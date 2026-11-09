import Papa from 'papaparse';
import type { RecipientRow, ValidationIssue } from '../domain/types';

/**
 * 解析結果。issues は取り込み段階の問題（上限超過・見出し不備・引用符の乱れ）のみ。
 * 宛名の空欄・重複・長さ超過は validateRecipients(rows) を呼び出し側が実行して得る。
 */
export interface ParseResult { rows: RecipientRow[]; issues: ValidationIssue[] }

export const MAX_ROWS = 300;
export const MAX_BYTES = 5 * 1024 * 1024;

type FieldKey = Exclude<keyof RecipientRow, 'sourceRow'>;

/** 各項目の長さ上限（文字数＝コードポイント）。超過は警告のみで切り詰めない。 */
export const FIELD_LIMITS: Record<FieldKey, number> = {
  name: 100,
  honorific: 20,
  code: 50,
  postalCode: 20,
  address: 200,
  contactPerson: 100,
  group: 100,
  memo: 200,
};

const FIELD_LABELS: Record<FieldKey, string> = {
  name: '宛名', honorific: '敬称', code: '宛先コード', postalCode: '郵便番号',
  address: '住所', contactPerson: '担当者', group: 'グループ', memo: 'メモ',
};

const FIELD_KEYS = Object.keys(FIELD_LIMITS) as FieldKey[];

const ALIASES: Record<FieldKey, string[]> = {
  name: ['宛名', '名前', '氏名', '会社名', '取引先', '顧客名', 'name'],
  honorific: ['敬称', 'honorific'],
  code: ['宛先コード', 'コード', 'code'],
  postalCode: ['郵便番号', '〒', 'postal'],
  address: ['住所', 'address'],
  contactPerson: ['担当者', '担当者名'],
  group: ['グループ', 'group'],
  memo: ['メモ', '備考', 'memo'],
};

const ALIAS_TO_KEY = new Map<string, FieldKey>();
for (const key of FIELD_KEYS) for (const a of ALIASES[key]) ALIAS_TO_KEY.set(a.toLowerCase(), key);

const KNOWN_HONORIFICS = new Set(['様', '御中', '殿', '各位', '先生', 'さま', '御一同様']);

/** タブ(\t)・改行(\n)以外の制御文字、BOM(U+FEFF)。 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F﻿]/g;
// eslint-disable-next-line no-control-regex
const HAS_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F﻿]/;

function charLength(s: string): number {
  let n = 0;
  for (const _ of s) { void _; n++; }
  return n;
}

/** 制御文字除去＋前後トリム（半角・全角スペース含む）。NFKC等の正規化はしない（髙→高を防ぐ）。 */
function cleanCell(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(CONTROL_CHARS, '').trim();
}

const headerKey = (cell: string): string => cleanCell(cell).replace(/[\s　]+/g, '').toLowerCase();

/** 5MBを超える場合、先頭5MBの範囲で最後の改行までに切り詰める。 */
function limitSize(text: string, issues: ValidationIssue[]): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= MAX_BYTES) return text;
  let head = new TextDecoder('utf-8').decode(bytes.subarray(0, MAX_BYTES)).replace(/�+$/, '');
  const cut = Math.max(head.lastIndexOf('\n'), head.lastIndexOf('\r'));
  head = cut >= 0 ? head.slice(0, cut) : '';
  issues.push({
    code: 'bulk.limit.size',
    level: 'error',
    message: '読み込めるサイズ（5MB）を超えています。超えた部分は読み込んでいません。ファイルを分けてください。',
  });
  return head;
}

