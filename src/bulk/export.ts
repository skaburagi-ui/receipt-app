/** 先頭に付けると表計算ソフトが数式として解釈し得る文字（OWASP CSV Injection＋全角）。 */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r', '\n', '＝', '＋', '－', '＠']);

/**
 * CSVエクスポート用の無害化（先頭の = + - @ タブ CR LF と全角の＝＋－＠ をアポストロフィで保護）。Phase 2 でも使う。担当: W4
 * 正当な負数（-100）や電話番号の先頭 + も保護対象（安全側）。エクスポート時のみ適用すること。
 */
export function sanitizeCsvCell(value: string): string {
  if (value.length === 0) return value;
  return FORMULA_TRIGGERS.has(value[0]) ? `'${value}` : value;
}
