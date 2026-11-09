/**
 * 共有型の契約。全モジュールはここの型だけを介して連携する。
 * 変更は「追加のみ」（既存フィールドの削除・意味変更は禁止）。追加したら docs/ARCHITECTURE.md の変更ログへ1行書く。
 * 金額はすべて「円の整数」。日付は 'YYYY-MM-DD'（日本時間の暦日）。
 */

// ───────── 領収書の入力 ─────────

/** 領収書の種類。名称ではなく記載内容で法的性質が決まる点に注意（docs/review/worker-B-tax-legal.md §1）。 */
export type ReceiptMode = 'general' | 'qualified' | 'qualifiedSimple';

/** 税区分。税率別合計に入れるのは taxable10 / taxable8 のみ。 */
export type TaxCategory = 'taxable10' | 'taxable8' | 'exempt' | 'outOfScope' | 'taxFree';
//                         課税10%       課税8%(軽減)  非課税     不課税       免税

export type TaxInputMode = 'inclusive' | 'exclusive'; // 税込入力 / 税抜入力（1書類内で統一）
export type RoundingMode = 'floor' | 'round' | 'ceil'; // 切捨て / 四捨五入 / 切上げ

export interface LineItem {
  description: string;
  /** 入力方式（税込／税抜）に従った、その明細の合計金額（円）。マイナスはPhase 1では不可。 */
  amountYen: number;
  category: TaxCategory;
}

export interface TaxInput {
  inputMode: TaxInputMode;
  rounding: RoundingMode;
  /** シンプル入力は明細1件で表す。 */
  items: LineItem[];
}

export type PaymentMethod = 'cash' | 'bankTransfer' | 'creditCard' | 'electronicMoney' | 'qrPayment' | 'other';

export interface IssuerInfo {
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  /** 入力されたままの文字列。正規化は normalizeRegistrationNumber で行う。 */
  registrationNumber: string;
  /** 消費税の課税事業者か。印紙税の判定（消費税額の区分記載の扱い）に使う。 */
  taxpayerType: 'taxable' | 'exempt' | 'unknown';
  /** 営業に関する受取か（営業に関しない受取書は印紙税が非課税）。 */
  businessNature: 'business' | 'nonBusiness' | 'unknown';
}

export interface RecipientInfo {
  name: string;
  /** 敬称。'様' | '御中' | '殿' | '' など。 */
  honorific: string;
}

export type DeliveryMethod = 'paper' | 'electronic';

export interface ReceiptInput {
  mode: ReceiptMode;
  issuer: IssuerInfo;
  recipient: RecipientInfo;
  /** 但し書き */
  proviso: string;
  /** 領収日（既定：当日） */
  receiptDate: string;
  /** 発行日。null＝領収日と同じ。 */
  issueDate: string | null;
  /** 取引日（適格請求書の「課税資産の譲渡等を行った年月日」に当たる）。 */
  transactionDate: string;
  /** 取引日を利用者が個別に編集したか（true なら領収日変更に連動させない）。 */
  transactionDateEdited: boolean;
  /** 領収書番号。ゲストは省略が基本。空文字＝番号なし。 */
  receiptNumber: string;
  paymentMethod: PaymentMethod | null;
  showPaymentMethod: boolean;
  tax: TaxInput;
  remarks: string;
  /** 印紙税の判定入力 */
  delivery: DeliveryMethod;
  /** 売上代金の受取書か（false＝売上代金以外：借入金・保険金など）。 */
  isSalesProceeds: boolean;
  /** 適格系モードの確認チェック */
  confirmations: {
    ownRegistrationNumber: boolean; // 「入力した登録番号は私自身のものです」
    simpleInvoiceEligibleBusiness: boolean; // 「私の事業は適格簡易請求書の対象事業です」
  };
  /** 控え用の項目（A4：領収書＋控え） */
  copyInfo: { issuedBy: string; paymentChannel: string; internalNote: string };
  /**
   * 訂正書面として発行するときの情報（任意。null/未指定＝通常の領収書）。
   * 元の書類の日付・番号と修正箇所を印字する（国税庁インボイスQ&A問33の「関連性の明示＋修正事項の明示」）。
   */
  correction?: { originalDate: string; originalNumber: string; changes: string } | null;
}

// ───────── 税計算・検証・印紙税 ─────────

export interface TaxRateBreakdown {
  rate: 10 | 8;
  /** 税抜の対象金額（税率ごとの合計） */
  baseExclusiveYen: number;
  taxYen: number;
  /** 税込の対象金額 = base + tax */
  inclusiveYen: number;
}

export interface TaxBreakdown {
  byRate: TaxRateBreakdown[]; // 10, 8 の順。該当がない税率は含めない
  /** 非課税・不課税・免税の明細合計（税の対象外）。 */
  nonTaxableYen: number;
  /** 領収金額（税込の総額）。 */
  grandTotalYen: number;
  totalTaxYen: number;
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  /** 機械可読コード（例: 'recipient.required', 'registration.format'）。UIとテストが参照する。 */
  code: string;
  level: IssueLevel;
  field?: string;
  /** 利用者向けの平易な日本語。 */
  message: string;
}

