import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { 
  collection, 
   query, 
  where, 
  getDocs, 
  orderBy, 
  getDoc,
  doc, 
  updateDoc,
  addDoc,
  writeBatch,
  setDoc,
  deleteDoc,
  increment,
  limit,
  deleteField
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  BankTransaction,
  CategorizationRule,
  BankAccount,
  PurchaseRecord,
  DailySalesLog,
  SalesSummaryRecord,
  RECONCILIATION_CATEGORIES,
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
  Tag,
  BarChart3,
  PieChart as PieIcon,
  Trash2,
  RefreshCcw,
  ChevronDown,
  Sparkles,
  Check,
  BrainCircuit,
  Info,
  Database,
  History,
  X,
  PackagePlus,
  TrendingDown,
  TrendingUp,
  Minus,
  Scale,
  MessageSquare,
  AlignJustify,
  BarChart2,
  List,
  Wallet,
  CreditCard,
  Smartphone
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from 'recharts';

// ─── Split-tender payment-mode parsing ──────────────────────────────────────
// POS `paymentMode` can be a split-tender string like "Cash(500), UPI(46)" where the
// embedded amounts sum to the order's net payable. Parse per-channel amounts out of it
// rather than attributing the whole order to a single channel.
type Channel = 'cash' | 'upi' | 'card' | 'other';

const normalizeChannel = (label: string): Channel => {
  const l = label.toLowerCase();
  if (l.includes('cash')) return 'cash';
  if (l.includes('upi')) return 'upi';
  if (l.includes('card') || l.includes('credit') || l.includes('debit')) return 'card';
  return 'other';
};

const parseTender = (paymentMode: string, fallbackAmount: number): Record<Channel, number> => {
  const out: Record<Channel, number> = { cash: 0, upi: 0, card: 0, other: 0 };
  const mode = paymentMode || '';
  const re = /([A-Za-z][A-Za-z ]*?)\s*\(\s*([\d,.]+)\s*\)/g;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mode)) !== null) {
    const amt = parseFloat(m[2].replace(/,/g, ''));
    if (!isNaN(amt)) { out[normalizeChannel(m[1])] += amt; matched = true; }
  }
  // Plain string with no "(amount)" breakdown → attribute the order's amount to that channel.
  if (!matched) out[normalizeChannel(mode)] += fallbackAmount || 0;
  return out;
};

