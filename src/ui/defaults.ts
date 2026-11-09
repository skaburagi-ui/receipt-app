import type { DesignSettings, SealSpec } from '../domain/types';

export const THEME_COLORS: { name: string; value: string }[] = [
  { name: '青', value: '#2563EB' },
  { name: '緑', value: '#15803D' },
  { name: '赤', value: '#C8161D' },
  { name: '紺', value: '#1E3A5F' },
  { name: '黒', value: '#222222' },
];

export function createDefaultDesign(): DesignSettings {
  return {
    design: 'simple',
    themeColor: '#2563EB',
    format: 'a4-single',
    showSeal: false,
    sealImage: null,
    sealSpec: null,
    sealPlacement: { xMm: 162, yMm: 100, sizeMm: 20 },
    logo: null,
    logoWidthMm: 30,
    showRevenueStampBox: false,
    showCutGuide: true,
    showCutGuideOnEmptyHalf: false,
    showNotInvoiceNotice: true,
    showGeneralTaxReference: true,
  };
}

export function createDefaultSealSpec(text = ''): SealSpec {
  return { text, layout: 'auto', color: '#C8161D', frame: 'single', roundedFrame: false };
}

export const FORMAT_INFO: { id: import('../domain/types').PrintFormat; label: string; desc: string }[] = [
  { id: 'a4-single', label: 'A4 1件', desc: 'A4たて。1枚に領収書1件。' },
  { id: 'a5-single', label: 'A5 1件', desc: 'A5よこ。A5の用紙が使えないときは、A4に印刷して切ってください。' },
  { id: 'a4-double', label: 'A4 2件（上下）', desc: 'A4に別々の領収書を上下2件。真ん中で切って使います。' },
  { id: 'a4-with-copy', label: 'A4 領収書＋控え', desc: '上が領収書、下が自分用の控え。同じ番号・同じ金額で出ます。' },
];

export const DESIGN_INFO: { id: import('../domain/types').DesignId; label: string; desc: string }[] = [
  { id: 'simple', label: 'シンプル', desc: 'ゴシック体・細い罫線' },
  { id: 'business', label: 'ビジネス', desc: '明朝体の見出し・二重罫' },
  { id: 'casual', label: 'カジュアル', desc: '太字・角丸・色つき' },
];
