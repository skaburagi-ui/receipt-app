import { useMemo, useRef, useState, type Dispatch } from 'react';
import { applyReceiptDateChange } from '../../domain/defaults';
import { validateReceipt } from '../../domain/validate';
import type { DesignSettings, ReceiptInput, RecipientRow, ValidationIssue } from '../../domain/types';
import { MAX_BYTES, MAX_ROWS, buildRecipientCsvTemplate, parseRecipientsFromCsv, parseRecipientsFromPaste, validateRecipients } from '../../bulk/recipients';
import { decodeCsvBytes } from '../../bulk/csv';
import { assignReceiptNumbers } from '../../bulk/numbering';
import { generatePdfInWorker } from '../../pdf/workerClient';
import { findMissingGlyphs } from '../../layout/measure';
import { SAVE_NOTICE } from '../copy';
import { FORMAT_INFO } from '../defaults';
import { downloadBlob, downloadText, pdfBlob } from '../output';
import { buildPages, pdfFileName, receiptsForRows } from '../pipeline';
import { attempt, attemptAsync } from '../safe';
import type { Action } from '../state';
import { isBlocked } from '../validation';
import { AmountInput, Check, DateField, IssueList, Modal, SelectField, TextAreaField, TextField } from './common';
import { isSimpleItems } from './BasicForm';

type Step = 1 | 2 | 3;

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: '共通の設定' },
  { n: 2, label: '宛先の取り込み' },
  { n: 3, label: '確認して作る' },
];

const HONORIFIC_OPTIONS = [
  { value: '様', label: '様' },
  { value: '御中', label: '御中' },
  { value: '殿', label: '殿' },
  { value: '', label: '（なし）' },
];
const ROW_HONORIFIC_OPTIONS = [{ value: '', label: '共通に合わせる' }, ...HONORIFIC_OPTIONS.filter((o) => o.value !== '')];

interface RowStatus { errors: string[]; warnings: string[] }

