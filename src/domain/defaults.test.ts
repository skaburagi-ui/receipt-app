import { describe, expect, it } from 'vitest';
import { applyReceiptDateChange, createDefaultReceipt, todayInJapan } from './defaults';

describe('createDefaultReceipt', () => {
  it('既定値', () => {
    const r = createDefaultReceipt('2026-11-05');
    expect(r.mode).toBe('general');
    expect(r.issuer).toMatchObject({ name: '', taxpayerType: 'unknown', businessNature: 'business', registrationNumber: '' });
    expect(r.recipient).toEqual({ name: '', honorific: '様' });
    expect(r.receiptDate).toBe('2026-11-05');
    expect(r.transactionDate).toBe('2026-11-05');
    expect(r.issueDate).toBeNull();
    expect(r.transactionDateEdited).toBe(false);
    expect(r.receiptNumber).toBe('');
    expect(r.paymentMethod).toBeNull();
    expect(r.showPaymentMethod).toBe(false);
    expect(r.tax).toEqual({ inputMode: 'inclusive', rounding: 'floor', items: [{ description: '', amountYen: 0, category: 'taxable10' }] });
    expect(r.delivery).toBe('paper');
    expect(r.isSalesProceeds).toBe(true);
    expect(r.confirmations).toEqual({ ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false });
    expect(r.copyInfo).toEqual({ issuedBy: '', paymentChannel: '', internalNote: '' });
  });
  it('呼び出しごとに独立したオブジェクトを返す', () => {
    const a = createDefaultReceipt('2026-11-05');
    const b = createDefaultReceipt('2026-11-05');
    a.tax.items[0].amountYen = 100;
    expect(b.tax.items[0].amountYen).toBe(0);
  });
});

describe('applyReceiptDateChange', () => {
  it('取引日が未編集なら連動する', () => {
    const r = createDefaultReceipt('2026-11-05');
    const next = applyReceiptDateChange(r, '2026-11-10');
    expect(next.receiptDate).toBe('2026-11-10');
    expect(next.transactionDate).toBe('2026-11-10');
  });
  it('取引日が編集済みなら維持する', () => {
    const r = { ...createDefaultReceipt('2026-11-05'), transactionDate: '2026-11-01', transactionDateEdited: true };
    const next = applyReceiptDateChange(r, '2026-11-10');
    expect(next.receiptDate).toBe('2026-11-10');
    expect(next.transactionDate).toBe('2026-11-01');
  });
  it('元のオブジェクトを変更しない', () => {
    const r = createDefaultReceipt('2026-11-05');
    applyReceiptDateChange(r, '2026-11-10');
    expect(r.receiptDate).toBe('2026-11-05');
    expect(r.transactionDate).toBe('2026-11-05');
  });
});

describe('todayInJapan', () => {
  it('UTC 14:59:59 はまだ同日（日本時間 23:59:59）', () => {
    expect(todayInJapan(new Date('2026-11-05T14:59:59Z'))).toBe('2026-11-05');
  });
  it('UTC 15:00:00 は翌日（日本時間 00:00）', () => {
    expect(todayInJapan(new Date('2026-11-05T15:00:00Z'))).toBe('2026-11-06');
  });
  it('月末・年末の繰り上がり', () => {
    expect(todayInJapan(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01');
    expect(todayInJapan(new Date('2028-02-28T15:00:00Z'))).toBe('2028-02-29');
  });
  it('引数なしでも YYYY-MM-DD を返す', () => {
    expect(todayInJapan()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
