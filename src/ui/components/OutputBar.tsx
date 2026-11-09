import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hasBlockingIssue } from '../../domain/validate';
import { guideStampDuty } from '../../domain/stamp';
import type { DesignSettings, Page, ReceiptInput, ValidationIssue } from '../../domain/types';
import { FORMAT_INFO } from '../defaults';
import { buildTestPrintPages } from '../../layout/testPrint';
import { generatePdfInWorker } from '../../pdf/workerClient';
import { PRINT_ENV_DISCLAIMER, PRINT_ENV_GUIDES, PRINT_GUIDE, SAVE_NOTICE, SAVE_NOTICE_SHORT, STAMP_DUTY_NOTICE } from '../copy';
import type { PreviewState } from '../hooks';
import { canShareFile, downloadBlob, pdfBlob, printPdfBlob, shareFile, type PrintResult } from '../output';
import { buildPages, pdfFileName } from '../pipeline';
import { attempt, attemptAsync } from '../safe';
import { taxAmountShown } from '../state';
import { isBlocked } from '../validation';
import { Modal } from './common';

type Kind = 'save' | 'print';

interface Props {
  /** プレビュー・PDFに使う入力（effectiveReceipt 済み） */
  receipt: ReceiptInput;
  design: DesignSettings;
  issues: ValidationIssue[];
  preview: PreviewState;
  onSwitchToGeneral: () => void;
}

/** 出力できない理由（null＝出力できる）。 */
export function outputBlockReason(receipt: ReceiptInput, issues: ValidationIssue[], preview: PreviewState): string | null {
  if (hasBlockingIssue(issues)) {
    return receipt.mode === 'general'
      ? '入力に直す点があるため、まだPDFを作れません。上の赤い表示を確認してください。'
      : '適格請求書（インボイス）に必要な項目が足りないため、PDFを作れません。上の赤い表示を直すか、ふつうの領収書に切り替えてください。';
  }
  if (preview.status === 'ok' && preview.overflow) return '内容が枠に入りきらないため、PDFを作れません。品目や文字を減らしてください。';
  if (preview.status === 'error') return 'プレビューを作れないため、PDFを作れません。入力内容を見直してください。';
  return null;
}

function recipientEmpty(r: ReceiptInput): boolean {
  return r.recipient.name.trim() === '';
}

