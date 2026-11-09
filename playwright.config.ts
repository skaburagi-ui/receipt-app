import { defineConfig } from '@playwright/test';

// E2E（実ブラウザー）。vitest の対象外（vite.config.ts の test.include は src/** と tests/**/*.test.ts のみ。e2e は *.spec.ts）。
// 事前に `npm run build` を実行しておく。サーバーは dist/_headers の CSP を付けて配信する。
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE ?? 'http://127.0.0.1:4180', channel: 'chrome', acceptDownloads: true },
  // E2E_BASE を指定したときは、別途起動したサーバーを使う（CSPなし比較用など）。
  webServer: process.env.E2E_BASE ? undefined : { command: 'node tests/e2e/server.mjs', url: 'http://127.0.0.1:4180/', reuseExistingServer: false, timeout: 30_000 },
});
