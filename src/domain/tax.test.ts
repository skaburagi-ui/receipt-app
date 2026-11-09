import { describe, expect, it } from 'vitest';
import { calculateTax } from './tax';
import type { LineItem, RoundingMode, TaxInput, TaxInputMode } from './types';

const mk = (inputMode: TaxInputMode, rounding: RoundingMode, items: LineItem[]): TaxInput => ({ inputMode, rounding, items });
const it1 = (amountYen: number, category: LineItem['category'] = 'taxable10'): LineItem => ({ description: '', amountYen, category });

describe('calculateTax（国税庁Q&A問57の検証値）', () => {
  it('税込・10%・60,000円 → 税額5,454円（切捨て）', () => {
    const r = calculateTax(mk('inclusive', 'floor', [it1(60000)]));
    expect(r.byRate).toEqual([{ rate: 10, baseExclusiveYen: 54546, taxYen: 5454, inclusiveYen: 60000 }]);
    expect(r.totalTaxYen).toBe(5454);
    expect(r.grandTotalYen).toBe(60000);
  });
  it('税込・8%・40,000円 → 税額2,962円（切捨て）', () => {
    const r = calculateTax(mk('inclusive', 'floor', [it1(40000, 'taxable8')]));
    expect(r.byRate).toEqual([{ rate: 8, baseExclusiveYen: 37038, taxYen: 2962, inclusiveYen: 40000 }]);
  });
  it('105円×3明細（合計315円）→ 税額28円（明細ごとの27は誤り）', () => {
    const r = calculateTax(mk('inclusive', 'floor', [it1(105), it1(105), it1(105)]));
    expect(r.totalTaxYen).toBe(28);
    expect(r.totalTaxYen).not.toBe(27);
  });
});

describe('calculateTax 端数処理', () => {
  it('切捨て・四捨五入・切上げで差が出る', () => {
    const items = [it1(1000)]; // 1000×10/110 = 90.909…
    expect(calculateTax(mk('inclusive', 'floor', items)).totalTaxYen).toBe(90);
    expect(calculateTax(mk('inclusive', 'round', items)).totalTaxYen).toBe(91);
    expect(calculateTax(mk('inclusive', 'ceil', items)).totalTaxYen).toBe(91);
    const items2 = [it1(1001)]; // 91.0 ぴったり
    expect(calculateTax(mk('inclusive', 'ceil', items2)).totalTaxYen).toBe(91);
    const items3 = [it1(105)]; // 9.545…
    expect(calculateTax(mk('inclusive', 'floor', items3)).totalTaxYen).toBe(9);
    expect(calculateTax(mk('inclusive', 'round', items3)).totalTaxYen).toBe(10);
    expect(calculateTax(mk('inclusive', 'ceil', items3)).totalTaxYen).toBe(10);
    const items4 = [it1(104)]; // 9.4545… → 四捨五入は9、切上げは10
    expect(calculateTax(mk('inclusive', 'round', items4)).totalTaxYen).toBe(9);
    expect(calculateTax(mk('inclusive', 'ceil', items4)).totalTaxYen).toBe(10);
  });
  it('四捨五入は0.5を切り上げる（税抜 5円×10% = 0.5）', () => {
    expect(calculateTax(mk('exclusive', 'round', [it1(5)])).totalTaxYen).toBe(1);
    expect(calculateTax(mk('exclusive', 'floor', [it1(5)])).totalTaxYen).toBe(0);
    expect(calculateTax(mk('exclusive', 'ceil', [it1(5)])).totalTaxYen).toBe(1);
    expect(calculateTax(mk('exclusive', 'round', [it1(4)])).totalTaxYen).toBe(0); // 0.4
  });
  it('割り切れる場合は端数処理しても同じ', () => {
    for (const r of ['floor', 'round', 'ceil'] as const) {
      expect(calculateTax(mk('inclusive', r, [it1(110)])).totalTaxYen).toBe(10);
    }
  });
  it('大きな金額でも誤差が出ない（10億円）', () => {
    const r = calculateTax(mk('inclusive', 'floor', [it1(1_000_000_000)]));
    expect(r.totalTaxYen).toBe(90_909_090);
  });
});

describe('calculateTax 税抜入力・混在・非課税', () => {
  it('税抜入力：税抜×10%、税込＝税抜＋税額', () => {
    const r = calculateTax(mk('exclusive', 'floor', [it1(48000)]));
    expect(r.byRate).toEqual([{ rate: 10, baseExclusiveYen: 48000, taxYen: 4800, inclusiveYen: 52800 }]);
    expect(r.grandTotalYen).toBe(52800);
  });
  it('税抜入力：税率ごとの合計に1回だけ端数処理（明細ごとではない）', () => {
    // 税抜 15円×3 = 45 → 4.5 → 切捨て4。明細ごと(1.5→1)×3 = 3 は誤り
    const r = calculateTax(mk('exclusive', 'floor', [it1(15), it1(15), it1(15)]));
    expect(r.totalTaxYen).toBe(4);
  });
  it('10%と8%の混在：税率ごとに1回ずつ、10→8の順', () => {
    const r = calculateTax(mk('inclusive', 'floor', [it1(40000, 'taxable8'), it1(60000), it1(110)]));
    expect(r.byRate.map((b) => b.rate)).toEqual([10, 8]);
    // 60,110×10/110 = 5,464.5… → 5,464
    expect(r.byRate[0]).toEqual({ rate: 10, baseExclusiveYen: 60110 - 5464, taxYen: 5464, inclusiveYen: 60110 });
    expect(r.byRate[1].taxYen).toBe(2962);
    expect(r.totalTaxYen).toBe(5464 + 2962);
    expect(r.grandTotalYen).toBe(100110);
  });
  it('該当明細のない税率は含めない', () => {
    expect(calculateTax(mk('inclusive', 'floor', [it1(1080, 'taxable8')])).byRate.map((b) => b.rate)).toEqual([8]);
  });
  it('非課税・不課税・免税は nonTaxableYen に合計し、税額に入れない', () => {
    const r = calculateTax(
      mk('inclusive', 'floor', [it1(11000), it1(3000, 'exempt'), it1(2000, 'outOfScope'), it1(500, 'taxFree')]),
    );
    expect(r.nonTaxableYen).toBe(5500);
    expect(r.totalTaxYen).toBe(1000);
    expect(r.grandTotalYen).toBe(11000 + 5500);
  });
  it('課税明細がなければ byRate は空', () => {
    const r = calculateTax(mk('exclusive', 'floor', [it1(3000, 'exempt')]));
    expect(r).toEqual({ byRate: [], nonTaxableYen: 3000, grandTotalYen: 3000, totalTaxYen: 0 });
  });
  it('0以下・非整数の明細は無視し、例外を投げない', () => {
    const r = calculateTax(mk('inclusive', 'floor', [it1(-500), it1(0), it1(10.5), it1(NaN), it1(1100)]));
    expect(r.grandTotalYen).toBe(1100);
    expect(r.totalTaxYen).toBe(100);
  });
  it('明細なしは全部0', () => {
    expect(calculateTax(mk('inclusive', 'floor', []))).toEqual({ byRate: [], nonTaxableYen: 0, grandTotalYen: 0, totalTaxYen: 0 });
  });
});
