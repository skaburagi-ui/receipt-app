import { describe, expect, it } from 'vitest';
import type { DrawOp, Page } from '../domain/types';
import { escapeXml, pageToSvg } from './svg';
import { TINY_PNG } from './testFixtures';

const page = (ops: DrawOp[], w = 210, h = 297): Page => ({ widthMm: w, heightMm: h, ops });
const text = (over: Partial<Extract<DrawOp, { type: 'text' }>> = {}): DrawOp => ({ type: 'text', x: 10, y: 20, text: 'テスト', font: 'sans', sizePt: 10, color: '#111111', ...over });

describe('pageToSvg', () => {
  it('viewBox はmm、width/height に mm 単位を付ける', () => {
    const svg = pageToSvg(page([], 210, 148.5));
    expect(svg).toContain('viewBox="0 0 210 148.5"');
    expect(svg).toContain('width="210mm"');
    expect(svg).toContain('height="148.5mm"');
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('フォント役割 → font-family / font-weight', () => {
    const cases: [Extract<DrawOp, { type: 'text' }>['font'], string, number][] = [
      ['sans', 'ReceiptSans', 400],
      ['sansBold', 'ReceiptSans', 700],
      ['serif', 'ReceiptSerif', 400],
      ['serifBold', 'ReceiptSerif', 700],
    ];
    for (const [font, family, weight] of cases) {
      const svg = pageToSvg(page([text({ font })]));
      expect(svg).toContain(`font-family="${family}"`);
      expect(svg).toContain(`font-weight="${weight}"`);
    }
  });

  it('文字サイズは pt→mm、text-anchor は align に対応、letter-spacing も mm', () => {
    const svg = pageToSvg(page([text({ sizePt: 72, align: 'center', letterSpacingPt: 72 }), text({ align: 'right' }), text({})]));
    expect(svg).toContain('font-size="25.4"');
    expect(svg).toContain('letter-spacing="25.4"');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('text-anchor="start"');
  });

  it('テキストはXMLエスケープされる（& < > " \' と制御文字）', () => {
    const evil = `<script>alert("x")</script> & 'q' \u0001\u0008終`;
    const svg = pageToSvg(page([text({ text: evil })]));
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &apos;q&apos; 終');
    expect(svg).not.toMatch(/[\u0001\u0008]/);
    expect(escapeXml('a&b<c>"d\'')).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
  });

  it('属性値に入る文字列（dataUrl・パス）もエスケープし、色は不正値を無害化する', () => {
    const svg = pageToSvg(page([
      { type: 'image', x: 1, y: 2, w: 3, h: 4, dataUrl: 'data:image/png;base64,AAA"onload="x', opacity: 0.5 },
      { type: 'path', d: 'M0 0 L1 1"/><circle', fill: 'red" onload="x' },
      { type: 'rect', x: 0, y: 0, w: 1, h: 1, fill: 'url(#x)' },
    ]));
    expect(svg).not.toContain('"onload="');
    expect(svg).not.toContain('<circle');
    expect(svg).toContain('&quot;onload=&quot;'); // 引用符は無害化されて値の一部になる
    expect(svg).not.toContain('url(#x)');
  });

  it('ImageOp は <image href=dataUrl>、PathOp は <path>、LineOp の破線、RectOp の角丸', () => {
    const svg = pageToSvg(page([
      { type: 'image', x: 1, y: 2, w: 3, h: 4, dataUrl: TINY_PNG, opacity: 0.5 },
      { type: 'path', d: 'M0 0 L10 0 L10 10 Z', fill: '#C8161D', fillRule: 'evenodd', stroke: '#000000', strokeWidthMm: 0.3, opacity: 0.8 },
      { type: 'line', x1: 0, y1: 1, x2: 5, y2: 1, widthMm: 0.2, color: '#000000', dash: [2, 1] },
      { type: 'rect', x: 1, y: 2, w: 30, h: 10, fill: '#eeeeee', stroke: '#000000', strokeWidthMm: 0.25, radiusMm: 3 },
    ]));
    expect(svg).toContain(`<image href="${TINY_PNG}" x="1" y="2" width="3" height="4"`);
    expect(svg).toContain('opacity="0.5"');
    expect(svg).toContain('<path d="M0 0 L10 0 L10 10 Z" fill="#C8161D" fill-rule="evenodd" stroke="#000000" stroke-width="0.3" opacity="0.8"/>');
    expect(svg).toContain('stroke-dasharray="2 1"');
    expect(svg).toContain('rx="3" ry="3"');
  });

  it('空文字のテキストは出さない。出力は整形式のXML', () => {
    const svg = pageToSvg(page([text({ text: '' }), text({ text: '髙﨑邉𠮷㈱①〒' })]));
    expect(svg.match(/<text /g)).toHaveLength(1);
    expect(svg).toContain('髙﨑邉𠮷㈱①〒');
    // タグの開閉がバランスしている（簡易チェック）
    expect((svg.match(/<svg/g) ?? []).length).toBe(1);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
  });
});
