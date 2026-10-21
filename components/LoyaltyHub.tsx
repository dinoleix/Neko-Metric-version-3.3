import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from '../tenantFirestore';
import { db } from '../firebase';
import { parseCsvRecords } from '../csvParse';
import type { LoyaltyImportSummary } from '../types';
import * as XLSX from 'xlsx';
import {
  AlertTriangle, CheckCircle2, ChevronRight, FileSpreadsheet, HeartHandshake,
  Loader2, LockKeyhole, ShieldCheck, Upload, Users, WalletCards,
} from 'lucide-react';

const REQUIRED_COLUMNS = [
  'User ID', 'First Name', 'Phone Number', 'Country Code', 'Total Transactions',
  'Total Transactions Amount', 'Available Loyalty Points', 'Dnd Status',
  'Subscription Status', 'Phone Number Status', 'User Status',
] as const;

type ParsedCustomer = {
  externalUserId: string;
  firstName: string;
  lastName: string;
  phoneE164: string;
  countryCode: string;
  email: string;
  transactions: number;
  spend: number;
  points: number;
  lastTransactionAt: string;
  lastLocationId: string;
  weekdayOrders: boolean;
  weekendOrders: boolean;
  sourceStatus: Record<string, string>;
};

type ImportPlan = {
  newIds: Set<string>;
  changedIds: Set<string>;
  pointsChangedIds: Set<string>;
  unchanged: number;
};

const numberValue = (value: string) => {
  const parsed = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
};

const phoneE164 = (countryCode: string, phone: string) => {
  const digits = phone.replace(/\D/g, '');
  const country = countryCode.replace(/\D/g, '');
  return country && digits ? `+${country}${digits}` : '';
};

const countNumber = new Intl.NumberFormat('en-IN');

const customerFields = (customer: ParsedCustomer) => ({
  externalUserId: customer.externalUserId,
  source: 'limetray',
  firstName: customer.firstName,
  lastName: customer.lastName || null,
  phoneE164: customer.phoneE164,
  countryCode: customer.countryCode,
  email: customer.email || null,
  lifetime: {
    transactions: customer.transactions,
    spend: customer.spend,
    lastTransactionAt: customer.lastTransactionAt || null,
    lastLocationId: customer.lastLocationId || null,
    weekdayOrders: customer.weekdayOrders,
    weekendOrders: customer.weekendOrders,
  },
  loyalty: { importedOpeningBalance: customer.points },
  sourceStatus: customer.sourceStatus,
});

const comparableCustomer = (customer: ParsedCustomer | Record<string, any>) => {
  const fields = 'points' in customer ? customerFields(customer as ParsedCustomer) : {
    externalUserId: customer.externalUserId || '', source: customer.source || 'limetray',
    firstName: customer.firstName || '', lastName: customer.lastName || null,
    phoneE164: customer.phoneE164 || '', countryCode: customer.countryCode || '', email: customer.email || null,
    lifetime: {
      transactions: customer.lifetime?.transactions || 0, spend: customer.lifetime?.spend || 0,
      lastTransactionAt: customer.lifetime?.lastTransactionAt || null, lastLocationId: customer.lifetime?.lastLocationId || null,
      weekdayOrders: Boolean(customer.lifetime?.weekdayOrders), weekendOrders: Boolean(customer.lifetime?.weekendOrders),
    },
    loyalty: { importedOpeningBalance: customer.loyalty?.importedOpeningBalance || 0 },
    sourceStatus: customer.sourceStatus || {},
  };
  return JSON.stringify(fields);
};

const spreadsheetRecords = async (file: File): Promise<string[][]> => {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return [];
    return XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[firstSheet], { header: 1, defval: '', raw: false })
      .map(row => row.map(value => String(value ?? '').trim()));
  }
  return parseCsvRecords(await file.text());
};

