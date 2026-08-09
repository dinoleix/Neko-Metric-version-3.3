
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { computeConsumption, closingStockTotal, hasImpossibleStock, costMapsOf, forEachCostRow } from '../pnlService';
import { getCachedCollection } from '../referenceCache';
import {
  inr, inrCompact, pct, bps, Tile, DeltaChip, CHART,
  monthWindow, prevPeriod, daysInMonth, proration, PeriodKey,
} from '../reportKit';
import {
  SalesMonthlySnapshot, ExpenseMonthlySnapshot, CogsAdjustment, DailySalesLog,
  Employee, StoreRental, MonthlyPayroll, CategorySettings,
  getOutletName, MONTH_NAMES, YEAR_OPTIONS, DEFAULT_COGS, DEFAULT_LABOUR, DEFAULT_OPS,
  istNow,
} from '../types';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  CartesianGrid, XAxis, YAxis, Tooltip as ChartTooltip, Legend as ChartLegend,
} from 'recharts';
import {
  Crown, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Info, ShieldAlert, Clock,
} from 'lucide-react';
import WeatherWidget from './WeatherWidget';

/**
 * CEO Dashboard — "are we on track?" at a glance.
 *
 * DATA REALITY that shapes everything here: the sales CSV is imported MONTHLY,
 * but crew enter daily sales EVERY DAY. So during the live month:
 *   - sales_snapshots.dailyTrend is empty (no CSV yet)
 *   - daily_sales_logs is the ONLY live revenue signal — and it is COUNTER ONLY;
 *     delivery-app revenue does not exist until the CSV lands
 *   - the crew_* half of expense_snapshots is live; the CSV half is not
 *
 * The pace comparison is therefore till-vs-till (counter vs counter, like for
 * like). Comparing live till against last month's dailyTrend would be
 * counter-vs-(counter+online) and would manufacture a permanent shortfall —
 * the exact bug fixed in SalesHub's reconciliation.
 *
 * The app is light-only; the palettes below carry no dark-mode variants.
 */

/* ── Palettes — validated with the dataviz validator, light surface ───────
 *
 * Pace chart · node scripts/validate_palette.js "#4f46e5,#0891b2,#475569" --mode light
 *   [PASS] lightness · [PASS] CVD sep (worst #0891b2↔#4f46e5 ΔE 16.4 deutan)
 *   [PASS] normal-vision (worst ΔE 18.3) · [PASS] contrast
 *   [FAIL] chroma on #475569 — INTENTIONAL. "Last month" is context, not a
 *   category; the emphasis form (one accent + gray) is correct here. The chroma
 *   floor exists to stop a categorical SLOT reading as gray. Do not "fix" it.
 */
const PACE_THIS = '#4f46e5';
const PACE_TILL = '#0891b2';
const PACE_PREV = '#475569';

/* Cost pillars · node scripts/validate_palette.js "#d97706,#4f46e5,#0891b2,#e11d48,#94a3b8" --mode light
 *   [PASS] CVD sep (worst adjacent #94a3b8↔#e11d48 ΔE 16.0 deutan)
 *   [PASS] normal-vision (worst #0891b2↔#4f46e5 ΔE 21.4)
 *   [FAIL] chroma on #94a3b8 — INTENTIONAL, residual bucket not a category
 *   [WARN] contrast on #94a3b8 (2.5:1) — discharged by always direct-labelling it
 *
 * STACK ORDER IS MANDATORY, bottom→top as listed. Moving Uncategorized next to
 * Operations drops adjacent ΔE from 16.0 to 7.8 and fails the check.
 * (ExpenseHub's PILLAR_COLORS fails validation — #ef4444 vs #f43f5e, ΔE 3.5. Don't reuse.)
 */
const PILLARS = [
  { key: 'COGS', label: 'COGS', color: '#d97706' },
  { key: 'LABOUR', label: 'Labour', color: '#4f46e5' },
  { key: 'OPERATIONS', label: 'Operations', color: '#0891b2' },
  { key: 'RENT', label: 'Rent', color: '#e11d48' },
  { key: 'UNCATEGORIZED', label: 'Uncategorized', color: '#94a3b8' },
] as const;
type PillarKey = typeof PILLARS[number]['key'];

