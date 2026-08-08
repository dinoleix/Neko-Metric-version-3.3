
import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { computeConsumption, closingStockTotal } from '../pnlService';
import { getCachedCollection } from '../referenceCache';
import { 
  SalesMonthlySnapshot, 
  ExpenseMonthlySnapshot,
  ItemMonthlySnapshot,
  Employee, 
  StoreRental, 
  CogsAdjustment,
  MonthlyPayroll,
  getOutletName,
  CategorySettings,
  SkuMapping,
  SkuCategory,
  MenuNormalization,
  ItemCost,
  DEFAULT_COGS,
  DEFAULT_LABOUR,
  DEFAULT_OPS,
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
import { 
  BarChart3, 
  Building2, 
  Check, 
  CalendarDays, 
  ShieldQuestion, 
  CheckCircle2, 
  Loader2,
  ChevronDown,
  Utensils,
  Coffee,
  Info,
  TrendingUp,
  AlertCircle,
  LayoutGrid,
  Zap,
  ArrowRight,
  Target,
  Trophy,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Tag,
  Layers,
  Scale,
  RefreshCw,
  Sparkles,
  PieChart,
  DollarSign,
  PackageSearch,
  ShoppingCart,
  ListFilter,
  ArrowRightCircle
} from 'lucide-react';

import { 
  PieChart as RePieChart, 
  Pie, 
  Cell, 
  Tooltip as ReTooltip, 
  ResponsiveContainer, 
  Legend 
} from 'recharts';

type PnlTab = 'overview' | 'menu-engineering' | 'unit-economics';

const PnLAnalytics: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [expenseSnaps, setExpenseSnaps] = useState<ExpenseMonthlySnapshot[]>([]);
  const [itemSnaps, setItemSnaps] = useState<ItemMonthlySnapshot[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, { category: SkuCategory, segment?: string }>>({});
  const [normalizationMap, setNormalizationMap] = useState<Record<string, string>>({});
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [adjustments, setAdjustments] = useState<CogsAdjustment[]>([]);
  const [monthlyPayrolls, setMonthlyPayrolls] = useState<MonthlyPayroll[]>([]);
  
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeTab, setActiveTab] = useState<PnlTab>('overview');

  const [cogsKeywords, setCogsKeywords] = useState<string[]>(DEFAULT_COGS);
  const [labourKeywords, setLabourKeywords] = useState<string[]>(DEFAULT_LABOUR);
  const [opsKeywords, setOpsKeywords] = useState<string[]>(DEFAULT_OPS);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>(['all']);
  const [selectedSegment, setSelectedSegment] = useState<string>('all');
  const [isOutletDropdownOpen, setIsOutletDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOutletDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchPrerequisites = async () => {
    try {
      const settingsRef = doc(db, 'category_settings', dataOwnerId);
      const [rent, setSnap, sku, costs, norm] = await Promise.all([
        getCachedCollection<StoreRental>('rentals', dataOwnerId),
        getDoc(settingsRef),
        getCachedCollection<SkuMapping>('sku_mappings', dataOwnerId),
        getCachedCollection<ItemCost>('item_costs', dataOwnerId),
        getCachedCollection<MenuNormalization>('menu_normalization', dataOwnerId)
      ]);

      if (setSnap.exists()) {
        const data = setSnap.data() as CategorySettings;
        if (data.cogsKeywords) setCogsKeywords(data.cogsKeywords.map(k => k.trim().toUpperCase()));
        if (data.labourKeywords) setLabourKeywords(data.labourKeywords.map(k => k.trim().toUpperCase()));
        if (data.opsKeywords) setOpsKeywords(data.opsKeywords.map(k => k.trim().toUpperCase()));
      }

      setRentals(rent);
      setItemCosts(costs);

      const normMap: Record<string, string> = {};
      norm.forEach(data => {
        normMap[data.sourceName.trim().toUpperCase()] = data.masterName;
      });
      setNormalizationMap(normMap);

      const mappingObj: Record<string, { category: SkuCategory, segment?: string }> = {};
      sku.forEach(data => {
        mappingObj[data.itemName.trim().toUpperCase()] = { category: data.category, segment: data.segment };
      });
      setSkuMappings(mappingObj);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchPrerequisites(); }, [user]);

  const availableOutlets = useMemo(() => {
    const monthIdx = MONTH_NAMES.indexOf(selectedMonth);
    const yearNum = parseInt(selectedYear);
    const periodStart = new Date(yearNum, monthIdx, 1);

    return rentals.filter(r => {
      if (r.status === 'active') return true;
      if (r.status === 'closed' && r.closeDate) {
        const closeDate = new Date(r.closeDate);
        return closeDate >= periodStart;
      }
      return true; 
    });
  }, [rentals, selectedMonth, selectedYear]);

  useEffect(() => {
    if (selectedOutlets.includes('all')) return;
    const availableIds = availableOutlets.map(o => o.outletId);
    const next = selectedOutlets.filter(id => availableIds.includes(id));
    if (next.length === 0) setSelectedOutlets(['all']);
    else if (next.length !== selectedOutlets.length) setSelectedOutlets(next);
  }, [availableOutlets, selectedOutlets]);

  const generateReport = async () => {
    setLoading(true);
    try {
      const periodConstraints = [
        where('userId', '==', dataOwnerId),
        where('year', '==', selectedYear),
        where('month', '==', selectedMonth)
      ];

      const [sSnaps, eSnaps, iSnaps, adj, pay] = await Promise.all([
        getDocs(query(collection(db, 'sales_snapshots'), ...periodConstraints)),
        getDocs(query(collection(db, 'expense_snapshots'), ...periodConstraints)),
        getDocs(query(collection(db, 'item_snapshots'), ...periodConstraints)),
        getDocs(query(collection(db, 'cogs_adjustments'), ...periodConstraints)),
        getDocs(query(collection(db, 'monthly_payrolls'), ...periodConstraints))
      ]);
      
      setSalesSnaps(sSnaps.docs.map(d => d.data() as SalesMonthlySnapshot));
      setExpenseSnaps(eSnaps.docs.map(d => d.data() as ExpenseMonthlySnapshot));
      setItemSnaps(iSnaps.docs.map(d => d.data() as ItemMonthlySnapshot));
      setAdjustments(adj.docs.map(d => d.data() as CogsAdjustment));
      setMonthlyPayrolls(pay.docs.map(d => d.data() as MonthlyPayroll));
      
      setHasSearched(true);
      setSelectedSegment('all');
    } catch (err) { 
      console.error(err);
      alert("Failed to build intelligence report.");
    } finally { setLoading(false); }
  };

  const CATEGORY_COLORS: Record<string, string> = {
    'FOOD': '#10b981', // emerald-500
    'DRINKS': '#6366f1', // indigo-500
    'MISC': '#94a3b8', // slate-400
    'UNMAPPED': '#f43f5e' // rose-500
  };

  const toggleOutlet = (id: string) => {
    if (id === 'all') setSelectedOutlets(['all']);
    else {
      let next = selectedOutlets.filter(o => o !== 'all');
      if (next.includes(id)) {
        next = next.filter(o => o !== id);
        if (next.length === 0) next = ['all'];
      } else next.push(id);
      setSelectedOutlets(next);
    }
  };

  const intelligence = useMemo(() => {
    if (!hasSearched) return null;

    const activeOutletOptionsIds = selectedOutlets.includes('all') 
      ? availableOutlets.map(r => r.outletId)
      : selectedOutlets;

    const filteredSalesSnaps = salesSnaps.filter(s => activeOutletOptionsIds.includes(s.outletId));
    const filteredExpenseSnaps = expenseSnaps.filter(s => activeOutletOptionsIds.includes(s.outletId));
    const filteredItemSnaps = itemSnaps.filter(s => activeOutletOptionsIds.includes(s.outletId));
    const filteredAdjustments = adjustments.filter(a => activeOutletOptionsIds.includes(a.outletId));

    const goodRev = filteredSalesSnaps.reduce((acc, s) => acc + (s.posGoodGross || 0) + (s.onlineGoodGross || 0), 0);
    const posTax = filteredSalesSnaps.reduce((acc, s) => acc + (s.posGoodTax || 0), 0);
    const platformLeakage = filteredSalesSnaps.reduce((acc, s) => acc + (s.onlineGoodTax || 0) + (s.onlineGoodComm || 0) + (s.onlineGoodAds || 0), 0);

    let rawCogs = 0;
    let rawOps = 0;
    let rawLabour = 0;
    let rawOther = 0;

    filteredExpenseSnaps.forEach(snap => {
      const processMap = (map: Record<string, number>) => {
        Object.entries(map || {}).forEach(([cat, amt]) => {
          const upper = cat.trim().toUpperCase();
          if (cogsKeywords.includes(upper)) rawCogs += amt;
          else if (labourKeywords.includes(upper)) rawLabour += amt;
          else if (opsKeywords.includes(upper)) rawOps += amt;
          else rawOther += amt;
        });
      };
      processMap(snap.expenseByCategory);
      processMap(snap.purchaseByCategory);
    });

    // Consumption = Opening + Purchases − Closing (shared with PnLHub so the two
    // screens can no longer report different COGS for the same month)
    const cogsAdj = closingStockTotal(filteredAdjustments);
    const coGS = computeConsumption(rawCogs, filteredAdjustments);
    const grossProfit = goodRev - posTax - platformLeakage - coGS;
    const grossMargin = goodRev > 0 ? (grossProfit / goodRev) * 100 : 0;
    const totalOpEx = rawLabour + rawOps + rawOther;
    const netProfit = grossProfit - totalOpEx;
    const netMargin = goodRev > 0 ? (netProfit / goodRev) * 100 : 0;

    const outletTierMap: Record<string, 'TIER_1' | 'TIER_2'> = {};
    rentals.forEach(r => { outletTierMap[r.outletId] = r.tier; });

    const consolidatedItems: Record<string, { qty: number, rev: number, theoreticalCost: number }> = {};
    filteredItemSnaps.forEach(snap => {
      const tier = outletTierMap[snap.outletId] ?? 'TIER_1';
      Object.entries(snap.items || {}).forEach(([name, data]: [string, any]) => {
        const upperName = name.trim().toUpperCase();
        const masterName = (normalizationMap[upperName] || name).trim().toUpperCase();

        if (!consolidatedItems[masterName]) consolidatedItems[masterName] = { qty: 0, rev: 0, theoreticalCost: 0 };
        consolidatedItems[masterName].qty += data.quantity;
        consolidatedItems[masterName].rev += data.revenue;

        const costRec = itemCosts.find(c => (c.itemName || '').trim().toUpperCase() === masterName);
        if (costRec) {
          const servingCost = tier === 'TIER_1'
            ? (costRec.tier1ServingsCost ?? costRec.servingsCostPerUnit ?? 0)
            : (costRec.tier2ServingsCost ?? costRec.servingsCostPerUnit ?? 0);
          consolidatedItems[masterName].theoreticalCost += data.quantity * (Number(costRec.costPerUnit || 0) + servingCost);
        }
      });
    });

    const itemAnalysisRaw = Object.entries(consolidatedItems).map(([name, data]) => {
      const costRec = itemCosts.find(c => (c.itemName || '').trim().toUpperCase() === name);
      const mapping = skuMappings[name] || { category: 'UNMAPPED' };
      const avgPrice = data.qty > 0 ? data.rev / data.qty : 0;
      const cost = data.qty > 0 ? data.theoreticalCost / data.qty : 0;
      const margin = avgPrice - cost;
      const marginPercent = avgPrice > 0 ? (margin / avgPrice) * 100 : 0;
      const profitAmount = margin * data.qty;
      
      let grade = 'HEALTHY';
      if (marginPercent >= 85) grade = 'ELITE';
      else if (marginPercent >= 65) grade = 'HEALTHY';
      else if (marginPercent >= 50) grade = 'SUBPAR';
      else grade = 'CRITICAL';

      return { 
        name, 
        category: (mapping.category || 'UNMAPPED') as SkuCategory, 
        segment: mapping.segment || 'UNSEGMENTED', 
        quantity: data.qty, 
        revenue: data.rev, 
        price: avgPrice, 
        cost, 
        margin, 
        marginPercent, 
        profitAmount,
        grade, 
        hasCost: !!costRec 
      };
    });

    const categoryAgg: Record<string, { revenue: number, profit: number, quantity: number, itemCount: number }> = {};
    itemAnalysisRaw.forEach(i => {
      const cat = i.category;
      if (!categoryAgg[cat]) categoryAgg[cat] = { revenue: 0, profit: 0, quantity: 0, itemCount: 0 };
      categoryAgg[cat].revenue += i.revenue;
      categoryAgg[cat].profit += i.profitAmount;
      categoryAgg[cat].quantity += i.quantity;
      categoryAgg[cat].itemCount++;
    });

    const categorySummary = Object.entries(categoryAgg).map(([name, data]) => ({
      name,
      value: data.revenue,
      revenue: data.revenue,
      profit: data.profit,
      qty: data.quantity,
      items: data.itemCount,
      avgPrice: data.quantity > 0 ? data.revenue / data.quantity : 0,
      margin: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0
    })).sort((a,b) => b.revenue - a.revenue);

    const itemAnalysis = itemAnalysisRaw.filter(i => (i.category === 'FOOD' || i.category === 'DRINKS') && i.quantity > 0);

    const segmentAgg: Record<string, { revenue: number, profit: number, qty: number, items: number }> = {};
    itemAnalysis.forEach(i => {
      const s = i.segment;
      if (!segmentAgg[s]) segmentAgg[s] = { revenue: 0, profit: 0, qty: 0, items: 0 };
      segmentAgg[s].revenue += i.revenue;
      segmentAgg[s].profit += i.profitAmount;
      segmentAgg[s].qty += i.quantity;
      segmentAgg[s].items++;
    });

    const segmentAnalysis = Object.entries(segmentAgg).map(([name, data]) => ({
      name, revenue: data.revenue, profit: data.profit, marginPercent: data.revenue > 0 ? (data.profit / data.revenue) * 100 : 0, qty: data.qty, items: data.items
    })).sort((a, b) => b.revenue - a.revenue);

    const uniqueSegments = Array.from(new Set(itemAnalysis.map(i => i.segment))).sort();

    const topSegment = [...segmentAnalysis].sort((a, b) => b.profit - a.profit)[0];
    const worstSegment = [...segmentAnalysis].sort((a, b) => a.marginPercent - b.marginPercent)[0];

      return {
      snapshot: { goodRev, posTax, platformLeakage, coGS, grossProfit, grossMargin, totalOpEx, netProfit, netMargin },
      itemAnalysis: itemAnalysis.sort((a, b) => b.revenue - a.revenue),
      segmentAnalysis, categorySummary, topSegment, worstSegment, uniqueSegments
    };
  }, [salesSnaps, expenseSnaps, itemSnaps, itemCosts, skuMappings, normalizationMap, selectedYear, selectedMonth, selectedOutlets, cogsKeywords, labourKeywords, opsKeywords, hasSearched, rentals, adjustments, availableOutlets]);

  const filteredItemsForLedger = useMemo(() => {
    if (!intelligence) return [];
    if (selectedSegment === 'all') return intelligence.itemAnalysis;
    return intelligence.itemAnalysis.filter(i => i.segment === selectedSegment);
  }, [intelligence, selectedSegment]);

  const GradeBadge = ({ grade }: { grade: string }) => {
    const colors: Record<string, string> = { 
      'CRITICAL': 'bg-rose-50 text-rose-600 border-rose-100', 
      'SUBPAR': 'bg-amber-50 text-amber-600 border-amber-100', 
      'HEALTHY': 'bg-emerald-50 text-emerald-600 border-emerald-100', 
      'ELITE': 'bg-indigo-50 text-indigo-600 border-indigo-100' 
    };
    const labels: Record<string, string> = { 
      'CRITICAL': 'C', 
      'SUBPAR': 'S', 
      'HEALTHY': 'G', 
      'ELITE': 'E' 
    };
    return (
      <div className={`flex items-center gap-2 px-1.5 py-0.5 rounded-lg border font-black text-[10px] ${colors[grade]}`}>
        <span className="w-5 h-5 flex items-center justify-center bg-white rounded-md shadow-sm">{labels[grade]}</span>
        <span className="uppercase tracking-tighter hidden md:inline">{grade}</span>
      </div>
    );
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl"><Sparkles size={28} /></div>
          <div><h2 className="text-3xl font-black text-slate-900 tracking-tight">Margin Intelligence</h2><p className="text-slate-400 text-sm font-medium">Strategic diagnostics via snapshot intelligence.</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-slate-100 shadow-sm">
           <div className="relative" ref={dropdownRef}>
              <button onClick={() => setIsOutletDropdownOpen(!isOutletDropdownOpen)} className="bg-slate-50 px-5 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-3 hover:border-indigo-200 min-w-[220px]">
                <Building2 size={16} className="text-indigo-500" />
                <div className="flex-1 text-left">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Outlet Scope</p>
                  <p className="text-[11px] font-bold text-slate-700 uppercase truncate">
                    {selectedOutlets.includes('all') ? 'All Active Units' : (selectedOutlets.length === 1 ? getOutletName(selectedOutlets[0]) : `${selectedOutlets.length} Units`)}
                  </p>
                </div>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${isOutletDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOutletDropdownOpen && (
                <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-2xl shadow-2xl border border-slate-100 z-[100] p-2 animate-in zoom-in-95 duration-200">
                  <button onClick={() => toggleOutlet('all')} className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${selectedOutlets.includes('all') ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}>
                    <span className="text-[11px] font-black uppercase">All Active Operational Units</span>
                    {selectedOutlets.includes('all') && <Check size={14} />}
                  </button>
                  <div className="h-px bg-slate-50 my-2" />
                  {availableOutlets.map(o => (<button key={o.outletId} onClick={() => toggleOutlet(o.outletId)} className={`w-full flex items-center justify-between p-3 rounded-xl transition-all text-left ${selectedOutlets.includes(o.outletId) && !selectedOutlets.includes('all') ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}><span className="text-[11px] font-bold uppercase">{o.storeName}</span>{selectedOutlets.includes(o.outletId) && !selectedOutlets.includes('all') && <Check size={14} />}</button>))}
                </div>
              )}
           </div>
           <div className="bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-100 flex items-center gap-2"><CalendarDays size={14} className="text-indigo-500" /><select value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setHasSearched(false); }} className="bg-transparent font-bold text-xs outline-none uppercase">{MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}</select><select value={selectedYear} onChange={e => { setSelectedYear(e.target.value); setHasSearched(false); }} className="bg-transparent font-bold text-xs outline-none">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
           <button onClick={generateReport} disabled={loading} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 shadow-lg flex items-center gap-2">{loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Build Intelligence</button>
        </div>
      </header>

      {!hasSearched ? (
        <section className="py-40 bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 text-center animate-in zoom-in-95 duration-500"><div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-8 text-indigo-400"><ShieldQuestion size={48} /></div><h3 className="text-3xl font-black text-slate-900 tracking-tight">Intelligence Ready</h3><p className="text-slate-500 mt-3 font-medium max-w-md mx-auto">Click build to generate a diagnostic report for {selectedMonth} {selectedYear}.</p></section>
      ) : loading ? (
        <div className="py-40 text-center"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-6" /><p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Processing monthly snapshots...</p></div>
      ) : intelligence && (
        <div className="animate-in fade-in duration-500 space-y-12">
          <div className="flex flex-wrap bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner gap-1">
            <button onClick={() => setActiveTab('overview')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'overview' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><LayoutGrid size={16}/> Overview</button>
            <button onClick={() => setActiveTab('menu-engineering')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'menu-engineering' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Zap size={16}/> Menu Engineering</button>
            <button onClick={() => setActiveTab('unit-economics')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'unit-economics' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><DollarSign size={16}/> Unit Economics</button>
          </div>

          {activeTab === 'overview' && (
             <div className="space-y-10">
                <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                   <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group"><div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity"><Scale size={60} /></div><p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Fiscal Yield</p><h4 className="text-4xl font-black tracking-tighter text-emerald-400">₹{intelligence.snapshot.netProfit.toLocaleString()}</h4><p className="text-[9px] font-bold text-slate-500 uppercase mt-4">Retention: {intelligence.snapshot.goodRev > 0 ? intelligence.snapshot.netMargin.toFixed(1) + '%' : 'N/A'}</p></div>
                   <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm"><p className="text-[10px] font-black text-rose-500 uppercase mb-1">Gross Margin</p><h4 className="text-4xl font-black text-slate-900 tracking-tighter">{intelligence.snapshot.goodRev > 0 ? intelligence.snapshot.grossMargin.toFixed(1) + '%' : 'N/A'}</h4><p className="text-[9px] font-bold text-slate-400 uppercase mt-4">After COGS & Leakage</p></div>
                   <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm"><p className="text-[10px] font-black text-slate-400 uppercase mb-1">Operational Burn</p><h4 className="text-4xl font-black text-slate-900 tracking-tighter">₹{intelligence.snapshot.totalOpEx.toLocaleString()}</h4><p className="text-[9px] font-bold text-slate-400 uppercase mt-4">OpEx + Labour + Fixed</p></div>
                   <div className={`p-8 rounded-[2.5rem] text-white shadow-xl ${intelligence.snapshot.goodRev > 0 ? (intelligence.snapshot.netMargin >= 0 ? 'bg-emerald-600' : 'bg-rose-600') : 'bg-slate-600'}`}><p className="text-[10px] font-black uppercase mb-1 opacity-70">Efficiency Signal</p><h4 className="text-4xl font-black tracking-tighter">{intelligence.snapshot.goodRev > 0 ? (intelligence.snapshot.netMargin >= 0 ? 'OPTIMAL' : 'CRITICAL') : 'NO DATA'}</h4><p className="text-[9px] font-black uppercase mt-4 opacity-80">{intelligence.snapshot.goodRev > 0 ? (intelligence.snapshot.netMargin >= 0 ? 'Surplus Achieved' : 'Deficit Detected') : 'Awaiting Sales'}</p></div>
                </section>
                
                {/* Category Appetite Section */}
                <section className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                  <div className="xl:col-span-2 bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col md:flex-row">
                    <div className="p-10 flex-1">
                      <div className="flex items-center gap-3 mb-8">
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl"><PieChart size={20}/></div>
                        <h4 className="text-xl font-black text-slate-900 uppercase tracking-tight">Category Appetite</h4>
                      </div>
                      
                      <div className="space-y-6">
                        {intelligence.categorySummary.map((cat) => (
                          <div key={cat.name} className="group cursor-default">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-3">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat.name] || '#94a3b8' }} />
                                <span className="text-sm font-black text-slate-800 uppercase tracking-tight">{cat.name}</span>
                              </div>
                              <span className="text-[10px] font-black text-slate-500">{((cat.revenue / (intelligence.categorySummary.reduce((acc, c) => acc + c.revenue, 0) || 1)) * 100).toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div 
                                className="h-full rounded-full transition-all duration-1000" 
                                style={{ 
                                  width: `${(cat.revenue / (intelligence.categorySummary.reduce((acc, c) => acc + c.revenue, 0) || 1)) * 100}%`,
                                  backgroundColor: CATEGORY_COLORS[cat.name] || '#94a3b8'
                                }} 
                              />
                            </div>
                            <div className="flex items-center gap-4 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                               <p className="text-[9px] font-bold text-slate-400 uppercase">Rev: ₹{cat.revenue.toLocaleString()}</p>
                               <div className="w-1 h-1 bg-slate-200 rounded-full" />
                               <p className="text-[9px] font-bold text-slate-400 uppercase">Margin: {cat.margin.toFixed(1)}%</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    
                    <div className="w-full md:w-[300px] bg-slate-50/50 p-8 flex flex-col items-center justify-center border-t md:border-t-0 md:border-l border-slate-100">
                      <div className="w-full h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <RePieChart>
                            <Pie
                              data={intelligence.categorySummary}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                            >
                              {intelligence.categorySummary.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.name] || '#94a3b8'} stroke="none" />
                              ))}
                            </Pie>
                            <ReTooltip 
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  return (
                                    <div className="bg-slate-900 text-white p-3 rounded-xl shadow-2xl border border-slate-800 text-xs shadow-indigo-500/10">
                                      <p className="font-black uppercase mb-1 tracking-widest text-[10px] text-slate-400">{data.name}</p>
                                      <div className="space-y-0.5">
                                        <p className="font-bold">Rev: ₹{data.revenue.toLocaleString()}</p>
                                        <p className="text-emerald-400 font-bold">Margin: {data.margin.toFixed(1)}%</p>
                                        <p className="text-amber-400 font-bold">Avg Price: ₹{data.avgPrice.toFixed(0)}</p>
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                          </RePieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="text-center mt-4">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Master Sales</p>
                        <p className="text-2xl font-black text-slate-900">₹{intelligence.categorySummary.reduce((acc, c) => acc + c.revenue, 0).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-indigo-600 rounded-[3rem] p-10 text-white shadow-xl relative overflow-hidden flex flex-col justify-between">
                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
                    <div className="relative z-10">
                      <div className="flex items-center gap-3 mb-6">
                        <Zap size={20} className="text-indigo-200" />
                        <h4 className="text-lg font-black uppercase tracking-tight">Category Efficiency</h4>
                      </div>
                      
                      <div className="space-y-6">
                        {intelligence.categorySummary.slice(0, 2).map((cat) => (
                          <div key={cat.name}>
                            <div className="flex justify-between items-start mb-1">
                              <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest">{cat.name} Summary</p>
                              <p className="text-[10px] font-black text-amber-300 bg-amber-900/40 px-2 py-0.5 rounded-full uppercase tracking-widest">Avg ₹{cat.avgPrice.toFixed(0)}</p>
                            </div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-3xl font-black">₹{cat.profit.toLocaleString()}</span>
                              <span className="text-xs font-bold text-indigo-300">Gross Profit</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-10 pt-6 border-t border-white/10 relative z-10">
                      <p className="text-[10px] font-black text-indigo-200 uppercase tracking-widest mb-3">Strategic Insight</p>
                      <p className="text-sm font-medium leading-relaxed italic opacity-90">
                        {intelligence.categorySummary[0]?.name === 'DRINKS' 
                          ? "Beverages are leading in revenue throughput. Evaluate food pairing strategies to boost cross-sell."
                          : "Food remains the volume anchor. Consider optimizing beverage upselling to expand margins."}
                      </p>
                    </div>
                  </div>
                </section>

                <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex items-center gap-10"><div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center shrink-0 border border-indigo-100"><Info size={40} className="text-indigo-500" /></div><div><h4 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">Normalized Cost Intelligence</h4><p className="text-slate-500 text-sm leading-relaxed max-w-3xl">All analytics on this page use <b>Master SKU Normalization</b>. Typos and variant names across platforms have been merged into single Master records for absolute margin accuracy. This ensures 2026 data links correctly with 2025 cost structures.</p></div></div>
             </div>
          )}

          {activeTab === 'menu-engineering' && (
             <div className="space-y-10 animate-in slide-in-from-right-4 duration-500">
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                   {intelligence.topSegment && (<div className="bg-emerald-600 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group"><div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform"><Trophy size={140} /></div><p className="text-[11px] font-black uppercase tracking-widest text-emerald-200 mb-2 flex items-center gap-2"><ArrowUpRight size={14}/> Segment Leader</p><h4 className="text-5xl font-black tracking-tighter mb-4">{intelligence.topSegment.name}</h4><div className="flex items-end gap-10"><div><p className="text-[10px] font-black text-emerald-200 uppercase mb-1">Cash Contribution</p><p className="text-3xl font-black">₹{intelligence.topSegment.profit.toLocaleString()}</p></div><div><p className="text-[10px] font-black text-emerald-200 uppercase mb-1">Gross Margin</p><p className="text-3xl font-black">{intelligence.topSegment.marginPercent.toFixed(1)}%</p></div></div></div>)}
                   {intelligence.worstSegment && (<div className="bg-slate-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group border-2 border-rose-500/20"><div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform"><AlertTriangle size={140} /></div><p className="text-[11px] font-black uppercase tracking-widest text-rose-400 mb-2 flex items-center gap-2"><ArrowDownRight size={14}/> Critical Anchor</p><h4 className="text-5xl font-black tracking-tighter mb-4">{intelligence.worstSegment.name}</h4><div className="flex items-end gap-10"><div><p className="text-[10px] font-black text-slate-500 uppercase mb-1">Items in Group</p><p className="text-3xl font-black">{intelligence.worstSegment.items}</p></div><div><p className="text-[10px] font-black text-rose-400 uppercase mb-1">Group Margin</p><p className="text-3xl font-black text-rose-500">{intelligence.worstSegment.marginPercent.toFixed(1)}%</p></div></div></div>)}
                </section>
                <div className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden"><div className="p-10 border-b border-slate-50 flex items-center justify-between bg-slate-50/50"><div className="flex items-center gap-4"><div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><Tag size={24}/></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Segment Radar</h3><p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Aggregated Master SKU Categories</p></div></div></div><div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-slate-50/80 border-b border-slate-100"><tr><th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Master Segment</th><th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Revenue</th><th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Cash Margin</th><th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Efficiency %</th></tr></thead><tbody className="divide-y divide-slate-50">{intelligence.segmentAnalysis.map((seg) => (<tr key={seg.name} className="hover:bg-slate-50/50 transition-colors group"><td className="px-10 py-6"><div className="flex items-center gap-4"><div className={`p-2 rounded-xl bg-indigo-50 text-indigo-600`}><Tag size={14}/></div><div><p className="text-sm font-black text-slate-900 uppercase tracking-tight">{seg.name}</p><p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{seg.items} SKUs</p></div></div></td><td className="px-10 py-6 text-right font-black text-slate-900">₹{seg.revenue.toLocaleString()}</td><td className="px-10 py-6 text-right font-black text-emerald-600">₹{seg.profit.toLocaleString()}</td><td className="px-10 py-6"><div className="flex flex-col items-center gap-1.5"><div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${seg.marginPercent > 70 ? 'bg-emerald-500' : (seg.marginPercent < 55 ? 'bg-rose-500' : 'bg-indigo-500')}`} style={{ width: `${seg.marginPercent}%` }} /></div><span className="text-[10px] font-black text-slate-600">{seg.marginPercent.toFixed(1)}%</span></div></td></tr>))}</tbody></table></div></div>
             </div>
          )}

          {activeTab === 'unit-economics' && (
             <div className="animate-in slide-in-from-left-4 duration-500">
                <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden">
                   <div className="p-10 border-b border-slate-50 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl shadow-inner"><PackageSearch size={24}/></div>
                        <div>
                           <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">SKU Economics Ledger</h3>
                           <p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Atomic Profitability Audit</p>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-4">
                         <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 flex items-center gap-2 shadow-sm">
                            <ListFilter size={14} className="text-indigo-500" />
                            <select 
                              value={selectedSegment} 
                              onChange={e => setSelectedSegment(e.target.value)}
                              className="bg-transparent font-bold text-xs outline-none uppercase min-w-[140px] cursor-pointer"
                            >
                               <option value="all">All Segments</option>
                               {intelligence.uniqueSegments.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                         </div>

                         <div className="hidden md:flex items-center gap-6 bg-white px-6 py-2.5 rounded-xl border border-slate-100 shadow-sm">
                            <div className="text-right">
                               <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Focus Profit</p>
                               <p className="text-sm font-black text-emerald-600">₹{Math.round(filteredItemsForLedger.reduce((acc, i) => acc + i.profitAmount, 0)).toLocaleString()}</p>
                            </div>
                            <div className="h-8 w-px bg-slate-100" />
                            <div className="text-right">
                               <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Focus Margin</p>
                               <p className="text-sm font-black text-indigo-600">{(filteredItemsForLedger.reduce((acc, i) => acc + i.marginPercent, 0) / (filteredItemsForLedger.length || 1)).toFixed(1)}%</p>
                            </div>
                         </div>
                      </div>
                   </div>

                   <div className="overflow-x-auto">
                      <table className="w-full text-left">
                         <thead className="bg-slate-50/80 border-b border-slate-100">
                            <tr>
                               <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Master SKU Detail</th>
                               <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Revenue (₹)</th>
                               <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Unit Sell (₹)</th>
                               <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Unit Cost (₹)</th>
                               <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Unit Margin %</th>
                               <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase text-right">Profit Amount (₹)</th>
                               <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Audit</th>
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-50">
                            {filteredItemsForLedger.sort((a,b) => b.profitAmount - a.profitAmount).map((item) => (
                               <tr key={item.name} className="hover:bg-slate-50/50 transition-colors group">
                                  <td className="px-10 py-6">
                                     <div className="flex items-center gap-4">
                                        <div className={`p-2 rounded-xl ${item.category === 'FOOD' ? 'bg-emerald-50 text-emerald-600' : 'bg-indigo-50 text-indigo-600'}`}>
                                           {item.category === 'FOOD' ? <Utensils size={14}/> : <Coffee size={14}/>}
                                        </div>
                                        <div>
                                           <p className="text-sm font-black text-slate-900 uppercase tracking-tight truncate max-w-[180px]">{item.name}</p>
                                           <p className="text-[9px] font-bold text-slate-400 uppercase">{item.segment} • {item.quantity} units</p>
                                        </div>
                                     </div>
                                  </td>
                                  <td className="px-10 py-6 text-right font-black text-slate-900">₹{item.revenue.toLocaleString()}</td>
                                  <td className="px-10 py-6 text-right font-black text-slate-700">₹{item.price.toFixed(0)}</td>
                                  <td className="px-10 py-6 text-right font-black text-rose-500">₹{item.cost.toFixed(1)}</td>
                                  <td className="px-10 py-6">
                                     <div className="flex items-center justify-center gap-3">
                                        <GradeBadge grade={item.grade} />
                                        <div className="flex flex-col items-center gap-1">
                                           <span className={`text-[10px] font-black ${item.marginPercent >= 65 ? 'text-emerald-600' : (item.marginPercent < 50 ? 'text-rose-600' : 'text-amber-600')}`}>
                                              {item.marginPercent.toFixed(1)}%
                                           </span>
                                           <div className="w-16 h-1 bg-slate-100 rounded-full overflow-hidden">
                                              <div className={`h-full rounded-full ${item.marginPercent >= 65 ? 'bg-emerald-500' : (item.marginPercent < 50 ? 'bg-rose-500' : 'bg-amber-500')}`} style={{ width: `${Math.min(100, item.marginPercent)}%` }} />
                                           </div>
                                        </div>
                                     </div>
                                  </td>
                                  <td className="px-10 py-6 text-right">
                                     <p className="text-md font-black text-slate-900 uppercase tracking-tighter">₹{Math.round(item.profitAmount).toLocaleString()}</p>
                                     <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Total Contribution</p>
                                  </td>
                                  <td className="px-10 py-6">
                                     <div className="flex justify-center">
                                        {item.hasCost ? (
                                           <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg shadow-inner"><CheckCircle2 size={14}/></div>
                                        ) : (
                                           <div className="p-1.5 bg-rose-50 text-rose-500 rounded-lg shadow-inner animate-pulse"><AlertTriangle size={14}/></div>
                                        )}
                                     </div>
                                  </td>
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                </section>
             </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PnLAnalytics;
