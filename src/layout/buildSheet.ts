import type { DesignSettings, DrawOp, FontRole, ImageAsset, PaymentMethod, ReceiptInput, Sheet, TaxBreakdown } from '../domain/types';
import { normalizeRegistrationNumber } from '../domain/registration';
import { buildSealOps } from '../seal/seal';
import { sheetSizeMm } from './impose';
import { fitFontSize, measureText, wrapText } from './measure';
import { translateOps } from './ops';

/**
 * 領収書1枚の描画リストを作る（プレビューとPDFで共通）。role='copy' は控え（発行担当・入金方法・管理用備考を描く）。
 * 内容が枠に収まらない場合は自動縮小（本文8pt未満にはしない）→まだ溢れるなら overflow=true（描画は打ち切らず返す）。
 *
 * 重要：同期関数。フォント計測は measure.ts の fontkit を使うので、呼ぶ前に `await loadFonts()` しておくこと。
 *
 * 一般モード（general）では issuer.registrationNumber を絶対に印字しない。「インボイス」の語はどのモードでも使わない。
 * 「適格」の語は、適格系モードの書類名と、一般モードの注記「適格請求書ではありません」（showNotInvoiceNotice）のみ。
 */
export interface BuildSheetResult { sheet: Sheet; overflow: boolean }

const PT = 25.4 / 72; // pt → mm
const INK = '#111111';
const SUB = '#444444';
const FRAME_MARGIN = 9; // 枠の外側の余白（重要要素はシート端から8mm以上）
const MIN_SEAL_MARGIN = 8;

