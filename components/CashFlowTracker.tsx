import React, { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
  addDoc
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
  Layers,
  BarChart2
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

  const [activeTab, setActiveTab] = useState<'mapping' | 'overview'>('mapping');

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
        collection(db, 'bank_statement_imports'),
        where('userId', '==', dataOwnerId),
        where('category', 'in', ['LOAN_EMI', 'INTEREST_ONLY', 'CAPEX_REPAYMENT', 'CREDIT CARD PAYMENT', 'PERSONAL'])
      );
      const bankRes = await getDocs(bankQuery);
      
      const transactions = bankRes.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction)).filter(bt => {
        const d = new Date(bt.date);
        return d.getFullYear().toString() === selectedYear && MONTH_NAMES[d.getMonth()] === selectedMonth;
      });
      setPeriodBTs(transactions);

      // 4. Fetch Cash Flow Snapshot (Mappings) — use deterministic ID
      const snapId = `${dataOwnerId}_${selectedYear}_${selectedMonth}`;
      const snapRef = doc(db, 'cash_flow_snapshots', snapId);
      const cfSnap = await getDoc(snapRef);

      if (cfSnap.exists()) {
        const data = cfSnap.data() as CashFlowSnapshot;
        setCashFlowSnap({ id: cfSnap.id, ...data });
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
    const creditCard = periodBTs.filter(t => t.category === 'CREDIT CARD PAYMENT').reduce((acc, t) => acc + t.amount, 0);
    const personal = periodBTs.filter(t => t.category === 'PERSONAL').reduce((acc, t) => acc + t.amount, 0);

    // Profile-wise breakdown
    const byProfile: Record<string, number> = {};
    periodBTs.forEach(t => {
      const pId = mappings[t.id!];
      if (pId) {
        byProfile[pId] = (byProfile[pId] || 0) + t.amount;
      }
    });

    const total = loanEmi + interestOnly + capex + creditCard + personal;
    return { loanEmi, interestOnly, capex, creditCard, personal, total, byProfile };
  }, [periodBTs, mappings]);

  const realCashLeft = totalNetProfit - totalObligationsBreakdown.total;

  const categoryBreakdown = useMemo(() => {
    const cats: { key: string; label: string; color: string; bg: string; hex: string }[] = [
      { key: 'LOAN_EMI',            label: 'Loan EMI',            color: 'bg-rose-500',   bg: 'bg-rose-50',   hex: '#f43f5e' },
      { key: 'INTEREST_ONLY',       label: 'Interest Only',       color: 'bg-orange-500', bg: 'bg-orange-50', hex: '#f97316' },
      { key: 'CAPEX_REPAYMENT',     label: 'Capex Repayment',     color: 'bg-amber-500',  bg: 'bg-amber-50',  hex: '#f59e0b' },
      { key: 'CREDIT CARD PAYMENT', label: 'Credit Card Payment', color: 'bg-violet-500', bg: 'bg-violet-50', hex: '#8b5cf6' },
      { key: 'PERSONAL',            label: 'Personal',            color: 'bg-pink-500',   bg: 'bg-pink-50',   hex: '#ec4899' },
    ];
    return cats.map(c => ({
      ...c,
      amount: periodBTs.filter(t => t.category === c.key).reduce((s, t) => s + t.amount, 0),
    })).filter(c => c.amount > 0);
  }, [periodBTs]);

  const profileBreakdown = useMemo(() => {
    return loanProfiles
      .map(p => ({
        ...p,
        amount: Object.entries(totalObligationsBreakdown.byProfile)
          .filter(([id]) => id === p.id)
          .reduce((s, [, v]) => s + (v as number), 0),
      }))
      .filter(p => p.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [loanProfiles, totalObligationsBreakdown.byProfile]);

  const handleSaveSnapshot = async () => {
    try {
      const snapId = `${dataOwnerId}_${selectedYear}_${selectedMonth}`;
      const snapRef = doc(db, 'cash_flow_snapshots', snapId);

      const payload: CashFlowSnapshot = {
        userId: dataOwnerId,
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

  const updateMapping = async (txId: string, profileId: string) => {
    const newMappings = { ...mappings, [txId]: profileId };
    setMappings(newMappings);
    // Auto-save immediately so the user doesn't need to click "Update Reality Snap"
    try {
      const snapId = `${dataOwnerId}_${selectedYear}_${selectedMonth}`;
      const snapRef = doc(db, 'cash_flow_snapshots', snapId);
      await setDoc(snapRef, {
        userId: dataOwnerId,
        month: selectedMonth,
        year: selectedYear,
        mappings: newMappings,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      console.error('Error saving mapping:', err);
    }
  };

  const PROFILE_PALETTE = ['#6366f1','#0ea5e9','#14b8a6','#84cc16','#f59e0b','#f43f5e','#a855f7','#06b6d4'];

  const renderDonut = (segs: { label: string; amount: number; color: string }[], total: number) => {
    const size = 200;
    const sw = 48;
    const r = (size - sw) / 2;
    const circ = 2 * Math.PI * r;
    let acc = 0;
    const slices = segs.filter(s => s.amount > 0 && total > 0).map(s => {
      const len = (s.amount / total) * circ;
      const slice = { ...s, len, offset: circ - acc };
      acc += len;
      return slice;
    });
    const pct = total > 0 ? Math.round((segs.reduce((s, c) => s + c.amount, 0) / total) * 100) : 0;
    return (
      <div className="relative w-fit mx-auto">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={sw} />
          {slices.map((s, i) => (
            <circle
              key={i}
              cx={size/2} cy={size/2} r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={sw}
              strokeDasharray={`${s.len} ${circ - s.len}`}
              strokeDashoffset={s.offset}
              transform={`rotate(-90 ${size/2} ${size/2})`}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-2xl font-black text-slate-900">{pct}%</span>
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">allocated</span>
        </div>
      </div>
    );
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

      {/* Tab switcher */}
      <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl w-fit">
        {([['mapping', ArrowRightLeft, 'Period Mapping'], ['overview', BarChart2, 'Visual Overview']] as const).map(([tab, Icon, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' ? (
        <div className="space-y-8">
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-6">
            {[
              { label: 'Net Profit (P&L)', value: totalNetProfit, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-100' },
              { label: 'Total Obligations', value: -totalObligationsBreakdown.total, color: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-100' },
              { label: 'Real Cash Left', value: realCashLeft, color: realCashLeft >= 0 ? 'text-emerald-600' : 'text-rose-600', bg: realCashLeft >= 0 ? 'bg-emerald-50' : 'bg-rose-50', border: realCashLeft >= 0 ? 'border-emerald-100' : 'border-rose-100' },
            ].map(({ label, value, color, bg, border }) => (
              <div key={label} className={`${bg} border ${border} rounded-[2rem] p-8`}>
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">{label}</p>
                <p className={`text-3xl font-black tracking-tighter ${color}`}>
                  {value < 0 ? '-' : ''}₹{Math.abs(value).toLocaleString('en-IN')}
                </p>
              </div>
            ))}
          </div>

          {/* Stacked bar */}
          {totalNetProfit > 0 && (
            <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 space-y-6">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Profit Allocation</p>
              <div className="w-full h-14 rounded-2xl overflow-hidden flex">
                {categoryBreakdown.map(c => (
                  <div
                    key={c.key}
                    className={`${c.color} h-full transition-all`}
                    style={{ width: `${Math.min((c.amount / totalNetProfit) * 100, 100)}%` }}
                    title={`${c.label}: ₹${c.amount.toLocaleString('en-IN')}`}
                  />
                ))}
                {realCashLeft > 0 && (
                  <div
                    className="bg-emerald-500 h-full flex-1"
                    title={`Cash Left: ₹${realCashLeft.toLocaleString('en-IN')}`}
                  />
                )}
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-4">
                {categoryBreakdown.map(c => (
                  <div key={c.key} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${c.color}`} />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">{c.label}</span>
                    <span className="text-[10px] font-black text-slate-800">₹{c.amount.toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {realCashLeft > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-emerald-500" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Cash Left</span>
                    <span className="text-[10px] font-black text-slate-800">₹{realCashLeft.toLocaleString('en-IN')}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pie charts — by category and by named profile */}
          {(categoryBreakdown.length > 0 || profileBreakdown.length > 0) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Category donut */}
              {categoryBreakdown.length > 0 && (
                <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 space-y-8">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">By Category</p>
                  {renderDonut([
                    ...categoryBreakdown.map(c => ({ label: c.label, amount: c.amount, color: c.hex })),
                    ...(realCashLeft > 0 ? [{ label: 'Cash Left', amount: realCashLeft, color: '#10b981' }] : []),
                  ], totalNetProfit)}
                  <div className="space-y-2.5">
                    {categoryBreakdown.map(c => {
                      const pct = totalNetProfit > 0 ? (c.amount / totalNetProfit) * 100 : 0;
                      return (
                        <div key={c.key} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.hex }} />
                            <span className="text-[10px] font-bold text-slate-600 uppercase truncate">{c.label}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[9px] font-bold text-slate-400">{pct.toFixed(1)}%</span>
                            <span className="text-[11px] font-black text-slate-900">₹{c.amount.toLocaleString('en-IN')}</span>
                          </div>
                        </div>
                      );
                    })}
                    {realCashLeft > 0 && (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-500" />
                          <span className="text-[10px] font-bold text-slate-600 uppercase">Cash Left</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[9px] font-bold text-slate-400">{((realCashLeft / totalNetProfit) * 100).toFixed(1)}%</span>
                          <span className="text-[11px] font-black text-emerald-600">₹{realCashLeft.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Profile donut */}
              {profileBreakdown.length > 0 && (
                <div className="bg-white border border-slate-100 rounded-[2.5rem] p-10 space-y-8">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">By Named Profile</p>
                  {renderDonut([
                    ...profileBreakdown.map((p, i) => ({ label: p.name, amount: p.amount, color: PROFILE_PALETTE[i % PROFILE_PALETTE.length] })),
                    ...(realCashLeft > 0 ? [{ label: 'Cash Left', amount: realCashLeft, color: '#10b981' }] : []),
                  ], totalNetProfit)}
                  <div className="space-y-2.5">
                    {profileBreakdown.map((p, i) => {
                      const pct = totalNetProfit > 0 ? (p.amount / totalNetProfit) * 100 : 0;
                      const hex = PROFILE_PALETTE[i % PROFILE_PALETTE.length];
                      return (
                        <div key={p.id} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: hex }} />
                            <div className="min-w-0">
                              <span className="text-[10px] font-bold text-slate-800 uppercase truncate block">{p.name}</span>
                              <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">{p.category.replace(/_/g, ' ')}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[9px] font-bold text-slate-400">{pct.toFixed(1)}%</span>
                            <span className="text-[11px] font-black text-slate-900">₹{p.amount.toLocaleString('en-IN')}</span>
                          </div>
                        </div>
                      );
                    })}
                    {realCashLeft > 0 && (
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0 bg-emerald-500" />
                          <span className="text-[10px] font-bold text-slate-600 uppercase">Cash Left</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[9px] font-bold text-slate-400">{((realCashLeft / totalNetProfit) * 100).toFixed(1)}%</span>
                          <span className="text-[11px] font-black text-emerald-600">₹{realCashLeft.toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          )}

          {categoryBreakdown.length === 0 && (
            <div className="py-24 bg-white border-2 border-dashed border-slate-100 rounded-[3rem] flex flex-col items-center justify-center">
              <BarChart2 size={48} className="text-slate-200 mb-4" />
              <p className="text-sm font-black text-slate-300 uppercase tracking-widest">No obligations found for this period</p>
              <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mt-2">Tag transactions in the Mapping tab first</p>
            </div>
          )}
        </div>
      ) : (
      <>
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
                          <option value="CREDIT CARD PAYMENT">Credit Card Payment</option>
                          <option value="PERSONAL">Personal</option>
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
                             {loanProfiles.map(p => (
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
      </>
      )}
    </div>
  );
};

export default CashFlowTracker;
