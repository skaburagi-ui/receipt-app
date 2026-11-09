import { create } from 'fontkit';
import type { DrawOp, PathOp, SealSpec } from '../domain/types';

/**
 * 角印（アプリ内作成）。文字は字形アウトライン（パス）にして描画リストへ。原点(0,0)、sizeMm四方。
 * 配置側（layout）が平行移動して使う。縦書きは1文字ずつ格子セルに配置。担当: W3
 *
 * - 書体：Noto Serif JP Bold（`public/fonts/NotoSerifJP-Bold.subset.ttf`）。「印鑑風（篆書体ではない）」。
 * - フォントは `loadSealFont()` で事前に一度ロードする（未ロードなら `buildSealOps` 等は例外）。
 * - 縦書き字形（長音「ー」・括弧・句読点・波ダッシュ等）はフォントの GSUB `vert` 字形で置き換える。
 *   `vert` に字形が無い文字は通常字形のまま置く。
 * - フォントに無い文字（例：𠮷 U+20BB7）は `findUnsupportedChars` で事前に検出できる。検出せずに
 *   `buildSealOps` へ渡した場合は .notdef（豆腐の四角）が描かれる（黙って欠落させない）。
 */

export const SEAL_FONT_URL = '/fonts/NotoSerifJP-Bold.subset.ttf';
export const DEFAULT_SEAL_COLOR = '#C8161D';

// ───────── フォントのロード ─────────

interface FkPath {
  commands: { command: string; args: number[] }[];
  cbox: { minX: number; minY: number; maxX: number; maxY: number };
}
interface FkGlyph {
  id: number;
  path: FkPath;
}
interface FkFont {
  unitsPerEm: number;
  hasGlyphForCodePoint(cp: number): boolean;
  glyphForCodePoint(cp: number): FkGlyph;
  layout(text: string, features?: string[]): { glyphs: FkGlyph[] };
}

let sealFont: FkFont | null = null;
let loading: Promise<void> | null = null;

/** フォントがロード済みか。 */
export function isSealFontLoaded(): boolean {
  return sealFont !== null;
}

/**
 * 角印用フォントをロードして保持する（初回だけ通信／読み込み）。UI は初回に `await loadSealFont()` してから
 * `buildSealOps` 等の同期APIを使う。引数なし：ブラウザーは `fetch(SEAL_FONT_URL)`、Node（テスト）は `fs`。
 * バイト列または URL 文字列を渡して差し替えることもできる（Worker から渡す場合など）。
 */
export function loadSealFont(source?: ArrayBuffer | Uint8Array | string): Promise<void> {
  if (sealFont && source === undefined) return Promise.resolve();
  if (loading && source === undefined) return loading;
  const p = (async () => {
    const bytes = await readFontBytes(source);
    const font = create(bytes as unknown as Buffer);
    if (!('glyphForCodePoint' in font)) throw new Error('角印用フォントの読み込みに失敗しました（フォントコレクションは未対応）。');
    sealFont = font as unknown as FkFont;
  })();
  loading = p.catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

async function readFontBytes(source?: ArrayBuffer | Uint8Array | string): Promise<Uint8Array> {
  if (source && typeof source !== 'string') return source instanceof Uint8Array ? source : new Uint8Array(source);
  const isNode = typeof process !== 'undefined' && !!process.versions?.node;
  if (isNode && typeof source !== 'string') {
    const spec = 'node:fs/promises';
    const fs = (await import(/* @vite-ignore */ spec)) as typeof import('node:fs/promises');
    const buf = await fs.readFile(new URL('../../public/fonts/NotoSerifJP-Bold.subset.ttf', import.meta.url));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const url = source ?? SEAL_FONT_URL;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`角印用フォントを読み込めませんでした（${res.status}）。`);
  return new Uint8Array(await res.arrayBuffer());
}

function requireFont(): FkFont {
  if (!sealFont) {
    throw new Error('角印用フォントが未ロードです。先に `await loadSealFont()` を呼んでください。');
  }
  return sealFont;
}

// ───────── 未対応文字 ─────────

/** 入力文字のうちフォントに無い文字を（重複なし・出現順で）返す（豆腐防止）。改行・タブは無視する。担当: W3 */
export function findUnsupportedChars(text: string): string[] {
  const font = requireFont();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ch of Array.from(text)) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    if (seen.has(ch)) continue;
    seen.add(ch);
    if (!font.hasGlyphForCodePoint(ch.codePointAt(0)!)) out.push(ch);
  }
  return out;
}

// ───────── レイアウト ─────────

type SealLayout = SealSpec['layout'];
type ConcreteLayout = Exclude<SealLayout, 'auto'>;

const GRIDS: { layout: ConcreteLayout; cols: number; rows: number }[] = [
  { layout: 'v1x2', cols: 1, rows: 2 },
  { layout: 'v2x2', cols: 2, rows: 2 },
  { layout: 'v2x3', cols: 2, rows: 3 },
  { layout: 'v3x3', cols: 3, rows: 3 },
  { layout: 'v3x4', cols: 3, rows: 4 },
];
const MAX_CHARS = 12;

