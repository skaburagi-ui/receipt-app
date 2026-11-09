export type CsvEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'shift_jis';

/**
 * バイト列から文字コードを判別してデコード（BOM付きUTF-8/UTF-16LE/UTF-8/Shift_JIS）。担当: W4
 * 判別順：EF BB BF→UTF-8(BOM除去)／FF FE→UTF-16LE(BOM除去)／厳密UTF-8で成功→UTF-8／失敗→Shift_JIS(WHATWG＝CP932拡張を含む)。
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le', { ignoreBOM: true }).decode(bytes.subarray(2)), encoding: 'utf-16le' };
  }
  if (bytes.length === 0) return { text: '', encoding: 'utf-8' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'shift_jis' };
  }
}
