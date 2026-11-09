import { useId, useRef, useState, type Dispatch } from 'react';
import type { DesignSettings, SealSpec } from '../../domain/types';
import { processUploadedImage } from '../../image/process';
import { findUnsupportedChars, sealToSvg } from '../../seal/seal';
import { createDefaultSealSpec } from '../defaults';
import { sanitizeSvg, attempt, attemptAsync } from '../safe';
import type { Action } from '../state';
import { Check, SelectField, TextField } from './common';

type Source = 'image' | 'make';

const LAYOUTS: { value: SealSpec['layout']; label: string }[] = [
  { value: 'auto', label: 'おまかせ' },
  { value: 'v1x2', label: '縦1列×2字' },
  { value: 'v2x2', label: '2列×2行（4字）' },
  { value: 'v2x3', label: '2列×3行（6字）' },
  { value: 'v3x3', label: '3列×3行' },
];
const FRAMES: { value: SealSpec['frame']; label: string }[] = [
  { value: 'single', label: '一重の枠' },
  { value: 'double', label: '二重の枠' },
  { value: 'none', label: '枠なし' },
];

export function Slider({
  label, value, min, max, step = 1, unit = 'mm', onChange,
}: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="field slider">
      <label htmlFor={id}>{label}：{value}{unit}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function SealEditor({ design, dispatch }: { design: DesignSettings; dispatch: Dispatch<Action> }) {
  const patch = (p: Partial<DesignSettings>) => dispatch({ type: 'patchDesign', patch: p });
  const [source, setSource] = useState<Source>(design.sealImage ? 'image' : 'make');
  const [removeBg, setRemoveBg] = useState(true);
  const [threshold, setThreshold] = useState(200);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastFile = useRef<File | null>(null);
  const spec = design.sealSpec;

  const process = async (file: File, remove: boolean, th: number) => {
    setBusy(true);
    setError(null);
    const r = await attemptAsync(() => processUploadedImage(file, 'seal', { removeWhiteBackground: remove, threshold: th }));
    setBusy(false);
    if (r.ok) patch({ sealImage: r.value, sealSpec: null, showSeal: true });
    else setError(r.message);
  };

  const chooseSource = (s: Source) => {
    setSource(s);
    if (s === 'make') patch({ sealImage: null, sealSpec: spec ?? createDefaultSealSpec('') });
    else patch({ sealSpec: null });
  };

  const unsupported = spec && spec.text ? attempt(() => findUnsupportedChars(spec.text)) : null;
  const preview = spec && spec.text ? attempt(() => sanitizeSvg(sealToSvg(spec, 96))) : null;
  const setSpec = (p: Partial<SealSpec>) => patch({ sealSpec: { ...(spec ?? createDefaultSealSpec('')), ...p } });

  return (
    <div className="seal-editor">
      <Check label="角印（会社印・店の印）を領収書に表示する" checked={design.showSeal} onChange={(v) => patch({ showSeal: v })} />
      {design.showSeal ? (
        <>
          <fieldset className="radio-group inline">
            <legend>角印の作り方</legend>
            <div className="radio">
              <input id="seal-src-make" type="radio" name="seal-src" checked={source === 'make'} onChange={() => chooseSource('make')} />
              <label htmlFor="seal-src-make">アプリで作る</label>
            </div>
            <div className="radio">
              <input id="seal-src-image" type="radio" name="seal-src" checked={source === 'image'} onChange={() => chooseSource('image')} />
              <label htmlFor="seal-src-image">画像をアップロード</label>
            </div>
          </fieldset>
          {source === 'image' ? (
            <div className="seal-upload">
              <div className="field">
                <label htmlFor="seal-file">印影の画像（PNG・JPEG）</label>
                <input
                  id="seal-file"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { lastFile.current = f; void process(f, removeBg, threshold); }
                    e.target.value = '';
                  }}
                />
              </div>
              <Check
                label="白い背景を透明にする"
                checked={removeBg}
                onChange={(v) => { setRemoveBg(v); if (lastFile.current) void process(lastFile.current, v, threshold); }}
                hint="紙に押した印影を撮影・スキャンした画像に向いています。"
              />
              {removeBg ? (
                <Slider label="透明にする白さのしきい値" value={threshold} min={100} max={250} unit="" onChange={(v) => { setThreshold(v); if (lastFile.current) void process(lastFile.current, removeBg, v); }} />
              ) : null}
              {busy ? <p role="status">画像を処理しています…</p> : null}
              {design.sealImage ? (
                <div className="image-preview">
                  <img src={design.sealImage.dataUrl} alt="角印の画像" />
                  <button type="button" className="btn btn-small" onClick={() => { lastFile.current = null; patch({ sealImage: null }); }}>画像を外す</button>
                </div>
              ) : null}
              {error ? <p className="issue issue-error" role="alert"><span className="issue-tag">エラー</span><span>{error}</span></p> : null}
            </div>
          ) : (
            <div className="seal-make">
              <TextField
                label="角印の文字（2〜6字くらい）"
                value={spec?.text ?? ''}
                onChange={(v) => setSpec({ text: v })}
                maxLength={12}
                placeholder="例：山田商店"
              />
              {unsupported && unsupported.ok && unsupported.value.length > 0 ? (
                <p className="issue issue-warning" role="alert"><span className="issue-tag">注意</span><span>この文字は印影に使えません（四角く表示されます）：{unsupported.value.join(' ')}</span></p>
              ) : null}
              <div className="row">
                <SelectField<SealSpec['layout']> label="文字の並べ方" value={spec?.layout ?? 'auto'} onChange={(v) => setSpec({ layout: v })} options={LAYOUTS} />
                <SelectField<SealSpec['frame']> label="枠" value={spec?.frame ?? 'single'} onChange={(v) => setSpec({ frame: v })} options={FRAMES} />
              </div>
              <div className="row">
                <div className="field">
                  <label htmlFor="seal-color">印影の色</label>
                  <input id="seal-color" type="color" value={spec?.color ?? '#C8161D'} onChange={(e) => setSpec({ color: e.target.value.toUpperCase() })} />
                </div>
                <Check label="角を丸くする" checked={spec?.roundedFrame ?? false} onChange={(v) => setSpec({ roundedFrame: v })} />
              </div>
              <div className="seal-preview" aria-label="角印のプレビュー">
                {preview && preview.ok ? <div dangerouslySetInnerHTML={{ __html: preview.value }} /> : (
                  <p className="hint">{preview && !preview.ok ? `角印を表示できませんでした。（${preview.message}）` : '文字を入れると、ここに表示されます。'}</p>
                )}
              </div>
            </div>
          )}
          <Slider label="印の大きさ" value={design.sealPlacement.sizeMm} min={12} max={40} onChange={(v) => patch({ sealPlacement: { ...design.sealPlacement, sizeMm: v } })} />
          <Slider label="印の位置（左から）" value={design.sealPlacement.xMm} min={0} max={190} onChange={(v) => patch({ sealPlacement: { ...design.sealPlacement, xMm: v } })} />
          <Slider label="印の位置（上から）" value={design.sealPlacement.yMm} min={0} max={140} onChange={(v) => patch({ sealPlacement: { ...design.sealPlacement, yMm: v } })} />
        </>
      ) : null}
    </div>
  );
}
