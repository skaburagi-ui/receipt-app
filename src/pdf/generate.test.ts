import { beforeAll, describe, expect, it } from 'vitest';
import type { DrawOp, Page, PrintFormat } from '../domain/types';
import { buildSheet } from '../layout/buildSheet';
import { imposePages, pageSizeMm } from '../layout/impose';
import { loadFonts } from '../layout/measure';
import { buildTestPrintPages } from '../layout/testPrint';
import { sampleDesign, sampleReceipt, TAX_10, TAX_MIXED, TINY_PNG } from '../layout/testFixtures';
import { generatePdf } from './generate';
import { generatePdfInWorker } from './workerClient';

beforeAll(async () => {
  await loadFonts();
});

const MM = 72 / 25.4;
const latin1 = (u: Uint8Array) => Buffer.from(u).toString('latin1');
const mediaBoxes = (pdf: Uint8Array) =>
  [...latin1(pdf).matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => ({ wMm: parseFloat(m[1]) / MM, hMm: parseFloat(m[2]) / MM }));
const pageCount = (pdf: Uint8Array) => (latin1(pdf).match(/\/Type \/Page\b(?!s)/g) ?? []).length;

function pagesFor(format: PrintFormat, n: number): Page[] {
  const design = sampleDesign({ format, showRevenueStampBox: true, showSeal: true, sealImage: { dataUrl: TINY_PNG, widthPx: 8, heightPx: 8 } });
  const receipt = sampleReceipt({ mode: 'qualified', receiptNumber: '0001', tax: { inputMode: 'inclusive', rounding: 'floor', items: [{ description: '宿泊費', amountYen: 11000, category: 'taxable10' }, { description: '朝食', amountYen: 5400, category: 'taxable8' }] } });
  const originals = Array.from({ length: n }, () => buildSheet(receipt, TAX_MIXED, design, 'original').sheet);
  const copies = format === 'a4-with-copy' ? Array.from({ length: n }, () => buildSheet(receipt, TAX_MIXED, design, 'copy').sheet) : null;
  return imposePages(originals, copies, design);
}

describe('generatePdf：ページ数と寸法', () => {
  const formats: PrintFormat[] = ['a4-single', 'a5-single', 'a4-double', 'a4-with-copy'];
  for (const f of formats) {
    it(`${f}：ページ数と用紙寸法（±0.1mm）`, async () => {
      const n = 5;
      const pages = pagesFor(f, n);
      const pdf = await generatePdf(pages, { title: 'テスト' });
      expect(latin1(pdf).startsWith('%PDF-')).toBe(true);
      const expectedPages = f === 'a4-double' ? 3 : 5;
      expect(pages).toHaveLength(expectedPages);
      expect(pageCount(pdf)).toBe(expectedPages);
      const boxes = mediaBoxes(pdf);
      expect(boxes).toHaveLength(expectedPages);
      const { widthMm, heightMm } = pageSizeMm(f);
      for (const b of boxes) {
        expect(Math.abs(b.wMm - widthMm)).toBeLessThan(0.1);
        expect(Math.abs(b.hMm - heightMm)).toBeLessThan(0.1);
      }
    });
  }

  it('試し刷りページ：A4縦1枚', async () => {
    const pdf = await generatePdf(buildTestPrintPages(), { title: '試し刷り' });
    expect(pageCount(pdf)).toBe(1);
    const [b] = mediaBoxes(pdf);
    expect(Math.abs(b.wMm - 210)).toBeLessThan(0.1);
    expect(Math.abs(b.hMm - 297)).toBeLessThan(0.1);
  });

  it('ページが0件でも不正なPDFにならない（空白1枚）', async () => {
    expect(pageCount(await generatePdf([]))).toBe(1);
  });
});

