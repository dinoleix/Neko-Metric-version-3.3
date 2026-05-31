import React, { useState, useEffect, useMemo, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  SalesMonthlySnapshot, 
  ExpenseMonthlySnapshot,
  MonthlyPayroll,
  PnLMonthlySnapshot,
  MASTER_OUTLETS,
  getOutletName,
  YEAR_OPTIONS,
  MONTH_NAMES,
  DEFAULT_COGS,
  DEFAULT_LABOUR,
  DEFAULT_OPS,
  CategorySettings
} from '../types';
import { 
  Handshake, 
  TrendingUp, 
  Building2, 
  DollarSign, 
  RefreshCw, 
  Target, 
  Scale, 
  Percent, 
  Users, 
  ShoppingCart, 
  Info,
  ShieldCheck,
  Zap,
  LayoutList,
  ChevronRight,
  PieChart,
  History,
  ArrowRight,
  Coins,
  Briefcase,
  Clock,
  X,
  Flame,
  Activity,
  LayoutGrid,
  BarChartHorizontal,
  CalendarDays,
  Utensils,
  Settings,
  AlertTriangle,
  Lock,
  Download
} from 'lucide-react';

type LookbackPeriod = '3M' | '6M' | '1Y' | 'LIFETIME' | 'SPECIFIC';
type ModelType = 'ROYALTY' | 'PROFIT_SHARE';
type ForgeTab = 'projections' | 'sensitivity';

