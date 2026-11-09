import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { DesignId, LineItem, PrintFormat, ReceiptMode } from '../domain/types';
import { buildSheet } from '../layout/buildSheet';
import { imposePages } from '../layout/impose';
import { loadFonts } from '../layout/measure';
import { pageToSvg } from '../layout/svg';
import { buildTestPrintPages } from '../layout/testPrint';
import { sampleDesign, sampleReceipt, TAX_10, TAX_MIXED, TINY_PNG } from '../layout/testFixtures';
import { generatePdf } from './generate';

/**
 * 目視確認・実測用の出力（W2_OUT=出力ディレクトリ を指定したときだけ動く。リポジトリ外へ書く）。
 *   W2_OUT='D:\Temp\claude\w2-out' npx vitest run src/pdf/verify.dump.test.ts
 */
const OUT = process.env.W2_OUT;
const CORRECTION_ONLY = process.env.W2_CORRECTION_ONLY === '1';

const mixed: LineItem[] = [
  { description: '宿泊費（2名・1泊）', amountYen: 11000, category: 'taxable10' },
  { description: '朝食', amountYen: 5400, category: 'taxable8' },
];

describe.skipIf(!OUT)('verify dump', () => {
  it('代表ケースのPDF/SVGを書き出す', async () => {
    await loadFonts();
    mkdirSync(OUT!, { recursive: true });
    const cases: [string, DesignId, ReceiptMode, PrintFormat][] = [
      ['simple-general-a4', 'simple', 'general', 'a4-single'],
      ['business-qualified-double', 'business', 'qualified', 'a4-double'],
      ['casual-simple-copy', 'casual', 'qualifiedSimple', 'a4-with-copy'],
      ['casual-qualified-a5', 'casual', 'qualified', 'a5-single'],
      ['business-general-a4', 'business', 'general', 'a4-single'],
      ['simple-qualified-double', 'simple', 'qualified', 'a4-double'],
    ];
    for (const [name, d, mode, fmt] of CORRECTION_ONLY ? [] : cases) {
      const design = sampleDesign({
        design: d, format: fmt, showRevenueStampBox: true, showSeal: true,
        sealImage: { dataUrl: TINY_PNG, widthPx: 8, heightPx: 8 },
        logo: d === 'casual' ? { dataUrl: TINY_PNG, widthPx: 40, heightPx: 20 } : null,
        sealPlacement: { xMm: fmt === 'a5-single' ? 160 : 162, yMm: fmt === 'a4-single' ? 250 : 100, sizeMm: 18 },
      });
      const receipt = sampleReceipt({
        mode, receiptNumber: '0001', showPaymentMethod: true, paymentMethod: 'bankTransfer', remarks: '振込手数料はご負担いただきました。',
        proviso: mode === 'general' ? 'お品代として' : 'ご宿泊費',
        recipient: { name: '髙﨑邉㈱①〒 渡邉商事', honorific: '御中' },
        copyInfo: { issuedBy: '山田', paymentChannel: '銀行振込', internalNote: '請求書No.1234と照合済み' },
        tax: { inputMode: 'inclusive', rounding: 'floor', items: mode === 'general' ? [{ description: 'お品代', amountYen: 11000, category: 'taxable10' }] : mixed },
      });
      const tax = mode === 'general' ? TAX_10 : TAX_MIXED;
      const o = buildSheet(receipt, tax, design, 'original').sheet;
      const c = fmt === 'a4-with-copy' ? [buildSheet(receipt, tax, design, 'copy').sheet] : null;
      const sheets = fmt === 'a4-double' ? [o, buildSheet(sampleReceipt({ mode, recipient: { name: '渡邉 一郎', honorific: '様' } }), tax, design, 'original').sheet, o] : [o];
      const pages = imposePages(sheets, c, design);
      writeFileSync(`${OUT}/${name}.pdf`, await generatePdf(pages, { title: name }));
      writeFileSync(`${OUT}/${name}.svg`, pageToSvg(pages[0]));
    }
    for (const mode of ['general', 'qualified', 'qualifiedSimple'] as ReceiptMode[]) {
      const name = `correction-${mode}-copy`;
      const design = sampleDesign({ design: mode === 'general' ? 'simple' : 'business', format: 'a4-with-copy' });
      const receipt = sampleReceipt({
        mode,
        receiptNumber: 'R-002',
        correction: { originalDate: '2026-10-01', originalNumber: 'R-001', changes: '誤：領収金額 10,000円\n正：領収金額 11,000円' },
        tax: { inputMode: 'inclusive', rounding: 'floor', items: mode === 'general' ? [{ description: 'サービス料', amountYen: 11000, category: 'taxable10' }] : mixed },
      });
      const tax = mode === 'general' ? TAX_10 : TAX_MIXED;
      const original = buildSheet(receipt, tax, design, 'original').sheet;
      const copy = buildSheet(receipt, tax, design, 'copy').sheet;
      const pages = imposePages([original], [copy], design);
      writeFileSync(`${OUT}/${name}.pdf`, await generatePdf(pages, { title: name }));
      writeFileSync(`${OUT}/${name}.svg`, pageToSvg(pages[0]));
    }
    if (!CORRECTION_ONLY) {
      writeFileSync(`${OUT}/testprint.pdf`, await generatePdf(buildTestPrintPages(), { title: '試し刷り' }));
      writeFileSync(`${OUT}/testprint.svg`, pageToSvg(buildTestPrintPages()[0]));
    }
  });

  it('100件の生成時間・容量（形式ごと）', async () => {
    if (CORRECTION_ONLY) return;
    await loadFonts();
    const rows: string[] = [];
    for (const fmt of ['a4-single', 'a5-single', 'a4-double', 'a4-with-copy'] as PrintFormat[]) {
      const design = sampleDesign({ design: 'business', format: fmt, showRevenueStampBox: true, showSeal: true, sealImage: { dataUrl: TINY_PNG, widthPx: 8, heightPx: 8 } });
      const names = ['髙橋 太郎', '﨑山 花子', '株式会社 山田商事', '渡邉 一郎', '齋藤 美咲'];
      const t0 = performance.now();
      const originals = [], copies = [];
      for (let i = 0; i < 100; i++) {
        const r = sampleReceipt({ mode: 'qualified', receiptNumber: String(i + 1).padStart(4, '0'), recipient: { name: names[i % 5], honorific: '様' }, tax: { inputMode: 'inclusive', rounding: 'floor', items: mixed } });
        originals.push(buildSheet(r, TAX_MIXED, design, 'original').sheet);
        if (fmt === 'a4-with-copy') copies.push(buildSheet(r, TAX_MIXED, design, 'copy').sheet);
      }
      const t1 = performance.now();
      const pages = imposePages(originals, fmt === 'a4-with-copy' ? copies : null, design);
      const pdf = await generatePdf(pages, { title: 'bulk' });
      const t2 = performance.now();
      writeFileSync(`${OUT}/bulk100-${fmt}.pdf`, pdf);
      rows.push(`${fmt}: pages=${pages.length} layout=${Math.round(t1 - t0)}ms pdf=${Math.round(t2 - t1)}ms total=${Math.round(t2 - t0)}ms size=${Math.round(pdf.length / 1024)}KB rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`);
    }
    writeFileSync(`${OUT}/bulk-report.txt`, rows.join('\n') + '\n');
    console.log(rows.join('\n'));
  }, 120000);
});
