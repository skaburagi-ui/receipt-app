// 画面から呼ぶ経路（入力→税計算→シート→面付け→SVG/PDF）を、モックなしで通す結合テスト。
import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultReceipt } from '../domain/defaults';
import { validateReceipt, hasBlockingIssue } from '../domain/validate';
import type { PrintFormat, ReceiptInput } from '../domain/types';
import { loadFonts } from '../layout/measure';
import { pageToSvg } from '../layout/svg';
import { generatePdf } from '../pdf/generate';
import { buildTestPrintPages } from '../layout/testPrint';
import { createDefaultDesign } from './defaults';
import { buildPages, pdfFileName, receiptsForRows } from './pipeline';
import { effectiveReceipt } from './state';

function sample(over: Partial<ReceiptInput> = {}): ReceiptInput {
  const r = createDefaultReceipt('2026-11-06');
  return {
    ...r,
    issuer: { ...r.issuer, name: '山田商店', address: '東京都千代田区1-1', phone: '03-0000-0000', postalCode: '100-0001' },
    recipient: { name: '株式会社サンプル', honorific: '御中' },
    proviso: 'お食事代として',
    tax: { inputMode: 'inclusive', rounding: 'floor', items: [{ description: '', amountYen: 12000, category: 'taxable10' }] },
    ...over,
  };
}

beforeAll(async () => { await loadFonts(); });

describe('画面の経路（実装どうしの結合）', () => {
  const formats: PrintFormat[] = ['a4-single', 'a5-single', 'a4-double', 'a4-with-copy'];
  for (const format of formats) {
    it(`${format}：ページとSVGができ、PDFを作れる`, async () => {
      const design = { ...createDefaultDesign(), format };
      const built = buildPages(sample(), design);
      expect(built.pages.length).toBe(1);
      expect(built.overflow).toBe(false);
      expect(pageToSvg(built.pages[0])).toContain('<svg');
      const bytes = await generatePdf(built.pages, { title: '領収書' });
      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    }, 30000);
  }

  it('一般モードでは登録番号を渡しても印字されない（effectiveReceipt 経由）', () => {
    const r = sample({ issuer: { ...sample().issuer, registrationNumber: 'T1234567890123' } });
    const built = buildPages(effectiveReceipt(r), createDefaultDesign());
    expect(pageToSvg(built.pages[0])).not.toContain('1234567890123');
  });

  it('適格請求書モード：登録番号が印字され、不足の間は検証でエラーになる', () => {
    const base = sample({ mode: 'qualified' });
    expect(hasBlockingIssue(validateReceipt(base))).toBe(true);
    const ok = sample({
      mode: 'qualified',
      issuer: { ...base.issuer, registrationNumber: 'T1234567890123' },
      confirmations: { ownRegistrationNumber: true, simpleInvoiceEligibleBusiness: false },
    });
    // 検査用数字が合わない番号は warning のみ。error が無ければ出力可
    expect(hasBlockingIssue(validateReceipt(ok))).toBe(false);
    expect(pageToSvg(buildPages(ok, createDefaultDesign()).pages[0])).toContain('T1234567890123');
  });

  it('一括：宛先ごとの領収書が面付けされる（A4 2件上下で3件→2ページ）', () => {
    const rows = ['甲', '乙', '丙'].map((name, i) => ({
      sourceRow: i + 1, name, honorific: '', code: '', postalCode: '', address: '', contactPerson: '', group: '', memo: '',
    }));
    const common = sample();
    const built = buildPages(common, { ...createDefaultDesign(), format: 'a4-double' }, receiptsForRows(common, rows, ['', '', '']));
    expect(built.pages.length).toBe(2);
  });

  it('試し刷りページを作れる', async () => {
    const pages = buildTestPrintPages();
    expect(pages.length).toBeGreaterThan(0);
    expect((await generatePdf(pages)).length).toBeGreaterThan(500);
  }, 30000);

  it('ファイル名は 領収書_YYYYMMDD.pdf', () => {
    expect(pdfFileName('2026-11-06')).toBe('領収書_20261106.pdf');
    expect(pdfFileName('2026-11-06', '_3件')).toBe('領収書_20261106_3件.pdf');
  });
});
