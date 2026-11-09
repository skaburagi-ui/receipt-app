import { create } from 'fontkit';
import type { Font } from 'fontkit';
import type { FontRole } from '../domain/types';
import { ALL_FONT_ROLES, loadFontBytes } from './fontLoader';

/**
 * テキスト計測と折り返し。fontkit で public/fonts/*.subset.ttf のグリフ幅を測る（PDF側と同じフォント）。
 * 重要：buildSheet などは同期なので、先に `await loadFonts(...)` を呼んでおくこと。
 * 未読込の間は概算幅（全角=1em／半角英数=0.55em）で動くが、折り返し位置は不正確になる（fontsLoaded() で判定できる）。担当: W2
 */

const PT_TO_MM = 25.4 / 72;

interface LoadedFont {
  font: Font;
  upm: number;
  widths: Map<number, number>; // codePoint -> em単位の送り幅
  has: Map<number, boolean>;
}

const loaded = new Map<FontRole, LoadedFont>();
const loading = new Map<FontRole, Promise<void>>();

/** 指定の役割（既定：全4種）のフォントを読み込む。繰り返し呼んでよい。 */
export async function loadFonts(roles: FontRole[] = ALL_FONT_ROLES): Promise<void> {
  await Promise.all(roles.map((role) => loadOne(role)));
}

function loadOne(role: FontRole): Promise<void> {
  if (loaded.has(role)) return Promise.resolve();
  let p = loading.get(role);
  if (!p) {
    p = loadFontBytes(role).then((bytes) => {
      // fontkit は Buffer 相当（Uint8Array）を受け付ける。ブラウザーでも Uint8Array のまま渡せる。
      const font = create(bytes as unknown as Buffer) as Font;
      loaded.set(role, { font, upm: font.unitsPerEm, widths: new Map(), has: new Map() });
    });
    p.catch(() => loading.delete(role));
    loading.set(role, p);
  }
  return p;
}

/** 指定の役割（既定：全4種）が読込済みか。 */
export function fontsLoaded(roles: FontRole[] = ALL_FONT_ROLES): boolean {
  return roles.every((r) => loaded.has(r));
}

/** 読込済みフォントのメトリクス（em単位）。未読込なら既定値。 */
export function fontMetrics(role: FontRole): { ascent: number; descent: number; capHeight: number } {
  const f = loaded.get(role);
  if (!f) return { ascent: 0.88, descent: 0.12, capHeight: 0.73 };
  return { ascent: f.font.ascent / f.upm, descent: -f.font.descent / f.upm, capHeight: f.font.capHeight / f.upm };
}

function approxAdvanceEm(cp: number, role: FontRole): number {
  if (cp < 0x80) return role === 'sansBold' || role === 'serifBold' ? 0.6 : 0.55;
  if (cp >= 0xff61 && cp <= 0xff9f) return 0.5; // 半角カナ
  return 1;
}

function advanceEm(cp: number, role: FontRole): number {
  // 異体字セレクター・ZWJ は幅を持たない（基底文字に付く）
  if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || cp === 0x200d) return 0;
  const f = loaded.get(role);
  if (!f) return approxAdvanceEm(cp, role);
  let w = f.widths.get(cp);
  if (w === undefined) {
    const g = f.font.glyphForCodePoint(cp);
    w = g ? g.advanceWidth / f.upm : 0.5;
    f.widths.set(cp, w);
  }
  return w;
}

/** フォントにこの文字（コードポイント）のグリフがあるか。フォント未読込なら true（判定不能）。 */
export function hasGlyph(cp: number, role: FontRole = 'sans'): boolean {
  const f = loaded.get(role);
  if (!f) return true;
  let h = f.has.get(cp);
  if (h === undefined) {
    h = f.font.hasGlyphForCodePoint(cp);
    f.has.set(cp, h);
  }
  return h;
}

/**
 * フォントに無い文字（重複なし・出現順）を返す。UIが警告に使う（豆腐＝印刷事故の防止）。
 * 空白・改行・制御文字は対象外。フォント未読込の間は [] を返す（fontsLoaded() で確認できる）。
 * 4種のうち、一つでも欠ける文字は欠落として返す（デザインによって使うフォントが変わるため）。
 */
export function findMissingGlyphs(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (seen.has(cp)) continue;
    seen.add(cp);
    if (cp <= 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0x3000 || cp === 0x200b || cp === 0xfeff) continue;
    // 異体字セレクター（U+FE00-FE0F, U+E0100-E01EF）・ZWJ は基底文字側で判定
    if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || cp === 0x200d) continue;
    for (const role of ALL_FONT_ROLES) {
      if (loaded.has(role) && !hasGlyph(cp, role)) {
        out.push(ch);
        break;
      }
    }
  }
  return out;
}

/** 1行のテキスト幅（mm）。letterSpacingPt は文字ごと（最後の文字の後ろも）に加算する。 */
export function measureText(text: string, font: FontRole, sizePt: number, letterSpacingPt = 0): number {
  let em = 0;
  let n = 0;
  for (const ch of text) {
    em += advanceEm(ch.codePointAt(0)!, font);
    n++;
  }
  return (em * sizePt + n * letterSpacingPt) * PT_TO_MM;
}