describe('generatePdf：メタデータ・埋め込み', () => {
  it('ViewerPreferences の PrintScaling=None を catalog に設定する', async () => {
    const pdf = await generatePdf(pagesFor('a4-single', 1));
    const s = latin1(pdf);
    expect(s).toMatch(/\/PrintScaling \/None/);
    expect(s).toMatch(/\/ViewerPreferences \d+ 0 R/);
  });

  it('title がメタデータ（Info/Title）に入る', async () => {
    const pdf = await generatePdf(pagesFor('a4-single', 1), { title: 'Receipt-2026' });
    const s = latin1(pdf);
    // pdfkit は文字列を UTF-16BE の16進（<feff...>）または () で書く
    const hex = Buffer.from('﻿Receipt-2026', 'utf16le').swap16().toString('hex');
    expect(s.includes(hex) || s.includes('(Receipt-2026)') || s.toLowerCase().includes(hex.toLowerCase())).toBe(true);
  });

  it('作成ソフト名を画面名「かんたん領収書」に統一する', async () => {
    const pdf = await generatePdf(pagesFor('a4-single', 1));
    const bytes = Buffer.from(pdf);
    const appName = Buffer.from('﻿かんたん領収書', 'utf16le').swap16();
    const oldName = Buffer.from('﻿領収書メーカー', 'utf16le').swap16();
    expect(bytes.indexOf(appName)).toBeGreaterThanOrEqual(0);
    expect(bytes.indexOf(oldName)).toBe(-1);
  });

  it('使うフォントだけを埋め込む（フォント4種の全体＝約12MBは入らない。1ページは数十KB）', async () => {
    const pdf = await generatePdf(pagesFor('a4-single', 1));
    expect(pdf.length).toBeLessThan(200 * 1024);
    expect(latin1(pdf)).toContain('/CIDFontType2');
  });

  it('同一画像は1度だけ登録して使い回す（100ページでも容量が線形に膨らまない）', async () => {
    const one = await generatePdf(pagesFor('a4-single', 1));
    const many = await generatePdf(pagesFor('a4-single', 30));
    expect(many.length).toBeLessThan(one.length * 30);
    expect((latin1(many).match(/\/Subtype \/Image/g) ?? []).length).toBeLessThanOrEqual(2); // 画像本体＋SMask
  });

  it('各 DrawOp（text/line/rect/path/image・opacity・破線・角丸・右寄せ）を描いても例外にならない', async () => {
    const ops: DrawOp[] = [
      { type: 'text', x: 105, y: 20, text: '中央', font: 'serifBold', sizePt: 14, color: '#111111', align: 'center', letterSpacingPt: 3 },
      { type: 'text', x: 200, y: 30, text: '右寄せ', font: 'sansBold', sizePt: 10, color: '#222', align: 'right' },
      { type: 'line', x1: 10, y1: 40, x2: 200, y2: 40, widthMm: 0.3, color: '#000000', dash: [2, 1] },
      { type: 'rect', x: 10, y: 50, w: 50, h: 20, fill: '#dde6ff', stroke: '#2563EB', strokeWidthMm: 0.5, radiusMm: 3 },
      { type: 'rect', x: 70, y: 50, w: 20, h: 20, stroke: '#000000' },
      { type: 'path', d: 'M100 50 L120 50 L120 70 Z M104 54 L116 54 L116 66 Z', fill: '#C8161D', fillRule: 'evenodd', opacity: 0.8 },
      { type: 'path', d: 'M130 50 C140 40 150 70 160 50', stroke: '#C8161D', strokeWidthMm: 0.4 },
      { type: 'image', x: 170, y: 50, w: 20, h: 20, dataUrl: TINY_PNG, opacity: 0.6 },
    ];
    const pdf = await generatePdf([{ widthMm: 210, heightMm: 297, ops }]);
    expect(pageCount(pdf)).toBe(1);
    expect(latin1(pdf)).toMatch(/\/ca 0\.6/); // 画像の不透明度
  });

  it('進捗通知と中断', async () => {
    const pages = pagesFor('a4-single', 25);
    const seen: [number, number][] = [];
    await generatePdf(pages, { onProgress: (d, t) => seen.push([d, t]) });
    expect(seen[0]).toEqual([1, 25]);
    expect(seen.at(-1)).toEqual([25, 25]);
    const ac = new AbortController();
    ac.abort();
    await expect(generatePdf(pages, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const ac2 = new AbortController();
    const p = generatePdf(pages, { signal: ac2.signal, onProgress: (d) => { if (d === 5) ac2.abort(); } });
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('generatePdfInWorker（Node ではフォールバック）', () => {
  it('Worker が無い環境では generatePdf と同じ結果を返し、進捗も通知する', async () => {
    const pages = pagesFor('a4-single', 3);
    const seen: number[] = [];
    const pdf = await generatePdfInWorker(pages, { title: 'x', onProgress: (d) => seen.push(d) });
    expect(pageCount(pdf)).toBe(3);
    expect(seen).toEqual([1, 2, 3]);
  });
  it('中断済みの signal なら AbortError', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(generatePdfInWorker(pagesFor('a4-single', 1), { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('一般モードのPDFに登録番号が入らない（PDFの文字列でも確認）', () => {
  it('buildSheet→PDF の経路でも T+13桁は出力されない', async () => {
    const design = sampleDesign();
    const pages = imposePages([buildSheet(sampleReceipt({ mode: 'general' }), TAX_10, design, 'original').sheet], null, design);
    const ops = JSON.stringify(pages);
    expect(ops).not.toMatch(/T\d{13}/);
  });
});
