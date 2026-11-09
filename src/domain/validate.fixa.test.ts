import { describe, expect, it } from 'vitest';
import { hasBlockingIssue, validateReceipt } from './validate';
import { createDefaultReceipt } from './defaults';
import { calculateTax } from './tax';
import { MAX_AMOUNT_YEN } from './limits';
import type { ReceiptInput } from './types';

/** QA指摘（M12・H1受け皿・M1・M2・M3・訂正書面）の回帰テスト。 */

const REG = 'T8700110005901';

function base(mode: ReceiptInput['mode'], patch: (r: ReceiptInput) => void = () => {}): ReceiptInput {
  const r = createDefaultReceipt('2026-11-05');
  r.mode = mode;
  r.issuer.name = '株式会社テスト';
  r.recipient.name = '株式会社サンプル';
  r.proviso = '飲食代として';
  r.tax.items[0].amountYen = 11000;
  if (mode !== 'general') {
    r.issuer.registrationNumber = REG;
    r.confirmations.ownRegistrationNumber = true;
    r.confirmations.simpleInvoiceEligibleBusiness = true;
  }
  patch(r);
  return r;
}
const codes = (r: ReceiptInput) => validateReceipt(r).map((i) => i.code);
const find = (r: ReceiptInput, code: string) => validateReceipt(r).find((i) => i.code === code);
const MODES = ['general', 'qualified', 'qualifiedSimple'] as const;

describe('M12 金額の上限（amount.tooLarge）', () => {
  const MAX = MAX_AMOUNT_YEN;
  it('定数は 9,999,999,999', () => {
    expect(MAX).toBe(9_999_999_999);
  });
  it('上限ちょうどは通り、1円超えると全モードで error', () => {
    for (const mode of MODES) {
      expect(codes(base(mode, (r) => (r.tax.items[0].amountYen = MAX))), mode).not.toContain('amount.tooLarge');
      const i = find(base(mode, (r) => (r.tax.items[0].amountYen = MAX + 1)), 'amount.tooLarge');
      expect(i?.level, mode).toBe('error');
      expect(i?.field).toBe('tax.items');
    }
  });
  it('1明細は上限内でも、合計が上限を超えれば error', () => {
    const r = base('general', (x) => {
      x.tax.items = [
        { description: 'a', amountYen: MAX, category: 'taxable10' },
        { description: 'b', amountYen: 1, category: 'taxable10' },
      ];
    });
    expect(find(r, 'amount.tooLarge')?.level).toBe('error');
    expect(hasBlockingIssue(validateReceipt(r))).toBe(true);
  });
  it('税抜入力で税込合計が上限を超えるときも error', () => {
    const r = base('general', (x) => {
      x.tax.inputMode = 'exclusive';
      x.tax.items[0].amountYen = MAX;
    });
    expect(find(r, 'amount.tooLarge')?.level).toBe('error');
  });
  it('15桁×30明細でも例外を出さず error になる', () => {
    const r = base('qualified', (x) => {
      x.tax.items = Array.from({ length: 30 }, () => ({ description: 'x', amountYen: 999_999_999_999_999, category: 'taxable10' as const }));
    });
    expect(() => validateReceipt(r)).not.toThrow();
    expect(hasBlockingIssue(validateReceipt(r))).toBe(true);
  });
});

describe('calculateTax の上限・不正値（M12）', () => {
  const mk = (amounts: number[], inputMode: 'inclusive' | 'exclusive' = 'inclusive') => ({
    inputMode,
    rounding: 'floor' as const,
    items: amounts.map((a) => ({ description: '', amountYen: a, category: 'taxable10' as const })),
  });
  it('上限ちょうどの10明細でも税額・合計は整数で、例外を出さない', () => {
    for (const mode of ['inclusive', 'exclusive'] as const) {
      const t = calculateTax(mk(Array(10).fill(MAX_AMOUNT_YEN), mode));
      expect(Number.isSafeInteger(t.grandTotalYen)).toBe(true);
      expect(Number.isSafeInteger(t.totalTaxYen)).toBe(true);
    }
  });
  it('上限超・NaN・Infinity・負数・小数の明細は計算から除外（残りは正しく計算）', () => {
    const t = calculateTax(mk([11000, MAX_AMOUNT_YEN + 1, 999_999_999_999_999, NaN, Infinity, -Infinity, -5, 1.5]));
    expect(t.grandTotalYen).toBe(11000);
    expect(t.totalTaxYen).toBe(1000);
  });
  it('全部が除外対象でも例外なく 0', () => {
    expect(calculateTax(mk([NaN, 1e15])).grandTotalYen).toBe(0);
  });
});

