// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printPdfBlob } from './output';

describe('printPdfBlob', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:print-test');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('印刷開始後にreleaseするとiframeと一時URLを解放する', async () => {
    const pending = printPdfBlob(new Blob(['pdf'], { type: 'application/pdf' }));
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    iframe.contentWindow!.focus = vi.fn();
    iframe.contentWindow!.print = vi.fn();
    iframe.onload?.(new Event('load'));

    const result = await pending;
    expect(result.printed).toBe(true);
    expect(result.fallbackUrl).toBeNull();
    result.release();
    expect(document.querySelector('iframe')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:print-test');
  });

  it('印刷失敗時は案内用URLをreleaseまで保持する', async () => {
    const pending = printPdfBlob(new Blob(['pdf'], { type: 'application/pdf' }));
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    iframe.onerror?.(new Event('error'));

    const result = await pending;
    expect(result).toMatchObject({ printed: false, fallbackUrl: 'blob:print-test' });
    expect(document.querySelector('iframe')).toBeNull();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    result.release();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:print-test');
  });
});
