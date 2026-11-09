import { describe, expect, it, vi } from 'vitest';

/**
 * 回帰テスト（QA1）：ブラウザー用ビルドの pdfkit（package.json の exports の "default" = pdfkit.browser.mjs）は、
 * 標準フォントを registerStdFonts() で登録しないと、`new PDFDocument()` の既定フォント（Helvetica）で
 * 「Standard font "Helvetica" is not registered」と失敗する。Node 用ビルドは登録済みなので、Node のテストでは見つからなかった。
 * ここでは 'pdfkit' をブラウザー用ビルドに差し替えて、generatePdf が成功することを確かめる。
 */
// @ts-expect-error 型定義のない内部パス（ブラウザー用ビルドを直接読む）
vi.mock('pdfkit', async () => await import('../../node_modules/pdfkit/js/pdfkit.browser.mjs'));

describe('generatePdf（pdfkit ブラウザー用ビルド）', () => {
  it('標準フォントを登録しなくても、日本語フォントだけでPDFを作れる', async () => {
    const { generatePdf } = await import('./generate');
    const { buildTestPrintPages } = await import('../layout/testPrint');
    const { loadFonts } = await import('../layout/measure');
    await loadFonts();
    const pdf = await generatePdf(buildTestPrintPages(), { title: 'ブラウザー用ビルド' });
    expect(Buffer.from(pdf).toString('latin1').startsWith('%PDF-')).toBe(true);
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
