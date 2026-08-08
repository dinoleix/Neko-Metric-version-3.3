
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, writeBatch, doc, setDoc, getDoc, increment, arrayUnion } from 'firebase/firestore';
import { db } from '../firebase';
import { getCachedCollection } from '../referenceCache';
import { 
  FileMetadata, 
  SalesMonthlySnapshot, 
  SalesSummaryRecord,
  ExpenseRecord,
  PurchaseRecord,
  DailyCounterEntry,
  ExpenseMonthlySnapshot,
  ItemMonthlySnapshot,
  ItemSalesRecord,
  DEFAULT_COGS,
  CogsBucket,
  getOutletName,
  MASTER_OUTLETS,
  FileType,
  PlatformItemMapping,
  EventRecord,
  YEAR_OPTIONS,
  MONTH_NAMES as MONTHS,
  StoreRental,
  ItemCost,
  SkuMapping
} from '../types';
import { 
  Database, 
  Layers, 
  ShieldCheck, 
  CheckCircle2, 
  Circle,
  ShoppingBag,
  ArrowRightLeft,
  Smartphone,
  ShoppingCart,
  Wrench,
  Loader2,
  AlertTriangle,
  RefreshCw,
  History,
  TrendingUp,
  ReceiptIndianRupee,
  ChevronDown,
  ChevronRight,
  Filter,
  Activity,
  FileSearch,
  Zap,
  Box,
  Trash2,
  ArrowRight
} from 'lucide-react';

const parseIndianTime = (timeStr: string): number => {
  if (!timeStr) return 0;
  let clean = timeStr.trim().toUpperCase();
  
  // If it's a full ISO string or has a space, try to find the part with a colon
  if (clean.includes(' ') || clean.includes('T')) {
    const parts = clean.split(/[ T]/);
    const timePart = parts.find(p => p.includes(':'));
    if (timePart) {
      clean = timePart + (clean.includes('PM') ? ' PM' : (clean.includes('AM') ? ' AM' : ''));
    }
  }
  
  const isPM = clean.includes('PM');
  const isAM = clean.includes('AM');
  const digitsOnly = clean.replace(/[^0-9:]/g, '');
  const segments = digitsOnly.split(':');
  let hour = parseInt(segments[0], 10);
  if (isNaN(hour)) return 0;
  if (isPM && hour < 12) hour += 12;
  if (isAM && hour === 12) hour = 0;
  return hour % 24;
};

// GLOBAL CONSTANT FOR CONSISTENCY
const GLOBAL_ID = 'GLOBAL';

type CatalogTab = 'heatmap' | 'audit';

