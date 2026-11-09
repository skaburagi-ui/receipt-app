import type { Dispatch } from 'react';
import type { PaymentMethod, ReceiptInput, ValidationIssue } from '../../domain/types';
import type { Action } from '../state';
import { CORRECTION_NOTE, PAYMENT_STAMP_NOTE } from '../copy';
import { Check, DateField, Section, SelectField, TextAreaField, TextField, issuesFor } from './common';

const PAYMENT_OPTIONS: { value: PaymentMethod | ''; label: string }[] = [
  { value: '', label: '未選択／わからない' },
  { value: 'cash', label: '現金' },
  { value: 'bankTransfer', label: '銀行振込' },
  { value: 'creditCard', label: 'クレジットカード' },
  { value: 'electronicMoney', label: '電子マネー' },
  { value: 'qrPayment', label: 'QR・コード決済' },
  { value: 'other', label: 'その他' },
];

export function MiscSection({ receipt, issues, dispatch }: { receipt: ReceiptInput; issues: ValidationIssue[]; dispatch: Dispatch<Action> }) {
  const patch = (p: Partial<ReceiptInput>) => dispatch({ type: 'patchReceipt', patch: p });
  return (
    <Section title="番号・支払方法・備考">
      <TextField
        label="領収書番号"
        value={receipt.receiptNumber}
        onChange={(v) => patch({ receiptNumber: v })}
        hint="空欄なら番号は印字されません。"
        placeholder="例：2026-001"
      />
      <Check
        label="支払方法を領収書に表示する"
        checked={receipt.showPaymentMethod}
        onChange={(v) => patch({ showPaymentMethod: v })}
      />
      <SelectField<PaymentMethod | ''>
        label="支払方法（印紙税の目安用）"
        value={receipt.paymentMethod ?? ''}
        onChange={(v) => patch({ paymentMethod: v || null })}
        options={PAYMENT_OPTIONS}
        hint="領収書に表示するかどうかとは別に、印紙税の目安に使います。"
      />
      {receipt.paymentMethod === 'creditCard' || receipt.paymentMethod === 'electronicMoney' || receipt.paymentMethod === 'qrPayment' ? (
        <p className="notice notice-info">{PAYMENT_STAMP_NOTE}</p>
      ) : null}
      <TextAreaField label="備考" value={receipt.remarks} onChange={(v) => patch({ remarks: v })} rows={2} maxLength={500} />
      <Check
        label="訂正書面として発行する"
        checked={receipt.correction != null}
        onChange={(on) => dispatch({
          type: 'setCorrection',
          correction: on ? { originalDate: '', originalNumber: '', changes: '' } : null,
        })}
        hint={CORRECTION_NOTE}
      />
      {receipt.correction ? (
        <>
          <DateField
            label="元の領収日"
            value={receipt.correction.originalDate}
            onChange={(v) => dispatch({ type: 'setCorrection', correction: { ...receipt.correction!, originalDate: v } })}
            issues={issuesFor(issues, 'correction.originalDate')}
          />
          <TextField
            label="元の領収書番号"
            value={receipt.correction.originalNumber}
            onChange={(v) => dispatch({ type: 'setCorrection', correction: { ...receipt.correction!, originalNumber: v } })}
            placeholder="例：2026-001"
            issues={issuesFor(issues, 'correction.originalNumber', 'correction.originalDate').filter((i) => i.code === 'correction.original.required')}
          />
          <TextAreaField
            label={receipt.mode === 'general' ? '訂正内容' : '訂正内容（必須）'}
            value={receipt.correction.changes}
            onChange={(v) => dispatch({ type: 'setCorrection', correction: { ...receipt.correction!, changes: v } })}
            hint="例：誤：10,000円 → 正：11,000円"
            rows={3}
            maxLength={1000}
            issues={issuesFor(issues, 'correction.changes')}
          />
        </>
      ) : null}
    </Section>
  );
}
