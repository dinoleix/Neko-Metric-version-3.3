import React from 'react';
import type { User } from 'firebase/auth';
import { LogOut, MapPin, Store } from 'lucide-react';
import type { TenantSession } from '../multitenantRuntime';
import TenantDataProbe from './TenantDataProbe';
import ThemeToggle from './ThemeToggle';

type Props = {
  user: User;
  session: TenantSession | null;
  error: string | null;
  onSignOut: () => void;
};

const MultiTenantHome: React.FC<Props> = ({ user, session, error, onSignOut }) => (
  <div className="min-h-screen bg-slate-950 text-white">
    <header className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300"><Store size={20} /></div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">NekoMetrics · Tenant Preview</p>
          <p className="mt-1 text-xs text-slate-400">{user.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <ThemeToggle compact />
        <button onClick={onSignOut} className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm font-bold text-slate-300 hover:bg-white/5">
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </header>

    <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8">
      {error ? (
        <section role="alert" className="rounded-3xl border border-rose-400/20 bg-rose-400/5 p-8">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-rose-300">Tenant access unavailable</p>
          <p className="mt-3 text-lg font-semibold text-white">{error}</p>
        </section>
      ) : !session ? (
        <div className="flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-300/20 border-t-indigo-300" />
          <div><p className="font-bold">Loading your restaurant</p><p className="mt-1 text-sm text-slate-400">Checking your membership and outlet access.</p></div>
        </div>
      ) : (
        <>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">Active restaurant</p>
          <h1 className="mt-3 text-4xl font-black tracking-tight">{session.tenant.name}</h1>
          <p className="mt-3 max-w-2xl text-slate-400">Your account has resolved to one active tenant. Business modules will appear here as each data area is migrated to tenant-scoped reads and writes.</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Your access</p>
              <p className="mt-3 text-2xl font-black capitalize">{session.membership.role}</p>
              <p className="mt-2 text-sm text-slate-400">{session.membership.role === 'owner' || session.membership.outletIds.includes('*') ? 'All restaurant outlets' : `${session.membership.outletIds.length} assigned outlet${session.membership.outletIds.length === 1 ? '' : 's'}`}</p>
            </section>
            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Restaurant settings</p>
              <p className="mt-3 text-2xl font-black">{session.tenant.currency}</p>
              <p className="mt-2 text-sm text-slate-400">{session.tenant.timezone}</p>
            </section>
          </div>

          <section className="mt-8 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
            <div className="flex items-center gap-2"><MapPin size={16} className="text-indigo-300" /><h2 className="font-black">Your outlets</h2></div>
            {session.outlets.filter(outlet => session.membership.role === 'owner' || session.membership.outletIds.includes('*') || session.membership.outletIds.includes(outlet.id)).length ? (
              <ul className="mt-4 divide-y divide-white/10">
                {session.outlets.filter(outlet => session.membership.role === 'owner' || session.membership.outletIds.includes('*') || session.membership.outletIds.includes(outlet.id)).map(outlet => <li key={outlet.id} className="flex items-center justify-between py-3"><span className="font-semibold">{outlet.name}</span><span className="text-xs text-emerald-300">Access granted</span></li>)}
              </ul>
            ) : <p className="mt-4 text-sm text-slate-400">No active outlets are assigned to this account.</p>}
          </section>

          <TenantDataProbe user={user} session={session} />
        </>
      )}
    </main>
  </div>
);

export default MultiTenantHome;
