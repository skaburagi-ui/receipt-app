import { applyReceiptDateChange, createDefaultReceipt, todayInJapan } from '../domain/defaults';
import type { DesignSettings, IssuerInfo, LineItem, ReceiptInput, ReceiptMode } from '../domain/types';
import { createDefaultDesign } from './defaults';

export type Tab = 'input' | 'preview';

export interface AppState {
  receipt: ReceiptInput;
  design: DesignSettings;
  tab: Tab;
}

export type Action =
  | { type: 'setMode'; mode: ReceiptMode }
  | { type: 'patchReceipt'; patch: Partial<ReceiptInput> }
  | { type: 'patchIssuer'; patch: Partial<IssuerInfo> }
  | { type: 'setRecipient'; patch: Partial<ReceiptInput['recipient']> }
  | { type: 'setReceiptDate'; date: string }
  | { type: 'setTransactionDate'; date: string }
  | { type: 'setItems'; items: LineItem[] }
  | { type: 'patchTax'; patch: Partial<ReceiptInput['tax']> }
  | { type: 'patchConfirmations'; patch: Partial<ReceiptInput['confirmations']> }
  | { type: 'setCorrection'; correction: ReceiptInput['correction'] }
  | { type: 'patchCopyInfo'; patch: Partial<ReceiptInput['copyInfo']> }
  | { type: 'patchDesign'; patch: Partial<DesignSettings> }
  | { type: 'setTab'; tab: Tab }
  | { type: 'replace'; receipt: ReceiptInput; design: DesignSettings }
  | { type: 'loadIssuer'; issuer: IssuerInfo; design: Partial<DesignSettings> };

export function createInitialState(today: string = todayInJapan()): AppState {
  return { receipt: createDefaultReceipt(today), design: createDefaultDesign(), tab: 'input' };
}

export function reducer(state: AppState, action: Action): AppState {
  const r = state.receipt;
  switch (action.type) {
    case 'setMode': {
      // 適格系を選び直したときは確認チェックを外す（確認は選んだモードごとに自分で行う）
      const confirmations = action.mode === r.mode ? r.confirmations : { ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false };
      return { ...state, receipt: { ...r, mode: action.mode, confirmations } };
    }
    case 'patchReceipt':
      return { ...state, receipt: { ...r, ...action.patch } };
    case 'patchIssuer':
      return { ...state, receipt: { ...r, issuer: { ...r.issuer, ...action.patch } } };
    case 'setRecipient':
      return { ...state, receipt: { ...r, recipient: { ...r.recipient, ...action.patch } } };
    case 'setReceiptDate':
      return { ...state, receipt: applyReceiptDateChange(r, action.date) };
    case 'setTransactionDate':
      return { ...state, receipt: { ...r, transactionDate: action.date, transactionDateEdited: true } };
    case 'setItems':
      return { ...state, receipt: { ...r, tax: { ...r.tax, items: action.items } } };
    case 'patchTax':
      return { ...state, receipt: { ...r, tax: { ...r.tax, ...action.patch } } };
    case 'patchConfirmations':
      return { ...state, receipt: { ...r, confirmations: { ...r.confirmations, ...action.patch } } };
    case 'setCorrection':
      return { ...state, receipt: { ...r, correction: action.correction } };
    case 'patchCopyInfo':
      return { ...state, receipt: { ...r, copyInfo: { ...r.copyInfo, ...action.patch } } };
    case 'patchDesign':
      return { ...state, design: { ...state.design, ...action.patch } };
    case 'setTab':
      return { ...state, tab: action.tab };
    case 'replace':
      return { ...state, receipt: resetConfirmations(action.receipt), design: action.design };
    case 'loadIssuer':
      return {
        ...state,
        receipt: resetConfirmations({ ...r, issuer: action.issuer }),
        design: { ...state.design, ...action.design },
      };
  }
}

/** 領収書に消費税額を書く前提か（印紙税の目安の前提）。適格系は常に書く。一般は「参考表示」の設定に従う。 */
export function taxAmountShown(receipt: ReceiptInput, design: DesignSettings): boolean {
  return receipt.mode !== 'general' || design.showGeneralTaxReference;
}

/**
 * 下書きの復元・読み込みのあとは、確認チェック（登録番号が自分のもの・簡易の対象事業）を外す。
 * 確認は、その時点の内容を見て利用者が毎回自分で行うもの。
 */
export function resetConfirmations(receipt: ReceiptInput): ReceiptInput {
  const c = receipt.confirmations;
  if (!c.ownRegistrationNumber && !c.simpleInvoiceEligibleBusiness) return receipt;
  return { ...receipt, confirmations: { ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false } };
}

/**
 * プレビュー・PDF・検証に使う入力。一般モードでは登録番号を空にして渡す
 * （画面に欄が無いので、以前の入力が残っていても出力・検証に影響させない）。
 */
export function effectiveReceipt(receipt: ReceiptInput): ReceiptInput {
  if (receipt.mode !== 'general' || receipt.issuer.registrationNumber === '') return receipt;
  return { ...receipt, issuer: { ...receipt.issuer, registrationNumber: '' } };
}
