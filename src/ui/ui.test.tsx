// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 他担当（W2/W3）のモジュールは同時に実装中のため、画面のテストではモックする。
vi.mock('../layout/measure', () => ({
  loadFonts: vi.fn(async () => undefined),
  fontsLoaded: vi.fn(() => true),
  findMissingGlyphs: vi.fn((t: string) => (t.includes('𠮷') ? ['𠮷'] : [])),
}));
vi.mock('../layout/buildSheet', () => ({
  buildSheet: vi.fn(() => ({ sheet: { widthMm: 210, heightMm: 297, ops: [] }, overflow: false })),
}));
vi.mock('../layout/impose', () => ({
  imposePages: vi.fn(() => [{ widthMm: 210, heightMm: 297, ops: [] }]),
  pageSizeMm: vi.fn(() => ({ widthMm: 210, heightMm: 297 })),
}));
vi.mock('../layout/svg', () => ({
  pageToSvg: vi.fn(() => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297"><text x="10" y="10">PREVIEW-OK</text><script>alert(1)</script></svg>'),
}));
vi.mock('../layout/testPrint', () => ({ buildTestPrintPages: vi.fn(() => [{ widthMm: 210, heightMm: 297, ops: [] }]) }));
vi.mock('../pdf/workerClient', () => ({
  generatePdfInWorker: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
}));
vi.mock('../seal/seal', () => ({
  buildSealOps: vi.fn(() => []),
  sealToSvg: vi.fn(() => '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'),
  findUnsupportedChars: vi.fn(() => []),
  isSealFontLoaded: vi.fn(() => true),
  loadSealFont: vi.fn(async () => undefined),
}));
vi.mock('../image/process', () => ({ processUploadedImage: vi.fn(async () => { throw new Error('not implemented'); }) }));

import { App } from './App';
import { BulkDialog } from './components/BulkDialog';
import { createDefaultReceipt } from '../domain/defaults';
import { createDefaultDesign } from './defaults';
import { deleteAllDrafts, listDrafts, saveDraft } from '../storage/drafts';
import { generatePdfInWorker } from '../pdf/workerClient';
import { buildSheet } from '../layout/buildSheet';

beforeEach(() => {
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const chooseHasInvoice = () => fireEvent.click(within(screen.getByRole('region', { name: 'どんな領収書を作りますか？' })).getByLabelText('はい'));
const pdfButton = () => screen.getByRole('button', { name: 'PDFを保存' });
const change = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

function fillBasics() {
  change(screen.getByLabelText('発行者（あなたの名前・会社名）'), '山田商店');
  change(screen.getByLabelText('領収金額'), '12,000');
  change(screen.getByLabelText('但し書き'), 'お食事代として');
}

describe('モード選択', () => {
  it('支払方法が未選択のとき、現金とは表示しない', () => {
    render(<App />);
    expect((screen.getByLabelText('支払方法（印紙税の目安用）') as HTMLSelectElement).value).toBe('');
  });

  it('一般モードでは登録番号の欄が無く、「はい」を選ぶと出る', () => {
    render(<App />);
    expect(screen.queryByLabelText('インボイス登録番号')).toBeNull();
    chooseHasInvoice();
    expect(screen.getByLabelText('インボイス登録番号')).toBeTruthy();
    // 続けて小売の質問が出て、確認チェックボックスが出る
    expect(screen.getByText('不特定多数のお客様に対する、小売・飲食・タクシー等の事業ですか？')).toBeTruthy();
    expect(screen.getByLabelText(/入力した登録番号は私自身のものです/)).toBeTruthy();
  });

  it('簡易インボイスを選ぶと対象事業の確認が出る。一般に戻すと登録番号欄が消える', () => {
    render(<App />);
    chooseHasInvoice();
    expect(screen.queryByLabelText(/対象事業|上記に該当することを確認/)).toBeNull();
    fireEvent.click(screen.getByLabelText(/簡易インボイス/));
    expect(screen.getByLabelText(/上記に該当することを確認/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/いいえ（ふつうの領収書）/));
    expect(screen.queryByLabelText('インボイス登録番号')).toBeNull();
    expect(screen.getByLabelText(/適格請求書（インボイス）ではありません/)).toBeTruthy();
  });

  it('一般モードで以前に入力した登録番号は、出力用の入力に含めない', () => {
    render(<App />);
    chooseHasInvoice();
    change(screen.getByLabelText('インボイス登録番号'), 'T1234567890123');
    fireEvent.click(screen.getByLabelText(/いいえ（ふつうの領収書）/));
    fillBasics();
    return waitFor(() => {
      const calls = vi.mocked(buildSheet).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const last = calls[calls.length - 1][0];
      expect(last.mode).toBe('general');
      expect(last.issuer.registrationNumber).toBe('');
    });
  });
});

describe('出力ボタンの有効・無効', () => {
  it('適格系でエラーの間はPDF保存・印刷が無効。理由と切り替えボタンが出て、一般に切り替えると有効になる', async () => {
    render(<App />);
    fillBasics();
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
    chooseHasInvoice();
    expect(pdfButton().hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '印刷' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/適格請求書（インボイス）に必要な項目が足りない/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'ふつうの領収書に切り替える' }));
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
    expect(screen.queryByLabelText('インボイス登録番号')).toBeNull();
  });

  it('適格請求書に必要な項目がそろい確認にチェックすると有効になる', async () => {
    render(<App />);
    fillBasics();
    change(screen.getByLabelText('宛名（領収書を受け取る人・会社）'), '株式会社サンプル');
    chooseHasInvoice();
    change(screen.getByLabelText('インボイス登録番号'), 'Ｔ１２３４５６７８９０１２３');
    fireEvent.click(screen.getByLabelText(/入力した登録番号は私自身のものです/));
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
  });

  it('金額が0円のときは無効', () => {
    render(<App />);
    change(screen.getByLabelText('発行者（あなたの名前・会社名）'), '山田商店');
    expect(pdfButton().hasAttribute('disabled')).toBe(true);
  });
});

describe('日付の連動', () => {
  it('領収日を変えると取引日も変わり、取引日を個別に編集すると連動しなくなる', () => {
    render(<App />);
    const receiptDate = screen.getByLabelText('領収日') as HTMLInputElement;
    const tx = screen.getByLabelText(/^取引日/) as HTMLInputElement;
    change(receiptDate, '2026-10-01');
    expect(tx.value).toBe('2026-10-01');
    change(tx, '2026-09-15');
    change(receiptDate, '2026-10-20');
    expect(tx.value).toBe('2026-09-15');
    fireEvent.click(screen.getByRole('button', { name: '取引日を領収日に合わせる' }));
    expect(tx.value).toBe('2026-10-20');
    change(receiptDate, '2026-11-02');
    expect(tx.value).toBe('2026-11-02');
  });

  it('適格系では取引日がインボイス上の日付になる説明が出る', () => {
    render(<App />);
    chooseHasInvoice();
    expect(screen.getByText(/取引日が、インボイス上の日付になります/)).toBeTruthy();
  });
});

describe('プレビュー', () => {
  it('SVGを表示し、scriptは取り除かれる', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText('領収書のプレビュー').textContent).toContain('PREVIEW-OK'));
    expect(document.querySelector('.receipt-svg script')).toBeNull();
  });

  it('フォントに無い文字を警告する', async () => {
    render(<App />);
    change(screen.getByLabelText('発行者（あなたの名前・会社名）'), '𠮷野商店');
    await waitFor(() => expect(screen.getAllByText(/領収書の書体に無いため/).length).toBeGreaterThan(0), { timeout: 2000 });
  });
});