/* Alert thresholds — named so they can be tuned without archaeology. */
const TH = {
  uploadsStaleDays: 3,       // uploads this many days behind "today" → chip
  cogsBandBps: 400,          // |current − trailing median| ≥ 4pp → chip
  cogsMinDay: 20,            // ...but never before day 20: purchases are lumpy
  uncatPctOfCost: 5,         // uncategorized ≥ 5% of total cost …
  uncatMinRupees: 25000,     // …AND ≥ ₹25k, so it scales with the business
  minTillDaysToExpect: 5,    // only nag about missing till days for outlets that use it
};

type LegState = 'ok' | 'failed';
interface Leg<T> { data: T[]; failed: boolean; }

const okLeg = <T,>(data: T[]): Leg<T> => ({ data, failed: false });
const failLeg = <T,>(): Leg<T> => ({ data: [], failed: true });

/** Runs a query in isolation. Never let one leg's failure discard another's data. */
const runLeg = async <T,>(label: string, fn: () => Promise<T[]>): Promise<Leg<T>> => {
  try { return okLeg(await fn()); }
  catch (err) { console.warn(`[ExecDashboard] ${label} failed:`, err); return failLeg<T>(); }
};

const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const Card: React.FC<{ title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }> =
  ({ title, sub, children, right }) => (
    <section className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-xs font-black text-slate-700 uppercase tracking-widest">{title}</h3>
          {sub && <p className="text-[11px] font-medium text-slate-400 mt-1 max-w-2xl leading-relaxed">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );

const Unavailable: React.FC<{ what: string; why: string }> = ({ what, why }) => (
  <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-100 rounded-xl">
    <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
    <div>
      <p className="text-xs font-bold text-rose-900">{what}</p>
      <p className="text-[11px] font-medium text-rose-800 mt-0.5">{why}</p>
    </div>
  </div>
);

const ExecDashboard: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const nowIst = istNow();
  const curMonth = MONTH_NAMES[nowIst.getUTCMonth()];
  const curYear = nowIst.getUTCFullYear().toString();
  const todayDom = nowIst.getUTCDate();

  const [anchorMonth, setAnchorMonth] = useState(curMonth);
  const [anchorYear, setAnchorYear] = useState(curYear);
  const [outlet, setOutlet] = useState('all');
  const [windowMonths, setWindowMonths] = useState(6);
  const [costMeasure, setCostMeasure] = useState<'pct' | 'rupees'>('pct');

  const [salesLeg, setSalesLeg] = useState<Leg<SalesMonthlySnapshot>>(okLeg([]));
  const [expenseLeg, setExpenseLeg] = useState<Leg<ExpenseMonthlySnapshot>>(okLeg([]));
  const [cogsLeg, setCogsLeg] = useState<Leg<CogsAdjustment>>(okLeg([]));
  const [rentalsLeg, setRentalsLeg] = useState<Leg<StoreRental>>(okLeg([]));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payrolls, setPayrolls] = useState<MonthlyPayroll[]>([]);
  const [payrollFailed, setPayrollFailed] = useState(false);
  const [tillLogs, setTillLogs] = useState<DailySalesLog[]>([]);
  const [tillState, setTillState] = useState<'ok' | 'partial' | 'failed' | 'empty'>('ok');
  const [keywords, setKeywords] = useState({ cogs: DEFAULT_COGS, labour: DEFAULT_LABOUR, ops: DEFAULT_OPS });
  const [keywordsFellBack, setKeywordsFellBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nonce, setNonce] = useState(0);

  const isLive = anchorMonth === curMonth && anchorYear === curYear;
  const anchorIdx = MONTH_NAMES.indexOf(anchorMonth);
  const isFuture = parseInt(anchorYear) > parseInt(curYear) ||
    (anchorYear === curYear && anchorIdx > MONTH_NAMES.indexOf(curMonth));
  const prev = prevPeriod(anchorMonth, anchorYear);
  const D = isLive ? todayDom : daysInMonth(anchorMonth, anchorYear);
  const Dprev = daysInMonth(prev.month, prev.year);

  /* Year set is [Y, Y-1] — NOT derived from the trend window — so the 3/6/12
   * toggle costs zero extra reads and triggers no refetch. Any ≤12-month window
   * walked back from the anchor is contained in those two years. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const years = [anchorYear, (parseInt(anchorYear) - 1).toString()];
      const [s, e, c, settings] = await Promise.all([
        runLeg('sales_snapshots', async () =>
          (await getDocs(query(collection(db, 'sales_snapshots'), where('userId', '==', dataOwnerId), where('year', 'in', years))))
            .docs.map(d => d.data() as SalesMonthlySnapshot)),
        runLeg('expense_snapshots', async () =>
          (await getDocs(query(collection(db, 'expense_snapshots'), where('userId', '==', dataOwnerId), where('year', 'in', years))))
            .docs.map(d => d.data() as ExpenseMonthlySnapshot)),
        runLeg('cogs_adjustments', async () =>
          (await getDocs(query(collection(db, 'cogs_adjustments'), where('userId', '==', dataOwnerId), where('year', 'in', years))))
            .docs.map(d => d.data() as CogsAdjustment)),
        (async () => { try { return await getDoc(doc(db, 'category_settings', dataOwnerId)); } catch { return null; } })(),
      ]);
      const [rent, emp, pay] = await Promise.all([
        runLeg('rentals', () => getCachedCollection<StoreRental>('rentals', dataOwnerId)),
        runLeg('employees', () => getCachedCollection<Employee>('employees', dataOwnerId)),
        runLeg('monthly_payrolls', () => getCachedCollection<MonthlyPayroll>('monthly_payrolls', dataOwnerId)),
      ]);
      if (cancelled) return;

      setSalesLeg(s); setExpenseLeg(e); setCogsLeg(c);
      setRentalsLeg(rent); setEmployees(emp.data); setPayrolls(pay.data); setPayrollFailed(pay.failed);

      // Normalized on read; a silent fallback to defaults is the bug fixed in 44f4398
      const norm = (l: string[]) => l.map(k => (k || '').trim().toUpperCase());
      if (settings?.exists()) {
        const d = settings.data() as CategorySettings;
        setKeywords({
          cogs: d.cogsKeywords ? norm(d.cogsKeywords) : DEFAULT_COGS,
          labour: d.labourKeywords ? norm(d.labourKeywords) : DEFAULT_LABOUR,
          ops: d.opsKeywords ? norm(d.opsKeywords) : DEFAULT_OPS,
        });
        setKeywordsFellBack(false);
      } else {
        setKeywordsFellBack(true);
      }
      setLoading(false); setRefreshing(false);
    })();
    return () => { cancelled = true; };
  }, [dataOwnerId, anchorYear, nonce]);

  /* Till logs: anchor month + prior month, for the till-vs-till pace curve.
   * Both legs isolated — a shared Promise.all here has caused five incidents. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const start = `${prev.year}-${String(MONTH_NAMES.indexOf(prev.month) + 1).padStart(2, '0')}-01`;
      const end = `${anchorYear}-${String(anchorIdx + 1).padStart(2, '0')}-${String(daysInMonth(anchorMonth, anchorYear)).padStart(2, '0')}`;
      const leg = (field: 'ownerId' | 'userId') => runLeg(`daily_sales_logs ${field}`, async () =>
        (await getDocs(query(collection(db, 'daily_sales_logs'),
          where(field, '==', dataOwnerId), where('date', '>=', start), where('date', '<=', end))))
          .docs.map(d => ({ id: d.id, ...d.data() } as DailySalesLog)));
      const [byOwner, byUser] = await Promise.all([leg('ownerId'), leg('userId')]);
      if (cancelled) return;
      const seen = new Set<string>();
      const logs = [...byOwner.data, ...byUser.data].filter(l => l.id && !seen.has(l.id) && seen.add(l.id));
      setTillLogs(logs);
      setTillState(
        byOwner.failed && byUser.failed ? 'failed'
        : byOwner.failed || byUser.failed ? 'partial'
        : logs.length === 0 ? 'empty' : 'ok'
      );
    })();
    return () => { cancelled = true; };
  }, [dataOwnerId, anchorMonth, anchorYear, nonce]);

  const outletIds = useMemo(() => Array.from(new Set(
    [...salesLeg.data, ...expenseLeg.data].map(s => s.outletId)
      .filter(o => o && o !== 'GLOBAL' && o !== 'Unassigned')
  )).sort(), [salesLeg.data, expenseLeg.data]);

  const inScope = (oId: string) =>
    outlet === 'all' ? (oId !== 'GLOBAL' && oId !== 'Unassigned') : oId === outlet;

  const windowKeys: PeriodKey[] = useMemo(
    () => monthWindow(anchorMonth, anchorYear, windowMonths), [anchorMonth, anchorYear, windowMonths]);

  /** One month's figures, classified exactly as PnLHub does so the numbers agree. */
  const periodFigures = useMemo(() => (month: string, year: string) => {
    const sales = salesLeg.data.filter(s => s.month === month && s.year === year && inScope(s.outletId));
    const exp = expenseLeg.data.filter(s => s.month === month && s.year === year && inScope(s.outletId));
    const adj = cogsLeg.data.filter(a => a.month === month && a.year === year && inScope(a.outletId));

    const posGoodGross = sales.reduce((a, s) => a + (s.posGoodGross || 0), 0);
    const onlineGoodGross = sales.reduce((a, s) => a + (s.onlineGoodGross || 0), 0);
    const eventRevenue = sales.reduce((a, s) => a + (s.eventRevenue || 0), 0);
    const posGoodTax = sales.reduce((a, s) => a + (s.posGoodTax || 0), 0);
    const onlineGoodNet = sales.reduce((a, s) => a + (s.onlineGoodNet || 0), 0);
    const gross = posGoodGross + onlineGoodGross + eventRevenue;
    const netCashInflow = (posGoodGross - posGoodTax) + onlineGoodNet + eventRevenue;

    let rawCogs = 0, csvLabour = 0, ops = 0, uncat = 0;
    exp.forEach(snap => forEachCostRow(costMapsOf(snap), (cat, amt) => {
      const v = Math.abs(amt);
      if (keywords.cogs.includes(cat)) rawCogs += v;
      else if (keywords.labour.includes(cat)) csvLabour += v;
      else if (keywords.ops.includes(cat)) ops += v;
      else uncat += v;
    }));

    // Fixed costs, PRORATED for outlets closed mid-month (absent before this rebuild).
    // NOTE: monthly_payrolls MUST be filtered by THIS month and year. PnLHub gets
    // away with find(p => p.outletId === oId) only because its fetch is already
    // scoped to one period; in this multi-month loop that would apply one month's
    // payroll to every month and look entirely plausible.
    let rent = 0, fixedLabour = 0, payrollEstimated = false;
    (outlet === 'all' ? outletIds : [outlet]).forEach(oId => {
      const rental = rentalsLeg.data.find(r => r.outletId === oId);
      const mult = proration(rental, month, year);
      if (rental) rent += (rental.currentRent || 0) * mult;
      const fiscal = payrolls.find(p => p.outletId === oId && p.month === month && p.year === year);
      if (fiscal) fixedLabour += fiscal.totalAmount;
      else if (mult > 0) {
        payrollEstimated = true;
        fixedLabour += employees.filter(e => e.outletId === oId)
          .reduce((a, e) => a + (e.currentSalary || 0), 0) * mult;
      }
    });

    const cogs = computeConsumption(rawCogs, adj);
    const stockSuspect = hasImpossibleStock(rawCogs, adj);
    const labour = csvLabour + fixedLabour;
    const totalCost = cogs + labour + ops + rent + uncat;
    const netProfit = netCashInflow - totalCost;

    const pillar: Record<PillarKey, number> = { COGS: cogs, LABOUR: labour, OPERATIONS: ops, RENT: rent, UNCATEGORIZED: uncat };
    return {
      hasSales: sales.length > 0, hasExpense: exp.length > 0,
      gross, netCashInflow, posGoodGross, onlineGoodGross, eventRevenue,
      pillar, totalCost, netProfit,
      margin: gross > 0 ? (netProfit / gross) * 100 : null,
      ratio: (k: PillarKey) => gross > 0 ? (pillar[k] / gross) * 100 : null,
      stockSuspect, payrollEstimated,
    };
  }, [salesLeg.data, expenseLeg.data, cogsLeg.data, rentalsLeg.data, payrolls, employees, keywords, outlet, outletIds]);

  const anchorFig = useMemo(() => periodFigures(anchorMonth, anchorYear), [periodFigures, anchorMonth, anchorYear]);
  const prevFig = useMemo(() => periodFigures(prev.month, prev.year), [periodFigures, prev.month, prev.year]);

  /* ── Block A: till-vs-till cumulative pace ─────────────────────────────── */
  const pace = useMemo(() => {
    const cum = (month: string, year: string, days: number) => {
      const mm = String(MONTH_NAMES.indexOf(month) + 1).padStart(2, '0');
      const byDay = new Array(days).fill(0);
      let logged = 0;
      tillLogs.forEach(l => {
        if (!l.date?.startsWith(`${year}-${mm}`) || !inScope(l.outletId)) return;
        const d = parseInt(l.date.split('-')[2]);
        if (d >= 1 && d <= days) { byDay[d - 1] += Number(l.totalNet || 0); }
      });
      const out: number[] = []; let run = 0;
      byDay.forEach((v, i) => { run += v; out[i] = run; if (v > 0) logged++; });
      return { cum: out, daily: byDay, logged };
    };
    const thisM = cum(anchorMonth, anchorYear, D);
    const prevM = cum(prev.month, prev.year, Dprev);
    const k = Math.min(D, Dprev);
    const mtd = thisM.cum[D - 1] || 0;
    const prevAtK = prevM.cum[k - 1] || 0;
    const pacePct = prevAtK > 0 ? ((mtd - prevAtK) / prevAtK) * 100 : null;

    // Two projection methods; show a RANGE. A single number reads as a commitment.
    const dim = daysInMonth(anchorMonth, anchorYear);
    const flat = D > 0 ? (mtd / D) * dim : 0;
    const prevFull = prevM.cum[Dprev - 1] || 0;
    const shaped = prevAtK > 0 ? mtd * (prevFull / prevAtK) : null;
    const canProject = isLive && D >= 5 && mtd > 0;

    return {
      rows: Array.from({ length: Math.max(D, k) }, (_, i) => ({
        day: i + 1,
        thisMonth: i < D ? thisM.cum[i] : null,
        lastMonth: i < Dprev ? prevM.cum[i] : null,
      })),
      mtd, prevAtK, pacePct, k, logged: thisM.logged,
      projLow: canProject ? Math.min(flat, shaped ?? flat) : null,
      projHigh: canProject ? Math.max(flat, shaped ?? flat) : null,
      projReason: !isLive ? null : D < 5 ? `Too early to project — ${D} day${D === 1 ? '' : 's'} of data`
        : mtd === 0 ? 'No till entries yet this month' : null,
      missingDays: isLive ? Array.from({ length: D - 1 }, (_, i) => i + 1).filter(d => thisM.daily[d - 1] === 0) : [],
    };
  }, [tillLogs, anchorMonth, anchorYear, prev, D, Dprev, isLive, outlet]);

  /* ── Block B: cost structure across the window ─────────────────────────── */
  const costSeries = useMemo(() => windowKeys.map(w => {
    const f = periodFigures(w.month, w.year);
    const row: any = { label: w.label, _hasData: f.hasExpense || f.hasSales, _gross: f.gross };
    PILLARS.forEach(p => {
      row[p.key] = costMeasure === 'pct' ? (f.ratio(p.key) ?? 0) : f.pillar[p.key];
    });
    return row;
  }), [windowKeys, periodFigures, costMeasure]);

  /* ── Alerts ────────────────────────────────────────────────────────────── */
  const alerts = useMemo(() => {
    const out: { tone: 'critical' | 'warning' | 'info'; text: string }[] = [];
    if (salesLeg.failed) out.push({ tone: 'critical', text: 'Sales data could not be loaded — figures below are incomplete, not zero.' });
    if (expenseLeg.failed) out.push({ tone: 'critical', text: 'Cost data could not be loaded — profit is unavailable, not zero.' });
    if (cogsLeg.failed) out.push({ tone: 'critical', text: 'Stock records could not be loaded — COGS and profit suppressed rather than overstated.' });
    if (rentalsLeg.failed) out.push({ tone: 'critical', text: 'Rentals could not be loaded — rent and proration unavailable.' });
    if (keywordsFellBack) out.push({ tone: 'warning', text: 'Using built-in category keywords — your Category Settings could not be read, so this cost split may not match Expense Hub.' });
    if (tillState === 'failed') out.push({ tone: 'critical', text: 'Till log could not be read — the pace chart is empty because of a read failure.' });
    if (tillState === 'partial') out.push({ tone: 'warning', text: 'Till log partially read — one source was unavailable, so the pace curve may be incomplete.' });
    if (anchorFig.stockSuspect) out.push({ tone: 'critical', text: `Closing stock exceeds opening + purchases for ${anchorMonth} — a data-entry error. COGS is clamped at zero.` });
    if (anchorFig.payrollEstimated && (!isLive || D >= 25)) out.push({ tone: 'warning', text: 'Payroll estimated from employee records — no validated monthly payroll for this period.' });
    if (isLive && pace.missingDays.length > 0) out.push({ tone: 'warning', text: `No till entry for day${pace.missingDays.length > 1 ? 's' : ''} ${pace.missingDays.slice(0, 5).join(', ')}${pace.missingDays.length > 5 ? '…' : ''} — the curve is flat there, not zero sales.` });

    // COGS out of band — median of complete prior months, never before day 20
    if ((!isLive || D >= TH.cogsMinDay) && anchorFig.ratio('COGS') !== null) {
      const prior = windowKeys.slice(0, -1).map(w => periodFigures(w.month, w.year).ratio('COGS')).filter((v): v is number => v !== null);
      const med = prior.length >= 3 ? median(prior) : null;
      const cur = anchorFig.ratio('COGS') as number;
      if (med !== null && Math.abs(cur - med) * 100 >= TH.cogsBandBps) {
        out.push({ tone: 'warning', text: `COGS at ${pct(cur)} of revenue vs a ${prior.length}-month median of ${pct(med)} — ${bps(cur - med)} outside the ±${TH.cogsBandBps} bps band.` });
      }
    }
    const uncatPct = anchorFig.totalCost > 0 ? (anchorFig.pillar.UNCATEGORIZED / anchorFig.totalCost) * 100 : 0;
    if (uncatPct >= TH.uncatPctOfCost && anchorFig.pillar.UNCATEGORIZED >= TH.uncatMinRupees) {
      out.push({ tone: 'warning', text: `${inr(anchorFig.pillar.UNCATEGORIZED)} of cost is uncategorized (${pct(uncatPct)} of total) — map these in Category Settings.` });
    }
    const future = salesLeg.data.filter(s => {
      const y = parseInt(s.year), i = MONTH_NAMES.indexOf(s.month);
      return y > parseInt(curYear) || (s.year === curYear && i > MONTH_NAMES.indexOf(curMonth));
    });
    if (future.length > 0) out.push({ tone: 'warning', text: `${future.length} snapshot(s) exist for future months — check Data Catalog.` });
    return out;
  }, [salesLeg, expenseLeg, cogsLeg, rentalsLeg, keywordsFellBack, tillState, anchorFig, isLive, D, pace, windowKeys, periodFigures, curMonth, curYear, anchorMonth]);

  const refresh = () => { setRefreshing(true); setNonce(n => n + 1); };

  if (loading) return <div className="py-32 text-center"><Loader2 className="mx-auto animate-spin text-indigo-600" size={28} /></div>;

  return (
    <div className={`space-y-6 animate-in fade-in duration-500 pb-20 ${refreshing ? 'opacity-50' : ''}`}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-slate-900 rounded-2xl text-amber-400 shadow-lg"><Crown size={24} /></div>
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight uppercase">CEO Dashboard</h2>
            <p className="text-slate-400 text-sm font-medium">
              {anchorMonth} {anchorYear}
              {isLive && <span className="ml-2 text-[10px] font-black uppercase text-amber-600 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded">Live — day {D}</span>}
            </p>
          </div>
        </div>
        <button onClick={refresh} disabled={refreshing}
          className="h-10 px-4 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-40 transition-all">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {/* Filters — one row, above everything they scope */}
      <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <button onClick={() => { setAnchorMonth(curMonth); setAnchorYear(curYear); }}
          className={`h-10 px-4 rounded-xl text-xs font-bold transition-all ${isLive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>This month</button>
        <button onClick={() => { const p = prevPeriod(curMonth, curYear); setAnchorMonth(p.month); setAnchorYear(p.year); }}
          className="h-10 px-4 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-xs font-bold transition-all">Last month</button>
        <select value={anchorMonth} onChange={e => setAnchorMonth(e.target.value)}
          className="h-10 px-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-indigo-400">
          {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={anchorYear} onChange={e => setAnchorYear(e.target.value)}
          className="h-10 px-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-indigo-400">
          {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={outlet} onChange={e => setOutlet(e.target.value)}
          className="h-10 px-4 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold outline-none focus:border-indigo-400">
          <option value="all">All stores</option>
          {outletIds.map(o => <option key={o} value={o}>{getOutletName(o)}</option>)}
        </select>
        <div className="flex gap-1 ml-auto">
          {[3, 6, 12].map(n => (
            <button key={n} onClick={() => setWindowMonths(n)}
              className={`h-10 w-12 rounded-xl text-xs font-bold transition-all ${windowMonths === n ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{n}m</button>
          ))}
        </div>
      </div>

      {/* Alerts — always rendered; "no exceptions" is information */}
      <div className="space-y-2">
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl">
            <CheckCircle2 size={15} className="text-emerald-600" />
            <p className="text-xs font-semibold text-emerald-900">No exceptions for this period.</p>
          </div>
        ) : alerts.map((a, i) => (
          <div key={i} className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border ${
            a.tone === 'critical' ? 'bg-rose-50 border-rose-100' : a.tone === 'warning' ? 'bg-amber-50 border-amber-100' : 'bg-slate-50 border-slate-100'}`}>
            {a.tone === 'critical' ? <ShieldAlert size={15} className="text-rose-600 shrink-0 mt-0.5" />
              : a.tone === 'warning' ? <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />
              : <Info size={15} className="text-slate-500 shrink-0 mt-0.5" />}
            <p className={`text-xs font-semibold ${a.tone === 'critical' ? 'text-rose-900' : a.tone === 'warning' ? 'text-amber-900' : 'text-slate-700'}`}>{a.text}</p>
          </div>
        ))}
      </div>

      {isFuture ? (
        <Card title="Not started"><p className="text-sm font-medium text-slate-500 py-8 text-center">{anchorMonth} {anchorYear} hasn't started yet.</p></Card>
      ) : (
        <>
          {/* ── Block A ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile label={isLive ? `Counter sales — day ${D}` : 'Counter sales (till)'}
              value={tillState === 'failed' ? '—' : inr(pace.mtd)}
              sub={tillState === 'failed' ? 'read failed' : `${pace.logged} day${pace.logged === 1 ? '' : 's'} logged`} />
            <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl px-5 py-4">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">Pace vs {prev.month.slice(0, 3)}</p>
              {pace.pacePct === null
                ? <p className="text-sm font-bold text-slate-400">No comparable data</p>
                : <><p className={`text-2xl font-black tracking-tighter ${pace.pacePct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{pace.pacePct >= 0 ? '+' : ''}{pace.pacePct.toFixed(0)}%</p>
                   {/* When the prior month is shorter, k clamps to its length — say so
                       rather than implying a same-day comparison that isn't possible */}
                   <p className="text-[10px] font-medium text-slate-400 mt-1">
                     vs {inr(pace.prevAtK)} {pace.k < D ? `— all ${pace.k} days of ${prev.month.slice(0, 3)}` : `at day ${pace.k}`}
                   </p></>}
            </div>
            <Tile label="Projected month-end"
              value={pace.projLow !== null ? `${inrCompact(pace.projLow)}–${inrCompact(pace.projHigh as number)}` : '—'}
              sub={pace.projReason || (pace.projLow !== null ? 'run-rate & last-month shape' : 'actual, month complete')} />
            <Tile label="Net profit"
              value={cogsLeg.failed || expenseLeg.failed || rentalsLeg.failed ? '—' : inr(anchorFig.netProfit)}
              tone={anchorFig.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}
              sub={cogsLeg.failed || expenseLeg.failed || rentalsLeg.failed ? 'suppressed — data unavailable' : `margin ${pct(anchorFig.margin)}`} />
          </div>

          <Card title="Counter sales pace" sub="Counter sales only, from the crew till count. Delivery-app revenue appears when the monthly CSV is imported, so it is not on this curve. Compared calendar day to calendar day — weekends fall on different dates in different months.">
            {tillState === 'failed' ? <Unavailable what="Till log could not be read" why="This is a read failure, not an absence of sales. Check the browser console for the Firestore error." />
              : tillState === 'empty' ? <p className="text-sm font-medium text-slate-400 py-12 text-center">No till entries recorded for {anchorMonth} {anchorYear}.</p>
              : (
                <ResponsiveContainer width="100%" height={296}>
                  <LineChart data={pace.rows} margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="day" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.axisLine }} minTickGap={16} />
                    <YAxis tickFormatter={inrCompact} tick={CHART.tick} tickLine={false} axisLine={false} width={54} />
                    <ChartTooltip contentStyle={CHART.tooltip}
                      formatter={(v: any, n: any) => [v === null ? '—' : inr(Number(v)), n]}
                      labelFormatter={(d: any) => `Day ${d}`} />
                    <ChartLegend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                    <Line name={`${prev.month.slice(0, 3)} (cumulative)`} type="monotone" dataKey="lastMonth"
                      stroke={PACE_PREV} strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
                    <Line name={`${anchorMonth.slice(0, 3)} (cumulative)`} type="monotone" dataKey="thisMonth"
                      stroke={PACE_THIS} strokeWidth={2} dot={false} activeDot={{ r: 5 }} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
          </Card>

          {/* ── Block B ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {PILLARS.map(p => {
              const cur = anchorFig.ratio(p.key);
              const before = prevFig.ratio(p.key);
              const suppressed = expenseLeg.failed || (p.key === 'COGS' && cogsLeg.failed) || (p.key === 'RENT' && rentalsLeg.failed);
              return (
                <div key={p.key} className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl px-5 py-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: p.color }} />
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest">{p.label}</p>
                  </div>
                  <p className="text-xl font-black text-slate-900 tracking-tighter">{suppressed ? '—' : inr(anchorFig.pillar[p.key])}</p>
                  <p className="text-[10px] font-medium text-slate-400 mt-1">
                    {suppressed ? 'unavailable' : `${pct(cur)} of revenue`}
                    {!suppressed && cur !== null && before !== null && <span className="ml-1.5 font-bold text-slate-500">{bps(cur - before)}</span>}
                  </p>
                </div>
              );
            })}
          </div>

          <Card
            title="Cost structure"
            sub={isLive
              ? 'Live month shows crew-entered costs only — the CSV half arrives at month end, so these ratios are incomplete and move as purchases land.'
              : 'Share of gross revenue by cost pillar.'}
            right={
              <div className="flex gap-1">
                {(['pct', 'rupees'] as const).map(m => (
                  <button key={m} onClick={() => setCostMeasure(m)}
                    className={`h-8 px-3 rounded-lg text-[11px] font-bold transition-all ${costMeasure === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                    {m === 'pct' ? '% of revenue' : '₹'}
                  </button>
                ))}
              </div>
            }>
            {expenseLeg.failed ? <Unavailable what="Cost data could not be loaded" why="Showing nothing rather than zero. Retry, or check the console for the Firestore error." /> : (
              <ResponsiveContainer width="100%" height={296}>
                <BarChart data={costSeries} margin={{ top: 6, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="label" tick={CHART.tick} tickLine={false} axisLine={{ stroke: CHART.axisLine }} />
                  <YAxis tickFormatter={(v: number) => costMeasure === 'pct' ? `${v.toFixed(0)}%` : inrCompact(v)}
                    tick={CHART.tick} tickLine={false} axisLine={false} width={54} />
                  <ChartTooltip contentStyle={CHART.tooltip}
                    formatter={(v: any, n: any) => [costMeasure === 'pct' ? pct(Number(v)) : inr(Number(v)), n]} />
                  <ChartLegend wrapperStyle={{ fontSize: 11 }} />
                  {/* Stack order is validated — see the palette comment at the top */}
                  {PILLARS.map((p, i) => (
                    <Bar key={p.key} dataKey={p.key} name={p.label} stackId="cost" fill={p.color}
                      radius={i === PILLARS.length - 1 ? [4, 4, 0, 0] : undefined}
                      stroke="#ffffff" strokeWidth={2} maxBarSize={56} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-400">
            <Clock size={12} />
            Revenue for complete months includes delivery apps; the live month is counter-only until the CSV is imported.
          </div>
        </>
      )}
    </div>
  );
};

export default ExecDashboard;
