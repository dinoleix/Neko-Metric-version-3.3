
import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, getDoc, where, addDoc, doc, deleteDoc, updateDoc, setDoc, orderBy, increment, runTransaction } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { getCachedCollection, invalidateCached } from '../referenceCache';
import { rebuildCrewSnapshot } from '../crewSnapshotService';
import {
  DailyCounterEntry,
  DailySalesLog,
  SalesLedgerEntry,
  UserProfile,
  MASTER_OUTLETS,
  MONTH_NAMES,
  getOutletName,
  getOutletCode,
  CREW_PURCHASE_CATEGORIES,
  CREW_EXPENSE_CATEGORIES,
  EntryStatus,
  BankAccount,
  Vendor,
  Product,
  CrewCategory,
  BillItem,
  ServingOption,
  WasteEntry,
  WasteLineItem,
  WasteType,
  TrackedConsumable,
  istNow,
  istDateString
} from '../types';
import ProductCatalog from './ProductCatalog';
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
  AlertTriangle,
  ArrowRightLeft,
  Vault,
  Package,
  Table2,
  LayoutList
} from 'lucide-react';

const ALL_CREW_CATEGORIES = Array.from(
  new Set([...CREW_PURCHASE_CATEGORIES, ...CREW_EXPENSE_CATEGORIES])
).sort();

const STATUS_CONFIG: Record<EntryStatus, { label: string, color: string, bg: string, icon: any }> = {
  paid: { label: 'Paid', color: 'text-emerald-500', bg: 'bg-emerald-500/10', icon: CheckCircle2 },
  pending: { label: 'Pending', color: 'text-amber-500', bg: 'bg-amber-500/10', icon: Clock3 },
  cancelled: { label: 'Cancelled', color: 'text-rose-500', bg: 'bg-rose-500/10', icon: XCircle }
};

type DatePreset = 'today' | 'yesterday' | 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'custom';

// Resolves which bank account an entry hits: 10K vault for cash expenses paid
// from the vault (no fallback — the source was explicit), otherwise the outlet's
// primary cash/digital account with the historical fallback chain. The generic
// fallback excludes the 10K vault so it can never be charged by accident.
const resolveTargetAccount = (
  accounts: BankAccount[],
  entryOutletId: string,
  type: 'purchase' | 'expense',
  source: 'counter' | '10k'
): BankAccount | null => {
  if (type === 'expense' && source === '10k') {
    return accounts.find(a => a.outletId === entryOutletId && a.accountType === '10kcash') ?? null;
  }
  const accountType = type === 'expense' ? 'cash' : 'digital';
  return accounts.find(a => a.outletId === entryOutletId && a.isPrimary === true && a.accountType === accountType)
    ?? accounts.find(a => a.outletId === entryOutletId && a.accountType === accountType)
    ?? accounts.find(a => a.outletId === entryOutletId && a.accountType !== '10kcash')
    ?? null;
};

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

// Returns today's date in YYYY-MM-DD format using IST (UTC+5:30) so the default
// is never off by one day for users in India regardless of local timezone.
const istToday = (): string => istDateString(0);

const ENTRY_TABLE_HEADERS = ['Date', 'Bill No', 'Store', 'Type', 'Paid From', 'Category', 'Description', 'Vendor', 'Submitted By', 'Status', 'Qty', 'Price/Unit', 'Amount'];
const ENTRY_TABLE_RIGHT_COLS = [10, 11, 12];
const ENTRY_TABLE_PAGE_SIZES = [10, 20, 30, 50];