const LoyaltyHub: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [summary, setSummary] = useState<LoyaltyImportSummary | null>(null);
  const [customers, setCustomers] = useState<ParsedCustomer[]>([]);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');

  const importId = `limetray_${dataOwnerId}`;

  const loadSummary = async () => {
    setLoading(true);
    try {
      const snapshot = await getDoc(doc(db, 'loyalty_imports', importId));
      setSummary(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as LoyaltyImportSummary) : null);
    } catch (err) {
      console.error(err);
      setError('Unable to read the existing loyalty import status. Please retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSummary(); }, [dataOwnerId]);

  const preview = useMemo(() => ({
    customers: customers.length,
    points: customers.reduce((sum, customer) => sum + customer.points, 0),
    spend: customers.reduce((sum, customer) => sum + customer.spend, 0),
    active: customers.filter(customer => customer.transactions > 0).length,
    invalid: customers.filter(customer => !customer.phoneE164 || !customer.externalUserId).length,
  }), [customers]);

  const plannedWrites = (importPlan?.newIds.size || 0) + (importPlan?.changedIds.size || 0);

  const readFile = async (file: File) => {
    setError('');
    setConfirmed(false);
    setPreparing(true);
    try {
      const records = await spreadsheetRecords(file);
      if (records.length < 2) { setError('This file has no customer rows.'); return; }
      const headers = records[0].map(header => header.replace(/^\uFEFF/, '').trim());
      const missing = REQUIRED_COLUMNS.filter(column => !headers.includes(column));
      if (missing.length) {
        setError(`This is not the expected customer export. Missing: ${missing.join(', ')}.`);
        return;
      }
      const rows = records.slice(1).filter(row => row.some(cell => cell.trim() !== ''));
      const headerIndex = (name: string) => headers.indexOf(name);
      const value = (row: string[], name: string) => (row[headerIndex(name)] ?? '').trim();
      const seen = new Set<string>();
      const parsed: ParsedCustomer[] = [];
      for (const row of rows) {
        const externalUserId = value(row, 'User ID');
        if (!externalUserId || seen.has(externalUserId)) continue;
        seen.add(externalUserId);
        const countryCode = value(row, 'Country Code');
        parsed.push({
          externalUserId,
          firstName: value(row, 'First Name'),
          lastName: value(row, 'Last Name'),
          phoneE164: phoneE164(countryCode, value(row, 'Phone Number')),
          countryCode,
          email: value(row, 'Email').toLowerCase(),
          transactions: numberValue(value(row, 'Total Transactions')),
          spend: numberValue(value(row, 'Total Transactions Amount')),
          points: numberValue(value(row, 'Available Loyalty Points')),
          lastTransactionAt: value(row, 'Last Transaction Added'),
          lastLocationId: value(row, 'Last Transaction Location ID'),
          weekdayOrders: value(row, 'Have Weekday Orders') === '1',
          weekendOrders: value(row, 'Have Weekend Orders') === '1',
          sourceStatus: {
            dndStatusCode: value(row, 'Dnd Status'),
            subscriptionStatusCode: value(row, 'Subscription Status'),
            phoneStatusCode: value(row, 'Phone Number Status'),
            emailStatusCode: value(row, 'Email Status'),
            userStatusCode: value(row, 'User Status'),
          },
        });
      }
      const existing = await getDocs(query(collection(db, 'loyalty_customers'), where('ownerId', '==', dataOwnerId)));
      const existingByUserId = new Map(existing.docs.map(snapshot => [snapshot.data().externalUserId, snapshot.data()]));
      const plan: ImportPlan = { newIds: new Set(), changedIds: new Set(), pointsChangedIds: new Set(), unchanged: 0 };
      parsed.forEach(customer => {
        const prior = existingByUserId.get(customer.externalUserId);
        if (!prior) { plan.newIds.add(customer.externalUserId); plan.pointsChangedIds.add(customer.externalUserId); return; }
        if (comparableCustomer(customer) === comparableCustomer(prior)) { plan.unchanged += 1; return; }
        plan.changedIds.add(customer.externalUserId);
        if ((prior.loyalty?.importedOpeningBalance || 0) !== customer.points) plan.pointsChangedIds.add(customer.externalUserId);
      });
      setCustomers(parsed);
      setImportPlan(plan);
      setFileName(file.name);
    } catch (err) {
      console.error(err);
      setError('The file could not be checked against existing customer data. Please retry before importing.');
    } finally {
      setPreparing(false);
    }
  };

  const importCustomers = async () => {
    if (!confirmed || !customers.length || preview.invalid > 0 || !importPlan || plannedWrites === 0) return;
    setImporting(true);
    setError('');
    const baseSummary = {
      userId: dataOwnerId,
      ownerId: dataOwnerId,
      source: 'limetray' as const,
      importedCustomers: customers.length,
      createdCustomers: importPlan.newIds.size,
      updatedCustomers: importPlan.changedIds.size,
      unchangedCustomers: importPlan.unchanged,
      pointsUpdatedCustomers: importPlan.pointsChangedIds.size,
      totalOpeningPoints: preview.points,
      importedAt: Date.now(),
      importedBy: user.uid,
      sourceFileName: fileName,
      rejectedRows: preview.invalid,
    };
    try {
      await setDoc(doc(db, 'loyalty_imports', importId), { ...baseSummary, status: 'processing' }, { merge: true });
      // Two deterministic documents per customer keep the process restart-safe:
      // a retry updates the same profile and opening-balance record instead of
      // creating duplicate people or duplicating their starting points.
      const customersToWrite = customers.filter(customer => importPlan.newIds.has(customer.externalUserId) || importPlan.changedIds.has(customer.externalUserId));
      for (let start = 0; start < customersToWrite.length; start += 200) {
        const batch = writeBatch(db);
        customersToWrite.slice(start, start + 200).forEach(customer => {
          const customerId = `limetray_${customer.externalUserId}`;
          batch.set(doc(db, 'loyalty_customers', customerId), {
            userId: dataOwnerId,
            ownerId: dataOwnerId,
            ...customerFields(customer),
            updatedAt: Date.now(),
            ...(importPlan.newIds.has(customer.externalUserId) ? { createdAt: Date.now() } : {}),
          }, { merge: true });
          if (importPlan.pointsChangedIds.has(customer.externalUserId)) {
            batch.set(doc(db, 'loyalty_opening_balances', `limetray_opening_${customer.externalUserId}`), {
              userId: dataOwnerId, ownerId: dataOwnerId, customerId, source: 'limetray',
              type: 'opening_balance', points: customer.points, importedAt: Date.now(), importedBy: user.uid,
            }, { merge: true });
          }
        });
        await batch.commit();
      }
      const completed: LoyaltyImportSummary = { ...baseSummary, status: 'completed' };
      await setDoc(doc(db, 'loyalty_imports', importId), completed, { merge: true });
      setSummary(completed);
      setCustomers([]);
      setImportPlan(null);
      setFileName('');
      setConfirmed(false);
    } catch (err) {
      console.error(err);
      await setDoc(doc(db, 'loyalty_imports', importId), { ...baseSummary, status: 'failed', error: 'Import stopped before all batches completed.' }, { merge: true }).catch(() => undefined);
      setError('The import stopped. No duplicate customers or points are created by a safe retry, but please retry only after checking your connection.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-5">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-600 text-white shadow-xl shadow-rose-100"><HeartHandshake size={28} /></div>
          <div><h2 className="text-3xl font-black tracking-tight text-slate-900">Loyalty & Customers</h2><p className="text-sm font-medium uppercase tracking-widest text-slate-400">Private customer profiles · consent-safe marketing</p></div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-700"><ShieldCheck size={16} /> Marketing consent is separate</div>
      </header>

      {error && <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm font-bold text-rose-700"><AlertTriangle size={18} className="mt-0.5 shrink-0" />{error}</div>}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Metric label="Imported customers" value={loading ? '…' : countNumber.format(summary?.importedCustomers ?? 0)} icon={<Users size={19} />} />
        <Metric label="Opening loyalty points" value={loading ? '…' : countNumber.format(summary?.totalOpeningPoints ?? 0)} icon={<WalletCards size={19} />} />
        <Metric label="Import status" value={loading ? '…' : summary?.status === 'completed' ? 'Ready' : summary?.status === 'processing' ? 'In progress' : 'Not imported'} icon={<CheckCircle2 size={19} />} />
      </section>

      <section className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-sm md:p-9">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="text-xl font-black text-slate-900">Import LimeTray customer export</h3><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Profiles, purchase history, and current points are imported. The source’s numeric DND and subscription codes are retained as evidence, but never converted into SMS or WhatsApp permission.</p></div><LockKeyhole className="shrink-0 text-slate-300" size={25} /></div>
        <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ''; }} />
        {!customers.length ? <button type="button" disabled={preparing} onClick={() => inputRef.current?.click()} className="mt-7 flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 px-6 py-12 text-indigo-700 transition-colors hover:bg-indigo-50 disabled:opacity-60">{preparing ? <Loader2 className="animate-spin" size={32} /> : <FileSpreadsheet size={32} />}<span className="mt-3 text-sm font-black">Choose LimeTray customer CSV or Excel</span><span className="mt-1 text-xs font-medium text-indigo-400">The sheet is compared before anything is imported</span></button> : <>
          <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"><Preview label="Profiles" value={countNumber.format(preview.customers)} /><Preview label="New" value={countNumber.format(importPlan?.newIds.size || 0)} /><Preview label="Updated" value={countNumber.format(importPlan?.changedIds.size || 0)} /><Preview label="Unchanged" value={countNumber.format(importPlan?.unchanged || 0)} /><Preview label="Points changed" value={countNumber.format(importPlan?.pointsChangedIds.size || 0)} /><Preview label="Invalid rows" value={countNumber.format(preview.invalid)} alert={preview.invalid > 0} /></div>
          <div className={`mt-6 rounded-2xl p-5 text-sm ${plannedWrites === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}><p className="font-black">{plannedWrites === 0 ? 'Already up to date' : 'Before importing'}</p><p className="mt-1 leading-6">{plannedWrites === 0 ? `${fileName} matches the saved LimeTray customer records. Nothing will be written.` : `${fileName} will write ${countNumber.format(plannedWrites)} changed customer profile${plannedWrites === 1 ? '' : 's'}; ${countNumber.format(importPlan?.unchanged || 0)} unchanged profile${(importPlan?.unchanged || 0) === 1 ? '' : 's'} will not be touched. It will not send messages or mark anyone subscribed.`}</p></div>
          <label className="mt-6 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-4 text-sm text-slate-600"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-indigo-600" /><span>I am authorised to import this customer data and understand that SMS and WhatsApp consent still need to be captured separately.</span></label>
          <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={() => { setCustomers([]); setImportPlan(null); setFileName(''); setConfirmed(false); }} className="rounded-xl bg-slate-100 px-5 py-3 text-xs font-black uppercase tracking-widest text-slate-500">Choose another file</button><button type="button" disabled={!confirmed || importing || preview.invalid > 0 || plannedWrites === 0} onClick={() => void importCustomers()} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-indigo-100 disabled:cursor-not-allowed disabled:opacity-50">{importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}{importing ? 'Applying updates…' : `Apply ${countNumber.format(plannedWrites)} update${plannedWrites === 1 ? '' : 's'}`}<ChevronRight size={15} /></button></div>
        </>}
      </section>

      <section className="rounded-[2rem] border border-slate-100 bg-slate-900 p-6 text-slate-100 shadow-sm md:p-9"><h3 className="text-lg font-black">What this module protects</h3><div className="mt-5 grid gap-4 md:grid-cols-3"><Protection title="No accidental messages" text="Imports never trigger SMS, WhatsApp, or email." /><Protection title="Channel-specific consent" text="WhatsApp and SMS opt-ins will be collected and stored separately." /><Protection title="Retry-safe points" text="Opening balances use deterministic records, so a retry cannot double-credit points." /></div></section>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; icon: React.ReactNode }> = ({ label, value, icon }) => <div className="rounded-3xl border border-slate-100 bg-white p-5 shadow-sm"><div className="flex items-center gap-2 text-indigo-500">{icon}<p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</p></div><p className="mt-4 text-2xl font-black text-slate-900">{value}</p></div>;
const Preview: React.FC<{ label: string; value: string; alert?: boolean }> = ({ label, value, alert }) => <div className={`rounded-2xl p-4 ${alert ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-700'}`}><p className="text-[9px] font-black uppercase tracking-widest opacity-60">{label}</p><p className="mt-2 text-lg font-black">{value}</p></div>;
const Protection: React.FC<{ title: string; text: string }> = ({ title, text }) => <div className="rounded-2xl bg-slate-800 p-5"><p className="font-black">{title}</p><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></div>;

export default LoyaltyHub;
