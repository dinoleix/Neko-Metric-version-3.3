
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, addDoc, doc, deleteDoc, updateDoc, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { 
  DailyCounterEntry, 
  UserProfile, 
  MASTER_OUTLETS, 
  getOutletName,
  DEFAULT_COGS,
  DEFAULT_OPS,
  EntryStatus,
  BankAccount
} from '../types';
import { 
  Plus, 
  ShoppingBag, 
  Receipt, 
  Trash2, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Smartphone,
  Calendar,
  IndianRupee,
  ChevronRight,
  ArrowLeft,
  Store,
  Clock,
  RefreshCw,
  Filter,
  Check,
  XCircle,
  Clock3,
  Camera,
  Image as ImageIcon,
  Eye,
  Edit2,
  X,
  FileText,
  MapPin,
  Search,
  CalendarDays,
  ListFilter,
  ChevronDown,
  SearchX,
  Wallet
} from 'lucide-react';

const CATEGORIES = {
  expense: [...DEFAULT_OPS, 'OTHER EXPENSE'].sort(),
  purchase: [...DEFAULT_COGS, 'OTHER PURCHASE'].sort()
};

const ALL_CATEGORIES = Array.from(new Set([...CATEGORIES.expense, ...CATEGORIES.purchase])).sort();

const STATUS_CONFIG: Record<EntryStatus, { label: string, color: string, bg: string, icon: any }> = {
  paid: { label: 'Paid', color: 'text-emerald-500', bg: 'bg-emerald-500/10', icon: CheckCircle2 },
  pending: { label: 'Pending', color: 'text-amber-500', bg: 'bg-amber-500/10', icon: Clock3 },
  cancelled: { label: 'Cancelled', color: 'text-rose-500', bg: 'bg-rose-500/10', icon: XCircle }
};

type DatePreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'custom';

// --- SAFE STATUS CONFIG HELPER ---
const getStatusConfig = (status?: string) => {
  const key = (status as EntryStatus) || 'paid';
  return STATUS_CONFIG[key] || STATUS_CONFIG['paid'];
};

// --- IMAGE COMPRESSION HELPER ---
const compressImage = (file: File, maxWidth: number = 1200): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (maxWidth / width) * height;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas to Blob conversion failed'));
        }, 'image/jpeg', 0.7); // 70% quality for clarity + efficiency
      };
    };
    reader.onerror = (error) => reject(error);
  });
};

