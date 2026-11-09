import type { ReceiptMode } from '../../domain/types';
import { QUALIFIED_CONFIRM, QUALIFIED_NOTICE, SIMPLE_CONFIRM, SIMPLE_NOTICE } from '../copy';
import { Check, RadioGroup } from './common';

interface Props {
  mode: ReceiptMode;
  confirmations: { ownRegistrationNumber: boolean; simpleInvoiceEligibleBusiness: boolean };
  showNotInvoiceNotice: boolean;
  showGeneralTaxReference: boolean;
  onMode: (m: ReceiptMode) => void;
  onConfirm: (patch: Partial<{ ownRegistrationNumber: boolean; simpleInvoiceEligibleBusiness: boolean }>) => void;
  onDesign: (patch: { showNotInvoiceNotice?: boolean; showGeneralTaxReference?: boolean }) => void;
}

/** 質問形式のモード選択。general / qualified / qualifiedSimple のどれかを返す。 */
export function ModeSelector({ mode, confirmations, showNotInvoiceNotice, showGeneralTaxReference, onMode, onConfirm, onDesign }: Props) {
  const hasInvoice = mode !== 'general';
  return (
    <section className="card mode-selector" aria-labelledby="mode-title">
      <h2 id="mode-title">どんな領収書を作りますか？</h2>
      <RadioGroup<'no' | 'yes'>
        legend="インボイス（適格請求書）の登録番号をお持ちですか？"
        name="has-invoice"
        value={hasInvoice ? 'yes' : 'no'}
        onChange={(v) => onMode(v === 'no' ? 'general' : mode === 'general' ? 'qualified' : mode)}
        options={[
          { value: 'no', label: 'いいえ（ふつうの領収書）', desc: '登録番号を持っていない方、よくわからない方はこちら。' },
          { value: 'yes', label: 'はい', desc: 'T＋13桁の登録番号を持っている方。' },
        ]}
      />
      {hasInvoice ? (
        <>
          <RadioGroup<'yes' | 'no'>
            legend="不特定多数のお客様に対する、小売・飲食・タクシー等の事業ですか？"
            name="is-retail"
            value={mode === 'qualifiedSimple' ? 'yes' : 'no'}
            onChange={(v) => onMode(v === 'yes' ? 'qualifiedSimple' : 'qualified')}
            options={[
              { value: 'yes', label: 'はい（簡易インボイス＝適格簡易請求書）', desc: '宛名は書かなくてもかまいません（「上様」も可）。' },
              { value: 'no', label: 'いいえ（インボイス＝適格請求書）', desc: '宛名・税率ごとの金額・税額など、決められた項目がすべて必要です。' },
            ]}
          />
          <div className="notice notice-info">
            <p>{QUALIFIED_NOTICE}</p>
            {mode === 'qualifiedSimple' ? <p>{SIMPLE_NOTICE}</p> : null}
          </div>
          <Check
            label={QUALIFIED_CONFIRM}
            checked={confirmations.ownRegistrationNumber}
            onChange={(v) => onConfirm({ ownRegistrationNumber: v })}
          />
          {mode === 'qualifiedSimple' ? (
            <Check
              label={SIMPLE_CONFIRM}
              checked={confirmations.simpleInvoiceEligibleBusiness}
              onChange={(v) => onConfirm({ simpleInvoiceEligibleBusiness: v })}
            />
          ) : null}
          <p className="hint">登録番号などは、下の「詳細設定」の「発行者」に入力します。</p>
        </>
      ) : (
        <div className="general-toggles">
          <Check
            label="「この領収書は適格請求書（インボイス）ではありません」と小さく表示する"
            checked={showNotInvoiceNotice}
            onChange={(v) => onDesign({ showNotInvoiceNotice: v })}
          />
          <Check
            label="税率ごとの金額と消費税額を、参考として表示する"
            checked={showGeneralTaxReference}
            onChange={(v) => onDesign({ showGeneralTaxReference: v })}
            hint="ふつうの領収書では参考表示です。登録番号は印字されません。"
          />
        </div>
      )}
    </section>
  );
}