describe('H1 の受け皿：不正な金額（NaN など）は PDF出力を止める error', () => {
  it('NaN・Infinity・小数・負数の明細は item.amount.invalid（全モード）で、計算は壊れない', () => {
    for (const mode of MODES) {
      for (const bad of [NaN, Infinity, -Infinity, 10.5, -1]) {
        const r = base(mode, (x) => x.tax.items.push({ description: '', amountYen: bad, category: 'taxable10' }));
        const issues = validateReceipt(r);
        expect(issues.find((i) => i.code === 'item.amount.invalid')?.level, `${mode}/${bad}`).toBe('error');
        expect(hasBlockingIssue(issues)).toBe(true);
        const t = calculateTax(r.tax);
        expect(Number.isInteger(t.grandTotalYen) && Number.isInteger(t.totalTaxYen)).toBe(true);
        expect(t.grandTotalYen).toBe(11000);
      }
    }
  });
  it('唯一の明細が NaN のときも error（領収金額0円と合わせて止まる）', () => {
    const issues = validateReceipt(base('general', (r) => (r.tax.items[0].amountYen = NaN)));
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(['item.amount.invalid', 'amount.required']));
    expect(hasBlockingIssue(issues)).toBe(true);
  });
});

describe('M1 一般モードの自由記述欄の登録番号らしい文字列（text.registrationLike）', () => {
  const REGLIKE = [
    'T1234567890123',
    'T-1234-5678-9012-3',
    'Ｔ１２３４５６７８９０１２３',
    't 1234 5678 9012 3',
    '登録番号：T 1234567890123',
    'T‐1234‐5678‐9012‐3',
  ];
  const fields: [string, (r: ReceiptInput, v: string) => void][] = [
    ['issuer.name', (r, v) => (r.issuer.name = `株式会社テスト ${v}`)],
    ['issuer.address', (r, v) => (r.issuer.address = v)],
    ['issuer.phone', (r, v) => (r.issuer.phone = v)],
    ['recipient.name', (r, v) => (r.recipient.name = v)],
    ['proviso', (r, v) => (r.proviso = `${v}として`)],
    ['remarks', (r, v) => (r.remarks = v)],
    ['receiptNumber', (r, v) => (r.receiptNumber = v)],
    ['copyInfo.issuedBy', (r, v) => (r.copyInfo.issuedBy = v)],
    ['copyInfo.paymentChannel', (r, v) => (r.copyInfo.paymentChannel = v)],
    ['copyInfo.internalNote', (r, v) => (r.copyInfo.internalNote = v)],
    ['tax.items', (r, v) => (r.tax.items[0].description = v)],
    ['correction.changes', (r, v) => (r.correction = { originalDate: '2026-10-01', originalNumber: '', changes: v })],
    ['correction.originalNumber', (r, v) => (r.correction = { originalDate: '', originalNumber: v, changes: '誤→正' })],
  ];
  it('一般モードでは、どの欄でも表記ゆれ込みで error（field つき）', () => {
    for (const [field, set] of fields) {
      for (const v of REGLIKE) {
        const i = validateReceipt(base('general', (r) => set(r, v))).find((x) => x.code === 'text.registrationLike' && x.field === field);
        expect(i?.level, `${field} / ${v}`).toBe('error');
        expect(i?.message).toContain('登録番号のように見える文字列があります');
      }
    }
  });
  it('qualified / qualifiedSimple では出さない', () => {
    for (const mode of ['qualified', 'qualifiedSimple'] as const) {
      expect(codes(base(mode, (r) => (r.remarks = 'T1234567890123'))), mode).not.toContain('text.registrationLike');
    }
  });
  it('構造化欄の登録番号（issuer.registrationNumber）は従来どおり warning のみで、このcodeは出ない', () => {
    const c = codes(base('general', (r) => (r.issuer.registrationNumber = REG)));
    expect(c).toContain('registration.ignoredInGeneral');
    expect(c).not.toContain('text.registrationLike');
  });
  it('電話番号・金額・品番などは誤検出しない', () => {
    for (const v of ['TEL 03-1234-5678', '090-1234-5678', 'T12345', '1234567890123', 'ST-1234567890123', 'T-1234-5678（13桁未満）', 'ご担当T 内線1234']) {
      expect(codes(base('general', (r) => (r.remarks = v))), v).not.toContain('text.registrationLike');
    }
  });
  it('正常な一般領収書（電話・住所入り）は引き続き issue なし', () => {
    expect(
      validateReceipt(
        base('general', (r) => {
          r.issuer.phone = '03-1234-5678';
          r.issuer.address = '東京都千代田区1-1-1';
        }),
      ),
    ).toEqual([]);
  });
});