describe('PDF保存', () => {
  it('宛名が空欄のときは確認し、進むとPDFを作って保存の案内を出す', async () => {
    render(<App />);
    fillBasics();
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
    fireEvent.click(pdfButton());
    const dlg = await screen.findByRole('dialog', { name: '宛名が空欄です' });
    fireEvent.click(within(dlg).getByRole('button', { name: '宛名なしで進む' }));
    const done = await screen.findByRole('dialog', { name: 'PDFを保存しました' });
    expect(done.textContent).toContain('領収書_');
    expect(done.textContent).toContain('写し（控え）の保存は、利用者の責任');
    expect(done.textContent).toContain('原則7年間');
    expect(generatePdfInWorker).toHaveBeenCalledTimes(1);
  });

  it('印刷の前に、設定の案内を出す', async () => {
    render(<App />);
    fillBasics();
    change(screen.getByLabelText('宛名（領収書を受け取る人・会社）'), '株式会社サンプル');
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '印刷' }));
    const dlg = await screen.findByRole('dialog', { name: '印刷する前に' });
    expect(dlg.textContent).toContain('100%（実際のサイズ）');
    expect(dlg.textContent).toContain('ヘッダーとフッター：なし');
    expect(generatePdfInWorker).not.toHaveBeenCalled();
  });
});

