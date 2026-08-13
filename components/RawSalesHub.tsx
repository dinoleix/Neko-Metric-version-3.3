
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, orderBy, limit, doc, getDoc, increment, writeBatch, deleteDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getCachedCollection } from '../referenceCache';
import { 
  SalesSummaryRecord, 
  ItemSalesRecord, 
  StoreRental, 
  getOutletName, 
  ExpenseRecord, 
  PurchaseRecord, 
  CategorySettings, 
  DEFAULT_COGS, 
  DEFAULT_LABOUR, 
  DEFAULT_OPS, 
  YEAR_OPTIONS, 
  MONTH_NAMES 
} from '../types';
import { 
  RefreshCw, 
  MapPin, 
  Calculator,
  CheckCircle2,
  Store,
  Smartphone,
  ShieldAlert,
  Loader2,
  Database,
  Search,
  SearchX,
  Edit3,
  X,
  Save,
  Info,
  Filter,
  ArrowUpDown,
  Trash2,
  Receipt,
  ShoppingCart,
  AlertTriangle,
  History,
  Check,
  SearchCode,
  ArrowRight,
  ShieldQuestion,
  CalendarDays,
  CheckSquare,
  Square,
  Hash,
  RotateCcw
} from 'lucide-react';

type VerifyMode = 'sales' | 'online-orders' | 'online-items' | 'expenses' | 'purchases';

