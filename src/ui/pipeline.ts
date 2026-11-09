/** 入力 → 税計算 → シート → 面付け。プレビューとPDFで同じ経路を使う。他担当の関数は契約どおりに呼ぶだけ。 */
import { calculateTax } from '../domain/tax';
import type { DesignSettings, Page, ReceiptInput, RecipientRow, Sheet } from '../domain/types';
import { buildSheet } from '../layout/buildSheet';
import { imposePages } from '../layout/impose';
import { effectiveReceipt } from './state';

export interface BuiltPages {
  pages: Page[];
  overflow: boolean;
  /** overflow になった領収書の番号（0始まり） */
  overflowIndexes: number[];
}

/** 複数件（1件でも可）をページにする。rows が空なら receipt 1件。 */
export function buildPages(receiptIn: ReceiptInput, design: DesignSettings, rows?: { receipt: ReceiptInput }[]): BuiltPages {
  const list = (rows && rows.length > 0 ? rows.map((r) => r.receipt) : [receiptIn]).map(effectiveReceipt);
  const withCopy = design.format === 'a4-with-copy';
  const originals: Sheet[] = [];
  const copies: Sheet[] = [];
  const overflowIndexes: number[] = [];
  list.forEach((rc, i) => {
    const tax = calculateTax(rc.tax);
    const o = buildSheet(rc, tax, design, 'original');
    originals.push(o.sheet);
    let over = o.overflow;
    if (withCopy) {
      const c = buildSheet(rc, tax, design, 'copy');
      copies.push(c.sheet);
      over = over || c.overflow;
    }
    if (over) overflowIndexes.push(i);
  });
  const pages = imposePages(originals, withCopy ? copies : null, design);
  return { pages, overflow: overflowIndexes.length > 0, overflowIndexes };
}

/** 一括用：共通設定＋宛先行＋番号から領収書の配列を作る。 */
export function receiptsForRows(common: ReceiptInput, rows: RecipientRow[], numbers: string[]): { receipt: ReceiptInput }[] {
  return rows.map((row, i) => ({
    receipt: {
      ...common,
      recipient: { name: row.name, honorific: row.honorific || common.recipient.honorific },
      receiptNumber: numbers[i] ?? '',
    },
  }));
}

export function pdfFileName(dateIso: string, suffix = ''): string {
  const ymd = /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso.replace(/-/g, '') : 'nodate';
  return `領収書_${ymd}${suffix}.pdf`;
}