describe('金額入力', () => {
  it('マイナスは入力できない旨を案内する', () => {
    render(<App />);
    change(screen.getByLabelText('領収金額'), '-500');
    expect(screen.getAllByText(/マイナスの金額は入力できません/).length).toBeGreaterThan(0);
  });
  it('有効値を不正な文字へ直すと直前の金額を残さず、出力を停止する', async () => {
    render(<App />);
    fillBasics();
    const amount = screen.getByLabelText('領収金額');
    change(amount, '12O00');
    expect(screen.getAllByText(/金額は数字だけで入力してください/).length).toBeGreaterThan(0);
    // 画面上部のまとめ（IssueList）にも、検証のエラーとして出る
    expect(document.querySelector('.summary [data-code="item.amount.invalid"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PDFを保存' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '印刷' }).hasAttribute('disabled')).toBe(true);
    change(amount, '12000');
    await waitFor(() => expect(screen.getByRole('button', { name: 'PDFを保存' }).hasAttribute('disabled')).toBe(false));
  });
});

describe('下書き保存', () => {
  beforeEach(async () => { await deleteAllDrafts(); });

  it('既定ではOFFで、入力しても保存されない。ONにすると警告を出し、保存される', async () => {
    render(<App />);
    const toggle = screen.getByLabelText('この端末に下書きを保存する') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fillBasics();
    await new Promise((r) => setTimeout(r, 1300));
    expect(await listDrafts()).toHaveLength(0);

    fireEvent.click(toggle);
    const warn = await screen.findByRole('dialog', { name: '下書きの保存をONにしますか？' });
    expect(warn.textContent).toContain('共有PC・職場・ネットカフェでは使わないでください');
    expect(warn.textContent).toContain('Safari');
    expect(await listDrafts()).toHaveLength(0); // 承諾前は保存しない
    fireEvent.click(within(warn).getByRole('button', { name: '理解した上でONにする' }));
    await waitFor(async () => expect((await listDrafts()).length).toBe(1), { timeout: 4000 });
    await waitFor(() => expect(screen.getByText(/最終保存：/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'すべて削除' }));
    await waitFor(async () => expect(await listDrafts()).toHaveLength(0));
  });

  it('保存した下書きを、次回の起動時に読み込める（読み込むまで自動保存で上書きしない）', async () => {
    const first = render(<App />);
    fireEvent.click(screen.getByLabelText('この端末に下書きを保存する'));
    fireEvent.click(await screen.findByRole('button', { name: '理解した上でONにする' }));
    change(screen.getByLabelText('発行者（あなたの名前・会社名）'), '山田商店');
    await waitFor(async () => expect((await listDrafts())[0]?.label ?? '').toContain('山田商店'), { timeout: 4000 });
    first.unmount();

    render(<App />);
    expect(await screen.findByText(/前回の下書きがあります/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 1300));
    expect((await listDrafts())[0].label).toContain('山田商店'); // 空の入力で上書きされていない
    fireEvent.click(screen.getAllByRole('button', { name: '読み込む' })[0]);
    await waitFor(() => expect((screen.getByLabelText('発行者（あなたの名前・会社名）') as HTMLInputElement).value).toBe('山田商店'));
  });
});

