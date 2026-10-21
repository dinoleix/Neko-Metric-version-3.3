import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  addDoc,
  collection,
  getDoc,
  getDocs,
  query,
  where,
} from '../tenantFirestore';
import { Check, LoaderCircle, Save, ShieldCheck } from 'lucide-react';
import { db } from '../firebase';
import type { TenantSession } from '../multitenantRuntime';

type ProbeRecord = {
  id: string;
  tenantId: string;
  outletId: string;
  note: string;
  createdBy: string;
  createdAt: number;
};

type Props = { user: User; session: TenantSession };

const TenantDataProbe: React.FC<Props> = ({ user, session }) => {
  const accessibleOutlets = session.outlets.filter(outlet =>
    session.membership.role === 'owner'
    || session.membership.outletIds.includes('*')
    || session.membership.outletIds.includes(outlet.id)
  );
  const [outletId, setOutletId] = useState(accessibleOutlets[0]?.id ?? '');
  const [note, setNote] = useState('Synthetic isolation probe');
  const [records, setRecords] = useState<ProbeRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    if (!outletId && accessibleOutlets[0]) setOutletId(accessibleOutlets[0].id);
  }, [outletId, accessibleOutlets]);

  useEffect(() => {
    if (!outletId) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setConfirmation(null);
    getDocs(query(
      collection(db, 'tenant_test_records'),
      where('tenantId', '==', session.tenant.id),
      where('outletId', '==', outletId),
    )).then(snapshot => {
      if (cancelled) return;
      const next = snapshot.docs.map(item => ({ id: item.id, ...item.data() } as ProbeRecord));
      next.sort((a, b) => b.createdAt - a.createdAt);
      setRecords(next);
    }).catch(err => {
      console.error('[tenant] could not load isolation probes:', err);
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read tenant-scoped records.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [outletId, session.tenant.id]);

  const saveProbe = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!outletId || !note.trim()) return;
    setSaving(true);
    setError(null);
    setConfirmation(null);
    try {
      const record = {
        tenantId: session.tenant.id,
        outletId,
        note: note.trim(),
        createdBy: user.uid,
        createdAt: Date.now(),
      };
      const reference = await addDoc(collection(db, 'tenant_test_records'), record);
      const saved = await getDoc(reference);
      if (!saved.exists()) throw new Error('The write completed, but its scoped read-back was denied.');
      const savedRecord = { id: saved.id, ...saved.data() } as ProbeRecord;
      setRecords(previous => [savedRecord, ...previous.filter(item => item.id !== saved.id)]);
      setNote('');
      setConfirmation('Saved and read back under this tenant and outlet.');
    } catch (err) {
      console.error('[tenant] isolation probe failed:', err);
      setError(err instanceof Error ? err.message : 'Could not write and read back a tenant-scoped record.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mt-8 rounded-3xl border border-indigo-300/15 bg-indigo-300/[0.04] p-6 sm:p-7">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-300/10 p-2 text-indigo-200"><ShieldCheck size={18} /></div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-200">Dev-only data probe</p>
          <h2 className="mt-1 text-lg font-black">Tenant-scoped read and write</h2>
          <p className="mt-1 text-sm text-slate-400">Synthetic notes are saved with this tenant and outlet ID, then read back through the same membership rules.</p>
        </div>
      </div>

      {accessibleOutlets.length === 0 ? (
        <p className="mt-5 rounded-xl border border-white/10 p-4 text-sm text-slate-400">No outlet is assigned to this membership, so the probe is unavailable.</p>
      ) : (
        <>
          <form onSubmit={saveProbe} className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
            {accessibleOutlets.length > 1 && (
              <label className="sr-only" htmlFor="tenant-probe-outlet">Outlet</label>
            )}
            {accessibleOutlets.length > 1 ? (
              <select id="tenant-probe-outlet" value={outletId} onChange={event => setOutletId(event.target.value)} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white">
                {accessibleOutlets.map(outlet => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}
              </select>
            ) : <div className="flex items-center rounded-xl border border-white/10 bg-slate-900/60 px-3 py-3 text-sm text-slate-300">{accessibleOutlets[0].name}</div>}
            <label className="sr-only" htmlFor="tenant-probe-note">Synthetic note</label>
            <input id="tenant-probe-note" value={note} onChange={event => setNote(event.target.value)} maxLength={160} required placeholder="Type a synthetic note" className="min-w-0 rounded-xl border border-white/10 bg-slate-900 px-3 py-3 text-sm text-white placeholder:text-slate-600" />
            <button type="submit" disabled={saving || !note.trim()} className="flex items-center justify-center gap-2 rounded-xl bg-indigo-400 px-4 py-3 text-sm font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
              {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
              Save probe
            </button>
          </form>

          {confirmation && <p role="status" className="mt-4 flex items-center gap-2 text-sm font-semibold text-emerald-300"><Check size={16} />{confirmation}</p>}
          {error && <p role="alert" className="mt-4 break-words text-sm font-semibold text-rose-300">{error}</p>}

          <div className="mt-5 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">Records visible to this tenant</p>
              {loading && <LoaderCircle size={15} className="animate-spin text-slate-500" />}
            </div>
            {!loading && records.length === 0 ? <p className="mt-3 text-sm text-slate-500">No probe records for this outlet yet.</p> : (
              <ul className="mt-2 divide-y divide-white/10">
                {records.map(record => <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><span className="font-semibold text-slate-200">{record.note}</span><time className="text-xs text-slate-500">{new Date(record.createdAt).toLocaleString()}</time></li>)}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default TenantDataProbe;
