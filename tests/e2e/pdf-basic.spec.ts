import { test } from '@playwright/test';
import { attachProbe, cspViolations, expect, fillBasic, savePdf, shot } from './helpers';

for (const [label, vp] of [['pc', { width: 1280, height: 800 }], ['sp', { width: 390, height: 844 }]] as const) {
  test(`単票PDF保存(${label})`, async ({ page }) => {
    await page.setViewportSize(vp);
    const probe = await attachProbe(page);
    await page.goto('/');
    await fillBasic(page);
    await expect(page.getByRole('button', { name: 'PDFを保存', exact: true })).toBeEnabled({ timeout: 15_000 });
    await shot(page, `basic-${label}-input.png`, true);
    const file = await savePdf(page, `basic-${label}.pdf`);
    console.log('saved', file);
    expect(await cspViolations(page, probe)).toEqual([]);
    console.log('external', probe.externalRequests, 'errors', probe.consoleErrors, probe.pageErrors, probe.badResponses);
    expect(probe.externalRequests).toEqual([]);
  });
}
