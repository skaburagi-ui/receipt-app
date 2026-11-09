import type { DesignSettings, DrawOp, Page, PrintFormat, Sheet } from '../domain/types';
import { translateOps } from './ops';

/** 用紙寸法（mm）。a4-single=210x297縦 / a5-single=210x148横 / a4-double=A4縦に210x148.5を上下 / a4-with-copy=A4縦に上:領収書 下:控え。 */
export function pageSizeMm(format: PrintFormat): { widthMm: number; heightMm: number } {
  switch (format) {
    case 'a4-single':
    case 'a4-double':
    case 'a4-with-copy':
      return { widthMm: 210, heightMm: 297 };
    case 'a5-single':
      return { widthMm: 210, heightMm: 148 };
  }
}

/** シート1枚の標準寸法（mm）。buildSheet が使う。 */
export function sheetSizeMm(format: PrintFormat): { widthMm: number; heightMm: number } {
  switch (format) {
    case 'a4-single': return { widthMm: 210, heightMm: 297 };
    case 'a5-single': return { widthMm: 210, heightMm: 148 };
    case 'a4-double':
    case 'a4-with-copy': return { widthMm: 210, heightMm: 148.5 };
  }
}

const HALF = 148.5;
const GUIDE_COLOR = '#808080';

/** 裁断ガイド：y=148.5mm の破線（左右とも端から5mm内側）＋小さな「切り取り線」表示。 */
function cutGuideOps(): DrawOp[] {
  return [
    { type: 'line', x1: 5, y1: HALF, x2: 205, y2: HALF, widthMm: 0.2, color: GUIDE_COLOR, dash: [2, 1.5] },
    // 枠（上下4mm以上の余白の内側）に食い込まない位置に、ガイドのすぐ上へ小さく添える
    { type: 'text', x: 205, y: HALF - 0.9, text: '切り取り線', font: 'sans', sizePt: 6, color: GUIDE_COLOR, align: 'right' },
  ];
}

/**
 * シートをページへ面付けする。originals は領収書の並び（1件=1要素）、copies は a4-with-copy 用の控え（同数）。
 * 奇数件の a4-double は最終ページの下半分を空欄。裁断ガイドは design.showCutGuide に従う。
 * （空欄の下半分にガイドを描くかは showCutGuideOnEmptyHalf）
 */
export function imposePages(originals: Sheet[], copies: Sheet[] | null, design: DesignSettings): Page[] {
  const format = design.format;
  const { widthMm, heightMm } = pageSizeMm(format);
  const pages: Page[] = [];

  if (format === 'a4-single' || format === 'a5-single') {
    for (const s of originals) pages.push({ widthMm, heightMm, ops: s.ops.slice() });
    return pages;
  }

  if (format === 'a4-double') {
    for (let i = 0; i < originals.length; i += 2) {
      const top = originals[i];
      const bottom = originals[i + 1];
      const ops: DrawOp[] = [...translateOps(top.ops, 0, 0)];
      if (bottom) ops.push(...translateOps(bottom.ops, 0, HALF));
      if (design.showCutGuide && (bottom || design.showCutGuideOnEmptyHalf)) ops.push(...cutGuideOps());
      pages.push({ widthMm, heightMm, ops });
    }
    return pages;
  }

  // a4-with-copy：1件=1ページ。上=領収書、下=控え。
  originals.forEach((s, i) => {
    const copy = copies?.[i];
    const ops: DrawOp[] = [...translateOps(s.ops, 0, 0)];
    if (copy) ops.push(...translateOps(copy.ops, 0, HALF));
    if (design.showCutGuide && (copy || design.showCutGuideOnEmptyHalf)) ops.push(...cutGuideOps());
    pages.push({ widthMm, heightMm, ops });
  });
  return pages;
}
