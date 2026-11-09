import type { ReceiptInput } from './types';

/** 既定値つきの空の領収書。today は 'YYYY-MM-DD'。担当: W1 */
export function createDefaultReceipt(today: string): ReceiptInput {
  return {
    mode: 'general',
    issuer: {
      name: '',
      postalCode: '',
      address: '',
      phone: '',
      registrationNumber: '',
      taxpayerType: 'unknown',
      businessNature: 'business',
    },
    recipient: { name: '', honorific: '様' },
    proviso: '',
    receiptDate: today,
    issueDate: null,
    transactionDate: today,
    transactionDateEdited: false,
    receiptNumber: '',
    paymentMethod: null,
    showPaymentMethod: false,
    tax: {
      inputMode: 'inclusive',
      rounding: 'floor',
      items: [{ description: '', amountYen: 0, category: 'taxable10' }],
    },
    remarks: '',
    delivery: 'paper',
    isSalesProceeds: true,
    confirmations: { ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false },
    copyInfo: { issuedBy: '', paymentChannel: '', internalNote: '' },
    correction: null,
  };
}

/** 領収日変更時、未編集の取引日を連動させる。取引日を個別編集済みなら維持。元のオブジェクトは変更しない。担当: W1 */
export function applyReceiptDateChange(input: ReceiptInput, newReceiptDate: string): ReceiptInput {
  return {
    ...input,
    receiptDate: newReceiptDate,
    transactionDate: input.transactionDateEdited ? input.transactionDate : newReceiptDate,
  };
}

/** 日本時間（UTC+9、サマータイムなし）の今日 'YYYY-MM-DD'。担当: W1 */
export function todayInJapan(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}