const CrewTerminal: React.FC<{ user: User, profile: UserProfile }> = ({ user, profile }) => {
  const [activeMode, setActiveMode] = useState<'view' | 'add' | 'edit'>('view');
  const [entryType, setEntryType] = useState<'expense' | 'purchase'>('purchase');
  const [entries, setEntries] = useState<DailyCounterEntry[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  // --- Filtering State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | EntryStatus>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customStartDate, setCustomStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [customEndDate, setCustomEndDate] = useState(new Date().toISOString().split('T')[0]);

  // Viewing detail state
  const [viewingEntry, setViewingEntry] = useState<DailyCounterEntry | null>(null);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<EntryStatus>('paid');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [outletId, setOutletId] = useState(profile.assignedOutlet || MASTER_OUTLETS[0].id);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [existingReceiptUrl, setExistingReceiptUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchEntries = async () => {
    setLoading(true);
    try {
      // Use ownerId if available (for crew), otherwise fallback to current user.uid (for admin)
      const ownerId = profile.ownerId || user.uid;

      // Fetch Bank Accounts
      const bankQ = query(
        collection(db, 'bank_accounts'),
        where('userId', '==', ownerId)
      );
      const bankSnap = await getDocs(bankQ);
      const allBankAccounts = bankSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
      
      // Filter by assigned outlet if available
      const filteredBankAccounts = profile.assignedOutlet 
        ? allBankAccounts.filter(acc => acc.outletId === profile.assignedOutlet)
        : allBankAccounts;

      setBankAccounts(filteredBankAccounts);

      let start: string;
      let end: string = new Date().toISOString().split('T')[0];
      const today = new Date();

      switch (datePreset) {
        case 'yesterday':
          const yest = new Date();
          yest.setDate(yest.getDate() - 1);
          start = yest.toISOString().split('T')[0];
          end = start;
          break;
        case 'this-week':
          const startOfWeek = new Date();
          const day = startOfWeek.getDay(); // 0 is Sun, 1 is Mon
          const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Monday start
          startOfWeek.setDate(diff);
          start = startOfWeek.toISOString().split('T')[0];
          break;
        case 'last-week':
          const prevWeekStart = new Date();
          prevWeekStart.setDate(prevWeekStart.getDate() - prevWeekStart.getDay() - 6);
          const prevWeekEnd = new Date(prevWeekStart);
          prevWeekEnd.setDate(prevWeekStart.getDate() + 6);
          start = prevWeekStart.toISOString().split('T')[0];
          end = prevWeekEnd.toISOString().split('T')[0];
          break;
        case 'this-month':
          start = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
          break;
        case 'custom':
          start = customStartDate;
          end = customEndDate;
          break;
        default: // today
          start = today.toISOString().split('T')[0];
          break;
      }

      // FIX: Simplifed query to avoid composite index requirement. 
      // Date filtering is moved to client-side.
      const q = query(
        collection(db, 'crew_entries'),
        where('userId', '==', user.uid)
      );
      
      const snap = await getDocs(q);
      const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() } as DailyCounterEntry));
      
      // Perform client-side date range filtering to bypass index error
      const filteredByDate = allDocs.filter(entry => entry.date >= start && entry.date <= end);
      
      setEntries(filteredByDate.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error("Fetch entries error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [user, datePreset, customStartDate, customEndDate]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReceiptFile(file);
      setReceiptPreview(URL.createObjectURL(file));
    }
  };

  const handleEdit = (entry: DailyCounterEntry) => {
    setEditingId(entry.id!);
    setEntryType(entry.type);
    setAmount(entry.amount.toString());
    setCategory(entry.category);
    setDescription(entry.description);
    setStatus(entry.status || 'paid');
    setDate(entry.date);
    setOutletId(entry.outletId);
    setExistingReceiptUrl(entry.receiptUrl || null);
    setReceiptPreview(entry.receiptUrl || null);
    setActiveMode('edit');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !category) return;

    setSaving(true);
    try {
      let finalReceiptUrl = existingReceiptUrl;

      if (receiptFile) {
        const compressedBlob = await compressImage(receiptFile);
        const fileName = `receipts/${user.uid}/${Date.now()}.jpg`;
        const storageRef = ref(storage, fileName);
        await uploadBytes(storageRef, compressedBlob);
        finalReceiptUrl = await getDownloadURL(storageRef);
      }

      const entryData: any = {
        userId: user.uid,
        userName: user.email?.split('@')[0] || 'Unknown',
        outletId,
        type: entryType,
        amount: parseFloat(amount),
        date,
        category,
        description,
        status,
        receiptUrl: finalReceiptUrl || null,
        createdAt: Date.now()
      };

      if (activeMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'crew_entries', editingId), entryData);
      } else {
        await addDoc(collection(db, 'crew_entries'), entryData);
      }
      
      setSuccess(true);
      resetForm();
      
      setTimeout(() => {
        setSuccess(false);
        setActiveMode('view');
        fetchEntries();
      }, 1500);
    } catch (err) {
      console.error(err);
      alert("Submission failed. Check connection.");
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setAmount('');
    setCategory('');
    setDescription('');
    setStatus('paid');
    setReceiptFile(null);
    setReceiptPreview(null);
    setEditingId(null);
    setExistingReceiptUrl(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    try {
      await deleteDoc(doc(db, 'crew_entries', id));
      fetchEntries();
    } catch (err) {
      console.error(err);
    }
  };

  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      const matchesStatus = filterStatus === 'all' || e.status === filterStatus;
      const matchesCategory = filterCategory === 'all' || e.category === filterCategory;
      const matchesSearch = !searchTerm || 
        e.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
        e.category.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesStatus && matchesCategory && matchesSearch;
    });
  }, [entries, filterStatus, filterCategory, searchTerm]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-24">
      {/* STATION CONTEXT BAR */}
      <div className="flex flex-wrap items-center gap-3 bg-slate-800/40 p-4 rounded-[2rem] border border-slate-700/50 shadow-inner">
        <div className="flex items-center gap-3 px-4 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl shadow-sm">
          <MapPin size={16} className="text-indigo-400" />
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-indigo-500/70 uppercase tracking-widest leading-none mb-1">Active Station</span>
            <span className="text-sm font-black text-white uppercase leading-none tracking-tight">
              {getOutletName(profile.assignedOutlet || 'GLOBAL')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 py-2 bg-slate-700/30 border border-slate-600/30 rounded-xl shadow-sm">
          <Calendar size={16} className="text-slate-400" />
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Audit Mode</span>
            <span className="text-sm font-black text-slate-300 uppercase leading-none tracking-tight">
              {datePreset === 'custom' ? `${customStartDate} to ${customEndDate}` : datePreset.replace('-', ' ')}
            </span>
          </div>
        </div>
      </div>

      {/* BANK ACCOUNT CONTEXT */}
      {bankAccounts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bankAccounts.map(acc => (
            <div key={acc.id} className="bg-slate-800/60 border border-slate-700/50 rounded-2xl p-4 flex items-center justify-between shadow-lg">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl">
                  <Wallet size={18} />
                </div>
                <div>
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">{acc.bankName || 'Operational Bank'}</p>
                  <p className="text-sm font-black text-white uppercase leading-none tracking-tight">{acc.name}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Available Balance</p>
                <p className="text-lg font-black text-indigo-400 leading-none tracking-tighter">₹{acc.balance.toLocaleString('en-IN')}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeMode === 'view' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <button 
              onClick={() => { resetForm(); setEntryType('purchase'); setActiveMode('add'); }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2.5rem] p-8 flex flex-col items-center justify-center gap-4 shadow-xl transition-all active:scale-95 border border-indigo-400/20"
            >
              <ShoppingBag size={48} />
              <div className="text-center">
                <p className="text-xl font-black uppercase tracking-tight leading-none">New Purchase</p>
                <p className="text-[10px] font-bold text-indigo-200 mt-1 uppercase tracking-widest">Logged Inventory</p>
              </div>
            </button>
            <button 
              onClick={() => { resetForm(); setEntryType('expense'); setActiveMode('add'); }}
              className="bg-rose-500 hover:bg-rose-600 text-white rounded-[2.5rem] p-8 flex flex-col items-center justify-center gap-4 shadow-xl transition-all active:scale-95 border border-rose-400/20"
            >
              <Receipt size={48} />
              <div className="text-center">
                <p className="text-xl font-black uppercase tracking-tight leading-none">New Expense</p>
                <p className="text-[10px] font-bold text-rose-100 mt-1 uppercase tracking-widest">Petty Cash / Daily Bills</p>
              </div>
            </button>
          </div>

          <section className="bg-slate-800 rounded-[2.5rem] border border-slate-700 p-8 space-y-8">
            {/* SEARCH AND FILTERS HEADER */}
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-slate-700 rounded-2xl text-indigo-400 shadow-inner">
                    <Clock size={20}/>
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight leading-none">Shift Ledger</h3>
                    <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">Transaction History & Verification</p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex bg-slate-700/50 p-1 rounded-xl border border-slate-700">
                    {(['all', 'paid', 'pending', 'cancelled'] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setFilterStatus(s)}
                        className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${filterStatus === s ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <button onClick={fetchEntries} className="p-3 text-slate-400 hover:text-white transition-colors">
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                  </button>
                </div>
              </div>

              {/* FILTER BAR */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-4 relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-indigo-400" size={18} />
                  <input 
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search logs..."
                    className="w-full bg-slate-900 border border-slate-700 focus:border-indigo-500 outline-none pl-12 pr-4 py-4 rounded-2xl text-xs font-bold text-white transition-all shadow-inner"
                  />
                </div>

                <div className="md:col-span-4 relative">
                  <ListFilter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
                  <select 
                    value={filterCategory}
                    onChange={e => setFilterCategory(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 focus:border-indigo-500 outline-none pl-12 pr-8 py-4 rounded-2xl text-xs font-bold text-white appearance-none uppercase transition-all shadow-inner"
                  >
                    <option value="all">All Categories</option>
                    {ALL_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={14} />
                </div>

                <div className="md:col-span-4 overflow-x-auto no-scrollbar">
                   <div className="flex bg-slate-700/30 p-1 rounded-2xl border border-slate-700 gap-1 w-max">
                     {(['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'custom'] as DatePreset[]).map(p => (
                       <button
                         key={p}
                         onClick={() => setDatePreset(p)}
                         className={`px-4 py-3 rounded-xl text-[8px] font-black uppercase tracking-widest transition-all ${datePreset === p ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                       >
                         {p.replace('-', ' ')}
                       </button>
                     ))}
                   </div>
                </div>
              </div>

              {datePreset === 'custom' && (
                <div className="grid grid-cols-2 gap-4 animate-in slide-in-from-top-2 duration-300">
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-500 uppercase ml-2">From</label>
                    <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs font-bold text-white outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[8px] font-black text-slate-500 uppercase ml-2">To</label>
                    <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-xs font-bold text-white outline-none" />
                  </div>
                </div>
              )}
            </div>

            {/* ENTRIES LIST */}
            <div className="space-y-3">
              {loading ? (
                <div className="py-12 flex justify-center"><Loader2 className="animate-spin text-slate-600" /></div>
              ) : filteredEntries.length === 0 ? (
                <div className="py-20 text-center border-2 border-dashed border-slate-700 rounded-3xl">
                   <SearchX className="mx-auto text-slate-700 mb-4" size={40} />
                   <p className="text-slate-500 font-bold uppercase text-xs tracking-widest">No matching entries found</p>
                </div>
              ) : filteredEntries.map(entry => {
                const config = getStatusConfig(entry.status);
                const StatusIcon = config.icon;
                
                return (
                  <div key={entry.id} className="bg-slate-700/30 p-5 rounded-3xl border border-slate-700/50 flex flex-col md:flex-row md:items-center justify-between gap-4 group hover:border-slate-600 transition-all">
                    <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-2xl shadow-inner shrink-0 ${entry.type === 'purchase' ? 'bg-indigo-50/10 text-indigo-400' : 'bg-rose-500/10 text-rose-400'}`}>
                          {entry.type === 'purchase' ? <ShoppingBag size={20} /> : <Receipt size={20} />}
                        </div>
                        <div className="overflow-hidden">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="text-sm font-black text-white uppercase tracking-tight truncate">{entry.category}</p>
                            <span className={`px-2 py-0.5 rounded-md text-[7px] font-black uppercase tracking-widest flex items-center gap-1 shrink-0 ${config.bg} ${config.color}`}>
                              <StatusIcon size={8} /> {config.label}
                            </span>
                            {entry.receiptUrl && <ImageIcon size={12} className="text-indigo-400" />}
                          </div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase truncate max-w-[200px]">{entry.description || 'No description'}</p>
                        </div>
                    </div>
                    
                    <div className="flex items-center justify-between md:justify-end gap-6">
                        <div className="text-right">
                          <p className="text-lg font-black text-white tracking-tight">₹{entry.amount.toLocaleString()}</p>
                          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                            {entry.date} {new Date(entry.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                           <button 
                             onClick={() => setViewingEntry(entry)}
                             className="p-3 bg-slate-700 rounded-xl text-slate-300 hover:text-white transition-colors"
                             title="View"
                           >
                             <Eye size={18} />
                           </button>
                           <button 
                             onClick={() => handleEdit(entry)}
                             className="p-3 bg-indigo-500/10 rounded-xl text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all"
                             title="Edit"
                           >
                             <Edit2 size={18} />
                           </button>
                           <button 
                             onClick={() => entry.id && handleDelete(entry.id)} 
                             className="p-3 bg-rose-500/10 rounded-xl text-rose-400 hover:bg-rose-500 hover:text-white transition-all"
                             title="Delete"
                           >
                             <Trash2 size={18} />
                           </button>
                        </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
        <div className="animate-in slide-in-from-right duration-300">
           <div className="bg-white rounded-[3rem] shadow-2xl overflow-hidden">
              <header className={`p-8 flex items-center justify-between ${entryType === 'purchase' ? 'bg-indigo-600' : 'bg-rose-500'} text-white`}>
                 <div className="flex items-center gap-4">
                   <button onClick={() => { setActiveMode('view'); resetForm(); }} className="p-3 bg-white/10 rounded-2xl hover:bg-white/20 transition-all">
                      <ArrowLeft size={24} />
                   </button>
                   <div>
                      <h3 className="text-2xl font-black uppercase tracking-tight leading-none">
                        {activeMode === 'edit' ? 'Edit' : 'Add'} {entryType}
                      </h3>
                      <p className="text-white/70 text-[10px] font-bold uppercase tracking-widest mt-1">Terminal Form #ENTRY</p>
                   </div>
                 </div>
                 <div className="p-3 bg-white/20 rounded-2xl">
                    {entryType === 'purchase' ? <ShoppingBag size={32}/> : <Receipt size={32}/>}
                 </div>
              </header>

              <form onSubmit={handleSubmit} className="p-10 space-y-8">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2 block">Amount (Rupees)</label>
                       <div className="relative">
                          <IndianRupee className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300" size={28} />
                          <input 
                            required
                            type="number"
                            step="0.01"
                            value={amount}
                            onChange={e => setAmount(e.target.value)}
                            className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 outline-none pl-16 pr-8 py-6 rounded-[2rem] text-3xl font-black text-slate-900 transition-all"
                            placeholder="0.00"
                            autoFocus
                          />
                       </div>
                    </div>

                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2 block">Category</label>
                       <select 
                         required
                         value={category}
                         onChange={e => setCategory(e.target.value)}
                         className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 outline-none px-8 py-6 rounded-[2rem] text-xl font-black text-slate-700 appearance-none uppercase transition-all"
                       >
                         <option value="">-- Choose Category --</option>
                         {CATEGORIES[entryType].map(cat => (
                           <option key={cat} value={cat}>{cat}</option>
                         ))}
                       </select>
                    </div>

                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2 block">Payment Status</label>
                       <div className="flex bg-slate-50 p-1.5 rounded-2xl border-2 border-slate-100 gap-2">
                          {(['paid', 'pending', 'cancelled'] as EntryStatus[]).map((s) => {
                             const isActive = status === s;
                             const config = STATUS_CONFIG[s];
                             return (
                               <button
                                 key={s}
                                 type="button"
                                 onClick={() => setStatus(s)}
                                 className={`flex-1 py-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${isActive ? `${config.bg} ${config.color} border-current shadow-sm` : 'bg-white border-slate-100 text-slate-400'}`}
                               >
                                 {config.label}
                               </button>
                             );
                          })}
                       </div>
                    </div>

                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2 block">Outlet Attribution</label>
                       <div className="relative">
                          <Store className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                          <select 
                            required
                            value={outletId}
                            onChange={e => setOutletId(e.target.value)}
                            className="w-full bg-slate-50 border-2 border-slate-100 outline-none pl-14 pr-8 py-5 rounded-2xl text-sm font-bold text-slate-600 appearance-none uppercase"
                          >
                            {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                       </div>
                    </div>

                    <div className="space-y-2">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2 block">Transaction Date</label>
                       <div className="relative">
                          <Calendar className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300" size={20} />
                          <input 
                            required
                            type="date"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                            className="w-full bg-slate-50 border-2 border-slate-100 outline-none pl-14 pr-8 py-5 rounded-2xl text-sm font-bold text-slate-600 appearance-none"
                          />
                       </div>
                    </div>
                 </div>

                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2 block">Short Note / Description</label>
                    <textarea 
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-slate-100 outline-none px-8 py-5 rounded-[2rem] text-sm font-medium text-slate-600 resize-none h-24"
                      placeholder="What was this for? (e.g. Milk, Petrol, Stationary...)"
                    />
                 </div>

                 <div className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2 block">Evidence (Receipt Photo)</label>
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-200 rounded-[2.5rem] p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 transition-all relative overflow-hidden group"
                    >
                      {receiptPreview ? (
                        <>
                          <img src={receiptPreview} alt="Receipt Preview" className="absolute inset-0 w-full h-full object-cover opacity-20 group-hover:opacity-10 transition-opacity" />
                          <div className="relative z-10 flex flex-col items-center">
                            <ImageIcon size={48} className="text-indigo-600 mb-2" />
                            <p className="text-xs font-black text-slate-900 uppercase">Change Photo</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <Camera size={48} className="text-slate-300 mb-2" />
                          <p className="text-xs font-black text-slate-400 uppercase">Tap to Capture or Upload</p>
                        </>
                      )}
                      <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileSelect} 
                        accept="image/*" 
                        capture="environment" // Forces camera on mobile
                        className="hidden" 
                      />
                    </div>
                 </div>

                 <div className="pt-6">
                    <button 
                      disabled={saving || success}
                      className={`w-full py-8 rounded-[2.5rem] font-black uppercase text-xl tracking-wider shadow-2xl transition-all flex items-center justify-center gap-4 ${success ? 'bg-emerald-500 scale-[0.98]' : (entryType === 'purchase' ? 'bg-indigo-600 hover:bg-indigo-700 hover:translate-y-[-2px]' : 'bg-rose-500 hover:bg-rose-600 hover:translate-y-[-2px]')} text-white`}
                    >
                       {saving ? (
                         <Loader2 size={32} className="animate-spin" />
                       ) : success ? (
                         <>
                           <CheckCircle2 size={32} /> {activeMode === 'edit' ? 'Updated' : 'Submitted'}...
                         </>
                       ) : (
                         <>
                           <Plus size={32} /> {activeMode === 'edit' ? 'Update Entry' : 'Post Entry'}
                         </>
                       )}
                    </button>
                    {activeMode === 'edit' && (
                      <button 
                        type="button"
                        onClick={() => { setActiveMode('view'); resetForm(); }}
                        className="w-full mt-4 py-4 text-slate-400 font-black uppercase text-xs tracking-widest"
                      >
                        Cancel Edit
                      </button>
                    )}
                 </div>
              </form>
           </div>
        </div>
      )}

      {/* DETAIL VIEW MODAL */}
      {viewingEntry && (() => {
        const config = getStatusConfig(viewingEntry.status);
        const StatusIcon = config.icon;
        
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setViewingEntry(null)} />
             <div className="relative w-full max-w-lg bg-white rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
                <header className={`p-8 flex items-center justify-between text-white ${viewingEntry.type === 'purchase' ? 'bg-indigo-600' : 'bg-rose-500'}`}>
                   <div className="flex items-center gap-4">
                      <div className="p-3 bg-white/20 rounded-2xl">
                         {viewingEntry.type === 'purchase' ? <ShoppingBag size={24}/> : <Receipt size={24}/>}
                      </div>
                      <div>
                         <h3 className="text-xl font-black uppercase tracking-tight">{viewingEntry.category}</h3>
                         <p className="text-[10px] font-bold uppercase opacity-70 tracking-widest">{viewingEntry.date}</p>
                      </div>
                   </div>
                   <button onClick={() => setViewingEntry(null)} className="p-2 bg-white/10 rounded-xl hover:bg-white/20 transition-all">
                      <X size={20}/>
                   </button>
                </header>

                <div className="p-8 space-y-8">
                   <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-1">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</p>
                         <p className="text-3xl font-black text-slate-900 tracking-tighter">₹{viewingEntry.amount.toLocaleString()}</p>
                      </div>
                      <div className="space-y-1">
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Station</p>
                         <p className="text-sm font-black text-slate-700 uppercase">{getOutletName(viewingEntry.outletId)}</p>
                      </div>
                   </div>

                   <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</p>
                      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl font-black text-xs uppercase ${config.bg} ${config.color}`}>
                         <StatusIcon size={14} />
                         {config.label}
                      </div>
                   </div>

                   {viewingEntry.description && (
                     <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Note</p>
                        <p className="text-sm font-medium text-slate-700 leading-relaxed italic">"{viewingEntry.description}"</p>
                     </div>
                   )}

                   {viewingEntry.receiptUrl ? (
                     <div className="space-y-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Receipt Image</p>
                        <div className="rounded-[2rem] overflow-hidden border border-slate-100 shadow-inner bg-slate-50">
                           <img 
                             src={viewingEntry.receiptUrl} 
                             alt="Receipt Evidence" 
                             className="w-full h-auto max-h-[300px] object-contain cursor-zoom-in"
                             onClick={() => window.open(viewingEntry.receiptUrl, '_blank')}
                           />
                        </div>
                     </div>
                   ) : (
                     <div className="p-8 border-2 border-dashed border-slate-100 rounded-[2.5rem] flex flex-col items-center justify-center text-slate-300">
                        <ImageIcon size={32} className="mb-2 opacity-30" />
                        <p className="text-[10px] font-bold uppercase tracking-widest">No photo evidence attached</p>
                     </div>
                   )}
                </div>

                <footer className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                   <button 
                     onClick={() => { handleEdit(viewingEntry); setViewingEntry(null); }}
                     className="flex-1 py-4 bg-white border border-slate-200 rounded-2xl font-black uppercase text-xs text-indigo-600 flex items-center justify-center gap-2 hover:border-indigo-600 transition-colors"
                   >
                      <Edit2 size={16}/> Edit
                   </button>
                   <button 
                     onClick={() => setViewingEntry(null)}
                     className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center"
                   >
                      Close
                   </button>
                </footer>
             </div>
          </div>
        );
      })()}

      {/* POLICY ALERT FOOTER */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-slate-950/90 backdrop-blur-xl border-t border-white/5 z-[40]">
        <div className="max-w-4xl mx-auto flex items-center justify-center gap-6">
           <AlertCircle size={16} className="text-amber-500 shrink-0" />
           <p className="text-[10px] font-bold text-slate-400 leading-relaxed uppercase tracking-widest text-center">
             Verified Logging Policy: Every entry is timestamped and attributed to your user ID. Ensure all amounts match physical receipts.
           </p>
        </div>
      </div>
    </div>
  );
};

// Add CSS for hiding scrollbar
const style = document.createElement('style');
style.textContent = `
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;
document.head.append(style);

export default CrewTerminal;
