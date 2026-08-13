
export type FileType = 'sales' | 'item' | 'expense' | 'purchase' | 'platform_item' | 'online_order' | 'customer_mapping' | 'bank_statement';

export type UserRole = 'admin' | 'viewer' | 'crew';

export interface UserProfile {
  uid: string;
  email: string;
  role: UserRole;
  createdAt: number;
  assignedOutlet?: string;
  ownerId?: string;
}

export type EntryStatus = 'paid' | 'pending' | 'cancelled';

export interface BillItem {
  productId: string;
  productName: string;
  quantity: number;
  pricePerUnit: number;
  amount: number;
}

export interface DailyCounterEntry {
  id?: string;
  userId: string;
  userName: string;
  outletId: string;
  type: 'expense' | 'purchase';
  amount: number;
  quantity?: number;
  pricePerUnit?: number;
  date: string;
  category: string;
  description: string;
  status: EntryStatus;
  receiptUrl?: string;
  billNumber?: string;
  vendorId?: string;
  vendorName?: string;
  items?: BillItem[];
  // Which account a paid cash expense was deducted from (default 'counter')
  paidFrom?: 'counter' | '10k';
  createdAt: number;
}

export interface Vendor {
  id?: string;
  userId: string;
  ownerId: string;
  name: string;
  address?: string;
  phone?: string;
  gst?: string;
  email?: string;
  createdAt: number;
}

export interface DailySalesLog {
  id?: string;
  userId: string;    // the authenticated submitter's UID (for security rules)
  ownerId: string;   // the business owner's UID (for admin queries)
  outletId: string;
  date: string; // YYYY-MM-DD
  cash: number;
  card: number; // net after card charges
  upi: number;
  totalNet: number; // cash + card + upi
  notes: string;
  submittedBy: string;
  createdAt: number;
}

export interface FileMetadata {
  id?: string;
  name: string;
  type: FileType;
  month: string;
  year: string;
  uploadedAt: number;
  recordCount: number;
  userId: string;
  storagePath?: string; 
  entryMode?: 'csv' | 'manual';
  outletId?: string;
  platform?: 'ZOMATO' | 'SWIGGY' | 'NONE';
}

export interface PnLMonthlySnapshot {
  id?: string;
  userId: string;
  outletId: string;
  month: string;
  year: string;
  grossRevenue: number;
  netRevenue: number;
  cogsAmount: number;
  labourAmount: number;
  opsAmount: number;
  rentAmount: number;
  netProfit: number;
  cogsRatio: number;
  labourRatio: number;
  opsRatio: number;
  rentRatio: number;
  netMargin: number;
  isLocked: boolean;
  lastUpdated: number;
}

export interface SalesMonthlySnapshot {
  id?: string;
  userId: string;
  outletId: string;
  month: string;
  year: string;
  posTotalGross: number;
  posGoodGross: number;
  posGoodNet: number;
  posGoodTax: number;
  onlineGoodGross: number;
  onlineGoodNet: number;
  onlineGoodTax: number;
  onlineGoodTax_calculated?: number;
  onlineGoodComm: number;
  onlineGoodAds: number;
  onlineGoodGstOnComm?: number;
  onlineGoodTds?: number;
  eventRevenue: number;
  settledOrderCount: number;
  onlineOrderCount: number;
  totalOrderCount: number;
  cancelledOrderCount: number;
  dailyTrend: number[]; // 31 slots
  hourlyDistribution: number[]; // 24 slots for aggregate sales intensity
  onlineHourlyDistribution?: number[]; // 24 slots for online revenue
  onlineOrderHourlyDistribution?: number[]; // 24 slots for online order counts
  onlineWeekdayDistribution?: number[]; // 7 slots (0=Sun, 6=Sat)
  platformBreakdown?: {
    [platform: string]: {
      gross: number;
      net: number;
      tax: number;
      commission: number;
      ads: number;
      gstOnComm: number;
      tds: number;
      orders: number;
    }
  };
  lastUpdated: number;
}

