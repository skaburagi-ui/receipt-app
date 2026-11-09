import { test } from '@playwright/test';
import { attachProbe, cspViolations, expect, fillBasic, inspectPdf, allText, makePng, openAdvanced, savePdf, shot } from './helpers';

const FORMATS = [
  { id: 'A4 1件', pages: 1, w: 210, h: 297 },
  { id: 'A5 1件', pages: 1, w: 210, h: 148 },
  { id: 'A4 2件（上下）', pages: 1, w: 210, h: 297 },
  { id: 'A4 領収書＋控え', pages: 1, w: 210, h: 297 },
];
const DESIGNS = ['シンプル', 'ビジネス', 'カジュアル'];

test('デザイン3種×印刷形式4種（角印・ロゴ・印紙欄つき）', async ({ page }) => {
  test.setTimeout(240_000);
  const probe = await attachProbe(page);
  await page.goto('/');
  await fillBasic(page, { issuer: '株式会社山田商店', amount: '55000' });
  await openAdvanced(page);
  await page.getByLabel('住所').fill('東京都千代田区千代田1-1');
  await page.getByLabel('郵便番号').fill('100-0001');
  await page.getByLabel('電話番号').fill('03-1234-5678');
  await page.getByLabel('収入印紙を貼る欄を表示する').check();
  // ロゴ（PNG透過）
  await page.locator('#logo-file').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: makePng(200) });
  await expect(page.getByAltText('ロゴ')).toBeVisible();
  // 角印（アプリ内作成）
  await page.getByLabel('角印（会社印・店の印）を領収書に表示する').check();
  await page.getByLabel('角印の文字（最大12字）').fill('株式会社山田商店');
  await expect(page.locator('.seal-preview svg')).toBeVisible();
  for (const d of DESIGNS) {
    await page.getByLabel(d).first().check();
    for (const f of FORMATS) {
      await page.locator('.preview select').selectOption({ label: f.id });
      await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled();
      await page.waitForTimeout(300);
      const name = `design-${d}-${f.id.replace(/[ （）＋]/g, '')}.pdf`;
      const info = inspectPdf(await savePdf(page, name));
      const t = allText(info);
      console.log(d, f.id, info.pages, info.sizes.map((s) => `${s.wMm}x${s.hMm}`).join(','), 'stampbox=', t.includes('収入印紙'), 'copy=', t.includes('控'));
      expect(info.pages).toBe(f.pages);
      expect(info.sizes[0].wMm).toBeCloseTo(f.w, 0);
      expect(info.sizes[0].hMm).toBeCloseTo(f.h, 0);
      expect(t).toContain('株式会社山田商店');
      expect(t).toContain('収入印紙');
      if (f.id.includes('控')) expect(t).toContain('控');
    }
  }
  await shot(page, 'designs-last.png', true);
  expect(await cspViolations(page, probe)).toEqual([]);
  expect(probe.externalRequests).toEqual([]);
});

test('角印：アプリ内作成12字と画像アップロード（PNG透過）', async ({ page }) => {
  const probe = await attachProbe(page);
  await page.goto('/');
  await fillBasic(page);
  await openAdvanced(page);
  await page.getByLabel('角印（会社印・店の印）を領収書に表示する').check();
  await page.getByLabel('角印の文字（最大12字）').fill('山田太郎商店本店東京都新');
  await expect(page.locator('.seal-preview svg')).toBeVisible();
  await expect(page.locator('.seal-preview svg path[fill]:not([fill="none"])')).toHaveCount(12);
  const a = inspectPdf(await savePdf(page, 'seal-yamada.pdf'));
  expect(a.pages).toBe(1);
  await page.getByLabel('画像をアップロード').check();
  await page.locator('#seal-file').setInputFiles({ name: 'seal.png', mimeType: 'image/png', buffer: makePng(240) });
  await expect(page.getByAltText('角印の画像')).toBeVisible();
  const b = inspectPdf(await savePdf(page, 'seal-image.pdf'));
  expect(b.pages).toBe(1);
  await shot(page, 'seal-image-ui.png');
  expect(await cspViolations(page, probe)).toEqual([]);
  expect(probe.externalRequests).toEqual([]);
});

test('試し刷りページ（PDF保存）', async ({ page }) => {
  const probe = await attachProbe(page);
  await page.goto('/');
  await page.getByRole('button', { name: '試し刷りページ' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: '試し刷りPDFを保存' }).click()]);
  await dl.saveAs('D:/Temp/claude/fixb-out/testprint.pdf');
  const info = inspectPdf('D:/Temp/claude/fixb-out/testprint.pdf');
  console.log('testprint', info.pages, info.sizes.map((s) => `${s.wMm}x${s.hMm}`), allText(info).slice(0, 200).replace(/\n/g, '|'));
  expect(info.pages).toBeGreaterThanOrEqual(1);
  expect(await cspViolations(page, probe)).toEqual([]);
});

test('PDF生成：Web Worker経由／メインスレッドへのフォールバック', async ({ browser }) => {
  // Worker経由
  const ctx1 = await browser.newContext({ acceptDownloads: true });
  const p1 = await ctx1.newPage();
  const probe1 = await attachProbe(p1);
  let workers = 0;
  p1.on('worker', () => workers++);
  await p1.goto('/');
  await fillBasic(p1);
  const f1 = await savePdf(p1, 'via-worker.pdf');
  expect(workers).toBeGreaterThan(0);
  expect(inspectPdf(f1, false).pages).toBe(1);
  expect(await cspViolations(p1, probe1)).toEqual([]);
  await ctx1.close();
  // Worker 無効（undefined）→ フォールバック
  const ctx2 = await browser.newContext({ acceptDownloads: true });
  const p2 = await ctx2.newPage();
  const probe2 = await attachProbe(p2);
  await p2.addInitScript(() => { delete (window as unknown as { Worker?: unknown }).Worker; });
  let workers2 = 0;
  p2.on('worker', () => workers2++);
  await p2.goto('/');
  await fillBasic(p2);
  const f2 = await savePdf(p2, 'via-mainthread.pdf');
  expect(workers2).toBe(0);
  expect(allText(inspectPdf(f2, false))).toContain('髙﨑邉㈱①');
  expect(await cspViolations(p2, probe2)).toEqual([]);
  await ctx2.close();
  // Worker のスクリプトが読み込めない（404）→ フォールバック
  const ctx3 = await browser.newContext({ acceptDownloads: true });
  const p3 = await ctx3.newPage();
  await attachProbe(p3);
  await p3.route('**/assets/worker-*.js', (r) => r.fulfill({ status: 404, body: 'x' }));
  await p3.goto('/');
  await fillBasic(p3);
  const f3 = await savePdf(p3, 'via-worker-failed.pdf');
  expect(allText(inspectPdf(f3, false))).toContain('髙﨑邉㈱①');
  await ctx3.close();
});
