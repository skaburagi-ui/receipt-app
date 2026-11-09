import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { DesignId, DrawOp, LineItem, PrintFormat, ReceiptMode } from '../domain/types';
import { buildSheet } from './buildSheet';
import { loadFonts } from './measure';
import { opBounds } from './ops';
import { sheetSizeMm } from './impose';
import { sampleDesign, sampleReceipt, taxForSingle, TAX_10, TAX_MIXED, TINY_PNG } from './testFixtures';

type TextO = Extract<DrawOp, { type: 'text' }>;

beforeAll(async () => {
  await loadFonts();
});

const allText = (ops: DrawOp[]) => ops.filter((o): o is TextO => o.type === 'text').map((t) => t.text);
const joined = (ops: DrawOp[]) => allText(ops).join('\n');

const DESIGNS: DesignId[] = ['simple', 'business', 'casual'];
const MODES: ReceiptMode[] = ['general', 'qualified', 'qualifiedSimple'];
const FORMATS: PrintFormat[] = ['a4-single', 'a5-single', 'a4-double', 'a4-with-copy'];

const mixedItems: LineItem[] = [
  { description: '宿泊費', amountYen: 11000, category: 'taxable10' },
  { description: '朝食', amountYen: 5400, category: 'taxable8' },
];

describe('一般モード：登録番号・「インボイス」「適格」を出さない（回帰）', () => {
  for (const d of DESIGNS) {
    for (const f of FORMATS) {
      it(`${d} / ${f}`, () => {
        const design = sampleDesign({ design: d, format: f, showNotInvoiceNotice: false, showGeneralTaxReference: true, showRevenueStampBox: true });
        for (const role of ['original', 'copy'] as const) {
          const r = buildSheet(sampleReceipt({ mode: 'general', receiptNumber: 'No-1', tax: { inputMode: 'inclusive', rounding: 'floor', items: mixedItems } }), TAX_MIXED, design, role);
          const t = joined(r.sheet.ops);
          expect(t).not.toMatch(/T1234567890123/);
          expect(t).not.toMatch(/1234567890123/);
          expect(t).not.toMatch(/登録番号/);
          expect(t).not.toMatch(/インボイス/);
          expect(t).not.toMatch(/適格/);
        }
      });
    }
  }

  it('登録番号が全角・ハイフン付きで入っていても出さない', () => {
    const r = buildSheet(
      sampleReceipt({ mode: 'general', issuer: { ...sampleReceipt().issuer, registrationNumber: 'Ｔ９８７６-５４３２-１０９８７' } }),
      TAX_10,
      sampleDesign(),
      'original',
    );
    expect(joined(r.sheet.ops)).not.toMatch(/\d{13}|9876|5432|登録番号/);
  });

  it('showNotInvoiceNotice=true のときだけ「適格請求書ではありません」を小さく出す（それ以外に「適格」「インボイス」は出ない）', () => {
    const on = joined(buildSheet(sampleReceipt(), TAX_10, sampleDesign({ showNotInvoiceNotice: true }), 'original').sheet.ops);
    expect(on).toContain('この領収書は適格請求書ではありません');
    expect(on.replace('この領収書は適格請求書ではありません', '')).not.toMatch(/適格|インボイス/);
    const off = joined(buildSheet(sampleReceipt(), TAX_10, sampleDesign({ showNotInvoiceNotice: false }), 'original').sheet.ops);
    expect(off).not.toMatch(/適格|インボイス|ではありません/);
  });

  it('showGeneralTaxReference に従って税の参考表示を出す／出さない', () => {
    const on = joined(buildSheet(sampleReceipt(), TAX_MIXED, sampleDesign({ showGeneralTaxReference: true }), 'original').sheet.ops);
    expect(on).toMatch(/参考.*10%対象.*¥11,000.*¥1,000/);
    expect(on).toMatch(/8%対象.*¥5,400.*¥400/);
    const off = joined(buildSheet(sampleReceipt(), TAX_MIXED, sampleDesign({ showGeneralTaxReference: false }), 'original').sheet.ops);
    expect(off).not.toMatch(/参考|消費税相当額/);
  });
});

