import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  SalesSummaryRecord, 
  ItemSalesRecord, 
  MASTER_OUTLETS, 
  getOutletName,
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
import { 
  ShieldCheck, 
  RefreshCw, 
  MapPin, 
  CalendarDays, 
  AlertTriangle, 
  CheckCircle2, 
  Database,
  Link2,
  XCircle,
  ArrowRight,
  Info,
  SearchX,
  FileSearch,
  Scale,
  Activity,
  History,
  Loader2,
  Hash,
  Percent
} from 'lucide-react';

interface AuditResult {
  orderId: string;
  refNo: string;
  date: string;
  outletId: string;
  status: string;
  salesGross: number;
  salesTax: number;
  salesNet: number;
  itemsTotal: number;
  itemCount: number;
  discrepancy: number;
  type: 'synced' | 'orphan_items' | 'hollow_order' | 'drift';
  bridgeIdUsed: string;
}

const IntegrityAudit: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [salesRecords, setSalesRecords] = useState<SalesSummaryRecord[]>([]);
  const [itemRecords, setItemRecords] = useState<ItemSalesRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [storeFilter, setStoreFilter] = useState('all');

  const runAudit = async () => {
    setLoading(true);
    try {
      const constraints = [where('userId', '==', dataOwnerId)];
      
      const [sSnap, iSnap] = await Promise.all([
        getDocs(query(collection(db, 'sales_summary'), ...constraints)),
        getDocs(query(collection(db, 'item_sales'), ...constraints))
      ]);

      const monthIdx = MONTH_NAMES.indexOf(selectedMonth);
      const yearNum = parseInt(selectedYear);

      const filterByPeriod = (r: any) => {
        const d = new Date(r.date);
        return !isNaN(d.getTime()) && 
               d.getFullYear() === yearNum && 
               (selectedMonth === 'All Months' || d.getMonth() === monthIdx);
      };

      setSalesRecords(sSnap.docs.map(d => d.data() as SalesSummaryRecord).filter(filterByPeriod));
      setItemRecords(iSnap.docs.map(d => d.data() as ItemSalesRecord).filter(filterByPeriod));
      setHasSearched(true);
    } catch (err) {
      console.error(err);
      alert("Relational Audit failed to run.");
    } finally {
      setLoading(false);
    }
  };

  const auditReport = useMemo(() => {
    if (!hasSearched) return null;

    const normalize = (val: any) => String(val || '').trim().toUpperCase();

    const filteredSales = salesRecords.filter(r => storeFilter === 'all' || r.outletId === storeFilter);
    const filteredItems = itemRecords.filter(r => storeFilter === 'all' || r.outletId === storeFilter);

    // Step 1: Map sales by every possible unique ID
    const saleLookup = new Map<string, SalesSummaryRecord>();
    const uniqueSales = new Set<SalesSummaryRecord>();

    filteredSales.forEach(s => {
      const nid = normalize(s.orderId);
      const nref = normalize(s.refNo);
      if (nid) saleLookup.set(nid, s);
      if (nref && nref !== nid) saleLookup.set(nref, s);
      uniqueSales.add(s);
    });

    // Step 2: Group items by matching any valid sale ID
    const salesItemGroups = new Map<SalesSummaryRecord, ItemSalesRecord[]>();
    const orphanItemGroups = new Map<string, ItemSalesRecord[]>();

    filteredItems.forEach(item => {
      const nid = normalize(item.orderId);
      const nref = normalize(item.refNo);
      let targetSale = saleLookup.get(nid) || saleLookup.get(nref);

      if (targetSale) {
        const group = salesItemGroups.get(targetSale) || [];
        group.push(item);
        salesItemGroups.set(targetSale, group);
      } else {
        const orphanKey = nid || nref || 'NO_ID';
        const group = orphanItemGroups.get(orphanKey) || [];
        group.push(item);
        orphanItemGroups.set(orphanKey, group);
      }
    });

    const results: AuditResult[] = [];

    // Process Sales (Comparing Net vs Net)
    uniqueSales.forEach(sale => {
      const items = salesItemGroups.get(sale) || [];
      const itemsTotal = items.reduce((sum, i) => sum + (i.itemTotal || 0), 0);
      const salesGross = sale.revenue || 0;
      const salesTax = sale.totalTax || 0;
      const salesNet = salesGross - salesTax;
      
      // Calculate discrepancy based on Net Price comparison
      const discrepancy = salesNet - itemsTotal;

      let type: AuditResult['type'] = 'synced';
      if (items.length === 0) type = 'hollow_order';
      // Tolerance of ₹2 for rounding differences in tax calculations
      else if (Math.abs(discrepancy) > 2) type = 'drift';

      results.push({
        orderId: sale.orderId,
        refNo: sale.refNo,
        date: sale.date,
        outletId: sale.outletId,
        status: sale.orderStatus || 'SETTLED',
        salesGross,
        salesTax,
        salesNet,
        itemsTotal,
        itemCount: items.length,
        discrepancy,
        type,
        bridgeIdUsed: normalize(sale.orderId)
      });
    });

    // Process Orphans
    orphanItemGroups.forEach((items, key) => {
      const itemsTotal = items.reduce((sum, i) => sum + (i.itemTotal || 0), 0);
      results.push({
        orderId: items[0].orderId,
        refNo: items[0].refNo,
        date: items[0].date,
        outletId: items[0].outletId,
        status: 'NO_LEGAL_RECORD',
        salesGross: 0,
        salesTax: 0,
        salesNet: 0,
        itemsTotal,
        itemCount: items.length,
        discrepancy: -itemsTotal,
        type: 'orphan_items',
        bridgeIdUsed: key
      });
    });

    const stats = {
      total: results.length,
      synced: results.filter(r => r.type === 'synced').length,
      orphans: results.filter(r => r.type === 'orphan_items').length,
      hollows: results.filter(r => r.type === 'hollow_order').length,
      drifts: results.filter(r => r.type === 'drift').length,
      netDrift: results.reduce((sum, r) => sum + Math.abs(r.discrepancy), 0),
      health: results.length > 0 ? (results.filter(r => r.type === 'synced').length / results.length) * 100 : 0
    };

    return { results: results.sort((a, b) => b.type.localeCompare(a.type)), stats };
  }, [salesRecords, itemRecords, storeFilter, hasSearched]);

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
            <ShieldCheck size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Relational Integrity Guardian</h2>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest flex items-center gap-2">
              <RefreshCw size={12} className="text-indigo-400" /> Tax-Aware Reconciliation Active
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-100">
            <MapPin size={14} className="text-indigo-500" />
            <select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase">
              <option value="all">Global Scan</option>
              {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-100">
            <CalendarDays size={14} className="text-indigo-500" />
            <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase">
              {MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-transparent font-bold text-xs outline-none">
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button 
            onClick={runAudit} 
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
            Scan Integrity
          </button>
        </div>
      </header>

      {!hasSearched ? (
        <section className="py-40 bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 text-center">
           <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-8 text-indigo-300">
              <Scale size={48} />
           </div>
           <h3 className="text-3xl font-black text-slate-900 tracking-tight">Guardian Ready to Inspect</h3>
           <p className="text-slate-500 mt-3 font-medium max-w-md mx-auto leading-relaxed uppercase tracking-tight text-[10px]">Comparing (Bill Total - Tax) against SKU line items to ensure P&L accuracy.</p>
        </section>
      ) : loading ? (
        <div className="py-40 text-center">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-6" />
          <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Reconciling Gross-to-Net Transitions...</p>
        </div>
      ) : auditReport && (
        <div className="animate-in fade-in duration-500 space-y-12">
           
           <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
              <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between group overflow-hidden">
                 <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:rotate-12 transition-transform"><ShieldCheck size={120}/></div>
                 <div><p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Net Integrity Score</p><h4 className="text-4xl font-black tracking-tighter">{auditReport.stats.health.toFixed(1)}%</h4></div>
                 <div className="mt-6 flex items-center gap-2 text-indigo-400 text-[10px] font-bold uppercase"><Activity size={12}/> Tax-Adjusted Linking</div>
              </div>
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                 <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-1">Orphan Detail (Items)</p>
                 <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{auditReport.stats.orphans} Rows</h4>
                 <p className="text-[9px] font-bold text-slate-400 uppercase mt-4">Unlinked to any Bill record</p>
              </div>
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                 <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-1">Hollow Records (Sales)</p>
                 <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{auditReport.stats.hollows} Bills</h4>
                 <p className="text-[9px] font-bold text-slate-400 uppercase mt-4">Revenue recorded, SKU Details missing</p>
              </div>
              <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                 <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-1">Net Revenue Drift</p>
                 <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{Math.round(auditReport.stats.netDrift).toLocaleString()}</h4>
                 <p className="text-[9px] font-bold text-slate-400 uppercase mt-4">Difference after extracting 5% tax</p>
              </div>
           </section>

           <div className="bg-indigo-50 p-10 rounded-[3rem] border border-indigo-200 flex items-center gap-10">
              <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center shrink-0 border border-indigo-200 shadow-inner">
                 <Percent size={32} className="text-indigo-600" />
              </div>
              <div>
                 <h4 className="text-xl font-black text-indigo-900 uppercase tracking-tight mb-2">Bridge Logic: Tax Reconciliation</h4>
                 <p className="text-indigo-800 text-sm font-medium leading-relaxed uppercase tracking-tight">
                    The Guardian is now performing a <b>Net-to-Net</b> audit. It subtracts the 5% tax from your Sales Summary revenue and compares it to the pre-tax item totals in your Item Sales collection. 
                    This ensures "Profit Drifts" accurately represent actual inventory or pricing errors, not just tax components.
                 </p>
              </div>
           </div>

           <section className="bg-white rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-10 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                 <div className="flex items-center gap-4">
                    <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><History size={24}/></div>
                    <div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Audit Ledger</h3><p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Cross-collection relational mapping</p></div>
                 </div>
              </div>

              <div className="overflow-x-auto">
                 <table className="w-full text-left">
                    <thead>
                       <tr className="bg-slate-50/80 border-b border-slate-100">
                          <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Identities (Order / Ref)</th>
                          <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Gross → Net</th>
                          <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Sales Net</th>
                          <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Items Net Sum</th>
                          <th className="px-10 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Verdict</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                       {auditReport.results.slice(0, 100).map((r, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                             <td className="px-10 py-6">
                                <div className="flex items-center gap-2 mb-1">
                                  <Hash size={10} className="text-indigo-400" />
                                  <p className="text-sm font-black text-slate-900 truncate max-w-[200px] uppercase tracking-tight">{r.orderId}</p>
                                </div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase ml-4">{r.refNo || 'NO REF'} • {r.date}</p>
                             </td>
                             <td className="px-10 py-6">
                                <div className="flex flex-col gap-1">
                                   <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase">
                                      <span className="w-10">Gross</span>
                                      <span className="text-slate-600 font-black">₹{r.salesGross.toLocaleString()}</span>
                                   </div>
                                   <div className="flex items-center gap-2 text-[10px] font-bold text-rose-400 uppercase">
                                      <span className="w-10">Tax</span>
                                      <span className="font-black">-₹{r.salesTax.toLocaleString()}</span>
                                   </div>
                                </div>
                             </td>
                             <td className="px-10 py-6 text-right font-black text-slate-900">₹{r.salesNet.toLocaleString()}</td>
                             <td className="px-10 py-6 text-right font-black text-indigo-600">₹{r.itemsTotal.toLocaleString()}</td>
                             <td className="px-10 py-6">
                                <div className="flex justify-center">
                                   {r.type === 'synced' && <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase tracking-widest"><CheckCircle2 size={12}/> Synced</div>}
                                   {r.type === 'orphan_items' && <div className="flex items-center gap-1.5 px-3 py-1 bg-rose-50 text-rose-600 rounded-full text-[9px] font-black uppercase tracking-widest"><AlertTriangle size={12}/> Orphan</div>}
                                   {r.type === 'hollow_order' && <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-[9px] font-black uppercase tracking-widest"><XCircle size={12}/> Hollow</div>}
                                   {r.type === 'drift' && <div className="flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[9px] font-black uppercase tracking-widest"><Scale size={12}/> Drift</div>}
                                </div>
                             </td>
                          </tr>
                       ))}
                    </tbody>
                 </table>
              </div>

              {auditReport.results.length === 0 && (
                <div className="py-32 text-center">
                   <SearchX size={56} className="mx-auto text-slate-200 mb-6" />
                   <p className="text-slate-400 font-black uppercase text-xs tracking-widest">Clear Scan: No Discrepancies</p>
                </div>
              )}
           </section>
        </div>
      )}
    </div>
  );
};

export default IntegrityAudit;