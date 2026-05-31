
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import {
  WasteEntry,
  WasteLineItem,
  WasteType,
  MASTER_OUTLETS,
  getOutletName,
  MONTH_NAMES,
  YEAR_OPTIONS,
} from '../types';
import {
  Trash2,
  RefreshCw,
  MapPin,
  CalendarDays,
  ChevronDown,
  Loader2,
  SearchX,
  TrendingDown,
  Package,
  AlertTriangle,
  IndianRupee,
  ChevronRight,
  X,
  Filter,
  BarChart2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
  ComposedChart,
} from 'recharts';

interface Props {
  user: User;
  dataOwnerId: string;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const WasteHub: React.FC<Props> = ({ user, dataOwnerId }) => {
  const [entries, setEntries] = useState<WasteEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const now = new Date();
  const [filterYear, setFilterYear] = useState(String(now.getFullYear()));
  const [filterMonth, setFilterMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [filterOutlet, setFilterOutlet] = useState('all');
  const [filterType, setFilterType] = useState<'all' | WasteType>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchEntries = async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const snap = await getDocs(
        query(collection(db, 'waste_entries'), where('ownerId', '==', dataOwnerId))
      );
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as WasteEntry)));
    } catch (err: any) {
      console.error('WasteHub fetch error:', err);
      setFetchError(err?.message || 'Failed to load entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEntries(); }, [dataOwnerId]);

  const filtered = useMemo(() => {
    const monthStr = `${filterYear}-${filterMonth}`;
    return entries.filter(e => {
      if (!e.date.startsWith(monthStr)) return false;
      if (filterOutlet !== 'all' && e.outletId !== filterOutlet) return false;
      if (filterType !== 'all' && !e.items.some(i => i.wasteType === filterType)) return false;
      return true;
    });
  }, [entries, filterYear, filterMonth, filterOutlet, filterType]);

  // Summary metrics
  // BUG-07 fix: when a type filter is active, only sum costs of matching items (not all items in the entry)
  const totalCost = useMemo(() => filtered.reduce((s, e) => s + e.items.filter(i => filterType === 'all' || i.wasteType === filterType).reduce((a, i) => a + i.totalCost, 0), 0), [filtered, filterType]);
  const extraDemandCost = useMemo(() =>
    filtered.reduce((s, e) => s + e.items.filter(i => i.wasteType === 'extra_demand').reduce((a, i) => a + i.totalCost, 0), 0),
    [filtered]
  );
  const brokenCost = useMemo(() =>
    filtered.reduce((s, e) => s + e.items.filter(i => i.wasteType === 'broken').reduce((a, i) => a + i.totalCost, 0), 0),
    [filtered]
  );

  // Category breakdown: group by item name — tracks both cost and quantity
  const categoryBreakdown = useMemo(() => {
    const map: Record<string, {
      extra_demand: number; broken: number; total: number;
      extra_demand_qty: number; broken_qty: number; total_qty: number;
    }> = {};
    filtered.forEach(e => e.items.forEach(item => {
      const key = item.itemName || item.servingOptionName;
      if (!map[key]) map[key] = { extra_demand: 0, broken: 0, total: 0, extra_demand_qty: 0, broken_qty: 0, total_qty: 0 };
      map[key][item.wasteType] += item.totalCost;
      map[key].total += item.totalCost;
      map[key][`${item.wasteType}_qty` as 'extra_demand_qty' | 'broken_qty'] += item.quantity;
      map[key].total_qty += item.quantity;
    }));
    return Object.entries(map)
      .map(([name, vals]) => ({ name, ...vals }))
      .sort((a, b) => b.total - a.total);
  }, [filtered]);

  // Daily trend within the month
  const dailyTrend = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(e => {
      const day = e.date.slice(8); // DD
      map[day] = (map[day] || 0) + e.totalCost;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, cost]) => ({ day: parseInt(day), cost: parseFloat(cost.toFixed(2)) }));
  }, [filtered]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this waste entry?')) return;
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, 'waste_entries', id));
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.error('Delete waste error:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-rose-100 rounded-2xl">
            <Trash2 size={22} className="text-rose-600" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Waste Hub</h2>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Serving material waste tracker</p>
          </div>
        </div>
        <button onClick={fetchEntries} className="flex items-center gap-2 h-10 px-5 bg-slate-100 text-slate-600 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-100 rounded-3xl p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-slate-400 shrink-0">
            <Filter size={14} />
            <span className="text-[10px] font-black uppercase tracking-widest">Filters</span>
          </div>

          {/* Year */}
          <div className="relative">
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
              className="h-10 pl-4 pr-8 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black text-slate-700 appearance-none outline-none focus:border-rose-400 transition-all uppercase"
            >
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
          </div>

          {/* Month */}
          <div className="relative">
            <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
              className="h-10 pl-4 pr-8 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black text-slate-700 appearance-none outline-none focus:border-rose-400 transition-all uppercase"
            >
              {MONTH_NAMES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
          </div>

          {/* Outlet */}
          <div className="relative">
            <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
            <select value={filterOutlet} onChange={e => setFilterOutlet(e.target.value)}
              className="h-10 pl-8 pr-8 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black text-slate-700 appearance-none outline-none focus:border-rose-400 transition-all uppercase"
            >
              <option value="all">All Outlets</option>
              {MASTER_OUTLETS.filter(o => o.id !== 'GLOBAL').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
          </div>

          {/* Waste type */}
          <div className="flex bg-slate-50 border border-slate-200 p-1 rounded-2xl gap-1">
            {(['all', 'extra_demand', 'broken'] as const).map(t => (
              <button key={t} onClick={() => setFilterType(t)}
                className={`h-8 px-4 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                  filterType === t
                    ? t === 'broken' ? 'bg-orange-500 text-white shadow-sm' : t === 'extra_demand' ? 'bg-rose-500 text-white shadow-sm' : 'bg-slate-700 text-white shadow-sm'
                    : 'text-slate-400'
                }`}
              >
                {t === 'all' ? 'All' : t === 'extra_demand' ? 'Extra Demand' : 'Broken'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Waste Cost</p>
          <p className="text-3xl font-black text-slate-900 tracking-tighter">₹{fmt(totalCost)}</p>
          <p className="text-[10px] font-bold text-slate-400 mt-1">{filtered.length} entr{filtered.length !== 1 ? 'ies' : 'y'}</p>
        </div>
        <div className="bg-rose-50 border border-rose-100 rounded-3xl p-6">
          <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2">Extra Demand</p>
          <p className="text-3xl font-black text-rose-700 tracking-tighter">₹{fmt(extraDemandCost)}</p>
          <p className="text-[10px] font-bold text-rose-400 mt-1">
            {totalCost > 0 ? ((extraDemandCost / totalCost) * 100).toFixed(1) : '0'}% of waste
          </p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-3xl p-6">
          <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-2">Broken / Damaged</p>
          <p className="text-3xl font-black text-orange-700 tracking-tighter">₹{fmt(brokenCost)}</p>
          <p className="text-[10px] font-bold text-orange-400 mt-1">
            {totalCost > 0 ? ((brokenCost / totalCost) * 100).toFixed(1) : '0'}% of waste
          </p>
        </div>
      </div>

      {fetchError && (
        <div className="flex items-center gap-3 px-5 py-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm font-medium">
          <AlertTriangle size={16} className="shrink-0 text-rose-500" />
          {fetchError}
        </div>
      )}

      {filtered.length === 0 && !loading && !fetchError && (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-300">
          <SearchX size={40} />
          <p className="text-sm font-black uppercase tracking-widest">No waste entries for this period</p>
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {/* Category breakdown chart */}
          {categoryBreakdown.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <BarChart2 size={16} className="text-rose-500" />
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Waste by Item</h3>
                </div>
                <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400 inline-block" />Extra Demand ₹</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block" />Broken ₹</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-indigo-400 inline-block" />Total Qty</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={categoryBreakdown} margin={{ top: 4, right: 40, left: -10, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 9, fontWeight: 700, fill: '#475569' }}
                    interval={0}
                    angle={-30}
                    textAnchor="end"
                    height={50}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="cost"
                    tick={{ fontSize: 9, fill: '#94a3b8' }}
                    tickFormatter={v => `₹${v}`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="qty"
                    orientation="right"
                    tick={{ fontSize: 9, fill: '#818cf8' }}
                    tickFormatter={v => `${v} u`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v: number, key: string) =>
                      key === 'Total Qty' ? [`${v} units`, key] : [`₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, key]
                    }
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700 }}
                  />
                  <Bar yAxisId="cost" dataKey="extra_demand" name="Extra Demand" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={32} fillOpacity={0.85} />
                  <Bar yAxisId="cost" dataKey="broken" name="Broken" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={32} fillOpacity={0.85} />
                  <Line yAxisId="qty" type="monotone" dataKey="total_qty" name="Total Qty" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Daily trend */}
          {dailyTrend.length > 1 && (
            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <TrendingDown size={16} className="text-rose-500" />
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Daily Waste Cost — {MONTH_SHORT[parseInt(filterMonth) - 1]} {filterYear}</h3>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={dailyTrend} margin={{ top: 4, right: 4, left: -10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="day" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `₹${v}`} />
                  <Tooltip formatter={(v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`} />
                  <Line type="monotone" dataKey="cost" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Entry list */}
          <div className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">All Entries</h3>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {[...filtered].sort((a, b) => b.createdAt - a.createdAt).map(entry => {
                const extraCost = entry.items.filter(i => i.wasteType === 'extra_demand').reduce((s, i) => s + i.totalCost, 0);
                const brknCost = entry.items.filter(i => i.wasteType === 'broken').reduce((s, i) => s + i.totalCost, 0);
                const isOpen = expandedId === entry.id;
                return (
                  <div key={entry.id}>
                    <div
                      className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                      onClick={() => setExpandedId(isOpen ? null : (entry.id ?? null))}
                    >
                      <div className="p-2.5 bg-rose-100 rounded-xl shrink-0">
                        <Trash2 size={14} className="text-rose-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-black text-slate-900">{entry.date}</p>
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded-full">{getOutletName(entry.outletId)}</span>
                          <span className="text-[9px] font-bold text-slate-400">{entry.items.length} item{entry.items.length !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          {extraCost > 0 && <span className="text-[10px] font-bold text-rose-500">Demand ₹{fmt(extraCost)}</span>}
                          {brknCost > 0 && <span className="text-[10px] font-bold text-orange-500">Broken ₹{fmt(brknCost)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="text-base font-black text-slate-900">₹{fmt(entry.totalCost)}</p>
                        <button
                          onClick={e => { e.stopPropagation(); entry.id && handleDelete(entry.id); }}
                          disabled={deletingId === entry.id}
                          className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors rounded-xl disabled:opacity-50"
                        >
                          {deletingId === entry.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                        </button>
                        <ChevronRight size={14} className={`text-slate-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div className="px-6 pb-5 bg-slate-50 border-t border-slate-100">
                        <div className="pt-4 space-y-2">
                          {entry.items.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-3 bg-white border border-slate-100 rounded-2xl px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-sm font-black text-slate-900 uppercase truncate">{item.itemName || item.servingOptionName}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {item.itemName && <span className="text-[9px] font-bold text-slate-400 uppercase truncate">{item.servingOptionName}</span>}
                                  <span className="text-[10px] font-bold text-slate-500">{item.quantity} × ₹{item.costPerUnit}</span>
                                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${item.wasteType === 'broken' ? 'bg-orange-100 text-orange-600' : 'bg-rose-100 text-rose-600'}`}>
                                    {item.wasteType === 'extra_demand' ? 'Extra Demand' : 'Broken'}
                                  </span>
                                </div>
                              </div>
                              <p className="text-sm font-black text-slate-900 shrink-0">₹{fmt(item.totalCost)}</p>
                            </div>
                          ))}
                          {entry.notes && (
                            <p className="text-[11px] font-medium text-slate-500 italic px-1 pt-1">"{entry.notes}"</p>
                          )}
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-1">
                            Submitted by {entry.submittedBy} · {new Date(entry.createdAt).toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default WasteHub;