describe('M2 適格簡易請求書で課税明細がない', () => {
  it('qualifiedSimple は error（qualified は warning のまま）', () => {
    const simple = base('qualifiedSimple', (x) => (x.tax.items[0].category = 'exempt'));
    expect(find(simple, 'tax.noTaxableItems')?.level).toBe('error');
    expect(hasBlockingIssue(validateReceipt(simple))).toBe(true);
    const q = base('qualified', (x) => (x.tax.items[0].category = 'outOfScope'));
    expect(find(q, 'tax.noTaxableItems')?.level).toBe('warning');
  });
  it('課税明細があれば出ない', () => {
    expect(codes(base('qualifiedSimple'))).not.toContain('tax.noTaxableItems');
    expect(codes(base('qualifiedSimple', (x) => (x.tax.items[0].category = 'taxable8')))).not.toContain('tax.noTaxableItems');
  });
});

describe('M3 適格請求書の宛名の別表記', () => {
  it('実質「上様」の語は recipient.required', () => {
    const words = ['お客様', 'お客さま', '御客様', '上樣', 'うえさま', 'ウエサマ', 'うえ様', 'ウエ様', 'お得意様', 'おきゃくさま', 'ｳｴｻﾏ', '上 様', 'お 客 様', '各位'];
    for (const w of words) {
      expect(find(base('qualified', (r) => (r.recipient = { name: w, honorific: '' })), 'recipient.required')?.level, w).toBe('error');
      expect(find(base('qualified', (r) => (r.recipient = { name: w, honorific: '様' })), 'recipient.required')?.level, `${w}+様`).toBe('error');
    }
    expect(find(base('qualified', (r) => (r.recipient = { name: 'お客', honorific: '様' })), 'recipient.required')?.level).toBe('error');
  });
  it('実在の宛名は通す（部分一致で誤判定しない）', () => {
    for (const w of ['お客様センター株式会社', '上村商事', '殿村工業', '山田様方', '株式会社うえだ']) {
      expect(codes(base('qualified', (r) => (r.recipient = { name: w, honorific: '御中' }))), w).not.toContain('recipient.required');
    }
  });
  it('qualifiedSimple・general では出さない', () => {
    expect(codes(base('qualifiedSimple', (r) => (r.recipient = { name: 'お客様', honorific: '' })))).not.toContain('recipient.required');
    expect(codes(base('general', (r) => (r.recipient = { name: 'お客様', honorific: '' })))).not.toContain('recipient.required');
  });
});

describe('訂正書面（correction）', () => {
  const corr = (c: Partial<NonNullable<ReceiptInput['correction']>>) => (r: ReceiptInput) => {
    r.correction = { originalDate: '2026-10-01', originalNumber: 'No.12', changes: '誤：10,000円 → 正：11,000円', ...c };
  };
  it('既定値は correction: null で、correction 関連の issue は出ない', () => {
    expect(createDefaultReceipt('2026-11-05').correction).toBeNull();
    for (const mode of MODES) {
      expect(codes(base(mode)).some((c) => c.startsWith('correction.'))).toBe(false);
    }
  });
  it('正常な訂正は issue なし（全モード）', () => {
    for (const mode of MODES) {
      expect(validateReceipt(base(mode, corr({})))).toEqual([]);
    }
  });
  it('元の日付・番号が両方空 → error correction.original.required（全モード）', () => {
    for (const mode of MODES) {
      expect(find(base(mode, corr({ originalDate: ' ', originalNumber: '' })), 'correction.original.required')?.level, mode).toBe('error');
    }
    expect(codes(base('general', corr({ originalDate: '', originalNumber: 'No.5' })))).not.toContain('correction.original.required');
    expect(codes(base('general', corr({ originalDate: '2026-10-01', originalNumber: '' })))).not.toContain('correction.original.required');
  });
  it('元の日付の形式不正 → error date.invalid（field=correction.originalDate）', () => {
    const i = find(base('general', corr({ originalDate: '2026/10/01' })), 'date.invalid');
    expect(i?.level).toBe('error');
    expect(i?.field).toBe('correction.originalDate');
    expect(find(base('general', corr({ originalDate: '2026-02-30' })), 'date.invalid')?.field).toBe('correction.originalDate');
  });
  it('適格系で修正箇所が空 → error correction.changes.required', () => {
    for (const mode of ['qualified', 'qualifiedSimple'] as const) {
      const r = base(mode, corr({ changes: '  ' }));
      expect(find(r, 'correction.changes.required')?.level, mode).toBe('error');
      expect(hasBlockingIssue(validateReceipt(r))).toBe(true);
    }
  });
  it('一般で修正箇所が空 → warning correction.changes.empty（止めない）', () => {
    const r = base('general', corr({ changes: '' }));
    expect(find(r, 'correction.changes.empty')?.level).toBe('warning');
    expect(hasBlockingIssue(validateReceipt(r))).toBe(false);
  });
});