function parseDelimited(input: string, delimiter: { fixed: string } | { guess: string[] }): ParseResult {
  const issues: ValidationIssue[] = [];
  const rows: RecipientRow[] = [];

  let text = limitSize(input, issues);
  text = text.replace(/^﻿/, '').replace(/\r\n|\r/g, '\n');

  const papaOpts: Papa.ParseConfig<string[]> = { header: false, skipEmptyLines: false, newline: '\n', quoteChar: '"' };
  if ('fixed' in delimiter) papaOpts.delimiter = delimiter.fixed;
  else { papaOpts.delimiter = ''; papaOpts.delimitersToGuess = delimiter.guess; }
  const parsed = Papa.parse<string[]>(text, papaOpts);
  const records = parsed.data;

  if (parsed.errors.some((e) => e.type === 'Quotes')) {
    issues.push({
      code: 'bulk.parse.quotes',
      level: 'warning',
      message: '引用符（"）の対応が取れていない箇所があります。内容を確認してください。',
    });
  }

  const isBlank = (r: string[]) => r.every((c) => cleanCell(c) === '');

  // ヘッダー判定：先頭の非空行に既知の列名が1つでもあればヘッダー。
  const firstIdx = records.findIndex((r) => !isBlank(r));
  if (firstIdx < 0) return { rows, issues };
  const colMap = new Map<FieldKey, number>();
  let hasHeader = false;
  records[firstIdx].forEach((cell, i) => {
    const key = ALIAS_TO_KEY.get(headerKey(cell));
    if (key !== undefined) {
      hasHeader = true;
      if (!colMap.has(key)) colMap.set(key, i);
    }
  });
  if (hasHeader && !colMap.has('name')) {
    issues.push({
      code: 'bulk.header.name_missing',
      level: 'error',
      message: '見出し行に宛名の列（宛名・名前・氏名・会社名・取引先・顧客名・name のいずれか）が見つかりません。',
    });
    return { rows, issues };
  }
  if (!hasHeader) colMap.set('name', 0);

  const dataStart = hasHeader ? firstIdx + 1 : firstIdx;
  // sourceRow はヘッダーを除いたレコード番号（空行も数える＝表計算ソフトの行番号−見出し行に一致）。
  for (let i = dataStart; i < records.length; i++) {
    const rec = records[i];
    if (isBlank(rec)) continue;
    if (rows.length >= MAX_ROWS) {
      issues.push({
        code: 'bulk.limit.rows',
        level: 'error',
        message: `1回に読み込める行数（${MAX_ROWS}行）を超えています。${MAX_ROWS}行目までを読み込み、残りは読み込んでいません。`,
      });
      break;
    }
    const row: RecipientRow = {
      sourceRow: i - dataStart + 1,
      name: '', honorific: '', code: '', postalCode: '', address: '', contactPerson: '', group: '', memo: '',
    };
    for (const [key, col] of colMap) row[key] = cleanCell(rec[col]);
    // 見出しなしの2列目は、既知の敬称だけを安全に取り込む。住所など別用途の値は従来どおり無視する。
    if (!hasHeader) {
      const second = cleanCell(rec[1]);
      if (KNOWN_HONORIFICS.has(second)) row.honorific = second;
    }
    rows.push(row);
  }
  return { rows, issues };
}

/** CSV（デコード済み文字列）から宛先を読む。ヘッダー有無・列名の別名（宛名/名前/氏名/会社名 等）に対応。上限300行・5MB。担当: W4 */
export function parseRecipientsFromCsv(text: string): ParseResult {
  return parseDelimited(text, { guess: [',', '\t'] });
}

/** Excel等からの貼り付け（タブ区切り、セル内改行は引用符）。区切りはタブ固定。担当: W4 */
export function parseRecipientsFromPaste(text: string): ParseResult {
  return parseDelimited(text, { fixed: '\t' });
}

/** 一覧の検証：空欄（error）・完全重複（warning）・長さ超過／制御文字（warning）。担当: W4 */
export function validateRecipients(rows: RecipientRow[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firstSeen = new Map<string, number>();
  for (const row of rows) {
    const r = String(row.sourceRow);
    if (row.name.trim() === '') {
      issues.push({ code: 'recipient.empty', level: 'error', field: r, message: `${row.sourceRow}行目：宛名が空欄です。` });
    } else {
      const prev = firstSeen.get(row.name);
      if (prev === undefined) firstSeen.set(row.name, row.sourceRow);
      else {
        issues.push({
          code: 'recipient.duplicate',
          level: 'warning',
          field: r,
          message: `${row.sourceRow}行目：宛名「${row.name}」が${prev}行目と重複しています。`,
        });
      }
    }
    for (const key of FIELD_KEYS) {
      const v = row[key];
      if (HAS_CONTROL.test(v)) {
        issues.push({
          code: 'bulk.field.control',
          level: 'warning',
          field: `${r}.${key}`,
          message: `${row.sourceRow}行目の${FIELD_LABELS[key]}に制御文字が含まれています。`,
        });
      }
      const len = charLength(v);
      if (len > FIELD_LIMITS[key]) {
        issues.push({
          code: 'bulk.field.truncated',
          level: 'warning',
          field: `${r}.${key}`,
          message: `${row.sourceRow}行目の${FIELD_LABELS[key]}が長すぎます（${len}字。目安は${FIELD_LIMITS[key]}字まで）。印刷時にはみ出す可能性があります。`,
        });
      }
    }
  }
  return issues;
}

/** 金額の正規化（全角数字・カンマ・円・¥）。不正（空・負数・小数・15桁超・数字以外）は null。担当: W4 */
export function normalizeAmount(input: string): number | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/[,，円¥￥]/g, '').trim();
  if (!/^[0-9]+$/.test(s) || s.length > 15) return null;
  return Number(s);
}

/** CSVテンプレート（UTF-8 BOM付き文字列、CRLF）。担当: W4 */
export function buildRecipientCsvTemplate(): string {
  const lines = [
    '宛名,敬称,宛先コード,郵便番号,住所,担当者,グループ,メモ',
    '山田太郎,様,,,,,,',
    '株式会社サンプル,御中,C001,000-0000,サンプル県サンプル市1-2-3,見本 花子,営業部,記入例（削除してください）',
  ];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
