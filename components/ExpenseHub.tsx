import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  ExpenseMonthlySnapshot, 
  StoreRental, 
  Employee, 
  MonthlyPayroll, 
  BankTransaction,
  CogsAdjustment, 
  DEFAULT_COGS, 
  DEFAULT_LABOUR, 
  DEFAULT_OPS, 
  CogsBucket, 
  getOutletName, 
  CategorySettings,
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
import { 
  Receipt, 
  RefreshCw, 
  MapPin, 
  ShoppingCart, 
  TrendingDown,
  SearchX,
  Flame,
  ChevronDown,
  ChevronRight,
  Package,
  Users,
  CalendarDays,
  Settings2,
  Lock,
  Unlock,
  Building2,
  PieChart as PieIcon,
  Target,
  Box,
  Utensils,
  Coffee,
  Grape,
  LayoutGrid,
  Activity,
  BarChart,
  BarChart3,
  LineChart,
  Calendar,
  Clock,
  Layers,
  Loader2,
  PackageCheck,
  AlertTriangle,
  HelpCircle,
  Banknote,
  CreditCard,
  Hash,
  ArrowRight,
  ClipboardList
} from 'lucide-react';

type ViewMode = 'combined' | 'expense' | 'purchase';
type CogsVisualMode = 'pie' | 'bar';
type TrajectoryMode = 'stacked' | 'grouped' | 'line';

const PILLAR_COLORS: Record<string, string> = {
  'COGS': '#f59e0b',       // Amber
  'OPERATIONS': '#ec4899', // Pink
  'LABOUR': '#6366f1',     // Indigo
  'FIXED (RENT)': '#f43f5e', // Rose
  'UNCATEGORIZED': '#ef4444' // Bright Red
};

