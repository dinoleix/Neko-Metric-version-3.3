
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, getDoc, where, doc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  ExpenseMonthlySnapshot,
  SalesMonthlySnapshot,
  ItemMonthlySnapshot,
  TrackedConsumable,
  CategorySettings as CategorySettingsType,
  MONTH_NAMES,
  YEAR_OPTIONS,
  getOutletName,
} from '../types';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip as ChartTooltip, Legend, ReferenceLine,
} from 'recharts';
import {
  Flame, Loader2, AlertTriangle, CheckCircle2, Info, Settings2,
} from 'lucide-react';
import { num, inrCompact, Tile, DeltaChip } from '../reportKit';

/**
 * Tracks consumption of a physical consumable (gas cylinders, oil, packaging)
 * against business activity, to surface months where usage is out of line.
 *
 * Consumption is approximated by units PURCHASED — there is no stock count — so
 * the raw monthly figure is lumpy by construction (cylinders bought on the 30th
 * serve the following month). Two deliberate choices absorb that:
 *   1. the headline series is a 4-month rolling ratio, where numerator and
 *      denominator span the same window so boundary effects largely cancel;
 *   2. the baseline is a trailing MEDIAN, which a single stockpile month barely
 *      moves, unlike a mean.
 * `consumedUnits` is named for what it approximates, not how it is sourced: if
 * opening/closing counts are added later, only that one assignment changes.
 */

// 4, not 3. Restaurants commonly buy on a 2-month cycle, and a 3-month window
// cannot contain that evenly — simulated against a flat-consumption alternating
// 6/2 pattern it reported a spurious -16.7% deviation, past the default alert
// threshold. A 4-month window reports 0.0% on the same input while still showing
// 56% for genuine overuse. 6 months over-smooths (real signal falls to 25%).
const ROLLING_WINDOW = 4;
const BASELINE_MONTHS = 6;
const MIN_BASELINE_MONTHS = 3;

// Diverging pair for over/under baseline. Emerald<->rose is NOT used: it fails
// deutan separation. Indigo<->rose is CVD-safe on white.
const C_UNDER = '#4f46e5';
const C_OVER = '#e11d48';
const C_NEUTRAL = '#94a3b8';
const C_GRID = '#f1f5f9';

type DataState = 'ok' | 'not-recorded' | 'not-measured' | 'estimated';

interface MonthRow {
  key: string;
  label: string;
  month: string;
  year: string;
  isCurrent: boolean;
  state: DataState;
  units: number | null;
  dishes: number;
  sales: number;
  spend: number;
  entries: number;
  withQty: number;
  ratioDish: number | null;
  ratioSales: number | null;
  rollDish: number | null;
  rollSales: number | null;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const ConsumablesEfficiency: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const now = new Date();
  const [anchorYear, setAnchorYear] = useState(now.getFullYear().toString());
  const [anchorMonth, setAnchorMonth] = useState(MONTH_NAMES[now.getMonth()]);
  const [windowMonths, setWindowMonths] = useState(12);
  const [outlet, setOutlet] = useState('all');
  const [consumableId, setConsumableId] = useState('');
  const [useEstimates, setUseEstimates] = useState(true);

  const [consumables, setConsumables] = useState<TrackedConsumable[]>([]);
  const [expenseSnaps, setExpenseSnaps] = useState<ExpenseMonthlySnapshot[]>([]);
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [itemSnaps, setItemSnaps] = useState<ItemMonthlySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const currentKey = `${MONTH_NAMES[now.getMonth()]}_${now.getFullYear()}`;

  // The window of months to report on, walking backwards from the anchor with
  // year wrap — same approach as ExpenseHub's trajectory.
  const window = useMemo(() => {
    const endM = MONTH_NAMES.indexOf(anchorMonth);
    const endY = parseInt(anchorYear);
    const out: { month: string; year: string; key: string; label: string }[] = [];
    for (let i = windowMonths - 1; i >= 0; i--) {
      let m = endM - i, y = endY;
      while (m < 0) { m += 12; y -= 1; }
      out.push({ month: MONTH_NAMES[m], year: y.toString(), key: `${MONTH_NAMES[m]}_${y}`, label: `${MONTH_NAMES[m].slice(0, 3)} ${String(y).slice(2)}` });
    }
    return out;
  }, [anchorMonth, anchorYear, windowMonths]);

