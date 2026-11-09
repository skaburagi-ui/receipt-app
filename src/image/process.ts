import type { ImageAsset } from '../domain/types';

/**
 * 画像（角印・ロゴ）の取り込み処理。ブラウザー内のみで完結する（外部送信なし）。担当: W3
 * 純粋関数（whiteToAlpha / fitWithin / validateUploadFile）とブラウザーAPI部分（processUploadedImage）を分けている。
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
export const SEAL_MAX_EDGE_PX = 800;
export const LOGO_MAX_EDGE_PX = 1200;
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** 背景透過のしきい値の既定（輝度 0–255。これ以上の明るさは透明側）。 */
export const DEFAULT_WHITE_THRESHOLD = 235;
/** しきい値の手前、何段階ぶんをなだらかに半透明へ移すか（輝度の幅）。 */
const SOFT_RANGE = 40;

// ───────── 純粋関数 ─────────

/**
 * RGBA配列の白背景を透過に変換（輝度→アルファ）。threshold 0-255。
 * - 輝度 L = 0.299R + 0.587G + 0.114B。L ≥ threshold は完全透明、L ≤ threshold − 40 は元のアルファのまま、
 *   その間は直線的に段階変化（縁のにじみを滑らかにする）。
 * - インク色（暗い色）のRGBは変更しない。入力は破壊せず、新しい配列を返す。
 * - 元のアルファが小さい画素はさらに小さくなる（乗算）。
 */
export function whiteToAlpha(rgba: Uint8ClampedArray, threshold: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba);
  const t = Number.isFinite(threshold) ? Math.min(255, Math.max(0, threshold)) : DEFAULT_WHITE_THRESHOLD;
  const lo = t - Math.min(SOFT_RANGE, t); // この輝度以下は不透明のまま
  const span = t - lo;
  for (let i = 0; i + 3 < out.length; i += 4) {
    const lum = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2];
    if (lum >= t) {
      out[i + 3] = 0;
    } else if (lum > lo && span > 0) {
      const f = (t - lum) / span; // 0..1（1＝不透明）
      out[i + 3] = Math.round(out[i + 3] * f);
    }
  }
  return out;
}

/** 長辺 maxEdge に収まる縮小後の寸法。アスペクト比維持、拡大はしない、整数に丸める（最小1px）。 */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new RangeError('画像の寸法が不正です。');
  }
  if (!(maxEdge >= 1) || !Number.isFinite(maxEdge)) throw new RangeError('最大辺は1以上で指定してください。');
  const long = Math.max(width, height);
  if (long <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / long;
  return {
    width: Math.max(1, Math.min(Math.round(maxEdge), Math.round(width * scale))),
    height: Math.max(1, Math.min(Math.round(maxEdge), Math.round(height * scale))),
  };
}

export type ImageErrorCode = 'empty' | 'heic' | 'svg' | 'unsupported-type' | 'too-large' | 'decode-failed' | 'no-canvas';

/** 利用者向けの平易なメッセージを持つエラー。`message` をそのまま画面に出してよい。 */
export class ImageUploadError extends Error {
  readonly code: ImageErrorCode;
  constructor(code: ImageErrorCode, message: string) {
    super(message);
    this.name = 'ImageUploadError';
    this.code = code;
  }
}

export type UploadValidation = { ok: true } | { ok: false; code: ImageErrorCode; message: string };

const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

function extOf(name: string | undefined): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(name ?? '');
  return m ? m[1].toLowerCase() : '';
}

/**
 * アップロードファイルの検証（純粋関数）。MIME は PNG／JPEG／WebP のみ許可。SVG・HEIC等は拒否し平易な文言を返す。
 * 上限5MB。MIME が空のとき（一部のOS・ブラウザー）は拡張子（png/jpg/jpeg/webp）で判定する。
 * ※ MIME・拡張子は申告値。実際に画像として読めるかは processUploadedImage のデコードで確認する。
 */
export function validateUploadFile(file: { name?: string; type: string; size: number }): UploadValidation {
  const type = (file.type || '').toLowerCase();
  const ext = extOf(file.name);
  if (!(file.size > 0)) {
    return { ok: false, code: 'empty', message: 'ファイルが空です。別の画像を選んでください。' };
  }
  if (/^image\/hei[cf]/.test(type) || ['heic', 'heif', 'heics', 'heifs'].includes(ext)) {
    return {
      ok: false,
      code: 'heic',
      message: 'HEIC形式の画像は使えません。写真アプリでJPEGに変換してから選び直してください。',
    };
  }
  if (type === 'image/svg+xml' || ext === 'svg' || ext === 'svgz') {
    return {
      ok: false,
      code: 'svg',
      message: 'SVG形式の画像は使えません。PNG・JPEG・WebPの画像を選んでください（SVGは安全のため受け付けません）。',
    };
  }
  const effective = type || EXT_MIME[ext] || '';
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(effective)) {
    return {
      ok: false,
      code: 'unsupported-type',
      message: 'この形式の画像は使えません。PNG・JPEG・WebPの画像を選んでください。',
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      code: 'too-large',
      message: `ファイルが大きすぎます（${mb}MB）。5MB以下の画像を選んでください。`,
    };
  }
  return { ok: true };
}

// ───────── ブラウザーAPI部分（薄く） ─────────

interface Surface {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  toDataUrl(): Promise<string>;
}

function createSurface(w: number, h: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      return {
        ctx,
        toDataUrl: async () => blobToDataUrl(await c.convertToBlob({ type: 'image/png' })),
      };
    }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) return { ctx, toDataUrl: async () => c.toDataURL('image/png') };
  }
  throw new ImageUploadError('no-canvas', 'このブラウザーでは画像を処理できません。別のブラウザーでお試しください。');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/**
 * アップロード画像（File）をブラウザー内で縮小しPNGのdataURLへ。kind='seal' は長辺800px、'logo' は1200px。上限5MB。
 * 手順：検証 → createImageBitmap(file, { imageOrientation: 'from-image' })（向き補正）→ 長辺を縮小した小さなcanvasへ描画
 * （巨大canvasは作らない）→ 必要なら whiteToAlpha → PNG。再エンコードによりEXIF（位置情報等）は残らない。
 * 失敗時は ImageUploadError（`message` は利用者向け）。通信は一切行わない。担当: W3
 */
export async function processUploadedImage(
  file: File,
  kind: 'seal' | 'logo',
  opts?: { removeWhiteBackground?: boolean; threshold?: number },
): Promise<ImageAsset> {
  const v = validateUploadFile(file);
  if (!v.ok) throw new ImageUploadError(v.code, v.message);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageUploadError('decode-failed', '画像を読み込めませんでした。ファイルが壊れているか、対応していない形式です。別の画像でお試しください。');
  }
  try {
    const maxEdge = kind === 'seal' ? SEAL_MAX_EDGE_PX : LOGO_MAX_EDGE_PX;
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge);
    const surface = createSurface(width, height);
    const ctx = surface.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (opts?.removeWhiteBackground) {
      const img = ctx.getImageData(0, 0, width, height);
      const out = whiteToAlpha(img.data, opts.threshold ?? DEFAULT_WHITE_THRESHOLD);
      ctx.putImageData(new ImageData(out as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    }
    const dataUrl = await surface.toDataUrl();
    return { dataUrl, widthPx: width, heightPx: height };
  } finally {
    bitmap.close?.();
  }
}
