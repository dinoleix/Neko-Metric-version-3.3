import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import {
  BankTransaction, DailyCounterEntry, PurchaseRecord, Vendor, getOutletName,
} from '../types';
import {
  Store, ChevronDown, ChevronRight, Loader2, ArrowRightLeft, AlertTriangle,
  Clock, PackageSearch, CheckCircle2,
} from 'lucide-react';

/**
 * Vendor Ledger — finds purchases that were never matched to the bank payment
 * that settled them, without assuming payment happens right next to the
 * purchase date the way Match Discovery's ±0/1/2 day window does.
 *
 * Grouped by VENDOR, not by date: for each supplier, every purchase/crew entry
 * that is not cash, not cancelled and not yet isBankVerified is a candidate,
 * across a selectable lookback (1 week up to 12 months — the day-level search
 * Match Discovery does would not scale to "forty purchases over a month cleared
 * by one payment"). A lump payment either clears the pile exactly, or is
 * matched FIFO against the oldest bills first — the same convention real
 * accounts-payable ledgers use, and the only one that scales without a
 * combinatorial search over dozens of line items.
 *
 * PAID vs PENDING matters and is kept separate throughout. A 'pending' crew
 * entry has not been paid by any method yet, so it cannot correspond to a bank
 * transaction that already happened — only paidItems/paidTotal are ever offered
 * as a match. Pending bills are still shown (never hidden), with a one-bill-at-
 * a-time "was this actually paid?" action for the case where the crew simply
 * forgot to update the status — confirming that ALSO corrects the status to
 * 'paid', because discovering the real bank line is the correction.
 *
 * Vendor grouping is by NORMALISED NAME TEXT, not vendorId. A linked vendor and
 * a free-typed one with the same name group together; two different spellings
 * of the same supplier do not. That is a known, accepted limitation — the
 * alternative (vendorId-only) would strand most existing history, which has no
 * link at all.
 */

const NO_VENDOR_KEY = '__NO_VENDOR__';
// Days, not months: a 1/2-week option doesn't divide evenly into months, and
// most reconciliation happens weekly-to-monthly — the multi-month options exist
// for the occasional vendor whose tab really does run long.
const LOOKBACK_OPTIONS = [
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: '12 months', days: 365 },
];

interface LedgerItem {
  id: string;
  source: 'purchases' | 'crew_entries';
  date: string;
  amount: number;
  description: string;
  category: string;
  outletId: string;
  billNo: string;
  vendorKey: string;
  vendorLabel: string;
  /**
   * 'paid' or 'pending' for a crew entry; undefined for a CSV purchase record,
   * which has no such concept — those are treated as already paid. A pending
   * bill has not been paid by ANY method yet, so it cannot correspond to a bank
   * transaction that already happened — it is shown for visibility, never
   * offered as part of a match.
   */
  status?: 'paid' | 'pending';
}

interface VendorGroup {
  key: string;
  label: string;
  items: LedgerItem[];        // everything, oldest first — for the itemised display
  paidItems: LedgerItem[];    // subset: the matchable pool
  pendingItems: LedgerItem[]; // subset: owed but not yet paid by any method
  paidTotal: number;
  pendingTotal: number;
  oldestPaid: string;         // age/staleness signal, and the floor date for suggestions
}

const daysAgoStr = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
};

const daysAgo = (dateStr: string) => Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);

