import React, { lazy } from 'react';
import type { User } from 'firebase/auth';
import { UserRole, UserProfile } from './types';
import {
  Crown, TrendingUp, Receipt, ShoppingBag, Globe, Zap, Flame, PieChart, Smartphone,
  Banknote, Sparkles, Handshake, BarChart3, ShieldHalf, LayoutDashboard, ShieldCheck,
  Database, ShieldAlert, Settings2, Users, Building2, Calendar, Wallet, Store,
  ChefHat, IndianRupee, PlusSquare,
} from 'lucide-react';

/**
 * The one place that knows what a module is.
 *
 * Before this existed, each of the 29 module ids was repeated as a bare string in
 * four independent places in App.tsx — the sidebar, the render switch, a read-only
 * banner whitelist, and the landing-tab logic — with the access rule re-typed at
 * each site. Adding a module meant four edits, and the copies had already drifted
 * (crew-terminal's nav was gated and its render was not).
 *
 * Everything now derives from MODULES below. Adding a module is one entry.
 */

// Lazy, with string-literal paths so Vite still emits one chunk per module.
// lazy() only stores the thunk — importing this file fetches no component code,
// which is what lets UserManagement import the registry for its module picker.
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
const MenuPriceBoard = lazy(() => import('./components/MenuPriceBoard'));

export type ModuleId =
  | 'exec-dashboard' | 'sales' | 'expenses' | 'items' | 'online-profit' | 'waste-v2'
  | 'consumables' | 'pnl' | 'pnl-crew' | 'cash-flow' | 'pnl-insights' | 'partnership'
  | 'crew-terminal' | 'crew-reports' | 'users' | 'dashboard' | 'integrity' | 'catalog'
  | 'raw-verify' | 'category-settings' | 'team' | 'rentals' | 'holidays'
  | 'bank-management' | 'bank-audit' | 'vendor-management' | 'recipe-costing'
  | 'menu-prices' | 'upload';

export type ModuleSection = 'Executive' | 'Intelligence' | 'Crew Terminal' | 'Operations' | 'Inputs';

/** Section order in the sidebar. A section with no visible modules is not rendered. */
export const MODULE_SECTIONS: ModuleSection[] = [
  'Executive', 'Intelligence', 'Crew Terminal', 'Operations', 'Inputs',
];

/** What a module's `render` gets when its props differ from the common shape. */
export interface ModuleRenderContext {
  user: User;
  userProfile: UserProfile;
  dataOwnerId: string;
  isReadOnly: boolean;
  goTo: (id: ModuleId) => void;
  /** Send the user to whichever module they land on by default. */
  goToLanding: () => void;
}

export interface AppModule {
  id: ModuleId;
  label: string;
  icon: React.ReactNode;
  section: ModuleSection;
  Component: React.LazyExoticComponent<React.ComponentType<any>>;
  /**
   * Who reaches this module when no group is assigned. Transcribed from the
   * pre-registry gating in App.tsx, and it is also what the starter groups are
   * seeded from — so it must stay an accurate record of the old behaviour.
   *
   * No module lists 'crew': crew never see the sidebar at all (App.tsx forks to
   * the fullscreen Crew Terminal before it renders), so the old `!isReadOnly`
   * gate was, in practice, admin-only.
   */
  defaultRoles: UserRole[];
  /** Viewer read-only banner is hidden on these. Was a hardcoded list in App.tsx. */
  suppressReadOnlyBanner?: boolean;
  /**
   * Never group-controlled: force-granted to this role, force-denied to all others.
   * Only 'users' uses it, so an admin cannot be locked out of the group editor.
   */
  roleLocked?: UserRole;
  /** Shows a warning badge in the group picker — granting it widens real access. */
  sensitive?: boolean;
  /** Only for modules whose props differ from `{ user, dataOwnerId }`. */
  render?: (ctx: ModuleRenderContext) => React.ReactNode;
}

/**
 * Order here IS the sidebar order. Keep it matching the pre-registry layout.
 */
