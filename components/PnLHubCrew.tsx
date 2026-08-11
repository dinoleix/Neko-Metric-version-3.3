
import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { getCachedCollection } from '../referenceCache';
import { computeConsumption, closingStockTotal, openingStockTotal, openingByBucket, closingByBucket, hasImpossibleStock } from '../pnlService';
import { 
  SalesMonthlySnapshot, 
  ExpenseMonthlySnapshot, 
  ItemMonthlySnapshot,
  Employee, 
  StoreRental, 
  CogsAdjustment, 
  MonthlyPayroll,
  DailySalesLog,
  getOutletName,
  CategorySettings, 
  SkuMapping,
  SkuCategory,
  DEFAULT_COGS, 
  DEFAULT_LABOUR, 
  DEFAULT_OPS,
  YEAR_OPTIONS,
  MONTH_NAMES,
  MASTER_OUTLETS
} from '../types';
import { 
  PieChart, 
  RefreshCw, 
  ArrowUpRight, 
  ArrowDownRight, 
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Store,
  Users,
  Calculator,
  Scale,
  Percent,
  CalendarDays,
  Activity,
  ShoppingCart,
  MapPin,
  PackageCheck,
  Save,
  Loader2,
  CheckCircle2,
  X,
  Lock,
  Unlock,
  Building2,
  ChevronDown,
  Check,
  Info,
  AlertTriangle,
  HelpCircle,
  Settings2,
  Banknote,
  Zap,
  ListFilter,
  ArrowDownCircle,
  Layers,
  Utensils,
  Coffee,
  Ticket,
  ClipboardList,
  Target,
  ChevronRight,
  BarChartHorizontal,
  Flame,
  Wallet,
  Box,
  Grape,
  Eye,
  LineChart as LineChartIcon
} from 'lucide-react';
import PnLPerformanceTrends from './PnLPerformanceTrends';

type DetailTab = 'statement' | 'waterfall' | 'pnl-waterfall' | 'performance-trends' | 'audit-log';

