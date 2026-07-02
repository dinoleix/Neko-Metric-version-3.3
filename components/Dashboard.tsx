
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from '@firebase/auth';
import { 
  collection, 
  query, 
  getDocs, 
  deleteDoc, 
  doc, 
  where, 
  limit, 
  writeBatch,
  getDoc,
  updateDoc,
  increment 
} from '@firebase/firestore';
import { ref, getDownloadURL, deleteObject } from '@firebase/storage';
import { db, storage } from '../firebase';
import { 
  FileMetadata, 
  FileType, 
  SalesAnalytics, 
  getOutletName, 
  DEFAULT_COGS, 
  CategorySettings, 
  CogsBucket,
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
import { 
  FileText, 
  Calendar, 
  Database, 
  Trash2, 
  ArrowUpRight, 
  Search, 
  ChevronRight, 
  ChevronDown,
  LayoutGrid, 
  List,
  X,
  Table as TableIcon,
  Download,
  CheckCircle2,
  TrendingUp,
  BarChart3,
  CloudUpload,
  FileDown,
  Eraser,
  AlertTriangle,
  Loader2,
  MapPin,
  Clock,
  FolderOpen,
  Smartphone,
  Layers,
  Circle,
  Activity,
  ShieldCheck
} from 'lucide-react';

const FILE_RECORD_COLLECTIONS: Partial<Record<FileType, string>> = {
  sales: 'sales_summary',
  item: 'item_sales',
  platform_item: 'item_sales',
  expense: 'expenses',
  purchase: 'purchases',
  online_order: 'online_order_details',
  customer_mapping: 'customer_name_mappings',
  bank_statement: 'bank_statement_imports'
};

const Dashboard: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [analytics, setAnalytics] = useState<SalesAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FileType | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<string>>(new Set());

  const [viewingFile, setViewingFile] = useState<FileMetadata | null>(null);
  const [rawRecords, setRawRecords] = useState<any[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const [isPurgeModalOpen, setIsPurgeModalOpen] = useState(false);
  // FIX: Initialize with MONTH_NAMES array to ensure English strings and prevent "undefined" crashes
  const [purgeMonth, setPurgeMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [purgeYear, setPurgeYear] = useState(new Date().getFullYear().toString());
  const [purgeType, setPurgeType] = useState<FileType>('sales');
  const [isPurging, setIsPurging] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const qFiles = query(collection(db, 'files'), where('userId', '==', dataOwnerId));
      const qAnalytics = query(collection(db, 'sales_analytics'), where('userId', '==', dataOwnerId));
      const [filesSnap, analyticsSnap] = await Promise.all([getDocs(qFiles), getDocs(qAnalytics)]);
      
      const fileList = filesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileMetadata));
      const analyticsList = analyticsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SalesAnalytics));
      
      setFiles(fileList.sort((a, b) => b.uploadedAt - a.uploadedAt));
      setAnalytics(analyticsList.sort((a, b) => b.lastUpdated - a.lastUpdated));
    } catch (error) { 
      console.error("Dashboard fetch error:", error); 
    } finally { 
      setLoading(false); 
    }
  };

  useEffect(() => { 
    if (user) fetchData(); 
  }, [user]);

  const fetchRawRecords = async (file: FileMetadata) => {
    setViewingFile(file);
    setLoadingRecords(true);
    setRawRecords([]);
    try {
      const collectionName = FILE_RECORD_COLLECTIONS[file.type];
      if (!collectionName) return;
      const q = query(collection(db, collectionName), where('_fileId', '==', file.id), where('userId', '==', dataOwnerId), limit(100));
      const snapshot = await getDocs(q);
      setRawRecords(snapshot.docs.map(doc => doc.data()));
    } catch (error) { console.error(error); } finally { setLoadingRecords(false); }
  };

  const handleDownloadOriginal = async (file: FileMetadata) => {
    if (!file.storagePath) { alert("Record was created before physical archiving."); return; }
    setDownloading(file.id || 'current');
    try {
      const url = await getDownloadURL(ref(storage, file.storagePath));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `${file.name}.csv`);
      link.setAttribute('target', 'blank');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) { alert("Failed to retrieve file."); } finally { setDownloading(null); }
  };

  const handleDeleteFile = async (file: FileMetadata) => {
    if (!file.id) return;
    setLoading(true);
    try {
      const collectionName = FILE_RECORD_COLLECTIONS[file.type];
      if (!collectionName) throw new Error(`Unsupported file type for deletion: ${file.type}`);
      
      const q = query(collection(db, collectionName), where('_fileId', '==', file.id), where('userId', '==', dataOwnerId));
      const recordsSnap = await getDocs(q);
      const allRecords = recordsSnap.docs;
      
      if (allRecords.length === 0) {
        console.warn("No raw records found for rollback calculations. Snapshot might remain inconsistent.");
      }

      const outletImpacts: Record<string, any> = {};

      let cogsKeywords = DEFAULT_COGS;
      let cogsBucketMapping: Record<string, CogsBucket> = {};
      const settingsSnap = await getDoc(doc(db, 'category_settings', dataOwnerId));
      if (settingsSnap.exists()) {
        const sData = settingsSnap.data() as CategorySettings;
        if (sData.cogsKeywords) cogsKeywords = sData.cogsKeywords.map(k => k.trim().toUpperCase());
        if (sData.cogsBucketMapping) cogsBucketMapping = sData.cogsBucketMapping;
      }

      allRecords.forEach(docSnap => {
        const data = docSnap.data();
        const oId = data.outletId || file.outletId || 'GLOBAL';

        if (file.type === 'sales') {
          if (!data.orderId || data.orderId.toString().trim() === '') return;
          if (!outletImpacts[oId]) outletImpacts[oId] = { posGoodGross: 0, posGoodNet: 0, posGoodTax: 0, onlineGoodGross: 0, onlineGoodNet: 0, onlineGoodTax: 0, onlineGoodComm: 0, onlineGoodAds: 0, settledOrderCount: 0, totalOrderCount: 0, cancelledOrderCount: 0, dayValues: {} };
          const impact = outletImpacts[oId];
          const rev = Number(data.revenue || 0);
          const tax = Number(data.totalTax || 0);
          const comm = Number(data.commission || 0);
          const ads = Number(data.adCharges || 0);
          const payout = Number(data.netPayout || 0);
          const status = (data.orderStatus || '').toUpperCase();
          const isOnline = data.onlinePlatform && data.onlinePlatform.toLowerCase() !== 'none';
          
          if (!isOnline) { impact.totalOrderCount++; if (status === 'CANCELLED') impact.cancelledOrderCount++; }
          const isSettled = status === 'SETTLED' || status === 'PICKEDUP' || status === 'DELIVERED';
          const d = new Date(data.date);
          const day = !isNaN(d.getTime()) ? d.getDate() : -1;
          
          if (isSettled) {
            if (!isOnline) { 
              impact.settledOrderCount++; 
              impact.posGoodGross += rev; 
              impact.posGoodTax += tax; 
              impact.posGoodNet += (rev - tax); 
            } else { 
              impact.onlineGoodGross += rev; 
              impact.onlineGoodTax += tax; 
              impact.onlineGoodComm += comm; 
              impact.onlineGoodAds += ads; 
              impact.onlineGoodNet += payout || Math.max(0, rev - tax - comm - ads); 
            }
            if (day > 0) impact.dayValues[day] = (impact.dayValues[day] || 0) + rev;
          }
        } else if (file.type === 'expense' || file.type === 'purchase') {
          if (!outletImpacts[oId]) outletImpacts[oId] = { total: 0, catMap: {}, bucketMap: {} };
          const amt = Number(data.amount || 0);
          const cat = (data.category || '').toUpperCase();
          outletImpacts[oId].total += amt;
          if (cat) {
             outletImpacts[oId].catMap[cat] = (outletImpacts[oId].catMap[cat] || 0) + amt;
             if (cogsKeywords.includes(cat)) {
                const bucket = cogsBucketMapping[cat] || 'FOOD';
                outletImpacts[oId].bucketMap[bucket] = (outletImpacts[oId].bucketMap[bucket] || 0) + amt;
             }
          }
        } else if (file.type === 'item' || file.type === 'platform_item') {
          if (!outletImpacts[oId]) outletImpacts[oId] = { items: {} };
          const name = (data.itemName || 'Unknown').trim().toUpperCase();
          if (!outletImpacts[oId].items[name]) outletImpacts[oId].items[name] = { qty: 0, rev: 0, posQty: 0, onlineQty: 0, trend: new Array(31).fill(0) };
          const item = outletImpacts[oId].items[name];
          const qty = Number(data.itemQuantity || 0);
          const totalRev = Number(data.itemTotal || 0);
          item.qty += qty;
          item.rev += totalRev;
          if (data.isPlatform) item.onlineQty += qty; else item.posQty += qty;
          const d = new Date(data.date);
          if (!isNaN(d.getTime())) { const dayIdx = d.getDate() - 1; if (dayIdx >= 0 && dayIdx < 31) item.trend[dayIdx] += qty; }
        }
      });

      // Delete records in chunks to respect Firestore 500-op limit
      for (let i = 0; i < allRecords.length; i += 450) {
        const batch = writeBatch(db);
        const chunk = allRecords.slice(i, i + 450);
        chunk.forEach(docSnap => batch.delete(docSnap.ref));
        await batch.commit();
      }

      // Snapshot Rollback Logic
      if (file.type === 'sales') {
        const dYear = file.year.includes(' ') ? new Date(file.year).getFullYear().toString() : file.year;
        const dMonth = (file.month && file.month !== "undefined") ? file.month : MONTH_NAMES[new Date(file.year).getMonth()];

        // Source of truth: which sales rows still exist after this file's records were deleted above.
        // Only this file's month matters, so scope the read server-side when the month is parseable.
        const monthIdx = MONTH_NAMES.indexOf(dMonth);
        const monthScope = monthIdx >= 0
          ? [
              where('date', '>=', `${dYear}-${String(monthIdx + 1).padStart(2, '0')}-01`),
              where('date', '<=', `${dYear}-${String(monthIdx + 1).padStart(2, '0')}-31`)
            ]
          : [];
        const remainingSnap = await getDocs(query(collection(db, 'sales_summary'), where('userId', '==', dataOwnerId), ...monthScope));
        const remainingRecords = remainingSnap.docs.map(d => d.data());

        // Clean snapshots for every outlet touched by this file. Fall back to the file's own outlet
        // so the snapshot is still cleaned even when no raw records were found (e.g. untagged records).
        const affectedOutlets = new Set<string>(Object.keys(outletImpacts));
        if (affectedOutlets.size === 0) affectedOutlets.add(file.outletId || 'GLOBAL');

        for (const oId of affectedOutlets) {
          const snapRef = doc(db, 'sales_snapshots', `${user.uid}_${oId}_${dYear}_${dMonth}`);
          const snapDoc = await getDoc(snapRef);
          if (!snapDoc.exists()) continue;
          const data = snapDoc.data();

          // Does any sales row still belong to this outlet + month + year?
          const sliceHasRecords = remainingRecords.some(r => {
            if ((r.outletId || 'GLOBAL') !== oId) return false;
            const parts = String(r.date || '').split('-');
            return parts.length >= 3 && parts[0] === dYear && MONTH_NAMES[parseInt(parts[1]) - 1] === dMonth;
          });

          if (!sliceHasRecords) {
            // No sales rows remain for this slice. Event revenue lives in the same doc, so if it
            // exists we zero only the sales figures; otherwise remove the snapshot entirely so
            // nothing lingers on the dashboard.
            if (Number(data.eventRevenue || 0) > 0) {
              await updateDoc(snapRef, {
                posGoodGross: 0, posGoodNet: 0, posGoodTax: 0,
                onlineGoodGross: 0, onlineGoodNet: 0, onlineGoodTax: 0, onlineGoodComm: 0, onlineGoodAds: 0,
                settledOrderCount: 0, totalOrderCount: 0, cancelledOrderCount: 0,
                dailyTrend: new Array(31).fill(0), lastUpdated: Date.now()
              });
            } else {
              await deleteDoc(snapRef);
            }
          } else {
            // Other sales files still feed this slice — roll back just this file's contribution.
            const impact = outletImpacts[oId];
            if (!impact) continue;
            const currentTrend = Array.isArray(data.dailyTrend) ? data.dailyTrend : new Array(31).fill(0);
            const newTrend = currentTrend.map((v: number, i: number) => Math.max(0, v - (impact.dayValues[i + 1] || 0)));
            await updateDoc(snapRef, {
              posGoodGross: increment(-impact.posGoodGross),
              posGoodNet: increment(-impact.posGoodNet),
              posGoodTax: increment(-impact.posGoodTax),
              onlineGoodGross: increment(-impact.onlineGoodGross),
              onlineGoodNet: increment(-impact.onlineGoodNet),
              onlineGoodTax: increment(-impact.onlineGoodTax),
              onlineGoodComm: increment(-impact.onlineGoodComm),
              onlineGoodAds: increment(-impact.onlineGoodAds),
              settledOrderCount: increment(-impact.settledOrderCount),
              totalOrderCount: increment(-impact.totalOrderCount),
              cancelledOrderCount: increment(-impact.cancelledOrderCount),
              dailyTrend: newTrend,
              lastUpdated: Date.now()
            });
          }
        }
      } else if (file.type === 'expense' || file.type === 'purchase') {
        for (const oId in outletImpacts) {
          const impact = outletImpacts[oId];
          const eYear = file.year.includes(' ') ? new Date(file.year).getFullYear().toString() : file.year;
          const eMonth = (file.month && file.month !== "undefined") ? file.month : MONTH_NAMES[new Date(file.year).getMonth()];
          const snapId = `${user.uid}_${oId}_${eYear}_${eMonth}`;
          const snapRef = doc(db, 'expense_snapshots', snapId);
          const snapDoc = await getDoc(snapRef);
          if (snapDoc.exists()) {
            const data = snapDoc.data();
            const catField = file.type === 'expense' ? 'expenseByCategory' : 'purchaseByCategory';
            const totalField = file.type === 'expense' ? 'totalExpense' : 'totalPurchase';
            
            const currentCatMap = data[catField] || {};
            const nextCatMap = { ...currentCatMap };
            Object.entries(impact.catMap).forEach(([cat, amt]) => { 
              nextCatMap[cat] = Math.max(0, (nextCatMap[cat] || 0) - (amt as number)); 
            });

            const nextBucketAgg = { ...(data.cogsBucketAgg || {}) };
            Object.entries(impact.bucketMap || {}).forEach(([bucket, amt]) => {
               nextBucketAgg[bucket] = Math.max(0, (nextBucketAgg[bucket] || 0) - (amt as number));
            });

            await updateDoc(snapRef, { 
              [totalField]: increment(-impact.total), 
              [catField]: nextCatMap, 
              cogsBucketAgg: nextBucketAgg,
              lastUpdated: Date.now() 
            });
          }
        }
      } else if (file.type === 'item' || file.type === 'platform_item') {
        for (const oId in outletImpacts) {
          const impact = outletImpacts[oId];
          const iYear = file.year.includes(' ') ? new Date(file.year).getFullYear().toString() : file.year;
          const iMonth = (file.month && file.month !== "undefined") ? file.month : MONTH_NAMES[new Date(file.year).getMonth()];
          const snapId = `${user.uid}_${oId}_${iYear}_${iMonth}`;
          const snapRef = doc(db, 'item_snapshots', snapId);
          const snapDoc = await getDoc(snapRef);
          if (snapDoc.exists()) {
            const existingItems = snapDoc.data().items || {};
            const nextItems = { ...existingItems };
            Object.entries(impact.items).forEach(([name, data]: [string, any]) => {
              if (nextItems[name]) {
                nextItems[name].quantity = Math.max(0, nextItems[name].quantity - data.qty);
                nextItems[name].revenue = Math.max(0, nextItems[name].revenue - data.rev);
                nextItems[name].posQuantity = Math.max(0, (nextItems[name].posQuantity || 0) - data.posQty);
                nextItems[name].onlineQuantity = Math.max(0, (nextItems[name].onlineQuantity || 0) - data.onlineQty);
                const currentDailyTrend = Array.isArray(nextItems[name].dailyTrend) ? nextItems[name].dailyTrend : new Array(31).fill(0);
                nextItems[name].dailyTrend = currentDailyTrend.map((v: number, i: number) => Math.max(0, v - data.trend[i]));
                if (nextItems[name].quantity === 0 && nextItems[name].revenue === 0) delete nextItems[name];
              }
            });
            await updateDoc(snapRef, { items: nextItems, lastUpdated: Date.now() });
          }
        }
      }

      if (file.storagePath) { 
        try { 
          await deleteObject(ref(storage, file.storagePath)); 
        } catch (e) {
          console.warn("Storage archive missing, skipping physical file deletion:", e);
        } 
      }
      await deleteDoc(doc(db, 'files', file.id));
      
      setFiles(prev => prev.filter(f => f.id !== file.id));
      fetchData();
    } catch (error) { 
      console.error("Wipe failure:", error); 
      const msg = error instanceof Error ? error.message : String(error);
      alert(`Wipe failed: ${msg}. Check your connection or try again.`); 
    } finally { setLoading(false); }
  };

  const handlePurgeMonth = async () => {
    if (!confirm(`GLOBAL PURGE: Wipe ALL ${purgeType} data and snapshots for ${purgeMonth} ${purgeYear}?`)) return;
    setIsPurging(true);
    try {
      const q = query(collection(db, 'files'), where('userId', '==', dataOwnerId), where('month', '==', purgeMonth), where('year', '==', purgeYear), where('type', '==', purgeType));
      const filesSnap = await getDocs(q);
      
      for (const fileDoc of filesSnap.docs) { 
        await handleDeleteFile({ id: fileDoc.id, ...fileDoc.data() } as FileMetadata); 
      }
      
      let snapCollection = '';
      if (purgeType === 'sales') snapCollection = 'sales_snapshots';
      else if (purgeType === 'expense' || purgeType === 'purchase') snapCollection = 'expense_snapshots';
      else if (purgeType === 'item' || purgeType === 'platform_item') snapCollection = 'item_snapshots';
      else if (purgeType === 'online_order') snapCollection = 'sales_snapshots';

      if (snapCollection) {
        const snapQ = query(collection(db, snapCollection), where('userId', '==', dataOwnerId), where('month', '==', purgeMonth), where('year', '==', purgeYear));
        const snapshots = await getDocs(snapQ);
        const batch = writeBatch(db);
        snapshots.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      
      setIsPurgeModalOpen(false);
      fetchData();
    } catch (error) { console.error(error); alert("Purge failed."); } finally { setIsPurging(false); }
  };

  const scrollToPeriod = (period: string) => {
    const el = document.getElementById(`period-${period.replace(' ', '-')}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const next = new Set(collapsedPeriods);
      next.delete(period);
      setCollapsedPeriods(next);
    }
  };

  const availabilityMatrix = useMemo(() => {
    const matrix: Record<string, Record<string, Set<FileType>>> = {};
    YEAR_OPTIONS.forEach(y => {
      matrix[y] = {};
      MONTH_NAMES.forEach(m => { matrix[y][m] = new Set(); });
    });
    files.forEach(f => {
      if (f.year && matrix[f.year] && f.month && matrix[f.year][f.month]) {
        matrix[f.year][f.month].add(f.type);
      }
    });
    return matrix;
  }, [files]);

  const filteredFiles = files.filter(f => (filter === 'all' || f.type === filter) && (f.name || '').toLowerCase().includes(searchTerm.toLowerCase()));
  
  const groupedFiles = useMemo(() => {
    const groups: Record<string, FileMetadata[]> = {};
    filteredFiles.forEach(file => {
      const groupKey = `${file.month || 'Unknown'} ${file.year || 'Unknown'}`;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(file);
    });

    return Object.entries(groups).sort((a, b) => {
      const [monthA, yearA] = a[0].split(' ');
      const [monthB, yearB] = b[0].split(' ');
      if (yearA !== yearB) return yearB.localeCompare(yearA);
      // FIX: Standardize month index retrieval to prevent undefined crashes
      const idxA = MONTH_NAMES.indexOf(monthA);
      const idxB = MONTH_NAMES.indexOf(monthB);
      return (idxB !== -1 ? idxB : 0) - (idxA !== -1 ? idxA : 0);
    }).map(([period, items]) => ({
      period,
      month: period.split(' ')[0],
      year: period.split(' ')[1],
      items: items.sort((a, b) => b.uploadedAt - a.uploadedAt),
      totalRecords: items.reduce((acc, i) => acc + (i.recordCount || 0), 0)
    }));
  }, [filteredFiles]);

  const togglePeriod = (period: string) => {
    setCollapsedPeriods(prev => {
      const next = new Set(prev);
      if (next.has(period)) next.delete(period);
      else next.add(period);
      return next;
    });
  };

  const latestAnalytics = analytics.length > 0 ? analytics[0] : null;

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-24">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div><h2 className="text-4xl font-black text-slate-900 tracking-tighter">Performance Hub</h2><p className="text-slate-500 mt-1 font-medium uppercase tracking-widest text-[10px]">Collection logs & Audit-Ready Datasets.</p></div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 w-4 h-4" />
            <input type="text" placeholder="Search datasets..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-12 pr-4 py-4 bg-white border border-slate-100 rounded-2xl text-sm focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 outline-none w-full md:w-64 shadow-sm transition-all" />
          </div>
          <div className="flex bg-white p-1 rounded-2xl border border-slate-100 shadow-sm shrink-0">
            <button onClick={() => setViewMode('grid')} className={`p-3 rounded-xl transition-all ${viewMode === 'grid' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}><LayoutGrid size={18} /></button>
            <button onClick={() => setViewMode('list')} className={`p-3 rounded-xl transition-all ${viewMode === 'list' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-600'}`}><List size={18} /></button>
          </div>
          <button onClick={() => setIsPurgeModalOpen(true)} className="p-4 bg-rose-50 text-rose-600 rounded-2xl hover:bg-rose-100 transition-all border border-rose-100 flex items-center gap-2 shadow-sm"><Eraser size={20} /><span className="hidden md:inline font-black uppercase text-[10px] tracking-widest">Wipe Period</span></button>
        </div>
      </header>

      <section className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
           <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><Activity size={24}/></div>
              <div><h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Global Ingestion Matrix</h3><p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.2em]">Operational Health Check</p></div>
           </div>
           <div className="flex flex-wrap items-center gap-4 bg-slate-50 p-3 rounded-2xl border border-slate-100 shadow-inner">
              {[
                { label: 'Sales', color: 'bg-indigo-500' },
                { label: 'SKU Items', color: 'bg-emerald-500' },
                { label: 'Expenses', color: 'bg-rose-500' },
                { label: 'Purchases', color: 'bg-amber-500' }
              ].map(l => (
                <div key={l.label} className="flex items-center gap-2">
                   <div className={`w-3 h-3 ${l.color} rounded shadow-sm`} />
                   <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">{l.label}</span>
                </div>
              ))}
           </div>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
           <table className="w-full text-center border-separate border-spacing-2">
              <thead>
                 <tr>
                    <th className="p-2"></th>
                    {MONTH_NAMES.map(m => <th key={m} className="p-2 text-[9px] font-black text-slate-400 uppercase tracking-tighter min-w-[60px]">{m.substring(0, 3)}</th>)}
                 </tr>
              </thead>
              <tbody>
                 {YEAR_OPTIONS.slice(1, 4).map(y => ( 
                    <tr key={y}>
                       <td className="p-2 text-sm font-black text-slate-900 pr-6 text-left">{y}</td>
                       {MONTH_NAMES.map(m => {
                          const types = availabilityMatrix[y]?.[m] || new Set();
                          const hasData = types.size > 0;
                          return (
                             <td key={m} className="p-0.5">
                                <div 
                                   onClick={() => hasData && scrollToPeriod(`${m} ${y}`)}
                                   className={`h-24 rounded-2xl border transition-all flex flex-col p-1.5 gap-1.5 justify-center relative group ${hasData ? 'bg-white border-slate-200 shadow-sm cursor-pointer hover:border-indigo-400 hover:scale-105' : 'bg-slate-50 border-slate-50 opacity-20'}`}
                                >
                                   {types.has('sales') ? <div className="h-full bg-indigo-500 rounded shadow-sm" /> : <div className="h-full bg-slate-100 rounded-sm" />}
                                   {(types.has('item') || types.has('platform_item')) ? <div className="h-full bg-emerald-500 rounded shadow-sm" /> : <div className="h-full bg-slate-100 rounded-sm" />}
                                   {types.has('expense') ? <div className="h-full bg-rose-500 rounded shadow-sm" /> : <div className="h-full bg-slate-100 rounded-sm" />}
                                   {types.has('purchase') ? <div className="h-full bg-amber-500 rounded shadow-sm" /> : <div className="h-full bg-slate-100 rounded-sm" />}
                                   
                                   {hasData && (
                                     <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/5 transition-colors rounded-2xl flex items-center justify-center">
                                        <ChevronDown size={14} className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-all" />
                                     </div>
                                   )}
                                </div>
                             </td>
                          );
                       })}
                    </tr>
                 ))}
              </tbody>
           </table>
        </div>
      </section>

      {latestAnalytics && (
        <section className="bg-slate-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 right-0 p-12 opacity-10 pointer-events-none"><TrendingUp size={200} className="text-indigo-400" /></div>
          <div className="relative z-10 grid grid-cols-1 lg:grid-cols-3 gap-12 items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-500/20 rounded-full border border-indigo-500/30"><span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span><span className="text-[10px] font-black uppercase tracking-widest text-indigo-200">Latest Processed: {latestAnalytics.month} {latestAnalytics.year}</span></div>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Gross Ledger Revenue</p><h3 className="text-6xl font-black tracking-tighter">₹{latestAnalytics.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white/5 backdrop-blur-md rounded-3xl p-8 border border-white/10">
                <div className="flex items-center gap-3 mb-4 text-indigo-300"><ShieldCheck size={20}/><p className="text-xs font-black uppercase tracking-widest">Audit Stability</p></div>
                <p className="text-slate-300 text-sm leading-relaxed">System-wide snapshots are computed in parallel to ensure high-performance reporting. Missing indicators in the matrix above may indicate incomplete ledgers.</p>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="space-y-12">
        <div className="flex flex-wrap items-center bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm w-fit gap-1">
          {(['all', 'sales', 'item', 'platform_item', 'expense', 'purchase', 'bank_statement'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${filter === t ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:text-slate-900'}`}
            >
              {t === 'platform_item' ? 'Online items' : t === 'bank_statement' ? 'Bank' : t}
            </button>
          ))}
        </div>
        
        {loading ? (
          <div className="bg-white rounded-[2rem] p-20 text-center"><Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-6" /></div>
        ) : groupedFiles.length === 0 ? (
          <div className="bg-white rounded-[2rem] p-20 text-center border border-slate-50 shadow-sm"><BarChart3 size={48} className="text-slate-200 mx-auto mb-4" /><p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No matching datasets found</p></div>
        ) : viewMode === 'grid' ? (
          <div className="space-y-16">
            {groupedFiles.map((group) => {
              const isCollapsed = collapsedPeriods.has(group.period);
              return (
                <div key={group.period} className="space-y-6 scroll-mt-24" id={`period-${group.period.replace(' ', '-')}`}>
                  <div 
                    onClick={() => togglePeriod(group.period)}
                    className="flex items-center justify-between border-b border-slate-200 pb-4 sticky top-0 bg-slate-50/90 backdrop-blur-md z-10 pt-2 px-2 cursor-pointer group hover:bg-slate-100/50 rounded-t-2xl transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg group-hover:bg-indigo-600 transition-colors">
                        {isCollapsed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">{group.period}</h3>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Datasets</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                         <p className="text-xs font-black text-slate-900">{group.items.length} Files</p>
                         <p className="text-[9px] font-bold text-slate-400 uppercase">Archive</p>
                      </div>
                      <div className="h-8 w-px bg-slate-200" />
                      <div className="text-right">
                         <p className="text-xs font-black text-indigo-600">{(group.totalRecords || 0).toLocaleString()}</p>
                         <p className="text-[9px] font-bold text-slate-400 uppercase">Records</p>
                      </div>
                    </div>
                  </div>
                  
                  {!isCollapsed && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in duration-300">
                      {group.items.map((file) => (
                        <div key={file.id} className="bg-white rounded-[2rem] border border-slate-50 shadow-sm hover:shadow-xl transition-all group overflow-hidden flex flex-col hover:-translate-y-1">
                          <div className="p-8">
                            <div className="flex items-center justify-between mb-6">
                              <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${file.type === 'sales' ? 'bg-indigo-50 text-indigo-600' : (file.type === 'platform_item' ? 'bg-orange-50 text-orange-600' : 'bg-slate-50 text-slate-600')}`}>
                                {file.type === 'platform_item' ? 'Platform Report' : file.type}
                              </div>
                              <div className="flex items-center gap-2 group-hover:opacity-100 transition-all opacity-40">
                                {file.storagePath && (
                                  <button onClick={() => handleDownloadOriginal(file)} disabled={downloading === file.id} className="p-2 text-indigo-400 hover:text-indigo-600">
                                    <Download size={16} />
                                  </button>
                                )}
                                <button onClick={() => { if(confirm(`WIPE DATA: Permanently delete "${file.name}"?`)) handleDeleteFile(file); }} className="p-2 text-slate-300 hover:text-rose-500">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-2 text-indigo-600 text-[10px] font-black uppercase tracking-widest mb-1 bg-indigo-50/50 w-fit px-2 py-0.5 rounded-lg">
                               <MapPin size={10} /> 
                               <span>{getOutletName(file.outletId || 'Global / Mixed')}</span>
                            </div>
                            
                            <h3 className="text-xl font-black text-slate-800 line-clamp-1 mb-4">{file.name}</h3>
                            
                            <div className="flex flex-col gap-2">
                               <div className="flex items-center gap-2 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                                  <Database size={12} className="text-indigo-500" /> 
                                  <span>{(file.recordCount || 0).toLocaleString()} Entries</span>
                               </div>
                               <div className="flex items-center gap-2 text-slate-400 text-[10px] font-black uppercase tracking-widest">
                                  <Clock size={12} className="text-indigo-500" /> 
                                  <span>Logged {new Date(file.uploadedAt).toLocaleDateString()}</span>
                               </div>
                            </div>
                          </div>
                          <button onClick={() => fetchRawRecords(file)} className="w-full py-4 bg-slate-50/50 border-t border-slate-50 text-indigo-600 font-black uppercase text-[10px] tracking-widest hover:bg-indigo-50 transition-colors flex items-center justify-center gap-2">
                            Inspect Data <ChevronRight size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden animate-in fade-in duration-300">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Period / Dataset Name</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Outlet</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                  <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {groupedFiles.map((group) => {
                  const isCollapsed = collapsedPeriods.has(group.period);
                  return (
                    <React.Fragment key={group.period}>
                      <tr 
                        onClick={() => togglePeriod(group.period)}
                        className="bg-slate-50/50 cursor-pointer hover:bg-slate-100/70 transition-colors"
                      >
                        <td colSpan={4} className="px-8 py-4">
                          <div className="flex items-center gap-3">
                             <div className="p-1 bg-slate-200 rounded text-slate-600">
                               {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                             </div>
                             <FolderOpen size={16} className="text-slate-400" />
                             <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-900">{group.period}</span>
                             <div className="h-px flex-1 bg-slate-200 mx-4" />
                             <span className="text-[9px] font-bold text-slate-400 uppercase">{group.items.length} Files</span>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed && group.items.map((file) => (
                        <tr key={file.id} className="hover:bg-slate-50/30 transition-colors group animate-in slide-in-from-top-1 duration-200">
                          <td className="px-8 py-5">
                            <p className="text-sm font-black text-slate-900">{file.name}</p>
                            <p className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Processed {new Date(file.uploadedAt).toLocaleDateString()} • {(file.recordCount || 0).toLocaleString()} Records</p>
                          </td>
                          <td className="px-8 py-5">
                             <div className="flex items-center gap-2 text-indigo-600 text-[10px] font-black uppercase tracking-tighter">
                                <MapPin size={12} />
                                {getOutletName(file.outletId || 'Global')}
                             </div>
                          </td>
                          <td className="px-8 py-5">
                            <span className={`px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest ${file.type === 'sales' ? 'bg-indigo-50 text-indigo-600' : (file.type === 'platform_item' ? 'bg-orange-50 text-orange-600' : 'bg-slate-100 text-slate-600')}`}>
                              {file.type === 'platform_item' ? 'Platform' : file.type}
                            </span>
                          </td>
                          <td className="px-8 py-5 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => fetchRawRecords(file)} className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all shadow-sm">
                                <TableIcon size={16} />
                              </button>
                              <button onClick={() => { if(confirm(`WIPE DATA: Permanently delete "${file.name}"?`)) handleDeleteFile(file); }} className="p-2.5 bg-rose-50 text-rose-400 rounded-xl hover:bg-rose-500 hover:text-white transition-all shadow-sm">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isPurgeModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setIsPurgeModalOpen(false)} />
          <div className="relative w-full max-w-md bg-white rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300 p-10">
            <div className="flex items-center gap-4 mb-8"><div className="p-4 bg-rose-50 text-rose-600 rounded-2xl"><AlertTriangle size={32} /></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Global Purge</h3><p className="text-slate-500 text-sm font-medium leading-tight">Bulk delete records and snapshots for a specific period.</p></div></div>
            <div className="space-y-6 mb-10">
               <div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Month</label><select value={purgeMonth} onChange={e => setPurgeMonth(e.target.value)} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none">{MONTH_NAMES.map(m => (<option key={m} value={m}>{m}</option>))}</select></div>
               <div className="grid grid-cols-2 gap-4"><div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Year</label><select value={purgeYear} onChange={e => setPurgeYear(e.target.value)} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select></div><div><label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Type</label><select value={purgeType} onChange={e => setPurgeType(e.target.value as FileType)} className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none"><option value="sales">Sales</option><option value="online_order">Online Hub</option><option value="item">Items</option><option value="platform_item">Online Items</option><option value="expense">Expenses</option><option value="purchase">Purchases</option></select></div></div>
            </div>
            <div className="flex gap-4"><button onClick={() => setIsPurgeModalOpen(false)} className="flex-1 py-4 bg-slate-50 text-slate-400 rounded-2xl font-black uppercase text-[10px] tracking-widest">Cancel</button><button onClick={handlePurgeMonth} disabled={isPurging} className="flex-1 py-4 bg-rose-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-rose-200 flex items-center justify-center gap-2">{isPurging ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser size={14} />} Confirm Wipe</button></div>
          </div>
        </div>
      )}

      {viewingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setViewingFile(null)} />
          <div className="relative w-full max-w-5xl bg-white h-[85vh] rounded-[3rem] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in duration-300">
            <header className="p-8 border-b border-slate-100 flex items-center justify-between"><div><h3 className="text-2xl font-black text-slate-900">{viewingFile.name}</h3><p className="text-slate-500 font-medium text-sm">Viewing up to 100 raw records.</p></div><button onClick={() => setViewingFile(null)} className="p-4 bg-slate-50 rounded-2xl text-slate-400 hover:text-slate-900 transition-all"><X size={24} /></button></header>
            <div className="flex-1 overflow-auto p-8 custom-scrollbar">{loadingRecords ? (<div className="h-full flex items-center justify-center"><Loader2 className="w-10 h-10 text-indigo-600 animate-spin" /></div>) : (<div className="bg-slate-50 rounded-3xl border border-slate-100 overflow-hidden"><table className="w-full text-left text-sm font-medium"><thead className="bg-white border-b border-slate-100"><tr>{rawRecords.length > 0 && Object.keys(rawRecords[0]).filter(k => !k.startsWith('_') && k !== 'userId').map(h => (<th key={h} className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>))}</tr></thead><tbody className="divide-y divide-slate-100">{rawRecords.map((r, i) => (<tr key={i} className="hover:bg-white transition-colors">{Object.keys(r).filter(k => !k.startsWith('_') && k !== 'userId').map(h => (<td key={h} className="px-6 py-4 text-slate-600">{typeof r[h] === 'number' ? `₹${r[h].toLocaleString()}` : String(r[h])}</td>))}</tr>))}</tbody></table></div>)}</div>
            <footer className="p-8 bg-slate-50/50 border-t border-slate-50 flex justify-end"><button onClick={() => setViewingFile(null)} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-slate-800 transition-all">Close Inspector</button></footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
