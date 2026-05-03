
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, addDoc, doc, updateDoc, arrayUnion, deleteDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Employee, SalaryHistory, StoreRental, MonthlyPayroll, MASTER_OUTLETS, getOutletName, YEAR_OPTIONS, MONTH_NAMES } from '../types';
import { 
  Users, 
  Plus, 
  Search, 
  MapPin, 
  Calendar, 
  TrendingUp, 
  ChevronRight, 
  X,
  History,
  Trash2,
  Save,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Unlock,
  Loader2,
  AlertCircle,
  ChevronDown,
  Building2,
  Wallet,
  CalendarDays
} from 'lucide-react';

const Team: React.FC<{ user: User }> = ({ user }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [monthlyPayrolls, setMonthlyPayrolls] = useState<MonthlyPayroll[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOutlet, setSelectedOutlet] = useState('all');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  
  // Registry Year Selector
  const [registryYear, setRegistryYear] = useState(new Date().getFullYear().toString());
  
  // Payroll Modal State
  const [isPayrollModalOpen, setIsPayrollModalOpen] = useState(false);
  const [payrollTargetMonth, setPayrollTargetMonth] = useState('');
  const [payrollTargetYear, setPayrollTargetYear] = useState('');
  const [editingPayroll, setEditingPayroll] = useState<Record<string, number>>({});
  const [isSavingPayroll, setIsSavingPayroll] = useState(false);

  // New Employee Form
  const [newName, setNewName] = useState('');
  const [newOutlet, setNewOutlet] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newSalary, setNewSalary] = useState('');

  // Increment Form
  const [incAmount, setIncAmount] = useState('');
  const [incDate, setIncDate] = useState(new Date().toISOString().split('T')[0]);
  const [incReason, setIncReason] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const constraints = [where('userId', '==', user.uid)];
      const [empSnap, rentSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, 'employees'), ...constraints)),
        getDocs(query(collection(db, 'rentals'), ...constraints)),
        getDocs(query(collection(db, 'monthly_payrolls'), ...constraints))
      ]);
      setEmployees(empSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee)));
      setRentals(rentSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StoreRental)));
      setMonthlyPayrolls(paySnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MonthlyPayroll)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user]);

  // Open Payroll Management
  const handleOpenPayroll = (month: string, year: string) => {
    setPayrollTargetMonth(month);
    setPayrollTargetYear(year);
    
    const periodStart = new Date(parseInt(year), MONTH_NAMES.indexOf(month), 1);
    const activeOutlets = rentals.filter(r => {
      if (r.status !== 'closed' || !r.closeDate) return true;
      const cDate = new Date(r.closeDate);
      return cDate >= periodStart;
    });

    const initialEdits: Record<string, number> = {};
    activeOutlets.forEach(o => {
      const existing = monthlyPayrolls.find(p => p.outletId === o.outletId && p.month === month && p.year === year);
      if (existing) {
        initialEdits[o.outletId] = existing.totalAmount;
      } else {
        // Suggested: Previous month or current staff sum
        const monthIdx = MONTH_NAMES.indexOf(month);
        const prevMonth = monthIdx === 0 ? MONTH_NAMES[11] : MONTH_NAMES[monthIdx - 1];
        const prevYear = monthIdx === 0 ? (parseInt(year) - 1).toString() : year;
        const previous = monthlyPayrolls.find(p => p.outletId === o.outletId && p.month === prevMonth && p.year === prevYear);
        
        if (previous) {
          initialEdits[o.outletId] = previous.totalAmount;
        } else {
          const teamSum = employees.filter(e => e.outletId === o.outletId).reduce((acc, e) => acc + (e.currentSalary || 0), 0);
          initialEdits[o.outletId] = teamSum;
        }
      }
    });
    setEditingPayroll(initialEdits);
    setIsPayrollModalOpen(true);
  };

  const handleSavePayroll = async () => {
    setIsSavingPayroll(true);
    try {
      const batch = writeBatch(db);
      const newLogs: MonthlyPayroll[] = [];

      for (const outletId in editingPayroll) {
        const payId = `${user.uid}_${outletId}_${payrollTargetYear}_${payrollTargetMonth}`;
        const payRef = doc(db, 'monthly_payrolls', payId);
        const log: MonthlyPayroll = {
          userId: user.uid,
          outletId,
          month: payrollTargetMonth,
          year: payrollTargetYear,
          totalAmount: editingPayroll[outletId],
          isValidated: true,
          updatedAt: Date.now()
        };
        batch.set(payRef, log);
        newLogs.push(log);
      }

      await batch.commit();
      
      setMonthlyPayrolls(prev => {
        const filtered = prev.filter(p => !(p.month === payrollTargetMonth && p.year === payrollTargetYear));
        return [...filtered, ...newLogs];
      });
      
      setIsPayrollModalOpen(false);
    } catch (err) {
      console.error(err);
      alert("Failed to lock payroll snapshots.");
    } finally {
      setIsSavingPayroll(false);
    }
  };

  const activeOutletsForPeriod = useMemo(() => {
    const today = new Date();
    return MASTER_OUTLETS.filter(m => {
      const rental = rentals.find(r => r.outletId === m.id);
      if (!rental) return true;
      if (rental.status === 'active') return true;
      if (rental.closeDate) return new Date(rental.closeDate) >= today;
      return false;
    });
  }, [rentals]);

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    const salary = parseFloat(newSalary);
    if (!newName || !newOutlet || isNaN(salary)) return;

    try {
      const employee: Omit<Employee, 'id'> = {
        name: newName, outletId: newOutlet, joiningDate: newDate,
        baseSalary: salary, currentSalary: salary,
        history: [{ date: newDate, amount: salary, reason: 'Joining Salary' }],
        userId: user.uid
      };
      await addDoc(collection(db, 'employees'), employee);
      setIsAdding(false);
      setNewName(''); setNewSalary(''); setNewOutlet('');
      fetchData();
    } catch (err) { console.error(err); }
  };

  const handleAddIncrement = async () => {
    if (!selectedEmployee || !selectedEmployee.id || isNaN(parseFloat(incAmount))) return;
    const amount = parseFloat(incAmount);
    try {
      const newHistory: SalaryHistory = { date: incDate, amount: amount, reason: incReason };
      const employeeRef = doc(db, 'employees', selectedEmployee.id);
      await updateDoc(employeeRef, { currentSalary: amount, history: arrayUnion(newHistory) });
      setIncAmount(''); setIncReason('');
      fetchData();
      setSelectedEmployee({ ...selectedEmployee, currentSalary: amount, history: [...selectedEmployee.history, newHistory] });
    } catch (err) { console.error(err); }
  };

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm("Remove this employee record?")) return;
    try {
      await deleteDoc(doc(db, 'employees', id));
      setSelectedEmployee(null);
      fetchData();
    } catch (err) { console.error(err); }
  };

  const filteredEmployees = employees.filter(e => 
    (selectedOutlet === 'all' || e.outletId === selectedOutlet) &&
    e.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const historyTimeline = useMemo(() => {
    return MONTH_NAMES.map((m) => {
      const y = registryYear;
      const periodStart = new Date(parseInt(y), MONTH_NAMES.indexOf(m), 1);
      
      const activeUnits = rentals.filter(r => {
        if (r.status !== 'closed' || !r.closeDate) return true;
        return new Date(r.closeDate) >= periodStart;
      });

      const logs = monthlyPayrolls.filter(p => p.month === m && p.year === y);
      const isValidated = logs.length >= activeUnits.length && logs.length > 0;
      return { m, y, isValidated };
    });
  }, [monthlyPayrolls, rentals, registryYear]);

  const outletAggregates = useMemo(() => {
    const today = new Date();
    const activeUnits = rentals.filter(r => r.status === 'active' || (r.closeDate && new Date(r.closeDate) >= today));
    
    return activeUnits.map(rental => {
      const outletStaff = employees.filter(e => e.outletId === rental.outletId);
      const totalSalary = outletStaff.reduce((sum, e) => sum + e.currentSalary, 0);
      return {
        id: rental.outletId,
        name: rental.storeName,
        staffCount: outletStaff.length,
        totalSalary
      };
    }).sort((a, b) => b.totalSalary - a.totalSalary);
  }, [employees, rentals]);

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Team & Payroll</h2>
          <p className="text-slate-500 mt-1 font-medium">Managing staff growth and historical fiscal snapshots.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-6 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all"
        >
          <Plus size={18} /> Add Employee
        </button>
      </header>

      <section>
        <div className="flex items-center gap-3 mb-6">
          <Building2 size={20} className="text-indigo-600" />
          <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Operational Staffing Breakdown</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {outletAggregates.map(agg => (
            <div key={agg.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-50 shadow-sm flex items-center justify-between group hover:shadow-md transition-all">
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{agg.name}</p>
                <h4 className="text-2xl font-black text-slate-900 tracking-tight">₹{agg.totalSalary.toLocaleString()}</h4>
                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                  <Users size={12} className="text-indigo-400" />
                  {agg.staffCount} Active Members
                </div>
              </div>
              <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 group-hover:bg-indigo-50 group-hover:text-indigo-500 transition-colors">
                <Wallet size={24} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 pt-6">
         <div className="lg:col-span-2 space-y-8">
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative flex-1 min-w-[300px]">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                <input 
                  type="text" placeholder="Search team members..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-12 pr-4 py-4 bg-white border border-slate-100 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 outline-none shadow-sm transition-all"
                />
              </div>
              <div className="bg-white px-6 py-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-3">
                <MapPin size={16} className="text-indigo-500" />
                <select value={selectedOutlet} onChange={e => setSelectedOutlet(e.target.value)} className="bg-transparent font-bold text-xs text-slate-900 outline-none uppercase tracking-widest">
                  <option value="all">All Outlets</option>
                  {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {loading ? (
                <div className="col-span-full py-20 text-center"><Loader2 className="animate-spin mx-auto text-indigo-600" /></div>
              ) : filteredEmployees.length === 0 ? (
                <div className="col-span-full py-20 bg-white rounded-[2.5rem] border border-slate-100 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">No employees found</div>
              ) : filteredEmployees.map(e => (
                <div key={e.id} onClick={() => setSelectedEmployee(e)} className="group bg-white rounded-[2.5rem] border border-slate-50 shadow-sm hover:shadow-xl transition-all cursor-pointer overflow-hidden flex flex-col hover:-translate-y-1">
                  <div className="p-8 flex-1">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600 font-black text-lg">{e.name[0].toUpperCase()}</div>
                      <div>
                        <h3 className="font-black text-slate-900 text-lg leading-tight">{e.name}</h3>
                        <div className="flex items-center gap-2 text-slate-400 text-[10px] font-bold uppercase mt-1"><MapPin size={10} /> {getOutletName(e.outletId)}</div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Salary</p><p className="text-2xl font-black text-slate-900">₹{e.currentSalary.toLocaleString()}</p></div>
                        <div className="text-right"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Growth</p><p className="text-xs font-black text-emerald-500">+{Math.round((e.currentSalary - e.baseSalary) / (e.baseSalary || 1) * 100)}%</p></div>
                      </div>
                    </div>
                  </div>
                  <div className="px-8 py-4 bg-slate-50/50 border-t border-slate-50 flex items-center justify-between text-indigo-600 font-black uppercase text-[10px] tracking-widest group-hover:bg-indigo-50 transition-all">Details <ChevronRight size={14} /></div>
                </div>
              ))}
            </div>
         </div>

         <div className="space-y-8">
            <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-2xl relative overflow-hidden flex flex-col">
               <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none"><ShieldCheck size={120} /></div>
               
               <div className="flex items-center justify-between mb-8 relative z-10">
                 <h3 className="text-xl font-black tracking-tight flex items-center gap-3"><History size={20} className="text-indigo-400" /> Fiscal Registry</h3>
                 <div className="bg-white/10 px-3 py-1.5 rounded-xl border border-white/10 flex items-center gap-2">
                    <CalendarDays size={14} className="text-indigo-300" />
                    <select 
                      value={registryYear} 
                      onChange={(e) => setRegistryYear(e.target.value)}
                      className="bg-transparent font-black text-xs outline-none text-white cursor-pointer"
                    >
                      {YEAR_OPTIONS.map(y => <option key={y} value={y} className="text-slate-900">{y}</option>)}
                    </select>
                 </div>
               </div>
               
               <p className="text-slate-400 text-xs font-medium leading-relaxed mb-8 relative z-10">Snapshot salary costs for accurate historical P&L reporting. Select a year and month to define period costs.</p>
               
               <div className="space-y-3 relative z-10 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
                  {historyTimeline.map((item) => (
                    <div key={`${item.m}-${item.y}`} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-between hover:bg-white/10 transition-all">
                       <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.isValidated ? 'bg-emerald-50 text-emerald-400' : 'bg-orange-50 text-orange-400'}`}>
                             {item.isValidated ? <Lock size={18} /> : <Unlock size={18} />}
                          </div>
                          <div>
                             <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">{item.y}</p>
                             <p className="text-sm font-black text-slate-200 uppercase">{item.m}</p>
                          </div>
                       </div>
                       <button 
                         onClick={() => handleOpenPayroll(item.m, item.y)}
                         className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${item.isValidated ? 'bg-indigo-50 text-white shadow-lg shadow-indigo-900/40' : 'bg-orange-50 text-white animate-pulse shadow-lg shadow-orange-900/40'}`}
                       >
                         {item.isValidated ? 'Adjust' : 'Verify'}
                       </button>
                    </div>
                  ))}
               </div>
            </div>
         </div>
      </section>

      {isPayrollModalOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setIsPayrollModalOpen(false)} />
           <div className="relative w-full max-w-xl bg-white rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
              <header className="p-8 border-b border-slate-100 flex items-center justify-between">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-orange-100 text-orange-600 rounded-2xl"><ShieldCheck size={28} /></div>
                    <div>
                       <h3 className="text-2xl font-black text-slate-900">Payroll Validator</h3>
                       <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Snapshot for {payrollTargetMonth} {payrollTargetYear}</p>
                    </div>
                 </div>
                 <button onClick={() => setIsPayrollModalOpen(false)} className="p-2 bg-slate-50 rounded-xl text-slate-400 hover:text-slate-900"><X size={20}/></button>
              </header>
              <div className="p-8 space-y-6 max-h-[50vh] overflow-y-auto custom-scrollbar">
                 <div className="space-y-4">
                    {Object.keys(editingPayroll).map(oId => (
                       <div key={oId} className="p-5 bg-slate-50 border border-slate-100 rounded-[2rem] flex items-center justify-between">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 border border-slate-100 shadow-sm"><MapPin size={18} /></div>
                             <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Outlet</p><p className="text-sm font-black text-slate-900 uppercase">{getOutletName(oId)}</p></div>
                          </div>
                          <div className="flex-1 max-w-[180px]">
                             <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Total Payroll (₹)</label>
                             <input type="number" value={editingPayroll[oId]} onChange={(e) => setEditingPayroll({...editingPayroll, [oId]: parseFloat(e.target.value) || 0})} className="w-full bg-white border border-slate-200 px-4 py-2 rounded-xl font-black text-slate-900 outline-none" />
                          </div>
                       </div>
                    ))}
                 </div>
              </div>
              <footer className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                 <button onClick={() => setIsPayrollModalOpen(false)} className="flex-1 py-4 bg-white border border-slate-200 rounded-2xl font-black uppercase text-xs tracking-widest text-slate-400 hover:text-slate-600 transition-colors">Cancel</button>
                 <button onClick={handleSavePayroll} disabled={isSavingPayroll} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all active:scale-[0.98]">
                    {isSavingPayroll ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Validate & Lock
                 </button>
              </footer>
           </div>
        </div>
      )}
    </div>
  );
};

export default Team;
