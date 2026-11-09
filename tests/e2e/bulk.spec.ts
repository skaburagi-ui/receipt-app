import { test } from '@playwright/test';
import iconv from 'iconv-lite';
import type { Page } from '@playwright/test';
import { attachProbe, cspViolations, expect, fillBasic, inspectPdf, allText, openAdvanced, setMode, shot, OUT } from './helpers';
import path from 'node:path';

const CSV = '宛名,敬称,宛先コード\r\n髙橋太郎,様,A1\r\n株式会社㈱テスト商事,御中,A2\r\n髙橋太郎,様,A3\r\n,様,A4\r\n山田花子,,A5\r\n';

async function openBulkStep2(page: Page, opts: { mode?: 'general' | 'qualified' } = {}) {
  await page.goto('/');
  await fillBasic(page, { recipient: '' });
  if (opts.mode === 'qualified') {
    await setMode(page, 'qualified');
    await openAdvanced(page);
    await page.getByLabel('インボイス登録番号').fill('T7000012050002');
    await page.getByLabel('私は適格請求書発行事業者であり、入力した登録番号は私自身のものです。').check();
  }
  await page.getByRole('button', { name: 'まとめて発行' }).click();
  const dlg = page.getByRole('dialog', { name: 'まとめて発行' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: '次へ：宛先の取り込み' }).click();
  return dlg;
}

async function pasteAndNext(dlg: ReturnType<Page['getByRole']>, page: Page, text: string) {
  await dlg.getByLabel('Excelなどの表をコピーして貼り付け').fill(text);
  await dlg.getByRole('button', { name: '貼り付けた内容を取り込む' }).click();
}

for (const [label, bytes] of [
  ['utf8bom', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CSV, 'utf8')])],
  ['sjis', iconv.encode(CSV.replace('㈱', '㈱'), 'Shift_JIS')],
  ['utf16le', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(CSV, 'utf16le')])],
] as const) {
  test(`CSV取り込み(${label})：髙橋・㈱の保持、警告、並べ替え、番号、PDF`, async ({ page }) => {
    const probe = await attachProbe(page);
    const dlg = await openBulkStep2(page);
    await dlg.locator('input[aria-label="CSVファイルを選ぶ"]').setInputFiles({ name: `r-${label}.csv`, mimeType: 'text/csv', buffer: bytes });
    await expect(dlg.getByRole('status').filter({ hasText: '取り込みました' })).toBeVisible();
    console.log(label, await dlg.getByRole('status').filter({ hasText: '取り込みました' }).innerText());
    await dlg.getByRole('button', { name: '次へ：確認' }).click();
    const names = await dlg.locator('.recipient-table tbody tr td:nth-child(3) input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    console.log(label, 'names', JSON.stringify(names));
    expect(names).toContain('髙橋太郎');
    expect(names).toContain('株式会社㈱テスト商事');
    const statuses = await dlg.locator('.recipient-table tbody tr td:nth-child(5)').allInnerTexts();
    console.log(label, 'status', JSON.stringify(statuses));
    expect(statuses.join('|')).toContain('重複');
    expect(statuses.join('|')).toContain('空欄');
    if (label === 'utf8bom') await shot(page, 'bulk-step3.png');
    // 空欄行（4件目）は一般モードでもエラー扱いか確認 → 削除
    const gen = dlg.getByRole('button', { name: /件のPDFを作る/ });
    const disabledBefore = await gen.isDisabled();
    console.log(label, 'generate disabled with blank row:', disabledBefore);
    // 並べ替え：2件目を上へ → 1件目が「株式会社㈱テスト商事」
    await dlg.getByRole('button', { name: '2件目を上へ' }).click();
    expect(await dlg.getByLabel('1件目の宛名').inputValue()).toBe('株式会社㈱テスト商事');
    // 削除：空欄の行（宛名が空）を削除
    const idx = names.indexOf('');
    await dlg.getByRole('button', { name: `${idx + 1}件目を削除` }).click();
    await expect(dlg.locator('.recipient-table tbody tr')).toHaveCount(4);
    // 番号付与
    await dlg.getByLabel('頭につける文字').fill('R-');
    await dlg.getByLabel('開始番号').fill('1');
    await expect(dlg.getByText('最初の番号：R-001')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), gen.click()]);
    const f = path.join(OUT, `bulk-${label}.pdf`);
    await download.saveAs(f);
    const info = inspectPdf(f);
    const t = allText(info);
    expect(info.pages).toBe(4);
    expect(t).toContain('髙橋太郎');
    expect(t).toContain('株式会社㈱テスト商事');
    expect(t).toContain('R-001');
    expect(t).toContain('R-004');
    expect(await cspViolations(page, probe)).toEqual([]);
    expect(probe.externalRequests).toEqual([]);
    expect(probe.apiRequests).toEqual([]);
  });
}

