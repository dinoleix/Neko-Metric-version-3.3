
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { computeConsumption, closingStockTotal } from '../pnlService';
import { 
  SalesMonthlySnapshot, 
  ExpenseMonthlySnapshot, 
  CogsAdjustment,
  Employee,
  StoreRental,
  MonthlyPayroll,
  getOutletName, 
  MASTER_OUTLETS, 
  DEFAULT_COGS, 
  DEFAULT_LABOUR, 
  DEFAULT_OPS,
  CategorySettings,
  MONTH_NAMES
} from '../types';
import { 
  Crown, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Zap, 
  ShieldCheck, 
  ArrowUpRight, 
  ArrowDownRight, 
  Building2, 
  Smartphone, 
  Store, 
  Scale, 
  AlertTriangle,
  Loader2,
  RefreshCw,
  Clock,
  ChevronRight,
  Coins,
  PackageCheck,
  Calendar,
  CloudSun
} from 'lucide-react';
import WeatherWidget from './WeatherWidget';
import { getCachedCollection } from '../referenceCache';

const ExecDashboard: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [expenseSnaps, setExpenseSnaps] = useState<ExpenseMonthlySnapshot[]>([]);
  const [adjustments, setAdjustments] = useState<CogsAdjustment[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [payrolls, setPayrolls] = useState<MonthlyPayroll[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const constraints = [where('userId', '==', dataOwnerId)];
      const [sSnap, eSnap, aSnap, empArr, rentArr, payArr] = await Promise.all([
        getDocs(query(collection(db, 'sales_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'expense_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'cogs_adjustments'), ...constraints)),
        getCachedCollection<Employee>('employees', dataOwnerId),
        getCachedCollection<StoreRental>('rentals', dataOwnerId),
        getCachedCollection<MonthlyPayroll>('monthly_payrolls', dataOwnerId)
      ]);
      setSalesSnaps(sSnap.docs.map(d => d.data() as SalesMonthlySnapshot));
      setExpenseSnaps(eSnap.docs.map(d => d.data() as ExpenseMonthlySnapshot));
      setAdjustments(aSnap.docs.map(d => d.data() as CogsAdjustment));
      setEmployees(empArr);
      setRentals(rentArr);
      setPayrolls(payArr);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user]);

  const metrics = useMemo(() => {
    if (salesSnaps.length === 0 && expenseSnaps.length === 0) return null;

    const allAvailablePeriods = [
      ...salesSnaps.map(s => ({ month: s.month, year: s.year })),
      ...expenseSnaps.map(e => ({ month: e.month, year: e.year }))
    ].sort((a, b) => {
      // FIX: Add safety checks for month attributes before calling indexOf
      const idxA = a.month ? MONTH_NAMES.indexOf(a.month) : 0;
      const idxB = b.month ? MONTH_NAMES.indexOf(b.month) : 0;
      const valA = parseInt(a.year || '0') * 12 + idxA;
      const valB = parseInt(b.year || '0') * 12 + idxB;
      return valB - valA;
    });

    if (allAvailablePeriods.length === 0) return null;

    const latestMonth = allAvailablePeriods[0].month;
    const latestYear = allAvailablePeriods[0].year;

    const currentSales = salesSnaps.filter(s => s.month === latestMonth && s.year === latestYear);
    const currentExpenses = expenseSnaps.filter(s => s.month === latestMonth && s.year === latestYear);
    const currentAdjustments = adjustments.filter(a => a.month === latestMonth && a.year === latestYear);
    const currentPayrolls = payrolls.filter(p => p.month === latestMonth && p.year === latestYear);

    const totalGoodGross = currentSales.reduce((acc, s) => acc + (s.posGoodGross || 0) + (s.onlineGoodGross || 0) + (s.eventRevenue || 0), 0);
    const cashInflow = currentSales.reduce((acc, s) => acc + (s.posGoodNet || 0) + (s.onlineGoodNet || 0) + (s.eventRevenue || 0), 0);

    const totalPurchases = currentExpenses.reduce((acc, s) => acc + (s.totalPurchase || 0) + (s.crewTotalPurchase || 0), 0);
    // Consumption = Opening + Purchases − Closing (shared with PnLHub)
    const stockOffset = closingStockTotal(currentAdjustments);
    const netMaterialConsumption = computeConsumption(totalPurchases, currentAdjustments);

    // BUG-03 fix: separate labour-classified rows from general opex so they don't stack on top of totalFixedPayroll
    let csvLabourFromExpenses = 0;
    currentExpenses.forEach(s => {
      const processMap = (map: Record<string, number> | undefined) => {
        Object.entries(map || {}).forEach(([cat, amt]) => {
          if (DEFAULT_LABOUR.includes(cat.trim().toUpperCase())) csvLabourFromExpenses += Math.abs(Number(amt) || 0);
        });
      };
      processMap(s.expenseByCategory);
      processMap((s as any).crewExpenseByCategory);
    });
    const totalOpExBills = currentExpenses.reduce((acc, s) => acc + (s.totalExpense || 0) + (s.crewTotalExpense || 0), 0) - csvLabourFromExpenses;

    const totalRent = rentals.reduce((acc, r) => acc + (r.status === 'active' ? r.currentRent : 0), 0);
    const totalFixedPayroll = MASTER_OUTLETS.reduce((acc, o) => {
       const fiscal = currentPayrolls.find(p => p.outletId === o.id);
       if (fiscal) return acc + fiscal.totalAmount;
       return acc + employees.filter(e => e.outletId === o.id).reduce((sum, e) => sum + (e.currentSalary || 0), 0);
    }, 0);

    const totalBurden = netMaterialConsumption + totalOpExBills + totalRent + totalFixedPayroll;

    const netProfit = cashInflow - totalBurden;
    const netMargin = totalGoodGross > 0 ? (netProfit / totalGoodGross) * 100 : 0;

    const latestMonthIdx = MONTH_NAMES.indexOf(latestMonth);
    const prevMonthIdx = latestMonthIdx - 1;
    const prevMonth = prevMonthIdx < 0 ? MONTH_NAMES[11] : MONTH_NAMES[prevMonthIdx];
    const prevYear = prevMonthIdx < 0 ? (parseInt(latestYear) - 1).toString() : latestYear;
    
    const prevSales = salesSnaps.filter(s => s.month === prevMonth && s.year === prevYear);
    const prevTotalGross = prevSales.reduce((acc, s) => acc + (s.posGoodGross || 0) + (s.onlineGoodGross || 0) + (s.eventRevenue || 0), 0);
    const revenueGrowth = prevTotalGross > 0 ? ((totalGoodGross - prevTotalGross) / prevTotalGross) * 100 : 0;

    const outletStats = MASTER_OUTLETS
      .filter(o => {
        if (o.id === 'GLOBAL') return false;
        const rental = rentals.find(r => r.outletId === o.id);
        return rental?.status === 'active';
      })
      .map(o => {
        const oSales = currentSales.filter(s => s.outletId === o.id);
        const oExp = currentExpenses.filter(s => s.outletId === o.id);
        const oAdj = currentAdjustments.filter(a => a.outletId === o.id);
        const oPay = currentPayrolls.find(p => p.outletId === o.id);
        const oRent = rentals.find(r => r.outletId === o.id)?.currentRent || 0;
        
        const gross = oSales.reduce((acc, s) => acc + (s.posGoodGross || 0) + (s.onlineGoodGross || 0) + (s.eventRevenue || 0), 0);
        const oInflow = oSales.reduce((acc, s) => acc + (s.posGoodNet || 0) + (s.onlineGoodNet || 0) + (s.eventRevenue || 0), 0);
        
        let oCSVLabour = 0;
        oExp.forEach(s => {
          const pm = (map: Record<string, number> | undefined) => Object.entries(map || {}).forEach(([cat, amt]) => {
            if (DEFAULT_LABOUR.includes(cat.trim().toUpperCase())) oCSVLabour += Math.abs(Number(amt) || 0);
          });
          pm(s.expenseByCategory);
          pm((s as any).crewExpenseByCategory);
        });
        const oOpEx = oExp.reduce((acc, s) => acc + (s.totalExpense || 0) + (s.crewTotalExpense || 0), 0) - oCSVLabour;
        const oPurch = oExp.reduce((acc, s) => acc + (s.totalPurchase || 0) + (s.crewTotalPurchase || 0), 0);
        const oOffset = closingStockTotal(oAdj);
        const oStaff = oPay != null ? oPay.totalAmount : employees.filter(e => e.outletId === o.id).reduce((sum, e) => sum + (e.currentSalary || 0), 0);

        const oBurden = oOpEx + computeConsumption(oPurch, oAdj) + oRent + oStaff;
        const profit = oInflow - oBurden;
        const margin = gross > 0 ? (profit / gross) * 100 : 0;

        return { ...o, gross, profit, margin };
      })
      .sort((a, b) => b.profit - a.profit);

    const totalOnlineGross = currentSales.reduce((acc, s) => acc + (s.onlineGoodGross || 0), 0);
    const onlinePercentage = totalGoodGross > 0 ? (totalOnlineGross / totalGoodGross) * 100 : 0;

    return { 
      latestMonth, latestYear, totalGoodGross, cashInflow, netProfit, netMargin, revenueGrowth, 
      outletStats, totalPurchases, totalOpEx: totalOpExBills, stockOffset, totalFixedCosts: totalRent + totalFixedPayroll,
      reportingPeriod: `${latestMonth} ${latestYear}`,
      onlinePercentage
    };
  }, [salesSnaps, expenseSnaps, adjustments, payrolls, employees, rentals]);

  if (loading) {
    return (
      <div className="py-40 text-center">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
        <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Scanning Available Monthly Datasets...</p>
      </div>
    );
  }

  if (!metrics) return (
    <div className="py-40 text-center bg-white rounded-[3rem] border-2 border-dashed border-slate-200">
      <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
      <h3 className="text-xl font-black text-slate-900 uppercase">No Financial Data Found</h3>
      <p className="text-slate-500 mt-2">Upload Sales and Expense CSVs to initialize the Executive Dashboard.</p>
    </div>
  );

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-slate-200">
            <Crown size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">CEO Dashboard</h2>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-2 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-lg font-black text-[10px] uppercase border border-indigo-100">
                <Calendar size={12} /> Reporting Period: {metrics.reportingPeriod}
              </div>
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck size={14} className="text-emerald-500" /> Latest Verified Data
              </p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4 overflow-x-auto pb-2 no-scrollbar max-w-full">
          {rentals.filter(r => r.status === 'active').slice(0, 3).map(r => (
            <WeatherWidget key={r.id} outlet={r} userId={dataOwnerId} />
          ))}
        </div>

        <button onClick={fetchData} className="p-3 bg-white rounded-xl border border-slate-100 text-slate-400 hover:text-indigo-600 shadow-sm transition-colors">
          <RefreshCw size={16} />
        </button>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
        <div className="bg-white p-6 xl:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm group hover:shadow-xl transition-all overflow-hidden">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Global Revenue</p>
          <h4 className="text-xl lg:text-2xl xl:text-3xl font-black text-slate-900 tracking-tighter truncate">₹{metrics.totalGoodGross.toLocaleString('en-IN')}</h4>
          <div className={`mt-4 flex items-center gap-1.5 font-black uppercase text-[10px] ${metrics.revenueGrowth >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {metrics.revenueGrowth >= 0 ? <ArrowUpRight size={14}/> : <ArrowDownRight size={14}/>}
            {Math.abs(metrics.revenueGrowth).toFixed(1)}% vs. Prev Month
          </div>
        </div>

        <div className={`p-6 xl:p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between transition-colors overflow-hidden ${metrics.netProfit >= 0 ? 'bg-emerald-600' : 'bg-rose-600'}`}>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest mb-1 opacity-70">Reconciled Net Profit</p>
            <h4 className="text-xl lg:text-2xl xl:text-3xl font-black tracking-tighter truncate">₹{metrics.netProfit.toLocaleString('en-IN')}</h4>
          </div>
          <div className="mt-4 flex items-center gap-1.5 font-black uppercase text-[10px] opacity-80">
            <Scale size={14} /> Full Waterfall Deduction
          </div>
        </div>

        <div className="bg-slate-900 p-6 xl:p-8 rounded-[2.5rem] text-white shadow-xl overflow-hidden">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Group Net Margin</p>
          <h4 className="text-xl lg:text-2xl xl:text-3xl font-black text-indigo-300 tracking-tighter">{metrics.netMargin.toFixed(1)}%</h4>
          <div className="mt-4 flex items-center gap-1.5 font-black uppercase text-[10px] text-indigo-300">
            <Activity size={14} /> Efficiency Score
          </div>
        </div>

        <div className="bg-white p-6 xl:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Online Sales Mix</p>
          <h4 className="text-xl lg:text-2xl xl:text-3xl font-black text-indigo-600 tracking-tighter">{(metrics.onlinePercentage || 0).toFixed(1)}%</h4>
          <div className="mt-4 flex items-center gap-1.5 font-black uppercase text-[10px] text-slate-400">
            <Smartphone size={14} className="text-indigo-400" /> Digital Channels
          </div>
        </div>

        <div className="bg-white p-6 xl:p-8 rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Burn (Full Opex)</p>
          <h4 className="text-xl lg:text-2xl xl:text-3xl font-black text-slate-900 tracking-tighter truncate">₹{(metrics.totalOpEx + (metrics.totalPurchases - metrics.stockOffset) + metrics.totalFixedCosts).toLocaleString('en-IN')}</h4>
          <div className="mt-4 flex items-center gap-1.5 font-black uppercase text-[10px] text-rose-500">
            <TrendingDown size={14} /> Consolidated Burden
          </div>
        </div>
      </section>

      <section className="bg-white rounded-[3.5rem] p-10 border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between mb-10">
          <div>
            <h3 className="text-2xl font-black text-slate-900 tracking-tight">Outlet Yield Rankings</h3>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Active Units Benchmarking for {metrics.reportingPeriod}</p>
          </div>
          <div className="px-4 py-2 bg-slate-50 rounded-xl border border-slate-100 text-[10px] font-black uppercase text-slate-400 tracking-widest">
            Metric: Reconciled Margin %
          </div>
        </div>

        <div className="space-y-4">
          {metrics.outletStats.length === 0 ? (
            <div className="py-20 text-center border-2 border-dashed border-slate-100 rounded-3xl">
              <Building2 className="w-10 h-10 text-slate-200 mx-auto mb-4" />
              <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">No Active Outlets Registered</p>
            </div>
          ) : metrics.outletStats.map((o, idx) => (
            <div key={o.id} className="p-5 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-between gap-4 hover:bg-white transition-all overflow-hidden">
              <div className="flex items-center gap-4 min-w-0">
                <span className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center font-black text-sm ${idx === 0 ? 'bg-amber-100 text-amber-600' : 'bg-slate-200 text-slate-500'}`}>
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight truncate">{o.name}</h4>
                  <p className="text-[10px] font-bold text-slate-400 uppercase truncate">Gross: ₹{o.gross.toLocaleString('en-IN')}</p>
                </div>
              </div>
              <div className="flex items-center gap-6 xl:gap-12 shrink-0">
                <div className="text-right">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Yield</p>
                  <p className={`text-base font-black ${o.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>₹{o.profit.toLocaleString('en-IN')}</p>
                </div>
                <div className="text-right w-16 xl:w-20">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Margin</p>
                  <p className={`text-base font-black ${o.margin >= 10 ? 'text-indigo-600' : 'text-slate-600'}`}>{o.margin.toFixed(1)}%</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default ExecDashboard;
