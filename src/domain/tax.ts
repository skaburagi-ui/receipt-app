import { MAX_AMOUNT_YEN } from './limits';
import type { RoundingMode, TaxBreakdown, TaxInput, TaxRateBreakdown } from './types';

/**
 * 消費税計算。書類単位×税率ごとに1回だけ端数処理（明細ごとの端数処理の合計は禁止）。
 * 税込: 合計×10/110 (8/108)、税抜: 合計×10/100 (8/100)。担当: W1
 * 根拠：docs/review/worker-B-tax-legal.md §4（国税庁インボイスQ&A 問57、消費税法施行令70条の10）。
 */

/** n/d の整数商（n>=0, d>0）を端数処理つきで返す。浮動小数点の割り算を使わない。 */
function divideRounded(n: number, d: number, rounding: RoundingMode): number {
  const r = n % d;
  const q = (n - r) / d; // 切捨て
  if (r === 0) return q;
  switch (rounding) {
    case 'floor':
      return q;
    case 'ceil':
      return q + 1;
    case 'round':
      return r * 2 >= d ? q + 1 : q; // 四捨五入（0.5は切り上げ）
  }
}

/**
 * 計算対象にする明細金額か。正の整数で、1明細の上限（MAX_AMOUNT_YEN）以下のものだけ。
 * NaN・Infinity・負数・小数・上限超は計算から除いて整数演算を壊さない（指摘は validate 側の責務：item.amount.invalid / amount.tooLarge）。
 */
function isCountableAmount(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_AMOUNT_YEN;
}

export function calculateTax(input: TaxInput): TaxBreakdown {
  let taxable10 = 0;
  let taxable8 = 0;
  let nonTaxableYen = 0;
  let has10 = false;
  let has8 = false;

  for (const item of input.items) {
    if (!isCountableAmount(item.amountYen)) continue;
    switch (item.category) {
      case 'taxable10':
        taxable10 += item.amountYen;
        has10 = true;
        break;
      case 'taxable8':
        taxable8 += item.amountYen;
        has8 = true;
        break;
      default:
        // exempt / outOfScope / taxFree は税の対象外として合計する
        nonTaxableYen += item.amountYen;
    }
  }

  const byRate: TaxRateBreakdown[] = [];
  const build = (rate: 10 | 8, total: number): TaxRateBreakdown => {
    if (input.inputMode === 'inclusive') {
      const taxYen = divideRounded(total * rate, 100 + rate, input.rounding);
      return { rate, baseExclusiveYen: total - taxYen, taxYen, inclusiveYen: total };
    }
    const taxYen = divideRounded(total * rate, 100, input.rounding);
    return { rate, baseExclusiveYen: total, taxYen, inclusiveYen: total + taxYen };
  };
  if (has10) byRate.push(build(10, taxable10));
  if (has8) byRate.push(build(8, taxable8));

  const totalTaxYen = byRate.reduce((sum, r) => sum + r.taxYen, 0);
  const grandTotalYen = byRate.reduce((sum, r) => sum + r.inclusiveYen, 0) + nonTaxableYen;
  return { byRate, nonTaxableYen, grandTotalYen, totalTaxYen };
}