export interface ResolvedSealLayout {
  layout: ConcreteLayout;
  /** 列数・行数（縦書きの列＝右から左へ、各列は上から下へ）。 */
  cols: number;
  rows: number;
  /** 実際に配置する文字（空白除去後、最大12文字）。 */
  chars: string[];
  /** 12文字を超えて配置しなかった文字数。 */
  dropped: number;
}

/**
 * 文字列と指定レイアウトから、実際に使う格子を決める。
 * - `auto`：2字→v1x2、3〜4字→v2x2、5〜6字→v2x3、7〜9字→v3x3、10〜12字→v3x4（1字は1×1）。
 * - 明示指定：指定は「最小サイズ」として扱い、文字数が収まらなければ収まる最小の格子へ自動で拡大する。
 * - 空白（半角・全角・改行）は無視する。
 */
export function resolveSealLayout(spec: Pick<SealSpec, 'text' | 'layout'>): ResolvedSealLayout {
  const all = Array.from(spec.text).filter((c) => !/\s/u.test(c));
  const chars = all.slice(0, MAX_CHARS);
  const n = chars.length;
  let idx: number;
  if (spec.layout === 'auto') idx = 0;
  else idx = Math.max(0, GRIDS.findIndex((g) => g.layout === spec.layout));
  while (idx < GRIDS.length - 1 && GRIDS[idx].cols * GRIDS[idx].rows < n) idx++;
  const g = GRIDS[idx];
  if (n === 1) return { layout: g.layout, cols: 1, rows: 1, chars, dropped: all.length - n };
  return { layout: g.layout, cols: g.cols, rows: g.rows, chars, dropped: all.length - n };
}

// ───────── 字形 → パス ─────────

const EM_Y_TOP = 880; // CJK 仮想ボディ: y = -120 .. 880（unitsPerEm=1000）
const EM_Y_BOTTOM = -120;
/** 1文字の縦横比の伸縮上限（横／縦）。セルが縦長・横長でも字が崩れすぎないように。 */
const MAX_X_STRETCH = 1.4;
const MAX_Y_OVER_REF = 1.15;
/** 句読点など「小さい字形」（ink が em の半分未満）は、拡大せず仮想ボディ内の位置を保って置く。 */
const SMALL_GLYPH_RATIO = 0.5;

function fmt(n: number): string {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
}

function glyphFor(font: FkFont, ch: string): FkGlyph {
  const cp = ch.codePointAt(0)!;
  try {
    const run = font.layout(ch, ['vert']);
    if (run.glyphs.length === 1) return run.glyphs[0];
  } catch {
    // layout が使えない場合は通常字形へ
  }
  return font.glyphForCodePoint(cp);
}

interface Cell { x: number; y: number; w: number; h: number }

/** 1文字をセルへ配置したSVGパスデータ（座標はmm、y下向き）。 */
function glyphPathInCell(font: FkFont, ch: string, cell: Cell): string {
  const glyph = glyphFor(font, ch);
  const path = glyph.path;
  const upem = font.unitsPerEm || 1000;
  const k = 1000 / upem;
  const cb = path.cbox;
  const inkW = (cb.maxX - cb.minX) * k;
  const inkH = (cb.maxY - cb.minY) * k;
  if (!path.commands.length || inkW <= 0 || inkH <= 0) return '';

  const cx = cell.x + cell.w / 2;
  const cy = cell.y + cell.h / 2;
  const uRef = Math.min(cell.w, cell.h) / 920; // 字高約920ユニットの字がセル短辺にちょうど収まる倍率（mm/ユニット）
  let sx: number;
  let sy: number;
  let ox: number;
  let oy: number;
  if (inkW < upem * SMALL_GLYPH_RATIO * k && inkH < upem * SMALL_GLYPH_RATIO * k) {
    sx = sy = uRef;
    ox = cx - 500 * sx;
    oy = cy + ((EM_Y_TOP + EM_Y_BOTTOM) / 2) * sy;
  } else {
    sy = Math.min(cell.h / inkH, uRef * MAX_Y_OVER_REF);
    sx = Math.min(cell.w / inkW, sy * MAX_X_STRETCH);
    ox = cx - (((cb.minX + cb.maxX) / 2) * k) * sx;
    oy = cy + (((cb.minY + cb.maxY) / 2) * k) * sy;
  }
  const X = (x: number) => fmt(ox + x * k * sx);
  const Y = (y: number) => fmt(oy - y * k * sy);

  let d = '';
  for (const c of path.commands) {
    const a = c.args;
    switch (c.command) {
      case 'moveTo': d += `M${X(a[0])} ${Y(a[1])}`; break;
      case 'lineTo': d += `L${X(a[0])} ${Y(a[1])}`; break;
      case 'quadraticCurveTo': d += `Q${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])}`; break;
      case 'bezierCurveTo': d += `C${X(a[0])} ${Y(a[1])} ${X(a[2])} ${Y(a[3])} ${X(a[4])} ${Y(a[5])}`; break;
      case 'closePath': d += 'Z'; break;
      default: break;
    }
  }
  return d;
}

// ───────── 枠 ─────────

