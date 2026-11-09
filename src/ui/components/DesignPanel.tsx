import { useState, type Dispatch } from 'react';
import type { DesignId, DesignSettings, PrintFormat, ReceiptInput } from '../../domain/types';
import { processUploadedImage } from '../../image/process';
import { DESIGN_INFO, FORMAT_INFO, THEME_COLORS } from '../defaults';
import { attemptAsync } from '../safe';
import type { Action } from '../state';
import { Check, RadioGroup, Section, TextField } from './common';
import { SealEditor, Slider } from './SealEditor';
import { SettingsGroup } from './SettingsGroup';

export function FormatRadio({ design, dispatch, name = 'format' }: { design: DesignSettings; dispatch: Dispatch<Action>; name?: string }) {
  return (
    <RadioGroup<PrintFormat>
      legend="印刷の形式"
      name={name}
      value={design.format}
      onChange={(v) => dispatch({ type: 'patchDesign', patch: { format: v } })}
      options={FORMAT_INFO.map((f) => ({ value: f.id, label: f.label, desc: f.desc }))}
    />
  );
}

function LogoEditor({ design, dispatch }: { design: DesignSettings; dispatch: Dispatch<Action> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="logo-editor">
      <div className="field">
        <label htmlFor="logo-file">ロゴ画像（PNG・JPEG）</label>
        <input
          id="logo-file"
          type="file"
          accept="image/png,image/jpeg"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setBusy(true);
            setError(null);
            const r = await attemptAsync(() => processUploadedImage(f, 'logo'));
            setBusy(false);
            if (r.ok) dispatch({ type: 'patchDesign', patch: { logo: r.value } });
            else setError(r.message);
          }}
        />
      </div>
      {busy ? <p role="status">画像を処理しています…</p> : null}
      {error ? <p className="issue issue-error" role="alert"><span className="issue-tag">エラー</span><span>{error}</span></p> : null}
      {design.logo ? (
        <>
          <div className="image-preview">
            <img src={design.logo.dataUrl} alt="ロゴ" />
            <button type="button" className="btn btn-small" onClick={() => dispatch({ type: 'patchDesign', patch: { logo: null } })}>ロゴを外す</button>
          </div>
          <Slider label="ロゴの幅" value={design.logoWidthMm} min={10} max={60} onChange={(v) => dispatch({ type: 'patchDesign', patch: { logoWidthMm: v } })} />
        </>
      ) : null}
    </div>
  );
}

export function DesignPanel({ receipt, design, dispatch }: { receipt: ReceiptInput; design: DesignSettings; dispatch: Dispatch<Action> }) {
  const patch = (p: Partial<DesignSettings>) => dispatch({ type: 'patchDesign', patch: p });
  return (
    <>
      <SettingsGroup title="デザイン・色"><Section title="デザイン">
        <RadioGroup<DesignId>
          inline
          legend="デザイン"
          name="design"
          value={design.design}
          onChange={(v) => patch({ design: v })}
          options={DESIGN_INFO.map((d) => ({ value: d.id, label: d.label, desc: d.desc }))}
        />
        <fieldset className="radio-group inline">
          <legend>テーマカラー</legend>
          <div className="swatches">
            {THEME_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`swatch ${design.themeColor.toLowerCase() === c.value.toLowerCase() ? 'selected' : ''}`}
                style={{ background: c.value }}
                aria-pressed={design.themeColor.toLowerCase() === c.value.toLowerCase()}
                aria-label={`テーマカラー：${c.name}`}
                onClick={() => patch({ themeColor: c.value })}
              >
                {design.themeColor.toLowerCase() === c.value.toLowerCase() ? '✓' : ''}
              </button>
            ))}
            <label className="swatch-custom">
              その他の色
              <input type="color" value={design.themeColor} onChange={(e) => patch({ themeColor: e.target.value.toUpperCase() })} />
            </label>
          </div>
        </fieldset>
      </Section></SettingsGroup>

      <SettingsGroup title="印刷の形式"><Section title="印刷の形式">
        <FormatRadio design={design} dispatch={dispatch} name="format-adv" />
        <Check
          label="切り取り用のガイド線を表示する"
          checked={design.showCutGuide}
          onChange={(v) => patch({ showCutGuide: v })}
        />
        <Check
          label="収入印紙を貼る欄を表示する"
          checked={design.showRevenueStampBox}
          onChange={(v) => patch({ showRevenueStampBox: v })}
          hint="領収書（正本）にだけ表示します。控えには出ません。"
        />
        {design.format === 'a4-with-copy' ? (
          <div className="copy-info">
            <h4>控えに載せる情報（自分用）</h4>
            <p className="hint">控えにだけ印字されます。</p>
            <TextField label="発行担当" value={receipt.copyInfo.issuedBy} onChange={(v) => dispatch({ type: 'patchCopyInfo', patch: { issuedBy: v } })} />
            <TextField label="入金方法" value={receipt.copyInfo.paymentChannel} onChange={(v) => dispatch({ type: 'patchCopyInfo', patch: { paymentChannel: v } })} />
            <TextField label="管理用の備考" value={receipt.copyInfo.internalNote} onChange={(v) => dispatch({ type: 'patchCopyInfo', patch: { internalNote: v } })} />
          </div>
        ) : null}
      </Section></SettingsGroup>

      <SettingsGroup title="ロゴ"><Section title="ロゴ">
        <LogoEditor design={design} dispatch={dispatch} />
      </Section></SettingsGroup>

      <SettingsGroup title="角印"><Section title="角印">
        <SealEditor design={design} dispatch={dispatch} />
      </Section></SettingsGroup>
    </>
  );
}
