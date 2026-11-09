import { test } from '@playwright/test';
import { OUT, expect, fillBasic, openAdvanced, shot } from './helpers';

test('不正金額を停止し、保存案内と訂正書面の入力欄をスマホで表示する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await fillBasic(page, { amount: '12000' });
  await expect(page.getByText(/控えの保存：/)).toBeVisible();

  await page.getByLabel('領収金額').fill('12O00');
  await expect(page.getByText(/金額は数字だけで入力してください/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'PDFを保存' })).toBeDisabled();
  await page.getByLabel('領収金額').fill('12000');
  await expect(page.getByRole('button', { name: 'PDFを保存' })).toBeEnabled();

  await openAdvanced(page);
  await page.getByLabel('訂正書面として発行する').check();
  await page.getByLabel('元の領収日').fill('2026-10-01');
  await page.getByLabel('元の領収書番号').fill('R-001');
  await page.getByLabel('訂正内容').fill('誤：10,000円 → 正：12,000円');
  await expect(page.getByText(/元の書類との関連/)).toBeVisible();
  await shot(page, 'fixes-sp-correction.png', true);
  await page.locator('details.advanced .section').filter({ hasText: '訂正書面として' }).screenshot({ path: `${OUT}/fixb-sp-correction-section.png` });
});

test('一括取り込みで301件目以降の除外を確認するまで作成できない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await fillBasic(page);
  await page.getByRole('button', { name: 'まとめて発行' }).click();
  const dialog = page.getByRole('dialog', { name: 'まとめて発行' });
  await dialog.getByRole('button', { name: '次へ：宛先の取り込み' }).click();
  const rows = ['𠮷田商店\t様', ...Array.from({ length: 300 }, (_, i) => `宛先${i + 1}\t様`)].join('\n');
  await dialog.getByLabel(/Excelなどの表をコピーして貼り付け/).fill(rows);
  await dialog.getByRole('button', { name: '貼り付けた内容を取り込む' }).click();
  await dialog.getByRole('button', { name: '次へ：確認' }).click();
  const generate = dialog.getByRole('button', { name: '300件のPDFを作る' });
  await expect(generate).toBeDisabled();
  await expect(dialog.getByText(/残りは読み込んでいません/)).toBeVisible();
  await dialog.getByLabel('301件目以降は含まれないことを理解しました').check();
  await expect(generate).toBeEnabled();
  await shot(page, 'fixes-pc-bulk-truncation.png');
  await expect(dialog.getByText(/「𠮷」は四角く表示される可能性があります/)).toBeVisible();
  await dialog.locator('.modal-body').evaluate((e) => { e.scrollTop = 330; });
  await shot(page, 'fixb-pc-bulk-glyph-row.png');
});

test('スマホ幅：保存案内・印紙税の案内が出力ボタンの上に常設され、入力タブでも文字の警告が見える', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await fillBasic(page, { issuer: '𠮷野商店', amount: '120000' });
  const bar = page.locator('.output-bar');
  // 入力タブのまま、フォントに無い文字の警告が見える
  await expect(page.locator('#pane-input .narrow-only')).toContainText('𠮷');
  await expect(bar.getByText(/控えの保存：/)).toBeVisible();
  await expect(bar.getByText(/収入印紙が必要になる可能性があります/)).toBeVisible();
  // 案内はボタンより上にあり、操作バーは画面の下に収まっている
  const noticeBox = (await bar.locator('.save-notice').boundingBox())!;
  const buttonBox = (await bar.getByRole('button', { name: 'PDFを保存' }).boundingBox())!;
  expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(buttonBox.y + 1);
  const barBox = (await bar.boundingBox())!;
  expect(Math.round(barBox.y + barBox.height)).toBe(844);
  // 末尾のフッターが操作バーに隠れない
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const foot = (await page.locator('footer').boundingBox())!;
  expect(foot.y + foot.height).toBeLessThanOrEqual(barBox.y + 1);
  await shot(page, 'fixb-sp-notices.png');
  await bar.locator('.save-notice summary').click();
  await expect(bar.getByText(/保存は、利用者の責任/)).toBeVisible();
  await shot(page, 'fixb-sp-notices-open.png');
});

