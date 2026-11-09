import type { DrawOp, FontRole } from '../domain/types';
import { measureText } from './measure';

/** 描画リスト（DrawOp）の汎用ユーティリティ：平行移動と外接矩形。担当: W2 */

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ───────── SVGパスデータ ─────────

interface Seg { cmd: string; args: number[] }

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function parsePath(d: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0;
  const n = d.length;
  const skipSep = () => { while (i < n && /[\s,]/.test(d[i])) i++; };
  const readNum = (): number => {
    skipSep();
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(d.slice(i));
    if (!m) throw new Error(`不正なパスデータ: ${d.slice(i, i + 12)}`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const readFlag = (): number => {
    skipSep();
    const c = d[i];
    if (c !== '0' && c !== '1') throw new Error('不正なアークフラグ');
    i++;
    return c === '1' ? 1 : 0;
  };
  let cmd = '';
  while (true) {
    skipSep();
    if (i >= n) break;
    if (/[A-Za-z]/.test(d[i])) { cmd = d[i++]; if (!(cmd.toUpperCase() in ARITY)) throw new Error(`不正なコマンド ${cmd}`); }
    else if (!cmd) throw new Error('パスデータがコマンドで始まっていません');
    const up = cmd.toUpperCase();
    const arity = ARITY[up];
    if (arity === 0) { segs.push({ cmd, args: [] }); cmd = ''; continue; }
    const args: number[] = [];
    for (let k = 0; k < arity; k++) args.push(up === 'A' && (k === 3 || k === 4) ? readFlag() : readNum());
    segs.push({ cmd, args });
    // 暗黙の繰り返し：M の後続は L、m の後続は l
    if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
  }
  return segs;
}

/** パスデータを (dx, dy) だけ平行移動した新しいパスデータを返す。相対コマンドはそのまま。 */
export function translatePathData(d: string, dx: number, dy: number): string {
  const segs = parsePath(d);
  const out: string[] = [];
  let first = true;
  for (const s of segs) {
    const abs = s.cmd === s.cmd.toUpperCase();
    const a = s.args.slice();
    const isFirstMove = first && (s.cmd === 'm' || s.cmd === 'M');
    first = false;
    if (abs || isFirstMove) {
      switch (s.cmd.toUpperCase()) {
        case 'H': a[0] += dx; break;
        case 'V': a[0] += dy; break;
        case 'A': a[5] += dx; a[6] += dy; break;
        case 'Z': break;
        default: for (let k = 0; k + 1 < a.length; k += 2) { a[k] += dx; a[k + 1] += dy; }
      }
    }
    out.push(s.cmd + a.map((v) => String(r3(v))).join(' '));
  }
  return out.join(' ');
}

/** パスの外接矩形（制御点を含む概算。アークは端点のみ）。空なら null。 */
export function pathBounds(d: string): { x1: number; y1: number; x2: number; y2: number } | null {
  const segs = parsePath(d);
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const add = (x: number, y: number) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
  for (const s of segs) {
    const rel = s.cmd !== s.cmd.toUpperCase();
    const up = s.cmd.toUpperCase();
    const a = s.args;
    const bx = rel ? cx : 0, by = rel ? cy : 0;
    switch (up) {
      case 'M': cx = bx + a[0]; cy = by + a[1]; sx = cx; sy = cy; add(cx, cy); break;
      case 'L': case 'T': cx = bx + a[0]; cy = by + a[1]; add(cx, cy); break;
      case 'H': cx = bx + a[0]; add(cx, cy); break;
      case 'V': cy = by + a[0]; add(cx, cy); break;
      case 'C': add(bx + a[0], by + a[1]); add(bx + a[2], by + a[3]); cx = bx + a[4]; cy = by + a[5]; add(cx, cy); break;
      case 'S': case 'Q': add(bx + a[0], by + a[1]); cx = bx + a[2]; cy = by + a[3]; add(cx, cy); break;
      case 'A': cx = bx + a[5]; cy = by + a[6]; add(cx, cy); break;
      case 'Z': cx = sx; cy = sy; break;
    }
  }
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}

// ───────── DrawOp ─────────

export function translateOp(op: DrawOp, dx: number, dy: number): DrawOp {
  switch (op.type) {
    case 'text': return { ...op, x: r3(op.x + dx), y: r3(op.y + dy) };
    case 'line': return { ...op, x1: r3(op.x1 + dx), y1: r3(op.y1 + dy), x2: r3(op.x2 + dx), y2: r3(op.y2 + dy) };
    case 'rect': return { ...op, x: r3(op.x + dx), y: r3(op.y + dy) };
    case 'image': return { ...op, x: r3(op.x + dx), y: r3(op.y + dy) };
    case 'path': return { ...op, d: translatePathData(op.d, dx, dy) };
  }
}

export function translateOps(ops: DrawOp[], dx: number, dy: number): DrawOp[] {
  return dx === 0 && dy === 0 ? ops.slice() : ops.map((o) => translateOp(o, dx, dy));
}

const PT_TO_MM = 25.4 / 72;

/** テキストの外接矩形（mm）。ベースラインの上 0.88em、下 0.14em（Noto Sans/Serif JP の ascent/descent 相当）。 */
export function textBounds(op: { x: number; y: number; text: string; font: FontRole; sizePt: number; align?: 'left' | 'center' | 'right'; letterSpacingPt?: number }) {
  const w = measureText(op.text, op.font, op.sizePt, op.letterSpacingPt ?? 0);
  const x1 = op.align === 'center' ? op.x - w / 2 : op.align === 'right' ? op.x - w : op.x;
  const em = op.sizePt * PT_TO_MM;
  return { x1, y1: op.y - em * 0.88, x2: x1 + w, y2: op.y + em * 0.14 };
}

/** 外接矩形（mm）。線幅は含めない。 */
export function opBounds(op: DrawOp): { x1: number; y1: number; x2: number; y2: number } | null {
  switch (op.type) {
    case 'text': return op.text.trim() === '' ? null : textBounds(op);
    case 'line': return { x1: Math.min(op.x1, op.x2), y1: Math.min(op.y1, op.y2), x2: Math.max(op.x1, op.x2), y2: Math.max(op.y1, op.y2) };
    case 'rect': return { x1: op.x, y1: op.y, x2: op.x + op.w, y2: op.y + op.h };
    case 'image': return { x1: op.x, y1: op.y, x2: op.x + op.w, y2: op.y + op.h };
    case 'path': return pathBounds(op.d);
  }
}
