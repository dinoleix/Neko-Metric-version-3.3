
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
      const allBT = bSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction));
      
      // Filter and sort in memory to avoid composite index requirements
      const filteredBT = allBT
        .filter(t => t.date.startsWith(datePrefix))
        .sort((a, b) => b.date.localeCompare(a.date));
      setBankTransactions(filteredBT);

      const purchaseQ = query(
        collection(db, 'purchases'),
        where('userId', '==', user.uid)
      );
      const pSnap = await getDocs(purchaseQ);
      const allP = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseRecord));
      const filteredP = allP
        .filter(p => p.date.startsWith(datePrefix))
        .sort((a, b) => b.date.localeCompare(a.date));
      setPurchases(filteredP);

    } catch (err) {
      console.error("Reconciliation fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, [user, selectedMonth, selectedYear]);

  const stats = useMemo(() => {
    const debits = bankTransactions.filter(t => t.type === 'debit' || !t.type);
    const credits = bankTransactions.filter(t => t.type === 'credit');
    
    const total = debits.length;
    const reconciled = debits.filter(t => t.isReconciled).length;
    const missing = total - reconciled;
    const totalValue = debits.reduce((sum, t) => sum + t.amount, 0);
    const reconciledValue = debits.filter(t => t.isReconciled).reduce((sum, t) => sum + t.amount, 0);
    
    const totalCreditValue = credits.reduce((sum, t) => sum + t.amount, 0);
    
    return { 
      total, 
      reconciled, 
      missing, 
      completion: total > 0 ? (reconciled / total) * 100 : 0,
      totalValue,
      reconciledValue,
      totalCredits: credits.length,
      totalCreditValue
    };
  }, [bankTransactions]);

  const findSuggestedPurchase = (bt: BankTransaction) => {
    if (bt.type === 'credit') return null; // Only debits match purchases
    return purchases.find(p => {
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
      await updateDoc(doc(db, 'bank_transactions', bt.id!), {
        isReconciled: true,
        matchedPurchaseId: purchaseId
      });
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
              ) : bankTransactions.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-20 text-slate-300">
                  <CalendarDays size={48} className="mb-4 opacity-20" />
                  <p className="font-black uppercase text-sm">No Statements Found for this period</p>
                  <p className="text-[10px] font-medium uppercase mt-1">Upload a Bank Statement CSV in the Data Hub to begin</p>
                </div>
              ) : (
                <table className="w-full text-left border-separate border-spacing-0">
                  <thead>
                    <tr className="bg-slate-50/30">
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Transaction Date</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Type</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Description / Narration</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Amount (Dr/Cr)</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Reconciliation Status</th>
                      <th className="px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Integrity Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {bankTransactions.map(bt => {
                      const suggestion = bt.isReconciled ? null : findSuggestedPurchase(bt);
                      const isReconciling = reconcilingId === bt.id;

                      return (
                        <tr key={bt.id} className="group hover:bg-slate-50/50 transition-colors">
                          <td className="px-8 py-6">
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-slate-900">{new Date(bt.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                              <span className="text-[9px] font-bold text-slate-400 uppercase">{new Date(bt.date).getFullYear()}</span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-widest ${bt.type === 'credit' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                              {bt.type === 'credit' ? 'CREDIT' : 'DEBIT'}
                            </span>
                          </td>
                          <td className="px-8 py-6">
                            <p className="text-xs font-bold text-slate-700 uppercase leading-snug line-clamp-2 max-w-[300px]">{bt.description}</p>
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">REF: {bt.referenceNo || 'N/A'}</span>
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black text-slate-400">₹</span>
                              <span className={`text-lg font-black tracking-tighter ${bt.type === 'credit' ? 'text-emerald-600' : 'text-slate-900'}`}>{bt.amount.toLocaleString('en-IN')}</span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            {bt.isReconciled ? (
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[10px] font-black uppercase border border-emerald-100">
                                <CheckCircle2 size={12} /> Reconciled
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
                                    onClick={() => handleCreateAndReconcile(bt)}
                                    disabled={isReconciling}
                                    className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg hover:shadow-slate-200"
                                  >
                                    {isReconciling ? <Loader2 size={14} className="animate-spin"/> : <Plus size={14} />} Fast Log Purchase
                                  </button>
                               </div>
                             )}
                             {bt.type === 'credit' && (
                               <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Inflow Record</span>
                             )}
                             {bt.isReconciled && (
                               <div className="flex flex-col items-end gap-1">
                                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Matched ID</span>
                                  <span className="text-[8px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 uppercase truncate max-w-[120px]">{bt.matchedPurchaseId}</span>
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
    </div>
  );
};

export default BankReconciliation;