const PnLHubCrew: React.FC<{ user: User; dataOwnerId: string; readOnly?: boolean }> = ({ user, dataOwnerId, readOnly = false }) => {
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [expenseSnaps, setExpenseSnaps] = useState<ExpenseMonthlySnapshot[]>([]);
  const [dailySalesLogs, setDailySalesLogs] = useState<DailySalesLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [adjustments, setAdjustments] = useState<CogsAdjustment[]>([]);
  const [monthlyPayrolls, setMonthlyPayrolls] = useState<MonthlyPayroll[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>('statement');

  const [cogsKeywords, setCogsKeywords] = useState<string[]>(DEFAULT_COGS);
  const [labourKeywords, setLabourKeywords] = useState<string[]>(DEFAULT_LABOUR);
  const [opsKeywords, setOpsKeywords] = useState<string[]>(DEFAULT_OPS);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>(['all']);
  const [isOutletDropdownOpen, setIsOutletDropdownOpen] = useState(false);
  
  // Stock Adjustment States (Split into buckets)
  const [isStockModalOpen, setIsStockModalOpen] = useState(false);
  const [editingStock, setEditingStock] = useState<Record<string, { food: number, drinks: number, foodIngredients: number, drinkIngredients: number, foodIngredientsOpening: number, drinkIngredientsOpening: number, foodServingsOpening: number, drinkServingsOpening: number }>>({});
  const [isSavingStock, setIsSavingStock] = useState(false);
  const [isCarrying, setIsCarrying] = useState(false);

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

  const fetchData = async () => {
    setLoading(true);
    try {
      const periodConstraints = [
        where('userId', '==', dataOwnerId),
        where('year', '==', selectedYear),
        where('month', '==', selectedMonth)
      ];

      const settingsRef = doc(db, 'category_settings', dataOwnerId);

      // daily_sales_logs has no year/month fields — it's a plain YYYY-MM-DD
      // date string, so the period needs a range query instead of equality.
      const monthIdx = MONTH_NAMES.indexOf(selectedMonth);
      const rangeStart = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}-01`;
      const rangeEnd = `${selectedYear}-${String(monthIdx + 1).padStart(2, '0')}-31`;

      // Two legs: ownerId covers crew-written logs, userId covers logs an admin
      // submitted directly themselves. Isolated try/catch per leg — SalesHub's
      // reconciliation fetch hit a bug where one leg failing (e.g. a missing
      // composite index) silently discarded the OTHER leg's results too.
      const fetchDailySalesLeg = async (field: 'ownerId' | 'userId') => {
        try {
          const snap = await getDocs(query(collection(db, 'daily_sales_logs'),
            where(field, '==', dataOwnerId), where('date', '>=', rangeStart), where('date', '<=', rangeEnd)));
          return snap.docs;
        } catch (err) {
          console.warn(`[PnLHubCrew] daily_sales_logs ${field} query failed:`, err);
          return [];
        }
      };

      const [sSnaps, eSnaps, emp, rent, adj, pay, setSnap, dsByOwner, dsByUser] = await Promise.all([
        getDocs(query(collection(db, 'sales_snapshots'), ...periodConstraints)),
        getDocs(query(collection(db, 'expense_snapshots'), ...periodConstraints)),
        getCachedCollection<Employee>('employees', dataOwnerId),
        getCachedCollection<StoreRental>('rentals', dataOwnerId),
        getDocs(query(collection(db, 'cogs_adjustments'), ...periodConstraints)),
        getDocs(query(collection(db, 'monthly_payrolls'), ...periodConstraints)),
        getDoc(settingsRef),
        fetchDailySalesLeg('ownerId'),
        fetchDailySalesLeg('userId')
      ]);

      const seenLogIds = new Set<string>();
      const mergedLogs: DailySalesLog[] = [];
      [...dsByOwner, ...dsByUser].forEach(d => {
        if (!seenLogIds.has(d.id)) { seenLogIds.add(d.id); mergedLogs.push({ id: d.id, ...d.data() } as DailySalesLog); }
      });
      setDailySalesLogs(mergedLogs);

      if (setSnap.exists()) {
        const data = setSnap.data() as CategorySettings;
        // Normalize on read. Keywords are stored exactly as typed, and every
        // comparison below is against an upper-cased category — without this,
        // a keyword saved as "Vegetables" or " Milk " silently failed to match
        // here (and only here), dropping that spend out of COGS into unmapped.
        const norm = (l: string[]) => l.map(k => (k || '').trim().toUpperCase());
        if (data.cogsKeywords) setCogsKeywords(norm(data.cogsKeywords));
        if (data.labourKeywords) setLabourKeywords(norm(data.labourKeywords));
        if (data.opsKeywords) setOpsKeywords(norm(data.opsKeywords));
      }
      
      setSalesSnaps(sSnaps.docs.map(d => d.data() as SalesMonthlySnapshot));
      setExpenseSnaps(eSnaps.docs.map(d => d.data() as ExpenseMonthlySnapshot));
      setEmployees(emp);
      setRentals(rent);
      setAdjustments(adj.docs.map(d => d.data() as CogsAdjustment));
      setMonthlyPayrolls(pay.docs.map(d => d.data() as MonthlyPayroll));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user, selectedYear, selectedMonth]);

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
      return false;
    }).map(r => ({ id: r.outletId, name: r.storeName }));
  }, [rentals, selectedMonth, selectedYear]);

  useEffect(() => {
    if (selectedOutlets.includes('all')) return;
    const availableIds = availableOutlets.map(o => o.id);
    const next = selectedOutlets.filter(id => availableIds.includes(id));
    if (next.length === 0) setSelectedOutlets(['all']);
    else if (next.length !== selectedOutlets.length) setSelectedOutlets(next);
  }, [availableOutlets, selectedOutlets]);

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

  const handleOpenStock = () => {
    if (readOnly) return;
    const currentFilterOutlets = selectedOutlets.includes('all') 
      ? availableOutlets.map(o => o.id)
      : selectedOutlets;
    
    const initialValues: Record<string, { food: number, drinks: number, foodIngredients: number, drinkIngredients: number, foodIngredientsOpening: number, drinkIngredientsOpening: number, foodServingsOpening: number, drinkServingsOpening: number }> = {};
    currentFilterOutlets.forEach(oId => {
      const existing = adjustments.find(a => a.outletId === oId);
      initialValues[oId] = {
        food: existing?.foodServingsAdjustment || 0,
        drinks: existing?.drinkServingsAdjustment || 0,
        foodIngredients: existing?.foodIngredientsAdjustment || 0,
        drinkIngredients: existing?.drinkIngredientsAdjustment || 0,
        foodIngredientsOpening: existing?.foodIngredientsOpening || 0,
        drinkIngredientsOpening: existing?.drinkIngredientsOpening || 0,
        foodServingsOpening: existing?.foodServingsOpening || 0,
        drinkServingsOpening: existing?.drinkServingsOpening || 0
      };
    });
    setEditingStock(initialValues);
    setIsStockModalOpen(true);
  };

  const handleSaveStock = async () => {
    if (readOnly) return;
    setIsSavingStock(true);
    try {
      const batch = writeBatch(db);
      for (const outletId in editingStock) {
        const adjId = `${user.uid}_${outletId}_${selectedYear}_${selectedMonth}`;
        const adjRef = doc(db, 'cogs_adjustments', adjId);
        const { food, drinks, foodIngredients, drinkIngredients, foodIngredientsOpening, drinkIngredientsOpening, foodServingsOpening, drinkServingsOpening } = editingStock[outletId];
        batch.set(adjRef, {
          userId: user.uid,
          outletId,
          year: selectedYear,
          month: selectedMonth,
          foodServingsAdjustment: food,
          drinkServingsAdjustment: drinks,
          foodIngredientsAdjustment: foodIngredients,
          drinkIngredientsAdjustment: drinkIngredients,
          foodIngredientsOpening,
          drinkIngredientsOpening,
          foodServingsOpening,
          drinkServingsOpening,
          adjustmentAmount: food + drinks + foodIngredients + drinkIngredients, // Keep total for legacy dashboard support
          lastUpdated: Date.now()
        }, { merge: true });
      }
      await batch.commit();
      setIsStockModalOpen(false);
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to save closing stock.");
    } finally {
      setIsSavingStock(false);
    }
  };

  // Pull the previous month's CLOSING ingredient stock into this month's OPENING fields.
  // Ingredients only (packaging flows in via purchase files); values stay editable before saving.
  const handleCarryForward = async () => {
    if (readOnly) return;
    setIsCarrying(true);
    try {
      const curIdx = MONTH_NAMES.indexOf(selectedMonth);
      const prevIdx = (curIdx + 11) % 12;
      const prevMonth = MONTH_NAMES[prevIdx];
      const prevYear = curIdx === 0 ? (parseInt(selectedYear) - 1).toString() : selectedYear;

      const prevSnap = await getDocs(query(
        collection(db, 'cogs_adjustments'),
        where('userId', '==', dataOwnerId),
        where('year', '==', prevYear),
        where('month', '==', prevMonth)
      ));
      const prevAdjustments = prevSnap.docs.map(d => d.data() as CogsAdjustment);

      let foundAny = false;
      const next = { ...editingStock };
      Object.keys(next).forEach(oId => {
        const prior = prevAdjustments.find(a => a.outletId === oId);
        if (prior) foundAny = true;
        next[oId] = {
          ...next[oId],
          foodIngredientsOpening: prior?.foodIngredientsAdjustment || 0,
          drinkIngredientsOpening: prior?.drinkIngredientsAdjustment || 0,
          foodServingsOpening: prior?.foodServingsAdjustment || 0,
          drinkServingsOpening: prior?.drinkServingsAdjustment || 0
        };
      });
      setEditingStock(next);

      if (!foundAny) {
        alert(`No closing stock found for ${prevMonth} ${prevYear}. Opening set to 0 — adjust manually if needed.`);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to pull opening stock from last month.");
    } finally {
      setIsCarrying(false);
    }
  };

  const pnlData = useMemo(() => {
    const monthIdx = MONTH_NAMES.indexOf(selectedMonth);
    const selectedYearNum = parseInt(selectedYear);
    const periodStart = new Date(selectedYearNum, monthIdx, 1);
    const periodEnd = new Date(selectedYearNum, monthIdx + 1, 0);

    const currentFilterOutlets = selectedOutlets.includes('all') 
      ? availableOutlets.map(o => o.id)
      : selectedOutlets;

    const filteredSalesSnaps = salesSnaps.filter(s => currentFilterOutlets.includes(s.outletId));
    const filteredExpenseSnaps = expenseSnaps.filter(s => currentFilterOutlets.includes(s.outletId));
    const filteredDailySalesLogs = dailySalesLogs.filter(l => currentFilterOutlets.includes(l.outletId));

    // 1. REVENUE (CASH YIELD) — POS/counter comes from Crew Terminal's daily
    // till counts instead of the CSV snapshot; Online + Event stay CSV-sourced
    // since Crew Terminal never captures aggregator or event revenue.
    // Till counts are already net (no GST split, no card-fee breakdown at the
    // till), so there's no tax component to carve out of them.
    const crewCounterNet = filteredDailySalesLogs.reduce((acc, l) => acc + (l.totalNet || 0), 0);
    const posGoodGross = crewCounterNet;
    const posGoodTax = 0;
    const posGoodNet = crewCounterNet;

    const onlineGoodGross = filteredSalesSnaps.reduce((acc, s) => acc + (s.onlineGoodGross || 0), 0);
    const eventRevenue = filteredSalesSnaps.reduce((acc, s) => acc + (s.eventRevenue || 0), 0);
    const grossGoodRevenue = posGoodGross + onlineGoodGross + eventRevenue;

    const onlineGoodTax = filteredSalesSnaps.reduce((acc, s) => acc + (s.onlineGoodTax || 0), 0);
    const onlineGoodComm = filteredSalesSnaps.reduce((acc, s) => acc + (s.onlineGoodComm || 0), 0);
    const onlineGoodAds = filteredSalesSnaps.reduce((acc, s) => acc + (s.onlineGoodAds || 0), 0);
    const onlineGoodNet = filteredSalesSnaps.reduce((acc, s) => acc + (s.onlineGoodNet || 0), 0);
    
    const netCashInflow = posGoodNet + onlineGoodNet + eventRevenue;

    // 2. MATERIALS (COGS)
    let rawCogs = 0;
    let csvVariableLabour = 0;
    let mappedOps = 0;
    let unmappedExp = 0;

    filteredExpenseSnaps.forEach(snap => {
      const processMap = (map: Record<string, number>) => {
        Object.entries(map || {}).forEach(([cat, amount]) => {
          const magnitude = Math.abs(amount || 0);
          const upper = cat.trim().toUpperCase();
          if (cogsKeywords.includes(upper)) rawCogs += magnitude;
          else if (labourKeywords.includes(upper)) csvVariableLabour += magnitude;
          else if (opsKeywords.includes(upper)) mappedOps += magnitude;
          else unmappedExp += magnitude;
        });
      };
      processMap(snap.expenseByCategory);
      processMap(snap.purchaseByCategory);
      processMap(snap.crewExpenseByCategory || {});
      processMap(snap.crewPurchaseByCategory || {});
    });

    const scopedAdjustments = adjustments.filter(a => currentFilterOutlets.includes(a.outletId));
    const cogsAdj = closingStockTotal(scopedAdjustments);
    const closing = closingByBucket(scopedAdjustments);
    const foodIngredientsAdj = closing['FOOD'];
    const drinkIngredientsAdj = closing['DRINKS'];
    const foodServingsAdj = closing['FOOD SERVINGS'];
    const drinkServingsAdj = closing['DRINKS SERVINGS'];

    // Opening stock carried over from prior month's closing (all four buckets).
    // Defaults to 0, so months without an opening value behave identically to before.
    const opening = openingByBucket(scopedAdjustments);
    const foodIngredientsOpening = opening['FOOD'];
    const drinkIngredientsOpening = opening['DRINKS'];
    const foodServingsOpening = opening['FOOD SERVINGS'];
    const drinkServingsOpening = opening['DRINKS SERVINGS'];
    const openingIngredients = foodIngredientsOpening + drinkIngredientsOpening;
    const openingServings = foodServingsOpening + drinkServingsOpening;
    const openingStock = openingStockTotal(scopedAdjustments);

    // Consumption = Opening + Purchases − Closing
    const adjustedCOGS = computeConsumption(rawCogs, scopedAdjustments);
    const stockDataSuspect = hasImpossibleStock(rawCogs, scopedAdjustments);

    // 3. FIXED BURDEN
    let fixedPayroll = 0;
    let payrollValidated = true;

    currentFilterOutlets.forEach(oId => {
      const rental = rentals.find(r => r.outletId === oId);
      let multiplier = 1.0;
      if (rental?.status === 'closed' && rental.closeDate) {
        const cDate = new Date(rental.closeDate);
        if (cDate < periodStart) multiplier = 0.0;
        else if (cDate < periodEnd) multiplier = cDate.getDate() / periodEnd.getDate();
      }

      const fiscalLog = monthlyPayrolls.find(p => p.outletId === oId);
      if (fiscalLog) {
        fixedPayroll += fiscalLog.totalAmount;
      } else {
        payrollValidated = false;
        fixedPayroll += (employees.filter(e => e.outletId === oId).reduce((acc, e) => acc + (e.currentSalary || 0), 0)) * multiplier;
      }
    });

    const totalRent = rentals
      .filter(r => currentFilterOutlets.includes(r.outletId))
      .reduce((acc, r) => {
        let multiplier = 1.0;
        if (r.status === 'closed' && r.closeDate) {
          const cDate = new Date(r.closeDate);
          if (cDate < periodStart) multiplier = 0.0;
          else if (cDate < periodEnd) multiplier = cDate.getDate() / periodEnd.getDate();
        }
        return acc + (r.currentRent * multiplier);
      }, 0);

    // 4. THE BOTTOM LINE RECONCILIATION
    const contributionMargin = netCashInflow - adjustedCOGS;
    const totalPayroll = fixedPayroll + csvVariableLabour;
    const operatingBurn = totalPayroll + totalRent + mappedOps + unmappedExp;
    const netProfit = contributionMargin - totalPayroll - totalRent - mappedOps - unmappedExp;

    const denominator = grossGoodRevenue || 1;

    return {
      grossGoodRevenue, posGoodGross, onlineGoodGross, eventRevenue, posGoodTax, onlineGoodTax, onlineGoodComm, onlineGoodAds,
      posGoodNet, onlineGoodNet, netCashInflow, adjustedCOGS, cogsAdj, rawCogs, contributionMargin,
      foodIngredientsAdj, drinkIngredientsAdj, foodServingsAdj, drinkServingsAdj,
      openingIngredients, foodIngredientsOpening, drinkIngredientsOpening,
      openingServings, foodServingsOpening, drinkServingsOpening, openingStock,
      mappedOps, csvVariableLabour, fixedPayroll, totalPayroll, totalRent, unmappedExp, operatingBurn,
      netProfit, payrollValidated, stockDataSuspect,
      margins: {
        contributionPercent: (contributionMargin / denominator) * 100,
        netProfitMargin: (netProfit / denominator) * 100,
        cogsPercent: (adjustedCOGS / denominator) * 100,
        labourPercent: (totalPayroll / denominator) * 100,
        rentPercent: (totalRent / denominator) * 100,
        opsPercent: (mappedOps / denominator) * 100
      }
    };
  }, [salesSnaps, expenseSnaps, dailySalesLogs, monthlyPayrolls, rentals, adjustments, selectedYear, selectedMonth, selectedOutlets, employees, cogsKeywords, labourKeywords, opsKeywords, availableOutlets]);

  const waterfallSteps = useMemo(() => {
    return [
      { label: 'Gross Revenue', val: pnlData.grossGoodRevenue, color: '#1e293b', type: 'start' },
      { label: 'Tax & Commissions', val: pnlData.posGoodTax + pnlData.onlineGoodTax + pnlData.onlineGoodComm + pnlData.onlineGoodAds, color: '#f43f5e', type: 'expense' },
      { label: 'COGS', val: pnlData.adjustedCOGS, color: '#f59e0b', type: 'expense' },
      { label: 'Labour Cost', val: pnlData.totalPayroll, color: '#6366f1', type: 'expense' },
      { label: 'Store Rent', val: pnlData.totalRent, color: '#ec4899', type: 'expense' },
      { label: 'Operations', val: pnlData.mappedOps, color: '#94a3b8', type: 'expense' },
      { label: 'Other/Unmapped', val: pnlData.unmappedExp, color: '#fb7185', type: 'expense' },
      { label: 'Net Profit', val: pnlData.netProfit, color: '#10b981', type: 'final' }
    ].filter(s => s.type !== 'expense' || s.val > 0);
  }, [pnlData]);

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
            <PieChart size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">P&L Command (Crew)</h2>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Counter revenue from Crew Terminal till counts vs operational burn.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
           <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-slate-100 shadow-sm">
             <div className="relative" ref={dropdownRef}>
                <button onClick={() => setIsOutletDropdownOpen(!isOutletDropdownOpen)} className="bg-slate-50 px-5 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-3 hover:border-indigo-200 min-w-[220px]">
                  <Building2 size={16} className="text-indigo-500 shrink-0" />
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
                      <span className="text-[11px] font-black uppercase">All Active Units</span>
                      {selectedOutlets.includes('all') && <Check size={14} />}
                    </button>
                    <div className="h-px bg-slate-50 my-2" />
                    {availableOutlets.map(o => (<button key={o.id} onClick={() => toggleOutlet(o.id)} className={`w-full flex items-center justify-between p-3 rounded-xl transition-all text-left ${selectedOutlets.includes(o.id) && !selectedOutlets.includes('all') ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50'}`}><span className="text-[11px] font-bold uppercase">{o.name}</span>{selectedOutlets.includes(o.id) && !selectedOutlets.includes('all') && <Check size={14} />}</button>))}
                  </div>
                )}
             </div>
             
             <div className="bg-slate-50 px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2">
               <CalendarDays size={14} className="text-indigo-500" />
               <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent font-bold text-xs outline-none">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select>
               <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase">{MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}</select>
             </div>
           </div>

           <div className="flex items-center gap-3">
             {!readOnly ? (
               <>
                 <button onClick={handleOpenStock} className="px-5 py-2.5 bg-white rounded-xl border border-slate-100 text-slate-500 font-black uppercase text-[10px] tracking-widest flex items-center gap-3 hover:border-indigo-200 hover:text-indigo-600 shadow-sm transition-all">
                    <PackageCheck size={16} />
                    Closing Stock
                 </button>
               </>
             ) : (
               <div className="px-4 py-2.5 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 flex items-center gap-2 font-black text-[10px] uppercase tracking-widest">
                 <Eye size={16} /> Read Only
               </div>
             )}
             <button onClick={fetchData} className="p-3 bg-white rounded-xl border border-slate-100 text-slate-400 hover:text-indigo-600 shadow-sm transition-colors">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
            </button>
           </div>
        </div>
      </header>
      
      {/* REST OF THE COMPONENT REMAINS THE SAME */}
      {loading ? (
        <div className="py-48 text-center"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-6" /><p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Assembling Multi-Dimensional Audit...</p></div>
      ) : (
        <div className="space-y-12 animate-in fade-in duration-700">
          
          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
               <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gross Revenue</p>
                  <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{pnlData.grossGoodRevenue.toLocaleString()}</h4>
               </div>
               <div className="mt-6 flex items-center gap-2 text-slate-300 text-[10px] font-black uppercase"><Store size={12}/> Crew Till Base</div>
            </div>

            <div className="bg-slate-950 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
               <div className="absolute top-6 right-6 p-3 bg-white/5 rounded-full flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform"><CheckCircle2 size={24} className="text-emerald-400" /></div>
               <div>
                  <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Good Revenue</p>
                  <h4 className="text-3xl font-black tracking-tighter text-white">₹{pnlData.grossGoodRevenue.toLocaleString()}</h4>
               </div>
               <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                 <div className="flex justify-between text-[9px] font-black uppercase"><span className="text-slate-500">Counter (Crew Till)</span><span className="text-slate-200">₹{pnlData.posGoodGross.toLocaleString()}</span></div>
                 <div className="flex justify-between text-[9px] font-black uppercase"><span className="text-indigo-400">Online</span><span className="text-slate-200">₹{pnlData.onlineGoodGross.toLocaleString()}</span></div>
               </div>
            </div>

            <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden group">
               <div>
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">Total Net Revenue</p>
                  <h4 className="text-3xl font-black tracking-tighter text-emerald-400">₹{pnlData.netCashInflow.toLocaleString()}</h4>
               </div>
               <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                 <div className="flex justify-between text-[9px] font-black uppercase"><span className="text-slate-500">Counter Net (Crew)</span><span className="text-slate-200">₹{pnlData.posGoodNet.toLocaleString()}</span></div>
                 <div className="flex justify-between text-[9px] font-black uppercase"><span className="text-indigo-400">Online Net</span><span className="text-slate-200">₹{pnlData.onlineGoodNet.toLocaleString()}</span></div>
               </div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
               <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Adjusted COGS</p>
                  <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{pnlData.adjustedCOGS.toLocaleString()}</h4>
               </div>
               <div className="mt-6 flex items-center gap-1.5 text-indigo-500 text-[10px] font-black uppercase"><PackageCheck size={12}/> Consumables Focus</div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
               <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Gross Margin</p>
                  <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{pnlData.margins.contributionPercent.toFixed(1)}%</h4>
               </div>
               <div className="mt-6 flex items-center gap-2 text-emerald-500 text-[10px] font-black uppercase"><TrendingUp size={12}/> CP Efficiency</div>
            </div>

            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
               <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Operating Burn</p>
                  <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{pnlData.operatingBurn.toLocaleString()}</h4>
               </div>
               <div className="mt-6 flex items-center gap-1.5 text-rose-400 text-[10px] font-black uppercase"><Flame size={12}/> Total Opex</div>
            </div>

            <div className="bg-indigo-900 p-8 rounded-[2.5rem] text-white shadow-2xl flex flex-col justify-between">
               <div>
                  <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-1">Net Margin</p>
                  <h4 className="text-3xl font-black tracking-tighter">{pnlData.margins.netProfitMargin.toFixed(1)}%</h4>
               </div>
               <div className="mt-6 flex items-center gap-2 text-indigo-300 text-[10px] font-black uppercase"><Zap size={12}/> Profit Signal</div>
            </div>

            <div className={`p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between transition-colors duration-500 ${pnlData.netProfit >= 0 ? 'bg-emerald-600 shadow-emerald-900/40' : 'bg-rose-600 shadow-rose-900/40'}`}>
               <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Net Monthly Profit</p>
                  <h4 className="text-3xl font-black tracking-tighter">₹{pnlData.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h4>
               </div>
               <div className="mt-6 flex items-center gap-2 text-[10px] font-black uppercase">
                 {pnlData.netProfit >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}
                 {pnlData.netProfit >= 0 ? 'Surplus' : 'Deficit'} Detected
               </div>
            </div>
          </section>
          
          <div className="flex flex-wrap bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner gap-1">
             <button onClick={() => setActiveDetailTab('statement')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeDetailTab === 'statement' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Scale size={16} /> Fiscal Statement</button>
             <button onClick={() => setActiveDetailTab('performance-trends')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeDetailTab === 'performance-trends' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><LineChartIcon size={16} /> Performance Trends</button>
             <button onClick={() => setActiveDetailTab('pnl-waterfall')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeDetailTab === 'pnl-waterfall' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><BarChartHorizontal size={16} /> Profit Waterfall</button>
             <button onClick={() => setActiveDetailTab('waterfall')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeDetailTab === 'waterfall' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><ArrowDownCircle size={16} /> Burn Velocity</button>
          </div>

          <section className="animate-in slide-in-from-bottom-2 duration-500">
             {activeDetailTab === 'statement' ? (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
                   <div className="lg:col-span-3 bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm space-y-10">
                      <div className="flex items-center justify-between">
                         <h3 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3"><Activity size={24} className="text-indigo-600"/> Settled Income Statement</h3>
                         <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-xl border border-slate-100 font-black text-[9px] text-slate-400 uppercase tracking-widest">Fiscal Period: {selectedMonth}</div>
                      </div>

                      <div className="space-y-4">
                         <div className="pb-6 border-b border-slate-50">
                            <div className="flex justify-between items-center mb-4">
                               <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Good Revenue (Settled Sales)</span>
                               <span className="text-xl font-black text-slate-900">₹{pnlData.grossGoodRevenue.toLocaleString()}</span>
                            </div>
                         </div>

                         <div className="py-4 border-b border-slate-50 px-6">
                            <div className="flex justify-between text-rose-500 text-sm font-bold uppercase italic">
                               <span>(-) Platform Leakage & Good Tax</span>
                               <span>(₹{(pnlData.posGoodTax + pnlData.onlineGoodTax + pnlData.onlineGoodComm + pnlData.onlineGoodAds).toLocaleString()})</span>
                            </div>
                         </div>

                         <div className="py-6 bg-slate-900 rounded-3xl px-8 text-white flex justify-between items-center shadow-xl">
                            <span className="text-sm font-black uppercase tracking-widest text-emerald-400">Net Inflow (Spendable Cash Yield)</span>
                            <span className="text-2xl font-black text-indigo-400">₹{pnlData.netCashInflow.toLocaleString()}</span>
                         </div>

                         <div className="py-8 border-b border-slate-50">
                            <div className="flex justify-between items-center mb-4">
                               <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Adjusted COGS (Consumption)</span>
                               <span className="text-xl font-black text-slate-900">₹{pnlData.adjustedCOGS.toLocaleString()}</span>
                            </div>
                            <div className="space-y-2 px-6">
                               <div className="flex justify-between text-sm font-medium text-slate-500 italic"><span>Raw Material Inflow</span><span>₹{pnlData.rawCogs.toLocaleString()}</span></div>
                               {pnlData.openingStock > 0 && (
                                 <>
                                   <div className="flex justify-between text-sm font-black text-rose-600"><span>(+) Opening Stock</span><span>+₹{pnlData.openingStock.toLocaleString()}</span></div>
                                   {/* Broken out the same four ways as closing stock below, so each
                                       bucket's movement can be read off directly */}
                                   <div className="pl-4 space-y-1 opacity-60">
                                      <div className="flex justify-between text-[10px] font-bold uppercase"><span>Food Ingredients</span><span>+₹{pnlData.foodIngredientsOpening.toLocaleString()}</span></div>
                                      <div className="flex justify-between text-[10px] font-bold uppercase"><span>Drink Ingredients</span><span>+₹{pnlData.drinkIngredientsOpening.toLocaleString()}</span></div>
                                      <div className="flex justify-between text-[10px] font-bold uppercase"><span>Food Packaging</span><span>+₹{pnlData.foodServingsOpening.toLocaleString()}</span></div>
                                      <div className="flex justify-between text-[10px] font-bold uppercase"><span>Drink Packaging</span><span>+₹{pnlData.drinkServingsOpening.toLocaleString()}</span></div>
                                   </div>
                                 </>
                               )}
                               <div className="flex justify-between text-sm font-black text-emerald-600"><span>(-) Unused Stock Adjustment</span><span>-₹{pnlData.cogsAdj.toLocaleString()}</span></div>
                               <div className="pl-4 space-y-1 opacity-60">
                                  <div className="flex justify-between text-[10px] font-bold uppercase"><span>Food Ingredients</span><span>-₹{pnlData.foodIngredientsAdj.toLocaleString()}</span></div>
                                  <div className="flex justify-between text-[10px] font-bold uppercase"><span>Drink Ingredients</span><span>-₹{pnlData.drinkIngredientsAdj.toLocaleString()}</span></div>
                                  <div className="flex justify-between text-[10px] font-bold uppercase"><span>Food Packaging</span><span>-₹{pnlData.foodServingsAdj.toLocaleString()}</span></div>
                                  <div className="flex justify-between text-[10px] font-bold uppercase"><span>Drink Packaging</span><span>-₹{pnlData.drinkServingsAdj.toLocaleString()}</span></div>
                               </div>
                            </div>
                         </div>

                         <div className="py-6 bg-indigo-50 border border-indigo-100 rounded-3xl px-8 text-indigo-900 flex justify-between items-center">
                            <span className="text-sm font-black uppercase tracking-widest">Contribution Margin</span>
                            <span className="text-2xl font-black">₹{pnlData.contributionMargin.toLocaleString()}</span>
                         </div>

                         <div className="py-8 space-y-4">
                            <span className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Operational Burden</span>
                            <div className="space-y-3 px-6">
                               <div className="flex justify-between text-sm font-medium text-slate-600">
                                  <span className="flex items-center gap-2">Base Fixed Payroll {pnlData.payrollValidated ? <Lock size={12} className="text-emerald-500"/> : <Unlock size={12} className="text-orange-400"/>}</span>
                                  <span>₹{pnlData.fixedPayroll.toLocaleString()}</span>
                               </div>
                               <div className="flex justify-between text-sm font-medium text-slate-600"><span>Daily Wages & Incentives (CSV)</span><span>₹{pnlData.csvVariableLabour.toLocaleString()}</span></div>
                               <div className="flex justify-between text-sm font-medium text-slate-600"><span>Store Lease (Rent)</span><span>₹{pnlData.totalRent.toLocaleString()}</span></div>
                               <div className="flex justify-between text-sm font-medium text-slate-600"><span>Operational Utility Spend</span><span>₹{pnlData.mappedOps.toLocaleString()}</span></div>
                               {pnlData.unmappedExp > 0 && (
                                 <div className="flex justify-between text-sm font-black text-rose-600"><span>Miscellaneous Leakage (Unmapped)</span><span>₹{pnlData.unmappedExp.toLocaleString()}</span></div>
                               )}
                            </div>
                         </div>

                         <div className={`py-8 rounded-[3rem] px-10 flex justify-between items-center text-white shadow-2xl transition-all duration-1000 ${pnlData.netProfit >= 0 ? 'bg-emerald-600 shadow-emerald-900/40' : 'bg-rose-600 shadow-rose-900/40'}`}>
                            <div className="flex items-center gap-6">
                               <div className="p-4 bg-white/10 rounded-2xl shadow-inner"><Target size={32} /></div>
                               <div>
                                  <p className="text-[10px] font-black uppercase tracking-widest opacity-70">Bottom Line Result</p>
                                  <span className="text-3xl font-black tracking-tight uppercase">Net Monthly Profit</span>
                                </div>
                            </div>
                            <span className="text-5xl font-black tracking-tighter">₹{pnlData.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                         </div>
                      </div>
                   </div>

                   <div className="lg:col-span-2 space-y-8">
                      <div className="bg-slate-900 p-10 rounded-[3rem] text-white shadow-xl relative overflow-hidden">
                         <div className="absolute top-0 right-0 p-6 opacity-5"><Target size={140} /></div>
                         <h4 className="text-xl font-black uppercase tracking-tight mb-8">Margin Efficiency</h4>
                         <div className="space-y-8">
                            {[
                               { label: 'COGS %', val: pnlData.margins.cogsPercent, color: 'bg-amber-500', icon: <ShoppingCart size={14}/> },
                               { label: 'LABOUR %', val: pnlData.margins.labourPercent, color: 'bg-indigo-500', icon: <Users size={14}/> },
                               { label: 'FIXED COST %', val: pnlData.margins.rentPercent, color: 'bg-rose-500', icon: <Building2 size={14}/> },
                               { label: 'OPS %', val: pnlData.margins.opsPercent, color: 'bg-pink-500', icon: <Settings2 size={14}/> }
                            ].map(g => (
                              <div key={g.label}>
                                 <div className="flex justify-between items-center mb-3">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">{g.icon} {g.label}</span>
                                    <span className="text-xs font-black">{g.val.toFixed(1)}%</span>
                                 </div>
                                 <div className="h-1.5 bg-white/5 rounded-full overflow-hidden shadow-inner">
                                    <div className={`h-full ${g.color} transition-all duration-1000 ease-out`} style={{ width: `${Math.min(100, g.val)}%` }} />
                                 </div>
                              </div>
                            ))}
                         </div>
                      </div>

                      <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex items-center gap-8 relative overflow-hidden">
                        <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner shrink-0"><ShieldCheck size={32}/></div>
                        <div><h4 className="text-lg font-black text-slate-900 uppercase tracking-tight">Audit Stability</h4><p className="text-[11px] text-slate-500 leading-relaxed font-bold uppercase">All line items map 1:1 with source records.</p></div>
                      </div>
                   </div>
                </div>
             ) : activeDetailTab === 'pnl-waterfall' ? (
                <div className="bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm space-y-12 overflow-hidden">
                   <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-4 bg-indigo-50 text-indigo-600 rounded-[1.5rem] shadow-inner"><BarChartHorizontal size={28}/></div>
                        <div>
                           <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Yield Erosion Waterfall</h3>
                           <p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Bridging Gross Revenue to Net Cash Profit</p>
                        </div>
                      </div>
                   </div>

                   <div className="relative w-full h-[500px] mt-10">
                      <svg viewBox="0 0 1000 450" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                         {[0, 0.25, 0.5, 0.75, 1].map((p, idx) => (
                           <line key={idx} x1="60" y1={400 - (p * 350)} x2="950" y2={400 - (p * 350)} stroke="#f1f5f9" strokeWidth="1" />
                         ))}
                         <line x1="60" y1={400} x2="950" y2={400} stroke="#e2e8f0" strokeWidth="2" />

                         {(() => {
                            const max = pnlData.grossGoodRevenue || 1;
                            const steps = waterfallSteps;
                            const barWidth = 80;
                            const spacing = (890 - steps.length * barWidth) / (steps.length + 1);
                            let currentBaseline = 0;

                            return steps.map((step, i) => {
                               const x = 60 + spacing + i * (barWidth + spacing);
                               let y, height;

                               if (step.type === 'start') {
                                  const valHeight = (step.val / max) * 350;
                                  y = 400 - valHeight;
                                  height = valHeight;
                                  currentBaseline = step.val;
                               } else if (step.type === 'final') {
                                  const valHeight = (Math.max(0, step.val) / max) * 350;
                                  y = 400 - valHeight;
                                  height = valHeight;
                               } else {
                                  const startValue = currentBaseline;
                                  const endValue = currentBaseline - step.val;
                                  const startY = 400 - (startValue / max) * 350;
                                  const endY = 400 - (endValue / max) * 350;
                                  y = Math.min(startY, endY);
                                  height = Math.max(4, Math.abs(startY - endY));
                                  currentBaseline = endValue;
                               }

                               return (
                                  <g key={i} className="group">
                                     <rect x={x} y={y} width={barWidth} height={height} fill={step.color} rx="8" className="transition-all duration-1000 ease-out hover:opacity-80 shadow-sm" />
                                     <text x={x + barWidth/2} y="430" textAnchor="middle" className="text-[9px] font-black fill-slate-400 uppercase tracking-tighter">{step.label}</text>
                                     <text x={x + barWidth/2} y={y - 12} textAnchor="middle" className={`text-[10px] font-black ${step.type === 'expense' ? 'fill-rose-500' : 'fill-slate-900'}`}>
                                        {step.type === 'expense' ? '-' : ''}₹{Math.round(Math.abs(step.val)).toLocaleString()}
                                     </text>
                                     {i > 0 && step.type !== 'final' && (
                                        <line x1={x - spacing} y1={y} x2={x} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />
                                     )}
                                  </g>
                               );
                            });
                         })()}
                      </svg>
                   </div>
                </div>
             ) : activeDetailTab === 'performance-trends' ? (
                <PnLPerformanceTrends
                  user={user}
                  dataOwnerId={dataOwnerId}
                  selectedOutlets={selectedOutlets}
                  rentals={rentals}
                />
             ) : activeDetailTab === 'waterfall' ? (
                <div className="bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm space-y-12">
                   <div className="flex items-center gap-4"><div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><Calculator size={24}/></div><h3 className="text-2xl font-black text-slate-900 uppercase">Waterfall Math Verification</h3></div>
                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
                      {[
                        { label: 'Net Inflow', val: pnlData.netCashInflow, color: 'bg-slate-900', text: 'text-white' },
                        { label: '(-) COGS', val: -pnlData.adjustedCOGS, color: 'bg-amber-100', text: 'text-amber-900' },
                        { label: '(-) Payroll', val: -pnlData.totalPayroll, color: 'bg-indigo-100', text: 'text-indigo-900' },
                        { label: '(-) Rent', val: -pnlData.totalRent, color: 'bg-rose-100', text: 'text-rose-900' },
                        { label: '(-) Ops Spend', val: -pnlData.mappedOps, color: 'bg-slate-100', text: 'text-slate-600' },
                        { label: '(-) Unmapped', val: -pnlData.unmappedExp, color: 'bg-rose-50', text: 'text-rose-700' },
                        { label: 'Net Profit', val: pnlData.netProfit, color: 'bg-emerald-600', text: 'text-white' }
                      ].map(step => (
                        <div key={step.label} className={`p-6 rounded-[2rem] ${step.color} ${step.text} flex flex-col justify-between min-h-[140px]`}>
                           <p className="text-[9px] font-black uppercase tracking-widest opacity-60">{step.label}</p>
                           <p className="text-md font-black">₹{Math.abs(step.val).toLocaleString()}</p>
                        </div>
                      ))}
                   </div>
                   <div className="p-10 bg-slate-900 rounded-[2.5rem] text-white flex flex-col md:flex-row items-center justify-between gap-10">
                      <div className="flex items-center gap-6">
                         <div className="p-4 bg-emerald-500 rounded-2xl shadow-lg"><Scale size={32}/></div>
                         <div>
                            <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">Final Reconciled Bottom Line</p>
                            <h4 className="text-4xl font-black tracking-tighter">₹{pnlData.netProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h4>
                         </div>
                      </div>
                      <div className="text-right text-slate-400 text-[10px] font-medium max-w-sm leading-relaxed uppercase tracking-wide">
                        Validation: ₹{pnlData.contributionMargin.toLocaleString()} (Contrib) - ₹{pnlData.totalPayroll.toLocaleString()} (Labour) - ₹{pnlData.totalRent.toLocaleString()} (Rent) - ₹{pnlData.mappedOps.toLocaleString()} (Ops) - ₹{pnlData.unmappedExp.toLocaleString()} (Unmapped) = ₹{pnlData.netProfit.toLocaleString(undefined, {minimumFractionDigits: 2})}.
                      </div>
                   </div>
                </div>
             ) : null}
          </section>
        </div>
      )}

      {isStockModalOpen && !readOnly && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setIsStockModalOpen(false)} />
           <div className="relative w-full max-w-xl bg-white rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
              <header className="p-8 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-amber-100 text-amber-600 rounded-2xl"><PackageCheck size={28} /></div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-900">Define Closing Stock</h3>
                       <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">{selectedMonth} {selectedYear}</p>
                    </div>
                 </div>
                 <button onClick={() => setIsStockModalOpen(false)} className="p-2 bg-slate-50 rounded-xl text-slate-400 hover:text-slate-900"><X size={20}/></button>
              </header>
              <div className="p-8 space-y-8 max-h-[50vh] overflow-y-auto custom-scrollbar">
                 <button onClick={handleCarryForward} disabled={isCarrying} className="w-full py-3.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 hover:bg-amber-100 transition-all disabled:opacity-50 active:scale-[0.99]">
                    {isCarrying ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownCircle size={14} />} Pull Opening from Last Month's Closing
                 </button>
                 <div className="space-y-6">
                    {Object.keys(editingStock).map(oId => (
                       <div key={oId} className="p-6 bg-slate-50 border border-slate-100 rounded-[2.5rem] space-y-4">
                          <div className="flex items-center gap-4 border-b border-slate-100 pb-4 mb-2">
                             <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 border border-slate-100 shadow-sm"><MapPin size={18} /></div>
                             <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Outlet</p><p className="text-sm font-black text-slate-900 uppercase">{getOutletName(oId)}</p></div>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-4">
                             <div className="space-y-1.5">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1"><Utensils size={10} className="text-emerald-500" /> Food Ingredients (₹)</label>
                                <input 
                                  type="number" 
                                  value={editingStock[oId].foodIngredients} 
                                  onChange={(e) => setEditingStock({...editingStock, [oId]: { ...editingStock[oId], foodIngredients: parseFloat(e.target.value) || 0 }})} 
                                  className="w-full bg-white border border-slate-200 px-4 py-3 rounded-xl font-black text-indigo-600 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm" 
                                  placeholder="0.00"
                                />
                             </div>
                             <div className="space-y-1.5">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1"><Coffee size={10} className="text-indigo-500" /> Drink Ingredients (₹)</label>
                                <input 
                                  type="number" 
                                  value={editingStock[oId].drinkIngredients} 
                                  onChange={(e) => setEditingStock({...editingStock, [oId]: { ...editingStock[oId], drinkIngredients: parseFloat(e.target.value) || 0 }})} 
                                  className="w-full bg-white border border-slate-200 px-4 py-3 rounded-xl font-black text-indigo-600 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm" 
                                  placeholder="0.00"
                                />
                             </div>
                             <div className="space-y-1.5">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1"><Box size={10} className="text-amber-500" /> Food Packaging (₹)</label>
                                <input 
                                  type="number" 
                                  value={editingStock[oId].food} 
                                  onChange={(e) => setEditingStock({...editingStock, [oId]: { ...editingStock[oId], food: parseFloat(e.target.value) || 0 }})} 
                                  className="w-full bg-white border border-slate-200 px-4 py-3 rounded-xl font-black text-indigo-600 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm" 
                                  placeholder="0.00"
                                />
                             </div>
                             <div className="space-y-1.5">
                                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1"><Grape size={10} className="text-rose-500" /> Drink Packaging (₹)</label>
                                <input
                                  type="number"
                                  value={editingStock[oId].drinks}
                                  onChange={(e) => setEditingStock({...editingStock, [oId]: { ...editingStock[oId], drinks: parseFloat(e.target.value) || 0 }})}
                                  className="w-full bg-white border border-slate-200 px-4 py-3 rounded-xl font-black text-indigo-100 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
                                  placeholder="0.00"
                                />
                             </div>
                          </div>

                          <div className="pt-4 mt-2 border-t border-dashed border-slate-200 space-y-3">
                             <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest px-1">Opening Stock — carried from last month</p>
                             <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1"><Utensils size={10} className="text-emerald-500" /> Food Ingredients Opening (₹)</label>
                                   <input
                                     type="number"
                                     value={editingStock[oId].foodIngredientsOpening}
                                     onChange={(e) => setEditingStock({...editingStock, [oId]: { ...editingStock[oId], foodIngredientsOpening: parseFloat(e.target.value) || 0 }})}
                                     className="w-full bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl font-black text-amber-700 outline-none focus:ring-2 focus:ring-amber-400 transition-all shadow-sm"
                                     placeholder="0.00"
                                   />
                                </div>
                                <div className="space-y-1.5">
                                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1"><Coffee size={10} className="text-indigo-500" /> Drink Ingredients Opening (₹)</label>
                                   <input
                                     type="number"
                                     value={editingStock[oId].drinkIngredientsOpening}
                                     onChange={(e) => setEditingStock({...editingStock, [oId]: { ...editingStock[oId], drinkIngredientsOpening: parseFloat(e.target.value) || 0 }})}
                                     className="w-full bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl font-black text-amber-700 outline-none focus:ring-2 focus:ring-amber-400 transition-all shadow-sm"
                                     placeholder="0.00"
                                   />
                                </div>
                                <div className="space-y-1.5">
                                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1"><Box size={10} className="text-amber-500" /> Food Packaging Opening (₹)</label>
                                   <input
                                     type="number"
                                     value={editingStock[oId].foodServingsOpening}
                                     onChange={(e) => setEditingStock({...editingStock, [oId]: { ...editingStock[oId], foodServingsOpening: parseFloat(e.target.value) || 0 }})}
                                     className="w-full bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl font-black text-amber-700 outline-none focus:ring-2 focus:ring-amber-400 transition-all shadow-sm"
                                     placeholder="0.00"
                                   />
                                </div>
                                <div className="space-y-1.5">
                                   <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 px-1"><Grape size={10} className="text-rose-500" /> Drink Packaging Opening (₹)</label>
                                   <input
                                     type="number"
                                     value={editingStock[oId].drinkServingsOpening}
                                     onChange={(e) => setEditingStock({...editingStock, [oId]: { ...editingStock[oId], drinkServingsOpening: parseFloat(e.target.value) || 0 }})}
                                     className="w-full bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl font-black text-amber-700 outline-none focus:ring-2 focus:ring-amber-400 transition-all shadow-sm"
                                     placeholder="0.00"
                                   />
                                </div>
                             </div>
                          </div>
                       </div>
                    ))}
                 </div>
              </div>
              <footer className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                 <button onClick={() => setIsStockModalOpen(false)} className="flex-1 py-4 bg-white border border-slate-200 rounded-2xl font-black uppercase text-xs tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Cancel</button>
                 <button onClick={handleSaveStock} disabled={isSavingStock} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all active:scale-[0.98]">
                    {isSavingStock ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Update Bucket Adjustments
                 </button>
              </footer>
           </div>
        </div>
      )}
    </div>
  );
};

export default PnLHubCrew;
