import { describe, it, expect, beforeAll } from 'vitest';
import { buildSealOps, findUnsupportedChars, loadSealFont, resolveSealLayout, sealToSvg, isSealFontLoaded } from './seal';
import type { DrawOp, PathOp, SealSpec } from '../domain/types';

const spec = (over: Partial<SealSpec> = {}): SealSpec => ({
  text: '山田', layout: 'auto', color: '#C8161D', frame: 'single', roundedFrame: false, ...over,
});

function nums(d: string): number[] {
  return (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}
const xsOf = (d: string) => nums(d).filter((_, i) => i % 2 === 0);
const ysOf = (d: string) => nums(d).filter((_, i) => i % 2 === 1);
const glyphOps = (ops: DrawOp[]) => ops.filter((o): o is PathOp => o.type === 'path' && !!o.fill && !o.stroke);
const frameOps = (ops: DrawOp[]) => ops.filter((o): o is PathOp => o.type === 'path' && !!o.stroke);

describe('seal font loading', () => {
  it('loadSealFont は冪等で、ロード後に isSealFontLoaded が true', async () => {
    await loadSealFont();
    expect(isSealFontLoaded()).toBe(true);
    await loadSealFont();
  });
});

describe('seal', () => {
  beforeAll(async () => {
    await loadSealFont();
  });

  it('auto の選択：2字→v1x2、3〜4字→v2x2、5〜6字→v2x3、7〜9字→v3x3、10〜12字→v3x4', () => {
    expect(resolveSealLayout(spec({ text: '山田' })).layout).toBe('v1x2');
    expect(resolveSealLayout(spec({ text: '山田商' })).layout).toBe('v2x2');
    expect(resolveSealLayout(spec({ text: '株式会社' })).layout).toBe('v2x2');
    expect(resolveSealLayout(spec({ text: '山田商店会' })).layout).toBe('v2x3');
    expect(resolveSealLayout(spec({ text: '山田商店会社' })).layout).toBe('v2x3');
    expect(resolveSealLayout(spec({ text: '株式会社山田商店' })).layout).toBe('v3x3');
    expect(resolveSealLayout(spec({ text: '一二三四五六七八九' })).layout).toBe('v3x3');
    expect(resolveSealLayout(spec({ text: '一二三四五六七八九十甲乙' })).layout).toBe('v3x4');
  });

  it('明示レイアウトは最小サイズ扱い。収まらなければ拡大、13字以上は先頭12字', () => {
    expect(resolveSealLayout(spec({ text: '山田', layout: 'v2x2' })).layout).toBe('v2x2');
    expect(resolveSealLayout(spec({ text: '山田商店会', layout: 'v1x2' })).layout).toBe('v2x3');
    expect(resolveSealLayout(spec({ text: '一二三四五六七八九十', layout: 'v3x3' })).layout).toBe('v3x4');
    const r = resolveSealLayout(spec({ text: '一二三四五六七八九十甲乙丙', layout: 'auto' }));
    expect(r.chars).toHaveLength(12);
    expect(r.dropped).toBe(1);
  });

  it('空白（半角・全角）は無視される', () => {
    expect(resolveSealLayout(spec({ text: '山　田 ' })).chars).toEqual(['山', '田']);
  });

  for (const [label, text, layout] of [
    ['2字', '山田', 'v1x2'],
    ['4字', '株式会社', 'v2x2'],
    ['6字', '山田商店会社', 'v2x3'],
    ['9字', '山田太郎商店本店東', 'v3x3'],
    ['12字', '山田太郎商店本店東京都新', 'v3x4'],
  ] as const) {
    for (const frame of ['single', 'double', 'none'] as const) {
      for (const roundedFrame of [false, true]) {
        it(`${label} ${frame}${roundedFrame ? '(角丸)' : ''}：全パスが 0..sizeMm に収まり、文字数分のグリフがある`, () => {
          const sizeMm = 24;
          const ops = buildSealOps(spec({ text, layout, frame, roundedFrame }), sizeMm);
          expect(glyphOps(ops)).toHaveLength(Array.from(text).length);
          expect(frameOps(ops)).toHaveLength(frame === 'none' ? 0 : frame === 'double' ? 2 : 1);
          for (const o of ops) {
            expect(o.type).toBe('path');
            const p = o as PathOp;
            const n = nums(p.d);
            expect(n.length).toBeGreaterThan(0);
            for (const v of n) {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(sizeMm);
            }
            if (p.stroke) {
              // 線幅の外側まで 0..sizeMm に収まる
              const w = p.strokeWidthMm ?? 0;
              expect(Math.min(...xsOf(p.d)) - w / 2).toBeGreaterThanOrEqual(-1e-6);
              expect(Math.max(...xsOf(p.d)) + w / 2).toBeLessThanOrEqual(sizeMm + 1e-6);
              expect(Math.min(...ysOf(p.d)) - w / 2).toBeGreaterThanOrEqual(-1e-6);
              expect(Math.max(...ysOf(p.d)) + w / 2).toBeLessThanOrEqual(sizeMm + 1e-6);
            }
          }
        });
      }
    }
  }

  it('配置：右列が上→下、その次が左列（2×2）', () => {
    const ops = glyphOps(buildSealOps(spec({ text: '一二三四', layout: 'v2x2', frame: 'none' }), 40));
    const c = ops.map((o) => {
      const xs = xsOf(o.d), ys = ysOf(o.d);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    });
    expect(c[0].x).toBeGreaterThan(20);
    expect(c[1].x).toBeGreaterThan(20);
    expect(c[0].y).toBeLessThan(c[1].y);
    expect(c[2].x).toBeLessThan(20);
    expect(c[3].x).toBeLessThan(20);
    expect(c[2].y).toBeLessThan(c[3].y);
  });

  it('朱色は spec.color。不正な色は既定色にフォールバック（SVGへの注入対策）', () => {
    const ops = buildSealOps(spec({ color: '#112233' }), 20) as PathOp[];
    expect(ops.every((o) => o.fill === '#112233' || o.stroke === '#112233')).toBe(true);
    const bad = buildSealOps(spec({ color: '"/><script>' }), 20) as PathOp[];
    expect(bad.every((o) => o.fill === '#C8161D' || o.stroke === '#C8161D')).toBe(true);
  });

  it('長音「ー」は縦書き字形（縦長の棒）になる', () => {
    const ops = glyphOps(buildSealOps(spec({ text: 'ーー', frame: 'none' }), 40));
    expect(ops).toHaveLength(2);
    for (const o of ops) {
      const xs = xsOf(o.d), ys = ysOf(o.d);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(Math.max(...xs) - Math.min(...xs));
    }
  });

  it('sealToSvg：同じパスから生成した整ったSVG', () => {
    const svg = sealToSvg(spec({ text: '株式会社' }), 120);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('width="120"');
    expect(svg.match(/<path /g)!.length).toBe(4 + 1);
    expect(svg).not.toContain('NaN');
  });

  it('SVGの aria-label はエスケープされる', () => {
    const svg = sealToSvg(spec({ text: '<&>' }), 50);
    expect(svg).not.toContain('<&>');
    expect(svg).toContain('&lt;&amp;&gt;');
  });
});

describe('findUnsupportedChars / フォントカバレッジ', () => {
  beforeAll(async () => {
    await loadSealFont();
  });

  it('必須文字はすべて含まれる', () => {
    expect(findUnsupportedChars('髙﨑邉㈱①〒ー、。「」～―¥々ヶ')).toEqual([]);
  });

  it('氏名・屋号でよく使われるJIS第1・2水準の代表文字が含まれる', () => {
    const names =
      '佐藤鈴木高橋田中伊藤渡辺山本中村小林加藤吉田山田佐々木山口松本井上木村林斎藤清水山崎森池田橋本阿部石川' +
      '前田藤田小川後藤岡田長谷川村上近藤石井坂本遠藤青木藤井西村福田太田三浦岡本松田中島原田小野竹内金子' +
      '和田中野上田森田原野柴田酒井工藤横山宮崎宮本内田高木安藤谷口大野丸山今井河野藤原大塚新井櫻澤齋藤' +
      '株式会社有限合同商店薬局医院工業製作所研究事務弁護士税理士行政書士領収書但様御中殿' +
      '一二三四五六七八九十百千万円壱弐参';
    expect(findUnsupportedChars(names)).toEqual([]);
  });

  it('難読・旧字体を含む JIS X 0208 の文字が含まれる', () => {
    expect(findUnsupportedChars('鴎閖鬮齷蠧')).toEqual([]);
  });

  it('𠮷（U+20BB7）はサブセットに無く、重複なしで返す。通常の文字は返さない', () => {
    expect(findUnsupportedChars('𠮷')).toEqual(['𠮷']);
    expect(findUnsupportedChars('山𠮷田𠮷')).toEqual(['𠮷']);
    expect(findUnsupportedChars('山田')).toEqual([]);
  });

  it('改行・タブは無視する。絵文字は未対応として返す', () => {
    expect(findUnsupportedChars('山\n田\t')).toEqual([]);
    expect(findUnsupportedChars('山😀')).toEqual(['😀']);
  });

  it('未対応文字を含んでも buildSealOps は例外にせず、文字数分のパス（.notdef）を返す', () => {
    const ops = buildSealOps({ text: '𠮷田', layout: 'auto', color: '#C8161D', frame: 'single', roundedFrame: false }, 24);
    expect(glyphOps(ops)).toHaveLength(2);
  });
});
