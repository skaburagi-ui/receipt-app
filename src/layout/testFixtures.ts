import type { DesignSettings, ReceiptInput, TaxBreakdown } from '../domain/types';

/** レイアウト・PDFテスト用のサンプル（W1の calculateTax に依存しないよう、TaxBreakdown は手組み）。 */

export function sampleDesign(over: Partial<DesignSettings> = {}): DesignSettings {
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
    ...over,
  };
}

export function sampleReceipt(over: Partial<ReceiptInput> = {}): ReceiptInput {
  return {
    mode: 'general',
    issuer: {
      name: '株式会社髙﨑商事',
      postalCode: '100-0005',
      address: '東京都千代田区丸の内1-9-1 丸の内ビル5階',
      phone: '03-1234-5678',
      registrationNumber: 'T1234567890123',
      taxpayerType: 'taxable',
      businessNature: 'business',
    },
    recipient: { name: '髙﨑邉𠮷㈱①〒', honorific: '様' },
    proviso: 'お品代',
    receiptDate: '2026-11-05',
    issueDate: null,
    transactionDate: '2026-11-05',
    transactionDateEdited: false,
    receiptNumber: '',
    paymentMethod: null,
    showPaymentMethod: false,
    tax: { inputMode: 'inclusive', rounding: 'floor', items: [{ description: 'お品代', amountYen: 11000, category: 'taxable10' }] },
    remarks: '',
    delivery: 'paper',
    isSalesProceeds: true,
    confirmations: { ownRegistrationNumber: true, simpleInvoiceEligibleBusiness: true },
    copyInfo: { issuedBy: '', paymentChannel: '', internalNote: '' },
    ...over,
  };
}

export const TAX_10: TaxBreakdown = {
  byRate: [{ rate: 10, baseExclusiveYen: 10000, taxYen: 1000, inclusiveYen: 11000 }],
  nonTaxableYen: 0,
  grandTotalYen: 11000,
  totalTaxYen: 1000,
};

/** 10%（税込 11,000）と 8%（税込 5,400）の混在。 */
export const TAX_MIXED: TaxBreakdown = {
  byRate: [
    { rate: 10, baseExclusiveYen: 10000, taxYen: 1000, inclusiveYen: 11000 },
    { rate: 8, baseExclusiveYen: 5000, taxYen: 400, inclusiveYen: 5400 },
  ],
  nonTaxableYen: 0,
  grandTotalYen: 16400,
  totalTaxYen: 1400,
};

export function taxForSingle(amountYen: number): TaxBreakdown {
  const tax = Math.floor((amountYen * 10) / 110);
  return { byRate: [{ rate: 10, baseExclusiveYen: amountYen - tax, taxYen: tax, inclusiveYen: amountYen }], nonTaxableYen: 0, grandTotalYen: amountYen, totalTaxYen: tax };
}

/** 透過PNG（赤い丸）の最小データURL。8x8。 */
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4nGNgQAInxGT/gzADOoBJoGPiFOCShCsiqIByNxDyJgDMtFb5zjstrQAAAABJRU5ErkJggg==';
