import type { Dispatch } from 'react';
import type { ReceiptInput, StampDutyGuidance } from '../../domain/types';
import { guideStampDuty } from '../../domain/stamp';
import { attempt } from '../safe';
import type { Action } from '../state';
import { RadioGroup, Section, formatYen } from './common';

function headline(g: StampDutyGuidance): string {
  switch (g.level) {
    case 'none': return '【目安】印紙税は課税されない可能性があります。';
    case 'estimate': return `【目安】入力された内容では、${g.amountYen !== null ? formatYen(g.amountYen) : ''}の収入印紙が必要となる可能性があります。`;
    case 'possible': return '【目安】印紙税の課税対象になる可能性があります。金額は自動では確定できません。';
    case 'unknown': return '【目安】印紙税は、自動では判断できません。';
  }
}

export function StampDutyPanel({
  receipt, taxAmountShown, dispatch,
}: { receipt: ReceiptInput; taxAmountShown: boolean; dispatch: Dispatch<Action> }) {
  const r = attempt(() => guideStampDuty(receipt, { taxAmountShown }));
  return (
    <Section title="印紙税の目安" note="5万円以上の受取書は、収入印紙が必要になることがあります。ここは目安であり、判断を保証するものではありません。">
      <RadioGroup<'paper' | 'electronic'>
        inline
        legend="領収書の渡し方"
        name="delivery"
        value={receipt.delivery}
        onChange={(v) => dispatch({ type: 'patchReceipt', patch: { delivery: v } })}
        options={[
          { value: 'paper', label: '紙に印刷して渡す' },
          { value: 'electronic', label: 'PDFなどの電子データで渡す' },
        ]}
      />
      <RadioGroup<'sales' | 'other'>
        inline
        legend="この受取は、商品・サービスの代金（売上代金）ですか？"
        name="sales"
        value={receipt.isSalesProceeds ? 'sales' : 'other'}
        onChange={(v) => dispatch({ type: 'patchReceipt', patch: { isSalesProceeds: v === 'sales' } })}
        options={[
          { value: 'sales', label: 'はい（売上代金）' },
          { value: 'other', label: 'いいえ（借入金・保険金など）' },
        ]}
      />
      {r.ok ? (
        <div className={`stamp-guide stamp-${r.value.level}`} aria-live="polite">
          <p className="stamp-headline"><strong>{headline(r.value)}</strong></p>
          <h4>この目安の前提</h4>
          <ul>{r.value.premises.map((p) => <li key={p}>{p}</li>)}</ul>
          <h4>理由・注意</h4>
          <ul>{r.value.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <h4>根拠</h4>
          <ul>
            {r.value.sources.map((s) => (
              <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer">{s.label}</a>（確認日：{s.checkedAt}）</li>
            ))}
          </ul>
          <p className="hint">税額表の施行日：{r.value.tableVersion.effectiveFrom}／最終確認日：{r.value.tableVersion.checkedAt}。収入印紙の購入・貼付・消印は、ご自身で行います。</p>
        </div>
      ) : (
        <p className="notice notice-info">印紙税の目安を表示できませんでした。</p>
      )}
    </Section>
  );
}
