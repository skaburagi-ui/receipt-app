import { useEffect, useId, useRef, useState, type ReactNode, type InputHTMLAttributes } from 'react';
import type { ValidationIssue } from '../../domain/types';
import { normalizeAmount } from '../../bulk/recipients';
import { MAX_AMOUNT_YEN } from '../../domain/limits';

const LEVEL_LABEL: Record<ValidationIssue['level'], string> = { error: 'エラー', warning: '注意', info: 'お知らせ' };

/** 検証結果の表示。色だけに頼らず、ラベル文字も付ける。 */
export function IssueList({ issues, live = true }: { issues: ValidationIssue[]; live?: boolean }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues" aria-live={live ? 'polite' : undefined}>
      {issues.map((i, idx) => (
        <li key={`${i.code}-${idx}`} className={`issue issue-${i.level}`} data-code={i.code}>
          <span className="issue-tag">{LEVEL_LABEL[i.level]}</span>
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function issuesFor(issues: ValidationIssue[], ...fields: string[]): ValidationIssue[] {
  return issues.filter((i) => i.field !== undefined && fields.includes(i.field));
}

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  issues?: ValidationIssue[];
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
}

export function FieldShell({ label, hint, issues = [], children, className }: FieldShellProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const issueId = `${id}-issue`;
  const hasIssues = issues.length > 0;
  const describedBy = [hint ? hintId : '', hasIssues ? issueId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, describedBy, invalid: issues.some((i) => i.level === 'error') })}
      {hint ? <p className="hint" id={hintId}>{hint}</p> : null}
      {hasIssues ? <div id={issueId}><IssueList issues={issues} /></div> : null}
    </div>
  );
}

type TextProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  issues?: ValidationIssue[];
};

