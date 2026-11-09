/** 画面からの検証呼び出し。検証が例外を投げたら、出力を止める（フェイルクローズ）。 */
import { hasBlockingIssue, validateReceipt } from '../domain/validate';
import type { ReceiptInput, ValidationIssue } from '../domain/types';

export const VALIDATION_FAILED: ValidationIssue = {
  code: 'ui.validation.failed',
  level: 'error',
  message: '入力内容を検証できません。入力を見直してください。解決しないときは、ページを読み込み直してください。',
};

export function validateForUi(receipt: ReceiptInput): ValidationIssue[] {
  try {
    return validateReceipt(receipt);
  } catch {
    return [VALIDATION_FAILED];
  }
}

/** 出力の直前の再検証。error があれば true（処理を中止する）。 */
export function isBlocked(receipt: ReceiptInput): boolean {
  return hasBlockingIssue(validateForUi(receipt));
}