/** 角丸（または直角）の矩形パス。(x0,y0)-(x1,y1)、半径 r。3次ベジェで近似（円弧コマンドを使わない）。 */
function roundedRectPath(x0: number, y0: number, x1: number, y1: number, r: number): string {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  if (rr === 0) return `M${fmt(x0)} ${fmt(y0)}L${fmt(x1)} ${fmt(y0)}L${fmt(x1)} ${fmt(y1)}L${fmt(x0)} ${fmt(y1)}Z`;
  const k = rr * 0.5523;
  const p = (x: number, y: number) => `${fmt(x)} ${fmt(y)}`;
  return (
    `M${p(x0 + rr, y0)}L${p(x1 - rr, y0)}C${p(x1 - rr + k, y0)} ${p(x1, y0 + rr - k)} ${p(x1, y0 + rr)}` +
    `L${p(x1, y1 - rr)}C${p(x1, y1 - rr + k)} ${p(x1 - rr + k, y1)} ${p(x1 - rr, y1)}` +
    `L${p(x0 + rr, y1)}C${p(x0 + rr - k, y1)} ${p(x0, y1 - rr + k)} ${p(x0, y1 - rr)}` +
    `L${p(x0, y0 + rr)}C${p(x0, y0 + rr - k)} ${p(x0 + rr - k, y0)} ${p(x0 + rr, y0)}Z`
  );
}

function safeColor(c: string | undefined): string {
  return typeof c === 'string' && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c.trim()) ? c.trim() : DEFAULT_SEAL_COLOR;
}

/**
 * 角印の描画リスト。原点(0,0)・sizeMm四方。文字＝塗り(fill)のみの PathOp を1文字1つ、枠＝線(stroke)のみの PathOp。
 * 全座標（線幅の外側を含む）は 0..sizeMm に収まる。同期API：事前に `await loadSealFont()` が必要。担当: W3
 */
export function buildSealOps(spec: SealSpec, sizeMm: number): DrawOp[] {
  const font = requireFont();
  const S = sizeMm;
  const color = safeColor(spec.color);
  const ops: PathOp[] = [];
  const r0 = spec.roundedFrame ? S * 0.09 : 0;

  // 枠と、文字を置く内側領域
  let margin: number;
  if (spec.frame === 'single') {
    const w = S * 0.045;
    ops.push({ type: 'path', d: roundedRectPath(w / 2, w / 2, S - w / 2, S - w / 2, r0 - w / 2), stroke: color, strokeWidthMm: round3(w) });
    margin = w + S * 0.05;
  } else if (spec.frame === 'double') {
    const w1 = S * 0.05;
    const gap = S * 0.03;
    const w2 = S * 0.022;
    ops.push({ type: 'path', d: roundedRectPath(w1 / 2, w1 / 2, S - w1 / 2, S - w1 / 2, r0 - w1 / 2), stroke: color, strokeWidthMm: round3(w1) });
    const i = w1 + gap + w2 / 2;
    ops.push({ type: 'path', d: roundedRectPath(i, i, S - i, S - i, Math.max(0, r0 - i)), stroke: color, strokeWidthMm: round3(w2) });
    margin = w1 + gap + w2 + S * 0.04;
  } else {
    margin = S * 0.06;
  }

  const { cols, rows, chars } = resolveSealLayout(spec);
  const inner = S - 2 * margin;
  const cellW = inner / cols;
  const cellH = inner / rows;
  const pad = Math.min(cellW, cellH) * 0.06; // セル内の余白（隣の字・枠との間隔）
  const glyphOps: PathOp[] = [];
  chars.forEach((ch, i) => {
    const col = Math.floor(i / rows); // 0 = 右端の列
    const row = i % rows;
    const cell: Cell = {
      x: margin + (cols - 1 - col) * cellW + pad,
      y: margin + row * cellH + pad,
      w: cellW - 2 * pad,
      h: cellH - 2 * pad,
    };
    const d = glyphPathInCell(font, ch, cell);
    if (d) glyphOps.push({ type: 'path', d, fill: color, fillRule: 'nonzero' });
  });
  return [...glyphOps, ...ops];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

/** 角印のプレビュー用SVG文字列（`buildSealOps` と同じパスから生成）。背景は透明。担当: W3 */
export function sealToSvg(spec: SealSpec, sizePx: number): string {
  const S = 100; // viewBox は 100 単位（mm換算ではなく相対）で組み立てる
  const ops = buildSealOps(spec, S) as PathOp[];
  const body = ops
    .map((o) => {
      const attrs = [`d="${o.d}"`];
      if (o.fill) attrs.push(`fill="${o.fill}"`);
      else attrs.push('fill="none"');
      if (o.stroke) attrs.push(`stroke="${o.stroke}"`, `stroke-width="${fmt(o.strokeWidthMm ?? 0)}"`);
      if (o.fillRule) attrs.push(`fill-rule="${o.fillRule}"`);
      return `<path ${attrs.join(' ')}/>`;
    })
    .join('');
  const px = fmt(sizePx);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${escapeXml(`角印：${spec.text}`)}">` +
    body +
    '</svg>'
  );
}
