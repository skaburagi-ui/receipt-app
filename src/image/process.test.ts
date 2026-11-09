import { describe, it, expect } from 'vitest';
import { fitWithin, validateUploadFile, whiteToAlpha, MAX_UPLOAD_BYTES, processUploadedImage } from './process';

const px = (r: number, g: number, b: number, a = 255) => [r, g, b, a];
const arr = (...p: number[][]) => new Uint8ClampedArray(p.flat());

describe('whiteToAlpha', () => {
  it('白は透明、黒・朱のインク色はそのまま（RGBもαも保持）', () => {
    const src = arr(px(255, 255, 255), px(0, 0, 0), px(200, 22, 29));
    const out = whiteToAlpha(src, 235);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 255, 0]);
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 0, 255]);
    expect(Array.from(out.slice(8, 12))).toEqual([200, 22, 29, 255]);
  });

  it('閾値付近は段階的（単調に減少）で、閾値ちょうど以上は透明', () => {
    const lums = [150, 200, 215, 225, 234, 235, 240];
    const src = arr(...lums.map((l) => px(l, l, l)));
    const out = whiteToAlpha(src, 235);
    const alphas = lums.map((_, i) => out[i * 4 + 3]);
    for (let i = 1; i < alphas.length; i++) expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1]);
    expect(alphas[0]).toBe(255); // 195 以下は不透明
    expect(alphas[3]).toBeGreaterThan(0);
    expect(alphas[3]).toBeLessThan(255); // 225 は半透明
    expect(alphas[5]).toBe(0);
    expect(alphas[6]).toBe(0);
  });

  it('入力を破壊しない。長さ・RGBは変えない', () => {
    const src = arr(px(250, 250, 250), px(10, 10, 10));
    const copy = new Uint8ClampedArray(src);
    const out = whiteToAlpha(src, 200);
    expect(src).toEqual(copy);
    expect(out).not.toBe(src);
    expect(out.length).toBe(src.length);
    expect(out[0]).toBe(250);
  });

  it('元のアルファが低い画素はさらに薄くなる（乗算）。しきい値が範囲外でも例外にならない', () => {
    const src = arr(px(0, 0, 0, 100));
    expect(whiteToAlpha(src, 235)[3]).toBe(100);
    expect(whiteToAlpha(arr(px(255, 255, 255)), 999)[3]).toBe(0); // 255 に丸め
    expect(whiteToAlpha(arr(px(0, 0, 0)), -5)[3]).toBe(0); // 0 に丸め：輝度0 ≥ 閾値0 なので透明
  });

  it('空配列', () => {
    expect(whiteToAlpha(new Uint8ClampedArray(0), 200).length).toBe(0);
  });
});

describe('fitWithin', () => {
  it('長辺に合わせて縮小し、アスペクト比を保つ', () => {
    expect(fitWithin(4000, 3000, 800)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(3000, 4000, 800)).toEqual({ width: 600, height: 800 });
    expect(fitWithin(1000, 1000, 800)).toEqual({ width: 800, height: 800 });
  });
  it('拡大はしない', () => {
    expect(fitWithin(300, 200, 800)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(800, 800, 800)).toEqual({ width: 800, height: 800 });
  });
  it('整数に丸める。極端な縦横比でも最小1px、長辺は maxEdge を超えない', () => {
    const r = fitWithin(3333, 777, 800);
    expect(Number.isInteger(r.width) && Number.isInteger(r.height)).toBe(true);
    expect(r.width).toBe(800);
    expect(fitWithin(100000, 10, 800)).toEqual({ width: 800, height: 1 });
    expect(fitWithin(12000, 9000, 1200)).toEqual({ width: 1200, height: 900 });
  });
  it('不正な寸法は RangeError', () => {
    expect(() => fitWithin(0, 100, 800)).toThrow(RangeError);
    expect(() => fitWithin(NaN, 100, 800)).toThrow(RangeError);
    expect(() => fitWithin(100, 100, 0)).toThrow(RangeError);
  });
});

describe('validateUploadFile', () => {
  const f = (type: string, size = 1000, name = 'a.png') => ({ type, size, name });

  it('PNG・JPEG・WebP は許可', () => {
    expect(validateUploadFile(f('image/png'))).toEqual({ ok: true });
    expect(validateUploadFile(f('image/jpeg', 1000, 'a.jpg'))).toEqual({ ok: true });
    expect(validateUploadFile(f('image/webp', 1000, 'a.webp'))).toEqual({ ok: true });
  });

  it('SVG は拒否（MIMEでも拡張子でも）', () => {
    const r = validateUploadFile(f('image/svg+xml', 1000, 'a.svg'));
    expect(r).toMatchObject({ ok: false, code: 'svg' });
    expect(validateUploadFile(f('image/png', 1000, 'evil.svg'))).toMatchObject({ ok: false, code: 'svg' });
  });

  it('HEIC/HEIF は拒否し、JPEGへの変換を案内する', () => {
    for (const x of [f('image/heic', 1000, 'IMG_1.HEIC'), f('image/heif', 1000, 'a.heif'), f('', 1000, 'IMG_2.heic')]) {
      const r = validateUploadFile(x);
      expect(r).toMatchObject({ ok: false, code: 'heic' });
      if (!r.ok) expect(r.message).toContain('JPEGに変換');
    }
  });

  it('GIF・BMP・PDF・非画像は拒否', () => {
    expect(validateUploadFile(f('image/gif', 1000, 'a.gif'))).toMatchObject({ ok: false, code: 'unsupported-type' });
    expect(validateUploadFile(f('image/bmp', 1000, 'a.bmp'))).toMatchObject({ ok: false, code: 'unsupported-type' });
    expect(validateUploadFile(f('application/pdf', 1000, 'a.pdf'))).toMatchObject({ ok: false, code: 'unsupported-type' });
    expect(validateUploadFile(f('', 1000, 'noext'))).toMatchObject({ ok: false, code: 'unsupported-type' });
  });

  it('MIMEが空でも拡張子が png/jpg/jpeg/webp なら許可', () => {
    expect(validateUploadFile(f('', 1000, 'seal.PNG'))).toEqual({ ok: true });
    expect(validateUploadFile(f('', 1000, 'logo.jpeg'))).toEqual({ ok: true });
  });

  it('5MB ちょうどは許可、超えると拒否。空ファイルも拒否', () => {
    expect(validateUploadFile(f('image/png', MAX_UPLOAD_BYTES))).toEqual({ ok: true });
    const r = validateUploadFile(f('image/png', MAX_UPLOAD_BYTES + 1));
    expect(r).toMatchObject({ ok: false, code: 'too-large' });
    if (!r.ok) expect(r.message).toContain('5MB');
    expect(validateUploadFile(f('image/png', 0))).toMatchObject({ ok: false, code: 'empty' });
  });

  it('processUploadedImage は検証エラーを ImageUploadError（利用者向けメッセージ）で返す（ブラウザーAPI不要の分岐）', async () => {
    const file = { name: 'a.heic', type: 'image/heic', size: 10 } as unknown as File;
    await expect(processUploadedImage(file, 'logo')).rejects.toMatchObject({ name: 'ImageUploadError', code: 'heic' });
  });
});
