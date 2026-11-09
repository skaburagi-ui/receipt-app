import type { Page } from '../domain/types';
import type { WorkerResponse } from './worker';

/**
 * Web Worker内でPDF生成。進捗とキャンセル（AbortSignal → Worker終了）に対応。
 * Worker非対応環境（Node・テスト）や、Workerを起動できなかった場合は generatePdf（同じスレッド）にフォールバックする。
 */
export function generatePdfInWorker(
  pages: Page[],
  opts: { title?: string; onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const abortError = () =>
    typeof DOMException !== 'undefined' ? new DOMException('PDFの作成を中止しました', 'AbortError') : Object.assign(new Error('PDFの作成を中止しました'), { name: 'AbortError' });
  if (opts.signal?.aborted) return Promise.reject(abortError());
  // 同じスレッドでの生成。pdfkit をメインのバンドルへ入れないよう、必要になった時だけ読み込む。
  const fallback = () => import('./generate').then((m) => m.generatePdf(pages, { title: opts.title, onProgress: opts.onProgress, signal: opts.signal }));
  if (typeof Worker === 'undefined') return fallback();

  return new Promise<Uint8Array>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      fallback().then(resolve, reject);
      return;
    }
    let settled = false;
    let started = false; // 1通でも応答があれば「Workerは動いている」
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      fn();
    };
    const onAbort = () => finish(() => reject(abortError()));
    opts.signal?.addEventListener('abort', onAbort);

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      started = true;
      const m = e.data;
      if (m.type === 'progress') opts.onProgress?.(m.done, m.total);
      else if (m.type === 'done') finish(() => resolve(m.bytes));
      else finish(() => reject(new Error(m.message)));
    };
    worker.onerror = (ev) => {
      ev.preventDefault?.();
      if (!started) {
        // Workerの読込・起動に失敗：同じスレッドで作り直す
        finish(() => fallback().then(resolve, reject));
      } else {
        finish(() => reject(new Error('PDF生成中にエラーが発生しました')));
      }
    };
    worker.postMessage({ pages, title: opts.title });
  });
}
