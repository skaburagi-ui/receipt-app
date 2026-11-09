import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteAllDrafts,
  exportDraftsToJson,
  importDraftsFromJson,
  isDraftStorageAvailable,
  listDrafts,
  loadDraft,
  saveDraft,
  type DraftPayload,
} from './drafts';
import type { DesignSettings, ReceiptInput } from '../domain/types';

// W1/W3のスタブに依存しないよう、検証用の入力はここで直接作る
const receipt: ReceiptInput = {
  mode: 'general',
  issuer: { name: '山田商店', postalCode: '100-0001', address: '東京都千代田区', phone: '03-0000-0000', registrationNumber: '', taxpayerType: 'unknown', businessNature: 'unknown' },
  recipient: { name: '株式会社テスト', honorific: '御中' },
  proviso: 'お品代として',
  receiptDate: '2026-11-05',
  issueDate: null,
  transactionDate: '2026-11-05',
  transactionDateEdited: false,
  receiptNumber: '',
  paymentMethod: null,
  showPaymentMethod: false,
  tax: { inputMode: 'inclusive', rounding: 'floor', items: [{ description: '', amountYen: 1100, category: 'taxable10' }] },
  remarks: '',
  delivery: 'paper',
  isSalesProceeds: true,
  confirmations: { ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false },
  copyInfo: { issuedBy: '', paymentChannel: '', internalNote: '' },
};
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const design: DesignSettings = {
  design: 'simple', themeColor: '#2563EB', format: 'a4-single', showSeal: true,
  sealImage: { dataUrl: PNG, widthPx: 10, heightPx: 10 },
  sealSpec: null,
  sealPlacement: { xMm: 150, yMm: 60, sizeMm: 18 },
  logo: { dataUrl: PNG, widthPx: 20, heightPx: 10 }, logoWidthMm: 30,
  showRevenueStampBox: false, showCutGuide: true, showCutGuideOnEmptyHalf: false,
  showNotInvoiceNotice: true, showGeneralTaxReference: true,
};
const full: DraftPayload = { kind: 'full', receipt, design };
const day = 24 * 60 * 60 * 1000;

