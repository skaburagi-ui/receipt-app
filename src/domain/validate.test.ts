import { describe, expect, it } from 'vitest';
import { hasBlockingIssue, validateReceipt } from './validate';
import { createDefaultReceipt } from './defaults';
import type { ReceiptInput } from './types';

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

describe('全モード共通', () => {
  it('正常な領収書は error なし（一般）', () => {
    expect(validateReceipt(base('general'))).toEqual([]);
  });
  it('発行者名が空 → error issuer.name.required', () => {
    for (const mode of ['general', 'qualified', 'qualifiedSimple'] as const) {
      expect(find(base(mode, (r) => (r.issuer.name = '  ')), 'issuer.name.required')?.level).toBe('error');
    }
  });
  it('領収金額が0以下 → error amount.required', () => {
    expect(find(base('general', (r) => (r.tax.items[0].amountYen = 0)), 'amount.required')?.level).toBe('error');
  });
  it('マイナス・非整数の明細 → error item.amount.invalid', () => {
    expect(find(base('general', (r) => r.tax.items.push({ description: '', amountYen: -100, category: 'taxable10' })), 'item.amount.invalid')?.level).toBe('error');
    expect(find(base('general', (r) => (r.tax.items[0].amountYen = 100.5)), 'item.amount.invalid')?.level).toBe('error');
  });
  it('日付の書式不正 → error date.invalid', () => {
    expect(find(base('general', (r) => (r.receiptDate = '2026/11/05')), 'date.invalid')?.level).toBe('error');
    expect(find(base('general', (r) => (r.receiptDate = '2026-02-30')), 'date.invalid')?.level).toBe('error');
    expect(find(base('general', (r) => (r.receiptDate = '')), 'date.invalid')?.level).toBe('error');
    expect(find(base('general', (r) => (r.issueDate = '2026-13-01')), 'date.invalid')?.field).toBe('issueDate');
    expect(codes(base('general', (r) => (r.issueDate = '2026-11-06')))).not.toContain('date.invalid');
  });
  it('宛名が空 → warning recipient.empty（一般）／但し書きが空 → warning proviso.empty', () => {
    const r = base('general', (x) => {
      x.recipient.name = '';
      x.proviso = '';
    });
    expect(find(r, 'recipient.empty')?.level).toBe('warning');
    expect(find(r, 'proviso.empty')?.level).toBe('warning');
    expect(hasBlockingIssue(validateReceipt(r))).toBe(false);
  });
});

describe('general', () => {
  it('法令由来の error を出さない', () => {
    const r = base('general', (x) => {
      x.recipient.name = '';
      x.proviso = '';
      x.issuer.registrationNumber = 'xxxx';
    });
    expect(hasBlockingIssue(validateReceipt(r))).toBe(false);
  });
  it('登録番号が入っていれば warning registration.ignoredInGeneral', () => {
    const i = find(base('general', (r) => (r.issuer.registrationNumber = REG)), 'registration.ignoredInGeneral');
    expect(i?.level).toBe('warning');
    expect(i?.message).toContain('一般領収書には登録番号を印字しません');
  });
  it('登録番号が空なら出ない', () => {
    expect(codes(base('general'))).not.toContain('registration.ignoredInGeneral');
  });
});