// Module-level so pagination state survives parent re-renders while filters stay put
const EntriesDataTable = ({ rows }: { rows: (string | number)[][] }) => {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * pageSize;
  const pageRows = rows.slice(startIdx, startIdx + pageSize);
  return (
    <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl">
      <div className="overflow-x-auto rounded-t-2xl">
        <table className="w-full text-left text-xs" style={{ minWidth: 1050 }}>
          <thead>
            <tr className="border-b border-slate-100">
              {ENTRY_TABLE_HEADERS.map((h, i) => (
                <th key={h} className={`px-3 py-3 font-semibold text-slate-500 whitespace-nowrap ${ENTRY_TABLE_RIGHT_COLS.includes(i) ? 'text-right' : ''}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, ri) => (
              <tr key={startIdx + ri} className="border-b border-slate-50 last:border-0 hover:bg-indigo-50/40 transition-colors">
                {row.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2.5 whitespace-nowrap max-w-[240px] truncate ${ENTRY_TABLE_RIGHT_COLS.includes(ci) ? 'text-right font-semibold text-slate-800' : 'text-slate-600'}`}>
                    {ci === 12 && typeof cell === 'number' ? `₹${cell.toLocaleString('en-IN')}` : (cell === '' ? '—' : cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>Rows:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(parseInt(e.target.value)); setPage(0); }}
            className="h-8 bg-slate-50 border border-slate-200 rounded-lg px-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-400"
          >
            {ENTRY_TABLE_PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <p className="text-xs text-slate-400">
          {rows.length === 0 ? '0' : `${startIdx + 1}–${Math.min(startIdx + pageSize, rows.length)}`} of {rows.length}
        </p>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => setPage(p => Math.max(0, Math.min(p, totalPages - 1) - 1))}
            disabled={safePage === 0}
            className="h-8 px-3 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 rounded-lg text-xs font-semibold text-slate-600 transition-colors"
          >
            Prev
          </button>
          <button
            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={safePage >= totalPages - 1}
            className="h-8 px-3 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 rounded-lg text-xs font-semibold text-slate-600 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

const CrewTerminal: React.FC<{ user: User, profile: UserProfile }> = ({ user, profile }) => {
  const [activeMode, setActiveMode] = useState<'landing' | 'view' | 'add' | 'edit' | 'daily-sales' | 'transfer-10k' | 'record-waste'>('landing');
  const [entryType, setEntryType] = useState<'expense' | 'purchase'>('purchase');
  const [entries, setEntries] = useState<DailyCounterEntry[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [allBankAccounts, setAllBankAccounts] = useState<BankAccount[]>([]);
  // 10K transfer state
  const [transferAmount, setTransferAmount] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferSuccess, setTransferSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  // --- Filtering State ---
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | EntryStatus>('all');
  const [filterType, setFilterType] = useState<'all' | 'purchase' | 'expense'>('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterOutlet, setFilterOutlet] = useState('all');
  const [entriesViewMode, setEntriesViewMode] = useState<'cards' | 'table'>('cards');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [customStartDate, setCustomStartDate] = useState(istToday());
  const [customEndDate, setCustomEndDate] = useState(istToday());

  // Viewing detail state
  const [viewingEntry, setViewingEntry] = useState<DailyCounterEntry | null>(null);

  // Form State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<EntryStatus>('paid');
  const [paidFrom, setPaidFrom] = useState<'counter' | '10k'>('counter');
  const [date, setDate] = useState(istToday());
  const [outletId, setOutletId] = useState(profile.assignedOutlet || MASTER_OUTLETS[0].id);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [existingReceiptUrl, setExistingReceiptUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showProductCatalog, setShowProductCatalog] = useState(false);
  const [productCatalogEnabled, setProductCatalogEnabled] = useState(false);
  const [trackedConsumables, setTrackedConsumables] = useState<TrackedConsumable[]>([]);
  const [entriesLoadFailed, setEntriesLoadFailed] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');

  // Bill-builder state (purchase mode)
  const [billItems, setBillItems] = useState<BillItem[]>([]);
  const [billProductId, setBillProductId] = useState('');
  const [billQty, setBillQty] = useState('');
  const [billPrice, setBillPrice] = useState('');

  // Inline new-product form (crew can add a missing product without leaving the bill)
  const [showNewProductForm, setShowNewProductForm] = useState(false);
  const [npName, setNpName] = useState('');
  const [npCategory, setNpCategory] = useState('');
  const [npPrice, setNpPrice] = useState('');
  const [npUnit, setNpUnit] = useState('');
  const [npSaving, setNpSaving] = useState(false);

  // Custom categories (crew_categories collection), merged with the hardcoded lists
  const [customCategories, setCustomCategories] = useState<CrewCategory[]>([]);
  const [showNewCategoryForm, setShowNewCategoryForm] = useState(false);
  const [ncName, setNcName] = useState('');
  const [ncSaving, setNcSaving] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);

  const allCategories = useMemo(
    () => Array.from(new Set([...ALL_CREW_CATEGORIES, ...customCategories.map(c => c.name)])).sort(),
    [customCategories]
  );

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState('');
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showVendorForm, setShowVendorForm] = useState(false);
  const [editingVendorId, setEditingVendorId] = useState<string | null>(null);
  const [deletingVendorId, setDeletingVendorId] = useState<string | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  // Vendor form state (inside crew terminal)
  const [vName, setVName] = useState('');
  const [vAddress, setVAddress] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [vGst, setVGst] = useState('');
  const [vEmail, setVEmail] = useState('');
  const [vSaving, setVSaving] = useState(false);

  // --- Daily Sales Log State ---
  const [dsDate, setDsDate] = useState(istToday());
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
  const [dsLogs, setDsLogs] = useState<DailySalesLog[]>([]);
  const [dsLoadingLogs, setDsLoadingLogs] = useState(false);

  // --- Record Waste State ---
  const [servingOptions, setServingOptions] = useState<ServingOption[]>([]);
  const [wasteDate, setWasteDate] = useState(istToday());
  const [wasteOutletId, setWasteOutletId] = useState(profile.assignedOutlet || MASTER_OUTLETS[0].id);
  const [wasteNotes, setWasteNotes] = useState('');
  const [wasteItems, setWasteItems] = useState<WasteLineItem[]>([]);
  const [wasteSaving, setWasteSaving] = useState(false);
  const [wasteSuccess, setWasteSuccess] = useState(false);
  // line-item builder
  // value format: "servingOptionId::itemName::price"
  const [wSelItemKey, setWSelItemKey] = useState('');
  const [wQty, setWQty] = useState('1');
  const [wType, setWType] = useState<WasteType>('extra_demand');

  const fetchServingOptions = async () => {
    const ownerId = profile.ownerId || user.uid;
    const options = await getCachedCollection<ServingOption>('serving_options', ownerId);
    setServingOptions(options);
  };

  const resetWasteForm = () => {
    setWasteDate(istToday());
    setWasteOutletId(profile.assignedOutlet || MASTER_OUTLETS[0].id);
    setWasteNotes('');
    setWasteItems([]);
    setWasteSuccess(false);
    setWSelItemKey('');
    setWQty('1');
    setWType('extra_demand');
  };

  const addWasteLineItem = () => {
    if (!wSelItemKey || !wQty || parseFloat(wQty) <= 0) return;
    const [optId, itemName, priceStr] = wSelItemKey.split('::');
    const opt = servingOptions.find(o => o.id === optId);
    if (!opt) return;
    const qty = parseFloat(wQty);
    const price = parseFloat(priceStr);
    setWasteItems(prev => [...prev, {
      servingOptionId: opt.id!,
      servingOptionName: opt.name,
      itemName,
      quantity: qty,
      costPerUnit: price,
      totalCost: parseFloat((price * qty).toFixed(2)),
      wasteType: wType,
    }]);
    setWSelItemKey('');
    setWQty('1');
  };

  const handleWasteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (wasteItems.length === 0) return;
    setWasteSaving(true);
    try {
      const ownerId = profile.ownerId || user.uid;
      const totalCost = wasteItems.reduce((s, i) => s + i.totalCost, 0);
      const entry: WasteEntry = {
        userId: user.uid,
        ownerId,
        outletId: wasteOutletId,
        date: wasteDate,
        items: wasteItems,
        totalCost: parseFloat(totalCost.toFixed(2)),
        notes: wasteNotes,
        submittedBy: user.email || user.uid,
        createdAt: Date.now(),
      };
      await addDoc(collection(db, 'waste_entries'), entry);
      setWasteSuccess(true);
      setTimeout(() => { resetWasteForm(); setActiveMode('landing'); }, 1800);
    } catch (err) {
      console.error('Waste submit error:', err);
    } finally {
      setWasteSaving(false);
    }
  };

  const fetchEntries = async () => {
    setLoading(true);
    try {
      // Use ownerId if available (for crew), otherwise fallback to current user.uid (for admin)
      const ownerId = profile.ownerId || user.uid;

      // Fetch only this business's bank accounts (rules deny broader reads)
      const bankSnap = await getDocs(query(collection(db, 'bank_accounts'), where('userId', '==', ownerId)));
      const fetchedAllAccounts = bankSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as BankAccount));
      setAllBankAccounts(fetchedAllAccounts);

      // Filter by assigned outlet if available
      const filteredBankAccounts = profile.assignedOutlet
        ? fetchedAllAccounts.filter(acc => acc.outletId === profile.assignedOutlet)
        : fetchedAllAccounts;

      setBankAccounts(filteredBankAccounts);

      // Fetch this business's vendors (all vendor docs carry ownerId) — cached
      const vendorArr = await getCachedCollection<Vendor>('vendors', ownerId, 'ownerId');
      setVendors([...vendorArr].sort((a, b) => a.name.localeCompare(b.name)));

      let start: string;
      let end: string = istToday();
      const todayIst = istToday(); // IST-safe date string

      // All presets are computed in IST (istNow shifts UTC fields to IST wall-clock)
      switch (datePreset) {
        case 'yesterday':
          start = istDateString(-1);
          end = start;
          break;
        case 'this-week': {
          const nowIst = istNow();
          const day = nowIst.getUTCDay(); // 0 is Sun, 1 is Mon
          const daysSinceMonday = day === 0 ? 6 : day - 1;
          start = istDateString(-daysSinceMonday);
          break;
        }
        case 'last-week': {
          const nowIst = istNow();
          const day = nowIst.getUTCDay();
          const daysSinceMonday = day === 0 ? 6 : day - 1;
          start = istDateString(-daysSinceMonday - 7);
          end = istDateString(-daysSinceMonday - 1);
          break;
        }
        case 'this-month':
          start = todayIst.slice(0, 8) + '01'; // first day of current IST month
          break;
        case 'last-month': {
          // Whole previous calendar month. Day 0 of the following month gives its
          // last day (UTC-safe, so leap years and year rollover both hold).
          const [y, m] = todayIst.split('-').map(Number);
          const lastY = m === 1 ? y - 1 : y;
          const lastM = m === 1 ? 12 : m - 1;
          const mm = String(lastM).padStart(2, '0');
          const lastDay = new Date(Date.UTC(lastY, lastM, 0)).getUTCDate();
          start = `${lastY}-${mm}-01`;
          end = `${lastY}-${mm}-${String(lastDay).padStart(2, '0')}`;
          break;
        }
        case 'custom':
          start = customStartDate;
          end = customEndDate;
          break;
        default: // today
          start = todayIst;
          break;
      }

      // Date range is applied server-side so we only pay for the docs we show.
      // Crew query their own entries by userId; admins query the whole business
      // by ownerId, plus their own legacy pre-ownerId entries by userId.
      // Needs the (userId, date) and (ownerId, date) composite indexes.
      // Each leg is isolated. Sharing a Promise.all meant one failing query threw
      // away the other's results, and the catch below then left the PREVIOUS
      // fetch's rows on screen — stale data that looks like a filter result.
      const runEntries = async (field: 'ownerId' | 'userId', value: string) => {
        try {
          const snap = await getDocs(query(
            collection(db, 'crew_entries'),
            where(field, '==', value),
            where('date', '>=', start),
            where('date', '<=', end)
          ));
          return { docs: snap.docs, failed: false };
        } catch (err) {
          console.warn(`[CrewTerminal] crew_entries ${field} query failed:`, err);
          return { docs: [] as any[], failed: true };
        }
      };

      let docs: DailyCounterEntry[];
      let allFailed = false;
      if (profile.role === 'admin') {
        // ownerId is the BUSINESS owner, not necessarily this admin. Querying
        // user.uid here (the only place in this file that did) meant a delegated
        // admin saw none of their crew's entries, while Crew Reports — which uses
        // profile.ownerId — showed all of them.
        const [byOwner, byUser] = await Promise.all([
          runEntries('ownerId', ownerId),
          runEntries('userId', user.uid),
        ]);
        allFailed = byOwner.failed && byUser.failed;
        const seen = new Set<string>();
        docs = [...byOwner.docs, ...byUser.docs]
          .filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; })
          .map(d => ({ id: d.id, ...d.data() } as DailyCounterEntry));
      } else {
        const byUser = await runEntries('userId', user.uid);
        allFailed = byUser.failed;
        docs = byUser.docs.map(d => ({ id: d.id, ...d.data() } as DailyCounterEntry));
      }

      setEntriesLoadFailed(allFailed);
      setEntries(docs.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error("Fetch entries error:", err);
      // Never leave the previous period's rows on screen — an empty list with an
      // error is honest; stale rows look like a real (wrong) answer.
      setEntries([]);
      setEntriesLoadFailed(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const ownerId = profile.ownerId || user.uid;
    getDoc(doc(db, 'category_settings', ownerId))
      .then(snap => {
        if (!snap.exists()) return;
        setProductCatalogEnabled(snap.data().productCatalogEnabled === true);
        setTrackedConsumables(snap.data().trackedConsumables || []);
      })
      .catch(() => {});
  }, []);

  const loadCatalogProducts = async () => {
    try {
      const ownerId = profile.ownerId || user.uid;
      const snap = await getDocs(query(collection(db, 'products'), where('ownerId', '==', ownerId)));
      setCatalogProducts(
        snap.docs.map(d => ({ id: d.id, ...d.data() } as Product))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (err) {
      console.error('[Products] failed to load:', err);
    }
  };

  useEffect(() => { loadCatalogProducts(); }, []);

  useEffect(() => {
    const ownerId = profile.ownerId || user.uid;
    getCachedCollection<CrewCategory>('crew_categories', ownerId, 'ownerId')
      .then(cats => setCustomCategories(cats))
      .catch(err => console.error('[Categories] failed to load:', err));
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [user, datePreset, customStartDate, customEndDate]);

  useEffect(() => {
    // 'view' is already covered by the [user, datePreset, ...] effect and by the
    // explicit fetchEntries() after every submit/delete — no need to refetch here.
    if (activeMode === 'daily-sales') fetchDsLogs();
    if (activeMode === 'record-waste') fetchServingOptions();
  }, [activeMode]);

  useEffect(() => {
    const q = parseFloat(quantity);
    const p = parseFloat(pricePerUnit);
    if (q > 0 && p > 0) setAmount((q * p).toFixed(2));
  }, [quantity, pricePerUnit]);

  useEffect(() => { setSelectedProductId(''); setBillProductId(''); setBillQty(''); setBillPrice(''); setBillItems([]); setShowNewProductForm(false); }, [category]);

  useEffect(() => {
    if (!selectedProductId) return;
    const product = catalogProducts.find(p => p.id === selectedProductId);
    if (!product) return;
    setDescription(product.name);
    if (product.pricePerUnit != null) setPricePerUnit(product.pricePerUnit.toString());
    if (product.quantity != null) setQuantity(product.quantity.toString());
  }, [selectedProductId]);

  // Auto-fill bill item price when a product is selected in the bill builder
  useEffect(() => {
    if (!billProductId) { setBillPrice(''); setBillQty(''); return; }
    const product = catalogProducts.find(p => p.id === billProductId);
    if (!product) return;
    if (product.pricePerUnit != null) setBillPrice(product.pricePerUnit.toString());
    if (product.quantity != null) setBillQty(product.quantity.toString());
  }, [billProductId]);

  const billTotal = useMemo(() => billItems.reduce((s, i) => s + i.amount, 0), [billItems]);

  // Consumables (gas cylinders etc) are tracked by unit count, so an entry
  // without a quantity is useless for consumption reporting — require one.
  const activeConsumable = useMemo(() =>
    trackedConsumables.find(c =>
      c.active !== false && c.category.trim().toUpperCase() === category.trim().toUpperCase()
    ) || null,
  [trackedConsumables, category]);

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
    setQuantity(entry.quantity ? entry.quantity.toString() : '');
    setPricePerUnit(entry.pricePerUnit ? entry.pricePerUnit.toString() : '');
    setCategory(entry.category);
    setDescription(entry.description);
    setStatus(entry.status || 'paid');
    setPaidFrom(entry.paidFrom || 'counter');
    setDate(entry.date);
    setOutletId(entry.outletId);
    setExistingReceiptUrl(entry.receiptUrl || null);
    setReceiptPreview(entry.receiptUrl || null);
    setSelectedVendorId(entry.vendorId || '');
    setSelectedProductId('');
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
    const ownerId = profile.ownerId || user.uid;

    // Atomic per-outlet-per-day counter: 1 read + 1 write instead of scanning all
    // crew_entries, and concurrent submissions can't mint the same number.
    const counterRef = doc(db, 'bill_counters', `${ownerId}_${storeCode}_${dateCode}`);
    const seqNum = await runTransaction(db, async (txn) => {
      const counterSnap = await txn.get(counterRef);
      const next = (counterSnap.exists() ? (counterSnap.data().seq || 0) : 0) + 1;
      txn.set(counterRef, { userId: ownerId, seq: next, updatedAt: Date.now() }, { merge: true });
      return next;
    });
    const seq = seqNum.toString().padStart(3, '0');

    return `${prefix}-${storeCode}-${dateCode}-${seq}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hasBillItems = entryType === 'purchase' && billItems.length > 0;
    if (!hasBillItems && !amount) return;
    if (!category) return;

    // Bill-builder lines already enforce qty > 0, so only the simple form needs this
    if (activeConsumable && !hasBillItems && !(parseFloat(quantity) > 0)) {
      alert(`Enter how many ${activeConsumable.unitLabel}s this covers — ${activeConsumable.label} is tracked by unit.`);
      return;
    }

    // Prevent cash expense if it would overdraw the selected source account
    if (entryType === 'expense' && status === 'paid' && expenseSourceAccount) {
      const parsedAmt = parseFloat(amount) || 0;
      if (parsedAmt - editOldImpact > expenseSourceAccount.balance) return;
    }

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

      // For purchases with bill items, use the bill total; otherwise use the manual amount
      const finalAmount = (entryType === 'purchase' && billItems.length > 0)
        ? billTotal
        : parseFloat(amount);
      const finalDescription = (entryType === 'purchase' && billItems.length > 0)
        ? billItems.map(i => i.productName).join(', ')
        : description;

      // On edit, keep the original author so the entry stays visible in the
      // submitter's own list (admins can edit crew entries)
      const editedEntry = !isNew ? entries.find(e => e.id === editingId) : undefined;
      const entryData: any = {
        userId: editedEntry?.userId || user.uid,
        ownerId: editedEntry?.ownerId || profile.ownerId || user.uid,
        userName: editedEntry?.userName || user.email?.split('@')[0] || 'Unknown',
        outletId,
        type: entryType,
        amount: finalAmount,
        quantity: quantity ? parseFloat(quantity) : null,
        pricePerUnit: pricePerUnit ? parseFloat(pricePerUnit) : null,
        date,
        category,
        description: finalDescription,
        status,
        paidFrom: entryType === 'expense' ? paidFrom : null,
        receiptUrl: finalReceiptUrl || null,
        billNumber: billNumber || null,
        vendorId: selectedVendorId || null,
        vendorName: vendors.find(v => v.id === selectedVendorId)?.name || null,
        // Edit mode renders the simple form, so billItems is always empty there —
        // carry the original line items forward instead of nulling them.
        items: (entryType === 'purchase' && billItems.length > 0)
          ? billItems
          : (!isNew ? (editedEntry?.items || null) : null),
        createdAt: Date.now()
      };

      let savedEntryId: string | null = null;
      if (activeMode === 'edit' && editingId) {
        await updateDoc(doc(db, 'crew_entries', editingId), entryData);
        savedEntryId = editingId;
      } else {
        const ref = await addDoc(collection(db, 'crew_entries'), entryData);
        savedEntryId = ref.id;
      }

      // Deduct from the correct bank account based on payment type + pay-from source
      try {
        const ownerId = profile.ownerId || user.uid;
        const entrySource: 'counter' | '10k' = entryType === 'expense' ? paidFrom : 'counter';

        // Re-fetch live bank accounts to avoid stale React state
        const liveBankSnap = await getDocs(query(collection(db, 'bank_accounts'), where('userId', '==', ownerId)));
        const liveBankAccounts = liveBankSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as BankAccount));

        const isEdit = activeMode === 'edit' && editingId;
        const oldEntry = isEdit ? entries.find(e => e.id === editingId) : undefined;
        const oldImpact = oldEntry?.status === 'paid' ? oldEntry.amount : 0;
        const newImpact = status === 'paid' ? finalAmount : 0;

        // Old and new can hit different accounts when an edit changes the
        // pay-from source, outlet, or type — resolve each side separately
        const oldAcc = oldEntry
          ? resolveTargetAccount(liveBankAccounts, oldEntry.outletId, oldEntry.type, oldEntry.paidFrom || 'counter')
          : null;
        const newAcc = resolveTargetAccount(liveBankAccounts, outletId, entryType, entrySource);

        console.log('[Bank] outletId:', outletId, '| source:', entrySource, '| liveBankAccounts:', liveBankAccounts.map(a => `${a.outletId}/${a.accountType}/primary=${a.isPrimary}/id=${a.id}`), '| found:', newAcc?.id, '| oldAcc:', oldAcc?.id);

        if (!newAcc && newImpact !== 0) {
          alert(`⚠️ Entry saved, but no ${entrySource === '10k' ? '10K vault' : 'bank'} account found for outlet "${outletId}".\n\nAvailable accounts:\n${liveBankAccounts.map(a => `• ${a.name} (${a.outletId}/${a.accountType})`).join('\n') || 'none'}\n\nThe bank balance was NOT updated.`);
        }

        const sourceLabel = entryType === 'expense'
          ? (entrySource === '10k' ? '10K Cash Expense' : 'Cash Expense')
          : 'Digital Purchase';
        const now = Date.now();
        const applyMovement = async (acc: BankAccount, deduction: number) => {
          if (deduction === 0) return;
          // increment() is atomic — concurrent submissions can't lose a deduction
          await updateDoc(doc(db, 'bank_accounts', acc.id!), {
            balance: increment(-deduction),
            updatedAt: now,
          });
          await addDoc(collection(db, 'bank_transactions'), {
            userId: user.uid,
            ownerId,
            bankAccountId: acc.id!,
            date,
            description: `${sourceLabel}: ${category}${description ? ` — ${description}` : ''}`,
            amount: Math.abs(deduction),
            type: deduction > 0 ? 'debit' : 'credit',
            category: category.toUpperCase(),
            referenceNo: billNumber || `AUTO-${savedEntryId}`,
            isVerified: false,
            isReconciled: false,
            createdAt: now,
          });
        };

        if (oldAcc && newAcc && oldAcc.id === newAcc.id) {
          await applyMovement(newAcc, newImpact - oldImpact);
        } else {
          if (oldAcc) await applyMovement(oldAcc, -oldImpact); // refund the old account
          if (newAcc) await applyMovement(newAcc, newImpact);
        }
      } catch (bankErr: any) {
        console.error('[Bank] Deduction failed:', bankErr);
        alert(`⚠️ Purchase saved, but bank deduction failed.\n\nError: ${bankErr?.message || bankErr}\n\nPlease report this to your admin.`);
      }

      // Rebuild crew expense snapshot so all reporting reflects the current state of entries
      try {
        const isEdit = activeMode === 'edit' && editingId;
        if (isEdit) {
          const oldEntry = entries.find(e => e.id === editingId);
          // If outlet or month changed, also rebuild the old period's snapshot
          if (oldEntry && (oldEntry.status === 'paid' || status === 'paid')) {
            if (oldEntry && (oldEntry.outletId !== outletId || oldEntry.date.slice(0, 7) !== date.slice(0, 7))) {
              await rebuildExpenseSnapshot(oldEntry.outletId, oldEntry.date);
            }
            await rebuildExpenseSnapshot(outletId, date);
          }
        } else if (status === 'paid') {
          await rebuildExpenseSnapshot(outletId, date);
        }
      } catch (snapErr: any) {
        console.error('[Rebuild] FAILED:', snapErr);
        alert(`⚠️ Entry saved, but reporting sync failed.\n\nError: ${snapErr?.message || snapErr}\n\nPlease report this to support.`);
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
    setDsDate(istToday());
    setDsTotal('');
    setDsCash('');
    setDsCard('');
    setDsUpi('');
    setDsNotes('');
    setDsExistingId(null);
    setDsDuplicateWarning(false);
  };

  const fetchDsLogs = async () => {
    setDsLoadingLogs(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'daily_sales_logs'), where('userId', '==', user.uid), orderBy('date', 'desc'))
      );
      setDsLogs(snap.docs.map(d => ({ id: d.id, ...d.data() } as DailySalesLog)));
    } catch (err) {
      console.error('Error fetching daily sales logs:', err);
    } finally {
      setDsLoadingLogs(false);
    }
  };

  const handleDsEdit = (log: DailySalesLog) => {
    setDsDate(log.date);
    setDsTotal(log.totalNet.toString());
    setDsCash(log.cash.toString());
    setDsCard(log.card.toString());
    setDsUpi(log.upi.toString());
    setDsNotes(log.notes || '');
    setDsExistingId(log.id!);
    setDsDuplicateWarning(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        // Equality-only filter (no composite index needed); outlet checked client-side
        const dupQ = query(
          collection(db, 'daily_sales_logs'),
          where('userId', '==', user.uid),
          where('date', '==', dsDate)
        );
        const dupSnap = await getDocs(dupQ);
        const existing = dupSnap.docs.find(d => d.data().outletId === dsOutletId);
        if (existing) {
          setDsExistingId(existing.id);
          setDsDuplicateWarning(true);
          setDsSaving(false);
          return;
        }
      }

      const logData: Omit<DailySalesLog, 'id'> = {
        userId: user.uid,  // submitter's UID — satisfies security rules
        ownerId,           // admin's UID — used by SalesHub queries
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
        // Fetch old values to compute deltas before overwriting
        const oldSnap = await getDoc(doc(db, 'daily_sales_logs', dsExistingId));
        const old = oldSnap.exists() ? oldSnap.data() : { cash: 0, card: 0, upi: 0 };
        await updateDoc(doc(db, 'daily_sales_logs', dsExistingId), logData as any);

        // Apply balance deltas to primary bank accounts
        try {
          const bankQ = query(collection(db, 'bank_accounts'), where('userId', '==', ownerId));
          const bankSnap = await getDocs(bankQ);
          const primaryAccounts = bankSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as BankAccount))
            .filter((a: BankAccount) => a.outletId === dsOutletId && a.isPrimary);

          const cashAcc = primaryAccounts.find((a: BankAccount) => a.accountType === 'cash');
          const digitalAcc = primaryAccounts.find((a: BankAccount) => a.accountType === 'digital');
          const cashDelta = cash - (old.cash || 0);
          const cardDelta = card - (old.card || 0);
          const upiDelta = upi - (old.upi || 0);
          const digitalDelta = cardDelta + upiDelta;
          const now = Date.now();
          const routingOps: Promise<any>[] = [];

          if (cashAcc && cashDelta !== 0) {
            routingOps.push(updateDoc(doc(db, 'bank_accounts', cashAcc.id!), {
              balance: increment(cashDelta), updatedAt: now,
            }));
            routingOps.push(addDoc(collection(db, 'sales_ledger'), {
              bankAccountId: cashAcc.id!, bankAccountName: cashAcc.name,
              outletId: dsOutletId, userId: user.uid, ownerId,
              amount: cashDelta, channel: 'cash', sourceId: dsExistingId,
              description: `Correction: cash sales — ${dsDate}`, date: dsDate, createdAt: now,
            } as Omit<SalesLedgerEntry, 'id'>));
          }
          if (digitalAcc && digitalDelta !== 0) {
            routingOps.push(updateDoc(doc(db, 'bank_accounts', digitalAcc.id!), {
              balance: increment(digitalDelta), updatedAt: now,
            }));
            if (cardDelta !== 0) {
              routingOps.push(addDoc(collection(db, 'sales_ledger'), {
                bankAccountId: digitalAcc.id!, bankAccountName: digitalAcc.name,
                outletId: dsOutletId, userId: user.uid, ownerId,
                amount: cardDelta, channel: 'card', sourceId: dsExistingId,
                description: `Correction: card sales — ${dsDate}`, date: dsDate, createdAt: now,
              } as Omit<SalesLedgerEntry, 'id'>));
            }
            if (upiDelta !== 0) {
              routingOps.push(addDoc(collection(db, 'sales_ledger'), {
                bankAccountId: digitalAcc.id!, bankAccountName: digitalAcc.name,
                outletId: dsOutletId, userId: user.uid, ownerId,
                amount: upiDelta, channel: 'upi', sourceId: dsExistingId,
                description: `Correction: UPI sales — ${dsDate}`, date: dsDate, createdAt: now,
              } as Omit<SalesLedgerEntry, 'id'>));
            }
          }
          if (routingOps.length > 0) await Promise.all(routingOps);
        } catch (routingErr) {
          console.warn('Balance delta skipped:', routingErr);
        }
      } else {
        const ref = await addDoc(collection(db, 'daily_sales_logs'), logData);
        const savedLogId = ref.id;

        // Route to primary bank accounts — runs after the log is saved.
        // Wrapped in its own try-catch: a permissions failure here must not
        // block the crew member's submission.
        try {
          const bankQ = query(
            collection(db, 'bank_accounts'),
            where('userId', '==', ownerId)
          );
          const bankSnap = await getDocs(bankQ);
          const primaryAccounts = bankSnap.docs
            .map(d => ({ id: d.id, ...d.data() } as BankAccount))
            .filter((a: BankAccount) => a.outletId === dsOutletId && a.isPrimary);

          const cashAcc = primaryAccounts.find((a: BankAccount) => a.accountType === 'cash');
          const digitalAcc = primaryAccounts.find((a: BankAccount) => a.accountType === 'digital');
          const now = Date.now();
          const routingOps: Promise<any>[] = [];

          if (cashAcc && cash > 0) {
            routingOps.push(
              updateDoc(doc(db, 'bank_accounts', cashAcc.id!), {
                balance: increment(cash),
                updatedAt: now,
              })
            );
            routingOps.push(addDoc(collection(db, 'sales_ledger'), {
              bankAccountId: cashAcc.id!,
              bankAccountName: cashAcc.name,
              outletId: dsOutletId,
              userId: user.uid,
              ownerId,
              amount: cash,
              channel: 'cash',
              sourceId: savedLogId,
              description: `Daily cash sales — ${dsDate}`,
              date: dsDate,
              createdAt: now,
            } as Omit<SalesLedgerEntry, 'id'>));
          }

          if (digitalAcc && (card > 0 || upi > 0)) {
            routingOps.push(
              updateDoc(doc(db, 'bank_accounts', digitalAcc.id!), {
                balance: increment(card + upi),
                updatedAt: now,
              })
            );
            if (card > 0) {
              routingOps.push(addDoc(collection(db, 'sales_ledger'), {
                bankAccountId: digitalAcc.id!,
                bankAccountName: digitalAcc.name,
                outletId: dsOutletId,
                userId: user.uid,
                ownerId,
                amount: card,
                channel: 'card',
                sourceId: savedLogId,
                description: `Card sales — ${dsDate}`,
                date: dsDate,
                createdAt: now,
              } as Omit<SalesLedgerEntry, 'id'>));
            }
            if (upi > 0) {
              routingOps.push(addDoc(collection(db, 'sales_ledger'), {
                bankAccountId: digitalAcc.id!,
                bankAccountName: digitalAcc.name,
                outletId: dsOutletId,
                userId: user.uid,
                ownerId,
                amount: upi,
                channel: 'upi',
                sourceId: savedLogId,
                description: `UPI sales — ${dsDate}`,
                date: dsDate,
                createdAt: now,
              } as Omit<SalesLedgerEntry, 'id'>));
            }
          }

          if (routingOps.length > 0) await Promise.all(routingOps);
        } catch (routingErr) {
          // Log but don't surface — the daily sales log was saved successfully
          console.warn('Bank routing skipped (check Firestore rules for crew write access):', routingErr);
        }
      }

      setDsSuccess(true);
      fetchDsLogs();
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
    setQuantity('');
    setPricePerUnit('');
    setCategory('');
    setDescription('');
    setStatus('paid');
    setPaidFrom('counter');
    setReceiptFile(null);
    setReceiptPreview(null);
    setEditingId(null);
    setExistingReceiptUrl(null);
    setSelectedVendorId('');
    setSelectedProductId('');
    setBillItems([]);
    setBillProductId('');
    setBillQty('');
    setBillPrice('');
  };

  // Rebuilds the crew_* fields in expense_snapshots from scratch for the given outlet+period.
  // Called after every paid entry submit, edit, or delete — guarantees the snapshot is always
  // consistent with actual crew_entries in Firestore (no fragile increment/decrement logic).
  // The aggregation itself lives in crewSnapshotService so Data Catalog's resync shares it.
  const rebuildExpenseSnapshot = async (entryOutletId: string, entryDate: string) => {
    const ownerId = profile.ownerId || user.uid;
    const { snapId, entryCount } = await rebuildCrewSnapshot({
      ownerId,
      outletId: entryOutletId,
      date: entryDate,
      legacyUserId: user.uid, // pre-ownerId entries authored by this user
    });
    console.log('[Rebuild] DONE ✓', snapId, `(${entryCount} paid entries)`);
  };

  // Adds or renames a custom category and selects it in the form. New categories
  // start in the UNCATEGORIZED COGS bucket until the admin maps them in Category
  // Settings. Renames/deletes don't touch entries or products — they keep the old
  // category string.
  const handleNewCategorySave = async () => {
    const name = ncName.trim().toUpperCase();
    if (!name) return;
    const ownerId = profile.ownerId || user.uid;

    if (editingCategoryId) {
      const existing = customCategories.find(c => c.id === editingCategoryId);
      if (!existing) { setEditingCategoryId(null); return; }
      if (existing.name === name) { setNcName(''); setEditingCategoryId(null); return; }
      if (allCategories.includes(name)) { alert(`Category "${name}" already exists.`); return; }
      setNcSaving(true);
      try {
        await updateDoc(doc(db, 'crew_categories', editingCategoryId), { name });
        invalidateCached('crew_categories', ownerId);
        setCustomCategories(prev => prev.map(c => c.id === editingCategoryId ? { ...c, name } : c));
        if (category === existing.name) setCategory(name);
        setNcName('');
        setEditingCategoryId(null);
      } catch (err) {
        console.error('Error renaming category:', err);
        alert('Could not rename category. Check connection.');
      } finally {
        setNcSaving(false);
      }
      return;
    }

    if (allCategories.includes(name)) {
      setCategory(name);
      setNcName('');
      setShowNewCategoryForm(false);
      return;
    }
    setNcSaving(true);
    try {
      const data = { name, ownerId, userId: user.uid, createdAt: Date.now() };
      const ref = await addDoc(collection(db, 'crew_categories'), data);
      invalidateCached('crew_categories', ownerId);
      setCustomCategories(prev => [...prev, { ...data, id: ref.id }]);
      setCategory(name);
      setNcName('');
      setShowNewCategoryForm(false);
    } catch (err) {
      console.error('Error creating category:', err);
      alert('Could not create category. Check connection.');
    } finally {
      setNcSaving(false);
    }
  };

  const handleCategoryDelete = async (cat: CrewCategory) => {
    if (!confirm(`Delete category "${cat.name}"?\n\nExisting entries and products keep this category name; only the dropdown option is removed.`)) return;
    try {
      const ownerId = profile.ownerId || user.uid;
      await deleteDoc(doc(db, 'crew_categories', cat.id!));
      invalidateCached('crew_categories', ownerId);
      setCustomCategories(prev => prev.filter(c => c.id !== cat.id));
      if (category === cat.name) setCategory('');
      if (editingCategoryId === cat.id) { setEditingCategoryId(null); setNcName(''); }
    } catch (err) {
      console.error('Error deleting category:', err);
      alert('Could not delete category. Check connection.');
    }
  };

  const resetNewProductForm = () => {
    setNpName(''); setNpCategory(''); setNpPrice(''); setNpUnit('');
    setShowNewProductForm(false);
  };

  // Same doc shape as ProductCatalog.handleSave so admin and crew products are identical
  const handleNewProductSave = async () => {
    const cat = npCategory || category;
    if (!npName.trim() || !cat) return;
    setNpSaving(true);
    try {
      const ownerId = profile.ownerId || user.uid;
      const data = {
        name: npName.trim().toUpperCase(),
        category: cat,
        pricePerUnit: npPrice ? parseFloat(npPrice) : null,
        quantity: null,
        unit: npUnit.trim() || null,
        ownerId,
        userId: user.uid,
        createdAt: Date.now(),
      };
      const ref = await addDoc(collection(db, 'products'), data);
      setCatalogProducts(prev =>
        [...prev, { ...data, id: ref.id } as unknown as Product].sort((a, b) => a.name.localeCompare(b.name))
      );
      // Auto-select it in whichever form is active: the purchase bill builder,
      // or the expense/edit product picker (which auto-fills description + price)
      if (entryType === 'purchase' && activeMode !== 'edit') {
        if (cat === category) setBillProductId(ref.id);
      } else if (!category || cat === category) {
        setSelectedProductId(ref.id);
      }
      resetNewProductForm();
    } catch (err) {
      console.error('Error creating product:', err);
      alert('Could not create product. Check connection.');
    } finally {
      setNpSaving(false);
    }
  };

  const handleProductSelect = (product: Product) => {
    setDescription(product.name);
    setCategory(product.category);
    if (product.pricePerUnit != null) setPricePerUnit(product.pricePerUnit.toString());
    setShowProductCatalog(false);
  };

  const resetVendorForm = () => {
    setVName(''); setVAddress(''); setVPhone(''); setVGst(''); setVEmail('');
    setEditingVendorId(null); setShowVendorForm(false);
  };

  const handleVendorSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vName.trim()) return;
    setVSaving(true);
    try {
      const ownerId = profile.ownerId || user.uid;
      const data = {
        userId: user.uid, ownerId,
        name: vName.trim().toUpperCase(),
        address: vAddress.trim(), phone: vPhone.trim(),
        gst: vGst.trim().toUpperCase(), email: vEmail.trim().toLowerCase(),
        createdAt: Date.now(),
      };
      if (editingVendorId) {
        await updateDoc(doc(db, 'vendors', editingVendorId), data as any);
        setVendors(prev =>
          prev.map(v => v.id === editingVendorId ? { ...data, id: editingVendorId } as Vendor : v)
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } else {
        const ref = await addDoc(collection(db, 'vendors'), data);
        setVendors(prev => [...prev, { id: ref.id, ...data }].sort((a, b) => a.name.localeCompare(b.name)));
        setSelectedVendorId(ref.id);
      }
      invalidateCached('vendors', ownerId);
      resetVendorForm();
    } catch (err) { console.error(err); } finally { setVSaving(false); }
  };

  const handleVendorEdit = (v: Vendor) => {
    setEditingVendorId(v.id!);
    setVName(v.name); setVAddress(v.address || ''); setVPhone(v.phone || '');
    setVGst(v.gst || ''); setVEmail(v.email || '');
    setShowVendorForm(true);
  };

  const handleVendorDelete = async (id: string) => {
    setDeletingVendorId(id);
    try {
      await deleteDoc(doc(db, 'vendors', id));
      invalidateCached('vendors', profile.ownerId || user.uid);
      setVendors(prev => prev.filter(v => v.id !== id));
    } catch (err) { console.error(err); } finally { setDeletingVendorId(null); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    try {
      const entry = entries.find(e => e.id === id);
      await deleteDoc(doc(db, 'crew_entries', id));

      // Reverse the bank deduction if the entry was paid
      if (entry && entry.status === 'paid') {
        const ownerId = profile.ownerId || user.uid;
        const liveBankSnap = await getDocs(query(collection(db, 'bank_accounts'), where('userId', '==', ownerId)));
        const liveAccounts = liveBankSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
        const targetAcc = resolveTargetAccount(liveAccounts, entry.outletId, entry.type, entry.paidFrom || 'counter');
        if (targetAcc) {
          const now = Date.now();
          const safeBalance = (typeof targetAcc.balance === 'number' && !isNaN(targetAcc.balance)) ? targetAcc.balance : 0;
          await updateDoc(doc(db, 'bank_accounts', targetAcc.id!), {
            balance: increment(entry.amount),
            updatedAt: now,
          });
          await addDoc(collection(db, 'bank_transactions'), {
            userId: user.uid,
            ownerId,
            bankAccountId: targetAcc.id!,
            date: entry.date,
            description: `Reversal: ${entry.type === 'expense' ? (entry.paidFrom === '10k' ? '10K Cash Expense' : 'Cash Expense') : 'Digital Purchase'} deleted — ${entry.category}${entry.description ? ` — ${entry.description}` : ''}`,
            amount: entry.amount,
            type: 'credit',
            category: entry.category.toUpperCase(),
            referenceNo: entry.billNumber || `REV-${id}`,
            isVerified: false,
            isReconciled: false,
            createdAt: now,
          });
          // Keep in-memory balance in sync
          const updater = (a: BankAccount) => a.id === targetAcc.id ? { ...a, balance: safeBalance + entry.amount } : a;
          setAllBankAccounts(prev => prev.map(updater));
          setBankAccounts(prev => prev.map(updater));
        }

        // Rebuild snapshot — deleted entry is already gone from Firestore so rebuild gives correct totals
        try {
          await rebuildExpenseSnapshot(entry.outletId, entry.date);
        } catch (snapErr) {
          console.warn('Snapshot rebuild skipped:', snapErr);
        }
      }

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
      const matchesOutlet = filterOutlet === 'all' || e.outletId === filterOutlet;
      const matchesSearch = !searchTerm ||
        e.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        e.category.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesType && matchesStatus && matchesCategory && matchesOutlet && matchesSearch;
    });
  }, [entries, filterType, filterStatus, filterCategory, filterOutlet, searchTerm]);

  const entrySummary = useMemo(() => {
    const paid = filteredEntries.filter(e => e.status === 'paid').reduce((s, e) => s + e.amount, 0);
    const pending = filteredEntries.filter(e => e.status === 'pending').reduce((s, e) => s + e.amount, 0);
    return { paid, pending, total: paid + pending };
  }, [filteredEntries]);

  const entryTableRows = useMemo(() => filteredEntries.map(e => [
    e.date, e.billNumber || '', getOutletName(e.outletId),
    e.type === 'purchase' ? 'Online' : 'Cash',
    e.type === 'expense' ? (e.paidFrom === '10k' ? '10K Vault' : 'Counter') : '',
    e.category, e.description || '', e.vendorName || '', e.userName || '', e.status || 'paid',
    e.quantity != null ? e.quantity : '', e.pricePerUnit != null ? e.pricePerUnit : '', e.amount,
  ]), [filteredEntries]);

  const primaryCashAccount = useMemo(() => {
    const outlet = profile.assignedOutlet || dsOutletId;
    return bankAccounts.find(a => a.outletId === outlet && a.isPrimary && a.accountType === 'cash') ?? null;
  }, [bankAccounts, profile.assignedOutlet, dsOutletId]);

  const tenKAccount = useMemo(() => {
    const outlet = profile.assignedOutlet || dsOutletId;
    return allBankAccounts.find(a => a.outletId === outlet && a.accountType === '10kcash') ?? null;
  }, [allBankAccounts, profile.assignedOutlet, dsOutletId]);

  // Pay-from source accounts for the entry form's selected outlet (not the DS outlet)
  const counterFormAccount = useMemo(() =>
    allBankAccounts.find(a => a.outletId === outletId && a.isPrimary && a.accountType === 'cash')
      ?? allBankAccounts.find(a => a.outletId === outletId && a.accountType === 'cash')
      ?? null,
    [allBankAccounts, outletId]);
  const tenKFormAccount = useMemo(() =>
    allBankAccounts.find(a => a.outletId === outletId && a.accountType === '10kcash') ?? null,
    [allBankAccounts, outletId]);
  const expenseSourceAccount = paidFrom === '10k' ? tenKFormAccount : counterFormAccount;

  // Old entry's impact on the currently selected source — used by the overdraw
  // guard and warning so an edit doesn't double-count its own prior deduction
  const editOldImpact = useMemo(() => {
    if (!(activeMode === 'edit' && editingId)) return 0;
    const oldEntry = entries.find(en => en.id === editingId);
    if (!oldEntry || oldEntry.status !== 'paid' || oldEntry.type !== 'expense') return 0;
    if ((oldEntry.paidFrom || 'counter') !== paidFrom || oldEntry.outletId !== outletId) return 0;
    return oldEntry.amount;
  }, [activeMode, editingId, entries, paidFrom, outletId]);

  // If the selected outlet has no 10K vault, fall back to the counter
  useEffect(() => {
    if (allBankAccounts.length > 0 && paidFrom === '10k' && !tenKFormAccount) setPaidFrom('counter');
  }, [allBankAccounts, paidFrom, tenKFormAccount]);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(transferAmount);
    if (!amt || amt <= 0 || !primaryCashAccount || !tenKAccount) return;
    if (amt > primaryCashAccount.balance) return;

    setTransferring(true);
    try {
      const ownerId = profile.ownerId || user.uid;
      const now = Date.now();
      const today = istToday();
      const ref = `10K-${now}`;

      await Promise.all([
        updateDoc(doc(db, 'bank_accounts', primaryCashAccount.id!), {
          balance: increment(-amt), updatedAt: now,
        }),
        updateDoc(doc(db, 'bank_accounts', tenKAccount.id!), {
          balance: increment(amt), updatedAt: now,
        }),
        addDoc(collection(db, 'bank_transactions'), {
          userId: user.uid, ownerId, bankAccountId: primaryCashAccount.id!,
          date: today, description: `10K Transfer — moved to safe`,
          amount: amt, type: 'debit', referenceNo: ref,
          category: 'TRANSFER', isVerified: false, isReconciled: false, createdAt: now,
        }),
        addDoc(collection(db, 'bank_transactions'), {
          userId: user.uid, ownerId, bankAccountId: tenKAccount.id!,
          date: today, description: `10K Transfer — received from counter`,
          amount: amt, type: 'credit', referenceNo: ref,
          category: 'TRANSFER', isVerified: false, isReconciled: false, createdAt: now,
        }),
      ]);

      // Optimistically update local balances
      const updater = (a: BankAccount) => {
        if (a.id === primaryCashAccount.id) return { ...a, balance: a.balance - amt, updatedAt: now };
        if (a.id === tenKAccount.id) return { ...a, balance: a.balance + amt, updatedAt: now };
        return a;
      };
      setBankAccounts(prev => prev.map(updater));
      setAllBankAccounts(prev => prev.map(updater));

      setTransferSuccess(true);
      setTimeout(() => {
        setTransferSuccess(false);
        setTransferAmount('');
        setActiveMode('landing');
      }, 2000);
    } catch (err) {
      console.error(err);
      alert('Transfer failed. Check connection.');
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="animate-in fade-in duration-500 pb-24">

      {/* ── LANDING ─────────────────────────────────────────────── */}
      {activeMode === 'landing' ? (
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-6 py-10 gap-10">
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
          {/* 10K Transfer + Record Waste */}
          <div className="grid grid-cols-2 gap-5 w-full max-w-2xl">
            <button
              onClick={() => setActiveMode('transfer-10k')}
              className="h-28 bg-amber-500 active:scale-95 text-white rounded-[2.5rem] flex flex-col items-center justify-center gap-2 shadow-2xl shadow-amber-900/40 transition-transform border border-amber-400/20"
            >
              <Vault size={32} strokeWidth={1.5} />
              <div className="text-center px-3">
                <p className="text-base font-black uppercase tracking-tight leading-tight">10K Transfer</p>
                <p className="text-[10px] font-bold text-amber-200/80 mt-1 uppercase tracking-widest">Counter → Safe</p>
              </div>
            </button>

            <button
              onClick={() => { resetWasteForm(); setActiveMode('record-waste'); }}
              className="h-28 bg-rose-600 active:scale-95 text-white rounded-[2.5rem] flex flex-col items-center justify-center gap-2 shadow-2xl shadow-rose-900/40 transition-transform border border-rose-500/20"
            >
              <Trash2 size={32} strokeWidth={1.5} />
              <div className="text-center px-3">
                <p className="text-base font-black uppercase tracking-tight leading-tight">Record Waste</p>
                <p className="text-[10px] font-bold text-rose-200/80 mt-1 uppercase tracking-widest">Servings · Broken</p>
              </div>
            </button>
          </div>

          {/* Shortcuts row */}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => setShowVendorModal(true)}
              className="flex items-center gap-3 px-6 py-4 bg-slate-800/60 border border-slate-700/50 rounded-2xl text-slate-400 text-[11px] font-black uppercase tracking-widest hover:text-white hover:border-indigo-500/50 active:scale-95 transition-all"
            >
              <Store size={16} className="text-indigo-400" />
              Manage Vendors
            </button>
            {(profile.role === 'admin' || productCatalogEnabled) && (
              <button
                onClick={() => setShowProductCatalog(true)}
                className="flex items-center gap-3 px-6 py-4 bg-slate-800/60 border border-slate-700/50 rounded-2xl text-slate-400 text-[11px] font-black uppercase tracking-widest hover:text-white hover:border-indigo-500/50 active:scale-95 transition-all"
              >
                <Package size={16} className="text-indigo-400" />
                Products
              </button>
            )}
          </div>
        </div>

      /* ── ENTRIES LIST ──────────────────────────────────────────── */
      ) : activeMode === 'view' ? (
        <div className="space-y-4 px-1 pt-2">
          {/* Top nav bar */}
          <div className="flex items-center gap-3 bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm px-3 py-3">
            <button
              onClick={() => setActiveMode('landing')}
              className="flex items-center gap-2 h-11 px-4 bg-slate-100 hover:bg-slate-200 active:scale-95 rounded-xl text-slate-600 transition-all text-sm font-semibold shrink-0"
            >
              <ArrowLeft size={18} /> Home
            </button>
            <h2 className="flex-1 text-center text-sm font-bold text-slate-800 truncate">Purchases &amp; Expenses</h2>
            <button
              onClick={() => { resetForm(); setEntryType('purchase'); setActiveMode('add'); }}
              className="flex items-center gap-2 h-11 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-95 rounded-xl text-white text-sm font-semibold transition-all shadow-sm shadow-indigo-600/20 shrink-0"
            >
              <Plus size={18} /> New
            </button>
          </div>

          {/* Filter panel */}
          <div className="bg-white rounded-2xl ring-1 ring-slate-100 shadow-sm p-4 space-y-3.5">
            {/* Type + Status toggles + refresh */}
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                {(['all', 'purchase', 'expense'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`h-9 px-4 rounded-lg text-xs font-semibold transition-all active:scale-95 ${
                      filterType === t
                        ? t === 'expense' ? 'bg-rose-500 text-white shadow-sm' : 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {t === 'purchase' ? 'Online' : t === 'expense' ? 'Cash' : 'All'}
                  </button>
                ))}
              </div>

              <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                {(['all', 'paid', 'pending', 'cancelled'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`h-9 px-3.5 rounded-lg text-xs font-semibold capitalize transition-all active:scale-95 ${
                      filterStatus === s ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              <button onClick={fetchEntries} className="ml-auto h-9 w-9 flex items-center justify-center text-slate-400 hover:text-indigo-600 transition-colors shrink-0">
                <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>

            {/* Date presets */}
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {(['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month', 'custom'] as DatePreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => setDatePreset(p)}
                  className={`h-9 px-4 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-all active:scale-95 shrink-0 ${
                    datePreset === p ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {p.replace('-', ' ')}
                </button>
              ))}
            </div>

            {datePreset === 'custom' && (
              <div className="grid grid-cols-2 gap-3 animate-in slide-in-from-top-2 duration-300">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1 ml-0.5">From</label>
                  <input type="date" value={customStartDate} onChange={e => setCustomStartDate(e.target.value)} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-3.5 text-sm font-medium text-slate-700 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1 ml-0.5">To</label>
                  <input type="date" value={customEndDate} onChange={e => setCustomEndDate(e.target.value)} className="w-full h-11 bg-slate-50 border border-slate-200 rounded-xl px-3.5 text-sm font-medium text-slate-700 outline-none focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 transition-all" />
                </div>
              </div>
            )}

            {/* Search + Category */}
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search…"
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none pl-10 pr-4 rounded-xl text-sm font-medium text-slate-700 transition-all"
                />
              </div>
              <div className="relative">
                <ListFilter className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                <select
                  value={filterCategory}
                  onChange={e => setFilterCategory(e.target.value)}
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none pl-10 pr-8 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                >
                  <option value="all">All categories</option>
                  {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
              </div>
            </div>

            {/* Store filter — admins see every outlet's entries */}
            {profile.role === 'admin' && (
              <div className="relative">
                <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                <select
                  value={filterOutlet}
                  onChange={e => setFilterOutlet(e.target.value)}
                  className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none pl-10 pr-8 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                >
                  <option value="all">All stores</option>
                  {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
              </div>
            )}
          </div>

          {entriesLoadFailed && (
            <div className="flex items-start gap-3 p-4 bg-rose-50 border border-rose-100 rounded-2xl">
              <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-rose-900">Couldn't load entries</p>
                <p className="text-[11px] font-medium text-rose-800 mt-0.5">
                  This list is empty because the read failed, not because there is nothing to show.
                  Check the browser console for the Firestore error.
                </p>
              </div>
            </div>
          )}

          {/* Summary strip */}
          {!loading && filteredEntries.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-semibold text-emerald-600 mb-1">Paid</p>
                <p className="text-sm font-bold text-slate-900 tracking-tight">₹{entrySummary.paid.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-semibold text-amber-600 mb-1">Pending</p>
                <p className="text-sm font-bold text-slate-900 tracking-tight">₹{entrySummary.pending.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl px-4 py-3 text-center">
                <p className="text-[10px] font-semibold text-slate-500 mb-1">Total</p>
                <p className="text-sm font-bold text-slate-900 tracking-tight">₹{entrySummary.total.toLocaleString('en-IN')}</p>
              </div>
            </div>
          )}

          {/* View toggle */}
          {!loading && filteredEntries.length > 0 && (
            <div className="flex bg-slate-100 p-1 rounded-xl gap-1 w-fit">
              {([['cards', LayoutList, 'Cards'], ['table', Table2, 'Excel']] as const).map(([v, Icon, label]) => (
                <button
                  key={v}
                  onClick={() => setEntriesViewMode(v)}
                  className={`h-9 px-3.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all active:scale-95 ${
                    entriesViewMode === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          )}

          {/* Entries */}
          {loading ? (
            <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={36} /></div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-24 text-center bg-white border-2 border-dashed border-slate-200 rounded-2xl">
              <SearchX className="mx-auto text-slate-300 mb-3" size={44} />
              <p className="text-slate-400 font-medium text-sm">No matching entries</p>
            </div>
          ) : entriesViewMode === 'table' ? (
            <EntriesDataTable rows={entryTableRows} />
          ) : (
          <div className="space-y-2.5">
            {filteredEntries.map(entry => {
              const config = getStatusConfig(entry.status);
              const StatusIcon = config.icon;
              return (
                <div key={entry.id} className="bg-white ring-1 ring-slate-100 shadow-sm rounded-2xl flex items-stretch overflow-hidden active:scale-[0.995] transition-transform">
                  {/* Tappable main area */}
                  <button
                    onClick={() => setViewingEntry(entry)}
                    className="flex items-center gap-4 flex-1 text-left px-4 py-3 min-h-[64px]"
                  >
                    <div className={`p-3.5 rounded-xl shrink-0 ${entry.type === 'purchase' ? 'bg-indigo-50 text-indigo-600' : 'bg-rose-50 text-rose-600'}`}>
                      {entry.type === 'purchase' ? <ShoppingBag size={24} /> : <Receipt size={24} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-base font-bold text-slate-900 tracking-tight truncate">{entry.category}</p>
                        <span className={`shrink-0 px-2 py-0.5 rounded-md text-[9px] font-semibold ${config.bg} ${config.color}`}>
                          {config.label}
                        </span>
                        {entry.receiptUrl && <ImageIcon size={13} className="text-slate-400 shrink-0" />}
                      </div>
                      {entry.billNumber && (
                        <p className="text-[10px] font-medium text-slate-400 tracking-wide font-mono mb-0.5">{entry.billNumber}</p>
                      )}
                      {entry.items && entry.items.length > 0
                        ? <p className="text-xs font-medium text-slate-500 truncate">{entry.items.length} item{entry.items.length !== 1 ? 's' : ''}</p>
                        : entry.description && <p className="text-xs text-slate-400 truncate">{entry.description}</p>
                      }
                      {entry.vendorName && (
                        <p className="text-xs font-medium text-indigo-500 truncate mt-0.5">{entry.vendorName}</p>
                      )}
                      {profile.role === 'admin' && (
                        <p className="text-[10px] font-medium text-slate-400 truncate mt-0.5 flex items-center gap-1">
                          <MapPin size={10} className="shrink-0" /> {getOutletName(entry.outletId)}{entry.userName ? ` · ${entry.userName}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-center justify-center px-3 border-x border-slate-100">
                      <p className="text-[9px] font-medium text-slate-400 mb-0.5">Date</p>
                      <p className="text-xs font-semibold text-slate-700 tracking-wide text-center">{entry.date}</p>
                    </div>
                    <div className="text-right shrink-0 pl-3 pr-1">
                      <p className="text-lg font-bold text-slate-900 tracking-tight">₹{entry.amount.toLocaleString()}</p>
                    </div>
                  </button>

                  {/* Action buttons */}
                  <div className="flex items-stretch border-l border-slate-100">
                    <button
                      onClick={() => handleEdit(entry)}
                      className="w-12 flex items-center justify-center bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white active:bg-indigo-700 transition-all"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={() => entry.id && handleDelete(entry.id)}
                      className="w-12 flex items-center justify-center bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white active:bg-rose-700 transition-all"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          )}
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
                  : dsDuplicateWarning ? <><Edit2 size={30} /> Update Entry</>
                  : <><Plus size={30} /> Post Daily Sales</>}
              </button>

              {dsExistingId && (
                <button type="button" onClick={() => { resetDsForm(); }}
                  className="w-full py-4 text-slate-400 font-black uppercase text-sm tracking-widest"
                >
                  Cancel Edit
                </button>
              )}
            </form>

            {/* Past logs */}
            <div className="px-8 pb-10 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-100" />
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Past Submissions</p>
                <div className="h-px flex-1 bg-slate-100" />
              </div>
              {dsLoadingLogs ? (
                <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-slate-300" size={24} /></div>
              ) : dsLogs.length === 0 ? (
                <p className="text-center text-xs font-bold text-slate-300 uppercase tracking-widest py-6">No past submissions</p>
              ) : (
                <div className="space-y-2">
                  {dsLogs.map(log => (
                    <div key={log.id} className="flex items-center justify-between gap-4 bg-slate-50 border border-slate-100 rounded-2xl px-5 py-4">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-800">{log.date}</p>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          <span className="text-[10px] font-bold text-slate-500">Total ₹{log.totalNet.toLocaleString('en-IN')}</span>
                          {log.cash > 0 && <span className="text-[10px] font-bold text-slate-400">Cash ₹{log.cash.toLocaleString('en-IN')}</span>}
                          {log.card > 0 && <span className="text-[10px] font-bold text-slate-400">Card ₹{log.card.toLocaleString('en-IN')}</span>}
                          {log.upi > 0 && <span className="text-[10px] font-bold text-slate-400">UPI ₹{log.upi.toLocaleString('en-IN')}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDsEdit(log)}
                        className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 active:scale-95 transition-all"
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      /* ── 10K TRANSFER ────────────────────────────────────────────── */
      ) : activeMode === 'transfer-10k' ? (
        <div className="animate-in slide-in-from-right duration-300 px-1 pt-2">
          <div className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
            <header className="px-8 py-7 flex items-center justify-between bg-amber-500 text-white">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => { setTransferAmount(''); setActiveMode('landing'); }}
                  className="p-3.5 bg-white/15 rounded-2xl active:bg-white/30 transition-all"
                >
                  <ArrowLeft size={22} />
                </button>
                <div>
                  <h3 className="text-2xl font-black uppercase tracking-tight leading-none">10K Transfer</h3>
                  <p className="text-amber-100/70 text-[10px] font-bold uppercase tracking-widest mt-1.5">Counter Cash → 10K Safe</p>
                </div>
              </div>
              <div className="p-3.5 bg-white/20 rounded-2xl"><Vault size={30} /></div>
            </header>

            <div className="p-8 md:p-10 space-y-7">
              {/* Account balances */}
              {!primaryCashAccount || !tenKAccount ? (
                <div className="py-12 flex flex-col items-center gap-4 text-center">
                  <AlertCircle size={40} className="text-amber-400" />
                  <p className="font-black text-slate-800 uppercase tracking-tight">
                    {!primaryCashAccount ? 'No primary cash account found for this outlet.' : 'No 10K cash account found.'}
                  </p>
                  <p className="text-sm text-slate-400 font-medium leading-relaxed max-w-xs">
                    {!primaryCashAccount
                      ? 'Set a primary cash account for this outlet in Bank Accounts.'
                      : 'Create a cash bank account with "10K" in its name in Bank Accounts first.'}
                  </p>
                </div>
              ) : (
                <form onSubmit={handleTransfer} className="space-y-7">
                  {/* From / To cards */}
                  <div className="space-y-3">
                    <div className="bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-5 flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">From · Counter Cash</p>
                        <p className="text-base font-black text-slate-800 uppercase leading-tight truncate">{primaryCashAccount.name}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Balance</p>
                        <p className="text-2xl font-black text-slate-900 tracking-tighter">₹{primaryCashAccount.balance.toLocaleString('en-IN')}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-center">
                      <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border border-amber-200 rounded-full">
                        <ArrowRightLeft size={14} className="text-amber-500" />
                        <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest">Transfer to safe</span>
                      </div>
                    </div>

                    <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl px-6 py-5 flex items-center justify-between">
                      <div>
                        <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">To · 10K Safe</p>
                        <p className="text-base font-black text-slate-800 uppercase leading-tight truncate">{tenKAccount.name}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-[9px] font-black text-amber-500 uppercase tracking-widest mb-1">Balance</p>
                        <p className="text-2xl font-black text-amber-700 tracking-tighter">₹{tenKAccount.balance.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  </div>

                  {/* Amount input */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Transfer Amount (₹)</label>
                    <div className="relative">
                      <IndianRupee className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={28} />
                      <input
                        required
                        type="number"
                        step="0.01"
                        min="1"
                        value={transferAmount}
                        onChange={e => setTransferAmount(e.target.value)}
                        className="w-full bg-slate-50 border-2 border-slate-100 focus:border-amber-400 focus:ring-4 focus:ring-amber-400/10 outline-none pl-16 pr-8 py-6 rounded-[2rem] text-4xl font-black text-slate-900 transition-all"
                        placeholder="0.00"
                        autoFocus
                      />
                    </div>
                    {parseFloat(transferAmount) > 0 && parseFloat(transferAmount) > primaryCashAccount.balance && (
                      <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest ml-1 flex items-center gap-1.5">
                        <AlertTriangle size={12} /> Amount exceeds counter balance
                      </p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={transferring || transferSuccess || !parseFloat(transferAmount) || parseFloat(transferAmount) <= 0 || (!!primaryCashAccount && parseFloat(transferAmount) > primaryCashAccount.balance)}
                    className={`w-full py-7 rounded-[2rem] font-black uppercase text-xl tracking-wider shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-4 text-white disabled:opacity-40 ${transferSuccess ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  >
                    {transferring ? <Loader2 size={30} className="animate-spin" />
                      : transferSuccess ? <><CheckCircle2 size={30} /> Transferred!</>
                      : <><ArrowRightLeft size={30} /> Transfer ₹{parseFloat(transferAmount) > 0 ? parseFloat(transferAmount).toLocaleString('en-IN') : '—'}</>}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

      /* ── RECORD WASTE ─────────────────────────────────────────── */
      ) : activeMode === 'record-waste' ? (
        <div className="animate-in slide-in-from-right duration-300 px-1 pt-2">
          <div className="bg-white rounded-[2.5rem] shadow-2xl overflow-hidden">
            <header className="px-8 py-7 flex items-center justify-between text-white bg-rose-600">
              <div className="flex items-center gap-4">
                <button onClick={() => { setActiveMode('landing'); resetWasteForm(); }} className="p-3.5 bg-white/15 rounded-2xl active:bg-white/30 transition-all">
                  <ArrowLeft size={22} />
                </button>
                <div>
                  <h3 className="text-2xl font-black uppercase tracking-tight leading-none">Record Waste</h3>
                  <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mt-1.5">Serving materials used beyond billing</p>
                </div>
              </div>
            </header>

            <form onSubmit={handleWasteSubmit} className="p-8 space-y-7">

              {/* Outlet + Date */}
              <div className="grid grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Outlet</label>
                  {profile.assignedOutlet ? (
                    <div className="h-14 bg-slate-50 border-2 border-slate-100 rounded-2xl flex items-center px-5">
                      <MapPin size={16} className="text-slate-300 mr-3 shrink-0" />
                      <span className="text-sm font-black text-slate-700 uppercase">{getOutletName(wasteOutletId)}</span>
                    </div>
                  ) : (
                    <div className="relative">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                      <select value={wasteOutletId} onChange={e => setWasteOutletId(e.target.value)}
                        className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-rose-400 outline-none pl-10 pr-8 rounded-2xl text-sm font-black text-slate-700 appearance-none uppercase transition-all"
                      >
                        {MASTER_OUTLETS.filter(o => o.id !== 'GLOBAL').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                    <input required type="date" value={wasteDate} onChange={e => setWasteDate(e.target.value)}
                      className="w-full h-14 bg-slate-50 border-2 border-slate-100 outline-none pl-10 pr-4 rounded-2xl text-sm font-bold text-slate-700 appearance-none"
                    />
                  </div>
                </div>
              </div>

              {/* Line-item builder */}
              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Add Serving Material</label>
                <div className="bg-slate-50 border-2 border-slate-100 rounded-3xl p-5 space-y-4">
                  {/* Waste type toggle */}
                  <div className="flex bg-white p-1 rounded-2xl border-2 border-slate-100 gap-2">
                    {(['extra_demand', 'broken'] as WasteType[]).map(t => (
                      <button key={t} type="button" onClick={() => setWType(t)}
                        className={`flex-1 h-11 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 border ${
                          wType === t
                            ? t === 'broken' ? 'bg-orange-500/10 text-orange-600 border-orange-200' : 'bg-rose-500/10 text-rose-600 border-rose-200'
                            : 'bg-white border-slate-100 text-slate-400'
                        }`}
                      >
                        {t === 'extra_demand' ? 'Extra Demand' : 'Broken on Unpack'}
                      </button>
                    ))}
                  </div>

                  {/* Individual item select — flat deduplicated list */}
                  <div className="relative">
                    <select value={wSelItemKey} onChange={e => setWSelItemKey(e.target.value)}
                      className="w-full bg-white border-2 border-slate-100 focus:border-rose-400 outline-none px-5 py-3.5 rounded-2xl text-sm font-black text-slate-700 appearance-none uppercase transition-all"
                    >
                      <option value="">-- Select item --</option>
                      {(() => {
                        const seen = new Set<string>();
                        return servingOptions.flatMap(o =>
                          o.items
                            .filter(item => {
                              const key = item.name.toUpperCase();
                              if (seen.has(key)) return false;
                              seen.add(key);
                              return true;
                            })
                            .map(item => (
                              <option key={`${o.id}::${item.name}`} value={`${o.id}::${item.name}::${item.price}`}>
                                {item.name} — ₹{item.price}
                              </option>
                            ))
                        );
                      })()}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                  </div>

                  {/* Quantity stepper + Add */}
                  <div className="flex gap-3">
                    <button type="button"
                      onClick={() => setWQty(q => String(Math.max(1, parseInt(q || '1') - 1)))}
                      className="w-14 shrink-0 bg-white border-2 border-slate-100 active:bg-slate-100 rounded-2xl text-2xl font-black text-slate-600 flex items-center justify-center transition-all active:scale-95"
                    >−</button>
                    <input
                      type="number" min="1" step="1" value={wQty}
                      onChange={e => setWQty(String(Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-0 flex-1 bg-white border-2 border-slate-100 focus:border-rose-400 outline-none px-3 py-3.5 rounded-2xl text-2xl font-black text-slate-900 text-center transition-all"
                    />
                    <button type="button"
                      onClick={() => setWQty(q => String(parseInt(q || '1') + 1))}
                      className="w-14 shrink-0 bg-white border-2 border-slate-100 active:bg-slate-100 rounded-2xl text-2xl font-black text-slate-600 flex items-center justify-center transition-all active:scale-95"
                    >+</button>
                    <button type="button" onClick={addWasteLineItem}
                      disabled={!wSelItemKey}
                      className="px-7 py-3.5 bg-rose-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest disabled:opacity-40 active:scale-95 transition-all flex items-center gap-2 shadow-lg shadow-rose-100"
                    >
                      <Plus size={16} /> Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Waste item list */}
              {wasteItems.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Items to Record</p>
                  {wasteItems.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-3 bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-3.5">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-slate-900 uppercase truncate">{item.itemName}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] font-bold text-slate-400 truncate">{item.servingOptionName}</span>
                          <span className="text-[10px] font-bold text-slate-500">{item.quantity} × ₹{item.costPerUnit}</span>
                          <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${item.wasteType === 'broken' ? 'bg-orange-100 text-orange-600' : 'bg-rose-100 text-rose-600'}`}>
                            {item.wasteType === 'extra_demand' ? 'Extra Demand' : 'Broken'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className="text-sm font-black text-slate-900">₹{item.totalCost.toLocaleString('en-IN')}</p>
                        <button type="button" onClick={() => setWasteItems(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors rounded-xl"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {/* Total */}
                  <div className="flex items-center justify-between px-5 py-4 bg-rose-50 border-2 border-rose-100 rounded-2xl mt-1">
                    <p className="text-[10px] font-black text-rose-600 uppercase tracking-widest">Total Waste Cost</p>
                    <p className="text-xl font-black text-rose-700">₹{wasteItems.reduce((s, i) => s + i.totalCost, 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Notes (Optional)</label>
                <textarea value={wasteNotes} onChange={e => setWasteNotes(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-100 focus:border-rose-400 outline-none px-6 py-5 rounded-2xl text-sm font-medium text-slate-600 resize-none h-20"
                  placeholder="Any context about the waste…"
                />
              </div>

              <button
                disabled={wasteSaving || wasteSuccess || wasteItems.length === 0}
                className={`w-full py-7 rounded-[2rem] font-black uppercase text-xl tracking-wider shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-4 text-white disabled:opacity-40 ${wasteSuccess ? 'bg-emerald-500' : 'bg-rose-600'}`}
              >
                {wasteSaving ? <Loader2 size={30} className="animate-spin" />
                  : wasteSuccess ? <><CheckCircle2 size={30} /> Recorded!</>
                  : <><Trash2 size={28} /> Submit Waste · ₹{wasteItems.reduce((s, i) => s + i.totalCost, 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</>}
              </button>
            </form>
          </div>
        </div>

      /* ── ADD / EDIT FORM ───────────────────────────────────────── */
      ) : (
        <div className="animate-in slide-in-from-right duration-300 px-1 pt-2">
          <div className="bg-white rounded-[2rem] shadow-xl ring-1 ring-slate-100 overflow-hidden">
            <header className={`px-7 py-6 flex items-center justify-between text-white ${entryType === 'purchase' ? 'bg-indigo-600' : 'bg-rose-500'}`}>
              <div className="flex items-center gap-3.5">
                <button
                  onClick={() => { setActiveMode('view'); resetForm(); }}
                  className="p-2.5 bg-white/15 rounded-xl hover:bg-white/25 active:bg-white/30 transition-colors"
                >
                  <ArrowLeft size={20} />
                </button>
                <div>
                  <h3 className="text-xl font-bold tracking-tight leading-none">
                    {activeMode === 'edit' ? 'Edit entry' : entryType === 'purchase' ? 'New purchase' : 'New expense'}
                  </h3>
                  <p className="text-white/70 text-xs font-medium mt-1">
                    {entryType === 'purchase' ? 'Online / digital payment' : 'Cash payment'}
                  </p>
                </div>
              </div>
              <div className="p-3 bg-white/15 rounded-xl">
                {entryType === 'purchase' ? <ShoppingBag size={26} /> : <Receipt size={26} />}
              </div>
            </header>

            <form onSubmit={handleSubmit} className="p-7 md:p-8 space-y-6">
              {/* Payment type toggle */}
              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1.5 rounded-2xl">
                <button
                  type="button" onClick={() => setEntryType('purchase')}
                  className={`flex items-center justify-center gap-2 h-12 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${entryType === 'purchase' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <ShoppingBag size={18} /> Online
                </button>
                <button
                  type="button" onClick={() => setEntryType('expense')}
                  className={`flex items-center justify-center gap-2 h-12 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${entryType === 'expense' ? 'bg-rose-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  <Receipt size={18} /> Cash
                </button>
              </div>

              {/* ── PURCHASE BILL BUILDER ───────────────────────────── */}
              {entryType === 'purchase' && activeMode !== 'edit' ? (
                <>
                  {/* Vendor */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-0.5">Vendor <span className="text-slate-300">· optional</span></label>
                    <div className="flex gap-2.5">
                      <div className="relative flex-1">
                        <Store className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={17} />
                        <select
                          value={selectedVendorId} onChange={e => setSelectedVendorId(e.target.value)}
                          className="w-full h-12 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none pl-11 pr-9 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                        >
                          <option value="">No vendor</option>
                          {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                      </div>
                      <button type="button" onClick={() => setShowVendorModal(true)} className="h-12 w-12 flex items-center justify-center bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 active:scale-95 transition-all shrink-0">
                        <Plus size={20} />
                      </button>
                    </div>
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-0.5">Category</label>
                    <div className="flex gap-2.5">
                      <div className="relative flex-1">
                        <select
                          required value={category} onChange={e => setCategory(e.target.value)}
                          className="w-full h-12 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 pr-10 rounded-xl text-sm font-semibold text-slate-700 appearance-none transition-all"
                        >
                          <option value="">Select category</option>
                          {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                        </select>
                        <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                      </div>
                      {profile.role === 'admin' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (showNewCategoryForm) { setNcName(''); setEditingCategoryId(null); setShowNewCategoryForm(false); }
                            else setShowNewCategoryForm(true);
                          }}
                          className={`h-12 w-12 flex items-center justify-center rounded-xl shrink-0 active:scale-95 transition-all ${showNewCategoryForm ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}
                          title={showNewCategoryForm ? 'Cancel new category' : 'Add new category'}
                        >
                          {showNewCategoryForm ? <X size={18} /> : <Plus size={20} />}
                        </button>
                      )}
                    </div>
                    {/* Inline category manager (admin only) — add, rename, delete custom categories */}
                    {profile.role === 'admin' && showNewCategoryForm && (
                      <div className="mt-2.5 rounded-xl border border-indigo-200 bg-white p-3 space-y-2.5">
                        {editingCategoryId && (
                          <p className="text-[11px] font-semibold text-amber-600">
                            Renaming "{customCategories.find(c => c.id === editingCategoryId)?.name}"
                          </p>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text" value={ncName} onChange={e => setNcName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleNewCategorySave(); } }}
                            placeholder={editingCategoryId ? 'New name' : 'New category name'}
                            autoFocus
                            className="flex-1 h-12 bg-slate-50 border border-indigo-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-sm font-semibold text-slate-800 uppercase transition-all"
                          />
                          <button
                            type="button"
                            disabled={ncSaving || !ncName.trim()}
                            onClick={handleNewCategorySave}
                            className="h-12 px-5 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-indigo-700 active:scale-[0.98] transition-all shrink-0"
                          >
                            {ncSaving ? <Loader2 size={16} className="animate-spin" /> : <><Check size={16} /> {editingCategoryId ? 'Rename' : 'Save'}</>}
                          </button>
                        </div>
                        {customCategories.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[11px] font-medium text-slate-400">Your categories</p>
                            {[...customCategories].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                              <div key={c.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-100 rounded-lg pl-3 pr-1.5 py-1.5">
                                <p className="text-xs font-semibold text-slate-700 truncate">{c.name}</p>
                                <div className="flex items-center shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => { setEditingCategoryId(c.id!); setNcName(c.name); }}
                                    className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                                    title="Rename"
                                  >
                                    <Edit2 size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCategoryDelete(c)}
                                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                                    title="Delete"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Product + Qty + Price + Add */}
                  {category && (
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4 space-y-3.5">
                      <p className="text-xs font-semibold text-indigo-600">Add item to bill</p>
                      {/* Product picker */}
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Package className="absolute left-3.5 top-1/2 -translate-y-1/2 text-indigo-300 pointer-events-none" size={16} />
                          {(() => {
                            const catProducts = catalogProducts.filter(p => p.category === category);
                            return (
                              <select
                                value={billProductId} onChange={e => setBillProductId(e.target.value)}
                                className="w-full h-11 bg-white border border-indigo-100 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none pl-10 pr-9 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                              >
                                {catProducts.length === 0
                                  ? <option value="">No products in this category</option>
                                  : <>
                                      <option value="">Select product</option>
                                      {catProducts.map(p => (
                                        <option key={p.id} value={p.id!}>
                                          {p.name}{p.pricePerUnit != null ? ` — ₹${p.pricePerUnit}${p.unit ? `/${p.unit}` : ''}` : ''}
                                        </option>
                                      ))}
                                    </>
                                }
                              </select>
                            );
                          })()}
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-300 pointer-events-none" size={15} />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (showNewProductForm) { resetNewProductForm(); }
                            else { setNpCategory(category); setShowNewProductForm(true); }
                          }}
                          className={`h-11 w-11 flex items-center justify-center rounded-xl shrink-0 active:scale-95 transition-all ${showNewProductForm ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                          title={showNewProductForm ? 'Cancel new product' : 'Add new product'}
                        >
                          {showNewProductForm ? <X size={18} /> : <Plus size={18} />}
                        </button>
                      </div>

                      {/* Inline new-product form */}
                      {showNewProductForm && (
                        <div className="rounded-xl border border-indigo-200 bg-white p-3.5 space-y-3">
                          <p className="text-xs font-semibold text-indigo-600">New product</p>
                          <input
                            type="text" value={npName} onChange={e => setNpName(e.target.value)}
                            placeholder="Product name"
                            autoFocus
                            className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-sm font-semibold text-slate-800 uppercase transition-all"
                          />
                          <div className="relative">
                            <select
                              value={npCategory} onChange={e => setNpCategory(e.target.value)}
                              className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 pr-9 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                            >
                              {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <input
                              type="number" step="0.01" min="0"
                              value={npPrice} onChange={e => setNpPrice(e.target.value)}
                              placeholder="Price / unit (₹)"
                              className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-sm font-semibold text-slate-800 transition-all"
                            />
                            <input
                              type="text" value={npUnit} onChange={e => setNpUnit(e.target.value)}
                              placeholder="Unit (kg, pc…)"
                              className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-sm font-medium text-slate-700 transition-all"
                            />
                          </div>
                          {npCategory && npCategory !== category && (
                            <p className="text-[11px] text-amber-600 font-medium">
                              This product will be saved under {npCategory} — switch the bill's category to see it here.
                            </p>
                          )}
                          <button
                            type="button"
                            disabled={npSaving || !npName.trim() || !(npCategory || category)}
                            onClick={handleNewProductSave}
                            className="w-full h-11 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-indigo-700 active:scale-[0.98] transition-all"
                          >
                            {npSaving ? <Loader2 size={16} className="animate-spin" /> : <><Check size={16} /> Save product</>}
                          </button>
                        </div>
                      )}
                      {/* Qty + Price */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-indigo-500/80 mb-1 ml-0.5">Quantity</label>
                          <input
                            type="number" step="0.01" min="0"
                            value={billQty} onChange={e => setBillQty(e.target.value)}
                            placeholder="0"
                            className="w-full h-11 bg-white border border-indigo-100 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-base font-semibold text-slate-900 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-indigo-500/80 mb-1 ml-0.5">Price / unit (₹)</label>
                          <input
                            type="number" step="0.01" min="0"
                            value={billPrice} onChange={e => setBillPrice(e.target.value)}
                            placeholder="0.00"
                            className="w-full h-11 bg-white border border-indigo-100 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-base font-semibold text-slate-900 transition-all"
                          />
                        </div>
                      </div>
                      {/* Subtotal preview */}
                      {parseFloat(billQty) > 0 && parseFloat(billPrice) > 0 && (
                        <p className="text-sm font-semibold text-indigo-600 ml-0.5">
                          Subtotal · ₹{(parseFloat(billQty) * parseFloat(billPrice)).toLocaleString('en-IN')}
                        </p>
                      )}
                      {/* Add to Bill button */}
                      <button
                        type="button"
                        disabled={!billProductId || !(parseFloat(billQty) > 0) || !(parseFloat(billPrice) > 0)}
                        onClick={() => {
                          const product = catalogProducts.find(p => p.id === billProductId);
                          if (!product) return;
                          const qty = parseFloat(billQty);
                          const price = parseFloat(billPrice);
                          setBillItems(prev => [...prev, {
                            productId: billProductId,
                            productName: product.name,
                            quantity: qty,
                            pricePerUnit: price,
                            amount: parseFloat((qty * price).toFixed(2)),
                          }]);
                          setBillProductId('');
                          setBillQty('');
                          setBillPrice('');
                        }}
                        className="w-full h-11 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-indigo-700 active:scale-[0.98] transition-all"
                      >
                        <Plus size={16} /> Add to bill
                      </button>
                    </div>
                  )}

                  {/* Bill items list */}
                  {billItems.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-slate-500 ml-0.5">Bill items</p>
                      {billItems.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{item.productName}</p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {item.quantity} × ₹{item.pricePerUnit.toLocaleString('en-IN')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <p className="text-sm font-bold text-slate-900">₹{item.amount.toLocaleString('en-IN')}</p>
                            <button
                              type="button"
                              onClick={() => setBillItems(prev => prev.filter((_, i) => i !== idx))}
                              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                      {/* Bill total */}
                      <div className="flex items-center justify-between px-4 py-3.5 bg-indigo-600 rounded-xl mt-1">
                        <p className="text-xs font-medium text-indigo-200">{billItems.length} item{billItems.length !== 1 ? 's' : ''}</p>
                        <p className="text-lg font-bold text-white">₹{billTotal.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                  )}

                  {/* Status */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-0.5">Payment status</label>
                    <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1.5 rounded-2xl">
                      {(['paid', 'pending', 'cancelled'] as EntryStatus[]).map((s) => {
                        const isActive = status === s;
                        const cfg = STATUS_CONFIG[s];
                        return (
                          <button key={s} type="button" onClick={() => setStatus(s)}
                            className={`h-11 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] ${isActive ? `${cfg.bg} ${cfg.color} shadow-sm` : 'text-slate-500 hover:text-slate-700'}`}
                          >
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Date */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-0.5">Date</label>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={17} />
                      <input required type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="w-full h-12 bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none pl-11 pr-4 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                      />
                    </div>
                  </div>

                  {/* Note */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-0.5">Note <span className="text-slate-300">· optional</span></label>
                    <textarea
                      value={description} onChange={e => setDescription(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 py-3.5 rounded-xl text-sm text-slate-600 resize-none h-20 transition-all"
                      placeholder="Any additional notes…"
                    />
                  </div>

                  {/* Receipt photo */}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-0.5">Receipt photo <span className="text-slate-300">· optional</span></label>
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-200 rounded-2xl p-7 flex flex-col items-center justify-center cursor-pointer hover:border-indigo-300 hover:bg-slate-50/60 active:bg-slate-50 transition-all relative overflow-hidden">
                      {receiptPreview ? (
                        <>
                          <img src={receiptPreview} alt="Receipt" className="absolute inset-0 w-full h-full object-cover opacity-15" />
                          <div className="relative z-10 flex flex-col items-center gap-2">
                            <ImageIcon size={38} className="text-indigo-600" />
                            <p className="text-sm font-semibold text-slate-700">Change photo</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <Camera size={38} className="text-slate-300 mb-1.5" />
                          <p className="text-sm font-medium text-slate-500">Tap to capture or upload</p>
                        </>
                      )}
                      <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" capture="environment" className="hidden" />
                    </div>
                  </div>

                  <button
                    disabled={saving || success || billItems.length === 0 || !category}
                    className={`w-full py-5 rounded-2xl font-bold text-lg tracking-tight shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.99] disabled:opacity-40 disabled:shadow-none flex items-center justify-center gap-3 text-white ${success ? 'bg-emerald-500' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                  >
                    {saving ? <Loader2 size={26} className="animate-spin" />
                      : success ? <><CheckCircle2 size={26} /> Submitted!</>
                      : <><Plus size={26} /> Submit bill · ₹{billTotal.toLocaleString('en-IN')}</>}
                  </button>
                </>
              ) : (
                <>
                  {/* ── EXPENSE FORM (or edit mode) ─────────────────── */}
                  {(entryType === 'expense' || activeMode === 'edit') && (
                    <div className="space-y-4">
                      {/* Vendor */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Vendor (Optional)</label>
                        <div className="relative">
                          <Store className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                          <select value={selectedVendorId} onChange={e => setSelectedVendorId(e.target.value)}
                            className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none pl-12 pr-8 rounded-2xl text-sm font-bold text-slate-700 appearance-none uppercase transition-all"
                          >
                            <option value="">-- No Vendor --</option>
                            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                        </div>
                      </div>
                      {/* Product — auto-fills description, price, qty */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Product (Optional)</label>
                        <div className="flex gap-2.5">
                          <div className="relative flex-1">
                            <Package className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                            <select
                              value={selectedProductId}
                              onChange={e => setSelectedProductId(e.target.value)}
                              className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none pl-12 pr-8 rounded-2xl text-sm font-bold text-slate-700 appearance-none uppercase transition-all"
                            >
                              <option value="">-- Select Product --</option>
                              {catalogProducts.filter(p => !category || p.category === category).map(p => (
                                <option key={p.id} value={p.id!}>
                                  {p.name}{p.pricePerUnit != null ? ` — ₹${p.pricePerUnit}${p.unit ? `/${p.unit}` : ''}` : ''}
                                </option>
                              ))}
                            </select>
                            <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={16} />
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              if (showNewProductForm) { resetNewProductForm(); }
                              else { setNpCategory(category); setShowNewProductForm(true); }
                            }}
                            className={`h-14 w-14 flex items-center justify-center rounded-2xl shrink-0 active:scale-95 transition-all ${showNewProductForm ? 'bg-slate-100 text-slate-500 hover:bg-slate-200' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                            title={showNewProductForm ? 'Cancel new product' : 'Add new product'}
                          >
                            {showNewProductForm ? <X size={18} /> : <Plus size={20} />}
                          </button>
                        </div>
                        {/* Inline new-product form */}
                        {showNewProductForm && (
                          <div className="rounded-2xl border border-indigo-200 bg-white p-3.5 space-y-3">
                            <p className="text-xs font-semibold text-indigo-600">New product</p>
                            <input
                              type="text" value={npName} onChange={e => setNpName(e.target.value)}
                              placeholder="Product name"
                              autoFocus
                              className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-sm font-semibold text-slate-800 uppercase transition-all"
                            />
                            <div className="relative">
                              <select
                                value={npCategory} onChange={e => setNpCategory(e.target.value)}
                                className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 pr-9 rounded-xl text-sm font-medium text-slate-700 appearance-none transition-all"
                              >
                                <option value="">Select category</option>
                                {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                              </select>
                              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <input
                                type="number" step="0.01" min="0"
                                value={npPrice} onChange={e => setNpPrice(e.target.value)}
                                placeholder="Price / unit (₹)"
                                className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-sm font-semibold text-slate-800 transition-all"
                              />
                              <input
                                type="text" value={npUnit} onChange={e => setNpUnit(e.target.value)}
                                placeholder="Unit (kg, pc…)"
                                className="w-full h-11 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none px-4 rounded-xl text-sm font-medium text-slate-700 transition-all"
                              />
                            </div>
                            <button
                              type="button"
                              disabled={npSaving || !npName.trim() || !(npCategory || category)}
                              onClick={handleNewProductSave}
                              className="w-full h-11 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2 hover:bg-indigo-700 active:scale-[0.98] transition-all"
                            >
                              {npSaving ? <Loader2 size={16} className="animate-spin" /> : <><Check size={16} /> Save product</>}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black uppercase tracking-[0.2em] ml-1 block ${activeConsumable ? 'text-indigo-500' : 'text-slate-400'}`}>
                        {activeConsumable ? `Quantity (${activeConsumable.unitLabel}s) *` : 'Quantity'}
                      </label>
                      <input type="number" step="0.01" min={activeConsumable ? '0.01' : '0'} value={quantity} onChange={e => setQuantity(e.target.value)}
                        required={!!activeConsumable}
                        className={`w-full bg-slate-50 border-2 outline-none px-5 py-5 rounded-2xl text-xl font-black text-slate-900 transition-all ${activeConsumable ? 'border-indigo-200 focus:border-indigo-500' : 'border-slate-100 focus:border-indigo-500'}`}
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Price / Unit (₹)</label>
                      <div className="relative">
                        <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                        <input type="number" step="0.01" min="0" value={pricePerUnit} onChange={e => setPricePerUnit(e.target.value)}
                          className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none pl-10 pr-5 py-5 rounded-2xl text-xl font-black text-slate-900 transition-all" placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-5">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">
                        Total (₹){quantity && pricePerUnit && <span className="ml-2 text-indigo-400 normal-case font-bold tracking-normal">auto-calculated</span>}
                      </label>
                      <div className="relative">
                        <IndianRupee className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={26} />
                        <input required type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                          className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none pl-14 pr-5 py-5 rounded-2xl text-3xl font-black text-slate-900 transition-all" placeholder="0.00" autoFocus
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Category</label>
                      <select required value={category} onChange={e => setCategory(e.target.value)}
                        className="w-full h-[74px] bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none px-6 rounded-2xl text-base font-black text-slate-700 appearance-none uppercase transition-all"
                      >
                        <option value="">-- Pick Category --</option>
                        {allCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Pay from — cash counter or 10K vault (cash expenses only) */}
                  {entryType === 'expense' && (
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Pay From</label>
                      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1.5 rounded-2xl border-2 border-slate-100">
                        <button type="button" onClick={() => setPaidFrom('counter')}
                          className={`h-16 rounded-xl transition-all active:scale-95 border flex flex-col items-center justify-center gap-0.5 ${paidFrom === 'counter' ? 'bg-emerald-500/10 text-emerald-600 border-current shadow-sm' : 'bg-white border-slate-100 text-slate-400'}`}
                        >
                          <span className="text-sm font-black uppercase tracking-widest flex items-center gap-1.5"><Wallet size={14} /> Cash Counter</span>
                          {counterFormAccount && <span className="text-[10px] font-bold opacity-70">₹{counterFormAccount.balance.toLocaleString('en-IN')}</span>}
                        </button>
                        <button type="button" onClick={() => setPaidFrom('10k')} disabled={!tenKFormAccount}
                          className={`h-16 rounded-xl transition-all active:scale-95 border flex flex-col items-center justify-center gap-0.5 disabled:opacity-40 ${paidFrom === '10k' ? 'bg-amber-500/10 text-amber-600 border-current shadow-sm' : 'bg-white border-slate-100 text-slate-400'}`}
                        >
                          <span className="text-sm font-black uppercase tracking-widest flex items-center gap-1.5"><Vault size={14} /> 10K Vault</span>
                          <span className="text-[10px] font-bold opacity-70">{tenKFormAccount ? `₹${tenKFormAccount.balance.toLocaleString('en-IN')}` : 'Not set up'}</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {entryType === 'expense' && status === 'paid' && parseFloat(amount) > 0 && expenseSourceAccount && parseFloat(amount) - editOldImpact > expenseSourceAccount.balance && (
                    <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest flex items-center gap-1.5 -mt-1">
                      <AlertTriangle size={12} /> Amount exceeds {paidFrom === '10k' ? '10K vault' : 'cash'} balance (₹{expenseSourceAccount.balance.toLocaleString('en-IN')})
                    </p>
                  )}

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Payment Status</label>
                    <div className="flex bg-slate-50 p-1.5 rounded-2xl border-2 border-slate-100 gap-2">
                      {(['paid', 'pending', 'cancelled'] as EntryStatus[]).map((s) => {
                        const isActive = status === s;
                        const cfg = STATUS_CONFIG[s];
                        return (
                          <button key={s} type="button" onClick={() => setStatus(s)}
                            className={`flex-1 h-14 rounded-xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 border ${isActive ? `${cfg.bg} ${cfg.color} border-current shadow-sm` : 'bg-white border-slate-100 text-slate-400'}`}
                          >
                            {cfg.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Date</label>
                    <div className="relative">
                      <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                      <input required type="date" value={date} onChange={e => setDate(e.target.value)}
                        className="w-full h-14 bg-slate-50 border-2 border-slate-100 outline-none pl-12 pr-4 rounded-2xl text-sm font-bold text-slate-700 appearance-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Note / Description</label>
                    <textarea value={description} onChange={e => setDescription(e.target.value)}
                      className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 outline-none px-6 py-5 rounded-2xl text-sm font-medium text-slate-600 resize-none h-24"
                      placeholder="What was this for? (e.g. Milk, Petrol, Stationery…)"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 block">Receipt Photo</label>
                    <div onClick={() => fileInputRef.current?.click()} className="border-2 border-dashed border-slate-200 rounded-[2rem] p-8 flex flex-col items-center justify-center cursor-pointer active:bg-slate-50 transition-all relative overflow-hidden">
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
                      <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" capture="environment" className="hidden" />
                    </div>
                  </div>

                  <button
                    disabled={saving || success || (entryType === 'expense' && status === 'paid' && !!primaryCashAccount && parseFloat(amount) - (activeMode === 'edit' && editingId ? (entries.find((en: DailyCounterEntry) => en.id === editingId)?.status === 'paid' ? entries.find((en: DailyCounterEntry) => en.id === editingId)?.amount || 0 : 0) : 0) > primaryCashAccount.balance)}
                    className={`w-full py-7 rounded-[2rem] font-black uppercase text-xl tracking-wider shadow-xl transition-all active:scale-[0.98] flex items-center justify-center gap-4 text-white ${success ? 'bg-emerald-500' : entryType === 'purchase' ? 'bg-indigo-600' : 'bg-rose-500'}`}
                  >
                    {saving ? <Loader2 size={30} className="animate-spin" />
                      : success ? <><CheckCircle2 size={30} /> {activeMode === 'edit' ? 'Updated' : 'Submitted'}!</>
                      : <><Plus size={30} /> {activeMode === 'edit' ? 'Update Entry' : 'Post Entry'}</>}
                  </button>
                  {activeMode === 'edit' && (
                    <button type="button" onClick={() => { setActiveMode('view'); resetForm(); }}
                      className="w-full py-4 text-slate-400 font-black uppercase text-sm tracking-widest"
                    >
                      Cancel Edit
                    </button>
                  )}
                </>
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

                {viewingEntry.items && viewingEntry.items.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Bill Breakdown</p>
                    {viewingEntry.items.map((item, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
                        <div>
                          <p className="text-sm font-black text-slate-800 uppercase">{item.productName}</p>
                          <p className="text-[10px] font-bold text-slate-400 mt-0.5">{item.quantity} × ₹{item.pricePerUnit.toLocaleString('en-IN')}</p>
                        </div>
                        <p className="text-sm font-black text-slate-900">₹{item.amount.toLocaleString('en-IN')}</p>
                      </div>
                    ))}
                  </div>
                )}

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

      {/* ── PRODUCT CATALOG MODAL ─────────────────────────────── */}
      {showProductCatalog && (
        <ProductCatalog
          user={user}
          ownerId={profile.ownerId || user.uid}
          onSelect={handleProductSelect}
          onClose={() => { setShowProductCatalog(false); loadCatalogProducts(); }}
        />
      )}

      {/* ── VENDOR DIRECTORY MODAL ─────────────────────────────── */}
      {showVendorModal && (
        <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => { setShowVendorModal(false); resetVendorForm(); setVendorSearch(''); }} />
          <div className="relative w-full max-w-lg max-h-[90vh] bg-white rounded-t-[3rem] sm:rounded-[3rem] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">

            {/* Header */}
            <div className="bg-slate-900 px-8 pt-8 pb-6 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-white/10 rounded-2xl">
                  <Store size={20} className="text-white" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase tracking-tight">Vendor Directory</h3>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                    {vendors.length} vendor{vendors.length !== 1 ? 's' : ''} defined
                  </p>
                </div>
              </div>
              <button onClick={() => { setShowVendorModal(false); resetVendorForm(); setVendorSearch(''); }} className="p-2.5 bg-white/10 text-white rounded-2xl hover:bg-white/20 transition-all">
                <X size={18} />
              </button>
            </div>

            {/* Search + Add */}
            <div className="px-6 pt-5 pb-3 flex items-center gap-3 shrink-0">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  value={vendorSearch}
                  onChange={e => setVendorSearch(e.target.value)}
                  placeholder="Search vendors…"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 transition-all"
                />
              </div>
              <button
                onClick={() => { resetVendorForm(); setShowVendorForm(true); }}
                className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-100 active:scale-95 transition-all shrink-0"
              >
                <Plus size={14} /> Add
              </button>
            </div>

            {/* Inline Add/Edit Form */}
            {showVendorForm && (
              <form onSubmit={handleVendorSave} className="mx-6 mb-3 bg-indigo-50 rounded-[2rem] p-5 border-2 border-indigo-100 shrink-0 space-y-3">
                <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">
                  {editingVendorId ? 'Edit Vendor' : 'New Vendor'}
                </p>
                <input
                  required type="text" value={vName} onChange={e => setVName(e.target.value)}
                  placeholder="Vendor name *"
                  className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-black text-slate-900 outline-none focus:border-indigo-400 uppercase placeholder:normal-case placeholder:font-medium"
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-3">
                  <input type="tel" value={vPhone} onChange={e => setVPhone(e.target.value)} placeholder="Phone" className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-medium text-slate-700 outline-none focus:border-indigo-400" />
                  <input type="text" value={vGst} onChange={e => setVGst(e.target.value)} placeholder="GST No." className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 uppercase" />
                </div>
                <input type="email" value={vEmail} onChange={e => setVEmail(e.target.value)} placeholder="Email" className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-medium text-slate-700 outline-none focus:border-indigo-400" />
                <textarea value={vAddress} onChange={e => setVAddress(e.target.value)} placeholder="Address" rows={2} className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 resize-none" />
                <div className="flex gap-3">
                  <button type="button" onClick={resetVendorForm} className="flex-1 py-3 bg-white text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 border-slate-100">
                    Cancel
                  </button>
                  <button type="submit" disabled={vSaving || !vName.trim()} className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2 active:scale-95 transition-all">
                    {vSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    {editingVendorId ? 'Update' : 'Save'}
                  </button>
                </div>
              </form>
            )}

            {/* Vendor List */}
            <div className="flex-1 overflow-y-auto px-6 pb-8">
              {vendors.length === 0 ? (
                <div className="py-16 text-center">
                  <Store size={40} className="mx-auto text-slate-200 mb-3" />
                  <p className="text-xs font-black text-slate-300 uppercase tracking-widest">No vendors yet — add one above</p>
                </div>
              ) : (
                <div className="space-y-2 pt-2">
                  {vendors
                    .filter(v =>
                      !vendorSearch ||
                      v.name.toLowerCase().includes(vendorSearch.toLowerCase()) ||
                      (v.phone || '').includes(vendorSearch) ||
                      (v.gst || '').toLowerCase().includes(vendorSearch.toLowerCase())
                    )
                    .map(v => (
                      <div key={v.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-2xl px-4 py-3.5 border border-slate-100">
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900 uppercase truncate">{v.name}</p>
                          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                            {v.phone && <span className="text-[10px] font-bold text-slate-400">{v.phone}</span>}
                            {v.gst && <span className="text-[10px] font-bold text-indigo-400 uppercase">{v.gst}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleVendorEdit(v)}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                            title="Edit"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => v.id && handleVendorDelete(v.id)}
                            disabled={deletingVendorId === v.id}
                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50"
                            title="Delete"
                          >
                            {deletingVendorId === v.id
                              ? <Loader2 size={13} className="animate-spin" />
                              : <Trash2 size={13} />}
                          </button>
                        </div>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