export function OutputBar({ receipt, design, issues, preview, onSwitchToGeneral }: Props) {
  const [busy, setBusy] = useState<null | 'save' | 'print' | 'test'>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<Kind | null>(null);
  const [printGuideOpen, setPrintGuideOpen] = useState(false);
  const [printResult, setPrintResult] = useState<PrintResult | null>(null);
  const [saved, setSaved] = useState<{ blob: Blob; fileName: string } | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // スマホでは操作バーが画面の下に固定される。案内の行数で高さが変わるので、ページ末尾の余白を実測に合わせる。
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const apply = () => document.documentElement.style.setProperty('--bar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 結果を置き換える／画面を閉じるとき、一時URLとiframeを必ず片付ける。
  useEffect(() => () => printResult?.release(), [printResult]);

  const reason = outputBlockReason(receipt, issues, preview);
  const blocked = reason !== null || preview.status === 'loading';
  const format = FORMAT_INFO.find((f) => f.id === design.format);
  const stamp = attempt(() => guideStampDuty(receipt, { taxAmountShown: taxAmountShown(receipt, design) }));
  const showStampNotice = stamp.ok && stamp.value.level !== 'none';

  const makePdf = async (pagesFn: () => Page[]): Promise<Blob | null> => {
    const r = await attemptAsync(async () => {
      const pages = pagesFn();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const bytes = await generatePdfInWorker(pages, { title: '領収書', signal: ctrl.signal });
      return pdfBlob(bytes);
    });
    if (r.ok) return r.value;
    setError(`PDFを作れませんでした。（${r.message}）`);
    return null;
  };

  const exec = async (kind: Kind) => {
    setError(null);
    if (isBlocked(receipt)) {
      setError('入力内容にエラーがあるため、PDFを作れません。入力を確認してください。');
      return;
    }
    setBusy(kind);
    const blob = await makePdf(() => {
      const built = buildPages(receipt, design);
      if (built.overflow) throw new Error('内容が枠に入りきりません');
      return built.pages;
    });
    setBusy(null);
    if (!blob) return;
    const fileName = pdfFileName(receipt.receiptDate);
    if (kind === 'save') {
      downloadBlob(blob, fileName);
      setSaved({ blob, fileName });
    } else {
      const res = await printPdfBlob(blob);
      setPrintResult(res);
      if (res.printed) setSaved({ blob, fileName });
    }
  };

  const start = (kind: Kind) => {
    if (blocked) return;
    if (receipt.mode === 'general' && recipientEmpty(receipt)) {
      setConfirmKind(kind);
      return;
    }
    proceed(kind);
  };
  const proceed = (kind: Kind) => {
    if (kind === 'print') setPrintGuideOpen(true);
    else void exec('save');
  };

  const runTestPrint = async (kind: Kind) => {
    setError(null);
    setBusy('test');
    const blob = await makePdf(() => buildTestPrintPages());
    setBusy(null);
    if (!blob) return;
    if (kind === 'save') downloadBlob(blob, '試し刷り.pdf');
    else setPrintResult(await printPdfBlob(blob));
  };

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <div className="output-bar" role="region" aria-label="PDFの保存と印刷" ref={barRef}>
      <div className="output-notices">
      <div className="save-notice">
        <p><strong>控えの保存：</strong>{SAVE_NOTICE_SHORT}</p>
        <details><summary>くわしく</summary><p>{SAVE_NOTICE}</p></details>
      </div>
      {showStampNotice ? <p className="notice notice-info">{STAMP_DUTY_NOTICE}</p> : null}
      {reason ? (
        <div className="output-reason" id="output-reason" aria-live="polite">
          <p>{reason}</p>
          {receipt.mode !== 'general' && hasBlockingIssue(issues) ? (
            <button type="button" className="btn" onClick={onSwitchToGeneral}>ふつうの領収書に切り替える</button>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="issue issue-error" role="alert"><span className="issue-tag">エラー</span><span>{error}</span></p> : null}
      </div>
      <div className="output-buttons">
        <button type="button" className="btn btn-primary" disabled={blocked || busy !== null} aria-describedby={reason ? 'output-reason' : undefined} onClick={() => start('save')}>
          {busy === 'save' ? '作成中…' : 'PDFを保存'}
        </button>
        <button type="button" className="btn btn-primary" disabled={blocked || busy !== null} aria-describedby={reason ? 'output-reason' : undefined} onClick={() => start('print')}>
          {busy === 'print' ? '準備中…' : '印刷'}
        </button>
        <button type="button" className="btn btn-secondary btn-test" onClick={() => setTestOpen(true)}>試し刷りページ</button>
      </div>
      {busy ? (
        <p className="busy" role="status">
          PDFを作っています…
          <button type="button" className="btn-link" onClick={() => abortRef.current?.abort()}>やめる</button>
        </p>
      ) : null}

      {confirmKind ? (
        <Modal
          title="宛名が空欄です"
          onClose={() => setConfirmKind(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmKind(null)}>戻って入力する</button>
              <button type="button" className="btn btn-primary" onClick={() => { const k = confirmKind; setConfirmKind(null); proceed(k); }}>宛名なしで進む</button>
            </>
          }
        >
          <p>宛名を入力していません。宛名を空欄のまま領収書を作りますか？</p>
        </Modal>
      ) : null}

      {printGuideOpen ? (
        <Modal
          title="印刷する前に"
          onClose={() => setPrintGuideOpen(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setPrintGuideOpen(false)}>やめる</button>
              <button type="button" className="btn btn-primary" onClick={() => { setPrintGuideOpen(false); void exec('print'); }}>印刷画面を開く</button>
            </>
          }
        >
          <p>印刷の設定画面で、次のとおりに設定してください。</p>
          <ul className="print-guide">
            <li>用紙サイズ：{design.format === 'a5-single' ? 'A5（よこ）。A5の用紙がないときはA4' : 'A4'}</li>
            {PRINT_GUIDE.slice(1).map((g) => <li key={g}>{g}</li>)}
          </ul>
          {format ? <p className="hint">選んだ形式：{format.label}。{format.desc}</p> : null}
          <p className="hint">スマホから印刷するときは、「PDFを保存」してから、コンビニなどのプリンターで印刷すると確実です。</p>
          {showStampNotice ? <p className="notice notice-info">{STAMP_DUTY_NOTICE}</p> : null}
          <details>
            <summary>環境別の印刷手順</summary>
            {PRINT_ENV_GUIDES.map((g) => <div key={g.title}><h3>{g.title}</h3><ol>{g.steps.map((s) => <li key={s}>{s}</li>)}</ol></div>)}
            <p className="hint">{PRINT_ENV_DISCLAIMER}</p>
          </details>
        </Modal>
      ) : null}

      {printResult && !printResult.printed && printResult.fallbackUrl ? (
        <Modal title="印刷画面を開けませんでした" onClose={() => setPrintResult(null)} actions={<button type="button" className="btn" onClick={() => setPrintResult(null)}>閉じる</button>}>
          <p>お使いのブラウザーでは、ここから直接印刷できませんでした。次のリンクでPDFを開き、PDFの画面から印刷してください。</p>
          <p><a href={printResult.fallbackUrl} target="_blank" rel="noopener noreferrer">PDFを開く</a>　または「PDFを保存」を使ってください。</p>
        </Modal>
      ) : null}

      {saved ? (
        <Modal
          title={printResult?.printed ? '印刷を開始しました' : 'PDFを保存しました'}
          onClose={() => { setSaved(null); setPrintResult(null); setShareMsg(null); }}
          actions={
            <>
              {canShare && canShareFile(saved.blob, saved.fileName) ? (
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try { await shareFile(saved.blob, saved.fileName); setShareMsg(null); } catch (e) {
                      if (!(e instanceof DOMException && e.name === 'AbortError')) setShareMsg('共有できませんでした。「PDFを保存」を使ってください。');
                    }
                  }}
                >共有／ファイルに保存</button>
              ) : null}
              <button type="button" className="btn btn-primary" onClick={() => { setSaved(null); setPrintResult(null); setShareMsg(null); }}>閉じる</button>
            </>
          }
        >
          <p>{saved.fileName}</p>
          <div className="notice notice-info"><p><strong>控えの保存について</strong></p><p>{SAVE_NOTICE}</p></div>
          {showStampNotice ? <p className="notice notice-info">{STAMP_DUTY_NOTICE}</p> : null}
          {shareMsg ? <p className="issue issue-error" role="alert"><span className="issue-tag">エラー</span><span>{shareMsg}</span></p> : null}
        </Modal>
      ) : null}

      {testOpen ? (
        <Modal
          title="試し刷りページ"
          onClose={() => setTestOpen(false)}
          actions={
            <>
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void runTestPrint('save')}>試し刷りPDFを保存</button>
              <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void runTestPrint('print')}>試し刷りを印刷</button>
              <button type="button" className="btn" onClick={() => setTestOpen(false)}>閉じる</button>
            </>
          }
        >
          <p>領収書を本番の用紙に刷る前に、大きさがずれていないか確かめるためのページです。</p>
          <ol>
            <li>「試し刷りを印刷」を押し、印刷設定を「用紙サイズ：A4」「拡大縮小：100%（実際のサイズ）」「ヘッダーとフッター：なし」にして印刷します。</li>
            <li>印刷された目盛りを<strong>定規で測り、「100mm」の長さが99〜101mmになっている</strong>か確認します。</li>
            <li>ずれているときは、拡大縮小が「ページに合わせる」になっていないか確認してください。外枠が欠けるときは、プリンターの余白の設定を確認してください。</li>
          </ol>
          {error ? <p className="issue issue-error" role="alert"><span className="issue-tag">エラー</span><span>{error}</span></p> : null}
        </Modal>
      ) : null}
    </div>
  );
}

