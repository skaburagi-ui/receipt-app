/**
 * 下書きデータ（読み込んだJSON・IndexedDBの中身）の検証。型・列挙値・大きさを確かめ、不正なら例外を投げる。
 * 画面側に渡る前に必ず通す（外部から読み込んだファイルは信用しない）。
 */
import type {
  DesignSettings,
  ImageAsset,
  IssuerInfo,
  ReceiptInput,
  SealSpec,
} from '../domain/types';
import { MAX_AMOUNT_YEN } from '../domain/limits';

export type DraftPayload =
  | { kind: 'full'; receipt: ReceiptInput; design: DesignSettings }
  | { kind: 'issuer'; issuer: IssuerInfo; design: Partial<DesignSettings> };

export const MAX_TEXT_LENGTH = 5000;
export const MAX_IMAGE_DATAURL_LENGTH = 8 * 1024 * 1024; // 文字数（約6MBの画像）
export const MAX_DRAFT_JSON_BYTES = 40 * 1024 * 1024;
export const MAX_DRAFTS_PER_FILE = 50;
export const MAX_LINE_ITEMS = 100;

type Rec = Record<string, unknown>;

function fail(path: string, why: string): never {
  throw new Error(`下書きのデータが正しくありません（${path}：${why}）`);
}

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, path: string, max = MAX_TEXT_LENGTH): string {
  if (typeof v !== 'string') fail(path, '文字ではありません');
  if (v.length > max) fail(path, '長すぎます');
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, '真偽値ではありません');
  return v;
}

function num(v: unknown, path: string, min = -1e9, max = 1e9): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, '数値ではありません');
  if (v < min || v > max) fail(path, '範囲外です');
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(path, '選択肢にない値です');
  return v as T;
}

