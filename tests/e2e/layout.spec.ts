import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { attachProbe, cspViolations, expect, fillBasic, openAdvanced, savePdf, setMode, shot } from './helpers';

/** 画面に見えている操作要素のうち、44px未満のもの（幅または高さ）を列挙。 */
async function smallTargets(page: Page, scope = 'body') {
  return page.evaluate((sc) => {
    const out: string[] = [];
    const root = document.querySelector(sc)!;
    const sel = 'button, a[href], select, input:not([type=hidden]):not([type=file]), textarea, summary, [role=tab], label';
    root.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (el.tagName === 'LABEL') {
        // チェックボックス・ラジオの文字ラベルのみ対象（入力欄の見出しラベルは対象外）
        const f = (el as HTMLLabelElement).control as HTMLInputElement | null;
        if (!f || !(f.type === 'checkbox' || f.type === 'radio')) return;
      }
      if (el.tagName === 'INPUT') {
        const t = (el as HTMLInputElement).type;
        if ((t === 'checkbox' || t === 'radio')) {
          // 入力本体 or 付属ラベルのどちらかが44px以上なら可
          const lab = (el as HTMLInputElement).labels?.[0]?.getBoundingClientRect();
          if (lab && lab.height >= 44) return;
        }
      }
      if (r.width < 44 || r.height < 44) out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}[${(el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).type || '').trim().slice(0, 24)}] ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return out;
  }, scope);
}

const noHScroll = (page: Page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));

