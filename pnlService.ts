
import { CogsAdjustment, CogsBucket, ExpenseMonthlySnapshot } from './types';

/**
 * Single source of truth for turning stock records into consumption.
 *
 *     Consumption = Opening + Purchases − Closing
 *
 * Five modules previously reimplemented this and drifted: only PnLHub added
 * opening stock, so every other screen understated COGS by the whole opening
 * balance for the same month. Route all COGS arithmetic through here.
 *
 * Naming note: in `cogs_adjustments` the CLOSING stock is stored in fields named
 * `*Adjustment` (and the legacy total `adjustmentAmount`). They are month-end
 * stock on hand, not a correction — the UI's "Unused Stock Adjustment" label
 * refers to the same thing.
 */

const BUCKETS: CogsBucket[] = ['FOOD', 'DRINKS', 'FOOD SERVINGS', 'DRINKS SERVINGS', 'UNCATEGORIZED'];

/**
 * Closing stock for one record. Falls back to summing the four sub-buckets when
 * `adjustmentAmount` is absent — legacy records predate that field, and reading
 * it unguarded yields NaN, which then silently poisons every downstream margin.
 */
export const closingOf = (a: CogsAdjustment): number =>
  a?.adjustmentAmount != null
    ? Number(a.adjustmentAmount) || 0
    : (a?.foodIngredientsAdjustment || 0) + (a?.drinkIngredientsAdjustment || 0)
      + (a?.foodServingsAdjustment || 0) + (a?.drinkServingsAdjustment || 0);

/** Opening stock for one record. Absent on months never carried forward — treated as 0. */
export const openingOf = (a: CogsAdjustment): number =>
  (a?.foodIngredientsOpening || 0) + (a?.drinkIngredientsOpening || 0)
  + (a?.foodServingsOpening || 0) + (a?.drinkServingsOpening || 0);

export const closingStockTotal = (adjustments: CogsAdjustment[] = []): number =>
  adjustments.reduce((s, a) => s + closingOf(a), 0);

export const openingStockTotal = (adjustments: CogsAdjustment[] = []): number =>
  adjustments.reduce((s, a) => s + openingOf(a), 0);

/**
 * Consumption from purchases and the period's stock records.
 *
 * Clamped at 0: a negative result means closing exceeds opening + purchases,
 * which is a data-entry error rather than a real figure. Callers that want to
 * surface that error should compare against `rawConsumption`.
 */
export const computeConsumption = (purchases: number, adjustments: CogsAdjustment[] = []): number =>
  Math.max(0, rawConsumption(purchases, adjustments));

/** Unclamped, so callers can detect the impossible-stock case. */
export const rawConsumption = (purchases: number, adjustments: CogsAdjustment[] = []): number =>
  purchases + openingStockTotal(adjustments) - closingStockTotal(adjustments);

/** True when closing exceeds opening + purchases — always a data problem. */
export const hasImpossibleStock = (purchases: number, adjustments: CogsAdjustment[] = []): boolean =>
  rawConsumption(purchases, adjustments) < 0;

const emptyBuckets = (): Record<CogsBucket, number> =>
  ({ 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 });

/** Per-bucket opening stock, for modules that track FOOD/DRINKS separately. */
export const openingByBucket = (adjustments: CogsAdjustment[] = []): Record<CogsBucket, number> => {
  const out = emptyBuckets();
  adjustments.forEach(a => {
    out['FOOD'] += a?.foodIngredientsOpening || 0;
    out['DRINKS'] += a?.drinkIngredientsOpening || 0;
    out['FOOD SERVINGS'] += a?.foodServingsOpening || 0;
    out['DRINKS SERVINGS'] += a?.drinkServingsOpening || 0;
  });
  return out;
};

/** Per-bucket closing stock, mirroring openingByBucket. */
export const closingByBucket = (adjustments: CogsAdjustment[] = []): Record<CogsBucket, number> => {
  const out = emptyBuckets();
  adjustments.forEach(a => {
    out['FOOD'] += a?.foodIngredientsAdjustment || 0;
    out['DRINKS'] += a?.drinkIngredientsAdjustment || 0;
    out['FOOD SERVINGS'] += a?.foodServingsAdjustment || 0;
    out['DRINKS SERVINGS'] += a?.drinkServingsAdjustment || 0;
  });
  return out;
};

