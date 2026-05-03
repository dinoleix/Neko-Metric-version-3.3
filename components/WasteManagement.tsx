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
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
import { 
  Trash2, 
  RefreshCw, 
  MapPin, 
  AlertTriangle, 
  CheckCircle2, 
  TrendingDown, 
  ShoppingCart, 
  ShoppingBag,
  ArrowDownRight,
  Zap,
  Scale,
  Flame,
  SearchX,
  Target,
  Utensils,
  Coffee,
  PackageCheck,
  ChevronDown,
  Loader2,
  Calendar,
  Smartphone,
  Layers,
  ArrowRight,
  Settings2,
  Info,
  HelpCircle,
  LayoutGrid,
  List,
  Eye,
  Activity
} from 'lucide-react';

type BurnViewMode = 'combined' | 'pos' | 'online';
type ItemsViewMode = 'grid' | 'list';

const WasteManagement: React.FC<{ user: User }> = ({ user }) => {
  const [itemSnapshots, setItemSnapshots] = useState<ItemMonthlySnapshot[]>([]);
  const [expenseSnapshots, setExpenseSnapshots] = useState<ExpenseMonthlySnapshot[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, SkuCategory>>({});
  const [adjustments, setAdjustments] = useState<CogsAdjustment[]>([]);
  const [cogsKeywords, setCogsKeywords] = useState<string[]>(DEFAULT_COGS);
  const [cogsBucketMapping, setCogsBucketMapping] = useState<Record<string, CogsBucket>>({});
  const [loading, setLoading] = useState(false);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [burnViewMode, setBurnViewMode] = useState<BurnViewMode>('combined');
  
  const [itemsViewMode, setItemsViewMode] = useState<ItemsViewMode>('grid');
  const [displayLimit, setDisplayLimit] = useState<number>(30);

  const fetchData = async () => {
    setLoading(true);
    try {
      const constraints = [where('userId', '==', user.uid)];
      const settingsRef = doc(db, 'category_settings', user.uid);

      const [iSnap, eSnap, cSnap, skuSnap, adjSnap, setSnap] = await Promise.all([
        getDocs(query(collection(db, 'item_snapshots'), ...constraints, where('year', '==', selectedYear))),
        getDocs(query(collection(db, 'expense_snapshots'), ...constraints, where('year', '==', selectedYear))),
        getDocs(query(collection(db, 'item_costs'), ...constraints)),
        getDocs(query(collection(db, 'sku_mappings'), ...constraints)),
        getDocs(query(collection(db, 'cogs_adjustments'), ...constraints, where('year', '==', selectedYear))),
        getDoc(settingsRef)
      ]);

      if (setSnap.exists()) {
        const d = setSnap.data() as CategorySettings;
        if (d.cogsKeywords) setCogsKeywords(d.cogsKeywords.map(k => k.trim().toUpperCase()));
        if (d.cogsBucketMapping) setCogsBucketMapping(d.cogsBucketMapping);
      }

      setItemSnapshots(iSnap.docs.map(d => d.data() as ItemMonthlySnapshot));
      setExpenseSnapshots(eSnap.docs.map(d => d.data() as ExpenseMonthlySnapshot));
      setItemCosts(cSnap.docs.map(d => d.data() as ItemCost));
      setAdjustments(adjSnap.docs.map(d => d.data() as CogsAdjustment));

      const mappingObj: Record<string, SkuCategory> = {};
      skuSnap.docs.forEach(d => {
        const data = d.data() as SkuMapping;
        mappingObj[data.itemName] = data.category;
      });
      setSkuMappings(mappingObj);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user, selectedYear, selectedMonth]);

  const intelligence = useMemo(() => {
    const filteredItemSnaps = itemSnapshots.filter(s => 
      (storeFilter === 'all' || s.outletId === storeFilter) && s.month === selectedMonth
    );
    const filteredExpSnaps = expenseSnapshots.filter(s => 
      (storeFilter === 'all' || s.outletId === storeFilter) && s.month === selectedMonth
    );
    const filteredAdjustments = adjustments.filter(a => 
      (storeFilter === 'all' || a.outletId === storeFilter) && a.month === selectedMonth
    );

    if (filteredItemSnaps.length === 0 && filteredExpSnaps.length === 0) return null;

    let theoreticalFoodSpend = 0;
    let theoreticalDrinksSpend = 0;
    const itemDrilldown: Record<string, { qty: number, revenue: number, theoreticalCost: number, category: SkuCategory, posQty: number, onlineQty: number, hasCost: boolean }> = {};

    filteredItemSnaps.forEach(snap => {
      Object.entries(snap.items).forEach(([name, data]: [string, any]) => {
        const costRecord = itemCosts.find(c => c.itemName === name);
        const unitCost = costRecord ? costRecord.costPerUnit : 0;
        const category = skuMappings[name] || 'UNMAPPED';
        
        const posQty = data.posQuantity ?? data.quantity;
        const onlineQty = data.onlineQuantity ?? 0;
        const totalQty = data.quantity;

        let activeQty = totalQty;
        if (burnViewMode === 'pos') activeQty = posQty;
        else if (burnViewMode === 'online') activeQty = onlineQty;

        const itemCostTotal = activeQty * unitCost;

        if (category === 'FOOD') theoreticalFoodSpend += (totalQty * unitCost);
        else if (category === 'DRINKS') theoreticalDrinksSpend += (totalQty * unitCost);

        if (!itemDrilldown[name]) {
          itemDrilldown[name] = { qty: 0, revenue: 0, theoreticalCost: 0, category, posQty: 0, onlineQty: 0, hasCost: unitCost > 0 };
        }
        itemDrilldown[name].qty += totalQty;
        itemDrilldown[name].posQty += posQty;
        itemDrilldown[name].onlineQty += onlineQty;
        itemDrilldown[name].revenue += data.revenue;
        itemDrilldown[name].theoreticalCost += itemCostTotal;
      });
    });

    let rawFoodCogs = 0;
    let rawDrinksCogs = 0;
    let rawMiscCogs = 0;
    let rawCogsTotal = 0;

    filteredExpSnaps.forEach(snap => {
      const process = (src: Record<string, number>) => {
        Object.entries(src || {}).forEach(([cat, amt]) => {
          const val = Number(amt || 0);
          const upper = cat.trim().toUpperCase();
          if (cogsKeywords.includes(upper)) {
            rawCogsTotal += val;
            const bucket = cogsBucketMapping[upper] || 'FOOD';
            if (bucket === 'FOOD' || bucket === 'FOOD SERVINGS') rawFoodCogs += val;
            else if (bucket === 'DRINKS' || bucket === 'DRINKS SERVINGS') rawDrinksCogs += val;
            else rawMiscCogs += val;
          }
        });
      };
      process(snap.purchaseByCategory || {});
      process(snap.expenseByCategory || {});
    });

    const totalOffset = filteredAdjustments.reduce((acc, a) => acc + a.adjustmentAmount, 0);
    
    let actualFoodPurchase = rawFoodCogs;
    let actualDrinksPurchase = rawDrinksCogs;
    let actualMiscCogs = rawMiscCogs;

    if (totalOffset > 0 && rawCogsTotal > 0) {
      const foodRatio = rawFoodCogs / rawCogsTotal;
      const drinkRatio = rawDrinksCogs / rawCogsTotal;
      const miscRatio = rawMiscCogs / rawCogsTotal;
      actualFoodPurchase -= (totalOffset * foodRatio);
      actualDrinksPurchase -= (totalOffset * drinkRatio);
      actualMiscCogs -= (totalOffset * miscRatio);
    }

    const foodVariance = Math.max(0, actualFoodPurchase - theoreticalFoodSpend);
    const drinksVariance = Math.max(0, actualDrinksPurchase - theoreticalDrinksSpend);
    const foodLeakagePercent = actualFoodPurchase > 0 ? (foodVariance / actualFoodPurchase) * 100 : 0;
    const drinkLeakagePercent = actualDrinksPurchase > 0 ? (drinksVariance / actualDrinksPurchase) * 100 : 0;

    const totalActual = actualFoodPurchase + actualDrinksPurchase + actualMiscCogs;
    const totalTheoretical = theoreticalFoodSpend + theoreticalDrinksSpend;
    const totalVariance = Math.max(0, totalActual - totalTheoretical);
    const globalLeakagePercent = totalActual > 0 ? (totalVariance / totalActual) * 100 : 0;

    let status: 'optimal' | 'warning' | 'critical' = 'optimal';
    if (globalLeakagePercent > 10) status = 'critical';
    else if (globalLeakagePercent > 5) status = 'warning';

    const drilldownItemsRaw = Object.entries(itemDrilldown)
      .filter(([_, data]) => {
        if (burnViewMode === 'pos') return data.posQty > 0;
        if (burnViewMode === 'online') return data.onlineQty > 0;
        return data.qty > 0;
      })
      .sort((a, b) => {
        if (b[1].theoreticalCost !== a[1].theoreticalCost) return b[1].theoreticalCost - a[1].theoreticalCost;
        return b[1].qty - a[1].qty;
      });

    const unmappedItemsCount = drilldownItemsRaw.filter(([_, data]) => !data.hasCost).length;

    return {
      totalActual,
      totalTheoretical,
      totalVariance,
      globalLeakagePercent,
      status,
      segments: {
        food: { actual: actualFoodPurchase, theoretical: theoreticalFoodSpend, variance: foodVariance, percent: foodLeakagePercent },
        drinks: { actual: actualDrinksPurchase, theoretical: theoreticalDrinksSpend, variance: drinksVariance, percent: drinkLeakagePercent },
        misc: { actual: actualMiscCogs }
      },
      itemDrilldown: drilldownItemsRaw.slice(0, displayLimit === 0 ? undefined : displayLimit),
      totalAvailableItems: drilldownItemsRaw.length,
      totalOffset,
      unmappedItemsCount
    };
  }, [itemSnapshots, expenseSnapshots, itemCosts, skuMappings, adjustments, selectedMonth, storeFilter, burnViewMode, displayLimit, cogsKeywords, cogsBucketMapping]);

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-rose-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-rose-100">
            <Trash2 size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Wastage Management</h2>
            <p className="text-slate-400 text-sm font-medium">Monitoring the gap between purchases and sales.</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2">
            <MapPin size={14} className="text-rose-500" />
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase">
              <option value="all">Global View</option>
              {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 font-bold text-xs outline-none shadow-sm">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 font-bold text-xs outline-none shadow-sm uppercase">{MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}</select>
          <button onClick={fetchData} className="p-3 bg-white rounded-xl border border-slate-100 text-slate-400 hover:text-rose-600 shadow-sm transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
          </button>
        </div>
      </header>

      {loading ? (
        <div className="py-40 text-center">
          <div className="w-12 h-12 border-4 border-rose-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Auditing Consumption Records...</p>
        </div>
      ) : !intelligence ? (
        <div className="py-32 bg-white rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
          <SearchX size={48} className="mx-auto text-slate-200 mb-4" />
          <h3 className="text-xl font-black text-slate-900">No Historical Snapshots</h3>
          <p className="text-slate-500 mt-2">Upload Sales and Purchase data for this month to see the waste radar.</p>
        </div>
      ) : (
        <>
          {intelligence.unmappedItemsCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 p-8 rounded-[2.5rem] flex items-start gap-6 animate-in slide-in-from-top-4 duration-500 shadow-sm">
               <div className="p-4 bg-amber-100 rounded-2xl text-amber-600 shadow-inner"><AlertTriangle size={32} /></div>
               <div className="flex-1">
                  <h4 className="text-lg font-black text-amber-900 uppercase tracking-tight mb-2">Unmapped Items Impacting Audit</h4>
                  <p className="text-sm font-medium text-amber-700 leading-relaxed mb-6">
                    We found <span className="font-black underline">{intelligence.unmappedItemsCount} items</span> that haven't been assigned a unit cost in Product Intelligence. 
                    This makes your theoretical burn look artificially low and increases your "Leakage" percentage.
                  </p>
                  <div className="flex gap-4">
                     <button className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-amber-700 shadow-lg shadow-amber-200 transition-all">
                        Map Costs Now <ArrowRight size={14}/>
                     </button>
                  </div>
               </div>
            </div>
          )}

          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Net Consumption (Burn)</p>
                <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{intelligence.totalActual.toLocaleString()}</h4>
              </div>
              <div className="mt-6 flex items-center gap-1.5 text-indigo-500 text-[10px] font-black uppercase">
                <ShoppingCart size={12} /> Matches Expense Radar COGS
              </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Theoretical Consumption</p>
                <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{intelligence.totalTheoretical.toLocaleString()}</h4>
              </div>
              <div className="mt-6 flex items-center gap-1.5 text-emerald-500 text-[10px] font-black uppercase">
                <ShoppingBag size={12} /> Expected Ingredient Burn
              </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 opacity-10"><Flame size={80} /></div>
              <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">Implicit Wastage</p>
              <h4 className="text-3xl font-black tracking-tighter text-rose-400">₹{intelligence.totalVariance.toLocaleString()}</h4>
              <p className="text-[9px] font-bold text-slate-500 uppercase mt-4">Direct Net Profit Drain</p>
            </div>

            <div className={`p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-center items-center text-center ${intelligence.status === 'optimal' ? 'bg-emerald-600 shadow-emerald-100' : (intelligence.status === 'warning' ? 'bg-amber-50 shadow-amber-100' : 'bg-rose-600 shadow-rose-100')}`}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-70">Leakage Signal</p>
              <h4 className="text-5xl font-black tracking-tighter">{intelligence.globalLeakagePercent.toFixed(1)}%</h4>
              <p className="text-[10px] font-black uppercase mt-4">
                {intelligence.status === 'optimal' ? 'Optimal Efficiency' : (intelligence.status === 'warning' ? 'High Variance' : 'Critical Leakage')}
              </p>
            </div>
          </section>

          <section className="bg-white rounded-[3.5rem] p-12 border border-slate-100 shadow-sm">
            <div className="flex flex-col lg:flex-row items-center gap-16">
              <div className="lg:w-1/3 text-center lg:text-left">
                <h3 className="text-3xl font-black text-slate-900 tracking-tight mb-4">The Leakage Radar</h3>
                <p className="text-slate-500 text-sm leading-relaxed mb-8">This gauge measures how much of your inventory is "disappearing" compared to what your menu sales suggest. Your target is a maximum of <span className="text-emerald-600 font-bold">5% deviation</span>.</p>
                <div className="inline-flex items-center gap-3 px-6 py-3 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className={`w-3 h-3 rounded-full animate-pulse ${intelligence.status === 'optimal' ? 'bg-emerald-500' : (intelligence.status === 'warning' ? 'bg-amber-500' : 'bg-rose-500')}`} />
                  <span className="text-[11px] font-black uppercase text-slate-700 tracking-widest">Live Auditor Active</span>
                </div>
              </div>

              <div className="flex-1 w-full max-w-2xl">
                 <div className="relative pt-10">
                    <div className="flex justify-between mb-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                       <span>Theoretical (0%)</span>
                       <span>Acceptable (5%)</span>
                       <span>Alert (10%+)</span>
                    </div>
                    <div className="h-6 bg-slate-100 rounded-full relative overflow-hidden shadow-inner p-1">
                       <div className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 rounded-full opacity-30" />
                       <div 
                          className={`absolute top-1 left-1 bottom-1 rounded-full transition-all duration-1000 shadow-lg ${intelligence.status === 'optimal' ? 'bg-emerald-500' : (intelligence.status === 'warning' ? 'bg-amber-500' : 'bg-rose-500')}`}
                          style={{ width: `calc(${Math.min(100, intelligence.globalLeakagePercent * 10)}% - 8px)` }}
                       />
                    </div>
                    <div className="mt-8 grid grid-cols-3 gap-1">
                       <div className="h-1 bg-emerald-500 rounded-l-full" />
                       <div className="h-1 bg-amber-400" />
                       <div className="h-1 bg-rose-500 rounded-r-full" />
                    </div>
                 </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-8 opacity-5"><Utensils size={100} /></div>
               <div className="flex justify-between items-start mb-8">
                  <div><h4 className="text-xl font-black text-slate-900">Food Division</h4><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Raw Ingredient & Kitchen Yield</p></div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Leakage</p>
                    <p className={`text-3xl font-black ${intelligence.segments.food.percent > 5 ? 'text-rose-500' : 'text-emerald-500'}`}>{intelligence.segments.food.percent.toFixed(1)}%</p>
                  </div>
               </div>
               <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                     <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Theoretical Burn</p>
                     <p className="text-lg font-black text-slate-900">₹{intelligence.segments.food.theoretical.toLocaleString()}</p>
                  </div>
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                     <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Actual Consumption</p>
                     <p className="text-lg font-black text-slate-900">₹{intelligence.segments.food.actual.toLocaleString()}</p>
                  </div>
               </div>
               <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-black uppercase text-slate-400"><span>Variance Efficiency</span><span>Gap: ₹{intelligence.segments.food.variance.toLocaleString()}</span></div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                     <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${Math.max(5, 100 - intelligence.segments.food.percent * 2)}%` }} />
                  </div>
               </div>
            </div>

            <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-8 opacity-5"><Coffee size={100} /></div>
               <div className="flex justify-between items-start mb-8">
                  <div><h4 className="text-xl font-black text-slate-900">Drinks Division</h4><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Beverage & Bar Inventory</p></div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Leakage</p>
                    <p className={`text-3xl font-black ${intelligence.segments.drinks.percent > 5 ? 'text-rose-500' : 'text-emerald-500'}`}>{intelligence.segments.drinks.percent.toFixed(1)}%</p>
                  </div>
               </div>
               <div className="grid grid-cols-2 gap-4 mb-8">
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                     <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Theoretical Burn</p>
                     <p className="text-lg font-black text-slate-900">₹{intelligence.segments.drinks.theoretical.toLocaleString()}</p>
                  </div>
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                     <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Actual Consumption</p>
                     <p className="text-lg font-black text-slate-900">₹{intelligence.segments.drinks.actual.toLocaleString()}</p>
                  </div>
               </div>
               <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-black uppercase text-slate-400"><span>Variance Efficiency</span><span>Gap: ₹{intelligence.segments.drinks.variance.toLocaleString()}</span></div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden shadow-inner">
                     <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.max(5, 100 - intelligence.segments.drinks.percent * 2)}%` }} />
                  </div>
               </div>
            </div>

            <div className="bg-slate-50 p-10 rounded-[3rem] border border-slate-100 shadow-sm relative overflow-hidden group">
               <div className="absolute top-0 right-0 p-8 opacity-5"><Settings2 size={100} /></div>
               <div className="flex justify-between items-start mb-8">
                  <div><h4 className="text-xl font-black text-slate-800">General COGS</h4><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Other Consumption Unmapped to Audit</p></div>
               </div>
               <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                  <p className="text-[9px] font-black text-slate-400 uppercase mb-2">Unmapped Burn</p>
                  <h5 className="text-2xl font-black text-slate-900">₹{intelligence.segments.misc.actual.toLocaleString()}</h5>
                  <div className="mt-4 p-4 bg-indigo-50 rounded-xl flex items-start gap-3">
                     <HelpCircle size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                     <p className="text-[9px] font-bold text-indigo-700 leading-relaxed uppercase tracking-tight">This includes keywords tagged as COGS but not assigned to Food or Drinks (e.g. Cleaning Supplies). It is included in your Burn Total but excluded from Leakage %.</p>
                  </div>
               </div>
            </div>
          </section>

          <section className="bg-white rounded-[3.5rem] p-12 border border-slate-100 shadow-sm">
             <div className="flex flex-col xl:flex-row xl:items-center justify-between mb-12 gap-8">
                <div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">Top Burn Items (Theoretical)</h3>
                  <p className="text-slate-400 text-sm font-medium mt-1">Analyzing segment-specific ingredient usage patterns.</p>
                </div>
                
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-xl border border-slate-100">
                    <span className="text-[9px] font-black text-slate-400 uppercase px-3">Limit</span>
                    {[30, 60, 100, 0].map(limit => (
                       <button 
                        key={limit}
                        onClick={() => setDisplayLimit(limit)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${displayLimit === limit ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                      >
                        {limit === 0 ? 'All' : limit}
                      </button>
                    ))}
                  </div>
                </div>
             </div>

             <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">Item Name</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Qty</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Theoretical Burn</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Revenue</th>
                      <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {intelligence.itemDrilldown.map(([name, data]) => (
                      <tr key={name} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4">
                          <p className="text-xs font-black text-slate-800 uppercase truncate max-w-[250px]">{name}</p>
                          <p className="text-[9px] font-bold text-slate-400 uppercase">{data.category}</p>
                        </td>
                        <td className="px-6 py-4 text-center font-bold text-slate-600">{data.qty}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-900">₹{data.theoreticalCost.toLocaleString()}</td>
                        <td className="px-6 py-4 text-right font-black text-indigo-600">₹{data.revenue.toLocaleString()}</td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center">
                            {data.hasCost ? (
                              <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg"><CheckCircle2 size={14}/></div>
                            ) : (
                              <div className="p-1.5 bg-rose-50 text-rose-500 rounded-lg animate-pulse"><AlertTriangle size={14}/></div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </section>
        </>
      )}
    </div>
  );
};

export default WasteManagement;