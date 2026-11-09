import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { DesignSettings, ReceiptInput } from '../../domain/types';
import { calculateTax } from '../../domain/tax';
import {
  deleteAllDrafts, exportDraftsToJson, importDraftsFromJson, isDraftStorageAvailable, listDrafts, loadDraft, saveDraft,
  type DraftMeta, type DraftPayload,
} from '../../storage/drafts';
import { CONFIRMATIONS_RESET_NOTICE, DRAFT_WARNING } from '../copy';
import { downloadText } from '../output';
import type { Action } from '../state';
import { Check, Modal, formatDateTime, formatYen } from './common';

const FLAG_KEY = 'receipt-app-draft-enabled';
const CURRENT = 'current';
const ISSUER = 'issuer';

function readFlag(): boolean {
  try { return localStorage.getItem(FLAG_KEY) === '1'; } catch { return false; }
}
function writeFlag(on: boolean): void {
  try { if (on) localStorage.setItem(FLAG_KEY, '1'); else localStorage.removeItem(FLAG_KEY); } catch { /* 保存できない環境では、このセッションだけ有効 */ }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : '処理に失敗しました。';
}

/** 下書き保存の画面。既定はOFF。利用者が明示的にONにしたときだけ、この端末（IndexedDB）に保存する。 */
export function DraftPanel({
  receipt, design, dispatch,
}: { receipt: ReceiptInput; design: DesignSettings; dispatch: Dispatch<Action> }) {
  const available = isDraftStorageAvailable();
  const [enabled, setEnabled] = useState<boolean>(() => available && readFlag());
  const [warnOpen, setWarnOpen] = useState(false);
  const [drafts, setDrafts] = useState<DraftMeta[]>([]);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);
  /** 起動時に前回の下書きがあるとき、利用者が選ぶまで自動保存を止める（空の入力で上書きしないため）。 */
  const [pendingRestore, setPendingRestore] = useState<DraftMeta | null>(null);
  const [checked, setChecked] = useState(!enabled);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listDrafts();
      setDrafts(list);
      const cur = list.find((d) => d.id === CURRENT);
      setLastSaved(cur?.savedAt ?? null);
      return list;
    } catch (e) {
      setMessage({ kind: 'error', text: errMsg(e) });
      return [];
    }
  }, []);

  // 起動時：有効なら前回の下書きの有無を確認
  useEffect(() => {
    if (!available) return;
    let alive = true;
    void (async () => {
      const list = await refresh();
      if (!alive) return;
      if (enabled) {
        const cur = list.find((d) => d.id === CURRENT);
        if (cur) setPendingRestore(cur);
      }
      setChecked(true);
    })();
    return () => { alive = false; };
    // 起動時の1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自動保存（有効・確認済み・復元待ちでないときだけ）
  useEffect(() => {
    // 入力途中の不正な金額（NaN）は下書き形式として保存できない。ほかの未入力項目は下書きなので許容する。
    if (!available || !enabled || !checked || pendingRestore || receipt.tax.items.some((item) => !Number.isFinite(item.amountYen))) return;
    const t = setTimeout(() => {
      const payload: DraftPayload = { kind: 'full', receipt, design };
      const label = `${receipt.issuer.name || '（発行者未入力）'} ${formatYen(calculateTax(receipt.tax).grandTotalYen)}`;
      saveDraft(CURRENT, payload, label).then(
        () => { setMessage(null); void refresh(); },
        (e) => setMessage({ kind: 'error', text: `下書きを保存できませんでした。（${errMsg(e)}）` }),
      );
    }, 1000);
    return () => clearTimeout(t);
  }, [available, enabled, checked, pendingRestore, receipt, design, refresh]);

  const turnOn = () => {
    writeFlag(true);
    setEnabled(true);
    setWarnOpen(false);
    setChecked(true);
    void refresh();
  };
  const turnOff = () => {
    writeFlag(false);
    setEnabled(false);
    setPendingRestore(null);
  };

  const applyPayload = (p: unknown): boolean => {
    const d = p as DraftPayload | null;
    if (!d) return false;
    if (d.kind === 'full') { dispatch({ type: 'replace', receipt: d.receipt, design: d.design }); return true; }
    if (d.kind === 'issuer') { dispatch({ type: 'loadIssuer', issuer: d.issuer, design: d.design }); return true; }
    return false;
  };

  const load = async (id: string) => {
    try {
      const p = await loadDraft(id);
      if (!applyPayload(p)) { setMessage({ kind: 'error', text: '下書きを読み込めませんでした（期限切れか、データが壊れています）。' }); await refresh(); return; }
      setMessage({ kind: 'info', text: `下書きを読み込みました。${CONFIRMATIONS_RESET_NOTICE}` });
      if (id === CURRENT) setPendingRestore(null);
    } catch (e) {
      setMessage({ kind: 'error', text: errMsg(e) });
    }
  };

  const saveIssuerOnly = async () => {
    try {
      const { logo, logoWidthMm, sealImage, sealSpec, sealPlacement, showSeal, themeColor, design: dsg } = design;
      await saveDraft(ISSUER, { kind: 'issuer', issuer: receipt.issuer, design: { logo, logoWidthMm, sealImage, sealSpec, sealPlacement, showSeal, themeColor, design: dsg } }, `${receipt.issuer.name || '（発行者未入力）'} の発行者情報`);
      setMessage({ kind: 'info', text: '発行者情報を保存しました。' });
      await refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: `保存できませんでした。（${errMsg(e)}）` });
    }
  };

  const removeAll = async () => {
    try {
      await deleteAllDrafts();
      writeFlag(false);
      setEnabled(false);
      setPendingRestore(null);
      setLastSaved(null);
      setMessage({ kind: 'info', text: 'この端末に保存した下書きを、すべて削除しました。自動保存もOFFにしました。' });
      await refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: errMsg(e) });
    }
  };

  const exportAll = async () => {
    try {
      const json = await exportDraftsToJson(drafts.map((d) => d.id));
      downloadText(json, '領収書_下書き.json', 'application/json');
    } catch (e) {
      setMessage({ kind: 'error', text: errMsg(e) });
    }
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const n = await importDraftsFromJson(text);
      setMessage({ kind: 'info', text: `${n}件の下書きを読み込みました。` });
      await refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: `読み込めませんでした。${errMsg(e)}` });
    }
  };

  const hasIssuerDraft = drafts.some((d) => d.id === ISSUER);

  return (
    <section className="card draft-panel" aria-labelledby="draft-title">
      <h2 id="draft-title">下書き（この端末に保存）</h2>
      {!available ? (
        <p className="notice notice-info">このブラウザーでは、下書きの保存を使えません（プライベートモードなどでは使えないことがあります）。入力した内容は、ページを閉じると消えます。</p>
      ) : (
        <>
          <Check
            label="この端末に下書きを保存する"
            checked={enabled}
            onChange={(v) => (v ? setWarnOpen(true) : turnOff())}
            hint="初期設定は「保存しない」です。入力した内容は、ONにしたときだけ、この端末の中に保存されます。"
          />
          {pendingRestore ? (
            <div className="notice notice-info" role="status">
              <p>前回の下書きがあります（最終保存：{formatDateTime(pendingRestore.savedAt)}）。読み込みますか？</p>
              <p>
                <button type="button" className="btn btn-primary" onClick={() => void load(CURRENT)}>読み込む</button>{' '}
                <button type="button" className="btn" onClick={() => setPendingRestore(null)}>読み込まない（今の入力を保存していく）</button>
              </p>
            </div>
          ) : null}
          {enabled ? (
            <p className="hint" aria-live="polite">
              {lastSaved ? `最終保存：${formatDateTime(lastSaved)}（30日を過ぎた下書きは、次回アクセス時などに削除します）` : 'まだ保存していません。入力すると自動で保存します。'}
            </p>
          ) : null}
          <div className="draft-actions">
            {enabled ? <button type="button" className="btn" onClick={() => void saveIssuerOnly()}>発行者情報だけ保存</button> : null}
            {hasIssuerDraft ? <button type="button" className="btn" onClick={() => void load(ISSUER)}>保存した発行者情報を使う</button> : null}
            <button type="button" className="btn" disabled={drafts.length === 0} onClick={() => void exportAll()}>ファイルに書き出す</button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>ファイルから読み込む</button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              aria-label="下書きファイルを選ぶ"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }}
            />
            <button type="button" className="btn btn-danger" disabled={drafts.length === 0} onClick={() => void removeAll()}>すべて削除</button>
          </div>
          {drafts.length > 0 ? (
            <ul className="draft-list">
              {drafts.map((d) => (
                <li key={d.id}>
                  <span>{d.label}（{formatDateTime(d.savedAt)}）</span>
                  <button type="button" className="btn btn-small" onClick={() => void load(d.id)}>読み込む</button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="hint">一括発行の宛先一覧は、下書きには保存しません。</p>
          {message ? (
            <p className={`issue issue-${message.kind === 'error' ? 'error' : 'info'}`} role={message.kind === 'error' ? 'alert' : 'status'}>
              <span className="issue-tag">{message.kind === 'error' ? 'エラー' : 'お知らせ'}</span><span>{message.text}</span>
            </p>
          ) : null}
        </>
      )}
      {warnOpen ? (
        <Modal
          title="下書きの保存をONにしますか？"
          onClose={() => setWarnOpen(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setWarnOpen(false)}>やめる</button>
              <button type="button" className="btn btn-primary" onClick={turnOn}>理解した上でONにする</button>
            </>
          }
        >
          <p>{DRAFT_WARNING}</p>
        </Modal>
      ) : null}
    </section>
  );
}
