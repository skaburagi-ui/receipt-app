import type { ReceiptInput, StampDutyGuidance } from './types';
import { calculateTax } from './tax';
import { STAMP_DUTY_NON_SALES, STAMP_DUTY_TABLE_SALES, lookupStampDuty } from './stampDutyTable';

/**
 * 印紙税の目安（none/estimate/possible/unknown）。断定語を使わない。自動判定しないケース
 * （クレジット・QR・電子マネー・有価証券・不動産・営業か不明・課税事業者か不明など）は unknown。
 * 電子交付は「課税文書に当たらないとする国税庁の質疑応答がある」旨を notes に出すが断定しない。担当: W1
 * 根拠：docs/review/worker-B-tax-legal.md §9。
 */

const CHECKED_AT = '2026-11-05';

const SRC = {
  table: { label: '国税庁 No.7141 印紙税額の一覧表（その2）', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7141.htm' },
  taxDivision: { label: '国税庁 No.7124 消費税額等が区分記載されている場合の記載金額', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7124.htm' },
  nonBusiness: { label: '国税庁 No.7125 営業に関しない受取書', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7125.htm' },
  electronic: { label: '国税庁 質疑応答事例（電子メールで送信した電磁的記録と印紙税）', url: 'https://www.nta.go.jp/law/shitsugi/inshi/02/10.htm' },
  penalty: { label: '国税庁 No.7131 印紙税を納めなかったとき（過怠税）', url: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7131.htm' },
  creditCard: { label: '国税庁 質疑応答事例（クレジットカードで支払う場合の受取書）', url: 'https://www.nta.go.jp/law/shitsugi/inshi/19/37.htm' },
  codePayment: { label: '国税庁 質疑応答事例（コード決済の場合の受取書）', url: 'https://www.nta.go.jp/law/shitsugi/inshi/19/50.htm' },
} as const;

const PAYMENT_LABEL: Record<string, string> = {
  cash: '現金',
  bankTransfer: '銀行振込',
  creditCard: 'クレジットカード',
  electronicMoney: '電子マネー',
  qrPayment: 'QR・コード決済',
  other: 'その他',
};

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

export function guideStampDuty(input: ReceiptInput, opts?: { taxAmountShown?: boolean }): StampDutyGuidance {
  const breakdown = calculateTax(input.tax);
  const gross = breakdown.grandTotalYen;
  const net = gross - breakdown.totalTaxYen;
  const taxAmountShown = opts?.taxAmountShown ?? input.mode !== 'general';
  const { taxpayerType, businessNature } = input.issuer;

  const premises: string[] = [
    `受取金額（税込の総額）：${yen(gross)}`,
    taxAmountShown
      ? `消費税額：書面に区分して記載する前提（${yen(breakdown.totalTaxYen)}）`
      : '消費税額：書面に区分して記載しない前提',
    `事業者区分：${taxpayerType === 'taxable' ? '消費税の課税事業者' : taxpayerType === 'exempt' ? '消費税の免税事業者' : '不明'}`,
    `交付方法：${input.delivery === 'paper' ? '紙に印刷して渡す' : '電子データ（PDFなど）で渡す'}`,
    `営業に関する受取か：${businessNature === 'business' ? '営業に関する受取' : businessNature === 'nonBusiness' ? '営業に関しない受取' : '不明'}`,
    `売上代金の受取書か：${input.isSalesProceeds ? '売上代金（商品・サービスの対価）' : '売上代金以外（借入金・保険金など）'}`,
    `支払方法：${input.paymentMethod ? (PAYMENT_LABEL[input.paymentMethod] ?? 'その他') : '未選択'}`,
  ];

  const commonNotes = [
    '収入印紙の購入・貼り付け・消印は、利用者ご自身で行います。このアプリは印紙を貼りません。',
    '必要な印紙を貼らなかった場合は、過怠税（原則として印紙税額の3倍。自主的に申し出た場合は1.1倍）がかかることがあります。',
    '表示は一般的な目安です。個別の取引では扱いが異なる場合があります。',
  ];

  const sources = (...extra: { label: string; url: string }[]) =>
    [SRC.table, ...extra, SRC.penalty].map((s) => ({ ...s, checkedAt: CHECKED_AT }));

  const make = (
    level: StampDutyGuidance['level'],
    amountYen: number | null,
    notes: string[],
    extraSources: { label: string; url: string }[] = [],
  ): StampDutyGuidance => ({
    level,
    amountYen,
    premises,
    notes: [...notes, ...commonNotes],
    sources: sources(...extraSources),
    tableVersion: { effectiveFrom: STAMP_DUTY_TABLE_SALES.effectiveFrom, checkedAt: STAMP_DUTY_TABLE_SALES.checkedAt },
  });

  // 1. クレジット・電子マネー・QR決済は自動では判断しない
  if (input.paymentMethod === 'creditCard' || input.paymentMethod === 'electronicMoney' || input.paymentMethod === 'qrPayment') {
    const notes =
      input.paymentMethod === 'creditCard'
        ? ['クレジットカード払いの場合、領収書に「クレジットカード払い」などと書くかどうかで、印紙税の扱いが変わることがあります。自動では判断できません。']
        : input.paymentMethod === 'qrPayment'
          ? ['QR・コード決済は、決済サービスによって金銭の受け取りに当たるかどうかが異なります。「コード決済」とだけ書いた領収書の扱いなど、自動では判断できません。']
          : ['電子マネーは、サービスによって金銭の受け取りに当たるかどうかが異なる可能性があります。自動では判断できません。'];
    return make('unknown', null, ['判断できません。', ...notes, '税務署または税理士にご確認ください。'], [
      input.paymentMethod === 'creditCard' ? SRC.creditCard : SRC.codePayment,
    ]);
  }

  // 2. 営業に関する受取か
  if (businessNature === 'unknown') {
    return make('unknown', null, ['判断できません。営業に関する受取かどうかが分からないため、印紙税の目安を出せません。'], [SRC.nonBusiness]);
  }
  if (businessNature === 'nonBusiness') {
    return make(
      'none',
      null,
      [
        '営業に関しない受取書は、印紙税の対象外となる可能性があります。',
        '自治会・任意団体などの行為が「営業」に当たるかどうかは、個別に判断が必要です。迷う場合は税務署または税理士にご確認ください。',
      ],
      [SRC.nonBusiness],
    );
  }

  // 3. 電子データのみで交付
  if (input.delivery === 'electronic') {
    return make(
      'none',
      null,
      [
        '電子データ（PDFなど）だけで渡す場合は、印紙税の課税文書の作成に当たらないとする国税庁の質疑応答があります。',
        'ただし、領収書そのものについて明記した資料は確認できていません。',
        '紙に印刷して渡す場合は、課税文書になる可能性があります。',
      ],
      [SRC.electronic],
    );
  }

  // 7（先行）. 金額が0円以下
  if (gross <= 0) {
    return make('unknown', null, ['判断できません。金額が入力されていないため、目安を出せません。']);
  }

  // 4. 紙交付：判定に使う金額を決める（金額の区分記載があり、課税事業者なら税抜）
  const classify = (amount: number): number => {
    if (amount <= 0) return 0;
    if (!input.isSalesProceeds) return amount < STAMP_DUTY_NON_SALES.nonTaxableBelowYen ? 0 : STAMP_DUTY_NON_SALES.taxYen;
    return lookupStampDuty(amount) ?? 0;
  };

  let judgedAmount: number;
  const amountNotes: string[] = [];
  const extraSources: { label: string; url: string }[] = [];
  if (taxAmountShown && taxpayerType === 'taxable') {
    judgedAmount = net;
    amountNotes.push(`消費税額を書面に区分して記載する課税事業者のため、税抜金額（${yen(net)}）で判定しています。`);
    extraSources.push(SRC.taxDivision);
  } else if (taxAmountShown && taxpayerType === 'unknown') {
    extraSources.push(SRC.taxDivision);
    if (classify(gross) !== classify(net)) {
      return make(
        'unknown',
        null,
        [
          `判断できません。課税事業者か免税事業者かで、税込金額（${yen(gross)}）と税抜金額（${yen(net)}）のどちらで判定するかが変わり、結果が分かれます。`,
          '課税事業者かどうかを選ぶと、目安を表示できます。',
        ],
        extraSources,
      );
    }
    judgedAmount = gross;
    amountNotes.push('課税事業者か免税事業者かが不明ですが、税込・税抜のどちらで判定しても同じ区分になります。');
  } else {
    judgedAmount = gross;
    amountNotes.push(
      taxAmountShown
        ? `免税事業者が消費税相当額を区分して書いても、税込の金額（${yen(gross)}）で判定します。`
        : `消費税額が書面で明らかでないため、税込の総額（${yen(gross)}）で判定しています。`,
    );
    extraSources.push(SRC.taxDivision);
  }

  // 5. 売上代金以外（17号の2）
  if (!input.isSalesProceeds) {
    const notes = [...amountNotes, '売上代金以外の受取書（借入金・保険金などの受取）として判定しています。'];
    if (judgedAmount < STAMP_DUTY_NON_SALES.nonTaxableBelowYen) {
      return make('none', null, [...notes, '受取金額が5万円未満のため、非課税となる可能性があります。'], extraSources);
    }
    return make('estimate', STAMP_DUTY_NON_SALES.taxYen, [...notes, '受取金額が5万円以上のため、印紙税額は200円となる目安です。'], extraSources);
  }

  // 6. 売上代金：税額表で判定
  const taxYen = lookupStampDuty(judgedAmount);
  if (taxYen === null) {
    return make('unknown', null, ['判断できません。税額表に当てはまる金額が見つかりませんでした。'], extraSources);
  }
  if (taxYen === 0) {
    return make(
      'none',
      null,
      [...amountNotes, `判定金額${yen(judgedAmount)}は5万円未満のため、印紙税が非課税となる可能性があります。`],
      extraSources,
    );
  }
  const notes = [
    ...amountNotes,
    `判定金額${yen(judgedAmount)}は、売上代金の受取書（第17号の1文書）の税額表では ${yen(taxYen)} の区分に当たる可能性があります。`,
  ];
  if (judgedAmount > 1_000_000) {
    notes.push('金額が大きい場合は、税務署または税理士に確認することをおすすめします。');
  }
  return make('estimate', taxYen, notes, extraSources);
}
