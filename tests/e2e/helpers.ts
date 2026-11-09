import { expect, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const OUT = 'D:/Temp/claude/fixb-out';
fs.mkdirSync(OUT, { recursive: true });

export interface Probe {
  externalRequests: string[];
  apiRequests: string[];
  allRequests: string[];
  violations: string[];
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
}

/** 全リクエスト・CSP違反・コンソールエラーを記録する。Worker のリクエストも context レベルで拾う。 */
export async function attachProbe(page: Page, origin = process.env.E2E_BASE ?? 'http://127.0.0.1:4180'): Promise<Probe> {
  const p: Probe = { externalRequests: [], apiRequests: [], allRequests: [], violations: [], consoleErrors: [], pageErrors: [], badResponses: [] };
  page.context().on('request', (req) => {
    const u = req.url();
    p.allRequests.push(u);
    // blob:/data: と、Chrome内蔵PDFビューアーの内部リソース（chrome-extension:// chrome://）はネットワーク通信ではない。
    if (/^(blob:|data:|chrome-extension:|chrome:)/.test(u)) return;
    if (!u.startsWith(origin)) p.externalRequests.push(u);
    if (/\/api(\/|$)/.test(new URL(u).pathname)) p.apiRequests.push(u);
  });
  page.context().on('response', (r) => { if (r.status() >= 400) p.badResponses.push(`${r.status()} ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') p.consoleErrors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => p.pageErrors.push(String(e)));
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} blocked=${e.blockedURI} src=${e.sourceFile}:${e.lineNumber}`);
    });
  });
  return p;
}

export async function cspViolations(page: Page, probe: Probe): Promise<string[]> {
  const v = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
  return [...v, ...probe.violations, ...probe.consoleErrors.filter((c) => /Content Security Policy|Refused to/i.test(c))];
}

export async function fillBasic(page: Page, o: { issuer?: string; recipient?: string; amount?: string; proviso?: string } = {}) {
  await page.getByLabel('発行者（あなたの名前・会社名）').fill(o.issuer ?? '髙﨑邉㈱①');
  await page.getByLabel('宛名（領収書を受け取る人・会社）').fill(o.recipient ?? '株式会社サンプル');
  await page.getByLabel('領収金額').fill(o.amount ?? '12345');
  await page.getByLabel('但し書き').fill(o.proviso ?? 'お食事代として');
}

export async function savePdf(page: Page, name: string, button = 'PDFを保存'): Promise<string> {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByRole('button', { name: button, exact: true }).click(),
  ]);
  const file = path.join(OUT, name);
  await dl.saveAs(file);
  // 「保存しました」ダイアログ（aria-modal）が次の操作を邪魔するので閉じる
  const dlg = page.getByRole('dialog', { name: /保存しました|印刷を開始/ });
  if (await dlg.isVisible().catch(() => false)) await dlg.getByRole('button', { name: '閉じる' }).click();
  return file;
}

export function shot(page: Page, name: string, fullPage = false) {
  return page.screenshot({ path: path.join(OUT, name), fullPage });
}

export { expect };
export type { TestInfo };

import { execFileSync } from 'node:child_process';

export interface PdfInfo {
  pages: number;
  sizes: { wMm: number; hMm: number; text: string }[];
  fonts: string[];
}
/** PyMuPDF で検査（ページ数・寸法・文字抽出・先頭3ページのPNG）。 */
export function inspectPdf(file: string, png = true): PdfInfo {
  const script = path.resolve(process.cwd(), 'tests/e2e/pdf_inspect.py');
  const out = execFileSync('python', ['-X', 'utf8', '-I', '-W', 'ignore', script, file, ...(png ? [OUT] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out) as PdfInfo;
}
export const allText = (i: PdfInfo) => i.sizes.map((s) => s.text).join('\n');

/** 詳細設定（<details>）を開く。 */
export async function openAdvanced(page: Page) {
  const d = page.locator('details.advanced');
  if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator(':scope > summary').click();
  // 既存の業務フローテストは個別の設定欄を操作するため、対象グループを展開する。
  await d.locator('details.settings-group').evaluateAll((groups) => groups.forEach((el) => { (el as HTMLDetailsElement).open = true; }));
}

export async function setMode(page: Page, mode: 'general' | 'qualified' | 'simple') {
  const ms = page.locator('.mode-selector');
  if (mode === 'general') { await ms.getByLabel('いいえ（ふつうの領収書）').check(); return; }
  await ms.getByLabel('はい', { exact: true }).first().check();
  if (mode === 'simple') await ms.getByLabel('はい（簡易インボイス＝適格簡易請求書）').check();
  else await ms.getByLabel('いいえ（インボイス＝適格請求書）').check();
}

import zlib from 'node:zlib';
/** 透明背景つきPNG（赤い円＋縦棒）を生成。 */
export function makePng(size = 160, opaqueWhite = false): Buffer {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2, dy = y - size / 2, d = Math.sqrt(dx * dx + dy * dy);
      const o = y * stride + 1 + x * 4;
      const ink = (d < size / 2 - 2 && d > size / 2 - 12) || (Math.abs(dx) < 8 && Math.abs(dy) < size / 3);
      raw[o] = ink ? 200 : 255; raw[o + 1] = ink ? 22 : 255; raw[o + 2] = ink ? 29 : 255;
      raw[o + 3] = ink ? 255 : opaqueWhite ? 255 : 0;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
