
import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserRole, UserProfile, UserGroup, BankAccount, getOutletName } from './types';
import Login from './components/Login';
import {
  MODULES, MODULE_BY_ID, MODULE_SECTIONS, ModuleId, AppModule, landingModule,
} from './moduleRegistry';
import { resolveAllowedModules } from './moduleAccess';
import {
  LogOut,
  Cat,
  ChevronRight,
  Eye,
  Smartphone,
  MapPin,
  Calendar,
  Wallet,
  Banknote,
} from 'lucide-react';

const CrewTerminalComponent = MODULE_BY_ID.get('crew-terminal')!.Component;

const TabLoader: React.FC = () => (
  <div className="flex items-center justify-center py-24">
    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
  </div>
);

/**
 * One sidebar button. Hoisted to module scope on purpose: defined inside App it
 * was a fresh component type on every render, so every button remounted whenever
 * any state changed.
 */
const NavItem: React.FC<{ module: AppModule; active: boolean; onSelect: (id: ModuleId) => void }> = ({ module, active, onSelect }) => (
  <button
    onClick={() => onSelect(module.id)}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
      active
        ? 'bg-indigo-600 shadow-lg shadow-indigo-900/40 translate-x-1'
        : 'hover:bg-slate-800 text-slate-400 hover:text-white'
    }`}
  >
    {module.icon}
    <span className="font-bold text-sm">{module.label}</span>
    {active && <ChevronRight className="ml-auto opacity-50" size={14} />}
  </button>
);

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ModuleId>('exec-dashboard');
  const [userGroup, setUserGroup] = useState<UserGroup | null>(null);
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [primaryCashAccount, setPrimaryCashAccount] = useState<BankAccount | null>(null);
  const [primaryTenKAccount, setPrimaryTenKAccount] = useState<BankAccount | null>(null);

  const INACTIVE_MS = userProfile?.role === 'crew' ? 14 * 60 * 60 * 1000 : 15 * 60 * 1000;
  const WARN_MS = userProfile?.role === 'crew' ? (14 * 60 * 60 - 5 * 60) * 1000 : 14 * 60 * 1000;
  const WARN_LABEL = userProfile?.role === 'crew' ? '5 minutes' : '1 minute';
  const warnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (warnTimer.current) clearTimeout(warnTimer.current);
    if (logoutTimer.current) clearTimeout(logoutTimer.current);
  }, []);

  const resetTimers = useCallback(() => {
    clearTimers();
    setShowTimeoutWarning(false);
    warnTimer.current = setTimeout(() => setShowTimeoutWarning(true), WARN_MS);
    logoutTimer.current = setTimeout(() => signOut(auth), INACTIVE_MS);
  }, [clearTimers, INACTIVE_MS, WARN_MS]);

  useEffect(() => {
    if (!user) { clearTimers(); return; }
    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetTimers, { passive: true }));
    resetTimers();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetTimers));
      clearTimers();
    };
  }, [user, resetTimers, clearTimers]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        try {
          const userDoc = await getDoc(doc(db, 'users', u.uid));
          if (userDoc.exists()) {
            const profile = userDoc.data() as UserProfile;
            // For admins, ownerId is themselves if not set
            if (profile.role === 'admin' && !profile.ownerId) {
              profile.ownerId = profile.uid;
            }
            setUserProfile(profile);
            // Landing tab comes from the same resolver the sidebar uses, so an
            // account can never open on a module its group does not include.
            // No group is loaded yet at this point, so this is the role default;
            // it is corrected once the group resolves.
            const initial = landingModule(profile.role, resolveAllowedModules(profile, null));
            if (initial) setActiveTab(initial);
          } else {
            // Profile missing from database, auto-create a default record
            const newProfile: UserProfile = { 
              uid: u.uid, 
              email: u.email || '', 
              role: 'viewer', 
              createdAt: Date.now() 
            };
            await setDoc(doc(db, 'users', u.uid), newProfile);
            setUserProfile(newProfile);
            const initial = landingModule('viewer', resolveAllowedModules(newProfile, null));
            if (initial) setActiveTab(initial);
          }
        } catch (err) {
          console.error("Error fetching user profile:", err);
          const fallback: UserProfile = { uid: u.uid, email: u.email || '', role: 'viewer', createdAt: Date.now() };
          setUserProfile(fallback);
          const initial = landingModule('viewer', resolveAllowedModules(fallback, null));
          if (initial) setActiveTab(initial);
        }
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  /**
   * The account's access group, when it has one. A failure here is deliberately
   * non-fatal: resolveAllowedModules falls back to the role defaults, so a
   * deleted group or a denied read leaves the sidebar as it was before groups
   * existed rather than emptying it.
   */
  useEffect(() => {
    const groupId = userProfile?.groupId;
    if (!groupId) { setUserGroup(null); return; }
    let cancelled = false;
    getDoc(doc(db, 'user_groups', groupId))
      .then(snap => {
        if (cancelled) return;
        setUserGroup(snap.exists() ? ({ id: snap.id, ...snap.data() } as UserGroup) : null);
      })
      .catch(err => {
        console.warn('[access] could not load group; using role defaults:', err);
        if (!cancelled) setUserGroup(null);
      });
    return () => { cancelled = true; };
  }, [userProfile?.groupId]);

  useEffect(() => {
    if (!userProfile || userProfile.role !== 'crew') return;
    const ownerId = userProfile.ownerId || user?.uid;
    if (!ownerId) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'bank_accounts'), where('userId', '==', ownerId)),
      (snap) => {
        const accounts = snap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
        setPrimaryCashAccount(
          accounts.find(a => a.outletId === userProfile.assignedOutlet && a.isPrimary && a.accountType === 'cash') ?? null
        );
        setPrimaryTenKAccount(
          accounts.find(a => a.outletId === userProfile.assignedOutlet && a.accountType === '10kcash') ?? null
        );
      }
    );
    return () => unsubscribe();
  }, [userProfile]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center">
          <Cat className="w-12 h-12 text-indigo-400 animate-bounce mx-auto mb-4" />
          <p className="text-white font-medium">Loading Neko Metrics...</p>
        </div>
      </div>
    );
  }

  if (!user || !userProfile) return <Login />;

  const role = userProfile.role;
  const isReadOnly = role === 'viewer';
  const isCrew = role === 'crew';
  const isAdmin = role === 'admin';
  const dataOwnerId = userProfile.ownerId || user.uid;

  // Single source of truth for "what can this account open". Nav, render, the
  // read-only banner and the landing tab all read this one set, so they can no
  // longer disagree the way the four hand-written copies did.
  const allowed = resolveAllowedModules(userProfile, userGroup);
  const activeModule = MODULE_BY_ID.get(activeTab);
  const goToLanding = () => {
    const id = landingModule(role, allowed);
    if (id) setActiveTab(id);
  };

  // If user is crew, provide a specialized fullscreen layout
  if (isCrew) {
    return (
      <div className="min-h-screen bg-slate-950 overflow-x-hidden">
        <header className="p-6 bg-slate-900 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
           <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-900/40">
                    <Smartphone className="text-white" size={24} />
                </div>
                <h1 className="text-2xl font-black text-white tracking-tighter uppercase">Crew Terminal</h1>
              </div>

              {/* Context Highlights */}
              <div className="flex flex-wrap items-center gap-3">
                 <div className="px-4 py-2.5 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl flex items-center gap-3 shadow-inner group transition-all hover:bg-indigo-600/30">
                    <div className="p-1.5 bg-indigo-600 rounded-lg shadow-lg">
                       <MapPin size={16} className="text-white" />
                    </div>
                    <div className="flex flex-col">
                       <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest leading-none mb-1">Active Station</span>
                       <span className="text-sm font-black text-white leading-none truncate max-w-[180px] uppercase">
                          {getOutletName(userProfile.assignedOutlet || 'UNASSIGNED')}
                       </span>
                    </div>
                 </div>

                 <div className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-2xl flex items-center gap-3 shadow-inner">
                    <div className="p-1.5 bg-slate-700 rounded-lg">
                       <Calendar size={16} className="text-slate-400" />
                    </div>
                    <div className="flex flex-col">
                       <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none mb-1">Duty Date</span>
                       <span className="text-sm font-black text-slate-300 leading-none uppercase">
                          {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                       </span>
                    </div>
                 </div>

                 <div className="px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center gap-3 shadow-inner">
                    <div className="p-1.5 bg-emerald-600/40 rounded-lg">
                       <Wallet size={16} className="text-emerald-400" />
                    </div>
                    <div className="flex flex-col">
                       <span className="text-[9px] font-black text-emerald-500/70 uppercase tracking-widest leading-none mb-1">Cash Counter</span>
                       <span className="text-sm font-black text-emerald-400 leading-none">
                          {primaryCashAccount ? `₹${primaryCashAccount.balance.toLocaleString('en-IN')}` : '—'}
                       </span>
                    </div>
                 </div>

                 {primaryTenKAccount && (
                   <div className="px-4 py-2.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center gap-3 shadow-inner">
                      <div className="p-1.5 bg-amber-500/40 rounded-lg">
                         <Banknote size={16} className="text-amber-400" />
                      </div>
                      <div className="flex flex-col">
                         <span className="text-[9px] font-black text-amber-500/70 uppercase tracking-widest leading-none mb-1">10K Safe</span>
                         <span className="text-sm font-black text-amber-400 leading-none">
                            ₹{primaryTenKAccount.balance.toLocaleString('en-IN')}
                         </span>
                      </div>
                   </div>
                 )}
              </div>
           </div>

           <div className="flex items-center gap-4">
              <div className="hidden lg:block text-right">
                 <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Authenticated As</p>
                 <p className="text-xs font-bold text-slate-300">{user.email}</p>
              </div>
              <button
                onClick={() => signOut(auth)}
                className="flex items-center gap-2 px-5 py-3 bg-rose-500/10 text-rose-400 rounded-2xl font-black text-[11px] uppercase tracking-widest border border-rose-500/20 transition-all hover:bg-rose-500 hover:text-white"
              >
                <LogOut size={16} /> Sign Out
              </button>
           </div>
        </header>
        <main className="p-4 md:p-10 max-w-4xl mx-auto">
           <Suspense fallback={<TabLoader />}>
             {/* Same lazy component the registry holds, so crew and the admin's
                 Crew Terminal tab can never load two different builds of it. */}
             <CrewTerminalComponent user={user} profile={userProfile} />
           </Suspense>
        </main>
      </div>
    );
  }


  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50">
      {showTimeoutWarning && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full mx-4 text-center space-y-4">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
              <span className="text-2xl">⏱</span>
            </div>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Still there?</h2>
            <p className="text-sm text-slate-500 font-medium">You'll be signed out in <span className="text-amber-600 font-black">{WARN_LABEL}</span> due to inactivity.</p>
            <button
              onClick={resetTimers}
              className="w-full py-3 bg-slate-900 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-indigo-600 transition-all"
            >
              Keep me signed in
            </button>
          </div>
        </div>
      )}
      <aside className="w-full md:w-64 bg-slate-900 text-white flex-shrink-0 flex flex-col sticky top-0 h-screen overflow-y-auto custom-scrollbar">
        <div className="p-6 flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg shadow-lg shadow-indigo-500/20">
            <div className="relative">
              <Cat className="w-6 h-6 text-indigo-600" />
              <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full border-2 border-slate-900" />
            </div>
          </div>
          <h1 className="text-xl font-black tracking-tight">Neko Metrics</h1>
        </div>
        
        <nav className="mt-6 px-4 space-y-1.5 flex-1">
          {MODULE_SECTIONS.map(section => {
            const items = MODULES.filter(m => m.section === section && allowed.has(m.id));
            // Sections with nothing in them are not rendered. Previously the
            // Executive and Crew Terminal headings were unconditional, so a viewer
            // saw two headings with no entries under them.
            if (items.length === 0) return null;
            return (
              <React.Fragment key={section}>
                <div className="pt-4 pb-2 px-4 first:pt-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">{section}</p>
                </div>
                {items.map(m => (
                  <NavItem key={m.id} module={m} active={activeTab === m.id} onSelect={setActiveTab} />
                ))}
              </React.Fragment>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 mt-auto">
          <div className="flex items-center gap-3 mb-4 bg-slate-800/50 p-3 rounded-2xl">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black ${isReadOnly ? 'bg-emerald-400 text-emerald-950' : 'bg-indigo-400 text-indigo-950'}`}>
              {user.email?.[0].toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">{role} Access</p>
                {isReadOnly && <Eye size={10} className="text-emerald-400" />}
              </div>
              <p className="text-xs font-bold truncate text-slate-200">{user.email}</p>
            </div>
          </div>
          <button
            onClick={() => signOut(auth)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-bold text-slate-500 hover:text-rose-400 hover:bg-rose-50/5 rounded-xl transition-all"
          >
            <LogOut size={16} />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 md:p-10">
          {isReadOnly && !activeModule?.suppressReadOnlyBanner && (
            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center gap-3 mb-8">
               <Eye className="text-emerald-600" size={18} />
               <p className="text-emerald-800 text-xs font-bold uppercase tracking-widest">You are in Executive Read-Only mode</p>
            </div>
          )}

          <Suspense fallback={<TabLoader />}>
            {!activeModule || !allowed.has(activeModule.id) ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
                <p className="text-sm font-black uppercase tracking-widest text-slate-400">No access</p>
                <p className="text-slate-500 mt-2">
                  This module is not part of your access group. Contact your administrator if you need it.
                </p>
              </div>
            ) : activeModule.render ? (
              activeModule.render({ user, userProfile, dataOwnerId, isReadOnly, goTo: setActiveTab, goToLanding })
            ) : (
              <activeModule.Component user={user} dataOwnerId={dataOwnerId} />
            )}
          </Suspense>
        </div>
      </main>
    </div>
  );
};

export default App;
