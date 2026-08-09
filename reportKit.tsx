
import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { MONTH_NAMES, StoreRental } from './types';

/**
 * Shared presentation helpers for reporting screens.
 *
 * These were copy-pasted between CrewReports and ConsumablesEfficiency and had
 * already drifted — inrCompact rendered ₹4,500 as "₹4.5k" in one and "₹5k" in
 * the other. The CrewReports variants are canonical here.
 *
 * Deliberately NOT here: chart palettes. Each one has a validated adjacency
 * ORDER (swapping two slots can drop colour-blind separation below the pass
 * threshold), so they live next to their chart with the validator output in a
 * comment. A shared COLORS object would invite exactly the reordering that
 * breaks them.
 *
 * The app is light-only; CHART below carries no dark-mode variants by design.
 */

/* ── Formatters ─────────────────────────────────────────────────────────── */

export const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export const inrCompact = (n: number) =>
  n >= 100000 ? `₹${(n / 100000).toFixed(1)}L`
  : n >= 1000 ? `₹${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  : `₹${Math.round(n)}`;

/** Percentage to 1dp. Returns an em dash for null so callers never print "NaN%". */
export const pct = (n: number | null, digits = 1) =>
  n === null || !isFinite(n) ? '—' : `${n.toFixed(digits)}%`;

/**
 * Basis points, for month-over-month movement in a ratio.
 * "COGS up 180 bps" is actionable; "COGS up ₹1.4L" is confounded by revenue.
 */
export const bps = (deltaPct: number | null) =>
  deltaPct === null || !isFinite(deltaPct) ? '—' : `${deltaPct >= 0 ? '+' : ''}${Math.round(deltaPct * 100)} bps`;

/** 'YYYY-MM-DD' → '9 Aug' */
export const shortDate = (d: string) => {
  const [, m, dd] = d.split('-');
  return `${parseInt(dd)} ${MONTH_NAMES[parseInt(m) - 1].slice(0, 3)}`;
};

export const num = (n: number, d = 2) => n.toLocaleString('en-IN', { maximumFractionDigits: d });

/* ── Period arithmetic ──────────────────────────────────────────────────── */

/** Days in a month. UTC so leap years and year rollover hold. */
export const daysInMonth = (month: string, year: string): number =>
  new Date(Date.UTC(parseInt(year), MONTH_NAMES.indexOf(month) + 1, 0)).getUTCDate();

/** Previous month, wrapping the year. The (idx + 11) % 12 form from PnLHub. */
export const prevPeriod = (month: string, year: string): { month: string; year: string } => {
  const idx = MONTH_NAMES.indexOf(month);
  return {
    month: MONTH_NAMES[(idx + 11) % 12],
    year: idx === 0 ? (parseInt(year) - 1).toString() : year,
  };
};

export interface PeriodKey { month: string; year: string; key: string; label: string; }

/** `count` months ending at the anchor, oldest first, wrapping the year. */
export const monthWindow = (anchorMonth: string, anchorYear: string, count: number): PeriodKey[] => {
  const endM = MONTH_NAMES.indexOf(anchorMonth);
  const endY = parseInt(anchorYear);
  const out: PeriodKey[] = [];
  for (let i = count - 1; i >= 0; i--) {
    let m = endM - i, y = endY;
    while (m < 0) { m += 12; y -= 1; }
    out.push({
      month: MONTH_NAMES[m], year: y.toString(),
      key: `${MONTH_NAMES[m]}_${y}`,
      label: `${MONTH_NAMES[m].slice(0, 3)} ${String(y).slice(2)}`,
    });
  }
  return out;
};

/**
 * Share of a month an outlet was trading: 1 normally, 0 if it closed before the
 * month began, else the fraction of days up to the close date. Fixed costs must
 * be multiplied by this or a closed outlet carries a full month of rent.
 *
 * Extracted from ExpenseHub.tsx:380-388 / PnLHub.tsx:392-399. Those two keep
 * their inline copies for now — they are correct and were verified in
 * production; unifying them is a refactor with real regression surface and no
 * user-visible gain. Adopt here when one of them is next touched.
 */
export const proration = (rental: StoreRental | undefined, month: string, year: string): number => {
  if (!rental) return 0;
  if (rental.status !== 'closed' || !rental.closeDate) return 1;
  const mIdx = MONTH_NAMES.indexOf(month);
  const periodStart = new Date(parseInt(year), mIdx, 1);
  const periodEnd = new Date(parseInt(year), mIdx + 1, 0);
  const cDate = new Date(rental.closeDate);
  if (cDate < periodStart) return 0;
  if (cDate < periodEnd) return cDate.getDate() / periodEnd.getDate();
  return 1;
};

/* ── Components ─────────────────────────────────────────────────────────── */

export const Tile: React.FC<{ label: string; value: string; sub?: string; tone?: string }> =
  ({ label, value, sub, tone = 'text-slate-900' }) => (
    <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl px-5 py-4">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1.5">{label}</p>
      <p className={`text-2xl font-black tracking-tighter ${tone}`}>{value}</p>
      {sub && <p className="text-[10px] font-medium text-slate-400 mt-1">{sub}</p>}
    </div>
  );

/**
 * Signed change chip with an explicit polarity.
 *
 * Revenue up is good; COGS up is bad. Two divergent copies of this existed
 * because the original hardcoded "up = green". The ±3% dead band prints "flat"
 * rather than dressing noise up as a trend.
 */
export const DeltaChip: React.FC<{
  pct: number | null;
  polarity?: 'higher-is-good' | 'higher-is-bad';
  label?: string;
}> = ({ pct, polarity = 'higher-is-good', label }) => {
  if (pct === null || !isFinite(pct)) return null;
  const flat = Math.abs(pct) < 3;
  const good = polarity === 'higher-is-good' ? pct > 0 : pct < 0;
  const Dir = flat ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  const tone = flat ? 'text-slate-400' : good ? 'text-emerald-600' : 'text-rose-600';
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-100 rounded-lg text-[10px] font-semibold text-slate-600">
      {label}
      <Dir size={11} className={tone} />
      <span className={tone}>{flat ? 'flat' : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`}</span>
    </span>
  );
};

/* ── Chart constants ────────────────────────────────────────────────────── */

/** Shared recharts styling. Light-only — see the module note above. */
export const CHART = {
  grid: '#f1f5f9',
  axisLine: '#e2e8f0',
  tick: { fontSize: 10, fill: '#94a3b8' },
  tooltip: { borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 },
  /** Neutral for de-emphasised context series and residual buckets. */
  muted: '#94a3b8',
} as const;
