import type { ReceiptInput, ValidationIssue } from './types';
import { calculateTax } from './tax';
import { normalizeRegistrationNumber } from './registration';
import { MAX_AMOUNT_YEN } from './limits';

/**
 * モード別の検証。error があれば適格系の発行は止める（general は error を出さず warning まで）。
 * 担当: W1。issue.code の一覧は docs/ARCHITECTURE.md の「検証コード」に追記すること。
 * 根拠：docs/review/worker-B-tax-legal.md §2〜§6。AIの判定で法的適合性は保証できない。迷う箇所は保守的に倒す。
 */

function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

const stripSpaces = (s: string) => (s ?? '').replace(/[\s　]/g, '');

/** かな・表記ゆれをそろえる：NFKC、空白除去、カタカナ→ひらがな、旧字「樣」→「様」、「御客」「御得意」→「お客」「お得意」。 */
function normalizeNameWord(s: string): string {
  return (s ?? '')
    .normalize('NFKC')
    .replace(/[\s　]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/樣/g, '様')
    .replace(/御(客|得意)/g, 'お$1');
}

/**
 * 宛名が実質空か：空白と、「上様」の別表記（上様・うえさま・ウエサマ・上樣・うえ様・お客様・お客さま・御客様・お得意様 等）、
 * 敬称（御中・様・殿・各位）だけで構成されるもの。名前と敬称を結合した後で判定する。
 */
const EMPTY_RECIPIENT_WORDS = /お得意さま|お得意様|おとくいさま|おきゃくさま|お客さま|お客様|上さま|上様|うえさま|うえ様|御中|各位|お客|殿|様|さま/g;
function isEffectivelyEmptyRecipient(name: string, honorific: string): boolean {
  const combined = normalizeNameWord(name) + normalizeNameWord(honorific);
  return combined.replace(EMPTY_RECIPIENT_WORDS, '') === '';
}

/** 区切り（空白・各種ハイフン・ダッシュ・長音・下線・ピリオド・コロン・中黒）を除いたうえで、T＋数字13桁が現れるか。直前が英字のとき（品番の一部など）は対象にしない。 */
function looksLikeRegistrationNumber(text: string): boolean {
  const stripped = (text ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s\-‐-―−ー_.:・,]/g, '');
  return /(?<![A-Z])T[0-9]{13}/.test(stripped);
}

/** 曖昧な但し書き（「お品代として」等）。内容が具体的でないものを警告する。 */
const VAGUE_PROVISO = new Set([
  'お品代', '品代', '商品代', '商品代金', '代金', 'お代金', 'お代', '代', '料金', 'お料金', '諸費用', '諸経費', '費用',
  '一式', 'お買上', 'お買上げ', 'お買い上げ', 'お支払', 'お支払い', '支払', '支払い', '上記', '上記代金', '上記金額', '代金一式',
]);
function isVagueProviso(proviso: string): boolean {
  let s = stripSpaces(proviso);
  s = s.replace(/^(但し|但|ただし|たゞし)[、,]?/, '');
  s = s.replace(/(として|にて)?[。.．]*$/, '');
  return VAGUE_PROVISO.has(s);
}

