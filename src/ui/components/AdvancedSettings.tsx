import type { Dispatch } from 'react';
import type { DesignSettings, ReceiptInput, ValidationIssue } from '../../domain/types';
import { taxAmountShown as isTaxAmountShown, type Action } from '../state';
import { DatesSection } from './DatesSection';
import { DesignPanel } from './DesignPanel';
import { IssuerSection } from './IssuerSection';
import { MiscSection } from './MiscSection';
import { StampDutyPanel } from './StampDutyPanel';
import { TaxDetail } from './TaxDetail';

/** 詳細設定（折りたたみ。既定は閉）。 */
export function AdvancedSettings({
  receipt, design, issues, dispatch,
}: { receipt: ReceiptInput; design: DesignSettings; issues: ValidationIssue[]; dispatch: Dispatch<Action> }) {
  const taxAmountShown = isTaxAmountShown(receipt, design);
  return (
    <details className="card advanced">
      <summary>詳細設定（住所・日付・消費税・デザイン・角印・印紙税など）</summary>
      <div className="advanced-body">
        <IssuerSection receipt={receipt} issues={issues} dispatch={dispatch} />
        <DatesSection receipt={receipt} issues={issues} dispatch={dispatch} />
        <MiscSection receipt={receipt} issues={issues} dispatch={dispatch} />
        <TaxDetail receipt={receipt} dispatch={dispatch} />
        <DesignPanel receipt={receipt} design={design} dispatch={dispatch} />
        <StampDutyPanel receipt={receipt} taxAmountShown={taxAmountShown} dispatch={dispatch} />
      </div>
    </details>
  );
}
