import { beforeAll, describe, expect, it } from 'vitest';
import { findMissingGlyphs, fitFontSize, fontsLoaded, loadFonts, measureText, wrapText } from './measure';

beforeAll(async () => {
  await loadFonts();
});

describe('フォント読込と計測', () => {
  it('4種のフォントが読み込める', () => {
    expect(fontsLoaded()).toBe(true);
  });
  it('全角は約1em、半角英数は約0.5〜0.6em', () => {
    const pt = 10;
    const em = (pt * 25.4) / 72;
    expect(measureText('あ', 'sans', pt)).toBeGreaterThan(em * 0.95);
    expect(measureText('あ', 'sans', pt)).toBeLessThan(em * 1.05);
    expect(measureText('0', 'sans', pt)).toBeGreaterThan(em * 0.4);
    expect(measureText('0', 'sans', pt)).toBeLessThan(em * 0.7);
  });
  it('letterSpacing は文字数分だけ加わる', () => {
    const a = measureText('領収書', 'sansBold', 12, 0);
    const b = measureText('領収書', 'sansBold', 12, 4);
    expect(b - a).toBeCloseTo((3 * 4 * 25.4) / 72, 5);
  });
});

describe('findMissingGlyphs', () => {
  it('髙﨑邉㈱①〒ー、。「」～―¥ はフォントにある', () => {
    expect(findMissingGlyphs('髙﨑邉㈱①〒ー、。「」～―¥濵 株式会社\n')).toEqual([]);
  });
  it('サブセット外の字（𠮷・絵文字）は重複なく出現順に返す', () => {
    expect(findMissingGlyphs('𠮷田😀𠮷')).toEqual(['𠮷', '😀']);
  });
  it('空白・改行・制御文字・異体字セレクターは対象外', () => {
    expect(findMissingGlyphs(' \t\n　​️')).toEqual([]);
  });
});

describe('wrapText（折り返し・禁則）', () => {
  const mm = (pt: number, chars: number) => measureText('あ'.repeat(chars), 'sans', pt) + 0.01;

  it('日本語は文字単位で折り返し、行幅を超えない', () => {
    const text = 'あいうえおかきくけこさしすせそたちつてと';
    const maxW = mm(10, 8);
    const lines = wrapText(text, 'sans', 10, maxW);
    expect(lines.join('')).toBe(text);
    expect(lines.length).toBe(3);
    for (const l of lines) expect(measureText(l, 'sans', 10)).toBeLessThanOrEqual(maxW + 1e-6);
  });
  it('行頭禁則：、。）」は行頭に来ない', () => {
    const maxW = mm(10, 5);
    const text = 'あいうえお、かきくけこ。さしすせそ」たち';
    const lines = wrapText(text, 'sans', 10, maxW);
    for (const l of lines) expect('、。）」'.includes(l[0])).toBe(false);
    expect(lines.join('')).toBe(text);
  });
  it('行末禁則：（「は行末に来ない', () => {
    const maxW = mm(10, 5);
    const text = 'あいうえ（かきくけ「こさしす';
    const lines = wrapText(text, 'sans', 10, maxW);
    for (const l of lines) expect('（「'.includes(l[l.length - 1])).toBe(false);
    expect(lines.join('')).toBe(text);
  });
  it('英数字の連続は語として扱い、行幅を超える長い語は文字単位で分割する', () => {
    const t = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const lines = wrapText(t, 'sans', 10, 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe(t);
    for (const l of lines) expect(measureText(l, 'sans', 10)).toBeLessThanOrEqual(20 + 1e-6);
  });
  it('改行文字は強制改行、空文字は空1行', () => {
    expect(wrapText('あ\nい', 'sans', 10, 100)).toEqual(['あ', 'い']);
    expect(wrapText('', 'sans', 10, 100)).toEqual(['']);
  });
  it('異体字選択子付きの文字は基底文字と同じ単位（分割しない）', () => {
    const t = '齋\u{E0100}藤';
    const lines = wrapText(t, 'sans', 10, mm(10, 1));
    expect(lines.join('')).toBe(t);
    expect(lines.some((l) => l.startsWith('\u{E0100}'))).toBe(false);
  });
});

describe('fitFontSize', () => {
  it('収まる最大サイズを返し、下限を割らない', () => {
    const text = 'あ'.repeat(30);
    const s = fitFontSize(text, 'sans', 20, 8, 100);
    expect(s).toBeLessThan(20);
    expect(s).toBeGreaterThan(8);
    expect(measureText(text, 'sans', s)).toBeLessThanOrEqual(100 + 1e-6);
    expect(fitFontSize(text, 'sans', 20, 12, 10)).toBe(12);
    expect(fitFontSize('あ', 'sans', 20, 8, 100)).toBe(20);
  });
});