describe('一括発行', () => {
  const base = { ...createDefaultReceipt('2026-11-05'), issuer: { ...createDefaultReceipt('2026-11-05').issuer, name: '山田商店' }, tax: { inputMode: 'inclusive' as const, rounding: 'floor' as const, items: [{ description: '', amountYen: 1000, category: 'taxable10' as const }] }, proviso: 'お品代として' };

  const renderBulk = (receipt = base) => render(<BulkDialog base={receipt} design={createDefaultDesign()} dispatch={() => undefined} onClose={() => undefined} />);

  const importPaste = (text: string) => {
    fireEvent.click(screen.getByRole('button', { name: '次へ：宛先の取り込み' }));
    change(screen.getByLabelText(/Excelなどの表をコピーして貼り付け/), text);
    fireEvent.click(screen.getByRole('button', { name: '貼り付けた内容を取り込む' }));
    fireEvent.click(screen.getByRole('button', { name: '次へ：確認' }));
  };

  it('重複は警告、空欄はエラーで、エラーの間は作れない。行を削除すると作れる', () => {
    renderBulk();
    importPaste('宛名\t敬称\n山田太郎\t様\n山田太郎\t様\n \t様\n');
    expect(screen.getByText(/同じ宛名があります/)).toBeTruthy();
    expect(screen.getByText(/宛名が空欄です/)).toBeTruthy();
    const gen = () => screen.getByRole('button', { name: /件のPDFを作る/ });
    expect(gen().hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '3件目を削除' }));
    expect(gen().hasAttribute('disabled')).toBe(false);
  });

  it('上へ・下へで並べ替えられ、宛名を編集できる', () => {
    renderBulk();
    importPaste('宛名\n甲\n乙\n丙\n');
    const names = () => (screen.getAllByLabelText(/件目の宛名/) as HTMLInputElement[]).map((i) => i.value);
    expect(names()).toEqual(['甲', '乙', '丙']);
    fireEvent.click(screen.getByRole('button', { name: '1件目を下へ' }));
    expect(names()).toEqual(['乙', '甲', '丙']);
    fireEvent.click(screen.getByRole('button', { name: '3件目を上へ' }));
    expect(names()).toEqual(['乙', '丙', '甲']);
    change(screen.getByLabelText('1件目の宛名'), '乙商事');
    expect(names()[0]).toBe('乙商事');
  });

  it('適格請求書モードでは「上様」の宛名をエラーにする', () => {
    const q = { ...base, mode: 'qualified' as const, issuer: { ...base.issuer, registrationNumber: 'T1234567890123' }, confirmations: { ownRegistrationNumber: true, simpleInvoiceEligibleBusiness: false } };
    renderBulk(q);
    importPaste('宛名\n上様\n山田太郎\n');
    expect(screen.getAllByText(/上様」など宛名の代わりになる語だけの宛名は使えません/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /件のPDFを作る/ }).hasAttribute('disabled')).toBe(true);
  });

  it('PDFを作ると進捗付きで保存され、保存の案内が出る', async () => {
    renderBulk();
    importPaste('宛名\n甲\n乙\n');
    fireEvent.click(screen.getByRole('button', { name: '2件のPDFを作る' }));
    await waitFor(() => expect(screen.getByText(/を保存しました/)).toBeTruthy());
    expect(generatePdfInWorker).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/写し（控え）の保存は、利用者の責任/)).toBeTruthy();
  });

  it('CSVのひな形と、宛先をサーバーに送らない旨を表示する', () => {
    renderBulk();
    fireEvent.click(screen.getByRole('button', { name: '次へ：宛先の取り込み' }));
    expect(screen.getByRole('button', { name: 'CSVのひな形をダウンロード' })).toBeTruthy();
    expect(screen.getByText(/サーバーには送りません/)).toBeTruthy();
    expect(screen.getByText(/会員機能で提供予定/)).toBeTruthy();
  });

  it('取込成功後に大きすぎるCSVを選ぶと、前回の宛先を破棄して次へ進めない', () => {
    renderBulk();
    importPaste('宛名\n甲\n乙\n');
    fireEvent.click(screen.getByRole('button', { name: '戻る' }));

    const input = screen.getByLabelText('CSVファイルを選ぶ');
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'too-large.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [oversized] } });

    expect(screen.getByText(/ファイルが大きすぎます/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '次へ：確認' }).hasAttribute('disabled')).toBe(true);
  });
});


