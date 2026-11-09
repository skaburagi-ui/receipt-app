import { useEffect, useMemo, useState } from 'react';
import { calculateTax } from '../domain/tax';
import type { DesignSettings, ReceiptInput } from '../domain/types';
import { findMissingGlyphs, fontsLoaded, loadFonts } from '../layout/measure';
import { pageToSvg } from '../layout/svg';
import { isSealFontLoaded, loadSealFont } from '../seal/seal';
import { buildPages } from './pipeline';
import { effectiveReceipt } from './state';
import { attempt, sanitizeSvg } from './safe';

export function useDebounced<T>(value: T, ms = 100): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; svg: string; pageCount: number; overflow: boolean; widthMm: number; heightMm: number };

/**
 * フォントを読み込む（プレビューの計測と、アプリ内で作る角印の字形に必要）。失敗しても画面は動かす。
 * 角印用フォント（loadSealFont）を読み込まないと、buildSealOps が例外になり、角印がプレビューにもPDFにも出ない
 * （buildSheet は例外を握りつぶして角印だけ省略する）。QA1の実ブラウザー確認で発見。
 */
export function useFonts(): boolean {
  const [ready, setReady] = useState(() => { const r = attempt(() => fontsLoaded() && isSealFontLoaded()); return r.ok && r.value; });
  useEffect(() => {
    if (ready) return;
    let alive = true;
    Promise.resolve()
      .then(() => Promise.all([loadFonts(), loadSealFont().catch(() => undefined)]))
      .catch(() => undefined)
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [ready]);
  return ready;
}

/** 入力のたびに（デバウンス後）税計算→シート→面付け→SVG。1ページ目のSVGだけ返す。 */
export function usePreview(receipt: ReceiptInput, design: DesignSettings, fontsReady: boolean): PreviewState {
  const dReceipt = useDebounced(receipt, 100);
  const dDesign = useDebounced(design, 100);
  return useMemo<PreviewState>(() => {
    if (!fontsReady) return { status: 'loading' };
    const r = attempt(() => {
      const built = buildPages(effectiveReceipt(dReceipt), dDesign);
      const first = built.pages[0];
      if (!first) throw new Error('ページがありません');
      return { built, svg: sanitizeSvg(pageToSvg(first)), first };
    });
    if (!r.ok) return { status: 'error', message: r.message };
    const { built, svg, first } = r.value;
    return { status: 'ok', svg, pageCount: built.pages.length, overflow: built.overflow, widthMm: first.widthMm, heightMm: first.heightMm };
  }, [dReceipt, dDesign, fontsReady]);
}

/** 入力文字のうち領収書フォントに無いもの（豆腐になる文字）。フォント未読込の間は空。 */
export function useMissingGlyphs(receipt: ReceiptInput, design: DesignSettings, fontsReady: boolean): string[] {
  const text = [
    receipt.issuer.name, receipt.issuer.address, receipt.issuer.phone, receipt.issuer.postalCode,
    receipt.recipient.name, receipt.recipient.honorific, receipt.proviso, receipt.remarks, receipt.receiptNumber,
    receipt.copyInfo.issuedBy, receipt.copyInfo.paymentChannel, receipt.copyInfo.internalNote,
    ...receipt.tax.items.map((i) => i.description),
  ].join('');
  const d = useDebounced(text, 300);
  return useMemo(() => {
    if (!fontsReady) return [];
    const r = attempt(() => findMissingGlyphs(d));
    return r.ok ? r.value : [];
  }, [d, fontsReady, design.design]);
}

export function useTaxBreakdown(receipt: ReceiptInput) {
  return useMemo(() => calculateTax(receipt.tax), [receipt.tax]);
}
