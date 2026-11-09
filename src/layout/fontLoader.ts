import type { FontRole } from '../domain/types';

/**
 * フォントバイト列の読込（環境抽象化）。Node（テスト・スクリプト）は fs、ブラウザー／Worker は fetch('/fonts/...')。
 * 計測（measure.ts）とPDF埋め込み（pdf/generate.ts）で同じバイト列を共有する。担当: W2
 */

export const FONT_FILES: Record<FontRole, string> = {
  sans: 'NotoSansJP-Regular',
  sansBold: 'NotoSansJP-Bold',
  serif: 'NotoSerifJP-Regular',
  serifBold: 'NotoSerifJP-Bold',
};

export const ALL_FONT_ROLES: FontRole[] = ['sans', 'sansBold', 'serif', 'serifBold'];

export type FontBytesLoader = (role: FontRole) => Promise<Uint8Array>;

const bytesCache = new Map<FontRole, Promise<Uint8Array>>();
let customLoader: FontBytesLoader | null = null;

/** テストや特殊環境向け。ローダーを差し替える（キャッシュも消す）。null で既定に戻す。 */
export function setFontLoader(loader: FontBytesLoader | null): void {
  customLoader = loader;
  bytesCache.clear();
}

function isNode(): boolean {
  return typeof process !== 'undefined' && !!process.versions && !!process.versions.node && typeof window === 'undefined' && typeof (globalThis as { importScripts?: unknown }).importScripts === 'undefined';
}

function fontFileName(role: FontRole): string {
  return `${FONT_FILES[role]}.subset.ttf`;
}

async function defaultLoad(role: FontRole): Promise<Uint8Array> {
  const file = fontFileName(role);
  if (isNode()) {
    // 変数経由の動的 import にして、ブラウザー向けバンドルへ node:fs を巻き込まない。
    const fsName = 'node:fs/promises';
    const pathName = 'node:path';
    const fs = (await import(/* @vite-ignore */ fsName)) as typeof import('node:fs/promises');
    const path = (await import(/* @vite-ignore */ pathName)) as typeof import('node:path');
    const buf = await fs.readFile(path.resolve(process.cwd(), 'public', 'fonts', file));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const base = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';
  const res = await fetch(`${base.endsWith('/') ? base : base + '/'}fonts/${file}`);
  if (!res.ok) throw new Error(`フォントを読み込めませんでした: ${file} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

/** フォントのバイト列（TTF）。同じ役割は1度だけ読み込む。 */
export function loadFontBytes(role: FontRole): Promise<Uint8Array> {
  let p = bytesCache.get(role);
  if (!p) {
    p = (customLoader ?? defaultLoad)(role);
    p.catch(() => bytesCache.delete(role)); // 失敗は再試行できるように
    bytesCache.set(role, p);
  }
  return p;
}