  // Snapshots: equality + `in` on year only, so no composite index is required.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const years = Array.from(new Set(window.map(w => w.year)));
        const [setSnap, eSnap, sSnap] = await Promise.all([
          getDoc(doc(db, 'category_settings', dataOwnerId)),
          getDocs(query(collection(db, 'expense_snapshots'), where('userId', '==', dataOwnerId), where('year', 'in', years))),
          getDocs(query(collection(db, 'sales_snapshots'), where('userId', '==', dataOwnerId), where('year', 'in', years))),
        ]);
        if (cancelled) return;
        const cfg = (setSnap.exists() ? (setSnap.data() as CategorySettingsType).trackedConsumables : []) || [];
        setConsumables(cfg.filter(c => c.active !== false && c.category));
        setExpenseSnaps(eSnap.docs.map(d => d.data() as ExpenseMonthlySnapshot));
        setSalesSnaps(sSnap.docs.map(d => d.data() as SalesMonthlySnapshot));
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dataOwnerId, window]);

  const consumable = useMemo(
    () => consumables.find(c => c.id === consumableId) || consumables[0] || null,
    [consumables, consumableId]);

  const catKey = (consumable?.category || '').trim().toUpperCase();

  // Outlets that actually carry data. GLOBAL is excluded: CSV sales can land
  // there while crew entries never do, which would deflate an 'all' ratio.
  const outletIds = useMemo(() => Array.from(new Set(
    [...expenseSnaps, ...salesSnaps].map(s => s.outletId).filter(o => o && o !== 'GLOBAL' && o !== 'Unassigned')
  )).sort(), [expenseSnaps, salesSnaps]);

  const activeOutlets = outlet === 'all' ? outletIds : [outlet];

  // item_snapshots carry every dish with a 31-slot dailyTrend, so a year-range
  // query would pull hundreds of KB. Ids are deterministic — fetch only what the
  // window needs, and only when the per-dishes denominator is in play.
  useEffect(() => {
    let cancelled = false;
    if (outletIds.length === 0) { setItemSnaps([]); return; }
    (async () => {
      try {
        const docs = await Promise.all(window.flatMap(w => activeOutlets.map(oId =>
          getDoc(doc(db, 'item_snapshots', `${dataOwnerId}_${oId}_${w.year}_${w.month}`))
        )));
        if (cancelled) return;
        setItemSnaps(docs.filter(d => d.exists()).map(d => d.data() as ItemMonthlySnapshot));
      } catch { if (!cancelled) setItemSnaps([]); }
    })();
    return () => { cancelled = true; };
  }, [dataOwnerId, window, outlet, outletIds.length]);

  const rows: MonthRow[] = useMemo(() => {
    if (!consumable) return [];
    const perUnit = consumable.unitsPerPurchase ?? 1;
    const inScope = (oId: string) => outlet === 'all' ? (oId !== 'GLOBAL' && oId !== 'Unassigned') : oId === outlet;

    const base = window.map(w => {
      const exp = expenseSnaps.filter(s => s.month === w.month && s.year === w.year && inScope(s.outletId));
      const sal = salesSnaps.filter(s => s.month === w.month && s.year === w.year && inScope(s.outletId));
      const itm = itemSnaps.filter(s => s.month === w.month && s.year === w.year && inScope(s.outletId));

      let rawUnits = 0, entries = 0, withQty = 0, spend = 0, anyCrewActivity = false, anySnapshot = exp.length > 0;
      exp.forEach(s => {
        rawUnits += (s.crewQtyByCategory?.[catKey] || 0);
        const meta = s.crewQtyMetaByCategory?.[catKey];
        if (meta) { entries += meta.entries; withQty += meta.withQty; }
        spend += (s.crewExpenseByCategory?.[catKey] || 0) + (s.crewPurchaseByCategory?.[catKey] || 0)
               + (s.expenseByCategory?.[catKey] || 0) + (s.purchaseByCategory?.[catKey] || 0);
        if ((s.crewTotalExpense || 0) > 0 || (s.crewTotalPurchase || 0) > 0) anyCrewActivity = true;
      });

      const dishes = itm.reduce((acc, s) =>
        acc + Object.values(s.items || {}).reduce((a: number, it: any) => a + (Number(it?.quantity) || 0), 0), 0);
      const sales = sal.reduce((acc, s) =>
        acc + (s.posGoodGross || 0) + (s.onlineGoodGross || 0) + (s.eventRevenue || 0), 0);

      // Three states, not two: a chart must not plot "nobody typed a number" as zero.
      let state: DataState;
      let units: number | null;
      if (withQty > 0) { state = 'ok'; units = rawUnits * perUnit; }
      else if (entries > 0) {
        // Entries exist but carry no quantity. Reconstruct from spend if the
        // owner configured a unit cost — derived at read time, no backfill.
        if (useEstimates && (consumable.estimatedUnitCost || 0) > 0 && spend > 0) {
          state = 'estimated'; units = spend / (consumable.estimatedUnitCost as number);
        } else { state = 'not-recorded'; units = null; }
      } else if (anySnapshot && anyCrewActivity) { state = 'ok'; units = 0; }
      else { state = 'not-measured'; units = null; }

      return {
        key: w.key, label: w.label, month: w.month, year: w.year,
        isCurrent: w.key === currentKey,
        state, units, dishes, sales, spend, entries, withQty,
        ratioDish: units !== null && dishes > 0 ? (units / dishes) * 1000 : null,
        ratioSales: units !== null && sales > 0 ? (units / sales) * 100000 : null,
        rollDish: null as number | null, rollSales: null as number | null,
      };
    });

    // Rolling ratio: sum numerator and denominator over the same window, then
    // divide. Ratio of sums, never mean of ratios.
    return base.map((r, i) => {
      const slice = base.slice(Math.max(0, i - ROLLING_WINDOW + 1), i + 1)
        .filter(x => x.units !== null);
      if (slice.length === 0) return r;
      const u = slice.reduce((s, x) => s + (x.units as number), 0);
      const d = slice.reduce((s, x) => s + x.dishes, 0);
      const v = slice.reduce((s, x) => s + x.sales, 0);
      return { ...r, rollDish: d > 0 ? (u / d) * 1000 : null, rollSales: v > 0 ? (u / v) * 100000 : null };
    });
  }, [window, expenseSnaps, salesSnaps, itemSnaps, consumable, catKey, outlet, useEstimates, currentKey]);

  const anchor = rows[rows.length - 1];

  // Baseline excludes the anchor and the in-progress current month — a
  // half-finished month otherwise drags the median and fakes an overuse signal.
  const baseline = useMemo(() => {
    if (rows.length < 2) return { dish: null as number | null, sales: null as number | null, n: 0 };
    const prior = rows.slice(Math.max(0, rows.length - 1 - BASELINE_MONTHS), rows.length - 1)
      .filter(r => !r.isCurrent);
    const dishVals = prior.map(r => r.rollDish).filter((v): v is number => v !== null && v > 0);
    const salesVals = prior.map(r => r.rollSales).filter((v): v is number => v !== null && v > 0);
    return {
      dish: dishVals.length >= MIN_BASELINE_MONTHS ? median(dishVals) : null,
      sales: salesVals.length >= MIN_BASELINE_MONTHS ? median(salesVals) : null,
      n: Math.max(dishVals.length, salesVals.length),
    };
  }, [rows]);

  const deviationPct = baseline.dish && anchor?.rollDish
    ? ((anchor.rollDish - baseline.dish) / baseline.dish) * 100
    : (baseline.sales && anchor?.rollSales ? ((anchor.rollSales - baseline.sales) / baseline.sales) * 100 : null);

  const expectedUnits = baseline.dish && anchor && anchor.dishes > 0
    ? (baseline.dish * anchor.dishes) / 1000
    : (baseline.sales && anchor && anchor.sales > 0 ? (baseline.sales * anchor.sales) / 100000 : null);

  const threshold = consumable?.alertThresholdPct ?? 15;
  const isAlert = deviationPct !== null && Math.abs(deviationPct) >= threshold;
  const unitLabel = consumable?.unitLabel || 'unit';

  const chartRows = rows.map(r => ({
    label: r.label,
    rollDish: r.rollDish, rollSales: r.rollSales,
    rawDish: r.ratioDish, rawSales: r.ratioSales,
    dev: baseline.dish && r.rollDish ? ((r.rollDish - baseline.dish) / baseline.dish) * 100 : null,
  }));

  const coverage = useMemo(() => {
    const entries = rows.reduce((s, r) => s + r.entries, 0);
    const withQty = rows.reduce((s, r) => s + r.withQty, 0);
    return {
      entries, withQty,
      notRecorded: rows.filter(r => r.state === 'not-recorded').length,
      notMeasured: rows.filter(r => r.state === 'not-measured').length,
      estimated: rows.filter(r => r.state === 'estimated').length,
    };
  }, [rows]);

  if (loading) {
    return <div className="py-32 text-center"><Loader2 className="mx-auto animate-spin text-indigo-600" size={28} /></div>;
  }

  if (consumables.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-24 text-center space-y-5">
        <div className="w-16 h-16 mx-auto bg-orange-50 text-orange-500 rounded-3xl flex items-center justify-center"><Flame size={28} /></div>
        <h3 className="text-2xl font-black text-slate-900 tracking-tight">No consumables tracked yet</h3>
        <p className="text-slate-500 font-medium leading-relaxed">
          Add one in <strong>Category Settings → Consumables</strong> — pick the category your crew logs it under
          (e.g. <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded">OPERATIONS - GAS CYLINDER</span>),
          give it a unit name, and quantity becomes mandatory on new entries.
        </p>
        <p className="text-xs text-slate-400 font-medium flex items-center justify-center gap-1.5"><Settings2 size={13} /> Setting an estimated ₹/unit reconstructs past months from spend.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-orange-500 rounded-2xl text-white shadow-lg shadow-orange-200"><Flame size={24} /></div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Consumables Efficiency</h2>
            <p className="text-slate-400 text-sm font-medium">Usage measured against how much you actually cooked and sold.</p>
          </div>
        </div>
      </header>

      {error && <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">{error}</p>}

      {/* Controls */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-4 flex flex-wrap gap-3">
        <select value={consumable?.id || ''} onChange={e => setConsumableId(e.target.value)}
          className="h-10 px-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-indigo-400">
          {consumables.map(c => <option key={c.id} value={c.id}>{c.label || c.category}</option>)}
        </select>
        <select value={anchorMonth} onChange={e => setAnchorMonth(e.target.value)}
          className="h-10 px-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-indigo-400">
          {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={anchorYear} onChange={e => setAnchorYear(e.target.value)}
          className="h-10 px-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-indigo-400">
          {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={windowMonths} onChange={e => setWindowMonths(parseInt(e.target.value))}
          className="h-10 px-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-indigo-400">
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
        </select>
        <select value={outlet} onChange={e => setOutlet(e.target.value)}
          className="h-10 px-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-indigo-400">
          <option value="all">All stores</option>
          {outletIds.map(o => <option key={o} value={o}>{getOutletName(o)}</option>)}
        </select>
        {(consumable?.estimatedUnitCost || 0) > 0 && (
          <button onClick={() => setUseEstimates(v => !v)}
            className={`h-10 px-4 rounded-xl text-xs font-bold transition-all ${useEstimates ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : 'bg-slate-100 text-slate-500'}`}>
            {useEstimates ? 'Estimates on' : 'Estimates off'}
          </button>
        )}
      </div>

      {/* Verdict */}
      {baseline.dish === null && baseline.sales === null ? (
        <div className="flex items-start gap-3 p-6 bg-amber-50 border border-amber-100 rounded-2xl">
          <Info size={18} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-black text-amber-900 uppercase tracking-tight">Building baseline — {baseline.n} of {MIN_BASELINE_MONTHS} months</p>
            <p className="text-xs font-medium text-amber-800 mt-1 leading-relaxed">
              A deviation figure needs at least {MIN_BASELINE_MONTHS} months of measured history, so none is shown yet.
              {(consumable?.estimatedUnitCost || 0) > 0
                ? ' Estimates are filling gaps where quantity was never recorded.'
                : ' Setting an estimated ₹/unit in Category Settings would reconstruct past months from spend.'}
            </p>
          </div>
        </div>
      ) : (
        <div className={`p-6 rounded-2xl border flex flex-wrap items-center gap-4 justify-between ${isAlert ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
          <div className="flex items-center gap-4">
            {isAlert ? <AlertTriangle size={22} className="text-rose-600" /> : <CheckCircle2 size={22} className="text-emerald-600" />}
            <div>
              <p className={`text-sm font-black uppercase tracking-tight ${isAlert ? 'text-rose-900' : 'text-emerald-900'}`}>
                {isAlert
                  ? (deviationPct as number) > 0
                    ? `Using more ${unitLabel}s than usual for this level of activity`
                    : `Using fewer ${unitLabel}s than usual`
                  : 'In line with the usual pattern'}
              </p>
              <p className="text-xs font-medium text-slate-600 mt-1">
                {anchor?.month} {anchor?.year}{anchor?.isCurrent ? ' (month to date)' : ''} · baseline is the median of the prior {baseline.n} months · alert at ±{threshold}%
              </p>
            </div>
          </div>
          {/* Consumption ratios invert: using MORE per dish is bad */}
          <DeltaChip pct={deviationPct} polarity="higher-is-bad" label="vs baseline" />
        </div>
      )}

      {/* Hero tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Tile label={`Used (${anchor?.month.slice(0, 3)})`}
          value={anchor?.units !== null && anchor?.units !== undefined ? `${num(anchor.units, 1)}` : '—'}
          sub={anchor?.state === 'estimated' ? 'estimated from spend' : `${unitLabel}s`} />
        <Tile label="Expected at this activity"
          value={expectedUnits !== null ? num(expectedUnits, 1) : '—'}
          sub={expectedUnits !== null ? `${unitLabel}s` : 'needs baseline'} />
        <Tile label="Difference"
          value={expectedUnits !== null && anchor?.units != null ? `${anchor.units - expectedUnits > 0 ? '+' : ''}${num(anchor.units - expectedUnits, 1)}` : '—'}
          tone={expectedUnits !== null && anchor?.units != null ? (anchor.units - expectedUnits > 0 ? 'text-rose-600' : 'text-emerald-600') : 'text-slate-900'}
          sub={expectedUnits !== null && anchor?.units != null && (consumable?.estimatedUnitCost || 0) > 0
            ? `≈ ${inrCompact(Math.abs(anchor.units - expectedUnits) * (consumable!.estimatedUnitCost as number))}` : undefined} />
        <Tile label="Per 1,000 dishes" value={anchor?.rollDish !== null && anchor?.rollDish !== undefined ? num(anchor.rollDish, 2) : '—'} sub="4-month rolling" />
        <Tile label="Per ₹100k sales" value={anchor?.rollSales !== null && anchor?.rollSales !== undefined ? num(anchor.rollSales, 2) : '—'} sub="4-month rolling" />
      </div>

      {/* Coverage warnings */}
      {(coverage.notRecorded > 0 || coverage.notMeasured > 0 || coverage.withQty < coverage.entries || coverage.estimated > 0) && (
        <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-5 space-y-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Data coverage</p>
          <div className="flex flex-wrap gap-2">
            {coverage.entries > 0 && (
              <span className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold ${coverage.withQty < coverage.entries ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                {coverage.withQty} of {coverage.entries} entries have a quantity
              </span>
            )}
            {coverage.estimated > 0 && <span className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-50 text-indigo-700">{coverage.estimated} month(s) estimated from spend</span>}
            {coverage.notRecorded > 0 && <span className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-700">{coverage.notRecorded} month(s) have entries but no counts</span>}
            {coverage.notMeasured > 0 && <span className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-500">{coverage.notMeasured} month(s) not measured — resync in Data Catalog</span>}
          </div>
        </div>
      )}

      {/* Two ratios, deliberately separate charts — the scales are unrelated,
          so a shared second y-axis would invent meaning at the crossing points. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {([
          { title: `${unitLabel}s per 1,000 dishes`, roll: 'rollDish', raw: 'rawDish', base: baseline.dish },
          { title: `${unitLabel}s per ₹100k sales`, roll: 'rollSales', raw: 'rawSales', base: baseline.sales },
        ] as const).map(cfg => (
          <div key={cfg.roll} className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-5">
            <p className="text-xs font-black text-slate-700 uppercase tracking-widest mb-4">{cfg.title}</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartRows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} minTickGap={12} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} />
                <ChartTooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(v: any) => v === null ? '—' : num(Number(v), 2)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {cfg.base !== null && <ReferenceLine y={cfg.base} stroke={C_NEUTRAL} strokeDasharray="4 4" />}
                <Line name="4-month rolling" type="monotone" dataKey={cfg.roll} stroke={C_UNDER} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls={false} />
                <Line name="Month" type="monotone" dataKey={cfg.raw} stroke="#cbd5e1" strokeWidth={0} dot={{ r: 3 }} legendType="circle" connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* Deviation */}
      {baseline.dish !== null && (
        <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-5">
          <p className="text-xs font-black text-slate-700 uppercase tracking-widest mb-4">Deviation from baseline (%)</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartRows} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} minTickGap={12} />
              <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} unit="%" />
              <ChartTooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                formatter={(v: any) => v === null ? '—' : `${Number(v).toFixed(1)}%`} />
              <ReferenceLine y={0} stroke="#cbd5e1" />
              <ReferenceLine y={threshold} stroke={C_OVER} strokeDasharray="3 3" />
              <ReferenceLine y={-threshold} stroke={C_UNDER} strokeDasharray="3 3" />
              <Bar dataKey="dev" radius={[4, 4, 0, 0]}>
                {chartRows.map((r, i) => (
                  <Cell key={i} fill={r.dev === null ? '#e2e8f0' : Math.abs(r.dev) < 3 ? '#e2e8f0' : r.dev > 0 ? C_OVER : C_UNDER} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                {['Month', `${unitLabel}s`, 'Dishes', 'Sales', 'Per 1k dishes', 'Per ₹100k', 'Status'].map((h, i) => (
                  <th key={h} className={`px-5 py-3 ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(r => (
                <tr key={r.key} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-bold text-slate-800">{r.month.slice(0, 3)} {r.year}{r.isCurrent && <span className="ml-2 text-[9px] font-black text-amber-600 uppercase">to date</span>}</td>
                  <td className="px-5 py-3 text-right font-bold tabular-nums">{r.units !== null ? num(r.units, 1) : '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-500">{r.dishes > 0 ? num(r.dishes, 0) : '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-500">{r.sales > 0 ? inrCompact(r.sales) : '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.ratioDish !== null ? num(r.ratioDish, 2) : '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.ratioSales !== null ? num(r.ratioSales, 2) : '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-tight ${
                      r.state === 'ok' ? 'bg-emerald-50 text-emerald-600'
                      : r.state === 'estimated' ? 'bg-indigo-50 text-indigo-600'
                      : r.state === 'not-recorded' ? 'bg-amber-50 text-amber-600'
                      : 'bg-slate-100 text-slate-400'}`}>
                      {r.state === 'ok' ? 'Measured' : r.state === 'estimated' ? 'Estimated' : r.state === 'not-recorded' ? 'No count' : 'No data'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-400 font-medium leading-relaxed max-w-3xl">
        Consumption is approximated by units <strong>purchased</strong>, so a month where you stocked up reads high and the
        month after reads low. The rolling 4-month figure absorbs most of that; the raw monthly dots show it. Add
        month-end stock counts later to turn this into true consumption.
      </p>
    </div>
  );
};

export default ConsumablesEfficiency;