function rec(v: unknown, path: string): Rec {
  if (!isRec(v)) fail(path, 'オブジェクトではありません');
  return v;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function date(v: unknown, path: string): string {
  const s = str(v, path, 10);
  if (s !== '' && !DATE_RE.test(s)) fail(path, '日付の形式が違います');
  return s;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function color(v: unknown, path: string): string {
  const s = str(v, path, 7);
  if (!COLOR_RE.test(s)) fail(path, '色の形式が違います');
  return s;
}

const IMAGE_DATAURL_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
function imageAsset(v: unknown, path: string): ImageAsset {
  const o = rec(v, path);
  const dataUrl = str(o.dataUrl, `${path}.dataUrl`, MAX_IMAGE_DATAURL_LENGTH);
  if (!IMAGE_DATAURL_RE.test(dataUrl)) fail(`${path}.dataUrl`, '画像データではありません');
  return {
    dataUrl,
    widthPx: num(o.widthPx, `${path}.widthPx`, 1, 20000),
    heightPx: num(o.heightPx, `${path}.heightPx`, 1, 20000),
  };
}

function nullable<T>(v: unknown, f: (x: unknown) => T): T | null {
  return v === null ? null : f(v);
}

const TAX_CATEGORIES = ['taxable10', 'taxable8', 'exempt', 'outOfScope', 'taxFree'] as const;
const PAYMENT_METHODS = ['cash', 'bankTransfer', 'creditCard', 'electronicMoney', 'qrPayment', 'other'] as const;

export function validateIssuer(v: unknown, path = 'issuer'): IssuerInfo {
  const o = rec(v, path);
  return {
    name: str(o.name, `${path}.name`),
    postalCode: str(o.postalCode, `${path}.postalCode`, 100),
    address: str(o.address, `${path}.address`),
    phone: str(o.phone, `${path}.phone`, 100),
    registrationNumber: str(o.registrationNumber, `${path}.registrationNumber`, 100),
    taxpayerType: oneOf(o.taxpayerType, `${path}.taxpayerType`, ['taxable', 'exempt', 'unknown'] as const),
    businessNature: oneOf(o.businessNature, `${path}.businessNature`, ['business', 'nonBusiness', 'unknown'] as const),
  };
}

export function validateReceiptInput(v: unknown, path = 'receipt'): ReceiptInput {
  const o = rec(v, path);
  const recipient = rec(o.recipient, `${path}.recipient`);
  const tax = rec(o.tax, `${path}.tax`);
  if (!Array.isArray(tax.items)) fail(`${path}.tax.items`, '配列ではありません');
  if (tax.items.length > MAX_LINE_ITEMS) fail(`${path}.tax.items`, '明細が多すぎます');
  const conf = rec(o.confirmations, `${path}.confirmations`);
  const copy = rec(o.copyInfo, `${path}.copyInfo`);
  return {
    mode: oneOf(o.mode, `${path}.mode`, ['general', 'qualified', 'qualifiedSimple'] as const),
    issuer: validateIssuer(o.issuer, `${path}.issuer`),
    recipient: {
      name: str(recipient.name, `${path}.recipient.name`),
      honorific: str(recipient.honorific, `${path}.recipient.honorific`, 20),
    },
    proviso: str(o.proviso, `${path}.proviso`),
    receiptDate: date(o.receiptDate, `${path}.receiptDate`),
    issueDate: nullable(o.issueDate, (x) => date(x, `${path}.issueDate`)),
    transactionDate: date(o.transactionDate, `${path}.transactionDate`),
    transactionDateEdited: bool(o.transactionDateEdited, `${path}.transactionDateEdited`),
    receiptNumber: str(o.receiptNumber, `${path}.receiptNumber`, 100),
    paymentMethod: nullable(o.paymentMethod, (x) => oneOf(x, `${path}.paymentMethod`, PAYMENT_METHODS)),
    showPaymentMethod: bool(o.showPaymentMethod, `${path}.showPaymentMethod`),
    tax: {
      inputMode: oneOf(tax.inputMode, `${path}.tax.inputMode`, ['inclusive', 'exclusive'] as const),
      rounding: oneOf(tax.rounding, `${path}.tax.rounding`, ['floor', 'round', 'ceil'] as const),
      items: tax.items.map((it, i) => {
        const p = `${path}.tax.items[${i}]`;
        const io = rec(it, p);
        return {
          description: str(io.description, `${p}.description`),
          amountYen: num(io.amountYen, `${p}.amountYen`, 0, MAX_AMOUNT_YEN),
          category: oneOf(io.category, `${p}.category`, TAX_CATEGORIES),
        };
      }),
    },
    remarks: str(o.remarks, `${path}.remarks`),
    delivery: oneOf(o.delivery, `${path}.delivery`, ['paper', 'electronic'] as const),
    isSalesProceeds: bool(o.isSalesProceeds, `${path}.isSalesProceeds`),
    confirmations: {
      ownRegistrationNumber: bool(conf.ownRegistrationNumber, `${path}.confirmations.ownRegistrationNumber`),
      simpleInvoiceEligibleBusiness: bool(
        conf.simpleInvoiceEligibleBusiness,
        `${path}.confirmations.simpleInvoiceEligibleBusiness`,
      ),
    },
    copyInfo: {
      issuedBy: str(copy.issuedBy, `${path}.copyInfo.issuedBy`),
      paymentChannel: str(copy.paymentChannel, `${path}.copyInfo.paymentChannel`),
      internalNote: str(copy.internalNote, `${path}.copyInfo.internalNote`),
    },
    correction: !('correction' in o) || o.correction === null ? null : (() => {
      const c = rec(o.correction, `${path}.correction`);
      return {
        originalDate: str(c.originalDate, `${path}.correction.originalDate`, 20),
        originalNumber: str(c.originalNumber, `${path}.correction.originalNumber`, 100),
        changes: str(c.changes, `${path}.correction.changes`, 1000),
      };
    })(),
  };
}

function sealSpec(v: unknown, path: string): SealSpec {
  const o = rec(v, path);
  return {
    text: str(o.text, `${path}.text`, 20),
    layout: oneOf(o.layout, `${path}.layout`, ['v1x2', 'v2x2', 'v2x3', 'v3x3', 'v3x4', 'auto'] as const),
    color: color(o.color, `${path}.color`),
    frame: oneOf(o.frame, `${path}.frame`, ['single', 'double', 'none'] as const),
    roundedFrame: bool(o.roundedFrame, `${path}.roundedFrame`),
  };
}

/** 設定の一部だけ（キーが無いものは省略）を検証する。 */
export function validatePartialDesign(v: unknown, path = 'design'): Partial<DesignSettings> {
  const o = rec(v, path);
  const out: Partial<DesignSettings> = {};
  if ('design' in o) out.design = oneOf(o.design, `${path}.design`, ['simple', 'business', 'casual'] as const);
  if ('themeColor' in o) out.themeColor = color(o.themeColor, `${path}.themeColor`);
  if ('format' in o)
    out.format = oneOf(o.format, `${path}.format`, ['a4-single', 'a5-single', 'a4-double', 'a4-with-copy'] as const);
  if ('showSeal' in o) out.showSeal = bool(o.showSeal, `${path}.showSeal`);
  if ('sealImage' in o) out.sealImage = nullable(o.sealImage, (x) => imageAsset(x, `${path}.sealImage`));
  if ('sealSpec' in o) out.sealSpec = nullable(o.sealSpec, (x) => sealSpec(x, `${path}.sealSpec`));
  if ('sealPlacement' in o) {
    const p = rec(o.sealPlacement, `${path}.sealPlacement`);
    out.sealPlacement = {
      xMm: num(p.xMm, `${path}.sealPlacement.xMm`, -500, 500),
      yMm: num(p.yMm, `${path}.sealPlacement.yMm`, -500, 500),
      sizeMm: num(p.sizeMm, `${path}.sealPlacement.sizeMm`, 1, 200),
    };
  }
  if ('logo' in o) out.logo = nullable(o.logo, (x) => imageAsset(x, `${path}.logo`));
  if ('logoWidthMm' in o) out.logoWidthMm = num(o.logoWidthMm, `${path}.logoWidthMm`, 1, 300);
  if ('showRevenueStampBox' in o) out.showRevenueStampBox = bool(o.showRevenueStampBox, `${path}.showRevenueStampBox`);
  if ('showCutGuide' in o) out.showCutGuide = bool(o.showCutGuide, `${path}.showCutGuide`);
  if ('showCutGuideOnEmptyHalf' in o)
    out.showCutGuideOnEmptyHalf = bool(o.showCutGuideOnEmptyHalf, `${path}.showCutGuideOnEmptyHalf`);
  if ('showNotInvoiceNotice' in o) out.showNotInvoiceNotice = bool(o.showNotInvoiceNotice, `${path}.showNotInvoiceNotice`);
  if ('showGeneralTaxReference' in o)
    out.showGeneralTaxReference = bool(o.showGeneralTaxReference, `${path}.showGeneralTaxReference`);
  return out;
}

const DESIGN_KEYS: (keyof DesignSettings)[] = [
  'design', 'themeColor', 'format', 'showSeal', 'sealImage', 'sealSpec', 'sealPlacement', 'logo', 'logoWidthMm',
  'showRevenueStampBox', 'showCutGuide', 'showCutGuideOnEmptyHalf', 'showNotInvoiceNotice', 'showGeneralTaxReference',
];

export function validateDesign(v: unknown, path = 'design'): DesignSettings {
  const o = rec(v, path);
  for (const k of DESIGN_KEYS) if (!(k in o)) fail(`${path}.${k}`, '項目がありません');
  return validatePartialDesign(o, path) as DesignSettings;
}

/**
 * 確認チェック（登録番号が自分のもの・簡易の対象事業）を外した下書きにする。
 * 確認は、その時点の内容を見て利用者が毎回自分で行うもの。読み込んだファイルの「確認済み」は引き継がない。
 */
export function withoutConfirmations(p: DraftPayload): DraftPayload {
  if (p.kind !== 'full') return p;
  return { ...p, receipt: { ...p.receipt, confirmations: { ownRegistrationNumber: false, simpleInvoiceEligibleBusiness: false } } };
}

/** 下書き本体の検証。不正なら Error を投げる。 */
export function validateDraftPayload(v: unknown): DraftPayload {
  const o = rec(v, 'payload');
  if (o.kind === 'full') {
    return { kind: 'full', receipt: validateReceiptInput(o.receipt), design: validateDesign(o.design) };
  }
  if (o.kind === 'issuer') {
    return { kind: 'issuer', issuer: validateIssuer(o.issuer), design: validatePartialDesign(o.design ?? {}) };
  }
  return fail('payload.kind', '種類が不明です');
}