const RawSalesHub: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [activeView, setActiveView] = useState<VerifyMode>('sales');
  const [records, setRecords] = useState<SalesSummaryRecord[]>([]);
  const [onlineOrders, setOnlineOrders] = useState<any[]>([]);
  const [itemRecords, setItemRecords] = useState<ItemSalesRecord[]>([]);
  const [expenseRecords, setExpenseRecords] = useState<ExpenseRecord[]>([]);
  const [purchaseRecords, setPurchaseRecords] = useState<PurchaseRecord[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [storeFilter, setStoreFilter] = useState<'all' | string>('all');
  const [showManualOnly, setShowManualOnly] = useState(false);
  const [showUncategorizedOnly, setShowUncategorizedOnly] = useState(false);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [itemSearchTerm, setItemSearchTerm] = useState('');
  const [settings, setSettings] = useState<CategorySettings>({
    cogsKeywords: DEFAULT_COGS,
    labourKeywords: DEFAULT_LABOUR,
    opsKeywords: DEFAULT_OPS,
    cogsBucketMapping: {}
  });

  const [editingRecord, setEditingRecord] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ revenue: '', tax: '', commission: '', amount: '', category: '', description: '', productName: '' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  useEffect(() => {
    const fetchPrerequisites = async () => {
      try {
        const setRef = doc(db, 'category_settings', dataOwnerId);
        const [setSnap, rentArr] = await Promise.all([
          getDoc(setRef),
          getCachedCollection<StoreRental>('rentals', dataOwnerId)
        ]);
        if (setSnap.exists()) setSettings(setSnap.data() as CategorySettings);
        setRentals(rentArr);
      } catch (err) { console.error(err); }
    };
    fetchPrerequisites();
  }, [user]);

  const fetchData = async () => {
    setLoading(true);
    setSelectedIds(new Set());
    try {
      const constraints = [where('userId', '==', dataOwnerId)];
      
      // BUG-15 fix: cap all unbounded queries to prevent runaway Firestore reads at scale
      const CAP = limit(500);
      if (activeView === 'sales') {
        const sSnap = await getDocs(query(collection(db, 'sales_summary'), ...constraints, CAP));
        setRecords(sSnap.docs.map(d => ({ ...d.data(), id: d.id } as SalesSummaryRecord)));
      } else if (activeView === 'online-orders') {
        const oSnap = await getDocs(query(collection(db, 'online_order_details'), ...constraints, CAP));
        setOnlineOrders(oSnap.docs.map(d => ({ ...d.data(), id: d.id })));
      } else if (activeView === 'online-items') {
        const iSnap = await getDocs(query(collection(db, 'item_sales'), where('userId', '==', dataOwnerId), where('isPlatform', '==', true), limit(1000)));
        setItemRecords(iSnap.docs.map(d => ({ ...d.data(), id: d.id } as ItemSalesRecord)));
      } else if (activeView === 'expenses') {
        const eSnap = await getDocs(query(collection(db, 'expenses'), ...constraints, CAP));
        setExpenseRecords(eSnap.docs.map(d => ({ ...d.data(), id: d.id } as ExpenseRecord)));
      } else if (activeView === 'purchases') {
        const pSnap = await getDocs(query(collection(db, 'purchases'), ...constraints, CAP));
        setPurchaseRecords(pSnap.docs.map(d => ({ ...d.data(), id: d.id } as PurchaseRecord)));
      }
      setHasSearched(true);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { 
    if (user) {
      setSelectedIds(new Set());
      fetchData(); 
    }
  }, [activeView, user]);

  const isUncategorized = (category: string) => {
    const upper = (category || '').trim().toUpperCase();
    if (!upper) return true;
    return !settings.cogsKeywords.includes(upper) && !settings.labourKeywords.includes(upper) && !settings.opsKeywords.includes(upper);
  };

  const salesAnalytics = useMemo(() => {
    const selectedMonthIdx = MONTH_NAMES.indexOf(selectedMonth);
    const selectedYearNum = parseInt(selectedYear);
    
    const selectedOutlet = rentals.find(rent => rent.outletId === storeFilter);
    const selectedStoreName = selectedOutlet?.storeName;
    
    const filtered = records.filter(r => {
      const d = new Date(r.date);
      if (isNaN(d.getTime())) return false;
      
      const rYear = d.getFullYear().toString();
      const rMonth = MONTH_NAMES[d.getMonth()];
      
      const matchesDate = rYear === selectedYear && (selectedMonth === 'All Months' || rMonth === selectedMonth);
      const matchesStore = storeFilter === 'all' || r.outletId === storeFilter || (selectedStoreName && r.outletId === selectedStoreName);
      const matchesManual = !showManualOnly || r._fileId === 'manual_online_entry';
      return matchesDate && matchesStore && matchesManual;
    }).sort((a, b) => b.date.localeCompare(a.date));
    
    return { recordCount: filtered.length, rawData: filtered };
  }, [records, storeFilter, selectedMonth, selectedYear, showManualOnly]);

  const expenseAnalytics = useMemo(() => {
    const selectedMonthIdx = MONTH_NAMES.indexOf(selectedMonth);
    const selectedYearNum = parseInt(selectedYear);
    const selectedOutlet = rentals.find(rent => rent.outletId === storeFilter);
    const selectedStoreName = selectedOutlet?.storeName;
    const raw = activeView === 'expenses' ? expenseRecords : purchaseRecords;
    
    const filtered = raw.filter(r => {
      const d = new Date(r.date);
      if (isNaN(d.getTime())) return false;
      const rYear = d.getFullYear().toString();
      const rMonth = MONTH_NAMES[d.getMonth()];

      const matchesDate = rYear === selectedYear && (selectedMonth === 'All Months' || rMonth === selectedMonth);
      const matchesStore = storeFilter === 'all' || r.outletId === storeFilter || (selectedStoreName && r.outletId === selectedStoreName);
      const unmapped = isUncategorized(r.category);
      const matchesUncat = !showUncategorizedOnly || unmapped;
      return matchesDate && matchesStore && matchesUncat;
    }).sort((a, b) => b.date.localeCompare(a.date));
    
    return { rawData: filtered, recordCount: filtered.length };
  }, [expenseRecords, purchaseRecords, activeView, selectedMonth, selectedYear, storeFilter, showUncategorizedOnly, settings]);

  const itemAnalytics = useMemo(() => {
    const selectedMonthIdx = MONTH_NAMES.indexOf(selectedMonth);
    const selectedYearNum = parseInt(selectedYear);
    
    const selectedOutlet = rentals.find(rent => rent.outletId === storeFilter);
    const selectedStoreName = selectedOutlet?.storeName;
    
    const filtered = itemRecords.filter(r => {
      const d = new Date(r.date);
      if (isNaN(d.getTime())) return false;
      const rYear = d.getFullYear().toString();
      const rMonth = MONTH_NAMES[d.getMonth()];

      const matchesDate = rYear === selectedYear && (selectedMonth === 'All Months' || rMonth === selectedMonth);
      const matchesStore = storeFilter === 'all' || r.outletId === storeFilter || (selectedStoreName && r.outletId === selectedStoreName);
      const matchesSearch = !itemSearchTerm || (r.itemName || '').toLowerCase().includes(itemSearchTerm.toLowerCase());
      return matchesDate && matchesStore && matchesSearch;
    }).sort((a, b) => b.date.localeCompare(a.date));
    
    return { rawData: filtered, recordCount: filtered.length };
  }, [itemRecords, storeFilter, selectedMonth, selectedYear, itemSearchTerm]);

  const currentVisibleItems = useMemo(() => {
    if (activeView === 'sales') return salesAnalytics.rawData;
    if (activeView === 'online-orders') {
      const selectedOutlet = rentals.find(rent => rent.outletId === storeFilter);
      const selectedStoreName = selectedOutlet?.storeName;

      return onlineOrders.filter(r => {
        const d = new Date(r.orderDate || "");
        if (isNaN(d.getTime())) return false;
        const rYear = d.getFullYear().toString();
        const rMonth = MONTH_NAMES[d.getMonth()];
        const matchesDate = rYear === selectedYear && (selectedMonth === 'All Months' || rMonth === selectedMonth);
        const matchesStore = storeFilter === 'all' || r.outletId === storeFilter || (selectedStoreName && r.outletId === selectedStoreName);
        return matchesDate && matchesStore;
      }).sort((a, b) => b.orderDate.localeCompare(a.orderDate));
    }
    if (activeView === 'expenses' || activeView === 'purchases') return expenseAnalytics.rawData;
    if (activeView === 'online-items') return itemAnalytics.rawData;
    return [];
  }, [activeView, salesAnalytics, expenseAnalytics, itemAnalytics]);

  const activeOutletOptions = useMemo(() => {
    return rentals.map(r => ({ id: r.outletId, name: r.storeName }));
  }, [rentals]);

  const toggleItemSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllSelection = () => {
    if (selectedIds.size === currentVisibleItems.length && currentVisibleItems.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(currentVisibleItems.map(item => item.id!)));
    }
  };

  const resetAllFilters = () => {
    setStoreFilter('all');
    setShowManualOnly(false);
    setShowUncategorizedOnly(false);
    setItemSearchTerm('');
  };

  const handleBulkDelete = async (ids?: string[]) => {
    const targets = ids ? ids : Array.from(selectedIds);
    if (targets.length === 0) return;
    if (!confirm(`Permanently delete ${targets.length} record(s)? Snapshots will be updated.`)) return;

    setIsBulkDeleting(true);
    try {
      const collectionName = activeView === 'sales' ? 'sales_summary' : (activeView === 'online-orders' ? 'online_order_details' : (activeView === 'expenses' ? 'expenses' : (activeView === 'purchases' ? 'purchases' : 'item_sales')));
      const itemsToDelete = currentVisibleItems.filter(item => targets.includes(item.id!));
      
      const snapshotImpacts: Record<string, any> = {};
      const batchChunks: any[] = [];
      let currentBatch = writeBatch(db);
      let opCount = 0;

      for (const record of itemsToDelete) {
        if (opCount >= 400) { batchChunks.push(currentBatch); currentBatch = writeBatch(db); opCount = 0; }
        currentBatch.delete(doc(db, collectionName, record.id!));
        opCount++;

        const d = new Date(record.date || record.orderDate || '');
        if (isNaN(d.getTime())) continue;

        const rYear = d.getFullYear().toString();
        const rMonth = MONTH_NAMES[d.getMonth()];
        const oId = record.outletId || 'Unassigned';

        if (activeView === 'sales' || activeView === 'online-orders') {
          const snapId = `${user.uid}_${oId}_${rYear}_${rMonth}`;
          const key = `sales_snapshots_${snapId}`;
          if (!snapshotImpacts[key]) snapshotImpacts[key] = { ref: doc(db, 'sales_snapshots', snapId), deltas: {} };
          const dObj = snapshotImpacts[key].deltas;
          
          if (activeView === 'sales') {
            const isOnline = record.onlinePlatform && record.onlinePlatform.toLowerCase() !== 'none';
            if (!isOnline) { 
              dObj.totalOrderCount = (dObj.totalOrderCount || 0) - 1; 
              if (record.orderStatus === 'CANCELLED') dObj.cancelledOrderCount = (dObj.cancelledOrderCount || 0) - 1; 
            }
            
            if (['SETTLED', 'PICKEDUP', 'DELIVERED'].includes((record.orderStatus || '').toUpperCase())) {
              if (!isOnline) { 
                dObj.posGoodGross = (dObj.posGoodGross || 0) - (record.revenue || 0); 
                dObj.posGoodTax = (dObj.posGoodTax || 0) - (record.totalTax || 0); 
                dObj.posGoodNet = (dObj.posGoodNet || 0) - ((record.revenue || 0) - (record.totalTax || 0)); 
                dObj.settledOrderCount = (dObj.settledOrderCount || 0) - 1; 
              } else { 
                dObj.onlineGoodGross = (dObj.onlineGoodGross || 0) - (record.revenue || 0); 
                dObj.onlineGoodTax = (dObj.onlineGoodTax || 0) - (record.totalTax || 0); 
                dObj.onlineGoodComm = (dObj.onlineGoodComm || 0) - (record.commission || 0); 
                dObj.onlineGoodNet = (dObj.onlineGoodNet || 0) - (record.netPayout || 0); 
              }
              const dayIdx = d.getDate() - 1;
              if (dayIdx >= 0 && dayIdx < 31) {
                  dObj[`dailyTrend.${dayIdx}`] = (dObj[`dailyTrend.${dayIdx}`] || 0) - (record.revenue || 0);
              }
            }
          } else {
            // online-orders
            const status = (record.orderStatus || '').toUpperCase();
            const isSettled = ['SETTLED', 'PICKEDUP', 'DELIVERED'].includes(status);
            const isCancelled = status === 'CANCELLED';
            
            dObj.totalOrderCount = (dObj.totalOrderCount || 0) - 1;
            if (isCancelled) dObj.cancelledOrderCount = (dObj.cancelledOrderCount || 0) - 1;
            
            if (isSettled) {
              const rev = (record.itemTotal || 0) + (record.packagingCharge || 0) + (record.totalTax || 0) - (record.discount || 0);
              dObj.onlineGoodGross = (dObj.onlineGoodGross || 0) - rev;
              dObj.onlineGoodTax = (dObj.onlineGoodTax || 0) - (record.totalTax || 0);
              dObj.onlineGoodComm = (dObj.onlineGoodComm || 0) - (record.commission || 0);
              dObj.onlineGoodNet = (dObj.onlineGoodNet || 0) - (record.netPayout || 0);
              dObj.settledOrderCount = (dObj.settledOrderCount || 0) - 1;
              
              const dayIdx = d.getDate() - 1;
              if (dayIdx >= 0 && dayIdx < 31) {
                dObj[`dailyTrend.${dayIdx}`] = (dObj[`dailyTrend.${dayIdx}`] || 0) - rev;
              }
            }
          }
        } else if (activeView === 'expenses' || activeView === 'purchases') {
          const snapId = `${user.uid}_${oId}_${rYear}_${rMonth}`;
          const key = `expense_snapshots_${snapId}`;
          if (!snapshotImpacts[key]) snapshotImpacts[key] = { ref: doc(db, 'expense_snapshots', snapId), deltas: {} };
          const dObj = snapshotImpacts[key].deltas;
          const amt = Number(record.amount || 0);
          const cat = (record.category || '').toUpperCase();
          const totalField = activeView === 'expenses' ? 'totalExpense' : 'totalPurchase';
          const catField = activeView === 'expenses' ? 'expenseByCategory' : 'purchaseByCategory';
          dObj[totalField] = (dObj[totalField] || 0) - amt;
          dObj[`${catField}.${cat}`] = (dObj[`${catField}.${cat}`] || 0) - amt;
          if (settings.cogsKeywords.includes(cat)) { const bucket = settings.cogsBucketMapping?.[cat] || 'FOOD'; dObj[`cogsBucketAgg.${bucket}`] = (dObj[`cogsBucketAgg.${bucket}`] || 0) - amt; }
        } else if (activeView === 'online-items') {
           const itemStatus = (record.orderStatus || '').toUpperCase();
           const itemIsSettled = ['SETTLED', 'PICKEDUP', 'DELIVERED'].includes(itemStatus);
           if (itemIsSettled) {
             const snapId = `${user.uid}_${oId}_${rYear}_${rMonth}`;
             const key = `item_snapshots_${snapId}`;
             if (!snapshotImpacts[key]) snapshotImpacts[key] = { ref: doc(db, 'item_snapshots', snapId), deltas: {} };
             const dObj = snapshotImpacts[key].deltas;
             const name = (record.itemName || '').trim().toUpperCase();
             const qty = Number(record.itemQuantity || 0);
             const total = Number(record.itemTotal || 0);
             dObj[`items.${name}.quantity`] = (dObj[`items.${name}.quantity`] || 0) - qty;
             dObj[`items.${name}.revenue`] = (dObj[`items.${name}.revenue`] || 0) - total;
             if (record.isPlatform) {
               dObj[`items.${name}.onlineQuantity`] = (dObj[`items.${name}.onlineQuantity`] || 0) - qty;
               // Keep platformBreakdown in step with onlineQuantity, or online
               // revenue drifts upward every time a record is removed.
               const plat = (record.platform || 'UNKNOWN').toUpperCase();
               dObj[`items.${name}.platformBreakdown.${plat}.quantity`] = (dObj[`items.${name}.platformBreakdown.${plat}.quantity`] || 0) - qty;
               dObj[`items.${name}.platformBreakdown.${plat}.revenue`] = (dObj[`items.${name}.platformBreakdown.${plat}.revenue`] || 0) - total;
             }
             else dObj[`items.${name}.posQuantity`] = (dObj[`items.${name}.posQuantity`] || 0) - qty;
           }
        }
      }

      for (const key in snapshotImpacts) {
        const { ref, deltas } = snapshotImpacts[key];
        const updateData: any = { lastUpdated: Date.now() };
        Object.entries(deltas).forEach(([field, val]) => { updateData[field] = increment(val as number); });
        currentBatch.set(ref, updateData, { merge: true });
        opCount++;
        if (opCount >= 480) { batchChunks.push(currentBatch); currentBatch = writeBatch(db); opCount = 0; }
      }
      batchChunks.push(currentBatch);
      for (const batch of batchChunks) { await batch.commit(); }
      setSelectedIds(new Set());
      fetchData();
    } catch (err) { 
      console.error(err); 
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Delete failed: ${msg}`); 
    } finally { setIsBulkDeleting(false); }
  };

  const handleOpenEdit = (record: any) => {
    setEditingRecord(record);
    if (activeView === 'online-orders') {
      setEditForm({
        revenue: (record.itemTotal || 0).toString(),
        tax: (record.totalTax || 0).toString(),
        commission: (record.commission || 0).toString(),
        amount: (record.netPayout || 0).toString(),
        category: record.platform || '',
        description: record.orderStatus || '',
        productName: ''
      });
    } else {
      setEditForm({
        revenue: (record.revenue || 0).toString(),
        tax: (record.totalTax || 0).toString(),
        commission: (record.commission || 0).toString(),
        amount: (record.amount || 0).toString(),
        category: record.category || '',
        description: record.description || '',
        productName: record.productName || ''
      });
    }
  };

  const handleSaveEdit = async () => {
    if (!editingRecord || !editingRecord.id) return;
    setIsSavingEdit(true);
    try {
      const batch = writeBatch(db);
      const d = new Date(editingRecord.date || editingRecord.orderDate || '');
      if (isNaN(d.getTime())) throw new Error("Invalid record date");
      
      const rYear = d.getFullYear().toString();
      const rMonth = MONTH_NAMES[d.getMonth()];
      const oId = editingRecord.outletId || 'Unassigned';

      if (activeView === 'sales' || activeView === 'online-orders') {
        let deltaRev = 0, deltaTax = 0, deltaComm = 0, deltaPayout = 0;
        
        if (activeView === 'sales') {
          const newRev = parseFloat(editForm.revenue) || 0;
          const newTax = parseFloat(editForm.tax) || 0;
          const newComm = parseFloat(editForm.commission) || 0;
          const newPayout = Math.max(0, newRev - newTax - newComm);
          deltaRev = newRev - editingRecord.revenue;
          deltaTax = newTax - editingRecord.totalTax;
          deltaComm = newComm - editingRecord.commission;
          deltaPayout = newPayout - (editingRecord.netPayout || 0);

          batch.update(doc(db, 'sales_summary', editingRecord.id), { revenue: newRev, totalTax: newTax, commission: newComm, netPayout: newPayout, lastUpdated: Date.now() });
        } else {
          // online-orders
          const newItemTotal = parseFloat(editForm.revenue) || 0;
          const newTax = parseFloat(editForm.tax) || 0;
          const newComm = parseFloat(editForm.commission) || 0;
          const newPayout = parseFloat(editForm.amount) || 0;
          
          const oldRev = (editingRecord.itemTotal || 0) + (editingRecord.packagingCharge || 0) + (editingRecord.totalTax || 0) - (editingRecord.discount || 0);
          const newRev = newItemTotal + (editingRecord.packagingCharge || 0) + newTax - (editingRecord.discount || 0);
          
          deltaRev = newRev - oldRev;
          deltaTax = newTax - editingRecord.totalTax;
          deltaComm = newComm - editingRecord.commission;
          deltaPayout = newPayout - (editingRecord.netPayout || 0);
          
          batch.update(doc(db, 'online_order_details', editingRecord.id), { itemTotal: newItemTotal, totalTax: newTax, commission: newComm, netPayout: newPayout, lastUpdated: Date.now() });
        }
        
        // BUG-06 fix: route snapshot update to correct channel fields based on record type
        const snapUpdate: any = { lastUpdated: Date.now() };
        if (activeView === 'online-orders') {
          snapUpdate.onlineGoodGross = increment(deltaRev);
          snapUpdate.onlineGoodTax = increment(deltaTax);
          snapUpdate.onlineGoodComm = increment(deltaComm);
          snapUpdate.onlineGoodNet = increment(deltaPayout);
        } else {
          const isOnline = editingRecord.onlinePlatform && editingRecord.onlinePlatform.toLowerCase() !== 'none';
          if (isOnline) {
            snapUpdate.onlineGoodGross = increment(deltaRev);
            snapUpdate.onlineGoodTax = increment(deltaTax);
            snapUpdate.onlineGoodComm = increment(deltaComm);
            snapUpdate.onlineGoodNet = increment(deltaPayout);
          } else {
            snapUpdate.posGoodGross = increment(deltaRev);
            snapUpdate.posGoodTax = increment(deltaTax);
            snapUpdate.posGoodNet = increment(deltaPayout);
          }
        }
        
        const dayIdx = d.getDate() - 1;
        if (dayIdx >= 0 && dayIdx < 31) {
            snapUpdate[`dailyTrend.${dayIdx}`] = increment(deltaRev);
        }

        batch.set(doc(db, 'sales_snapshots', `${user.uid}_${oId}_${rYear}_${rMonth}`), snapUpdate, { merge: true });
      } else if (activeView === 'expenses' || activeView === 'purchases') {
        const newAmt = parseFloat(editForm.amount) || 0;
        const deltaAmt = newAmt - (editingRecord.amount || 0);
        const oldCat = (editingRecord.category || '').toUpperCase();
        const newCat = editForm.category.toUpperCase();
        const coll = activeView === 'expenses' ? 'expenses' : 'purchases';
        const totalField = activeView === 'expenses' ? 'totalExpense' : 'totalPurchase';
        const catField = activeView === 'expenses' ? 'expenseByCategory' : 'purchaseByCategory';

        const recordUpdate: any = { amount: newAmt, category: editForm.category, lastUpdated: Date.now() };
        if (activeView === 'expenses') recordUpdate.description = editForm.description;
        else recordUpdate.productName = editForm.productName;
        batch.update(doc(db, coll, editingRecord.id), recordUpdate);

        const snapRef = doc(db, 'expense_snapshots', `${user.uid}_${oId}_${rYear}_${rMonth}`);
        const snapUpdate: any = { [totalField]: increment(deltaAmt), lastUpdated: Date.now() };
        if (oldCat === newCat) {
          snapUpdate[`${catField}.${newCat}`] = increment(deltaAmt);
          if (settings.cogsKeywords.includes(newCat)) { const bucket = settings.cogsBucketMapping?.[newCat] || 'FOOD'; snapUpdate[`cogsBucketAgg.${bucket}`] = increment(deltaAmt); }
        } else {
          snapUpdate[`${catField}.${oldCat}`] = increment(-(editingRecord.amount || 0));
          snapUpdate[`${catField}.${newCat}`] = increment(newAmt);
          if (settings.cogsKeywords.includes(oldCat)) { const b = settings.cogsBucketMapping?.[oldCat] || 'FOOD'; snapUpdate[`cogsBucketAgg.${b}`] = increment(-(editingRecord.amount || 0)); }
          if (settings.cogsKeywords.includes(newCat)) { const b = settings.cogsBucketMapping?.[newCat] || 'FOOD'; snapUpdate[`cogsBucketAgg.${b}`] = increment(newAmt); }
        }
        batch.set(snapRef, snapUpdate, { merge: true });
      }
      await batch.commit();
      setEditingRecord(null);
      fetchData();
    } catch (err) { console.error(err); alert("Update failed."); } finally { setIsSavingEdit(false); }
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-20 relative">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl"><ShieldAlert size={28} /></div>
          <div><h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Raw Data Verify</h2><p className="text-slate-400 text-sm font-bold tracking-widest flex items-center gap-2"><Database size={14} className="text-indigo-500" /> SOURCE LEDGER AUDIT</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
             <button onClick={() => setActiveView('sales')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${activeView === 'sales' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Sales</button>
             <button onClick={() => setActiveView('online-orders')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${activeView === 'online-orders' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Online Hub</button>
             <button onClick={() => setActiveView('expenses')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${activeView === 'expenses' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Expenses</button>
             <button onClick={() => setActiveView('purchases')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${activeView === 'purchases' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Purchases</button>
             <button onClick={() => setActiveView('online-items')} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${activeView === 'online-items' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>Items</button>
          </div>
          <div className="flex items-center gap-2">
            <div className="bg-slate-50 px-3 py-2 rounded-xl flex items-center gap-2 border border-slate-100"><MapPin size={12} className="text-indigo-500" /><select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent font-bold text-[10px] outline-none uppercase tracking-tight"><option value="all">All Outlets</option>{activeOutletOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
            <div className="bg-slate-50 px-3 py-2 rounded-xl flex items-center gap-2 border border-slate-100">
              <CalendarDays size={12} className="text-indigo-500" />
              <select 
                value={selectedMonth} 
                onChange={e => setSelectedMonth(e.target.value)} 
                className="bg-transparent font-bold text-[10px] outline-none uppercase"
              >
                <option value="All Months">All Months</option>
                {MONTH_NAMES.map(m => (
                  <option key={m} value={m}>{m.substring(0, 3)}</option>
                ))}
              </select>
              <select 
                value={selectedYear} 
                onChange={e => setSelectedYear(e.target.value)} 
                className="bg-transparent font-bold text-[10px] outline-none"
              >
                {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
          <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 transition-all shadow-lg"><SearchCode size={14} /> Fetch</button>
        </div>
      </header>

      {!hasSearched ? (
        <section className="py-32 bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 text-center animate-in zoom-in-95 duration-500"><div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-8 text-indigo-400"><ShieldQuestion size={48} /></div><h3 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Audit Scope Required</h3><p className="text-slate-500 mt-3 font-medium max-w-md mx-auto">Select a store and period to inspect atomic transactions.</p></section>
      ) : loading ? (
        <div className="py-40 text-center"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-6" /><p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Processing Database Load...</p></div>
      ) : (
        <section className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-700">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
                <div><h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">{activeView.replace('-', ' ')} Record Registry</h3><p className="text-slate-400 text-sm font-medium">{currentVisibleItems.length} lines detected for {selectedMonth} {selectedYear}</p></div>
                <div className="flex flex-wrap items-center gap-4">
                  {activeView === 'sales' && <button onClick={() => setShowManualOnly(!showManualOnly)} className={`px-5 py-3 rounded-2xl font-black uppercase text-[10px] border transition-all ${showManualOnly ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white text-slate-400 border-slate-100'}`}>Manual Only</button>}
                  {(activeView === 'expenses' || activeView === 'purchases') && <button onClick={() => setShowUncategorizedOnly(!showUncategorizedOnly)} className={`px-5 py-3 rounded-2xl font-black uppercase text-[10px] border transition-all ${showUncategorizedOnly ? 'bg-rose-600 text-white shadow-lg animate-pulse' : 'bg-white text-slate-400 border-slate-100'}`}>Unmapped Only</button>}
                  {activeView === 'online-items' && <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={14}/><input type="text" placeholder="Search item..." value={itemSearchTerm} onChange={e => setItemSearchTerm(e.target.value)} className="pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-xs outline-none w-48"/></div>}
                </div>
             </div>
             
             <div className="overflow-x-auto"><table className="w-full text-left">
                 <thead className="bg-slate-50 border-b border-slate-100"><tr>
                    <th className="px-6 py-4 w-10"><button onClick={toggleAllSelection} className="text-indigo-600">{selectedIds.size > 0 && selectedIds.size === currentVisibleItems.length ? <CheckSquare size={18}/> : <Square size={18}/>}</button></th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date / Entity</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{activeView === 'online-items' ? 'SKU Name' : 'Identity'}</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{activeView === 'online-items' ? 'Qty' : 'Category'}</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Value</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Actions</th>
                 </tr></thead>
                 <tbody className="divide-y divide-slate-100">{currentVisibleItems.length === 0 ? (
                   <tr>
                     <td colSpan={6} className="py-32 text-center">
                       <SearchX size={56} className="mx-auto text-slate-200 mb-6" />
                       <p className="text-slate-400 font-black uppercase text-xs tracking-widest">No records match these criteria</p>
                       {(showManualOnly || showUncategorizedOnly || storeFilter !== 'all') && (
                         <button onClick={resetAllFilters} className="mt-4 flex items-center gap-2 px-6 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-indigo-50 hover:text-indigo-600 transition-all mx-auto">
                           <RotateCcw size={14} /> Clear Active Filters
                         </button>
                       )}
                     </td>
                   </tr>
                 ) : currentVisibleItems.slice(0, 500).map((r, i) => {
                     const isManual = r._fileId === 'manual_online_entry';
                     const unmapped = (activeView === 'expenses' || activeView === 'purchases') && isUncategorized(r.category);
                     const isSelected = selectedIds.has(r.id!);
                     return (
                       <tr key={r.id || i} className={`hover:bg-slate-50/50 transition-colors ${isSelected ? 'bg-indigo-50/30' : ''} ${unmapped ? 'bg-rose-50/20' : ''}`}>
                         <td className="px-6 py-5"><button onClick={() => toggleItemSelection(r.id!)} className="text-indigo-600">{isSelected ? <CheckSquare size={18}/> : <Square size={18}/>}</button></td>
                         <td className="px-6 py-5"><p className="text-xs font-black text-slate-900">{r.date || r.orderDate}</p><p className="text-[9px] font-bold text-slate-400 uppercase">{getOutletName(r.outletId)}</p></td>
                         <td className="px-6 py-5"><p className="text-xs font-black text-slate-800 uppercase truncate max-w-[200px]">{activeView === 'online-items' ? (r.itemName || 'Unknown SKU') : (activeView === 'purchases' ? r.productName : (activeView === 'expenses' ? r.description : r.orderId))}</p>{(activeView === 'sales' || activeView === 'online-orders') && <p className="text-[9px] font-bold text-slate-400 uppercase">{r.onlinePlatform || r.platform || 'POS'}</p>}</td>
                         <td className="px-6 py-5"><div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[9px] font-black uppercase ${unmapped ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{unmapped && <AlertTriangle size={10} />}{activeView === 'online-items' ? r.itemQuantity : (activeView === 'online-orders' ? r.orderStatus : (r.category || 'N/A'))}</div></td>
                         <td className="px-6 py-5 text-xs font-black text-slate-900">₹{(activeView === 'online-orders' ? (r.netPayout || 0) : (r.revenue || r.amount || r.itemTotal || 0)).toLocaleString()}</td>
                         <td className="px-6 py-5 text-right"><div className="flex items-center justify-end gap-2">
                             {(activeView !== 'online-items' && (isManual || activeView !== 'sales')) && (<button onClick={() => handleOpenEdit(r)} className="p-2 text-indigo-400 hover:bg-indigo-50 rounded-lg"><Edit3 size={14}/></button>)}
                             <button onClick={() => handleBulkDelete([r.id!])} className="p-2 text-rose-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg"><Trash2 size={14}/></button>
                         </div></td>
                       </tr>
                     );
                 })}</tbody>
               </table></div>
          </section>
      )}

      {selectedIds.size > 0 && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[90] animate-in slide-in-from-bottom-8 duration-500 w-full max-w-xl px-4">
           <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-[2.5rem] p-4 flex items-center justify-between shadow-2xl">
              <div className="flex items-center gap-5 pl-4"><div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg"><CheckSquare size={24} /></div><div><p className="text-white font-black text-lg">{selectedIds.size} Lines</p><p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">Audit Selection</p></div></div>
              <div className="flex items-center gap-3"><button onClick={() => setSelectedIds(new Set())} className="px-6 py-3 text-slate-400 font-black uppercase text-[10px] tracking-widest hover:text-white">Clear</button><button onClick={() => handleBulkDelete()} disabled={isBulkDeleting} className="flex items-center gap-2 px-8 py-3 bg-rose-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-rose-700 shadow-xl">{isBulkDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Batch Wipe</button></div>
           </div>
        </div>
      )}

      {editingRecord && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setEditingRecord(null)} />
          <div className="relative w-full max-w-md bg-white rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
             <header className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-4"><div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><Edit3 size={24} /></div><div><h3 className="text-xl font-black text-slate-900 uppercase">Audit Entry</h3><p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">{editingRecord.date}</p></div></div>
                <button onClick={() => setEditingRecord(null)} className="p-2 text-slate-400 hover:text-slate-900"><X /></button>
             </header>
             <div className="p-8 space-y-6">
                {activeView === 'sales' ? (
                  <div className="space-y-4">
                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Revenue (Gross)</label><input type="number" value={editForm.revenue} onChange={e => setEditForm({...editForm, revenue: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-black text-slate-900 outline-none" /></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Tax</label><input type="number" value={editForm.tax} onChange={e => setEditForm({...editForm, tax: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold" /></div>
                      <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Comm.</label><input type="number" value={editForm.commission} onChange={e => setEditForm({...editForm, commission: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold" /></div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">{activeView === 'purchases' ? 'Product' : 'Description'}</label><input type="text" value={activeView === 'purchases' ? editForm.productName : editForm.description} onChange={e => setEditForm({...editForm, [activeView === 'purchases' ? 'productName' : 'description']: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold" /></div>
                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Category Keyword</label><input type="text" value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-black uppercase text-xs" /></div>
                    <div><label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Amount (Burn)</label><input type="number" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: e.target.value})} className="w-full px-5 py-4 bg-indigo-50 border border-indigo-100 rounded-2xl font-black text-indigo-700" /></div>
                  </div>
                )}
             </div>
             <footer className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                <button onClick={() => setEditingRecord(null)} className="flex-1 py-4 bg-white border border-slate-200 rounded-2xl font-black uppercase text-xs text-slate-400">Cancel</button>
                <button onClick={handleSaveEdit} disabled={isSavingEdit} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2 shadow-xl">{isSavingEdit ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Sync Changes</button>
             </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default RawSalesHub;
