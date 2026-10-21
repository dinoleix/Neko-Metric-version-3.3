import React from 'react';
import type { User } from 'firebase/auth';
import { LogOut, MapPin, Store } from 'lucide-react';
import type { TenantSession } from '../multitenantRuntime';
import ThemeToggle from './ThemeToggle';

type Props = {
  user: User;
  sessions: TenantSession[];
  onSelect: (session: TenantSession) => void;
  onSignOut: () => void;
};

const TenantPicker: React.FC<Props> = ({ user, sessions, onSelect, onSignOut }) => (
  <div className="min-h-screen bg-slate-950 text-white">
    <header className="flex items-center justify-between border-b border-white/10 px-5 py-4 sm:px-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300"><Store size={20} /></div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-300">NekoMetrics</p>
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
    <main className="mx-auto max-w-3xl px-5 py-12 sm:px-8">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-300">Choose a restaurant</p>
      <h1 className="mt-3 text-3xl font-black tracking-tight">Where would you like to work?</h1>
      <p className="mt-3 text-slate-400">Your account has access to more than one restaurant. Choose the tenant for this session.</p>
      <div className="mt-8 space-y-3">
        {sessions.map(session => {
          const accessibleOutlets = session.outlets.filter(outlet =>
            session.membership.role === 'owner'
            || session.membership.outletIds.includes('*')
            || session.membership.outletIds.includes(outlet.id));
          return <button key={session.tenant.id} onClick={() => onSelect(session)} className="w-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left transition hover:border-emerald-300/40 hover:bg-white/[0.06]">
            <span className="flex items-start justify-between gap-4">
              <span>
                <span className="block text-xl font-black">{session.tenant.name}</span>
                <span className="mt-1 block text-sm capitalize text-slate-400">{session.membership.role}</span>
              </span>
              <span className="rounded-lg bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-300">Open</span>
            </span>
            <span className="mt-4 flex items-center gap-2 text-xs text-slate-400"><MapPin size={14} /> {accessibleOutlets.length} accessible outlet{accessibleOutlets.length === 1 ? '' : 's'}</span>
          </button>;
        })}
      </div>
    </main>
  </div>
);

export default TenantPicker;
