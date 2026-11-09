import type { Dispatch } from 'react';
import type { LineItem, ReceiptInput, RoundingMode, TaxCategory } from '../../domain/types';
import { calculateTax } from '../../domain/tax';
import type { Action } from '../state';
import { AmountInput, RadioGroup, Section, SelectField, TextField, formatYen } from './common';

const CATEGORY_OPTIONS: { value: TaxCategory; label: string }[] = [
  { value: 'taxable10', label: '課税 10%' },
  { value: 'taxable8', label: '課税 8%（軽減税率）' },
  { value: 'exempt', label: '非課税' },
  { value: 'outOfScope', label: '不課税' },
  { value: 'taxFree', label: '免税' },
];

const ROUNDING_OPTIONS: { value: RoundingMode; label: string }[] = [
  { value: 'floor', label: '切り捨て（ふつう）' },
  { value: 'round', label: '四捨五入' },
  { value: 'ceil', label: '切り上げ' },
];

const CATEGORY_NOTE =
  '非課税（例：土地の貸付、保険料）・不課税（例：寄付金、給与）・免税（輸出など）の金額は、税率ごとの合計には入りません。';

export function TaxDetail({ receipt, dispatch }: { receipt: ReceiptInput; dispatch: Dispatch<Action> }) {
  const items = receipt.tax.items;
  const breakdown = calculateTax(receipt.tax);
  const setItems = (next: LineItem[]) => dispatch({ type: 'setItems', items: next });
  const update = (i: number, patch: Partial<LineItem>) => setItems(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const incl = receipt.tax.inputMode === 'inclusive';
  return (
    <Section title="消費税の詳細入力" note="品目ごとに税率を分けたいときに使います。ふつうは、上の「領収金額」だけで足ります。">
      <ol className="items-list">
        {items.map((it, i) => (
          <li key={i} className="item-row">
            <TextField label={`品目 ${i + 1}`} value={it.description} onChange={(v) => update(i, { description: v })} placeholder="例：お弁当" />
            <AmountInput label={`金額 ${i + 1}（${incl ? '税込' : '税抜'}）`} value={it.amountYen} onChange={(v) => update(i, { amountYen: v })} />
            <SelectField<TaxCategory> label={`税区分 ${i + 1}`} value={it.category} onChange={(v) => update(i, { category: v })} options={CATEGORY_OPTIONS} />
            <button
              type="button"
              className="btn btn-small"
              disabled={items.length <= 1}
              onClick={() => setItems(items.filter((_, idx) => idx !== i))}
              aria-label={`品目 ${i + 1} を削除`}
            >削除</button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn"
        disabled={items.length >= 30}
        onClick={() => setItems([...items, { description: '', amountYen: 0, category: items[items.length - 1]?.category ?? 'taxable10' }])}
      >＋ 品目を追加</button>
      <p className="hint">{CATEGORY_NOTE}</p>
      <p className="hint">マイナスの金額（値引き・返品）は入力できません。この画面では未対応です。</p>

      <RadioGroup<'inclusive' | 'exclusive'>
        inline
        legend="入力する金額は"
        name="input-mode-detail"
        value={receipt.tax.inputMode}
        onChange={(v) => dispatch({ type: 'patchTax', patch: { inputMode: v } })}
        options={[
          { value: 'inclusive', label: '税込' },
          { value: 'exclusive', label: '税抜' },
        ]}
      />
      <SelectField<RoundingMode>
        label="消費税の端数の処理"
        value={receipt.tax.rounding}
        onChange={(v) => dispatch({ type: 'patchTax', patch: { rounding: v } })}
        options={ROUNDING_OPTIONS}
        hint="書類1枚につき、税率ごとに1回だけ端数を処理します。"
      />

      <table className="tax-table">
        <caption>税率ごとの内訳</caption>
        <thead>
          <tr><th scope="col">税率</th><th scope="col">税抜金額</th><th scope="col">消費税額</th><th scope="col">税込金額</th></tr>
        </thead>
        <tbody>
          {breakdown.byRate.map((b) => (
            <tr key={b.rate}>
              <th scope="row">{b.rate}%{b.rate === 8 ? '（軽減）' : ''}</th>
              <td>{formatYen(b.baseExclusiveYen)}</td>
              <td>{formatYen(b.taxYen)}</td>
              <td>{formatYen(b.inclusiveYen)}</td>
            </tr>
          ))}
          {breakdown.nonTaxableYen > 0 ? (
            <tr><th scope="row">税の対象外</th><td colSpan={3}>{formatYen(breakdown.nonTaxableYen)}</td></tr>
          ) : null}
        </tbody>
        <tfoot>
          <tr><th scope="row">領収金額（税込）</th><td colSpan={2}>消費税額の合計 {formatYen(breakdown.totalTaxYen)}</td><td><strong>{formatYen(breakdown.grandTotalYen)}</strong></td></tr>
        </tfoot>
      </table>
    </Section>
  );
}
