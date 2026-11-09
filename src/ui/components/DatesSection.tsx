import type { Dispatch } from 'react';
import type { ReceiptInput, ValidationIssue } from '../../domain/types';
import type { Action } from '../state';
import { DateField, Section, issuesFor } from './common';

export function DatesSection({ receipt, issues, dispatch }: { receipt: ReceiptInput; issues: ValidationIssue[]; dispatch: Dispatch<Action> }) {
  const qualified = receipt.mode !== 'general';
  return (
    <Section title="日付">
      <DateField
        label="発行日"
        value={receipt.issueDate ?? receipt.receiptDate}
        onChange={(v) => dispatch({ type: 'patchReceipt', patch: { issueDate: v === receipt.receiptDate ? null : v } })}
        hint={receipt.issueDate === null ? '領収日と同じです。' : '領収日と別の日付にしています。'}
        issues={issuesFor(issues, 'issueDate')}
      />
      {receipt.issueDate !== null ? (
        <button type="button" className="btn-link" onClick={() => dispatch({ type: 'patchReceipt', patch: { issueDate: null } })}>発行日を領収日と同じに戻す</button>
      ) : null}
      <DateField
        label="取引日（商品やサービスを提供した日）"
        value={receipt.transactionDate}
        onChange={(v) => dispatch({ type: 'setTransactionDate', date: v })}
        hint={
          qualified
            ? '取引日が、インボイス上の日付になります。領収日と違う場合は、取引日を正しく入力してください。'
            : receipt.transactionDateEdited ? '個別に変更しています。' : '領収日を変えると、ここも同じ日付になります。'
        }
        issues={issuesFor(issues, 'transactionDate')}
      />
      {receipt.transactionDateEdited ? (
        <button type="button" className="btn-link" onClick={() => dispatch({ type: 'patchReceipt', patch: { transactionDate: receipt.receiptDate, transactionDateEdited: false } })}>取引日を領収日に合わせる</button>
      ) : null}
    </Section>
  );
}
