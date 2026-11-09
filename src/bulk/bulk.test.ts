import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { decodeCsvBytes } from './csv';
import {
  buildRecipientCsvTemplate, normalizeAmount, parseRecipientsFromCsv, parseRecipientsFromPaste, validateRecipients,
} from './recipients';
import { assignReceiptNumbers } from './numbering';
import { sanitizeCsvCell } from './export';

const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));

describe('decodeCsvBytes', () => {
  const sample = '宛名\n髙橋 﨑山 ①㈱\n';
  it('CP932 を Shift_JIS として復元（UTF-8 としては不正）', () => {
    const bytes = new Uint8Array(iconv.encode(sample, 'cp932'));
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toThrow();
    const r = decodeCsvBytes(bytes);
    expect(r.encoding).toBe('shift_jis');
    expect(r.text).toBe(sample);
    expect(r.text).toContain('髙橋');
    expect(r.text).toContain('﨑');
    expect(r.text).toContain('①㈱');
  });
  it('BOM付きUTF-8', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(sample)]);
    const r = decodeCsvBytes(bytes);
    expect(r).toEqual({ text: sample, encoding: 'utf-8-bom' });
  });
  it('BOMなしUTF-8', () => {
    expect(decodeCsvBytes(utf8(sample))).toEqual({ text: sample, encoding: 'utf-8' });
  });
  it('UTF-16LE（BOM付き）', () => {
    const bytes = new Uint8Array(iconv.encode(sample, 'utf-16le', { addBOM: true }));
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xfe);
    expect(decodeCsvBytes(bytes)).toEqual({ text: sample, encoding: 'utf-16le' });
  });
  it('空のバイト列・ASCIIのみ', () => {
    expect(decodeCsvBytes(new Uint8Array()).text).toBe('');
    expect(decodeCsvBytes(utf8('a,b')).encoding).toBe('utf-8');
  });
});

describe('parseRecipientsFromCsv', () => {
  it('ヘッダーあり・別名・順不同', () => {
    const csv = '備考,名前,〒,Honorific,住所,担当者名,group,コード\nm1,山田太郎,100-0001,様,東京,花子,営業,C1\n';
    const { rows, issues } = parseRecipientsFromCsv(csv);
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      { sourceRow: 1, name: '山田太郎', honorific: '様', code: 'C1', postalCode: '100-0001', address: '東京', contactPerson: '花子', group: '営業', memo: 'm1' },
    ]);
  });
  it('すべての宛名別名を認識', () => {
    for (const h of ['宛名', '名前', '氏名', '会社名', '取引先', '顧客名', 'name', 'NAME']) {
      const { rows } = parseRecipientsFromCsv(`${h}\n甲\n`);
      expect(rows.map((r) => r.name)).toEqual(['甲']);
    }
  });
  it('ヘッダーなしは1列目が宛名、空行は無視、sourceRow は1始まり', () => {
    const { rows } = parseRecipientsFromCsv('山田太郎,様\n\n   \n佐藤花子\n');
    expect(rows.map((r) => [r.sourceRow, r.name])).toEqual([[1, '山田太郎'], [4, '佐藤花子']]);
  });
  it('ヘッダーなしの2列目は既知の敬称だけを読む', () => {
    const { rows } = parseRecipientsFromPaste('山田太郎\t様\n株式会社A\t御中\n佐藤花子\t東京都\n');
    expect(rows.map((r) => [r.name, r.honorific])).toEqual([
      ['山田太郎', '様'], ['株式会社A', '御中'], ['佐藤花子', ''],
    ]);
  });
  it('ヘッダー行を除いて sourceRow を数える', () => {
    const { rows } = parseRecipientsFromCsv('宛名\nA\nB\n');
    expect(rows.map((r) => r.sourceRow)).toEqual([1, 2]);
  });
  it('宛名列のない見出しはエラー', () => {
    const { rows, issues } = parseRecipientsFromCsv('住所,メモ\nx,y\n');
    expect(rows).toEqual([]);
    expect(issues[0].code).toBe('bulk.header.name_missing');
  });
  it('空文字列・BOM付き・CRLF/CR 混在', () => {
    expect(parseRecipientsFromCsv('').rows).toEqual([]);
    const { rows } = parseRecipientsFromCsv('﻿宛名,敬称\r\nA,様\rB,御中\nC,\r\n');
    expect(rows.map((r) => [r.name, r.honorific])).toEqual([['A', '様'], ['B', '御中'], ['C', '']]);
  });
  it('引用符・カンマ・セル内改行', () => {
    const { rows } = parseRecipientsFromCsv('宛名,住所\n"株式会社A, B","東京都\n千代田区"\n"say ""hi""",x\n');
    expect(rows[0].name).toBe('株式会社A, B');
    expect(rows[0].address).toBe('東京都\n千代田区');
    expect(rows[1].name).toBe('say "hi"');
  });
  it('髙・﨑・㈱ を正規化せず保持、全角/半角スペースは前後トリム', () => {
    const { rows } = parseRecipientsFromCsv('宛名\n　髙橋　﨑山㈱ 　\n');
    expect(rows[0].name).toBe('髙橋　﨑山㈱');
  });
  it('制御文字（タブ・改行以外）を除去', () => {
    const { rows } = parseRecipientsFromCsv('宛名,メモ\nA\u0000B\u0007,x\u001by\ta\n');
    expect(rows[0].name).toBe('AB');
    expect(rows[0].memo).toBe('xy\ta');
  });
  it('数式文字列は取り込み時には文字列のまま保持', () => {
    const { rows } = parseRecipientsFromCsv('宛名\n=cmd|\' /C calc\'!A0\n＝1+1\n@SUM(1)\n');
    expect(rows.map((r) => r.name)).toEqual(["=cmd|' /C calc'!A0", '＝1+1', '@SUM(1)']);
  });
  it('宛名が空の行も保持（validate で検出）', () => {
    const { rows } = parseRecipientsFromCsv('宛名,敬称\n,様\nA,\n');
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('');
  });
});

