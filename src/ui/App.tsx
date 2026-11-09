import { useMemo, useReducer, useState } from 'react';
import type { ValidationIssue } from '../domain/types';
import { AdvancedSettings } from './components/AdvancedSettings';
import { BasicForm } from './components/BasicForm';
import { BulkDialog } from './components/BulkDialog';
import { DraftPanel } from './components/DraftPanel';
import { Footer } from './components/Footer';
import { IssueList } from './components/common';
import { ModeSelector } from './components/ModeSelector';
import { OutputBar } from './components/OutputBar';
import { Preview, RenderWarnings } from './components/Preview';
import { useFonts, useMissingGlyphs, usePreview } from './hooks';
import { createInitialState, effectiveReceipt, reducer } from './state';
import { validateForUi } from './validation';

export function App() {
  const [state, dispatch] = useReducer(reducer, undefined, () => createInitialState());
  const [bulkOpen, setBulkOpen] = useState(false);
  const { receipt, design, tab } = state;

  const eff = useMemo(() => effectiveReceipt(receipt), [receipt]);
  const issues = useMemo<ValidationIssue[]>(() => validateForUi(eff), [eff]);

  const fontsReady = useFonts();
  const preview = usePreview(receipt, design, fontsReady);
  const missing = useMissingGlyphs(eff, design, fontsReady);

  const errors = issues.filter((i) => i.level === 'error');
  const others = issues.filter((i) => i.level !== 'error');

  return (
    <div className={`app tab-${tab}`}>
      <header className="site-header">
        <h1>かんたん領収書</h1>
        <p className="tagline">会員登録なし・入力内容は送信されません</p>
        <button type="button" className="btn" onClick={() => setBulkOpen(true)}>まとめて発行</button>
      </header>

      <div className="tabs" role="tablist" aria-label="表示の切り替え">
        <button type="button" role="tab" id="tab-input" aria-selected={tab === 'input'} aria-controls="pane-input" onClick={() => dispatch({ type: 'setTab', tab: 'input' })}>入力</button>
        <button type="button" role="tab" id="tab-preview" aria-selected={tab === 'preview'} aria-controls="pane-preview" onClick={() => dispatch({ type: 'setTab', tab: 'preview' })}>プレビュー</button>
      </div>

      <main className="layout">
        <div className="pane pane-input" id="pane-input" role="tabpanel" aria-labelledby="tab-input">
          {issues.length > 0 ? (
            <section className="card summary" aria-label="入力のチェック結果">
              <h2>入力のチェック</h2>
              {errors.length > 0 ? <p className="summary-lead">直してほしい点が{errors.length}件あります。</p> : <p className="summary-lead ok">必要な項目は入力できています。</p>}
              <IssueList issues={[...errors, ...others]} />
            </section>
          ) : null}
          {/* スマホでは「入力」タブにいるとプレビューが見えないので、プレビューの警告をここにも出す（PCでは非表示） */}
          <RenderWarnings state={preview} missingGlyphs={missing} className="narrow-only" />
          <ModeSelector
            mode={receipt.mode}
            confirmations={receipt.confirmations}
            showNotInvoiceNotice={design.showNotInvoiceNotice}
            showGeneralTaxReference={design.showGeneralTaxReference}
            onMode={(mode) => dispatch({ type: 'setMode', mode })}
            onConfirm={(patch) => dispatch({ type: 'patchConfirmations', patch })}
            onDesign={(patch) => dispatch({ type: 'patchDesign', patch })}
          />
          <BasicForm receipt={receipt} issues={issues} dispatch={dispatch} />
          <AdvancedSettings receipt={receipt} design={design} issues={issues} dispatch={dispatch} />
          <DraftPanel receipt={receipt} design={design} dispatch={dispatch} />
        </div>
        <div className="pane pane-preview" id="pane-preview" role="tabpanel" aria-labelledby="tab-preview">
          <Preview state={preview} missingGlyphs={missing} design={design} dispatch={dispatch} />
        </div>
      </main>

      <OutputBar
        receipt={eff}
        design={design}
        issues={issues}
        preview={preview}
        onSwitchToGeneral={() => dispatch({ type: 'setMode', mode: 'general' })}
      />
      <Footer />
      {bulkOpen ? <BulkDialog base={eff} design={design} dispatch={dispatch} onClose={() => setBulkOpen(false)} /> : null}
    </div>
  );
}