test('スマホ幅 390×844：切替・固定バー・横スクロール・タップ領域', async ({ page }) => {
  const probe = await attachProbe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await fillBasic(page, { issuer: '髙﨑邉㈱①', amount: '12345' });
  await page.waitForTimeout(500);
  // 入力タブ
  await expect(page.locator('#pane-input')).toBeVisible();
  await expect(page.locator('#pane-preview')).toBeHidden();
  console.log('sp input scroll', await noHScroll(page));
  await shot(page, 'sp-input-top.png');
  await shot(page, 'sp-input-full.png', true);
  expect(await smallTargets(page), 'sp small targets (input tab):').toEqual([]); // M-2: タップ領域は44px以上
  // 固定の操作バー
  const bar = page.locator('.output-bar');
  const bb = await bar.boundingBox();
  console.log('sp output-bar', JSON.stringify(bb));
  expect(Math.round(bb!.y + bb!.height)).toBe(844);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(200);
  const bb2 = await bar.boundingBox();
  expect(Math.round(bb2!.y + bb2!.height)).toBe(844);
  // 最下部のフッターが操作バーに隠れていないか
  const foot = await page.locator('footer').boundingBox();
  console.log('sp footer bottom', foot && Math.round(foot.y + foot.height), 'bar top', Math.round(bb2!.y));
  // 回帰：フッターの最下行が固定バーに隠れない
  expect(foot!.y + foot!.height).toBeLessThanOrEqual(bb2!.y + 1);
  await shot(page, 'sp-input-bottom.png');
  // プレビュータブ
  await page.getByRole('tab', { name: 'プレビュー' }).click();
  await expect(page.locator('#pane-preview')).toBeVisible();
  await expect(page.locator('#pane-input')).toBeHidden();
  await page.evaluate(() => window.scrollTo(0, 0));
  console.log('sp preview scroll', await noHScroll(page));
  await shot(page, 'sp-preview.png');
  expect(await smallTargets(page), 'sp small targets (preview tab):').toEqual([]); // M-2: タップ領域は44px以上
  // プレビューが画面幅に収まる
  const pv = await page.locator('.receipt-svg').boundingBox();
  console.log('sp preview svg box', JSON.stringify(pv));
  expect(pv!.x + pv!.width).toBeLessThanOrEqual(391);
  // 詳細設定を開く（入力タブ）
  await page.getByRole('tab', { name: '入力' }).click();
  await openAdvanced(page);
  await page.getByLabel('収入印紙を貼る欄を表示する').check();
  console.log('sp advanced scroll', await noHScroll(page));
  await shot(page, 'sp-advanced-full.png', true);
  expect(await smallTargets(page), 'sp small targets (advanced):').toEqual([]); // M-2: タップ領域は44px以上
  // 適格請求書モードの項目（品目追加）
  await setMode(page, 'qualified');
  await page.getByRole('button', { name: '＋ 品目を追加' }).click();
  console.log('sp qualified scroll', await noHScroll(page));
  await shot(page, 'sp-qualified-full.png', true);
  // モーダル：印刷案内
  await setMode(page, 'general');
  await page.getByRole('button', { name: '印刷', exact: true }).click();
  await shot(page, 'sp-print-guide.png');
  console.log('sp modal scroll', await noHScroll(page));
  expect(await smallTargets(page, '.modal'), 'sp modal small').toEqual([]); // M-2
  await page.getByRole('button', { name: 'やめる' }).click();
  // PDF（スマホ幅）
  const f = await savePdf(page, 'sp-final.pdf');
  expect(f).toContain('sp-final');
  await shot(page, 'sp-after-save.png');
  // 一括ダイアログ（スマホ）
  await page.getByRole('button', { name: 'まとめて発行' }).click();
  const dlg = page.getByRole('dialog', { name: 'まとめて発行' });
  await shot(page, 'sp-bulk-1.png');
  await dlg.getByRole('button', { name: '次へ：宛先の取り込み' }).click();
  await dlg.getByLabel('Excelなどの表をコピーして貼り付け').fill('髙橋商事株式会社\t御中\n山田太郎\t様\n株式会社ABC');
  await dlg.getByRole('button', { name: '貼り付けた内容を取り込む' }).click();
  await shot(page, 'sp-bulk-2.png');
  await dlg.getByRole('button', { name: '次へ：確認' }).click();
  console.log('sp bulk scroll', await noHScroll(page), await dlg.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth })));
  await shot(page, 'sp-bulk-3.png');
  // 回帰：スマホ幅でも宛名の入力欄が使える幅（表は横スクロール）
  expect((await dlg.getByLabel('1件目の宛名').boundingBox())!.width).toBeGreaterThanOrEqual(120);
  expect(await smallTargets(page, '.modal'), 'sp bulk small').toEqual([]); // M-2
  expect(await cspViolations(page, probe)).toEqual([]);
});

