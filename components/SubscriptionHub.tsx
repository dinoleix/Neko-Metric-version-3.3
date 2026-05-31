import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import {
  collection, query, where, getDocs, doc, writeBatch, updateDoc, deleteDoc, addDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Subscription, SubscriptionCustomer, SubscriptionOrder, SubscriptionLineItem,
  SubscriptionStatus, DeliveryDay
} from '../types';
import {
  Users, CalendarCheck, LayoutGrid, Truck, ChevronDown, ChevronUp,
  Plus, Check, X, Loader2, CheckCircle2, Search, Phone, MapPin,
  Package, Tag, Clock, TrendingUp, AlertCircle, Edit2, Trash2,
  RefreshCw, Calendar, Star
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const istToday = (): string => {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().split('T')[0];
};

const DAY_LABELS: Record<DeliveryDay, string> = {
  MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun'
};
const ALL_DAYS: DeliveryDay[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const DAY_MAP: Record<number, DeliveryDay> = { 0: 'SUN', 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT' };

function generateDeliveryDates(startDate: string, endDate: string, deliveryDays: DeliveryDay[]): string[] {
  const dates: string[] = [];
  const cur = new Date(startDate + 'T00:00:00+05:30');
  const end = new Date(endDate + 'T00:00:00+05:30');
  while (cur <= end) {
    const dow = DAY_MAP[cur.getDay()];
    if (deliveryDays.includes(dow)) {
      dates.push(cur.toISOString().split('T')[0]);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function computeLineItemTotals(items: SubscriptionLineItem[], discountPercent: number) {
  const baseTotal = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const discountedTotal = items.reduce((s, i) => s + i.qty * i.discountedUnitPrice, 0);
  return { baseTotal, discountedTotal };
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00+05:30');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const STATUS_COLOR: Record<SubscriptionStatus, string> = {
  pending_approval: 'bg-amber-50 text-amber-700 border-amber-200',
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused: 'bg-slate-100 text-slate-600 border-slate-200',
  cancelled: 'bg-rose-50 text-rose-600 border-rose-200',
  completed: 'bg-indigo-50 text-indigo-600 border-indigo-200',
};

const STATUS_LABEL: Record<SubscriptionStatus, string> = {
  pending_approval: 'Pending Approval',
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

type HubTab = 'overview' | 'subscriptions' | 'customers' | 'deliveries';

// ─── Component ────────────────────────────────────────────────────────────────

const SubscriptionHub: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [activeTab, setActiveTab] = useState<HubTab>('overview');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [customers, setCustomers] = useState<SubscriptionCustomer[]>([]);
  const [orders, setOrders] = useState<SubscriptionOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  // Approval panel state
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approvalDiscount, setApprovalDiscount] = useState('15');
  const [approvalDays, setApprovalDays] = useState<DeliveryDay[]>(['MON', 'WED', 'FRI']);
  const [approvalEndDate, setApprovalEndDate] = useState('');

  // Deliveries filter
  const [deliveryFilter, setDeliveryFilter] = useState<'all' | 'scheduled' | 'delivered' | 'skipped'>('all');
  const [deliveryDateFrom, setDeliveryDateFrom] = useState(istToday());
  const [deliveryDateTo, setDeliveryDateTo] = useState(addDays(istToday(), 7));

  // Customer search
  const [customerSearch, setCustomerSearch] = useState('');

  // Subscription filter
  const [subStatusFilter, setSubStatusFilter] = useState<SubscriptionStatus | 'all'>('all');

  const fetchAll = async () => {
    setLoading(true);
    setError('');
    try {
      // Single-field queries only — avoids composite index requirements on new collections.
      // Sorting is done client-side.
      const [subSnap, custSnap, ordSnap] = await Promise.all([
        getDocs(query(collection(db, 'subscriptions'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'subscription_customers'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'subscription_orders'), where('ownerId', '==', dataOwnerId))),
      ]);
      setSubscriptions(subSnap.docs.map(d => ({ id: d.id, ...d.data() } as Subscription)).sort((a, b) => b.createdAt - a.createdAt));
      setCustomers(custSnap.docs.map(d => ({ id: d.id, ...d.data() } as SubscriptionCustomer)).sort((a, b) => b.createdAt - a.createdAt));
      setOrders(ordSnap.docs.map(d => ({ id: d.id, ...d.data() } as SubscriptionOrder)).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)));
    } catch (e) {
      setError('Failed to load subscription data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, [dataOwnerId]);

  // ── Overview metrics ──────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const active = subscriptions.filter(s => s.status === 'active');
    const pending = subscriptions.filter(s => s.status === 'pending_approval');
    const mrr = active.reduce((sum, s) => {
      const { discountedTotal } = computeLineItemTotals(s.defaultItems, s.discountPercent);
      return sum + discountedTotal * s.totalDeliveries;
    }, 0);
    const today = istToday();
    const todayDeliveries = orders.filter(o => o.scheduledDate === today && o.status === 'scheduled');
    const thisWeekEnd = addDays(today, 6);
    const weekDeliveries = orders.filter(o => o.scheduledDate >= today && o.scheduledDate <= thisWeekEnd);
    return { activeCount: active.length, pendingCount: pending.length, mrr, todayCount: todayDeliveries.length, weekCount: weekDeliveries.length };
  }, [subscriptions, orders]);

  // ── Approval helpers ───────────────────────────────────────────────────────
  const openApproval = (sub: Subscription) => {
    setApprovingId(sub.id!);
    setApprovalDiscount(sub.discountPercent > 0 ? String(sub.discountPercent) : '15');
    setApprovalDays(sub.deliveryDays.length > 0 ? sub.deliveryDays : ['MON', 'WED', 'FRI']);
    setApprovalEndDate(sub.endDate || addDays(sub.startDate, 29));
  };

  const handleApprove = async () => {
    if (!approvingId) return;
    const sub = subscriptions.find(s => s.id === approvingId);
    if (!sub) return;
    const discount = Number(approvalDiscount) || 0;
    const endDate = approvalEndDate || addDays(sub.startDate, 29);
    const dates = generateDeliveryDates(sub.startDate, endDate, approvalDays);
    if (dates.length === 0) { setError('No delivery dates generated — check start/end date and selected days.'); return; }

    setSaving(true); setError('');
    try {
      const now = Date.now();
      const updatedItems: SubscriptionLineItem[] = sub.defaultItems.map(item => ({
        ...item,
        discountedUnitPrice: +(item.unitPrice * (1 - discount / 100)).toFixed(2),
      }));
      const { baseTotal, discountedTotal } = computeLineItemTotals(updatedItems, discount);

      const BATCH_LIMIT = 400;
      for (let i = 0; i < dates.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        dates.slice(i, i + BATCH_LIMIT).forEach(date => {
          batch.set(doc(collection(db, 'subscription_orders')), {
            subscriptionId: sub.id,
            customerId: sub.customerId,
            customerName: sub.customerName,
            customerPhone: sub.customerPhone,
            customerAddress: sub.customerAddress,
            userId: user.uid,
            ownerId: dataOwnerId,
            outletId: sub.outletId,
            scheduledDate: date,
            status: 'scheduled',
            items: updatedItems,
            baseTotal,
            discountedTotal,
            discountPercent: discount,
            notes: '',
            createdAt: now,
            updatedAt: now,
          } as Omit<SubscriptionOrder, 'id'>);
        });
        if (i === 0) {
          batch.update(doc(db, 'subscriptions', sub.id!), {
            status: 'active',
            discountPercent: discount,
            deliveryDays: approvalDays,
            endDate,
            defaultItems: updatedItems,
            totalDeliveries: dates.length,
            updatedAt: now,
          });
        }
        await batch.commit();
      }
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
      setApprovingId(null);
      await fetchAll();
    } catch (e) {
      setError('Approval failed. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (subId: string, newStatus: SubscriptionStatus) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'subscriptions', subId), { status: newStatus, updatedAt: Date.now() });
      setSubscriptions(prev => prev.map(s => s.id === subId ? { ...s, status: newStatus } : s));
    } catch { setError('Status update failed.'); }
    finally { setSaving(false); }
  };

  const handleDeleteSubscription = async (subId: string) => {
    if (!window.confirm('Delete this subscription? All scheduled orders will also be removed.')) return;
    setSaving(true);
    try {
      const relatedOrders = orders.filter(o => o.subscriptionId === subId && o.id);
      const batch = writeBatch(db);
      relatedOrders.forEach(o => batch.delete(doc(db, 'subscription_orders', o.id!)));
      batch.delete(doc(db, 'subscriptions', subId));
      await batch.commit();
      await fetchAll();
    } catch { setError('Delete failed.'); }
    finally { setSaving(false); }
  };

  const handleDeleteCustomer = async (custId: string) => {
    if (!window.confirm('Delete this customer? Their subscription data will remain.')) return;
    try {
      await deleteDoc(doc(db, 'subscription_customers', custId));
      setCustomers(prev => prev.filter(c => c.id !== custId));
    } catch { setError('Delete failed.'); }
  };

  // ── Filtered data ─────────────────────────────────────────────────────────
  const filteredSubs = useMemo(() =>
    subscriptions.filter(s => subStatusFilter === 'all' || s.status === subStatusFilter),
    [subscriptions, subStatusFilter]);

  const filteredCustomers = useMemo(() =>
    customers.filter(c =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.phone.includes(customerSearch)
    ), [customers, customerSearch]);

  const filteredOrders = useMemo(() =>
    orders.filter(o => {
      const inRange = o.scheduledDate >= deliveryDateFrom && o.scheduledDate <= deliveryDateTo;
      const matchStatus = deliveryFilter === 'all' || o.status === deliveryFilter;
      return inRange && matchStatus;
    }), [orders, deliveryFilter, deliveryDateFrom, deliveryDateTo]);

  const TABS: { id: HubTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutGrid size={16} /> },
    { id: 'subscriptions', label: 'Subscriptions', icon: <CalendarCheck size={16} />, badge: metrics.pendingCount || undefined },
    { id: 'customers', label: 'Customers', icon: <Users size={16} /> },
    { id: 'deliveries', label: 'Deliveries', icon: <Truck size={16} /> },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-700 pb-20">
      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <Star size={22} />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Subscription Hub</h2>
          </div>
          <p className="text-slate-500 font-medium uppercase text-xs tracking-widest">Manage recurring meal subscriptions</p>
        </div>
        <button onClick={fetchAll} disabled={loading} className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-100 text-slate-600 font-bold text-xs uppercase hover:bg-slate-200 transition-all">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </header>

      {error && <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-2xl px-5 py-3">{error}</p>}

      {/* Tab Bar */}
      <div className="flex flex-wrap bg-slate-100 p-1.5 rounded-[1.5rem] w-fit gap-1 border border-slate-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${activeTab === t.id ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {t.icon} {t.label}
            {t.badge ? (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-amber-500 text-white rounded-full text-[8px] font-black flex items-center justify-center">{t.badge}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Active', value: metrics.activeCount, icon: <CheckCircle2 size={20} />, color: 'text-emerald-600 bg-emerald-50' },
              { label: 'Pending Approval', value: metrics.pendingCount, icon: <Clock size={20} />, color: 'text-amber-600 bg-amber-50' },
              { label: "Today's Deliveries", value: metrics.todayCount, icon: <Truck size={20} />, color: 'text-indigo-600 bg-indigo-50' },
              { label: 'This Week', value: metrics.weekCount, icon: <Calendar size={20} />, color: 'text-slate-700 bg-slate-100' },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-3xl border border-slate-100 p-6 shadow-sm">
                <div className={`w-10 h-10 rounded-2xl flex items-center justify-center mb-3 ${card.color}`}>{card.icon}</div>
                <p className="text-3xl font-black text-slate-900">{card.value}</p>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">{card.label}</p>
              </div>
            ))}
          </div>
          <div className="bg-white rounded-3xl border border-slate-100 p-8 shadow-sm">
            <div className="flex items-center gap-3 mb-2">
              <TrendingUp size={18} className="text-indigo-600" />
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Estimated Monthly Recurring Revenue</p>
            </div>
            <p className="text-5xl font-black text-slate-900">₹{metrics.mrr.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
            <p className="text-xs text-slate-400 mt-2">Based on active subscriptions × default order value × total deliveries</p>
          </div>
          {metrics.pendingCount > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 flex items-center gap-4">
              <AlertCircle size={20} className="text-amber-600 shrink-0" />
              <div>
                <p className="text-sm font-black text-amber-800">{metrics.pendingCount} subscription{metrics.pendingCount > 1 ? 's' : ''} waiting for approval</p>
                <button onClick={() => setActiveTab('subscriptions')} className="text-xs font-bold text-amber-700 underline mt-0.5">Review now →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Subscriptions Tab ──────────────────────────────────────────────── */}
      {activeTab === 'subscriptions' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-2">
            {(['all', 'pending_approval', 'active', 'paused', 'completed', 'cancelled'] as const).map(f => (
              <button key={f} onClick={() => setSubStatusFilter(f)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${subStatusFilter === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}>
                {f === 'all' ? 'All' : STATUS_LABEL[f]}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-slate-300" /></div>
          ) : filteredSubs.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-3xl border border-dashed border-slate-200">
              <CalendarCheck size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">No subscriptions found</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredSubs.map(sub => (
                <div key={sub.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
                  <div className="p-6 flex flex-col md:flex-row md:items-center gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <p className="text-sm font-black text-slate-900 uppercase">{sub.customerName}</p>
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase border ${STATUS_COLOR[sub.status]}`}>{STATUS_LABEL[sub.status]}</span>
                      </div>
                      <div className="flex flex-wrap gap-4 text-[10px] text-slate-500 font-bold uppercase">
                        <span className="flex items-center gap-1"><Phone size={10} /> {sub.customerPhone}</span>
                        <span className="flex items-center gap-1"><MapPin size={10} /> {sub.customerAddress}</span>
                        <span className="flex items-center gap-1"><Calendar size={10} /> {sub.startDate} → {sub.endDate || '—'}</span>
                        <span className="flex items-center gap-1"><Tag size={10} /> {sub.discountPercent}% off</span>
                        <span className="flex items-center gap-1"><Truck size={10} /> {sub.deliveryDays.map(d => DAY_LABELS[d]).join(', ')}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {sub.defaultItems.map((item, i) => (
                          <span key={i} className="px-2 py-0.5 bg-slate-50 border border-slate-100 rounded-lg text-[9px] font-bold text-slate-600">
                            {item.itemName} ×{item.qty}
                          </span>
                        ))}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2">{sub.completedDeliveries}/{sub.totalDeliveries} deliveries completed</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {sub.status === 'pending_approval' && (
                        <button onClick={() => openApproval(sub)}
                          className="px-5 py-2.5 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow hover:bg-indigo-700 transition-all">
                          Approve
                        </button>
                      )}
                      {sub.status === 'active' && (
                        <button onClick={() => handleStatusChange(sub.id!, 'paused')}
                          className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase hover:bg-slate-200 transition-all">
                          Pause
                        </button>
                      )}
                      {sub.status === 'paused' && (
                        <button onClick={() => handleStatusChange(sub.id!, 'active')}
                          className="px-4 py-2 bg-emerald-100 text-emerald-700 rounded-xl text-[10px] font-black uppercase hover:bg-emerald-200 transition-all">
                          Resume
                        </button>
                      )}
                      {['active', 'paused'].includes(sub.status) && (
                        <button onClick={() => handleStatusChange(sub.id!, 'cancelled')}
                          className="px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-[10px] font-black uppercase hover:bg-rose-100 transition-all">
                          Cancel
                        </button>
                      )}
                      <button onClick={() => handleDeleteSubscription(sub.id!)}
                        className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:bg-rose-50 hover:text-rose-500 transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Customers Tab ─────────────────────────────────────────────────── */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
              placeholder="Search by name or phone..."
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm outline-none shadow-sm" />
          </div>
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-slate-300" /></div>
          ) : filteredCustomers.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-3xl border border-dashed border-slate-200">
              <Users size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">No customers yet</p>
              <p className="text-slate-400 text-xs mt-1">Crew adds customers from the Crew Terminal</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Name', 'Phone', 'Address', 'Subscriptions', ''].map(h => (
                      <th key={h} className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredCustomers.map(c => {
                    const subCount = subscriptions.filter(s => s.customerId === c.id).length;
                    return (
                      <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4 font-black text-slate-900 text-sm uppercase">{c.name}</td>
                        <td className="px-6 py-4 text-slate-600 text-xs font-bold">{c.phone}</td>
                        <td className="px-6 py-4 text-slate-500 text-xs max-w-[200px] truncate">{c.address}</td>
                        <td className="px-6 py-4">
                          <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-[9px] font-black border border-indigo-100">{subCount} sub{subCount !== 1 ? 's' : ''}</span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => handleDeleteCustomer(c.id!)} className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-300 hover:bg-rose-50 hover:text-rose-500 transition-all ml-auto">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Deliveries Tab ────────────────────────────────────────────────── */}
      {activeTab === 'deliveries' && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase">From</label>
              <input type="date" value={deliveryDateFrom} onChange={e => setDeliveryDateFrom(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold outline-none" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-black text-slate-500 uppercase">To</label>
              <input type="date" value={deliveryDateTo} onChange={e => setDeliveryDateTo(e.target.value)}
                className="px-3 py-2 border border-slate-200 rounded-xl text-xs font-bold outline-none" />
            </div>
            <div className="flex gap-2">
              {(['all', 'scheduled', 'delivered', 'skipped'] as const).map(f => (
                <button key={f} onClick={() => setDeliveryFilter(f)}
                  className={`px-3 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${deliveryFilter === f ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-slate-300" /></div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-16 text-center bg-white rounded-3xl border border-dashed border-slate-200">
              <Truck size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">No deliveries in this range</p>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100">
                    {['Date', 'Customer', 'Items', 'Value', 'Status'].map(h => (
                      <th key={h} className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredOrders.map(o => (
                    <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-xs font-black text-slate-700">{o.scheduledDate}</td>
                      <td className="px-6 py-4">
                        <p className="text-xs font-black text-slate-900 uppercase">{o.customerName}</p>
                        <p className="text-[10px] text-slate-400">{o.customerPhone}</p>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {o.items.slice(0, 3).map((item, i) => (
                            <span key={i} className="px-2 py-0.5 bg-slate-50 border border-slate-100 rounded-lg text-[9px] font-bold text-slate-600">
                              {item.itemName} ×{item.qty}
                            </span>
                          ))}
                          {o.items.length > 3 && <span className="text-[9px] text-slate-400">+{o.items.length - 3} more</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-xs font-black text-slate-900">₹{o.discountedTotal.toFixed(0)}</p>
                        <p className="text-[10px] text-slate-400 line-through">₹{o.baseTotal.toFixed(0)}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase border ${
                          o.status === 'delivered' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          o.status === 'skipped' ? 'bg-rose-50 text-rose-600 border-rose-200' :
                          o.status === 'confirmed' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' :
                          'bg-amber-50 text-amber-700 border-amber-200'
                        }`}>{o.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Approval Panel (modal) ────────────────────────────────────────── */}
      {approvingId && (() => {
        const sub = subscriptions.find(s => s.id === approvingId);
        if (!sub) return null;
        return (
          <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg animate-in zoom-in-95 duration-200">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase">Approve Subscription</h3>
                  <p className="text-xs text-slate-500 font-bold mt-1">{sub.customerName} · {sub.customerPhone}</p>
                </div>
                <button onClick={() => setApprovingId(null)} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-all">
                  <X size={16} />
                </button>
              </div>
              <div className="p-8 space-y-6">
                {/* Discount */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Discount %</label>
                  <input type="number" min="0" max="100" value={approvalDiscount} onChange={e => setApprovalDiscount(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-2xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                {/* Delivery Days */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Delivery Days</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_DAYS.map(d => (
                      <button key={d} onClick={() => setApprovalDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d])}
                        className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase border transition-all ${approvalDays.includes(d) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}>
                        {DAY_LABELS[d]}
                      </button>
                    ))}
                  </div>
                </div>
                {/* End Date */}
                <div>
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">End Date</label>
                  <input type="date" value={approvalEndDate || addDays(sub.startDate, 29)} onChange={e => setApprovalEndDate(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-2xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
                {/* Preview */}
                <div className="bg-indigo-50 rounded-2xl p-4 text-xs font-bold text-indigo-700">
                  {generateDeliveryDates(sub.startDate, approvalEndDate || addDays(sub.startDate, 29), approvalDays).length} deliveries will be scheduled · {approvalDays.map(d => DAY_LABELS[d]).join(', ')}
                </div>
                {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
              </div>
              <div className="p-8 border-t border-slate-100 flex gap-3">
                <button onClick={() => setApprovingId(null)} className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-600 font-black text-xs uppercase">Cancel</button>
                <button onClick={handleApprove} disabled={saving}
                  className="flex-1 py-4 rounded-2xl bg-indigo-600 text-white font-black text-xs uppercase shadow hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                  {saving ? <><Loader2 size={14} className="animate-spin" /> Activating...</> : <><Check size={14} /> Activate Subscription</>}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default SubscriptionHub;