export function validateReceipt(input: ReceiptInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (code: string, level: ValidationIssue['level'], message: string, field?: string) =>
    issues.push(field ? { code, level, field, message } : { code, level, message });

  const mode = input.mode;
  const qualifiedLike = mode === 'qualified' || mode === 'qualifiedSimple';
  const breakdown = calculateTax(input.tax);
  const items = input.tax.items;
  const hasPositiveItem = items.some((i) => Number.isSafeInteger(i.amountYen) && i.amountYen > 0);

  // ───── 全モード共通（法令由来でない基本検証） ─────
  if (stripSpaces(input.issuer.name) === '') {
    push('issuer.name.required', 'error', '発行者（領収書を出す人・会社）の名前を入力してください。', 'issuer.name');
  }
  const tooLargeIdx = items.map((i, idx) => (Number.isFinite(i.amountYen) && i.amountYen > MAX_AMOUNT_YEN ? idx + 1 : 0)).filter((n) => n > 0);
  if (breakdown.grandTotalYen <= 0 && tooLargeIdx.length === 0) {
    push('amount.required', 'error', '金額を入力してください。領収金額が0円になっています。', 'tax.items');
  }
  if (tooLargeIdx.length > 0) {
    push(
      'amount.tooLarge',
      'error',
      `金額が大きすぎます（${tooLargeIdx.join('・')}行目）。1つの明細は${MAX_AMOUNT_YEN.toLocaleString('ja-JP')}円までです。桁を確認してください。`,
      'tax.items',
    );
  } else if (breakdown.grandTotalYen > MAX_AMOUNT_YEN) {
    push(
      'amount.tooLarge',
      'error',
      `領収金額の合計が大きすぎます。合計は${MAX_AMOUNT_YEN.toLocaleString('ja-JP')}円までです。桁を確認してください。`,
      'tax.items',
    );
  }
  if (items.some((i) => !Number.isInteger(i.amountYen) || i.amountYen < 0)) {
    push(
      'item.amount.invalid',
      'error',
      '金額は0以上の整数（円）で入力してください。マイナスや小数は使えません。値引き・返品は、この画面では扱えません。',
      'tax.items',
    );
  }
  const dateFields: [string, string, string][] = [
    ['receiptDate', input.receiptDate, '領収日'],
    ['issueDate', input.issueDate ?? '', '発行日'],
    ['transactionDate', input.transactionDate, '取引日'],
  ];
  for (const [field, value, label] of dateFields) {
    if (value === '') {
      // 発行日は空（＝領収日と同じ）が正常。取引日の空は適格系で別コードにより指摘する。領収日の空は不正。
      if (field === 'receiptDate') push('date.invalid', 'error', `${label}が入力されていません。日付を選んでください。`, field);
      continue;
    }
    if (!isValidDate(value)) {
      push('date.invalid', 'error', `${label}の日付が正しくありません。実在する日付を「年-月-日」の形で入力してください。`, field);
    }
  }

  const recipientEmpty = stripSpaces(input.recipient.name) === '';
  const provisoEmpty = stripSpaces(input.proviso) === '';

  // ───── 訂正書面（correction が非null のとき） ─────
  const corr = input.correction;
  if (corr) {
    const origDate = (corr.originalDate ?? '').trim();
    const origNo = (corr.originalNumber ?? '').trim();
    if (origDate === '' && origNo === '') {
      push('correction.original.required', 'error', '訂正する元の書類の日付か番号のどちらかを入力してください。どの書類の訂正か分かるようにする必要があります。', 'correction.originalDate');
    }
    if (origDate !== '' && !isValidDate(origDate)) {
      push('date.invalid', 'error', '元の書類の日付が正しくありません。実在する日付を「年-月-日」の形で入力してください。', 'correction.originalDate');
    }
    if ((corr.changes ?? '').trim() === '') {
      if (qualifiedLike) {
        push('correction.changes.required', 'error', '修正した箇所を入力してください。インボイスを修正して交付するときは、修正した事項を示す必要があります（例：誤 10,000円 → 正 11,000円）。', 'correction.changes');
      } else {
        push('correction.changes.empty', 'warning', '修正した箇所が空欄です。何をどう直したか（例：誤 10,000円 → 正 11,000円）を書いておくと、相手に伝わります。', 'correction.changes');
      }
    }
  }

  // ───── general ─────
  if (mode === 'general') {
    if (stripSpaces(input.issuer.registrationNumber) !== '') {
      push(
        'registration.ignoredInGeneral',
        'warning',
        '一般領収書には登録番号を印字しません。インボイスとして発行するならモードを切り替えてください。',
        'issuer.registrationNumber',
      );
    }
    // 自由記述欄に登録番号らしい文字列があると、登録のない書類が適格請求書と誤認されるおそれがある（消費税法第57条の5）。
    const freeTexts: [string, string][] = [
      ['issuer.name', input.issuer.name],
      ['issuer.postalCode', input.issuer.postalCode],
      ['issuer.address', input.issuer.address],
      ['issuer.phone', input.issuer.phone],
      ['recipient.name', input.recipient.name],
      ['proviso', input.proviso],
      ['remarks', input.remarks],
      ['receiptNumber', input.receiptNumber],
      ['copyInfo.issuedBy', input.copyInfo?.issuedBy],
      ['copyInfo.paymentChannel', input.copyInfo?.paymentChannel],
      ['copyInfo.internalNote', input.copyInfo?.internalNote],
      ['correction.originalDate', corr?.originalDate ?? ''],
      ['correction.originalNumber', corr?.originalNumber ?? ''],
      ['correction.changes', corr?.changes ?? ''],
      ...items.map((i): [string, string] => ['tax.items', i.description]),
    ];
    const seen = new Set<string>();
    for (const [field, value] of freeTexts) {
      if (!seen.has(field) && looksLikeRegistrationNumber(value)) {
        seen.add(field);
        push(
          'text.registrationLike',
          'error',
          '登録番号のように見える文字列があります。インボイスとして発行するならモードを切り替え、そうでなければ消してください。消費税法上、登録のない書類が適格請求書と誤認されるおそれがあります。',
          field,
        );
      }
    }
    if (recipientEmpty) {
      push('recipient.empty', 'warning', '宛名が空欄です。空欄のまま発行もできますが、相手先の名前を入れることをおすすめします。', 'recipient.name');
    }
    if (provisoEmpty) {
      push('proviso.empty', 'warning', '但し書きが空欄です。「但し ○○として」の内容を入れておくと、何の代金か分かりやすくなります。', 'proviso');
    }
    return issues;
  }

  // ───── 適格請求書・適格簡易請求書に共通 ─────
  if (qualifiedLike) {
    const reg = normalizeRegistrationNumber(input.issuer.registrationNumber);
    if (reg.normalized === null) {
      push('registration.required', 'error', 'インボイスには登録番号（Tのあとに数字13桁）が必要です。登録番号を入力してください。', 'issuer.registrationNumber');
    } else {
      issues.push(...reg.issues);
    }
    if (stripSpaces(input.transactionDate) === '') {
      push('transactionDate.required', 'error', '取引日（商品を渡した日・サービスを提供した日）を入力してください。', 'transactionDate');
    }
    if (!hasPositiveItem) {
      push('items.required', 'error', '金額が1円以上の明細を1行以上入力してください。', 'tax.items');
    }
    if (!input.confirmations.ownRegistrationNumber) {
      push('confirm.ownRegistration', 'error', '入力した登録番号がご自身のものであることを確認し、チェックを入れてください。', 'confirmations.ownRegistrationNumber');
    }
    if (isValidDate(input.receiptDate) && isValidDate(input.transactionDate) && input.receiptDate !== input.transactionDate) {
      push(
        'date.receiptVsTransaction',
        'info',
        'インボイスに記載する年月日は、領収日ではなく取引日になります。領収日と取引日が違うので、取引日が正しいかご確認ください。',
        'transactionDate',
      );
    }
  }

  // ───── qualified（適格請求書） ─────
  if (mode === 'qualified') {
    if (isEffectivelyEmptyRecipient(input.recipient.name, input.recipient.honorific)) {
      push(
        'recipient.required',
        'error',
        '適格請求書には、受け取る事業者の名前（会社名・屋号など）が必要です。空欄や「上様」だけでは発行できません。',
        'recipient.name',
      );
    }
    if (provisoEmpty) {
      push('proviso.required', 'error', '但し書き（何の代金か）を入力してください。インボイスには取引の内容が必要です。', 'proviso');
    }
    if (hasPositiveItem && breakdown.byRate.length === 0) {
      push(
        'tax.noTaxableItems',
        'warning',
        '消費税のかかる明細がありません。非課税・不課税・免税の取引だけの場合、インボイスを渡す義務がないことがあります。区分をご確認ください。',
        'tax.items',
      );
    }
  }

  // ───── qualifiedSimple（適格簡易請求書） ─────
  if (mode === 'qualifiedSimple') {
    if (hasPositiveItem && breakdown.byRate.length === 0) {
      push(
        'tax.noTaxableItems',
        'error',
        '消費税のかかる明細（10%・8%）がありません。適格簡易請求書には、税率ごとの対価の額と、税率または消費税額の記載が必要です。区分を確認してください。非課税・不課税・免税だけの取引は、インボイスを渡す義務がないことがあります。',
        'tax.items',
      );
    }
    if (!input.confirmations.simpleInvoiceEligibleBusiness) {
      push(
        'confirm.simpleEligible',
        'error',
        '適格簡易請求書は、小売業・飲食店業など限られた事業で使えます。ご自身の事業が対象であることを確認し、チェックを入れてください。',
        'confirmations.simpleInvoiceEligibleBusiness',
      );
    }
    // 宛名は任意（空でも警告しない）
    if (provisoEmpty) {
      // 適格簡易請求書も「資産又は役務の内容」が記載事項のため、空欄は発行停止（レビューで仕様漏れを修正）
      push('proviso.required', 'error', '但し書き（何の代金か）を入力してください。簡易インボイスにも取引の内容が必要です。', 'proviso');
    }
  }

  // ───── 但し書きが曖昧（適格系） ─────
  if (qualifiedLike && !provisoEmpty && isVagueProviso(input.proviso)) {
    push(
      'proviso.vague',
      'warning',
      '但し書きが「お品代」などの大まかな表現です。インボイスでは取引の内容が分かるよう、具体的に書くことをおすすめします（例：飲食代として、○○の施工費として）。',
      'proviso',
    );
  }

  return issues;
}

/** 発行を止めるべき error があるか。 */
export function hasBlockingIssue(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
