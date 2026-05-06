
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { SalesMonthlySnapshot, StoreRental, SkuMapping, SkuCategory, getOutletName, YEAR_OPTIONS, MONTH_NAMES } from '../types';
import { 
  TrendingUp, 
  RefreshCw, 
  MapPin, 
  SearchX,
  Calculator,
  ArrowDownRight, 
  CheckCircle2,
  LineChart,
  BarChart,
  Activity,
  Store,
  Smartphone,
  Percent,
  XCircle,
  Layers,
  Dna,
  Zap,
  AlertTriangle,
  Calendar,
  ArrowRight,
  Clock,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  History,
  AlertCircle,
  Loader2,
  Ticket,
  Utensils,
  Coffee,
  Trophy,
  Target,
  CloudSun
} from 'lucide-react';
import WeatherWidget from './WeatherWidget';
import ProjectionEngine from './ProjectionEngine';

type ChartType = 'bar' | 'line' | 'dotted';
type SalesTab = 'velocity' | 'trajectory' | 'traffic-trend' | 'projections';

const OUTLET_COLORS: Record<string, string> = {
  '40543': '#6366f1', 
  '40186': '#10b981', 
  '40140': '#f59e0b', 
  'default': '#94a3b8'
};

const SalesHub: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [snapshots, setSnapshots] = useState<SalesMonthlySnapshot[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<SalesTab>('velocity');
  
  const [startMonth, setStartMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [startYear, setStartYear] = useState(new Date().getFullYear().toString());
  const [endMonth, setEndMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [endYear, setEndYear] = useState(new Date().getFullYear().toString());
  
  const [storeFilter, setStoreFilter] = useState<'all' | string>('all');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [outletChartType, setOutletChartType] = useState<ChartType>('line');
  
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number, y: number, value: number, label: string, color?: string, subLabel?: string } | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const snapQ = query(collection(db, 'sales_snapshots'), where('userId', '==', dataOwnerId));
      const rentQ = query(collection(db, 'rentals'), where('userId', '==', dataOwnerId));
      const [sSnap, rSnap] = await Promise.all([getDocs(snapQ), getDocs(rentQ)]);
      setSnapshots(sSnap.docs.map(d => ({ ...d.data(), id: d.id } as SalesMonthlySnapshot)));
      setRentals(rSnap.docs.map(d => ({ id: d.id, ...d.data() } as StoreRental)));
    } catch (err: any) {
      setError("Failed to sync intelligence suite.");
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [user]);

  const activeOutletOptions = useMemo(() => {
    const startMonthIdx = MONTH_NAMES.indexOf(startMonth);
    const startYearNum = parseInt(startYear);
    const periodStart = new Date(startYearNum, startMonthIdx, 1);
    return rentals.filter(r => {
      if (r.status === 'active') return true;
      if (r.status === 'closed' && r.closeDate) {
        return new Date(r.closeDate) >= periodStart;
      }
      return true;
    }).map(r => ({ id: r.outletId, name: r.storeName }));
  }, [rentals, startMonth, startYear]);

  const applyPreset = (months: number) => {
    const end = new Date();
    const start = new Date();
    start.setMonth(end.getMonth() - months + 1);
    setEndMonth(MONTH_NAMES[end.getMonth()]);
    setEndYear(end.getFullYear().toString());
    setStartMonth(MONTH_NAMES[start.getMonth()]);
    setStartYear(start.getFullYear().toString());
  };

  const applyLastMonth = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const m = MONTH_NAMES[d.getMonth()];
    const y = d.getFullYear().toString();
    setStartMonth(m); setStartYear(y); setEndMonth(m); setEndYear(y);
  };

  const analytics = useMemo(() => {
    const startVal = parseInt(startYear) * 12 + MONTH_NAMES.indexOf(startMonth);
    const endVal = parseInt(endYear) * 12 + MONTH_NAMES.indexOf(endMonth);
    const isInvalidRange = startVal > endVal;
    
    const totals = {
      posTotalGross: 0, posGoodGross: 0, posGoodNet: 0, posGoodTax: 0,
      onlineGoodGross: 0, onlineGoodNet: 0, onlineGoodTax: 0, onlineGoodComm: 0, onlineGoodAds: 0,
      eventRevenue: 0,
      settledOrderCount: 0, totalOrderCount: 0, cancelledOrderCount: 0,
      trendValues: [] as number[],
      labels: [] as string[],
      outletTrends: {} as Record<string, number[]>,
      hourlyIntensity: new Array(24).fill(0),
      weekdayRevenue: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<number, number>,
      dayParts: {
        morning: { id: 'morning', label: 'Morning Opener', hours: '09:00 - 12:00', revenue: 0, icon: Sunrise, color: 'text-amber-500', bg: 'bg-amber-50' },
        afternoon: { id: 'afternoon', label: 'Peak Afternoon', hours: '12:00 - 16:00', revenue: 0, icon: Sun, color: 'text-indigo-500', bg: 'bg-indigo-50' },
        evening: { id: 'evening', label: 'Evening Hi-Tea', hours: '16:00 - 20:00', revenue: 0, icon: Sunset, color: 'text-orange-500', bg: 'bg-orange-50' },
        night: { id: 'night', label: 'Late Night Surge', hours: '20:00 - 00:00', revenue: 0, icon: Moon, color: 'text-slate-500', bg: 'bg-slate-50' }
      }
    };

    if (isInvalidRange) return { ...totals, yieldEfficiency: 0, maxVal: 1, maxOutletVal: 1, isSingleMonth: false, isInvalidRange: true, maxHourVal: 1 };

    const filteredSnapshots = snapshots.filter(s => {
      const sVal = parseInt(s.year) * 12 + MONTH_NAMES.indexOf(s.month);
      const matchesStore = storeFilter === 'all' || s.outletId === storeFilter;
      return sVal >= startVal && sVal <= endVal && matchesStore;
    });

    filteredSnapshots.forEach(s => {
      totals.posTotalGross += Number(s.posTotalGross || 0);
      totals.posGoodGross += Number(s.posGoodGross || 0);
      totals.posGoodNet += Number(s.posGoodNet || 0);
      totals.posGoodTax += Number(s.posGoodTax || 0);
      totals.onlineGoodGross += Number(s.onlineGoodGross || 0);
      totals.onlineGoodNet += Number(s.onlineGoodNet || 0);
      totals.onlineGoodTax += Number(s.onlineGoodTax || 0);
      totals.onlineGoodComm += Number(s.onlineGoodComm || 0);
      totals.onlineGoodAds += Number(s.onlineGoodAds || 0);
      totals.eventRevenue += Number(s.eventRevenue || 0);
      totals.settledOrderCount += Number(s.settledOrderCount || 0);
      totals.totalOrderCount += Number(s.totalOrderCount || 0);
      totals.cancelledOrderCount += Number(s.cancelledOrderCount || 0);

      const hDist = Array.isArray(s.hourlyDistribution) ? s.hourlyDistribution : [];
      hDist.forEach((v, i) => {
        if (i < 24) {
          totals.hourlyIntensity[i] += (Number(v) || 0);
          if (i >= 9 && i < 12) totals.dayParts.morning.revenue += (Number(v) || 0);
          else if (i >= 12 && i < 16) totals.dayParts.afternoon.revenue += (Number(v) || 0);
          else if (i >= 16 && i < 20) totals.dayParts.evening.revenue += (Number(v) || 0);
          else totals.dayParts.night.revenue += (Number(v) || 0);
        }
      });

      const dTrend = Array.isArray(s.dailyTrend) ? s.dailyTrend : [];
      const mIdx = MONTH_NAMES.indexOf(s.month);
      const yNum = parseInt(s.year);
      dTrend.forEach((val, idx) => {
        if (idx < 31) {
          const date = new Date(yNum, mIdx, idx + 1);
          if (date.getMonth() === mIdx) {
            totals.weekdayRevenue[date.getDay()] += Number(val || 0);
          }
        }
      });
    });

    const isSingleMonth = startVal === endVal;
    if (isSingleMonth) {
      totals.trendValues = new Array(31).fill(0);
      totals.labels = Array.from({ length: 31 }, (_, i) => (i + 1).toString());
      filteredSnapshots.forEach(s => {
        if (!totals.outletTrends[s.outletId]) totals.outletTrends[s.outletId] = new Array(31).fill(0);
        const dTrend = Array.isArray(s.dailyTrend) ? s.dailyTrend : [];
        dTrend.forEach((val, idx) => {
          const v = Number(val || 0);
          if (idx < 31) {
            totals.trendValues[idx] += v;
            totals.outletTrends[s.outletId][idx] += v;
          }
        });
      });
    } else {
      const numMonths = endVal - startVal + 1;
      totals.trendValues = new Array(numMonths).fill(0);
      for (let i = 0; i < numMonths; i++) {
        const cur = startVal + i;
        totals.labels.push(`${MONTH_NAMES[cur % 12].substring(0, 3)} '${Math.floor(cur / 12).toString().substring(2)}`);
      }
      filteredSnapshots.forEach(s => {
        const idx = (parseInt(s.year) * 12 + MONTH_NAMES.indexOf(s.month)) - startVal;
        if (idx >= 0 && idx < numMonths) {
          const combined = Number(s.posGoodGross || 0) + Number(s.onlineGoodGross || 0) + Number(s.eventRevenue || 0);
          totals.trendValues[idx] += combined;
          if (!totals.outletTrends[s.outletId]) totals.outletTrends[s.outletId] = new Array(numMonths).fill(0);
          totals.outletTrends[s.outletId][idx] += combined;
        }
      });
    }

    const totalGoodGross = totals.posGoodGross + totals.onlineGoodGross + totals.eventRevenue;
    const yieldEfficiency = totalGoodGross > 0 ? ((totals.posGoodNet + totals.onlineGoodNet + totals.eventRevenue) / totalGoodGross) * 100 : 0;
    const maxHourVal = Math.max(...totals.hourlyIntensity, 1);

    const numMonths = endVal - startVal + 1;
    const totalDays = isSingleMonth ? 30 : numMonths * 30;
    const avgDailyOrders = totals.settledOrderCount / totalDays;
    const avgBillValue = totals.settledOrderCount > 0 ? totalGoodGross / totals.settledOrderCount : 0;

    return { 
      ...totals, yieldEfficiency, avgDailyOrders, avgBillValue, totalGoodGross,
      maxVal: Math.max(...totals.trendValues, 1), 
      maxOutletVal: Math.max(...Object.values(totals.outletTrends).flatMap(t => t), 1),
      maxHourVal, isSingleMonth, isInvalidRange
    };
  }, [snapshots, storeFilter, startMonth, startYear, endMonth, endYear]);

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col gap-8">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100"><TrendingUp size={28} /></div>
            <div>
              <h2 className="text-3xl font-black text-slate-900 tracking-tight">Sales Intelligence</h2>
              <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Multi-month performance visualization</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {storeFilter !== 'all' && rentals.find(r => r.outletId === storeFilter) && (
              <WeatherWidget 
                outlet={rentals.find(r => r.outletId === storeFilter)!} 
                userId={dataOwnerId} 
              />
            )}
            <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2">
              <MapPin size={14} className="text-indigo-500" />
              <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase tracking-tight">
                <option value="all">All Active Outlets</option>
                {activeOutletOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <button onClick={fetchData} className="p-3 bg-white rounded-xl border border-slate-100 text-slate-400 hover:text-indigo-600 shadow-sm transition-colors"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row items-center gap-4 bg-white p-4 rounded-[2rem] border border-slate-100 shadow-sm">
           <div className={`flex items-center gap-3 p-2 rounded-2xl border transition-colors ${analytics.isInvalidRange ? 'bg-rose-50 border-rose-200' : 'bg-slate-50 border-slate-100'}`}>
              <div className="px-3 text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-slate-200 flex items-center gap-2"><Calendar size={12}/> Range From</div>
              <div className="flex items-center gap-2">
                 <select value={startMonth} onChange={e => setStartMonth(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase">{MONTH_NAMES.map(m => <option key={m} value={m}>{m.substring(0, 3)}</option>)}</select>
                 <select value={startYear} onChange={e => setStartYear(e.target.value)} className="bg-transparent font-bold text-xs outline-none">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select>
              </div>
              <ArrowRight size={14} className="text-slate-300 mx-2" />
              <div className="flex items-center gap-2">
                 <select value={endMonth} onChange={e => setEndMonth(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase">{MONTH_NAMES.map(m => <option key={m} value={m}>{m.substring(0, 3)}</option>)}</select>
                 <select value={endYear} onChange={e => setEndYear(e.target.value)} className="bg-transparent font-bold text-xs outline-none">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select>
              </div>
           </div>
           <div className="h-8 w-px bg-slate-100 hidden lg:block mx-2" />
           <div className="flex flex-wrap gap-2">
              <button onClick={() => applyPreset(1)} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase hover:bg-indigo-100 transition-all">This Month</button>
              <button onClick={applyLastMonth} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase hover:bg-indigo-100 transition-all">Last Month</button>
              <button onClick={() => applyPreset(3)} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase hover:bg-indigo-100 transition-all">Last 3M</button>
              <button onClick={() => applyPreset(6)} className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase hover:bg-indigo-100 transition-all">Last 6M</button>
           </div>
        </div>
      </header>

      {loading ? (
        <div className="py-40 text-center"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" /><p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Accessing Database...</p></div>
      ) : analytics.isInvalidRange ? (
        <div className="py-32 bg-white rounded-[3rem] border-2 border-dashed border-rose-200 text-center"><AlertTriangle size={48} className="mx-auto text-rose-500 mb-4" /><h3 className="text-xl font-black text-slate-900">Invalid Range</h3></div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <div className="bg-slate-50 p-8 rounded-[2.5rem] border border-indigo-100 shadow-sm flex flex-col justify-between min-h-[180px] group hover:bg-white hover:shadow-xl transition-all duration-500">
               <div>
                 <p className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] mb-1 italic">Consolidated Yield</p>
                 <h4 className="text-4xl font-black text-slate-900 tracking-tighter">₹{analytics.totalGoodGross.toLocaleString()}</h4>
               </div>
               <div className="mt-4 flex items-center justify-between">
                 <div className="flex items-center gap-1.5 text-slate-400 font-black uppercase text-[10px]"><TrendingUp size={12} className="text-indigo-500" /> Total Revenue</div>
                 <div className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[8px] font-black uppercase">Active Yield</div>
               </div>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between min-h-[180px]">
               <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">POS REVENUE (TOTAL)</p><h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{analytics.posTotalGross.toLocaleString()}</h4></div>
               <div className="mt-4 flex items-center gap-1.5 text-slate-300 font-black uppercase text-[10px]"><Calculator size={12} /> COMBINED POS BASE</div>
            </div>
            <div className="bg-emerald-600 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between min-h-[180px] relative overflow-hidden group">
               <div className="absolute top-6 right-6 p-3 bg-emerald-500/50 rounded-full flex items-center justify-center"><CheckCircle2 size={32} className="text-emerald-300" /></div>
               <div><p className="text-[10px] font-black text-emerald-100 uppercase tracking-widest mb-1">POS REVENUE (GOOD)</p><h4 className="text-3xl font-black text-white tracking-tighter">₹{analytics.posGoodGross.toLocaleString()}</h4></div>
               <div className="mt-4 flex items-center gap-1.5 text-emerald-100 font-black uppercase text-[10px]"><CheckCircle2 size={12} /> SETTLED OR DELIVERED</div>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between min-h-[180px]">
               <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">EVENT REVENUE</p><h4 className="text-3xl font-black text-violet-600 tracking-tighter">₹{analytics.eventRevenue.toLocaleString()}</h4></div>
               <div className="mt-4 flex items-center gap-1.5 text-slate-300 font-black uppercase text-[10px]"><Ticket size={12} className="text-violet-400" /> SPECIAL PROGRAMMING</div>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between min-h-[180px]">
               <div><p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-1">ONLINE NET (GOOD)</p><h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{analytics.onlineGoodNet.toLocaleString()}</h4></div>
               <div className="mt-4 pt-4 border-t border-slate-50 space-y-2">
                 <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-tight"><span className="text-slate-400 flex items-center gap-1"><ArrowDownRight size={10} className="text-orange-400" /> PLATFORM TAX</span><span className="text-slate-600">₹{analytics.onlineGoodTax.toLocaleString()}</span></div>
                 <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-tight"><span className="text-slate-400 flex items-center gap-1"><ArrowDownRight size={10} className="text-orange-400" /> COMMISSIONS</span><span className="text-slate-600">₹{analytics.onlineGoodComm.toLocaleString()}</span></div>
               </div>
            </div>
            <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between min-h-[180px] relative overflow-hidden">
               <div className="absolute -right-4 -top-4 opacity-10 rotate-12"><Zap size={120} /></div>
               <div>
                 <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">SETTLEMENT & VOLUME</p>
                 <div className="space-y-2.5 mt-2">
                    <div className="flex justify-between items-end"><span className="text-[9px] font-black text-slate-500 uppercase">POS NET</span><span className="text-lg font-black tracking-tight">₹{analytics.posGoodNet.toLocaleString()}</span></div>
                    <div className="flex justify-between items-end"><span className="text-[9px] font-black text-slate-500 uppercase">SETTLED VOL</span><span className="text-lg font-black tracking-tight">{analytics.settledOrderCount.toLocaleString()}</span></div>
                 </div>
               </div>
               <div className="mt-4 flex items-center gap-1.5 text-slate-500 font-black uppercase text-[10px]"><Zap size={12} className="text-indigo-400" /> TRANSACTIONAL DEPTH</div>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between min-h-[180px]">
               <div><p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">POS TAX (GOOD)</p><h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{analytics.posGoodTax.toLocaleString()}</h4></div>
               <div className="mt-4 flex items-center gap-1.5 text-slate-300 font-black uppercase text-[10px]"><Percent size={12} className="text-rose-400" /> GOVERNMENT LEVY</div>
            </div>
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between min-h-[180px]">
               <div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">UNIT PERFORMANCE</p>
                 <div className="space-y-4 mt-4">
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-1">AVG DAILY ORDERS</p>
                      <h4 className="text-2xl font-black text-indigo-600 tracking-tighter">{analytics.avgDailyOrders.toFixed(1)} <span className="text-xs text-slate-400">ORD</span></h4>
                    </div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase mb-1">AVG BILL VALUE</p>
                      <h4 className="text-2xl font-black text-emerald-600 tracking-tighter">₹{Math.round(analytics.avgBillValue).toLocaleString()}</h4>
                    </div>
                 </div>
               </div>
               <div className="mt-4 flex items-center gap-1.5 text-slate-300 font-black uppercase text-[10px]"><Activity size={12} className="text-indigo-400" /> UNIT METRICS</div>
            </div>
          </section>

          <div className="flex bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner">
             <button onClick={() => setActiveTab('velocity')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'velocity' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Activity size={16} /> Velocity</button>
             <button onClick={() => setActiveTab('trajectory')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'trajectory' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><LineChart size={16} /> Trajectory</button>
             <button onClick={() => setActiveTab('traffic-trend')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'traffic-trend' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Clock size={16} /> Traffic Trend</button>
             <button onClick={() => setActiveTab('projections')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'projections' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Zap size={16} /> Projections</button>
          </div>

          <section className="animate-in slide-in-from-bottom-2 duration-500">
            {activeTab === 'velocity' && (
              <section className="bg-slate-900 rounded-[3rem] p-10 text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-12 opacity-5 pointer-events-none rotate-12"><Activity size={200} /></div>
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12 relative z-10">
                    <div><h3 className="text-2xl font-black tracking-tight flex items-center gap-3"><Dna className="text-indigo-400" /> Outlet Velocity Comparison</h3><p className="text-slate-400 text-sm font-medium">Node benchmarking</p></div>
                    <div className="flex items-center gap-6">
                      <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                        <button onClick={() => setOutletChartType('bar')} className={`p-2.5 rounded-lg transition-all ${outletChartType === 'bar' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><BarChart size={18} /></button>
                        <button onClick={() => setOutletChartType('line')} className={`p-2.5 rounded-lg transition-all ${outletChartType === 'line' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}><LineChart size={18} /></button>
                      </div>
                    </div>
                </div>
                <div className="relative h-[340px] w-full pl-12 pr-4 z-10">
                    <svg viewBox="0 0 1000 300" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                      {[0, 0.5, 1].map(p => (<g key={p}><line x1="0" y1={300 - p * 300} x2="1000" y2={300 - p * 300} stroke="rgba(255,255,255,0.05)" strokeWidth="1" /><text x="-10" y={300 - p * 300 + 3} textAnchor="end" className="fill-slate-500 text-[10px] font-black">{Math.round((analytics.maxOutletVal * p) / 1000)}k</text></g>))}
                      {outletChartType === 'bar' ?
                        Object.keys(analytics.outletTrends).map((oId, oIdx) => (
                            <g key={oId}>{(analytics.outletTrends[oId] as number[]).map((val, i) => {
                                  const length = analytics.trendValues.length;
                                  const barWidth = (1000 / Math.max(1, length)) * 0.8 / Object.keys(analytics.outletTrends).length;
                                  const x = (i / Math.max(1, length - 1)) * 1000 - (0.4 * (1000 / Math.max(1, length))) + (oIdx * barWidth);
                                  const h = (val / (analytics.maxOutletVal || 1)) * 300;
                                  if (val === 0) return null;
                                  return (<rect key={i} x={x} y={300 - h} width={barWidth * 0.9} height={h} fill={OUTLET_COLORS[oId] || OUTLET_COLORS.default} rx="2" onMouseEnter={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setHoveredPoint({ x: rect.left + rect.width/2, y: rect.top, value: val, label: `${analytics.labels[i]} - ${getOutletName(oId)}`, color: OUTLET_COLORS[oId] }); }} onMouseLeave={() => setHoveredPoint(null)} className="transition-all duration-500 hover:opacity-100 opacity-80" />);
                            })}</g>
                        ))
                      : (Object.entries(analytics.outletTrends) as [string, number[]][]).map(([oId, trend]) => (
                          <g key={oId}><path d={`M ${trend.map((val, i) => { const x = trend.length > 1 ? (i / (trend.length - 1)) * 1000 : 500; return `${x},${300 - (val / (analytics.maxOutletVal || 1)) * 300}`; }).join(' L ')}`} fill="none" stroke={OUTLET_COLORS[oId] || OUTLET_COLORS.default} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-700 opacity-80 hover:opacity-100" />
                              {trend.map((val, i) => { const x = trend.length > 1 ? (i / (trend.length - 1)) * 1000 : 500; const y = 300 - (val / (analytics.maxOutletVal || 1)) * 300; return (<circle key={i} cx={x} cy={y} r="3" fill={OUTLET_COLORS[oId] || OUTLET_COLORS.default} onMouseEnter={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setHoveredPoint({ x: rect.left, y: rect.top, value: val, label: `${analytics.labels[i]} - ${getOutletName(oId)}`, color: OUTLET_COLORS[oId] }); }} onMouseLeave={() => setHoveredPoint(null)} className="opacity-40 cursor-pointer hover:opacity-100 transition-opacity" />); })}
                          </g>
                        ))
                      }
                    </svg>
                </div>
                <div className="flex justify-between mt-10 text-[9px] font-black text-slate-500 uppercase tracking-widest px-2 relative z-10">
                  {analytics.labels.filter((_, i) => analytics.isSingleMonth ? (i % Math.max(1, Math.floor(analytics.labels.length / 10)) === 0) : true).map(l => <span key={l}>{l}</span>)}
                </div>
                <div className="mt-12 flex flex-wrap gap-6 border-t border-white/5 pt-8 relative z-10">
                  {Object.keys(analytics.outletTrends).map(oId => (
                    <div key={oId} className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded shadow-sm" style={{ backgroundColor: OUTLET_COLORS[oId] || OUTLET_COLORS.default }} />
                      <span className="text-[10px] font-black uppercase text-slate-400">{getOutletName(oId)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'trajectory' && (
              <section className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm overflow-hidden animate-in slide-in-from-right-4 duration-500">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-8">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><LineChart size={24}/></div>
                      <div>
                        <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Gross Yield Trajectory</h3>
                        <p className="text-slate-400 text-sm font-medium">Consolidated multi-period revenue tracking</p>
                      </div>
                    </div>
                </div>
                <div className="relative h-[340px] w-full pl-12 pr-4">
                  <svg viewBox="0 0 1000 300" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                    {[0, 0.5, 1].map(p => (<g key={p}><line x1="0" y1={300 - p * 250} x2="1000" y2={300 - p * 250} stroke="#f1f5f9" strokeWidth="1" /><text x="-10" y={300 - p * 250 + 4} textAnchor="end" className="fill-slate-300 text-[10px] font-black">{Math.round((analytics.maxVal * p) / 1000)}k</text></g>))}
                    <path d={`M ${analytics.trendValues.map((val, i) => { const x = analytics.trendValues.length > 1 ? (i / (analytics.trendValues.length - 1)) * 1000 : 500; return `${x},${300 - (val / (analytics.maxVal || 1)) * 250}`; }).join(' L ')}`} fill="none" stroke="#6366f1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="animate-in fade-in slide-in-from-left-4 duration-1000" />
                    {analytics.trendValues.map((val, i) => {
                      const x = analytics.trendValues.length > 1 ? (i / (analytics.trendValues.length - 1)) * 1000 : 500;
                      const y = 300 - (val / (analytics.maxVal || 1)) * 250;
                      return (
                        <circle key={i} cx={x} cy={y} r="5" fill="white" stroke="#6366f1" strokeWidth="3" className="cursor-pointer hover:r-7 transition-all" onMouseEnter={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setHoveredPoint({ x: rect.left, y: rect.top, value: val, label: analytics.labels[i] }); }} onMouseLeave={() => setHoveredPoint(null)} />
                      );
                    })}
                  </svg>
                  <div className="flex justify-between mt-10 text-[9px] font-black text-slate-400 uppercase tracking-widest px-2">
                    {analytics.labels.filter((_, i) => analytics.isSingleMonth ? true : (i % Math.max(1, Math.floor(analytics.labels.length / 8)) === 0)).map(l => <span key={l}>{l}</span>)}
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'traffic-trend' && (
              <div className="space-y-12 animate-in slide-in-from-right-4 duration-500">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <section className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm overflow-hidden">
                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-8">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><Clock size={24}/></div>
                          <div>
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Aggregated Sales Intensity</h3>
                            <p className="text-slate-400 text-sm font-medium">Peak transactional windows</p>
                          </div>
                        </div>
                    </div>

                    {analytics.hourlyIntensity.every(v => v === 0) ? (
                        <div className="py-20 text-center bg-slate-50 rounded-[2.5rem] border border-dashed border-slate-200">
                          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm"><RefreshCw size={24} className="text-indigo-400" /></div>
                          <h4 className="text-lg font-black text-slate-800 uppercase tracking-tight">Re-Sync Required</h4>
                        </div>
                    ) : (
                        <div className="relative h-[300px] w-full pl-12 pr-4 group/chart">
                          <svg viewBox="0 0 1000 300" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                            {[0, 0.5, 1].map(p => (<g key={p}><line x1="0" y1={280 - p * 250} x2="1000" y2={280 - p * 250} stroke="#f1f5f9" strokeWidth="1" strokeDasharray={p === 0 ? "0" : "4 4"} /><text x="-12" y={280 - p * 250 + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-black">{p === 0 ? '0' : `${Math.round((analytics.maxHourVal * p) / 1000)}k`}</text></g>))}
                            {analytics.hourlyIntensity.map((val, i) => {
                                const x = (i / 23) * 1000;
                                const barWidth = (1000 / 24) * 0.75;
                                const h = (val / (analytics.maxHourVal || 1)) * 250;
                                return (
                                  <g key={i} className="cursor-help" onMouseEnter={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setHoveredPoint({ x: rect.left + rect.width/2, y: rect.top, value: val, label: `${i.toString().padStart(2, '0')}:00h` }); }} onMouseLeave={() => setHoveredPoint(null)}>
                                    <rect x={x - barWidth / 2} y={280 - h} width={barWidth} height={h} fill={i >= 12 && i < 16 ? "#6366f1" : "#818cf8"} rx="4" className="hover:fill-indigo-400 transition-colors" />
                                  </g>
                                );
                            })}
                          </svg>
                          <div className="flex justify-between mt-8 text-[9px] font-black text-slate-500 uppercase tracking-widest border-t border-slate-50 pt-4 px-1">
                            {[0, 6, 12, 18, 23].map(h => <span key={h}>{h.toString().padStart(2, '0')}h</span>)}
                          </div>
                        </div>
                    )}
                  </section>

                  <section className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm overflow-hidden">
                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-12 gap-8">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl shadow-inner"><Calendar size={24}/></div>
                          <div>
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Weekday Revenue Distribution</h3>
                            <p className="text-slate-400 text-sm font-medium">Performance by day of week</p>
                          </div>
                        </div>
                    </div>

                    {Object.values(analytics.weekdayRevenue).every(v => v === 0) ? (
                        <div className="py-20 text-center bg-slate-50 rounded-[2.5rem] border border-dashed border-slate-200">
                          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm"><Activity size={24} className="text-emerald-400" /></div>
                          <h4 className="text-lg font-black text-slate-800 uppercase tracking-tight">No Weekday Data</h4>
                        </div>
                    ) : (
                        <div className="relative h-[300px] w-full pl-12 pr-4 group/chart">
                          <svg viewBox="0 0 1000 300" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                            {(() => {
                              const weekdayValues = Object.values(analytics.weekdayRevenue) as number[];
                              const maxWeekday = Math.max(...weekdayValues, 1);
                              const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                              return (
                                <>
                                  {[0, 0.5, 1].map(p => (<g key={p}><line x1="0" y1={280 - p * 250} x2="1000" y2={280 - p * 250} stroke="#f1f5f9" strokeWidth="1" strokeDasharray={p === 0 ? "0" : "4 4"} /><text x="-12" y={280 - p * 250 + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-black">{p === 0 ? '0' : `${Math.round((maxWeekday * p) / 1000)}k`}</text></g>))}
                                  {days.map((day, i) => {
                                    const val = analytics.weekdayRevenue[i] || 0;
                                    const x = (i / 6) * 1000;
                                    const barWidth = (1000 / 7) * 0.75;
                                    const h = (val / maxWeekday) * 250;
                                    return (
                                      <g key={day} className="cursor-help" onMouseEnter={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setHoveredPoint({ x: rect.left + rect.width/2, y: rect.top, value: val, label: day }); }} onMouseLeave={() => setHoveredPoint(null)}>
                                        <rect x={x - barWidth / 2} y={280 - h} width={barWidth} height={h} fill={i === 0 || i === 6 ? "#10b981" : "#34d399"} rx="4" className="hover:fill-emerald-400 transition-colors" />
                                      </g>
                                    );
                                  })}
                                </>
                              );
                            })()}
                          </svg>
                          <div className="flex justify-between mt-8 text-[9px] font-black text-slate-500 uppercase tracking-widest border-t border-slate-50 pt-4 px-1">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <span key={d}>{d}</span>)}
                          </div>
                        </div>
                    )}
                  </section>
                </div>

                <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {Object.values(analytics.dayParts).map((part: any) => (
                      <div key={part.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all group">
                          <div className="flex justify-between items-start mb-6">
                            <div className={`p-3 rounded-2xl shadow-inner ${part.bg} ${part.color}`}><part.icon size={20} /></div>
                            <span className="text-[10px] font-black text-slate-400 uppercase bg-slate-50 px-2 py-1 rounded-lg border border-slate-100">{part.hours}</span>
                          </div>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{part.label}</p>
                          <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{Math.round(part.revenue).toLocaleString()}</h4>
                      </div>
                    ))}
                </section>

                <div className="p-10 bg-slate-900 rounded-[3rem] text-white shadow-2xl relative overflow-hidden flex flex-col md:flex-row items-center gap-10">
                    <div className="absolute top-0 right-0 p-8 opacity-5"><Activity size={180}/></div>
                    <div className="flex items-center gap-6 shrink-0">
                      <div className="w-20 h-20 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center shadow-xl shadow-indigo-900/50"><Target size={32}/></div>
                      <div>
                        <p className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-1">Golden Hour Anchor</p>
                        <h4 className="text-4xl font-black tracking-tighter">
                          {analytics.hourlyIntensity.indexOf(Math.max(...analytics.hourlyIntensity))}:00h
                        </h4>
                      </div>
                    </div>
                    <div className="h-px w-full md:w-px md:h-16 bg-white/10" />
                    <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-2xl">
                      Analysis of historical snapshots identifies <span className="text-white font-black">{analytics.hourlyIntensity.indexOf(Math.max(...analytics.hourlyIntensity))}:00 hours</span> as the primary revenue velocity center.
                    </p>
                </div>
              </div>
            )}

            {activeTab === 'projections' && (
              <div className="space-y-8">
                {storeFilter === 'all' ? (
                  <div className="py-20 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-100">
                    <Store size={48} className="text-slate-200 mx-auto mb-4" />
                    <h4 className="text-lg font-black text-slate-900 uppercase">Select an Outlet</h4>
                    <p className="text-slate-400 text-sm mt-2">AI Projections require a specific store context to analyze local factors.</p>
                  </div>
                ) : (
                  <ProjectionEngine 
                    outlet={rentals.find(r => r.outletId === storeFilter)!} 
                    userId={dataOwnerId} 
                  />
                )}
              </div>
            )}
          </section>
        </>
      )}

      {hoveredPoint && (
        <div className="fixed pointer-events-none z-[1000] animate-in fade-in zoom-in-95 duration-150" style={{ left: hoveredPoint.x, top: hoveredPoint.y - 15, transform: 'translate(-50%, -100%)' }}>
          <div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl border border-white/10 min-w-[140px] text-center">
             <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">{hoveredPoint.label}</p>
             <p className="text-lg font-black" style={{ color: hoveredPoint.color || '#fff' }}>₹{hoveredPoint.value.toLocaleString()}</p>
             {hoveredPoint.subLabel && <p className="text-[9px] font-bold text-slate-400 uppercase mt-1">{hoveredPoint.subLabel}</p>}
             <div className="absolute top-full left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-900 rotate-45 -mt-1.5" />
          </div>
        </div>
      )}
    </div>
  );
};

export default SalesHub;
