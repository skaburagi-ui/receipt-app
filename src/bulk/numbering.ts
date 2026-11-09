/** ゲスト一括発行の任意の番号付け：接頭辞＋開始番号＋桁数。start が null なら番号なし（空文字の配列）。担当: W4 */
export function assignReceiptNumbers(count: number, opts: { prefix: string; start: number | null; digits: number }): string[] {
  const n = Number.isFinite(count) ? Math.floor(count) : 0;
  if (n <= 0) return [];
  const { prefix, start } = opts;
  if (start === null || typeof start !== 'number' || !Number.isSafeInteger(start) || start < 0) {
    return new Array<string>(n).fill('');
  }
  const digits = Number.isFinite(opts.digits) ? Math.max(0, Math.floor(opts.digits)) : 0;
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    // 桁があふれた場合はそのまま（切り詰めない）。
    out.push(prefix + String(start + i).padStart(digits, '0'));
  }
  return out;
}
