import { useState } from 'react';
import type { Dispatch } from 'react';
import type { DesignSettings } from '../../domain/types';
import type { PreviewState } from '../hooks';
import { FORMAT_INFO } from '../defaults';
import type { Action } from '../state';
import { SelectField } from './common';
import type { PrintFormat } from '../../domain/types';

/** プレビューを作った結果の警告（枠に入りきらない・フォントに無い文字）。スマホの入力タブにも同じものを出す。 */
export function RenderWarnings({ state, missingGlyphs, className }: { state: PreviewState; missingGlyphs: string[]; className?: string }) {
  return (
    <div className={className} aria-live="polite">
      {state.status === 'ok' && state.overflow ? (
        <p className="issue issue-error" role="alert">
          <span className="issue-tag">エラー</span>
          <span>内容が枠に入りきりません。品目の数や文字数を減らすか、備考を短くしてください。このままでは、PDFを作れません。</span>
        </p>
      ) : null}
      {missingGlyphs.length > 0 ? (
        <p className="issue issue-warning" role="alert">
          <span className="issue-tag">注意</span>
          <span>次の文字は、領収書の書体に無いため、四角く表示される可能性があります：{missingGlyphs.join(' ')}　別の文字に置きかえてください。</span>
        </p>
      ) : null}
    </div>
  );
}

export function Preview({
  state, missingGlyphs, design, dispatch,
}: { state: PreviewState; missingGlyphs: string[]; design: DesignSettings; dispatch: Dispatch<Action> }) {
  const format = FORMAT_INFO.find((f) => f.id === design.format);
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="preview" aria-label="領収書のプレビュー">
      <div className="preview-controls">
        <SelectField<PrintFormat>
          label="印刷の形式"
          value={design.format}
          onChange={(v) => dispatch({ type: 'patchDesign', patch: { format: v } })}
          options={FORMAT_INFO.map((f) => ({ value: f.id, label: f.label }))}
        />
        <button type="button" className="btn" aria-pressed={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? '全体を表示' : '拡大して確認'}
        </button>
      </div>
      {format ? <p className="hint preview-format-hint">{format.desc}</p> : null}
      <RenderWarnings state={state} missingGlyphs={missingGlyphs} className="preview-banners" />
      <div className={`preview-sheet${expanded ? ' preview-expanded' : ''}`}>
        {state.status === 'ok' ? (
          <div
            className="receipt-svg"
            style={{ aspectRatio: `${state.widthMm} / ${state.heightMm}` }}
            dangerouslySetInnerHTML={{ __html: state.svg }}
          />
        ) : state.status === 'loading' ? (
          <p className="preview-placeholder" role="status">プレビューを準備しています…</p>
        ) : (
          <p className="preview-placeholder" role="alert">プレビューを作れませんでした。入力内容を見直してください。（{state.message}）</p>
        )}
      </div>
      {state.status === 'ok' && state.pageCount > 1 ? <p className="hint">1ページ目を表示しています（全{state.pageCount}ページ）。</p> : null}
    </div>
  );
}