const ExpenseHub: React.FC<{ user: User }> = ({ user }) => {
  const [snapshots, setSnapshots] = useState<ExpenseMonthlySnapshot[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [monthlyPayrolls, setMonthlyPayrolls] = useState<MonthlyPayroll[]>([]);
  const [adjustments, setAdjustments] = useState<CogsAdjustment[]>([]);
  const [bankTxns, setBankTxns] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  
  const [cogsKeywords, setCogsKeywords] = useState<string[]>(DEFAULT_COGS);
  const [labourKeywords, setLabourKeywords] = useState<string[]>(DEFAULT_LABOUR);
  const [opsKeywords, setOpsKeywords] = useState<string[]>(DEFAULT_OPS);
  const [cogsBucketMapping, setCogsBucketMapping] = useState<Record<string, CogsBucket>>({});

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [storeFilter, setStoreFilter] = useState<'all' | string>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('combined');
  const [cogsVisualMode, setCogsVisualMode] = useState<CogsVisualMode>('pie');
  
  const [trajectoryMonths, setTrajectoryMonths] = useState(6);
  const [trajectoryMode, setTrajectoryMode] = useState<TrajectoryMode>('stacked');
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number, y: number, label: string, values: Record<string, number>, total: number } | null>(null);

  const [isCogsExpanded, setIsCogsExpanded] = useState(false);
  const [expandedCogsBuckets, setExpandedCogsBuckets] = useState<Set<string>>(new Set());
  const [isOpsExpanded, setIsOpsExpanded] = useState(false);
  const [isLabourExpanded, setIsLabourExpanded] = useState(false);
  const [isRentExpanded, setIsRentExpanded] = useState(false);
  const [isUncatExpanded, setIsUncatExpanded] = useState(true); // Default expanded to help identification

  const fetchData = async () => {
    setLoading(true);
    try {
      const yearInt = parseInt(selectedYear);
      // Fetch data for selected year and the one before it to support cross-year trajectory analysis
      const yearRange = [yearInt.toString(), (yearInt - 1).toString()];
      const settingsRef = doc(db, 'category_settings', user.uid);
      const [snapSnap, rSnap, empSnap, paySnap, adjSnap, bankSnap, setSnap] = await Promise.all([
        getDocs(query(collection(db, 'expense_snapshots'), where('userId', '==', user.uid), where('year', 'in', yearRange))),
        getDocs(query(collection(db, 'rentals'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'employees'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'monthly_payrolls'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'cogs_adjustments'), where('userId', '==', user.uid))),
        getDocs(query(collection(db, 'bank_transactions'), where('userId', '==', user.uid), where('isVerified', '==', true))),
        getDoc(settingsRef)
      ]);
      
      if (setSnap.exists()) {
        const d = setSnap.data() as CategorySettings;
        if (d.cogsKeywords) setCogsKeywords(d.cogsKeywords.map(k => k.trim().toUpperCase()));
        if (d.labourKeywords) setLabourKeywords(d.labourKeywords.map(k => k.trim().toUpperCase()));
        if (d.opsKeywords) setOpsKeywords(d.opsKeywords.map(k => k.trim().toUpperCase()));
        if (d.cogsBucketMapping) setCogsBucketMapping(d.cogsBucketMapping || {});
      }

      setSnapshots(snapSnap.docs.map(d => ({ ...d.data(), id: d.id } as ExpenseMonthlySnapshot)));
      setRentals(rSnap.docs.map(d => ({ ...d.data(), id: d.id } as StoreRental)));
      setEmployees(empSnap.docs.map(d => ({ ...d.data(), id: d.id } as Employee)));
      setMonthlyPayrolls(paySnap.docs.map(d => ({ ...d.data(), id: d.id } as MonthlyPayroll)));
      setAdjustments(adjSnap.docs.map(d => ({ ...d.data(), id: d.id } as CogsAdjustment)));
      setBankTxns(bankSnap.docs.map(d => ({ ...d.data(), id: d.id } as BankTransaction)));
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user, selectedYear]);

  const activeOutletOptions = useMemo(() => {
    const yearNum = parseInt(selectedYear);
    const monthIdx = selectedMonth === 'All Months' ? 0 : MONTH_NAMES.indexOf(selectedMonth);
    const monthFirstDay = new Date(yearNum, monthIdx, 1);
    return rentals.filter(r => {
      const status = r.status || 'active';
      return status === 'active' || (r.closeDate && new Date(r.closeDate) >= monthFirstDay);
    }).map(r => ({ id: r.outletId, name: r.storeName }));
  }, [rentals, selectedMonth, selectedYear]);

  const analytics = useMemo(() => {
    const currentFilterOutlets = storeFilter === 'all' ? activeOutletOptions.map(o => o.id) : [storeFilter];
    const filteredSnaps = snapshots.filter(s => {
      const matchesStore = storeFilter === 'all' || s.outletId === storeFilter;
      const matchesPeriod = selectedMonth === 'All Months' ? s.year === selectedYear : (s.month === selectedMonth && s.year === selectedYear);
      return matchesStore && matchesPeriod;
    });
    
    const opsCatMap: Record<string, number> = {};
    const uncatCatMap: Record<string, { amount: number, source: 'Cash' | 'Online' | 'Mixed' }> = {};
    const cogsBucketAgg: Record<string, number> = { 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 };
    const cogsItemBreakdown: Record<string, Record<string, { amount: number, source: 'Cash' | 'Online' | 'Mixed' }>> = { 
      'FOOD': {}, 'DRINKS': {}, 'FOOD SERVINGS': {}, 'DRINKS SERVINGS': {}, 'UNCATEGORIZED': {} 
    };
    
    let csvCogs = 0;
    let csvLabour = 0;
    let csvOps = 0;
    let csvUncat = 0;

    const classifyRow = (cat: string, amt: number, source: 'Cash' | 'Online') => {
        const val = Number(amt || 0);
        if (val === 0) return;
        const upper = cat.trim().toUpperCase();
        
        if (cogsKeywords.includes(upper)) {
          csvCogs += val;
          const bucket = cogsBucketMapping[upper] || 'FOOD';
          cogsBucketAgg[bucket] = (cogsBucketAgg[bucket] || 0) + val;
          if (!cogsItemBreakdown[bucket][cat]) {
            cogsItemBreakdown[bucket][cat] = { amount: val, source };
          } else {
            cogsItemBreakdown[bucket][cat].amount += val;
            if (cogsItemBreakdown[bucket][cat].source !== source) {
              cogsItemBreakdown[bucket][cat].source = 'Mixed';
            }
          }
        } else if (labourKeywords.includes(upper)) {
          csvLabour += val;
        } else if (opsKeywords.includes(upper)) {
          csvOps += val;
          opsCatMap[cat] = (opsCatMap[cat] || 0) + val;
        } else {
          csvUncat += val;
          if (!uncatCatMap[cat]) {
            uncatCatMap[cat] = { amount: val, source };
          } else {
            uncatCatMap[cat].amount += val;
            if (uncatCatMap[cat].source !== source) uncatCatMap[cat].source = 'Mixed';
          }
        }
    };

    filteredSnaps.forEach(snap => {
      if (viewMode === 'combined' || viewMode === 'purchase') {
        Object.entries(snap.purchaseByCategory || {}).forEach(([cat, amt]) => classifyRow(cat, amt as number, 'Online'));
      }
      if (viewMode === 'combined' || viewMode === 'expense') {
        Object.entries(snap.expenseByCategory || {}).forEach(([cat, amt]) => classifyRow(cat, amt as number, 'Cash'));
      }
    });

    let fixedBaseSalary = 0;
    let fixedRent = 0;
    let isPayrollFiscal = false;

    // Add Verified Bank Transactions
    const monthIdx = selectedMonth === 'All Months' ? null : (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = monthIdx ? `${selectedYear}-${monthIdx}` : `${selectedYear}`;
    
    bankTxns
      .filter(t => t.date.startsWith(datePrefix))
      .filter(t => t.type === 'debit') // Only outflows
      .forEach(t => {
        const amt = Number(t.amount);
        const cat = t.category || 'UNCATEGORIZED';
        
        if (cat === 'COGS') csvCogs += amt;
        else if (cat === 'SALARIES') csvLabour += amt;
        else if (cat === 'RENTALS') fixedRent += amt;
        else if (cat === 'OPERATIONS') {
          csvOps += amt;
          opsCatMap[t.description] = (opsCatMap[t.description] || 0) + amt;
        } else if (cat === 'UNCATEGORIZED') {
          csvUncat += amt;
          if (!uncatCatMap[t.description]) uncatCatMap[t.description] = { amount: amt, source: 'Online' };
          else uncatCatMap[t.description].amount += amt;
        } else {
          // Others (Loans, taxes etc) map to Ops for simplified PnL in this view, or separate
          csvOps += amt;
          opsCatMap[`${cat}: ${t.description}`] = (opsCatMap[`${cat}: ${t.description}`] || 0) + amt;
        }
      });

    if (viewMode === 'combined' || viewMode === 'purchase') {
      const relevantMonths = selectedMonth === 'All Months' ? MONTH_NAMES : [selectedMonth];
      relevantMonths.forEach(mo => {
        currentFilterOutlets.forEach(oId => {
          const rental = rentals.find(r => r.outletId === oId);
          const periodStart = new Date(parseInt(selectedYear), MONTH_NAMES.indexOf(mo), 1);
          const periodEnd = new Date(parseInt(selectedYear), MONTH_NAMES.indexOf(mo) + 1, 0);

          let multiplier = 1.0;
          if (rental?.status === 'closed' && rental.closeDate) {
            const cDate = new Date(rental.closeDate);
            if (cDate < periodStart) multiplier = 0.0;
            else if (cDate < periodEnd) multiplier = cDate.getDate() / periodEnd.getDate();
          }

          if (rental && multiplier > 0) fixedRent += rental.currentRent * multiplier;
          const fiscalRecord = monthlyPayrolls.find(p => p.outletId === oId && p.month === mo && p.year === selectedYear);
          if (fiscalRecord) {
            fixedBaseSalary += fiscalRecord.totalAmount;
            isPayrollFiscal = true;
          } else if (multiplier > 0) {
            fixedBaseSalary += employees.filter(e => e.outletId === oId).reduce((acc, e) => acc + (e.currentSalary || 0), 0) * multiplier;
          }
        });
      });
    }

    const relevantMonthsForAdj = selectedMonth === 'All Months' ? MONTH_NAMES : [selectedMonth];
    const totalCogsOffset = (viewMode === 'combined' || viewMode === 'purchase') ? adjustments.filter(a => {
        const matchesStore = currentFilterOutlets.includes(a.outletId);
        const matchesPeriod = relevantMonthsForAdj.includes(a.month) && a.year === selectedYear;
        return matchesStore && matchesPeriod;
    }).reduce((acc, a) => acc + (a.adjustmentAmount || 0), 0) : 0;

    const adjustedCogsTotal = Math.max(0, csvCogs - totalCogsOffset);
    const totalLabour = csvLabour + fixedBaseSalary;

    const catMap: Record<string, number> = {
      'COGS': adjustedCogsTotal,
      'LABOUR': totalLabour,
      'OPERATIONS': csvOps,
      'FIXED (RENT)': fixedRent
    };
    
    if (csvUncat > 0) catMap['UNCATEGORIZED'] = csvUncat;

    const displayOrder = ['COGS', 'LABOUR', 'OPERATIONS', 'FIXED (RENT)', 'UNCATEGORIZED'];
    const categories = displayOrder
      .filter(key => catMap.hasOwnProperty(key))
      .map(key => [key, catMap[key]] as [string, number]);

    const finalOpsBreakdown = Object.entries(opsCatMap).sort((a, b) => b[1] - a[1]);
    const finalUncatBreakdown = Object.entries(uncatCatMap).sort((a, b) => b[1].amount - a[1].amount);
    const currentTotal = adjustedCogsTotal + totalLabour + fixedRent + csvOps + csvUncat;

    return { 
      totalCombined: currentTotal, 
      categories,
      opsBreakdown: finalOpsBreakdown,
      uncatBreakdown: finalUncatBreakdown,
      cogsBucketAgg, 
      cogsItemBreakdown,
      cogsTotal: adjustedCogsTotal, 
      rawCogsTotal: csvCogs,
      totalCogsOffset,
      opsTotal: csvOps, 
      labourTotal: totalLabour, 
      rentTotal: fixedRent,
      uncatTotal: csvUncat,
      isPayrollFiscal
    };
  }, [snapshots, employees, monthlyPayrolls, rentals, adjustments, viewMode, storeFilter, selectedYear, selectedMonth, activeOutletOptions, cogsKeywords, labourKeywords, opsKeywords, cogsBucketMapping]);

  const trajectoryData = useMemo(() => {
    const endM = selectedMonth === 'All Months' ? 11 : MONTH_NAMES.indexOf(selectedMonth);
    const endY = parseInt(selectedYear);
    const currentFilterOutlets = storeFilter === 'all' ? activeOutletOptions.map(o => o.id) : [storeFilter];
    const results = [];
    for (let i = trajectoryMonths - 1; i >= 0; i--) {
      let mIdx = endM - i;
      let y = endY;
      while (mIdx < 0) { mIdx += 12; y -= 1; }
      const month = MONTH_NAMES[mIdx];
      const year = y.toString();
      const filteredSnaps = snapshots.filter(s => {
        const matchesStore = storeFilter === 'all' || s.outletId === storeFilter;
        return s.month === month && s.year === year && matchesStore;
      });
      let rawCogs = 0;
      let ops = 0;
      let csvLabour = 0;
      let uncat = 0;
      let fixedRent = 0;
      let fixedLabour = 0;
      filteredSnaps.forEach(snap => {
        const process = (src: Record<string, number>) => {
           Object.entries(src).forEach(([cat, amt]) => {
              const val = Number(amt || 0);
              const upper = cat.trim().toUpperCase();
              if (cogsKeywords.includes(upper)) rawCogs += val;
              else if (labourKeywords.includes(upper)) csvLabour += val;
              else if (opsKeywords.includes(upper)) ops += val;
              else uncat += val;
           });
        };
        if (viewMode === 'combined' || viewMode === 'purchase') process(snap.purchaseByCategory || {});
        if (viewMode === 'combined' || viewMode === 'expense') process(snap.expenseByCategory || {});
      });
      const monthOffset = (viewMode === 'combined' || viewMode === 'purchase') ? adjustments.filter(a => {
          return currentFilterOutlets.includes(a.outletId) && a.month === month && a.year === year;
      }).reduce((acc, a) => acc + (a.adjustmentAmount || 0), 0) : 0;
      if (viewMode === 'combined' || viewMode === 'purchase') {
        const periodStart = new Date(y, mIdx, 1);
        const periodEnd = new Date(y, mIdx + 1, 0);
        currentFilterOutlets.forEach(oId => {
          const rental = rentals.find(r => r.outletId === oId);
          let multiplier = 1.0;
          if (rental?.status === 'closed' && rental.closeDate) {
            const cDate = new Date(rental.closeDate);
            if (cDate < periodStart) multiplier = 0.0;
            else if (cDate < periodEnd) multiplier = cDate.getDate() / periodEnd.getDate();
          }
          if (rental && multiplier > 0) fixedRent += rental.currentRent * multiplier;
          const fiscalLog = monthlyPayrolls.find(p => p.outletId === oId && p.month === month && p.year === year);
          if (fiscalLog) fixedLabour += fiscalLog.totalAmount;
          else if (multiplier > 0) fixedLabour += employees.filter(e => e.outletId === oId).reduce((acc, e) => acc + (e.currentSalary || 0), 0) * multiplier;
        });
      }
      const totalCogs = Math.max(0, rawCogs - monthOffset);
      const totalLabour = csvLabour + fixedLabour;
      results.push({ label: month.substring(0, 3), month, year, COGS: totalCogs, OPERATIONS: ops, LABOUR: totalLabour, 'FIXED (RENT)': fixedRent, UNCATEGORIZED: uncat, total: totalCogs + ops + totalLabour + fixedRent + uncat });
    }
    return results;
  }, [snapshots, rentals, employees, monthlyPayrolls, adjustments, trajectoryMonths, viewMode, storeFilter, selectedMonth, selectedYear, activeOutletOptions, cogsKeywords, labourKeywords, opsKeywords]);

  const maxTrajectoryVal = Math.max(...trajectoryData.map(d => trajectoryMode === 'stacked' ? d.total : Math.max(d.COGS, d.OPERATIONS, d.LABOUR, d['FIXED (RENT)'], d.UNCATEGORIZED)), 1);

  const toggleCogsBucket = (bucket: string) => {
    const next = new Set(expandedCogsBuckets);
    if (next.has(bucket)) next.delete(bucket);
    else next.add(bucket);
    setExpandedCogsBuckets(next);
  };

  const CogsPieRenderer = () => {
    const buckets = [
      { id: 'FOOD', color: '#10b981', icon: Utensils },
      { id: 'DRINKS', color: '#6366f1', icon: Coffee },
      { id: 'FOOD SERVINGS', color: '#fbbf24', icon: Box },
      { id: 'DRINKS SERVINGS', color: '#fb7185', icon: Grape }
    ];
    let currentAngle = 0;
    const radius = 80;
    const center = 120;
    
    const totalServingsRaw = (analytics.cogsBucketAgg['FOOD SERVINGS'] || 0) + (analytics.cogsBucketAgg['DRINKS SERVINGS'] || 0);

    return (
      <div className="flex flex-col md:flex-row items-center justify-around gap-12 w-full animate-in zoom-in-95 duration-500">
        <div className="relative w-60 h-60">
          <svg viewBox="0 0 240 240" className="w-full h-full -rotate-90">
            {buckets.map((b) => {
              const rawBucketAmt = (analytics.cogsBucketAgg[b.id] as number) || 0;
              let adjustedAmt = rawBucketAmt;
              
              if (b.id.includes('SERVINGS') && totalServingsRaw > 0) {
                 const servingWeight = rawBucketAmt / totalServingsRaw;
                 adjustedAmt = Math.max(0, rawBucketAmt - (analytics.totalCogsOffset * servingWeight));
              }

              const percent = adjustedAmt / (analytics.cogsTotal || 1);
              if (percent <= 0) return null;
              const angle = percent * 360;
              const x1 = center + radius * Math.cos((currentAngle * Math.PI) / 180);
              const y1 = center + radius * Math.sin((currentAngle * Math.PI) / 180);
              const x2 = center + radius * Math.cos(((currentAngle + angle) * Math.PI) / 180);
              const y2 = center + radius * Math.sin(((currentAngle + angle) * Math.PI) / 180);
              const largeArc = angle > 180 ? 1 : 0;
              const pathData = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
              const slice = (
                <g key={b.id} className="group cursor-pointer">
                  <path d={pathData} fill={b.color} className="transition-all duration-500 hover:opacity-80 hover:scale-105" stroke="white" strokeWidth="2" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
                </g>
              );
              currentAngle += angle;
              return slice;
            })}
            <circle cx={center} cy={center} r={45} fill="white" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">Net COGS</p>
            <p className="text-sm font-black text-slate-900">₹{analytics.cogsTotal.toLocaleString()}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 flex-1 max-w-xs">
          {buckets.map(b => {
             const rawBucketAmt = (analytics.cogsBucketAgg[b.id] as number) || 0;
             let adjustedAmt = rawBucketAmt;
              
             if (b.id.includes('SERVINGS') && totalServingsRaw > 0) {
                const servingWeight = rawBucketAmt / totalServingsRaw;
                adjustedAmt = Math.max(0, rawBucketAmt - (analytics.totalCogsOffset * servingWeight));
             }

             if (adjustedAmt <= 0) return null;
             return (
               <div key={b.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100 group hover:border-indigo-200 transition-all">
                  <div className="flex items-center gap-3">
                     <div className="p-2 rounded-xl bg-white shadow-sm" style={{ color: b.color }}><b.icon size={14}/></div>
                     <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{b.id}</span>
                  </div>
                  <div className="text-right">
                     <p className="text-xs font-black text-slate-900">₹{adjustedAmt.toLocaleString()}</p>
                     <p className="text-[9px] font-bold text-slate-400">{((adjustedAmt / (analytics.cogsTotal || 1)) * 100).toFixed(1)}%</p>
                  </div>
               </div>
             );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-12 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-8">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-rose-500 rounded-3xl flex items-center justify-center text-white shadow-2xl shadow-rose-200"><Flame size={32} /></div>
          <div>
            <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Expense Radar</h2>
            <p className="text-slate-500 text-sm font-medium mt-1 uppercase tracking-widest flex items-center gap-2"><Clock size={14} className="text-rose-400" /> Operational Outflow Caches</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="px-4 py-2 bg-slate-50 rounded-2xl flex items-center gap-2 border border-slate-100">
            <MapPin size={14} className="text-rose-500" />
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent font-bold text-[10px] outline-none uppercase tracking-tight">
              <option value="all">All Active Outlets</option>
              {activeOutletOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="px-4 py-2 bg-slate-50 rounded-2xl flex items-center gap-2 border border-slate-100">
            <CalendarDays size={14} className="text-rose-500" />
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-transparent font-bold text-[10px] outline-none uppercase tracking-tight">
              <option value="All Months">All Months</option>
              {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="px-4 py-2 bg-slate-50 rounded-2xl flex items-center gap-2 border border-slate-100">
            <Layers size={14} className="text-rose-500" />
            <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent font-bold text-[10px] outline-none uppercase tracking-tight">
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={fetchData} className="p-3 bg-rose-50 rounded-2xl text-rose-500 hover:bg-rose-500 hover:text-white transition-all"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button>
        </div>
      </header>

      <div className="flex items-center bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner">
        <button 
           onClick={() => setViewMode('combined')} 
           className={`px-10 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${viewMode === 'combined' ? 'bg-white text-rose-600 shadow-xl translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}
        >
          Combined (Total)
        </button>
        <button 
           onClick={() => setViewMode('expense')} 
           className={`px-10 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${viewMode === 'expense' ? 'bg-white text-rose-600 shadow-xl translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <Banknote size={14} className="inline mr-2" /> Expense (Cash)
        </button>
        <button 
           onClick={() => setViewMode('purchase')} 
           className={`px-10 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${viewMode === 'purchase' ? 'bg-white text-rose-600 shadow-xl translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}
        >
          <CreditCard size={14} className="inline mr-2" /> Purchase (Online)
        </button>
      </div>

      {loading ? (
        <div className="py-48 text-center"><Loader2 className="w-12 h-12 text-rose-500 animate-spin mx-auto mb-6" /><p className="text-slate-400 font-black uppercase tracking-widest text-[10px] animate-pulse">Syncing Global Outflows...</p></div>
      ) : (analytics.totalCombined === 0 && analytics.categories.every(c => c[1] === 0)) ? (
        <div className="py-40 bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 text-center"><SearchX size={56} className="mx-auto text-slate-200 mb-6" /><h3 className="text-2xl font-black text-slate-900">No Records Detected</h3><p className="text-slate-500 mt-2 font-medium">Verify your data catalog for the selected period.</p></div>
      ) : (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
             <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col justify-between group hover:-translate-y-1 transition-all">
                <div><p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Operational Outflow</p><h4 className="text-4xl font-black tracking-tighter text-slate-900">₹{analytics.opsTotal.toLocaleString()}</h4></div>
                <div className="mt-8 flex items-center gap-3 text-slate-300 text-[10px] font-black uppercase"><Receipt size={14} className="text-indigo-400" /> Utility & G&A</div>
             </div>
             <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col justify-between group hover:-translate-y-1 transition-all relative overflow-hidden">
                {analytics.totalCogsOffset > 0 && <div className="absolute top-4 right-4"><PackageCheck size={20} className="text-emerald-500 animate-pulse" /></div>}
                <div><p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Net Inventory Value</p><h4 className="text-4xl font-black tracking-tighter text-slate-900">₹{analytics.cogsTotal.toLocaleString()}</h4></div>
                <div className="mt-8 flex items-center gap-3 text-slate-300 text-[10px] font-black uppercase"><ShoppingCart size={14} className="text-amber-400" /> Adjusted Consumption</div>
             </div>
             <div className="bg-slate-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden group hover:-translate-y-1 transition-all">
                <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:rotate-12 transition-transform"><Flame size={120} /></div>
                <div><p className="text-[11px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-2">Aggregate Velocity</p><h4 className="text-5xl font-black tracking-tighter text-emerald-400">₹{analytics.totalCombined.toLocaleString()}</h4></div>
                <div className="mt-8 flex items-center gap-3 text-indigo-300 text-[10px] font-black uppercase"><TrendingDown size={14} /> Total Burn Mode</div>
             </div>
          </section>

          {/* OUTFLOW LEDGER */}
          <section className="bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden">
             <div className="flex flex-col md:flex-row md:items-start justify-between mb-12 gap-8">
                <div>
                   <h3 className="text-3xl font-black text-slate-900 tracking-tighter">Outflow Ledger</h3>
                   <p className="text-slate-400 text-sm font-medium mt-1 uppercase tracking-widest flex items-center gap-2">
                     {viewMode === 'expense' ? <Banknote size={14} className="text-indigo-500"/> : <CreditCard size={14} className="text-indigo-500"/>}
                     Mode: {viewMode.toUpperCase()} • {selectedMonth} {selectedYear}
                   </p>
                </div>
                <div className="flex flex-col items-end gap-3">
                   <div className="px-6 py-3 bg-rose-50 text-rose-600 rounded-[1.5rem] text-[12px] font-black uppercase tracking-[0.2em] border border-rose-100 shadow-sm">Scope Total: ₹{analytics.totalCombined.toLocaleString()}</div>
                   {analytics.uncatTotal > 0 && (
                      <div className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest animate-pulse shadow-lg shadow-rose-900/20">
                         <AlertTriangle size={14} /> {((analytics.uncatTotal / analytics.totalCombined) * 100).toFixed(1)}% Leakage detected
                      </div>
                   )}
                </div>
             </div>
             
             <div className="space-y-4 max-h-[1000px] overflow-y-auto pr-6 custom-scrollbar">
                {analytics.categories.map(([cat, amount]) => {
                  const isCogs = cat === 'COGS';
                  const isLabour = cat === 'LABOUR';
                  const isOps = cat === 'OPERATIONS';
                  const isRent = cat === 'FIXED (RENT)';
                  const isUncat = cat === 'UNCATEGORIZED';
                  const isMaster = isCogs || isLabour || isOps || isRent || isUncat;
                  const isExpanded = isCogs ? isCogsExpanded : (isLabour ? isLabourExpanded : (isOps ? isOpsExpanded : (isRent ? isRentExpanded : (isUncat ? isUncatExpanded : false))));
                  
                  return (
                    <div key={cat} className="space-y-2">
                       <div onClick={() => { 
                         if(isCogs) setIsCogsExpanded(!isCogsExpanded); 
                         if(isLabour) setIsLabourExpanded(!isLabourExpanded); 
                         if(isOps) setIsOpsExpanded(!isOpsExpanded); 
                         if(isRent) setIsRentExpanded(!isRentExpanded);
                         if(isUncat) setIsUncatExpanded(!isUncatExpanded);
                        }}
                         className={`flex justify-between items-center p-6 rounded-3xl transition-all ${isMaster ? (isUncat ? 'bg-rose-900 border-2 border-rose-500/50 text-white' : 'bg-slate-900 text-white') : 'hover:bg-slate-50'} cursor-pointer hover:opacity-90 shadow-lg`}>
                          <div className="flex items-center gap-5">
                             {isMaster ? (
                               <div className={`p-3 rounded-2xl ${isExpanded ? 'bg-indigo-600 shadow-lg' : (isUncat ? 'bg-rose-600 animate-pulse' : (amount === 0 ? 'bg-slate-700' : 'bg-slate-800'))}`}>
                                 {isCogs && <Package size={20} />} 
                                 {isLabour && <Users size={20} />} 
                                 {isOps && <Settings2 size={20} />} 
                                 {isRent && <Building2 size={20} />}
                                 {isUncat && <AlertTriangle size={20} className="text-white" />}
                               </div>
                             ) : <div className="w-2.5 h-2.5 rounded-full bg-slate-300 ml-3" />}
                             <div className="flex flex-col">
                                <span className={`text-md font-black uppercase tracking-[0.1em] ${isUncat ? 'text-rose-200' : (amount === 0 ? 'text-slate-500' : 'text-white')}`}>
                                  {isCogs ? 'COGS (ADJUSTED)' : (isUncat ? 'UNMAPPED LEAKAGE' : cat)}
                                </span>
                                {isUncat && <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mt-0.5">Keywords not found in Category Mappings</span>}
                             </div>
                          </div>
                          <div className="flex items-center gap-6">
                             <div className="text-right">
                                <p className={`text-lg font-black tracking-tight ${isUncat ? 'text-white' : (amount === 0 ? 'text-slate-600' : 'text-white')}`}>₹{amount.toLocaleString()}</p>
                                <p className={`text-[10px] font-bold uppercase tracking-widest ${isUncat ? 'text-rose-400' : 'text-slate-400'}`}>{((amount / (analytics.totalCombined || 1)) * 100).toFixed(1)}%</p>
                             </div>
                             {isMaster && (isExpanded ? <ChevronDown size={22} className="text-indigo-400" /> : <ChevronRight size={22} className="text-slate-600" />)}
                          </div>
                       </div>
                       
                       {isCogs && isExpanded && (
                         <div className="ml-16 space-y-4 pt-3 pb-8 border-l-4 border-amber-500/20 pl-8 animate-in slide-in-from-top-3 duration-300">
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl mb-4 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <ShoppingCart size={16} className="text-amber-600" />
                                    <span className="text-xs font-black text-slate-600 uppercase tracking-tight">Gross COGS Spending</span>
                                </div>
                                <span className="text-sm font-black text-slate-900">₹{analytics.rawCogsTotal.toLocaleString()}</span>
                            </div>

                            {analytics.totalCogsOffset > 0 && (
                                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl mb-4 flex justify-between items-center">
                                    <div className="flex items-center gap-3">
                                        <PackageCheck size={16} className="text-emerald-600" />
                                        <span className="text-xs font-black text-emerald-800 uppercase tracking-tight">Inventory Offset (Servings Focus)</span>
                                    </div>
                                    <span className="text-sm font-black text-emerald-600">-₹{analytics.totalCogsOffset.toLocaleString()}</span>
                                </div>
                            )}

                            {['FOOD', 'DRINKS', 'FOOD SERVINGS', 'DRINKS SERVINGS'].map(bucket => {
                               const bucketAmtRaw = analytics.cogsBucketAgg[bucket] || 0;
                               if (bucketAmtRaw === 0) return null;
                               const isBucketExpanded = expandedCogsBuckets.has(bucket);
                               const bucketIcon = bucket.includes('FOOD') ? <Utensils size={14}/> : <Coffee size={14}/>;
                               const colorMap: any = { 'FOOD': 'text-emerald-500', 'DRINKS': 'text-indigo-500', 'FOOD SERVINGS': 'text-amber-500', 'DRINKS SERVINGS': 'text-rose-500' };
                               
                               let bucketAmtAdjusted = bucketAmtRaw;
                               if (bucket.includes('SERVINGS')) {
                                  const totalServingsRaw = (analytics.cogsBucketAgg['FOOD SERVINGS'] || 0) + (analytics.cogsBucketAgg['DRINKS SERVINGS'] || 0);
                                  const servingWeight = totalServingsRaw > 0 ? bucketAmtRaw / totalServingsRaw : 0;
                                  bucketAmtAdjusted = Math.max(0, bucketAmtRaw - (analytics.totalCogsOffset * servingWeight));
                               }

                               return (
                                 <div key={bucket} className="space-y-3">
                                    <div 
                                       onClick={() => toggleCogsBucket(bucket)} 
                                       className="flex justify-between items-center cursor-pointer hover:translate-x-2 transition-transform group py-2"
                                    >
                                       <div className="flex items-center gap-3">
                                          <div className={`p-1.5 rounded-lg bg-slate-50 ${colorMap[bucket]}`}>{bucketIcon}</div>
                                          <span className={`text-[12px] font-black uppercase tracking-[0.15em] ${colorMap[bucket]}`}>{bucket}</span>
                                          {isBucketExpanded ? <ChevronDown size={14} className="text-slate-300" /> : <ChevronRight size={14} className="text-slate-300" />}
                                       </div>
                                       <div className="flex items-center gap-3">
                                          {bucket.includes('SERVINGS') && analytics.totalCogsOffset > 0 && (
                                            <span className="text-[8px] font-black uppercase text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">Offset Applied</span>
                                          )}
                                          <span className="text-[11px] font-black text-slate-800 tracking-tight">₹{bucketAmtAdjusted.toLocaleString()}</span>
                                       </div>
                                    </div>

                                    {isBucketExpanded && (
                                       <div className="ml-8 space-y-2 border-l-2 border-slate-100 pl-6 py-2 animate-in slide-in-from-left-2 duration-300">
                                          {(Object.entries(analytics.cogsItemBreakdown[bucket]) as [string, { amount: number; source: string }][]).sort((a, b) => b[1].amount - a[1].amount).map(([itemName, itemData]) => {
                                             return (
                                                <div key={itemName} className="flex justify-between items-center group">
                                                   <div className="flex items-center gap-3">
                                                      <Hash size={10} className="text-slate-300 group-hover:text-indigo-400 transition-colors" />
                                                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate max-w-[180px]">{itemName}</span>
                                                      <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${itemData.source === 'Cash' ? 'bg-indigo-50 border-indigo-100 text-indigo-500' : 'bg-orange-50 border-orange-100 text-orange-500'}`}>
                                                         {itemData.source}
                                                      </span>
                                                   </div>
                                                   <span className="text-[10px] font-black text-slate-600">₹{itemData.amount.toLocaleString()}</span>
                                                </div>
                                             );
                                          })}
                                       </div>
                                    )}
                                 </div>
                               );
                            })}
                         </div>
                       )}

                       {isUncat && isExpanded && (
                         <div className="ml-16 space-y-4 pt-3 pb-8 border-l-4 border-rose-600/50 pl-8 animate-in slide-in-from-top-3 duration-300">
                            <div className="p-6 bg-rose-50 rounded-[2rem] flex flex-col md:flex-row items-start gap-6 border border-rose-200 mb-6 shadow-inner">
                               <div className="p-4 bg-rose-100 rounded-2xl text-rose-600"><ClipboardList size={32} /></div>
                               <div>
                                <div className="flex items-center justify-between gap-4 mb-2">
                                  <h4 className="text-lg font-black text-rose-900 uppercase tracking-tight">Unmapped Category Registry</h4>
                                  <div className="group relative">
                                    <HelpCircle size={16} className="text-rose-300 hover:text-rose-500 cursor-help transition-colors" />
                                    <div className="absolute right-0 top-full mt-2 w-64 p-4 bg-slate-900 text-white text-[10px] rounded-2xl shadow-2xl opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 font-medium leading-relaxed">
                                      To clear these items: Either map these keywords in <b>Mapping settings</b> to assign them to a pillar, or locate and delete the source file in the <b>Performance Hub</b> to wipe the data entirely.
                                    </div>
                                  </div>
                                </div>
                                  <p className="text-[11px] text-rose-700 leading-relaxed font-bold uppercase tracking-tight">
                                    The following keywords were found in your CSV data but are not assigned to any core pillar (COGS, Labour, Ops). 
                                    Copy these names and add them to your <b>Mapping</b> settings to remove this leakage.
                                  </p>
                               </div>
                            </div>

                            <div className="bg-white rounded-[2rem] border border-rose-100 overflow-hidden shadow-sm">
                               <table className="w-full text-left">
                                  <thead className="bg-rose-50/50 border-b border-rose-100">
                                     <tr>
                                        <th className="px-6 py-4 text-[9px] font-black text-rose-600 uppercase tracking-widest">Keyword to Map</th>
                                        <th className="px-6 py-4 text-[9px] font-black text-rose-600 uppercase tracking-widest text-center">Source</th>
                                        <th className="px-6 py-4 text-[9px] font-black text-rose-600 uppercase tracking-widest text-right">Total Burn</th>
                                     </tr>
                                  </thead>
                                  <tbody className="divide-y divide-rose-50">
                                     {analytics.uncatBreakdown.map(([cat, data]: [string, any]) => (
                                        <tr key={cat} className="group hover:bg-rose-50/30 transition-colors">
                                           <td className="px-6 py-4">
                                              <div className="flex items-center gap-3">
                                                 <span className="text-xs font-black text-slate-800 uppercase tracking-tight">{cat}</span>
                                              </div>
                                           </td>
                                           <td className="px-6 py-4 text-center">
                                              <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase border ${data.source === 'Cash' ? 'bg-indigo-50 border-indigo-100 text-indigo-500' : (data.source === 'Online' ? 'bg-orange-50 border-orange-100 text-orange-500' : 'bg-slate-100 border-slate-200 text-slate-500')}`}>
                                                 {data.source}
                                              </span>
                                           </td>
                                           <td className="px-6 py-4 text-right">
                                              <span className="text-xs font-black text-rose-600">₹{data.amount.toLocaleString()}</span>
                                           </td>
                                        </tr>
                                     ))}
                                  </tbody>
                               </table>
                            </div>
                            
                            <div className="flex justify-end">
                               <button 
                                 onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                                 className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-600 transition-all shadow-xl"
                               >
                                 Go to Mapping Hub <ArrowRight size={14}/>
                               </button>
                            </div>
                         </div>
                       )}

                       {isOps && isExpanded && (
                         <div className="ml-16 space-y-4 pt-3 pb-8 border-l-4 border-pink-500/20 pl-8 animate-in slide-in-from-top-3 duration-300">
                            {analytics.opsBreakdown.map(([sc, sa]) => (
                               <div key={sc} className="flex justify-between items-center group text-[11px] font-bold text-slate-500 hover:text-pink-600 transition-colors">
                                  <span className="uppercase tracking-widest">{sc}</span>
                                  <span className="text-slate-800 font-black">₹{sa.toLocaleString()}</span>
                               </div>
                            ))}
                            {analytics.opsBreakdown.length === 0 && (
                               <div className="py-4 text-[10px] font-bold text-slate-300 uppercase tracking-widest">No matching operational items found in source</div>
                            )}
                         </div>
                       )}

                       {isLabour && isExpanded && (
                         <div className="ml-16 space-y-5 pt-3 pb-8 border-l-4 border-indigo-500/20 pl-8 animate-in slide-in-from-top-3 duration-300">
                            <div className={`p-6 rounded-[2rem] flex justify-between items-center shadow-sm ${analytics.isPayrollFiscal ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50'}`}>
                               <div className="flex items-center gap-4">
                                  {analytics.isPayrollFiscal ? <Lock size={16} className="text-emerald-500" /> : <Unlock size={16} className="text-orange-400" />}
                                  <span className={`text-[12px] font-black uppercase tracking-widest ${analytics.isPayrollFiscal ? 'text-emerald-700' : 'text-slate-600'}`}>Staff Payouts {analytics.isPayrollFiscal ? '(LOCKED)' : '(THEORETICAL)'}</span>
                               </div>
                               <span className="text-lg font-black text-slate-900">₹{analytics.labourTotal.toLocaleString()}</span>
                            </div>
                         </div>
                       )}

                       {isRent && isExpanded && (
                         <div className="ml-16 space-y-4 pt-3 pb-8 border-l-4 border-rose-500/20 pl-8 animate-in slide-in-from-top-3 duration-300">
                           <div className="p-6 rounded-[2rem] bg-rose-50 border border-rose-100 flex justify-between items-center shadow-sm">
                             <div className="flex items-center gap-4">
                               <Building2 size={16} className="text-rose-500" />
                               <span className="text-[12px] font-black uppercase tracking-widest text-rose-700">Lease Liability</span>
                             </div>
                             <span className="text-lg font-black text-slate-900">₹{analytics.rentTotal.toLocaleString()}</span>
                           </div>
                         </div>
                       )}
                    </div>
                  );
                })}
             </div>
          </section>

          {/* COGS ANATOMY */}
          {analytics.cogsTotal > 0 && (
            <section className="bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden">
               <div className="flex flex-col md:flex-row md:items-center justify-between gap-8 mb-12">
                  <div className="flex items-center gap-4">
                    <div className="p-4 bg-amber-50 text-amber-600 rounded-[1.5rem] shadow-inner"><Target size={28}/></div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-900 tracking-tight">Functional Anatomy</h3>
                       <p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Detailed allocation for current burn mode</p>
                    </div>
                  </div>
                  <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
                    <button onClick={() => setCogsVisualMode('pie')} className={`p-3 rounded-xl transition-all ${cogsVisualMode === 'pie' ? 'bg-white text-indigo-600 shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}><PieIcon size={20}/></button>
                    <button onClick={() => setCogsVisualMode('bar')} className={`p-3 rounded-xl transition-all ${cogsVisualMode === 'bar' ? 'bg-white text-indigo-600 shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}><LayoutGrid size={20}/></button>
                  </div>
               </div>
               {cogsVisualMode === 'bar' ? (
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center animate-in fade-in duration-500">
                    <div className="space-y-8">
                      {[
                        { id: 'FOOD', label: 'Ingredients', color: 'bg-emerald-500', icon: Utensils },
                        { id: 'DRINKS', label: 'Beverage Base', color: 'bg-indigo-500', icon: Coffee },
                        { id: 'FOOD SERVINGS', label: 'Packaging (Food)', color: 'bg-amber-400', icon: Box },
                        { id: 'DRINKS SERVINGS', label: 'Packaging (Drink)', color: 'bg-rose-400', icon: Grape }
                      ].map(bucket => {
                        const rawBucketAmt = analytics.cogsBucketAgg[bucket.id] || 0;
                        let adjustedAmt = rawBucketAmt;

                        if (bucket.id.includes('SERVINGS')) {
                           const totalServingsRaw = (analytics.cogsBucketAgg['FOOD SERVINGS'] || 0) + (analytics.cogsBucketAgg['DRINKS SERVINGS'] || 0);
                           const servingWeight = totalServingsRaw > 0 ? rawBucketAmt / totalServingsRaw : 0;
                           adjustedAmt = Math.max(0, rawBucketAmt - (analytics.totalCogsOffset * servingWeight));
                        }

                        const percent = (adjustedAmt / (analytics.cogsTotal || 1)) * 100;
                        if (percent <= 0) return null;
                        return (
                          <div key={bucket.id} className="group">
                             <div className="flex justify-between items-center mb-3 px-1">
                                <div className="flex items-center gap-3">
                                   <div className={`p-2 rounded-xl ${bucket.color} text-white shadow-lg shadow-inner`}><bucket.icon size={12} /></div>
                                   <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">{bucket.label}</span>
                                </div>
                                <span className="text-xs font-black text-slate-900">₹{adjustedAmt.toLocaleString()} <span className="text-slate-300 font-bold ml-1 text-[10px]">{percent.toFixed(0)}%</span></span>
                             </div>
                             <div className="h-3 bg-slate-50 rounded-full overflow-hidden shadow-inner">
                                <div className={`h-full ${bucket.color} transition-all duration-1000 ease-out shadow-sm`} style={{ width: `${percent}%` }} />
                             </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="bg-slate-50 rounded-[3.5rem] p-16 border border-slate-100 flex items-center justify-center relative overflow-hidden h-full min-h-[350px] shadow-inner">
                       <div className="absolute top-0 left-0 p-12 opacity-5 pointer-events-none"><PieIcon size={200} /></div>
                       <div className="w-full flex items-center justify-center gap-3 h-48 relative z-10">
                         {['FOOD', 'DRINKS', 'FOOD SERVINGS', 'DRINKS SERVINGS'].map(b => {
                           const amtRaw = analytics.cogsBucketAgg[b] || 0;
                           let adjAmt = amtRaw;
                           if (b.includes('SERVINGS')) {
                             const totalServingsRaw = (analytics.cogsBucketAgg['FOOD SERVINGS'] || 0) + (analytics.cogsBucketAgg['DRINKS SERVINGS'] || 0);
                             const servingWeight = totalServingsRaw > 0 ? amtRaw / totalServingsRaw : 0;
                             adjAmt = Math.max(0, amtRaw - (analytics.totalCogsOffset * servingWeight));
                           }
                           const weight = adjAmt / (analytics.cogsTotal || 1);
                           if (weight < 0.01) return null;
                           const colorMap: any = { 'FOOD': 'bg-emerald-500', 'DRINKS': 'bg-indigo-500', 'FOOD SERVINGS': 'bg-amber-400', 'DRINKS SERVINGS': 'bg-rose-400' };
                           return <div key={b} style={{ flex: weight }} className={`h-full ${colorMap[b]} rounded-3xl flex items-center justify-center group relative hover:scale-110 hover:z-10 transition-all shadow-xl border-4 border-white/20`} />;
                         })}
                       </div>
                    </div>
                 </div>
               ) : <CogsPieRenderer />}
            </section>
          )}

          {/* BURN TRAJECTORY */}
          <section className="bg-white p-10 rounded-[3.5rem] border border-slate-100 shadow-xl overflow-hidden">
             <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-8 mb-16">
                <div className="flex items-center gap-5">
                   <div className="p-4 bg-indigo-50 text-indigo-600 rounded-[1.5rem] shadow-inner"><Activity size={28}/></div>
                   <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight">Structural Burn Trajectory</h3>
                      <p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Multi-month comparative analysis of core modes</p>
                   </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-4">
                  <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
                    <button onClick={() => setTrajectoryMode('stacked')} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${trajectoryMode === 'stacked' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>Stacked</button>
                    <button onClick={() => setTrajectoryMode('grouped')} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${trajectoryMode === 'grouped' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>Grouped</button>
                    <button onClick={() => setTrajectoryMode('line')} className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${trajectoryMode === 'line' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400'}`}>Lines</button>
                  </div>
                  <div className="h-10 w-px bg-slate-200 hidden lg:block mx-2" />
                  <div className="flex items-center gap-2">
                    {[3, 6, 9, 12].map(m => (
                      <button 
                        key={m} 
                        onClick={() => setTrajectoryMonths(m)}
                        className={`w-10 h-10 rounded-xl font-black text-[10px] transition-all ${trajectoryMonths === m ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                      >
                        {m}M
                      </button>
                    ))}
                  </div>
                </div>
             </div>

             <div className="relative h-[400px] w-full pl-16 pr-8 cursor-crosshair group/chart">
                <svg viewBox="0 0 1000 350" className="w-full h-full overflow-visible" preserveAspectRatio="none">
                   {[0, 0.25, 0.5, 0.75, 1].map(p => (
                     <g key={p}>
                        <line x1="0" y1={350 - p * 350} x2="1000" y2={350 - p * 350} stroke="#f1f5f9" strokeWidth="1.5" />
                        <text x="-12" y={350 - p * 350 + 4} textAnchor="end" className="fill-slate-300 text-[10px] font-black">{Math.round((maxTrajectoryVal * p) / 1000)}k</text>
                     </g>
                   ))}

                   {trajectoryMode === 'stacked' && (
                     trajectoryData.map((d, i) => {
                        const x = (i / (trajectoryData.length - 1)) * 1000;
                        const width = (1000 / trajectoryData.length) * 0.7;
                        let currentY = 350;
                        return (
                          <g key={i} onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredPoint({ x: rect.left + rect.width/2, y: rect.top, label: `${d.month} ${d.year}`, values: { COGS: d.COGS, OPERATIONS: d.OPERATIONS, LABOUR: d.LABOUR, 'FIXED (RENT)': d['FIXED (RENT)'], UNMAPPED: d.UNCATEGORIZED }, total: d.total });
                          }} onMouseLeave={() => setHoveredPoint(null)}>
                            {['COGS', 'OPERATIONS', 'LABOUR', 'FIXED (RENT)', 'UNCATEGORIZED'].map(pillar => {
                               const val = d[pillar as keyof typeof d] as number;
                               const h = (val / maxTrajectoryVal) * 350;
                               const bar = <rect key={pillar} x={x - width/2} y={currentY - h} width={width} height={h} fill={PILLAR_COLORS[pillar]} rx="3" className="transition-all duration-500 hover:opacity-100 opacity-90" />;
                               currentY -= h;
                               return bar;
                            })}
                          </g>
                        );
                     })
                   )}

                   {trajectoryMode === 'grouped' && (
                     trajectoryData.map((d, i) => {
                        const centerX = (i / (trajectoryData.length - 1)) * 1000;
                        const groupWidth = (1000 / trajectoryData.length) * 0.85;
                        const barWidth = groupWidth / 5;
                        return (
                          <g key={i} onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHoveredPoint({ x: rect.left + rect.width/2, y: rect.top, label: `${d.month} ${d.year}`, values: { COGS: d.COGS, OPERATIONS: d.OPERATIONS, LABOUR: d.LABOUR, 'FIXED (RENT)': d['FIXED (RENT)'], UNMAPPED: d.UNCATEGORIZED }, total: d.total });
                          }} onMouseLeave={() => setHoveredPoint(null)}>
                            {['COGS', 'OPERATIONS', 'LABOUR', 'FIXED (RENT)', 'UNCATEGORIZED'].map((pillar, idx) => {
                               const val = d[pillar as keyof typeof d] as number;
                               const h = (val / maxTrajectoryVal) * 350;
                               const x = (centerX - groupWidth/2) + (idx * barWidth);
                               return <rect key={pillar} x={x} y={350 - h} width={barWidth * 0.9} height={h} fill={PILLAR_COLORS[pillar]} rx="2" className="transition-all duration-500 hover:opacity-100 opacity-90" />;
                            })}
                          </g>
                        );
                     })
                   )}

                   {trajectoryMode === 'line' && (
                     ['COGS', 'OPERATIONS', 'LABOUR', 'FIXED (RENT)', 'UNCATEGORIZED'].map(pillar => {
                        const points = trajectoryData.map((d, i) => {
                           const x = (i / (trajectoryData.length - 1)) * 1000;
                           const y = 350 - ((d[pillar as keyof typeof d] as number) / maxTrajectoryVal) * 350;
                           return `${x},${y}`;
                        }).join(' L ');
                        return (
                          <g key={pillar} className="group">
                             <path d={`M ${points}`} fill="none" stroke={PILLAR_COLORS[pillar]} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="transition-all duration-700 opacity-80 group-hover:opacity-100" />
                             {trajectoryData.map((d, i) => (
                               <circle key={i} cx={(i / (trajectoryData.length - 1)) * 1000} cy={350 - ((d[pillar as keyof typeof d] as number) / maxTrajectoryVal) * 350} r="5" fill="white" stroke={PILLAR_COLORS[pillar]} strokeWidth="3" className="transition-all duration-300 cursor-pointer" onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setHoveredPoint({ x: rect.left, y: rect.top, label: `${d.month} ${d.year}`, values: { [pillar]: (d[pillar as keyof typeof d] as number) }, total: (d[pillar as keyof typeof d] as number) });
                               }} onMouseLeave={() => setHoveredPoint(null)} />
                             ))}
                          </g>
                        );
                     })
                   )}
                </svg>
                <div className="flex justify-between mt-10 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] px-2">
                   {trajectoryData.map(d => <span key={`${d.month}-${d.year}`}>{d.label}</span>)}
                </div>
             </div>

             <div className="mt-16 flex flex-wrap items-center gap-10 bg-slate-50 p-8 rounded-[2.5rem] border border-slate-100">
                {Object.entries(PILLAR_COLORS).map(([label, color]) => (
                  <div key={label} className="flex items-center gap-3 group">
                     <div className="w-4 h-4 rounded-full shadow-inner" style={{ backgroundColor: color }} />
                     <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest group-hover:text-slate-900 transition-colors">{label}</span>
                  </div>
                ))}
             </div>
          </section>
        </>
      )}

      {hoveredPoint && (
        <div 
          className="fixed pointer-events-none z-[1000] animate-in fade-in zoom-in-95 duration-150"
          style={{ left: hoveredPoint.x, top: hoveredPoint.y - 15, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-slate-950 text-white px-6 py-4 rounded-3xl shadow-2xl border border-white/10 flex flex-col items-center min-w-[180px]">
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 border-b border-white/10 pb-2 w-full text-center">{hoveredPoint.label}</span>
             <div className="space-y-1.5 w-full">
                {Object.entries(hoveredPoint.values).map(([k, v]) => (
                  <div key={k} className="flex justify-between items-center gap-6">
                     <span className="text-[9px] font-black text-slate-500 uppercase tracking-tighter">{k.split(' ')[0]}</span>
                     <span className="text-[11px] font-black">₹{v.toLocaleString()}</span>
                  </div>
                ))}
             </div>
             <div className="mt-3 pt-3 border-t border-white/10 w-full flex justify-between items-center">
                <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Total</span>
                <p className="text-sm font-black tracking-tight">₹{hoveredPoint.total.toLocaleString()}</p>
             </div>
             <div className="absolute top-full left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-950 rotate-45 -mt-2 shadow-xl" />
          </div>
        </div>
      )}
    </div>
  );
};

export default ExpenseHub;
