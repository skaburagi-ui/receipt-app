import { test } from '@playwright/test';
import { attachProbe, cspViolations, expect, fillBasic, inspectPdf, allText, openAdvanced, savePdf, setMode, shot } from './helpers';

const REG = 'T7000012050002';
const saveBtn = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'PDFを保存', exact: true });

test('適格請求書モード：必須が欠けるとPDF無効→そろえると有効→PDF内容', async ({ page }) => {
  const probe = await attachProbe(page);
  await page.goto('/');
  await fillBasic(page, { recipient: '', proviso: '' });
  await setMode(page, 'qualified');
  await openAdvanced(page);
  await expect(saveBtn(page)).toBeDisabled();
  await shot(page, 'qualified-disabled.png');
  // 宛名・但し書き・登録番号・確認チェックが欠けている
  await page.getByLabel('宛名（領収書を受け取る人・会社）').fill('上様');
  await expect(saveBtn(page)).toBeDisabled(); // 「上様」は不可
  await page.getByLabel('宛名（領収書を受け取る人・会社）').fill('株式会社サンプル');
  await page.getByLabel('但し書き').fill('システム開発費として');
  await expect(saveBtn(page)).toBeDisabled(); // 登録番号なし
  await page.getByLabel('インボイス登録番号').fill('Ｔ７０００−０１２０−５０００２'); // 全角・ハイフン
  await page.getByLabel('インボイス登録番号').blur();
  await expect(page.getByLabel('インボイス登録番号')).toHaveValue(REG);
  await expect(saveBtn(page)).toBeDisabled(); // 「私自身」チェックなし
  await page.getByLabel('私は適格請求書発行事業者であり、入力した登録番号は私自身のものです。').check();
  await expect(saveBtn(page)).toBeEnabled();
  // 税率別：8%の明細を追加
  await page.getByRole('button', { name: '＋ 品目を追加' }).click();
  await page.getByLabel('品目 1', { exact: true }).fill('宿泊');
  await page.getByLabel('金額 1（税込）').fill('11000');
  await page.getByLabel('品目 2', { exact: true }).fill('朝食');
  await page.getByLabel('金額 2（税込）').fill('5400');
  await page.getByLabel('税区分 2').selectOption('taxable8');
  await expect(saveBtn(page)).toBeEnabled();
  await shot(page, 'qualified-enabled.png', true);
  const f = await savePdf(page, 'qualified.pdf');
  const info = inspectPdf(f);
  const t = allText(info);
  console.log(t.replace(/\n/g, ' | '));
  expect(info.pages).toBe(1);
  expect(t).toContain(REG);
  expect(t).toContain('株式会社サンプル');
  expect(t).toContain('適格請求書');
  expect(t).toMatch(/取引日|2026年/);
  expect(t).toContain('10%');
  expect(t).toContain('8%');
  expect(t).toContain('※');
  expect(t).toContain('髙﨑邉㈱①');
  expect(await cspViolations(page, probe)).toEqual([]);
  expect(probe.externalRequests).toEqual([]);

  // 一般モードへ戻す：登録番号は入力済みのまま。PDFに登録番号・「インボイス」が出ない
  await setMode(page, 'general');
  await expect(saveBtn(page)).toBeEnabled();
  const g = inspectPdf(await savePdf(page, 'general-after-qualified.pdf'));
  const gt = allText(g);
  console.log('GENERAL:', gt.replace(/\n/g, ' | '));
  expect(gt).not.toContain('T7000');
  expect(gt).not.toContain('7000012050002');
  expect(gt).not.toContain('インボイス');
  expect(gt).not.toContain('登録番号');
  expect(gt).toContain('適格請求書ではありません'); // 仕様の注記（既定ON）
  // 注記をOFFにすると「適格」の語も出ない
  await page.getByLabel('「この領収書は適格請求書（インボイス）ではありません」と小さく表示する').uncheck();
  const g2 = inspectPdf(await savePdf(page, 'general-no-notice.pdf'));
  expect(allText(g2)).not.toMatch(/適格|インボイス|登録番号|T7000/);
});

test('簡易インボイス：宛名なしで可、確認2つ必須', async ({ page }) => {
  await attachProbe(page);
  await page.goto('/');
  await fillBasic(page, { recipient: '' });
  await setMode(page, 'simple');
  await openAdvanced(page);
  await page.getByLabel('インボイス登録番号').fill(REG);
  await expect(saveBtn(page)).toBeDisabled();
  await page.getByLabel('私は適格請求書発行事業者であり、入力した登録番号は私自身のものです。').check();
  await expect(saveBtn(page)).toBeDisabled();
  await page.getByLabel('私の事業は上記に該当することを確認しました。（該当の判断は利用者ご自身の責任です。）').check();
  await expect(saveBtn(page)).toBeEnabled();
  await saveBtn(page).click();
  // 宛名なしなのでモードは qualifiedSimple ＝ 宛名空欄の確認は一般モードのみ
  const dl = await page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
  expect(dl).not.toBeNull();
  const f = 'D:/Temp/claude/fixb-out/simple.pdf';
  await dl!.saveAs(f);
  const info = inspectPdf(f);
  const t = allText(info);
  console.log('SIMPLE:', t.replace(/\n/g, ' | '));
  expect(t).toContain(REG);
  expect(t).toMatch(/簡易/);
  expect(t).toMatch(/10%|税率/);
  await shot(page, 'simple-after.png');
});

test('一般モード：宛名が空欄だと確認ダイアログ', async ({ page }) => {
  await attachProbe(page);
  await page.goto('/');
  await fillBasic(page, { recipient: '' });
  await saveBtn(page).click();
  await expect(page.getByRole('dialog', { name: '宛名が空欄です' })).toBeVisible();
  await page.getByRole('button', { name: '宛名なしで進む' }).click();
  await expect(page.getByRole('dialog', { name: 'PDFを保存しました' })).toBeVisible({ timeout: 20_000 });
});
