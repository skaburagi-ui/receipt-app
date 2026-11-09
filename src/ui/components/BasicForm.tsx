import type { Dispatch } from 'react';
import type { TaxCategory, ValidationIssue, ReceiptInput } from '../../domain/types';
import { calculateTax } from '../../domain/tax';
import type { Action } from '../state';
import { AmountInput, DateField, FieldShell, RadioGroup, SelectField, TextField, formatYen, issuesFor } from './common';

const HONORIFICS = [
  { value: '様', label: '様' },
  { value: '御中', label: '御中' },
  { value: '殿', label: '殿' },
  { value: '', label: '（なし）' },
];

/** シンプル入力で扱える状態か（明細1件・税率10%か8%）。 */
export function isSimpleItems(receipt: ReceiptInput): boolean {
  const items = receipt.tax.items;
  return items.length === 1 && (items[0].category === 'taxable10' || items[0].category === 'taxable8');
}

export function BasicForm({ receipt, issues, dispatch }: { receipt: ReceiptInput; issues: ValidationIssue[]; dispatch: Dispatch<Action> }) {
  const simple = isSimpleItems(receipt);
  const item = receipt.tax.items[0];
  const total = calculateTax(receipt.tax).grandTotalYen;
  const setItem = (patch: Partial<typeof item>) => dispatch({ type: 'setItems', items: [{ ...item, ...patch }] });
  return (
    <section className="card basic-form" aria-labelledby="basic-title">
      <h2 id="basic-title">領収書の内容</h2>
      <TextField
        label="発行者（あなたの名前・会社名）"
        value={receipt.issuer.name}
        onChange={(v) => dispatch({ type: 'patchIssuer', patch: { name: v } })}
        autoComplete="organization"
        placeholder="例：山田商店"
        issues={issuesFor(issues, 'issuer.name')}
      />
      <div className="row">
        <TextField
          className="grow"
          label="宛名（領収書を受け取る人・会社）"
          value={receipt.recipient.name}
          onChange={(v) => dispatch({ type: 'setRecipient', patch: { name: v } })}
          placeholder="例：株式会社サンプル"
          issues={issuesFor(issues, 'recipient.name', 'recipient')}
        />
        <SelectField
          label="敬称"
          value={receipt.recipient.honorific}
          onChange={(v) => dispatch({ type: 'setRecipient', patch: { honorific: v } })}
          options={HONORIFICS}
        />
      </div>

      {simple ? (
        <>
          <div className="row">
            <AmountInput
              label={receipt.tax.inputMode === 'exclusive' ? '税抜金額' : '領収金額'}
              value={item.amountYen}
              onChange={(v) => setItem({ amountYen: v })}
              issues={issuesFor(issues, 'tax.items')}
              hint={receipt.tax.inputMode === 'exclusive' ? `領収金額（税込）は ${formatYen(total)} です。` : undefined}
            />
            <SelectField<TaxCategory>
              label="税率"
              value={item.category}
              onChange={(v) => setItem({ category: v })}
              options={[
                { value: 'taxable10', label: '10%' },
                { value: 'taxable8', label: '8%（軽減税率）' },
              ]}
            />
          </div>
          <RadioGroup<'inclusive' | 'exclusive'>
            inline
            legend="入力する金額は"
            name="input-mode"
            value={receipt.tax.inputMode}
            onChange={(v) => dispatch({ type: 'patchTax', patch: { inputMode: v } })}
            options={[
              { value: 'inclusive', label: '税込（消費税を含む）' },
              { value: 'exclusive', label: '税抜（消費税は別）' },
            ]}
          />
          <p className="hint">複数の品目や、税率の違う品目は、下の「詳細設定」の「消費税の詳細入力」で入力できます。</p>
        </>
      ) : (
        <FieldShell label="領収金額" issues={issuesFor(issues, 'tax.items')}>
          {() => (
            <p className="static-value">
              <strong>{formatYen(total)}</strong>（税込）<br />
              <span className="hint">「消費税の詳細入力」で、複数の品目を入力しています。</span>
            </p>
          )}
        </FieldShell>
      )}

      <TextField
        label="但し書き"
        value={receipt.proviso}
        onChange={(v) => dispatch({ type: 'patchReceipt', patch: { proviso: v } })}
        placeholder="例：お食事代として／コンサルティング料として"
        hint="何の代金かを具体的に書きます。「お品代として」だけでは足りない場合があります。"
        issues={issuesFor(issues, 'proviso')}
      />
      <DateField
        label="領収日"
        value={receipt.receiptDate}
        onChange={(v) => dispatch({ type: 'setReceiptDate', date: v })}
        issues={issuesFor(issues, 'receiptDate')}
      />
    </section>
  );
}