export interface EventRecord {
  id?: string;
  userId: string;
  outletId: string;
  month: string;
  year: string;
  date: string;
  eventName: string;
  revenue: number;
  costs: number;
  description: string;
  createdAt: number;
}

export interface ExpenseMonthlySnapshot {
  id?: string;
  userId: string;
  outletId: string;
  month: string;
  year: string;
  totalExpense: number;
  totalPurchase: number;
  expenseByCategory: Record<string, number>;
  purchaseByCategory: Record<string, number>;
  cogsBucketAgg: Record<string, number>;
  // Crew Terminal contributions (separate from CSV so sources never double-count)
  crewTotalExpense?: number;
  crewTotalPurchase?: number;
  crewExpenseByCategory?: Record<string, number>;
  crewPurchaseByCategory?: Record<string, number>;
  crewCogsBucketAgg?: Record<string, number>;
  // Physical units purchased per category, for consumption tracking (gas cylinders etc).
  // Meaningless for mixed-unit categories — only read for tracked single-unit consumables.
  crewQtyByCategory?: Record<string, number>;
  // Distinguishes "0 units bought" from "entries exist but nobody typed a quantity".
  crewQtyMetaByCategory?: Record<string, CrewQtyMeta>;
  crewLastUpdated?: number;
  lastUpdated: number;
}

/**
 * A consumable tracked by unit count rather than only by spend, so consumption
 * can be compared against business activity month over month (gas cylinders,
 * cooking oil, packaging). Configured per owner in category_settings.
 */
export interface TrackedConsumable {
  id: string;                   // stable slug, e.g. 'gas-cylinder'
  category: string;             // must match DailyCounterEntry.category
  label: string;                // 'Gas cylinders'
  unitLabel: string;            // singular; UI pluralizes — 'cylinder'
  unitsPerPurchase?: number;    // multiplier when one entry = several units (default 1)
  estimatedUnitCost?: number;   // enables reconstructing history from ₹ where quantity is missing
  alertThresholdPct?: number;   // deviation from baseline that counts as an alert (default 15)
  active?: boolean;
}

// Capture coverage for crewQtyByCategory. Without this a reader cannot tell a
// true zero from an unmeasured month, and a trend chart would plot both as 0.
export interface CrewQtyMeta {
  entries: number;    // reportable entries in this category
  withQty: number;    // ...of which carried a usable quantity
  fromItems: number;  // ...of which took it from the bill-builder line items
}

export interface ItemMonthlySnapshot {
  id?: string;
  userId: string;
  outletId: string;
  month: string;
  year: string;
  // Key is Master Item Name
  items: Record<string, {
    quantity: number;
    posQuantity?: number;
    onlineQuantity?: number;
    revenue: number;
    dailyTrend: number[]; // 31 slots
    staffQuantity?: number; // Aggregated NC- bill quantity
    staffTheoreticalCost?: number; // Aggregated NC- bill theoretical cost
    staffPotentialRevenue?: number; // Aggregated NC- bill potential revenue
    platformBreakdown?: {
      [platform: string]: {
        quantity: number;
        revenue: number;
      }
    };
  }>;
  combos?: {
    items: string[];
    count: number;
    totalRevenue: number;
  }[];
  lastUpdated: number;
}

export interface ItemCost {
  id?: string;
  itemName: string;
  costPerUnit: number; // Ingredient Cost
  servingsCostPerUnit?: number;
  tier1ServingsCost?: number;   
  tier2ServingsCost?: number;   
  userId: string;
  updatedAt: number;
}

export interface MenuNormalization {
  id?: string;
  sourceName: string;
  masterName: string;
  userId: string;
  updatedAt: number;
}

export interface ServingItem {
  name: string;
  price: number;
}

export interface ServingOption {
  id?: string;
  name: string;
  items: ServingItem[];
  totalCost: number;
  userId: string;
  updatedAt: number;
}

export type WasteType = 'extra_demand' | 'broken';

export interface WasteLineItem {
  servingOptionId: string;
  servingOptionName: string;
  itemName: string;
  quantity: number;
  costPerUnit: number;
  totalCost: number;
  wasteType: WasteType;
}