const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash: '現金',
  bankTransfer: '銀行振込',
  creditCard: 'クレジットカード',
  electronicMoney: '電子マネー',
  qrPayment: 'QRコード決済',
  other: 'その他',
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ───────── 色 ─────────
function parseHex(c: string): [number, number, number] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(c ?? '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** 白へ近づける（t=0 で元の色、1 で白）。 */
function tint(hex: string, t: number): string {
  const c = parseHex(hex)!;
  return toHex(c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t);
}
function shade(hex: string, t: number): string {
  const c = parseHex(hex)!;
  return toHex(c[0] * (1 - t), c[1] * (1 - t), c[2] * (1 - t));
}
/** 面の色の上に置く文字色（白か黒の濃い方）。 */
function onColor(hex: string): string {
  return luminance(parseHex(hex)!) > 0.4 ? INK : '#ffffff';
}

// ───────── 書式 ─────────
export function formatYen(n: number): string {
  const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}¥${s}`;
}
export function formatJaDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  if (!m) return iso ?? '';
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** ロゴの大きさ（mm）。幅は logoWidthMm（10〜50に丸め）、高さは縦横比から。高さ16mmを超えたら幅を縮める。 */
function logoGeometry(logo: ImageAsset, widthMm: number): { w: number; h: number } {
  let w = Math.min(50, Math.max(10, widthMm || 30));
  const ratio = logo.heightPx > 0 && logo.widthPx > 0 ? logo.heightPx / logo.widthPx : 1;
  let h = w * ratio;
  if (h > 16) { h = 16; w = h / ratio; }
  return { w, h };
}

interface Sec { h: number; gap: number; draw: (y: number) => void }

export function buildSheet(
  receipt: ReceiptInput,
  tax: TaxBreakdown,
  design: DesignSettings,
  role: 'original' | 'copy',
): BuildSheetResult {
  const { widthMm: W, heightMm: H } = sheetSizeMm(design.format);
  const kMax = H > 200 ? 1.3 : 1.0;
  const kMin = 0.8;

  let best: { ops: DrawOp[]; overflow: boolean } | null = null;
  for (let k = kMax; k >= kMin - 1e-9; k = Math.round((k - 0.05) * 100) / 100) {
    const r = layoutAt(Math.max(k, kMin));
    best = r;
    if (!r.overflow) break;
  }
  return { sheet: { widthMm: W, heightMm: H, ops: best!.ops }, overflow: best!.overflow };

  function layoutAt(k: number): { ops: DrawOp[]; overflow: boolean } {
    const ops: DrawOp[] = [];
    const style = design.design;
    const theme = parseHex(design.themeColor) ? design.themeColor : '#1F4E79';
    const isCopy = role === 'copy';
    const mode = receipt.mode;
    const qualified = mode === 'qualified';
    const simpleInv = mode === 'qualifiedSimple';
    const correction = receipt.correction ?? null;
    const general = mode === 'general';

    // フォントの使い分け
    const bodyFont: FontRole = 'sans';
    const labelFont: FontRole = style === 'business' ? 'serif' : style === 'casual' ? 'sansBold' : 'sans';
    const strongFont: FontRole = style === 'business' ? 'serifBold' : 'sansBold';
    const nameFont: FontRole = style === 'business' ? 'serifBold' : style === 'casual' ? 'sansBold' : 'sans';
    const titleFont: FontRole = style === 'business' ? 'serifBold' : 'sansBold';
    const lineColor = style === 'casual' ? shade(theme, 0.25) : '#333333';

    // サイズ（pt）。本文は8pt、小さい注記は7ptを下限にする。
    const small = Math.max(8.5 * k, 7);
    const sz = (base: number, floor: number) => Math.max(base * k, floor);

    const pad = style === 'business' ? 6.2 : 5;
    const cx0 = FRAME_MARGIN + pad;
    const cw = W - 2 * FRAME_MARGIN - 2 * pad;
    const cy0 = FRAME_MARGIN + pad;
    const availH = H - 2 * FRAME_MARGIN - 2 * pad;
    const cx1 = cx0 + cw;

    const lh = (pt: number, f = 1.4) => pt * PT * f;
    /** top から高さ boxH（既定は行高）の箱の中央にベースラインを置いて1行描く。 */
    const text = (x: number, top: number, str: string, font: FontRole, pt: number, color = INK, align?: 'left' | 'center' | 'right', ls?: number, boxH?: number): void => {
      const h = boxH ?? lh(pt);
      const base = top + (h - pt * PT) / 2 + pt * PT * 0.86;
      const op: DrawOp = { type: 'text', x: r3(x), y: r3(base), text: str, font, sizePt: pt, color };
      if (align) op.align = align;
      if (ls) op.letterSpacingPt = ls;
      ops.push(op);
    };
    const hline = (x1: number, x2: number, y: number, w = 0.25, color = lineColor): void => {
      ops.push({ type: 'line', x1, y1: y, x2, y2: y, widthMm: w, color });
    };

    // ── 枠 ──
    if (style === 'simple') {
      ops.push({ type: 'rect', x: FRAME_MARGIN, y: FRAME_MARGIN, w: W - 2 * FRAME_MARGIN, h: H - 2 * FRAME_MARGIN, stroke: lineColor, strokeWidthMm: 0.25 });
    } else if (style === 'business') {
      ops.push({ type: 'rect', x: FRAME_MARGIN, y: FRAME_MARGIN, w: W - 2 * FRAME_MARGIN, h: H - 2 * FRAME_MARGIN, stroke: '#222222', strokeWidthMm: 0.6 });
      ops.push({ type: 'rect', x: FRAME_MARGIN + 1.3, y: FRAME_MARGIN + 1.3, w: W - 2 * FRAME_MARGIN - 2.6, h: H - 2 * FRAME_MARGIN - 2.6, stroke: '#222222', strokeWidthMm: 0.2 });
    } else {
      ops.push({ type: 'rect', x: FRAME_MARGIN, y: FRAME_MARGIN, w: W - 2 * FRAME_MARGIN, h: H - 2 * FRAME_MARGIN, stroke: theme, strokeWidthMm: 0.7, radiusMm: 4 });
    }

    // ── 発行者情報（登録番号は適格系のみ。一般モードでは値を参照すらしない） ──
    const issuer = receipt.issuer;
    let regNo = '';
    if (!general) {
      try { regNo = normalizeRegistrationNumber(issuer.registrationNumber).normalized ?? ''; } catch { regNo = (issuer.registrationNumber ?? '').trim(); }
    }

    const secs: Sec[] = [];
    const add = (h: number, gap: number, draw: (y: number) => void) => secs.push({ h, gap, draw });

    // ── 1. 見出し ──
    const logo = design.logo ? logoGeometry(design.logo, design.logoWidthMm) : null;
    {
      const tPt = sz(20, 15);
      const titleH = Math.max(lh(tPt, 1.6), logo ? logo.h : 0, style === 'casual' ? lh(tPt, 1.9) : 0);
      const subtitle = qualified ? '適格請求書' : simpleInv ? '適格簡易請求書' : '';
      const subPt = sz(9, 7);
      const subH = subtitle ? lh(subPt, 1.3) : 0;
      const ruleH = style === 'business' ? 2.2 : style === 'simple' ? 1 : 0;
      add(titleH + subH + ruleH, 0, (y) => {
        const ls = 6;
        const title = correction ? '領収書（訂正）' : '領収書';
        const cxTitle = cx0 + cw / 2 + (ls * PT) / 2;
        if (style === 'casual') {
          const bandW = Math.min(cw - 2 * ((logo?.w ?? 0) + 4), 90);
          ops.push({ type: 'rect', x: cx0 + cw / 2 - bandW / 2, y, w: bandW, h: titleH, fill: theme, radiusMm: 3 });
          text(cxTitle, y, title, titleFont, tPt, onColor(theme), 'center', ls, titleH);
        } else {
          text(cxTitle, y, title, titleFont, tPt, INK, 'center', ls, titleH);
        }
        if (subtitle) text(cx0 + cw / 2, y + titleH, `（${subtitle}）`, strongFont, subPt, INK, 'center', 0, subH);
        if (logo) ops.push({ type: 'image', x: cx0, y, w: r3(logo.w), h: r3(logo.h), dataUrl: design.logo!.dataUrl });
        if (isCopy) {
          const bw = Math.max(9, tPt * PT * 0.9);
          ops.push({ type: 'rect', x: cx1 - bw, y, w: bw, h: bw, stroke: INK, strokeWidthMm: 0.35, radiusMm: style === 'casual' ? 2 : 0 });
          text(cx1 - bw / 2, y, '控', 'sansBold', sz(13, 10), INK, 'center', 0, bw);
        }
        const ry = y + titleH + subH;
        if (style === 'business') {
          hline(cx0, cx1, ry + 0.6, 0.6, '#222222');
          hline(cx0, cx1, ry + 1.7, 0.2, '#222222');
        } else if (style === 'simple') {
          hline(cx0, cx1, ry + 0.4, 0.25);
        }
      });
    }

    // ── 訂正する元の書類と修正内容 ──
    if (correction) {
      const cHeadPt = sz(9.5, 7.5);
      const cBodyPt = sz(9, 7);
      const original = [
        correction.originalDate.trim() ? `${formatJaDate(correction.originalDate.trim())}付` : '',
        correction.originalNumber.trim() ? `No. ${correction.originalNumber.trim()}` : '',
      ].filter(Boolean).join(' ');
      const head = `${original || '元の書類'}について、下記のとおり訂正します`;
      const lines = [
        ...wrapText(head, strongFont, cHeadPt, cw - 2),
        ...wrapText(correction.changes.trim(), bodyFont, cBodyPt, cw - 2),
      ].filter(Boolean);
      const lineH = lh(cBodyPt, 1.45);
      add(Math.max(lineH, lines.length * lineH), 2.2, (y) => {
        lines.forEach((ln, i) => text(cx0 + 1, y + i * lineH, ln, i === 0 ? strongFont : bodyFont, i === 0 ? cHeadPt : cBodyPt, INK, 'left', 0, lineH));
      });
    }

    // ── 2. 宛名（左）と 番号・日付（右） ──
    {
      const leftW = cw * 0.6;
      let name = (receipt.recipient.name ?? '').trim();
      let honorific = receipt.recipient.honorific ?? '';
      if (simpleInv && name === '') { name = '上'; honorific = '様'; } // 適格簡易は宛名任意：「上様」
      const honPt = sz(12, 9.5);
      const honW = honorific ? measureText(honorific, labelFont, honPt) + 2 : 0;
      const nameMaxW = leftW - honW - 1;
      const namePt = fitFontSize(name || ' ', nameFont, sz(14, 11), 9.5, nameMaxW);
      const nameLines = name ? wrapText(name, nameFont, namePt, nameMaxW) : [''];
      const nameLineH = lh(namePt, 1.55);
      const leftH = nameLineH * nameLines.length + 1;

      const metaPt = sz(10, 8);
      const metaLines: { label?: string; value: string; pt: number }[] = [];
      if (receipt.receiptNumber.trim() !== '') metaLines.push({ value: `No. ${receipt.receiptNumber.trim()}`, pt: metaPt });
      const rd = formatJaDate(receipt.receiptDate);
      if (general) {
        metaLines.push({ value: rd, pt: metaPt });
      } else {
        // 適格系の「年月日」は取引日
        metaLines.push({ label: '取引日', value: formatJaDate(receipt.transactionDate), pt: metaPt });
        if (receipt.receiptDate && receipt.receiptDate !== receipt.transactionDate) metaLines.push({ label: '領収日', value: rd, pt: small });
      }
      if (receipt.issueDate && receipt.issueDate !== receipt.receiptDate) metaLines.push({ label: '発行日', value: formatJaDate(receipt.issueDate), pt: small });
      const metaH = metaLines.reduce((a, m) => a + lh(m.pt, 1.5), 0);
      add(Math.max(leftH, metaH), 3.2, (y) => {
        nameLines.forEach((ln, i) => {
          const ty = y + i * nameLineH;
          if (ln) text(cx0 + 1, ty, ln, nameFont, namePt, INK, 'left', 0, nameLineH);
          hline(cx0, cx0 + leftW, ty + nameLineH + 0.2, style === 'casual' ? 0.45 : 0.3, style === 'casual' ? theme : lineColor);
        });
        if (honorific) {
          const ly = y + (nameLines.length - 1) * nameLineH;
          text(cx0 + leftW - 1, ly, honorific, labelFont, honPt, INK, 'right', 0, nameLineH);
        }
        let my = y;
        for (const m of metaLines) {
          const mh = lh(m.pt, 1.5);
          text(cx1, my, m.label ? `${m.label}　${m.value}` : m.value, bodyFont, m.pt, INK, 'right', 0, mh);
          my += mh;
        }
      });
    }

    // ── 3. 領収金額 ──
    {
      const amtPt = sz(26, 18);
      const boxH = lh(amtPt, 1.75);
      const labelPt = sz(10, 8);
      const amountStr = `${formatYen(tax.grandTotalYen)}-`;
      const showInc = tax.byRate.length > 0;
      add(boxH, 3.4, (y) => {
        const x = cx0, w = cw;
        if (style === 'business') {
          ops.push({ type: 'rect', x, y, w, h: boxH, stroke: '#222222', strokeWidthMm: 0.5 });
          ops.push({ type: 'rect', x: x + 0.9, y: y + 0.9, w: w - 1.8, h: boxH - 1.8, stroke: '#222222', strokeWidthMm: 0.2 });
        } else if (style === 'casual') {
          ops.push({ type: 'rect', x, y, w, h: boxH, fill: tint(theme, 0.86), stroke: theme, strokeWidthMm: 0.5, radiusMm: 3 });
        } else {
          ops.push({ type: 'rect', x, y, w, h: boxH, stroke: lineColor, strokeWidthMm: 0.3 });
        }
        text(x + 4, y, '領収金額', labelFont, labelPt, INK, 'left', 2, boxH);
        text(x + w / 2 + 6, y, amountStr, strongFont, amtPt, INK, 'center', 1, boxH);
        if (showInc) text(x + w - 3, y + boxH * 0.22, '税込', bodyFont, small, SUB, 'right', 0, boxH * 0.56);
      });
    }

    // ── 4. 但し書き ──
    {
      const pPt = sz(11, 8.5);
      let proviso = (receipt.proviso ?? '').trim();
      let lines: string[];
      if (proviso === '') {
        lines = ['但し　　　　　　　　　　　　　　　　として'];
      } else {
        if (!proviso.endsWith('として')) proviso += ' として';
        lines = wrapText(`但し ${proviso}`, bodyFont, pPt, cw - 2);
      }
      const l1 = lh(pPt, 1.5);
      const confPt = sz(10.5, 8.5);
      const confH = lh(confPt, 1.55);
      add(l1 * lines.length + confH, 3.2, (y) => {
        lines.forEach((ln, i) => text(cx0 + 1, y + i * l1, ln, bodyFont, pPt, INK, 'left', 0, l1));
        text(cx0 + 1, y + l1 * lines.length, '上記正に領収いたしました', bodyFont, confPt, INK, 'left', 0, confH);
      });
    }

    // ── 5. 明細 ──
    const items = receipt.tax.items.filter((it) => it.description.trim() !== '' || it.amountYen > 0);
    const markReduced = !general || design.showGeneralTaxReference; // ※を付けるか（一般は参考表示ONのときのみ）
    const showItems = !general ? items.length > 0 : items.length > 1;
    const showTaxTable = !general && (tax.byRate.length > 0 || tax.nonTaxableYen > 0);
    const showGeneralRef = general && design.showGeneralTaxReference && tax.byRate.length > 0;
    const reducedInItems = showItems && markReduced && items.some((it) => it.category === 'taxable8');
    const reducedInTax = (showTaxTable || showGeneralRef) && tax.byRate.some((r) => r.rate === 8);
    const needLegend = reducedInItems || reducedInTax;

    if (showItems) {
      const iPt = sz(10, 8);
      const amtColW = 34;
      const descW = cw - amtColW - 4;
      const rowLH = lh(iPt, 1.45);
      const rows = items.map((it) => {
        let d = it.description.trim() || (simpleInv ? receipt.proviso.trim() : '（品目なし）');
        if (it.category === 'taxable8' && markReduced) d = `※${d}`;
        else if (it.category === 'exempt') d += '（非課税）';
        else if (it.category === 'outOfScope') d += '（不課税）';
        else if (it.category === 'taxFree') d += '（免税）';
        return { lines: wrapText(d, bodyFont, iPt, descW), amount: formatYen(it.amountYen) };
      });
      const headH = lh(small, 1.5);
      const totalH = headH + rows.reduce((a, r) => a + r.lines.length * rowLH + 0.6, 0);
      const amountHead = receipt.tax.inputMode === 'exclusive' ? '金額（税抜）' : '金額（税込）';
      add(totalH, 2.6, (y) => {
        if (style === 'casual') ops.push({ type: 'rect', x: cx0, y, w: cw, h: headH, fill: tint(theme, 0.8), radiusMm: 1.2 });
        text(cx0 + 2, y, '内容', labelFont, small, INK, 'left', 0, headH);
        text(cx1 - 2, y, amountHead, labelFont, small, INK, 'right', 0, headH);
        if (style !== 'casual') hline(cx0, cx1, y + headH, 0.25);
        let ry = y + headH;
        for (const r of rows) {
          r.lines.forEach((ln, i) => text(cx0 + 2, ry + i * rowLH, ln, bodyFont, iPt, INK, 'left', 0, rowLH));
          text(cx1 - 2, ry, r.amount, bodyFont, iPt, INK, 'right', 0, rowLH);
          ry += r.lines.length * rowLH + 0.6;
          hline(cx0, cx1, ry - 0.3, 0.12, '#999999');
        }
      });
    }

    // ── 6. 税率別の内訳 ──
    if (showGeneralRef) {
      const tPt = sz(9, 7.5);
      const rl = lh(tPt, 1.5);
      add(rl * tax.byRate.length, 2.2, (y) => {
        tax.byRate.forEach((r, i) => {
          const mark = r.rate === 8 ? '※' : '';
          text(cx0 + 2, y + i * rl, `（参考）${r.rate}%対象${mark}　税込 ${formatYen(r.inclusiveYen)}　うち消費税相当額 ${formatYen(r.taxYen)}`, bodyFont, tPt, SUB, 'left', 0, rl);
        });
      });
    } else if (showTaxTable) {
      const tPt = sz(9.5, 8);
      const rl = lh(tPt, 1.5);
      const nRows = tax.byRate.length + (tax.nonTaxableYen > 0 ? 1 : 0);
      const cols = qualified
        ? [{ h: '税抜金額', x: cx0 + cw * 0.56 }, { h: '消費税額', x: cx0 + cw * 0.76 }, { h: '税込金額', x: cx1 - 2 }]
        : [{ h: '対価の額（税込）', x: cx0 + cw * 0.66 }, { h: '消費税額等', x: cx1 - 2 }];
      add(rl * (nRows + 1) + 0.6, 2.4, (y) => {
        if (style === 'casual') ops.push({ type: 'rect', x: cx0, y, w: cw, h: rl, fill: tint(theme, 0.8), radiusMm: 1.2 });
        text(cx0 + 2, y, '税率区分', labelFont, tPt, INK, 'left', 0, rl);
        cols.forEach((c) => text(c.x, y, c.h, labelFont, tPt, INK, 'right', 0, rl));
        if (style !== 'casual') hline(cx0, cx1, y + rl, 0.25);
        let ry = y + rl + 0.3;
        for (const r of tax.byRate) {
          text(cx0 + 2, ry, `${r.rate}%対象${r.rate === 8 ? '※' : ''}`, bodyFont, tPt, INK, 'left', 0, rl);
          const vals = qualified ? [formatYen(r.baseExclusiveYen), formatYen(r.taxYen), formatYen(r.inclusiveYen)] : [formatYen(r.inclusiveYen), formatYen(r.taxYen)];
          cols.forEach((c, i) => text(c.x, ry, vals[i], bodyFont, tPt, INK, 'right', 0, rl));
          ry += rl;
        }
        if (tax.nonTaxableYen > 0) {
          text(cx0 + 2, ry, '非課税・不課税・免税', bodyFont, tPt, INK, 'left', 0, rl);
          text(cols[qualified ? 2 : 0].x, ry, formatYen(tax.nonTaxableYen), bodyFont, tPt, INK, 'right', 0, rl);
        }
      });
    }

    // ── 8. フッター（発行者／収入印紙欄／控え情報）。下端に固定 ──
    const issuerX = cx0 + cw * 0.5;
    const issuerW = cx1 - issuerX;
    const iNamePt = sz(12, 9);
    const iPt = sz(9.5, 8);
    const issuerLines: { t: string; font: FontRole; pt: number }[] = [];
    for (const ln of wrapText((issuer.name ?? '').trim(), strongFont, iNamePt, issuerW)) issuerLines.push({ t: ln, font: strongFont, pt: iNamePt });
    const postal = (issuer.postalCode ?? '').trim();
    const addr = [postal ? (postal.startsWith('〒') ? postal : `〒${postal}`) : '', (issuer.address ?? '').trim()].filter(Boolean).join(' ');
    if (addr) for (const ln of wrapText(addr, bodyFont, iPt, issuerW)) issuerLines.push({ t: ln, font: bodyFont, pt: iPt });
    if ((issuer.phone ?? '').trim()) issuerLines.push({ t: `TEL ${issuer.phone.trim()}`, font: bodyFont, pt: iPt });
    if (regNo) issuerLines.push({ t: `登録番号 ${regNo}`, font: bodyFont, pt: iPt });
    const issuerH = issuerLines.reduce((a, l) => a + lh(l.pt, 1.45), 0);

    const stampBox = !isCopy && design.showRevenueStampBox;
    const stampSize = sz(22, 17);
    const cPt = sz(9, 7.5);
    const copyLines: { text: string; pt: number }[] = [];
    if (isCopy) {
      const ci = receipt.copyInfo;
      const raw = [
        ci.issuedBy?.trim() ? `発行担当：${ci.issuedBy.trim()}` : '',
        ci.paymentChannel?.trim() ? `入金方法：${ci.paymentChannel.trim()}` : '',
        ci.internalNote?.trim() ? `管理用備考：${ci.internalNote.trim()}` : '',
      ].filter(Boolean);
      for (const r of raw) for (const line of wrapText(r, bodyFont, cPt, cw * 0.46 - 2)) copyLines.push({ text: line, pt: cPt });
      const saveNotice = general
        ? 'この控えは発行者が保存してください。保存期間や方法は事業の種類により異なります。詳しくは国税庁の案内または税理士へ。'
        : 'この控えは発行者が保存してください。適格請求書の写しは原則7年間保存する義務があります。電子データで渡した場合はデータのまま保存が必要です。詳しくは国税庁の案内または税理士へ。';
      const savePt = sz(6.5, 6);
      for (const line of wrapText(saveNotice, bodyFont, savePt, cw * 0.46 - 3)) copyLines.push({ text: line, pt: savePt });
    }
    const copyH = copyLines.reduce((height, line) => height + lh(line.pt, 1.45), 0);
    const footH = Math.max(issuerH, stampBox ? stampSize : 0, copyH);
    const footGap = 3;

    // ── 7. ※凡例・支払方法・備考・注記 ──
    // 通常は本文の下（全幅）に置く。収まらないときは、収入印紙欄の右（フッター左側）の空きへ移して高さを稼ぐ。
    const nPt = sz(9, 7.5);
    const nl = lh(nPt, 1.5);
    const wrapNotes = (width: number): string[] => {
      const all: string[] = [];
      if (needLegend) all.push('※は軽減税率対象');
      if (receipt.showPaymentMethod && receipt.paymentMethod) all.push(`お支払方法：${PAYMENT_LABEL[receipt.paymentMethod]}`);
      if ((receipt.remarks ?? '').trim() !== '') all.push(...wrapText(`備考：${receipt.remarks.trim()}`, bodyFont, nPt, width));
      if (general && design.showNotInvoiceNotice) all.push(...wrapText('この領収書は適格請求書ではありません', bodyFont, nPt, width));
      return all;
    };
    const notesFlow = wrapNotes(cw - 2);
    const footLeftX = cx0 + 1 + (stampBox ? stampSize + 3 : 0);
    const narrowW = issuerX - footLeftX - 3;
    const notesFoot = !isCopy && narrowW > 35 ? wrapNotes(narrowW) : [];
    const baseFlowH = secs.reduce((a, s) => a + s.h, 0);
    const baseGaps = secs.reduce((a, s) => a + s.gap, 0) - (secs[0]?.gap ?? 0);
    const usedFlow = baseFlowH + baseGaps + (notesFlow.length ? nl * notesFlow.length + 2.4 : 0) + footGap + footH;
    const footHB = Math.max(footH, notesFoot.length * nl);
    const useFoot = usedFlow > availH + 1e-6 && notesFoot.length > 0 && baseFlowH + baseGaps + footGap + footHB < usedFlow - 1e-6;
    const notes = useFoot ? [] : notesFlow;
    const footHeight = useFoot ? footHB : footH;
    if (notes.length > 0) {
      add(nl * notes.length, 2.4, (y) => {
        notes.forEach((ln, i) => text(cx0 + 1, y + i * nl, ln, bodyFont, nPt, SUB, 'left', 0, nl));
      });
    }

    // 配置：セクションを上から積み、余りは隙間へ配分（上限あり）。足りないときは隙間を最大4割まで詰める。フッターは下端に固定。
    const flowH = secs.reduce((a, s) => a + s.h, 0);
    const gaps = secs.reduce((a, s) => a + s.gap, 0) - (secs[0]?.gap ?? 0);
    const fixed = flowH + footGap + footHeight;
    const slack = availH - fixed - gaps;
    const overflow = fixed + gaps * 0.6 > availH + 1e-6;
    const g = gaps <= 0 ? 1 : slack >= 0 ? Math.min(2.2, 1 + slack / gaps / 1.2) : Math.max(0.6, (availH - fixed) / gaps);
    let y = cy0;
    secs.forEach((s, i) => {
      if (i > 0) y += s.gap * g;
      s.draw(y);
      y += s.h;
    });
    const footTop = overflow ? y + footGap : cy0 + availH - footHeight;
    if (useFoot) {
      notesFoot.forEach((ln, i) => text(footLeftX, footTop + footHeight - notesFoot.length * nl + i * nl, ln, bodyFont, nPt, SUB, 'left', 0, nl));
    }
    if (stampBox) {
      const sx = cx0 + 1;
      const sy = footTop + footHeight - stampSize;
      ops.push({ type: 'rect', x: sx, y: sy, w: stampSize, h: stampSize, stroke: '#555555', strokeWidthMm: 0.25, radiusMm: style === 'casual' ? 2 : 0 });
      text(sx + stampSize / 2, sy + 1.2, '収入印紙', bodyFont, sz(8, 7), SUB, 'center', 0, lh(sz(8, 7), 1.3));
    }
    if (isCopy) {
      let cy = footTop + footHeight - copyH;
      copyLines.forEach((line) => {
        const lineH = lh(line.pt, 1.45);
        text(cx0 + 1, cy, line.text, bodyFont, line.pt, SUB, 'left', 0, lineH);
        cy += lineH;
      });
    }
    let iy = footTop + footHeight - issuerH;
    for (const l of issuerLines) {
      const h = lh(l.pt, 1.45);
      text(issuerX, iy, l.t, l.font, l.pt, INK, 'left', 0, h);
      iy += h;
    }

    // ── 9. 角印（画像優先。無ければ sealSpec）。位置はシート端から8mm以上内側へ丸める ──
    if (design.showSeal) {
      const size = Math.max(5, Math.min(design.sealPlacement.sizeMm, Math.min(W, H) - 2 * MIN_SEAL_MARGIN));
      const px = Math.min(Math.max(design.sealPlacement.xMm, MIN_SEAL_MARGIN), W - MIN_SEAL_MARGIN - size);
      const py = Math.min(Math.max(design.sealPlacement.yMm, MIN_SEAL_MARGIN), H - MIN_SEAL_MARGIN - size);
      if (design.sealImage) {
        const img = design.sealImage;
        const scale = Math.min(size / Math.max(img.widthPx, 1), size / Math.max(img.heightPx, 1));
        const w = img.widthPx * scale, h = img.heightPx * scale;
        ops.push({ type: 'image', x: r3(px + (size - w) / 2), y: r3(py + (size - h) / 2), w: r3(w), h: r3(h), dataUrl: img.dataUrl });
      } else if (design.sealSpec) {
        try {
          ops.push(...translateOps(buildSealOps(design.sealSpec, size), px, py));
        } catch {
          // 角印が未実装・失敗のときは、角印だけ省略して他は描く
        }
      }
    }

    return { ops, overflow };
  }
}
