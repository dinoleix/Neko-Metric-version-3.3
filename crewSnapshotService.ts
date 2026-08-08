
import { collection, query, where, getDocs, getDoc, setDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { DailyCounterEntry, MONTH_NAMES } from './types';

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
}

const emptyBuckets = (): Record<string, number> =>
  ({ FOOD: 0, DRINKS: 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, UNCATEGORIZED: 0 });

export const emptyCrewAggregate = (): CrewAggregate => ({
  crewTotalPurchase: 0,
  crewTotalExpense: 0,
  crewPurchaseByCategory: {},
  crewExpenseByCategory: {},
  crewCogsBucketAgg: emptyBuckets(),
});

/** Only 'paid' entries feed reporting — 'pending' and 'cancelled' are excluded. */
export const isReportable = (e: Pick<DailyCounterEntry, 'status'>) => e.status === 'paid';

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
    if (!isReportable(e)) continue;
    const amt = Number(e.amount || 0);
    const cat = (e.category || 'UNCATEGORIZED').trim().toUpperCase();

    if (e.type === 'purchase') {
      agg.crewTotalPurchase += amt;
      agg.crewPurchaseByCategory[cat] = (agg.crewPurchaseByCategory[cat] || 0) + amt;
    } else {
      agg.crewTotalExpense += amt;
      agg.crewExpenseByCategory[cat] = (agg.crewExpenseByCategory[cat] || 0) + amt;
    }

    const bucket = keywords.includes(cat) ? (cogsBucketMapping[cat] || 'FOOD') : 'UNCATEGORIZED';
    agg.crewCogsBucketAgg[bucket] = (agg.crewCogsBucketAgg[bucket] || 0) + amt;
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