test('PC幅 1280×800：2カラム・プレビュー・横スクロール', async ({ page }) => {
  const probe = await attachProbe(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await fillBasic(page, { issuer: '髙﨑邉㈱①' });
  await page.waitForTimeout(500);
  await expect(page.locator('#pane-input')).toBeVisible();
  await expect(page.locator('#pane-preview')).toBeVisible();
  console.log('pc scroll', await noHScroll(page));
  await shot(page, 'pc-top.png');
  await shot(page, 'pc-full.png', true);
  await openAdvanced(page);
  await shot(page, 'pc-advanced-full.png', true);
  expect(await smallTargets(page), 'pc small targets:').toEqual([]); // M-2: タップ領域は44px以上
  await page.getByRole('button', { name: 'まとめて発行' }).click();
  const dlg = page.getByRole('dialog', { name: 'まとめて発行' });
  await dlg.getByRole('button', { name: '次へ：宛先の取り込み' }).click();
  await dlg.getByLabel('Excelなどの表をコピーして貼り付け').fill('髙橋商事株式会社\t御中\n山田太郎\t様\n\n山田太郎\t様');
  await dlg.getByRole('button', { name: '貼り付けた内容を取り込む' }).click();
  await dlg.getByRole('button', { name: '次へ：確認' }).click();
  await shot(page, 'pc-bulk-3.png');
  expect(await cspViolations(page, probe)).toEqual([]);
});

test('フォント：プレビューが ReceiptSans/ReceiptSerif（woff2）／未収録文字の警告', async ({ page }) => {
  const probe = await attachProbe(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await fillBasic(page, { issuer: '髙﨑邉㈱①' });
  await page.waitForTimeout(1000);
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((f) => `${f.family}|${f.weight}|${f.status}`);
  });
  console.log('document.fonts:', fonts);
  const svgFamilies = await page.evaluate(() => [...new Set([...document.querySelectorAll('.receipt-svg text')].map((t) => getComputedStyle(t).fontFamily))]);
  console.log('svg text font-family:', svgFamilies);
  const woff2 = probe.allRequests.filter((u) => /\.woff2/.test(u)).map((u) => new URL(u).pathname);
  const ttf = probe.allRequests.filter((u) => /\.ttf/.test(u)).map((u) => new URL(u).pathname);
  console.log('woff2 requests:', woff2, 'ttf requests:', ttf);
  expect(woff2.length).toBeGreaterThan(0);
  expect(svgFamilies.join(',')).toMatch(/ReceiptSans/);
  // ビジネスデザインで明朝
  await openAdvanced(page);
  await page.getByLabel('ビジネス').first().check();
  await page.waitForTimeout(800);
  const fam2 = await page.evaluate(() => [...new Set([...document.querySelectorAll('.receipt-svg text')].map((t) => getComputedStyle(t).fontFamily))]);
  console.log('business font-family:', fam2);
  expect(fam2.join(',')).toMatch(/ReceiptSerif/);
  const usedFonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
  console.log('loaded fonts:', usedFonts);
  expect(usedFonts.join()).toMatch(/ReceiptSerif/);
  await shot(page, 'font-business.png');
  // 未収録文字
  await page.getByLabel('但し書き').fill('𠮷野家のお食事代として');
  await expect(page.locator('.preview-banners').getByText('四角く表示される可能性があります')).toBeVisible();
  const warn = await page.locator('.preview-banners').innerText();
  console.log('missing glyph warning:', warn.replace(/\n/g, ' '));
  expect(warn).toContain('𠮷');
  await shot(page, 'font-missing-glyph.png');
  expect(probe.externalRequests).toEqual([]);
});

test('全操作を通して外部通信ゼロ（入力→プレビュー→PDF→下書き→一括発行）', async ({ page }) => {
  test.setTimeout(120_000);
  const probe = await attachProbe(page);
  await page.goto('/');
  await fillBasic(page, { recipient: '個人情報テスト花子' });
  await openAdvanced(page);
  await page.getByLabel('住所').fill('東京都千代田区');
  await savePdf(page, 'flow.pdf');
  await page.getByLabel('この端末に下書きを保存する').click();
  await page.getByRole('button', { name: '理解した上でONにする' }).click();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'まとめて発行' }).click();
  const dlg = page.getByRole('dialog', { name: 'まとめて発行' });
  await dlg.getByRole('button', { name: '次へ：宛先の取り込み' }).click();
  await dlg.getByLabel('Excelなどの表をコピーして貼り付け').fill('A社\t御中\nB社\t御中');
  await dlg.getByRole('button', { name: '貼り付けた内容を取り込む' }).click();
  await dlg.getByRole('button', { name: '次へ：確認' }).click();
  const [d] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: '2件のPDFを作る' }).click()]);
  await d.path();
  const paths = [...new Set(probe.allRequests.map((u) => (u.startsWith('blob:') ? 'blob:' : u.startsWith('data:') ? 'data:' : new URL(u).origin + new URL(u).pathname.replace(/-[\w-]{8}\./, '-HASH.'))))];
  console.log('unique requests:', JSON.stringify(paths));
  expect(probe.externalRequests).toEqual([]);
  expect(probe.apiRequests).toEqual([]);
  expect(await cspViolations(page, probe)).toEqual([]);
});
