import { describe, expect, it } from 'vitest';
import { guideStampDuty } from './stamp';
import { STAMP_DUTY_TABLE_SALES, lookupStampDuty } from './stampDutyTable';
import { createDefaultReceipt } from './defaults';
import type { PaymentMethod, ReceiptInput, TaxInputMode } from './types';

function receipt(
  amountYen: number,
  over: {
    inputMode?: TaxInputMode;
    taxpayerType?: ReceiptInput['issuer']['taxpayerType'];
    businessNature?: ReceiptInput['issuer']['businessNature'];
    delivery?: ReceiptInput['delivery'];
    isSalesProceeds?: boolean;
    paymentMethod?: PaymentMethod | null;
    mode?: ReceiptInput['mode'];
  } = {},
): ReceiptInput {
  const r = createDefaultReceipt('2026-11-05');
  r.mode = over.mode ?? 'qualified';
  r.issuer.taxpayerType = over.taxpayerType ?? 'taxable';
  r.issuer.businessNature = over.businessNature ?? 'business';
  r.delivery = over.delivery ?? 'paper';
  r.isSalesProceeds = over.isSalesProceeds ?? true;
  r.paymentMethod = over.paymentMethod ?? 'cash';
  r.tax.inputMode = over.inputMode ?? 'inclusive';
  r.tax.items[0].amountYen = amountYen;
  return r;
}

describe('STAMP_DUTY_TABLE_SALES（No.7141 第17号の1）', () => {
  it('施行日・出典・確認日つき', () => {
    expect(STAMP_DUTY_TABLE_SALES.effectiveFrom).toBe('2026-04-01');
    expect(STAMP_DUTY_TABLE_SALES.checkedAt).toBe('2026-11-05');
    expect(STAMP_DUTY_TABLE_SALES.sourceUrl).toBe('https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7141.htm');
  });
  it('ブラケットの境界（以上／超）を固定する', () => {
    const t = (n: number) => lookupStampDuty(n);
    expect(t(1)).toBe(0);
    expect(t(49_999)).toBe(0);
    expect(t(50_000)).toBe(200);
    expect(t(1_000_000)).toBe(200);
    expect(t(1_000_001)).toBe(400);
    expect(t(2_000_000)).toBe(400);
    expect(t(2_000_001)).toBe(600);
    expect(t(3_000_000)).toBe(600);
    expect(t(3_000_001)).toBe(1_000);
    expect(t(5_000_000)).toBe(1_000);
    expect(t(5_000_001)).toBe(2_000);
    expect(t(10_000_000)).toBe(2_000);
    expect(t(10_000_001)).toBe(4_000);
    expect(t(20_000_000)).toBe(4_000);
    expect(t(20_000_001)).toBe(6_000);
    expect(t(30_000_000)).toBe(6_000);
    expect(t(30_000_001)).toBe(10_000);
    expect(t(50_000_000)).toBe(10_000);
    expect(t(50_000_001)).toBe(20_000);
    expect(t(100_000_000)).toBe(20_000);
    expect(t(100_000_001)).toBe(40_000);
    expect(t(200_000_000)).toBe(40_000);
    expect(t(200_000_001)).toBe(60_000);
    expect(t(300_000_000)).toBe(60_000);
    expect(t(300_000_001)).toBe(100_000);
    expect(t(500_000_000)).toBe(100_000);
    expect(t(500_000_001)).toBe(150_000);
    expect(t(1_000_000_000)).toBe(150_000);
    expect(t(1_000_000_001)).toBe(200_000);
    expect(t(9_999_999_999_999)).toBe(200_000);
  });
  it('ブラケットが隙間なく連続している', () => {
    const b = STAMP_DUTY_TABLE_SALES.brackets;
    expect(b).toHaveLength(15);
    for (let i = 1; i < b.length; i++) expect(b[i].overYen).toBe(b[i - 1].upToYen);
    expect(b[b.length - 1].upToYen).toBeNull();
  });
});