export function TextField({ label, value, onChange, hint, issues, className, ...rest }: TextProps) {
  return (
    <FieldShell label={label} hint={hint} issues={issues} className={className}>
      {({ id, describedBy, invalid }) => (
        <input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export function SelectField<T extends string>({
  label, value, onChange, options, hint, issues,
}: {
  label: ReactNode;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: ReactNode;
  issues?: ValidationIssue[];
}) {
  return (
    <FieldShell label={label} hint={hint} issues={issues}>
      {({ id, describedBy }) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} aria-describedby={describedBy}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </FieldShell>
  );
}

export function Check({
  label, checked, onChange, hint, disabled,
}: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="check">
      {/* ラベル全体が押せる（タップ領域44px以上）ように、入力欄をラベルの中に入れる */}
      <label htmlFor={id} className="choice">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
        <span>{label}</span>
      </label>
      {hint ? <p className="hint" id={`${id}-hint`}>{hint}</p> : null}
    </div>
  );
}

export function RadioGroup<T extends string>({
  legend, name, value, onChange, options, inline,
}: {
  legend: ReactNode;
  name: string;
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; desc?: ReactNode }[];
  inline?: boolean;
}) {
  const base = useId();
  return (
    <fieldset className={`radio-group ${inline ? 'inline' : ''}`}>
      <legend>{legend}</legend>
      {options.map((o) => {
        const id = `${base}-${o.value}`;
        return (
          <div className="radio" key={o.value}>
            <label htmlFor={id} className="choice">
              <input id={id} type="radio" name={`${name}-${base}`} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} aria-describedby={o.desc ? `${id}-desc` : undefined} />
              <span>{o.label}</span>
            </label>
            {o.desc ? <p className="hint" id={`${id}-desc`}>{o.desc}</p> : null}
          </div>
        );
      })}
    </fieldset>
  );
}

const NEGATIVE_RE = /^[-−－ー]/;
const DECIMAL_RE = /[.．]/;

export type YenParse = { ok: true; yen: number } | { ok: false; reason: 'negative' | 'decimal' | 'tooLarge' | 'invalid' };

/** 金額欄の文字列を円の整数にする。空欄は0。全角数字・カンマ・「円」「¥」は受け付ける。 */
export function parseYenInput(text: string): YenParse {
  const s = text.trim();
  if (s === '') return { ok: true, yen: 0 };
  if (NEGATIVE_RE.test(s)) return { ok: false, reason: 'negative' };
  const n = normalizeAmount(s);
  if (n === null) return { ok: false, reason: DECIMAL_RE.test(s) ? 'decimal' : 'invalid' };
  if (n > MAX_AMOUNT_YEN) return { ok: false, reason: 'tooLarge' };
  return { ok: true, yen: n };
}

const YEN_PARSE_MESSAGE: Record<Exclude<YenParse, { ok: true }>['reason'], string> = {
  negative: 'マイナスの金額は入力できません。値引き・返品はこの画面では扱えません。',
  decimal: '小数は入力できません。円の整数で入力してください（例：12,000）。',
  tooLarge: `金額が大きすぎます。${MAX_AMOUNT_YEN.toLocaleString('ja-JP')}円以下で入力してください。`,
  invalid: '金額は数字だけで入力してください（例：12,000）。',
};

/**
 * 円の金額入力。全角数字・カンマ・「円」を許し、マイナス・小数・文字・上限超は受け付けない。
 * 不正な入力のあいだは、状態の金額を NaN にする。直前の有効な金額が、プレビュー・PDFに残らないようにするため
 * （validateReceipt が item.amount.invalid を返し、出力が止まる）。
 */
export function AmountInput({
  label, value, onChange, issues, hint,
}: { label: ReactNode; value: number; onChange: (yen: number) => void; issues?: ValidationIssue[]; hint?: ReactNode }) {
  const initialText = (v: number) => (Number.isFinite(v) && v > 0 ? String(v) : '');
  const [text, setText] = useState(initialText(value));
  const last = useRef(value);
  useEffect(() => {
    // 外部（下書きの読み込み・同じ金額の別の欄）で値が変わったときだけ表示を合わせる。NaN どうしは同じとみなす。
    if (!Object.is(value, last.current)) {
      last.current = value;
      setText(initialText(value));
    }
  }, [value]);
  const parsed = parseYenInput(text);
  const localIssues: ValidationIssue[] = [...(issues ?? [])];
  if (!parsed.ok) {
    localIssues.push({ code: `ui.amount.${parsed.reason}`, level: 'error', message: YEN_PARSE_MESSAGE[parsed.reason] });
  } else if (!Number.isFinite(value)) {
    // この欄の文字は正しいが、同じ金額の別の欄が不正で、状態が「入力不正」になっている
    localIssues.push({ code: 'ui.amount.invalid', level: 'error', message: '金額の入力が正しくありません。もう一つの金額の欄を直してください。' });
  }
  return (
    <FieldShell label={label} hint={hint} issues={localIssues}>
      {({ id, describedBy, invalid }) => (
        <div className="yen-input">
          <input
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={text}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              const t = e.target.value;
              setText(t);
              const r = parseYenInput(t);
              const v = r.ok ? r.yen : Number.NaN;
              last.current = v;
              onChange(v);
            }}
            onBlur={() => {
              if (parsed.ok && parsed.yen > 0) setText(String(parsed.yen));
            }}
          />
          <span aria-hidden="true">円</span>
        </div>
      )}
    </FieldShell>
  );
}


export function TextAreaField({
  label, value, onChange, hint, issues, rows = 3, maxLength,
}: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; issues?: ValidationIssue[]; rows?: number; maxLength?: number }) {
  return (
    <FieldShell label={label} hint={hint} issues={issues}>
      {({ id, describedBy, invalid }) => (
        <textarea id={id} rows={rows} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} />
      )}
    </FieldShell>
  );
}

export function DateField({
  label, value, onChange, hint, issues,
}: { label: ReactNode; value: string; onChange: (v: string) => void; hint?: ReactNode; issues?: ValidationIssue[] }) {
  return (
    <FieldShell label={label} hint={hint} issues={issues}>
      {({ id, describedBy, invalid }) => (
        <input id={id} type="date" value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid || undefined} />
      )}
    </FieldShell>
  );
}

export function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {note ? <p className="hint">{note}</p> : null}
      {children}
    </section>
  );
}

export function Modal({
  title, children, onClose, actions, wide,
}: { title: string; children: ReactNode; onClose?: () => void; actions?: ReactNode; wide?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { onClose?.(); return; }
          if (e.key !== 'Tab') return;
          const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? []).filter((el) => !el.hasAttribute('hidden'));
          if (focusable.length === 0) { e.preventDefault(); ref.current?.focus(); return; }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="modal-body">{children}</div>
        {actions ? <div className="modal-actions">{actions}</div> : null}
      </div>
    </div>
  );
}

export function formatYen(n: number): string {
  return `${n.toLocaleString('ja-JP')}円`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
}
