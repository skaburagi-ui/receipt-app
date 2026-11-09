/**
 * 任意のブラウザー内下書き（IndexedDB）。既定OFF、30日で自動期限、すべて削除、JSON書き出し／読み込み。担当: W5
 *
 * - 保存先はこの端末のこのブラウザーだけ。サーバーへは送らない。
 * - 一括発行の宛先一覧は保存対象に含めない（呼び出し側が payload に入れない）。
 * - 期限切れ（最終保存から30日）は listDrafts / loadDraft / saveDraft の際に削除する。
 */
import { MAX_DRAFT_JSON_BYTES, MAX_DRAFTS_PER_FILE, validateDraftPayload, withoutConfirmations } from './validateDraft';
export type { DraftPayload } from './validateDraft';

export interface DraftMeta { id: string; savedAt: string; label: string }

export const DRAFT_TTL_DAYS = 30;
const DRAFT_TTL_MS = DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;
const DB_NAME = 'receipt-app-drafts';
const STORE = 'drafts';
const EXPORT_FORMAT = 'receipt-app-drafts';
const EXPORT_VERSION = 1;
const MAX_ID_LENGTH = 100;
const MAX_LABEL_LENGTH = 200;

interface DraftRecord extends DraftMeta { payload: unknown }
interface TimeOpts { now?: Date }

/** IndexedDB が使える環境か。使えない場合は下書き機能を無効にして説明する。 */
export function isDraftStorageAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isDraftStorageAvailable()) {
      reject(new Error('この環境では下書き保存を使えません'));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('下書きの保存先を開けません'));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('下書きの保存先を開けません'));
    req.onblocked = () => reject(new Error('下書きの保存先が使用中です'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      let result: T | undefined;
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('下書きの保存に失敗しました'));
      tx.onabort = () => reject(tx.error ?? new Error('下書きの保存に失敗しました'));
    });
  } finally {
    db.close();
  }
}

async function getAllRecords(): Promise<DraftRecord[]> {
  return ((await run<DraftRecord[]>('readonly', (s) => s.getAll())) ?? []) as DraftRecord[];
}

function isExpired(savedAt: string, now: Date): boolean {
  const t = Date.parse(savedAt);
  return !Number.isFinite(t) || now.getTime() - t > DRAFT_TTL_MS;
}

/** 期限切れを削除し、残ったものを返す。 */
async function purgeExpired(now: Date): Promise<DraftRecord[]> {
  const all = await getAllRecords();
  const expired = all.filter((r) => isExpired(r.savedAt, now));
  if (expired.length > 0) {
    await run('readwrite', (s) => {
      for (const r of expired) s.delete(r.id);
    });
  }
  return all.filter((r) => !isExpired(r.savedAt, now));
}

function checkId(id: string): void {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) {
    throw new Error('下書きの名前が正しくありません');
  }
}

export async function saveDraft(id: string, payload: unknown, label: string, opts?: TimeOpts): Promise<void> {
  checkId(id);
  const checked = validateDraftPayload(payload); // 保存前にも型・大きさを確認する
  const now = opts?.now ?? new Date();
  const rec: DraftRecord = { id, savedAt: now.toISOString(), label: String(label).slice(0, MAX_LABEL_LENGTH), payload: checked };
  await run('readwrite', (s) => s.put(rec));
}

export async function loadDraft(id: string, opts?: TimeOpts): Promise<unknown | null> {
  checkId(id);
  const now = opts?.now ?? new Date();
  const rec = (await run<DraftRecord | undefined>('readonly', (s) => s.get(id))) as DraftRecord | undefined;
  if (!rec) return null;
  if (isExpired(rec.savedAt, now)) {
    await purgeExpired(now);
    return null;
  }
  try {
    return validateDraftPayload(rec.payload);
  } catch {
    // 壊れたデータは読み込まない（削除もしておく）
    await run('readwrite', (s) => { s.delete(id); });
    return null;
  }
}

export async function listDrafts(opts?: TimeOpts): Promise<DraftMeta[]> {
  const alive = await purgeExpired(opts?.now ?? new Date());
  return alive
    .map(({ id, savedAt, label }) => ({ id, savedAt, label }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function deleteAllDrafts(): Promise<void> {
  await run('readwrite', (s) => s.clear());
}

export async function deleteDraft(id: string): Promise<void> {
  checkId(id);
  await run('readwrite', (s) => { s.delete(id); });
}

/** 指定した下書きをJSON文字列にする（ファイルへの書き出し用）。 */
export async function exportDraftsToJson(ids: string[], opts?: TimeOpts): Promise<string> {
  const now = opts?.now ?? new Date();
  const alive = await purgeExpired(now);
  const picked = alive.filter((r) => ids.includes(r.id));
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: now.toISOString(),
      drafts: picked.map((r) => ({ id: r.id, savedAt: r.savedAt, label: r.label, payload: r.payload })),
    },
    null,
    1,
  );
}

/**
 * 書き出したJSONを読み込む。型・大きさを検証し、1件でも不正なら全体を拒否して例外を投げる。
 * 読み込んだ下書きの保存日時は、読み込んだ時刻にする（期限は読み込みから30日）。戻り値は読み込んだ件数。
 * 確認チェック（登録番号が自分のもの等）は、読み込むときに必ず外す。
 */
export async function importDraftsFromJson(json: string, opts?: TimeOpts): Promise<number> {
  if (typeof json !== 'string') throw new Error('ファイルを読み込めません');
  // 文字数で上限判定（UTF-16。厳密なバイト数でなくてよい）
  if (json.length > MAX_DRAFT_JSON_BYTES) throw new Error('ファイルが大きすぎます');
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('このファイルは下書きのデータではありません');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('このファイルは下書きのデータではありません');
  const o = data as Record<string, unknown>;
  if (o.format !== EXPORT_FORMAT || o.version !== EXPORT_VERSION || !Array.isArray(o.drafts)) {
    throw new Error('このファイルは下書きのデータではありません');
  }
  if (o.drafts.length > MAX_DRAFTS_PER_FILE) throw new Error('下書きの数が多すぎます');

  const now = opts?.now ?? new Date();
  const records: DraftRecord[] = o.drafts.map((d, i) => {
    if (typeof d !== 'object' || d === null) throw new Error(`下書きのデータが正しくありません（${i + 1}件目）`);
    const r = d as Record<string, unknown>;
    if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > MAX_ID_LENGTH) {
      throw new Error(`下書きのデータが正しくありません（${i + 1}件目：名前）`);
    }
    if (typeof r.label !== 'string' || r.label.length > MAX_LABEL_LENGTH) {
      throw new Error(`下書きのデータが正しくありません（${i + 1}件目：ラベル）`);
    }
    return { id: r.id, savedAt: now.toISOString(), label: r.label, payload: withoutConfirmations(validateDraftPayload(r.payload)) };
  });
  if (records.length === 0) return 0;
  await run('readwrite', (s) => {
    for (const r of records) s.put(r);
  });
  return records.length;
}
