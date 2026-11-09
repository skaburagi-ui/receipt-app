/** 例外を握って結果として返す小さな補助。失敗しても画面を落とさず、利用者に message を見せるために使う。 */

export type Safe<T> = { ok: true; value: T } | { ok: false; message: string };

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function attempt<T>(fn: () => T): Safe<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, message: messageOf(e) };
  }
}

export async function attemptAsync<T>(fn: () => Promise<T>): Promise<Safe<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, message: messageOf(e) };
  }
}

/**
 * SVG文字列をページに埋め込む前の安全化（script・foreignObject・イベント属性・外部参照を除く）。
 * 描画側（layout）が文字をエスケープする前提だが、二重の防御として行う。
 */
export function sanitizeSvg(svg: string): string {
  if (typeof DOMParser === 'undefined') return svg;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return '';
  const root = doc.documentElement;
  if (root.localName !== 'svg') return '';
  doc.querySelectorAll('script, foreignObject, iframe, object, embed, link, style[src]').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && !val.startsWith('data:image/') && !val.startsWith('#')) el.removeAttribute(attr.name);
      else if (/url\(\s*['"]?\s*(https?:|\/\/)/i.test(attr.value)) el.removeAttribute(attr.name);
    }
  });
  return new XMLSerializer().serializeToString(root);
}