describe('行数・サイズ上限', () => {
  const makeCsv = (n: number) => '宛名\n' + Array.from({ length: n }, (_, i) => `客${i + 1}`).join('\n') + '\n';
  it('300行はOK', () => {
    const r = parseRecipientsFromCsv(makeCsv(300));
    expect(r.rows).toHaveLength(300);
    expect(r.issues).toEqual([]);
  });
  it('301行は300行まで読み error bulk.limit.rows', () => {
    const r = parseRecipientsFromCsv(makeCsv(301));
    expect(r.rows).toHaveLength(300);
    expect(r.rows[299].name).toBe('客300');
    expect(r.issues.map((i) => [i.code, i.level])).toEqual([['bulk.limit.rows', 'error']]);
  });
  it('貼り付けでも同様', () => {
    const r = parseRecipientsFromPaste(Array.from({ length: 301 }, (_, i) => `客${i}`).join('\n'));
    expect(r.rows).toHaveLength(300);
    expect(r.issues[0].code).toBe('bulk.limit.rows');
  });
  it('空行は行数に数えない', () => {
    const csv = '宛名\n' + Array.from({ length: 300 }, (_, i) => `客${i}\n\n`).join('');
    const r = parseRecipientsFromCsv(csv);
    expect(r.rows).toHaveLength(300);
    expect(r.issues).toEqual([]);
  });
  const MB5 = 5 * 1024 * 1024;
  it('ちょうど5MBはOK', () => {
    const head = '宛名\nA\n';
    const text = head + 'x'.repeat(MB5 - Buffer.byteLength(head));
    expect(Buffer.byteLength(text, 'utf8')).toBe(MB5);
    const r = parseRecipientsFromCsv(text);
    expect(r.issues.find((i) => i.code === 'bulk.limit.size')).toBeUndefined();
    expect(r.rows).toHaveLength(2);
    // 1バイト増えると超過。
    expect(parseRecipientsFromCsv(text + 'x').issues.map((i) => i.code)).toContain('bulk.limit.size');
  });
  it('5MB超は読み込まず error bulk.limit.size、読めた範囲の rows は返す', () => {
    const line = 'x'.repeat(1023) + '\n';
    const text = '宛名\n' + line.repeat(5 * 1024 + 10);
    const r = parseRecipientsFromCsv(text);
    expect(r.issues.map((i) => i.code)).toContain('bulk.limit.size');
    expect(r.issues.find((i) => i.code === 'bulk.limit.size')!.level).toBe('error');
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.length).toBeLessThanOrEqual(300);
    expect(r.rows.every((x) => x.name.length === 1023)).toBe(true);
  });
  it('5MB超（日本語＝多バイト）でも落ちない', () => {
    const text = '宛名\n' + '山田太郎\n'.repeat(Math.ceil(MB5 / 13) + 10);
    const r = parseRecipientsFromCsv(text);
    expect(r.issues.map((i) => i.code)).toContain('bulk.limit.size');
    expect(r.rows).toHaveLength(300);
  });
});

