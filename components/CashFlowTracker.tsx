import React, { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  setDoc,
  deleteDoc,
  addDoc,
  orderBy
} from 'firebase/firestore';
import { db } from '../firebase';
import { CashFlowSnapshot, PnLMonthlySnapshot, MONTH_NAMES, BankTransaction, LoanProfile } from '../types';
import { 
  Banknote, 
  Save, 
  TrendingUp, 
  TrendingDown, 
  ShieldCheck, 
  Calculator, 
  ArrowRightLeft,
  Calendar,
  AlertCircle,
  RefreshCcw,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const CashFlowTracker: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [pnlSnaps, setPnlSnaps] = useState<PnLMonthlySnapshot[]>([]);
  const [cashFlowSnap, setCashFlowSnap] = useState<CashFlowSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loanProfiles, setLoanProfiles] = useState<LoanProfile[]>([]);
  const [periodBTs, setPeriodBTs] = useState<BankTransaction[]>([]);

  // Mapping state: transactionId -> loanProfileId
  const [mappings, setMappings] = useState<Record<string, string>>({});

  // Loan Library form
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileCategory, setNewProfileCategory] = useState<LoanProfile['category']>('LOAN_EMI');

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current.toString(), (current - 1).toString()];
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Profit Data
      const pnlQuery = query(
        collection(db, 'pnl_snapshots'),
        where('userId', '==', dataOwnerId),
        where('month', '==', selectedMonth),
        where('year', '==', selectedYear)
      );
      const pnlRes = await getDocs(pnlQuery);
      setPnlSnaps(pnlRes.docs.map(d => d.data() as PnLMonthlySnapshot));

      // 2. Fetch Loan Profiles
      const lpQuery = query(collection(db, 'loan_profiles'), where('userId', '==', dataOwnerId));
      const lpRes = await getDocs(lpQuery);
      setLoanProfiles(lpRes.docs.map(d => ({ id: d.id, ...d.data() } as LoanProfile)));

      // 3. Fetch bank transactions for this period
      const bankQuery = query(
        collection(db, 'bank_transactions'),
        where('userId', '==', dataOwnerId),
        where('category', 'in', ['LOAN_EMI', 'INTEREST_ONLY', 'CAPEX_REPAYMENT'])
      );
      const bankRes = await getDocs(bankQuery);
      
      const transactions = bankRes.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction)).filter(bt => {
        const d = new Date(bt.date);
        return d.getFullYear().toString() === selectedYear && MONTH_NAMES[d.getMonth()] === selectedMonth;
      });
      setPeriodBTs(transactions);

      // 4. Fetch Cash Flow Snapshot (Mappings)
      const snapId = `${user.uid}_${selectedYear}_${selectedMonth}`;
      const snapRef = doc(db, 'cash_flow_snapshots', snapId);
      const cfRes = await getDocs(query(collection(db, 'cash_flow_snapshots'), where('userId', '==', dataOwnerId), where('month', '==', selectedMonth), where('year', '==', selectedYear)));
      
      if (!cfRes.empty) {
        const data = cfRes.docs[0].data() as CashFlowSnapshot;
        setCashFlowSnap({ id: cfRes.docs[0].id, ...data });
        setMappings(data.mappings || {});
      } else {
        setCashFlowSnap(null);
        setMappings({});
      }
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedMonth, selectedYear]);

  const totalNetProfit = useMemo(() => {
    return pnlSnaps.reduce((acc, curr) => acc + curr.netProfit, 0);
  }, [pnlSnaps]);

  const totalObligationsBreakdown = useMemo(() => {
    const loanEmi = periodBTs.filter(t => t.category === 'LOAN_EMI').reduce((acc, t) => acc + t.amount, 0);
    const interestOnly = periodBTs.filter(t => t.category === 'INTEREST_ONLY').reduce((acc, t) => acc + t.amount, 0);
    const capex = periodBTs.filter(t => t.category === 'CAPEX_REPAYMENT').reduce((acc, t) => acc + t.amount, 0);

    // Profile-wise breakdown
    const byProfile: Record<string, number> = {};
    periodBTs.forEach(t => {
      const pId = mappings[t.id!];
      if (pId) {
        byProfile[pId] = (byProfile[pId] || 0) + t.amount;
      }
    });

    return { loanEmi, interestOnly, capex, total: loanEmi + interestOnly + capex, byProfile };
  }, [periodBTs, mappings]);

  const realCashLeft = totalNetProfit - totalObligationsBreakdown.total;

  const handleSaveSnapshot = async () => {
    try {
      const snapId = `${user.uid}_${selectedYear}_${selectedMonth}`;
      const snapRef = doc(db, 'cash_flow_snapshots', snapId);
      
      const payload: CashFlowSnapshot = {
        userId: user.uid,
        month: selectedMonth,
        year: selectedYear,
        netProfit: totalNetProfit,
        loanEmi: totalObligationsBreakdown.loanEmi,
        interestOnlyLoan: totalObligationsBreakdown.interestOnly,
        capexRepayment: totalObligationsBreakdown.capex,
        realCashLeft,
        mappings,
        updatedAt: Date.now()
      };

      await setDoc(snapRef, payload);
      alert("Cash Reality committed successfully.");
      fetchData();
    } catch (err) {
      console.error(err);
      alert("Failed to save snapshot.");
    }
  };

  const handleAddProfile = async () => {
    if (!newProfileName) return;
    try {
      const profile: LoanProfile = {
        userId: user.uid,
        name: newProfileName,
        category: newProfileCategory,
        isActive: true,
        createdAt: Date.now()
      };
      await addDoc(collection(db, 'loan_profiles'), profile);
      setNewProfileName('');
      setIsAddingProfile(false);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProfile = async (id: string) => {
    if (!confirm("Are you sure? This will unmap any associated transactions.")) return;
    try {
      await deleteDoc(doc(db, 'loan_profiles', id));
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const updateMapping = (txId: string, profileId: string) => {
    setMappings(prev => ({
      ...prev,
      [txId]: profileId
    }));
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <div className="p-3 bg-slate-900 rounded-2xl shadow-lg shadow-indigo-900/10">
              <Banknote className="text-white" size={24} />
            </div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase">Cash Reality</h1>
          </div>
          <p className="text-slate-500 font-bold uppercase tracking-[0.2em] text-[10px]">Debt & Obligation Strategy</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-white p-1 rounded-2xl border border-slate-200 shadow-sm">
            {years.map(y => (
              <button
                key={y}
                onClick={() => setSelectedYear(y)}
                className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${selectedYear === y ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {y}
              </button>
            ))}
          </div>

          <div className="relative group">
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="bg-white border-2 border-slate-100 rounded-2xl pl-10 pr-10 py-3.5 text-[10px] font-black uppercase tracking-widest outline-none appearance-none cursor-pointer focus:border-slate-900 transition-all shadow-sm"
            >
              {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <Calendar size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-10">
        {/* Loan Library / Profiles */}
        <div className="xl:col-span-4 space-y-8">
           <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center text-indigo-600"><Layers size={20} /></div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Loan Library</h3>
                </div>
                <button 
                  onClick={() => setIsAddingProfile(!isAddingProfile)}
                  className="p-2 bg-slate-900 text-white rounded-xl hover:scale-105 transition-all"
                >
                  <Plus size={18} />
                </button>
              </div>

              <AnimatePresence>
                {isAddingProfile && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden space-y-4 pt-2 border-t border-slate-100"
                  >
                    <div className="space-y-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Loan Name (e.g. HDFC Term Loan)</label>
                        <input 
                          type="text" 
                          value={newProfileName}
                          onChange={e => setNewProfileName(e.target.value)}
                          placeholder="Loan Label..."
                          className="w-full bg-white border border-slate-200 px-4 py-3 rounded-xl font-bold text-slate-900 text-sm outline-none focus:ring-2 focus:ring-indigo-600"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
                        <select 
                          value={newProfileCategory}
                          onChange={e => setNewProfileCategory(e.target.value as any)}
                          className="w-full bg-white border border-slate-200 px-4 py-3 rounded-xl font-bold text-slate-900 text-sm outline-none"
                        >
                          <option value="LOAN_EMI">Loan EMI</option>
                          <option value="INTEREST_ONLY">Interest Only</option>
                          <option value="CAPEX_REPAYMENT">Capex Repayment</option>
                        </select>
                      </div>
                      <button 
                        onClick={handleAddProfile}
                        className="w-full py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-indigo-200"
                      >
                        Create Profile
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="space-y-3">
                {loanProfiles.length === 0 && !isAddingProfile && (
                   <p className="text-center py-8 text-[11px] font-bold text-slate-300 uppercase italic">No profiles defined. Use the + button.</p>
                )}
                {loanProfiles.map(lp => (
                  <div key={lp.id} className="flex items-center justify-between p-4 bg-slate-50/50 rounded-2xl border border-slate-100/50 hover:border-indigo-100 transition-all group">
                     <div>
                        <h4 className="text-[11px] font-black text-slate-900 uppercase tracking-tight">{lp.name}</h4>
                        <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest mt-1 block">{lp.category.replace('_', ' ')}</span>
                     </div>
                     <button 
                       onClick={() => handleDeleteProfile(lp.id!)}
                       className="p-2 text-slate-300 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-all"
                     >
                       <Trash2 size={14} />
                     </button>
                  </div>
                ))}
              </div>
           </div>
        </div>

        {/* Transaction Mapping */}
        <div className="xl:col-span-8 space-y-8">
           <div className="bg-white p-8 rounded-[3rem] border border-slate-100 shadow-sm space-y-8 min-h-[500px] flex flex-col">
              <div className="flex items-center justify-between border-b border-slate-50 pb-6">
                 <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 shadow-inner"><ArrowRightLeft size={22} /></div>
                    <div>
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Period Mapping</h3>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{selectedMonth} {selectedYear} Transactions</p>
                    </div>
                 </div>
                 <button 
                   onClick={handleSaveSnapshot}
                   className="px-8 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl flex items-center gap-2 hover:scale-[1.02] transition-all"
                 >
                    <Save size={16} /> Update Reality Snap
                 </button>
              </div>

              {periodBTs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center py-20 bg-slate-50/50 rounded-[2rem] border-2 border-dashed border-slate-100">
                   <AlertCircle className="text-slate-200 mb-4" size={48} />
                   <h5 className="text-sm font-black text-slate-400 uppercase">No Ledger Entries Found</h5>
                   <p className="text-[10px] text-slate-300 font-bold uppercase mt-2">Tag bank transactions in 'Reconciliation' to see them here.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {periodBTs.map(tx => (
                    <div key={tx.id} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center p-4 bg-white border border-slate-100 rounded-2xl hover:shadow-lg transition-all group">
                       <div className="md:col-span-5">
                          <p className="text-[11px] font-black text-slate-900 uppercase truncate mb-1">{tx.description}</p>
                          <div className="flex items-center gap-4">
                             <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{new Date(tx.date).toLocaleDateString()}</span>
                             <span className="text-[8px] font-black text-indigo-400 uppercase tracking-widest bg-indigo-50 px-2 py-0.5 rounded-md">{tx.category.replace('_', ' ')}</span>
                          </div>
                       </div>
                       
                       <div className="md:col-span-2 text-right">
                          <span className="text-sm font-black text-slate-900">₹{tx.amount.toLocaleString()}</span>
                       </div>

                       <div className="md:col-span-5 flex items-center gap-3">
                          <span className="text-[9px] font-black text-slate-400 whitespace-nowrap">MAP TO:</span>
                          <select 
                            value={mappings[tx.id!] || ''}
                            onChange={e => updateMapping(tx.id!, e.target.value)}
                            className="flex-1 bg-slate-50 border border-slate-100 px-4 py-2 rounded-xl font-bold text-xs outline-none focus:border-slate-900 transition-all appearance-none cursor-pointer"
                          >
                             <option value="">-- Select Loan --</option>
                             {loanProfiles.filter(p => p.category === tx.category).map(p => (
                               <option key={p.id} value={p.id}>{p.name}</option>
                             ))}
                          </select>
                          {mappings[tx.id!] && (
                            <div className="text-emerald-500 animate-in zoom-in duration-300"><CheckCircle2 size={16} /></div>
                          )}
                       </div>
                    </div>
                  ))}
                </div>
              )}
           </div>
        </div>
      </div>

      {/* The Reality Math Section (Results) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
         <div className="lg:col-span-2">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-slate-900 p-12 rounded-[3.5rem] text-white shadow-2xl relative overflow-hidden h-full flex flex-col justify-between"
            >
               <div className="absolute top-0 right-0 p-10 opacity-5 -mr-10 -mt-10"><Banknote size={240} /></div>
               
               <div className="space-y-12">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-500 rounded-2xl text-emerald-950 shadow-lg shadow-emerald-500/20"><TrendingUp size={24} /></div>
                    <h3 className="text-2xl font-black uppercase tracking-tight">The Reality Math</h3>
                 </div>

                 <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                   <div className="space-y-6">
                      <div className="flex justify-between items-center py-3 border-b border-white/5">
                         <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Base Net Profit (P&L)</span>
                         <span className="text-xl font-black text-indigo-400">₹{totalNetProfit.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between items-center py-3 border-b border-white/5">
                         <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">(-) Total Obligations</span>
                         <span className="text-xl font-black text-rose-400">-₹{totalObligationsBreakdown.total.toLocaleString()}</span>
                      </div>

                      <div className="pt-8">
                         <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Real Liquid Cash Left</p>
                         <h2 className={`text-6xl font-black tracking-tighter ${realCashLeft >= 0 ? 'text-white' : 'text-rose-500'}`}>
                           ₹{realCashLeft.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                         </h2>
                      </div>
                   </div>

                   <div className="space-y-6 p-8 bg-white/5 rounded-[2.5rem] border border-white/5">
                      <h4 className="text-[11px] font-black uppercase text-slate-400 tracking-widest">Named Obligations Breakdown</h4>
                      <div className="space-y-4 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                         {Object.entries(totalObligationsBreakdown.byProfile).map(([pId, val]) => {
                           const profile = loanProfiles.find(p => p.id === pId);
                           return (
                             <div key={pId} className="flex justify-between items-center bg-white/5 px-4 py-3 rounded-xl">
                                <span className="text-[10px] font-bold uppercase truncate max-w-[150px]">{profile?.name || 'Unknown'}</span>
                                <span className="text-[11px] font-black text-indigo-300">₹{val.toLocaleString()}</span>
                             </div>
                           )
                         })}
                         {Object.keys(totalObligationsBreakdown.byProfile).length === 0 && (
                           <p className="text-[9px] text-slate-600 font-bold uppercase text-center mt-4 tracking-widest">No Mapped Loans Found</p>
                         )}
                      </div>
                   </div>
                 </div>
               </div>

               <div className="mt-12 p-6 bg-white/5 rounded-3xl border border-white/10">
                  <p className="text-[11px] font-bold text-slate-400 uppercase leading-relaxed tracking-wider">
                    Survival Metric: Calculated intake after all debt servicing. Standard P&L shows operational pulse, but Cash Flow shows actual survival health.
                  </p>
               </div>
            </motion.div>
         </div>

         <div className="flex flex-col gap-10">
            <div className="bg-indigo-50 border border-indigo-100 p-10 rounded-[3rem] flex items-center gap-8 shadow-sm h-full">
               <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center text-indigo-600 shadow-xl shadow-indigo-100 shrink-0"><ShieldCheck size={40}/></div>
               <div>
                  <h5 className="text-lg font-black text-indigo-900 uppercase mb-2 tracking-tight">Integrity Check</h5>
                  <p className="text-xs text-indigo-600/70 font-bold leading-relaxed uppercase tracking-wider">Named mappings provide a clear audit trail of where your profit is going. Ensure all bank ledger entries are assigned to a profile to maintain 100% visibility.</p>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
};

export default CashFlowTracker;