describe('適格系モードの必須要素', () => {
  const qualifiedReceipt = () =>
    sampleReceipt({
      mode: 'qualified',
      transactionDate: '2026-11-03',
      receiptDate: '2026-11-05',
      issuer: { ...sampleReceipt().issuer, registrationNumber: 'Ｔ1234-5678-90123' },
      proviso: 'ご宿泊費',
      tax: { inputMode: 'inclusive', rounding: 'floor', items: mixedItems },
    });

  it('適格請求書：書類名・登録番号（T+13桁）・取引日・宛名・税率別の金額と税額・※と凡例', () => {
    const t = joined(buildSheet(qualifiedReceipt(), TAX_MIXED, sampleDesign(), 'original').sheet.ops);
    expect(t).toContain('領収書');
    expect(t).toContain('適格請求書');
    expect(t).toContain('登録番号 T1234567890123');
    expect(t).toContain('取引日　2026年11月3日');
    expect(t).toContain('髙﨑邉𠮷㈱①〒');
    expect(t).toContain('様');
    expect(t).toContain('10%対象');
    expect(t).toContain('8%対象※');
    expect(t).toContain('※朝食');
    expect(t).toContain('¥10,000');
    expect(t).toContain('¥1,000');
    expect(t).toContain('¥5,000');
    expect(t).toContain('¥400');
    expect(t).toContain('※は軽減税率対象');
    expect(t).toContain('但し ご宿泊費 として');
    expect(t).not.toMatch(/インボイス/);
  });

  it('軽減税率が無ければ「※は軽減税率対象」を出さない', () => {
    const r = qualifiedReceipt();
    r.tax.items = [mixedItems[0]];
    const t = joined(buildSheet(r, TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(t).not.toContain('※');
  });

  it('適格簡易請求書：登録番号・取引日・税率ごとの合計・税額。宛名が空なら「上様」', () => {
    const r = sampleReceipt({
      mode: 'qualifiedSimple',
      recipient: { name: '', honorific: '' },
      issuer: { ...sampleReceipt().issuer, registrationNumber: 'T1234567890123' },
      tax: { inputMode: 'inclusive', rounding: 'floor', items: mixedItems },
    });
    const t = joined(buildSheet(r, TAX_MIXED, sampleDesign(), 'original').sheet.ops);
    expect(t).toContain('適格簡易請求書');
    expect(t).toContain('登録番号 T1234567890123');
    expect(t).toContain('取引日');
    expect(t).toContain('上');
    expect(t).toContain('様');
    expect(t).toContain('¥11,000');
    expect(t).toContain('¥1,000');
    expect(t).toContain('消費税額等');
  });

  it('適格系の日付は取引日。領収日が違うときだけ領収日も小さく出す', () => {
    const same = joined(buildSheet(sampleReceipt({ mode: 'qualified' }), TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(same).toContain('取引日　2026年11月5日');
    expect(same).not.toContain('領収日');
    const diff = joined(buildSheet(qualifiedReceipt(), TAX_MIXED, sampleDesign(), 'original').sheet.ops);
    expect(diff).toContain('領収日　2026年11月5日');
  });

  it('非課税等がある場合は税率別の表に別行で出す', () => {
    const tax = { ...TAX_10, nonTaxableYen: 500, grandTotalYen: 11500 };
    const t = joined(buildSheet(sampleReceipt({ mode: 'qualified' }), tax, sampleDesign(), 'original').sheet.ops);
    expect(t).toContain('非課税・不課税・免税');
    expect(t).toContain('¥500');
  });
});

describe('訂正書面・控えの保存案内', () => {
  it('訂正の見出し、元書類、修正内容を描画する', () => {
    const receipt = sampleReceipt({
      correction: { originalDate: '2026-10-01', originalNumber: 'R-001', changes: '誤：10,000円 → 正：11,000円' },
    });
    const text = joined(buildSheet(receipt, TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(text).toContain('領収書（訂正）');
    expect(text).toContain('2026年10月1日付 No. R-001について、下記のとおり訂正します');
    expect(text).toContain('誤：10,000円 → 正：11,000円');
  });

  it('保存案内は控えだけに出し、一般モードでは適格請求書の語を出さない', () => {
    const receipt = sampleReceipt({ mode: 'general' });
    const original = joined(buildSheet(receipt, TAX_10, sampleDesign(), 'original').sheet.ops);
    const copy = joined(buildSheet(receipt, TAX_10, sampleDesign(), 'copy').sheet.ops);
    expect(original).not.toContain('この控えは発行者が保存してください');
    expect(copy).toContain('この控えは発行者が保存してください');
    expect(copy).not.toContain('適格請求書の写し');
  });

  it('適格簡易で品目名が空なら但し書きを内容欄に使う', () => {
    const receipt = sampleReceipt({ mode: 'qualifiedSimple', proviso: 'お食事代', tax: { inputMode: 'inclusive', rounding: 'floor', items: [{ description: '', amountYen: 11000, category: 'taxable10' }] } });
    const text = joined(buildSheet(receipt, TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(text).toContain('お食事代');
    expect(text).not.toContain('（品目なし）');
  });
});

describe('共通の表記規約', () => {
  it('領収金額は「¥1,234-」形式、日付は「2026年11月5日」形式', () => {
    const t = joined(buildSheet(sampleReceipt(), taxForSingle(1234), sampleDesign(), 'original').sheet.ops);
    expect(t).toContain('¥1,234-');
    expect(t).toContain('2026年11月5日');
    expect(t).toContain('領収書');
    expect(t).toContain('上記正に領収いたしました');
    expect(joined(buildSheet(sampleReceipt(), taxForSingle(12345678), sampleDesign(), 'original').sheet.ops)).toContain('¥12,345,678-');
  });

  it('領収書番号は空なら出さない／あれば出す', () => {
    expect(joined(buildSheet(sampleReceipt({ receiptNumber: '' }), TAX_10, sampleDesign(), 'original').sheet.ops)).not.toMatch(/No\./);
    expect(joined(buildSheet(sampleReceipt({ receiptNumber: '   ' }), TAX_10, sampleDesign(), 'original').sheet.ops)).not.toMatch(/No\./);
    expect(joined(buildSheet(sampleReceipt({ receiptNumber: 'A-0012' }), TAX_10, sampleDesign(), 'original').sheet.ops)).toContain('No. A-0012');
  });

  it('発行者ブロック：名称・〒住所・電話', () => {
    const t = joined(buildSheet(sampleReceipt(), TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(t).toContain('株式会社髙﨑商事');
    expect(t).toContain('〒100-0005');
    expect(t).toContain('東京都千代田区丸の内1-9-1');
    expect(t).toContain('TEL 03-1234-5678');
  });

  it('支払方法は showPaymentMethod が true のときのみ。備考は出る', () => {
    const base = { paymentMethod: 'bankTransfer' as const, remarks: '振込手数料は当方負担' };
    const on = joined(buildSheet(sampleReceipt({ ...base, showPaymentMethod: true }), TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(on).toContain('お支払方法：銀行振込');
    expect(on).toContain('備考：振込手数料は当方負担');
    const off = joined(buildSheet(sampleReceipt({ ...base, showPaymentMethod: false }), TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(off).not.toContain('お支払方法');
    expect(off).toContain('備考：');
  });

  it('但し書きが空でも描画できる（記入欄の形で出る）。末尾が「として」なら重ねない', () => {
    const empty = joined(buildSheet(sampleReceipt({ proviso: '' }), TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(empty).toMatch(/但し\s*として/);
    const dup = joined(buildSheet(sampleReceipt({ proviso: 'お品代として' }), TAX_10, sampleDesign(), 'original').sheet.ops);
    expect(dup).toContain('但し お品代として');
    expect(dup).not.toContain('としてとして');
  });
});

describe('収入印紙欄・控え', () => {
  it('収入印紙欄は showRevenueStampBox かつ role=original のときのみ', () => {
    const d = sampleDesign({ showRevenueStampBox: true });
    expect(joined(buildSheet(sampleReceipt(), TAX_10, d, 'original').sheet.ops)).toContain('収入印紙');
    expect(joined(buildSheet(sampleReceipt(), TAX_10, d, 'copy').sheet.ops)).not.toContain('収入印紙');
    expect(joined(buildSheet(sampleReceipt(), TAX_10, sampleDesign({ showRevenueStampBox: false }), 'original').sheet.ops)).not.toContain('収入印紙');
  });

  it('控え：「控」表示、同一番号・同一金額、copyInfo を描く。正本には「控」も copyInfo も出ない', () => {
    const r = sampleReceipt({ receiptNumber: '0007', copyInfo: { issuedBy: '山田', paymentChannel: '銀行振込', internalNote: '請求書1234と照合' } });
    const d = sampleDesign({ format: 'a4-with-copy' });
    const copy = joined(buildSheet(r, TAX_10, d, 'copy').sheet.ops);
    const orig = joined(buildSheet(r, TAX_10, d, 'original').sheet.ops);
    expect(allText(buildSheet(r, TAX_10, d, 'copy').sheet.ops)).toContain('控');
    expect(copy).toContain('No. 0007');
    expect(copy).toContain('¥11,000-');
    expect(copy).toContain('発行担当：山田');
    expect(copy).toContain('入金方法：銀行振込');
    expect(copy).toContain('管理用備考：請求書1234と照合');
    expect(allText(buildSheet(r, TAX_10, d, 'original').sheet.ops)).not.toContain('控');
    expect(orig).not.toContain('発行担当');
    expect(orig).not.toContain('管理用備考');
  });
});

describe('寸法と余白', () => {
  it('シート寸法：a4-single=210x297、a5-single=210x148、a4-double/a4-with-copy=210x148.5', () => {
    const exp: Record<PrintFormat, [number, number]> = { 'a4-single': [210, 297], 'a5-single': [210, 148], 'a4-double': [210, 148.5], 'a4-with-copy': [210, 148.5] };
    for (const f of FORMATS) {
      const s = buildSheet(sampleReceipt(), TAX_10, sampleDesign({ format: f }), 'original').sheet;
      expect([s.widthMm, s.heightMm]).toEqual(exp[f]);
      expect(sheetSizeMm(f)).toEqual({ widthMm: exp[f][0], heightMm: exp[f][1] });
    }
  });

  const heavy = () =>
    sampleReceipt({
      mode: 'qualified',
      receiptNumber: '2026-000123',
      showPaymentMethod: true,
      paymentMethod: 'creditCard',
      remarks: '備考のサンプルです。',
      copyInfo: { issuedBy: '山田', paymentChannel: '銀行振込', internalNote: '管理用メモ' },
      tax: { inputMode: 'inclusive', rounding: 'floor', items: mixedItems },
    });

  for (const d of DESIGNS) {
    for (const f of FORMATS) {
      for (const m of MODES) {
        it(`全ops（文字・罫線・枠・画像）がシート端から8mm以上内側：${d} / ${f} / ${m}`, () => {
          const design = sampleDesign({
            design: d, format: f, showRevenueStampBox: true, showSeal: true,
            sealImage: { dataUrl: TINY_PNG, widthPx: 8, heightPx: 8 },
            logo: { dataUrl: TINY_PNG, widthPx: 80, heightPx: 20 }, logoWidthMm: 36,
          });
          for (const role of ['original', 'copy'] as const) {
            const { sheet } = buildSheet({ ...heavy(), mode: m }, m === 'general' ? TAX_10 : TAX_MIXED, design, role);
            for (const op of sheet.ops) {
              const b = opBounds(op);
              if (!b) continue;
              expect(b.x1, JSON.stringify(op)).toBeGreaterThanOrEqual(8 - 1e-6);
              expect(b.y1, JSON.stringify(op)).toBeGreaterThanOrEqual(8 - 1e-6);
              expect(b.x2, JSON.stringify(op)).toBeLessThanOrEqual(sheet.widthMm - 8 + 1e-6);
              expect(b.y2, JSON.stringify(op)).toBeLessThanOrEqual(sheet.heightMm - 8 + 1e-6);
            }
          }
        });
      }
    }
  }

  it('角印の位置が端に寄りすぎていても、シート端から8mm以上内側へ丸める', () => {
    const design = sampleDesign({ format: 'a4-double', showSeal: true, sealImage: { dataUrl: TINY_PNG, widthPx: 8, heightPx: 8 }, sealPlacement: { xMm: 205, yMm: 146, sizeMm: 20 } });
    const { sheet } = buildSheet(sampleReceipt(), TAX_10, design, 'original');
    const img = sheet.ops.find((o) => o.type === 'image' && o.dataUrl === TINY_PNG && o.w === 20) as Extract<DrawOp, { type: 'image' }>;
    expect(img).toBeTruthy();
    expect(img.x + img.w).toBeLessThanOrEqual(202 + 1e-6);
    expect(img.y + img.h).toBeLessThanOrEqual(140.5 + 1e-6);
  });
});

describe('デザイン3種の区別', () => {
  const sheetOf = (d: DesignId) => buildSheet(sampleReceipt(), TAX_10, sampleDesign({ design: d, themeColor: '#C8161D' }), 'original').sheet.ops;
  it('simple：ゴシック・細罫線（フォントは sans 系のみ、塗り面なし）', () => {
    const ops = sheetOf('simple');
    expect(ops.filter((o): o is TextO => o.type === 'text').every((t) => t.font === 'sans' || t.font === 'sansBold')).toBe(true);
    expect(ops.some((o) => o.type === 'rect' && o.fill)).toBe(false);
  });
  it('business：明朝見出し・二重罫（外枠が2重）', () => {
    const ops = sheetOf('business');
    const title = ops.find((o): o is TextO => o.type === 'text' && o.text === '領収書')!;
    expect(title.font).toBe('serifBold');
    expect(ops.filter((o) => o.type === 'rect' && o.stroke && !o.fill).length).toBeGreaterThanOrEqual(4); // 外枠×2＋金額枠×2
  });
  it('casual：ゴシック太字・角丸・テーマカラー面（見出し帯の文字は面の色に対して読める色）', () => {
    const ops = sheetOf('casual');
    const title = ops.find((o): o is TextO => o.type === 'text' && o.text === '領収書')!;
    expect(title.font).toBe('sansBold');
    expect(ops.some((o) => o.type === 'rect' && o.fill === '#C8161D' && (o.radiusMm ?? 0) > 0)).toBe(true);
    expect(title.color).toBe('#ffffff'); // 濃い赤の面には白文字
    const light = buildSheet(sampleReceipt(), TAX_10, sampleDesign({ design: 'casual', themeColor: '#FFE08A' }), 'original').sheet.ops;
    expect(light.find((o): o is TextO => o.type === 'text' && o.text === '領収書')!.color).toBe('#111111'); // 淡色の面には黒文字
  });
  it('印刷で読みにくい淡色の文字を使わない（全文字の色が十分に濃い）', () => {
    for (const d of DESIGNS) {
      for (const op of sheetOf(d)) {
        if (op.type !== 'text') continue;
        if (op.color === '#ffffff') continue; // 面の上の白文字
        const n = parseInt(op.color.slice(1), 16);
        const lum = (((n >> 16) & 255) + ((n >> 8) & 255) + (n & 255)) / 3;
        expect(lum, `${d}:${op.text}`).toBeLessThanOrEqual(0x55);
      }
    }
  });
});

describe('ロゴ・角印', () => {
  it('ロゴは logoWidthMm 幅で左上に置かれる（縦長は高さ16mmまでに収める）', () => {
    const d = sampleDesign({ logo: { dataUrl: TINY_PNG, widthPx: 100, heightPx: 50 }, logoWidthMm: 30 });
    const img = buildSheet(sampleReceipt(), TAX_10, d, 'original').sheet.ops.find((o) => o.type === 'image') as Extract<DrawOp, { type: 'image' }>;
    expect(img.w).toBeCloseTo(30, 3);
    expect(img.h).toBeCloseTo(15, 3);
    const tall = sampleDesign({ logo: { dataUrl: TINY_PNG, widthPx: 50, heightPx: 100 }, logoWidthMm: 30 });
    const t = buildSheet(sampleReceipt(), TAX_10, tall, 'original').sheet.ops.find((o) => o.type === 'image') as Extract<DrawOp, { type: 'image' }>;
    expect(t.h).toBeLessThanOrEqual(16 + 1e-6);
  });

  it('sealImage があれば sealPlacement の位置に画像として置く（sealSpec より優先）', () => {
    const d = sampleDesign({
      showSeal: true,
      sealImage: { dataUrl: TINY_PNG, widthPx: 8, heightPx: 8 },
      sealSpec: { text: '山田', layout: 'auto', color: '#C8161D', frame: 'single', roundedFrame: false },
      sealPlacement: { xMm: 150, yMm: 80, sizeMm: 20 },
    });
    const ops = buildSheet(sampleReceipt(), TAX_10, d, 'original').sheet.ops;
    const img = ops.find((o) => o.type === 'image') as Extract<DrawOp, { type: 'image' }>;
    expect(img).toMatchObject({ x: 150, y: 80, w: 20, h: 20 });
    expect(ops.some((o) => o.type === 'path')).toBe(false);
  });

  it('showSeal=false なら角印を描かない', () => {
    const d = sampleDesign({ showSeal: false, sealImage: { dataUrl: TINY_PNG, widthPx: 8, heightPx: 8 } });
    expect(buildSheet(sampleReceipt(), TAX_10, d, 'original').sheet.ops.some((o) => o.type === 'image')).toBe(false);
  });

  it('buildSealOps が失敗（未実装）しても、角印だけ省略して描画を続ける', () => {
    const d = sampleDesign({ showSeal: true, sealSpec: { text: '山田', layout: 'auto', color: '#C8161D', frame: 'single', roundedFrame: false } });
    expect(() => buildSheet(sampleReceipt(), TAX_10, d, 'original')).not.toThrow();
  });
});

describe('長い入力：自動縮小とオーバーフロー判定', () => {
  const longName = '株式会社あいうえお日本橋ホールディングスグループ・カスタマーサクセス統括本部　第二営業企画部'; // 44字
  const longProviso60 = 'あ'.repeat(10) + 'い'.repeat(10) + 'う'.repeat(10) + 'え'.repeat(10) + 'お'.repeat(10) + 'か'.repeat(10);

  it('長い宛名：a4-double でも収まる。宛名は折り返され、欠落しない', () => {
    const r = buildSheet(sampleReceipt({ recipient: { name: longName, honorific: '御中' } }), TAX_10, sampleDesign({ format: 'a4-double' }), 'original');
    expect(r.overflow).toBe(false);
    const names = r.sheet.ops.filter((o): o is TextO => o.type === 'text' && longName.includes(o.text) && o.text.length > 1).map((o) => o.text);
    expect(names.join('')).toBe(longName);
  });

  it('60字の但し書き：折り返して全文を出し、a4-double でも収まる。文字は8pt以上', () => {
    const r = buildSheet(sampleReceipt({ proviso: longProviso60 }), TAX_10, sampleDesign({ format: 'a4-double' }), 'original');
    expect(r.overflow).toBe(false);
    const lines = r.sheet.ops.filter((o): o is TextO => o.type === 'text' && /^[あいうえおか]+$/.test(o.text.replace(/^但し /, '').replace(/ として$/, '')) && o.text.length > 3);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.map((l) => l.text).join('').replace(/但し | として/g, '')).toBe(longProviso60);
    for (const l of lines) expect(l.sizePt).toBeGreaterThanOrEqual(8);
  });

  it('明細・備考が多いケース：a4-single は収まる。a4-double で溢れるなら overflow=true で、描画は打ち切らない', () => {
    const items: LineItem[] = Array.from({ length: 6 }, (_, i) => ({ description: `明細${i + 1}の品名`, amountYen: 1000 * (i + 1), category: i % 2 ? 'taxable8' : 'taxable10' }));
    const tax = { ...TAX_MIXED };
    const r1 = buildSheet(sampleReceipt({ mode: 'qualified', remarks: '備考です。'.repeat(8), tax: { inputMode: 'inclusive', rounding: 'floor', items } }), tax, sampleDesign({ format: 'a4-single', showRevenueStampBox: true }), 'original');
    expect(r1.overflow).toBe(false);
    const many: LineItem[] = Array.from({ length: 14 }, (_, i) => ({ description: `明細${i + 1}`, amountYen: 100, category: 'taxable10' }));
    const r2 = buildSheet(sampleReceipt({ mode: 'qualified', remarks: '備考です。'.repeat(8), tax: { inputMode: 'inclusive', rounding: 'floor', items: many } }), tax, sampleDesign({ format: 'a4-double', showRevenueStampBox: true }), 'original');
    expect(r2.overflow).toBe(true);
    const t = joined(r2.sheet.ops);
    for (let i = 1; i <= 14; i++) expect(t).toContain(`明細${i}`); // 打ち切らない
    expect(t).toContain('株式会社髙﨑商事');
  });

  it('標準的な内容（適格請求書・明細2件・備考・支払方法・収入印紙欄）は全形式・全デザインで溢れない', () => {
    for (const d of DESIGNS) {
      for (const f of FORMATS) {
        const r = buildSheet(
          sampleReceipt({ mode: 'qualified', remarks: '振込手数料は貴社負担にてお願いします。', showPaymentMethod: true, paymentMethod: 'bankTransfer', tax: { inputMode: 'inclusive', rounding: 'floor', items: mixedItems } }),
          TAX_MIXED,
          sampleDesign({ design: d, format: f, showRevenueStampBox: true }),
          'original',
        );
        expect(r.overflow, `${d}/${f}`).toBe(false);
      }
    }
  });

  it('縮小しても文字は 7pt 未満にならない（本文は8pt以上）', () => {
    const many: LineItem[] = Array.from({ length: 14 }, (_, i) => ({ description: `明細${i + 1}`, amountYen: 100, category: 'taxable10' }));
    const r = buildSheet(sampleReceipt({ mode: 'qualified', tax: { inputMode: 'inclusive', rounding: 'floor', items: many } }), TAX_MIXED, sampleDesign({ format: 'a4-double' }), 'original');
    for (const o of r.sheet.ops) if (o.type === 'text') expect(o.sizePt).toBeGreaterThanOrEqual(7);
    const body = r.sheet.ops.filter((o): o is TextO => o.type === 'text' && /^明細\d+$/.test(o.text));
    for (const o of body) expect(o.sizePt).toBeGreaterThanOrEqual(8);
  });
});

describe('buildSealOps を使った角印の配置（モック）', () => {
  it('buildSealOps の結果を sealPlacement の位置へ平行移動して追加する', async () => {
    vi.resetModules();
    vi.doMock('../seal/seal', () => ({
      buildSealOps: (_spec: unknown, size: number): DrawOp[] => [{ type: 'path', d: `M0 0 L${size} 0 L${size} ${size} L0 ${size} Z`, stroke: '#C8161D', strokeWidthMm: 0.4 }],
    }));
    const mod = await import('./buildSheet');
    const d = sampleDesign({ showSeal: true, sealSpec: { text: '山田', layout: 'auto', color: '#C8161D', frame: 'single', roundedFrame: false }, sealPlacement: { xMm: 150, yMm: 80, sizeMm: 18 } });
    const ops = mod.buildSheet(sampleReceipt(), TAX_10, d, 'original').sheet.ops;
    const p = ops.find((o) => o.type === 'path') as Extract<DrawOp, { type: 'path' }>;
    expect(p.d).toBe('M150 80 L168 80 L168 98 L150 98 Z');
    vi.doUnmock('../seal/seal');
    vi.resetModules();
  });
});
