import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where } from 'firebase/firestore';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  ResponsiveContainer, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, Legend as ChartLegend,
  BarChart, Bar, LabelList,
} from 'recharts';
import { db } from '../firebase';
import { getCachedCollection } from '../referenceCache';
import {
  DailySalesLog,
  DailyCounterEntry,
  WasteEntry,
  Vendor,
  Product,
  UserProfile,
  BankAccount,
  MASTER_OUTLETS,
  MONTH_NAMES,
  getOutletName,
  istNow,
  istDateString,
} from '../types';
import {
  ArrowLeft,
  Loader2,
  FileSpreadsheet,
  FileDown,
  ChevronDown,
  MapPin,
  ArrowRightLeft,
  Tag,
  IndianRupee,
  ShoppingBag,
  Vault,
  Trash2,
  Store,
  Package,
  BarChart3,
  Table2,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';

type ReportTab = 'sales' | 'entries' | 'transfers' | 'waste' | 'catalog';
type DatePreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'custom';

interface BankTxn {
  id?: string;
  bankAccountId: string;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  category?: string;
  referenceNo?: string;
}

const TABS: { id: ReportTab; label: string; icon: any }[] = [
  { id: 'sales', label: 'Sales', icon: IndianRupee },
  { id: 'entries', label: 'Purchases & Expenses', icon: ShoppingBag },
  { id: 'transfers', label: '10K Transfers', icon: Vault },
  { id: 'waste', label: 'Waste', icon: Trash2 },
  { id: 'catalog', label: 'Catalog', icon: Package },
];

const istToday = (): string => istDateString(0);

// CVD-validated categorical palette (dataviz six-checks pass on white surface):
// indigo+violet fails protan separation, hence amber for UPI
const CHANNEL_COLORS: Record<'cash' | 'card' | 'upi', string> = {
  cash: '#059669',
  card: '#4f46e5',
  upi: '#d97706',
};
const CHANNEL_LABELS: Record<'cash' | 'card' | 'upi', string> = { cash: 'Cash', card: 'Card', upi: 'UPI' };
const CHANNELS = ['cash', 'card', 'upi'] as const;

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const inrCompact = (n: number) => n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `₹${Math.round(n)}`;
const shortDate = (d: string) => { const [, m, dd] = d.split('-'); return `${parseInt(dd)} ${MONTH_NAMES[parseInt(m) - 1].slice(0, 3)}`; };

// Entry-spend series colors — same validated hues as the sales palette:
// cash keeps its emerald identity, online (digital) purchases take indigo
const SPEND_COLORS = { online: '#4f46e5', cash: '#059669' } as const;

// 10K transfers keep the amber vault identity used on the tiles
const TRANSFER_COLOR = '#d97706';
// Waste types (CVD-validated pair): broken = rose, extra demand = cyan
const WASTE_COLORS = { broken: '#e11d48', extra: '#0891b2' } as const;

// Every date in [start, end] so zero-spend days show as zero instead of the
// line skipping over them (capped as a safety net for absurd custom ranges)
const listDates = (start: string, end: string): string[] => {
  const out: string[] = [];
  let cur = new Date(start + 'T00:00:00Z');
  const stop = new Date(end + 'T00:00:00Z');
  while (cur <= stop && out.length < 400) {
    out.push(cur.toISOString().slice(0, 10));
    cur = new Date(cur.getTime() + 86400000);
  }
  return out;
};

// Average of the second half of a daily series vs the first, as a % change
const halfOverHalf = (values: number[]): number | null => {
  if (values.length < 4) return null;
  const half = Math.floor(values.length / 2);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const a = avg(values.slice(0, half));
  const b = avg(values.slice(half));
  return a > 0 ? ((b - a) / a) * 100 : (b > 0 ? 100 : 0);
};

const TrendChip = ({ label, pct, swatch }: { label: string; pct: number | null; swatch?: string }) => {
  if (pct === null) return null;
  const Dir = Math.abs(pct) < 3 ? Minus : pct > 0 ? TrendingUp : TrendingDown;
  const dirColor = Math.abs(pct) < 3 ? 'text-slate-400' : pct > 0 ? 'text-emerald-600' : 'text-rose-600';
  return (
    <span className="flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-100 rounded-lg text-[10px] font-semibold text-slate-600">
      {swatch && <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: swatch }} />}
      {label}
      <Dir size={11} className={dirColor} />
      <span className={dirColor}>{Math.abs(pct) < 3 ? 'flat' : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`}</span>
    </span>
  );
};

// Same preset → [start, end] logic the entries list uses (all IST-safe)
const rangeForPreset = (preset: DatePreset, customStart: string, customEnd: string): [string, string] => {
  const today = istToday();
  switch (preset) {
    case 'yesterday': {
      const d = istDateString(-1);
      return [d, d];
    }
    case 'this-week': {
      const day = istNow().getUTCDay();
      const daysSinceMonday = day === 0 ? 6 : day - 1;
      return [istDateString(-daysSinceMonday), today];
    }
    case 'last-week': {
      const day = istNow().getUTCDay();
      const daysSinceMonday = day === 0 ? 6 : day - 1;
      return [istDateString(-daysSinceMonday - 7), istDateString(-daysSinceMonday - 1)];
    }
    case 'this-month':
      return [today.slice(0, 8) + '01', today];
    case 'last-month': {
      // Whole previous calendar month. Day 0 of the following month gives its
      // last day (UTC-safe, so leap years and year rollover both hold).
      const [y, m] = today.split('-').map(Number);
      const lastY = m === 1 ? y - 1 : y;
      const lastM = m === 1 ? 12 : m - 1;
      const mm = String(lastM).padStart(2, '0');
      const lastDay = new Date(Date.UTC(lastY, lastM, 0)).getUTCDate();
      return [`${lastY}-${mm}-01`, `${lastY}-${mm}-${String(lastDay).padStart(2, '0')}`];
    }
    case 'custom':
      return [customStart, customEnd];
    default:
      return [today, today];
  }
};

const downloadCsv = (headers: string[], rows: (string | number)[][], filename: string) => {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map(row => row.map(escape).join(','));
  // BOM so Excel opens it as UTF-8
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// Real .xlsx via SheetJS — dynamically imported so the library only loads on demand
const downloadXlsx = async (headers: string[], rows: (string | number)[][], filename: string, sheetName: string) => {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws['!cols'] = headers.map((h, i) => ({
    wch: Math.min(40, Math.max(h.length, ...rows.slice(0, 50).map(r => String(r[i] ?? '').length), 8) + 2),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
};

const downloadPdf = (
  title: string,
  metaLines: string[],
  headers: string[],
  rows: (string | number)[][],
  filename: string,
  rightAlignedCols: number[] = []
) => {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 27, 75);
  doc.text(title, 14, 14);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  metaLines.forEach((line, i) => doc.text(line, 14, 20 + i * 5));
  const columnStyles: Record<number, any> = {};
  rightAlignedCols.forEach(i => { columnStyles[i] = { halign: 'right' }; });
  autoTable(doc, {
    head: [headers],
    body: rows.map(r => r.map(v => String(v))),
    startY: 20 + metaLines.length * 5 + 3,
    styles: { fontSize: 7, cellPadding: 2, font: 'helvetica' },
    headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold' },
    columnStyles,
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
  doc.save(`${filename}.pdf`);
};

const PAGE_SIZES = [10, 20, 30, 50];

// Module-level so pagination state survives parent re-renders; page resets when
// rows shrink below the current window (e.g. filters changed)
const DataTable = ({ headers, rows, rightCols = [], minWidth = 900 }: { headers: string[]; rows: (string | number)[][]; rightCols?: number[]; minWidth?: number }) => {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * pageSize;
  const pageRows = rows.slice(startIdx, startIdx + pageSize);
  return (
    <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl">
      <div className="overflow-x-auto rounded-t-2xl">
        <table className="w-full text-left text-xs" style={{ minWidth }}>
          <thead>
            <tr className="border-b border-slate-100">
              {headers.map((h, i) => (
                <th key={h} className={`px-3 py-3 font-semibold text-slate-500 whitespace-nowrap ${rightCols.includes(i) ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, ri) => (
              <tr key={startIdx + ri} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40 transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2.5 whitespace-nowrap max-w-[240px] truncate ${rightCols.includes(ci) ? 'text-right font-semibold text-slate-800' : 'text-slate-600'}`}>
                    {typeof cell === 'number' ? `₹${cell.toLocaleString('en-IN')}` : (cell === '' ? '—' : cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Pagination footer */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Rows:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(parseInt(e.target.value)); setPage(0); }}
            className="h-8 bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-400"
          >
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <p className="text-xs text-slate-400">
          {rows.length === 0 ? '0' : `${startIdx + 1}–${Math.min(startIdx + pageSize, rows.length)}`} of {rows.length}
        </p>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => setPage(p => Math.max(0, Math.min(p, totalPages - 1) - 1))}
            disabled={safePage === 0}
            className="h-8 px-3 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-600 disabled:opacity-40 active:scale-95 transition-all"
          >
            ‹ Prev
          </button>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, Math.min(p, totalPages - 1) + 1))}
            disabled={safePage >= totalPages - 1}
            className="h-8 px-3 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-semibold text-slate-600 disabled:opacity-40 active:scale-95 transition-all"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
};

const CrewReports: React.FC<{ user: User; profile: UserProfile; onBack?: () => void }> = ({ user, profile, onBack }) => {
  const ownerId = profile.ownerId || user.uid;

  const [activeTab, setActiveTab] = useState<ReportTab>('sales');
  const [datePreset, setDatePreset] = useState<DatePreset>('this-month');
  const [customStartDate, setCustomStartDate] = useState(istToday());
  const [customEndDate, setCustomEndDate] = useState(istToday());
  const [filterOutlet, setFilterOutlet] = useState('all');
  // Entries-tab filters. They narrow fEntries itself, so the Paid/Pending/Total
  // tiles, the charts, the table and the exports all describe the same slice —
  // a total that disagreed with the rows under it would be worse than no filter.
  const [filterType, setFilterType] = useState<'all' | 'purchase' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [loading, setLoading] = useState(false);
  const [salesView, setSalesView] = useState<'charts' | 'table'>('charts');
  const [entriesView, setEntriesView] = useState<'charts' | 'table'>('charts');
  const [trendCategory, setTrendCategory] = useState('all');
  const [transfersView, setTransfersView] = useState<'charts' | 'table'>('charts');
  const [wasteView, setWasteView] = useState<'charts' | 'table'>('charts');

  const [salesLogs, setSalesLogs] = useState<DailySalesLog[]>([]);
  const [entries, setEntries] = useState<DailyCounterEntry[]>([]);
  const [transfers, setTransfers] = useState<BankTxn[]>([]);
  const [wasteEntries, setWasteEntries] = useState<WasteEntry[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [start, end] = rangeForPreset(datePreset, customStartDate, customEndDate);
  const rangeLabel = datePreset === 'custom' ? `${customStartDate} to ${customEndDate}` : datePreset.replace('-', ' ');
  const storeLabel = filterOutlet === 'all' ? 'All stores' : getOutletName(filterOutlet);
  const fileStamp = istToday();

  // Bank accounts are needed to map 10K transfer transactions back to a store
  useEffect(() => {
    getDocs(query(collection(db, 'bank_accounts'), where('userId', '==', ownerId)))
      .then(snap => setBankAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount))))
      .catch(err => console.error('[Reports] bank accounts failed:', err));
  }, []);

  // Store filter lists only outlets whose rental record is active; if there are
  // no rental records at all, fall back to the full master list
  const [activeOutlets, setActiveOutlets] = useState(MASTER_OUTLETS);
  useEffect(() => {
    getDocs(query(collection(db, 'rentals'), where('userId', '==', ownerId)))
      .then(snap => {
        const activeIds = new Set(
          snap.docs.filter(d => d.data().status === 'active').map(d => d.data().outletId as string)
        );
        if (activeIds.size > 0) {
          const outlets = MASTER_OUTLETS.filter(o => activeIds.has(o.id));
          setActiveOutlets(outlets);
          setFilterOutlet(prev => (prev === 'all' || outlets.some(o => o.id === prev)) ? prev : 'all');
        }
      })
      .catch(err => console.error('[Reports] rentals failed:', err));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        if (activeTab === 'sales') {
          const snap = await getDocs(query(collection(db, 'daily_sales_logs'),
            where('ownerId', '==', ownerId), where('date', '>=', start), where('date', '<=', end)));
          if (!cancelled) setSalesLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as DailySalesLog)));
        } else if (activeTab === 'entries') {
          // Two legs, de-duplicated by document id — the same shape Crew Terminal
          // and crewSnapshotService.fetchCrewEntries already use. Entries written
          // before the `ownerId` field existed carry only `userId`, and a Firestore
          // equality filter skips documents missing the field entirely, so the
          // single ownerId query silently omitted them. That put this report below
          // Expense Radar, which reads snapshots built from BOTH legs.
          // Each leg is isolated so one failing (e.g. a missing index) still lets
          // the other return.
          const runEntries = async (field: 'ownerId' | 'userId', value: string) => {
            try {
              const snap = await getDocs(query(collection(db, 'crew_entries'),
                where(field, '==', value), where('date', '>=', start), where('date', '<=', end)));
              return snap.docs;
            } catch (err) {
              console.warn(`[Reports] crew_entries ${field} query failed:`, err);
              return [];
            }
          };
          const [byOwner, byUser] = await Promise.all([
            runEntries('ownerId', ownerId),
            runEntries('userId', user.uid),
          ]);
          const seen = new Set<string>();
          const merged = [...byOwner, ...byUser]
            .filter(d => (seen.has(d.id) ? false : (seen.add(d.id), true)))
            .map(d => ({ id: d.id, ...d.data() } as DailyCounterEntry));
          if (!cancelled) setEntries(merged);
        } else if (activeTab === 'transfers') {
          const snap = await getDocs(query(collection(db, 'bank_transactions'),
            where('ownerId', '==', ownerId), where('category', '==', 'TRANSFER'),
            where('date', '>=', start), where('date', '<=', end)));
          if (!cancelled) {
            // Keep only the counter-side debit so each transfer counts once
            setTransfers(snap.docs.map(d => ({ id: d.id, ...d.data() } as BankTxn)).filter(t => t.type === 'debit'));
          }
        } else if (activeTab === 'waste') {
          const snap = await getDocs(query(collection(db, 'waste_entries'),
            where('ownerId', '==', ownerId), where('date', '>=', start), where('date', '<=', end)));
          if (!cancelled) setWasteEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as WasteEntry)));
        } else if (activeTab === 'catalog') {
          const [prods, vends] = await Promise.all([
            getDocs(query(collection(db, 'products'), where('ownerId', '==', ownerId))),
            getCachedCollection<Vendor>('vendors', ownerId, 'ownerId'),
          ]);
          if (!cancelled) {
            setProducts(prods.docs.map(d => ({ id: d.id, ...d.data() } as Product))
              .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
            setVendors([...vends].sort((a, b) => a.name.localeCompare(b.name)));
          }
        }
      } catch (err) {
        console.error('[Reports] load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab, datePreset, customStartDate, customEndDate]);

  const accountOutlet = (bankAccountId: string) => bankAccounts.find(a => a.id === bankAccountId)?.outletId || '';

  // ── Filtered views (store filter applied client-side) ──────────────
  const fSales = useMemo(
    () => salesLogs.filter(l => filterOutlet === 'all' || l.outletId === filterOutlet)
      .sort((a, b) => b.date.localeCompare(a.date) || a.outletId.localeCompare(b.outletId)),
    [salesLogs, filterOutlet]);
  // Store + type only. The category dropdown is built from this, not from
  // fEntries — sourcing it from the filtered list would leave the selected
  // category as the only option once chosen.
  const entriesByStoreAndType = useMemo(
    () => entries.filter(e =>
      (filterOutlet === 'all' || e.outletId === filterOutlet) &&
      (filterType === 'all' || e.type === filterType)),
    [entries, filterOutlet, filterType]);
  const fEntries = useMemo(
    () => entriesByStoreAndType
      .filter(e => filterCategory === 'all' || (e.category || 'UNCATEGORIZED') === filterCategory)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
    [entriesByStoreAndType, filterCategory]);

  // Cancelled entries are excluded from the options for the same reason the
  // totals exclude them — a cancelled bill is not spend.
  const entryCategoryOptions = useMemo(() => {
    const set = new Set<string>();
    entriesByStoreAndType.forEach(e => {
      if (e.status !== 'cancelled') set.add(e.category || 'UNCATEGORIZED');
    });
    return Array.from(set).sort();
  }, [entriesByStoreAndType]);
  const fTransfers = useMemo(
    () => transfers.filter(t => filterOutlet === 'all' || accountOutlet(t.bankAccountId) === filterOutlet)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [transfers, filterOutlet, bankAccounts]);
  const fWasteRows = useMemo(() => {
    const rows: { date: string; outletId: string; item: string; serving: string; type: string; qty: number; costPerUnit: number; total: number; submittedBy: string }[] = [];
    wasteEntries
      .filter(w => filterOutlet === 'all' || w.outletId === filterOutlet)
      .forEach(w => w.items.forEach(it => rows.push({
        date: w.date, outletId: w.outletId, item: it.itemName, serving: it.servingOptionName,
        type: it.wasteType === 'broken' ? 'Broken' : 'Extra demand',
        qty: it.quantity, costPerUnit: it.costPerUnit, total: it.totalCost, submittedBy: w.submittedBy,
      })));
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [wasteEntries, filterOutlet]);

  // ── Summaries ───────────────────────────────────────────────────────
  const salesTotals = useMemo(() => fSales.reduce((s, l) => ({
    cash: s.cash + (l.cash || 0), card: s.card + (l.card || 0), upi: s.upi + (l.upi || 0), total: s.total + (l.totalNet || 0),
  }), { cash: 0, card: 0, upi: 0, total: 0 }), [fSales]);

  // Daily totals across the visible stores — feeds the trend chart
  const salesTrend = useMemo(() => {
    const byDate: Record<string, { date: string; cash: number; card: number; upi: number }> = {};
    fSales.forEach(l => {
      const d = byDate[l.date] || (byDate[l.date] = { date: l.date, cash: 0, card: 0, upi: 0 });
      d.cash += l.cash || 0; d.card += l.card || 0; d.upi += l.upi || 0;
    });
    return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  }, [fSales]);

  // Direction per channel: average of the second half of the period vs the first
  const channelTrends = useMemo(() => {
    if (salesTrend.length < 4) return null;
    const half = Math.floor(salesTrend.length / 2);
    const avg = (arr: typeof salesTrend, k: 'cash' | 'card' | 'upi') => arr.reduce((s, r) => s + r[k], 0) / arr.length;
    return CHANNELS.map(k => {
      const a = avg(salesTrend.slice(0, half), k);
      const b = avg(salesTrend.slice(half), k);
      const pct = a > 0 ? ((b - a) / a) * 100 : (b > 0 ? 100 : 0);
      return { k, pct };
    });
  }, [salesTrend]);

  // Per-store totals for the side-by-side comparison when "All stores" is selected
  const salesByStore = useMemo(() => {
    const m: Record<string, { cash: number; card: number; upi: number; total: number }> = {};
    fSales.forEach(l => {
      const s = m[l.outletId] || (m[l.outletId] = { cash: 0, card: 0, upi: 0, total: 0 });
      s.cash += l.cash || 0; s.card += l.card || 0; s.upi += l.upi || 0; s.total += l.totalNet || 0;
    });
    return Object.entries(m).sort((a, b) => b[1].total - a[1].total);
  }, [fSales]);

  const entryTotals = useMemo(() => {
    const paid = fEntries.filter(e => e.status === 'paid').reduce((s, e) => s + e.amount, 0);
    const pending = fEntries.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0);
    const byCategory: Record<string, number> = {};
    fEntries.filter(e => e.status !== 'cancelled').forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.amount;
    });
    return { paid, pending, total: paid + pending, byCategory };
  }, [fEntries]);

  // Daily Online-vs-Cash spend, zero-filled across the period (cancelled excluded)
  const entriesTrend = useMemo(() => {
    const byDate = new Map(listDates(start, end).map(d => [d, { date: d, online: 0, cash: 0 }]));
    fEntries.forEach(e => {
      if (e.status === 'cancelled') return;
      const d = byDate.get(e.date);
      if (!d) return;
      if (e.type === 'purchase') d.online += e.amount; else d.cash += e.amount;
    });
    return Array.from(byDate.values());
  }, [fEntries, start, end]);

  // Top categories by spend share; everything past 8 folds into "Other"
  const categoryShare = useMemo(() => {
    const sorted = (Object.entries(entryTotals.byCategory) as [string, number][]).sort((a, b) => b[1] - a[1]);
    const rows = sorted.slice(0, 8).map(([name, amt]) => ({ name, amt }));
    const rest = sorted.slice(8);
    if (rest.length > 0) rows.push({ name: `OTHER (${rest.length} more)`, amt: rest.reduce((s, [, v]) => s + v, 0) });
    const total = entryTotals.total || 1;
    return rows.map(r => ({ ...r, pct: (r.amt / total) * 100 }));
  }, [entryTotals]);

  const categoryOptions = useMemo(() =>
    (Object.entries(entryTotals.byCategory) as [string, number][]).sort((a, b) => b[1] - a[1]).map(([c]) => c),
  [entryTotals]);

  // Daily spend for the selected category (or everything), zero-filled
  const categoryTrend = useMemo(() => {
    const byDate = new Map(listDates(start, end).map(d => [d, { date: d, amount: 0 }]));
    fEntries.forEach(e => {
      if (e.status === 'cancelled') return;
      if (trendCategory !== 'all' && e.category !== trendCategory) return;
      const d = byDate.get(e.date);
      if (d) d.amount += e.amount;
    });
    return Array.from(byDate.values());
  }, [fEntries, trendCategory, start, end]);

  // Don't keep a category selected once the filters exclude it entirely
  useEffect(() => {
    if (trendCategory !== 'all' && !categoryOptions.includes(trendCategory)) setTrendCategory('all');
  }, [categoryOptions, trendCategory]);

  useEffect(() => {
    if (filterCategory !== 'all' && !entryCategoryOptions.includes(filterCategory)) setFilterCategory('all');
  }, [entryCategoryOptions, filterCategory]);

  const transferTotal = useMemo(() => fTransfers.reduce((s, t) => s + t.amount, 0), [fTransfers]);

  // Daily 10K transfer amount, zero-filled across the period
  const transferTrend = useMemo(() => {
    const byDate = new Map(listDates(start, end).map(d => [d, { date: d, amount: 0 }]));
    fTransfers.forEach(t => {
      const d = byDate.get(t.date);
      if (d) d.amount += t.amount;
    });
    return Array.from(byDate.values());
  }, [fTransfers, start, end]);

  const wasteTotals = useMemo(() => fWasteRows.reduce((s, r) => ({
    cost: s.cost + r.total,
    broken: s.broken + (r.type === 'Broken' ? r.total : 0),
    extra: s.extra + (r.type === 'Extra demand' ? r.total : 0),
  }), { cost: 0, broken: 0, extra: 0 }), [fWasteRows]);

  // Daily waste cost split by type, zero-filled across the period
  const wasteTrend = useMemo(() => {
    const byDate = new Map(listDates(start, end).map(d => [d, { date: d, broken: 0, extra: 0 }]));
    fWasteRows.forEach(r => {
      const d = byDate.get(r.date);
      if (!d) return;
      if (r.type === 'Broken') d.broken += r.total; else d.extra += r.total;
    });
    return Array.from(byDate.values());
  }, [fWasteRows, start, end]);

  // Top wasted items by cost; everything past 8 folds into "Other"
  const wasteByItem = useMemo(() => {
    const m: Record<string, number> = {};
    fWasteRows.forEach(r => { m[r.item] = (m[r.item] || 0) + r.total; });
    const sorted = Object.entries(m).sort((a, b) => b[1] - a[1]);
    const rows = sorted.slice(0, 8).map(([name, amt]) => ({ name, amt }));
    const rest = sorted.slice(8);
    if (rest.length > 0) rows.push({ name: `OTHER (${rest.length} more)`, amt: rest.reduce((s, [, v]) => s + v, 0) });
    const total = wasteTotals.cost || 1;
    return rows.map(r => ({ ...r, pct: (r.amt / total) * 100 }));
  }, [fWasteRows, wasteTotals.cost]);

  // ── Export rows per tab ─────────────────────────────────────────────
  const metaLines = [
    `Period: ${rangeLabel}   ·   Store: ${storeLabel}   ·   Generated: ${fileStamp}`,
  ];

  const SALES_HEADERS = ['Date', 'Store', 'Cash', 'Card', 'UPI', 'Total', 'Submitted By', 'Notes'];
  const salesRows = () => fSales.map(l => [l.date, getOutletName(l.outletId), l.cash, l.card, l.upi, l.totalNet, l.submittedBy || '', l.notes || '']);

  const ENTRY_HEADERS = ['Date', 'Bill No', 'Store', 'Type', 'Paid From', 'Category', 'Description', 'Vendor', 'Submitted By', 'Status', 'Qty', 'Price/Unit', 'Amount'];
  const entryRows = () => fEntries.map(e => [
    e.date, e.billNumber || '', getOutletName(e.outletId),
    e.type === 'purchase' ? 'Online' : 'Cash',
    e.type === 'expense' ? (e.paidFrom === '10k' ? '10K Vault' : 'Counter') : '',
    e.category, e.description || '', e.vendorName || '', e.userName || '', e.status || 'paid',
    e.quantity != null ? e.quantity : '', e.pricePerUnit != null ? e.pricePerUnit : '', e.amount,
  ]);

  const TRANSFER_HEADERS = ['Date', 'Store', 'Description', 'Reference', 'Amount'];
  const transferRows = () => fTransfers.map(t => [t.date, getOutletName(accountOutlet(t.bankAccountId)), t.description, t.referenceNo || '', t.amount]);

  const WASTE_HEADERS = ['Date', 'Store', 'Item', 'Serving', 'Waste Type', 'Qty', 'Cost/Unit', 'Total Cost', 'Submitted By'];
  const wasteRows = () => fWasteRows.map(r => [r.date, getOutletName(r.outletId), r.item, r.serving, r.type, r.qty, r.costPerUnit, r.total, r.submittedBy]);

  const PRODUCT_HEADERS = ['Category', 'Product', 'Price/Unit', 'Unit'];
  const productRows = () => products.map(p => [p.category, p.name, p.pricePerUnit != null ? p.pricePerUnit : '', p.unit || '']);

  const VENDOR_HEADERS = ['Vendor', 'Phone', 'GST', 'Email', 'Address'];
  const vendorRows = () => vendors.map(v => [v.name, v.phone || '', v.gst || '', v.email || '', v.address || '']);

  const handleExport = (kind: 'csv' | 'excel' | 'pdf', section?: 'products' | 'vendors') => {
    let title = '', headers: string[] = [], rows: (string | number)[][] = [], filename = '', right: number[] = [], extraMeta: string[] = [];
    if (activeTab === 'sales') {
      title = 'Sales Report'; headers = SALES_HEADERS; rows = salesRows(); filename = `sales-report_${fileStamp}`; right = [2, 3, 4, 5];
      extraMeta = [`Cash: INR ${salesTotals.cash.toLocaleString('en-IN')}   ·   Card: INR ${salesTotals.card.toLocaleString('en-IN')}   ·   UPI: INR ${salesTotals.upi.toLocaleString('en-IN')}   ·   Total: INR ${salesTotals.total.toLocaleString('en-IN')}`];
    } else if (activeTab === 'entries') {
      title = 'Purchases & Expenses Report'; headers = ENTRY_HEADERS; rows = entryRows(); filename = `purchases-expenses_${fileStamp}`; right = [10, 11, 12];
      extraMeta = [`Paid: INR ${entryTotals.paid.toLocaleString('en-IN')}   ·   Pending: INR ${entryTotals.pending.toLocaleString('en-IN')}   ·   Total: INR ${entryTotals.total.toLocaleString('en-IN')}`];
    } else if (activeTab === 'transfers') {
      title = '10K Transfers Report'; headers = TRANSFER_HEADERS; rows = transferRows(); filename = `10k-transfers_${fileStamp}`; right = [4];
      extraMeta = [`Total transferred: INR ${transferTotal.toLocaleString('en-IN')}   ·   Transfers: ${fTransfers.length}`];
    } else if (activeTab === 'waste') {
      title = 'Waste Report'; headers = WASTE_HEADERS; rows = wasteRows(); filename = `waste-report_${fileStamp}`; right = [5, 6, 7];
      extraMeta = [`Total cost: INR ${wasteTotals.cost.toLocaleString('en-IN')}   ·   Broken: INR ${wasteTotals.broken.toLocaleString('en-IN')}   ·   Extra demand: INR ${wasteTotals.extra.toLocaleString('en-IN')}`];
    } else if (activeTab === 'catalog') {
      if (section === 'vendors') {
        title = 'Vendors'; headers = VENDOR_HEADERS; rows = vendorRows(); filename = `vendors_${fileStamp}`;
        extraMeta = [`Vendors: ${vendors.length}`];
      } else {
        title = 'Products'; headers = PRODUCT_HEADERS; rows = productRows(); filename = `products_${fileStamp}`; right = [2];
        extraMeta = [`Products: ${products.length}`];
      }
    }
    const meta = activeTab === 'catalog' ? [`Generated: ${fileStamp}`, ...extraMeta] : [...metaLines, ...extraMeta];
    if (kind === 'csv') downloadCsv(headers, rows, filename);
    else if (kind === 'excel') downloadXlsx(headers, rows, filename, title).catch(err => { console.error('[Reports] xlsx failed:', err); alert('Excel export failed.'); });
    else downloadPdf(title, meta, headers, rows, filename, right);
  };

  // ── Small render helpers ────────────────────────────────────────────
  const Tile = ({ label, value, tone = 'text-slate-900' }: { label: string; value: string; tone?: string }) => (
    <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl px-4 py-3 text-center">
      <p className="text-[10px] font-semibold text-slate-500 mb-1">{label}</p>
      <p className={`text-sm font-bold tracking-tight ${tone}`}>{value}</p>
    </div>
  );

  const ExportButtons = ({ section }: { section?: 'products' | 'vendors' }) => {
    const empty =
      activeTab === 'sales' ? fSales.length === 0
      : activeTab === 'entries' ? fEntries.length === 0
      : activeTab === 'transfers' ? fTransfers.length === 0
      : activeTab === 'waste' ? fWasteRows.length === 0
      : section === 'vendors' ? vendors.length === 0 : products.length === 0;
    return (
      <div className="flex gap-2">
        <button
          onClick={() => handleExport('csv', section)}
          disabled={empty || loading}
          className="h-9 px-3.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 active:scale-95 transition-all"
        >
          <FileDown size={14} /> CSV
        </button>
        <button
          onClick={() => handleExport('excel', section)}
          disabled={empty || loading}
          className="h-9 px-3.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 active:scale-95 transition-all"
        >
          <FileSpreadsheet size={14} /> Excel
        </button>
        <button
          onClick={() => handleExport('pdf', section)}
          disabled={empty || loading}
          className="h-9 px-3.5 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-xl text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 active:scale-95 transition-all"
        >
          <FileDown size={14} /> PDF
        </button>
      </div>
    );
  };

  // Money columns are numbers in export rows; qty must stay a plain number on screen
  const displayRows = (rows: (string | number)[][], plainNumberCols: number[] = []) =>
    rows.map(r => r.map((c, i) => (plainNumberCols.includes(i) && typeof c === 'number') ? String(c) : c));

  return (
    <div className="space-y-4 px-1 pt-2 animate-in slide-in-from-right duration-300">
      {/* Top bar */}
      <div className="flex items-center gap-3 bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm px-3 py-3">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-2 h-11 px-4 bg-slate-100 hover:bg-slate-200 active:scale-95 rounded-xl text-slate-600 transition-all text-sm font-semibold shrink-0"
          >
            <ArrowLeft size={18} /> Home
          </button>
        )}
        <h2 className="flex-1 text-center text-sm font-bold text-slate-800 truncate flex items-center justify-center gap-2 py-2">
          <BarChart3 size={16} className="text-indigo-500" /> Reports
        </h2>
        {onBack && <div className="w-[92px] shrink-0" />}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`h-10 px-4 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-all active:scale-95 shrink-0 ${activeTab === t.id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white ring-1 ring-slate-100 text-slate-500 hover:text-slate-700'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar (date + store) — not relevant for Catalog */}
      {activeTab !== 'catalog' && (
        <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-4 space-y-3.5">
          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {(['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month', 'custom'] as DatePreset[]).map(p => (
              <button
                key={p}
                onClick={() => setDatePreset(p)}
                className={`h-9 px-4 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-all active:scale-95 shrink-0 ${datePreset === p ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:text-slate-700'}`}
              >
                {p.replace('-', ' ')}
              </button>
            ))}
          </div>
          {datePreset === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1 ml-0.5">From</label>
                <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-3.5 text-sm font-medium text-slate-700 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1 ml-0.5">To</label>
                <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-3.5 text-sm font-medium text-slate-700 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all" />
              </div>
            </div>
          )}
          <div className="relative">
            <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
            <select
              value={filterOutlet}
              onChange={e => setFilterOutlet(e.target.value)}
              className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none pl-10 pr-8 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
            >
              <option value="all">All stores</option>
              {activeOutlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
          </div>
          {activeTab === 'entries' && (
            <>
              <div className="relative">
                <ArrowRightLeft className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                <select
                  value={filterType}
                  onChange={e => setFilterType(e.target.value as 'all' | 'purchase' | 'expense')}
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none pl-10 pr-8 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                >
                  <option value="all">All types</option>
                  <option value="purchase">Purchase (Online)</option>
                  <option value="expense">Expense (Cash)</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
              </div>
              <div className="relative">
                <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none pl-10 pr-8 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                >
                  <option value="all">All categories</option>
                  {entryCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
              </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={36} /></div>
      ) : activeTab === 'sales' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Tile label="Cash" value={`₹${salesTotals.cash.toLocaleString('en-IN')}`} tone="text-emerald-600" />
            <Tile label="Card" value={`₹${salesTotals.card.toLocaleString('en-IN')}`} tone="text-indigo-600" />
            <Tile label="UPI" value={`₹${salesTotals.upi.toLocaleString('en-IN')}`} tone="text-amber-600" />
            <Tile label="Total" value={`₹${salesTotals.total.toLocaleString('en-IN')}`} />
          </div>

          {/* View toggle + exports */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
              {([['charts', BarChart3, 'Charts'], ['table', Table2, 'Table']] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setSalesView(v)}
                  className={`h-9 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 ${salesView === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            <div className="ml-auto"><ExportButtons /></div>
          </div>

          {salesView === 'charts' && (
            fSales.length === 0
              ? <p className="py-16 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No sales logs in this period</p>
              : (
                <div className="grid md:grid-cols-5 gap-3">
                  {/* Payment mix donut */}
                  <div className="md:col-span-2 bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Payment mix</p>
                    <div className="relative">
                      <ResponsiveContainer width="100%" height={210}>
                        <PieChart>
                          <Pie
                            data={CHANNELS.map(k => ({ key: k, name: CHANNEL_LABELS[k], value: salesTotals[k] })).filter(d => d.value > 0)}
                            dataKey="value" nameKey="name"
                            innerRadius={62} outerRadius={92}
                            paddingAngle={2} stroke="#ffffff" strokeWidth={2}
                          >
                            {CHANNELS.map(k => salesTotals[k] > 0 && <Cell key={k} fill={CHANNEL_COLORS[k]} />)}
                          </Pie>
                          <ChartTooltip formatter={(v: any, n: any) => [inr(Number(v)), n]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Total</p>
                        <p className="text-base font-bold text-slate-900">{inrCompact(salesTotals.total)}</p>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {CHANNELS.map(k => (
                        <div key={k} className="flex items-center gap-2 text-xs">
                          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: CHANNEL_COLORS[k] }} />
                          <span className="font-semibold text-slate-700">{CHANNEL_LABELS[k]}</span>
                          <span className="ml-auto text-slate-500">{inr(salesTotals[k])}</span>
                          <span className="w-12 text-right text-slate-400">
                            {salesTotals.total > 0 ? `${((salesTotals[k] / salesTotals.total) * 100).toFixed(1)}%` : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Daily trend lines */}
                  <div className="md:col-span-3 bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Daily trend</p>
                      {channelTrends && (
                        <div className="ml-auto flex flex-wrap gap-1.5">
                          {channelTrends.map(({ k, pct }) => {
                            const Dir = Math.abs(pct) < 3 ? Minus : pct > 0 ? TrendingUp : TrendingDown;
                            const dirColor = Math.abs(pct) < 3 ? 'text-slate-400' : pct > 0 ? 'text-emerald-600' : 'text-rose-600';
                            return (
                              <span key={k} className="flex items-center gap-1 px-2 py-1 bg-slate-50 border border-slate-100 rounded-lg text-[10px] font-semibold text-slate-600">
                                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: CHANNEL_COLORS[k] }} />
                                {CHANNEL_LABELS[k]}
                                <Dir size={11} className={dirColor} />
                                <span className={dirColor}>{Math.abs(pct) < 3 ? 'flat' : `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`}</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {salesTrend.length < 2 ? (
                      <p className="h-[230px] flex items-center justify-center text-xs text-slate-400">Not enough days in this period to draw a trend — pick a wider range</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={salesTrend} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickFormatter={(d: string) => { const [, m, dd] = d.split('-'); return `${parseInt(dd)} ${MONTH_NAMES[parseInt(m) - 1].slice(0, 3)}`; }}
                            tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} minTickGap={28}
                          />
                          <YAxis tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={54} />
                          <ChartTooltip
                            formatter={(v: any, n: any) => [inr(Number(v)), n]}
                            labelFormatter={(d: any) => String(d)}
                            contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                          />
                          <ChartLegend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                          <Line type="monotone" dataKey="cash" name="Cash" stroke={CHANNEL_COLORS.cash} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                          <Line type="monotone" dataKey="card" name="Card" stroke={CHANNEL_COLORS.card} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                          <Line type="monotone" dataKey="upi" name="UPI" stroke={CHANNEL_COLORS.upi} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )
          )}

          {/* Side-by-side store comparison — shown when viewing all stores */}
          {salesView === 'table' && filterOutlet === 'all' && salesByStore.length > 1 && (
            <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">By store</p>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs min-w-[520px]">
                  <thead>
                    <tr className="border-b border-slate-100">
                      {['Store', 'Cash', 'Card', 'UPI', 'Total'].map((h, i) => (
                        <th key={h} className={`px-2 py-2 font-semibold text-slate-500 ${i > 0 ? 'text-right' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {salesByStore.map(([oid, s]) => (
                      <tr key={oid} className="border-b border-slate-50 last:border-0">
                        <td className="px-2 py-2 font-semibold text-slate-700">{getOutletName(oid)}</td>
                        <td className="px-2 py-2 text-right text-emerald-600 font-semibold">₹{s.cash.toLocaleString('en-IN')}</td>
                        <td className="px-2 py-2 text-right text-indigo-600 font-semibold">₹{s.card.toLocaleString('en-IN')}</td>
                        <td className="px-2 py-2 text-right text-amber-600 font-semibold">₹{s.upi.toLocaleString('en-IN')}</td>
                        <td className="px-2 py-2 text-right font-bold text-slate-900">₹{s.total.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {salesView === 'table' && (
            fSales.length === 0
              ? <p className="py-16 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No sales logs in this period</p>
              : <DataTable headers={SALES_HEADERS} rows={salesRows()} rightCols={[2, 3, 4, 5]} />
          )}
        </div>
      ) : activeTab === 'entries' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Paid" value={`₹${entryTotals.paid.toLocaleString('en-IN')}`} tone="text-emerald-600" />
            <Tile label="Pending" value={`₹${entryTotals.pending.toLocaleString('en-IN')}`} tone="text-amber-600" />
            <Tile label="Total" value={`₹${entryTotals.total.toLocaleString('en-IN')}`} />
          </div>
          {/* View toggle + exports */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
              {([['charts', BarChart3, 'Charts'], ['table', Table2, 'Table']] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setEntriesView(v)}
                  className={`h-9 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 ${entriesView === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            <div className="ml-auto"><ExportButtons /></div>
          </div>

          {entriesView === 'charts' && (
            fEntries.length === 0
              ? <p className="py-16 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No entries in this period</p>
              : (
                <div className="space-y-3">
                  <div className="grid md:grid-cols-2 gap-3">
                    {/* Online vs Cash daily trend */}
                    <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Spend trend</p>
                        <div className="ml-auto flex flex-wrap gap-1.5">
                          <TrendChip label="Online" swatch={SPEND_COLORS.online} pct={halfOverHalf(entriesTrend.map(r => r.online))} />
                          <TrendChip label="Cash" swatch={SPEND_COLORS.cash} pct={halfOverHalf(entriesTrend.map(r => r.cash))} />
                        </div>
                      </div>
                      {entriesTrend.length < 2 ? (
                        <p className="h-[230px] flex items-center justify-center text-xs text-slate-400">Pick a wider range to see a trend</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={240}>
                          <LineChart data={entriesTrend} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} minTickGap={28} />
                            <YAxis tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={54} />
                            <ChartTooltip formatter={(v: any, n: any) => [inr(Number(v)), n]} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                            <ChartLegend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                            <Line type="monotone" dataKey="online" name="Online" stroke={SPEND_COLORS.online} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                            <Line type="monotone" dataKey="cash" name="Cash" stroke={SPEND_COLORS.cash} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* Category share — ranked, top 8 + Other */}
                    <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Category share of spend</p>
                      <ResponsiveContainer width="100%" height={Math.max(220, categoryShare.length * 30 + 30)}>
                        <BarChart data={categoryShare} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 8 }}>
                          <XAxis type="number" hide />
                          <YAxis
                            type="category" dataKey="name" width={140}
                            tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false}
                            tickFormatter={(n: string) => n.length > 20 ? n.slice(0, 19) + '…' : n}
                          />
                          <ChartTooltip formatter={(v: any) => inr(Number(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                          <Bar dataKey="amt" name="Spend" fill={SPEND_COLORS.online} radius={[0, 4, 4, 0]} barSize={16}>
                            <LabelList dataKey="pct" position="right" formatter={(p: any) => `${Number(p).toFixed(1)}%`} style={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Single-category trend with selector */}
                  <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Category trend</p>
                      <div className="relative ml-2">
                        <select
                          value={trendCategory}
                          onChange={e => setTrendCategory(e.target.value)}
                          className="h-8 bg-slate-50 border border-slate-200 focus:border-indigo-400 outline-none pl-3 pr-8 rounded-lg text-xs font-semibold text-slate-700 appearance-none transition-all"
                        >
                          <option value="all">All categories</option>
                          {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={13} />
                      </div>
                      <div className="ml-auto">
                        <TrendChip
                          label={trendCategory === 'all' ? 'Total' : trendCategory.length > 18 ? trendCategory.slice(0, 17) + '…' : trendCategory}
                          pct={halfOverHalf(categoryTrend.map(r => r.amount))}
                        />
                      </div>
                    </div>
                    {categoryTrend.length < 2 ? (
                      <p className="h-[210px] flex items-center justify-center text-xs text-slate-400">Pick a wider range to see a trend</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={categoryTrend} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} minTickGap={28} />
                          <YAxis tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={54} />
                          <ChartTooltip formatter={(v: any) => [inr(Number(v)), trendCategory === 'all' ? 'Spend' : trendCategory]} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                          <Line type="monotone" dataKey="amount" name={trendCategory === 'all' ? 'Spend' : trendCategory} stroke={SPEND_COLORS.online} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )
          )}

          {entriesView === 'table' && Object.keys(entryTotals.byCategory).length > 0 && (
            <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2.5">By category</p>
              <div className="flex flex-wrap gap-2">
                {(Object.entries(entryTotals.byCategory) as [string, number][]).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
                  <span key={cat} className="px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-lg text-xs">
                    <span className="font-semibold text-slate-700">{cat}</span>
                    <span className="text-slate-400 ml-1.5">₹{amt.toLocaleString('en-IN')}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {entriesView === 'table' && (
            fEntries.length === 0
              ? <p className="py-16 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No entries in this period</p>
              : <DataTable headers={ENTRY_HEADERS} rows={displayRows(entryRows(), [10])} rightCols={[10, 11, 12]} minWidth={1050} />
          )}
        </div>
      ) : activeTab === 'transfers' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Total moved to safe" value={`₹${transferTotal.toLocaleString('en-IN')}`} tone="text-amber-600" />
            <Tile label="Transfers" value={String(fTransfers.length)} />
          </div>
          {/* View toggle + exports */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
              {([['charts', BarChart3, 'Charts'], ['table', Table2, 'Table']] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setTransfersView(v)}
                  className={`h-9 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 ${transfersView === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            <div className="ml-auto"><ExportButtons /></div>
          </div>

          {transfersView === 'charts' && (
            fTransfers.length === 0
              ? <p className="py-16 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No 10K transfers in this period</p>
              : (
                <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Daily transfers to safe</p>
                    <div className="ml-auto"><TrendChip label="Transfers" swatch={TRANSFER_COLOR} pct={halfOverHalf(transferTrend.map(r => r.amount))} /></div>
                  </div>
                  {transferTrend.length < 2 ? (
                    <p className="h-[230px] flex items-center justify-center text-xs text-slate-400">Pick a wider range to see a trend</p>
                  ) : (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={transferTrend} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} minTickGap={24} />
                        <YAxis tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={54} />
                        <ChartTooltip formatter={(v: any) => [inr(Number(v)), 'Transferred']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                        <Bar dataKey="amount" name="Transferred" fill={TRANSFER_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              )
          )}

          {transfersView === 'table' && (
            fTransfers.length === 0
              ? <p className="py-16 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No 10K transfers in this period</p>
              : <DataTable headers={TRANSFER_HEADERS} rows={transferRows()} rightCols={[4]} minWidth={700} />
          )}
        </div>
      ) : activeTab === 'waste' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Total waste cost" value={`₹${wasteTotals.cost.toLocaleString('en-IN')}`} tone="text-rose-600" />
            <Tile label="Broken" value={`₹${wasteTotals.broken.toLocaleString('en-IN')}`} />
            <Tile label="Extra demand" value={`₹${wasteTotals.extra.toLocaleString('en-IN')}`} />
          </div>
          {/* View toggle + exports */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
              {([['charts', BarChart3, 'Charts'], ['table', Table2, 'Table']] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setWasteView(v)}
                  className={`h-9 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 ${wasteView === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
            <div className="ml-auto"><ExportButtons /></div>
          </div>

          {wasteView === 'charts' && (
            fWasteRows.length === 0
              ? <p className="py-16 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No waste recorded in this period</p>
              : (
                <div className="space-y-3">
                  <div className="grid md:grid-cols-2 gap-3">
                    {/* Waste type mix donut */}
                    <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Waste by type</p>
                      <div className="relative">
                        <ResponsiveContainer width="100%" height={200}>
                          <PieChart>
                            <Pie
                              data={[{ name: 'Broken', value: wasteTotals.broken, c: WASTE_COLORS.broken }, { name: 'Extra demand', value: wasteTotals.extra, c: WASTE_COLORS.extra }].filter(d => d.value > 0)}
                              dataKey="value" nameKey="name" innerRadius={56} outerRadius={84} paddingAngle={2} stroke="#ffffff" strokeWidth={2}
                            >
                              {[{ name: 'Broken', value: wasteTotals.broken, c: WASTE_COLORS.broken }, { name: 'Extra demand', value: wasteTotals.extra, c: WASTE_COLORS.extra }].filter(d => d.value > 0).map(d => <Cell key={d.name} fill={d.c} />)}
                            </Pie>
                            <ChartTooltip formatter={(v: any, n: any) => [inr(Number(v)), n]} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                          <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest">Total</p>
                          <p className="text-base font-bold text-slate-900">{inrCompact(wasteTotals.cost)}</p>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {([['Broken', wasteTotals.broken, WASTE_COLORS.broken], ['Extra demand', wasteTotals.extra, WASTE_COLORS.extra]] as const).map(([label, amt, c]) => (
                          <div key={label} className="flex items-center gap-2 text-xs">
                            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: c }} />
                            <span className="font-semibold text-slate-700">{label}</span>
                            <span className="ml-auto text-slate-500">{inr(amt)}</span>
                            <span className="w-12 text-right text-slate-400">{wasteTotals.cost > 0 ? `${((amt / wasteTotals.cost) * 100).toFixed(1)}%` : '—'}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Top wasted items */}
                    <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Top wasted items</p>
                      <ResponsiveContainer width="100%" height={Math.max(200, wasteByItem.length * 30 + 30)}>
                        <BarChart data={wasteByItem} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 8 }}>
                          <XAxis type="number" hide />
                          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} tickFormatter={(n: string) => n.length > 18 ? n.slice(0, 17) + '…' : n} />
                          <ChartTooltip formatter={(v: any) => inr(Number(v))} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                          <Bar dataKey="amt" name="Waste cost" fill={WASTE_COLORS.broken} radius={[0, 4, 4, 0]} barSize={16}>
                            <LabelList dataKey="pct" position="right" formatter={(p: any) => `${Number(p).toFixed(1)}%`} style={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Daily waste trend, split by type */}
                  <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl p-4">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Daily waste cost</p>
                    {wasteTrend.length < 2 ? (
                      <p className="h-[210px] flex items-center justify-center text-xs text-slate-400">Pick a wider range to see a trend</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={230}>
                        <LineChart data={wasteTrend} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} minTickGap={28} />
                          <YAxis tickFormatter={(v: number) => inrCompact(v)} tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={54} />
                          <ChartTooltip formatter={(v: any, n: any) => [inr(Number(v)), n]} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
                          <ChartLegend wrapperStyle={{ fontSize: 11 }} iconType="plainline" />
                          <Line type="monotone" dataKey="broken" name="Broken" stroke={WASTE_COLORS.broken} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                          <Line type="monotone" dataKey="extra" name="Extra demand" stroke={WASTE_COLORS.extra} strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 5 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              )
          )}

          {wasteView === 'table' && (
            fWasteRows.length === 0
              ? <p className="py-16 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No waste recorded in this period</p>
              : <DataTable headers={WASTE_HEADERS} rows={displayRows(wasteRows(), [5])} rightCols={[5, 6, 7]} minWidth={950} />
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Tile label="Products" value={String(products.length)} tone="text-indigo-600" />
            <Tile label="Vendors" value={String(vendors.length)} tone="text-emerald-600" />
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700 flex items-center gap-2"><Package size={16} className="text-indigo-500" /> Products</p>
              <ExportButtons section="products" />
            </div>
            {products.length === 0
              ? <p className="py-10 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No products yet</p>
              : <DataTable headers={PRODUCT_HEADERS} rows={productRows()} rightCols={[2]} minWidth={600} />}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-700 flex items-center gap-2"><Store size={16} className="text-emerald-500" /> Vendors</p>
              <ExportButtons section="vendors" />
            </div>
            {vendors.length === 0
              ? <p className="py-10 text-center text-sm text-slate-400 bg-white border-2 border-dashed border-slate-200 rounded-2xl">No vendors yet</p>
              : <DataTable headers={VENDOR_HEADERS} rows={vendorRows()} minWidth={750} />}
          </div>
        </div>
      )}
    </div>
  );
};

export default CrewReports;