// ───────── 折り返し ─────────

/** 行頭禁則（行頭に置かない文字）。 */
const NO_LINE_START = new Set(
  Array.from('、。，．,.）」』】〕］｝〉》〗！？!?：；:;ー～‐−・゛゜ゝゞヽヾぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々〻%％)]}'),
);
/** 行末禁則（行末に置かない文字）。 */
const NO_LINE_END = new Set(Array.from('（「『【〔［｛〈《〖([{'));

/** 切れない塊（英数字・記号の連続）。 */
const WORD_CHAR = /[A-Za-z0-9À-ɏ#$%&*+\-./:;<=>?@_~'’^\\|¥]/;

function isWordChar(ch: string): boolean {
  return ch.length === 1 && WORD_CHAR.test(ch) && ch.charCodeAt(0) < 0x250;
}

/** 折り返しの単位に分ける（CJKは1文字、英数字の連続は1語、空白は直前の語に付ける）。 */
function tokenize(line: string): string[] {
  const chars = Array.from(line);
  const tokens: string[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (isWordChar(ch)) {
      let j = i + 1;
      while (j < chars.length && isWordChar(chars[j])) j++;
      // 語末に続く半角スペースは語に付ける（行頭に空白を出さない）
      while (j < chars.length && chars[j] === ' ') j++;
      tokens.push(chars.slice(i, j).join(''));
      i = j;
    } else if (ch === ' ') {
      let j = i + 1;
      while (j < chars.length && chars[j] === ' ') j++;
      tokens.push(chars.slice(i, j).join(''));
      i = j;
    } else {
      // 異体字セレクター等は直前の文字に結合
      let j = i + 1;
      while (j < chars.length) {
        const cp = chars[j].codePointAt(0)!;
        if ((cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || cp === 0x200d) j++;
        else break;
      }
      tokens.push(chars.slice(i, j).join(''));
      i = j;
    }
  }
  return tokens;
}

function firstChar(s: string): string {
  return Array.from(s)[0] ?? '';
}
function lastChar(s: string): string {
  const a = Array.from(s);
  return a[a.length - 1] ?? '';
}

/**
 * maxWidthMm に収まるように折り返す（\n は強制改行）。日本語は文字単位、英数字は語単位（長すぎる語は文字単位で分割）。
 * 行頭禁則（、。）」など）と行末禁則（「（など）を追い出しで処理する。行末の空白は除去する。
 */
export function wrapText(text: string, font: FontRole, sizePt: number, maxWidthMm: number, letterSpacingPt = 0): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n?/g, '\n').split('\n')) {
    out.push(...wrapParagraph(para, font, sizePt, maxWidthMm, letterSpacingPt));
  }
  return out;
}

function wrapParagraph(para: string, font: FontRole, sizePt: number, maxW: number, ls: number): string[] {
  if (para === '') return [''];
  const w = (s: string) => measureText(s, font, sizePt, ls);
  // 長すぎる語は文字に分解
  const units: string[] = [];
  for (const t of tokenize(para)) {
    if (w(t.trimEnd()) > maxW && Array.from(t).length > 1) {
      for (const ch of Array.from(t)) units.push(ch);
    } else {
      units.push(t);
    }
  }
  const lines: string[] = [];
  let cur: string[] = [];
  let curW = 0;
  const widthOf = (arr: string[]) => w(arr.join('').trimEnd());
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const uw = w(u);
    // 行末の空白は幅に数えない（trimEnd 相当）
    if (cur.length > 0 && widthOf([...cur, u]) > maxW + 1e-9) {
      // 折り返しが必要
      const startsBad = NO_LINE_START.has(firstChar(u));
      // 行頭禁則：直前の単位を次行へ追い出す（1行に1単位しか無い場合は諦めてそのまま）
      let carry: string[] = [];
      if (startsBad && cur.length > 1) carry = [cur.pop()!];
      // 行末禁則：行末に来てしまう開き括弧を次行へ
      while (cur.length > 1 && NO_LINE_END.has(lastChar(cur[cur.length - 1].trimEnd()))) {
        carry.unshift(cur.pop()!);
      }
      lines.push(cur.join('').trimEnd());
      cur = [...carry];
      curW = widthOf(cur);
    }
    // 先頭が空白だけの単位は行頭に置かない
    if (cur.length === 0 && u.trim() === '') continue;
    cur.push(u);
    curW += uw;
  }
  if (cur.length > 0) lines.push(cur.join('').trimEnd());
  return lines.length ? lines : [''];
}

/** 1行で maxWidthMm に収まる最大のフォントサイズ（pt）。下限 minPt 未満にはならない。 */
export function fitFontSize(text: string, font: FontRole, maxPt: number, minPt: number, maxWidthMm: number, letterSpacingPt = 0): number {
  let size = maxPt;
  while (size > minPt && measureText(text, font, size, letterSpacingPt) > maxWidthMm) size -= 0.5;
  return Math.max(size, Math.min(minPt, maxPt));
}
