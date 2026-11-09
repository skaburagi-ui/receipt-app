import PDFDocument from 'pdfkit';
import type { DrawOp, FontRole, Page } from '../domain/types';
import { ALL_FONT_ROLES, loadFontBytes } from '../layout/fontLoader';
import { loadFonts, measureText } from '../layout/measure';

/**
 * ページ列からPDFを生成する（pdfkit 直接利用。pdfmake の内部と同じ pdfkit 0.20 系）。
 * - 1 `Page` = 1 PDFページ。自動フロー・自動改ページは使わず、DrawOp を座標で描く（座標はmm、原点左上）。
 * - フォントは public/fonts/*.subset.ttf をそのまま登録する。pdfkit が使用文字だけにさらにサブセット化して埋め込む。
 * - Node（テスト）とブラウザー／Worker の両方で動く。出力は Uint8Array（Buffer に依存しない）。
 * - catalog に ViewerPreferences/PrintScaling=None を書く（印刷ダイアログの既定を「実際のサイズ」にする指示。
 *   尊重するかはビューアー次第）。
 */

const MM = 72 / 25.4; // mm → pt

export interface GeneratePdfOptions {
  title?: string;
  /** 完了ページ数 / 総ページ数 */
  onProgress?: (done: number, total: number) => void;
  /** 中断用。abort されたら DOMException('AbortError') で reject する。 */
  signal?: AbortSignal;
}

const FAMILY: Record<FontRole, string> = {
  sans: 'ReceiptSans',
  sansBold: 'ReceiptSansBold',
  serif: 'ReceiptSerif',
  serifBold: 'ReceiptSerifBold',
};

function abortError(): Error {
  return typeof DOMException !== 'undefined' ? new DOMException('PDFの作成を中止しました', 'AbortError') : Object.assign(new Error('PDFの作成を中止しました'), { name: 'AbortError' });
}

function usedRoles(pages: Page[]): FontRole[] {
  const set = new Set<FontRole>();
  for (const p of pages) for (const op of p.ops) if (op.type === 'text' && op.text !== '') set.add(op.font);
  return ALL_FONT_ROLES.filter((r) => set.has(r));
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** pdfkit の色指定として安全な文字列にする（'#RGB' '#RRGGBB' 以外は黒）。 */
function color(c: string | undefined, fallback = '#000000'): string {
  return c && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c) ? c : fallback;
}

function drawOp(doc: PDFKit.PDFDocument, op: DrawOp): void {
  switch (op.type) {
    case 'text': {
      if (op.text === '') return;
      const ls = op.letterSpacingPt ?? 0;
      let x = op.x;
      if (op.align === 'center' || op.align === 'right') {
        const w = measureText(op.text, op.font, op.sizePt, ls);
        x = op.align === 'center' ? op.x - w / 2 : op.x - w;
      }
      doc.font(FAMILY[op.font]).fontSize(op.sizePt).fillColor(color(op.color));
      doc.text(op.text, x * MM, op.y * MM, { lineBreak: false, baseline: 'alphabetic', characterSpacing: ls });
      return;
    }
    case 'line': {
      doc.save();
      doc.lineWidth(op.widthMm * MM).strokeColor(color(op.color));
      if (op.dash && op.dash.length > 0) {
        const a = op.dash[0] * MM;
        const b = (op.dash[1] ?? op.dash[0]) * MM;
        doc.dash(a, { space: b });
      }
      doc.moveTo(op.x1 * MM, op.y1 * MM).lineTo(op.x2 * MM, op.y2 * MM).stroke();
      doc.restore();
      return;
    }
    case 'rect': {
      if (!op.fill && !op.stroke) return;
      doc.save();
      const x = op.x * MM, y = op.y * MM, w = op.w * MM, h = op.h * MM;
      if (op.radiusMm && op.radiusMm > 0) doc.roundedRect(x, y, w, h, Math.min(op.radiusMm * MM, w / 2, h / 2));
      else doc.rect(x, y, w, h);
      if (op.stroke) doc.lineWidth((op.strokeWidthMm ?? 0.2) * MM);
      if (op.fill && op.stroke) doc.fillAndStroke(color(op.fill), color(op.stroke));
      else if (op.fill) doc.fill(color(op.fill));
      else doc.stroke(color(op.stroke));
      doc.restore();
      return;
    }
    case 'path': {
      if (!op.fill && !op.stroke) return;
      doc.save();
      if (op.opacity !== undefined) doc.opacity(Math.max(0, Math.min(1, op.opacity)));
      doc.scale(MM); // パス座標はmm。以降の座標・線幅はmm単位。
      doc.path(op.d);
      if (op.stroke) doc.lineWidth(op.strokeWidthMm ?? 0.2);
      const rule = op.fillRule === 'evenodd' ? 'evenodd' : undefined;
      if (op.fill && op.stroke) doc.fillAndStroke(color(op.fill), color(op.stroke), rule);
      else if (op.fill) doc.fill(color(op.fill), rule);
      else doc.stroke(color(op.stroke));
      doc.restore();
      return;
    }
    case 'image': {
      doc.save();
      if (op.opacity !== undefined) doc.opacity(Math.max(0, Math.min(1, op.opacity)));
      // data URL の文字列を渡すと pdfkit が同一画像を1度だけ登録して使い回す。
      doc.image(op.dataUrl, op.x * MM, op.y * MM, { width: op.w * MM, height: op.h * MM });
      doc.restore();
      return;
    }
  }
}

