/// <reference lib="webworker" />
import type { Page } from '../domain/types';
import { generatePdf } from './generate';

/**
 * PDF生成Worker。メインスレッドから { pages, title } を受け取り、進捗（progress）と結果（done）／失敗（error）を返す。
 * フォントは fontLoader が fetch('/fonts/...') で取得する（同一オリジンのみ。CSP connect-src 'self' の範囲）。
 */
export type WorkerRequest = { pages: Page[]; title?: string };
export type WorkerResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; bytes: Uint8Array }
  | { type: 'error'; message: string };

const ctx = self as unknown as { postMessage(m: WorkerResponse, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null };

ctx.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const bytes = await generatePdf(e.data.pages, {
      title: e.data.title,
      onProgress: (done, total) => ctx.postMessage({ type: 'progress', done, total }),
    });
    ctx.postMessage({ type: 'done', bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
