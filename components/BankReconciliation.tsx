
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  orderBy, 
  doc, 
  updateDoc, 
  addDoc,
  writeBatch
} from 'firebase/firestore';
import { db } from '../firebase';
import { 
  BankTransaction, 
  PurchaseRecord, 
  MONTH_NAMES, 
  YEAR_OPTIONS,
  MASTER_OUTLETS,
  getOutletName
} from '../types';
import { 
  ShieldCheck, 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertCircle, 
  ArrowRightLeft, 
  Plus, 
  Loader2, 
  CalendarDays,
  IndianRupee,
  Link as LinkIcon,
  Tag,
  Store,
  ShoppingBag,
  X,
  ChevronDown,
  ChevronRight,
  Database,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const BankReconciliation: React.FC<{ user: User }> = ({ user }) => {
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [loading, setLoading] = useState(true);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRecord[]>([]);
  const [reconcilingId, setReconcilingId] = useState<string | null>(null);
  const [splittingBT, setSplittingBT] = useState<BankTransaction | null>(null);
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);

  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [typeFilter, setTypeFilter] = useState<'all' | 'debit' | 'credit'>('all');
  const [amountSearch, setAmountSearch] = useState('');

  const fetchAuditData = async () => {
    setLoading(true);
    try {
      // Find transactions in the selected month
      // Note: We'll fetch all and filter by date string in JS for simplicity if needed, 
      // but let's try to query if possible. 
      // Our BankTransaction.date is likely YYYY-MM-DD
      const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
      const datePrefix = `${selectedYear}-${monthIdx}`;

      const bankQ = query(
        collection(db, 'bank_transactions'),
        where('userId', '==', user.uid)
      );
      const bSnap = await getDocs(bankQ);
      setBankTransactions(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction)));

      const purchaseQ = query(
        collection(db, 'purchases'),
        where('userId', '==', user.uid)
      );
      const pSnap = await getDocs(purchaseQ);
      setPurchases(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseRecord)));
    } catch (err) {
      console.error("Reconciliation fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, [user, selectedMonth, selectedYear]);

  const filteredAndSortedBT = useMemo(() => {
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;
    
    return bankTransactions
      .filter(t => t.date.startsWith(datePrefix))
      .filter(t => {
        if (typeFilter === 'all') return true;
        if (typeFilter === 'debit') return t.type === 'debit' || !t.type;
        return t.type === 'credit';
      })
      .filter(t => {
        if (!amountSearch) return true;
        return t.amount.toString().includes(amountSearch);
      })
      .sort((a, b) => {
        const comp = b.date.localeCompare(a.date);
        return sortOrder === 'desc' ? comp : -comp;
      });
  }, [bankTransactions, selectedMonth, selectedYear, sortOrder, typeFilter, amountSearch]);

  const filteredPurchases = useMemo(() => {
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;
    return purchases.filter(p => p.date.startsWith(datePrefix));
  }, [purchases, selectedMonth, selectedYear]);

  const stats = useMemo(() => {
    const debits = filteredAndSortedBT.filter(t => t.type === 'debit' || !t.type);
    const credits = filteredAndSortedBT.filter(t => t.type === 'credit');
    
    const total = debits.length;
    const reconciled = debits.filter(t => t.isReconciled).length;
    const partiallyReconciled = debits.filter(t => !t.isReconciled && (t.matchedPurchaseIds?.length || 0) > 0).length;
    const missing = total - reconciled - partiallyReconciled;
    
    const totalValue = debits.reduce((sum, t) => sum + t.amount, 0);
    const reconciledValue = debits.reduce((sum, t) => sum + (t.reconciledAmount || (t.isReconciled ? t.amount : 0)), 0);
    
    const totalCreditValue = credits.reduce((sum, t) => sum + t.amount, 0);
    
    return { 
      total, 
      reconciled, 
      partiallyReconciled,
      missing, 
      completion: total > 0 ? (reconciledValue / totalValue) * 100 : 0,
      totalValue,
      reconciledValue,
      totalCredits: credits.length,
      totalCreditValue
    };
  }, [bankTransactions]);

  const findSuggestedPurchase = (bt: BankTransaction) => {
    if (bt.type === 'credit') return null; // Only debits match purchases
    return filteredPurchases.find(p => {
      // Match if amount is exact and date is within range
      const btDate = new Date(bt.date);
      const pDate = new Date(p.date);
      const diffTime = Math.abs(btDate.getTime() - pDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      return p.amount === bt.amount && diffDays <= 7;
    });
  };

  const handleQuickReconcile = async (bt: BankTransaction, purchaseId: string) => {
    setReconcilingId(bt.id!);
    try {
      const p = filteredPurchases.find(p => p.id === purchaseId);
      const amount = p?.amount || 0;
      
      const newIds = Array.from(new Set([...(bt.matchedPurchaseIds || []), purchaseId]));
      const newAmount = (bt.reconciledAmount || 0) + amount;
      const isDone = newAmount >= bt.amount;

      await updateDoc(doc(db, 'bank_transactions', bt.id!), {
        isReconciled: isDone,
        matchedPurchaseId: purchaseId, // Maintain for legacy
        matchedPurchaseIds: newIds,
        reconciledAmount: newAmount
      });
      fetchAuditData();
    } catch (err) {
      console.error(err);
    } finally {
      setReconcilingId(null);
    }
  };

  const handleBulkReconcile = async () => {
    if (!splittingBT) return;
    setReconcilingId(splittingBT.id!);
    try {
      const selectedPurchases = filteredPurchases.filter(p => multiSelectedIds.includes(p.id!));
      const totalSelectedAmount = selectedPurchases.reduce((sum, p) => sum + p.amount, 0);
      
      const isDone = totalSelectedAmount >= splittingBT.amount;

      await updateDoc(doc(db, 'bank_transactions', splittingBT.id!), {
        isReconciled: isDone,
        matchedPurchaseIds: multiSelectedIds,
        reconciledAmount: totalSelectedAmount,
        matchedPurchaseId: multiSelectedIds[0] || null
      });
      
      setSplittingBT(null);
      setMultiSelectedIds([]);
      fetchAuditData();
    } catch (err) {
      console.error(err);
    } finally {
      setReconcilingId(null);
    }
  };

  const handleCreateAndReconcile = async (bt: BankTransaction) => {
    setReconcilingId(bt.id!);
    try {
      // 1. Create Purchase Record
      const newPurchase: Partial<PurchaseRecord> = {
        userId: user.uid,
        date: bt.date,
        amount: bt.amount,
        productName: bt.description,
        category: 'UNCATEGORIZED',
        vendor: 'UNKNOWN',
        outletId: 'GLOBAL', // Default
        isBankVerified: true,
        createdAt: Date.now()
      };
      
      const pRef = await addDoc(collection(db, 'purchases'), newPurchase);
      
      // 2. Link bank transaction
      await updateDoc(doc(db, 'bank_transactions', bt.id!), {
        isReconciled: true,
        matchedPurchaseId: pRef.id
      });
      
      fetchAuditData();
    } catch (err) {
      console.error(err);
    } finally {
      setReconcilingId(null);
    }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <ShieldCheck size={24} />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Bank Inbound Audit</h2>
          </div>
          <p className="text-slate-500 font-medium uppercase text-xs tracking-widest flex items-center gap-2">
             <History size={14} className="text-indigo-500"/> Verification Suite for Financial Integrity
          </p>
        </div>

        <div className="flex gap-4 p-1.5 bg-slate-100 rounded-2xl border border-slate-200 shadow-inner">
          <div className="relative">
            <select 
              value={selectedMonth} 
              onChange={e => setSelectedMonth(e.target.value)}
              className="pl-4 pr-10 py-3 bg-white rounded-xl text-xs font-black uppercase outline-none appearance-none border border-slate-200 shadow-sm"
            >
              {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
          <div className="relative">
            <select 
              value={selectedYear} 
              onChange={e => setSelectedYear(e.target.value)}
              className="pl-4 pr-10 py-3 bg-white rounded-xl text-xs font-black outline-none appearance-none border border-slate-200 shadow-sm"
            >
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200">
            {[
              { id: 'all', label: 'All Transactions' },
              { id: 'debit', label: 'Withdrawals (Dr)' },
              { id: 'credit', label: 'Deposits (Cr)' }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setTypeFilter(tab.id as any)}
                className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all ${
                  typeFilter === tab.id 
                    ? 'bg-white text-slate-900 shadow-sm' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="SEARCH BY AMOUNT..."
              value={amountSearch}
              onChange={e => setAmountSearch(e.target.value)}
              className="pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold uppercase outline-none focus:ring-2 ring-indigo-500/20 w-44 shadow-sm"
            />
          </div>
        </div>
      </header>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Debits</p>
          <div className="flex items-baseline gap-2">
            <h4 className="text-4xl font-black text-slate-900 tracking-tighter">{stats.total}</h4>
            <span className="text-xs font-bold text-slate-400">Records</span>
          </div>
        </div>
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-2 font-bold">Total Credits</p>
          <div className="flex items-baseline gap-2">
            <h4 className="text-4xl font-black text-emerald-500 tracking-tighter">{stats.totalCredits}</h4>
            <span className="text-xs font-bold text-slate-400">Deposits</span>
          </div>
        </div>
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Reconciled (Dr)</p>
          <div className="flex items-baseline gap-2">
            <h4 className="text-4xl font-black text-emerald-500 tracking-tighter">{stats.reconciled}</h4>
            <span className="text-xs font-bold text-slate-400">Match Found</span>
          </div>
        </div>
        <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
          <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-2 font-bold">Unmapped Leakage</p>
          <div className="flex items-baseline gap-2">
            <h4 className="text-4xl font-black text-rose-500 tracking-tighter">{(stats.totalValue - stats.reconciledValue).toLocaleString()}</h4>
            <span className="text-xs font-bold text-slate-400">₹ Pending</span>
          </div>
        </div>
        <div className="bg-slate-900 rounded-[2.5rem] p-8 shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full -mr-16 -mt-16 blur-2xl font-black"></div>
          <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">Health Index</p>
          <div className="flex items-baseline gap-2">
            <h4 className="text-4xl font-black text-white tracking-tighter">{Math.round(stats.completion)}%</h4>
            <div className="flex-1 h-3 bg-white/10 rounded-full overflow-hidden self-center ml-2">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${stats.completion}%` }}
                className="h-full bg-indigo-400"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
        {/* Left Column: Bank Transactions */}
        <div className="xl:col-span-12 space-y-6">
          <div className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
            <div className="p-8 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shadow-lg"><Database size={20} /></div>
                <div><h3 className="font-black text-slate-800 uppercase tracking-tight">Bank Ledger Inbound</h3><p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Scanning withdrawals from uploaded statements</p></div>
              </div>
              <div className="flex items-center gap-3">
                 <div className="px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase border border-indigo-100 shadow-sm">Audit Active</div>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto">
              {loading ? (
                <div className="h-full flex flex-col items-center justify-center py-20 text-slate-400">
                  <Loader2 className="animate-spin mb-4" size={32} />
                  <p className="font-bold uppercase text-[10px] tracking-[0.2em]">Processing relational maps...</p>
                </div>
              ) : filteredAndSortedBT.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-20 text-slate-300">
                  <CalendarDays size={48} className="mb-4 opacity-20" />
                  <p className="font-black uppercase text-sm">No Statements Found for this period</p>
                  <p className="text-[10px] font-medium uppercase mt-1">Upload a Bank Statement CSV in the Data Hub to begin</p>
                </div>
              ) : (
                <table className="w-full text-left border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-slate-50/30">
                      <th 
                        className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors"
                        onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                      >
                        <div className="flex items-center gap-2">
                          Transaction Date
                          <ChevronDown size={12} className={`transition-transform duration-300 ${sortOrder === 'asc' ? 'rotate-180' : ''}`} />
                        </div>
                      </th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Type</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Description / Narration</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Amount (Dr/Cr)</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Balance</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Reconciliation Status</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Integrity Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredAndSortedBT.map(bt => {
                      const suggestion = bt.isReconciled ? null : findSuggestedPurchase(bt);
                      const isReconciling = reconcilingId === bt.id;

                      return (
                        <tr key={bt.id} className="group hover:bg-slate-50/50 transition-colors">
                          <td className="px-8 py-6">
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-slate-900">{new Date(bt.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                              <div className="flex items-center gap-1">
                                <span className="text-[9px] font-bold text-slate-400 uppercase">{new Date(bt.date).getFullYear()}</span>
                                {bt.date.includes('T') && new Date(bt.date).getHours() + new Date(bt.date).getMinutes() > 0 && (
                                  <>
                                    <span className="text-[9px] font-bold text-slate-300">•</span>
                                    <span className="text-[9px] font-black text-indigo-500 uppercase">{new Date(bt.date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${bt.type === 'credit' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {bt.type === 'credit' ? 'CREDIT' : 'DEBIT'}
                            </span>
                          </td>
                          <td className="px-8 py-6">
                            <p className="text-xs font-bold text-slate-700 uppercase leading-snug line-clamp-2 max-w-[300px]">{bt.description}</p>
                            {bt.referenceNo && !bt.referenceNo.startsWith('AUTO-') && (
                              <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">REF: {bt.referenceNo}</span>
                            )}
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black text-slate-400">₹</span>
                              <span className={`text-lg font-black tracking-tighter ${bt.type === 'credit' ? 'text-emerald-600' : 'text-slate-900'}`}>{bt.amount.toLocaleString('en-IN')}</span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            {bt.balance !== undefined && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold text-slate-400">₹</span>
                                <span className="text-sm font-black text-slate-600 tracking-tighter">{bt.balance.toLocaleString('en-IN')}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6">
                            {bt.isReconciled ? (
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase border border-emerald-100">
                                <CheckCircle2 size={12} /> Reconciled
                              </div>
                            ) : (bt.matchedPurchaseIds?.length || 0) > 0 ? (
                              <div className="flex flex-col gap-1 w-full">
                                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-full text-[10px] font-black uppercase border border-indigo-100 w-fit">
                                  <ArrowRightLeft size={12} /> Partially Mapped ({(bt.matchedPurchaseIds?.length || 0)})
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                                  <div 
                                    className="h-full bg-indigo-500" 
                                    style={{ width: `${Math.min(100, ((bt.reconciledAmount || 0) / bt.amount) * 100)}%` }}
                                  />
                                </div>
                                <p className="text-[8px] font-bold text-slate-400 uppercase mt-1">₹{(bt.amount - (bt.reconciledAmount || 0)).toLocaleString()} Remaining</p>
                              </div>
                            ) : suggestion ? (
                              <div className="flex flex-col gap-1.5 animate-in fade-in duration-500">
                                <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase border border-amber-100 w-fit">
                                  <AlertCircle size={12} /> Suggestion Found
                                </div>
                                <div className="p-2 bg-indigo-50 border border-indigo-100 rounded-xl flex items-center gap-3 shadow-sm">
                                   <div className="p-2 bg-indigo-600 text-white rounded-lg"><ShoppingBag size={12}/></div>
                                   <div className="flex-1 min-w-0">
                                      <p className="text-[9px] font-black text-slate-900 truncate uppercase">{suggestion.productName}</p>
                                      <p className="text-[8px] font-bold text-indigo-500 uppercase">{getOutletName(suggestion.outletId)}</p>
                                   </div>
                                   <button 
                                      onClick={() => handleQuickReconcile(bt, suggestion.id!)}
                                      disabled={isReconciling}
                                      className="p-1.5 bg-white text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all shadow-sm border border-indigo-100"
                                    >
                                      {isReconciling ? <Loader2 size={12} className="animate-spin"/> : <LinkIcon size={12}/>}
                                   </button>
                                </div>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-500 rounded-full text-[10px] font-black uppercase border border-rose-100">
                                <X size={12} /> Record Missing
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6 text-right">
                             {!bt.isReconciled && bt.type !== 'credit' && (
                               <div className="flex items-center justify-end gap-3">
                                  <button 
                                    onClick={() => {
                                      setSplittingBT(bt);
                                      setMultiSelectedIds(bt.matchedPurchaseIds || []);
                                      setPurchaseSearch('');
                                    }}
                                    className="p-2 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all border border-indigo-100"
                                    title="Manual Split / Multi-Match"
                                  >
                                    <ArrowRightLeft size={16} />
                                  </button>
                                  <button 
                                    onClick={() => handleCreateAndReconcile(bt)}
                                    disabled={isReconciling}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg hover:shadow-slate-200"
                                  >
                                    {isReconciling ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14} />} Fast Log
                                  </button>
                               </div>
                             )}
                             {bt.type === 'credit' && (
                               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Inflow Record</span>
                             )}
                             {bt.isReconciled && (
                               <div className="flex items-center justify-end gap-3">
                                  <button 
                                    onClick={() => {
                                      setSplittingBT(bt);
                                      setMultiSelectedIds(bt.matchedPurchaseIds || []);
                                    }}
                                    className="text-[9px] font-black text-indigo-600 uppercase hover:underline"
                                  >
                                    View Links
                                  </button>
                                  <div className="flex flex-col items-end gap-1">
                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Matched Records</span>
                                    <span className="text-[8px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 uppercase">
                                      {bt.matchedPurchaseIds?.length || 1} Linked
                                    </span>
                                  </div>
                               </div>
                             )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
               <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase">
                     <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                     <span>Reconciled</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase">
                     <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                     <span>Suggested Fix</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase">
                     <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                     <span>Leakage Found</span>
                  </div>
               </div>
               <div className="flex items-center gap-4 text-xs font-black text-slate-400 uppercase tracking-widest">
                  Total Managed Volume: <span className="text-slate-900">₹{stats.totalValue.toLocaleString()}</span>
               </div>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {splittingBT && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-10">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSplittingBT(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-[3rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                    <ArrowRightLeft size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight">Split Reconciliation</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Map multiple purchases to one bank transaction</p>
                  </div>
                </div>
                <button onClick={() => setSplittingBT(null)} className="p-3 hover:bg-slate-100 rounded-2xl text-slate-400 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="p-8 flex-1 overflow-y-auto space-y-8">
                {/* Bank Transaction Header */}
                <div className="p-6 bg-slate-900 rounded-3xl text-white flex items-center justify-between shadow-xl">
                  <div className="flex flex-col gap-1">
                    <p className="text-[10px] font-black text-indigo-300 uppercase tracking-[0.2em]">Bank Transaction</p>
                    <p className="text-sm font-bold truncate max-w-[400px] uppercase">{splittingBT.description}</p>
                    <p className="text-[10px] font-black text-slate-400 uppercase italic">Date: {splittingBT.date}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-indigo-300 uppercase tracking-[0.2em]">Transaction Value</p>
                    <p className="text-2xl font-black tracking-tighter">₹{splittingBT.amount.toLocaleString()}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Available Purchases (This Month)</h4>
                    <div className="relative w-64">
                      <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input 
                        type="text" 
                        placeholder="SEARCH PURCHASES..."
                        value={purchaseSearch}
                        onChange={e => setPurchaseSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-[10px] font-bold uppercase outline-none focus:ring-2 ring-indigo-500/20"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredPurchases
                      .filter(p => !p.isBankVerified || multiSelectedIds.includes(p.id!))
                      .filter(p => p.productName.toLowerCase().includes(purchaseSearch.toLowerCase()) || p.vendor.toLowerCase().includes(purchaseSearch.toLowerCase()))
                      .map(p => {
                        const isSelected = multiSelectedIds.includes(p.id!);
                        return (
                          <button 
                            key={p.id}
                            onClick={() => {
                              if (isSelected) setMultiSelectedIds(prev => prev.filter(id => id !== p.id));
                              else setMultiSelectedIds(prev => [...prev, p.id!]);
                            }}
                            className={`p-4 rounded-2xl border transition-all text-left group ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100 scale-[1.02]' : 'bg-white border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30'}`}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className={`p-2 rounded-lg ${isSelected ? 'bg-indigo-500' : 'bg-slate-100'}`}>
                                <ShoppingBag size={14} />
                              </div>
                              <p className={`text-sm font-black tracking-tighter ${isSelected ? 'text-white' : 'text-slate-900'}`}>₹{p.amount.toLocaleString()}</p>
                            </div>
                            <p className={`text-[10px] font-black uppercase truncate ${isSelected ? 'text-indigo-100' : 'text-slate-800'}`}>{p.productName}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <Store size={10} className={isSelected ? 'text-indigo-300' : 'text-slate-400'} />
                              <p className={`text-[9px] font-bold uppercase ${isSelected ? 'text-indigo-200' : 'text-slate-400'}`}>{getOutletName(p.outletId)}</p>
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </div>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                <div className="flex flex-col">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Mapped</p>
                  <div className="flex items-baseline gap-2">
                    <span className={`text-2xl font-black tracking-tighter ${
                      multiSelectedIds.reduce((sum, id) => sum + (filteredPurchases.find(p => p.id === id)?.amount || 0), 0) > splittingBT.amount 
                        ? 'text-rose-500' 
                        : 'text-indigo-600'
                    }`}>
                      ₹{multiSelectedIds.reduce((sum, id) => sum + (filteredPurchases.find(p => p.id === id)?.amount || 0), 0).toLocaleString()}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">/ ₹{splittingBT.amount.toLocaleString()}</span>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => setSplittingBT(null)}
                    className="px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleBulkReconcile}
                    disabled={reconcilingId === splittingBT.id}
                    className="flex items-center gap-2 px-8 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50"
                  >
                    {reconcilingId === splittingBT.id ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} 
                    Finalize Mapping
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BankReconciliation;