describe('parseRecipientsFromPaste', () => {
  it('Excelの貼り付け（ヘッダー付き・セル内改行・引用符）', () => {
    const text = '宛名\t敬称\t住所\r\n株式会社A\t御中\t"東京都\r\n千代田区1-1"\r\n"山田 ""太郎"""\t様\t\r\n';
    const { rows, issues } = parseRecipientsFromPaste(text);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: '株式会社A', honorific: '御中', address: '東京都\n千代田区1-1' });
    expect(rows[1]).toMatchObject({ name: '山田 "太郎"', honorific: '様', address: '' });
  });
  it('1列の縦貼り付け（ヘッダーなし）', () => {
    const { rows } = parseRecipientsFromPaste('山田太郎\n佐藤花子\n鈴木一郎');
    expect(rows.map((r) => r.name)).toEqual(['山田太郎', '佐藤花子', '鈴木一郎']);
  });
  it('1行1列だけ', () => {
    expect(parseRecipientsFromPaste('山田太郎').rows.map((r) => r.name)).toEqual(['山田太郎']);
  });
  it('1列でヘッダー付き', () => {
    expect(parseRecipientsFromPaste('宛名\nA\nB').rows.map((r) => r.name)).toEqual(['A', 'B']);
  });
  it('宛名にカンマを含んでも分割しない（タブ固定）', () => {
    const { rows } = parseRecipientsFromPaste('A, Inc.\tご担当者\nB, Ltd.\t');
    expect(rows.map((r) => r.name)).toEqual(['A, Inc.', 'B, Ltd.']);
  });
  it('CR のみの改行', () => {
    expect(parseRecipientsFromPaste('A\rB\rC').rows.map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
});

describe('validateRecipients', () => {
  const row = (sourceRow: number, name: string, extra: Partial<Record<string, string>> = {}) => ({
    sourceRow, name, honorific: '', code: '', postalCode: '', address: '', contactPerson: '', group: '', memo: '', ...extra,
  });
  it('空欄は error recipient.empty（field に行番号）', () => {
    const issues = validateRecipients([row(1, 'A'), row(2, ''), row(3, '　')]);
    expect(issues.map((i) => [i.code, i.level, i.field])).toEqual([
      ['recipient.empty', 'error', '2'],
      ['recipient.empty', 'error', '3'],
    ]);
  });
  it('完全一致の重複は warning（どの行と重複か）', () => {
    const issues = validateRecipients([row(1, '山田'), row(2, '山田太郎'), row(5, '山田'), row(6, '山田')]);
    expect(issues.map((i) => [i.code, i.level, i.field])).toEqual([
      ['recipient.duplicate', 'warning', '5'],
      ['recipient.duplicate', 'warning', '6'],
    ]);
    expect(issues[0].message).toContain('1行目');
    expect(issues[1].message).toContain('1行目');
  });
  it('異体字は別の宛名（髙橋≠高橋）', () => {
    expect(validateRecipients([row(1, '髙橋'), row(2, '高橋')])).toEqual([]);
  });
  it('空欄は重複として数えない', () => {
    expect(validateRecipients([row(1, ''), row(2, '')]).map((i) => i.code)).toEqual(['recipient.empty', 'recipient.empty']);
  });
  it('長さ超過は警告のみ（宛名100字は可・101字で警告、メモ200字）', () => {
    expect(validateRecipients([row(1, 'あ'.repeat(100))])).toEqual([]);
    const issues = validateRecipients([row(1, 'あ'.repeat(101), { memo: 'x'.repeat(201), address: 'y'.repeat(200) })]);
    expect(issues.map((i) => [i.code, i.level, i.field])).toEqual([
      ['bulk.field.truncated', 'warning', '1.name'],
      ['bulk.field.truncated', 'warning', '1.memo'],
    ]);
  });
  it('サロゲートペアは1字として数える', () => {
    expect(validateRecipients([row(1, '𠮷'.repeat(100))])).toEqual([]);
  });
  it('制御文字が残っていれば警告', () => {
    expect(validateRecipients([row(1, 'A\u0000')]).map((i) => i.code)).toEqual(['bulk.field.control']);
  });
  it('取り込み→検証の通し', () => {
    const { rows } = parseRecipientsFromCsv('宛名\nA\n\nA\n,x\n');
    const codes = validateRecipients(parseRecipientsFromCsv('宛名,敬称\nA,\nA,\n,様\n').rows).map((i) => i.code);
    expect(rows.length).toBe(3);
    expect(codes).toEqual(['recipient.duplicate', 'recipient.empty']);
  });
});

describe('normalizeAmount', () => {
  it.each([
    ['１，２３４円', 1234],
    ['1,234', 1234],
    ['¥1,234', 1234],
    ['￥１２３４', 1234],
    ['  1234円  ', 1234],
    ['　1,234 円　', 1234],
    ['0', 0],
    ['007', 7],
    ['999999999999999', 999999999999999],
  ])('%s → %s', (input, expected) => {
    expect(normalizeAmount(input)).toBe(expected);
  });
  it.each(['', '   ', '-100', '－100', '12.5', '１２．５', '1000000000000000', '１０００００００００００００００', 'abc', '12a', '1 234', '円', '¥', '1e3', '(100)'])(
    '不正 %j → null',
    (input) => {
      expect(normalizeAmount(input)).toBeNull();
    },
  );
});

describe('buildRecipientCsvTemplate', () => {
  it('BOM付き・CRLF・ヘッダー＋記入例で、自分で読み戻せる', () => {
    const t = buildRecipientCsvTemplate();
    expect(t.charCodeAt(0)).toBe(0xfeff);
    const lines = t.slice(1).split('\r\n');
    expect(lines[0]).toBe('宛名,敬称,宛先コード,郵便番号,住所,担当者,グループ,メモ');
    expect(lines[1]).toBe('山田太郎,様,,,,,,');
    expect(t.slice(1)).not.toMatch(/(?<!\r)\n/);
    const { rows, issues } = parseRecipientsFromCsv(t);
    expect(issues).toEqual([]);
    expect(rows.length).toBe(2);
    expect(rows[1].honorific).toBe('御中');
    // バイト列経由でも BOM 付き UTF-8 と判別される。
    expect(decodeCsvBytes(new Uint8Array(Buffer.from(t, 'utf8'))).encoding).toBe('utf-8-bom');
  });
});

describe('assignReceiptNumbers', () => {
  it('start が null → 空文字の配列', () => {
    expect(assignReceiptNumbers(3, { prefix: 'R-', start: null, digits: 4 })).toEqual(['', '', '']);
  });
  it('接頭辞＋0埋め連番', () => {
    expect(assignReceiptNumbers(3, { prefix: 'R-', start: 1, digits: 4 })).toEqual(['R-0001', 'R-0002', 'R-0003']);
  });
  it('桁あふれはそのまま', () => {
    expect(assignReceiptNumbers(3, { prefix: '', start: 98, digits: 2 })).toEqual(['98', '99', '100']);
    expect(assignReceiptNumbers(2, { prefix: 'A', start: 9999, digits: 4 })).toEqual(['A9999', 'A10000']);
  });
  it('0始まり・digits 0/1', () => {
    expect(assignReceiptNumbers(2, { prefix: 'N', start: 0, digits: 3 })).toEqual(['N000', 'N001']);
    expect(assignReceiptNumbers(2, { prefix: '', start: 5, digits: 0 })).toEqual(['5', '6']);
  });
  it('count<=0 は空配列', () => {
    expect(assignReceiptNumbers(0, { prefix: 'R', start: 1, digits: 3 })).toEqual([]);
    expect(assignReceiptNumbers(-2, { prefix: 'R', start: null, digits: 3 })).toEqual([]);
  });
  it('start が負数・非整数なら例外でなく番号なし', () => {
    expect(assignReceiptNumbers(2, { prefix: 'R', start: -1, digits: 3 })).toEqual(['', '']);
    expect(assignReceiptNumbers(2, { prefix: 'R', start: 1.5, digits: 3 })).toEqual(['', '']);
    expect(assignReceiptNumbers(2, { prefix: 'R', start: NaN, digits: 3 })).toEqual(['', '']);
  });
  it('300件', () => {
    const r = assignReceiptNumbers(300, { prefix: 'R', start: 1, digits: 3 });
    expect(r[0]).toBe('R001');
    expect(r[299]).toBe('R300');
  });
});

describe('sanitizeCsvCell', () => {
  it.each(['=cmd|\' /C calc\'!A0', '+81-3-0000', '-100', '@SUM(A1)', '\tx', '\rx', '\nx', '＝1+1', '＋1', '－1', '＠x'])(
    '%j は先頭に \' を付ける',
    (v) => {
      expect(sanitizeCsvCell(v)).toBe(`'${v}`);
    },
  );
  it.each(['', 'abc', '山田太郎', '1-2-3', 'a=b', ' =1', "'=1", '100', '１２３'])('%j はそのまま', (v) => {
    expect(sanitizeCsvCell(v)).toBe(v);
  });
});
