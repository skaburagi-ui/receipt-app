import type { Dispatch } from 'react';
import type { DesignSettings, ReceiptInput, ValidationIssue } from '../../domain/types';
import { taxAmountShown as isTaxAmountShown, type Action } from '../state';
import { DatesSection } from './DatesSection';
import { DesignPanel } from './DesignPanel';
import { IssuerSection } from './IssuerSection';
import { MiscSection } from './MiscSection';
import { SettingsGroup } from './SettingsGroup';
import { StampDutyPanel } from './StampDutyPanel';
import { TaxDetail } from './TaxDetail';

/** 詳細設定（折りたたみ。既定は閉）。 */
export function AdvancedSettings({
  receipt, design, issues, dispatch,
}: { receipt: ReceiptInput; design: DesignSettings; issues: ValidationIssue[]; dispatch: Dispatch<Action> }) {
  const taxAmountShown = isTaxAmountShown(receipt, design);
  const countErrors = (...fields: string[]) => issues.filter((i) => i.level === 'error' && fields.some((f) => i.field === f || i.field?.startsWith(`${f}.`))).length;
  const advancedErrorCount = countErrors('issuer.registrationNumber', 'transactionDate', 'issueDate', 'correction', 'tax.items');
  return (
    <details className="card advanced">
      <summary>詳細設定 <span className="advanced-summary-hint">住所・日付・税・デザイン・角印など</span>{advancedErrorCount > 0 ? <span className="settings-error-count">要確認 {advancedErrorCount}件</span> : null}</summary>
      <div className="advanced-body">
        <SettingsGroup title="発行者の追加情報" errorCount={countErrors('issuer.registrationNumber')}><IssuerSection receipt={receipt} issues={issues} dispatch={dispatch} /></SettingsGroup>
        <SettingsGroup title="日付" errorCount={countErrors('transactionDate', 'issueDate')}><DatesSection receipt={receipt} issues={issues} dispatch={dispatch} /></SettingsGroup>
        <SettingsGroup title="番号・支払方法・訂正" errorCount={countErrors('correction')}><MiscSection receipt={receipt} issues={issues} dispatch={dispatch} /></SettingsGroup>
        <SettingsGroup title="消費税の詳細入力" errorCount={countErrors('tax.items')}><TaxDetail receipt={receipt} dispatch={dispatch} /></SettingsGroup>
        <DesignPanel receipt={receipt} design={design} dispatch={dispatch} />
        <SettingsGroup title="印紙税の目安"><StampDutyPanel receipt={receipt} taxAmountShown={taxAmountShown} dispatch={dispatch} /></SettingsGroup>
      </div>
    </details>
  );
}