const DataCatalog: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [activeTab, setActiveTab] = useState<CatalogTab>('audit');
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [expenseSnaps, setExpenseSnaps] = useState<ExpenseMonthlySnapshot[]>([]);
  const [itemSnaps, setItemSnaps] = useState<ItemMonthlySnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [rebuildStatus, setRebuildStatus] = useState<{current: number, total: number} | null>(null);
  const [syncingNode, setSyncingNode] = useState<string | null>(null);

  const fetchCatalog = async () => {
    setLoading(true);
    try {
      const constraints = [where('userId', '==', dataOwnerId)];
      const [fSnap, sSnap, eSnap, iSnap] = await Promise.all([
        getDocs(query(collection(db, 'files'), ...constraints)),
        getDocs(query(collection(db, 'sales_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'expense_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'item_snapshots'), ...constraints))
      ]);
      
      setFiles(fSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FileMetadata)));
      setSalesSnaps(sSnap.docs.map(doc => doc.data() as SalesMonthlySnapshot));
      setExpenseSnaps(eSnap.docs.map(doc => doc.data() as ExpenseMonthlySnapshot));
      setItemSnaps(iSnap.docs.map(doc => doc.data() as ItemMonthlySnapshot));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCatalog(); }, [user]);

  const syncSlice = async (year: string, month: string, outletId: string) => {
    const nodeId = `${year}_${month}_${outletId}`;
    setSyncingNode(nodeId);
    const isGlobal = outletId === GLOBAL_ID || outletId === 'Global / Mixed' || outletId === 'MIXED';
    
    try {
      const baseConstraints = [where('userId', '==', dataOwnerId)];
      const constraints = isGlobal ? baseConstraints : [...baseConstraints, where('outletId', '==', outletId)];

      const settingsRef = doc(db, 'category_settings', dataOwnerId);
      const [setSnap, aliasArr, costsArr, rentArr, skuArr] = await Promise.all([
        getDoc(settingsRef),
        getCachedCollection('platform_item_mappings', dataOwnerId),
        getCachedCollection<ItemCost>('item_costs', dataOwnerId),
        getCachedCollection<StoreRental>('rentals', dataOwnerId),
        getCachedCollection<SkuMapping>('sku_mappings', dataOwnerId)
      ]);

      let cogsKeywords = DEFAULT_COGS;
      let cogsBucketMapping: Record<string, CogsBucket> = {};
      if (setSnap.exists()) {
        const d = setSnap.data();
        if (d.cogsKeywords) cogsKeywords = d.cogsKeywords;
        if (d.cogsBucketMapping) cogsBucketMapping = d.cogsBucketMapping;
      }

      const aliasMap: Record<string, string> = {};
      aliasArr.forEach((data: PlatformItemMapping) => {
        aliasMap[data.platformItemName] = data.posItemName;
      });

      const rentals = rentArr;
      const itemCosts = costsArr;
      const skuMappings = skuArr;

      // Month range applied server-side so each slice only reads its own records
      // (previously every slice fetched the full history of all six collections).
      // online_order_details is excluded: its records mix orderDate/date fields,
      // so a server-side range would silently drop rows — the client-side month
      // filter below still handles it.
      const mm = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
      const dateRange = [where('date', '>=', `${year}-${mm}-01`), where('date', '<=', `${year}-${mm}-31`)];

      // crew_entries is keyed on ownerId (CSV collections use userId) and is the
      // source of the crew_* half of expense_snapshots. Sync recomputes BOTH halves
      // so the snapshot write below can own the whole document — previously it
      // rebuilt only the CSV half and then overwrote the doc, wiping crew data.
      const crewConstraints = isGlobal
        ? [where('ownerId', '==', dataOwnerId)]
        : [where('ownerId', '==', dataOwnerId), where('outletId', '==', outletId)];

      const [sSnap, eSnap, pSnap, iSnap, evSnap, oSnap, cSnap] = await Promise.all([
        getDocs(query(collection(db, 'sales_summary'), ...constraints, ...dateRange)),
        getDocs(query(collection(db, 'expenses'), ...constraints, ...dateRange)),
        getDocs(query(collection(db, 'purchases'), ...constraints, ...dateRange)),
        getDocs(query(collection(db, 'item_sales'), ...constraints, ...dateRange)),
        getDocs(query(collection(db, 'events'), ...constraints, ...dateRange)),
        getDocs(query(collection(db, 'online_order_details'), ...constraints)),
        getDocs(query(collection(db, 'crew_entries'), ...crewConstraints, ...dateRange))
      ]);

      const filterByPeriod = (r: any) => {
        if (!r.date) return false;
        const parts = r.date.split('-');
        if (parts.length < 3) return false;
        const rYear = parts[0];
        const rMonthIdx = parseInt(parts[1]) - 1;
        return rYear === year && MONTHS[rMonthIdx] === month;
      };

      const sliceSales = sSnap.docs.map(d => d.data() as SalesSummaryRecord).filter(filterByPeriod);
      const sliceExpenses = eSnap.docs.map(d => d.data() as ExpenseRecord).filter(filterByPeriod);
      const slicePurchases = pSnap.docs.map(d => d.data() as PurchaseRecord).filter(filterByPeriod);
      const sliceItems = iSnap.docs.map(d => d.data() as ItemSalesRecord).filter(filterByPeriod);
      const sliceEvents = evSnap.docs.map(d => d.data() as EventRecord).filter(filterByPeriod);
      // Only 'paid' entries feed reporting — mirrors rebuildExpenseSnapshot in CrewTerminal
      const sliceCrew = cSnap.docs
        .map(d => d.data() as DailyCounterEntry)
        .filter(r => filterByPeriod(r) && r.status === 'paid');
      const sliceOnline = oSnap.docs.map(d => d.data() as any).filter(r => {
        const dStr = r.orderDate || r.date;
        if (!dStr) return false;
        const parts = dStr.split('-');
        if (parts.length < 3) return false;
        const rYear = parts[0];
        const rMonthIdx = parseInt(parts[1]) - 1;
        return rYear === year && MONTHS[rMonthIdx] === month;
      });

      const outletsFound = new Set<string>();
      if (isGlobal) {
        sliceSales.forEach(r => outletsFound.add(r.outletId || 'Unassigned'));
        sliceExpenses.forEach(r => outletsFound.add(r.outletId || 'Unassigned'));
        slicePurchases.forEach(r => outletsFound.add(r.outletId || 'Unassigned'));
        sliceItems.forEach(r => outletsFound.add(r.outletId || 'Unassigned'));
        sliceEvents.forEach(r => outletsFound.add(r.outletId || 'Unassigned'));
        sliceOnline.forEach(r => outletsFound.add(r.outletId || 'Unassigned'));
        sliceCrew.forEach(r => outletsFound.add(r.outletId || 'Unassigned'));
      } else {
        outletsFound.add(outletId);
      }

      // Pre-calculate unified price map for potential revenue calculations
      const itemPrices: Record<string, { total: number, qty: number }> = {};
      sliceItems.forEach(r => {
        if (r.orderStatus === 'CANCELLED') return;
        const masterName = (aliasMap[r.itemName] || r.itemName).trim().toUpperCase();
        if (!itemPrices[masterName]) itemPrices[masterName] = { total: 0, qty: 0 };
        itemPrices[masterName].total += (r.itemTotal || 0);
        itemPrices[masterName].qty += (r.itemQuantity || 0);
      });

      const batch = writeBatch(db);

      for (const oId of outletsFound) {
        const outletSales = sliceSales.filter(s => (s.outletId || 'Unassigned') === oId);
        const outletExpenses = sliceExpenses.filter(e => (e.outletId || 'Unassigned') === oId);
        const outletPurchases = slicePurchases.filter(p => (p.outletId || 'Unassigned') === oId);
        const outletItems = sliceItems.filter(i => (i.outletId || 'Unassigned') === oId);
        const outletEvents = sliceEvents.filter(e => (e.outletId || 'Unassigned') === oId);
        const outletOnline = sliceOnline.filter(o => (o.outletId || 'Unassigned') === oId);
        const outletCrew = sliceCrew.filter(c => (c.outletId || 'Unassigned') === oId);

        const rental = rentals.find(r => r.outletId === oId);
        const tier = rental?.tier || 'TIER_1';

        // 1. Sales Snapshot
        if (outletSales.length > 0 || outletEvents.length > 0) {
          const agg: SalesMonthlySnapshot = {
            userId: dataOwnerId, outletId: oId, month, year,
            posTotalGross: 0, posGoodGross: 0, posGoodNet: 0, posGoodTax: 0,
            onlineGoodGross: 0, onlineGoodNet: 0, onlineGoodTax: 0, onlineGoodComm: 0, onlineGoodAds: 0,
            onlineGoodGstOnComm: 0, onlineGoodTds: 0,
            eventRevenue: 0,
            settledOrderCount: 0, onlineOrderCount: 0, totalOrderCount: 0, cancelledOrderCount: 0, 
            platformBreakdown: {} as Record<string, any>,
            dailyTrend: new Array(31).fill(0), 
            hourlyDistribution: new Array(24).fill(0),
            onlineHourlyDistribution: new Array(24).fill(0),
            onlineOrderHourlyDistribution: new Array(24).fill(0),
            onlineWeekdayDistribution: new Array(7).fill(0),
            lastUpdated: Date.now()
          };
          const customerAggs: Record<string, { totalOrders: number, totalSpent: number, platforms: Set<string>, lastOrderDate: string, lastOrderId: string }> = {};

          outletSales.forEach(r => {
            const rev = Number(r.revenue || 0);
            const tax = Number(r.totalTax || 0);
            const comm = Number(r.commission || 0);
            const ads = Number(r.adCharges || 0);
            const status = (r.orderStatus || '').toUpperCase();
            const isSettled = status === 'SETTLED' || status === 'PICKEDUP' || status === 'DELIVERED';
            const isOnline = r.onlinePlatform && r.onlinePlatform.toLowerCase() !== 'none';
            const dateParts = r.date.split('-');
            const dayIdx = parseInt(dateParts[2]) - 1;
            
            // Try to extract time from date if time is missing
            const rawTime = r.time || (r.date.includes(':') ? r.date : '00:00');
            const hour = parseIndianTime(rawTime);
            
            if (!isOnline) {
              agg.totalOrderCount++;
              if (status === 'CANCELLED') agg.cancelledOrderCount++;
              agg.posTotalGross += rev;
              if (isSettled) {
                agg.posGoodGross += rev; agg.posGoodTax += tax; agg.posGoodNet += (rev - tax); agg.settledOrderCount++;
                if (dayIdx >= 0 && dayIdx < 31) agg.dailyTrend[dayIdx] += rev;
                agg.hourlyDistribution[hour] += rev;
              }
            } else {
              agg.onlineOrderCount++;
              const plat = (r.onlinePlatform || 'UNKNOWN').toUpperCase();
              if (!agg.platformBreakdown[plat]) agg.platformBreakdown[plat] = { gross: 0, net: 0, tax: 0, commission: 0, ads: 0, gstOnComm: 0, tds: 0, orders: 0 };
              agg.platformBreakdown[plat].orders++;

              if (isSettled) {
                const netVal = Math.max(0, rev - tax - comm - ads);
                agg.onlineGoodGross += rev; 
                agg.onlineGoodTax += tax; 
                agg.onlineGoodComm += comm; 
                agg.onlineGoodAds += ads; 
                agg.onlineGoodNet += netVal;

                agg.platformBreakdown[plat].gross += rev;
                agg.platformBreakdown[plat].net += netVal;
                agg.platformBreakdown[plat].tax += tax;
                agg.platformBreakdown[plat].commission += comm;
                agg.platformBreakdown[plat].ads += ads;

                if (dayIdx >= 0 && dayIdx < 31) agg.dailyTrend[dayIdx] += rev;
                agg.hourlyDistribution[hour] += rev;
                if (agg.onlineHourlyDistribution) agg.onlineHourlyDistribution[hour] += rev;
                if (agg.onlineOrderHourlyDistribution) agg.onlineOrderHourlyDistribution[hour]++;
                
                const wDay = new Date(parseInt(year), MONTHS.indexOf(month), dayIdx + 1).getDay();
                if (agg.onlineWeekdayDistribution) agg.onlineWeekdayDistribution[wDay] += rev;
              }
            }
          });

          outletOnline.forEach(r => {
            const rev = Number(r.itemTotal || 0);
            const tax = Number(r.totalTax || 0);
            const comm = Number(r.commission || 0);
            const gstOnComm = Number(r.gst_on_commission || 0);
            const tds = Number(r.tds || 0);
            const payout = Number(r.netPayout || 0);
            const status = (r.orderStatus || '').toUpperCase();
            const isSettled = status === 'SETTLED' || status === 'DELIVERED' || status === 'PICKEDUP';
            const customerId = (r.customerId || '').toString().trim();
            const dateStr = r.orderDate || r.date;
            const orderId = (r.orderId || '').toString().trim();
            
            const plat = (r.platform || 'UNKNOWN').toUpperCase();

            // Customer Aggregation
            if (customerId && isSettled) {
              if (!customerAggs[customerId]) {
                customerAggs[customerId] = { totalOrders: 0, totalSpent: 0, platforms: new Set(), lastOrderDate: dateStr, lastOrderId: orderId };
              }
              const c = customerAggs[customerId];
              c.totalOrders++;
              c.totalSpent += rev;
              c.platforms.add(plat);
              if (new Date(dateStr) > new Date(c.lastOrderDate)) {
                c.lastOrderDate = dateStr;
                c.lastOrderId = orderId;
              }
            }

            if (!agg.platformBreakdown[plat]) agg.platformBreakdown[plat] = { gross: 0, net: 0, tax: 0, commission: 0, ads: 0, gstOnComm: 0, tds: 0, orders: 0 };

            agg.totalOrderCount++;
            agg.onlineOrderCount++;
            agg.platformBreakdown[plat].orders++;
            if (status === 'CANCELLED') agg.cancelledOrderCount++;
            
            if (isSettled) {
              agg.onlineGoodGross += rev;
              agg.onlineGoodTax += tax;
              agg.onlineGoodComm += comm;
              agg.onlineGoodGstOnComm += gstOnComm;
              agg.onlineGoodTds += tds;
              agg.onlineGoodNet += payout;
              
              agg.platformBreakdown[plat].gross += rev;
              agg.platformBreakdown[plat].net += payout;
              agg.platformBreakdown[plat].tax += tax;
              agg.platformBreakdown[plat].commission += comm;
              agg.platformBreakdown[plat].gstOnComm += gstOnComm;
              agg.platformBreakdown[plat].tds += tds;

              agg.settledOrderCount++;
              
              const dStr = r.orderDate || r.date;
              const dateParts = dStr.split('-');
              const dayIdx = parseInt(dateParts[2]) - 1;
              if (dayIdx >= 0 && dayIdx < 31) agg.dailyTrend[dayIdx] += rev;
              
              // Try to extract time from date if time is missing
              const rawTime = r.orderTime || r.time || (dStr.includes(':') ? dStr : '00:00');
              const hour = parseIndianTime(rawTime);
              
              if (agg.onlineHourlyDistribution) agg.onlineHourlyDistribution[hour] += rev;
              if (agg.onlineOrderHourlyDistribution) agg.onlineOrderHourlyDistribution[hour]++;
              agg.hourlyDistribution[hour] += rev;

              const wDay = new Date(parseInt(year), MONTHS.indexOf(month), dayIdx + 1).getDay();
              if (agg.onlineWeekdayDistribution) agg.onlineWeekdayDistribution[wDay] += rev;
            }
          });

          outletEvents.forEach(e => { agg.eventRevenue += (e.revenue || 0); });
          batch.set(doc(db, 'sales_snapshots', `${dataOwnerId}_${oId}_${year}_${month}`), agg);

          // Save Customers
          for (const [cId, data] of Object.entries(customerAggs)) {
            const cRef = doc(db, 'online_customers', `${dataOwnerId}_${cId}`);
            batch.set(cRef, {
              userId: dataOwnerId,
              customerId: cId,
              totalOrders: increment(data.totalOrders),
              totalSpent: increment(data.totalSpent),
              platforms: arrayUnion(...Array.from(data.platforms)),
              lastOrderDate: data.lastOrderDate,
              lastOrderId: data.lastOrderId,
              lastUpdated: Date.now()
            }, { merge: true });
          }
        }

        // 2. Expense/Purchase Snapshot — rebuilds the CSV half (total*/…ByCategory)
        // AND the Crew Terminal half (crew*) so the full-document write below is safe.
        if (outletExpenses.length > 0 || outletPurchases.length > 0 || outletCrew.length > 0) {
          const agg: ExpenseMonthlySnapshot = {
            userId: dataOwnerId, outletId: oId, month, year, totalExpense: 0, totalPurchase: 0,
            expenseByCategory: {}, purchaseByCategory: {},
            cogsBucketAgg: { 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 },
            crewTotalExpense: 0, crewTotalPurchase: 0,
            crewExpenseByCategory: {}, crewPurchaseByCategory: {},
            crewCogsBucketAgg: { 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 },
            crewLastUpdated: Date.now(),
            lastUpdated: Date.now()
          };
          outletExpenses.forEach(e => {
            const amt = Number(e.amount || 0);
            const cat = (e.category || 'UNCATEGORIZED').toUpperCase();
            agg.totalExpense += amt;
            agg.expenseByCategory[cat] = (agg.expenseByCategory[cat] || 0) + amt;
            if (cogsKeywords.includes(cat)) {
              const bucket = cogsBucketMapping[cat] || 'FOOD';
              agg.cogsBucketAgg[bucket] = (agg.cogsBucketAgg[bucket] || 0) + amt;
            }
          });
          outletPurchases.forEach(p => {
            const amt = Number(p.amount || 0);
            const cat = (p.category || 'UNCATEGORIZED').toUpperCase();
            agg.totalPurchase += amt;
            agg.purchaseByCategory[cat] = (agg.purchaseByCategory[cat] || 0) + amt;
            if (cogsKeywords.includes(cat)) {
              const bucket = cogsBucketMapping[cat] || 'FOOD';
              agg.cogsBucketAgg[bucket] = (agg.cogsBucketAgg[bucket] || 0) + amt;
            }
          });
          // Crew Terminal entries — aggregated into the crew_* namespace exactly as
          // rebuildExpenseSnapshot (CrewTerminal.tsx) does, so both writers agree.
          outletCrew.forEach(c => {
            const amt = Number(c.amount || 0);
            const cat = (c.category || 'UNCATEGORIZED').trim().toUpperCase();
            if (c.type === 'purchase') {
              agg.crewTotalPurchase! += amt;
              agg.crewPurchaseByCategory![cat] = (agg.crewPurchaseByCategory![cat] || 0) + amt;
            } else {
              agg.crewTotalExpense! += amt;
              agg.crewExpenseByCategory![cat] = (agg.crewExpenseByCategory![cat] || 0) + amt;
            }
            const bucket = cogsKeywords.includes(cat) ? (cogsBucketMapping[cat] || 'FOOD') : 'UNCATEGORIZED';
            agg.crewCogsBucketAgg![bucket] = (agg.crewCogsBucketAgg![bucket] || 0) + amt;
          });

          batch.set(doc(db, 'expense_snapshots', `${dataOwnerId}_${oId}_${year}_${month}`), agg);
        }

        // 3. Item Snapshot
        if (outletItems.length > 0) {
          const agg: ItemMonthlySnapshot = { userId: dataOwnerId, outletId: oId, month, year, items: {}, combos: [], lastUpdated: Date.now() };
          
          // Order Tracking for Combos
          const orderGroups: Record<string, { items: Set<string>, revenue: number }> = {};

          outletItems.forEach(r => {
            const posNameClean = (r.itemName || 'UNKNOWN').trim().toUpperCase();
            let name = aliasMap[posNameClean] || posNameClean;
            const qty = Number(r.itemQuantity || 0);
            const total = Number(r.itemTotal || 0);
            const dateParts = r.date.split('-');
            const dayIdx = parseInt(dateParts[2]) - 1;
            const isNc = (r.billNo || '').startsWith('NC-');
            
            if (!agg.items[name]) {
              agg.items[name] = { 
                quantity: 0, 
                posQuantity: 0, 
                onlineQuantity: 0, 
                revenue: 0, 
                dailyTrend: new Array(31).fill(0), 
                staffQuantity: 0, 
                staffTheoreticalCost: 0, 
                staffPotentialRevenue: 0,
                platformBreakdown: {} as Record<string, any>
              };
            }
            
            const item = agg.items[name];
            
            if (isNc) {
              item.staffQuantity = (item.staffQuantity || 0) + qty;
              const price = itemPrices[name] ? itemPrices[name].total / itemPrices[name].qty : 0;
              item.staffPotentialRevenue = (item.staffPotentialRevenue || 0) + (qty * price);
              
              const costRec = itemCosts.find(c => (c.itemName || '').toUpperCase() === name);
              const ingCost = costRec ? (Number(costRec.costPerUnit) || 0) : 0;
              const servCost = costRec ? (tier === 'TIER_1' ? (costRec.tier1ServingsCost ?? costRec.servingsCostPerUnit ?? 0) : (costRec.tier2ServingsCost ?? costRec.servingsCostPerUnit ?? 0)) : 0;
              item.staffTheoreticalCost = (item.staffTheoreticalCost || 0) + (qty * (ingCost + servCost));
            } else {
              item.quantity += qty;
              if (r.isPlatform) {
                item.onlineQuantity = (item.onlineQuantity || 0) + qty;
                const plat = (r.platform || 'UNKNOWN').toUpperCase();
                if (!item.platformBreakdown[plat]) item.platformBreakdown[plat] = { quantity: 0, revenue: 0 };
                item.platformBreakdown[plat].quantity += qty;
                item.platformBreakdown[plat].revenue += total;
              }
              else item.posQuantity = (item.posQuantity || 0) + qty;
              item.revenue += total;
              if (dayIdx >= 0 && dayIdx < 31) item.dailyTrend[dayIdx] += qty;

              // Combo Logic: Group items by Order ID, filtering out EXTRAS segment
              if (r.orderStatus !== 'CANCELLED' && r.orderId) {
                 if (!orderGroups[r.orderId]) orderGroups[r.orderId] = { items: new Set(), revenue: 0 };
                 const mapping = skuMappings.find(m => m.itemName.trim().toUpperCase() === name.trim().toUpperCase());
                 if (mapping?.segment !== 'EXTRAS') {
                    orderGroups[r.orderId].items.add(name);
                 }
                 orderGroups[r.orderId].revenue += total;
              }
            }
          });

          // Aggregate Combos
          const comboFrequencies: Record<string, { count: number, totalRevenue: number, names: string[] }> = {};
          Object.values(orderGroups).forEach(order => {
             if (order.items.size < 2) return;
             const sortedNames = Array.from(order.items).sort();
             const comboKey = sortedNames.join(' +++ ');
             if (!comboFrequencies[comboKey]) {
                comboFrequencies[comboKey] = { count: 0, totalRevenue: 0, names: sortedNames };
             }
             comboFrequencies[comboKey].count++;
             comboFrequencies[comboKey].totalRevenue += order.revenue;
          });

          agg.combos = Object.values(comboFrequencies)
            .sort((a, b) => b.count - a.count)
            .slice(0, 30)
            .map(c => ({ items: c.names, count: c.count, totalRevenue: c.totalRevenue }));

          batch.set(doc(db, 'item_snapshots', `${dataOwnerId}_${oId}_${year}_${month}`), agg);
        }
      }

      await batch.commit();
      await fetchCatalog();
    } catch (err) {
      console.error(err);
      alert("Aggregation failed.");
    } finally {
      setSyncingNode(null);
    }
  };

  const handleRebuildSnapshots = async () => {
    if (!confirm("This will re-calculate all records in your history. Proceed?")) return;
    setIsRebuilding(true);
    setRebuildStatus({ current: 0, total: 100 });
    try {
      await fetchCatalog();
      alert("System rebuild triggered.");
    } catch (err) { alert("Rebuild failed."); } finally { setIsRebuilding(false); setRebuildStatus(null); }
  };

  const coverageMatrix = useMemo(() => {
    const matrix: Record<string, Record<string, Set<string>>> = {};
    YEAR_OPTIONS.forEach(y => {
      matrix[y] = {};
      MONTHS.forEach(m => { matrix[y][m] = new Set(); });
    });
    files.forEach(f => {
      if (matrix[f.year] && matrix[f.year][f.month]) matrix[f.year][f.month].add(f.type);
    });
    return matrix;
  }, [files]);

  const auditRegistry = useMemo(() => {
    const registry: Record<string, any> = {};

    const normalizeOutlet = (oid: string) => {
      if (!oid || oid === 'Global / Mixed' || oid === 'MIXED') return GLOBAL_ID;
      return oid;
    };

    const ensureNode = (year: string, month: string, outletId: string) => {
      const normalizedId = normalizeOutlet(outletId);
      const key = `${year}_${month}_${normalizedId}`;
      if (!registry[key]) {
        registry[key] = {
          year, month, outletId: normalizedId,
          expected: new Set<FileType>(),
          actual: new Set<FileType>(),
          isSynced: false
        };
      }
      return key;
    };

    files.forEach(f => {
      const oId = normalizeOutlet(f.outletId || GLOBAL_ID);
      const key = ensureNode(f.year, f.month, oId);
      registry[key].expected.add(f.type);
    });

    const markActual = (year: string, month: string, outletId: string, types: FileType[]) => {
      const specificId = normalizeOutlet(outletId);
      const specificKey = `${year}_${month}_${specificId}`;
      const globalKey = `${year}_${month}_${GLOBAL_ID}`;
      
      types.forEach(type => {
        if (registry[specificKey]) registry[specificKey].actual.add(type);
        if (registry[globalKey]) registry[globalKey].actual.add(type);
      });
    };

    salesSnaps.forEach(s => markActual(s.year, s.month, s.outletId, ['sales']));
    expenseSnaps.forEach(e => markActual(e.year, e.month, e.outletId, ['expense', 'purchase']));
    itemSnaps.forEach(i => markActual(i.year, i.month, i.outletId, ['item', 'platform_item']));

    Object.values(registry).forEach((node: any) => {
      node.isSynced = Array.from(node.expected).every((type: any) => node.actual.has(type));
    });

    return Object.values(registry).sort((a: any, b: any) => {
      if (a.year !== b.year) return b.year.localeCompare(a.year);
      // FIX: Ensure MONTHS alias is available and robustly retrieved
      const idxA = a.month ? MONTHS.indexOf(a.month) : 0;
      const idxB = b.month ? MONTHS.indexOf(b.month) : 0;
      return idxB - idxA;
    });
  }, [files, salesSnaps, expenseSnaps, itemSnaps]);

  const stats = useMemo(() => {
    return {
      salesCount: files.filter(f => f.type === 'sales').reduce((acc, f) => acc + f.recordCount, 0),
      itemCount: files.filter(f => f.type === 'item' || f.type === 'platform_item').reduce((acc, f) => acc + f.recordCount, 0),
      expenseCount: files.filter(f => f.type === 'expense').reduce((acc, f) => acc + f.recordCount, 0),
      purchaseCount: files.filter(f => f.type === 'purchase').reduce((acc, f) => acc + f.recordCount, 0),
      totalDatasets: files.length
    };
  }, [files]);

  return (
    <div className="space-y-12 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <Database size={24} />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Data Catalog</h2>
          </div>
          <p className="text-slate-500 font-medium">Visual inventory and aggregation management center.</p>
        </div>

        <div className="flex bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner">
           <button onClick={() => setActiveTab('audit')} className={`px-8 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'audit' ? 'bg-white text-indigo-600 shadow-lg' : 'text-slate-50'}`}>System Audit</button>
           <button onClick={() => setActiveTab('heatmap')} className={`px-8 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'heatmap' ? 'bg-white text-indigo-600 shadow-lg' : 'text-slate-50'}`}>Heatmap</button>
        </div>
      </header>

      {isRebuilding && (
        <div className="p-8 bg-indigo-900 rounded-[2.5rem] text-white shadow-2xl animate-pulse">
           <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-white/10 rounded-2xl"><History size={32} className="text-indigo-300" /></div>
              <div><h3 className="text-xl font-black uppercase tracking-tight">Intelligence Re-Indexing</h3><p className="text-indigo-300 text-sm">Processing historical ledgers...</p></div>
           </div>
           <div className="h-4 bg-white/10 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-400 transition-all duration-500" style={{ width: rebuildStatus ? `${Math.round((rebuildStatus.current / rebuildStatus.total) * 100)}%` : '10%' }} />
           </div>
        </div>
      )}

      {activeTab === 'audit' ? (
        <section className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
           <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><ShieldCheck size={24}/></div>
                 <div>
                    <h3 className="text-xl font-black text-slate-900 tracking-tight">Aggregation Registry</h3>
                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Verify raw data ingestion vs system snapshots</p>
                 </div>
              </div>
              <button 
                onClick={handleRebuildSnapshots}
                disabled={isRebuilding}
                className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-600 transition-all shadow-xl shadow-slate-200"
              >
                {isRebuilding ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                Full Snapshot Rebuild
              </button>
           </div>

           <div className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden">
              <table className="w-full text-left">
                 <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                       <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Target Node (Month / Outlet)</th>
                       <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Expected Types</th>
                       <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Aggregation Status</th>
                       <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-slate-50">
                    {loading ? (
                       <tr><td colSpan={4} className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-indigo-600" /></td></tr>
                    ) : auditRegistry.length === 0 ? (
                       <tr><td colSpan={4} className="py-20 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">No data available for auditing</td></tr>
                    ) : auditRegistry.map((node: any) => {
                       const nodeId = `${node.year}_${node.month}_${node.outletId}`;
                       const isSyncing = syncingNode === nodeId;
                       const isGlobal = node.outletId === GLOBAL_ID;
                       return (
                          <tr key={nodeId} className="group hover:bg-slate-50/50 transition-colors">
                             <td className="px-8 py-6">
                                <div className="flex items-center gap-4">
                                   <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${node.isSynced ? 'bg-emerald-50 text-emerald-500' : 'bg-amber-50 text-amber-500 animate-pulse'}`}>
                                      {node.isSynced ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
                                   </div>
                                   <div>
                                      <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{node.month} {node.year}</p>
                                      <p className={`text-[10px] font-bold uppercase ${isGlobal ? 'text-indigo-500' : 'text-slate-400'}`}>
                                        {isGlobal ? 'Multi-Outlet Dataset' : getOutletName(node.outletId)}
                                      </p>
                                   </div>
                                </div>
                             </td>
                             <td className="px-8 py-6">
                                <div className="flex flex-wrap gap-2">
                                   {Array.from(node.expected as Set<FileType>).map((type: string) => {
                                      const hasActual = node.actual.has(type);
                                      const colorMap: any = { sales: 'indigo', item: 'emerald', platform_item: 'orange', expense: 'rose', purchase: 'amber' };
                                      return (
                                         <div key={type} className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter flex items-center gap-1.5 border ${hasActual ? `bg-${colorMap[type]}-50 text-${colorMap[type]}-600 border-${colorMap[type]}-100` : 'bg-slate-50 text-slate-300 border-slate-100'}`}>
                                            <div className={`w-1.5 h-1.5 rounded-full ${hasActual ? `bg-${colorMap[type]}-500` : 'bg-slate-200'}`} />
                                            {type.replace('_', ' ')}
                                         </div>
                                      );
                                   })}
                                </div>
                             </td>
                             <td className="px-8 py-6 text-center">
                                {node.isSynced ? (
                                   <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase tracking-widest"><CheckCircle2 size={12} /> Ready</span>
                                ) : (
                                   <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-[9px] font-black uppercase tracking-widest animate-pulse"><History size={12} /> Incomplete</span>
                                )}
                             </td>
                             <td className="px-8 py-6 text-right">
                                <button 
                                  onClick={() => syncSlice(node.year, node.month, node.outletId)}
                                  disabled={isSyncing || isRebuilding}
                                  className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${isSyncing ? 'bg-indigo-600 text-white animate-spin' : 'bg-slate-900 text-white hover:bg-indigo-600 shadow-md shadow-slate-200 disabled:opacity-30'}`}
                                >
                                  {isSyncing ? <RefreshCw size={14} /> : (isGlobal ? 'Sync Global Hub' : 'Sync Node')}
                                </button>
                             </td>
                          </tr>
                       );
                    })}
                 </tbody>
              </table>
           </div>
        </section>
      ) : (
        <section className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden animate-in fade-in duration-500">
          <div className="flex items-center justify-between mb-8">
            <div><h3 className="text-xl font-black text-slate-900 tracking-tight">Coverage Heatmap</h3><p className="text-slate-400 text-sm font-medium">Visual distribution of global uploads.</p></div>
            <div className="flex flex-wrap gap-4">
              {['Sales', 'Items', 'Expenses', 'Purchases'].map((l, i) => {
                 const color = ['indigo-500', 'emerald-500', 'rose-400', 'amber-500'][i];
                 return (
                   <div key={l} className="flex items-center gap-2"><div className={`w-3 h-3 bg-${color} rounded shadow-sm`} /><span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{l}</span></div>
                 );
              })}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-2 text-center">
              <thead>
                <tr>
                  <th className="p-2"></th>
                  {MONTHS.map(m => <th key={m} className="p-2 text-[10px] font-black text-slate-400 uppercase tracking-widest min-w-[60px]">{m.substring(0, 3)}</th>)}
                </tr>
              </thead>
              <tbody>
                {YEAR_OPTIONS.slice(0, 3).map(y => (
                  <tr key={y}>
                    <td className="p-2 text-sm font-black text-slate-900 pr-4 text-left">{y}</td>
                    {MONTHS.map(m => {
                      const types = coverageMatrix[y][m];
                      return (
                        <td key={m} className="p-1">
                          <div className={`h-16 rounded-2xl border flex flex-col items-center justify-center gap-1 transition-all ${types.size > 0 ? 'bg-slate-50 border-slate-100' : 'bg-transparent border-slate-50 opacity-20'}`}>
                            {types.has('sales') && <div className="w-5 h-1.5 bg-indigo-500 rounded-full shadow-sm" />}
                            {(types.has('item') || types.has('platform_item')) && <div className="w-5 h-1.5 bg-emerald-500 rounded-full shadow-sm" />}
                            {types.has('expense') && <div className="w-5 h-1.5 bg-rose-400 rounded-full shadow-sm" />}
                            {types.has('purchase') && <div className="w-5 h-1.5 bg-amber-500 rounded-full shadow-sm" />}
                            {types.size === 0 && <Circle size={4} className="text-slate-200 fill-slate-200" />}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between">
           <div><p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Total Sales Records</p><h4 className="text-4xl font-black tracking-tighter">{stats.salesCount.toLocaleString()}</h4></div>
           <div className="mt-8 flex items-center gap-3 bg-white/5 p-4 rounded-2xl"><TrendingUp className="text-indigo-400" /><div className="flex-1"><div className="h-1 bg-white/10 rounded-full overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (stats.salesCount / 50000) * 100)}%` }}></div></div><p className="text-[9px] font-bold text-white/40 mt-1 uppercase">Database Load</p></div></div>
        </div>
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between">
           <div><p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2 flex items-center gap-2"><Layers size={12} /> SKU Level Ingest</p><h4 className="text-3xl font-black text-slate-900 tracking-tighter">{stats.itemCount.toLocaleString()}</h4></div>
           <p className="text-slate-400 text-xs mt-2 leading-relaxed font-medium">Mapped SKU logs used for margin calculations.</p>
        </div>
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
           <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-2 flex items-center gap-2"><ShoppingCart size={12} /> Purchase Catalog</p>
           <h4 className="text-2xl font-black text-slate-900 tracking-tighter">{stats.purchaseCount.toLocaleString()}</h4>
           <p className="text-slate-400 text-xs mt-2 leading-relaxed font-medium">Inventory items logged from raw vendor bills.</p>
        </div>
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center items-center text-center">
           <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-4"><ShieldCheck size={32} /></div>
           <h4 className="text-lg font-black text-slate-900 tracking-tight">Reliability</h4>
           <p className="text-slate-400 text-xs font-medium mt-1">Audit Registry tracks {stats.totalDatasets} unique source datasets.</p>
        </div>
      </section>
    </div>
  );
};

export default DataCatalog;
