
import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserRole, UserProfile, BankAccount, getOutletName } from './types';
import Login from './components/Login';

// Tabs are lazy-loaded so the initial bundle only ships the active screen;
// each import below becomes its own chunk fetched on first visit to that tab.
const Dashboard = lazy(() => import('./components/Dashboard'));
const Uploader = lazy(() => import('./components/Uploader'));
const SalesHub = lazy(() => import('./components/SalesHub'));
const RawSalesHub = lazy(() => import('./components/RawSalesHub'));
const ExpenseHub = lazy(() => import('./components/ExpenseHub'));
const ItemSalesHub = lazy(() => import('./components/ItemSalesHub'));
const PnLHub = lazy(() => import('./components/PnLHub'));
const PnLHubCrew = lazy(() => import('./components/PnLHubCrew'));
const PnLAnalytics = lazy(() => import('./components/PnLAnalytics'));
const WasteManagementV2 = lazy(() => import('./components/WasteManagementV2'));
const IntegrityAudit = lazy(() => import('./components/IntegrityAudit'));
const Team = lazy(() => import('./components/Team'));
const Rentals = lazy(() => import('./components/Rentals'));
const DataCatalog = lazy(() => import('./components/DataCatalog'));
const CategorySettings = lazy(() => import('./components/CategorySettings'));
const PartnershipModel = lazy(() => import('./components/PartnershipModel'));
const ExecDashboard = lazy(() => import('./components/ExecDashboard'));
const CrewTerminal = lazy(() => import('./components/CrewTerminal'));
const CrewReports = lazy(() => import('./components/CrewReports'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const BankManagement = lazy(() => import('./components/BankManagement'));
const BankReconciliation = lazy(() => import('./components/BankReconciliation'));
const VendorManagement = lazy(() => import('./components/VendorManagement'));
const CashFlowTracker = lazy(() => import('./components/CashFlowTracker'));
const HolidayRegistry = lazy(() => import('./components/HolidayRegistry'));
const OnlineProfitCenter = lazy(() => import('./components/OnlineProfitCenter'));
const ConsumablesEfficiency = lazy(() => import('./components/ConsumablesEfficiency'));
const RecipeCostLab = lazy(() => import('./components/RecipeCostLab'));

const TabLoader: React.FC = () => (
  <div className="flex items-center justify-center py-24">
    <div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
  </div>
);
import {
  LayoutDashboard, 
  LogOut, 
  UploadCloud, 
  Cat, 
  TrendingUp, 
  Receipt, 
  ShoppingBag, 
  PieChart, 
  Users, 
  Building2, 
  Database,
  ChevronRight,
  BarChart3,
  Settings2,
  ShieldAlert,
  Trash2,
  Zap,
  ShieldCheck,
  Sparkles,
  Handshake,
  Crown,
  Globe,
  PlusSquare,
  Eye,
  Smartphone,
  ShieldHalf,
  MapPin,
  Calendar,
  Wallet,
  Clock3,
  Banknote,
  Store,
  Flame,
  ChefHat
} from 'lucide-react';

type AppTab = 'exec-dashboard' | 'dashboard' | 'sales' | 'raw-verify' | 'items' | 'pnl' | 'pnl-crew' | 'cash-flow' | 'pnl-insights' | 'waste-v2' | 'integrity' | 'team' | 'rentals' | 'catalog' | 'upload' | 'category-settings' | 'expenses' | 'partnership' | 'crew-terminal' | 'crew-reports' | 'users' | 'bank-management' | 'bank-audit' | 'holidays' | 'online-profit' | 'vendor-management' | 'consumables' | 'recipe-costing';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AppTab>('exec-dashboard');
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
            // If user is crew, set them to terminal immediately
            if (profile.role === 'crew') {
              setActiveTab('crew-terminal');
            } else if (profile.role !== 'admin') {
              // The CEO Dashboard is admin-only (group net profit, per-outlet
              // margins), so viewers land on Sales Hub instead of an empty tab
              setActiveTab('sales');
            }
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
            setActiveTab('sales'); // default viewer — CEO Dashboard is admin-only
          }
        } catch (err) {
          console.error("Error fetching user profile:", err);
          setUserProfile({ uid: u.uid, email: u.email || '', role: 'viewer', createdAt: Date.now() });
          setActiveTab('sales'); // default viewer — CEO Dashboard is admin-only
        }
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
             <CrewTerminal user={user} profile={userProfile} />
           </Suspense>
        </main>
      </div>
    );
  }

  const NavItem: React.FC<{ tab: AppTab, icon: React.ReactNode, label: string }> = ({ tab, icon, label }) => (
    <button
      onClick={() => setActiveTab(tab)}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
        activeTab === tab 
          ? 'bg-indigo-600 shadow-lg shadow-indigo-900/40 translate-x-1' 
          : 'hover:bg-slate-800 text-slate-400 hover:text-white'
      }`}
    >
      {icon}
      <span className="font-bold text-sm">{label}</span>
      {activeTab === tab && <ChevronRight className="ml-auto opacity-50" size={14} />}
    </button>
  );

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
          <div className="pb-2 px-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Executive</p>
          </div>
          {isAdmin && <NavItem tab="exec-dashboard" icon={<Crown size={18} />} label="CEO Dashboard" />}

          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Intelligence</p>
          </div>
          <NavItem tab="sales" icon={<TrendingUp size={18} />} label="Sales Hub" />
          <NavItem tab="expenses" icon={<Receipt size={18} />} label="Expense Hub" />
          <NavItem tab="items" icon={<ShoppingBag size={18} />} label="Item Insights" />
          <NavItem tab="online-profit" icon={<Globe size={18} />} label="Online Profit Center" />
          <NavItem tab="waste-v2" icon={<Zap size={18} />} label="Waste Radar" />
          {isAdmin && <NavItem tab="consumables" icon={<Flame size={18} />} label="Consumables" />}
          <NavItem tab="pnl" icon={<PieChart size={18} />} label="P&L Command" />
          <NavItem tab="pnl-crew" icon={<Smartphone size={18} />} label="P&L Command (Crew)" />
          <NavItem tab="cash-flow" icon={<Banknote size={18} />} label="Cash Reality" />
          <NavItem tab="pnl-insights" icon={<Sparkles size={18} />} label="Margin Intelligence" />
          <NavItem tab="partnership" icon={<Handshake size={18} />} label="Partnership Forge" />

          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Crew Terminal</p>
          </div>
          {!isReadOnly && <NavItem tab="crew-terminal" icon={<Smartphone size={18} />} label="Crew Terminal" />}
          {isAdmin && <NavItem tab="crew-reports" icon={<BarChart3 size={18} />} label="Crew Reports" />}

          {!isReadOnly && (
            <>
              <div className="pt-4 pb-2 px-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Operations</p>
              </div>
              {isAdmin && <NavItem tab="users" icon={<ShieldHalf size={18} />} label="User Access" />}
              <NavItem tab="dashboard" icon={<LayoutDashboard size={18} />} label="Operations Control" />
              <NavItem tab="integrity" icon={<ShieldCheck size={18} />} label="Data Integrity" />
              <NavItem tab="catalog" icon={<Database size={18} />} label="Data Catalog" />
              <NavItem tab="raw-verify" icon={<ShieldAlert size={18} />} label="Raw Data Verify" />
              <NavItem tab="category-settings" icon={<Settings2 size={18} />} label="Mapping" />
              <NavItem tab="team" icon={<Users size={18} />} label="Team" />
              <NavItem tab="rentals" icon={<Building2 size={18} />} label="Store Rentals" />
              <NavItem tab="holidays" icon={<Calendar size={18} />} label="Holiday Registry" />
              <NavItem tab="bank-management" icon={<Wallet size={18} />} label="Bank Accounts" />
              <NavItem tab="bank-audit" icon={<ShieldCheck size={18} />} label="Bank Reconcile" />
              <NavItem tab="vendor-management" icon={<Store size={18} />} label="Vendors" />
              <NavItem tab="recipe-costing" icon={<ChefHat size={18} />} label="Recipe Costing" />

              <div className="pt-4 pb-2 px-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Inputs</p>
              </div>
              <NavItem tab="upload" icon={<PlusSquare size={18} />} label="Data Inflow" />
            </>
          )}
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
          {isReadOnly && activeTab !== 'sales' && activeTab !== 'expenses' && activeTab !== 'items' && activeTab !== 'waste-v2' && activeTab !== 'pnl' && activeTab !== 'pnl-crew' && activeTab !== 'pnl-insights' && activeTab !== 'partnership' && (
            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center gap-3 mb-8">
               <Eye className="text-emerald-600" size={18} />
               <p className="text-emerald-800 text-xs font-bold uppercase tracking-widest">You are in Executive Read-Only mode</p>
            </div>
          )}

          <Suspense fallback={<TabLoader />}>
          {activeTab === 'exec-dashboard' && isAdmin && <ExecDashboard user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'dashboard' && !isReadOnly && <Dashboard user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'sales' && <SalesHub user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'online-profit' && <OnlineProfitCenter user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'raw-verify' && !isReadOnly && <RawSalesHub user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'expenses' && <ExpenseHub user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'items' && <ItemSalesHub user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'waste-v2' && <WasteManagementV2 user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'consumables' && isAdmin && <ConsumablesEfficiency user={user} dataOwnerId={dataOwnerId} />}

          {activeTab === 'integrity' && !isReadOnly && <IntegrityAudit user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'pnl' && <PnLHub user={user} dataOwnerId={dataOwnerId} readOnly={isReadOnly} />}
          {activeTab === 'pnl-crew' && <PnLHubCrew user={user} dataOwnerId={dataOwnerId} readOnly={isReadOnly} />}
          {activeTab === 'cash-flow' && <CashFlowTracker user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'pnl-insights' && <PnLAnalytics user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'partnership' && <PartnershipModel user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'catalog' && !isReadOnly && <DataCatalog user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'category-settings' && !isReadOnly && <CategorySettings user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'team' && !isReadOnly && <Team user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'rentals' && !isReadOnly && <Rentals user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'holidays' && !isReadOnly && <HolidayRegistry user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'bank-management' && !isReadOnly && <BankManagement user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'bank-audit' && !isReadOnly && <BankReconciliation user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'vendor-management' && !isReadOnly && <VendorManagement user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'recipe-costing' && !isReadOnly && <RecipeCostLab user={user} dataOwnerId={dataOwnerId} />}
          {activeTab === 'upload' && !isReadOnly && <Uploader user={user} dataOwnerId={dataOwnerId} onSuccess={() => setActiveTab('exec-dashboard')} />}
          {activeTab === 'crew-terminal' && <CrewTerminal user={user} profile={userProfile} />}
          {activeTab === 'crew-reports' && isAdmin && <CrewReports user={user} profile={userProfile} />}
          {activeTab === 'users' && isAdmin && <UserManagement user={user} />}
          </Suspense>
        </div>
      </main>
    </div>
  );
};

export default App;