describe('金額欄の不正入力（H1）', () => {
  const bad = ['12O00', '12,0 00', '12000円（税込）', '-500', '12.5', '99999999999', '12345678901234567890'];
  // 全角数字・カンマ・円・¥ は従来どおり受け付ける
  const good: [string, string][] = [['１２，０００', '12000'], ['¥12,000', '12000'], ['12,000円', '12000']];

  it.each(bad)('「%s」は不正として扱い、出力を止める', async (text) => {
    render(<App />);
    fillBasics();
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
    change(screen.getByLabelText('領収金額'), text);
    expect(pdfButton().hasAttribute('disabled')).toBe(true);
    expect(document.querySelector('.summary .issue-error')).toBeTruthy();
  });

  it.each(good)('「%s」は受け付けて正規化する', async (text) => {
    render(<App />);
    fillBasics();
    change(screen.getByLabelText('領収金額'), text);
    fireEvent.blur(screen.getByLabelText('領収金額'));
    expect((screen.getByLabelText('領収金額') as HTMLInputElement).value).toBe('12000');
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
  });

  it('不正入力のあいだ、直前の有効な金額でプレビューを作り続けない', async () => {
    render(<App />);
    fillBasics();
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
    change(screen.getByLabelText('領収金額'), '12O00');
    await waitFor(() => {
      const calls = vi.mocked(buildSheet).mock.calls;
      const last = calls[calls.length - 1];
      // 税計算の結果（領収金額）が0になっている＝12,000円が残っていない
      expect(last[1].grandTotalYen).toBe(0);
    });
  });

  it('詳細入力の明細金額も、不正入力で出力を止める', () => {
    render(<App />);
    fillBasics();
    change(screen.getByLabelText('金額 1（税込）'), '12O00');
    expect(pdfButton().hasAttribute('disabled')).toBe(true);
  });
});

describe('保存の案内・印紙税の案内（H2・M6）', () => {
  it('保存・印刷の前から、控えの保存の案内が常に見え、「くわしく」に全文がある', () => {
    render(<App />);
    const bar = screen.getByRole('region', { name: 'PDFの保存と印刷' });
    expect(within(bar).getByText(/控えの保存：/).parentElement?.textContent).toContain('7年間');
    expect(bar.querySelector('details')?.textContent).toContain('くわしく');
    expect(bar.querySelector('details')?.textContent).toContain('保存は、利用者の責任');
  });

  it('印紙税の目安が estimate のとき案内を出し、none（電子データ渡し）のときは出さない', async () => {
    render(<App />);
    fillBasics();
    change(screen.getByLabelText('領収金額'), '120,000');
    const bar = screen.getByRole('region', { name: 'PDFの保存と印刷' });
    expect(within(bar).getByText(/収入印紙が必要になる可能性があります/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('PDFなどの電子データで渡す'));
    expect(within(bar).queryByText(/収入印紙が必要になる可能性があります/)).toBeNull();
  });

  it('印刷前・保存後のモーダルにも印紙税の案内を出し、印刷前には環境別の手順を出す', async () => {
    render(<App />);
    fillBasics();
    change(screen.getByLabelText('宛名（領収書を受け取る人・会社）'), '株式会社サンプル');
    change(screen.getByLabelText('領収金額'), '120,000');
    await waitFor(() => expect(pdfButton().hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '印刷' }));
    const dlg = await screen.findByRole('dialog', { name: '印刷する前に' });
    expect(dlg.textContent).toContain('収入印紙が必要になる可能性があります');
    expect(dlg.textContent).toContain('その他の設定');
    expect(dlg.textContent).toContain('iPhone');
    expect(dlg.textContent).toContain('お使いの環境の表記は異なる場合があります');
    fireEvent.click(within(dlg).getByRole('button', { name: 'やめる' }));
    fireEvent.click(pdfButton());
    const done = await screen.findByRole('dialog', { name: 'PDFを保存しました' });
    expect(done.textContent).toContain('収入印紙が必要になる可能性があります');
  });
});

