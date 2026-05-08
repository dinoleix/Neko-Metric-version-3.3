
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, addDoc, doc, deleteDoc, updateDoc, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import {
  DailyCounterEntry,
  DailySalesLog,
  UserProfile,
  MASTER_OUTLETS,
  getOutletName,
  getOutletCode,
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
  Wallet,
  TrendingUp,
  CreditCard,
  AlertTriangle
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
      const img = document.createElement('img');
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
  const [activeMode, setActiveMode] = useState<'landing' | 'view' | 'add' | 'edit' | 'daily-sales'>('landing');
  const [entryType, setEntryType] = useState<'expense' | 'purchase'>('purchase');
  const [entries, setEntries] = useState<DailyCounterEntry[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  // --- Filtering State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | EntryStatus>('all');
  const [filterType, setFilterType] = useState<'all' | 'purchase' | 'expense'>('all');
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

  // --- Daily Sales Log State ---
  const [dsDate, setDsDate] = useState(new Date().toISOString().split('T')[0]);
  const [dsTotal, setDsTotal] = useState('');
  const [dsCash, setDsCash] = useState('');
  const [dsCard, setDsCard] = useState('');
  const [dsUpi, setDsUpi] = useState('');
  const [dsNotes, setDsNotes] = useState('');
  const [dsOutletId, setDsOutletId] = useState(profile.assignedOutlet || MASTER_OUTLETS[0].id);
  const [dsSaving, setDsSaving] = useState(false);
  const [dsSuccess, setDsSuccess] = useState(false);
  const [dsExistingId, setDsExistingId] = useState<string | null>(null);
  const [dsDuplicateWarning, setDsDuplicateWarning] = useState(false);

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

  const generateBillNumber = async (
    type: 'purchase' | 'expense',
    entryOutletId: string,
    entryDate: string
  ): Promise<string> => {
    const prefix = type === 'purchase' ? 'PUR' : 'EXP';
    const [yr, mo, dy] = entryDate.split('-');
    const dateCode = `${dy}${mo}${yr.slice(2)}`;
    const storeCode = getOutletCode(entryOutletId);

    // Query by userId (matches security rules), filter outlet+date client-side
    const q = query(collection(db, 'crew_entries'), where('userId', '==', user.uid));
    const snap = await getDocs(q);
    const sameDayCount = snap.docs.filter(d => {
      const data = d.data();
      return data.outletId === entryOutletId && data.date === entryDate;
    }).length;
    const seq = (sameDayCount + 1).toString().padStart(3, '0');

    return `${prefix}-${storeCode}-${dateCode}-${seq}`;
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

      // For new entries generate a bill number; for edits preserve the existing one
      const isNew = !(activeMode === 'edit' && editingId);
      const billNumber = isNew
        ? await generateBillNumber(entryType, outletId, date)
        : entries.find(e => e.id === editingId)?.billNumber;

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
        billNumber: billNumber || null,
        createdAt: Date.now()
      };

      if (activeMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'crew_entries', editingId), entryData);
      } else {
        await addDoc(collection(db, 'crew_entries'), entryData);
      }
      
      setSuccess(true);
      const returnTo = 'view';
      resetForm();

      setTimeout(() => {
        setSuccess(false);
        setActiveMode(returnTo);
        fetchEntries();
      }, 1500);
    } catch (err) {
      console.error(err);
      alert("Submission failed. Check connection.");
    } finally {
      setSaving(false);
    }
  };

  const resetDsForm = () => {
    setDsDate(new Date().toISOString().split('T')[0]);
    setDsTotal('');
    setDsCash('');
    setDsCard('');
    setDsUpi('');
    setDsNotes('');
    setDsExistingId(null);
    setDsDuplicateWarning(false);
  };

  const handleDailySalesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = parseFloat(dsTotal) || 0;
    const cash = parseFloat(dsCash) || 0;
    const card = parseFloat(dsCard) || 0;
    const upi = parseFloat(dsUpi) || 0;
    if (total === 0) return;
    if (Math.abs(cash + card + upi - total) > 0.5) return; // breakdown must match total

    setDsSaving(true);
    try {
      const ownerId = profile.ownerId || user.uid;

      if (!dsExistingId) {
        const dupQ = query(
          collection(db, 'daily_sales_logs'),
          where('userId', '==', ownerId),
          where('outletId', '==', dsOutletId),
          where('date', '==', dsDate)
        );
        const dupSnap = await getDocs(dupQ);
        if (!dupSnap.empty) {
          setDsExistingId(dupSnap.docs[0].id);
          setDsDuplicateWarning(true);
          setDsSaving(false);
          return;
        }
      }

      const logData: Omit<DailySalesLog, 'id'> = {
        userId: ownerId,
        outletId: dsOutletId,
        date: dsDate,
        cash,
        card,
        upi,
        totalNet: total,
        notes: dsNotes,
        submittedBy: user.email?.split('@')[0] || 'Unknown',
        createdAt: Date.now(),
      };

      if (dsExistingId) {
        await updateDoc(doc(db, 'daily_sales_logs', dsExistingId), logData as any);
      } else {
        await addDoc(collection(db, 'daily_sales_logs'), logData);
      }

      setDsSuccess(true);
      setTimeout(() => {
        setDsSuccess(false);
        setActiveMode('view');
        resetDsForm();
      }, 1500);
    } catch (err) {
      console.error(err);
      alert('Submission failed. Check connection.');
    } finally {
      setDsSaving(false);
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
      const matchesType = filterType === 'all' || e.type === filterType;
      const matchesStatus = filterStatus === 'all' || e.status === filterStatus;
      const matchesCategory = filterCategory === 'all' || e.category === filterCategory;
      const matchesSearch = !searchTerm ||
        e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.category.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesType && matchesStatus && matchesCategory && matchesSearch;
    });
  }, [entries, filterType, filterStatus, filterCategory, searchTerm]);

  return (
    <div className="animate-in fade-in duration-500 pb-24">

      {/* ── LANDING ─────────────────────────────────────────────── */}
      {activeMode === 'landing' ? (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-6 py-10 gap-10">
          {/* Greeting */}
          <div className="text-center">
            <p className="text-[11px] font-black text-slate-600 uppercase tracking-[0.3em] mb-3">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h2 className="text-5xl font-black text-white uppercase tracking-tight leading-none">
              {getOutletName(profile.assignedOutlet || 'GLOBAL')}
            </h2>
            <p className="text-slate-500 text-base font-bold uppercase tracking-[0.2em] mt-4">
              {user.email?.split('@')[0]}
            </p>
          </div>

          {/* Action cards */}
          <div className="grid grid-cols-2 gap-5 w-full max-w-2xl">
            <button
              onClick={() => { resetDsForm(); setActiveMode('daily-sales'); }}
              className="aspect-square bg-emerald-600 active:scale-95 text-white rounded-[2.5rem] flex flex-col items-center justify-center gap-6 shadow-2xl shadow-emerald-900/50 transition-transform border border-emerald-500/20"
            >
              <TrendingUp size={60} strokeWidth={1.5} />
              <div className="text-center px-4">
                <p className="text-2xl font-black uppercase tracking-tight leading-tight">Report Sales</p>
                <p className="text-[11px] font-bold text-emerald-200/80 mt-2 uppercase tracking-widest">Cash · Card · UPI</p>
              </div>
            </button>

            <button
              onClick={() => setActiveMode('view')}
              className="aspect-square bg-slate-800 active:scale-95 text-white rounded-[2.5rem] flex flex-col items-center justify-center gap-6 shadow-2xl transition-transform border border-slate-700/60"
            >
              <div className="flex items-center gap-3">
                <ShoppingBag size={44} strokeWidth={1.5} className="text-indigo-400" />
                <Receipt size={44} strokeWidth={1.5} className="text-rose-400" />
              </div>
              <div className="text-center px-4">
                <p className="text-2xl font-black uppercase tracking-tight leading-tight">Purchases</p>
                <p className="text-[11px] font-bold text-slate-500 mt-2 uppercase tracking-widest">& Expenses</p>
              </div>
            </button>
          </div>
        </div>

      /* ── ENTRIES LIST ──────────────────────────────────────────── */
      ) : activeMode === 'view' ? (
        <div className="space-y-5 px-1 pt-2">
          {/* Top nav bar */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveMode('landing')}
              className="flex items-center gap-2.5 h-14 px-6 bg-slate-800 active:scale-95 border border-slate-700 rounded-2xl text-white transition-transform text-sm font-black uppercase tracking-widest shrink-0"
            >
              <ArrowLeft size={18} /> Home
            </button>
            <div className="flex-1 text-center">
              <h2 className="text-base font-black text-white uppercase tracking-widest">Purchases & Expenses</h2>
            </div>
            <button
              onClick={() => { resetForm(); setEntryType('purchase'); setActiveMode('add'); }}
              className="flex items-center gap-2.5 h-14 px-6 bg-indigo-600 active:scale-95 rounded-2xl text-white text-sm font-black uppercase tracking-widest transition-transform shadow-lg shrink-0"
            >
              <Plus size={18} /> New Entry
            </button>
          </div>

          {/* Filter panel */}
          <div className="bg-slate-800/80 rounded-3xl border border-slate-700/60 p-5 space-y-4">
            {/* Type + Status toggles + refresh */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-700/60 gap-1">
                {(['all', 'purchase', 'expense'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`h-11 px-5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                      filterType === t
                        ? t === 'expense' ? 'bg-rose-500 text-white shadow-md' : 'bg-indigo-600 text-white shadow-md'
                        : 'text-slate-500'
                    }`}
                  >
                    {t === 'purchase' ? 'Online' : t === 'expense' ? 'Cash' : 'All'}
                  </button>
                ))}
              </div>

              <div className="flex bg-slate-900 p-1 rounded-2xl border border-slate-700/60 gap-1">
                {(['all', 'paid', 'pending', 'cancelled'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`h-11 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                      filterStatus === s ? 'bg-slate-500 text-white shadow-md' : 'text-slate-500'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <button onClick={fetchEntries} className="ml-auto h-11 w-11 flex items-center justify-center text-slate-500 active:text-white transition-colors shrink-0">
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Date presets */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {(['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'custom'] as DatePreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => setDatePreset(p)}
                  className={`h-11 px-5 rounded-2xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all active:scale-95 shrink-0 ${
                    datePreset === p ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-900 text-slate-500 border border-slate-700/60'
                  }`}
                >
                  {p.replace('-', ' ')}
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-top-2 duration-300">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">From</label>
                  <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="w-full h-12 bg-slate-900 border border-slate-700 rounded-xl px-4 text-sm font-bold text-white outline-none focus:border-indigo-500" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest ml-1">To</label>
                  <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="w-full h-12 bg-slate-900 border border-slate-700 rounded-xl px-4 text-sm font-bold text-white outline-none focus:border-indigo-500" />
                </div>
              </div>
            )}

            {/* Search + Category */}
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search…"
                  className="w-full h-12 bg-slate-900 border border-slate-700 focus:border-indigo-500 outline-none pl-10 pr-4 rounded-2xl text-sm font-bold text-white transition-all"
                />
              </div>
              <div className="relative">
                <ListFilter className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full h-12 bg-slate-900 border border-slate-700 focus:border-indigo-500 outline-none pl-10 pr-8 rounded-2xl text-sm font-bold text-white appearance-none uppercase transition-all"
                >
                  <option value="all">All Categories</option>
                  {ALL_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={14} />
              </div>
            </div>
          </div>

          {/* Entries */}
          <div className="space-y-2.5">
            {loading ? (
              <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-slate-700" size={36} /></div>
            ) : filteredEntries.length === 0 ? (
              <div className="py-28 text-center border-2 border-dashed border-slate-800 rounded-3xl">
                <SearchX className="mx-auto text-slate-700 mb-4" size={48} />
                <p className="text-slate-600 font-black uppercase text-xs tracking-widest">No matching entries</p>
              </div>
            ) : filteredEntries.map(entry => {
              const config = getStatusConfig(entry.status);
              const StatusIcon = config.icon;
              return (
                <div key={entry.id} className="bg-slate-800 border border-slate-700/50 rounded-3xl flex items-stretch overflow-hidden active:scale-[0.995] transition-transform">
                  {/* Tappable main area */}
                  <button
                    onClick={() => setViewingEntry(entry)}
                    className="flex items-center gap-5 flex-1 text-left px-5 py-5 min-h-[80px]"
                  >
                    <div className={`p-4 rounded-2xl shrink-0 ${entry.type === 'purchase' ? 'bg-indigo-500/15 text-indigo-400' : 'bg-rose-500/15 text-rose-400'}`}>
                      {entry.type === 'purchase' ? <ShoppingBag size={26} /> : <Receipt size={26} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="text-base font-black text-white uppercase tracking-tight truncate">{entry.category}</p>
                        <span className={`shrink-0 px-2 py-0.5 rounded-lg text-[8px] font-black uppercase tracking-widest ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                        {entry.receiptUrl && <ImageIcon size={13} className="text-slate-500 shrink-0" />}
                      </div>
                      {entry.billNumber && (
                        <p className="text-[10px] font-black text-slate-500 tracking-wider font-mono mb-0.5">{entry.billNumber}</p>
                      )}
                      {entry.description && (
                        <p className="text-[10px] text-slate-600 uppercase truncate">{entry.description}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 pr-2">
                      <p className="text-xl font-black text-white tracking-tight">₹{entry.amount.toLocaleString()}</p>
                      <p className="text-[9px] font-bold text-slate-600 uppercase mt-0.5">{entry.date}</p>
                    </div>
                  </button>

                  {/* Action buttons */}
                  <div className="flex items-stretch border-l border-slate-700/50">
                    <button
                      onClick={() => handleEdit(entry)}
                      className="w-14 flex items-center justify-center bg-indigo-500/10 text-indigo-400 active:bg-indigo-500 active:text-white transition-all"
                    >
                      <Edit2 size={20} />
                    </button>
                    <button
                      onClick={() => entry.id && handleDelete(entry.id)}
                      className="w-14 flex items-center justify-center bg-rose-500/10 text-rose-400 active:bg-rose-500 active:text-white transition-all rounded-r-3xl"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

      /* ── DAILY SALES FORM ──────────────────────────────────────── */
      ) : activeMode === 'daily-sales' ? (
        <div className="animate-in slide-in-from-right duration-300 px-1 pt-2">
          <div className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
            <header className="px-8 py-7 flex items-center justify-between bg-emerald-600 text-white">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => { setActiveMode('landing'); resetDsForm(); }}
                  className="p-3.5 bg-white/15 rounded-2xl active:bg-white/30 transition-all"
                >
                  <ArrowLeft size={22} />
                </button>
                <div>
                  <h3 className="text-2xl font-black uppercase tracking-tight leading-none">Log Daily Sales</h3>
                  <p className="text-emerald-100/70 text-[10px] font-bold uppercase tracking-widest mt-1.5">Cash · Card · UPI Breakdown</p>
                </div>
              </div>
              <div className="p-3.5 bg-white/20 rounded-2xl"><TrendingUp size={30} /></div>
            </header>

            <form onSubmit={handleDailySalesSubmit} className="p-8 md:p-10 space-y-7">
              {dsDuplicateWarning && (
                <div className="flex items-start gap-4 p-5 bg-amber-50 border border-amber-200 rounded-2xl">
                  <AlertTriangle size={22} className="text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-black text-amber-800 uppercase">Entry already exists for this date</p>
                    <p className="text-sm text-amber-600 font-medium mt-1">Submitting will update the existing entry for {dsDate} at {getOutletName(dsOutletId)}.</p>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Sales Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={20} />
                    <input
                      required type="date" value={dsDate}
                      onChange={e => { setDsDate(e.target.value); setDsDuplicateWarning(false); setDsExistingId(null); }}
                      className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 outline-none pl-14 pr-4 rounded-2xl text-sm font-bold text-slate-700 appearance-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Outlet</label>
                  <div className="relative">
                    <Store className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={20} />
                    <select
                      required value={dsOutletId}
                      onChange={e => { setDsOutletId(e.target.value); setDsDuplicateWarning(false); setDsExistingId(null); }}
                      className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 outline-none pl-14 pr-8 rounded-2xl text-sm font-bold text-slate-700 appearance-none uppercase"
                    >
                      {MASTER_OUTLETS.filter(o => o.id !== 'GLOBAL').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* Total */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Total Sales Amount</label>
                <div className="relative">
                  <IndianRupee className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={28} />
                  <input
                    required type="number" step="0.01" min="0"
                    value={dsTotal}
                    onChange={e => { setDsTotal(e.target.value); setDsCash(''); setDsCard(''); setDsUpi(''); }}
                    className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/5 outline-none pl-16 pr-8 py-6 rounded-[2rem] text-4xl font-black text-slate-900 transition-all"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
              </div>

              {/* Breakdown — revealed once total is set */}
              {(parseFloat(dsTotal) || 0) > 0 && (() => {
                const total = parseFloat(dsTotal) || 0;
                const allocated = (parseFloat(dsCash) || 0) + (parseFloat(dsCard) || 0) + (parseFloat(dsUpi) || 0);
                const remaining = total - allocated;
                const isMatch = Math.abs(remaining) <= 0.5;
                const isOver = remaining < -0.5;
                return (
                  <div className="space-y-6 animate-in slide-in-from-top-2 duration-300">
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-slate-100" />
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Break it down</p>
                      <div className="h-px flex-1 bg-slate-100" />
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      {[
                        { label: 'Cash', icon: <Wallet size={13} className="text-slate-400" />, val: dsCash, set: setDsCash, note: null },
                        { label: 'Card (Net)', icon: <CreditCard size={13} className="text-slate-400" />, val: dsCard, set: setDsCard, note: 'After card charges' },
                        { label: 'UPI', icon: <Smartphone size={13} className="text-slate-400" />, val: dsUpi, set: setDsUpi, note: null },
                      ].map(({ label, icon, val, set, note }) => (
                        <div key={label} className="space-y-2">
                          <label className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">
                            {icon} {label}
                          </label>
                          <div className="relative">
                            <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                            <input
                              type="number" step="0.01" min="0" value={val}
                              onChange={e => set(e.target.value)}
                              className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 outline-none pl-10 pr-3 py-4 rounded-2xl text-xl font-black text-slate-900 transition-all"
                              placeholder="0"
                            />
                          </div>
                          {note && <p className="text-[9px] text-slate-400 font-bold uppercase ml-1">{note}</p>}
                        </div>
                      ))}
                    </div>

                    {/* Balance indicator */}
                    <div className={`flex items-center justify-between px-7 py-5 rounded-2xl border-2 transition-all ${isMatch ? 'bg-emerald-50 border-emerald-300' : isOver ? 'bg-rose-50 border-rose-300' : 'bg-amber-50 border-amber-200'}`}>
                      <p className={`text-sm font-black uppercase tracking-wider ${isMatch ? 'text-emerald-700' : isOver ? 'text-rose-700' : 'text-amber-700'}`}>
                        {isMatch ? '✓ Breakdown matches total' : isOver ? 'Over-allocated' : 'Remaining to allocate'}
                      </p>
                      <p className={`text-3xl font-black tracking-tighter ${isMatch ? 'text-emerald-700' : isOver ? 'text-rose-700' : 'text-amber-700'}`}>
                        {isMatch ? '₹0' : `₹${Math.abs(remaining).toLocaleString('en-IN')}`}
                      </p>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Notes (Optional)</label>
                <textarea
                  value={dsNotes}
                  onChange={e => setDsNotes(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-100 focus:border-emerald-500 outline-none px-7 py-5 rounded-[1.5rem] text-sm font-medium text-slate-600 resize-none h-24"
                  placeholder="Any remarks for this day? (e.g. machine down, event, short staff…)"
                />
              </div>

              <button
                disabled={dsSaving || dsSuccess || (parseFloat(dsTotal) || 0) === 0 || Math.abs((parseFloat(dsCash) || 0) + (parseFloat(dsCard) || 0) + (parseFloat(dsUpi) || 0) - (parseFloat(dsTotal) || 0)) > 0.5}
                className={`w-full py-7 rounded-[2rem] font-black uppercase text-xl tracking-wider shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-4 text-white disabled:opacity-40 ${dsSuccess ? 'bg-emerald-400' : 'bg-emerald-600'}`}
              >
                {dsSaving ? <Loader2 size={30} className="animate-spin" />
                  : dsSuccess ? <><CheckCircle2 size={30} /> Saved!</>
                  : dsDuplicateWarning ? <><Plus size={30} /> Update Entry</>
                  : <><Plus size={30} /> Post Daily Sales</>}
              </button>
            </form>
          </div>
        </div>

      /* ── ADD / EDIT FORM ───────────────────────────────────────── */
      ) : (
        <div className="animate-in slide-in-from-right duration-300 px-1 pt-2">
          <div className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
            <header className={`px-8 py-7 flex items-center justify-between text-white ${entryType === 'purchase' ? 'bg-indigo-600' : 'bg-rose-500'}`}>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => { activeMode === 'edit' ? setActiveMode('view') : setActiveMode('landing'); resetForm(); }}
                  className="p-3.5 bg-white/15 rounded-2xl active:bg-white/30 transition-all"
                >
                  <ArrowLeft size={22} />
                </button>
                <div>
                  <h3 className="text-2xl font-black uppercase tracking-tight leading-none">
                    {activeMode === 'edit' ? 'Edit Entry' : 'Log Entry'}
                  </h3>
                  <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mt-1.5">
                    {entryType === 'purchase' ? 'Online / Digital Payment' : 'Cash Payment'}
                  </p>
                </div>
              </div>
              <div className="p-3.5 bg-white/20 rounded-2xl">
                {entryType === 'purchase' ? <ShoppingBag size={30} /> : <Receipt size={30} />}
              </div>
            </header>

            <form onSubmit={handleSubmit} className="p-8 md:p-10 space-y-7">
              {/* Payment type toggle */}
              <div className="grid grid-cols-2 gap-3 bg-slate-100 p-2 rounded-[1.5rem]">
                <button
                  type="button" onClick={() => setEntryType('purchase')}
                  className={`flex items-center justify-center gap-3 h-14 rounded-2xl font-black uppercase text-sm tracking-widest transition-all active:scale-95 ${entryType === 'purchase' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}
                >
                  <ShoppingBag size={20} /> Online / Digital
                </button>
                <button
                  type="button" onClick={() => setEntryType('expense')}
                  className={`flex items-center justify-center gap-3 h-14 rounded-2xl font-black uppercase text-sm tracking-widest transition-all active:scale-95 ${entryType === 'expense' ? 'bg-rose-500 text-white shadow-lg' : 'text-slate-400'}`}
                >
                  <Receipt size={20} /> By Cash
                </button>
              </div>

              {/* Amount + Category */}
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Amount (₹)</label>
                  <div className="relative">
                    <IndianRupee className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={26} />
                    <input
                      required type="number" step="0.01"
                      value={amount} onChange={e => setAmount(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none pl-14 pr-5 py-5 rounded-2xl text-3xl font-black text-slate-900 transition-all"
                      placeholder="0.00" autoFocus
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Category</label>
                  <select
                    required value={category} onChange={e => setCategory(e.target.value)}
                    className="w-full h-[74px] bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none px-6 rounded-2xl text-base font-black text-slate-700 appearance-none uppercase transition-all"
                  >
                    <option value="">-- Pick Category --</option>
                    {CATEGORIES[entryType].map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>

              {/* Status */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Payment Status</label>
                <div className="flex bg-slate-50 p-1.5 rounded-2xl border-2 border-slate-100 gap-2">
                  {(['paid', 'pending', 'cancelled'] as EntryStatus[]).map((s) => {
                    const isActive = status === s;
                    const cfg = STATUS_CONFIG[s];
                    return (
                      <button
                        key={s} type="button" onClick={() => setStatus(s)}
                        className={`flex-1 h-14 rounded-xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 border ${isActive ? `${cfg.bg} ${cfg.color} border-current shadow-sm` : 'bg-white border-slate-100 text-slate-400'}`}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Outlet + Date */}
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Outlet</label>
                  <div className="relative">
                    <Store className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                    <select
                      required value={outletId} onChange={e => setOutletId(e.target.value)}
                      className="w-full h-14 bg-slate-50 border-2 border-slate-100 outline-none pl-12 pr-8 rounded-2xl text-sm font-bold text-slate-700 appearance-none uppercase"
                    >
                      {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                    <input
                      required type="date" value={date} onChange={e => setDate(e.target.value)}
                      className="w-full h-14 bg-slate-50 border-2 border-slate-100 outline-none pl-12 pr-4 rounded-2xl text-sm font-bold text-slate-700 appearance-none"
                    />
                  </div>
                </div>
              </div>

              {/* Note */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Note / Description</label>
                <textarea
                  value={description} onChange={e => setDescription(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none px-6 py-5 rounded-2xl text-sm font-medium text-slate-600 resize-none h-24"
                  placeholder="What was this for? (e.g. Milk, Petrol, Stationery…)"
                />
              </div>

              {/* Receipt photo */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Receipt Photo</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-[2rem] p-8 flex flex-col items-center justify-center cursor-pointer active:bg-slate-50 transition-all relative overflow-hidden"
                >
                  {receiptPreview ? (
                    <>
                      <img src={receiptPreview} alt="Receipt Preview" className="absolute inset-0 w-full h-full object-cover opacity-15" />
                      <div className="relative z-10 flex flex-col items-center gap-2">
                        <ImageIcon size={44} className="text-indigo-600" />
                        <p className="text-sm font-black text-slate-800 uppercase tracking-widest">Change Photo</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <Camera size={44} className="text-slate-300 mb-2" />
                      <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Tap to Capture or Upload</p>
                    </>
                  )}
                  <input
                    type="file" ref={fileInputRef} onChange={handleFileSelect}
                    accept="image/*" capture="environment"
                    className="hidden"
                  />
                </div>
              </div>

              <button
                disabled={saving || success}
                className={`w-full py-7 rounded-[2rem] font-black uppercase text-xl tracking-wider shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-4 text-white ${
                  success ? 'bg-emerald-500' : entryType === 'purchase' ? 'bg-indigo-600' : 'bg-rose-500'
                }`}
              >
                {saving ? <Loader2 size={30} className="animate-spin" />
                  : success ? <><CheckCircle2 size={30} /> {activeMode === 'edit' ? 'Updated' : 'Submitted'}!</>
                  : <><Plus size={30} /> {activeMode === 'edit' ? 'Update Entry' : 'Post Entry'}</>}
              </button>
              {activeMode === 'edit' && (
                <button
                  type="button"
                  onClick={() => { setActiveMode('view'); resetForm(); }}
                  className="w-full py-4 text-slate-400 font-black uppercase text-sm tracking-widest"
                >
                  Cancel Edit
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ── DETAIL MODAL ───────────────────────────────────────────── */}
      {viewingEntry && (() => {
        const config = getStatusConfig(viewingEntry.status);
        const StatusIcon = config.icon;
        return (
          <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-4 md:p-6">
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setViewingEntry(null)} />
            <div className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom md:zoom-in duration-300">
              <header className={`px-8 py-7 flex items-center justify-between text-white ${viewingEntry.type === 'purchase' ? 'bg-indigo-600' : 'bg-rose-500'}`}>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-white/20 rounded-2xl">
                    {viewingEntry.type === 'purchase' ? <ShoppingBag size={26} /> : <Receipt size={26} />}
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tight leading-none">{viewingEntry.category}</h3>
                    <p className="text-[10px] font-bold uppercase opacity-60 tracking-widest mt-1">{viewingEntry.date}</p>
                  </div>
                </div>
                <button onClick={() => setViewingEntry(null)} className="p-3 bg-white/15 rounded-2xl active:bg-white/30 transition-all">
                  <X size={22} />
                </button>
              </header>

              <div className="p-8 space-y-6">
                {/* Bill number — prominent at top */}
                {viewingEntry.billNumber && (
                  <div className="flex items-center justify-between px-5 py-4 bg-slate-900 rounded-2xl border border-slate-700">
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Bill No.</p>
                    <p className="text-sm font-black text-white tracking-widest font-mono">{viewingEntry.billNumber}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-5">
                  <div className="bg-slate-50 rounded-2xl p-5">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Amount</p>
                    <p className="text-3xl font-black text-slate-900 tracking-tighter">₹{viewingEntry.amount.toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-5">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Station</p>
                    <p className="text-sm font-black text-slate-800 uppercase leading-tight">{getOutletName(viewingEntry.outletId)}</p>
                  </div>
                </div>

                <div className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl font-black text-sm uppercase ${config.bg} ${config.color}`}>
                  <StatusIcon size={16} /> {config.label}
                </div>

                {viewingEntry.description && (
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Note</p>
                    <p className="text-sm font-medium text-slate-700 leading-relaxed italic">"{viewingEntry.description}"</p>
                  </div>
                )}

                {viewingEntry.receiptUrl ? (
                  <div className="space-y-3">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Receipt</p>
                    <div className="rounded-[1.5rem] overflow-hidden border border-slate-100 shadow-inner bg-slate-50">
                      <img
                        src={viewingEntry.receiptUrl}
                        alt="Receipt Evidence"
                        className="w-full h-auto max-h-[260px] object-contain cursor-zoom-in"
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

                <footer className="px-8 py-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                  <button
                    onClick={() => { handleEdit(viewingEntry); setViewingEntry(null); }}
                    className="flex-1 h-14 bg-white border-2 border-slate-200 rounded-2xl font-black uppercase text-sm text-indigo-600 flex items-center justify-center gap-2 active:scale-95 transition-transform"
                  >
                    <Edit2 size={18} /> Edit
                  </button>
                  <button
                    onClick={() => setViewingEntry(null)}
                    className="flex-1 h-14 bg-slate-900 text-white rounded-2xl font-black uppercase text-sm flex items-center justify-center active:scale-95 transition-transform"
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
