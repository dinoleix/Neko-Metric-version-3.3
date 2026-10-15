import React, { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { addDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { LoyaltyCustomer } from '../types';
import {
  AlertCircle, CalendarClock, ChevronLeft, ChevronRight, HeartHandshake,
  Loader2, MessageCircle, Send, ShieldCheck, Sparkles, Users, WalletCards,
} from 'lucide-react';

type Segment = 'all' | 'points' | 'vip' | 'at-risk' | 'new';
type Channel = 'whatsapp' | 'sms';

const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-IN');

const dateOf = (raw?: string) => {
  if (!raw) return null;
  const value = new Date(raw);
  return Number.isNaN(value.valueOf()) ? null : value;
};

const daysSince = (raw?: string) => {
  const date = dateOf(raw);
  return date ? Math.floor((Date.now() - date.valueOf()) / 86_400_000) : null;
};

const isAtRisk = (customer: LoyaltyCustomer) => {
  const days = daysSince(customer.lifetime?.lastTransactionAt);
  return customer.lifetime?.transactions > 0 && days !== null && days >= 60;
};

const CustomerIntelligence: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [customers, setCustomers] = useState<LoyaltyCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [campaignName, setCampaignName] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('Hi {{first_name}}, we would love to welcome you back to Green Neko.');
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');

  const loadCustomers = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getDocs(query(collection(db, 'loyalty_customers'), where('ownerId', '==', dataOwnerId)));
      setCustomers(result.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() } as LoyaltyCustomer)));
    } catch (err) {
      console.error(err);
      setError('Customer intelligence could not load. Check that the loyalty import has completed and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadCustomers(); }, [dataOwnerId]);

  const analytics = useMemo(() => {
    const active = customers.filter(customer => customer.lifetime?.transactions > 0);
    const pointsHolders = customers.filter(customer => customer.loyalty?.importedOpeningBalance > 0);
    const atRisk = customers.filter(isAtRisk);
    const lastVisits = active.map(customer => dateOf(customer.lifetime?.lastTransactionAt)).filter((value): value is Date => Boolean(value));
    return {
      active: active.length,
      newCustomers: customers.length - active.length,
      pointsHolders: pointsHolders.length,
      atRisk: atRisk.length,
      points: customers.reduce((sum, customer) => sum + (customer.loyalty?.importedOpeningBalance || 0), 0),
      spend: customers.reduce((sum, customer) => sum + (customer.lifetime?.spend || 0), 0),
      transactions: customers.reduce((sum, customer) => sum + (customer.lifetime?.transactions || 0), 0),
      weekday: customers.filter(customer => customer.lifetime?.weekdayOrders).length,
      weekend: customers.filter(customer => customer.lifetime?.weekendOrders).length,
      latestVisit: lastVisits.length ? new Date(Math.max(...lastVisits.map(date => date.valueOf()))) : null,
    };
  }, [customers]);

  const audience = useMemo(() => customers.filter(customer => {
    if (segment === 'points' && !(customer.loyalty?.importedOpeningBalance > 0)) return false;
    if (segment === 'vip' && !(customer.lifetime?.spend >= 2000)) return false;
    if (segment === 'at-risk' && !isAtRisk(customer)) return false;
    if (segment === 'new' && customer.lifetime?.transactions > 0) return false;
    const haystack = `${customer.firstName} ${customer.lastName || ''} ${customer.externalUserId} ${customer.phoneE164?.slice(-4) || ''}`.toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }).sort((a, b) => (b.loyalty?.importedOpeningBalance || 0) - (a.loyalty?.importedOpeningBalance || 0)), [customers, segment, search]);

  const pageSize = 25;
  const maxPage = Math.max(0, Math.ceil(audience.length / pageSize) - 1);
  const visibleCustomers = audience.slice(page * pageSize, page * pageSize + pageSize);

  useEffect(() => setPage(0), [segment, search]);

  const saveDraft = async () => {
    if (!campaignName.trim() || !campaignMessage.trim() || !audience.length) return;
    setSavingDraft(true);
    setDraftNotice('');
    try {
      await addDoc(collection(db, 'loyalty_campaign_drafts'), {
        userId: dataOwnerId,
        ownerId: dataOwnerId,
        createdBy: user.uid,
        createdAt: Date.now(),
        status: 'draft',
        channel,
        segment,
        audienceCount: audience.length,
        name: campaignName.trim(),
        message: campaignMessage.trim(),
        consentGate: 'required_before_delivery',
      });
      setDraftNotice('Draft saved. It has not been sent to any customer.');
      setCampaignName('');
    } catch (err) {
      console.error(err);
      setDraftNotice('Unable to save the draft. Please retry.');
    } finally {
      setSavingDraft(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-5"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-100"><Sparkles size={27} /></div><div><h2 className="text-3xl font-black tracking-tight text-slate-900">Customer Intelligence</h2><p className="text-sm font-medium uppercase tracking-widest text-slate-400">Loyalty behaviour · points · consent-safe campaigns</p></div></div>
        <button type="button" onClick={() => void loadCustomers()} className="rounded-xl border border-slate-200 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50">Refresh data</button>
      </header>

      {error && <div className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700"><AlertCircle size={18} className="shrink-0" />{error}</div>}
      {loading ? <div className="flex min-h-80 items-center justify-center"><Loader2 className="animate-spin text-indigo-600" size={34} /></div> : customers.length === 0 ? <EmptyState /> : <>
        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4"><Metric icon={<Users size={18} />} label="Customers" value={number.format(customers.length)} sub={`${number.format(analytics.active)} have ordered`} /><Metric icon={<WalletCards size={18} />} label="Points outstanding" value={number.format(analytics.points)} sub={`${number.format(analytics.pointsHolders)} point holders`} /><Metric icon={<CalendarClock size={18} />} label="At risk" value={number.format(analytics.atRisk)} sub="No order in 60+ days" alert={analytics.atRisk > 0} /><Metric icon={<HeartHandshake size={18} />} label="Lifetime spend" value={money.format(analytics.spend)} sub={`${number.format(analytics.transactions)} transactions`} /></section>

        <section className="grid gap-6 xl:grid-cols-3"><div className="rounded-[2rem] border border-slate-100 bg-white p-7 shadow-sm xl:col-span-2"><h3 className="text-lg font-black text-slate-900">Behaviour snapshot</h3><div className="mt-6 grid gap-4 sm:grid-cols-3"><Insight label="Weekday customers" value={number.format(analytics.weekday)} text="Have at least one weekday order" /><Insight label="Weekend customers" value={number.format(analytics.weekend)} text="Have at least one weekend order" /><Insight label="Most recent source order" value={analytics.latestVisit ? analytics.latestVisit.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'} text="Based on imported history" /></div></div><div className="rounded-[2rem] bg-slate-900 p-7 text-white"><div className="flex items-center gap-2 text-emerald-300"><ShieldCheck size={18} /><p className="text-[10px] font-black uppercase tracking-widest">Delivery guardrail</p></div><p className="mt-4 text-lg font-black">No campaign can be sent from this page.</p><p className="mt-2 text-sm leading-6 text-slate-400">This workspace produces a draft only. A future delivery connection must verify WhatsApp or SMS opt-in before any customer is eligible.</p></div></section>

        <section className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm md:p-8"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><h3 className="text-xl font-black text-slate-900">Points & customer list</h3><p className="mt-1 text-sm text-slate-500">Customers are ranked by imported opening points. Phone numbers remain masked.</p></div><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, ID, or last 4 digits" className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium outline-none focus:border-indigo-500" /></div>
          <div className="mt-6 flex flex-wrap gap-2">{([{ id: 'all', label: 'All customers' }, { id: 'points', label: 'Points holders' }, { id: 'vip', label: 'VIP ₹2,000+' }, { id: 'at-risk', label: 'At risk 60d+' }, { id: 'new', label: 'No purchase yet' }] as { id: Segment; label: string }[]).map(item => <button key={item.id} type="button" onClick={() => setSegment(item.id)} className={`rounded-full px-4 py-2 text-xs font-black ${segment === item.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{item.label}</button>)}</div>
          <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400"><tr><th className="pb-3">Customer</th><th className="pb-3">Points</th><th className="pb-3">Lifetime spend</th><th className="pb-3">Orders</th><th className="pb-3">Last visit</th><th className="pb-3">Signals</th></tr></thead><tbody>{visibleCustomers.map(customer => <tr key={customer.id} className="border-b border-slate-50 text-sm text-slate-600"><td className="py-4"><p className="font-black text-slate-800">{customer.firstName} {customer.lastName || ''}</p><p className="mt-0.5 text-xs text-slate-400">•••• {customer.phoneE164?.slice(-4) || '—'} · ID {customer.externalUserId}</p></td><td className="py-4 font-black text-indigo-700">{number.format(customer.loyalty?.importedOpeningBalance || 0)}</td><td className="py-4 font-bold">{money.format(customer.lifetime?.spend || 0)}</td><td className="py-4">{number.format(customer.lifetime?.transactions || 0)}</td><td className="py-4">{formatVisit(customer.lifetime?.lastTransactionAt)}</td><td className="py-4"><div className="flex flex-wrap gap-1">{customer.lifetime?.weekdayOrders && <Tag label="Weekday" />}{customer.lifetime?.weekendOrders && <Tag label="Weekend" />}{isAtRisk(customer) && <Tag label="At risk" alert />}</div></td></tr>)}</tbody></table></div>
          {audience.length === 0 ? <p className="py-10 text-center text-sm font-bold text-slate-400">No customers match this audience.</p> : <div className="mt-5 flex items-center justify-between text-xs font-bold text-slate-500"><span>{number.format(audience.length)} customers</span><div className="flex gap-2"><button type="button" disabled={page === 0} onClick={() => setPage(value => Math.max(0, value - 1))} className="rounded-lg border border-slate-200 p-2 disabled:opacity-30"><ChevronLeft size={15} /></button><span className="px-2 py-2">{page + 1} / {maxPage + 1}</span><button type="button" disabled={page === maxPage} onClick={() => setPage(value => Math.min(maxPage, value + 1))} className="rounded-lg border border-slate-200 p-2 disabled:opacity-30"><ChevronRight size={15} /></button></div></div>}</section>

        <section className="rounded-[2rem] border border-indigo-100 bg-indigo-50/40 p-6 md:p-8"><div className="flex items-center gap-3"><div className="rounded-xl bg-white p-3 text-indigo-600 shadow-sm"><MessageCircle size={21} /></div><div><h3 className="text-xl font-black text-slate-900">Campaign studio</h3><p className="text-sm text-slate-500">Build an internal draft for the current customer segment. It does not send a message.</p></div></div><div className="mt-6 grid gap-4 md:grid-cols-2"><label className="text-xs font-black uppercase tracking-widest text-slate-500">Channel<select value={channel} onChange={event => setChannel(event.target.value as Channel)} className="mt-2 block h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700"><option value="whatsapp">WhatsApp — primary when opted in</option><option value="sms">SMS — DLT template and consent required</option></select></label><label className="text-xs font-black uppercase tracking-widest text-slate-500">Campaign name<input value={campaignName} onChange={event => setCampaignName(event.target.value)} placeholder="e.g. October points reminder" className="mt-2 block h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold normal-case tracking-normal outline-none focus:border-indigo-500" /></label><label className="md:col-span-2 text-xs font-black uppercase tracking-widest text-slate-500">Draft message<textarea value={campaignMessage} onChange={event => setCampaignMessage(event.target.value)} rows={4} className="mt-2 block w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-medium normal-case tracking-normal outline-none focus:border-indigo-500" /></label></div><div className="mt-5 flex flex-col gap-3 rounded-2xl bg-white p-4 text-sm text-slate-600 md:flex-row md:items-center md:justify-between"><span><b>{number.format(audience.length)}</b> customers in the currently selected audience. Delivery eligibility is still <b>zero</b> until channel-specific consent is recorded.</span><button type="button" disabled={savingDraft || !campaignName.trim() || !campaignMessage.trim() || !audience.length} onClick={() => void saveDraft()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-indigo-100 disabled:opacity-50">{savingDraft ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{savingDraft ? 'Saving…' : 'Save draft only'}</button></div>{draftNotice && <p className={`mt-4 text-sm font-bold ${draftNotice.startsWith('Draft') ? 'text-emerald-700' : 'text-rose-700'}`}>{draftNotice}</p>}</section>
      </>}
    </div>
  );
};

const Metric: React.FC<{ icon: React.ReactNode; label: string; value: string; sub: string; alert?: boolean }> = ({ icon, label, value, sub, alert }) => <div className={`rounded-3xl border p-5 shadow-sm ${alert ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'}`}><div className="flex items-center gap-2 text-indigo-500">{icon}<span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span></div><p className="mt-4 text-2xl font-black text-slate-900">{value}</p><p className="mt-1 text-xs font-medium text-slate-400">{sub}</p></div>;
const Insight: React.FC<{ label: string; value: string; text: string }> = ({ label, value, text }) => <div className="rounded-2xl bg-slate-50 p-5"><p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p><p className="mt-3 text-xl font-black text-slate-900">{value}</p><p className="mt-1 text-xs text-slate-400">{text}</p></div>;
const Tag: React.FC<{ label: string; alert?: boolean }> = ({ label, alert }) => <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${alert ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{label}</span>;
const formatVisit = (raw?: string) => { const date = dateOf(raw); return date ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No purchase'; };
const EmptyState = () => <div className="rounded-[2rem] border-2 border-dashed border-slate-200 bg-white px-6 py-24 text-center"><Users className="mx-auto text-slate-300" size={42} /><h3 className="mt-4 text-xl font-black text-slate-900">No loyalty customers yet</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Import the LimeTray customer CSV in Loyalty & Customers first. Customer behaviour and points analysis will appear here automatically after the import finishes.</p></div>;

export default CustomerIntelligence;