export interface WasteEntry {
  id?: string;
  userId: string;
  ownerId: string;
  outletId: string;
  date: string;
  items: WasteLineItem[];
  totalCost: number;
  notes?: string;
  submittedBy: string;
  createdAt: number;
}

export type SkuCategory = 'FOOD' | 'DRINKS' | 'MISC' | 'UNMAPPED';

export interface SkuMapping {
  id?: string;
  itemName: string;
  category: SkuCategory;
  segment?: string; 
  userId: string;
  updatedAt: number;
}

export interface PlatformItemMapping {
  id?: string;
  platformItemName: string;
  posItemName: string;
  userId: string;
  updatedAt: number;
}

export const MASTER_OUTLETS = [
  { id: '40543', name: 'Deer park B6',       code: 'B6'  },
  { id: '40186', name: 'New Friends Colony',  code: 'NFC' },
  { id: '40140', name: 'Safdarjung',          code: 'SFJ' },
  { id: 'GLOBAL', name: 'Global / Mixed',     code: 'GBL' },
];

export const getOutletName = (id: string) => {
  const outlet = MASTER_OUTLETS.find(o => o.id === id);
  return outlet ? outlet.name : id;
};

export const getOutletCode = (id: string) => {
  const outlet = MASTER_OUTLETS.find(o => o.id === id);
  return outlet?.code || id.slice(0, 4).toUpperCase();
};