export type StampDutyLevel = 'none' | 'estimate' | 'possible' | 'unknown';

export interface StampDutyGuidance {
  /**
   * none: 課税されない可能性が高い／estimate: 目安の金額あり／possible: 課税の可能性あり（金額は断定しない）／
   * unknown: 自動では判断できない。断定語（「不要です」等）は使わない。
   */
  level: StampDutyLevel;
  amountYen: number | null;
  /** 判定の前提（入力条件）を利用者向けに列挙。 */
  premises: string[];
  /** 判断理由・注意（利用者向け日本語）。 */
  notes: string[];
  /** 根拠URLと確認日。 */
  sources: { label: string; url: string; checkedAt: string }[];
  /** 税額表の施行日・確認日（データ版数）。 */
  tableVersion: { effectiveFrom: string; checkedAt: string };
}

// ───────── デザイン・印刷 ─────────

export type DesignId = 'simple' | 'business' | 'casual';
export type PrintFormat = 'a4-single' | 'a5-single' | 'a4-double' | 'a4-with-copy';

/** 角印アプリ内作成の指定 */
export interface SealSpec {
  /** 2〜6文字程度。 */
  text: string;
  layout: 'v1x2' | 'v2x2' | 'v2x3' | 'v3x3' | 'auto';
  color: string; // 例 '#C8161D'
  frame: 'single' | 'double' | 'none';
  roundedFrame: boolean;
}

export interface ImageAsset {
  /** 'data:image/png;base64,...'（透過PNG）。 */
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

export interface DesignSettings {
  design: DesignId;
  themeColor: string; // '#RRGGBB'
  format: PrintFormat;
  showSeal: boolean;
  /** 画像アップロードの印影。sealSpec より優先。 */
  sealImage: ImageAsset | null;
  sealSpec: SealSpec | null;
  /** 領収書上の位置（領収書シート左上基準、mm）と大きさ（mm、正方形の一辺）。 */
  sealPlacement: { xMm: number; yMm: number; sizeMm: number };
  logo: ImageAsset | null;
  logoWidthMm: number;
  showRevenueStampBox: boolean;
  showCutGuide: boolean;
  /** 控え（④）で下半分にも裁断ガイドを描くか、奇数件の下半分空欄で描くか等は layout 側の既定に従う。 */
  showCutGuideOnEmptyHalf: boolean;
  /** 一般モードで「この領収書は適格請求書（インボイス）ではありません」を小さく表示するか（既定 true）。 */
  showNotInvoiceNotice: boolean;
  /** 一般モードで、税率別の税込合計・消費税相当額を「参考表示」するか（Q1 案B。既定 true）。登録番号は一般モードでは常に印字しない。 */
  showGeneralTaxReference: boolean;
}

// ───────── 描画リスト（プレビューとPDFの共通表現） ─────────
// 座標はすべて mm、原点は左上、y は下向き。テキストは1行ずつ解決済み（折り返し済み）。

export type FontRole = 'sans' | 'sansBold' | 'serif' | 'serifBold';

export interface TextOp {
  type: 'text';
  x: number;
  /** ベースラインのy */
  y: number;
  text: string;
  font: FontRole;
  sizePt: number;
  color: string;
  align?: 'left' | 'center' | 'right'; // 既定 left。x は align の基準位置。
  letterSpacingPt?: number;
}
export interface LineOp {
  type: 'line';
  x1: number; y1: number; x2: number; y2: number;
  widthMm: number;
  color: string;
  dash?: number[]; // mm
}
export interface RectOp {
  type: 'rect';
  x: number; y: number; w: number; h: number;
  fill?: string; stroke?: string; strokeWidthMm?: number; radiusMm?: number;
}
export interface PathOp {
  type: 'path';
  /** SVGパスデータ。座標はページ上のmm（平行移動済み）。 */
  d: string;
  fill?: string; stroke?: string; strokeWidthMm?: number; opacity?: number;
  fillRule?: 'nonzero' | 'evenodd';
}
export interface ImageOp {
  type: 'image';
  x: number; y: number; w: number; h: number;
  dataUrl: string;
  opacity?: number;
}
export type DrawOp = TextOp | LineOp | RectOp | PathOp | ImageOp;

export interface Page {
  widthMm: number;
  heightMm: number;
  ops: DrawOp[];
}

/** 領収書1枚分の描画（原点はシートの左上）。 */
export interface Sheet {
  widthMm: number;
  heightMm: number;
  ops: DrawOp[];
}

// ───────── 一括発行 ─────────

export interface RecipientRow {
  /** 取り込み元の行番号（1始まり、ヘッダーを除く）。 */
  sourceRow: number;
  name: string;
  honorific: string; // 空なら共通設定の敬称を使う
  /** 宛先コード・住所などは Phase 2 のマスター連携用に保持する。 */
  code: string;
  postalCode: string;
  address: string;
  contactPerson: string;
  group: string;
  memo: string;
}
