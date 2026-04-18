
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  ItemMonthlySnapshot, 
  ExpenseMonthlySnapshot,
  ItemCost,
  SkuMapping,
  CogsAdjustment,
  getOutletName,
  MASTER_OUTLETS,
  CogsBucket,
  SkuCategory,
  DEFAULT_COGS,
  CategorySettings,
  StoreRental,
  MenuNormalization,
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
import { 
  Zap, 
  RefreshCw, 
  MapPin, 
  AlertTriangle, 
  CheckCircle2, 
  ShoppingCart, 
  ShoppingBag,
  Utensils,
  Coffee,
  Box,
  Grape,
  ArrowRight,
  Loader2,
  CalendarDays,
  Target,
  TrendingDown,
  Layers,
  Scale,
  Activity,
  Info,
  ChevronDown,
  LayoutGrid,
  List,
  SearchX,
  ArrowUpRight,
  ArrowDownRight,
  BarChartHorizontal,
  ChevronRight,
  ListFilter,
  PieChart,
  FileSearch,
  LayoutList,
  Filter,
  Users,
  SearchCode,
  DollarSign
} from 'lucide-react';

type WasteTab = 'audit' | 'drift' | 'staff';

const PILLARS: { id: CogsBucket, label: string, icon: any, color: string, ring: string, hex: string }[] = [
  { id: 'FOOD', label: 'Food Ingredients', icon: Utensils, color: 'text-emerald-500', ring: 'ring-emerald-500', hex: '#10b981' },
  { id: 'DRINKS', label: 'Drinks Ingredients', icon: Coffee, color: 'text-indigo-500', ring: 'ring-indigo-500', hex: '#6366f1' },
  { id: 'FOOD SERVINGS', label: 'Food Packaging', icon: Box, color: 'text-amber-400', ring: 'ring-amber-500', hex: '#f59e0b' },
  { id: 'DRINKS SERVINGS', label: 'Drinks Packaging', icon: Grape, color: 'text-rose-500', ring: 'ring-rose-500', hex: '#f43f5e' }
];

