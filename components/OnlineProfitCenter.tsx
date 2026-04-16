
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from '@firebase/auth';
import { collection, query, getDocs, where, orderBy, limit } from '@firebase/firestore';
import { db } from '../firebase';
import { 
  SalesMonthlySnapshot, 
  ItemMonthlySnapshot, 
  StoreRental, 
  ItemCost, 
  SkuMapping,
  MenuNormalization,
  OnlineCustomer,
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
  Scale,
  Users
} from 'lucide-react';

import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line,
  Legend
} from 'recharts';

const OnlineProfitCenter: React.FC<{ user: User }> = ({ user }) => {
  const [allSalesSnaps, setAllSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [itemSnaps, setItemSnaps] = useState<ItemMonthlySnapshot[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, any>>({});
  const [normalizationMap, setNormalizationMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'hourly' | 'velocity' | 'super_clients'>('overview');
  const [topCustomers, setTopCustomers] = useState<OnlineCustomer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [startHour, setStartHour] = useState(0);
  const [endHour, setEndHour] = useState(23);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState('all');

  const [velocityRange, setVelocityRange] = useState<'1m' | '3m' | '6m' | '9m' | 'custom'>('3m');
  const [customStartMonth, setCustomStartMonth] = useState(MONTH_NAMES[0]);
  const [customStartYear, setCustomStartYear] = useState(YEAR_OPTIONS[YEAR_OPTIONS.length - 1]);
  const [customEndMonth, setCustomEndMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [customEndYear, setCustomEndYear] = useState(new Date().getFullYear().toString());

  const fetchCustomers = async () => {
    setLoadingCustomers(true);
    setCustomerError(null);
    try {
      const q = query(
        collection(db, 'online_customers'),
        where('userId', '==', user.uid),
        orderBy('totalOrders', 'desc'),
        limit(50)
      );
      const snap = await getDocs(q);
      setTopCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() } as OnlineCustomer)));
    } catch (err: any) {
      console.error("Customer fetch error:", err);
      if (err.message?.includes('index')) {
        setCustomerError("This view requires a database index. Please click the link in the console or contact support to enable it.");
      } else {
        setCustomerError("Failed to fetch customer data. Please try again.");
      }
    } finally {
      setLoadingCustomers(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'super_clients') {
      fetchCustomers();
    }
  }, [activeTab, user.uid]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const constraints = [
        where('userId', '==', user.uid),
        where('year', '==', selectedYear),
        where('month', '==', selectedMonth)
      ];

      const [sSnap, iSnap, rSnap, cSnap, skuSnap, normSnap, allSSnap] = await Promise.all([
        getDocs(query(collection(db, 'sales_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'item_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'rentals'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'item_costs'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'sku_mappings'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'menu_normalization'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'sales_snapshots'), where('userId', '==', user.uid)))
      ]);

      // We still keep month-specific snaps for overview
      // but use allSSnap for velocity
      setAllSalesSnaps(allSSnap.docs.map(d => d.data() as SalesMonthlySnapshot));
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

  const availablePlatforms = useMemo(() => {
    const plats = new Set<string>();
    allSalesSnaps.forEach(s => {
      if (s.platformBreakdown) {
        Object.keys(s.platformBreakdown).forEach(p => plats.add(p));
      }
    });
    return Array.from(plats).sort();
  }, [allSalesSnaps]);

  const salesSnaps = useMemo(() => {
    return allSalesSnaps.filter(s => s.year === selectedYear && s.month === selectedMonth);
  }, [allSalesSnaps, selectedYear, selectedMonth]);

  const analytics = useMemo(() => {
    const filteredSales = salesSnaps.filter(s => storeFilter === 'all' || s.outletId === storeFilter);
    const filteredItems = itemSnaps.filter(s => storeFilter === 'all' || s.outletId === storeFilter);

    const platformFilteredSales = platformFilter === 'all' 
      ? filteredSales 
      : filteredSales.map(s => {
          const pData = s.platformBreakdown?.[platformFilter];
          if (!pData) return null;
          return {
            ...s,
            onlineGoodGross: pData.gross,
            onlineGoodNet: pData.net,
            onlineGoodTax: pData.tax,
            onlineGoodComm: pData.commission,
            onlineGoodAds: pData.ads,
            onlineGoodGstOnComm: pData.gstOnComm,
            onlineGoodTds: pData.tds,
            onlineOrderCount: pData.orders,
            totalOrderCount: pData.orders
          };
        }).filter(Boolean) as SalesMonthlySnapshot[];

    if (platformFilteredSales.length === 0) return null;

    // 1. Aggregated Sales Metrics
    const metrics = platformFilteredSales.reduce((acc, s) => ({
      gross: acc.gross + (s.onlineGoodGross || 0),
      net: acc.net + (s.onlineGoodNet || 0),
      tax: acc.tax + (s.onlineGoodTax || s.onlineGoodTax_calculated || 0),
      commission: acc.commission + (s.onlineGoodComm || 0),
      ads: acc.ads + (s.onlineGoodAds || 0),
      gstOnComm: acc.gstOnComm + (s.onlineGoodGstOnComm || 0),
      tds: acc.tds + (s.onlineGoodTds || 0),
      orders: acc.orders + (s.onlineOrderCount || s.totalOrderCount || 0),
      posNet: acc.posNet + (s.posGoodNet || 0)
    }), { gross: 0, net: 0, tax: 0, commission: 0, ads: 0, gstOnComm: 0, tds: 0, orders: 0, posNet: 0 });

    // netPayout is the actual realized payout from the snapshots
    const netPayout = metrics.net;
    const netSales = metrics.gross - metrics.tax;
    const effectiveCommissionRate = metrics.gross > 0 ? ((metrics.commission + metrics.ads + metrics.gstOnComm + metrics.tds) / metrics.gross) * 100 : 0;
    const roas = metrics.ads > 0 ? metrics.gross / metrics.ads : 0;

    // Platform Mix
    const platformMix = Object.entries(platformFilteredSales.reduce((acc, s) => {
      if (s.platformBreakdown) {
        Object.entries(s.platformBreakdown).forEach(([p, data]: [string, any]) => {
          if (!acc[p]) acc[p] = { gross: 0, orders: 0 };
          acc[p].gross += (data.gross || 0);
          acc[p].orders += (data.orders || 0);
        });
      }
      return acc;
    }, {} as Record<string, { gross: number, orders: number }>))
    .map(([name, data]) => ({ name, gross: (data as any).gross, orders: (data as any).orders }))
    .sort((a, b) => b.gross - a.gross);

    // 2. Item Analysis
    const itemMap: Record<string, { onlineQty: number, onlineRev: number, posQty: number, posRev: number, cost: number }> = {};
    
    filteredItems.forEach(snap => {
      Object.entries(snap.items).forEach(([name, data]: [string, any]) => {
        const masterName = (normalizationMap[name.trim().toUpperCase()] || name).trim().toUpperCase();
        if (!itemMap[masterName]) {
          const costRec = itemCosts.find(c => (c.itemName || '').trim().toUpperCase() === masterName);
          itemMap[masterName] = { onlineQty: 0, onlineRev: 0, posQty: 0, posRev: 0, cost: costRec?.costPerUnit || 0 };
        }
        
        if (platformFilter === 'all') {
          itemMap[masterName].onlineQty += (data.onlineQuantity || 0);
          // Sum up all platform revenues to get strictly online revenue
          if (data.platformBreakdown) {
            Object.values(data.platformBreakdown).forEach((p: any) => {
              itemMap[masterName].onlineRev += (p.revenue || 0);
            });
          } else if ((data.onlineQuantity || 0) > 0 && (data.posQuantity || 0) === 0) {
            // Fallback for older data: if it's strictly online, use total revenue
            itemMap[masterName].onlineRev += (data.revenue || 0);
          }
        } else {
          const pData = data.platformBreakdown?.[platformFilter];
          if (pData) {
            itemMap[masterName].onlineQty += pData.quantity;
            itemMap[masterName].onlineRev += pData.revenue;
          }
        }
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

    // 3. Hourly & Weekday Distribution
    const hourlyRevenue = new Array(24).fill(0);
    const hourlyOrders = new Array(24).fill(0);
    const weekdayRevenue = new Array(7).fill(0);

    filteredSales.forEach(s => {
      if (s.onlineHourlyDistribution) {
        s.onlineHourlyDistribution.forEach((v, h) => hourlyRevenue[h] += v);
      }
      if (s.onlineOrderHourlyDistribution) {
        s.onlineOrderHourlyDistribution.forEach((v, h) => hourlyOrders[h] += v);
      }
      if (s.onlineWeekdayDistribution) {
        s.onlineWeekdayDistribution.forEach((v, w) => weekdayRevenue[w] += v);
      }
    });

    const hourlyData = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: `${i}:00`,
      revenue: hourlyRevenue[i],
      orders: hourlyOrders[i]
    }));

    const weekdayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const weekdayData = Array.from({ length: 7 }, (_, i) => ({
      day: weekdayLabels[i],
      revenue: weekdayRevenue[i]
    }));

    const filteredHourlyData = hourlyData.filter(d => d.hour >= startHour && d.hour <= endHour);

    return {
      metrics,
      netSales,
      netPayout,
      effectiveCommissionRate,
      roas,
      topOnlineItems,
      contributionMargin,
      platformMix,
      hourlyData,
      weekdayData,
      filteredHourlyData
    };
  }, [salesSnaps, itemSnaps, storeFilter, platformFilter, normalizationMap, itemCosts, startHour, endHour]);

  const velocityAnalytics = useMemo(() => {
    if (allSalesSnaps.length === 0) return null;

    const now = new Date();
    let startDate: Date;
    let endDate: Date = new Date();

    if (velocityRange === 'custom') {
      startDate = new Date(parseInt(customStartYear), MONTH_NAMES.indexOf(customStartMonth), 1);
      endDate = new Date(parseInt(customEndYear), MONTH_NAMES.indexOf(customEndMonth), 28); // End of month approx
    } else {
      const monthsBack = parseInt(velocityRange);
      startDate = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);
    }

    // Generate month list in range
    const monthsInRange: { month: string, year: string, sortKey: number }[] = [];
    let curr = new Date(startDate);
    while (curr <= endDate) {
      monthsInRange.push({
        month: MONTH_NAMES[curr.getMonth()],
        year: curr.getFullYear().toString(),
        sortKey: curr.getFullYear() * 100 + curr.getMonth()
      });
      curr.setMonth(curr.getMonth() + 1);
    }

    const filteredSnaps = allSalesSnaps.filter(s => {
      const isOutletMatch = storeFilter === 'all' || s.outletId === storeFilter;
      const snapSortKey = parseInt(s.year) * 100 + MONTH_NAMES.indexOf(s.month);
      const isInRange = monthsInRange.some(m => m.sortKey === snapSortKey);
      return isOutletMatch && isInRange;
    }).map(s => {
      if (platformFilter === 'all') return s;
      const pData = s.platformBreakdown?.[platformFilter];
      if (!pData) return { ...s, onlineGoodGross: 0, onlineOrderCount: 0, totalOrderCount: 0 };
      return {
        ...s,
        onlineGoodGross: pData.gross,
        onlineOrderCount: pData.orders,
        totalOrderCount: pData.orders
      };
    });

    const trendData = monthsInRange.map(m => {
      const snaps = filteredSnaps.filter(s => s.month === m.month && s.year === m.year);
      const revenue = snaps.reduce((acc, s) => acc + (s.onlineGoodGross || 0), 0);
      const orders = snaps.reduce((acc, s) => acc + (s.onlineOrderCount || s.totalOrderCount || 0), 0);
      return {
        label: `${m.month.substring(0, 3)} ${m.year.substring(2)}`,
        revenue,
        orders,
        sortKey: m.sortKey
      };
    }).sort((a, b) => a.sortKey - b.sortKey);

    return {
      trendData
    };
  }, [allSalesSnaps, velocityRange, customStartMonth, customStartYear, customEndMonth, customEndYear, storeFilter, platformFilter]);

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
            <Globe size={14} className="text-indigo-500" />
            <select 
              value={platformFilter} 
              onChange={e => setPlatformFilter(e.target.value)} 
              className="bg-transparent font-bold text-xs outline-none uppercase cursor-pointer"
            >
              <option value="all">All Platforms</option>
              {availablePlatforms.map(p => <option key={p} value={p}>{p}</option>)}
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

      <div className="flex items-center gap-1 bg-slate-100 p-1.5 rounded-2xl w-fit">
        <button 
          onClick={() => setActiveTab('overview')}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'overview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Overview
        </button>
        <button 
          onClick={() => setActiveTab('hourly')}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'hourly' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Traffic Trends
        </button>
        <button 
          onClick={() => setActiveTab('velocity')}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'velocity' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Velocity
        </button>
        <button 
          onClick={() => setActiveTab('super_clients')}
          className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'super_clients' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Super Clients
        </button>
      </div>

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
          {activeTab === 'overview' ? (
            <>
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
                { label: 'Net Sales (After Tax)', value: analytics.netSales, color: 'bg-indigo-500', width: `${(analytics.netSales / analytics.metrics.gross) * 100}%` },
                { label: 'After Commission', value: analytics.netSales - analytics.metrics.commission, color: 'bg-indigo-400', width: `${((analytics.netSales - analytics.metrics.commission) / analytics.metrics.gross) * 100}%` },
                { label: 'After GST & TDS', value: analytics.netSales - analytics.metrics.commission - analytics.metrics.gstOnComm - analytics.metrics.tds, color: 'bg-indigo-300', width: `${((analytics.netSales - analytics.metrics.commission - analytics.metrics.gstOnComm - analytics.metrics.tds) / analytics.metrics.gross) * 100}%` },
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
              {analytics.platformMix.length > 0 && platformFilter === 'all' && (
                <div className="col-span-full mb-6">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Platform Revenue Mix</h4>
                  <div className="flex flex-wrap gap-4">
                    {analytics.platformMix.map((p, i) => (
                      <div key={i} className="flex-1 min-w-[150px] bg-slate-50 p-4 rounded-2xl border border-slate-100">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-xs font-black text-slate-700 uppercase">{p.name}</span>
                          <span className="text-[10px] font-bold text-indigo-600">{((p.gross / analytics.metrics.gross) * 100).toFixed(1)}%</span>
                        </div>
                        <p className="text-lg font-black text-slate-900">₹{p.gross.toLocaleString()}</p>
                        <p className="text-[9px] font-medium text-slate-400 uppercase">{p.orders} Orders</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
              <div className="flex items-center gap-4">
                <div className="p-2 rounded-xl bg-slate-50 text-slate-500"><ShieldCheck size={20}/></div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GST on Comm & TDS</p>
                  <p className="text-lg font-black text-slate-900">₹{(analytics.metrics.gstOnComm + analytics.metrics.tds).toLocaleString()}</p>
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
                {analytics.topOnlineItems.length > 0 ? (
                  analytics.topOnlineItems.map((item, i) => (
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
                  ))
                ) : (
                  <div className="py-12 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                    <SearchX size={32} className="mx-auto text-slate-300 mb-3" />
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">No Best Sellers Found</p>
                  </div>
                )}
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
          </>
          ) : activeTab === 'hourly' ? (
            <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-12">
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight">Hourly Order Intensity</h3>
                      <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">When do your digital customers order most?</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-6">
                      <div className="flex items-center gap-3 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                        <div className="flex items-center gap-2 px-3">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">From</span>
                          <select 
                            value={startHour} 
                            onChange={e => setStartHour(parseInt(e.target.value))}
                            className="bg-transparent font-bold text-xs outline-none cursor-pointer text-indigo-600"
                          >
                            {Array.from({ length: 24 }, (_, i) => (
                              <option key={i} value={i}>{i}:00</option>
                            ))}
                          </select>
                        </div>
                        <div className="w-px h-4 bg-slate-200" />
                        <div className="flex items-center gap-2 px-3">
                          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">To</span>
                          <select 
                            value={endHour} 
                            onChange={e => setEndHour(parseInt(e.target.value))}
                            className="bg-transparent font-bold text-xs outline-none cursor-pointer text-indigo-600"
                          >
                            {Array.from({ length: 24 }, (_, i) => (
                              <option key={i} value={i}>{i}:00</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-indigo-500" />
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Revenue</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full bg-emerald-500" />
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Orders</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={analytics.filteredHourlyData}>
                        <defs>
                          <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="label" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                          interval={2}
                        />
                        <YAxis 
                          yAxisId="left"
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                          tickFormatter={(v) => `₹${v >= 1000 ? (v/1000).toFixed(1) + 'k' : v}`}
                        />
                        <YAxis 
                          yAxisId="right"
                          orientation="right"
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#10b981', fontSize: 10, fontWeight: 700 }}
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '1.5rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '1.5rem' }}
                          itemStyle={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                          labelStyle={{ fontSize: '10px', fontWeight: 900, color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase' }}
                        />
                        <Area 
                          yAxisId="left"
                          type="monotone" 
                          dataKey="revenue" 
                          stroke="#6366f1" 
                          strokeWidth={4}
                          fillOpacity={1} 
                          fill="url(#colorRev)" 
                          name="Revenue (₹)"
                        />
                        <Area 
                          yAxisId="right"
                          type="monotone" 
                          dataKey="orders" 
                          stroke="#10b981" 
                          strokeWidth={4}
                          fill="transparent"
                          name="Orders"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-12">
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight">Weekday Performance</h3>
                      <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Revenue distribution by day of week</p>
                    </div>
                  </div>

                  <div className="h-[400px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.weekdayData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="day" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                          tickFormatter={(v) => `₹${v >= 1000 ? (v/1000).toFixed(1) + 'k' : v}`}
                        />
                        <Tooltip 
                          cursor={{ fill: '#f8fafc' }}
                          contentStyle={{ borderRadius: '1.5rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '1.5rem' }}
                          itemStyle={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                          labelStyle={{ fontSize: '10px', fontWeight: 900, color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase' }}
                        />
                        <Bar 
                          dataKey="revenue" 
                          fill="#6366f1" 
                          radius={[8, 8, 0, 0]} 
                          name="Revenue (₹)"
                        >
                          {analytics.weekdayData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={index === 0 || index === 6 ? '#818cf8' : '#6366f1'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Peak Hour Card */}
                <div className="bg-indigo-600 p-8 rounded-[2.5rem] text-white shadow-xl">
                  <div className="p-3 rounded-2xl bg-white/10 w-fit mb-6">
                    <TrendingUp size={24} />
                  </div>
                  <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-1">Peak Order Hour</p>
                  <h4 className="text-3xl font-black mb-2">
                    {analytics.hourlyData.reduce((prev, current) => (prev.orders > current.orders) ? prev : current).label}
                  </h4>
                  <p className="text-xs font-medium text-indigo-100 opacity-80">Highest volume of digital traffic</p>
                </div>

                {/* Lunch vs Dinner */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                  <div className="p-3 rounded-2xl bg-amber-50 text-amber-600 w-fit mb-6">
                    <PieChart size={24} />
                  </div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Lunch vs Dinner Mix</p>
                  <div className="flex items-end gap-4">
                    <h4 className="text-3xl font-black text-slate-900">
                      {(analytics.hourlyData.slice(11, 15).reduce((a, b) => a + b.orders, 0) / (analytics.metrics.orders || 1) * 100).toFixed(0)}%
                    </h4>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Lunch Share</p>
                  </div>
                  <div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-amber-500" 
                      style={{ width: `${(analytics.hourlyData.slice(11, 15).reduce((a, b) => a + b.orders, 0) / (analytics.metrics.orders || 1) * 100)}%` }} 
                    />
                  </div>
                </div>

                {/* Late Night Opportunity */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                  <div className="p-3 rounded-2xl bg-indigo-50 text-indigo-600 w-fit mb-6">
                    <Activity size={24} />
                  </div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Late Night (10PM+)</p>
                  <h4 className="text-3xl font-black text-slate-900">
                    ₹{analytics.hourlyData.slice(22).reduce((a, b) => a + b.revenue, 0).toLocaleString()}
                  </h4>
                  <p className="text-xs font-medium text-slate-400 mt-1">Revenue from night owls</p>
                </div>
              </div>
            </section>
          ) : (
            <section className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
              <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-8 mb-12">
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight">Sales & Order Velocity</h3>
                    <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Growth trajectory over time</p>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                      {(['1m', '3m', '6m', '9m', 'custom'] as const).map(r => (
                        <button
                          key={r}
                          onClick={() => setVelocityRange(r)}
                          className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${velocityRange === r ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>

                    {velocityRange === 'custom' && (
                      <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
                        <div className="flex items-center gap-2">
                          <select value={customStartMonth} onChange={e => setCustomStartMonth(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none">
                            {MONTH_NAMES.map(m => <option key={m} value={m}>{m.substring(0,3)}</option>)}
                          </select>
                          <select value={customStartYear} onChange={e => setCustomStartYear(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none">
                            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
                          </select>
                        </div>
                        <span className="text-slate-300">→</span>
                        <div className="flex items-center gap-2">
                          <select value={customEndMonth} onChange={e => setCustomEndMonth(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none">
                            {MONTH_NAMES.map(m => <option key={m} value={m}>{m.substring(0,3)}</option>)}
                          </select>
                          <select value={customEndYear} onChange={e => setCustomEndYear(e.target.value)} className="bg-transparent text-[10px] font-bold outline-none">
                            {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {!velocityAnalytics || velocityAnalytics.trendData.length === 0 ? (
                  <div className="py-20 text-center">
                    <p className="text-slate-400 font-bold">No historical data found for this range.</p>
                  </div>
                ) : (
                  <div className="space-y-12">
                    {/* Curve Chart (Area) */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Revenue Growth Curve</h4>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-indigo-500" />
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Revenue</span>
                          </div>
                        </div>
                      </div>
                      <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={velocityAnalytics.trendData}>
                            <defs>
                              <linearGradient id="colorVelocityRev" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} tickFormatter={(v) => `₹${v >= 1000 ? (v/1000).toFixed(1) + 'k' : v}`} />
                            <Tooltip 
                              contentStyle={{ borderRadius: '1.5rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '1.5rem' }}
                              itemStyle={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                              labelStyle={{ fontSize: '10px', fontWeight: 900, color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase' }}
                            />
                            <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={4} fillOpacity={1} fill="url(#colorVelocityRev)" name="Revenue (₹)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Bar Chart (Orders) */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">Order Volume Distribution</h4>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-emerald-500" />
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Orders</span>
                          </div>
                        </div>
                      </div>
                      <div className="h-[300px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={velocityAnalytics.trendData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }} />
                            <Tooltip 
                              cursor={{ fill: '#f8fafc' }}
                              contentStyle={{ borderRadius: '1.5rem', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '1.5rem' }}
                              itemStyle={{ fontSize: '12px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                              labelStyle={{ fontSize: '10px', fontWeight: 900, color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase' }}
                            />
                            <Bar dataKey="orders" fill="#10b981" radius={[6, 6, 0, 0]} name="Orders" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'super_clients' && (
            <section className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                <div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                    <Users size={24} className="text-indigo-600" /> Super Clients Leaderboard
                  </h3>
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Top 50 Most Loyal Digital Customers</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="px-4 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-[10px] font-black uppercase tracking-widest border border-indigo-100">
                    {topCustomers.length} Active Profiles
                  </div>
                </div>
              </div>

              {loadingCustomers ? (
                <div className="py-20 text-center">
                  <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-4" />
                  <p className="text-slate-400 font-black uppercase tracking-widest text-[9px]">Fetching Loyalty Data...</p>
                </div>
              ) : customerError ? (
                <div className="py-20 text-center bg-rose-50 rounded-[2rem] border border-rose-100">
                  <AlertCircle size={40} className="mx-auto text-rose-400 mb-4" />
                  <p className="text-rose-900 text-xs font-black uppercase tracking-widest">Database Setup Required</p>
                  <p className="text-rose-600 text-[10px] mt-2 px-10">{customerError}</p>
                  <a 
                    href="https://console.firebase.google.com/v1/r/project/nekometrics-b38b9/firestore/indexes?create_composite=Clpwcm9qZWN0cy9uZWtvbWV0cmljcy1iMzhiOS9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvb25saW5lX2N1c3RvbWVycy9pbmRleGVzL18QARoKCgZ1c2VySWQQARoPCgt0b3RhbE9yZGVycxACGgwKCF9fbmFtZV9fEAI"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-6 px-6 py-2 bg-rose-600 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-rose-700 transition-colors"
                  >
                    Create Index Now
                  </a>
                </div>
              ) : topCustomers.length === 0 ? (
                <div className="py-20 text-center bg-slate-50 rounded-[2rem] border border-dashed border-slate-200">
                  <Users size={40} className="mx-auto text-slate-200 mb-4" />
                  <p className="text-slate-400 text-xs font-black uppercase tracking-widest">No Customer Data Found</p>
                  <p className="text-slate-400 text-[10px] mt-2">Upload Online Order Hub CSVs to build your CRM.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {topCustomers.map((customer, i) => (
                    <div key={customer.id} className="flex items-center justify-between p-6 bg-slate-50 rounded-[2rem] border border-slate-100 group hover:bg-white hover:shadow-xl hover:border-indigo-100 transition-all">
                      <div className="flex items-center gap-5">
                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-black shadow-inner ${
                          i === 0 ? 'bg-amber-100 text-amber-600' : 
                          i === 1 ? 'bg-slate-200 text-slate-600' :
                          i === 2 ? 'bg-orange-100 text-orange-600' :
                          'bg-white text-slate-400'
                        }`}>
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900 tracking-tight">ID: {customer.customerId}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {customer.platforms.map(p => (
                              <span key={p} className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[8px] font-black text-slate-500 uppercase">
                                {p}
                              </span>
                            ))}
                            <span className="text-[9px] font-bold text-slate-400 ml-1">
                              Last: {new Date(customer.lastOrderDate).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-2xl font-black text-slate-900">{customer.totalOrders}</span>
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Orders</span>
                        </div>
                        <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-tighter">
                          ₹{customer.totalSpent.toLocaleString()} Spent
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default OnlineProfitCenter;