describe('qualified（適格請求書）', () => {
  it('必要事項が揃えば error なし', () => {
    const issues = validateReceipt(base('qualified'));
    expect(hasBlockingIssue(issues)).toBe(false);
  });
  it('登録番号が空 → registration.required', () => {
    expect(find(base('qualified', (r) => (r.issuer.registrationNumber = '')), 'registration.required')?.level).toBe('error');
  });
  it('登録番号の形式不正 → registration.format（validateRegistrationNumberの結果を含める）', () => {
    expect(find(base('qualified', (r) => (r.issuer.registrationNumber = 'T123')), 'registration.format')?.level).toBe('error');
  });
  it('法人番号形式でチェックデジット不一致 → info（発行は止めない）', () => {
    const issues = validateReceipt(base('qualified', (r) => (r.issuer.registrationNumber = 'T9700110005901')));
    expect(issues.find((i) => i.code === 'registration.checkdigit')?.level).toBe('info');
    expect(hasBlockingIssue(issues)).toBe(false);
  });
  it('全角ハイフン入りの登録番号も受け付ける', () => {
    const issues = validateReceipt(base('qualified', (r) => (r.issuer.registrationNumber = 'Ｔ－８７００１１０００５９０１')));
    expect(issues.some((i) => i.code.startsWith('registration.'))).toBe(false);
  });
  it('宛名が空・実質空 → recipient.required', () => {
    for (const [name, hon] of [['', '様'], ['上様', ''], ['上　様', '様'], ['御中', ''], ['様', ''], [' ', '御中'], ['上', '様']] as const) {
      const r = base('qualified', (x) => {
        x.recipient = { name, honorific: hon };
      });
      expect(find(r, 'recipient.required')?.level, `${name}/${hon}`).toBe('error');
    }
  });
  it('宛名があれば recipient.required は出ない', () => {
    expect(codes(base('qualified', (r) => (r.recipient = { name: '山田商店', honorific: '御中' })))).not.toContain('recipient.required');
    expect(codes(base('qualified'))).not.toContain('recipient.empty');
  });
  it('取引日が空 → transactionDate.required', () => {
    const r = base('qualified', (x) => (x.transactionDate = ''));
    expect(find(r, 'transactionDate.required')?.level).toBe('error');
    expect(codes(r)).not.toContain('date.invalid');
  });
  it('金額>0の明細がない → items.required', () => {
    expect(find(base('qualified', (r) => (r.tax.items[0].amountYen = 0)), 'items.required')?.level).toBe('error');
  });
  it('登録番号が自分のものか未確認 → confirm.ownRegistration', () => {
    expect(find(base('qualified', (r) => (r.confirmations.ownRegistrationNumber = false)), 'confirm.ownRegistration')?.level).toBe('error');
  });
  it('但し書きが空 → proviso.required（error）', () => {
    const r = base('qualified', (x) => (x.proviso = ' '));
    expect(find(r, 'proviso.required')?.level).toBe('error');
    expect(codes(r)).not.toContain('proviso.empty');
  });
  it('課税明細がない → warning tax.noTaxableItems', () => {
    const r = base('qualified', (x) => (x.tax.items[0].category = 'exempt'));
    expect(find(r, 'tax.noTaxableItems')?.level).toBe('warning');
    expect(hasBlockingIssue(validateReceipt(r))).toBe(false);
  });
  it('曖昧な但し書き → warning proviso.vague', () => {
    for (const p of ['お品代として', '代金として', 'お品代', '但しお品代として', '品代として。']) {
      expect(find(base('qualified', (x) => (x.proviso = p)), 'proviso.vague')?.level, p).toBe('warning');
    }
    for (const p of ['飲食代として', '〇〇工事の施工費として', 'ご宿泊料として']) {
      expect(codes(base('qualified', (x) => (x.proviso = p))), p).not.toContain('proviso.vague');
    }
  });
  it('領収日と取引日が異なる → info date.receiptVsTransaction', () => {
    const r = base('qualified', (x) => (x.transactionDate = '2026-10-31'));
    expect(find(r, 'date.receiptVsTransaction')?.level).toBe('info');
    expect(codes(base('qualified'))).not.toContain('date.receiptVsTransaction');
  });
  it('複数の不足があれば複数のerror', () => {
    const r = base('qualified', (x) => {
      x.issuer.registrationNumber = '';
      x.recipient.name = '';
      x.confirmations.ownRegistrationNumber = false;
    });
    const errs = validateReceipt(r).filter((i) => i.level === 'error').map((i) => i.code);
    expect(errs).toEqual(expect.arrayContaining(['registration.required', 'recipient.required', 'confirm.ownRegistration']));
  });
});

describe('qualifiedSimple（適格簡易請求書）', () => {
  it('宛名が空でも error も warning も出ない', () => {
    const issues = validateReceipt(base('qualifiedSimple', (r) => (r.recipient.name = '')));
    expect(issues.some((i) => i.code.startsWith('recipient.'))).toBe(false);
    expect(hasBlockingIssue(issues)).toBe(false);
  });
  it('「上様」でも通る', () => {
    expect(hasBlockingIssue(validateReceipt(base('qualifiedSimple', (r) => (r.recipient = { name: '上様', honorific: '' }))))).toBe(false);
  });
  it('登録番号・取引日・明細・自己確認の不足でerror', () => {
    const r = base('qualifiedSimple', (x) => {
      x.issuer.registrationNumber = 'T12';
      x.transactionDate = '';
      x.tax.items[0].amountYen = 0;
      x.confirmations.ownRegistrationNumber = false;
      x.confirmations.simpleInvoiceEligibleBusiness = false;
    });
    const errs = validateReceipt(r).filter((i) => i.level === 'error').map((i) => i.code);
    expect(errs).toEqual(
      expect.arrayContaining(['registration.format', 'transactionDate.required', 'items.required', 'confirm.ownRegistration', 'confirm.simpleEligible']),
    );
    expect(find(base('qualifiedSimple', (x) => (x.issuer.registrationNumber = '')), 'registration.required')?.level).toBe('error');
  });
  it('対象事業の確認がなければ confirm.simpleEligible', () => {
    expect(find(base('qualifiedSimple', (r) => (r.confirmations.simpleInvoiceEligibleBusiness = false)), 'confirm.simpleEligible')?.level).toBe('error');
  });
  it('但し書きが空 → proviso.required（error。簡易も取引内容が記載事項）', () => {
    const r = base('qualifiedSimple', (x) => (x.proviso = ''));
    expect(find(r, 'proviso.required')?.level).toBe('error');
    expect(codes(r)).not.toContain('proviso.empty');
  });
  it('適格請求書専用のコードは出ない', () => {
    const r = base('qualifiedSimple', (x) => {
      x.recipient.name = '';
    });
    const c = codes(r);
    expect(c).not.toContain('recipient.required');
    expect(c).not.toContain('confirm.simpleEligible');
  });
  it('正常な入力は error なし', () => {
    expect(hasBlockingIssue(validateReceipt(base('qualifiedSimple')))).toBe(false);
  });
});

describe('メッセージ', () => {
  it('すべて日本語で、codeとmessageが空でない', () => {
    const r = base('qualified', (x) => {
      x.issuer.name = '';
      x.issuer.registrationNumber = '';
      x.recipient.name = '';
      x.proviso = '';
      x.transactionDate = '';
      x.tax.items[0].amountYen = 0;
      x.confirmations.ownRegistrationNumber = false;
      x.receiptDate = 'bad';
    });
    const issues = validateReceipt(r);
    expect(issues.length).toBeGreaterThan(5);
    for (const i of issues) {
      expect(i.code).toMatch(/^[a-zA-Z.]+$/);
      expect(i.message).toMatch(/[ぁ-んァ-ヶ一-龠]/);
    }
  });
});