export { BUCKETS };

/* ────────────────────────────────────────────────────────────────────────────
 * Cost rows
 *
 * expense_snapshots keeps CSV-uploaded spend and Crew Terminal spend in two
 * separate namespaces so the sources can never double-count:
 *
 *   CSV   → expenseByCategory / purchaseByCategory / totalExpense / totalPurchase
 *   Crew  → crewExpenseByCategory / crewPurchaseByCategory / crewTotal*
 *
 * A module that reads only the CSV half sees a business with no Crew Terminal.
 * That is not hypothetical: five modules did exactly that, hiding six-figure
 * monthly spend from Margin Intelligence, Partnership Forge and Reports.
 *
 * Always reach a snapshot's costs through these helpers so a new module cannot
 * be written blind to half the data.
 * ──────────────────────────────────────────────────────────────────────────── */

type CostMap = Record<string, number> | undefined;

/** Every category→amount map on a snapshot: CSV and crew, expense and purchase. */
export const costMapsOf = (snap: ExpenseMonthlySnapshot): CostMap[] => [
  snap?.expenseByCategory,
  snap?.purchaseByCategory,
  snap?.crewExpenseByCategory,
  snap?.crewPurchaseByCategory,
];

/** Only the expense-side maps (CSV + crew). */
export const expenseMapsOf = (snap: ExpenseMonthlySnapshot): CostMap[] =>
  [snap?.expenseByCategory, snap?.crewExpenseByCategory];

/** Only the purchase-side maps (CSV + crew). */
export const purchaseMapsOf = (snap: ExpenseMonthlySnapshot): CostMap[] =>
  [snap?.purchaseByCategory, snap?.crewPurchaseByCategory];

/**
 * Visits every (category, amount) pair across the given maps.
 * Categories are trimmed and upper-cased, matching how keyword lists are held.
 */
export const forEachCostRow = (
  maps: CostMap[],
  cb: (category: string, amount: number) => void
): void => {
  maps.forEach(map => {
    Object.entries(map || {}).forEach(([cat, amt]) => {
      const value = Number(amt) || 0;
      if (value === 0) return;
      cb(cat.trim().toUpperCase(), value);
    });
  });
};

/** Total expense for a snapshot, both sources. */
export const totalExpenseOf = (snap: ExpenseMonthlySnapshot): number =>
  (snap?.totalExpense || 0) + (snap?.crewTotalExpense || 0);

/** Total purchases for a snapshot, both sources. */
export const totalPurchaseOf = (snap: ExpenseMonthlySnapshot): number =>
  (snap?.totalPurchase || 0) + (snap?.crewTotalPurchase || 0);

/**
 * COGS buckets for a snapshot, merging the CSV and crew aggregates.
 * Unknown bucket names fold into UNCATEGORIZED rather than being dropped.
 */
export const cogsBucketsOf = (snap: ExpenseMonthlySnapshot): Record<CogsBucket, number> => {
  const out = emptyBuckets();
  [snap?.cogsBucketAgg, snap?.crewCogsBucketAgg].forEach(map => {
    Object.entries(map || {}).forEach(([bucket, amt]) => {
      const value = Number(amt) || 0;
      if (BUCKETS.includes(bucket as CogsBucket)) out[bucket as CogsBucket] += value;
      else out['UNCATEGORIZED'] += value;
    });
  });
  return out;
};

/* ------------------------------------------------------------------ */
/* Break-even                                                          */
/* ------------------------------------------------------------------ */

/**
 * The same costs the P&L already totals, re-split by BEHAVIOUR instead of by
 * category. Callers pass the locals they have computed for the bottom line, so
 * break-even can never disagree with the Net Profit shown beside it.
 */