function move<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function BulkDialog({
  base, design, dispatch, onClose,
}: { base: ReceiptInput; design: DesignSettings; dispatch: Dispatch<Action>; onClose: () => void }) {
  const [step, setStep] = useState<Step>(1);
  // 訂正書面は一括では使わない（全員に同じ「元の領収書」を印字してしまうため）
  const [common, setCommon] = useState<ReceiptInput>({ ...base, correction: null });
  const [rows, setRows] = useState<RecipientRow[]>([]);
  const [importIssues, setImportIssues] = useState<ValidationIssue[]>([]);
  const [importInfo, setImportInfo] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [prefix, setPrefix] = useState('');
  const [startText, setStartText] = useState('');
  const [digits, setDigits] = useState(3);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneName, setDoneName] = useState<string | null>(null);
  const [truncationAcknowledged, setTruncationAcknowledged] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const format = FORMAT_INFO.find((f) => f.id === design.format);
  const qualified = common.mode === 'qualified';

  const numbers = useMemo(() => {
    const t = startText.trim();
    const start = t === '' || !/^\d+$/.test(t) ? null : Number(t);
    return assignReceiptNumbers(rows.length, { prefix, start, digits });
  }, [rows.length, prefix, startText, digits]);

  // 共通設定の検証（宛名以外の不足）
  const commonIssues = useMemo(() => {
    const r = attempt(() => validateReceipt({ ...common, recipient: { name: '宛先', honorific: common.recipient.honorific } }));
    return r.ok ? r.value : [];
  }, [common]);
  const commonErrors = commonIssues.filter((i) => i.level === 'error');

  const { rowStatus, listIssues } = useMemo(() => {
    const status = new Map<RecipientRow, RowStatus>();
    rows.forEach((r) => status.set(r, { errors: [], warnings: [] }));
    const issues = validateRecipients(rows);
    for (const i of issues) {
      const key = Number(String(i.field ?? '').split('.')[0]);
      const row = rows.find((r) => r.sourceRow === key);
      const st = row ? status.get(row) : undefined;
      if (!st) continue;
      const short = i.code === 'recipient.empty' ? '宛名が空欄です' : i.code === 'recipient.duplicate' ? '宛名が重複しています' : i.message.replace(/^\d+行目(：|の)?/, '');
      (i.level === 'error' ? st.errors : st.warnings).push(short);
    }
    rows.forEach((row) => {
      const missing = attempt(() => findMissingGlyphs(row.name));
      if (missing.ok && missing.value.length > 0) {
        status.get(row)!.warnings.push(`「${missing.value.join(' ')}」は四角く表示される可能性があります`);
      }
    });
    const extra: ValidationIssue[] = [];
    if (qualified) {
      const list = receiptsForRows(common, rows, numbers);
      rows.forEach((r, idx) => {
        const rc = list[idx].receipt;
        const v = attempt(() => validateReceipt(rc));
        if (v.ok && v.value.some((x) => x.code === 'recipient.required')) {
          const st = status.get(r)!;
          if (r.name.trim() !== '') st.errors.push('適格請求書では「上様」など宛名の代わりになる語だけの宛名は使えません');
          else if (!st.errors.includes('宛名が空欄です')) st.errors.push('宛名が空欄です');
          extra.push({ code: 'recipient.required', level: 'error', field: String(r.sourceRow), message: `${r.sourceRow}行目：適格請求書では、宛名の空欄・「上様」は使えません。` });
        }
      });
    }
    return { rowStatus: status, listIssues: [...issues, ...extra.filter((e) => !issues.some((i) => i.code === 'recipient.empty' && i.field === e.field))] };
  }, [rows, qualified, common, numbers]);

  const rowErrors = rows.filter((r) => (rowStatus.get(r)?.errors.length ?? 0) > 0).length;
  const tooMany = rows.length > MAX_ROWS;
  const wasTruncated = importIssues.some((i) => i.code === 'bulk.limit.rows' || i.code === 'bulk.limit.size');
  const hasImportError = importIssues.some((i) => i.level === 'error' && i.code !== 'bulk.limit.rows' && i.code !== 'bulk.limit.size');
  const canGenerate = rows.length > 0 && !tooMany && !hasImportError && rowErrors === 0 && commonErrors.length === 0 && (!wasTruncated || truncationAcknowledged) && progress === null;

  const failImport = (issue: ValidationIssue) => {
    // 前回の成功データを残すと、今回の失敗に気づかず古い宛先で発行できてしまう。
    setRows([]);
    setImportIssues([issue]);
    setImportInfo(null);
    setError(null);
    setDoneName(null);
    setTruncationAcknowledged(false);
  };

  const setImported = (res: { rows: RecipientRow[]; issues: ValidationIssue[] }, info: string) => {
    setRows(res.rows);
    setImportIssues(res.issues);
    setImportInfo(info);
    setError(null);
    setDoneName(null);
    setTruncationAcknowledged(false);
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_BYTES) {
      failImport({ code: 'bulk.file.size', level: 'error', message: 'ファイルが大きすぎます（5MBまで）。' });
      return;
    }
    const r = await attemptAsync(async () => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { text, encoding } = decodeCsvBytes(bytes);
      return { parsed: parseRecipientsFromCsv(text), encoding };
    });
    if (!r.ok) { failImport({ code: 'bulk.file.read', level: 'error', message: `ファイルを読み込めませんでした。（${r.message}）` }); return; }
    setImported(r.value.parsed, `${file.name}：${r.value.parsed.rows.length}件を取り込みました（文字コード：${r.value.encoding}）。`);
  };

  const importPaste = () => {
    const r = attempt(() => parseRecipientsFromPaste(pasteText));
    if (!r.ok) { failImport({ code: 'bulk.paste', level: 'error', message: r.message }); return; }
    setImported(r.value, `貼り付けから${r.value.rows.length}件を取り込みました。`);
  };

  const generate = async () => {
    setError(null);
    const current = receiptsForRows(common, rows, numbers);
    if (current.some(({ receipt }) => isBlocked(receipt))) {
      setError('入力内容にエラーがあるため、PDFを作れません。共通設定と宛先を確認してください。');
      return;
    }
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ done: 0, total: Math.max(1, rows.length) });
    const r = await attemptAsync(async () => {
      const built = buildPages(common, design, current);
      if (built.overflow) {
        const where = built.overflowIndexes.slice(0, 5).map((i) => `${i + 1}件目`).join('、');
        throw new Error(`${where}は内容が枠に入りきらないため作れません。宛名などを短くしてください。`);
      }
      const bytes = await generatePdfInWorker(built.pages, {
        title: '領収書',
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      return pdfBlob(bytes);
    });
    setProgress(null);
    abortRef.current = null;
    if (!r.ok) {
      if (ctrl.signal.aborted) setError('作成をやめました。');
      else setError(`PDFを作れませんでした。${r.message}`);
      return;
    }
    const name = pdfFileName(common.receiptDate, `_${rows.length}件`);
    downloadBlob(r.value, name);
    setDoneName(name);
  };

  const close = () => { abortRef.current?.abort(); onClose(); };
  const patchCommon = (p: Partial<ReceiptInput>) => setCommon((c) => ({ ...c, ...p }));
  const simple = isSimpleItems(common);
  const item = common.tax.items[0];

  return (
    <Modal
      wide
      title="まとめて発行"
      onClose={close}
      actions={
        <>
          <button type="button" className="btn" onClick={close}>閉じる</button>
          {step > 1 ? <button type="button" className="btn" disabled={progress !== null} onClick={() => setStep((step - 1) as Step)}>戻る</button> : null}
          {step === 1 ? <button type="button" className="btn btn-primary" disabled={commonErrors.length > 0} onClick={() => setStep(2)}>次へ：宛先の取り込み</button> : null}
          {step === 2 ? <button type="button" className="btn btn-primary" disabled={rows.length === 0 || hasImportError} onClick={() => setStep(3)}>次へ：確認</button> : null}
          {step === 3 ? <button type="button" className="btn btn-primary" disabled={!canGenerate} onClick={() => void generate()}>{rows.length}件のPDFを作る</button> : null}
        </>
      }
    >
      <ol className="steps" aria-label="手順">
        {STEPS.map((s) => (
          <li key={s.n} aria-current={s.n === step ? 'step' : undefined} className={s.n === step ? 'current' : ''}>{s.n}. {s.label}</li>
        ))}
      </ol>
      <p className="hint">取り込んだ宛先は、サーバーには送りません。この端末のブラウザーの中だけで処理します。</p>

      {step === 1 ? (
        <div className="bulk-step">
          <p>メイン画面で入力した内容を引き継いでいます。住所・税の設定など、ここに無い項目は、メイン画面の「詳細設定」で変えられます。</p>
          <TextField label="発行者（あなたの名前・会社名）" value={common.issuer.name} onChange={(v) => patchCommon({ issuer: { ...common.issuer, name: v } })} />
          {simple ? (
            <div className="row">
              <AmountInput label="領収金額（全員同じ）" value={item.amountYen} onChange={(v) => patchCommon({ tax: { ...common.tax, items: [{ ...item, amountYen: v }] } })} />
              <SelectField label="税率" value={item.category === 'taxable8' ? 'taxable8' : 'taxable10'} onChange={(v) => patchCommon({ tax: { ...common.tax, items: [{ ...item, category: v }] } })} options={[{ value: 'taxable10', label: '10%' }, { value: 'taxable8', label: '8%（軽減税率）' }]} />
            </div>
          ) : <p className="hint">金額は、メイン画面の「消費税の詳細入力」の内容（複数の品目）を全員に使います。</p>}
          <TextField label="但し書き" value={common.proviso} onChange={(v) => patchCommon({ proviso: v })} />
          <DateField label="領収日" value={common.receiptDate} onChange={(v) => setCommon((c) => applyReceiptDateChange(c, v))} />
          <SelectField label="敬称の初期値" value={common.recipient.honorific} onChange={(v) => patchCommon({ recipient: { ...common.recipient, honorific: v } })} options={HONORIFIC_OPTIONS} hint="宛先ごとに変えなければ、この敬称になります。" />
          <p className="hint">印刷の形式：{format?.label}（メイン画面で変えられます）</p>
          <SelectField label="印刷の形式を変える" value={design.format} onChange={(v) => dispatch({ type: 'patchDesign', patch: { format: v } })} options={FORMAT_INFO.map((f) => ({ value: f.id, label: f.label }))} hint={format?.desc} />
          <IssueList issues={commonIssues.filter((i) => i.level !== 'info')} />
        </div>
      ) : null}

      {step === 2 ? (
        <div className="bulk-step">
          <p>宛先は、次のどちらかで取り込みます。取り込める件数は、1回に{MAX_ROWS}件までです。</p>
          <div className="bulk-import">
            <div>
              <h3>CSVファイルから</h3>
              <p className="hint">1行目は見出し（宛名・敬称など）。ExcelのCSV（Shift_JIS）もそのまま読めます。</p>
              <button type="button" className="btn" onClick={() => downloadText(buildRecipientCsvTemplate(), '宛先テンプレート.csv')}>CSVのひな形をダウンロード</button>{' '}
              <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>CSVファイルを選ぶ</button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                hidden
                aria-label="CSVファイルを選ぶ"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }}
              />
            </div>
            <div>
              <h3>貼り付けから</h3>
              <TextAreaField label="Excelなどの表をコピーして貼り付け" value={pasteText} onChange={setPasteText} rows={5} hint="宛名の列が先頭になるようにコピーしてください。" />
              <button type="button" className="btn btn-primary" disabled={pasteText.trim() === ''} onClick={importPaste}>貼り付けた内容を取り込む</button>
            </div>
            <p className="hint">登録済みの宛先から選ぶ機能は、会員機能で提供予定です。</p>
          </div>
          {importInfo ? <p className="notice notice-info" role="status">{importInfo}</p> : null}
          <IssueList issues={importIssues} />
        </div>
      ) : null}

      {step === 3 ? (
        <div className="bulk-step">
          <p aria-live="polite"><strong>{rows.length}件</strong> / 上限{MAX_ROWS}件{tooMany ? '（多すぎます。減らしてください）' : ''}</p>
          <IssueList issues={importIssues} />
          {wasTruncated ? (
            <Check
              label={importIssues.some((i) => i.code === 'bulk.limit.rows') ? `${MAX_ROWS + 1}件目以降は含まれないことを理解しました` : '読み込まれなかった残りの部分は含まれないことを理解しました'}
              checked={truncationAcknowledged}
              onChange={setTruncationAcknowledged}
              hint="読み込まれなかった宛先は、このPDFには入りません。必要ならファイルを分けて発行してください。"
            />
          ) : null}
          {base.correction ? <p className="notice notice-info">「訂正書面として発行する」の設定は、まとめて発行では使えません（通常の領収書として作ります）。</p> : null}
          {qualified ? <p className="notice notice-info">適格請求書では、宛名の空欄と「上様」はエラーになります。</p> : null}
          <div className="numbering">
            <h3>領収書番号（つけるときだけ）</h3>
            <div className="row">
              <TextField label="頭につける文字" value={prefix} onChange={setPrefix} placeholder="例：R-" />
              <TextField label="開始番号" value={startText} onChange={setStartText} inputMode="numeric" placeholder="空欄＝番号なし" />
              <TextField label="桁数" value={String(digits)} onChange={(v) => setDigits(Math.min(10, Math.max(0, Number(v.replace(/\D/g, '')) || 0)))} inputMode="numeric" />
            </div>
            {numbers[0] ? <p className="hint">最初の番号：{numbers[0]}</p> : <p className="hint">開始番号が空欄のときは、番号は印字されません。</p>}
          </div>
          <div className="table-wrap">
            <table className="recipient-table">
              <caption>宛先の一覧</caption>
              <thead><tr><th scope="col">No.</th><th scope="col">取込元の行</th><th scope="col">宛名</th><th scope="col">敬称</th><th scope="col">状態</th><th scope="col">操作</th></tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const st = rowStatus.get(r) ?? { errors: [], warnings: [] };
                  return (
                    <tr key={`${r.sourceRow}-${i}`} className={st.errors.length ? 'row-error' : st.warnings.length ? 'row-warning' : ''}>
                      <td>{i + 1}</td>
                      <td>{r.sourceRow}</td>
                      <td>
                        <input
                          aria-label={`${i + 1}件目の宛名`}
                          type="text"
                          value={r.name}
                          aria-invalid={st.errors.length > 0 || undefined}
                          onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))}
                        />
                      </td>
                      <td>
                        <select aria-label={`${i + 1}件目の敬称`} value={r.honorific} onChange={(e) => setRows(rows.map((x, idx) => (idx === i ? { ...x, honorific: e.target.value } : x)))}>
                          {ROW_HONORIFIC_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </td>
                      <td>
                        {st.errors.length === 0 && st.warnings.length === 0 ? <span>OK</span> : null}
                        {st.errors.map((m) => <span key={m} className="status-error">エラー：{m}</span>)}
                        {st.warnings.map((m) => <span key={m} className="status-warning">注意：{m}</span>)}
                      </td>
                      <td className="row-actions">
                        <button type="button" className="btn btn-small" disabled={i === 0} onClick={() => setRows(move(rows, i, i - 1))} aria-label={`${i + 1}件目を上へ`}>上へ</button>
                        <button type="button" className="btn btn-small" disabled={i === rows.length - 1} onClick={() => setRows(move(rows, i, i + 1))} aria-label={`${i + 1}件目を下へ`}>下へ</button>
                        <button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, idx) => idx !== i))} aria-label={`${i + 1}件目を削除`}>削除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div aria-live="polite">
            {rowErrors > 0 ? <p className="issue issue-error"><span className="issue-tag">エラー</span><span>{rowErrors}件に直す点があります。直すか、その行を削除してください。</span></p> : null}
            {listIssues.some((i) => i.code === 'recipient.duplicate') ? <p className="issue issue-warning"><span className="issue-tag">注意</span><span>同じ宛名があります。意図したものなら、そのまま作れます。</span></p> : null}
          </div>
          <IssueList issues={commonIssues.filter((i) => i.level === 'error')} />
          {progress ? (
            <div className="progress" role="status">
              <progress max={progress.total} value={progress.done} aria-label="PDFの作成の進み具合" />
              <span>{progress.done} / {progress.total}</span>
              <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>やめる</button>
            </div>
          ) : null}
          {error ? <p className="issue issue-error" role="alert"><span className="issue-tag">エラー</span><span>{error}</span></p> : null}
          {doneName ? (
            <div className="notice notice-info" role="status">
              <p><strong>{doneName} を保存しました。</strong></p>
              <p>{SAVE_NOTICE}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
