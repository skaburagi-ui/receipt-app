import type { ValidationIssue } from './types';

/**
 * 登録番号の正規化と形式検証。
 * 根拠：docs/review/worker-B-tax-legal.md §5（T＋13桁。表記は半角・全角・ハイフン有無を問わない）。
 * チェックデジットは法人番号の算式のみ公式で確認できているため、不一致は「お知らせ（info）」にとどめる（個人事業者の番号は拒否しない）。
 */

/** 全角英数字→半角（NFKC）。ハイフン類・空白・その他の記号・日本語（「登録番号：」など）はすべて除去する。 */
function cleanRegistrationText(input: string): string {
  return (input ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * 法人番号のチェックデジット検証（12桁の基礎番号の前に検査用数字が付く13桁）。
 * 最下位桁を1桁目として、奇数桁の和 S_odd、偶数桁の和 S_even、S = S_even×2 + S_odd、検査用数字 = 9 − (S mod 9)。
 * 公式例：基礎番号 700110005901 → 法人番号 8700110005901。
 */
export function isValidCorporateNumberCheckDigit(thirteenDigits: string): boolean {
  if (!/^[0-9]{13}$/.test(thirteenDigits)) return false;
  const check = Number(thirteenDigits[0]);
  const base = thirteenDigits.slice(1); // 12桁
  let sOdd = 0;
  let sEven = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(base[11 - i]); // i=0 が最下位桁（1桁目）
    if (i % 2 === 0) sOdd += digit;
    else sEven += digit;
  }
  const s = sEven * 2 + sOdd;
  return 9 - (s % 9) === check;
}

function buildIssues(normalized: string): ValidationIssue[] {
  if (!/^T[0-9]{13}$/.test(normalized)) {
    return [
      {
        code: 'registration.format',
        level: 'error',
        field: 'issuer.registrationNumber',
        message: '登録番号は「T」のあとに数字13桁を続けた形式です。入力内容をご確認ください（例：T1234567890123）。',
      },
    ];
  }
  const digits = normalized.slice(1);
  // 法人番号の体裁（先頭桁が1〜9）の場合のみ検査用数字を確認する。個人事業者の番号は算式が未確認のため、お知らせ（info）にとどめる。
  if (/^[1-9]/.test(digits) && !isValidCorporateNumberCheckDigit(digits)) {
    return [
      {
        code: 'registration.checkdigit',
        level: 'info',
        field: 'issuer.registrationNumber',
        message:
          '法人の登録番号の場合、数字の並びが合っていません。個人事業者の番号は、この確認の対象ではありません。入力ミスがないかご確認ください。',
      },
    ];
  }
  return [];
}

/** 全角→半角、ハイフン・空白・記号を除去、先頭を大文字Tに。空入力は normalized=null、issuesなし。担当: W1 */
export function normalizeRegistrationNumber(input: string): { normalized: string | null; issues: ValidationIssue[] } {
  const cleaned = cleanRegistrationText(input);
  if (cleaned === '') return { normalized: null, issues: [] };
  // 数字だけが入力された場合（「T」の付け忘れ）は先頭にTを補う。
  const normalized = /^[0-9]/.test(cleaned) ? `T${cleaned}` : cleaned;
  return { normalized, issues: buildIssues(normalized) };
}

/** 形式（T＋13桁）を検証。法人番号形式（T+法人番号）の場合のみチェックデジット不一致を info にする（個人事業者の番号は形式のみ）。担当: W1 */
export function validateRegistrationNumber(input: string): ValidationIssue[] {
  return normalizeRegistrationNumber(input).issues;
}