export interface BreakEvenInput {
  /** POS + online + events, before tax and commission. The answer is in these units. */
  grossGoodRevenue: number;
  /** What actually lands: posGoodNet + onlineGoodNet + eventRevenue. */
  netCashInflow: number;
  adjustedCOGS: number;
  /** Daily wages & incentives — scales with volume, so treated as variable. */
  csvVariableLabour: number;
  fixedPayroll: number;
  totalRent: number;
  mappedOps: number;
  unmappedExp: number;
  /** Calendar days in the period, for the daily target. */
  daysInPeriod: number;
}

export interface BreakEvenResult {
  fixedCosts: number;
  variableCosts: number;
  /** Revenue less variable costs — the pool that has to cover fixed costs. */
  beContribution: number;
  /** beContribution as a fraction (0..1) of GROSS revenue. */
  contributionRatio: number;
  /** Gross revenue at which net profit would be exactly zero. */
  breakEvenRevenue: number;
  /** Actual gross revenue less break-even. Negative means a loss-making month. */
  marginOfSafety: number;
  marginOfSafetyPercent: number;
  dailyTarget: number;
  daysInPeriod: number;
  /** false when no volume breaks even — read `reason` before showing a figure. */
  reachable: boolean;
  reason: 'ok' | 'no_revenue' | 'negative_contribution';
}

const UNREACHABLE = (
  reason: BreakEvenResult['reason'],
  fixedCosts: number,
  variableCosts: number,
  beContribution: number,
  daysInPeriod: number,
): BreakEvenResult => ({
  fixedCosts,
  variableCosts,
  beContribution,
  contributionRatio: 0,
  breakEvenRevenue: 0,
  marginOfSafety: 0,
  marginOfSafetyPercent: 0,
  dailyTarget: 0,
  daysInPeriod,
  reachable: false,
  reason,
});

/**
 * Gross revenue needed to reach zero net profit.
 *
 *     variable  = COGS + daily wages
 *     fixed     = base payroll + rent + mapped ops + unmapped
 *     BE gross  = fixed / ((netCashInflow - variable) / grossGoodRevenue)
 *
 * Expressed in GROSS revenue to match the denominator the existing margins use.
 * That is consistent because tax and commission are percentage-based, so
 * netCashInflow scales linearly with gross: multiplying gross revenue by
 * `fixed / beContribution` drives net profit to exactly zero.
 *
 * Note `mappedOps` is held entirely fixed even though it mixes genuinely fixed
 * items (internet, software) with variable ones (marketing, utilities). That is
 * the conservative direction — it raises the target rather than lowering it.
 */
export const computeBreakEven = (i: BreakEvenInput): BreakEvenResult => {
  const grossRevenue = Number(i.grossGoodRevenue) || 0;
  const variableCosts = (Number(i.adjustedCOGS) || 0) + (Number(i.csvVariableLabour) || 0);
  const fixedCosts = (Number(i.fixedPayroll) || 0) + (Number(i.totalRent) || 0)
    + (Number(i.mappedOps) || 0) + (Number(i.unmappedExp) || 0);
  const beContribution = (Number(i.netCashInflow) || 0) - variableCosts;
  const days = Math.max(0, Number(i.daysInPeriod) || 0);

  // No sales loaded for the period: there is no ratio to project from.
  if (grossRevenue <= 0) return UNREACHABLE('no_revenue', fixedCosts, variableCosts, beContribution, days);

  // Variable costs meet or exceed revenue, so every extra rupee of sales loses
  // money and no volume breaks even. A real signal, not an error.
  if (beContribution <= 0) {
    return UNREACHABLE('negative_contribution', fixedCosts, variableCosts, beContribution, days);
  }

  const contributionRatio = beContribution / grossRevenue;
  const breakEvenRevenue = fixedCosts / contributionRatio;
  const marginOfSafety = grossRevenue - breakEvenRevenue;

  return {
    fixedCosts,
    variableCosts,
    beContribution,
    contributionRatio,
    breakEvenRevenue,
    marginOfSafety,
    marginOfSafetyPercent: (marginOfSafety / grossRevenue) * 100,
    dailyTarget: days > 0 ? breakEvenRevenue / days : 0,
    daysInPeriod: days,
    reachable: true,
    reason: 'ok',
  };
};