export const MODULES: AppModule[] = [
  // ---- Executive ----
  {
    id: 'exec-dashboard', label: 'CEO Dashboard', icon: <Crown size={18} />,
    section: 'Executive', Component: ExecDashboard,
    defaultRoles: ['admin', 'manager'], sensitive: true,
  },

  // ---- Intelligence ----
  {
    id: 'sales', label: 'Sales Hub', icon: <TrendingUp size={18} />,
    section: 'Intelligence', Component: SalesHub,
    defaultRoles: ['admin', 'manager', 'viewer'], suppressReadOnlyBanner: true,
  },
  {
    id: 'expenses', label: 'Expense Hub', icon: <Receipt size={18} />,
    section: 'Intelligence', Component: ExpenseHub,
    defaultRoles: ['admin', 'manager', 'viewer'], suppressReadOnlyBanner: true,
  },
  {
    id: 'items', label: 'Item Insights', icon: <ShoppingBag size={18} />,
    section: 'Intelligence', Component: ItemSalesHub,
    defaultRoles: ['admin', 'manager', 'viewer'], suppressReadOnlyBanner: true,
  },
  {
    // Note: no suppressReadOnlyBanner, matching the pre-registry whitelist, which
    // omitted this id — so a viewer here sees the read-only bar while on the eight
    // ids below they do not. Preserved deliberately; changing it is a visible call.
    id: 'online-profit', label: 'Online Profit Center', icon: <Globe size={18} />,
    section: 'Intelligence', Component: OnlineProfitCenter,
    defaultRoles: ['admin', 'manager', 'viewer'],
  },
  {
    id: 'waste-v2', label: 'Waste Radar', icon: <Zap size={18} />,
    section: 'Intelligence', Component: WasteManagementV2,
    defaultRoles: ['admin', 'manager', 'viewer'], suppressReadOnlyBanner: true,
  },
  {
    id: 'consumables', label: 'Consumables', icon: <Flame size={18} />,
    section: 'Intelligence', Component: ConsumablesEfficiency,
    defaultRoles: ['admin', 'manager'], sensitive: true,
  },
  {
    id: 'pnl', label: 'P&L Command', icon: <PieChart size={18} />,
    section: 'Intelligence', Component: PnLHub,
    defaultRoles: ['admin', 'manager', 'viewer'], suppressReadOnlyBanner: true,
    // readOnly is the ONLY thing making P&L non-editable for viewers, and the
    // component defaults it to false. Dropping it silently grants edit rights.
    render: ctx => <PnLHub user={ctx.user} dataOwnerId={ctx.dataOwnerId} readOnly={ctx.isReadOnly} />,
  },
  {
    id: 'pnl-crew', label: 'P&L Command (Crew)', icon: <Smartphone size={18} />,
    section: 'Intelligence', Component: PnLHubCrew,
    defaultRoles: ['admin', 'manager', 'viewer'], suppressReadOnlyBanner: true,
    render: ctx => <PnLHubCrew user={ctx.user} dataOwnerId={ctx.dataOwnerId} readOnly={ctx.isReadOnly} />,
  },
  {
    // Same banner note as online-profit.
    id: 'cash-flow', label: 'Cash Reality', icon: <Banknote size={18} />,
    section: 'Intelligence', Component: CashFlowTracker,
    defaultRoles: ['admin', 'manager', 'viewer'],
  },
  {
    id: 'pnl-insights', label: 'Margin Intelligence', icon: <Sparkles size={18} />,
    section: 'Intelligence', Component: PnLAnalytics,
    defaultRoles: ['admin', 'manager', 'viewer'], suppressReadOnlyBanner: true,
  },
  {
    id: 'partnership', label: 'Partnership Forge', icon: <Handshake size={18} />,
    section: 'Intelligence', Component: PartnershipModel,
    defaultRoles: ['admin', 'manager', 'viewer'], suppressReadOnlyBanner: true,
  },

  // ---- Crew Terminal ----
  {
    id: 'crew-terminal', label: 'Crew Terminal', icon: <Smartphone size={18} />,
    section: 'Crew Terminal', Component: CrewTerminal,
    defaultRoles: ['admin', 'manager'],
    render: ctx => <CrewTerminal user={ctx.user} profile={ctx.userProfile} />,
  },
  {
    id: 'crew-reports', label: 'Crew Reports', icon: <BarChart3 size={18} />,
    section: 'Crew Terminal', Component: CrewReports,
    defaultRoles: ['admin', 'manager'], sensitive: true,
    render: ctx => <CrewReports user={ctx.user} profile={ctx.userProfile} />,
  },

  // ---- Operations ----
  {
    id: 'users', label: 'User Access', icon: <ShieldHalf size={18} />,
    section: 'Operations', Component: UserManagement,
    defaultRoles: ['admin'], roleLocked: 'admin',
    render: ctx => <UserManagement user={ctx.user} dataOwnerId={ctx.dataOwnerId} />,
  },
  {
    id: 'dashboard', label: 'Operations Control', icon: <LayoutDashboard size={18} />,
    section: 'Operations', Component: Dashboard, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'integrity', label: 'Data Integrity', icon: <ShieldCheck size={18} />,
    section: 'Operations', Component: IntegrityAudit, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'catalog', label: 'Data Catalog', icon: <Database size={18} />,
    section: 'Operations', Component: DataCatalog, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'raw-verify', label: 'Raw Data Verify', icon: <ShieldAlert size={18} />,
    section: 'Operations', Component: RawSalesHub, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'category-settings', label: 'Mapping', icon: <Settings2 size={18} />,
    section: 'Operations', Component: CategorySettings, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'team', label: 'Team', icon: <Users size={18} />,
    section: 'Operations', Component: Team, defaultRoles: ['admin', 'manager'], sensitive: true,
  },
  {
    id: 'rentals', label: 'Store Rentals', icon: <Building2 size={18} />,
    section: 'Operations', Component: Rentals, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'holidays', label: 'Holiday Registry', icon: <Calendar size={18} />,
    section: 'Operations', Component: HolidayRegistry, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'bank-management', label: 'Bank Accounts', icon: <Wallet size={18} />,
    section: 'Operations', Component: BankManagement, defaultRoles: ['admin', 'manager'], sensitive: true,
  },
  {
    id: 'bank-audit', label: 'Bank Reconcile', icon: <ShieldCheck size={18} />,
    section: 'Operations', Component: BankReconciliation, defaultRoles: ['admin', 'manager'], sensitive: true,
  },
  {
    id: 'vendor-management', label: 'Vendors', icon: <Store size={18} />,
    section: 'Operations', Component: VendorManagement, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'recipe-costing', label: 'Recipe Costing', icon: <ChefHat size={18} />,
    section: 'Operations', Component: RecipeCostLab, defaultRoles: ['admin', 'manager'],
  },
  {
    id: 'menu-prices', label: 'Menu Prices', icon: <IndianRupee size={18} />,
    section: 'Operations', Component: MenuPriceBoard, defaultRoles: ['admin', 'manager'],
  },

  // ---- Inputs ----
  {
    id: 'upload', label: 'Data Inflow', icon: <PlusSquare size={18} />,
    section: 'Inputs', Component: Uploader, defaultRoles: ['admin', 'manager'],
    // Previously hardcoded to 'exec-dashboard', a tab most accounts cannot open.
    render: ctx => <Uploader user={ctx.user} dataOwnerId={ctx.dataOwnerId} onSuccess={ctx.goToLanding} />,
  },
];

export const MODULE_BY_ID: Map<ModuleId, AppModule> = new Map(MODULES.map(m => [m.id, m]));

/** Where each role starts, when that module is available to them. */
export const ROLE_LANDING: Record<UserRole, ModuleId> = {
  admin: 'exec-dashboard',
  // A manager has no CEO Dashboard by default, so they start where the numbers
  // they act on live.
  manager: 'sales',
  viewer: 'sales',
  crew: 'crew-terminal',
};

/**
 * The module to open on sign-in. Falls back to the first allowed module in
 * registry (sidebar) order, and null when the account has none at all — which
 * the caller renders as an explanatory panel rather than a blank page.
 */
export const landingModule = (role: UserRole, allowed: Set<ModuleId>): ModuleId | null => {
  const preferred = ROLE_LANDING[role];
  if (allowed.has(preferred)) return preferred;
  return MODULES.find(m => allowed.has(m.id))?.id ?? null;
};