const WasteManagementV2: React.FC<{ user: User }> = ({ user }) => {
  const [itemSnaps, setItemSnaps] = useState<ItemMonthlySnapshot[]>([]);
  const [expenseSnaps, setExpenseSnaps] = useState<ExpenseMonthlySnapshot[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, { category: SkuCategory, segment?: string }>>({});
  const [normalizationMap, setNormalizationMap] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<CogsAdjustment[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const [activeTab, setActiveTab] = useState<WasteTab>('audit');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [activeDrilldown, setActiveDrilldown] = useState<'ingredients' | 'packaging'>('ingredients');
  const [segmentFilter, setSegmentFilter] = useState('all');

  const fetchPrerequisites = async () => {
    try {
      const constraints = [where('userId', '==', user.uid)];
      const [cSnap, skuSnap, rSnap, normSnap] = await Promise.all([
        getDocs(query(collection(db, 'item_costs'), ...constraints)),
        getDocs(query(collection(db, 'sku_mappings'), ...constraints)),
        getDocs(query(collection(db, 'rentals'), ...constraints)),
        getDocs(query(collection(db, 'menu_normalization'), ...constraints))
      ]);
      
      const latestCostsMap = new Map<string, ItemCost>();
      cSnap.docs.forEach(d => {
        const data = d.data() as ItemCost;
        const key = (data.itemName || '').trim().toUpperCase();
        const existing = latestCostsMap.get(key);
        if (!existing || (data.updatedAt > existing.updatedAt)) {
          latestCostsMap.set(key, data);
        }
      });
      setItemCosts(Array.from(latestCostsMap.values()));
      setRentals(rSnap.docs.map(d => ({ id: d.id, ...d.data() } as StoreRental)));
      
      const nMap: Record<string, string> = {};
      normSnap.docs.forEach(d => {
        const data = d.data() as MenuNormalization;
        nMap[data.sourceName.trim().toUpperCase()] = data.masterName.trim().toUpperCase();
      });
      setNormalizationMap(nMap);

      const mappingObj: Record<string, { category: SkuCategory, segment?: string }> = {};
      skuSnap.docs.forEach(d => {
        const data = d.data() as SkuMapping;
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
      if (r.outletId === 'GLOBAL') return false;
      if (r.status === 'active') return true;
      if (r.status === 'closed' && r.closeDate) {
        return new Date(r.closeDate) >= periodStart;
      }
      return true;
    }).map(r => ({ id: r.outletId, name: r.storeName }));
  }, [rentals, selectedMonth, selectedYear]);

  const generateAudit = async () => {
    setLoading(true);
    try {
      const periodConstraints = [
        where('userId', '==', user.uid),
        where('year', '==', selectedYear),
        where('month', '==', selectedMonth)
      ];
      const [iSnap, eSnap, adjSnap] = await Promise.all([
        getDocs(query(collection(db, 'item_snapshots'), ...periodConstraints)),
        getDocs(query(collection(db, 'expense_snapshots'), ...periodConstraints)),
        getDocs(query(collection(db, 'cogs_adjustments'), ...periodConstraints))
      ]);
      setItemSnaps(iSnap.docs.map(d => d.data() as ItemMonthlySnapshot));
      setExpenseSnaps(eSnap.docs.map(d => d.data() as ExpenseMonthlySnapshot));
      setAdjustments(adjSnap.docs.map(d => d.data() as CogsAdjustment));
      setHasGenerated(true);
    } catch (err) {
      console.error(err);
      alert("Audit generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const intelligence = useMemo(() => {
    if (!hasGenerated) return null;
    const currentActiveIds = availableOutlets.map(o => o.id);
    const filteredItemSnaps = itemSnaps.filter(s => storeFilter === 'all' ? currentActiveIds.includes(s.outletId) : s.outletId === storeFilter);
    const filteredExpSnaps = expenseSnaps.filter(s => storeFilter === 'all' ? currentActiveIds.includes(s.outletId) : s.outletId === storeFilter);
    const filteredAdjustments = adjustments.filter(a => storeFilter === 'all' ? currentActiveIds.includes(a.outletId) : a.outletId === storeFilter);

    const targets: Record<CogsBucket, number> = { 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 };
    const itemAnalysis: Record<string, { qty: number, revenue: number, category: SkuCategory, segment: string, theoreticalIng: number, theoreticalServ: number, hasCost: boolean }> = {};
    const staffItems: Record<string, { qty: number, potentialRevenue: number, theoreticalCost: number, segment: string, category: SkuCategory, hasCost: boolean }> = {};

    filteredItemSnaps.forEach(snap => {
      const rental = rentals.find(r => r.outletId === snap.outletId);
      const tier = rental?.tier || 'TIER_1';

      Object.entries(snap.items).forEach(([name, data]: [string, any]) => {
        const masterName = (normalizationMap[name.trim().toUpperCase()] || name).trim().toUpperCase();
        const costRec = itemCosts.find(c => (c.itemName || '').trim().toUpperCase() === masterName);
        const mapping = skuMappings[masterName] || { category: 'UNMAPPED', segment: 'UNMAPPED' };
        
        const ingUnitCost = costRec ? (Number(costRec.costPerUnit) || 0) : 0;
        let servUnitCost = 0;
        if (costRec) {
          servUnitCost = tier === 'TIER_1' ? (costRec.tier1ServingsCost ?? costRec.servingsCostPerUnit ?? 0) : (costRec.tier2ServingsCost ?? costRec.servingsCostPerUnit ?? 0);
        }

        const activeCategory = (mapping.category === 'UNMAPPED' && costRec) ? 'FOOD' : mapping.category;
        const qty = data.quantity || 0;

        if (activeCategory === 'FOOD') {
          targets['FOOD'] += (qty * ingUnitCost);
          targets['FOOD SERVINGS'] += (qty * servUnitCost);
        } else if (activeCategory === 'DRINKS') {
          targets['DRINKS'] += (qty * ingUnitCost);
          targets['DRINKS SERVINGS'] += (qty * servUnitCost);
        }

        if (!itemAnalysis[masterName]) itemAnalysis[masterName] = { qty: 0, revenue: 0, category: activeCategory as SkuCategory, segment: mapping.segment || 'UNMAPPED', theoreticalIng: 0, theoreticalServ: 0, hasCost: !!costRec };
        itemAnalysis[masterName].qty += qty;
        itemAnalysis[masterName].revenue += (data.revenue || 0);
        itemAnalysis[masterName].theoreticalIng += (qty * ingUnitCost);
        itemAnalysis[masterName].theoreticalServ += (qty * servUnitCost);

        // AGGREGATE STAFF CONSUMPTION (Now using snapshot fields)
        if (data.staffQuantity > 0) {
          if (!staffItems[masterName]) staffItems[masterName] = { qty: 0, potentialRevenue: 0, theoreticalCost: 0, segment: mapping.segment || 'UNMAPPED', category: mapping.category, hasCost: !!costRec };
          staffItems[masterName].qty += data.staffQuantity;
          staffItems[masterName].potentialRevenue += (data.staffPotentialRevenue || 0);
          staffItems[masterName].theoreticalCost += (data.staffTheoreticalCost || 0);
        }
      });
    });

    const staffDrilldown = Object.entries(staffItems).sort((a, b) => b[1].theoreticalCost - a[1].theoreticalCost);
    const actuals: Record<CogsBucket, number> = { 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 };
    filteredExpSnaps.forEach(snap => {
      Object.entries(snap.cogsBucketAgg || {}).forEach(([bucket, amt]) => {
        if (actuals.hasOwnProperty(bucket)) actuals[bucket as CogsBucket] += Number(amt || 0);
        else actuals['UNCATEGORIZED'] += Number(amt || 0);
      });
    });

    const totalFoodIngOffset = filteredAdjustments.reduce((acc, a) => acc + (a.foodIngredientsAdjustment || 0), 0);
    const totalDrinkIngOffset = filteredAdjustments.reduce((acc, a) => acc + (a.drinkIngredientsAdjustment || 0), 0);
    const totalFoodPackOffset = filteredAdjustments.reduce((acc, a) => acc + (a.foodServingsAdjustment || 0), 0);
    const totalDrinkPackOffset = filteredAdjustments.reduce((acc, a) => acc + (a.drinkServingsAdjustment || 0), 0);

    actuals['FOOD'] = Math.max(0, actuals['FOOD'] - totalFoodIngOffset);
    actuals['DRINKS'] = Math.max(0, actuals['DRINKS'] - totalDrinkIngOffset);
    actuals['FOOD SERVINGS'] = Math.max(0, actuals['FOOD SERVINGS'] - totalFoodPackOffset);
    actuals['DRINKS SERVINGS'] = Math.max(0, actuals['DRINKS SERVINGS'] - totalDrinkPackOffset);

    const totalRevenue = Object.values(itemAnalysis).reduce((acc, i) => acc + i.revenue, 0);
    const totalUniqueProducts = Object.keys(itemAnalysis).length;
    const unmappedProductCount = Object.values(itemAnalysis).filter(i => !i.hasCost).length;
    const unmappedSkuPercent = totalUniqueProducts > 0 ? (unmappedProductCount / totalUniqueProducts) * 100 : 0;
    
    // Revenue coverage per category
    const coverageByBucket: Record<string, number> = { 'FOOD': 1, 'DRINKS': 1, 'FOOD SERVINGS': 1, 'DRINKS SERVINGS': 1 };
    ['FOOD', 'DRINKS'].forEach(cat => {
      const catItems = Object.values(itemAnalysis).filter(i => i.category === cat);
      const catRev = catItems.reduce((acc, i) => acc + i.revenue, 0);
      const mappedCatRev = catItems.filter(i => i.hasCost).reduce((acc, i) => acc + i.revenue, 0);
      const coverage = catRev > 0 ? mappedCatRev / catRev : 1;
      coverageByBucket[cat] = coverage;
      coverageByBucket[`${cat} SERVINGS`] = coverage;
    });

    const pillarMetrics = PILLARS.map(p => {
      const actual = Math.max(0, actuals[p.id] || 0);
      const theoretical = targets[p.id] || 0;
      const coverage = coverageByBucket[p.id] || 1;
      
      // Adjusted Actual: We only compare the portion of the actual cost that corresponds to mapped revenue
      const adjustedActual = actual * coverage;
      const variance = Math.max(0, adjustedActual - theoretical);
      const leakage = adjustedActual > 0 ? (variance / adjustedActual) * 100 : 0;
      
      return { ...p, actual, theoretical, variance, leakage, coveragePct: coverage * 100 };
    });

    const totalActualCOGS = Object.values(actuals).reduce((a, b) => a + (b || 0), 0);
    const totalTheoreticalCOGS = Object.values(targets).reduce((a, b) => a + (b || 0), 0);
    
    const ingMappedActual = (actuals['FOOD'] * coverageByBucket['FOOD']) + (actuals['DRINKS'] * coverageByBucket['DRINKS']);
    const packMappedActual = (actuals['FOOD SERVINGS'] * coverageByBucket['FOOD SERVINGS']) + (actuals['DRINKS SERVINGS'] * coverageByBucket['DRINKS SERVINGS']);
    
    const ingWaste = Math.max(0, ingMappedActual - (targets['FOOD'] + targets['DRINKS']));
    const packWaste = Math.max(0, packMappedActual - (targets['FOOD SERVINGS'] + targets['DRINKS SERVINGS']));
    const coverageGap = totalActualCOGS - (ingMappedActual + packMappedActual);
    const totalWastage = ingWaste + packWaste;

    return { 
      pillarMetrics, totalActual: totalActualCOGS, totalTheoretical: totalTheoreticalCOGS, totalRevenue, totalWastage, 
      unmappedSkuPercent, unmappedProductCount,
      itemDrilldown: Object.entries(itemAnalysis).filter(([_, d]) => d.category !== 'MISC' && d.qty > 0 && (segmentFilter === 'all' || d.segment === segmentFilter)).sort((a,b) => (activeDrilldown === 'ingredients' ? b[1].theoreticalIng - a[1].theoreticalIng : b[1].theoreticalServ - a[1].theoreticalServ)),
      availableSegments: Array.from(new Set(Object.values(itemAnalysis).map(i => i.segment))).filter(Boolean).sort(),
      staffDrilldown,
      waterfall: [
        { label: 'Gross Yield', val: totalRevenue, color: '#1e293b', isPositive: true },
        { label: 'Ing. Costs', val: targets['FOOD'] + targets['DRINKS'], color: '#6366f1', isPositive: false },
        { label: 'Ing. Waste', val: ingWaste, color: '#f43f5e', isPositive: false },
        { label: 'Pack. Costs', val: targets['FOOD SERVINGS'] + targets['DRINKS SERVINGS'], color: '#f59e0b', isPositive: false },
        { label: 'Pack. Waste', val: packWaste, color: '#fb7185', isPositive: false },
        { label: 'Coverage Gap', val: coverageGap, color: '#94a3b8', isPositive: false },
        { label: 'Realized Margin', val: Math.max(0, totalRevenue - totalActualCOGS), color: '#10b981', isPositive: true, isFinal: true }
      ]
    };
  }, [itemSnaps, expenseSnaps, itemCosts, skuMappings, normalizationMap, adjustments, hasGenerated, storeFilter, selectedMonth, selectedYear, rentals, activeDrilldown, segmentFilter, availableOutlets]);

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100"><Zap size={28} /></div>
          <div><h2 className="text-3xl font-black text-slate-900 tracking-tight">Waste Radar <span className="text-indigo-600">v2</span></h2><p className="text-slate-400 text-sm font-medium uppercase tracking-widest flex items-center gap-2"><RefreshCw size={14} className="text-indigo-400" /> Multi-Pillar Material Reconciliation</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-100"><MapPin size={14} className="text-indigo-500" /><select value={storeFilter} onChange={e => { setStoreFilter(e.target.value); setHasGenerated(false); }} className="bg-transparent font-bold text-xs outline-none uppercase cursor-pointer"><option value="all">All Active Outlets</option>{availableOutlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-100"><CalendarDays size={14} className="text-indigo-500" /><select value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setHasGenerated(false); }} className="bg-transparent font-bold text-xs outline-none uppercase cursor-pointer">{MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}</select><select value={selectedYear} onChange={e => { setSelectedYear(e.target.value); setHasGenerated(false); }} className="bg-transparent font-bold text-xs outline-none cursor-pointer">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
          <button onClick={generateAudit} disabled={loading} className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 transition-all shadow-lg"><Activity size={14} /> Run Audit</button>
        </div>
      </header>

      {!hasGenerated ? (
        <section className="py-40 bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 text-center animate-in zoom-in-95"><div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-8 text-indigo-300"><Layers size={48} /></div><h3 className="text-3xl font-black text-slate-900 tracking-tight">Performance Aggregation Active</h3><p className="text-slate-500 mt-3 font-medium max-w-md mx-auto leading-relaxed uppercase tracking-widest text-[10px]">Select scope and run audit to view relational drift.</p></section>
      ) : intelligence && (
        <div className="animate-in fade-in duration-500 space-y-12">
           <div className="flex bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner gap-1">
             <button onClick={() => setActiveTab('audit')} className={`px-10 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'audit' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><PieChart size={16}/> Executive Audit</button>
             <button onClick={() => setActiveTab('drift')} className={`px-10 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'drift' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><LayoutList size={16}/> Theoretical SKU Drift</button>
             <button onClick={() => setActiveTab('staff')} className={`px-10 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'staff' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Users size={16}/> Staff Consumption</button>
           </div>

           {intelligence.unmappedProductCount > 0 && (
             <div className="bg-rose-50 border border-rose-100 p-6 rounded-[2rem] flex items-center gap-5 slide-in-from-top-4 animate-in duration-500">
               <div className="p-3 bg-rose-500 text-white rounded-2xl shadow-lg shadow-rose-200">
                 <AlertTriangle size={20} />
               </div>
               <div className="flex-1">
                 <h4 className="text-sm font-black text-rose-900 uppercase tracking-tight">{intelligence.unmappedSkuPercent.toFixed(1)}% of SKUs have no cost assigned</h4>
                 <p className="text-rose-600 text-xs font-medium">Fix {intelligence.unmappedProductCount} items in <strong>Item Costs</strong> to improve reconciliation accuracy and remove drift noise.</p>
               </div>
               <button onClick={() => setActiveTab('drift')} className="px-6 py-2.5 bg-rose-100 text-rose-700 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-rose-200 transition-all">Identify Items</button>
             </div>
           )}

           {activeTab === 'audit' && (
             <div className="space-y-12 animate-in slide-in-from-left-4 duration-500">
                <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                  {intelligence.pillarMetrics.map((p) => (
                    <div key={p.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between group hover:shadow-xl transition-all hover:-translate-y-1">
                      <div className="flex justify-between items-start mb-6">
                        <div className={`p-3 rounded-2xl bg-slate-50 ${p.color} shadow-inner`}><p.icon size={20} /></div>
                        <div className="flex flex-col items-end gap-1.5">
                          <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${p.leakage > 8 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            {(p.leakage ?? 0).toFixed(1)}% Leakage
                          </div>
                          <div className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-tight ${p.coveragePct < 90 ? 'text-amber-500 bg-amber-50' : 'text-slate-400 bg-slate-50'}`}>
                            {p.coveragePct.toFixed(0)}% Coverage
                          </div>
                        </div>
                      </div>
                      <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{p.label}</p><h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{(p.actual ?? 0).toLocaleString()}</h4><div className="mt-4 space-y-2"><div className="flex justify-between text-[9px] font-bold uppercase tracking-tight"><span className="text-slate-400">Target Burn</span><span className="text-slate-700">₹{(p.theoretical ?? 0).toLocaleString()}</span></div><div className="h-1.5 bg-slate-100 rounded-full overflow-hidden shadow-inner"><div className={`h-full rounded-full transition-all duration-1000 ${p.leakage > 8 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(5, 100 - (p.leakage * 5))}%` }} /></div></div></div>
                    </div>
                  ))}
                </section>
                <section className="bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden">
                  <div className="flex flex-col md:flex-row md:items-center justify-between mb-16 gap-8">
                    <div><h3 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3"><BarChartHorizontal className="text-indigo-600" /> Strategic Yield Waterfall</h3><p className="text-slate-400 text-sm font-medium mt-1 uppercase tracking-widest">Revenue Erosion Audit: Snapshot Aggregated Data</p></div>
                    <div className="flex items-center gap-10 bg-slate-50 p-6 rounded-[2rem] border border-slate-100 shadow-inner">
                        <div className="text-center"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Drift (Waste)</p><p className="text-2xl font-black text-rose-500">₹{(intelligence.totalWastage ?? 0).toLocaleString()}</p></div>
                        <div className="h-10 w-px bg-slate-200" /><div className="text-center"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Retention Rate</p><p className="text-2xl font-black text-emerald-600">{((Math.max(0, intelligence.totalRevenue - intelligence.totalActual) / (intelligence.totalRevenue || 1)) * 100).toFixed(1)}%</p></div>
                    </div>
                  </div>
                  <div className="relative w-full h-[400px]"><svg viewBox="0 0 1000 400" className="w-full h-full overflow-visible" preserveAspectRatio="none">{[0, 0.5, 1].map((p, idx) => (<line key={idx} x1="60" y1={350 - (p * 300)} x2="950" y2={350 - (p * 300)} stroke="#f1f5f9" strokeWidth="1" />))}<line x1="60" y1={350} x2="950" y2={350} stroke="#e2e8f0" strokeWidth="2" />{(() => { const max = intelligence.totalRevenue || 1; const steps = intelligence.waterfall; const barWidth = 100; const spacing = (890 - steps.length * barWidth) / (steps.length + 1); let currentBaseline = 0; return steps.map((step, i) => { const x = 60 + spacing + i * (barWidth + spacing); let y, height; if (i === 0) { const vH = (step.val / max) * 300; y = 350 - vH; height = vH; currentBaseline = step.val; } else if (step.isFinal) { const vH = (step.val / max) * 300; y = 350 - vH; height = vH; } else { const sV = currentBaseline; const eV = currentBaseline - step.val; const sY = 350 - (sV / max) * 300; const eY = 350 - (eV / max) * 300; y = Math.min(sY, eY); height = Math.max(4, Math.abs(sY - eY)); currentBaseline = eV; } return (<g key={i} className="group"><rect x={x} y={y} width={barWidth} height={height} fill={step.color} rx="8" className="transition-all duration-1000 ease-out hover:opacity-80 shadow-md" /><text x={x + barWidth/2} y="380" textAnchor="middle" className="text-[10px] font-black fill-slate-400 uppercase tracking-tighter">{step.label}</text><text x={x + barWidth/2} y={y - 12} textAnchor="middle" className={`text-[11px] font-black ${step.isPositive ? 'fill-slate-900' : 'fill-rose-500'}`}>{step.isPositive ? '' : '-'}{Math.round(step.val).toLocaleString()}</text>{i > 0 && !step.isFinal && (<line x1={x - spacing} y1={y} x2={x} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />)}</g>); }); })()}</svg></div>
                </section>
             </div>
           )}

           {activeTab === 'drift' && (
             <section className="bg-white rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden animate-in slide-in-from-right-4 duration-500">
                <div className="p-12 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-8 bg-slate-50/50">
                  <div className="flex items-center gap-4"><div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><List size={28}/></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Theoretical SKU Drift</h3><p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Snapshot Aggregated Multi-layer Audit</p></div></div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="bg-white px-4 py-2 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2"><Filter size={14} className="text-indigo-500" /><select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} className="bg-transparent font-bold text-[10px] outline-none uppercase cursor-pointer min-w-[120px]"><option value="all">All Segments</option>{intelligence.availableSegments.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                    <div className="flex bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm"><button onClick={() => setActiveDrilldown('ingredients')} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeDrilldown === 'ingredients' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-500'}`}><Utensils size={14}/> Ingredients</button><button onClick={() => setActiveDrilldown('packaging')} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeDrilldown === 'packaging' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-500'}`}><Box size={14}/> Packaging</button></div>
                  </div>
                </div>
                <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="bg-slate-50/80 border-b border-slate-100"><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Menu Item SKU</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Unit Sales</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Target Burn</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Revenue Yield</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Audit Status</th></tr></thead><tbody className="divide-y divide-slate-50">{intelligence.itemDrilldown.map(([name, data]) => { const theoreticalCost = activeDrilldown === 'ingredients' ? data.theoreticalIng : data.theoreticalServ; return (<tr key={name} className="group hover:bg-slate-50/50 transition-colors"><td className="px-12 py-6"><div className="flex items-center gap-4"><div className={`p-2 rounded-xl text-white ${data.category === 'FOOD' ? 'bg-emerald-500' : 'bg-indigo-500'}`}>{data.category === 'FOOD' ? <Utensils size={12}/> : <Coffee size={12}/>}</div><div><p className="text-sm font-black text-slate-900 uppercase tracking-tight">{name}</p><p className="text-[9px] font-bold text-slate-400 uppercase">{data.segment} • {data.category} DIVISION</p></div></div></td><td className="px-12 py-6 text-center font-black text-slate-600">{data.qty}</td><td className="px-12 py-6 text-right font-black text-slate-900">₹{Math.round(theoreticalCost).toLocaleString()}</td><td className="px-12 py-6 text-right font-black text-indigo-600">₹{Math.round(data.revenue).toLocaleString()}</td><td className="px-12 py-6"><div className="flex justify-center">{data.hasCost ? <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase tracking-widest"><CheckCircle2 size={12}/> Mapped</div> : <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-500 rounded-full text-[9px] font-black uppercase animate-pulse"><AlertTriangle size={12}/> Unlinked</div>}</div></td></tr>); })}</tbody></table></div>
             </section>
           )}

           {activeTab === 'staff' && (
             <section className="bg-white rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden animate-in zoom-in-95 duration-500">
                <div className="p-12 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-8 bg-slate-50/50">
                   <div className="flex items-center gap-4"><div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><Users size={28}/></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Staff Consumption Audit</h3><p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Aggregated NC- bill tracking (Pre-calculated in Snapshots)</p></div></div>
                   <div className="flex gap-4"><div className="bg-white px-6 py-4 rounded-2xl border border-slate-100 shadow-sm"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Lost Market Value</p><p className="text-xl font-black text-indigo-600">₹{Math.round(intelligence.staffDrilldown.reduce((acc, item) => acc + item[1].potentialRevenue, 0)).toLocaleString()}</p></div><div className="bg-white px-6 py-4 rounded-2xl border border-slate-100 shadow-sm"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Internal Cost Burn</p><p className="text-xl font-black text-rose-500">₹{Math.round(intelligence.staffDrilldown.reduce((acc, item) => acc + item[1].theoreticalCost, 0)).toLocaleString()}</p></div></div>
                </div>
                <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="bg-slate-50/80 border-b border-slate-100"><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Consumed SKU</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Unit Count</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Burn Cost (₹)</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Market Value (₹)</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Integrity</th></tr></thead><tbody className="divide-y divide-slate-50">{intelligence.staffDrilldown.length === 0 ? (<tr><td colSpan={5} className="py-20 text-center"><SearchCode size={40} className="mx-auto text-slate-200 mb-4" /><p className="text-slate-400 font-black uppercase text-xs">No aggregate staff logs detected</p></td></tr>) : intelligence.staffDrilldown.map(([name, data]) => (<tr key={name} className="group hover:bg-slate-50/50 transition-colors"><td className="px-12 py-6"><div className="flex items-center gap-4"><div className={`p-2 rounded-xl text-white ${data.category === 'FOOD' ? 'bg-emerald-500' : 'bg-indigo-500'}`}>{data.category === 'FOOD' ? <Utensils size={12}/> : <Coffee size={12}/>}</div><div><p className="text-sm font-black text-slate-900 uppercase tracking-tight">{name}</p><p className="text-[9px] font-bold text-slate-400 uppercase">{data.segment} • {data.category}</p></div></div></td><td className="px-12 py-6 text-center font-black text-slate-600">{data.qty}</td><td className="px-12 py-6 text-right font-black text-rose-500">₹{Math.round(data.theoreticalCost).toLocaleString()}</td><td className="px-12 py-6 text-right font-black text-indigo-600">₹{Math.round(data.potentialRevenue).toLocaleString()}</td><td className="px-12 py-6"><div className="flex justify-center">{data.hasCost ? (<div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg shadow-inner"><CheckCircle2 size={14}/></div>) : (<div className="p-1.5 bg-rose-50 text-rose-500 rounded-lg animate-pulse"><AlertTriangle size={14}/></div>)}</div></td></tr>))}</tbody></table></div>
             </section>
           )}
        </div>
      )}
    </div>
  );
};

export default WasteManagementV2;
