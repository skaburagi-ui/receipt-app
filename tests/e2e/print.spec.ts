import { test } from '@playwright/test';
import { attachProbe, cspViolations, expect, fillBasic, shot } from './helpers';

// headless Chrome では PDF入りiframeの window.print() でページがクラッシュする（CSPの有無に関係なく再現）ため、
// print() だけを記録用に差し替える。実際の印刷ダイアログは自動では確認できない（人間が実機で確認）。
test('印刷導線：案内→iframeにPDFが読み込まれる（CSP下）', async ({ page }) => {
  const probe = await attachProbe(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __print: number };
    w.__print = 0;
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')!;
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get() {
        const win = desc.get!.call(this) as Window | null;
        if (!win) return win;
        return new Proxy(win, {
          get(t, k) {
            if (k === 'print') return () => { w.__print++; };
            const v = (t as never)[k];
            return typeof v === 'function' ? (v as () => unknown).bind(t) : v;
          },
        });
      },
    });
  });
  await page.goto('/');
  await fillBasic(page);
  await expect(page.getByRole('button', { name: '印刷', exact: true })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: '印刷', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '印刷する前に' })).toBeVisible();
  await shot(page, 'print-guide.png');
  await page.getByRole('button', { name: '印刷画面を開く' }).click();
  await expect(page.getByRole('dialog', { name: '印刷を開始しました' })).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { __print: number }).__print)).toBe(1);
  // iframe の中身（PDFビューアー）を確認
  const info = await page.evaluate(async () => {
    const f = document.querySelector('iframe') as HTMLIFrameElement | null;
    if (!f) return { frame: false };
    let embed: string | null = null;
    try { embed = f.contentDocument?.querySelector('embed')?.getAttribute('type') ?? null; } catch { embed = 'ERR'; }
    f.style.cssText = 'position:fixed;left:0;top:0;width:900px;height:700px;z-index:99999;background:#fff;opacity:1';
    await new Promise((r) => setTimeout(r, 2500));
    return { frame: true, src: f.src.slice(0, 20), embed };
  });
  console.log('iframe:', JSON.stringify(info));
  await shot(page, 'print-iframe-visible.png');
  console.log('frames:', page.frames().map((f) => f.url().slice(0, 40)));
  const csp = await cspViolations(page, probe);
  console.log('csp:', csp, 'console:', probe.consoleErrors, probe.pageErrors);
  expect(csp).toEqual([]);
  expect(probe.externalRequests).toEqual([]);
});
