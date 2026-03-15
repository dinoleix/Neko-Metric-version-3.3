
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from '@firebase/auth';
import { collection, query, getDocs, where } from '@firebase/firestore';
import { db } from '../firebase';
import { 
  SalesSummaryRecord, 
  ExpenseRecord, 
  PurchaseRecord, 
  Employee, 
  StoreRental,
  MONTH_NAMES,
  YEAR_OPTIONS
} from '../types';
import { 
  TrendingUp, 
  RefreshCw,
  MapPin,
  BarChart3,
  Smartphone,
  Target,
  Receipt,
  ShoppingBag,
  ArrowRight,
  ShieldCheck,
  CreditCard,
  Percent,
  Calculator,
  Store,
  CalendarDays,
  AlertCircle,
  SearchX,
  Tag,
  ShoppingCart,
  ArrowDownCircle,
  TrendingDown,
  Layers,
  FileText
} from 'lucide-react';

type AnalyticsTab = 'sales' | 'expenses' | 'purchases';

const Reports: React.FC<{ user: User }> = ({ user }) => {
  const [salesRecords, setSalesRecords] = useState<SalesSummaryRecord[]>([]);
  const [expenseRecords, setExpenseRecords] = useState<ExpenseRecord[]>([]);
  const [purchaseRecords, setPurchaseRecords] = useState<PurchaseRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [activeTab, setActiveTab] = useState<AnalyticsTab>('sales');
  const [selectedYear, setSelectedYear] = useState('All Years');
  const [selectedMonth, setSelectedMonth] = useState('All Months');
  const [storeFilter, setStoreFilter] = useState<'all' | string>('all');

  const parseFlexibleDate = (dateStr: string): Date | null => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
    const parts = dateStr.split(/[/-]/);
    if (parts.length === 3) {
      if (parts[0].length === 4) return new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
      return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    }
    return null;
  };

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const qSales = query(collection(db, 'sales_summary'), where('userId', '==', user.uid));
      const qExp = query(collection(db, 'expenses'), where('userId', '==', user.uid));
      const qPur = query(collection(db, 'purchases'), where('userId', '==', user.uid));
      const qEmp = query(collection(db, 'employees'), where('userId', '==', user.uid));
      const qRent = query(collection(db, 'rentals'), where('userId', '==', user.uid));
      
      const [salesSnap, expSnap, purSnap, empSnap, rentSnap] = await Promise.all([
        getDocs(qSales), 
        getDocs(qExp),
        getDocs(qPur),
        getDocs(qEmp),
        getDocs(qRent)
      ]);
      
      const sData = salesSnap.docs.map(d => ({ ...d.data(), id: d.id } as SalesSummaryRecord));
      const eData = expSnap.docs.map(d => ({ ...d.data(), id: d.id } as ExpenseRecord));
      const pData = purSnap.docs.map(d => ({ ...d.data(), id: d.id } as PurchaseRecord));
      const empData = empSnap.docs.map(d => ({ ...d.data(), id: d.id } as Employee));
      const rentData = rentSnap.docs.map(d => ({ ...d.data(), id: d.id } as StoreRental));

      const sortFn = (a: any, b: any) => (parseFlexibleDate(a.date)?.getTime() || 0) - (parseFlexibleDate(b.date)?.getTime() || 0);
      
      setSalesRecords(sData.sort(sortFn));
      setExpenseRecords(eData.sort(sortFn));
      setPurchaseRecords(pData.sort(sortFn));
      setEmployees(empData);
      setRentals(rentData);
    } catch (err: any) {
      console.error(err);
      setError("Failed to sync financial data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    [...salesRecords, ...expenseRecords, ...purchaseRecords].forEach(r => {
      const d = parseFlexibleDate(r.date);
      if (d) years.add(d.getFullYear().toString());
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [salesRecords, expenseRecords, purchaseRecords]);

  // Combined Filters
  const filteredSales = useMemo(() => {
    return salesRecords.filter(r => {
      const d = parseFlexibleDate(r.date);
      if (!d) return false;
      const matchesYear = selectedYear === 'All Years' || d.getFullYear().toString() === selectedYear;
      const matchesMonth = selectedMonth === 'All Months' || MONTH_NAMES[d.getMonth()] === selectedMonth;
      const matchesStore = storeFilter === 'all' || (r.outletName || '').trim() === storeFilter || (r.outletId || '').trim() === storeFilter;
      return matchesYear && matchesMonth && matchesStore;
    });
  }, [salesRecords, selectedYear, selectedMonth, storeFilter]);

  const filteredExpenses = useMemo(() => {
    return expenseRecords.filter(r => {
      const d = parseFlexibleDate(r.date);
      if (!d) return false;
      const matchesYear = selectedYear === 'All Years' || d.getFullYear().toString() === selectedYear;
      const matchesMonth = selectedMonth === 'All Months' || MONTH_NAMES[d.getMonth()] === selectedMonth;
      const matchesStore = storeFilter === 'all' || (r.outletId || '').trim() === storeFilter;
      return matchesYear && matchesMonth && matchesStore;
    });
  }, [expenseRecords, selectedYear, selectedMonth, storeFilter]);

  const filteredPurchases = useMemo(() => {
    return purchaseRecords.filter(r => {
      const d = parseFlexibleDate(r.date);
      if (!d) return false;
      const matchesYear = selectedYear === 'All Years' || d.getFullYear().toString() === selectedYear;
      const matchesMonth = selectedMonth === 'All Months' || MONTH_NAMES[d.getMonth()] === selectedMonth;
      const matchesStore = storeFilter === 'all' || (r.outletId || '').trim() === storeFilter;
      return matchesYear && matchesMonth && matchesStore;
    });
  }, [purchaseRecords, selectedYear, selectedMonth, storeFilter]);

  // Comprehensive Analytics Calculations
  const analytics = useMemo(() => {
    // Sales Logic
    const posSales = filteredSales.filter(r => !r.onlinePlatform || r.onlinePlatform.toLowerCase() === 'none');
    const onlineSales = filteredSales.filter(r => r.onlinePlatform && r.onlinePlatform.toLowerCase() !== 'none');
    const posGross = posSales.reduce((acc, r) => acc + (r.revenue || 0), 0);
    const posTax = posSales.reduce((acc, r) => acc + (r.totalTax || 0), 0);
    const posNet = posGross - posTax;
    const onlineGross = onlineSales.reduce((acc, r) => acc + (r.revenue || 0), 0);
    const onlineNet = onlineGross - onlineSales.reduce((acc, r) => acc + (r.commission || 0) + (r.totalTax || 0) + (r.adCharges || 0), 0);

    // Expense Logic
    const totalExp = filteredExpenses.reduce((acc, r) => acc + (r.amount || 0), 0);
    const expByCategory: Record<string, number> = {};
    filteredExpenses.forEach(e => {
      const cat = e.category || 'Misc';
      expByCategory[cat] = (expByCategory[cat] || 0) + (e.amount || 0);
    });

    // Purchase Logic
    const totalPur = filteredPurchases.reduce((acc, r) => acc + (r.amount || 0), 0);
    const purByCategory: Record<string, number> = {};
    filteredPurchases.forEach(p => {
      const cat = p.category || 'Inventory';
      purByCategory[cat] = (purByCategory[cat] || 0) + (p.amount || 0);
    });

    return { 
      sales: { posGross, posNet, onlineGross, onlineNet, totalRev: posGross + onlineGross },
      expenses: { total: totalExp, byCategory: Object.entries(expByCategory).sort((a, b) => b[1] - a[1]) },
      purchases: { total: totalPur, byCategory: Object.entries(purByCategory).sort((a, b) => b[1] - a[1]) }
    };
  }, [filteredSales, filteredExpenses, filteredPurchases]);

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
            <BarChart3 size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Financial Hub</h2>
            <p className="text-slate-400 text-sm font-medium">Cross-functional business analytics</p>
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2">
            <MapPin size={14} className="text-indigo-500" />
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent font-bold text-xs outline-none">
              <option value="all">All Outlets</option>
              {Array.from(new Set([...salesRecords.map(r => r.outletName || r.outletId), ...rentals.map(r => r.outletId)])).filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          
          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2">
            <CalendarDays size={14} className="text-indigo-500" />
            <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent font-bold text-xs outline-none">
              <option value="All Years">All Years</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 font-bold text-xs outline-none shadow-sm">
            <option value="All Months">All Months</option>
            {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>

          <button onClick={fetchData} className="p-3 bg-white rounded-xl border border-slate-100 text-slate-400 hover:text-indigo-600 shadow-sm transition-colors">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>
          </button>
        </div>
      </header>

      {/* Tab Switcher */}
      <div className="flex bg-slate-200/40 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner">
        {(['sales', 'expenses', 'purchases'] as AnalyticsTab[]).map((tab) => (
          <button 
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all ${
              activeTab === tab 
              ? 'bg-white text-slate-900 shadow-md translate-y-[-1px]' 
              : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {tab === 'sales' && <TrendingUp size={14} className="inline mr-2" />}
            {tab === 'expenses' && <Tag size={14} className="inline mr-2" />}
            {tab === 'purchases' && <ShoppingCart size={14} className="inline mr-2" />}
            {tab}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-40 text-center">
          <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Processing Financial Data...</p>
        </div>
      ) : (
        <div className="animate-in slide-in-from-bottom-6 duration-500">
          
          {/* SALES TAB CONTENT */}
          {activeTab === 'sales' && (
            <div className="space-y-12">
              <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between">
                  <div>
                    <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Total Revenue</p>
                    <h4 className="text-4xl font-black tracking-tighter">₹{analytics.sales.totalRev.toLocaleString()}</h4>
                  </div>
                  <div className="mt-6 flex items-center gap-2 text-indigo-400 text-[10px] font-bold uppercase">
                    <TrendingUp size={12} /> Combined Channels
                  </div>
                </div>
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">POS Net Gain</p>
                  <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{analytics.sales.posNet.toLocaleString()}</h4>
                  <div className="mt-4 flex items-center gap-2 text-slate-300 text-[10px] font-bold uppercase">
                    <Store size={12} /> In-store Sales
                  </div>
                </div>
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Online Net Payout</p>
                  <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{analytics.sales.onlineNet.toLocaleString()}</h4>
                  <div className="mt-4 flex items-center gap-2 text-orange-400 text-[10px] font-bold uppercase">
                    <Smartphone size={12} /> Swiggy/Zomato
                  </div>
                </div>
                <div className="bg-emerald-500 p-8 rounded-[2.5rem] text-white shadow-lg flex flex-col justify-center text-center">
                  <p className="text-[10px] font-black text-emerald-100 uppercase tracking-widest mb-1">Gross Profitability</p>
                  <h4 className="text-4xl font-black tracking-tighter">
                    {analytics.sales.totalRev > 0 ? (((analytics.sales.posNet + analytics.sales.onlineNet) / analytics.sales.totalRev) * 100).toFixed(1) : 0}%
                  </h4>
                </div>
              </section>

              {/* Existing POS and Online breakdown rows could go here */}
              <div className="p-10 bg-white rounded-[3rem] border border-slate-100 text-center font-bold text-slate-300 uppercase text-xs">
                Switch between Years/Months to see Trend Analysis
              </div>
            </div>
          )}

          {/* EXPENSES TAB CONTENT */}
          {activeTab === 'expenses' && (
            <div className="space-y-12">
              <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 bg-rose-500 p-10 rounded-[3rem] text-white shadow-2xl shadow-rose-100 flex flex-col justify-between">
                  <div>
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-6">
                      <TrendingDown size={28} />
                    </div>
                    <p className="text-[10px] font-black text-rose-100 uppercase tracking-widest mb-1">Total Operational Outflow</p>
                    <h4 className="text-5xl font-black tracking-tighter">₹{analytics.expenses.total.toLocaleString()}</h4>
                  </div>
                  <div className="mt-10 pt-6 border-t border-white/10">
                     <p className="text-[10px] font-black text-rose-200 uppercase tracking-widest">Active Records</p>
                     <p className="text-xl font-black">{filteredExpenses.length} Expense Logs</p>
                  </div>
                </div>

                <div className="lg:col-span-2 bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                  <h3 className="text-xl font-black text-slate-900 tracking-tight mb-8">Expense by Category</h3>
                  <div className="space-y-6">
                    {analytics.expenses.byCategory.length > 0 ? analytics.expenses.byCategory.map(([cat, amount], i) => (
                      <div key={cat} className="space-y-2">
                        <div className="flex justify-between items-end">
                          <span className="text-sm font-black text-slate-700">{cat}</span>
                          <span className="text-sm font-black text-slate-900">₹{amount.toLocaleString()}</span>
                        </div>
                        <div className="h-3 bg-slate-50 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full transition-all duration-1000 ${i === 0 ? 'bg-rose-500' : 'bg-rose-300'}`}
                            style={{ width: `${(amount / analytics.expenses.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    )) : (
                      <div className="py-20 text-center text-slate-300 font-bold uppercase text-xs">No Categorized Expenses</div>
                    )}
                  </div>
                </div>
              </section>

              <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
                <div className="p-8 border-b border-slate-50 flex items-center justify-between">
                   <h3 className="text-xl font-black text-slate-900 tracking-tight">Recent Expense Ledger</h3>
                   <button className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">View All Logs</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase">Date</th>
                        <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase">Category</th>
                        <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase">Description</th>
                        <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredExpenses.slice().reverse().slice(0, 10).map((e, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-8 py-4 text-xs font-bold text-slate-500">{e.date}</td>
                          <td className="px-8 py-4">
                            <span className="px-3 py-1 bg-rose-50 text-rose-600 rounded-full text-[10px] font-black uppercase tracking-tight">{e.category}</span>
                          </td>
                          <td className="px-8 py-4 text-xs font-bold text-slate-800 line-clamp-1">{e.description}</td>
                          <td className="px-8 py-4 text-right font-black text-slate-900">₹{e.amount.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {/* PURCHASES TAB CONTENT */}
          {activeTab === 'purchases' && (
            <div className="space-y-12">
              <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 <div className="bg-amber-500 p-8 rounded-[2.5rem] text-white shadow-xl shadow-amber-100 flex flex-col justify-between h-[200px]">
                    <p className="text-[10px] font-black text-amber-100 uppercase tracking-widest mb-1">Total Procurement</p>
                    <h4 className="text-4xl font-black tracking-tighter">₹{analytics.purchases.total.toLocaleString()}</h4>
                    <div className="flex items-center gap-2 mt-4 text-amber-100 text-[10px] font-bold uppercase">
                      <ShoppingCart size={14} /> Supply Chain Spend
                    </div>
                 </div>
                 <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between h-[200px]">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Avg. Purchase Bill</p>
                    <h4 className="text-3xl font-black text-slate-900 tracking-tighter">
                      ₹{filteredPurchases.length > 0 ? (analytics.purchases.total / filteredPurchases.length).toLocaleString(undefined, {maximumFractionDigits: 0}) : 0}
                    </h4>
                    <p className="text-[10px] font-bold text-slate-400 uppercase mt-auto">Across {filteredPurchases.length} Receipts</p>
                 </div>
                 <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between h-[200px]">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Top Category</p>
                    <h4 className="text-xl font-black text-slate-900 tracking-tight leading-tight">
                      {analytics.purchases.byCategory[0]?.[0] || 'N/A'}
                    </h4>
                    <p className="text-[10px] font-bold text-amber-500 uppercase mt-auto">₹{analytics.purchases.byCategory[0]?.[1].toLocaleString() || 0}</p>
                 </div>
                 <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between h-[200px]">
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">Stock Efficiency</p>
                    <h4 className="text-3xl font-black tracking-tighter text-emerald-400">Stable</h4>
                    <p className="text-[10px] font-bold text-slate-500 uppercase mt-auto">Based on Frequency</p>
                 </div>
              </section>

              <section className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                 <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mb-8">Procurement Mix</h3>
                    <div className="space-y-5">
                       {analytics.purchases.byCategory.length > 0 ? analytics.purchases.byCategory.map(([cat, amount], i) => (
                         <div key={cat} className="group">
                           <div className="flex justify-between items-center mb-1.5">
                             <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-amber-500' : 'bg-slate-300'}`} />
                                <span className="text-sm font-black text-slate-700">{cat}</span>
                             </div>
                             <span className="text-sm font-black text-slate-900">₹{amount.toLocaleString()}</span>
                           </div>
                           <div className="h-2 bg-slate-50 rounded-full overflow-hidden">
                             <div 
                               className={`h-full rounded-full transition-all duration-700 ${i === 0 ? 'bg-amber-500' : 'bg-slate-400'}`}
                               style={{ width: `${(amount / analytics.purchases.total) * 100}%` }}
                             />
                           </div>
                         </div>
                       )) : (
                        <div className="py-20 text-center text-slate-300 font-bold uppercase text-xs">No Purchase History</div>
                       )}
                    </div>
                 </div>

                 <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                    <h3 className="text-xl font-black text-slate-900 tracking-tight mb-8">Purchase Ledger</h3>
                    <div className="flex-1 overflow-auto max-h-[400px] custom-scrollbar">
                       <div className="space-y-4">
                          {filteredPurchases.slice().reverse().slice(0, 15).map((p, i) => (
                            <div key={i} className="flex items-center justify-between p-4 bg-slate-50/50 rounded-2xl border border-slate-50 hover:border-amber-200 transition-colors">
                               <div className="flex items-center gap-4">
                                  <div className="p-2 bg-white rounded-xl shadow-sm">
                                    <FileText size={16} className="text-slate-400" />
                                  </div>
                                  <div>
                                     <p className="text-xs font-black text-slate-900 truncate max-w-[150px]">{p.productName}</p>
                                     <p className="text-[9px] font-bold text-slate-400 uppercase">{p.date} • {p.billNo}</p>
                                  </div>
                               </div>
                               <div className="text-right">
                                  <p className="text-sm font-black text-slate-900">₹{p.amount.toLocaleString()}</p>
                                  <span className="text-[8px] font-black text-amber-600 uppercase tracking-tighter">{p.category}</span>
                               </div>
                            </div>
                          ))}
                       </div>
                    </div>
                 </div>
              </section>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default Reports;