/** ページ列からPDFを生成（pdfkit、静的TTFサブセット埋め込み、座標描画）。 */
export async function generatePdf(pages: Page[], opts: GeneratePdfOptions = {}): Promise<Uint8Array> {
  if (opts.signal?.aborted) throw abortError();
  const roles = usedRoles(pages);
  // 計測（右寄せ・中央寄せ）用の fontkit も同じバイト列から用意する。
  const [bytes] = await Promise.all([Promise.all(roles.map((r) => loadFontBytes(r))), loadFonts(roles)]);

  const doc = new PDFDocument({
    autoFirstPage: false,
    // 既定フォント（Helvetica）を読み込ませない。ブラウザー用ビルドの pdfkit は標準フォントを registerStdFonts() で
    // 登録しないと「Standard font Helvetica is not registered」で失敗する。使うのは registerFont した日本語フォントだけ。
    font: '',
    compress: true,
    info: { Title: opts.title ?? '', Creator: 'かんたん領収書', Producer: 'かんたん領収書' },
  });
  const chunks: Uint8Array[] = [];
  doc.on('data', (c: Uint8Array) => chunks.push(c));
  const ended = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve());
    doc.on('error', reject);
  });
  roles.forEach((r, i) => doc.registerFont(FAMILY[r], bytes[i] as unknown as Uint8Array));

  // 印刷時の拡大縮小を「なし（実際のサイズ）」にする指示。pdfkit は catalog の公開APIを持たないため内部の _root を使う。
  const root = (doc as unknown as { _root?: { data: Record<string, unknown> } })._root;
  if (root && typeof (doc as unknown as { ref?: unknown }).ref === 'function') {
    root.data.ViewerPreferences = (doc as unknown as { ref: (d: object) => unknown }).ref({ PrintScaling: 'None', DisplayDocTitle: true });
  }

  const total = pages.length;
  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw abortError();
    const page = pages[i];
    doc.addPage({ size: [page.widthMm * MM, page.heightMm * MM], margin: 0 });
    for (const op of page.ops) drawOp(doc, op);
    opts.onProgress?.(i + 1, total);
    if ((i + 1) % 10 === 0) await tick(); // 長いループでUI（フォールバック時）や中断要求に制御を返す
  }
  if (total === 0) doc.addPage({ size: [210 * MM, 297 * MM], margin: 0 }); // 0ページのPDFは不正なので空白1枚
  doc.end();
  await ended;

  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