// --- GLOBAL DATE CONFIGURATION ---
export const YEAR_OPTIONS = ['2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// --- DEFAULT CATEGORY MAPPINGS ---
export const DEFAULT_COGS = [
  'COGS', 'FOOD INGREDIENTS', 'INGREDIENT FOR FOOD', 'INGREDIENTS FOR FOOD', 'INGREDIENTS 4 FOOD', 'INGREDIENT 4 FOOD',
  'INGREDIENTS FOR DRINKS', 'INGREDIENT FOR DRINKS', 'INGREDIENT 4 DRINKS', 'SERVING FOR DRINKS', 'SERVINGS FOR DRINKS',
  'SERVINGS 4 DRINKS', 'SERVING 4 DRINKS', 'SERVING FOR FOOD', 'SERVINGS FOR FOOD', 'SERVING 4 FOOD', 'SERVINGS 4 FOOD',
  'DRINKS INGREDIENTS', 'BAKERY', 'RAW MATERIALS', 'RAW MATERIAL', 'KITCHEN CONSUMABLES', 'PACKAGING', 'PACKAGING MATERIAL'
];

export const DEFAULT_LABOUR = [
  'SALARIES', 'EMPLOYEE - STAFF MEALS', 'STAFF MEALS', 'SALARY', 'STAFF SALARY', 'STAFF SALARIES', 'EMPLOYEE SALARY',
  'LABOUR', 'WAGES', 'PAYROLL', 'STAFF PAYROLL', 'STAFF INCENTIVES', 'INCENTIVES', 'EMPLOYEES', 'EMPLOYEE ADVANCE', 'BONUS'
];

export const DEFAULT_OPS = [
  'OPERATIONS', 'RENTALS', 'RENT', 'MARKETING', 'UTILITIES', 'MAINTENANCE', 'REPAIRS', 'CLEANING', 'SOFTWARE', 'INTERNET', 'STATIONERY', 'TRAVEL',
  'MISC', 'ELECTRICITY', 'WATER', 'TRANSPORTATION & TRAVEL EXPENSE', 'PRINTING AND STATIONERY', 'OFFICE'
];

// --- CREW TERMINAL CATEGORIES (separate, curated list) ---
export const CREW_PURCHASE_CATEGORIES = [
  'BAKERY',
  'INGREDIENTS FOR DRINKS',
  'INGREDIENTS FOR FOOD',
  'SERVING FOR DRINKS',
  'SERVING FOR FOOD',
  'IROHA',
].sort();

export const CREW_EXPENSE_CATEGORIES = [
  'EMPLOYEE ADVANCE',
  'INTERNET & PHONE BILLS',
  'OPERATIONS - REPAIR & MAINTENANCE',
  'OPERATIONS - MARKETING',
  'OPERATIONS - GAS CYLINDER',
  'OPERATIONS - ELECTRICITY',
  'FIXED - RENTALS',
  'STAFF MEALS',
  'OPERATION- STORE EQUIPMENT',
  'OPERATIONS -TRANSPORTATION & TRAVEL EXPENSE',
  'WATER',
  'OPERATION - EMERGENCY MEDICINE',
].sort();

export type CogsBucket = 'FOOD' | 'DRINKS' | 'FOOD SERVINGS' | 'DRINKS SERVINGS' | 'UNCATEGORIZED';

export interface CategorySettings {
  cogsKeywords: string[];
  labourKeywords: string[];
  opsKeywords: string[];
  menuSegments?: string[];
  cogsBucketMapping?: Record<string, CogsBucket>;
  productCatalogEnabled?: boolean;
  trackedConsumables?: TrackedConsumable[];
}

export interface Product {
  id?: string;
  name: string;
  category: string;
  pricePerUnit?: number;
  quantity?: number;
  unit?: string;
  ownerId: string;
  userId: string;
  createdAt: number;
}

// Crew-added categories, merged with the hardcoded CREW_* lists in the terminal dropdowns
export interface CrewCategory {
  id?: string;
  name: string;
  ownerId: string;
  userId: string;
  createdAt: number;
}

export interface SalesAnalytics {
  id?: string;
  userId: string;
  month: string;
  year: string;
  totalRevenue: number;
  totalTax: number;
  totalCommission?: number;
  totalAdCharges?: number;
  orderCount: number;
  paidCount: number;
  unpaidCount: number;
  lastUpdated: number;
}

export interface SalaryHistory {
  date: string;
  amount: number;
  reason?: string;
}

export interface Employee {
  id?: string;
  name: string;
  outletId: string;
  joiningDate: string;
  baseSalary: number;
  currentSalary: number;
  history: SalaryHistory[];
  userId: string;
}

export interface MonthlyPayroll {
  id?: string;
  userId: string;
  outletId: string;
  month: string;
  year: string;
  totalAmount: number;
  isValidated: boolean;
  updatedAt: number;
}

export type StoreTier = 'TIER_1' | 'TIER_2';

export interface StoreRental {
  id?: string;
  outletId: string;
  storeName: string;
  baseRent: number;
  currentRent: number;
  startDate: string;
  status: 'active' | 'closed';
  closeDate?: string;
  tier: StoreTier; 
  history: RentalHistory[];
  userId: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface RentalHistory {
  date: string;
  amount: number;
  reason?: string;
}

export interface Holiday {
  id?: string;
  date: string;
  name: string;
  type: 'public' | 'regional' | 'custom';
  outletId?: string; // Optional: if it's specific to an outlet
  region?: string;   // e.g. "Delhi", "Maharashtra"
  userId: string;
  createdAt: number;
}

export interface SalesProjection {
  id?: string;
  outletId: string;
  userId: string;
  generatedAt: number;
  startDate: string;
  endDate: string;
  dailyProjections: {
    date: string;
    projectedRevenue: number;
    confidence: number;
    factors: string[]; // e.g. ["Holiday: Holi", "Weather: Rain"]
  }[];
  totalProjectedRevenue: number;
  aiInsights: string;
}

export interface WeatherForecast {
  date: string;
  temp: number;
  condition: string;
  icon: string;
  precipitation: number;
  humidity: number;
}

export interface WeatherData {
  id?: string;
  date: string;
  outletId: string;
  temp: number;
  condition: string;
  precipitation: number;
  humidity: number;
  windSpeed: number;
  icon?: string;
  userId: string;
  isForecast: boolean;
  updatedAt: number;
}

export interface CogsAdjustment {
  id?: string;
  userId: string;
  month: string;
  year: string;
  outletId: string;
  adjustmentAmount: number;
  foodServingsAdjustment?: number;
  drinkServingsAdjustment?: number;
  foodIngredientsAdjustment?: number;
  drinkIngredientsAdjustment?: number;
  // Opening stock carried over from the previous month's closing (all four buckets).
  // Optional + defaults to 0, so untouched records behave exactly as before.
  foodIngredientsOpening?: number;
  drinkIngredientsOpening?: number;
  foodServingsOpening?: number;
  drinkServingsOpening?: number;
  lastUpdated: number;
}

export interface SalesSummaryRecord {
  id?: string;
  date: string;
  time: string;
  orderId: string;
  refNo: string;
  billNo: string;
  outletName: string;
  outletId: string;
  orderStatus: string;
  totalTax: number;
  paymentMode: string;
  paymentStatus: string;
  revenue: number;
  onlinePlatform?: 'Zomato' | 'Swiggy' | 'None' | string;
  commission: number;
  adCharges: number;
  netPayout?: number;
  _fileId: string;
  userId: string;
}

export interface ItemSalesRecord {
  id?: string;
  date: string;
  time: string;
  billNo: string;
  orderId: string;
  refNo: string;
  outletName: string;
  orderStatus: string;
  paymentMode: string;
  totalTax: number;
  netPayable: number;
  netSales: number;
  ltItemId: string;
  itemName: string;
  itemQuantity: number;
  itemTotal: number;
  itemDiscount: number;
  itemTaxes: number;
  outletId: string;
  _fileId: string;
  userId: string;
  isPlatform?: boolean;
  platform?: string;
}

export interface ExpenseRecord {
  id?: string;
  billNo: string; 
  date: string;
  category: string;
  description: string;
  amount: number;
  outletId?: string;
  userId: string;
  _fileId: string;
}

export interface PurchaseRecord {
  id?: string;
  billNo: string;
  date: string;
  productName: string;
  amount: number;
  category: string;
  vendor?: string;
  outletId?: string;
  userId: string;
  _fileId: string;
  isBankVerified?: boolean;
  createdAt?: number;
}

export interface OnlineOrderDetail {
  id?: string;
  platform: string;
  orderId: string;
  orderDate: string;
  orderStatus: string;
  itemTotal: number;
  packagingCharge: number;
  totalTax: number;
  discount: number;
  commission: number;
  netPayout: number;
  settlementStatus: string;
  settlementDate: string;
  customerId: string;
  _fileId: string;
  userId: string;
  outletId: string;
}

export interface OnlineCustomer {
  id?: string;
  userId: string;
  customerId: string;
  name?: string;
  totalOrders: number;
  totalSpent: number;
  platforms: string[];
  lastOrderDate: string;
  lastOrderId: string;
  lastUpdated: number;
  tags?: string[];
}

export interface BankAccount {
  id?: string;
  name: string;
  balance: number;
  accountNumber?: string;
  bankName?: string;
  outletId?: string;
  accountType?: 'cash' | 'digital' | '10kcash';
  isPrimary?: boolean;
  userId: string;
  updatedAt: number;
}

export interface SalesLedgerEntry {
  id?: string;
  bankAccountId: string;
  bankAccountName: string;
  outletId: string;
  userId: string;   // submitter's UID (satisfies security rules)
  ownerId: string;  // admin's UID (used for admin reads)
  amount: number;
  channel: 'cash' | 'card' | 'upi' | 'digital';
  sourceId: string;
  description: string;
  date: string;
  createdAt: number;
}

export const SALES_TARGET_FIELDS = [
  { id: 'date', label: 'Date', required: true },
  { id: 'time', label: 'Time', required: false },
  { id: 'orderId', label: 'Order ID', required: true },
  { id: 'refNo', label: 'Reference Number', required: false },
  { id: 'billNo', label: 'Bill Number', required: false },
  { id: 'outletName', label: 'Outlet Name', required: false },
  { id: 'outletId', label: 'Outlet ID', required: false },
  { id: 'orderStatus', label: 'Order Status', required: true },
  { id: 'totalTax', label: 'Total Tax', required: true },
  { id: 'paymentMode', label: 'Payment Mode', required: false },
  { id: 'paymentStatus', label: 'Payment Status', required: true },
  { id: 'revenue', label: 'Revenue/Total', required: true },
  { id: 'onlinePlatform', label: 'Platform (Zomato/Swiggy)', required: false },
  { id: 'commission', label: 'Commission Paid', required: false },
  { id: 'adCharges', label: 'Ad/Marketing Charges', required: false },
];

export const ITEM_TARGET_FIELDS = [
  { id: 'date', label: 'Order Date', required: true },
  { id: 'time', label: 'Order Time', required: false },
  { id: 'billNo', label: 'Bill Number', required: false },
  { id: 'orderId', label: 'Order Id', required: true },
  { id: 'refNo', label: 'Reference Number', required: false },
  { id: 'outletName', label: 'Outlet Name', required: false },
  { id: 'outletId', label: 'Outlet ID', required: false },
  { id: 'orderStatus', label: 'Order Status', required: true },
  { id: 'paymentMode', label: 'Payment Mode', required: false },
  { id: 'totalTax', label: 'Total Tax', required: false },
  { id: 'netPayable', label: 'Net Payable', required: false },
  { id: 'netSales', label: 'Net Sales', required: false },
  { id: 'ltItemId', label: 'Lt Item Id', required: false },
  { id: 'itemName', label: 'Item Name', required: true },
  { id: 'itemQuantity', label: 'Item Quantity', required: true },
  { id: 'itemTotal', label: 'Item Total', required: true },
  { id: 'itemDiscount', label: 'Item Discount', required: false },
  { id: 'itemTaxes', label: 'Item Taxes', required: false },
];

// Zomato/Swiggy item exports report a per-unit "sell price" alongside a quantity
// and carry no line-total column, so revenue has to be derived as qty × sellPrice.
// Map sellPrice for those; map itemTotal only when the export genuinely has a
// line total. If both are mapped, itemTotal wins.
export const PLATFORM_ITEM_TARGET_FIELDS = [
  { id: 'itemName', label: 'Item Name', required: true },
  { id: 'itemQuantity', label: 'Item Quantity', required: true },
  { id: 'sellPrice', label: 'Unit Sell Price', required: false },
  { id: 'itemTotal', label: 'Item Total/Revenue (if line total)', required: false },
];

export const EXPENSE_TARGET_FIELDS = [
  { id: 'billNo', label: 'Expense Number', required: false },
  { id: 'date', label: 'Date', required: true },
  { id: 'category', label: 'Category', required: true },
  { id: 'description', label: 'Description', required: true },
  { id: 'amount', label: 'Amount', required: true },
  { id: 'outletId', label: 'Outlet ID', required: false },
];

export const PURCHASE_TARGET_FIELDS = [
  { id: 'billNo', label: 'Bill Number', required: false },
  { id: 'date', label: 'Date', required: true },
  { id: 'productName', label: 'Product Name', required: true },
  { id: 'amount', label: 'Amount', required: true },
  { id: 'category', label: 'Category', required: true },
  { id: 'outletId', label: 'Outlet ID', required: false },
];

export const ONLINE_ORDER_TARGET_FIELDS = [
  { id: 'platform', label: 'platform', required: true },
  { id: 'orderId', label: 'order_id', required: true },
  { id: 'orderDate', label: 'order_date', required: true },
  { id: 'orderTime', label: 'order_time', required: false },
  { id: 'orderStatus', label: 'order_status', required: true },
  { id: 'itemTotal', label: 'item_total', required: true },
  { id: 'packagingCharge', label: 'packaging_charge', required: false },
  { id: 'totalTax', label: 'total_tax', required: false },
  { id: 'discount', label: 'discount', required: false },
  { id: 'commission', label: 'commission', required: false },
  { id: 'gst_on_commission', label: 'gst_on_commission', required: false },
  { id: 'tds', label: 'tds', required: false },
  { id: 'netPayout', label: 'net_payout', required: true },
  { id: 'settlementStatus', label: 'settlement_status', required: false },
  { id: 'settlementDate', label: 'settlement_date', required: false },
  { id: 'customerId', label: 'customer_id', required: false },
];

export const CUSTOMER_NAME_MAPPING_TARGET_FIELDS = [
  { id: 'orderId', label: 'Order ID', required: true },
  { id: 'customerName', label: 'Customer Name', required: true },
];

export interface BankTransaction {
  id?: string;
  userId: string;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  referenceNo: string;
  balance?: number;
  bankAccountId?: string;
  isReconciled: boolean;
  matchedPurchaseId?: string; // Legacy
  matchedPurchaseIds?: string[]; // Legacy
  reconciledAmount?: number; // Legacy
  category?: string;
  isVerified?: boolean;
  pushedToPurchases?: boolean; // True when this transaction was used to create a new purchase record
  comment?: string;
  createdAt: number;
}

export interface CategorizationRule {
  id?: string;
  keyword: string;
  category: string;
  userId: string;
  usageCount: number;
  lastUsedAt: number;
}

export interface LoanProfile {
  id?: string;
  userId: string;
  name: string;
  category: 'LOAN_EMI' | 'INTEREST_ONLY' | 'CAPEX_REPAYMENT' | 'CREDIT CARD PAYMENT' | 'PERSONAL';
  description?: string;
  isActive: boolean;
  createdAt: number;
}

export interface CashFlowSnapshot {
  id?: string;
  userId: string;
  month: string;
  year: string;
  netProfit: number;
  loanEmi: number;
  interestOnlyLoan: number;
  capexRepayment: number;
  realCashLeft: number;
  mappings?: Record<string, string>; // transactionId -> loanProfileId
  updatedAt: number;
}

// A debt repayment made in cash (e.g. paying a lender from a store's 10k access
// bank) that never appears in a bank statement import. Surfaced in Cash Reality
// alongside bank-sourced obligations; deducts from the source 10k bank balance.
export interface CashObligation {
  id?: string;
  userId: string;
  date: string;                       // YYYY-MM-DD (IST)
  amount: number;
  category: LoanProfile['category'];  // inherited from the mapped lender
  loanProfileId: string;              // the lender being repaid
  bankAccountId: string;              // source 10k access bank
  bankTxnId?: string;                 // linked bank_transactions ledger line (for history + cleanup)
  outletId?: string;                  // store the 10k bank belongs to
  description?: string;
  createdAt: number;
}

export const RECONCILIATION_CATEGORIES = [
  'COGS',
  'OPERATIONS',
  'RENT',
  'PAYROLL',
  'LOAN_EMI',
  'PERSONAL',
  'OTHER'
];

export const BANK_STATEMENT_TARGET_FIELDS = [
  { id: 'date', label: 'Date', required: true },
  { id: 'description', label: 'Description/Narration', required: true },
  { id: 'debit_amount', label: 'Withdrawal/Debit Amount', required: false },
  { id: 'credit_amount', label: 'Deposit/Credit Amount', required: false },
  { id: 'balance', label: 'Balance', required: false },
  { id: 'referenceNo', label: 'Ref/UTR Number', required: false },
];

// ---------------------------------------------------------------------------
// IST date helpers — all business dates in this app are Indian Standard Time.
// Never use `new Date().toISOString()` directly for a "today"-style default:
// UTC lags IST by 5h30m, so evenings/mornings shift the date by one day.
// ---------------------------------------------------------------------------

/** Date object shifted so its UTC fields read as IST wall-clock time. */
export const istNow = (): Date => new Date(Date.now() + 5.5 * 60 * 60 * 1000);

/** YYYY-MM-DD in IST, offset by the given number of days (0 = today). */
export const istDateString = (offsetDays = 0): string => {
  const d = new Date(Date.now() + (5.5 * 60 * 60 + offsetDays * 24 * 60 * 60) * 1000);
  return d.toISOString().split('T')[0];
};
