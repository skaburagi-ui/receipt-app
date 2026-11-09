import type { DrawOp, FontRole, Page } from '../domain/types';

/**
 * ページをSVG文字列にする（プレビュー用）。viewBox はmm単位、width/height は mm 付き。
 * フォントは CSS の @font-face（public/fonts の woff2）を使う：ReceiptSans / ReceiptSerif（400/700）。
 */

const PT_TO_MM = 25.4 / 72;

const FONT_ATTR: Record<FontRole, { family: string; weight: number }> = {
  sans: { family: 'ReceiptSans', weight: 400 },
  sansBold: { family: 'ReceiptSans', weight: 700 },
  serif: { family: 'ReceiptSerif', weight: 400 },
  serifBold: { family: 'ReceiptSerif', weight: 700 },
};

/** XMLの属性値・テキストとして安全にする（& < > " ' と XML 1.0 で使えない制御文字）。 */
export function escapeXml(s: string): string {
  return s
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const num = (n: number): string => {
  const v = Math.round(n * 1000) / 1000;
  return Number.isFinite(v) ? String(v) : '0';
};

function paint(c: string | undefined): string {
  if (!c) return 'none';
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#000000';
}

function opToSvg(op: DrawOp): string {
  switch (op.type) {
    case 'text': {
      if (op.text === '') return '';
      const f = FONT_ATTR[op.font];
      const anchor = op.align === 'center' ? 'middle' : op.align === 'right' ? 'end' : 'start';
      const ls = op.letterSpacingPt ? ` letter-spacing="${num(op.letterSpacingPt * PT_TO_MM)}"` : '';
      return `<text x="${num(op.x)}" y="${num(op.y)}" font-family="${f.family}" font-weight="${f.weight}" font-size="${num(op.sizePt * PT_TO_MM)}" fill="${paint(op.color)}" text-anchor="${anchor}"${ls} xml:space="preserve">${escapeXml(op.text)}</text>`;
    }
    case 'line': {
      const dash = op.dash && op.dash.length ? ` stroke-dasharray="${op.dash.map(num).join(' ')}"` : '';
      return `<line x1="${num(op.x1)}" y1="${num(op.y1)}" x2="${num(op.x2)}" y2="${num(op.y2)}" stroke="${paint(op.color)}" stroke-width="${num(op.widthMm)}"${dash}/>`;
    }
    case 'rect': {
      const rx = op.radiusMm ? ` rx="${num(op.radiusMm)}" ry="${num(op.radiusMm)}"` : '';
      const stroke = op.stroke ? ` stroke="${paint(op.stroke)}" stroke-width="${num(op.strokeWidthMm ?? 0.2)}"` : '';
      return `<rect x="${num(op.x)}" y="${num(op.y)}" width="${num(op.w)}" height="${num(op.h)}"${rx} fill="${paint(op.fill)}"${stroke}/>`;
    }
    case 'path': {
      const stroke = op.stroke ? ` stroke="${paint(op.stroke)}" stroke-width="${num(op.strokeWidthMm ?? 0.2)}"` : '';
      const opacity = op.opacity !== undefined ? ` opacity="${num(op.opacity)}"` : '';
      const rule = op.fillRule === 'evenodd' ? ' fill-rule="evenodd"' : '';
      return `<path d="${escapeXml(op.d)}" fill="${paint(op.fill)}"${rule}${stroke}${opacity}/>`;
    }
    case 'image': {
      const opacity = op.opacity !== undefined ? ` opacity="${num(op.opacity)}"` : '';
      return `<image href="${escapeXml(op.dataUrl)}" x="${num(op.x)}" y="${num(op.y)}" width="${num(op.w)}" height="${num(op.h)}" preserveAspectRatio="none"${opacity}/>`;
    }
  }
}

export function pageToSvg(page: Page): string {
  const w = num(page.widthMm);
  const h = num(page.heightMm);
  const body = page.ops.map(opToSvg).filter((s) => s !== '').join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">\n<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>\n${body}\n</svg>`;
}
