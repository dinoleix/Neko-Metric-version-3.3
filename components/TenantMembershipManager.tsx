import React, { useCallback, useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, deleteUser, getAuth, signOut } from 'firebase/auth';
import { deleteApp, initializeApp } from 'firebase/app';
import { collection, deleteDoc, doc, getDocs, query, setDoc, updateDoc, where } from '../tenantFirestore';
import { db, firebaseConfig } from '../firebase';
import type { User as FirebaseUser } from 'firebase/auth';
import type { TenantMembership, TenantOutlet, TenantRole } from '../tenantTypes';
import { tenantMembershipId } from '../tenantTypes';
import { Loader2, UserPlus, ShieldCheck, Trash2 } from 'lucide-react';

type MembershipRow = TenantMembership & { id: string; email?: string };

const TenantMembershipManager: React.FC<{ user: FirebaseUser; tenantId: string }> = ({ user, tenantId }) => {
  const [members, setMembers] = useState<MembershipRow[]>([]);
  const [outlets, setOutlets] = useState<TenantOutlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [accountMode, setAccountMode] = useState<'new' | 'existing'>('new');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [existingUserId, setExistingUserId] = useState('');
  const [role, setRole] = useState<Exclude<TenantRole, 'owner'>>('manager');
  const [outletIds, setOutletIds] = useState<string[]>(['*']);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [memberSnapshot, outletSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'tenant_memberships'), where('tenantId', '==', tenantId))),
        getDocs(query(collection(db, 'outlets'), where('tenantId', '==', tenantId))),
      ]);
      setMembers(memberSnapshot.docs.map(snapshot => ({
        ...snapshot.data(), id: snapshot.id,
      } as MembershipRow)));
      setOutlets(outletSnapshot.docs.map(snapshot => ({
        ...snapshot.data(), id: snapshot.id,
      } as TenantOutlet)).filter(outlet => outlet.status === 'active'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load tenant memberships.');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const updateMember = async (member: MembershipRow, nextRole: TenantRole, nextOutlets: string[]) => {
    if (member.userId === user.uid || member.role === 'owner') return;
    try {
      await updateDoc(doc(db, 'tenant_memberships', member.id), {
        role: nextRole,
        outletIds: nextOutlets,
        updatedAt: Date.now(),
      });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this member.');
    }
  };

  const suspendMember = async (member: MembershipRow) => {
    if (member.userId === user.uid || member.role === 'owner') return;
    if (!window.confirm(`Suspend access for ${member.email || member.userId}?`)) return;
    try {
      await updateDoc(doc(db, 'tenant_memberships', member.id), { status: 'suspended', updatedAt: Date.now() });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not suspend this member.');
    }
  };

  const reactivateMember = async (member: MembershipRow) => {
    if (member.userId === user.uid || member.role === 'owner') return;
    try {
      await updateDoc(doc(db, 'tenant_memberships', member.id), { status: 'active', updatedAt: Date.now() });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reactivate this member.');
    }
  };

  const removeMember = async (member: MembershipRow) => {
    if (member.userId === user.uid || member.role === 'owner') return;
    if (!window.confirm(`Remove tenant access for ${member.email || member.userId}? Their Firebase login will remain.`)) return;
    try {
      await deleteDoc(doc(db, 'tenant_memberships', member.id));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove this member.');
    }
  };

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUserId = existingUserId.trim();
    if (!normalizedEmail || accountMode === 'new' && password.length < 8) {
      setError(accountMode === 'new'
        ? 'Enter an email and a password with at least 8 characters.'
        : 'Enter the existing account email.');
      return;
    }
    if (accountMode === 'existing' && !normalizedUserId) {
      setError('Enter the existing Firebase account ID.');
      return;
    }
    if (role !== 'manager' && outletIds.includes('*')) {
      setError('Crew and viewer accounts must have one or more assigned outlets.');
      return;
    }
    if (role === 'manager' && outletIds.length === 0) {
      setError('Choose one or more outlets, or select all outlets for an HQ manager.');
      return;
    }

    setSaving(true);
    let secondaryApp: ReturnType<typeof initializeApp> | null = null;
    let createdUser: FirebaseUser | null = null;
    try {
      const existing = await getDocs(query(
        collection(db, 'tenant_memberships'),
        where('tenantId', '==', tenantId),
      ));
      if (existing.docs.some(snapshot => snapshot.data().email?.toLowerCase() === normalizedEmail
        || accountMode === 'existing' && snapshot.data().userId === normalizedUserId)) {
        throw new Error('That email already has access to this restaurant.');
      }

      let memberUserId = normalizedUserId;
      if (accountMode === 'new') {
        secondaryApp = initializeApp(firebaseConfig, `tenant-member-${Date.now()}`);
        const secondaryAuth = getAuth(secondaryApp);
        const credential = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, password);
        createdUser = credential.user;
        memberUserId = credential.user.uid;
      }
      const now = Date.now();
      const membership: Omit<TenantMembership, 'id'> & { email: string } = {
        tenantId,
        userId: memberUserId,
        email: normalizedEmail,
        role,
        outletIds,
        status: 'active',
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
      };
      await setDoc(doc(db, 'tenant_memberships', tenantMembershipId(tenantId, memberUserId)), membership);
      createdUser = null;
      setShowForm(false);
      setEmail('');
      setPassword('');
      setExistingUserId('');
      await refresh();
    } catch (cause: any) {
      if (createdUser) {
        try { await deleteUser(createdUser); } catch { /* Surface the original provisioning error. */ }
      }
      setError(cause?.code === 'auth/email-already-in-use'
        ? 'That email already has a Firebase account. Ask that person to sign in first, then add their existing user ID through the migration administrator.'
        : cause instanceof Error ? cause.message : 'Could not create the member account.');
    } finally {
      if (secondaryApp) {
        try { await signOut(getAuth(secondaryApp)); } catch { /* The temporary auth state is discarded with the app. */ }
        await deleteApp(secondaryApp);
      }
      setSaving(false);
    }
  };

  return (
    <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Restaurant members</h2>
          <p className="mt-1 text-sm text-slate-500">Assign each account a role and the outlets it may use.</p>
        </div>
        <button type="button" onClick={() => { setShowForm(value => !value); setError(null); }} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-500">
          <UserPlus size={16} /> Add member
        </button>
      </header>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}

      {showForm && <form onSubmit={addMember} className="grid gap-3 rounded-2xl bg-slate-50 p-4 md:grid-cols-2">
        <div role="group" aria-label="Account type" className="flex gap-2 md:col-span-2">
          <button type="button" aria-pressed={accountMode === 'new'} onClick={() => { setAccountMode('new'); setError(null); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${accountMode === 'new' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>Create new login</button>
          <button type="button" aria-pressed={accountMode === 'existing'} onClick={() => { setAccountMode('existing'); setError(null); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${accountMode === 'existing' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600'}`}>Add existing account</button>
        </div>
        <label className="text-xs font-bold text-slate-600">Email
          <input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm" />
        </label>
        {accountMode === 'new' ? <label className="text-xs font-bold text-slate-600">Temporary password
          <input required type="password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm" />
        </label> : <label className="text-xs font-bold text-slate-600">Existing account ID
          <input required value={existingUserId} onChange={event => setExistingUserId(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-mono" placeholder="Firebase Auth UID" />
          <span className="mt-1 block font-normal text-slate-500">Ask the account holder for the ID shown below their email in the app header or sidebar. They keep their existing password.</span>
        </label>}
        <label className="text-xs font-bold text-slate-600">Role
          <select value={role} onChange={event => { setRole(event.target.value as Exclude<TenantRole, 'owner'>); setOutletIds(event.target.value === 'manager' ? ['*'] : []); }} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm">
            <option value="manager">Manager</option><option value="crew">Crew</option><option value="viewer">Viewer</option>
          </select>
        </label>
        <fieldset className="text-xs font-bold text-slate-600">
          <legend>Outlet access</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {role === 'manager' && <label className="flex items-center gap-2"><input type="checkbox" checked={outletIds.includes('*')} onChange={event => setOutletIds(event.target.checked ? ['*'] : [])} /> All outlets (HQ)</label>}
            {outlets.map(outlet => <label key={outlet.id} className="flex items-center gap-2"><input type="checkbox" checked={outletIds.includes(outlet.id)} disabled={outletIds.includes('*')} onChange={event => setOutletIds(current => event.target.checked ? [...current.filter(id => id !== '*'), outlet.id] : current.filter(id => id !== outlet.id))} /> {outlet.name}</label>)}
          </div>
        </fieldset>
        <div className="flex items-center justify-end gap-3 md:col-span-2">
          <button type="button" onClick={() => setShowForm(false)} className="rounded-xl px-4 py-3 text-sm font-bold text-slate-500">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">{saving ? <Loader2 className="animate-spin" size={16} /> : <UserPlus size={16} />} {accountMode === 'new' ? 'Create account' : 'Add existing account'}</button>
        </div>
      </form>}

      {loading ? <div className="flex items-center gap-2 py-8 text-sm text-slate-500"><Loader2 className="animate-spin" size={16} /> Loading memberships…</div> : (
        <div className="divide-y divide-slate-100">
          {members.map(member => {
            const protectedOwner = member.role === 'owner';
            return <article key={member.id} className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_10rem_minmax(12rem,1fr)_auto] md:items-center">
              <div className="min-w-0"><p className="truncate font-bold text-slate-800">{member.email || member.userId}</p><p className="mt-1 truncate text-xs text-slate-400">{member.userId}</p></div>
              <select aria-label={`Role for ${member.email || member.userId}`} value={member.role} disabled={protectedOwner || member.userId === user.uid || member.status !== 'active'} onChange={event => {
                const nextRole = event.target.value as TenantRole;
                const nextOutlets = nextRole === 'manager' && member.outletIds.length === 0 ? ['*']
                  : nextRole !== 'manager' && member.outletIds.includes('*') ? (outlets[0] ? [outlets[0].id] : [])
                    : member.outletIds;
                void updateMember(member, nextRole, nextOutlets);
              }} className="rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50">
                <option value="manager">Manager</option><option value="crew">Crew</option><option value="viewer">Viewer</option>
              </select>
              <fieldset className="flex flex-wrap gap-x-3 gap-y-2 text-xs text-slate-600" disabled={protectedOwner || member.userId === user.uid || member.status !== 'active'}>
                {member.role === 'manager' && <label className="flex items-center gap-1.5"><input type="checkbox" checked={member.outletIds.includes('*')} onChange={event => void updateMember(member, member.role, event.target.checked ? ['*'] : [])} /> All outlets</label>}
                {outlets.map(outlet => <label key={outlet.id} className="flex items-center gap-1.5"><input type="checkbox" checked={member.outletIds.includes(outlet.id)} disabled={member.outletIds.includes('*')} onChange={event => {
                  const next = event.target.checked ? [...member.outletIds.filter(id => id !== '*'), outlet.id] : member.outletIds.filter(id => id !== outlet.id);
                  void updateMember(member, member.role, next);
                }} />{outlet.name}</label>)}
              </fieldset>
              {protectedOwner || member.userId === user.uid ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700"><ShieldCheck size={14} /> Protected</span> : <div className="flex items-center gap-2">
                {member.status === 'suspended'
                  ? <><span className="text-xs font-bold text-rose-600">Suspended</span><button type="button" onClick={() => void reactivateMember(member)} className="rounded-lg px-2 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-50">Reactivate</button></>
                  : <button type="button" onClick={() => void suspendMember(member)} title="Suspend member access" className="justify-self-start rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={16} /></button>}
                <button type="button" onClick={() => void removeMember(member)} title="Remove tenant access" className="rounded-lg px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50">Remove</button>
              </div>}
            </article>;
          })}
          {members.length === 0 && <p className="py-8 text-sm text-slate-500">No memberships found for this restaurant.</p>}
        </div>
      )}
    </section>
  );
};

export default TenantMembershipManager;
