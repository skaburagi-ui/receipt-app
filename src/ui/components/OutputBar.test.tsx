// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultReceipt } from '../../domain/defaults';
import { createDefaultDesign } from '../defaults';

const { release, printPdfBlob } = vi.hoisted(() => ({
  release: vi.fn(),
  printPdfBlob: vi.fn(async () => ({ printed: false, fallbackUrl: 'blob:fallback', release: vi.fn() })),
}));

vi.mock('../output', () => ({
  canShareFile: vi.fn(() => false),
  downloadBlob: vi.fn(),
  pdfBlob: vi.fn(() => new Blob(['pdf'], { type: 'application/pdf' })),
  printPdfBlob,
  shareFile: vi.fn(),
}));
vi.mock('../pipeline', () => ({
  buildPages: vi.fn(() => ({ pages: [{ widthMm: 210, heightMm: 297, ops: [] }], overflow: false })),
  pdfFileName: vi.fn(() => '領収書.pdf'),
}));
vi.mock('../../pdf/workerClient', () => ({
  generatePdfInWorker: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));

import { OutputBar } from './OutputBar';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OutputBarの印刷失敗', () => {
  it('失敗案内だけを表示し、成功案内は表示しない', async () => {
    printPdfBlob.mockResolvedValueOnce({ printed: false, fallbackUrl: 'blob:fallback', release });
    const receipt = createDefaultReceipt('2026-11-06');
    receipt.issuer.name = '山田商店';
    receipt.recipient.name = '山田太郎';
    receipt.tax.items[0].amountYen = 1000;
    render(
      <OutputBar
        receipt={receipt}
        design={createDefaultDesign()}
        issues={[]}
        preview={{ status: 'ok', svg: '<svg/>', pageCount: 1, overflow: false, widthMm: 210, heightMm: 297 }}
        onSwitchToGeneral={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '印刷' }));
    fireEvent.click(screen.getByRole('button', { name: '印刷画面を開く' }));

    expect(await screen.findByRole('heading', { name: '印刷画面を開けませんでした' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '印刷を開始しました' })).toBeNull();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
  });
});