describe('下書き保存（IndexedDB）', () => {
  beforeEach(async () => {
    await deleteAllDrafts();
  });

  it('IndexedDBが使える環境と判定される', () => {
    expect(isDraftStorageAvailable()).toBe(true);
  });

  it('保存→一覧→読込ができ、画像も戻る', async () => {
    await saveDraft('current', full, '山田商店 1,100円');
    const list = await listDrafts();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('current');
    expect(list[0].label).toBe('山田商店 1,100円');
    const loaded = (await loadDraft('current')) as DraftPayload;
    expect(loaded.kind).toBe('full');
    if (loaded.kind === 'full') {
      expect(loaded.receipt.issuer.name).toBe('山田商店');
      expect(loaded.design.logo?.dataUrl).toBe(PNG);
    }
  });

  it('同じidで保存すると上書きされる', async () => {
    await saveDraft('current', full, 'a');
    await saveDraft('current', full, 'b');
    const list = await listDrafts();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe('b');
  });

  it('存在しない下書きは null', async () => {
    expect(await loadDraft('nothing')).toBeNull();
  });

  it('30日を過ぎた下書きは読込・一覧のときに削除される', async () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    await saveDraft('old', full, 'old', { now: t0 });
    await saveDraft('keep', full, 'keep', { now: new Date(t0.getTime() + 20 * day) });
    // 29日目はまだ有効
    expect(await loadDraft('old', { now: new Date(t0.getTime() + 29 * day) })).not.toBeNull();
    // 31日目: old は期限切れ、keep（11日経過）は有効
    const later = new Date(t0.getTime() + 31 * day);
    expect(await loadDraft('old', { now: later })).toBeNull();
    const list = await listDrafts({ now: later });
    expect(list.map((d) => d.id)).toEqual(['keep']);
    // 実際に消えている（期限判定の時刻を戻しても出てこない）
    expect(await loadDraft('old', { now: t0 })).toBeNull();
  });

  it('すべて削除', async () => {
    await saveDraft('a', full, 'a');
    await saveDraft('issuer', { kind: 'issuer', issuer: receipt.issuer, design: {} }, 'issuer');
    await deleteAllDrafts();
    expect(await listDrafts()).toEqual([]);
  });

  it('発行者情報だけの下書きも保存・読込できる', async () => {
    await saveDraft('issuer', { kind: 'issuer', issuer: receipt.issuer, design: { logo: design.logo, logoWidthMm: 30 } }, '発行者');
    const loaded = (await loadDraft('issuer')) as DraftPayload;
    expect(loaded.kind).toBe('issuer');
    if (loaded.kind === 'issuer') {
      expect(loaded.issuer.name).toBe('山田商店');
      expect(loaded.design.logoWidthMm).toBe(30);
    }
  });

  it('JSON書き出し→全削除→読み込みで復元できる', async () => {
    await saveDraft('current', full, 'x');
    const json = await exportDraftsToJson(['current']);
    await deleteAllDrafts();
    expect(await importDraftsFromJson(json)).toBe(1);
    const loaded = (await loadDraft('current')) as DraftPayload;
    expect(loaded.kind === 'full' && loaded.receipt.recipient.name).toBe('株式会社テスト');
  });

  it('宛先一覧など余計な項目は書き出しに含まれない（保存時に検証済みの形だけ残る）', async () => {
    const withExtra = { ...full, recipients: [{ name: '秘密' }] } as unknown as DraftPayload;
    await saveDraft('current', withExtra, 'x');
    const json = await exportDraftsToJson(['current']);
    expect(json).not.toContain('秘密');
  });

  it('訂正書面（correction）を保存・読込できる。無い古い下書きも読める', async () => {
    const withCorrection: DraftPayload = { kind: 'full', receipt: { ...receipt, correction: { originalDate: '2026-10-01', originalNumber: 'R-001', changes: '誤：10,000円 → 正：11,000円' } }, design };
    await saveDraft('c', withCorrection, 'x');
    const loaded = (await loadDraft('c')) as DraftPayload;
    expect(loaded.kind === 'full' && loaded.receipt.correction).toEqual({ originalDate: '2026-10-01', originalNumber: 'R-001', changes: '誤：10,000円 → 正：11,000円' });
    // correction キーが無い（古い）下書き
    expect('correction' in receipt).toBe(false);
    await saveDraft('old', full, 'x');
    const old = (await loadDraft('old')) as DraftPayload;
    expect(old.kind === 'full' && (old.receipt.correction ?? null)).toBeNull();
    // 型が違う correction は拒否
    const bad = { kind: 'full', receipt: { ...receipt, correction: { originalDate: 1, originalNumber: '', changes: '' } }, design };
    await expect(saveDraft('bad', bad, 'x')).rejects.toThrow();
  });

  it('JSON読み込みでは確認チェック（登録番号が自分のもの等）を外す', async () => {
    const checked: DraftPayload = { kind: 'full', receipt: { ...receipt, mode: 'qualified', confirmations: { ownRegistrationNumber: true, simpleInvoiceEligibleBusiness: true } }, design };
    await saveDraft('current', checked, 'x');
    const json = await exportDraftsToJson(['current']);
    expect(json).toContain('"ownRegistrationNumber": true');
    await deleteAllDrafts();
    await importDraftsFromJson(json);
    const loaded = (await loadDraft('current')) as DraftPayload;
    expect(loaded.kind === 'full' && loaded.receipt.confirmations).toEqual({ ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false });
  });

  describe('読み込み時の検証（不正データは拒否）', () => {
    const wrap = (payload: unknown, extra: object = {}) =>
      JSON.stringify({ format: 'receipt-app-drafts', version: 1, drafts: [{ id: 'x', savedAt: 'x', label: 'x', payload }], ...extra });

    it('JSONでない／形式が違う', async () => {
      await expect(importDraftsFromJson('abc')).rejects.toThrow();
      await expect(importDraftsFromJson('[]')).rejects.toThrow();
      await expect(importDraftsFromJson('{"format":"other","version":1,"drafts":[]}')).rejects.toThrow();
    });

    it('列挙値や型が違う', async () => {
      const bad = { ...full, receipt: { ...receipt, mode: 'hacker' } };
      await expect(importDraftsFromJson(wrap(bad))).rejects.toThrow();
      const bad2 = { ...full, receipt: { ...receipt, tax: { ...receipt.tax, items: [{ description: '', amountYen: 'abc', category: 'taxable10' }] } } };
      await expect(importDraftsFromJson(wrap(bad2))).rejects.toThrow();
      const bad3 = { ...full, receipt: { ...receipt, tax: { ...receipt.tax, items: [{ description: '', amountYen: -5, category: 'taxable10' }] } } };
      await expect(importDraftsFromJson(wrap(bad3))).rejects.toThrow();
    });

    it('画像がdata:image/png|jpeg以外（スクリプト等）は拒否', async () => {
      const bad = { ...full, design: { ...design, logo: { dataUrl: 'javascript:alert(1)', widthPx: 1, heightPx: 1 } } };
      await expect(importDraftsFromJson(wrap(bad))).rejects.toThrow();
      const svg = { ...full, design: { ...design, logo: { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', widthPx: 1, heightPx: 1 } } };
      await expect(importDraftsFromJson(wrap(svg))).rejects.toThrow();
    });

    it('大きすぎる文字列・件数は拒否', async () => {
      const long = { ...full, receipt: { ...receipt, remarks: 'a'.repeat(10000) } };
      await expect(importDraftsFromJson(wrap(long))).rejects.toThrow();
      const many = JSON.stringify({ format: 'receipt-app-drafts', version: 1, drafts: Array.from({ length: 51 }, (_, i) => ({ id: `d${i}`, label: '', payload: full })) });
      await expect(importDraftsFromJson(many)).rejects.toThrow();
    });

    it('1件でも不正なら何も保存しない', async () => {
      const json = JSON.stringify({
        format: 'receipt-app-drafts', version: 1,
        drafts: [{ id: 'ok', label: '', payload: full }, { id: 'ng', label: '', payload: { kind: 'zzz' } }],
      });
      await expect(importDraftsFromJson(json)).rejects.toThrow();
      expect(await listDrafts()).toEqual([]);
    });
  });
});
