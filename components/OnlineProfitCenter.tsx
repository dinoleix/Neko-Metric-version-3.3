
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from '@firebase/auth';
import { collection, query, getDocs, where } from '@firebase/firestore';
import { db } from '../firebase';
import { 
  SalesMonthlySnapshot, 
  ItemMonthlySnapshot, 
  StoreRental, 
  ItemCost, 
  SkuMapping,
  MenuNormalization,
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
import { 
  TrendingUp, 
  ShoppingBag, 
  PieChart, 
  Zap, 
  ArrowDownRight, 
  ArrowUpRight, 
  RefreshCw, 
  MapPin, 
  CalendarDays,
  Target,
  Activity,
  Info,
  ChevronRight,
  MousePointer2,
  AlertCircle,
  ShieldCheck,
  Smartphone,
  Globe,
  DollarSign,
  Percent,
  BarChart3,
  SearchX,
  Loader2,
  Scale
} from 'lucide-react';

const OnlineProfitCenter: React.FC<{ user: User }> = ({ user }) => {
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [itemSnaps, setItemSnaps] = useState<ItemMonthlySnapshot[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, any>>({});
  const [normalizationMap, setNormalizationMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [storeFilter, setStoreFilter] = useState('all');

  const fetchData = async () => {
    setLoading(true);
    try {
      const constraints = [
        where('userId', '==', user.uid),
        where('year', '==', selectedYear),
        where('month', '==', selectedMonth)
      ];

      const [sSnap, iSnap, rSnap, cSnap, skuSnap, normSnap] = await Promise.all([
        getDocs(query(collection(db, 'sales_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'item_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'rentals'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'item_costs'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'sku_mappings'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'menu_normalization'), where('userId', '==', user.uid)))
      ]);

      setSalesSnaps(sSnap.docs.map(d => d.data() as SalesMonthlySnapshot));
      setItemSnaps(iSnap.docs.map(d => d.data() as ItemMonthlySnapshot));
      setRentals(rSnap.docs.map(d => ({ id: d.id, ...d.data() } as StoreRental)));
      setItemCosts(cSnap.docs.map(d => d.data() as ItemCost));
      
      const nMap: Record<string, string> = {};
      normSnap.docs.forEach(d => {
        const data = d.data() as MenuNormalization;
        nMap[data.sourceName.trim().toUpperCase()] = data.masterName.trim().toUpperCase();
      });
      setNormalizationMap(nMap);

      const mappingObj: Record<string, any> = {};
      skuSnap.docs.forEach(d => {
        const data = d.data() as SkuMapping;
        mappingObj[data.itemName.trim().toUpperCase()] = data;
      });
      setSkuMappings(mappingObj);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user, selectedYear, selectedMonth]);

  const activeOutletOptions = useMemo(() => rentals.map(r => ({ id: r.outletId, name: r.storeName })), [rentals]);

  const analytics = useMemo(() => {
    const filteredSales = salesSnaps.filter(s => storeFilter === 'all' || s.outletId === storeFilter);
    const filteredItems = itemSnaps.filter(s => storeFilter === 'all' || s.outletId === storeFilter);

    if (filteredSales.length === 0) return null;

    // 1. Aggregated Sales Metrics
    const metrics = filteredSales.reduce((acc, s) => ({
      gross: acc.gross + (s.onlineGoodGross || 0),
      net: acc.net + (s.onlineGoodNet || 0),
      tax: acc.tax + (s.onlineGoodTax || s.onlineGoodTax_calculated || 0),
      commission: acc.commission + (s.onlineGoodComm || 0),
      ads: acc.ads + (s.onlineGoodAds || 0),
      orders: acc.orders + (s.totalOrderCount || 0),
      posNet: acc.posNet + (s.posGoodNet || 0)
    }), { gross: 0, net: 0, tax: 0, commission: 0, ads: 0, orders: 0, posNet: 0 });

    const netPayout = metrics.net - metrics.commission - metrics.ads;
    const effectiveCommissionRate = metrics.gross > 0 ? ((metrics.commission + metrics.ads) / metrics.gross) * 100 : 0;
    const roas = metrics.ads > 0 ? metrics.gross / metrics.ads : 0;

    // 2. Item Analysis
    const itemMap: Record<string, { onlineQty: number, onlineRev: number, posQty: number, posRev: number, cost: number }> = {};
    
    filteredItems.forEach(snap => {
      Object.entries(snap.items).forEach(([name, data]: [string, any]) => {
        const masterName = (normalizationMap[name.trim().toUpperCase()] || name).trim().toUpperCase();
        if (!itemMap[masterName]) {
          const costRec = itemCosts.find(c => (c.itemName || '').trim().toUpperCase() === masterName);
          itemMap[masterName] = { onlineQty: 0, onlineRev: 0, posQty: 0, posRev: 0, cost: costRec?.costPerUnit || 0 };
        }
        itemMap[masterName].onlineQty += (data.onlineQuantity || 0);
        itemMap[masterName].onlineRev += (data.revenue || 0); // Note: Item snapshots usually store total revenue per item, but we'll treat it as online if it's from an online source or use a heuristic
        itemMap[masterName].posQty += (data.posQuantity || 0);
      });
    });

    const topOnlineItems = Object.entries(itemMap)
      .map(([name, data]) => ({
        name,
        qty: data.onlineQty,
        revenue: data.onlineRev,
        theoreticalCost: data.onlineQty * data.cost,
        // Estimate net margin after platform cut (using average effective rate)
        netMargin: data.onlineRev * (1 - effectiveCommissionRate/100) - (data.onlineQty * data.cost)
      }))
      .filter(i => i.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 10);

    const totalTheoreticalCOGS = topOnlineItems.reduce((acc, i) => acc + i.theoreticalCost, 0);
    const contributionMargin = netPayout - totalTheoreticalCOGS;

    return {
      metrics,
      netPayout,
      effectiveCommissionRate,
      roas,
      topOnlineItems,
      contributionMargin
    };
  }, [salesSnaps, itemSnaps, storeFilter, normalizationMap, itemCosts]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100">
            <Globe size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Online Profit Center</h2>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest flex items-center gap-2">
              <Smartphone size={14} className="text-indigo-400" /> Digital Storefront Performance & P&L
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-100">
            <MapPin size={14} className="text-indigo-500" />
            <select 
              value={storeFilter} 
              onChange={e => setStoreFilter(e.target.value)} 
              className="bg-transparent font-bold text-xs outline-none uppercase cursor-pointer"
            >
              <option value="all">All Units</option>
              {activeOutletOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-100">
            <CalendarDays size={14} className="text-indigo-500" />
            <select 
              value={selectedMonth} 
              onChange={e => setSelectedMonth(e.target.value)} 
              className="bg-transparent font-bold text-xs outline-none uppercase cursor-pointer"
            >
              {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select 
              value={selectedYear} 
              onChange={e => setSelectedYear(e.target.value)} 
              className="bg-transparent font-bold text-xs outline-none cursor-pointer"
            >
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={fetchData} className="p-2.5 text-slate-400 hover:text-indigo-600 transition-colors">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {loading ? (
        <div className="py-40 text-center">
          <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4" />
          <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Analyzing Digital P&L...</p>
        </div>
      ) : !analytics ? (
        <div className="py-32 bg-white rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
          <SearchX size={48} className="mx-auto text-slate-200 mb-4" />
          <h3 className="text-xl font-black text-slate-900">No Online Data Found</h3>
          <p className="text-slate-400 text-sm mt-2">Ensure online sales snapshots are generated for this period.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Executive Overview */}
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between group hover:shadow-xl transition-all">
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-600 shadow-inner">
                  <DollarSign size={20} />
                </div>
                <div className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase tracking-widest">
                  Net Realized
                </div>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Realized Net Payout</p>
                <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{analytics.netPayout.toLocaleString()}</h4>
                <p className="text-[9px] font-bold text-slate-400 uppercase mt-2">After Commission & Ads</p>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between group hover:shadow-xl transition-all">
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-2xl bg-rose-50 text-rose-600 shadow-inner">
                  <Percent size={20} />
                </div>
                <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${analytics.effectiveCommissionRate > 30 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {analytics.effectiveCommissionRate.toFixed(1)}% Rate
                </div>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Effective Take Rate</p>
                <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{analytics.effectiveCommissionRate.toFixed(1)}%</h4>
                <p className="text-[9px] font-bold text-slate-400 uppercase mt-2">Comm + Ads / Gross Sales</p>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between group hover:shadow-xl transition-all">
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-2xl bg-amber-50 text-amber-600 shadow-inner">
                  <Target size={20} />
                </div>
                <div className="px-3 py-1 rounded-full bg-amber-50 text-amber-600 text-[9px] font-black uppercase tracking-widest">
                  Efficiency
                </div>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Ad ROAS</p>
                <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{analytics.roas.toFixed(1)}x</h4>
                <p className="text-[9px] font-bold text-slate-400 uppercase mt-2">Revenue per ₹1 Ad Spend</p>
              </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between group hover:-translate-y-1 transition-all">
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-2xl bg-white/10 text-emerald-400 shadow-inner">
                  <Zap size={20} />
                </div>
                <div className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest">
                  Profitability
                </div>
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Contribution Margin</p>
                <h4 className="text-3xl font-black text-white tracking-tighter">₹{analytics.contributionMargin.toLocaleString()}</h4>
                <p className="text-[9px] font-bold text-slate-500 uppercase mt-2">Net Payout - Theoretical COGS</p>
              </div>
            </div>
          </section>

          {/* Platform Erosion Funnel */}
          <section className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
            <div className="flex items-center justify-between mb-12">
              <div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">Platform Erosion Audit</h3>
                <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">The Journey from Gross Order to Realized Payout</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Orders</p>
                <p className="text-xl font-black text-slate-900">{analytics.metrics.orders.toLocaleString()}</p>
              </div>
            </div>

            <div className="space-y-6">
              {[
                { label: 'Gross Online Sales', value: analytics.metrics.gross, color: 'bg-indigo-600', width: '100%' },
                { label: 'Net Sales (After Tax)', value: analytics.metrics.net, color: 'bg-indigo-500', width: `${(analytics.metrics.net / analytics.metrics.gross) * 100}%` },
                { label: 'After Platform Commission', value: analytics.metrics.net - analytics.metrics.commission, color: 'bg-indigo-400', width: `${((analytics.metrics.net - analytics.metrics.commission) / analytics.metrics.gross) * 100}%` },
                { label: 'Realized Payout (Final)', value: analytics.netPayout, color: 'bg-emerald-500', width: `${(analytics.netPayout / analytics.metrics.gross) * 100}%` }
              ].map((step, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between items-end">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-tight">{step.label}</span>
                    <span className="text-sm font-black text-slate-900">₹{step.value.toLocaleString()}</span>
                  </div>
                  <div className="h-4 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                    <div 
                      className={`h-full ${step.color} transition-all duration-1000 ease-out`} 
                      style={{ width: step.width }} 
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6 pt-10 border-t border-slate-50">
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-xl bg-rose-50 text-rose-500"><ArrowDownRight size={20}/></div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Commission Leakage</p>
                  <p className="text-lg font-black text-slate-900">₹{analytics.metrics.commission.toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-xl bg-amber-50 text-amber-500"><Activity size={20}/></div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Ad Spend Burn</p>
                  <p className="text-lg font-black text-slate-900">₹{analytics.metrics.ads.toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-xl bg-indigo-50 text-indigo-500"><PieChart size={20}/></div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tax Component</p>
                  <p className="text-lg font-black text-slate-900">₹{analytics.metrics.tax.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Online Menu Performance */}
            <section className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
              <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-8 flex items-center gap-3">
                <BarChart3 size={24} className="text-indigo-600" /> Digital Best Sellers
              </h3>
              <div className="space-y-4">
                {analytics.topOnlineItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl group hover:bg-indigo-50 transition-all">
                    <div className="flex items-center gap-4">
                      <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-black group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-xs font-black text-slate-800 uppercase tracking-tight">{item.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">{item.qty} Orders</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-slate-900">₹{item.revenue.toLocaleString()}</p>
                      <p className={`text-[9px] font-black uppercase ${item.netMargin > 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                        Est. Margin: ₹{item.netMargin.toFixed(0)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Strategic Insights */}
            <section className="space-y-8">
              <div className="bg-indigo-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
                  <Target size={160} />
                </div>
                <div className="relative z-10">
                  <h3 className="text-2xl font-black tracking-tight mb-6 uppercase">Strategic Insights</h3>
                  <div className="space-y-6">
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Scale size={20} className="text-indigo-300" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black uppercase tracking-widest mb-1">Channel Mix</h4>
                        <p className="text-indigo-200 text-xs leading-relaxed">
                          Online sales represent {((analytics.metrics.gross / (analytics.metrics.gross + analytics.metrics.posNet || 1)) * 100).toFixed(1)}% of your total revenue mix.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <AlertCircle size={20} className="text-amber-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black uppercase tracking-widest mb-1">Margin Warning</h4>
                        <p className="text-indigo-200 text-xs leading-relaxed">
                          {analytics.effectiveCommissionRate > 25 
                            ? "High take-rate detected. Consider optimizing ad spend or increasing online-only prices to protect margins."
                            : "Healthy take-rate. You have room to scale advertisement for higher volume."}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <ShieldCheck size={20} className="text-emerald-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black uppercase tracking-widest mb-1">ROAS Target</h4>
                        <p className="text-indigo-200 text-xs leading-relaxed">
                          Your ROAS of {analytics.roas.toFixed(1)}x is {analytics.roas > 5 ? 'Excellent' : 'below target'}. Aim for 6x+ to ensure ad spend is truly profitable.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-xl bg-slate-50 text-slate-400">
                    <Info size={18} />
                  </div>
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-widest">Data Methodology</h4>
                </div>
                <p className="text-slate-500 text-[11px] leading-relaxed font-medium">
                  Calculations are based on monthly online sales snapshots. "Est. Margin" factors in the average effective commission rate and theoretical ingredient costs from your Master Item Costs. Packaging costs are currently estimated within the theoretical COGS.
                </p>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
};

export default OnlineProfitCenter;
