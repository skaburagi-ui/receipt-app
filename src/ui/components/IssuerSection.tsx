import type { Dispatch } from 'react';
import type { IssuerInfo, ReceiptInput, ValidationIssue } from '../../domain/types';
import { normalizeRegistrationNumber, validateRegistrationNumber } from '../../domain/registration';
import type { Action } from '../state';
import { RadioGroup, Section, TextField, issuesFor } from './common';

export function IssuerSection({ receipt, issues, dispatch }: { receipt: ReceiptInput; issues: ValidationIssue[]; dispatch: Dispatch<Action> }) {
  const issuer = receipt.issuer;
  const patch = (p: Partial<IssuerInfo>) => dispatch({ type: 'patchIssuer', patch: p });
  const qualified = receipt.mode !== 'general';
  const norm = qualified ? normalizeRegistrationNumber(issuer.registrationNumber) : null;
  const regIssues: ValidationIssue[] = qualified
    ? [...issuesFor(issues, 'issuer.registrationNumber'), ...validateRegistrationNumber(issuer.registrationNumber).filter((i) => !issues.some((x) => x.code === i.code))]
    : [];
  return (
    <Section title="発行者（あなたの情報）">
      <div className="row">
        <TextField label="郵便番号" value={issuer.postalCode} onChange={(v) => patch({ postalCode: v })} autoComplete="postal-code" inputMode="numeric" placeholder="100-0001" />
        <TextField className="grow" label="電話番号" value={issuer.phone} onChange={(v) => patch({ phone: v })} autoComplete="tel" inputMode="tel" placeholder="03-1234-5678" />
      </div>
      <TextField label="住所" value={issuer.address} onChange={(v) => patch({ address: v })} autoComplete="street-address" placeholder="東京都千代田区…" />
      {qualified ? (
        <TextField
          label="インボイス登録番号"
          value={issuer.registrationNumber}
          onChange={(v) => patch({ registrationNumber: v })}
          onBlur={() => {
            if (norm?.normalized && norm.normalized !== issuer.registrationNumber) patch({ registrationNumber: norm.normalized });
          }}
          placeholder="T1234567890123"
          autoComplete="off"
          spellCheck={false}
          hint={
            norm?.normalized
              ? <>印字される番号：<strong>{norm.normalized}</strong>（全角・ハイフンは自動で直します。あなた自身の番号を入力してください）</>
              : 'T＋数字13桁。全角やハイフンが入っていても自動で直します。あなた自身の番号を入力してください。'
          }
          issues={regIssues}
        />
      ) : null}
      <RadioGroup<IssuerInfo['taxpayerType']>
        inline
        legend="消費税の課税事業者ですか？"
        name="taxpayer"
        value={issuer.taxpayerType}
        onChange={(v) => patch({ taxpayerType: v })}
        options={[
          { value: 'taxable', label: '課税事業者' },
          { value: 'exempt', label: '免税事業者' },
          { value: 'unknown', label: 'わからない' },
        ]}
      />
      <p className="hint">印紙税の目安の計算に使います。</p>
      <RadioGroup<IssuerInfo['businessNature']>
        inline
        legend="営業に関する受取ですか？（事業としての売上の受取か）"
        name="business"
        value={issuer.businessNature}
        onChange={(v) => patch({ businessNature: v })}
        options={[
          { value: 'business', label: 'はい' },
          { value: 'nonBusiness', label: 'いいえ' },
          { value: 'unknown', label: 'わからない' },
        ]}
      />
    </Section>
  );
}