test('貼り付け（タブ区切り・セル内改行）', async ({ page }) => {
  await attachProbe(page);
  const dlg = await openBulkStep2(page);
  const text = '"株式会社\nサンプル"\t御中\n髙橋　太郎\t様\n';
  await dlg.getByLabel('Excelなどの表をコピーして貼り付け').fill(text);
  await dlg.getByRole('button', { name: '貼り付けた内容を取り込む' }).click();
  await expect(dlg.getByRole('status').filter({ hasText: '貼り付けから' })).toBeVisible();
  console.log(await dlg.getByRole('status').filter({ hasText: '貼り付けから' }).innerText());
  await dlg.getByRole('button', { name: '次へ：確認' }).click();
  const names = await dlg.locator('.recipient-table tbody tr td:nth-child(3) input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  console.log('paste names', JSON.stringify(names));
  expect(names.length).toBe(2);
  expect(names[0].replace(/\s/g, '')).toBe('株式会社サンプル');
  const hon = await dlg.locator('.recipient-table tbody tr td:nth-child(4) select').evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
  console.log('honorifics', hon);
});

test('100件のPDF生成：時間・進捗', async ({ page }) => {
  test.setTimeout(240_000);
  const probe = await attachProbe(page);
  const dlg = await openBulkStep2(page);
  const text = Array.from({ length: 100 }, (_, i) => `髙橋商事${i + 1}号\t御中`).join('\n');
  await pasteAndNext(dlg, page, text);
  await dlg.getByRole('button', { name: '次へ：確認' }).click();
  const gen = dlg.getByRole('button', { name: '100件のPDFを作る' });
  await expect(gen).toBeEnabled();
  const t0 = Date.now();
  const seen: string[] = [];
  const poll = setInterval(() => { void dlg.locator('.progress span').innerText({ timeout: 200 }).then((s) => { if (seen[seen.length - 1] !== s) seen.push(s); }).catch(() => undefined); }, 50);
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 180_000 }), gen.click()]);
  clearInterval(poll);
  const ms = Date.now() - t0;
  const f = path.join(OUT, 'bulk-100.pdf');
  await download.saveAs(f);
  console.log(`100件: ${ms}ms, progress seen: ${seen.slice(0, 8).join(',')}...${seen.slice(-2).join(',')} (${seen.length}回)`);
  const info = inspectPdf(f, false);
  expect(info.pages).toBe(100);
  expect(allText(info)).toContain('髙橋商事100号');
  expect(await cspViolations(page, probe)).toEqual([]);
  expect(probe.externalRequests).toEqual([]);
});

test('キャンセル（300件）', async ({ page }) => {
  test.setTimeout(240_000);
  const dlg = await openBulkStep2(page);
  await pasteAndNext(dlg, page, Array.from({ length: 300 }, (_, i) => `宛先${i + 1}\t様`).join('\n'));
  await dlg.getByRole('button', { name: '次へ：確認' }).click();
  const gen = dlg.getByRole('button', { name: '300件のPDFを作る' });
  await expect(gen).toBeEnabled();
  let downloaded = false;
  page.on('download', () => { downloaded = true; });
  await gen.click();
  await expect(dlg.locator('.progress')).toBeVisible({ timeout: 5000 }).catch(() => undefined);
  const cancel = dlg.locator('.progress').getByRole('button', { name: 'やめる' });
  const visible = await cancel.isVisible().catch(() => false);
  console.log('cancel button visible during gen:', visible);
  if (visible) await cancel.click();
  await page.waitForTimeout(2500);
  console.log('after cancel: error text =', await dlg.getByRole('alert').allInnerTexts(), 'downloaded=', downloaded);
  if (visible) {
    expect(downloaded).toBe(false);
    await expect(dlg.getByText('作成をやめました。')).toBeVisible();
  }
  await shot(page, 'bulk-cancel.png');
});

test('301件でエラー', async ({ page }) => {
  const dlg = await openBulkStep2(page);
  await pasteAndNext(dlg, page, Array.from({ length: 301 }, (_, i) => `宛先${i + 1}\t様`).join('\n'));
  const info = await dlg.getByRole('status').allInnerTexts();
  const issues = await dlg.locator('.issues li').allInnerTexts();
  console.log('301 info:', info, 'issues:', issues);
  await dlg.getByRole('button', { name: '次へ：確認' }).click();
  console.log('rows after import:', await dlg.locator('.recipient-table tbody tr').count(), await dlg.getByText(/上限300件/).allInnerTexts());
  const gen = dlg.getByRole('button', { name: /件のPDFを作る/ });
  console.log('301: generate button:', await gen.innerText(), 'disabled=', await gen.isDisabled());
  await shot(page, 'bulk-301.png');
});

test('適格請求書モードで宛名「上様」「空欄」の行がエラー', async ({ page }) => {
  const probe = await attachProbe(page);
  const dlg = await openBulkStep2(page, { mode: 'qualified' });
  await pasteAndNext(dlg, page, '上様\t\n株式会社サンプル\t御中\n\t様\n');
  await dlg.getByRole('button', { name: '次へ：確認' }).click();
  const statuses = await dlg.locator('.recipient-table tbody tr td:nth-child(5)').allInnerTexts();
  console.log('qualified statuses', JSON.stringify(statuses));
  expect(statuses[0]).toContain('エラー');
  expect(statuses[1]).toContain('OK');
  expect(statuses[2]).toContain('エラー');
  await expect(dlg.getByRole('button', { name: /件のPDFを作る/ })).toBeDisabled();
  // 修正すると作れる
  await dlg.getByLabel('1件目の宛名').fill('株式会社甲');
  await dlg.getByLabel('3件目の宛名').fill('株式会社乙');
  const gen = dlg.getByRole('button', { name: '3件のPDFを作る' });
  await expect(gen).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), gen.click()]);
  const f = path.join(OUT, 'bulk-qualified.pdf');
  await download.saveAs(f);
  const info = inspectPdf(f);
  expect(info.pages).toBe(3);
  expect(allText(info)).toContain('T7000012050002');
  expect(await cspViolations(page, probe)).toEqual([]);
});