test('PC幅：保存案内・印紙税の案内・税抜入力・訂正欄', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await fillBasic(page, { amount: '100000' });
  await page.getByLabel(/税抜（消費税は別）/).check();
  await expect(page.getByLabel('税抜金額')).toBeVisible();
  await expect(page.getByText(/領収金額（税込）は 110,000円/).first()).toBeVisible();
  const bar = page.locator('.output-bar');
  await expect(bar.getByText(/収入印紙が必要になる可能性があります/)).toBeVisible();
  await openAdvanced(page);
  await page.getByLabel('支払方法（印紙税の目安用）').selectOption('creditCard');
  await expect(page.getByText(/書面にその支払方法を書くかで印紙税の扱いが変わります/)).toBeVisible();
  await expect(page.getByLabel('支払方法を領収書に表示する')).not.toBeChecked();
  await page.getByLabel('訂正書面として発行する').check();
  await page.getByLabel('元の領収日').fill('2026-10-01');
  await page.getByLabel('元の領収書番号').fill('R-001');
  await page.getByLabel('訂正内容').fill('誤：100,000円 → 正：110,000円');
  await shot(page, 'fixb-pc-full.png', true);
  await page.getByRole('button', { name: '印刷', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: '印刷する前に' });
  await expect(dlg.getByText(/収入印紙が必要になる可能性があります/)).toBeVisible();
  await dlg.getByText('環境別の印刷手順').click();
  await expect(dlg.getByText('お使いの環境の表記は異なる場合があります。', { exact: false })).toBeVisible();
  await shot(page, 'fixb-pc-print-guide.png');
});

test('下書き：復元すると確認チェックが外れる／すべて削除で自動保存がOFFになる', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await fillBasic(page);
  await page.getByLabel('この端末に下書きを保存する').click();
  await page.getByRole('button', { name: '理解した上でONにする' }).click();
  await page.locator('.mode-selector').getByLabel('はい', { exact: true }).first().check();
  await page.getByLabel(/入力した登録番号は私自身のものです/).check();
  await page.waitForTimeout(2000);
  await page.reload();
  await page.getByRole('button', { name: '読み込む' }).first().click();
  await expect(page.getByText(/確認チェックは、安全のため外しました/)).toBeVisible();
  await expect(page.getByLabel(/入力した登録番号は私自身のものです/)).not.toBeChecked();
  await page.getByRole('button', { name: 'すべて削除' }).click();
  await expect(page.getByText(/自動保存もOFFにしました/)).toBeVisible();
  await expect(page.getByLabel('この端末に下書きを保存する')).not.toBeChecked();
  await page.waitForTimeout(2000);
  await expect(page.getByRole('button', { name: 'すべて削除' })).toBeDisabled(); // 下書きは復活していない
});

test('スマホ幅：一括の手順3に、未収録文字の行の警告と取り込みの警告が出る', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await fillBasic(page);
  await page.getByRole('button', { name: 'まとめて発行' }).click();
  const dialog = page.getByRole('dialog', { name: 'まとめて発行' });
  await dialog.getByRole('button', { name: '次へ：宛先の取り込み' }).click();
  const rows = ['𠮷田商店', ...Array.from({ length: 300 }, (_, i) => `宛先${i + 1}`)].join('\n');
  await dialog.getByLabel(/Excelなどの表をコピーして貼り付け/).fill(rows);
  await dialog.getByRole('button', { name: '貼り付けた内容を取り込む' }).click();
  await dialog.getByRole('button', { name: '次へ：確認' }).click();
  await expect(dialog.getByText(/「𠮷」は四角く表示される可能性があります/)).toBeVisible();
  await expect(dialog.getByLabel('301件目以降は含まれないことを理解しました')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '300件のPDFを作る' })).toBeDisabled();
  await shot(page, 'fixb-sp-bulk-warnings.png');
  await dialog.locator('.modal-body').evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await shot(page, 'fixb-sp-bulk-warnings-table.png');
});
