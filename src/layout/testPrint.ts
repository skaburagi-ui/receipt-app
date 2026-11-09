import type { DrawOp, Page } from '../domain/types';

/**
 * 実寸確認用の試し刷りページ（A4縦1枚）。
 * 外枠（210x297）、端から3/5/8/10mmの枠、100mm目盛（横・縦。10mmごとの数字）、A4二等分線（148.5mm）、50x50mmの角。
 * 印刷後に定規で測り、拡大縮小や余白の設定を確認するために使う。
 */

const BLACK = '#000000';
const GRAY = '#555555';

function ruler(ops: DrawOp[], x0: number, y0: number, vertical: boolean): void {
  // 0〜100mm。1mmごとに短い目盛、5mmは中、10mmは長い目盛と数字。
  ops.push(
    vertical
      ? { type: 'line', x1: x0, y1: y0, x2: x0, y2: y0 + 100, widthMm: 0.25, color: BLACK }
      : { type: 'line', x1: x0, y1: y0, x2: x0 + 100, y2: y0, widthMm: 0.25, color: BLACK },
  );
  for (let i = 0; i <= 100; i++) {
    const len = i % 10 === 0 ? 4 : i % 5 === 0 ? 2.5 : 1.4;
    const wd = i % 10 === 0 ? 0.25 : 0.15;
    if (vertical) {
      ops.push({ type: 'line', x1: x0, y1: y0 + i, x2: x0 + len, y2: y0 + i, widthMm: wd, color: BLACK });
    } else {
      ops.push({ type: 'line', x1: x0 + i, y1: y0, x2: x0 + i, y2: y0 + len, widthMm: wd, color: BLACK });
    }
    if (i % 10 === 0) {
      if (vertical) ops.push({ type: 'text', x: x0 + 5, y: y0 + i + 0.8, text: String(i), font: 'sans', sizePt: 6, color: BLACK });
      else ops.push({ type: 'text', x: x0 + i, y: y0 + 7.5, text: String(i), font: 'sans', sizePt: 6, color: BLACK, align: 'center' });
    }
  }
}

export function buildTestPrintPages(): Page[] {
  const W = 210;
  const H = 297;
  const ops: DrawOp[] = [];

  // 外枠（印字可能な内側のみが出る。端は0.15mm内側に描く）
  ops.push({ type: 'rect', x: 0.15, y: 0.15, w: W - 0.3, h: H - 0.3, stroke: GRAY, strokeWidthMm: 0.2 });

  // 端から 3/5/8/10mm の枠（8mm枠が実線・太め＝「ここまでは必ず印刷される想定」）
  const insets: { mm: number; dash?: number[]; width: number; color: string }[] = [
    { mm: 3, dash: [1, 1], width: 0.2, color: GRAY },
    { mm: 5, dash: [2, 1], width: 0.2, color: GRAY },
    { mm: 8, width: 0.4, color: BLACK },
    { mm: 10, dash: [0.6, 0.8], width: 0.25, color: GRAY },
  ];
  insets.forEach((f, k) => {
    const x1 = f.mm, y1 = f.mm, x2 = W - f.mm, y2 = H - f.mm;
    const mk = (a: number, b: number, c: number, d: number): DrawOp => ({ type: 'line', x1: a, y1: b, x2: c, y2: d, widthMm: f.width, color: f.color, dash: f.dash });
    ops.push(mk(x1, y1, x2, y1), mk(x2, y1, x2, y2), mk(x2, y2, x1, y2), mk(x1, y2, x1, y1));
    // 枠の名前（白地を敷いて線の上に重ねる）。上辺に、枠ごとにx位置をずらす。
    const lx = 40 + k * 32;
    ops.push({ type: 'rect', x: lx - 6, y: f.mm - 1.1, w: 12, h: 2.2, fill: '#ffffff' });
    ops.push({ type: 'text', x: lx, y: f.mm + 0.65, text: `${f.mm}mm`, font: 'sans', sizePt: 5.5, color: BLACK, align: 'center' });
  });

  // 見出しと操作手順
  ops.push({ type: 'text', x: W / 2, y: 26, text: '試し刷りページ（実寸の確認）', font: 'sansBold', sizePt: 15, color: BLACK, align: 'center' });
  const steps = [
    '印刷設定：用紙 A4 ／ 拡大縮小 100%（「実際のサイズ」）／ ヘッダーとフッターなし。',
    '「ページに合わせる」「用紙に合わせて縮小」はOFFにしてください。',
    '定規で測ります：横の目盛・縦の目盛は各100mm、破線は上から148.5mm、四角は50×50mm。',
    '8mmの枠（太い実線）が四辺とも欠けずに印刷されていれば、領収書の内容も欠けません。',
  ];
  steps.forEach((s, i) => ops.push({ type: 'text', x: 16, y: 36 + i * 5.2, text: s, font: 'sans', sizePt: 8.5, color: BLACK }));

  // 100mm目盛：横（x=55〜155）と縦（y=85〜185）
  ops.push({ type: 'text', x: 55, y: 66, text: '横 100mm', font: 'sansBold', sizePt: 8, color: BLACK });
  ruler(ops, 55, 70, false);
  ops.push({ type: 'text', x: 22, y: 82, text: '縦 100mm', font: 'sansBold', sizePt: 8, color: BLACK });
  ruler(ops, 22, 85, true);

  // A4二等分線（148.5mm）：端から5mm内側まで
  ops.push({ type: 'line', x1: 5, y1: 148.5, x2: 205, y2: 148.5, widthMm: 0.25, color: BLACK, dash: [2, 1.5] });
  ops.push({ type: 'text', x: 198, y: 147.5, text: 'A4二等分 148.5mm', font: 'sans', sizePt: 7, color: BLACK, align: 'right' });

  // 50×50mm の四角
  ops.push({ type: 'rect', x: 80, y: 200, w: 50, h: 50, stroke: BLACK, strokeWidthMm: 0.3 });
  ops.push({ type: 'text', x: 105, y: 226.5, text: '50×50mm', font: 'sansBold', sizePt: 10, color: BLACK, align: 'center' });
  ops.push({ type: 'text', x: 105, y: 262, text: '測った長さが ±1mm 以内なら実寸で印刷されています。', font: 'sans', sizePt: 8.5, color: BLACK, align: 'center' });

  return [{ widthMm: W, heightMm: H, ops }];
}
