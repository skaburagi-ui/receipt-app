import { describe, expect, it } from 'vitest';
import type { DrawOp, PrintFormat, Sheet } from '../domain/types';
import { imposePages, pageSizeMm, sheetSizeMm } from './impose';
import { opBounds } from './ops';
import { sampleDesign } from './testFixtures';

type TextO = Extract<DrawOp, { type: 'text' }>;
type LineO = Extract<DrawOp, { type: 'line' }>;

const sheet = (w: number, h: number, marker: string): Sheet => ({
  widthMm: w,
  heightMm: h,
  ops: [{ type: 'text', x: 20, y: 20, text: marker, font: 'sans', sizePt: 10, color: '#000000' }],
});
const half = (m: string) => sheet(210, 148.5, m);
const texts = (ops: DrawOp[]) => ops.filter((o): o is TextO => o.type === 'text');
const markerY = (ops: DrawOp[], name: string) => texts(ops).find((t) => t.text === name)?.y;
const guideLines = (ops: DrawOp[]) => ops.filter((o): o is LineO => o.type === 'line' && o.y1 === 148.5 && o.y2 === 148.5);

describe('pageSizeMm（4形式すべて）', () => {
  const cases: [PrintFormat, number, number][] = [
    ['a4-single', 210, 297],
    ['a5-single', 210, 148],
    ['a4-double', 210, 297],
    ['a4-with-copy', 210, 297],
  ];
  it.each(cases)('%s = %d x %d mm', (f, w, h) => {
    expect(pageSizeMm(f)).toEqual({ widthMm: w, heightMm: h });
  });
  it('シートの標準寸法：a4-single=210x297, a5-single=210x148, double/with-copy=210x148.5', () => {
    expect(sheetSizeMm('a4-single')).toEqual({ widthMm: 210, heightMm: 297 });
    expect(sheetSizeMm('a5-single')).toEqual({ widthMm: 210, heightMm: 148 });
    expect(sheetSizeMm('a4-double')).toEqual({ widthMm: 210, heightMm: 148.5 });
    expect(sheetSizeMm('a4-with-copy')).toEqual({ widthMm: 210, heightMm: 148.5 });
  });
});

describe('imposePages', () => {
  it('a4-single / a5-single：1件=1ページで用紙寸法どおり', () => {
    const a4 = imposePages([sheet(210, 297, 'A'), sheet(210, 297, 'B')], null, sampleDesign({ format: 'a4-single' }));
    expect(a4).toHaveLength(2);
    expect(a4.every((p) => p.widthMm === 210 && p.heightMm === 297)).toBe(true);
    const a5 = imposePages([sheet(210, 148, 'A')], null, sampleDesign({ format: 'a5-single' }));
    expect(a5).toHaveLength(1);
    expect(a5[0]).toMatchObject({ widthMm: 210, heightMm: 148 });
  });

  it('a4-double：偶数件は2件ずつ上下に並ぶ（下は y+148.5）', () => {
    const pages = imposePages([half('A'), half('B'), half('C'), half('D')], null, sampleDesign({ format: 'a4-double' }));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatchObject({ widthMm: 210, heightMm: 297 });
    expect(markerY(pages[0].ops, 'A')).toBe(20);
    expect(markerY(pages[0].ops, 'B')).toBe(168.5);
    expect(markerY(pages[1].ops, 'C')).toBe(20);
    expect(markerY(pages[1].ops, 'D')).toBe(168.5);
  });

  it('a4-double：奇数件は最終ページの下半分が空欄。showCutGuideOnEmptyHalf=false ならガイドも描かない', () => {
    const d = sampleDesign({ format: 'a4-double', showCutGuide: true, showCutGuideOnEmptyHalf: false });
    const pages = imposePages([half('A'), half('B'), half('C')], null, d);
    expect(pages).toHaveLength(2);
    expect(guideLines(pages[0].ops)).toHaveLength(1); // 2件あるページはガイドあり
    const last = pages[1];
    expect(markerY(last.ops, 'C')).toBe(20);
    for (const o of last.ops) expect(opBounds(o)!.y1).toBeLessThan(148.5); // 下半分に何もない
    expect(guideLines(last.ops)).toHaveLength(0);
  });

  it('a4-double：showCutGuideOnEmptyHalf=true なら下半分が空でもガイドを描く', () => {
    const d = sampleDesign({ format: 'a4-double', showCutGuide: true, showCutGuideOnEmptyHalf: true });
    const pages = imposePages([half('A')], null, d);
    expect(guideLines(pages[0].ops)).toHaveLength(1);
  });

  it('showCutGuide=false ならガイドを描かない', () => {
    const d = sampleDesign({ format: 'a4-double', showCutGuide: false, showCutGuideOnEmptyHalf: true });
    const pages = imposePages([half('A'), half('B')], null, d);
    expect(guideLines(pages[0].ops)).toHaveLength(0);
    expect(texts(pages[0].ops).some((t) => t.text === '切り取り線')).toBe(false);
  });

  it('裁断ガイドは破線で、左右とも端から5mm以上内側。領収書の要素はガイドから上下4mm以上離れる', () => {
    const d = sampleDesign({ format: 'a4-double', showCutGuide: true });
    const pages = imposePages([half('A'), half('B')], null, d);
    const g = guideLines(pages[0].ops)[0];
    expect(g.dash && g.dash.length).toBeGreaterThan(0);
    expect(Math.min(g.x1, g.x2)).toBeGreaterThanOrEqual(5);
    expect(Math.max(g.x1, g.x2)).toBeLessThanOrEqual(205);
  });

  it('a4-with-copy：1件=1ページ。上=領収書、下=控え、間に切り取り線', () => {
    const d = sampleDesign({ format: 'a4-with-copy', showCutGuide: true });
    const pages = imposePages([half('O1'), half('O2')], [half('C1'), half('C2')], d);
    expect(pages).toHaveLength(2);
    expect(markerY(pages[1].ops, 'O2')).toBe(20);
    expect(markerY(pages[1].ops, 'C2')).toBe(168.5);
    expect(markerY(pages[0].ops, 'C1')).toBe(168.5);
    expect(guideLines(pages[1].ops)).toHaveLength(1);
    expect(texts(pages[1].ops).some((t) => t.text === '切り取り線')).toBe(true);
  });

  it('入力のシートを書き換えない', () => {
    const s = half('A');
    const snap = JSON.stringify(s);
    imposePages([s, half('B')], null, sampleDesign({ format: 'a4-double' }));
    expect(JSON.stringify(s)).toBe(snap);
  });
});
