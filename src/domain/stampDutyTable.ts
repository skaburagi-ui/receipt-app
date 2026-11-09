// 印紙税額表データ。法令改正に対応できるよう、施行日・出典・確認日つきのデータとして持つ。担当: W1
//
// 出典：国税庁 No.7141「印紙税額の一覧表（その2）」第17号の1文書（売上代金に係る金銭又は有価証券の受取書）。
// 令和8年4月1日現在法令等。確認日 2026-11-05。docs/review/worker-B-tax-legal.md §9(a) と一致させている。
// 税額表を更新する場合は、effectiveFrom / checkedAt / sourceUrl も必ず更新すること。

/** overYen は「超」（この金額は含まない）、upToYen は「以下」（この金額を含む。null＝上限なし）。金額は円の整数。 */
export interface StampDutyBracket { overYen: number; upToYen: number | null; taxYen: number; label?: string }

export const STAMP_DUTY_TABLE_SALES: { effectiveFrom: string; checkedAt: string; sourceUrl: string; brackets: StampDutyBracket[] } = {
  effectiveFrom: '2026-04-01', // 令和8年4月1日現在の法令等（現行）
  checkedAt: '2026-11-05',
  sourceUrl: 'https://www.nta.go.jp/taxes/shiraberu/taxanswer/inshi/7141.htm',
  brackets: [
    { overYen: 0, upToYen: 49_999, taxYen: 0, label: '5万円未満（非課税）' },
    { overYen: 49_999, upToYen: 1_000_000, taxYen: 200, label: '5万円以上100万円以下' },
    { overYen: 1_000_000, upToYen: 2_000_000, taxYen: 400, label: '100万円超200万円以下' },
    { overYen: 2_000_000, upToYen: 3_000_000, taxYen: 600, label: '200万円超300万円以下' },
    { overYen: 3_000_000, upToYen: 5_000_000, taxYen: 1_000, label: '300万円超500万円以下' },
    { overYen: 5_000_000, upToYen: 10_000_000, taxYen: 2_000, label: '500万円超1千万円以下' },
    { overYen: 10_000_000, upToYen: 20_000_000, taxYen: 4_000, label: '1千万円超2千万円以下' },
    { overYen: 20_000_000, upToYen: 30_000_000, taxYen: 6_000, label: '2千万円超3千万円以下' },
    { overYen: 30_000_000, upToYen: 50_000_000, taxYen: 10_000, label: '3千万円超5千万円以下' },
    { overYen: 50_000_000, upToYen: 100_000_000, taxYen: 20_000, label: '5千万円超1億円以下' },
    { overYen: 100_000_000, upToYen: 200_000_000, taxYen: 40_000, label: '1億円超2億円以下' },
    { overYen: 200_000_000, upToYen: 300_000_000, taxYen: 60_000, label: '2億円超3億円以下' },
    { overYen: 300_000_000, upToYen: 500_000_000, taxYen: 100_000, label: '3億円超5億円以下' },
    { overYen: 500_000_000, upToYen: 1_000_000_000, taxYen: 150_000, label: '5億円超10億円以下' },
    { overYen: 1_000_000_000, upToYen: null, taxYen: 200_000, label: '10億円超' },
  ],
};

/** 17号の2（売上代金以外の受取書）：5万円未満は非課税、5万円以上は200円（No.7141）。 */
export const STAMP_DUTY_NON_SALES = { nonTaxableBelowYen: 50_000, taxYen: 200 } as const;

/** 税額表から金額（円の整数、1以上）に該当する税額を引く。該当がなければ null。 */
export function lookupStampDuty(
  amountYen: number,
  brackets: StampDutyBracket[] = STAMP_DUTY_TABLE_SALES.brackets,
): number | null {
  for (const b of brackets) {
    if (amountYen > b.overYen && (b.upToYen === null || amountYen <= b.upToYen)) return b.taxYen;
  }
  return null;
}
