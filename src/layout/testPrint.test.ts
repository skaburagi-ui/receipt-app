import { beforeAll, describe, expect, it } from 'vitest';
import type { DrawOp } from '../domain/types';
import { loadFonts } from './measure';
import { opBounds } from './ops';
import { buildTestPrintPages } from './testPrint';

beforeAll(async () => {
  await loadFonts();
});

type LineO = Extract<DrawOp, { type: 'line' }>;
type TextO = Extract<DrawOp, { type: 'text' }>;

describe('buildTestPrintPages', () => {
  const pages = buildTestPrintPages();
  const ops = pages[0].ops;
  const lines = ops.filter((o): o is LineO => o.type === 'line');
  const texts = ops.filter((o): o is TextO => o.type === 'text').map((t) => t.text);

  it('A4縦1枚（210x297）', () => {
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ widthMm: 210, heightMm: 297 });
  });

  it('横・縦の100mm目盛：長さちょうど100mm、10mmごとの長い目盛と数字', () => {
    const h = lines.find((l) => l.y1 === l.y2 && Math.abs(l.x2 - l.x1 - 100) < 1e-9 && l.y1 === 70);
    const v = lines.find((l) => l.x1 === l.x2 && Math.abs(l.y2 - l.y1 - 100) < 1e-9 && l.x1 === 22);
    expect(h).toBeTruthy();
    expect(v).toBeTruthy();
    for (let i = 0; i <= 100; i += 10) {
      expect(texts).toContain(String(i));
      expect(lines.some((l) => l.x1 === 55 + i && l.x2 === 55 + i && l.y1 === 70 && l.y2 - l.y1 === 4)).toBe(true);
      expect(lines.some((l) => l.y1 === 85 + i && l.y2 === 85 + i && l.x1 === 22 && l.x2 - l.x1 === 4)).toBe(true);
    }
  });

  it('端から3/5/8/10mmの枠（4辺とも）', () => {
    for (const m of [3, 5, 8, 10]) {
      expect(lines.some((l) => l.y1 === m && l.y2 === m && l.x1 === m && l.x2 === 210 - m), `上辺 ${m}`).toBe(true);
      expect(lines.some((l) => l.y1 === 297 - m && l.y2 === 297 - m), `下辺 ${m}`).toBe(true);
      expect(lines.some((l) => l.x1 === m && l.x2 === m && Math.min(l.y1, l.y2) === m && Math.max(l.y1, l.y2) === 297 - m), `左辺 ${m}`).toBe(true);
      expect(lines.some((l) => l.x1 === 210 - m && l.x2 === 210 - m), `右辺 ${m}`).toBe(true);
      expect(texts).toContain(`${m}mm`);
    }
  });

  it('外枠（210x297の内側）、A4二等分線 y=148.5、50x50mm の四角', () => {
    const outer = ops.find((o) => o.type === 'rect' && o.x < 0.5 && o.w > 209) as Extract<DrawOp, { type: 'rect' }>;
    expect(outer).toBeTruthy();
    expect(outer.x + outer.w).toBeLessThanOrEqual(210);
    expect(outer.y + outer.h).toBeLessThanOrEqual(297);
    expect(lines.some((l) => l.y1 === 148.5 && l.y2 === 148.5 && l.x2 - l.x1 > 190)).toBe(true);
    expect(ops.some((o) => o.type === 'rect' && o.w === 50 && o.h === 50)).toBe(true);
  });

  it('操作手順の短い日本語文（A4・100%・ヘッダーとフッターなし）', () => {
    const t = texts.join('\n');
    expect(t).toContain('A4');
    expect(t).toContain('100%');
    expect(t).toContain('実際のサイズ');
    expect(t).toContain('ヘッダーとフッターなし');
  });

  it('すべての文字は用紙内（文字は端から10mm以上内側の枠の中）に収まる', () => {
    for (const o of ops) {
      if (o.type !== 'text') continue;
      const b = opBounds(o)!;
      expect(b.x1).toBeGreaterThanOrEqual(10);
      expect(b.x2).toBeLessThanOrEqual(200);
    }
  });
});
