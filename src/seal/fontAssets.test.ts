import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import iconv from 'iconv-lite';
import { create } from 'fontkit';
import { buildSealOps, findUnsupportedChars, isSealFontLoaded } from './seal';

// このファイルは loadSealFont() を呼ばない（未ロード時の挙動の確認）。

const FONT_DIR = new URL('../../public/fonts/', import.meta.url);
const NAMES = ['NotoSansJP-Regular', 'NotoSansJP-Bold', 'NotoSerifJP-Regular', 'NotoSerifJP-Bold'];

describe('未ロード時', () => {
  it('buildSealOps / findUnsupportedChars は分かりやすい例外を投げる', () => {
    expect(isSealFontLoaded()).toBe(false);
    expect(() => findUnsupportedChars('山')).toThrow(/loadSealFont/);
    expect(() =>
      buildSealOps({ text: '山田', layout: 'auto', color: '#C8161D', frame: 'single', roundedFrame: false }, 20),
    ).toThrow(/loadSealFont/);
  });
});

describe('public/fonts の資産', () => {
  const fonts = NAMES.map((n) => {
    const buf = fs.readFileSync(new URL(`${n}.subset.ttf`, FONT_DIR));
    return { name: n, font: create(buf) as unknown as { characterSet: number[]; hasGlyphForCodePoint(cp: number): boolean; familyName: string; fullName: string; postscriptName: string; fvar?: unknown } };
  });

  it('4ファイルとも TTF と WOFF2 が存在し、サイズが想定範囲（TTF合計 < 14MB、WOFF2合計 < 6MB）', () => {
    let ttf = 0, woff2 = 0;
    for (const n of NAMES) {
      ttf += fs.statSync(new URL(`${n}.subset.ttf`, FONT_DIR)).size;
      woff2 += fs.statSync(new URL(`${n}.subset.woff2`, FONT_DIR)).size;
    }
    expect(ttf).toBeGreaterThan(5_000_000);
    expect(ttf).toBeLessThan(14_000_000);
    expect(woff2).toBeGreaterThan(2_000_000);
    expect(woff2).toBeLessThan(6_000_000);
  });

  it('WOFF2 のシグネチャ（wOF2）', () => {
    for (const n of NAMES) {
      const b = fs.readFileSync(new URL(`${n}.subset.woff2`, FONT_DIR));
      expect(b.subarray(0, 4).toString('latin1')).toBe('wOF2');
    }
  });

  it('静的フォント（可変フォントではない）で、名称に予約名 Source を含まない', () => {
    for (const { font } of fonts) {
      expect(font.fvar).toBeUndefined();
      for (const nm of [font.familyName, font.fullName, font.postscriptName]) expect(nm).not.toMatch(/source/i);
    }
  });

  it('JIS X 0208 全域（EUC-JP 2バイト領域）と NEC行13・IBM拡張（CP932）が4ファイルすべてに含まれる', () => {
    const wanted = new Set<number>();
    for (let hi = 0xa1; hi <= 0xfe; hi++) {
      for (let lo = 0xa1; lo <= 0xfe; lo++) {
        const s = iconv.decode(Buffer.from([hi, lo]), 'euc-jp');
        if (s.length === 1 && s !== '�') wanted.add(s.codePointAt(0)!);
      }
    }
    for (let hi = 0x81; hi <= 0xfc; hi++) {
      if (hi >= 0xa0 && hi <= 0xdf) continue;
      for (let lo = 0x40; lo <= 0xfc; lo++) {
        if (lo === 0x7f) continue;
        const s = iconv.decode(Buffer.from([hi, lo]), 'cp932');
        const cp = s.codePointAt(0)!;
        if (s.length === 1 && s !== '�' && !(cp >= 0xe000 && cp <= 0xf8ff)) wanted.add(cp);
      }
    }
    expect(wanted.size).toBeGreaterThan(7000);
    // 上流（Google Fonts の Noto Sans/Serif JP 可変フォント）自体に無い文字：≒(U+2252)・‾(U+203E)。
    const UPSTREAM_GAPS = [0x2252, 0x203e];
    for (const { name, font } of fonts) {
      const missing = [...wanted].filter((cp) => !font.hasGlyphForCodePoint(cp) && !UPSTREAM_GAPS.includes(cp));
      expect(missing.map((c) => c.toString(16)), name).toEqual([]);
      for (const g of UPSTREAM_GAPS) expect(font.hasGlyphForCodePoint(g), `${name} U+${g.toString(16)} は上流にも無い`).toBe(false);
    }
  });

  it('必須文字（髙﨑邉㈱①〒ー、。「」～―¥々ヶ・半角カナ・ASCII）が4ファイルすべてに含まれ、𠮷は含まれない', () => {
    for (const { name, font } of fonts) {
      for (const ch of Array.from('髙﨑邉㈱①〒ー、。「」～―¥々ヶｱｲｳﾝ ABCabc012')) {
        expect(font.hasGlyphForCodePoint(ch.codePointAt(0)!), `${name} ${ch}`).toBe(true);
      }
      expect(font.hasGlyphForCodePoint(0x20bb7), name).toBe(false);
    }
  });
});