describe('支払方法と印紙税（M5）', () => {
  it('印紙税用の支払方法は、領収書に表示するチェックと独立している', () => {
    render(<App />);
    const show = screen.getByLabelText('支払方法を領収書に表示する') as HTMLInputElement;
    const select = () => screen.getByLabelText('支払方法（印紙税の目安用）') as HTMLSelectElement;
    expect(show.checked).toBe(false);
    change(select(), 'creditCard');
    expect(show.checked).toBe(false);
    expect(screen.getByText(/書面にその支払方法を書くかで印紙税の扱いが変わります/)).toBeTruthy();
    expect(screen.getAllByText(/印紙税は、自動では判断できません/).length).toBeGreaterThan(0);
    fireEvent.click(show);
    expect(select().value).toBe('creditCard');
    fireEvent.click(show);
    expect(select().value).toBe('creditCard');
  });
});

describe('税抜入力（M10）', () => {
  it('税抜のときは「税抜金額」に変わり、税込の領収金額を示す', () => {
    render(<App />);
    fillBasics();
    expect(screen.queryByLabelText('税抜金額')).toBeNull();
    fireEvent.click(screen.getByLabelText(/税抜（消費税は別）/));
    change(screen.getByLabelText('税抜金額'), '10000');
    expect(screen.getAllByText(/領収金額（税込）は 11,000円/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText(/税込（消費税を含む）/));
    expect(screen.getByLabelText('領収金額')).toBeTruthy();
  });
});

describe('フォントに無い文字の警告（M9）', () => {
  it('入力タブの中にも警告がある（スマホで入力タブにいても見える）', async () => {
    render(<App />);
    change(screen.getByLabelText('発行者（あなたの名前・会社名）'), '𠮷野商店');
    await waitFor(() => expect(document.querySelector('#pane-input .narrow-only')?.textContent).toContain('𠮷'), { timeout: 2000 });
  });
});

describe('検証の失敗は出力を止める（L1）', () => {
  it('検証が例外を投げたら、エラー1件を返して出力を止める', async () => {
    const validate = await import('../domain/validate');
    const spy = vi.spyOn(validate, 'validateReceipt').mockImplementation(() => { throw new Error('boom'); });
    try {
      render(<App />);
      fillBasics();
      expect(screen.getAllByText(/入力内容を検証できません/).length).toBeGreaterThan(0);
      expect(pdfButton().hasAttribute('disabled')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('訂正書面（UI）', () => {
  it('チェックで入力欄が出て、ONで correction がセットされ、OFFで消える', async () => {
    render(<App />);
    fillBasics();
    expect(screen.queryByLabelText('元の領収日')).toBeNull();
    fireEvent.click(screen.getByLabelText('訂正書面として発行する'));
    change(screen.getByLabelText('元の領収日'), '2026-10-01');
    change(screen.getByLabelText('元の領収書番号'), 'R-001');
    change(screen.getByLabelText(/訂正内容/), '誤：10,000円 → 正：11,000円');
    expect(screen.getAllByText(/誤：10,000円 → 正：11,000円/).length).toBeGreaterThan(0);
    await waitFor(() => {
      const calls = vi.mocked(buildSheet).mock.calls;
      expect(calls[calls.length - 1][0].correction).toEqual({ originalDate: '2026-10-01', originalNumber: 'R-001', changes: '誤：10,000円 → 正：11,000円' });
    });
    fireEvent.click(screen.getByLabelText('訂正書面として発行する'));
    expect(screen.queryByLabelText('元の領収日')).toBeNull();
    await waitFor(() => {
      const calls = vi.mocked(buildSheet).mock.calls;
      expect(calls[calls.length - 1][0].correction ?? null).toBeNull();
    });
  });
});

describe('下書きの復元と確認チェック（M4）／すべて削除（L-5）', () => {
  beforeEach(async () => { await deleteAllDrafts(); });

  it('復元すると確認チェックを両方外し、その旨を表示する', async () => {
    const r = createDefaultReceipt('2026-11-06');
    const receipt = {
      ...r, mode: 'qualifiedSimple' as const,
      issuer: { ...r.issuer, name: '山田商店', registrationNumber: 'T1234567890123' },
      confirmations: { ownRegistrationNumber: true, simpleInvoiceEligibleBusiness: true },
    };
    await saveDraft('current', { kind: 'full', receipt, design: createDefaultDesign() }, 'x');
    localStorage.setItem('receipt-app-draft-enabled', '1');
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: '読み込む' }))[0]);
    await screen.findByText(/確認チェックは、安全のため外しました。もう一度確認してください/);
    expect((screen.getByLabelText(/入力した登録番号は私自身のものです/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/上記に該当することを確認/) as HTMLInputElement).checked).toBe(false);
  });

  it('下書きONのまま「すべて削除」すると、自動保存もOFFにして、復活させない', async () => {
    render(<App />);
    fireEvent.click(screen.getByLabelText('この端末に下書きを保存する'));
    fireEvent.click(await screen.findByRole('button', { name: '理解した上でONにする' }));
    change(screen.getByLabelText('発行者（あなたの名前・会社名）'), '山田商店');
    await waitFor(async () => expect((await listDrafts()).length).toBe(1), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: 'すべて削除' }));
    await waitFor(async () => expect(await listDrafts()).toHaveLength(0));
    expect((screen.getByLabelText('この端末に下書きを保存する') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/自動保存もOFFにしました/)).toBeTruthy();
    expect(localStorage.getItem('receipt-app-draft-enabled')).toBeNull();
    await new Promise((res) => setTimeout(res, 1500));
    expect(await listDrafts()).toHaveLength(0);
  });
});

describe('一括発行：取り込みの警告・文字・再検証（M7・M8・L2）', () => {
  const base2 = { ...createDefaultReceipt('2026-11-05'), issuer: { ...createDefaultReceipt('2026-11-05').issuer, name: '山田商店' }, tax: { inputMode: 'inclusive' as const, rounding: 'floor' as const, items: [{ description: '', amountYen: 1000, category: 'taxable10' as const }] }, proviso: 'お品代として' };
  const renderBulk2 = () => render(<BulkDialog base={base2} design={createDefaultDesign()} dispatch={() => undefined} onClose={() => undefined} />);
  const toStep3 = (text: string) => {
    fireEvent.click(screen.getByRole('button', { name: '次へ：宛先の取り込み' }));
    change(screen.getByLabelText(/Excelなどの表をコピーして貼り付け/), text);
    fireEvent.click(screen.getByRole('button', { name: '貼り付けた内容を取り込む' }));
    fireEvent.click(screen.getByRole('button', { name: '次へ：確認' }));
  };

  it('301件目以降が読み込まれていないときは、手順3に警告を出し、確認するまで作れない', () => {
    renderBulk2();
    toStep3('宛名\n' + Array.from({ length: 301 }, (_, i) => `宛先${i + 1}`).join('\n'));
    const gen = () => screen.getByRole('button', { name: /件のPDFを作る/ });
    expect(screen.getAllByText(/読み込んでいません/).length).toBeGreaterThan(0);
    expect(gen().hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByLabelText('301件目以降は含まれないことを理解しました'));
    expect(gen().hasAttribute('disabled')).toBe(false);
  });

  it('フォントに無い文字を含む宛名の行に警告を出す', () => {
    renderBulk2();
    toStep3('宛名\n𠮷田商店\n山田太郎');
    expect(screen.getByText(/「𠮷」は四角く表示される可能性があります/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '2件のPDFを作る' }).hasAttribute('disabled')).toBe(false);
  });

  it('作成の直前に再検証し、error があればPDFを作らない', async () => {
    renderBulk2();
    toStep3('宛名\n甲');
    const validate = await import('../domain/validate');
    const spy = vi.spyOn(validate, 'validateReceipt').mockImplementation(() => [{ code: 'x', level: 'error', message: 'x' }]);
    try {
      fireEvent.click(screen.getByRole('button', { name: '1件のPDFを作る' }));
      await screen.findByText(/入力内容にエラーがあるため、PDFを作れません/);
      expect(generatePdfInWorker).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('金額欄の不正入力は、一括でも次へ進めない', () => {
    renderBulk2();
    change(screen.getByLabelText('領収金額（全員同じ）'), '1O00');
    expect(screen.getByRole('button', { name: '次へ：宛先の取り込み' }).hasAttribute('disabled')).toBe(true);
  });
});
