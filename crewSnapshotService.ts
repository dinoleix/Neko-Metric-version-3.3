
import { collection, query, where, getDocs, getDoc, setDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { CrewQtyMeta, DailyCounterEntry, MONTH_NAMES } from './types';

/**
 * Single source of truth for turning crew_entries into the crew_* half of an
 * expense_snapshots document.
 *
 * This logic used to be duplicated in CrewTerminal (rebuildExpenseSnapshot) and
 * DataCatalog (syncSlice). The copies drifted, which is how a Data Catalog sync
 * came to silently wipe Crew Terminal data. Both callers now share this module —
 * add new aggregation rules here and every writer picks them up.
 */

export interface CrewAggregate {
  crewTotalPurchase: number;
  crewTotalExpense: number;
  crewPurchaseByCategory: Record<string, number>;
  crewExpenseByCategory: Record<string, number>;
  crewCogsBucketAgg: Record<string, number>;
  crewQtyByCategory: Record<string, number>;
  crewQtyMetaByCategory: Record<string, CrewQtyMeta>;
  // Unpaid-but-committed spend, tallied separately so the paid figures above
  // keep their exact meaning. Nothing reads these unless a screen opts in —
  // see the accrual toggle in P&L Command (Crew).
  crewPendingTotalPurchase: number;
  crewPendingTotalExpense: number;
  crewPendingPurchaseByCategory: Record<string, number>;
  crewPendingExpenseByCategory: Record<string, number>;
  crewPendingCogsBucketAgg: Record<string, number>;
}

const emptyBuckets = (): Record<string, number> =>
  ({ FOOD: 0, DRINKS: 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, UNCATEGORIZED: 0 });

// Every key must be present here: DataCatalog's syncSlice spreads this into an
// agg it writes with a non-merge batch.set, so a key missing from this shape
// leaves stale data behind on a full sync rather than being reset.
export const emptyCrewAggregate = (): CrewAggregate => ({
  crewTotalPurchase: 0,
  crewTotalExpense: 0,
  crewPurchaseByCategory: {},
  crewExpenseByCategory: {},
  crewCogsBucketAgg: emptyBuckets(),
  crewQtyByCategory: {},
  crewQtyMetaByCategory: {},
  crewPendingTotalPurchase: 0,
  crewPendingTotalExpense: 0,
  crewPendingPurchaseByCategory: {},
  crewPendingExpenseByCategory: {},
  crewPendingCogsBucketAgg: emptyBuckets(),
});

/**
 * Physical units an entry represents.
 *
 * The top-level `quantity` wins over the bill-builder's line items and is never
 * added to them: an edited bill-built purchase can carry both, and preferring
 * one keeps the result idempotent. Summing `items[].quantity` mixes units of
 * measure (kg with pieces) and is only meaningful for single-unit consumables —
 * it is never read for anything else.
 */
const unitsForEntry = (e: DailyCounterEntry): { units: number; fromItems: boolean } => {
  const top = Number(e.quantity);
  if (top > 0) return { units: top, fromItems: false };
  const lines = Array.isArray(e.items)
    ? e.items.reduce((s, it) => s + (Number(it?.quantity) || 0), 0)
    : 0;
  return lines > 0 ? { units: lines, fromItems: true } : { units: 0, fromItems: false };
};

/** Only 'paid' entries feed the headline figures. */
export const isReportable = (e: Pick<DailyCounterEntry, 'status'>) => e.status === 'paid';

/**
 * Committed but not yet settled. Tallied into the crewPending* fields so a
 * screen can present an accrual view on request.
 *
 * 'cancelled' is never counted by either helper — a cancelled bill is not a
 * liability, and including it would overstate spend in every view.
 */
export const isPending = (e: Pick<DailyCounterEntry, 'status'>) => e.status === 'pending';

/**
 * Aggregates entries into the crew_* fields. Pure — no reads, no writes — so
 * callers that already hold the entries (e.g. DataCatalog's sync) can reuse it.
 * Callers are responsible for scoping `entries` to one outlet + period.
 */
export const aggregateCrewEntries = (
  entries: DailyCounterEntry[],
  cogsKeywords: string[] = [],
  cogsBucketMapping: Record<string, string> = {}
): CrewAggregate => {
  // Normalize here so callers can pass raw settings without each remembering to
  // uppercase — the two old copies disagreed on exactly this.
  const keywords = cogsKeywords.map(k => (k || '').trim().toUpperCase());
  const agg = emptyCrewAggregate();

  for (const e of entries) {
    const reportable = isReportable(e);
    const pending = isPending(e);
    if (!reportable && !pending) continue; // cancelled

    const amt = Number(e.amount || 0);
    const cat = (e.category || 'UNCATEGORIZED').trim().toUpperCase();
    const bucketKey = keywords.includes(cat) ? (cogsBucketMapping[cat] || 'FOOD') : 'UNCATEGORIZED';

    if (pending) {
      if (e.type === 'purchase') {
        agg.crewPendingTotalPurchase += amt;
        agg.crewPendingPurchaseByCategory[cat] = (agg.crewPendingPurchaseByCategory[cat] || 0) + amt;
      } else {
        agg.crewPendingTotalExpense += amt;
        agg.crewPendingExpenseByCategory[cat] = (agg.crewPendingExpenseByCategory[cat] || 0) + amt;
      }
      agg.crewPendingCogsBucketAgg[bucketKey] = (agg.crewPendingCogsBucketAgg[bucketKey] || 0) + amt;
      // Physical units stay paid-only on purpose: Consumables Efficiency reads
      // crewQtyByCategory, and folding unsettled bills into it would move that
      // screen's numbers without anyone asking for it.
      continue;
    }

    if (e.type === 'purchase') {
      agg.crewTotalPurchase += amt;
      agg.crewPurchaseByCategory[cat] = (agg.crewPurchaseByCategory[cat] || 0) + amt;
    } else {
      agg.crewTotalExpense += amt;
      agg.crewExpenseByCategory[cat] = (agg.crewExpenseByCategory[cat] || 0) + amt;
    }

    agg.crewCogsBucketAgg[bucketKey] = (agg.crewCogsBucketAgg[bucketKey] || 0) + amt;

    // Units are tallied for EVERY category, not just configured consumables, so
    // adding a new tracked consumable later needs no backfill. Runs across both
    // entry types — gas cylinders are an expense, not a purchase.
    const { units, fromItems } = unitsForEntry(e);
    if (units > 0) agg.crewQtyByCategory[cat] = (agg.crewQtyByCategory[cat] || 0) + units;

    const meta = agg.crewQtyMetaByCategory[cat] || (agg.crewQtyMetaByCategory[cat] = { entries: 0, withQty: 0, fromItems: 0 });
    meta.entries += 1;
    if (units > 0) meta.withQty += 1;
    if (fromItems) meta.fromItems += 1;
  }

  return agg;
};

/** Reads the owner's COGS keyword list and bucket mapping. Never throws. */
export const loadCogsSettings = async (
  ownerId: string
): Promise<{ cogsKeywords: string[]; cogsBucketMapping: Record<string, string> }> => {
  try {
    const snap = await getDoc(doc(db, 'category_settings', ownerId));
    if (snap.exists()) {
      const d = snap.data();
      return {
        cogsKeywords: d.cogsKeywords || [],
        cogsBucketMapping: d.cogsBucketMapping || {},
      };
    }
  } catch { /* settings are optional — fall through to empty */ }
  return { cogsKeywords: [], cogsBucketMapping: {} };
};

/** `${ownerId}_${outletId}_${year}_${MonthName}` — must match every other writer. */
export const crewSnapshotId = (ownerId: string, outletId: string, date: string): string => {
  const [year, month] = date.split('-');
  return `${ownerId}_${outletId}_${year}_${MONTH_NAMES[parseInt(month) - 1]}`;
};

/**
 * Fetches one outlet + month of crew_entries. Scoped server-side so a rebuild
 * costs a handful of reads rather than the full history.
 *
 * `legacyUserId` adds a second query for entries written before the ownerId
 * field existed; results are de-duplicated by document id. Each leg is isolated
 * so one failing (e.g. a missing index) still lets the other return.
 */
export const fetchCrewEntries = async (
  ownerId: string,
  outletId: string,
  date: string,
  legacyUserId?: string
): Promise<DailyCounterEntry[]> => {
  const [year, month] = date.split('-');
  const monthStart = `${year}-${month}-01`;
  const monthEnd = `${year}-${month}-31`;

  const run = async (field: 'ownerId' | 'userId', value: string) => {
    try {
      const snap = await getDocs(query(
        collection(db, 'crew_entries'),
        where(field, '==', value),
        where('outletId', '==', outletId),
        where('date', '>=', monthStart),
        where('date', '<=', monthEnd)
      ));
      return snap.docs;
    } catch (e) {
      console.warn(`[CrewSnapshot] ${field} query failed:`, e);
      return [];
    }
  };

  const byOwner = await run('ownerId', ownerId);
  const byUser = legacyUserId ? await run('userId', legacyUserId) : [];

  const seen = new Set<string>();
  return [...byOwner, ...byUser]
    .filter(d => (seen.has(d.id) ? false : (seen.add(d.id), true)))
    .map(d => ({ id: d.id, ...d.data() } as DailyCounterEntry))
    // Belt-and-braces: the query is already scoped, but a stray outlet/month
    // must never leak into another period's totals.
    .filter(e => e.outletId === outletId && (e.date || '').slice(0, 7) === `${year}-${month}`);
};

/**
 * Recounts one outlet + month from crew_entries and writes the crew_* fields.
 *
 * Always a clean recount from zero, never an increment, so it is idempotent and
 * safe to re-run. Writes with { merge: true } and touches only crew_* keys, so
 * CSV-uploaded fields in the same document are left intact.
 */
export const rebuildCrewSnapshot = async (opts: {
  ownerId: string;
  outletId: string;
  date: string;
  legacyUserId?: string;
  cogsKeywords?: string[];
  cogsBucketMapping?: Record<string, string>;
}): Promise<{ snapId: string; aggregate: CrewAggregate; entryCount: number }> => {
  const { ownerId, outletId, date, legacyUserId } = opts;

  const settings = opts.cogsKeywords !== undefined
    ? { cogsKeywords: opts.cogsKeywords, cogsBucketMapping: opts.cogsBucketMapping || {} }
    : await loadCogsSettings(ownerId);

  const entries = await fetchCrewEntries(ownerId, outletId, date, legacyUserId);
  const aggregate = aggregateCrewEntries(entries, settings.cogsKeywords, settings.cogsBucketMapping);

  const [year, month] = date.split('-');
  const snapId = crewSnapshotId(ownerId, outletId, date);

  await setDoc(doc(db, 'expense_snapshots', snapId), {
    userId: ownerId,
    outletId,
    month: MONTH_NAMES[parseInt(month) - 1],
    year,
    ...aggregate,
    crewLastUpdated: Date.now(),
  }, { merge: true });

  return { snapId, aggregate, entryCount: entries.filter(isReportable).length };
};
