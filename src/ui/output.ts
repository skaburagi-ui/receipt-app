/** PDFの保存・共有・印刷（ブラウザー操作）。外部通信はしない（blob: URL のみ）。 */

export function pdfBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadText(text: string, fileName: string, mime = 'text/csv;charset=utf-8'): void {
  downloadBlob(new Blob([text], { type: mime }), fileName);
}

/** Web Share API でファイル共有できるか。 */
export function canShareFile(blob: Blob, fileName: string): boolean {
  try {
    const file = new File([blob], fileName, { type: 'application/pdf' });
    return typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  await navigator.share({ files: [file], title: fileName });
}

export interface PrintResult {
  /** iframeから印刷画面を呼べたか */
  printed: boolean;
  /** 呼べなかったときに開くためのURL（利用者がリンクをクリックして開く） */
  fallbackUrl: string | null;
  /** blob: URL と隠しiframeを解放する（何度呼んでもよい）。リンクを出し終えたら呼ぶ。 */
  release: () => void;
}

/** 印刷画面を出したあと、afterprint が来なくても blob: URL を解放するまでの時間。 */
const RELEASE_AFTER_PRINT_MS = 5 * 60_000;

/**
 * 隠しiframeにPDFを読み込んで print() を呼ぶ。CSP等で読み込めない場合は fallbackUrl を返し、
 * 画面側で「PDFを開く」リンクを出す（画面要素は印刷しない）。
 * 印刷できたときは、印刷後（afterprint、または一定時間後）に blob: URL とiframeを解放する。
 * 印刷できなかったときは、リンクを使い終えるまで URL を残すので、呼び出し側が release() を呼ぶ。
 */
export function printPdfBlob(blob: Blob): Promise<PrintResult> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    let settled = false;
    let released = false;
    let releaseTimer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (released) return;
      released = true;
      if (releaseTimer) clearTimeout(releaseTimer);
      iframe.remove();
      URL.revokeObjectURL(url);
    };
    const finish = (r: Omit<PrintResult, 'release'>) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('securitypolicyviolation', onViolation);
      if (!r.printed) iframe.remove(); // 印刷できなかったときは隠しiframeを残さない（URLだけ、リンク用に残す）
      resolve({ ...r, release });
    };
    const onViolation = () => {
      iframe.remove();
      finish({ printed: false, fallbackUrl: url });
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    iframe.onload = () => {
      try {
        const w = iframe.contentWindow;
        if (!w) throw new Error('no window');
        w.addEventListener('afterprint', () => setTimeout(release, 1000));
        w.focus();
        w.print();
        releaseTimer = setTimeout(release, RELEASE_AFTER_PRINT_MS);
        finish({ printed: true, fallbackUrl: null });
      } catch {
        finish({ printed: false, fallbackUrl: url });
      }
    };
    iframe.onerror = () => finish({ printed: false, fallbackUrl: url });
    iframe.src = url;
    document.body.appendChild(iframe);
    // 読み込みが進まない環境向けの保険
    setTimeout(() => finish({ printed: false, fallbackUrl: url }), 8000);
  });
}