const VendorLedger: React.FC<{
  user: User;
  dataOwnerId: string;
  bankTransactions: BankTransaction[]; // all-time, already loaded by the parent
  onLinked: () => void; // refresh the parent's bank transaction list after a write
}> = ({ user, dataOwnerId, bankTransactions, onLinked }) => {
  const [lookbackDays, setLookbackDays] = useState(30); // 1 month — the stated typical cycle
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchOutstanding = async () => {
    setLoading(true);
    try {
      const since = daysAgoStr(lookbackDays);

      const [vendorSnap, purchaseSnap, crewByOwner, crewByUser] = await Promise.all([
        getDocs(query(collection(db, 'vendors'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'purchases'), where('userId', '==', dataOwnerId), where('date', '>=', since))),
        getDocs(query(collection(db, 'crew_entries'), where('ownerId', '==', dataOwnerId), where('date', '>=', since))),
        getDocs(query(collection(db, 'crew_entries'), where('userId', '==', user.uid), where('date', '>=', since))),
      ]);

      const vendorNameById = new Map<string, string>();
      vendorSnap.docs.forEach(d => vendorNameById.set(d.id, (d.data() as Vendor).name));

      const seen = new Set<string>();
      const crewDocs = [...crewByOwner.docs, ...crewByUser.docs].filter(d => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });

      const out: LedgerItem[] = [];

      purchaseSnap.docs.forEach(d => {
        const p = d.data() as PurchaseRecord;
        if (p.isBankVerified) return;
        const name = (p.vendor || '').trim().toUpperCase();
        out.push({
          id: d.id, source: 'purchases', date: p.date, amount: Number(p.amount || 0),
          description: p.productName || 'Purchase', category: (p.category || '').toUpperCase(),
          outletId: p.outletId || 'GLOBAL', billNo: p.billNo || '',
          vendorKey: name || NO_VENDOR_KEY, vendorLabel: name || 'No vendor recorded',
        });
      });

      crewDocs.forEach(d => {
        const c = d.data() as DailyCounterEntry & { isBankVerified?: boolean };
        // Cash never passes through the bank, so it can never be part of what a
        // bank line settled — the same exclusion Match Discovery applies.
        if (c.type !== 'purchase') return;
        if (c.status === 'cancelled') return;
        if (c.isBankVerified) return;
        const resolved = (c.vendorId && vendorNameById.get(c.vendorId)) || c.vendorName || '';
        const name = resolved.trim().toUpperCase();
        out.push({
          id: d.id, source: 'crew_entries', date: c.date, amount: Number(c.amount || 0),
          description: c.description || resolved || 'Crew purchase', category: (c.category || '').toUpperCase(),
          outletId: c.outletId || 'GLOBAL', billNo: c.billNumber || '',
          vendorKey: name || NO_VENDOR_KEY, vendorLabel: name || 'No vendor recorded',
          status: c.status === 'pending' ? 'pending' : 'paid',
        });
      });

      setItems(out);
    } catch (err) {
      console.error('[vendor-ledger] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOutstanding(); }, [dataOwnerId, lookbackDays]); // eslint-disable-line react-hooks/exhaustive-deps

  const vendorGroups = useMemo((): VendorGroup[] => {
    const map = new Map<string, VendorGroup>();
    items.forEach(it => {
      if (it.vendorKey === NO_VENDOR_KEY) return;
      if (!map.has(it.vendorKey)) {
        map.set(it.vendorKey, {
          key: it.vendorKey, label: it.vendorLabel, items: [],
          paidItems: [], pendingItems: [], paidTotal: 0, pendingTotal: 0, oldestPaid: it.date,
        });
      }
      const g = map.get(it.vendorKey)!;
      g.items.push(it);
      if (it.status === 'pending') {
        g.pendingItems.push(it);
        g.pendingTotal += it.amount;
      } else {
        g.paidItems.push(it);
        g.paidTotal += it.amount;
        if (it.date < g.oldestPaid) g.oldestPaid = it.date;
      }
    });
    map.forEach(g => {
      g.items.sort((a, b) => a.date.localeCompare(b.date));
      g.paidItems.sort((a, b) => a.date.localeCompare(b.date));
      g.pendingItems.sort((a, b) => a.date.localeCompare(b.date));
    });
    // Vendors with nothing paid yet (only pending bills) still deserve visibility —
    // sort them after the ones with an actual matchable balance.
    return Array.from(map.values())
      .filter(g => g.paidItems.length > 0 || g.pendingItems.length > 0)
      .sort((a, b) => (b.paidTotal - a.paidTotal) || (b.pendingTotal - a.pendingTotal));
  }, [items]);

  const noVendorItems = useMemo(
    () => items.filter(i => i.vendorKey === NO_VENDOR_KEY).sort((a, b) => a.date.localeCompare(b.date)),
    [items],
  );

  // Debits within the lookback that carry no bill link at all — the candidate
  // pool for clearing a vendor's balance, and separately the source of the two
  // "possibly missing" lists below.
  const unmatchedDebits = useMemo(() => {
    const since = daysAgoStr(lookbackDays);
    return bankTransactions
      .filter(t => t.type === 'debit' && !t.matchedPurchaseId && t.date >= since)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [bankTransactions, lookbackDays]);

  // Debits with no bill link AND no recognised non-purchase category — spend
  // that never became a purchase, expense, or explicit category at all, which
  // is the direct answer to "is anything missing from the P&L".
  // Two distinct confidence levels, not one fuzzy list. RENT/PAYROLL/LOAN_EMI/
  // PERSONAL/transfers/capital spend are EXPECTED to have no purchase record —
  // excluded from both. Anything else is a genuine gap, split by how sure we can
  // be it is one:
  const noRecordAtAll = useMemo(
    () => unmatchedDebits.filter(t => !(t.category || '').trim()).sort((a, b) => b.amount - a.amount),
    [unmatchedDebits],
  );
  // Categorised as purchase-type spend, but nobody ever logged the underlying
  // bill — the direct "crew forgot to enter this" signal.
  const categorisedNotLogged = useMemo(
    () => unmatchedDebits
      .filter(t => ['COGS', 'OPERATIONS', 'OTHER'].includes((t.category || '').trim().toUpperCase()))
      .sort((a, b) => b.amount - a.amount),
    [unmatchedDebits],
  );

  /**
   * Suggestions for one vendor: bank lines whose amount matches the FULL
   * outstanding balance, and separately, lines that match a FIFO prefix of it
   * (a partial payment against the oldest bills). A payment dated before the
   * vendor's oldest unpaid item is excluded — it cannot be settling a bill that
   * did not exist yet.
   */
  // Matches only against paidItems/paidTotal — a pending bill has not been paid
  // by any method yet, so no bank transaction can possibly correspond to it.
  const suggestionsFor = (group: VendorGroup) => {
    if (group.paidItems.length === 0) return { exact: [], fifo: [] };
    const tolerance = Math.max(1, group.paidTotal * 0.02);
    const candidates = unmatchedDebits.filter(t => t.date >= group.oldestPaid);

    const exact = candidates.filter(t => Math.abs(t.amount - group.paidTotal) <= tolerance);

    const fifo: { txn: BankTransaction; itemsToClear: LedgerItem[]; sum: number }[] = [];
    candidates.forEach(t => {
      if (t.amount >= group.paidTotal - tolerance) return; // covered by `exact`, or overpays the whole balance
      let sum = 0;
      const chosen: LedgerItem[] = [];
      for (const it of group.paidItems) {
        if (sum + it.amount > t.amount + tolerance) break;
        chosen.push(it);
        sum += it.amount;
      }
      if (chosen.length > 0 && Math.abs(sum - t.amount) <= tolerance) {
        fifo.push({ txn: t, itemsToClear: chosen, sum });
      }
    });

    return { exact, fifo: fifo.sort((a, b) => b.itemsToClear.length - a.itemsToClear.length).slice(0, 3) };
  };

  /**
   * Links a bank line to a set of outstanding items. Mirrors handleLinkCombination
   * in BankReconciliation — matchedPurchaseIds holds the full set, matchedPurchaseId
   * keeps the first so older single-match readers still resolve to something real.
   * Payment status on the crew entries is deliberately left alone: knowing a bill
   * cleared through the bank is a different fact from the crew's own paid/pending
   * workflow, and conflating them was avoided everywhere else this ledger touches.
   */
  const clearItems = async (txn: BankTransaction, itemsToClear: LedgerItem[]) => {
    const cats = Array.from(new Set(itemsToClear.map(i => i.category || 'COGS')));
    const category = cats.length === 1 ? cats[0] : 'COGS';
    if (cats.length > 1 && !window.confirm(
      `These ${itemsToClear.length} items carry different categories (${cats.join(', ')}).\n\n` +
      `The bank line will be categorised as COGS. Continue?`
    )) return;

    if (!window.confirm(
      `Link ${itemsToClear.length} item${itemsToClear.length === 1 ? '' : 's'} totalling ` +
      `₹${itemsToClear.reduce((s, i) => s + i.amount, 0).toLocaleString('en-IN')} to the ` +
      `₹${txn.amount.toLocaleString('en-IN')} payment on ${new Date(txn.date).toLocaleDateString('en-IN')}?`
    )) return;

    setBusyId(txn.id!);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'bank_statement_imports', txn.id!), {
        category, isVerified: true, isReconciled: true, aiSuggested: false,
        matchedPurchaseId: itemsToClear[0].id,
        matchedPurchaseIds: itemsToClear.map(i => i.id),
        matchedSource: itemsToClear[0].source,
      });
      itemsToClear.forEach(i => {
        if (i.source === 'crew_entries') batch.update(doc(db, 'crew_entries', i.id), { isBankVerified: true });
        else batch.update(doc(db, 'purchases', i.id), { category, isBankVerified: true });
      });
      await batch.commit();
      await fetchOutstanding();
      onLinked();
    } catch (err: any) {
      console.error('[vendor-ledger] clear failed:', err);
      alert(err?.code === 'permission-denied'
        ? 'You do not have permission to link these records.'
        : `Could not link: ${err?.message || err}`);
    } finally {
      setBusyId(null);
    }
  };

  /**
   * A pending bill has not been paid by any method — but the crew may simply
   * have forgotten to flip its status after the real payment went out. This
   * offers a bank line matching ONE pending item's own amount (never summed
   * with others, since we have no confirmed evidence any of them were paid).
   * Confirming both links the bank line AND corrects the status to 'paid' —
   * that correction IS what discovering a real match means.
   */
  const candidatesForPending = (item: LedgerItem) => {
    const tolerance = Math.max(1, item.amount * 0.02);
    return unmatchedDebits
      .filter(t => t.date >= item.date && Math.abs(t.amount - item.amount) <= tolerance)
      .slice(0, 3);
  };

  const matchPendingItem = async (txn: BankTransaction, item: LedgerItem) => {
    if (!window.confirm(
      `Mark this bill PAID and link it to the ₹${txn.amount.toLocaleString('en-IN')} payment on ` +
      `${new Date(txn.date).toLocaleDateString('en-IN')}?\n\n` +
      `This corrects its status in Crew Terminal from Pending to Paid. Only confirm this if you know the bill was actually paid.`
    )) return;
    setBusyId(txn.id!);
    try {
      const category = item.category || 'COGS';
      const batch = writeBatch(db);
      batch.update(doc(db, 'bank_statement_imports', txn.id!), {
        category, isVerified: true, isReconciled: true, aiSuggested: false,
        matchedPurchaseId: item.id, matchedPurchaseIds: [item.id], matchedSource: 'crew_entries',
      });
      batch.update(doc(db, 'crew_entries', item.id), { isBankVerified: true, status: 'paid' });
      await batch.commit();
      await fetchOutstanding();
      onLinked();
    } catch (err: any) {
      console.error('[vendor-ledger] pending match failed:', err);
      alert(err?.code === 'permission-denied'
        ? 'You do not have permission to link this record.'
        : `Could not link: ${err?.message || err}`);
    } finally {
      setBusyId(null);
    }
  };

  const grandPaid = vendorGroups.reduce((s, g) => s + g.paidTotal, 0);
  const grandPending = vendorGroups.reduce((s, g) => s + g.pendingTotal, 0);
  const staleCount = vendorGroups.filter(g => g.paidItems.length > 0 && daysAgo(g.oldestPaid) > 60).length;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><Store size={22} /></div>
            <div>
              <h3 className="text-xl font-black text-slate-900 tracking-tight">Vendor Ledger</h3>
              <p className="text-slate-500 text-sm font-medium mt-0.5 max-w-xl leading-snug">
                Every purchase not yet matched to a bank payment, grouped by supplier —
                so a bill from three weeks ago can still be found against a payment made today.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {LOOKBACK_OPTIONS.map(o => (
              <button key={o.days} onClick={() => setLookbackDays(o.days)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  lookbackDays === o.days ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400 border border-slate-200 hover:text-slate-600'
                }`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 size={28} className="animate-spin text-indigo-400" /></div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-slate-50 border border-slate-100 rounded-2xl px-6 py-5">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Awaiting bank match</p>
              <p className="text-xl font-black text-slate-900 tabular-nums">₹{Math.round(grandPaid).toLocaleString('en-IN')}</p>
            </div>
            <div className={`rounded-2xl px-6 py-5 border ${grandPending > 0 ? 'bg-slate-50 border-slate-200' : 'bg-slate-50 border-slate-100'}`}>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Still unpaid</p>
              <p className="text-xl font-black text-slate-500 tabular-nums">₹{Math.round(grandPending).toLocaleString('en-IN')}</p>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-2xl px-6 py-5">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Vendors</p>
              <p className="text-xl font-black text-slate-900 tabular-nums">{vendorGroups.length}</p>
            </div>
            <div className={`rounded-2xl px-6 py-5 border ${staleCount > 0 ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
              <p className={`text-[9px] font-black uppercase tracking-widest mb-1 ${staleCount > 0 ? 'text-amber-700' : 'text-slate-400'}`}>Paid, over 60d unmatched</p>
              <p className={`text-xl font-black tabular-nums ${staleCount > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{staleCount}</p>
            </div>
            <div className={`rounded-2xl px-6 py-5 border ${noVendorItems.length > 0 ? 'bg-slate-50 border-slate-200' : 'bg-slate-50 border-slate-100'}`}>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">No vendor recorded</p>
              <p className="text-xl font-black text-slate-900 tabular-nums">{noVendorItems.length}</p>
            </div>
          </div>
        )}
      </div>

      {!loading && (noRecordAtAll.length > 0 || categorisedNotLogged.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-[2.5rem] p-8 space-y-6">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-amber-500/15 rounded-xl"><AlertTriangle size={20} className="text-amber-600" /></div>
            <div>
              <h4 className="text-sm font-black text-amber-800 uppercase tracking-widest">Possibly missing from your records</h4>
              <p className="text-xs font-medium text-amber-700 mt-0.5">
                Bank debits with no bill behind them — spend that may never have reached a purchase or expense entry.
              </p>
            </div>
          </div>

          {noRecordAtAll.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2">
                No category at all ({noRecordAtAll.length})
              </p>
              <div className="space-y-2">
                {noRecordAtAll.slice(0, 8).map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-4 bg-white/70 border border-amber-100 rounded-xl px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-slate-400 uppercase">{new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                      <p className="text-xs font-bold text-slate-700 truncate max-w-md">{t.description}</p>
                    </div>
                    <span className="text-sm font-black text-amber-700 tabular-nums shrink-0">₹{t.amount.toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {noRecordAtAll.length > 8 && (
                  <p className="text-[10px] font-bold text-amber-600 uppercase pt-1">
                    +{noRecordAtAll.length - 8} more — Transaction Mapping, filtered to Uncategorised.
                  </p>
                )}
              </div>
            </div>
          )}

          {categorisedNotLogged.length > 0 && (
            <div>
              <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-2">
                Categorised, but no purchase logged — the crew may have forgotten to enter this ({categorisedNotLogged.length})
              </p>
              <div className="space-y-2">
                {categorisedNotLogged.slice(0, 8).map(t => (
                  <div key={t.id} className="flex items-center justify-between gap-4 bg-white/70 border border-amber-100 rounded-xl px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-black text-slate-400 uppercase">{new Date(t.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {t.category}</p>
                      <p className="text-xs font-bold text-slate-700 truncate max-w-md">{t.description}</p>
                    </div>
                    <span className="text-sm font-black text-amber-700 tabular-nums shrink-0">₹{t.amount.toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {categorisedNotLogged.length > 8 && (
                  <p className="text-[10px] font-bold text-amber-600 uppercase pt-1">
                    +{categorisedNotLogged.length - 8} more.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && vendorGroups.length === 0 && noVendorItems.length === 0 && (
        <div className="py-20 text-center bg-white rounded-[2.5rem] border-2 border-dashed border-slate-200">
          <CheckCircle2 size={40} className="mx-auto text-emerald-300 mb-4" />
          <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Nothing outstanding</p>
          <p className="text-slate-400 text-sm mt-1">Every purchase in this window is matched to a bank payment.</p>
        </div>
      )}

      {!loading && vendorGroups.map(group => {
        const isOpen = expanded === group.key;
        const age = group.paidItems.length > 0 ? daysAgo(group.oldestPaid) : null;
        const { exact, fifo } = isOpen ? suggestionsFor(group) : { exact: [], fifo: [] };
        return (
          <div key={group.key} className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
            <button onClick={() => setExpanded(isOpen ? null : group.key)}
              className="w-full text-left px-8 py-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {isOpen ? <ChevronDown size={18} className="text-slate-400 shrink-0" /> : <ChevronRight size={18} className="text-slate-400 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-black text-slate-900 truncate">{group.label}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5 flex items-center gap-2 flex-wrap">
                    {group.paidItems.length > 0 && (
                      <span>{group.paidItems.length} awaiting match</span>
                    )}
                    {group.pendingItems.length > 0 && (
                      <span className="text-amber-600">{group.pendingItems.length} still unpaid</span>
                    )}
                    {age !== null && (
                      <span className={`flex items-center gap-1 ${age > 60 ? 'text-amber-600' : ''}`}>
                        <Clock size={10} /> oldest {age}d ago
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <span className="text-lg font-black text-slate-800 tabular-nums block">₹{Math.round(group.paidTotal).toLocaleString('en-IN')}</span>
                {group.pendingTotal > 0 && (
                  <span className="text-[10px] font-bold text-amber-600 tabular-nums">+₹{Math.round(group.pendingTotal).toLocaleString('en-IN')} unpaid</span>
                )}
              </div>
            </button>

            {isOpen && (
              <div className="px-8 pb-8 space-y-6 animate-in slide-in-from-top-2 duration-200">
                {(exact.length > 0 || fifo.length > 0) && (
                  <div className="space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Suggested clearing</p>
                    {exact.map(txn => (
                      <div key={txn.id} className="flex items-center justify-between gap-4 bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4">
                        <div className="min-w-0">
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-emerald-600 text-white">Full balance match</span>
                          <p className="text-xs font-bold text-slate-700 mt-1.5 truncate">
                            ₹{txn.amount.toLocaleString('en-IN')} on {new Date(txn.date).toLocaleDateString('en-IN')} — {txn.description}
                          </p>
                        </div>
                        <button onClick={() => clearItems(txn, group.paidItems)} disabled={busyId === txn.id}
                          className="shrink-0 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50">
                          {busyId === txn.id ? <Loader2 size={13} className="animate-spin" /> : <ArrowRightLeft size={13} />}
                          Clear all {group.paidItems.length}
                        </button>
                      </div>
                    ))}
                    {fifo.map(({ txn, itemsToClear }) => (
                      <div key={txn.id} className="flex items-center justify-between gap-4 bg-indigo-50 border border-indigo-200 rounded-2xl px-5 py-4">
                        <div className="min-w-0">
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-indigo-600 text-white">Partial — oldest {itemsToClear.length}</span>
                          <p className="text-xs font-bold text-slate-700 mt-1.5 truncate">
                            ₹{txn.amount.toLocaleString('en-IN')} on {new Date(txn.date).toLocaleDateString('en-IN')} clears the {itemsToClear.length} oldest bills
                          </p>
                        </div>
                        <button onClick={() => clearItems(txn, itemsToClear)} disabled={busyId === txn.id}
                          className="shrink-0 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 disabled:opacity-50">
                          {busyId === txn.id ? <Loader2 size={13} className="animate-spin" /> : <ArrowRightLeft size={13} />}
                          Clear oldest {itemsToClear.length}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {group.paidItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Awaiting bank match — oldest first</p>
                    {group.paidItems.map(it => (
                      <div key={it.id} className="flex items-center justify-between gap-4 px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${it.source === 'crew_entries' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
                            {it.source === 'crew_entries' ? 'Crew' : 'CSV'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-400 shrink-0">{new Date(it.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                          <span className="text-xs font-bold text-slate-600 truncate">{it.description}</span>
                          <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">{getOutletName(it.outletId)}</span>
                        </div>
                        <span className="text-xs font-black text-slate-700 tabular-nums shrink-0">₹{it.amount.toLocaleString('en-IN')}</span>
                      </div>
                    ))}
                  </div>
                )}

                {group.pendingItems.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest">
                      Still unpaid — not yet paid by any method, so not offered in the suggestions above
                    </p>
                    {group.pendingItems.map(it => {
                      const candidates = candidatesForPending(it);
                      return (
                        <div key={it.id} className="px-4 py-3 bg-amber-50/60 border border-amber-100 rounded-xl">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Pending</span>
                              <span className="text-[10px] font-bold text-slate-400 shrink-0">{new Date(it.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                              <span className="text-xs font-bold text-slate-600 truncate">{it.description}</span>
                              <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">{getOutletName(it.outletId)}</span>
                            </div>
                            <span className="text-xs font-black text-slate-700 tabular-nums shrink-0">₹{it.amount.toLocaleString('en-IN')}</span>
                          </div>
                          {candidates.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="text-[9px] font-bold text-amber-700 uppercase">Was it actually already paid?</span>
                              {candidates.map(txn => (
                                <button key={txn.id} onClick={() => matchPendingItem(txn, it)} disabled={busyId === txn.id}
                                  className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-amber-100 disabled:opacity-50 flex items-center gap-1.5">
                                  {busyId === txn.id ? <Loader2 size={11} className="animate-spin" /> : <ArrowRightLeft size={11} />}
                                  ₹{txn.amount.toLocaleString('en-IN')} on {new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {!loading && noVendorItems.length > 0 && (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-8">
          <div className="flex items-center gap-4 mb-1">
            <div className="p-2.5 bg-slate-100 text-slate-500 rounded-xl"><PackageSearch size={18} /></div>
            <h4 className="text-sm font-black text-slate-700 uppercase tracking-widest">No vendor recorded</h4>
          </div>
          <p className="text-xs font-medium text-slate-400 mb-5 max-w-xl">
            These purchases have no supplier name at all, so they cannot be grouped or matched here.
            Total ₹{Math.round(noVendorItems.reduce((s, i) => s + i.amount, 0)).toLocaleString('en-IN')}.
            New purchases now require a vendor in Crew Terminal, so this list should stop growing.
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {noVendorItems.slice(0, 30).map(it => (
              <div key={it.id} className="flex items-center justify-between gap-4 px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${it.source === 'crew_entries' ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
                    {it.source === 'crew_entries' ? 'Crew' : 'CSV'}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">{new Date(it.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                  <span className="text-xs font-bold text-slate-600 truncate">{it.description}</span>
                </div>
                <span className="text-xs font-black text-slate-700 tabular-nums shrink-0">₹{it.amount.toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorLedger;