const PartnershipModel: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [expenseSnaps, setExpenseSnaps] = useState<ExpenseMonthlySnapshot[]>([]);
  const [payrolls, setPayrolls] = useState<MonthlyPayroll[]>([]);
  const [pnlSnaps, setPnlSnaps] = useState<PnLMonthlySnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ForgeTab>('projections');
  
  // Settings for Keyword mapping
  const [cogsKeywords, setCogsKeywords] = useState<string[]>(DEFAULT_COGS);
  const [labourKeywords, setLabourKeywords] = useState<string[]>(DEFAULT_LABOUR);

  // Simulation Parameters
  const [modelType, setModelType] = useState<ModelType>('ROYALTY');
  const [benchmarkStore, setBenchmarkStore] = useState('40543'); 
  const [lookback, setLookback] = useState<LookbackPeriod>('LIFETIME');
  
  // Specific Benchmark Month state
  const [benchmarkMonth, setBenchmarkMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [benchmarkYear, setBenchmarkYear] = useState(new Date().getFullYear().toString());

  const [projectedSales, setProjectedSales] = useState(900000);
  const [projectedRent, setProjectedRent] = useState(150000);
  
  // Model Specifics
  const [royaltyFee, setRoyaltyFee] = useState(5); 
  const [franchiseFee, setFranchiseFee] = useState(800000);
  const [partnerSplit, setPartnerSplit] = useState(50);
  const [initialInvestment, setInitialInvestment] = useState(3000000); 

  const fetchData = async () => {
    setLoading(true);
    try {
      const constraints = [where('userId', '==', dataOwnerId)];
      const settingsRef = doc(db, 'category_settings', dataOwnerId);

      const [sSnap, eSnap, pSnap, pnlSnap, setSnap] = await Promise.all([
        getDocs(query(collection(db, 'sales_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'expense_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'monthly_payrolls'), ...constraints)),
        getDocs(query(collection(db, 'pnl_snapshots'), ...constraints)),
        getDoc(settingsRef)
      ]);

      if (setSnap.exists()) {
        const d = setSnap.data() as CategorySettings;
        if (d.cogsKeywords) setCogsKeywords(d.cogsKeywords.map(k => k.trim().toUpperCase()));
        if (d.labourKeywords) setLabourKeywords(d.labourKeywords.map(k => k.trim().toUpperCase()));
      }

      setSalesSnaps(sSnap.docs.map(d => d.data() as SalesMonthlySnapshot));
      setExpenseSnaps(eSnap.docs.map(d => d.data() as ExpenseMonthlySnapshot));
      setPayrolls(pSnap.docs.map(d => d.data() as MonthlyPayroll));
      setPnlSnaps(pnlSnap.docs.map(d => d.data() as PnLMonthlySnapshot));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user]);

  const benchmarkMetrics = useMemo(() => {
    const filterByLookback = (item: { month: string, year: string }) => {
      if (lookback === 'SPECIFIC') {
        return item.month === benchmarkMonth && item.year === benchmarkYear;
      }
      if (lookback === 'LIFETIME') return true;
      
      const now = new Date();
      const itemDate = new Date(parseInt(item.year), MONTH_NAMES.indexOf(item.month), 1);
      const diffMonths = (now.getFullYear() - itemDate.getFullYear()) * 12 + (now.getMonth() - itemDate.getMonth());
      
      if (lookback === '3M') return diffMonths <= 3;
      if (lookback === '6M') return diffMonths <= 6;
      if (lookback === '1Y') return diffMonths <= 12;
      return true;
    };

    // PRIORITY 1: Check for Frozen P&L Snapshots (The "Truth" from P&L Command)
    const storePnlSnaps = pnlSnaps.filter(s => s.outletId === benchmarkStore && filterByLookback(s));
    
    if (storePnlSnaps.length > 0) {
      const totalRev = storePnlSnaps.reduce((acc, s) => acc + s.grossRevenue, 0);
      if (totalRev > 0) {
        return {
          cogsRatio: (storePnlSnaps.reduce((acc, s) => acc + s.cogsAmount, 0) / totalRev) * 100,
          opsRatio: (storePnlSnaps.reduce((acc, s) => acc + s.opsAmount, 0) / totalRev) * 100,
          labourRatio: (storePnlSnaps.reduce((acc, s) => acc + s.labourAmount, 0) / totalRev) * 100,
          sampleCount: storePnlSnaps.length,
          isVerified: true
        };
      }
    }

    // PRIORITY 2: Fallback to dynamic calculation if no P&L snapshots exist
    const storeSales = salesSnaps.filter(s => s.outletId === benchmarkStore && filterByLookback(s));
    const storeExpenses = expenseSnaps.filter(e => e.outletId === benchmarkStore && filterByLookback(e));

    const totalSales = storeSales.reduce((acc: number, s: SalesMonthlySnapshot) => 
      acc + (s.posGoodGross || 0) + (s.onlineGoodGross || 0) + (s.eventRevenue || 0), 0);
    
    if (totalSales === 0) return { cogsRatio: 30, opsRatio: 10, labourRatio: 15, sampleCount: 0, isVerified: false };

    let totalCogs = 0;
    let mappedLabourCost = 0;
    let totalOps = 0;

    storeExpenses.forEach((e: ExpenseMonthlySnapshot) => {
      const processMap = (map: Record<string, number> = {}) => {
        Object.entries(map).forEach(([cat, amt]) => {
          const val = Number(amt || 0);
          if (val === 0) return;
          const upper = cat.trim().toUpperCase();
          if (cogsKeywords.includes(upper)) totalCogs += val;
          else if (labourKeywords.includes(upper)) mappedLabourCost += val;
          else totalOps += val;
        });
      };
      processMap(e.expenseByCategory);
      processMap(e.purchaseByCategory);
    });

    const storePayrolls = payrolls.filter(p => p.outletId === benchmarkStore && filterByLookback(p));
    const totalVerifiedLabour = storePayrolls.reduce((acc: number, p: MonthlyPayroll) => acc + p.totalAmount, 0);
    // BUG-13 fix: use payroll_entries when available (authoritative); fall back to CSV-classified labour
    // Math.max was silently discarding the lower source; this makes the selection explicit
    const finalLabour = totalVerifiedLabour > 0 ? totalVerifiedLabour : mappedLabourCost;

    return {
      cogsRatio: (totalCogs / totalSales) * 100,
      opsRatio: (totalOps / totalSales) * 100,
      labourRatio: (finalLabour / totalSales) * 100,
      sampleCount: storeSales.length,
      isVerified: false
    };
  }, [salesSnaps, expenseSnaps, payrolls, pnlSnaps, benchmarkStore, lookback, benchmarkMonth, benchmarkYear, cogsKeywords, labourKeywords]);

  const simulation = useMemo(() => {
    const calcPnL = (sales: number, rent: number) => {
      const cogs = sales * (benchmarkMetrics.cogsRatio / 100);
      const ops = sales * (benchmarkMetrics.opsRatio / 100);
      const labour = sales * (benchmarkMetrics.labourRatio / 100);
      
      const benchmarkOpEx = cogs + ops + labour;
      const netProfit = sales - benchmarkOpEx - Number(rent);
      
      let royalty = 0;
      let partnerTake = 0;
      let companyTake = 0;

      if (modelType === 'ROYALTY') {
        royalty = sales * (royaltyFee / 100);
        partnerTake = netProfit - royalty; 
        companyTake = royalty;
      } else {
        const divisible = Math.max(0, netProfit);
        partnerTake = divisible * (partnerSplit / 100);
        companyTake = divisible * (1 - partnerSplit / 100);
      }
      
      const marginPercent = sales > 0 ? (netProfit / sales) * 100 : 0;
      
      return { 
        cogs, ops, labour, rent: Number(rent), royalty, netProfit, marginPercent, partnerTake, companyTake
      };
    };

    const current = calcPnL(projectedSales, projectedRent);
    const totalInvestorBurden = Number(initialInvestment) + (modelType === 'PROFIT_SHARE' ? Number(franchiseFee) : 0);
    const paybackMonths = current.partnerTake > 0 ? totalInvestorBurden / current.partnerTake : Infinity;

    const salesSteps = [
      projectedSales * 0.7,
      projectedSales * 0.85,
      projectedSales,
      projectedSales * 1.15,
      projectedSales * 1.3
    ];

    const possibilities = salesSteps.map(s => {
      const pnl = calcPnL(s, projectedRent);
      return { 
        sales: s, 
        ...pnl, 
        payback: pnl.partnerTake > 0 ? totalInvestorBurden / pnl.partnerTake : null 
      };
    });

    const rentSteps = [
      projectedRent * 0.8,
      projectedRent * 0.9,
      projectedRent,
      projectedRent * 1.1,
      projectedRent * 1.25
    ];

    const heatmap = rentSteps.map(r => {
      return {
        rent: r,
        results: salesSteps.map(s => {
          const pnl = calcPnL(s, r);
          return { sales: s, margin: pnl.marginPercent, profit: pnl.netProfit };
        })
      };
    });

    return { current, paybackMonths, possibilities, totalInvestorBurden, heatmap, salesSteps, rentSteps };
  }, [projectedSales, projectedRent, royaltyFee, benchmarkMetrics, initialInvestment, modelType, franchiseFee, partnerSplit]);

  const getHeatmapColor = (margin: number) => {
    if (margin > 15) return 'bg-emerald-600 text-white shadow-inner';
    if (margin > 8) return 'bg-emerald-400 text-emerald-950';
    if (margin > 3) return 'bg-amber-300 text-amber-950';
    if (margin > 0) return 'bg-orange-300 text-orange-950';
    return 'bg-rose-500 text-white animate-pulse';
  };

  const exportSensitivityPDF = useCallback(() => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const storeName = getOutletName(benchmarkStore);
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    // Header
    doc.setFillColor(238, 242, 255);
    doc.rect(0, 0, 297, 38, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(49, 46, 129);
    doc.text('INVESTOR SENSITIVITY MATRIX', 14, 15);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(`Benchmark: ${storeName}  |  Model: ${modelType.replace('_', ' ')}  |  Generated: ${dateStr}`, 14, 22);
    doc.text(`Projected Sales: ₹${Math.round(projectedSales).toLocaleString()}  |  Projected Rent: ₹${Math.round(projectedRent).toLocaleString()}  |  Initial Investment: ₹${Number(initialInvestment).toLocaleString()}`, 14, 29);
    doc.text(`COGS: ${benchmarkMetrics.cogsRatio.toFixed(1)}%  |  Labour: ${benchmarkMetrics.labourRatio.toFixed(1)}%  |  Ops: ${benchmarkMetrics.opsRatio.toFixed(1)}%  |  Payback Period: ${simulation.paybackMonths === Infinity ? 'N/A' : simulation.paybackMonths.toFixed(1) + ' months'}`, 14, 36);

    const headers = [
      'Monthly Sales',
      `COGS (${benchmarkMetrics.cogsRatio.toFixed(1)}%)`,
      `Labour (${benchmarkMetrics.labourRatio.toFixed(1)}%)`,
      'Rent (Fixed)',
      `Ops (${benchmarkMetrics.opsRatio.toFixed(1)}%)`,
      'Net Profit',
      'Partner Payout',
      'Company Take',
      'ROI Time',
    ];

    const rows = simulation.possibilities.map(pos => [
      `₹${Math.round(pos.sales).toLocaleString()}`,
      `₹${Math.round(pos.cogs).toLocaleString()}`,
      `₹${Math.round(pos.labour).toLocaleString()}`,
      `₹${Math.round(pos.rent).toLocaleString()}`,
      `₹${Math.round(pos.ops).toLocaleString()}`,
      `₹${Math.round(pos.netProfit).toLocaleString()}`,
      `₹${Math.round(pos.partnerTake).toLocaleString()}`,
      `₹${Math.round(pos.companyTake).toLocaleString()}`,
      pos.payback ? `${pos.payback.toFixed(1)} mo` : 'No Payback',
    ]);

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: 42,
      styles: { fontSize: 8, cellPadding: 3, font: 'helvetica' },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { fontStyle: 'bold', textColor: [30, 27, 75] },
        5: { fontStyle: 'bold', textColor: [79, 70, 229], halign: 'center' },
        6: { fontStyle: 'bold', textColor: [5, 150, 105], halign: 'center' },
        7: { halign: 'center' },
        8: { halign: 'center' },
      },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const pos = simulation.possibilities[data.row.index];
          const isTarget = pos && Math.abs(pos.sales - projectedSales) < 1;
          if (isTarget) {
            data.cell.styles.fillColor = [238, 242, 255];
            data.cell.styles.fontStyle = 'bold';
          }
          if (data.column.index === 8 && pos?.payback === null) {
            data.cell.styles.textColor = [239, 68, 68];
          }
        }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? 42;
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Neko Metric  |  Confidential — For Investor Use Only', 14, finalY + 8);

    doc.save(`Investor-Sensitivity-Matrix-${storeName.replace(/\s+/g, '-')}-${dateStr.replace(/\s/g, '-')}.pdf`);
  }, [simulation, benchmarkMetrics, benchmarkStore, modelType, projectedSales, projectedRent, initialInvestment]);

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100">
            <Handshake size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Partnership Forge</h2>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">
              {modelType === 'ROYALTY' ? 'Franchise Royalty Simulator' : 'Profit Sharing (FOCO) Simulator'}
            </p>
          </div>
        </div>
        <button onClick={fetchData} className="p-3 bg-white rounded-xl border border-slate-100 text-slate-400 hover:text-indigo-600 shadow-sm transition-colors">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
        </button>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Input Control Panel */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-8">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4 flex items-center gap-2">
                <Briefcase size={12} className="text-indigo-500" /> Partnership Structure
              </label>
              <div className="grid grid-cols-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                <button onClick={() => setModelType('ROYALTY')} className={`py-3 rounded-xl text-[10px] font-black transition-all ${modelType === 'ROYALTY' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>FIXED ROYALTY</button>
                <button onClick={() => setModelType('PROFIT_SHARE')} className={`py-3 rounded-xl text-[10px] font-black transition-all ${modelType === 'PROFIT_SHARE' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}>PROFIT SHARE</button>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4 flex items-center gap-2">
                <Target size={12} className="text-indigo-500" /> Benchmark Outlet
              </label>
              <select 
                value={benchmarkStore} 
                onChange={e => setBenchmarkStore(e.target.value)}
                className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none uppercase text-xs"
              >
                {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4 flex items-center gap-2">
                <History size={12} className="text-indigo-500" /> Performance Window
              </label>
              <div className="grid grid-cols-5 bg-slate-50 p-1.5 rounded-2xl border border-slate-100 mb-4">
                {(['3M', '6M', '1Y', 'LIFETIME', 'SPECIFIC'] as LookbackPeriod[]).map(p => (
                  <button key={p} onClick={() => setLookback(p)} className={`py-2 rounded-xl text-[9px] font-black transition-all ${lookback === p ? 'bg-white text-slate-900 shadow-sm border border-slate-100' : 'text-slate-400'}`}>{p === 'LIFETIME' ? 'ALL' : (p === 'SPECIFIC' ? 'MONTH' : p)}</button>
                ))}
              </div>

              {lookback === 'SPECIFIC' && (
                <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-top-2 duration-300">
                  <div className="relative">
                    <CalendarDays size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <select value={benchmarkMonth} onChange={e => setBenchmarkMonth(e.target.value)} className="w-full pl-9 pr-2 py-3 bg-slate-100 border border-slate-200 rounded-xl font-bold text-[10px] outline-none uppercase">{MONTH_NAMES.map(m => <option key={m} value={m}>{m.substring(0, 3)}</option>)}</select>
                  </div>
                  <select value={benchmarkYear} onChange={e => setBenchmarkYear(e.target.value)} className="w-full px-3 py-3 bg-slate-100 border border-slate-200 rounded-xl font-bold text-[10px] outline-none">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select>
                </div>
              )}
            </div>

            <div className="h-px bg-slate-100" />

            <div className="space-y-6">
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Monthly Sales (Expected)</label>
                  <span className="text-xs font-black text-indigo-600">₹{projectedSales.toLocaleString()}</span>
                </div>
                <input type="range" min="300000" max="3000000" step="50000" value={projectedSales} onChange={e => setProjectedSales(parseInt(e.target.value))} className="w-full h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Rent (Y)</label>
                  <input type="number" value={projectedRent} onChange={e => setProjectedRent(Number(e.target.value) || 0)} className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-black text-sm outline-none" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Setup CAPEX</label>
                  <input type="number" value={initialInvestment} onChange={e => setInitialInvestment(Number(e.target.value) || 0)} className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-black text-sm outline-none" placeholder="CAPEX" />
                </div>
              </div>

              {modelType === 'ROYALTY' ? (
                <div>
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Company Royalty %</label>
                  <div className="relative">
                    <Percent size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="number" value={royaltyFee} onChange={e => setRoyaltyFee(Number(e.target.value) || 0)} className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-black text-sm outline-none" />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Franchise Fee</label>
                    <input type="number" value={franchiseFee} onChange={e => setFranchiseFee(Number(e.target.value) || 0)} className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-black text-sm outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Partner Split %</label>
                    <div className="relative">
                      <Percent size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input type="number" value={partnerSplit} onChange={e => setPartnerSplit(Number(e.target.value) || 0)} className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-black text-sm outline-none" />
                    </div>
                  </div>
                </div>
              )}
            </div>
            
            {benchmarkMetrics.sampleCount === 0 && (
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-start gap-3 mt-4">
                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[10px] font-bold text-amber-700 leading-relaxed uppercase">No data found for {getOutletName(benchmarkStore)} in this window. Using industry defaults.</p>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-6">
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className={`p-8 rounded-[2.5rem] shadow-xl relative overflow-hidden transition-colors duration-500 ${simulation.current.partnerTake >= 0 ? 'bg-emerald-600' : 'bg-rose-600'} text-white`}>
               <div className="absolute top-0 right-0 p-6 opacity-10"><TrendingUp size={80} /></div>
               <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-70">Partner Monthly Yield</p>
               <h4 className="text-3xl font-black tracking-tighter">₹{Math.round(simulation.current.partnerTake).toLocaleString()}</h4>
               <p className="text-[9px] font-bold uppercase mt-4">Operational Net Profit: ₹{Math.round(simulation.current.netProfit).toLocaleString()}</p>
             </div>
             <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between">
               <div>
                 <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Months to Payback</p>
                 <div className="flex items-baseline gap-2">
                   <h4 className="text-3xl font-black tracking-tighter">{simulation.paybackMonths === Infinity ? 'N/A' : simulation.paybackMonths.toFixed(1)}</h4>
                   {simulation.paybackMonths !== Infinity && <span className="text-[10px] font-black uppercase text-indigo-300">Months</span>}
                 </div>
               </div>
               <div className="mt-4 flex items-center gap-2 text-indigo-300 text-[10px] font-black uppercase"><RefreshCw size={12} /> ROI Velocity</div>
             </div>
             <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
               <div>
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Company Share</p>
                 <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{Math.round(simulation.current.companyTake).toLocaleString()}</h4>
               </div>
               <div className="mt-4 flex items-center gap-2 text-rose-500 text-[10px] font-black uppercase"><Coins size={12} /> Operator Inflow</div>
             </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center">
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-8">Monthly Profit Split</h4>
                <div className="relative w-40 h-40 mb-6">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    {(() => {
                      const items = [{ label: 'Partner', val: Math.max(0, simulation.current.partnerTake), color: '#10b981' }, { label: 'Company', val: Math.max(0, simulation.current.companyTake), color: '#6366f1' }];
                      const total = items.reduce((a, b) => a + b.val, 0) || 1;
                      let currentOffset = 0;
                      return items.map((item, i) => {
                        const percent = (item.val / total) * 100;
                        if (percent <= 0) return null;
                        const strokeDash = `${percent} ${100 - percent}`;
                        const el = <circle key={i} cx="50" cy="50" r="40" fill="transparent" stroke={item.color} strokeWidth="16" strokeDasharray={strokeDash} strokeDashoffset={-currentOffset} />;
                        currentOffset += percent;
                        return el;
                      });
                    })()}
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                     <p className="text-[16px] font-black text-slate-900">₹{Math.round(Math.max(0, simulation.current.partnerTake + simulation.current.companyTake)).toLocaleString()}</p>
                     <p className="text-[8px] font-black text-slate-400 uppercase">Total Profit</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-6 text-left w-full max-w-[240px] mx-auto">
                   <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-emerald-500 shadow-sm"/><span className="text-[9px] font-black text-slate-500 uppercase">Partner</span></div>
                   <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-indigo-500 shadow-sm"/><span className="text-[9px] font-black text-slate-500 uppercase">Company</span></div>
                </div>
              </div>
              <div className="bg-slate-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 right-0 p-8 opacity-5"><PieChart size={140} /></div>
                <div>
                  <h4 className="text-lg font-black uppercase tracking-tight mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-indigo-400" /> Investment Summary</h4>
                  <p className="text-slate-400 text-xs leading-relaxed mb-6">In this <span className="text-white font-bold">{modelType.replace('_', ' ')}</span> model, the investor recovers their capital in <span className="text-emerald-400 font-black">{simulation.paybackMonths === Infinity ? 'N/A' : `${simulation.paybackMonths.toFixed(1)} months`}</span>.</p>
                  <div className="space-y-3">
                    <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between"><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Investor Risk</span><span className="text-xs font-black text-white">₹{simulation.totalInvestorBurden.toLocaleString()}</span></div>
                    <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between"><span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Profit Share</span><span className="text-xs font-black text-emerald-400">{modelType === 'ROYALTY' ? `${(simulation.current.partnerTake / (simulation.current.netProfit || 1) * 100).toFixed(0)}% of profit` : `${partnerSplit}% share`}</span></div>
                  </div>
                </div>
              </div>
           </div>
        </div>
      </section>

      <section className="space-y-12">
          <div className="flex bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner">
             <button onClick={() => setActiveTab('projections')} className={`px-10 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'projections' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><BarChartHorizontal size={16} /> Investor Sensitivity Matrix</button>
             <button onClick={() => setActiveTab('sensitivity')} className={`px-10 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'sensitivity' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Zap size={16} /> Operational Risk Heatmap</button>
          </div>
          {activeTab === 'projections' ? (
            <div className="animate-in slide-in-from-bottom-4 duration-500">
               <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden w-full">
                 <div className="p-10 border-b border-slate-50 flex flex-col lg:flex-row lg:items-center justify-between bg-slate-50/50 gap-6">
                   <div className="flex items-center gap-4">
                     <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><LayoutList size={24}/></div>
                     <div>
                       <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Investor Sensitivity Matrix</h3>
                       <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1">Projections based on {getOutletName(benchmarkStore)} proportional ratios</p>
                     </div>
                   </div>
                   <div className="flex flex-wrap items-center gap-6">
                     <div className="flex flex-wrap items-center gap-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        <span className="flex items-center gap-2"><Utensils size={12} className="text-emerald-500" /> Materials Ratio: {benchmarkMetrics.cogsRatio.toFixed(1)}%</span>
                        <span className="flex items-center gap-2"><Users size={12} className="text-indigo-500" /> Labour Ratio: {benchmarkMetrics.labourRatio.toFixed(1)}%</span>
                        <span className="flex items-center gap-2"><Settings size={12} className="text-pink-500" /> Utility Ratio: {benchmarkMetrics.opsRatio.toFixed(1)}%</span>
                        {benchmarkMetrics.isVerified && <span className="flex items-center gap-2 bg-emerald-50 text-emerald-600 px-3 py-1 rounded-lg border border-emerald-100"><Lock size={12} /> Verified Snapshots</span>}
                     </div>
                     <button onClick={exportSensitivityPDF} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-md shadow-indigo-200 transition-all shrink-0">
                       <Download size={13} /> Export PDF
                     </button>
                   </div>
                 </div>
                 <div className="overflow-x-auto">
                   <table className="w-full text-left min-w-[1000px]">
                     <thead className="bg-white border-b border-slate-100">
                       <tr>
                         <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Monthly Sales</th>
                         <th className="px-6 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Est. COGS ({benchmarkMetrics.cogsRatio.toFixed(1)}%)</th>
                         <th className="px-6 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Est. Labour ({benchmarkMetrics.labourRatio.toFixed(1)}%)</th>
                         <th className="px-6 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Rent (Fixed)</th>
                         <th className="px-6 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Est. Ops ({benchmarkMetrics.opsRatio.toFixed(1)}%)</th>
                         <th className="px-8 py-6 text-[10px] font-black text-indigo-600 uppercase text-center bg-indigo-50/30">Net Profit (Unit)</th>
                         <th className="px-10 py-6 text-[10px] font-black text-emerald-600 uppercase text-center">Partner Payout</th>
                         <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Company Take</th>
                         <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase text-center">ROI Time</th>
                       </tr>
                     </thead>
                     <tbody className="divide-y divide-slate-50">
                       {simulation.possibilities.map((pos, idx) => {
                         const isTarget = Math.abs(pos.sales - projectedSales) < 1;
                         return (
                           <tr key={idx} className={`group transition-all ${isTarget ? 'bg-indigo-50/50' : 'hover:bg-slate-50'}`}>
                             <td className="px-10 py-6"><span className={`text-sm font-black ${isTarget ? 'text-indigo-600' : 'text-slate-900'}`}>₹{Math.round(pos.sales).toLocaleString()}</span></td>
                             <td className="px-6 py-6 text-center text-[11px] font-bold text-slate-500">₹{Math.round(pos.cogs).toLocaleString()}</td>
                             <td className="px-6 py-6 text-center text-[11px] font-bold text-slate-500">₹{Math.round(pos.labour).toLocaleString()}</td>
                             <td className="px-6 py-6 text-center text-[11px] font-bold text-slate-500">₹{Math.round(pos.rent).toLocaleString()}</td>
                             <td className="px-6 py-6 text-center text-[11px] font-bold text-slate-500">₹{Math.round(pos.ops).toLocaleString()}</td>
                             <td className="px-8 py-6 text-center text-sm font-black text-indigo-700 bg-indigo-50/20">₹{Math.round(pos.netProfit).toLocaleString()}</td>
                             <td className="px-10 py-6 text-center text-sm font-black text-emerald-600">₹{Math.round(pos.partnerTake).toLocaleString()}</td>
                             <td className="px-10 py-6 text-center text-xs font-black text-slate-900">₹{Math.round(pos.companyTake).toLocaleString()}</td>
                             <td className="px-10 py-6 text-center">{pos.payback ? (<div className="inline-flex flex-col items-center bg-slate-900 text-white rounded-xl py-2 px-4 shadow-lg shadow-slate-200 min-w-[100px]"><span className="text-sm font-black tracking-tight">{pos.payback.toFixed(1)}</span><span className="text-[8px] font-black uppercase text-indigo-400 tracking-widest mt-[-2px]">Months</span></div>) : (<span className="text-rose-400 font-black text-[10px] uppercase flex items-center justify-center gap-1"><X size={10} /> No Payback</span>)}</td>
                           </tr>
                         );
                       })}
                     </tbody>
                   </table>
                 </div>
               </section>
            </div>
          ) : (
            <div className="animate-in slide-in-from-bottom-4 duration-500">
               <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-10 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                     <div className="flex items-center gap-4"><div className="p-3 bg-rose-50 text-rose-600 rounded-2xl shadow-inner"><Flame size={24}/></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Operational Sensitivity Heatmap</h3><p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-1">Simulating Unit Net Margin %: Rent vs. Sales Load</p></div></div>
                     <div className="flex gap-4"><div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-emerald-600 shadow-sm"/><span className="text-[9px] font-black text-slate-500 uppercase">Optimal (15%+)</span></div><div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-amber-300 shadow-sm"/><span className="text-[9px] font-black text-slate-500 uppercase">Warning (&lt;5%)</span></div><div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-rose-500 shadow-sm animate-pulse"/><span className="text-[9px] font-black text-slate-500 uppercase">Danger (Deficit)</span></div></div>
                  </div>
                  <div className="p-10">
                     <div className="overflow-x-auto">
                        <table className="w-full text-center border-separate border-spacing-2">
                           <thead>
                              <tr>
                                 <th className="p-4 bg-slate-50 rounded-2xl border border-slate-100"><p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Rent ↓ / Sales →</p></th>
                                 {simulation.salesSteps.map((s, idx) => (<th key={idx} className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100"><p className="text-indigo-600 font-black text-[10px]">₹{(s/1000).toFixed(0)}k</p><p className="text-[8px] font-black text-indigo-300 uppercase">Sales</p></th>))}
                              </tr>
                           </thead>
                           <tbody>
                              {simulation.heatmap.map((row, rIdx) => (
                                 <tr key={rIdx}>
                                    <td className="p-4 bg-slate-900 text-white rounded-2xl shadow-lg"><p className="text-[10px] font-black">₹{(row.rent/1000).toFixed(0)}k</p><p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter">Rent</p></td>
                                    {row.results.map((res, sIdx) => (<td key={sIdx} className={`p-6 rounded-2xl transition-all hover:scale-105 cursor-help group relative ${getHeatmapColor(res.margin)}`}><span className="text-xs font-black">{res.margin.toFixed(1)}%</span><div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 hidden group-hover:block z-20 pointer-events-none"><div className="bg-slate-900 text-white p-4 rounded-2xl shadow-2xl min-w-[160px] text-left border border-white/10"><p className="text-[8px] font-black text-slate-500 uppercase mb-2">Scenario Analysis</p><div className="space-y-1"><div className="flex justify-between text-[10px] font-bold"><span className="text-slate-400">Sales:</span><span>₹{Math.round(res.sales).toLocaleString()}</span></div><div className="flex justify-between text-[10px] font-bold"><span className="text-slate-400">Rent:</span><span>₹{Math.round(row.rent).toLocaleString()}</span></div><div className="h-px bg-white/10 my-2" /><div className="flex justify-between text-[10px] font-black"><span className="text-indigo-400 uppercase">Profit:</span><span className={res.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>₹{Math.round(res.profit).toLocaleString()}</span></div></div></div></div></td>))}
                                 </tr>
                              ))}
                           </tbody>
                        </table>
                     </div>
                     <div className="mt-10 p-6 bg-slate-50 rounded-[2.5rem] border border-slate-100 flex items-start gap-5"><div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-indigo-600 shadow-sm shrink-0"><Activity size={24}/></div><div><h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Risk Corridor Insight</h4><p className="text-slate-500 text-xs leading-relaxed font-medium mt-1">The heatmap visualizes your "Safety Margin". If your <span className="text-rose-600 font-bold">fixed rent</span> exceeds 20% of <span className="text-indigo-600 font-bold">sales</span>, the business enters a high-volatility zone. Use this grid to negotiate lease agreements based on projected platform performance.</p></div></div>
                  </div>
               </section>
            </div>
          )}
          <div className="bg-indigo-50 border border-indigo-100 p-8 rounded-3xl flex items-center gap-8 relative overflow-hidden"><div className="absolute top-0 right-0 p-8 opacity-5"><ShieldCheck size={140} /></div><div className="p-4 bg-white rounded-2xl shadow-sm text-indigo-600 shrink-0"><Info size={32} /></div><div><h4 className="text-xl font-black text-indigo-900 uppercase tracking-tight">Data Calibration</h4><p className="text-indigo-700/80 text-sm font-medium leading-relaxed max-w-2xl mt-1">All simulations use real-world operational ratios (COGS, Labour, Ops) derived from the <b>{getOutletName(benchmarkStore)}</b> dataset. Ensure your input variables align with the store's physical constraints for 99% accuracy.</p></div></div>
      </section>
    </div>
  );
};

export default PartnershipModel;