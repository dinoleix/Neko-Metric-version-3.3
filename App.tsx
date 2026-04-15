
import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from '@firebase/auth';
import type { User } from '@firebase/auth';
import { doc, getDoc, setDoc } from '@firebase/firestore';
import { auth, db } from './firebase';
import { UserRole, UserProfile, getOutletName } from './types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import Uploader from './components/Uploader';
import SalesHub from './components/SalesHub';
import RawSalesHub from './components/RawSalesHub';
import ExpenseHub from './components/ExpenseHub';
import ItemSalesHub from './components/ItemSalesHub';
import PnLHub from './components/PnLHub';
import PnLAnalytics from './components/PnLAnalytics';
import WasteManagement from './components/WasteManagement';
import WasteManagementV2 from './components/WasteManagementV2';
import IntegrityAudit from './components/IntegrityAudit';
import Team from './components/Team';
import Rentals from './components/Rentals';
import DataCatalog from './components/DataCatalog';
import CategorySettings from './components/CategorySettings';
import PartnershipModel from './components/PartnershipModel';
import ExecDashboard from './components/ExecDashboard';
import CrewTerminal from './components/CrewTerminal';
import UserManagement from './components/UserManagement';
import BankManagement from './components/BankManagement';
import HolidayRegistry from './components/HolidayRegistry';
import OnlineProfitCenter from './components/OnlineProfitCenter';
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
  Wallet
} from 'lucide-react';

type AppTab = 'exec-dashboard' | 'dashboard' | 'sales' | 'raw-verify' | 'items' | 'pnl' | 'pnl-insights' | 'waste' | 'waste-v2' | 'integrity' | 'team' | 'rentals' | 'catalog' | 'upload' | 'category-settings' | 'expenses' | 'partnership' | 'crew-terminal' | 'users' | 'bank-management' | 'holidays' | 'online-profit';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AppTab>('exec-dashboard');

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
          }
        } catch (err) {
          console.error("Error fetching user profile:", err);
          setUserProfile({ uid: u.uid, email: u.email || '', role: 'viewer', createdAt: Date.now() });
        }
      } else {
        setUser(null);
        setUserProfile(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

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
                <h1 className="text-2xl font-black text-white tracking-tighter uppercase">Purchase & Expenses</h1>
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
           <CrewTerminal user={user} profile={userProfile} />
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
          <NavItem tab="exec-dashboard" icon={<Crown size={18} />} label="CEO Dashboard" />

          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Intelligence</p>
          </div>
          <NavItem tab="sales" icon={<TrendingUp size={18} />} label="Sales Hub" />
          <NavItem tab="expenses" icon={<Receipt size={18} />} label="Expense Hub" />
          <NavItem tab="items" icon={<ShoppingBag size={18} />} label="Item Insights" />
          <NavItem tab="online-profit" icon={<Globe size={18} />} label="Online Profit Center" />
          <NavItem tab="waste-v2" icon={<Zap size={18} />} label="Waste Radar" />
          <NavItem tab="pnl" icon={<PieChart size={18} />} label="P&L Command" />
          <NavItem tab="pnl-insights" icon={<Sparkles size={18} />} label="Margin Intelligence" />
          <NavItem tab="partnership" icon={<Handshake size={18} />} label="Partnership Forge" />

          <div className="pt-4 pb-2 px-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-600">Crew Terminal</p>
          </div>
          {!isReadOnly && <NavItem tab="crew-terminal" icon={<Smartphone size={18} />} label="Purchase & Expenses" />}

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
          {isReadOnly && activeTab !== 'exec-dashboard' && activeTab !== 'sales' && activeTab !== 'expenses' && activeTab !== 'items' && activeTab !== 'waste' && activeTab !== 'waste-v2' && activeTab !== 'pnl' && activeTab !== 'pnl-insights' && activeTab !== 'partnership' && (
            <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl flex items-center gap-3 mb-8">
               <Eye className="text-emerald-600" size={18} />
               <p className="text-emerald-800 text-xs font-bold uppercase tracking-widest">You are in Executive Read-Only mode</p>
            </div>
          )}

          {activeTab === 'exec-dashboard' && <ExecDashboard user={user} />}
          {activeTab === 'dashboard' && !isReadOnly && <Dashboard user={user} />}
          {activeTab === 'sales' && <SalesHub user={user} />}
          {activeTab === 'online-profit' && <OnlineProfitCenter user={user} />}
          {activeTab === 'raw-verify' && !isReadOnly && <RawSalesHub user={user} />}
          {activeTab === 'expenses' && <ExpenseHub user={user} />}
          {activeTab === 'items' && <ItemSalesHub user={user} />}
          {activeTab === 'waste' && <WasteManagement user={user} />}
          {activeTab === 'waste-v2' && <WasteManagementV2 user={user} />}
          {activeTab === 'integrity' && !isReadOnly && <IntegrityAudit user={user} />}
          {activeTab === 'pnl' && <PnLHub user={user} readOnly={isReadOnly} />}
          {activeTab === 'pnl-insights' && <PnLAnalytics user={user} />}
          {activeTab === 'partnership' && <PartnershipModel user={user} />}
          {activeTab === 'catalog' && !isReadOnly && <DataCatalog user={user} />}
          {activeTab === 'category-settings' && !isReadOnly && <CategorySettings user={user} />}
          {activeTab === 'team' && !isReadOnly && <Team user={user} />}
          {activeTab === 'rentals' && !isReadOnly && <Rentals user={user} />}
          {activeTab === 'holidays' && !isReadOnly && <HolidayRegistry user={user} />}
          {activeTab === 'bank-management' && !isReadOnly && <BankManagement user={user} />}
          {activeTab === 'upload' && !isReadOnly && <Uploader user={user} onSuccess={() => setActiveTab('exec-dashboard')} />}
          {activeTab === 'crew-terminal' && <CrewTerminal user={user} profile={userProfile} />}
          {activeTab === 'users' && isAdmin && <UserManagement user={user} />}
        </div>
      </main>
    </div>
  );
};

export default App;