const BankReconciliation: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [loading, setLoading] = useState(true);
  const [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [rules, setRules] = useState<CategorizationRule[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [filterMode, setFilterMode] = useState<'all' | 'unverified' | 'verified'>('unverified');
  const [selectedBankId, setSelectedBankId] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<'all' | 'debit' | 'credit'>('all');
  
  // Match Discovery Modal
  const [discoveryTxn, setDiscoveryTxn] = useState<BankTransaction | null>(null);
  const [discoveryResults, setDiscoveryResults] = useState<PurchaseRecord[]>([]);
  const [isSearchingDiscovery, setIsSearchingDiscovery] = useState(false);
  const [discoveryDateRange, setDiscoveryDateRange] = useState<number>(0); // 0, 1, or 2 days offset
  const [categories, setCategories] = useState<string[]>(RECONCILIATION_CATEGORIES);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [learnedRules, setLearnedRules] = useState<Record<string, string>>({});
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [dailySalesLogs, setDailySalesLogs] = useState<DailySalesLog[]>([]);
  const [salesSummary, setSalesSummary] = useState<SalesSummaryRecord[]>([]);
  const [activeView, setActiveView] = useState<'mapping' | 'delta' | 'channel-delta' | 'analytics'>('mapping');
  const [analyticsView, setAnalyticsView] = useState<'list' | 'hbar' | 'vbar' | 'donut'>('hbar');
  const [deltaOutletFilter, setDeltaOutletFilter] = useState<string>('all');
  const [channelOutletFilter, setChannelOutletFilter] = useState<string>('all');
  const [commentingId, setCommentingId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState<string>('');

  const availableCategories = useMemo(() => {
    const fromTransactions = bankTransactions
      .map(t => t.category?.toUpperCase())
      .filter((c): c is string => !!c);
    
    const fromRules = rules.map(r => r.category.toUpperCase());
    
    const combined = new Set([...RECONCILIATION_CATEGORIES, ...categories, ...fromTransactions, ...fromRules]);
    return Array.from(combined).sort();
  }, [bankTransactions, rules, categories]);

  const fetchReconciliationData = async () => {
    setLoading(true);
    try {
      // 1. Fetch Transactions
      const bankQ = query(
        collection(db, 'bank_statement_imports'),
        where('userId', '==', dataOwnerId)
      );
      const bSnap = await getDocs(bankQ);
      setBankTransactions(bSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankTransaction)));

      // 2. Fetch Categorization Rules
      const rulesQ = query(
        collection(db, 'categorization_rules'),
        where('userId', '==', dataOwnerId)
      );
      const rSnap = await getDocs(rulesQ);
      setRules(rSnap.docs.map(d => ({ id: d.id, ...d.data() } as CategorizationRule)));

      // 3. Fetch Bank Accounts
      const bankAccQ = query(
        collection(db, 'bank_accounts'),
        where('userId', '==', dataOwnerId)
      );
      const accSnap = await getDocs(bankAccQ);
      setBankAccounts(accSnap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount)));

    } catch (err) {
      console.error("Reconciliation fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  // Bounded reads: daily_sales_logs and sales_summary are consumed only for the selected
  // month (every downstream filter uses `${selectedYear}-${monthIdx}`), so window them by
  // ISO date instead of scanning the whole collection as history grows.
  const fetchPeriodData = async () => {
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const start = `${selectedYear}-${monthIdx}-01`;
    const end = `${selectedYear}-${monthIdx}-31`;

    // daily sales logs (dual query for backward compat)
    try {
      const [ownerSnap, userSnap] = await Promise.all([
        getDocs(query(collection(db, 'daily_sales_logs'), where('ownerId', '==', dataOwnerId), where('date', '>=', start), where('date', '<=', end))),
        getDocs(query(collection(db, 'daily_sales_logs'), where('userId',  '==', dataOwnerId), where('date', '>=', start), where('date', '<=', end))),
      ]);
      const seenIds = new Set<string>();
      const logs: DailySalesLog[] = [];
      [...ownerSnap.docs, ...userSnap.docs].forEach(d => {
        if (!seenIds.has(d.id)) { seenIds.add(d.id); logs.push({ id: d.id, ...d.data() } as DailySalesLog); }
      });
      setDailySalesLogs(logs);
    } catch { setDailySalesLogs([]); }

    // POS sales summary (source of per-channel CSV figures via paymentMode)
    try {
      const salesSnap = await getDocs(query(collection(db, 'sales_summary'), where('userId', '==', dataOwnerId), where('date', '>=', start), where('date', '<=', end)));
      setSalesSummary(salesSnap.docs.map(d => ({ id: d.id, ...d.data() } as SalesSummaryRecord)));
    } catch { setSalesSummary([]); }
  };

  useEffect(() => {
    fetchReconciliationData();
  }, [user]);

  useEffect(() => {
    fetchPeriodData();
  }, [dataOwnerId, selectedMonth, selectedYear]);

  useEffect(() => {
    setMarkedCreditIds(new Set());
  }, [selectedMonth, selectedYear]);

  // Derived suggestions from history
  useEffect(() => {
    const verified = bankTransactions.filter(t => t.isVerified && t.category);
    const map: Record<string, { [cat: string]: number }> = {};
    
    verified.forEach(t => {
      // Use first 3 words as a signature
      const sig = t.description.split(' ').slice(0, 3).join(' ').toLowerCase();
      if (!map[sig]) map[sig] = {};
      map[sig][t.category!] = (map[sig][t.category!] || 0) + 1;
    });

    const suggestions: Record<string, string> = {};
    Object.entries(map).forEach(([sig, counts]) => {
      // Pick the category with highest frequency
      const bestCat = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      suggestions[sig] = bestCat;
    });
    setLearnedRules(suggestions);
  }, [bankTransactions]);

  const filteredBT = useMemo(() => {
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;
    
    return bankTransactions
      .filter(t => t.date.startsWith(datePrefix))
      .filter(t => {
        if (filterMode === 'verified') return t.isVerified;
        if (filterMode === 'unverified') return !t.isVerified;
        return true;
      })
      .filter(t => {
        if (selectedBankId !== 'all' && t.bankAccountId !== selectedBankId) return false;
        if (selectedType !== 'all' && t.type !== selectedType) return false;
        return true;
      })
      .filter(t => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return (
          t.description.toLowerCase().includes(search) || 
          t.amount.toString().includes(search) ||
          (t.category || '').toLowerCase().includes(search)
        );
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [bankTransactions, selectedMonth, selectedYear, searchTerm, filterMode, selectedBankId, selectedType]);

  const [markedCreditIds, setMarkedCreditIds] = useState<Set<string>>(new Set());

  const deltaCredits = useMemo(() => {
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;
    return bankTransactions
      .filter(t => t.date.startsWith(datePrefix) && t.type === 'credit')
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [bankTransactions, selectedMonth, selectedYear]);

  const deltaCardByDate = useMemo(() => {
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;
    const map: Record<string, number> = {};
    dailySalesLogs
      .filter(l => l.date.startsWith(datePrefix) && (deltaOutletFilter === 'all' || l.outletId === deltaOutletFilter))
      .forEach(l => { map[l.date] = (map[l.date] || 0) + (l.card || 0); });
    return map;
  }, [dailySalesLogs, selectedMonth, selectedYear, deltaOutletFilter]);

  const deltaUpiByDate = useMemo(() => {
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;
    const map: Record<string, number> = {};
    dailySalesLogs
      .filter(l => l.date.startsWith(datePrefix) && (deltaOutletFilter === 'all' || l.outletId === deltaOutletFilter))
      .forEach(l => { map[l.date] = (map[l.date] || 0) + (l.upi || 0); });
    return map;
  }, [dailySalesLogs, selectedMonth, selectedYear, deltaOutletFilter]);

  const deltaDates = useMemo(() => {
    const creditDates = deltaCredits.map(t => t.date);
    const crewDates = Array.from(new Set([...Object.keys(deltaCardByDate), ...Object.keys(deltaUpiByDate)]));
    return Array.from(new Set([...creditDates, ...crewDates])).sort().reverse();
  }, [deltaCredits, deltaCardByDate, deltaUpiByDate]);

  // ── Channel Delta: POS CSV (sales_summary) vs Crew (daily_sales_logs) per channel ──
  const channelDelta = useMemo(() => {
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;

    // CSV side: counter-only orders (exclude Zomato/Swiggy), parse split-tender amounts.
    const csvByDate: Record<string, Record<Channel, number>> = {};
    const unmapped: Record<string, number> = {}; // raw paymentMode → amount, for the 'other' bucket
    salesSummary
      .filter(r =>
        (r.date || '').startsWith(datePrefix) &&
        (!r.onlinePlatform || r.onlinePlatform.toLowerCase() === 'none') &&
        (channelOutletFilter === 'all' || r.outletId === channelOutletFilter)
      )
      .forEach(r => {
        const t = parseTender(r.paymentMode, r.revenue);
        if (!csvByDate[r.date]) csvByDate[r.date] = { cash: 0, upi: 0, card: 0, other: 0 };
        (['cash', 'upi', 'card', 'other'] as Channel[]).forEach(c => { csvByDate[r.date][c] += t[c]; });
        if (t.other > 0) unmapped[r.paymentMode || '(blank)'] = (unmapped[r.paymentMode || '(blank)'] || 0) + t.other;
      });

    // Crew side: daily_sales_logs, same month/outlet.
    const crewByDate: Record<string, { cash: number; upi: number; card: number }> = {};
    dailySalesLogs
      .filter(l => (l.date || '').startsWith(datePrefix) && (channelOutletFilter === 'all' || l.outletId === channelOutletFilter))
      .forEach(l => {
        if (!crewByDate[l.date]) crewByDate[l.date] = { cash: 0, upi: 0, card: 0 };
        crewByDate[l.date].cash += Number(l.cash || 0);
        crewByDate[l.date].upi += Number(l.upi || 0);
        crewByDate[l.date].card += Number(l.card || 0);
      });

    const statusOf = (csv: number, crew: number): 'match' | 'close' | 'gap' | 'missing' => {
      const delta = csv - crew;
      if (csv === 0 && crew === 0) return 'match';
      if (csv > 0 && crew === 0) return 'missing';
      const base = Math.max(csv, 1);
      const pct = Math.abs(delta) / base;
      if (pct <= 0.03) return 'match';
      if (pct <= 0.15) return 'close';
      return 'gap';
    };

    const dates = Array.from(new Set([...Object.keys(csvByDate), ...Object.keys(crewByDate)])).sort().reverse();
    const rows = dates.map(date => {
      const csv = csvByDate[date] || { cash: 0, upi: 0, card: 0, other: 0 };
      const crew = crewByDate[date] || { cash: 0, upi: 0, card: 0 };
      const csvTotal = csv.cash + csv.upi + csv.card;
      const crewTotal = crew.cash + crew.upi + crew.card;
      return { date, csv, crew, status: statusOf(csvTotal, crewTotal) };
    });

    const csvTotals = rows.reduce((a, r) => ({ cash: a.cash + r.csv.cash, upi: a.upi + r.csv.upi, card: a.card + r.csv.card }), { cash: 0, upi: 0, card: 0 });
    const crewTotals = rows.reduce((a, r) => ({ cash: a.cash + r.crew.cash, upi: a.upi + r.crew.upi, card: a.card + r.crew.card }), { cash: 0, upi: 0, card: 0 });
    const otherTotal = Object.values(unmapped).reduce((s, v) => s + v, 0);

    return { rows, csvTotals, crewTotals, unmapped, otherTotal };
  }, [salesSummary, dailySalesLogs, selectedMonth, selectedYear, channelOutletFilter]);

  const toggleMark = (id: string) => {
    setMarkedCreditIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAllForDate = (date: string, ids: string[]) => {
    const allMarked = ids.every(id => markedCreditIds.has(id));
    setMarkedCreditIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => allMarked ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!confirm("Delete this bank transaction?")) return;
    try {
      await deleteDoc(doc(db, 'bank_statement_imports', id));
      setBankTransactions(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      console.error(err);
    }
  };

  // Learning Engine: Match description against keywords
  const suggestCategory = (description: string): string | null => {
    const desc = description.toLowerCase();
    
    // 1. Check explicit rules (highest priority)
    const sortedRules = [...rules].sort((a, b) => b.keyword.length - a.keyword.length);
    for (const rule of sortedRules) {
      if (desc.includes(rule.keyword.toLowerCase())) {
        return rule.category.toUpperCase();
      }
    }

    // 2. Check learned history (fallback)
    const sig = description.split(' ').slice(0, 3).join(' ').toLowerCase();
    if (learnedRules[sig]) {
      return learnedRules[sig].toUpperCase();
    }

    return null;
  };

  const handleBulkMap = async (category: string) => {
    if (selectedBatchIds.size === 0) return;
    setIsBulkUpdating(true);
    const normalizedCategory = category.toUpperCase();
    
    try {
      const batch = writeBatch(db);
      const idsArray = Array.from(selectedBatchIds);
      
      // Firestore batch limit is 500
      for (const id of idsArray) {
        if (typeof id !== 'string') continue;
        batch.update(doc(db, 'bank_statement_imports', id), {
          category: normalizedCategory,
          isVerified: false, // Keep as unverified for user review or set to true if preferred
          isReconciled: true
        });
      }

      await batch.commit();

      // Update local state
      setBankTransactions(prev => prev.map(t => 
        selectedBatchIds.has(t.id!) 
          ? { ...t, category: normalizedCategory, isReconciled: true } 
          : t
      ));
      
      setSelectedBatchIds(new Set());
    } catch (err) {
      console.error("Bulk map failed:", err);
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedBatchIds.size === filteredBT.length) {
      setSelectedBatchIds(new Set());
    } else {
      setSelectedBatchIds(new Set(filteredBT.map(t => t.id!)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedBatchIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBatchIds(next);
  };
  const handleManualMap = async (btId: string, category: string, isVerified = false, purchaseId?: string) => {
    setUpdatingId(btId);
    const normalizedCategory = category.toUpperCase();
    try {
      const bt = bankTransactions.find(t => t.id === btId);
      if (!bt) return;

      const batch = writeBatch(db);
      
      // 1. Update the bank transaction
      const btRef = doc(db, 'bank_statement_imports', btId);
      batch.update(btRef, {
        category: normalizedCategory,
        isVerified,
        isReconciled: true,
        matchedPurchaseId: purchaseId || bt.matchedPurchaseId || null
      });

      // 2. If a purchase is linked, update it too
      if (purchaseId) {
        const pRef = doc(db, 'purchases', purchaseId);
        batch.update(pRef, {
          category: normalizedCategory, // Sync the category
          isBankVerified: true
        });
      }

      await batch.commit();

      // Update local state for immediate feedback
      setBankTransactions(prev => prev.map(t => 
        t.id === btId ? { ...t, category: normalizedCategory, isVerified, isReconciled: true, matchedPurchaseId: purchaseId || t.matchedPurchaseId } : t
      ));

      // Learning Opportunity: Check if we should suggest a rule
      // If user manually mapped, and it's not a rule yet
      const existingRule = rules.find(r => r.category === category && bt.description.toLowerCase().includes(r.keyword.toLowerCase()));
      
      if (!existingRule) {
        // We might want to prompt for rule creation, but for now let's auto-learn simple keywords
      } else {
        // Update rule usage count
        await updateDoc(doc(db, 'categorization_rules', existingRule.id!), {
          usageCount: increment(1),
          lastUsedAt: Date.now()
        });
      }

    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingId(null);
    }
  };

  const handlePushToPurchases = async (bt: BankTransaction) => {
    if (!bt.id) return;
    setPushingId(bt.id);
    try {
      const purchase: Omit<PurchaseRecord, 'id'> = {
        billNo: bt.referenceNo && !bt.referenceNo.startsWith('AUTO-') ? bt.referenceNo : `BANK-${bt.id.slice(-6).toUpperCase()}`,
        date: bt.date,
        productName: bt.description,
        amount: bt.amount,
        category: bt.category || 'UNCATEGORIZED',
        vendor: bt.description,
        userId: user.uid,
        _fileId: 'BANK_PUSH',
        createdAt: Date.now(),
      };

      const purchaseRef = await addDoc(collection(db, 'purchases'), purchase);

      await updateDoc(doc(db, 'bank_statement_imports', bt.id), {
        matchedPurchaseId: purchaseRef.id,
        pushedToPurchases: true,
        isVerified: true,
        isReconciled: true,
      });

      setBankTransactions(prev => prev.map(t =>
        t.id === bt.id
          ? { ...t, matchedPurchaseId: purchaseRef.id, pushedToPurchases: true, isVerified: true, isReconciled: true }
          : t
      ));
    } catch (err) {
      console.error('Push to purchases error:', err);
    } finally {
      setPushingId(null);
    }
  };

  const handleBulkAutoMap = async () => {
    setLoading(true);
    const batch = writeBatch(db);
    let count = 0;

    // We want to auto-map ALL unverified transactions for this month, 
    // regardless of what's currently filtered by search or tabs.
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;
    
    const periodTransactions = bankTransactions.filter(t => t.date.startsWith(datePrefix));

    for (const bt of periodTransactions) {
      if (bt.isVerified) continue;
      
      const suggested = suggestCategory(bt.description);
      if (suggested && suggested !== bt.category) {
        batch.update(doc(db, 'bank_statement_imports', bt.id!), {
          category: suggested,
          isVerified: false, // Keep as unverified so user can review/confirm
          isReconciled: true
        });
        count++;
      }
    }

    if (count > 0) {
      try {
        await batch.commit();
        // Update local state directly for immediate speed before/during re-fetch
        setBankTransactions(prev => prev.map(t => {
          if (t.date.startsWith(datePrefix) && !t.isVerified) {
            const suggested = suggestCategory(t.description);
            if (suggested) {
              return { ...t, category: suggested, isReconciled: true };
            }
          }
          return t;
        }));
        await fetchReconciliationData();
      } catch (err) {
        console.error("Bulk auto-map failed:", err);
      }
    }
    setLoading(false);
  };

  const createRuleFromTransaction = async (description: string, category: string) => {
    // Simple rule creation: use the first two words or cleaned description
    const keyword = description.split(' ').slice(0, 3).join(' ').trim();
    if (!keyword) return;

    try {
      const newRule: CategorizationRule = {
        keyword,
        category: category.toUpperCase(),
        userId: user.uid,
        usageCount: 1,
        lastUsedAt: Date.now()
      };
      await addDoc(collection(db, 'categorization_rules'), newRule);
      await fetchReconciliationData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddCategory = () => {
    if (!newCategoryName.trim()) return;
    const upper = newCategoryName.trim().toUpperCase();
    if (!categories.includes(upper)) {
      setCategories(prev => [...prev, upper]);
    }
    setNewCategoryName('');
    setIsAddingCategory(false);
  };

  const handleSaveComment = async (btId: string, value: string) => {
    const trimmed = value.trim();
    try {
      await updateDoc(doc(db, 'bank_statement_imports', btId), {
        comment: trimmed || deleteField(),
      });
      setBankTransactions((prev: BankTransaction[]) =>
        prev.map((t: BankTransaction) => t.id === btId ? { ...t, comment: trimmed || undefined } : t)
      );
    } catch (err) {
      console.error('Failed to save comment:', err);
    }
    setCommentingId(null);
  };

  const findMatchingPurchases = async (txn: BankTransaction, daysOffset: number) => {
    setIsSearchingDiscovery(true);
    setDiscoveryDateRange(daysOffset);
    try {
      const txnDate = new Date(txn.date);
      const searchDates: string[] = [];
      
      for (let i = 0; i <= daysOffset; i++) {
        const d = new Date(txnDate);
        d.setDate(d.getDate() + i);
        searchDates.push(d.toISOString().split('T')[0]);
      }

      // Query purchases for these dates
      // Due to Firebase limitation of 'in' queries being limited and wanting to be efficient:
      // We look for all user purchases in those dates.
      const q = query(
        collection(db, 'purchases'),
        where('userId', '==', dataOwnerId),
        where('date', 'in', searchDates)
      );

      const snap = await getDocs(q);
      const records = snap.docs.map(d => ({ id: d.id, ...d.data() } as PurchaseRecord));
      
      // Sort by closeness to amount first
      setDiscoveryResults(records.sort((a, b) => {
        const diffA = Math.abs(a.amount - txn.amount);
        const diffB = Math.abs(b.amount - txn.amount);
        return diffA - diffB;
      }));
      setDiscoveryTxn(txn);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearchingDiscovery(false);
    }
  };

  const stats = useMemo(() => {
    // Stats should be based on ALL transactions for the selected period/bank/type, 
    // NOT filtered by the 'unverified'/'verified' tabs.
    const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
    const datePrefix = `${selectedYear}-${monthIdx}`;
    
    const periodBT = bankTransactions
      .filter(t => t.date.startsWith(datePrefix))
      .filter(t => {
        if (selectedBankId !== 'all' && t.bankAccountId !== selectedBankId) return false;
        if (selectedType !== 'all' && t.type !== selectedType) return false;
        return true;
      });

    const total = periodBT.length;
    const verifiedCount = periodBT.filter(t => t.isVerified).length;
    const unverifiedCount = total - verifiedCount;
    
    const categoryBreakdown: Record<string, number> = {};
    let totalDebitValue = 0;
    let mappedDebitValue = 0;

    periodBT.forEach(t => {
      if (t.type === 'debit') {
        const amt = Number(t.amount) || 0;
        totalDebitValue += amt;
        if (t.category) {
          categoryBreakdown[t.category] = (categoryBreakdown[t.category] || 0) + amt;
          mappedDebitValue += amt;
        } else {
          categoryBreakdown['UNMAPPED'] = (categoryBreakdown['UNMAPPED'] || 0) + amt;
        }
      }
    });

    return { 
      total, 
      verified: verifiedCount, 
      unverified: unverifiedCount, 
      categoryBreakdown, 
      totalValue: totalDebitValue, 
      mappedValue: mappedDebitValue 
    };
  }, [bankTransactions, selectedMonth, selectedYear, selectedBankId, selectedType]);

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      {/* Bulk Actions Floating Bar */}
      {selectedBatchIds.size > 0 && (
        <motion.div 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white px-8 py-5 rounded-[2.5rem] shadow-2xl flex items-center gap-8 border border-slate-700 backdrop-blur-md"
        >
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Selected Batch</span>
            <span className="text-2xl font-black text-indigo-400">{selectedBatchIds.size} <span className="text-sm text-slate-400">Transactions</span></span>
          </div>

          <div className="h-10 w-px bg-slate-800" />

          <div className="flex items-center gap-4">
            <div className="relative group">
              <select 
                onChange={(e) => {
                  if(e.target.value) handleBulkMap(e.target.value);
                }}
                disabled={isBulkUpdating}
                className="bg-slate-800 border border-slate-700 text-white rounded-2xl pl-10 pr-10 py-3 text-[10px] font-black uppercase tracking-widest outline-none appearance-none cursor-pointer focus:ring-2 ring-indigo-500 transition-all"
              >
                <option value="">Move to Category...</option>
                {availableCategories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
              <Tag size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <ChevronDown size={14} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            </div>

            <button 
              onClick={() => setSelectedBatchIds(new Set())}
              className="p-3 bg-slate-800 text-slate-400 hover:text-white rounded-2xl transition-all"
              title="Clear Selection"
            >
              <X size={20} />
            </button>
          </div>
        </motion.div>
      )}

      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <RefreshCcw size={24} />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Transaction Categorizer</h2>
          </div>
          <p className="text-slate-500 font-medium uppercase text-[10px] tracking-widest flex items-center gap-2">
             <BrainCircuit size={14} className="text-indigo-500"/> AI-Assisted Financial Learning & Mapping
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex p-1 bg-slate-100 rounded-2xl border border-slate-200">
            <div className="relative">
              <select 
                value={selectedBankId} 
                onChange={e => setSelectedBankId(e.target.value)}
                className="pl-4 pr-10 py-2.5 bg-white rounded-xl text-[10px] font-black uppercase outline-none appearance-none border border-slate-200 shadow-sm"
              >
                <option value="all">All Banks</option>
                {bankAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.name}</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            <div className="relative ml-2">
              <select 
                value={selectedType} 
                onChange={e => setSelectedType(e.target.value as any)}
                className="pl-4 pr-10 py-2.5 bg-white rounded-xl text-[10px] font-black uppercase outline-none appearance-none border border-slate-200 shadow-sm"
              >
                <option value="all">All Types</option>
                <option value="debit">Debits (-)</option>
                <option value="credit">Credits (+)</option>
              </select>
              <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div className="flex p-1 bg-slate-100 rounded-2xl border border-slate-200">
            <div className="relative">
              <select 
                value={selectedMonth} 
                onChange={e => setSelectedMonth(e.target.value)}
                className="pl-4 pr-10 py-2.5 bg-white rounded-xl text-[10px] font-black uppercase outline-none appearance-none border border-slate-200 shadow-sm"
              >
                {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
            <div className="relative ml-2">
              <select 
                value={selectedYear} 
                onChange={e => setSelectedYear(e.target.value)}
                className="pl-4 pr-10 py-2.5 bg-white rounded-xl text-[10px] font-black outline-none appearance-none border border-slate-200 shadow-sm"
              >
                {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          <div className="relative group min-w-[300px]">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
            <input 
              type="text" 
              placeholder="Filter by description (e.g. 'Rent', 'Swiggy')..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-12 pr-12 py-3.5 bg-white border-2 border-slate-100 rounded-2xl text-xs font-black uppercase tracking-widest outline-none focus:border-indigo-600 focus:ring-4 focus:ring-indigo-100/50 w-full shadow-sm transition-all"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-900 transition-colors"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <button
            onClick={() => setShowSummary(!showSummary)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all shadow-xl ${showSummary ? 'bg-slate-900 text-white shadow-slate-200' : 'bg-white text-slate-900 border border-slate-200 shadow-slate-100'}`}
          >
            {showSummary ? <Database size={14} /> : <PieIcon size={14} />}
            {showSummary ? 'View Ledger' : 'View Insights'}
          </button>
        </div>
      </header>

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 bg-slate-200/40 p-1.5 rounded-[2rem] w-fit border border-slate-100 shadow-inner">
        <button
          onClick={() => setActiveView('mapping')}
          className={`px-6 py-2.5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'mapping' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-600'}`}
        >
          Transaction Mapping
        </button>
        <button
          onClick={() => setActiveView('delta')}
          className={`px-6 py-2.5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'delta' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-600'}`}
        >
          Sales Reconciliation Delta
        </button>
        <button
          onClick={() => setActiveView('channel-delta')}
          className={`px-6 py-2.5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'channel-delta' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-600'}`}
        >
          Channel Delta
        </button>
        <button
          onClick={() => setActiveView('analytics')}
          className={`px-6 py-2.5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeView === 'analytics' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-600'}`}
        >
          Category Analytics
        </button>
      </div>

      {/* ── SALES DELTA PANEL ─────────────────────────────────── */}
      {activeView === 'delta' && (() => {
        const markedTotal: number = deltaCredits.filter(t => markedCreditIds.has(t.id!)).reduce((s: number, t: BankTransaction) => s + t.amount, 0);
        const crewCardTotal: number = (Object.values(deltaCardByDate) as number[]).reduce((s: number, v: number) => s + v, 0);
        const crewUpiTotal: number = (Object.values(deltaUpiByDate) as number[]).reduce((s: number, v: number) => s + v, 0);
        const crewTotal = crewCardTotal + crewUpiTotal;
        const netDelta = markedTotal - crewTotal;
        return (
          <div className="space-y-6">
            {/* Summary strip */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: 'Marked Credits', value: markedTotal, color: 'indigo' },
                { label: 'Crew Card', value: crewCardTotal, color: 'violet' },
                { label: 'Crew UPI', value: crewUpiTotal, color: 'slate' },
                { label: 'Net Delta', value: netDelta, color: Math.abs(netDelta) < 1 ? 'emerald' : netDelta > 0 ? 'amber' : 'rose' },
              ].map(({ label, value, color }) => (
                <div key={label} className={`bg-white border border-slate-100 rounded-[2rem] px-7 py-5 shadow-sm`}>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
                  <p className={`text-2xl font-black tracking-tighter text-${color}-600`}>
                    {value >= 0 ? '' : '-'}₹{Math.abs(value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </div>

            {/* Per-date groups */}
            <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-8 py-5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl"><Scale size={18} /></div>
                  <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-sm">Sales Reconciliation Delta</h3>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">Tick the bank credits that represent actual sales settlements · {selectedMonth} {selectedYear}</p>
                  </div>
                </div>
                <select
                  value={deltaOutletFilter}
                  onChange={e => setDeltaOutletFilter(e.target.value)}
                  className="text-[9px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-500 rounded-xl px-3 py-2 cursor-pointer transition-colors hover:border-indigo-300"
                >
                  <option value="all">All Stores</option>
                  {MASTER_OUTLETS.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              {deltaDates.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-xs font-bold text-slate-300 uppercase tracking-widest">No data for this period</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="px-6 py-4 w-10"></th>
                        <th className="text-left px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                        <th className="text-left px-4 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Narration</th>
                        <th className="text-right px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Amount</th>
                        <th className="text-right px-6 py-4 text-[10px] font-black text-violet-400 uppercase tracking-widest">Crew Card</th>
                        <th className="text-right px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Crew UPI</th>
                        <th className="text-right px-8 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deltaDates.map(date => {
                        const dayCredits = deltaCredits.filter(t => t.date === date);
                        const crewCard = deltaCardByDate[date] || 0;
                        const crewUpi = deltaUpiByDate[date] || 0;
                        const crewDigital = crewCard + crewUpi;
                        const dayMarkedTotal = dayCredits.filter(t => markedCreditIds.has(t.id!)).reduce((s, t) => s + t.amount, 0);
                        const dayDelta = dayMarkedTotal - crewDigital;
                        const allMarked = dayCredits.length > 0 && dayCredits.every(t => markedCreditIds.has(t.id!));
                        const someMarked = dayCredits.some(t => markedCreditIds.has(t.id!));
                        const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

                        return (
                          <>
                            {/* Date group header */}
                            <tr key={`hdr-${date}`} className="bg-slate-50 border-t border-slate-100">
                              <td className="px-6 py-3">
                                {dayCredits.length > 0 && (
                                  <div
                                    onClick={() => toggleAllForDate(date, dayCredits.map(t => t.id!))}
                                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center cursor-pointer transition-all ${allMarked ? 'bg-indigo-600 border-indigo-600' : someMarked ? 'bg-indigo-200 border-indigo-400' : 'bg-white border-slate-300 hover:border-indigo-400'}`}
                                  >
                                    {allMarked && <Check size={12} className="text-white" />}
                                    {someMarked && !allMarked && <Minus size={10} className="text-indigo-600" />}
                                  </div>
                                )}
                              </td>
                              <td colSpan={2} className="px-4 py-3">
                                <span className="text-xs font-black text-slate-600 uppercase tracking-widest">{dateLabel}</span>
                                {dayCredits.length === 0 && <span className="ml-3 text-[10px] text-slate-300 font-bold uppercase">No bank credits</span>}
                              </td>
                              <td className="px-6 py-3 text-right">
                                {dayMarkedTotal > 0 && (
                                  <span className="text-xs font-black text-indigo-600">₹{dayMarkedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                )}
                              </td>
                              <td className="px-6 py-3 text-right">
                                {crewCard > 0
                                  ? <span className="text-xs font-black text-violet-600">₹{crewCard.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                  : <span className="text-slate-300 text-xs font-bold">—</span>}
                              </td>
                              <td className="px-6 py-3 text-right">
                                {crewUpi > 0
                                  ? <span className="text-xs font-black text-slate-700">₹{crewUpi.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                  : <span className="text-slate-300 text-xs font-bold">—</span>}
                              </td>
                              <td className="px-8 py-3 text-right">
                                {(dayMarkedTotal > 0 || crewDigital > 0) && (
                                  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black ${Math.abs(dayDelta) < 1 ? 'bg-emerald-50 text-emerald-600' : dayDelta > 0 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
                                    {Math.abs(dayDelta) < 1 ? <><Minus size={10} /> Balanced</> : dayDelta > 0 ? <><TrendingUp size={10} /> +₹{Math.abs(dayDelta).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</> : <><TrendingDown size={10} /> -₹{Math.abs(dayDelta).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</>}
                                  </span>
                                )}
                              </td>
                            </tr>

                            {/* Individual credit rows */}
                            {dayCredits.map(t => {
                              const marked = markedCreditIds.has(t.id!);
                              return (
                                <tr
                                  key={t.id}
                                  onClick={() => toggleMark(t.id!)}
                                  className={`border-b border-slate-50 cursor-pointer transition-colors ${marked ? 'bg-indigo-50/60 hover:bg-indigo-50' : 'hover:bg-slate-50'}`}
                                >
                                  <td className="px-6 py-4">
                                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${marked ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-slate-200'}`}>
                                      {marked && <Check size={12} className="text-white" />}
                                    </div>
                                  </td>
                                  <td className="px-4 py-4 text-xs text-slate-400 font-bold whitespace-nowrap"></td>
                                  <td className="px-4 py-4 max-w-[320px]">
                                    <p className="text-xs font-bold text-slate-700 uppercase leading-snug break-words line-clamp-2">{t.description}</p>
                                    {t.referenceNo && !t.referenceNo.startsWith('AUTO-') && (
                                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">UTR: {t.referenceNo}</span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <span className={`text-sm font-black ${marked ? 'text-indigo-600' : 'text-emerald-600'}`}>
                                      ₹{t.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4"></td>
                                  <td className="px-6 py-4"></td>
                                  <td className="px-8 py-4"></td>
                                </tr>
                              );
                            })}
                          </>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t-2 border-slate-200">
                        <td colSpan={3} className="px-8 py-4 text-[10px] font-black text-slate-500 uppercase tracking-widest">
                          Period Total · {markedCreditIds.size} transaction{markedCreditIds.size !== 1 ? 's' : ''} marked
                        </td>
                        <td className="px-6 py-4 text-right font-black text-indigo-700">
                          ₹{markedTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4 text-right font-black text-violet-700">
                          ₹{crewCardTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4 text-right font-black text-slate-800">
                          ₹{crewUpiTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-8 py-4 text-right">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black ${Math.abs(netDelta) < 1 ? 'bg-emerald-50 text-emerald-600' : netDelta > 0 ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
                            {Math.abs(netDelta) < 1 ? <><Minus size={11} /> Balanced</> : netDelta > 0 ? <><TrendingUp size={11} /> +₹{Math.abs(netDelta).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</> : <><TrendingDown size={11} /> -₹{Math.abs(netDelta).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</>}
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── CHANNEL DELTA PANEL (POS CSV vs Crew, per channel) ─────────────── */}
      {activeView === 'channel-delta' && (() => {
        const { rows, csvTotals, crewTotals, unmapped, otherTotal } = channelDelta;
        const fmt = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
        const channels: { key: Channel; label: string; icon: React.ReactNode; tint: string }[] = [
          { key: 'cash', label: 'Cash', icon: <Wallet size={16} />, tint: 'text-slate-600 bg-slate-100' },
          { key: 'upi', label: 'UPI', icon: <Smartphone size={16} />, tint: 'text-violet-600 bg-violet-50' },
          { key: 'card', label: 'Card (Net)', icon: <CreditCard size={16} />, tint: 'text-indigo-600 bg-indigo-50' },
        ];
        const statusStyle: Record<string, { label: string; dot: string; bg: string; text: string }> = {
          match:   { label: 'Match',   dot: 'bg-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-700' },
          close:   { label: 'Close',   dot: 'bg-amber-400',   bg: 'bg-amber-50',   text: 'text-amber-700' },
          gap:     { label: 'Gap',     dot: 'bg-rose-400',    bg: 'bg-rose-50',    text: 'text-rose-700' },
          missing: { label: 'Missing', dot: 'bg-rose-600',    bg: 'bg-rose-100',   text: 'text-rose-800' },
        };
        const deltaCell = (csv: number, crew: number) => {
          const d = csv - crew;
          return <span className={`font-black ${Math.abs(d) < 1 ? 'text-slate-300' : d > 0 ? 'text-amber-600' : 'text-rose-500'}`}>{d === 0 ? '—' : `${d > 0 ? '+' : '-'}${fmt(Math.abs(d))}`}</span>;
        };
        const consolidatedCsv = csvTotals.cash + csvTotals.upi + csvTotals.card;
        const consolidatedCrew = crewTotals.cash + crewTotals.upi + crewTotals.card;
        const totalDelta = consolidatedCsv - consolidatedCrew;
        return (
          <div className="space-y-6">
            {/* Consolidated totals strip */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Consolidated CSV Total', value: consolidatedCsv, cls: 'text-slate-900' },
                { label: 'Consolidated Crew Total', value: consolidatedCrew, cls: 'text-slate-900' },
                { label: 'Total Delta', value: totalDelta, cls: Math.abs(totalDelta) < 1 ? 'text-emerald-600' : totalDelta > 0 ? 'text-amber-600' : 'text-rose-500', signed: true },
              ].map(({ label, value, cls, signed }) => (
                <div key={label} className="bg-white border border-slate-100 rounded-[2rem] px-7 py-5 shadow-sm">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
                  <p className={`text-2xl font-black tracking-tighter ${cls}`}>{signed ? (value >= 0 ? '+' : '-') : ''}{fmt(Math.abs(value))}</p>
                </div>
              ))}
            </div>

            {/* Monthly per-channel summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {channels.map(ch => {
                const csv = csvTotals[ch.key as 'cash' | 'upi' | 'card'];
                const crew = crewTotals[ch.key as 'cash' | 'upi' | 'card'];
                const d = csv - crew;
                return (
                  <div key={ch.key} className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${ch.tint}`}>{ch.icon}</div>
                      <p className="text-xs font-black text-slate-500 uppercase tracking-widest">{ch.label}</p>
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">CSV</p>
                        <p className="text-lg font-black text-slate-900 tracking-tighter">{fmt(csv)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Crew</p>
                        <p className="text-lg font-black text-slate-900 tracking-tighter">{fmt(crew)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Delta</p>
                        <p className={`text-lg font-black tracking-tighter ${Math.abs(d) < 1 ? 'text-emerald-600' : d > 0 ? 'text-amber-600' : 'text-rose-500'}`}>{d >= 0 ? '+' : '-'}{fmt(Math.abs(d))}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Daily table */}
            <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-8 py-5 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl"><Scale size={18} /></div>
                  <div>
                    <h3 className="font-black text-slate-800 uppercase tracking-tight text-sm">Channel Delta — POS CSV vs Crew</h3>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest mt-0.5">Counter sales only (online excluded) · {selectedMonth} {selectedYear}</p>
                  </div>
                </div>
                <select
                  value={channelOutletFilter}
                  onChange={e => setChannelOutletFilter(e.target.value)}
                  className="text-[9px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-500 rounded-xl px-3 py-2 cursor-pointer transition-colors hover:border-indigo-300"
                >
                  <option value="all">All Stores</option>
                  {MASTER_OUTLETS.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              {otherTotal > 0 && (
                <div className="px-8 py-3 bg-amber-50 border-b border-amber-100 flex items-start gap-2">
                  <Info size={14} className="text-amber-600 mt-0.5 shrink-0" />
                  <p className="text-[11px] font-bold text-amber-700">
                    {fmt(otherTotal)} in unmapped payment modes not counted in Cash/UPI/Card:{' '}
                    {Object.entries(unmapped).map(([mode, amt]) => `${mode} (${fmt(amt as number)})`).join(', ')}
                  </p>
                </div>
              )}

              {rows.length === 0 ? (
                <div className="py-20 text-center">
                  <Scale size={40} className="mx-auto text-slate-200 mb-4" />
                  <p className="text-slate-400 font-black uppercase text-xs tracking-widest">No data for this period</p>
                  <p className="text-slate-300 text-xs font-medium mt-2">Upload a POS sales CSV or have crew log sales to compare</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-right whitespace-nowrap">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left px-6 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                        {['Cash', 'UPI', 'Card (Net)'].map(h => (
                          <th key={h} colSpan={3} className="px-6 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest border-l border-slate-100">{h}</th>
                        ))}
                        <th className="px-6 py-3 text-[9px] font-black text-slate-500 uppercase tracking-widest border-l border-slate-100">Total Δ</th>
                        <th className="px-6 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest border-l border-slate-100">Status</th>
                      </tr>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="px-6 py-2"></th>
                        {['cash', 'upi', 'card'].map(c => (
                          <React.Fragment key={c}>
                            <th className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase tracking-widest border-l border-slate-100">CSV</th>
                            <th className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase tracking-widest">Crew</th>
                            <th className="px-4 py-2 text-[8px] font-black text-slate-400 uppercase tracking-widest">Δ</th>
                          </React.Fragment>
                        ))}
                        <th className="border-l border-slate-100"></th>
                        <th className="border-l border-slate-100"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(row => {
                        const s = statusStyle[row.status];
                        const dayName = new Date(row.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
                        return (
                          <tr key={row.date} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                            <td className="text-left px-6 py-3 text-xs font-black text-slate-800">{dayName}</td>
                            {(['cash', 'upi', 'card'] as const).map(c => (
                              <React.Fragment key={c}>
                                <td className="px-4 py-3 text-xs font-bold text-slate-700 border-l border-slate-50">{row.csv[c] ? fmt(row.csv[c]) : '—'}</td>
                                <td className="px-4 py-3 text-xs font-bold text-slate-500">{row.crew[c] ? fmt(row.crew[c]) : '—'}</td>
                                <td className="px-4 py-3 text-xs">{deltaCell(row.csv[c], row.crew[c])}</td>
                              </React.Fragment>
                            ))}
                            <td className="px-6 py-3 text-xs border-l border-slate-50">{deltaCell(row.csv.cash + row.csv.upi + row.csv.card, row.crew.cash + row.crew.upi + row.crew.card)}</td>
                            <td className="px-6 py-3 text-center border-l border-slate-50">
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${s.bg} ${s.text}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                                {s.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-black">
                        <td className="text-left px-6 py-4 text-[10px] uppercase tracking-widest text-slate-500">Totals</td>
                        {(['cash', 'upi', 'card'] as const).map(c => (
                          <React.Fragment key={c}>
                            <td className="px-4 py-4 text-xs text-slate-800 border-l border-slate-100">{fmt(csvTotals[c])}</td>
                            <td className="px-4 py-4 text-xs text-slate-600">{fmt(crewTotals[c])}</td>
                            <td className="px-4 py-4 text-xs">{deltaCell(csvTotals[c], crewTotals[c])}</td>
                          </React.Fragment>
                        ))}
                        <td className="px-6 py-4 text-xs border-l border-slate-100">{deltaCell(consolidatedCsv, consolidatedCrew)}</td>
                        <td className="border-l border-slate-100"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {activeView === 'mapping' && <>
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-6 bg-indigo-50/50 p-6 rounded-[2.5rem] border border-indigo-100">
        <div className="flex items-center gap-6">
          <button 
            onClick={() => setFilterMode('unverified')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${filterMode === 'unverified' ? 'bg-rose-600 text-white shadow-lg' : 'bg-white text-slate-400'}`}
          >
            <AlertCircle size={14} /> Pending ({stats.unverified})
          </button>
          <button 
            onClick={() => setFilterMode('verified')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${filterMode === 'verified' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-slate-400'}`}
          >
            <CheckCircle2 size={14} /> Verified ({stats.verified})
          </button>
          <button 
            onClick={() => setFilterMode('all')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${filterMode === 'all' ? 'bg-slate-900 text-white shadow-lg' : 'bg-white text-slate-400'}`}
          >
            <Database size={14} /> All
          </button>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={handleBulkAutoMap}
            disabled={loading}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50"
          >
            <Sparkles size={14} /> Auto-Map month
          </button>
          
          <button 
            onClick={() => setIsAddingCategory(true)}
            className="flex items-center gap-2 px-6 py-3 bg-white text-slate-900 border border-slate-200 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
          >
            <Plus size={14} /> Custom Category
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showSummary ? (
          <motion.div 
            key="summary"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-10"
          >
            <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                <div className="flex items-center gap-4 mb-10">
                  <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><PieIcon size={24} /></div>
                  <div><h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Spending Anatomy</h3><p className="text-slate-400 text-xs font-medium">Categorical distribution of bank withdrawals.</p></div>
                </div>

                <div className="space-y-6">
                  {(Object.entries(stats.categoryBreakdown) as [string, number][])
                    .sort((a, b) => b[1] - a[1])
                    .map(([cat, val]) => (
                      <div key={cat} className="group">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-[10px] font-black uppercase tracking-widest ${cat === 'UNMAPPED' ? 'text-rose-500' : 'text-slate-500'}`}>{cat}</span>
                          <span className="text-sm font-black text-slate-900">₹{val.toLocaleString()}</span>
                        </div>
                        <div className="h-3 bg-slate-50 rounded-full overflow-hidden border border-slate-100">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${(val / (stats.totalValue || 1)) * 100}%` }}
                            className={`h-full ${cat === 'UNMAPPED' ? 'bg-rose-400' : 'bg-indigo-500'}`}
                          />
                        </div>
                      </div>
                    ))}
                  
                  {Object.keys(stats.categoryBreakdown).length === 0 && (
                    <div className="py-20 text-center">
                      <p className="text-xs font-black text-slate-300 uppercase">No mapped data available for this month</p>
                    </div>
                  )}
                </div>
            </div>

            <div className="bg-slate-900 p-10 rounded-[3rem] shadow-xl text-white overflow-hidden relative">
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full -mr-32 -mt-32 blur-3xl" />
              <div className="flex items-center gap-4 mb-10">
                <div className="p-3 bg-white/10 text-white rounded-2xl"><BarChart3 size={24} /></div>
                <div><h3 className="text-xl font-black text-white uppercase tracking-tight">Financial Health</h3><p className="text-indigo-300/50 text-xs font-medium">Month-to-date mapping efficiency.</p></div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                 <div className="bg-white/5 p-8 rounded-3xl border border-white/10">
                    <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">Total Managed</p>
                    <h4 className="text-3xl font-black text-white tracking-tighter">₹{stats.totalValue.toLocaleString()}</h4>
                 </div>
                 <div className="bg-white/5 p-8 rounded-3xl border border-white/10">
                    <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-2">Mapped Coverage</p>
                    <h4 className="text-3xl font-black text-white tracking-tighter">{stats.totalValue > 0 ? Math.round((stats.mappedValue / stats.totalValue) * 100) : 0}%</h4>
                 </div>
              </div>

              <div className="mt-10 p-8 bg-indigo-600 rounded-3xl shadow-inner border border-white/10">
                 <h5 className="text-[10px] font-black text-white uppercase tracking-widest mb-4 flex items-center gap-2">
                   <Sparkles size={12} /> System IQ
                 </h5>
                 <p className="text-indigo-100 text-sm font-medium leading-relaxed">
                   Your account has <b>{rules.length} active categorization rules</b>. The system has automatically identified <b>{filteredBT.filter(t => t.category || suggestCategory(t.description)).length} patterns</b> in your statement this month.
                 </p>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div 
            key="ledger"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden min-h-[600px] flex flex-col"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left border-separate border-spacing-0">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-8 py-6 border-b border-slate-100">
                      <div 
                        onClick={toggleSelectAll}
                        className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-all ${
                          selectedBatchIds.size === filteredBT.length && filteredBT.length > 0
                            ? 'bg-indigo-600 border-indigo-600' 
                            : 'bg-white border-slate-200'
                        }`}
                      >
                        {selectedBatchIds.size === filteredBT.length && filteredBT.length > 0 && <Check size={14} className="text-white" />}
                      </div>
                    </th>
                    <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Transaction Date</th>
                    <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Entity / Narration</th>
                    <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Amount</th>
                    <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Functional Category</th>
                    <th className="px-8 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredBT.map(bt => {
                    const suggestion = bt.category ? null : suggestCategory(bt.description);
                    const isUpdating = updatingId === bt.id;

                    return (
                      <tr key={bt.id} className={`group hover:bg-slate-50/50 transition-colors ${bt.isVerified ? 'opacity-60' : ''} ${selectedBatchIds.has(bt.id!) ? 'bg-indigo-50/30' : ''}`}>
                        <td className="px-8 py-6">
                           <div 
                             onClick={() => toggleSelectOne(bt.id!)}
                             className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center cursor-pointer transition-all ${
                               selectedBatchIds.has(bt.id!) 
                                 ? 'bg-indigo-600 border-indigo-600' 
                                 : 'bg-white border-slate-200 group-hover:border-indigo-300'
                             }`}
                           >
                             {selectedBatchIds.has(bt.id!) && <Check size={14} className="text-white" />}
                           </div>
                        </td>
                        <td className="px-8 py-6">
                           <div className="flex flex-col">
                             <span className="text-sm font-black text-slate-900">{new Date(bt.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                             <span className="text-[9px] font-bold text-slate-400 uppercase">{new Date(bt.date).getFullYear()}</span>
                           </div>
                        </td>
                        <td className="px-8 py-6 max-w-[280px] w-[280px]">
                           <p className="text-xs font-bold text-slate-700 uppercase leading-snug break-words line-clamp-3" title={bt.description}>{bt.description}</p>
                           {bt.referenceNo && !bt.referenceNo.startsWith('AUTO-') && (
                             <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">UTR: {bt.referenceNo}</span>
                           )}
                           {commentingId === bt.id ? (
                             <div className="mt-2" onClick={e => e.stopPropagation()}>
                               <textarea
                                 autoFocus
                                 rows={2}
                                 value={commentDraft}
                                 onChange={e => setCommentDraft(e.target.value)}
                                 onBlur={() => handleSaveComment(bt.id!, commentDraft)}
                                 onKeyDown={e => {
                                   if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveComment(bt.id!, commentDraft); }
                                   if (e.key === 'Escape') { setCommentingId(null); setCommentDraft(''); }
                                 }}
                                 placeholder="Add a note…"
                                 className="w-full mt-1 px-2 py-1.5 text-[10px] font-medium text-slate-600 bg-amber-50 border border-amber-200 rounded-lg resize-none outline-none focus:border-amber-400 placeholder:text-slate-300"
                               />
                               <p className="text-[8px] text-slate-300 font-bold uppercase mt-0.5">Enter to save · Esc to cancel</p>
                             </div>
                           ) : bt.comment ? (
                             <p
                               onClick={() => { setCommentingId(bt.id!); setCommentDraft(bt.comment!); }}
                               className="mt-1.5 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 cursor-pointer hover:bg-amber-100 transition-colors leading-snug"
                               title="Click to edit"
                             >
                               {bt.comment}
                             </p>
                           ) : null}
                        </td>
                        <td className="px-8 py-6">
                          <div className={`flex items-baseline gap-1 ${bt.type === 'credit' ? 'text-emerald-600' : 'text-slate-900'}`}>
                            <span className="text-xs font-black">₹</span>
                            <span className="text-lg font-black tracking-tighter">{bt.amount.toLocaleString()}</span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                           <div className="flex items-center gap-3">
                              <button 
                                onClick={() => findMatchingPurchases(bt, 0)}
                                className={`p-2 rounded-xl border transition-all ${discoveryTxn?.id === bt.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-400 border-slate-200 hover:text-indigo-600 hover:border-indigo-200'}`}
                                title="Find Matching Bills"
                              >
                                {isSearchingDiscovery && discoveryTxn?.id === bt.id ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                              </button>
                              <div className="relative">
                                <select 
                                  value={bt.category?.toUpperCase() || ''} 
                                  onChange={e => handleManualMap(bt.id!, e.target.value, false)}
                                  disabled={isUpdating}
                                  className={`pl-10 pr-10 py-2.5 rounded-xl text-[10px] font-black uppercase outline-none appearance-none border transition-all ${
                                    bt.category 
                                      ? 'bg-white border-slate-200 text-slate-900' 
                                      : 'bg-rose-50 border-rose-100 text-rose-500'
                                  }`}
                                >
                                  <option value="">Unmapped</option>
                                  {availableCategories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                  ))}
                                </select>
                                <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                              </div>

                              {!bt.category && suggestion && (
                                <button
                                  onClick={() => handleManualMap(bt.id!, suggestion, true)}
                                  className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[9px] font-black uppercase border border-indigo-100 animate-pulse"
                                >
                                  <Sparkles size={12} /> Map as {suggestion}?
                                </button>
                              )}
                           </div>
                        </td>
                        <td className="px-8 py-6 text-right">
                           <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={() => {
                                  if (commentingId === bt.id) { setCommentingId(null); setCommentDraft(''); }
                                  else { setCommentingId(bt.id!); setCommentDraft(bt.comment || ''); }
                                }}
                                className={`p-3 rounded-2xl transition-all border ${bt.comment ? 'bg-amber-50 text-amber-500 border-amber-100 hover:bg-amber-100' : 'text-slate-300 border-transparent hover:text-amber-500 hover:bg-amber-50 hover:border-amber-100'}`}
                                title={bt.comment ? 'Edit note' : 'Add note'}
                              >
                                <MessageSquare size={18} />
                              </button>
                              <button
                                onClick={() => handleDeleteTransaction(bt.id!)}
                                className="p-3 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-2xl transition-all"
                                title="Delete Record"
                              >
                                <Trash2 size={18} />
                              </button>

                              {/* Push to Purchases — only for debits not yet linked to any purchase */}
                              {bt.type === 'debit' && !bt.matchedPurchaseId && (
                                <button
                                  onClick={() => handlePushToPurchases(bt)}
                                  disabled={pushingId === bt.id}
                                  className="p-3 bg-amber-50 text-amber-600 rounded-2xl hover:bg-amber-600 hover:text-white transition-all border border-amber-100 shadow-sm disabled:opacity-50"
                                  title="Push to Purchase Records"
                                >
                                  {pushingId === bt.id ? <Loader2 size={18} className="animate-spin" /> : <PackagePlus size={18} />}
                                </button>
                              )}
                              {bt.pushedToPurchases && (
                                <div className="p-3 bg-amber-50 text-amber-500 rounded-2xl border border-amber-100" title="Pushed to Purchases">
                                  <PackagePlus size={18} />
                                </div>
                              )}

                              {bt.category && !bt.isVerified && (
                                <button
                                  onClick={() => handleManualMap(bt.id!, bt.category!, true)}
                                  className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-600 hover:text-white transition-all border border-emerald-100 shadow-sm"
                                  title="Confirm Intelligence"
                                >
                                  <Check size={18} />
                                </button>
                              )}
                              {bt.isVerified ? (
                                <div className="p-3 bg-slate-50 text-emerald-500 rounded-2xl border border-slate-100" title="Verified Transaction">
                                  <ShieldCheck size={18} />
                                </div>
                              ) : bt.category ? (
                                <button
                                  onClick={() => createRuleFromTransaction(bt.description, bt.category!)}
                                  className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl hover:bg-indigo-600 hover:text-white transition-all border border-indigo-100 shadow-sm"
                                  title="Create Learning Rule"
                                >
                                  <RefreshCcw size={18} />
                                </button>
                              ) : (
                                <div className="p-3 bg-rose-50 text-rose-400 rounded-2xl border border-rose-100" title="Pending Action">
                                  <AlertCircle size={18} />
                                </div>
                              )}
                           </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredBT.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-40 text-center">
                         <div className="flex flex-col items-center justify-center text-slate-300">
                           <CalendarDays size={64} className="mb-4 opacity-20" />
                           <h4 className="text-xl font-black uppercase">No Ledger Entries</h4>
                           <p className="text-[10px] font-bold uppercase mt-1">Upload statements for this period to begin reconciliation</p>
                         </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </>}

      {/* ── CATEGORY ANALYTICS PANEL ─────────────────────────────── */}
      {activeView === 'analytics' && (() => {
        const monthIdx = (MONTH_NAMES.indexOf(selectedMonth) + 1).toString().padStart(2, '0');
        const datePrefix = `${selectedYear}-${monthIdx}`;
        const periodBT: BankTransaction[] = bankTransactions
          .filter((t: BankTransaction) => t.date.startsWith(datePrefix))
          .filter((t: BankTransaction) => {
            if (selectedBankId !== 'all' && t.bankAccountId !== selectedBankId) return false;
            if (selectedType !== 'all' && t.type !== selectedType) return false;
            return true;
          });

        const catMap: Record<string, { debit: number; debitVerified: number; credit: number; creditVerified: number; count: number }> = {};
        let grandDebit = 0, grandCredit = 0;

        periodBT.forEach((t: BankTransaction) => {
          const cat = t.category?.toUpperCase() || 'UNMAPPED';
          if (!catMap[cat]) catMap[cat] = { debit: 0, debitVerified: 0, credit: 0, creditVerified: 0, count: 0 };
          const amt = Number(t.amount) || 0;
          catMap[cat].count++;
          if (t.type === 'debit') {
            catMap[cat].debit += amt;
            if (t.isVerified) catMap[cat].debitVerified += amt;
            grandDebit += amt;
          } else {
            catMap[cat].credit += amt;
            if (t.isVerified) catMap[cat].creditVerified += amt;
            grandCredit += amt;
          }
        });

        const catEntries = Object.entries(catMap).sort((a, b) => (b[1].debit + b[1].credit) - (a[1].debit + a[1].credit));
        const mappedDebit = catEntries.filter(([c]) => c !== 'UNMAPPED').reduce((s, [, v]) => s + v.debit, 0);
        const verifiedDebit = Object.values(catMap).reduce((s, v) => s + v.debitVerified, 0);
        const mappedPct = grandDebit > 0 ? Math.round((mappedDebit / grandDebit) * 100) : 0;
        const verifiedPct = grandDebit > 0 ? Math.round((verifiedDebit / grandDebit) * 100) : 0;

        return (
          <div className="space-y-8">
            {/* Summary strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Outflow', value: grandDebit, sub: `${periodBT.filter((t: BankTransaction) => t.type === 'debit').length} debit transactions`, color: 'slate', sign: '' },
                { label: 'Total Inflow', value: grandCredit, sub: `${periodBT.filter((t: BankTransaction) => t.type === 'credit').length} credit transactions`, color: 'emerald', sign: '+' },
                { label: 'Mapped Spend', value: mappedDebit, sub: `${mappedPct}% of outflows categorised`, color: 'indigo', sign: '' },
                { label: 'Verified Spend', value: verifiedDebit, sub: `${verifiedPct}% of outflows confirmed`, color: 'violet', sign: '' },
              ].map(({ label, value, sub, color, sign }) => (
                <div key={label} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm px-7 py-6">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">{label}</p>
                  <p className={`text-2xl font-black tracking-tighter text-${color}-600`}>{sign}₹{value.toLocaleString('en-IN')}</p>
                  <p className="text-[9px] font-bold text-slate-400 mt-1.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* Category breakdown */}
            {(() => {
              const PALETTE = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6','#f97316','#84cc16','#06b6d4','#a855f7'];
              const maxTotal = Math.max(...catEntries.map(([, s]) => s.debit + s.credit), 1);
              const vbarData = catEntries.map(([cat, s]) => ({ cat: cat.length > 8 ? cat.slice(0, 7) + '…' : cat, verified: s.debitVerified, pending: s.debit - s.debitVerified, total: s.debit + s.credit }));
              const donutData = catEntries.map(([cat, s]) => ({ name: cat, value: s.debit + s.credit }));

              return (
                <div className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden">
                  {/* Header with view toggle */}
                  <div className="px-10 py-6 border-b border-slate-50 flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><BarChart3 size={20} /></div>
                      <div>
                        <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Category Breakdown</h3>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5">{selectedMonth} {selectedYear} · {catEntries.length} categories</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-2xl">
                      {([
                        { id: 'list',  icon: <List size={13} />,         label: 'List'     },
                        { id: 'hbar',  icon: <AlignJustify size={13} />, label: 'H-Bars'   },
                        { id: 'vbar',  icon: <BarChart3 size={13} />,    label: 'Columns'  },
                        { id: 'donut', icon: <PieIcon size={13} />,      label: 'Donut'    },
                      ] as { id: 'list'|'hbar'|'vbar'|'donut'; icon: React.ReactNode; label: string }[]).map(v => (
                        <button
                          key={v.id}
                          onClick={() => setAnalyticsView(v.id)}
                          title={v.label}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${analyticsView === v.id ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          {v.icon}<span className="hidden sm:inline">{v.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {catEntries.length === 0 ? (
                    <div className="py-24 text-center">
                      <p className="text-xs font-black text-slate-300 uppercase">No transactions for this period</p>
                    </div>
                  ) : (
                    <AnimatePresence mode="wait">
                      <motion.div key={analyticsView} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>

                        {/* ── LIST view ── */}
                        {analyticsView === 'list' && (
                          <div className="divide-y divide-slate-50">
                            {catEntries.map(([cat, s]) => {
                              const total = s.debit + s.credit;
                              const pendingDebit = s.debit - s.debitVerified;
                              const verifiedFrac = s.debit > 0 ? s.debitVerified / s.debit : 0;
                              const isUnmapped = cat === 'UNMAPPED';
                              return (
                                <div key={cat} className={`px-10 py-6 transition-colors ${isUnmapped ? 'bg-rose-50/40' : 'hover:bg-slate-50/60'}`}>
                                  <div className="flex items-start justify-between gap-4 mb-3">
                                    <div className="flex items-center gap-2">
                                      <span className={`text-[11px] font-black uppercase tracking-widest ${isUnmapped ? 'text-rose-400' : 'text-slate-600'}`}>{cat}</span>
                                      <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{s.count} txn{s.count !== 1 ? 's' : ''}</span>
                                    </div>
                                    <p className={`text-lg font-black tracking-tighter ${isUnmapped ? 'text-rose-500' : 'text-slate-900'}`}>₹{total.toLocaleString('en-IN')}</p>
                                  </div>
                                  {s.debit > 0 && (
                                    <>
                                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
                                        <div className="h-full flex">
                                          <div className="h-full bg-emerald-400" style={{ width: `${verifiedFrac * 100}%` }} />
                                          <div className="h-full bg-rose-300" style={{ width: `${(1 - verifiedFrac) * 100}%` }} />
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-4 flex-wrap">
                                        <span className="flex items-center gap-1 text-[9px] font-black text-slate-400 uppercase"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> Verified ₹{s.debitVerified.toLocaleString('en-IN')}</span>
                                        <span className="flex items-center gap-1 text-[9px] font-black text-slate-400 uppercase"><span className="w-1.5 h-1.5 rounded-full bg-rose-300 inline-block" /> Pending ₹{pendingDebit.toLocaleString('en-IN')}</span>
                                        {s.credit > 0 && <span className="ml-auto text-[9px] font-black text-emerald-600">+₹{s.credit.toLocaleString('en-IN')} inflow</span>}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* ── HORIZONTAL BARS view ── */}
                        {analyticsView === 'hbar' && (
                          <div className="px-10 py-6 space-y-4">
                            {catEntries.map(([cat, s], i) => {
                              const total = s.debit + s.credit;
                              const widthPct = (total / maxTotal) * 100;
                              const verifiedPct = total > 0 ? (s.debitVerified / total) * 100 : 0;
                              const pendingPct = total > 0 ? ((s.debit - s.debitVerified) / total) * 100 : 0;
                              const isUnmapped = cat === 'UNMAPPED';
                              return (
                                <div key={cat} className="grid items-center gap-3" style={{ gridTemplateColumns: '9rem 1fr 7rem' }}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`text-[9px] font-black uppercase tracking-widest truncate ${isUnmapped ? 'text-rose-400' : 'text-slate-500'}`}>{cat}</span>
                                  </div>
                                  <div className="relative h-7 bg-slate-100 rounded-xl overflow-hidden">
                                    <div className="absolute inset-y-0 left-0 flex h-full rounded-xl overflow-hidden transition-all duration-700" style={{ width: `${widthPct}%` }}>
                                      <div className="h-full bg-emerald-400" style={{ width: `${verifiedPct}%` }} />
                                      <div className={`h-full ${isUnmapped ? 'bg-rose-400' : 'bg-indigo-400'}`} style={{ width: `${pendingPct}%` }} />
                                    </div>
                                  </div>
                                  <p className={`text-xs font-black tracking-tighter text-right ${isUnmapped ? 'text-rose-500' : 'text-slate-800'}`}>₹{total.toLocaleString('en-IN')}</p>
                                </div>
                              );
                            })}
                            <div className="flex items-center gap-4 pt-2 border-t border-slate-100 mt-2">
                              <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase"><span className="w-2 h-2 rounded-sm bg-emerald-400 inline-block" /> Verified</span>
                              <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase"><span className="w-2 h-2 rounded-sm bg-indigo-400 inline-block" /> Pending / Mapped</span>
                              <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase"><span className="w-2 h-2 rounded-sm bg-rose-400 inline-block" /> Unmapped</span>
                            </div>
                          </div>
                        )}

                        {/* ── VERTICAL BAR CHART view ── */}
                        {analyticsView === 'vbar' && (
                          <div className="px-6 pt-6 pb-4">
                            <ResponsiveContainer width="100%" height={320}>
                              <BarChart data={vbarData} margin={{ top: 10, right: 10, bottom: 50, left: 10 }} barSize={28}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                <XAxis dataKey="cat" tick={{ fontSize: 9, fontWeight: 800, fill: '#94a3b8', textTransform: 'uppercase' }} angle={-35} textAnchor="end" interval={0} />
                                <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={(v: number) => v >= 100000 ? `₹${(v/100000).toFixed(1)}L` : v >= 1000 ? `₹${(v/1000).toFixed(0)}K` : `₹${v}`} axisLine={false} tickLine={false} />
                                <Tooltip
                                  formatter={(value: number, name: string) => [`₹${value.toLocaleString('en-IN')}`, name === 'verified' ? 'Verified' : 'Pending']}
                                  contentStyle={{ borderRadius: '1rem', border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 800 }}
                                  cursor={{ fill: '#f8fafc' }}
                                />
                                <Bar dataKey="verified" stackId="a" fill="#34d399" name="Verified" />
                                <Bar dataKey="pending" stackId="a" fill="#818cf8" name="Pending" radius={[6, 6, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                            <div className="flex items-center justify-center gap-6 mt-1">
                              <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase"><span className="w-3 h-3 rounded-sm bg-emerald-400 inline-block" /> Verified</span>
                              <span className="flex items-center gap-1.5 text-[9px] font-black text-slate-400 uppercase"><span className="w-3 h-3 rounded-sm bg-indigo-400 inline-block" /> Pending</span>
                            </div>
                          </div>
                        )}

                        {/* ── DONUT view ── */}
                        {analyticsView === 'donut' && (
                          <div className="px-6 pt-6 pb-4">
                            <ResponsiveContainer width="100%" height={320}>
                              <PieChart>
                                <Pie data={donutData} cx="50%" cy="50%" innerRadius={75} outerRadius={130} paddingAngle={2} dataKey="value" nameKey="name">
                                  {donutData.map((_, i) => (
                                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} stroke="white" strokeWidth={2} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  formatter={(value: number, name: string) => [`₹${value.toLocaleString('en-IN')}`, name]}
                                  contentStyle={{ borderRadius: '1rem', border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 800 }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-2 px-4">
                              {donutData.map((d, i) => (
                                <span key={d.name} className="flex items-center gap-1.5 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                                  <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                                  {d.name}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                      </motion.div>
                    </AnimatePresence>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Manual Category Modal */}
      <AnimatePresence>
        {isAddingCategory && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
             <motion.div 
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 0.9 }}
               className="bg-white rounded-[3rem] w-full max-w-md shadow-2xl overflow-hidden border border-slate-100"
             >
                <div className="p-10 border-b border-slate-50">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl shadow-sm"><IndianRupee size={32} /></div>
                    <div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Custom Category</h3><p className="text-slate-400 text-sm font-medium">Expand your chart of accounts.</p></div>
                  </div>
                  <div className="space-y-4">
                     <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category Name</label>
                     <input 
                       type="text" 
                       placeholder="e.g. MARKETING / LOANS"
                       value={newCategoryName}
                       onChange={e => setNewCategoryName(e.target.value)}
                       className="w-full px-6 py-4 bg-slate-50 rounded-2xl font-bold text-slate-700 border border-slate-100 outline-none focus:ring-2 ring-indigo-500/20"
                     />
                  </div>
                </div>
                <div className="p-6 bg-slate-50 flex gap-4">
                  <button onClick={() => setIsAddingCategory(false)} className="flex-1 py-4 bg-white text-slate-400 rounded-2xl font-black uppercase text-[10px] tracking-widest border border-slate-200">Cancel</button>
                  <button onClick={handleAddCategory} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-indigo-100">Add Category</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Match Discovery Modal */}
      <AnimatePresence>
        {discoveryTxn && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-[3rem] w-full max-w-4xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[85vh]"
            >
              <div className="p-10 border-b border-slate-50 shrink-0">
                <div className="flex items-center justify-between gap-6 mb-8">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><Search size={24} /></div>
                    <div>
                      <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">Match Discovery</h3>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Searching related bills & purchase evidence</p>
                    </div>
                  </div>
                  <button onClick={() => setDiscoveryTxn(null)} className="p-3 text-slate-400 hover:text-slate-900 bg-slate-50 rounded-2xl transition-all">
                    <Plus size={20} className="rotate-45" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-6 rounded-3xl border border-slate-100">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Transaction Source</p>
                    <p className="text-sm font-black text-slate-900 truncate">{discoveryTxn.description}</p>
                    <div className="flex items-center gap-4 mt-2">
                       <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">₹{discoveryTxn.amount.toLocaleString()}</span>
                       <span className="text-[10px] font-bold text-slate-400 uppercase">{new Date(discoveryTxn.date).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-2">Search Range:</span>
                    {[0, 1, 2].map(days => (
                      <button
                        key={days}
                        onClick={() => findMatchingPurchases(discoveryTxn, days)}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${discoveryDateRange === days ? 'bg-indigo-600 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}
                      >
                        +{days} Day{days !== 1 ? 's' : ''}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-10">
                {isSearchingDiscovery ? (
                  <div className="flex flex-col items-center justify-center py-20 grayscale opacity-40">
                    <Loader2 size={48} className="animate-spin text-indigo-600 mb-4" />
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Querying Datacenter...</p>
                  </div>
                ) : discoveryResults.length === 0 ? (
                  <div className="text-center py-20 border-2 border-dashed border-slate-100 rounded-[2rem]">
                    <Database size={48} className="mx-auto text-slate-200 mb-4" />
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest">No matching bills found</h4>
                    <p className="text-[9px] font-bold text-slate-300 uppercase mt-1">Try expanding the date range above</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {discoveryResults.map(p => {
                      const amountDiff = Math.abs(p.amount - discoveryTxn.amount);
                      const isExact = amountDiff < 1;
                      
                      return (
                        <div key={p.id} className={`p-6 rounded-[2rem] border transition-all hover:shadow-lg flex items-start justify-between gap-4 ${isExact ? 'bg-emerald-50 border-emerald-100' : 'bg-white border-slate-100'}`}>
                          <div>
                             <div className="flex items-center gap-2 mb-1">
                               <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${isExact ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white'}`}>
                                 {getOutletName(p.outletId || 'GLOBAL')}
                               </span>
                               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{p.billNo || 'No Bill #'}</span>
                             </div>
                             <h5 className="text-sm font-black text-slate-900 line-clamp-1 mb-2">{p.productName}</h5>
                             <div className="flex items-center gap-4">
                                <span className={`text-lg font-black tracking-tighter ${isExact ? 'text-emerald-600' : 'text-slate-900'}`}>₹{p.amount.toLocaleString()}</span>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">{new Date(p.date).toLocaleDateString()}</span>
                             </div>
                          </div>

                          <button 
                            onClick={async () => {
                              await handleManualMap(discoveryTxn.id!, (p.category || 'COGS').toUpperCase(), true, p.id);
                              setDiscoveryTxn(null);
                            }}
                            className={`p-3 rounded-2xl transition-all ${isExact ? 'bg-emerald-600 text-white shadow-emerald-200' : 'bg-slate-900 text-white shadow-slate-200'} shadow-xl`}
                            title="Auto-Map Category"
                          >
                            <ArrowRightLeft size={18} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="bg-indigo-900 rounded-[3rem] p-10 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 p-10 opacity-10"><BrainCircuit size={120} /></div>
        <div className="flex items-start gap-8 relative z-10">
          <div className="p-5 bg-white/10 rounded-[2rem] border border-white/10 shadow-inner"><Info size={40} className="text-indigo-200" /></div>
          <div className="space-y-4 max-w-3xl">
            <h4 className="text-2xl font-black uppercase tracking-tight">System Intelligence Mode</h4>
            <p className="text-indigo-100/70 text-base leading-relaxed">
              This module operates on a <b>Keyword Intelligence Engine</b>. When you link a transaction description to a category (e.g. "Rental Group" to RENTALS), the system memorizes this pattern. 
            </p>
            <p className="text-indigo-100/70 text-base leading-relaxed">
              Mappings will be used to generate your <b>P&L Profitability Snapshots</b>. Any withdrawal without a category is treated as "Unmapped Leakage" and will negatively impact your Health Index.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BankReconciliation;
