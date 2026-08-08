
import { CogsAdjustment, CogsBucket } from './types';

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
