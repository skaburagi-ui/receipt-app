import { test } from '@playwright/test';
import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { attachProbe, cspViolations, expect, fillBasic, shot, OUT } from './helpers';

async function idbDump(page: Page): Promise<{ dbs: string[]; records: unknown[] }> {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases()).map((d) => d.name ?? '');
    const records: unknown[] = [];
    if (dbs.includes('receipt-app-drafts')) {
      await new Promise<void>((res, rej) => {
        const r = indexedDB.open('receipt-app-drafts');
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction('drafts', 'readonly');
          const all = tx.objectStore('drafts').getAll();
          all.onsuccess = () => { records.push(...all.result); db.close(); res(); };
          all.onerror = () => rej(all.error);
        };
        r.onerror = () => rej(r.error);
      });
    }
    return { dbs, records };
  });
}

test('下書き：既定OFFで保存されない／ON→警告→保存→復元→JSON→全削除→読み込み／宛先一覧は入らない', async ({ page }) => {
  test.setTimeout(120_000);
  const probe = await attachProbe(page);
  await page.goto('/');
  await fillBasic(page, { issuer: '髙﨑邉㈱①', recipient: '個人情報テスト太郎' });
  await page.waitForTimeout(2500);
  let dump = await idbDump(page);
  console.log('OFF:', JSON.stringify(dump).slice(0, 200), 'localStorage=', await page.evaluate(() => JSON.stringify(Object.entries(localStorage))));
  expect(dump.records).toEqual([]);
  expect(await page.getByLabel('この端末に下書きを保存する').isChecked()).toBe(false);

  // ON：警告が出る
  await page.getByLabel('この端末に下書きを保存する').check({ force: true }).catch(() => undefined);
  const warn = page.getByRole('dialog', { name: '下書きの保存をONにしますか？' });
  await expect(warn).toBeVisible();
  await shot(page, 'draft-warning.png');
  await warn.getByRole('button', { name: 'やめる' }).click();
  expect(await page.getByLabel('この端末に下書きを保存する').isChecked()).toBe(false);
  await page.getByLabel('この端末に下書きを保存する').click();
  await warn.getByRole('button', { name: '理解した上でONにする' }).click();
  await page.waitForTimeout(2500);
  dump = await idbDump(page);
  const json = JSON.stringify(dump.records);
  console.log('ON records:', dump.records.length, json.slice(0, 160));
  expect(dump.records.length).toBe(1);
  expect(json).toContain('個人情報テスト太郎');

  // 一括の宛先一覧は下書きに入らない
  await page.getByRole('button', { name: 'まとめて発行' }).click();
  const bulk = page.getByRole('dialog', { name: 'まとめて発行' });
  await bulk.getByRole('button', { name: '次へ：宛先の取り込み' }).click();
  await bulk.getByLabel('Excelなどの表をコピーして貼り付け').fill('秘密の宛先ABC\t様\n秘密の宛先DEF\t様');
  await bulk.getByRole('button', { name: '貼り付けた内容を取り込む' }).click();
  await bulk.getByRole('button', { name: '次へ：確認' }).click();
  await bulk.getByRole('button', { name: '閉じる' }).click();
  await page.getByLabel('発行者（あなたの名前・会社名）').fill('髙﨑邉㈱①改');
  await page.waitForTimeout(2500);
  dump = await idbDump(page);
  const json2 = JSON.stringify(dump.records);
  expect(json2).toContain('髙﨑邉㈱①改');
  expect(json2).not.toContain('秘密の宛先');
  console.log('宛先一覧がIDBに無い: OK');

  // 再読込で復元
  await page.reload();
  await expect(page.getByText('前回の下書きがあります')).toBeVisible();
  await shot(page, 'draft-restore.png');
  await page.getByRole('button', { name: '読み込む', exact: true }).first().click();
  await expect(page.getByLabel('発行者（あなたの名前・会社名）')).toHaveValue('髙﨑邉㈱①改');
  await expect(page.getByLabel('宛名（領収書を受け取る人・会社）')).toHaveValue('個人情報テスト太郎');

  // JSON書き出し
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ファイルに書き出す' }).click()]);
  const jf = `${OUT}/drafts-export.json`;
  await dl.saveAs(jf);
  const exported = fs.readFileSync(jf, 'utf8');
  console.log('export size', exported.length, exported.slice(0, 120));
  expect(exported).not.toContain('秘密の宛先');

  // 全削除（自動保存の1秒デバウンスが終わってから）
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'すべて削除' }).click();
  await expect(page.getByText('すべて削除しました')).toBeVisible();
  await page.waitForTimeout(1500);
  dump = await idbDump(page);
  console.log('after delete:', dump.records.length);
  expect(dump.records).toEqual([]);

  // 読み込み（JSON）
  await page.getByLabel('発行者（あなたの名前・会社名）').fill('別の名前');
  await page.locator('input[aria-label="下書きファイルを選ぶ"]').setInputFiles(jf);
  await expect(page.getByText(/件の下書きを読み込みました/)).toBeVisible();
  await page.locator('.draft-list').getByRole('button', { name: '読み込む' }).first().click();
  await expect(page.getByLabel('発行者（あなたの名前・会社名）')).toHaveValue('髙﨑邉㈱①改');
  await shot(page, 'draft-after-import.png');

  // 壊れたJSON
  fs.writeFileSync(`${OUT}/broken.json`, '{"format":"x"');
  await page.locator('input[aria-label="下書きファイルを選ぶ"]').setInputFiles(`${OUT}/broken.json`);
  await expect(page.getByText(/読み込めませんでした/)).toBeVisible();
  expect(await cspViolations(page, probe)).toEqual([]);
  expect(probe.externalRequests).toEqual([]);
});