describe('guideStampDuty 判定ロジック', () => {
  it('1. クレジット・電子マネー・QR決済 → unknown', () => {
    for (const pm of ['creditCard', 'electronicMoney', 'qrPayment'] as const) {
      const g = guideStampDuty(receipt(60000, { paymentMethod: pm }));
      expect(g.level).toBe('unknown');
      expect(g.amountYen).toBeNull();
      expect(g.notes.join('')).toContain('判断できません');
    }
  });
  it('2. 営業か不明 → unknown ／ 営業に関しない → none', () => {
    expect(guideStampDuty(receipt(60000, { businessNature: 'unknown' })).level).toBe('unknown');
    const g = guideStampDuty(receipt(60000, { businessNature: 'nonBusiness' }));
    expect(g.level).toBe('none');
    expect(g.notes.join('')).toContain('個別に判断');
  });
  it('3. 電子交付 → none（紙は課税文書になり得る旨を注記）', () => {
    const g = guideStampDuty(receipt(600000, { delivery: 'electronic' }));
    expect(g.level).toBe('none');
    expect(g.notes.join('')).toContain('紙に印刷して渡す場合');
    expect(g.sources.some((s) => s.url === 'https://www.nta.go.jp/law/shitsugi/inshi/02/10.htm')).toBe(true);
  });
  it('4. 課税事業者・税額表示・税込52,800円（税抜48,000円）→ none', () => {
    const g = guideStampDuty(receipt(52800));
    expect(g.level).toBe('none');
    expect(g.premises.join('')).toContain('52,800円');
  });
  it('4. 同条件で税抜50,000円（税込55,000円）→ estimate 200円', () => {
    const g = guideStampDuty(receipt(50000, { inputMode: 'exclusive' }));
    expect(g.level).toBe('estimate');
    expect(g.amountYen).toBe(200);
  });
  it('4. 免税事業者で税込52,800円 → estimate 200円', () => {
    const g = guideStampDuty(receipt(52800, { taxpayerType: 'exempt' }));
    expect(g.level).toBe('estimate');
    expect(g.amountYen).toBe(200);
  });
  it('4. 課税事業者でも税額が書面に出ない（一般モード既定）なら税込で判定', () => {
    const g = guideStampDuty(receipt(52800, { mode: 'general' }));
    expect(g.level).toBe('estimate');
    expect(g.amountYen).toBe(200);
    // 呼び出し側が税額表示ありを明示すれば税抜で判定
    expect(guideStampDuty(receipt(52800, { mode: 'general' }), { taxAmountShown: true }).level).toBe('none');
  });
  it('4. 事業者区分が不明で税込と税抜の区分が異なる → unknown', () => {
    const g = guideStampDuty(receipt(52800, { taxpayerType: 'unknown' }));
    expect(g.level).toBe('unknown');
  });
  it('4. 事業者区分が不明でも税込・税抜が同じ区分なら採用', () => {
    const g = guideStampDuty(receipt(110000, { taxpayerType: 'unknown' })); // 税抜100,000円
    expect(g.level).toBe('estimate');
    expect(g.amountYen).toBe(200);
    const g2 = guideStampDuty(receipt(11000, { taxpayerType: 'unknown' })); // 税抜10,000円
    expect(g2.level).toBe('none');
  });
  it('5. 売上代金以外（17号の2）：5万円未満 none／以上 estimate 200円', () => {
    const base = { taxpayerType: 'exempt' as const, isSalesProceeds: false };
    expect(guideStampDuty(receipt(49999, base)).level).toBe('none');
    const g = guideStampDuty(receipt(50000, base));
    expect(g.level).toBe('estimate');
    expect(g.amountYen).toBe(200);
    // 100万円超でも200円のまま（17号の2）
    expect(guideStampDuty(receipt(5_000_000, base)).amountYen).toBe(200);
  });
  it('6. 境界：49,999／50,000円、1,000,000／1,000,001円（免税事業者＝税込で判定）', () => {
    const base = { taxpayerType: 'exempt' as const };
    expect(guideStampDuty(receipt(49999, base)).level).toBe('none');
    expect(guideStampDuty(receipt(50000, base))).toMatchObject({ level: 'estimate', amountYen: 200 });
    expect(guideStampDuty(receipt(1_000_000, base))).toMatchObject({ level: 'estimate', amountYen: 200 });
    const big = guideStampDuty(receipt(1_000_001, base));
    expect(big).toMatchObject({ level: 'estimate', amountYen: 400 });
    expect(big.notes.join('')).toContain('税務署または税理士に確認');
  });
  it('7. 金額0円 → unknown', () => {
    expect(guideStampDuty(receipt(0)).level).toBe('unknown');
  });
});

describe('guideStampDuty 出力の体裁', () => {
  const cases: ReceiptInput[] = [
    receipt(60000, { paymentMethod: 'creditCard' }),
    receipt(60000, { paymentMethod: 'qrPayment' }),
    receipt(60000, { businessNature: 'unknown' }),
    receipt(60000, { businessNature: 'nonBusiness' }),
    receipt(60000, { delivery: 'electronic' }),
    receipt(52800),
    receipt(50000, { inputMode: 'exclusive' }),
    receipt(52800, { taxpayerType: 'exempt' }),
    receipt(52800, { taxpayerType: 'unknown' }),
    receipt(1_000_001, { taxpayerType: 'exempt' }),
    receipt(60000, { isSalesProceeds: false }),
    receipt(0),
  ];
  it('断定語を使わない', () => {
    for (const c of cases) {
      const text = JSON.stringify(guideStampDuty(c));
      for (const bad of ['不要です', '課税されません', '必ず', '非課税です', '貼る必要はありません']) {
        expect(text).not.toContain(bad);
      }
    }
  });
  it('premises・notes・sources・tableVersion を必ず埋める', () => {
    for (const c of cases) {
      const g = guideStampDuty(c);
      expect(g.premises.length).toBeGreaterThanOrEqual(7);
      expect(g.notes.length).toBeGreaterThan(0);
      expect(g.sources.length).toBeGreaterThan(0);
      for (const s of g.sources) {
        expect(s.url).toMatch(/^https:\/\/www\.nta\.go\.jp\//);
        expect(s.checkedAt).toBe('2026-11-05');
      }
      expect(g.tableVersion).toEqual({ effectiveFrom: '2026-04-01', checkedAt: '2026-11-05' });
      const notes = g.notes.join('');
      expect(notes).toContain('過怠税');
      expect(notes).toContain('消印');
    }
  });
  it('level が estimate のときだけ金額が入る', () => {
    for (const c of cases) {
      const g = guideStampDuty(c);
      if (g.level === 'estimate') expect(g.amountYen).not.toBeNull();
      else expect(g.amountYen).toBeNull();
    }
  });
});
