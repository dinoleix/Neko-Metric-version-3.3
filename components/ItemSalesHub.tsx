
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { getCachedCollection } from '../referenceCache';
import {
  ItemMonthlySnapshot,
  SalesMonthlySnapshot,
  StoreRental,
  ItemCost, 
  ItemSalesRecord, 
  getOutletName, 
  SkuCategory, 
  SkuMapping,
  SkuItemType,
  MenuNormalization,
  ServingOption,
  StoreTier,
  YEAR_OPTIONS,
  MONTH_NAMES,
  UserProfile
} from '../types';
import { managerOutlet, outletConstraint, rowsInManagerScope } from '../outletScope';
import { 
  History,
  RefreshCw, 
  MapPin, 
  TrendingUp, 
  Target,
  Settings2,
  Save,
  Loader2,
  X,
  Plus,
  Box,
  Search,
  SearchX,
  Package,
  Layers,
  ArrowRightLeft,
  Link2,
  Trophy,
  Info,
  Smartphone,
  Utensils,
  Coffee,
  Wind,
  Gem,
  Sparkles,
  ChevronRight,
  PieChart,
  Activity,
  Zap,
  MousePointer2,
  TrendingDown,
  AlertCircle,
  ArrowUpRight,
  ShieldCheck,
  ChevronDown,
  HelpCircle,
  UploadCloud,
  Layers2,
  LayoutGrid,
  List,
  Eye,
  TrendingUp as TrendingUpIcon,
  TrendingDown as TrendingDownIcon,
  Minus,
  ShoppingCart,
  Scale,
  Check,
  Filter,
} from 'lucide-react';
import { getItemChannelValues, CHANNEL_MODE_OPTIONS, ItemChannelMode } from '../itemChannels';

type InsightTab = 'matrix' | 'channels' | 'ranking' | 'profit' | 'velocity' | 'trends' | 'item-history' | 'combos' | 'ledger';
type AnalysisPeriod = 'custom' | '2m' | '3m' | '4m' | '6m' | '9m' | '12m' | '24m';
type ItemTypeScope = 'PRODUCT' | 'ADD_ON' | 'MODIFIER' | 'PACKAGING' | 'IGNORE' | 'UNCLASSIFIED' | 'ALL';

const ITEM_TYPE_SCOPE_OPTIONS: Array<{ id: ItemTypeScope; label: string }> = [
  { id: 'PRODUCT', label: 'Products' },
  { id: 'ADD_ON', label: 'Add-ons' },
  { id: 'MODIFIER', label: 'Modifiers' },
  { id: 'PACKAGING', label: 'Packaging' },
  { id: 'IGNORE', label: 'Ignored' },
  { id: 'UNCLASSIFIED', label: 'Unclassified' },
  { id: 'ALL', label: 'All item types' },
];

interface AggregatedItem {
  name: string;
  quantity: number;
  revenue: number;
  avgPrice: number;
  cost: number;
  servingsCost?: number;
  margin: number;
  marginPercent: number;
  velocity: number;
  history: number[];
  revenueHistory: number[];
  trendStatus: 'rising' | 'declining' | 'flat';
  trendPercent: number;
  segment?: string;
  itemType: SkuItemType;
  quadrant?: 'star' | 'promote' | 'reprice' | 'dog';
}

interface Combo {
  items: string[];
  count: number;
  totalRevenue: number;
  avgOrderValue: number;
}

const ItemSalesHub: React.FC<{ user: User; userProfile?: UserProfile; dataOwnerId: string }> = ({ user, userProfile, dataOwnerId }) => {
  const scopedOutlet = managerOutlet(userProfile);
  const [snapshots, setSnapshots] = useState<ItemMonthlySnapshot[]>([]);
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [servingOptions, setServingOptions] = useState<ServingOption[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, { category: SkuCategory, segment?: string, itemType: SkuItemType }>>({});
  const [normalizationMap, setNormalizationMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  
  const [storeFilter, setStoreFilter] = useState(scopedOutlet || 'all');
  const [channelMode, setChannelMode] = useState<ItemChannelMode>('all');
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod>('custom');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  // Product Intelligence opens on actual menu products. The remaining scopes
  // retain their operational data without letting modifiers distort product KPIs.
  const [itemTypeScope, setItemTypeScope] = useState<ItemTypeScope>('PRODUCT');
  const [showSegmentDropdown, setShowSegmentDropdown] = useState(false);
  const [rankingMode, setRankingMode] = useState<'top' | 'bottom'>('top');
  const [rankingLimit, setRankingLimit] = useState(10);
  const [activeTab, setActiveTab] = useState<InsightTab>('matrix');
  const [historyCategory, setHistoryCategory] = useState<string>('all');
  const [selectedItemName, setSelectedItemName] = useState<string | null>(null);
  const [comparisonItemNames, setComparisonItemNames] = useState<string[]>([]);
  const [comparisonMetric, setComparisonMetric] = useState<'units' | 'revenue'>('units');
  const [dashboardCategory, setDashboardCategory] = useState<string>('all');
  const [selectedDashboardItem, setSelectedDashboardItem] = useState<AggregatedItem | null>(null);
  
  const [hoveredBubble, setHoveredBubble] = useState<{ x: number, y: number, item: AggregatedItem } | null>(null);

  const fetchData = async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      let constraints = [where('userId', '==', dataOwnerId), ...outletConstraint(userProfile)];
      
      if (analysisPeriod === 'custom') {
        constraints.push(where('year', '==', selectedYear));
        if (selectedMonth !== 'All Months') constraints.push(where('month', '==', selectedMonth));
      } else {
        const count = parseInt(analysisPeriod);
        const years = new Set<string>();
        const now = new Date();
        for (let i = 0; i < count; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          years.add(d.getFullYear().toString());
        }
        constraints.push(where('year', 'in', Array.from(years)));
      }

      const [snap, salesSnap, rentalsArr, costsArr, skuArr, servingArr, normArr] = await Promise.all([
        getDocs(query(collection(db, 'item_snapshots'), ...constraints)),
        // Needed only for the channel comparison: commission lives in sales_snapshots,
        // and without it an online margin can't be shown net of the aggregator's cut.
        // Same period constraints, so this stays date-windowed rather than unbounded.
        getDocs(query(collection(db, 'sales_snapshots'), ...constraints)),
        getCachedCollection<StoreRental>('rentals', dataOwnerId, 'userId', scopedOutlet),
        getCachedCollection<ItemCost>('item_costs', dataOwnerId),
        getCachedCollection<SkuMapping>('sku_mappings', dataOwnerId),
        getCachedCollection<ServingOption>('serving_options', dataOwnerId),
        getCachedCollection<MenuNormalization>('menu_normalization', dataOwnerId)
      ]);

      let fetchedSnaps = snap.docs.map(d => ({ ...d.data(), id: d.id } as ItemMonthlySnapshot));
      
      if (analysisPeriod !== 'custom') {
        const count = parseInt(analysisPeriod);
        const targetMonths: string[] = [];
        const now = new Date();
        for (let i = 0; i < count; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          targetMonths.push(`${MONTH_NAMES[d.getMonth()]}-${d.getFullYear()}`);
        }
        fetchedSnaps = fetchedSnaps.filter(s => targetMonths.includes(`${s.month}-${s.year}`));
      }

      setSnapshots(fetchedSnaps);
      setSalesSnaps(salesSnap.docs.map(d => d.data() as SalesMonthlySnapshot));
      setRentals(rowsInManagerScope(rentalsArr, userProfile));
      setItemCosts(costsArr);
      setServingOptions(servingArr);

      const normMap: Record<string, string> = {};
      normArr.forEach(data => {
        normMap[data.sourceName.trim().toUpperCase()] = data.masterName.trim().toUpperCase();
      });
      setNormalizationMap(normMap);

      const mappingObj: Record<string, { category: SkuCategory, segment?: string, itemType: SkuItemType }> = {};
      skuArr.forEach(data => {
        mappingObj[data.itemName.trim().toUpperCase()] = {
          category: data.category,
          segment: data.segment,
          itemType: data.itemType || 'UNCLASSIFIED'
        };
      });
      setSkuMappings(mappingObj);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [user, selectedYear, selectedMonth, analysisPeriod, scopedOutlet]);

  // Rentals are the source of truth for operational outlets. Closed stores stay
  // in their historical records but must not appear in current analytics scope.
  const activeOutletOptions = useMemo(
    () => rentals.filter(r => r.status === 'active').map(r => ({ id: r.outletId, name: r.storeName })),
    [rentals]
  );
  const activeOutletIds = useMemo(() => new Set(activeOutletOptions.map(o => o.id)), [activeOutletOptions]);

  useEffect(() => {
    if (storeFilter !== 'all' && !activeOutletIds.has(storeFilter)) setStoreFilter('all');
  }, [storeFilter, activeOutletIds]);

  const intelligence = useMemo(() => {
    const filteredSnaps = snapshots.filter(s => storeFilter === 'all' ? activeOutletIds.has(s.outletId) : s.outletId === storeFilter);
    if (filteredSnaps.length === 0) return null;

    // Sort snapshots by date
    const sortedSnaps = [...filteredSnaps].sort((a, b) => {
      const yearA = parseInt(a.year);
      const yearB = parseInt(b.year);
      if (yearA !== yearB) return yearA - yearB;
      return MONTH_NAMES.indexOf(a.month) - MONTH_NAMES.indexOf(b.month);
    });

    const isSingleMonth = analysisPeriod === 'custom' && selectedMonth !== 'All Months';
    
    // Determine history length and labels
    let historyLength = 0;
    if (isSingleMonth) {
      historyLength = 31;
    } else if (analysisPeriod === 'custom') {
      historyLength = 12;
    } else {
      historyLength = parseInt(analysisPeriod);
    }

    const itemMap: Record<string, { quantity: number; revenue: number; dailyTrend: number[]; revenueTrend: number[]; outletQty: Record<string, number> }> = {};

    // Map snapshots to history slots
    const now = new Date();
    const getSlotIndex = (snap: ItemMonthlySnapshot) => {
      if (isSingleMonth) return -1; // Handled separately
      if (analysisPeriod === 'custom') return MONTH_NAMES.indexOf(snap.month);

      const snapDate = new Date(parseInt(snap.year), MONTH_NAMES.indexOf(snap.month), 1);
      if (isNaN(snapDate.getTime())) return -1;

      const diffMonths = (now.getFullYear() - snapDate.getFullYear()) * 12 + (now.getMonth() - snapDate.getMonth());
      const slot = historyLength - 1 - diffMonths;
      return (slot >= 0 && slot < historyLength) ? slot : -1;
    };

    // One label per slot, aligned to the same indexing getSlotIndex uses, so
    // the Item History tab's chart axis names the real calendar month behind
    // each bar rather than a bare index.
    const monthLabels: string[] = isSingleMonth
      ? Array.from({ length: historyLength }, (_, i) => String(i + 1))
      : analysisPeriod === 'custom'
        ? MONTH_NAMES.map(m => m.slice(0, 3))
        : Array.from({ length: historyLength }, (_, slot) => {
            const diffMonths = historyLength - 1 - slot;
            const d = new Date(now.getFullYear(), now.getMonth() - diffMonths, 1);
            return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} '${String(d.getFullYear()).slice(2)}`;
          });

    sortedSnaps.forEach(snap => {
      const slotIdx = getSlotIndex(snap);

      Object.entries(snap.items).forEach(([name, data]: [string, any]) => {
        const masterName = (normalizationMap[name.trim().toUpperCase()] || name).trim().toUpperCase();
        if (!itemMap[masterName]) itemMap[masterName] = { quantity: 0, revenue: 0, dailyTrend: new Array(historyLength).fill(0), revenueTrend: new Array(historyLength).fill(0), outletQty: {} };

        const { qty: chQty, revenue: chRevenue } = getItemChannelValues(data, channelMode);
        itemMap[masterName].quantity += chQty;
        itemMap[masterName].revenue += chRevenue;
        itemMap[masterName].outletQty[snap.outletId] = (itemMap[masterName].outletQty[snap.outletId] || 0) + chQty;

        // dailyTrend/revenueTrend have no per-channel breakdown in the schema —
        // they always reflect combined POS + online, regardless of channelMode.
        // Trend/velocity/history charts carry a note about this; quantity/
        // revenue/margin figures above do not.
        const dTrend = Array.isArray(data.dailyTrend) ? data.dailyTrend : [];
        if (isSingleMonth) {
          dTrend.forEach((v: number, i: number) => {
            if (itemMap[masterName].dailyTrend[i] !== undefined) itemMap[masterName].dailyTrend[i] += v;
          });
        } else if (slotIdx !== -1) {
          itemMap[masterName].dailyTrend[slotIdx] += data.quantity;
          itemMap[masterName].revenueTrend[slotIdx] += Number(data.revenue || 0);
        }
      });
    });

    const totalDays = isSingleMonth ? 30 : (historyLength * 30);
    const aggregated: AggregatedItem[] = Object.entries(itemMap).map(([name, data]) => {
      const history = data.dailyTrend;
      const splitIdx = Math.max(1, Math.floor(history.length * 0.8));
      const avgRecent = history.slice(splitIdx).reduce((a, b) => a + b, 0) / (history.length - splitIdx || 1);
      const avgPrev = history.slice(0, splitIdx).reduce((a, b) => a + b, 0) / (splitIdx || 1);
      const status: any = avgRecent > avgPrev * 1.1 ? 'rising' : (avgRecent < avgPrev * 0.9 ? 'declining' : 'flat');
      
      const costRecord = itemCosts.find(c => (c.itemName || '').trim().toUpperCase() === name);
      const mapping = skuMappings[name];
      
      let totalServingsCost = 0;
      Object.entries(data.outletQty).forEach(([oId, qty]) => {
         const rental = rentals.find(r => r.outletId === oId);
         const tier = rental?.tier || 'TIER_1';
         let specificServings = 0;
         if (tier === 'TIER_1') specificServings = costRecord?.tier1ServingsCost ?? costRecord?.servingsCostPerUnit ?? 0;
         else if (tier === 'TIER_2') specificServings = costRecord?.tier2ServingsCost ?? costRecord?.servingsCostPerUnit ?? 0;
         totalServingsCost += (specificServings * qty);
      });

      const avgServingsCost = data.quantity > 0 ? totalServingsCost / data.quantity : 0;
      const unitCost = (costRecord?.costPerUnit || 0) + avgServingsCost;
      const price = data.quantity > 0 ? data.revenue / data.quantity : 0;
      const margin = price - unitCost;
      
      return { 
        name, quantity: data.quantity, revenue: data.revenue, avgPrice: price, 
        cost: costRecord?.costPerUnit || 0, servingsCost: avgServingsCost, margin, 
        marginPercent: price > 0 ? (margin/price)*100 : 0, 
        velocity: data.quantity/totalDays, history, revenueHistory: data.revenueTrend, trendStatus: status,
        trendPercent: avgPrev > 0 ? ((avgRecent - avgPrev) / avgPrev) * 100 : 0,
        segment: mapping?.segment,
        itemType: mapping?.itemType || 'UNCLASSIFIED'
      };
    }).filter(i => i.quantity > 0);

    const availableSegments = Array.from(new Set((Object.values(skuMappings) as { segment?: string }[]).map(m => m.segment).filter(Boolean))) as string[];
    const matchesItemTypeScope = (itemType: SkuItemType) => itemTypeScope === 'ALL' || itemType === itemTypeScope;
    const finalItems = aggregated.filter(i =>
      matchesItemTypeScope(i.itemType) &&
      (selectedSegments.length === 0 || (i.segment && selectedSegments.includes(i.segment)))
    );

    const medianQty = [...finalItems].sort((a, b) => a.quantity - b.quantity)[Math.floor(finalItems.length / 2)]?.quantity || 0;
    const medianMargin = [...finalItems].sort((a, b) => a.margin - b.margin)[Math.floor(finalItems.length / 2)]?.margin || 0;

    // Aggregated Market Basket (Merge pre-calculated combos from snapshots)
    const comboMap: Record<string, { items: string[], count: number, totalRevenue: number }> = {};
    filteredSnaps.forEach(snap => {
       (snap.combos || []).forEach(c => {
          // A product scope keeps modifier/add-on-only combinations out of the
          // menu basket analysis, while the other scopes remain inspectable.
          if (selectedSegments.length > 0 || itemTypeScope !== 'ALL') {
            const allMatch = c.items.every(item => {
              const masterName = (normalizationMap[item.trim().toUpperCase()] || item).trim().toUpperCase();
              const mapping = skuMappings[masterName];
              const segmentMatches = selectedSegments.length === 0 || Boolean(mapping?.segment && selectedSegments.includes(mapping.segment));
              const itemTypeMatches = itemTypeScope === 'ALL' || (mapping?.itemType || 'UNCLASSIFIED') === itemTypeScope;
              return segmentMatches && itemTypeMatches;
            });
            if (!allMatch) return;
          }

          const key = [...c.items].sort().join(' +++ ');
          if (!comboMap[key]) {
             comboMap[key] = { ...c };
          } else {
             comboMap[key].count += c.count;
             comboMap[key].totalRevenue += c.totalRevenue;
          }
       });
    });
    const finalCombos = Object.values(comboMap)
      .map(c => ({ items: c.items, count: c.count, totalRevenue: c.totalRevenue, avgOrderValue: c.totalRevenue / c.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      items: finalItems.map((i): AggregatedItem => ({
        ...i,
        quadrant: (i.quantity >= medianQty ? (i.margin >= medianMargin ? 'star' : 'reprice') : (i.margin >= medianMargin ? 'promote' : 'dog')) as 'star' | 'promote' | 'reprice' | 'dog'
      })),
      monthLabels, isSingleMonth,
      rankedByVolume: [...finalItems].sort((a, b) => b.quantity - a.quantity).slice(0, rankingLimit),
      rankedByRevenue: [...finalItems].sort((a, b) => b.revenue - a.revenue).slice(0, rankingLimit),
      leastByVolume: [...finalItems].sort((a, b) => a.quantity - b.quantity).slice(0, rankingLimit),
      leastByRevenue: [...finalItems].sort((a, b) => a.revenue - b.revenue).slice(0, rankingLimit),
      combos: finalCombos,
      availableSegments,
      medianQty, medianMargin, maxQty: Math.max(...finalItems.map(i => i.quantity), 1), maxPrice: Math.max(...finalItems.map(i => i.avgPrice), 1), maxMargin: Math.max(...finalItems.map(i => i.margin), 1), maxVelocity: Math.max(...finalItems.map(i => i.velocity), 1),
      // Matrix plots margin on Y, so it needs the floor too — loss-making items must
      // render below the break-even line rather than being clamped to the axis.
      minMargin: Math.min(...finalItems.map(i => i.margin), 0),
      maxProfitContribution: Math.max(...finalItems.map(i => i.margin * i.quantity), 1),
      totalTheoreticalCost: finalItems.reduce((sum, i) => sum + ((i.cost + (i.servingsCost || 0)) * i.quantity), 0),
      totalRev: finalItems.reduce((sum, i) => sum + i.revenue, 0)
    };
  }, [snapshots, storeFilter, channelMode, selectedMonth, itemCosts, normalizationMap, skuMappings, rentals, selectedSegments, itemTypeScope, rankingLimit, activeOutletIds]);

  useEffect(() => {
    if (!intelligence) {
      setComparisonItemNames([]);
      return;
    }
    const available = new Set(intelligence.items.map(item => item.name));
    setComparisonItemNames(current => current.filter(name => available.has(name)));
  }, [intelligence]);

  // Per-item in-store vs online comparison. Online list prices are marked up to
  // absorb commission, so comparing raw prices is meaningless — the online side is
  // shown net of the aggregator's cut, which is the only basis on which the two
  // channels answer the same question.
  const channelComparison = useMemo(() => {
    const filteredSnaps = snapshots.filter(s => storeFilter === 'all' ? activeOutletIds.has(s.outletId) : s.outletId === storeFilter);
    const filteredSales = salesSnaps.filter(s => storeFilter === 'all' ? activeOutletIds.has(s.outletId) : s.outletId === storeFilter);
    if (filteredSnaps.length === 0) return null;

    // Same definition as Margin Intelligence: commission + GST on commission over
    // ex-tax online sales. Ads and TDS stay out (period cost / recoverable tax).
    const onlineGross = filteredSales.reduce((a, s) => a + (s.onlineGoodGross || 0), 0);
    const onlineTax = filteredSales.reduce((a, s) => a + (s.onlineGoodTax || 0), 0);
    const onlineComm = filteredSales.reduce((a, s) => a + (s.onlineGoodComm || 0), 0);
    const onlineGstOnComm = filteredSales.reduce((a, s) => a + (s.onlineGoodGstOnComm || 0), 0);
    const onlineNetSales = onlineGross - onlineTax;
    const takePercent = onlineNetSales > 0 ? ((onlineComm + onlineGstOnComm) / onlineNetSales) * 100 : 0;

    const map: Record<string, { posQty: number, posRev: number, onlineQty: number, onlineRev: number, outletQty: Record<string, number> }> = {};
    filteredSnaps.forEach(snap => {
      Object.entries(snap.items).forEach(([name, data]: [string, any]) => {
        const masterName = (normalizationMap[name.trim().toUpperCase()] || name).trim().toUpperCase();
        if (!map[masterName]) map[masterName] = { posQty: 0, posRev: 0, onlineQty: 0, onlineRev: 0, outletQty: {} };
        const pos = getItemChannelValues(data, 'pos');
        const online = getItemChannelValues(data, 'online');
        map[masterName].posQty += pos.qty;
        map[masterName].posRev += pos.revenue;
        map[masterName].onlineQty += online.qty;
        map[masterName].onlineRev += online.revenue;
        map[masterName].outletQty[snap.outletId] = (map[masterName].outletQty[snap.outletId] || 0) + pos.qty + online.qty;
      });
    });

    const rows = Object.entries(map).map(([name, d]) => {
      const costRecord = itemCosts.find(c => (c.itemName || '').trim().toUpperCase() === name);
      const totalQty = d.posQty + d.onlineQty;
      let servingsTotal = 0;
      Object.entries(d.outletQty).forEach(([oId, qty]) => {
        const tier = rentals.find(r => r.outletId === oId)?.tier || 'TIER_1';
        const serv = tier === 'TIER_1'
          ? (costRecord?.tier1ServingsCost ?? costRecord?.servingsCostPerUnit ?? 0)
          : (costRecord?.tier2ServingsCost ?? costRecord?.servingsCostPerUnit ?? 0);
        servingsTotal += serv * qty;
      });
      const unitCost = (costRecord?.costPerUnit || 0) + (totalQty > 0 ? servingsTotal / totalQty : 0);

      const posPrice = d.posQty > 0 ? d.posRev / d.posQty : 0;
      const onlinePrice = d.onlineQty > 0 ? d.onlineRev / d.onlineQty : 0;
      const onlineNet = onlinePrice * (1 - takePercent / 100);

      const posMarginPct = posPrice > 0 ? ((posPrice - unitCost) / posPrice) * 100 : 0;
      const onlineMarginPct = onlineNet > 0 ? ((onlineNet - unitCost) / onlineNet) * 100 : 0;
      const markupPct = posPrice > 0 ? ((onlinePrice / posPrice) - 1) * 100 : 0;
      // Markup that would put online net exactly level with the in-store price.
      const requiredMarkupPct = takePercent < 100 ? (takePercent / (100 - takePercent)) * 100 : 0;

      return {
        name, unitCost, posQty: d.posQty, onlineQty: d.onlineQty,
        posPrice, onlinePrice, onlineNet,
        posMarginPct, onlineMarginPct,
        gapPct: onlineMarginPct - posMarginPct,
        markupPct, requiredMarkupPct,
        hasCost: !!costRecord,
        segment: skuMappings[name]?.segment,
        itemType: skuMappings[name]?.itemType || 'UNCLASSIFIED',
      };
    }).filter(r =>
      r.posQty > 0 && r.onlineQty > 0 &&
      (itemTypeScope === 'ALL' || r.itemType === itemTypeScope) &&
      (selectedSegments.length === 0 || (r.segment && selectedSegments.includes(r.segment)))
    ).sort((a, b) => a.gapPct - b.gapPct);

    return { rows, takePercent, requiredMarkupPct: takePercent < 100 ? (takePercent / (100 - takePercent)) * 100 : 0 };
  }, [snapshots, salesSnaps, storeFilter, itemCosts, normalizationMap, rentals, skuMappings, selectedSegments, itemTypeScope, activeOutletIds]);

  // Zero-price modifiers (for example ICE, COLD, packing choices) carry unit
  // counts but no product revenue. They remain in the ledger, but including them
  // in menu recommendations makes them look like urgent low-margin products.
  const dashboardItems = intelligence?.items.filter(item =>
    item.revenue > 0 && item.avgPrice > 0 &&
    (dashboardCategory === 'all' || item.segment === dashboardCategory)
  ) || [];

  const dashboardGroups = intelligence ? [
    { id: 'star', label: 'Stars', hint: 'Strong volume + strong margin', color: 'emerald', items: dashboardItems.filter(item => item.quadrant === 'star') },
    { id: 'reprice', label: 'Reprice', hint: 'Strong volume + weak margin', color: 'amber', items: dashboardItems.filter(item => item.quadrant === 'reprice') },
    { id: 'promote', label: 'Promote', hint: 'Low volume + strong margin', color: 'indigo', items: dashboardItems.filter(item => item.quadrant === 'promote') },
    { id: 'review', label: 'Review', hint: 'Low volume + weak margin', color: 'rose', items: dashboardItems.filter(item => item.quadrant === 'dog') },
  ] : [];

  const recommendationFor = (item: AggregatedItem) => item.quadrant === 'star'
    ? 'Protect'
    : item.quadrant === 'reprice'
      ? 'Reprice'
      : item.quadrant === 'promote'
        ? 'Promote'
        : 'Review';

  const opportunityScore = (item: AggregatedItem) => {
    if (!intelligence) return 0;
    // Percentage margin keeps low-price add-ons from outranking full menu items
    // merely because their rupee margin sits far below the portfolio median.
    if (item.quadrant === 'reprice') return item.revenue * Math.max(0, 60 - item.marginPercent) / 100;
    if (item.quadrant === 'promote') return Math.max(0, item.margin) * Math.max(1, intelligence.medianQty - item.quantity);
    if (item.quadrant === 'dog') return item.revenue;
    return Math.max(0, item.margin) * item.quantity;
  };

  // Equal-size dots plus a small deterministic collision adjustment make dense
  // product clusters readable without changing the underlying axes.
  const renderDashboardSvg = () => {
    if (!intelligence) return null;
    const chartItems = [...dashboardItems].sort((a, b) => b.revenue - a.revenue).slice(0, 30);
    const PAD_L = 78, PAD_R = 26, PAD_T = 30, PAD_B = 54;
    const W = 1000 - PAD_L - PAD_R;
    const H = 420 - PAD_T - PAD_B;
    const maxQ = Math.max(...chartItems.map(item => item.quantity), 1);
    const minM = Math.min(...chartItems.map(item => item.margin), 0);
    const maxM = Math.max(...chartItems.map(item => item.margin), minM + 1);
    const x = (q: number) => PAD_L + (q / maxQ) * W;
    const y = (m: number) => PAD_T + (1 - (m - minM) / (maxM - minM)) * H;
    const cx = Math.max(PAD_L, Math.min(1000 - PAD_R, x(intelligence.medianQty)));
    const cy = Math.max(PAD_T, Math.min(420 - PAD_B, y(intelligence.medianMargin)));
    const trendColor = (s: string) => s === 'rising' ? '#10b981' : (s === 'declining' ? '#f43f5e' : '#f59e0b');
    const byProfit = [...chartItems].sort((a, b) => (b.margin * b.quantity) - (a.margin * a.quantity));
    const labelled = new Set(byProfit.slice(0, 4).map(item => item.name));
    const placed: Array<{ item: AggregatedItem; px: number; py: number }> = [];
    byProfit.forEach(item => {
      const baseX = x(item.quantity);
      const baseY = y(item.margin);
      let px = baseX, py = baseY;
      for (let attempt = 0; attempt < 18 && placed.some(point => Math.hypot(point.px - px, point.py - py) < 18); attempt++) {
        const radius = 7 + Math.floor(attempt / 4) * 7;
        const angle = attempt * 2.4;
        px = Math.max(PAD_L + 7, Math.min(1000 - PAD_R - 7, baseX + Math.cos(angle) * radius));
        py = Math.max(PAD_T + 7, Math.min(420 - PAD_B - 7, baseY + Math.sin(angle) * radius));
      }
      placed.push({ item, px, py });
    });
    const quadrants = [
      { label: 'Promote', qx: PAD_L + 8, qy: PAD_T + 20, color: '#6366f1' },
      { label: 'Stars', qx: 1000 - PAD_R - 8, qy: PAD_T + 20, color: '#10b981', anchor: 'end' },
      { label: 'Review', qx: PAD_L + 8, qy: 420 - PAD_B - 10, color: '#f43f5e' },
      { label: 'Reprice', qx: 1000 - PAD_R - 8, qy: 420 - PAD_B - 10, color: '#f59e0b', anchor: 'end' },
    ];

    return (
      <svg viewBox="0 0 1000 420" className="w-full h-auto overflow-visible" role="img" aria-label="Item portfolio showing units sold against margin per item">
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={PAD_T + p * H} x2={1000 - PAD_R} y2={PAD_T + p * H} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD_L - 10} y={PAD_T + p * H + 4} textAnchor="end" className="text-[11px] font-bold fill-slate-400">
              ₹{Math.round(maxM - p * (maxM - minM))}
            </text>
            <text x={PAD_L + p * W} y={420 - PAD_B + 22} textAnchor="middle" className="text-[11px] font-bold fill-slate-400">
              {Math.round(p * maxQ)}
            </text>
          </g>
        ))}

        {minM < 0 && <line x1={PAD_L} y1={y(0)} x2={1000 - PAD_R} y2={y(0)} stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="2 3" />}
        <line x1={cx} y1={PAD_T} x2={cx} y2={420 - PAD_B} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" />
        <line x1={PAD_L} y1={cy} x2={1000 - PAD_R} y2={cy} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" />

        {quadrants.map(q => (
          <text key={q.label} x={q.qx} y={q.qy} textAnchor={(q.anchor as any) || 'start'} className="text-[13px] font-black uppercase tracking-widest" fill={q.color} opacity="0.55">
            {q.label}
          </text>
        ))}

        {placed.map(({ item, px, py }) => {
          return (
            <g key={item.name}>
              <circle
                cx={px} cy={py} r={selectedDashboardItem?.name === item.name ? 9 : 6}
                fill={trendColor(item.trendStatus)} fillOpacity={selectedDashboardItem?.name === item.name ? 1 : 0.78}
                stroke="white" strokeWidth="2"
                className="transition-all cursor-pointer"
                onClick={() => setSelectedDashboardItem(item)}
                onMouseEnter={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setHoveredBubble({ x: rect.left + rect.width / 2, y: rect.top, item }); }}
                onMouseLeave={() => setHoveredBubble(null)}
              />
              {labelled.has(item.name) && (
                <text x={px > 820 ? px - 9 : px + 9} y={py - 8} textAnchor={px > 820 ? 'end' : 'start'} className="text-[10px] font-black fill-slate-600 pointer-events-none">
                  {item.name.length > 15 ? `${item.name.slice(0, 15)}…` : item.name}
                </text>
              )}
            </g>
          );
        })}

        <text x={PAD_L + W / 2} y={418} textAnchor="middle" className="text-[11px] font-black uppercase tracking-widest fill-slate-400">Units Sold →</text>
        <text x={16} y={PAD_T + H / 2} textAnchor="middle" transform={`rotate(-90 16 ${PAD_T + H / 2})`} className="text-[11px] font-black uppercase tracking-widest fill-slate-400">Margin / Unit →</text>
      </svg>
    );
  };

  const Sparkline: React.FC<{ data: number[], color: string }> = ({ data, color }) => {
    if (!data || data.length < 2) return null;
    const max = Math.max(...data, 1);
    const points = data.map((val, i) => { const x = (i / (data.length - 1)) * 100; const y = 30 - (val / max) * 25; return `${x},${y}`; }).join(' ');
    return (<svg viewBox="0 0 100 30" className="w-24 h-8 overflow-visible"><polyline fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} /></svg>);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5"><div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center text-white shadow-xl"><Target size={28} /></div><div><h2 className="text-3xl font-black text-slate-900 tracking-tight">Product Intelligence</h2><p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Master SKU aggregated analytics.</p></div></div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2">
            <History size={14} className="text-indigo-500" />
            <select 
              value={analysisPeriod} 
              onChange={e => setAnalysisPeriod(e.target.value as AnalysisPeriod)} 
              className="bg-transparent font-bold text-xs outline-none uppercase tracking-tight"
            >
              <option value="custom">Custom Range</option>
              <option value="2m">Last 2 Months</option>
              <option value="3m">Last 3 Months</option>
              <option value="4m">Last 4 Months</option>
              <option value="6m">Last 6 Months</option>
              <option value="9m">Last 9 Months</option>
              <option value="12m">Last 1 Year</option>
              <option value="24m">Last 2 Years</option>
            </select>
          </div>

          {analysisPeriod === 'custom' && (
            <>
              <select value={selectedYear} onChange={e => setSelectedYear(e.target.value)} className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 font-bold text-xs outline-none shadow-sm uppercase">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select>
              <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 font-bold text-xs outline-none shadow-sm uppercase"><option value="All Months">All Months</option>{MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}</select>
            </>
          )}
          
          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2"><MapPin size={14} className="text-emerald-500" /><select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase tracking-tight">{!scopedOutlet && <option value="all">All Active Outlets</option>}{activeOutletOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>

          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2" title="Quantity, revenue and margin respect this filter. Trend history, velocity, and combos have no per-channel breakdown in the data and always reflect combined POS + online."><Smartphone size={14} className="text-emerald-500" /><select value={channelMode} onChange={e => setChannelMode(e.target.value as ItemChannelMode)} className="bg-transparent font-bold text-xs outline-none uppercase tracking-tight">{CHANNEL_MODE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>

          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2" title="Products is the default scope. Use the other scopes to inspect add-ons, modifiers, packaging, ignored rows, or unclassified data separately."><Package size={14} className="text-amber-500" /><select value={itemTypeScope} onChange={e => setItemTypeScope(e.target.value as ItemTypeScope)} className="bg-transparent font-bold text-xs outline-none uppercase tracking-tight">{ITEM_TYPE_SCOPE_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>

          {intelligence?.availableSegments && intelligence.availableSegments.length > 0 && (
            <div className="relative">
              <button 
                onClick={() => setShowSegmentDropdown(!showSegmentDropdown)}
                className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2 hover:border-indigo-200 transition-all"
              >
                <Layers size={14} className="text-indigo-500" />
                <span className="font-bold text-xs uppercase tracking-tight">
                  {selectedSegments.length === 0 ? 'All Segments' : `${selectedSegments.length} Selected`}
                </span>
                <ChevronDown size={14} className={`text-slate-400 transition-transform ${showSegmentDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showSegmentDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSegmentDropdown(false)} />
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl border border-slate-100 shadow-2xl z-50 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-50">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Filter Segments</span>
                      <button 
                        onClick={() => setSelectedSegments([])}
                        className="text-[9px] font-black text-indigo-600 uppercase hover:underline"
                      >
                        Reset
                      </button>
                    </div>
                    <div className="space-y-1 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                      {intelligence.availableSegments.map(s => {
                        const isSelected = selectedSegments.includes(s);
                        return (
                          <button
                            key={s}
                            onClick={() => {
                              if (isSelected) {
                                setSelectedSegments(selectedSegments.filter(item => item !== s));
                              } else {
                                setSelectedSegments([...selectedSegments, s]);
                              }
                            }}
                            className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition-all ${isSelected ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-600'}`}
                          >
                            <span className="text-[10px] font-bold uppercase tracking-tight">{s}</span>
                            {isSelected && <Check size={14} className="text-indigo-600" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-50 flex gap-2">
                       <button 
                         onClick={() => setSelectedSegments(intelligence.availableSegments || [])}
                         className="flex-1 py-2 bg-slate-50 text-slate-600 rounded-lg text-[9px] font-black uppercase hover:bg-slate-100 transition-all"
                       >
                         Select All
                       </button>
                       <button 
                         onClick={() => setShowSegmentDropdown(false)}
                         className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-[9px] font-black uppercase hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all"
                       >
                         Apply
                       </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          
          <button onClick={fetchData} className="p-3 bg-white rounded-xl border border-slate-100 text-slate-400 hover:text-emerald-600 shadow-sm transition-colors"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/></button>
        </div>
      </header>

      {loading ? (
        <div className="py-40 text-center"><Loader2 className="w-12 h-12 text-emerald-500 animate-spin mx-auto mb-4" /><p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Processing Master SKUs...</p></div>
      ) : !intelligence ? (
        <div className="py-32 bg-white rounded-[3rem] border-2 border-dashed border-slate-200 text-center"><SearchX size={48} className="mx-auto text-slate-200 mb-4" /><h3 className="text-xl font-black text-slate-900">No Snapshot Data</h3></div>
      ) : (
        <>
          <div className="flex items-center gap-2 bg-slate-200/40 p-1.5 rounded-[2rem] w-fit border border-slate-100 shadow-inner flex-wrap">{(['matrix', 'channels', 'ranking', 'profit', 'velocity', 'trends', 'item-history', 'combos', 'ledger'] as InsightTab[]).map((tab) => (<button key={tab} onClick={() => { setActiveTab(tab); setHoveredBubble(null); }} className={`px-6 py-2.5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-600'}`}>{tab === 'matrix' ? 'Item Dashboard' : tab === 'item-history' ? 'Item History' : tab}</button>))}</div>
          
          <div className="mt-8">
            {activeTab === 'matrix' && (() => {
              const totalRevenue = dashboardItems.reduce((sum, item) => sum + item.revenue, 0);
              const groupValue = (group: typeof dashboardGroups[number]) => {
                const revenue = group.items.reduce((sum, item) => sum + item.revenue, 0);
                if (group.id === 'reprice') {
                  const gap = group.items.reduce((sum, item) => sum + item.revenue * Math.max(0, 60 - item.marginPercent) / 100, 0);
                  return `₹${Math.round(gap).toLocaleString()} margin gap`;
                }
                if (group.id === 'promote') {
                  const avg = group.items.length ? group.items.reduce((sum, item) => sum + item.marginPercent, 0) / group.items.length : 0;
                  return `${avg.toFixed(0)}% avg margin`;
                }
                return `${totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 100) : 0}% of revenue`;
              };
              const colorClasses: Record<string, { text: string; bg: string; border: string }> = {
                emerald: { text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'hover:border-emerald-300' },
                amber: { text: 'text-amber-600', bg: 'bg-amber-50', border: 'hover:border-amber-300' },
                indigo: { text: 'text-indigo-600', bg: 'bg-indigo-50', border: 'hover:border-indigo-300' },
                rose: { text: 'text-rose-600', bg: 'bg-rose-50', border: 'hover:border-rose-300' },
              };
              const sortedByOpportunity = [...dashboardItems].sort((a, b) => opportunityScore(b) - opportunityScore(a));
              const opportunities = (['reprice', 'promote', 'dog', 'star'] as const)
                .map(quadrant => sortedByOpportunity.find(item => item.quadrant === quadrant))
                .filter((item): item is AggregatedItem => Boolean(item));
              sortedByOpportunity.forEach(item => {
                if (opportunities.length < 5 && !opportunities.some(existing => existing.name === item.name)) opportunities.push(item);
              });
              const selectedInsight = selectedDashboardItem && dashboardItems.some(item => item.name === selectedDashboardItem.name)
                ? selectedDashboardItem
                : opportunities[0] || null;
              const rankedRows = sortedByOpportunity.filter(item => item.quadrant !== 'star').slice(0, 15);

              return (
                <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                  <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight">Item Performance Dashboard</h3>
                      <p className="text-slate-400 text-sm font-medium mt-1">See what to protect, promote, reprice, or review.</p>
                    </div>
                    <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2 min-w-[220px]">
                      <Layers size={14} className="text-indigo-500" />
                      <select value={dashboardCategory} onChange={e => { setDashboardCategory(e.target.value); setSelectedDashboardItem(null); }} className="w-full bg-transparent font-bold text-xs outline-none uppercase tracking-tight">
                        <option value="all">All Categories</option>
                        {intelligence.availableSegments.map(segment => <option key={segment} value={segment}>{segment}</option>)}
                      </select>
                    </div>
                  </div>

                  <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    {dashboardGroups.map(group => {
                      const colors = colorClasses[group.color];
                      return (
                        <button key={group.id} onClick={() => setSelectedDashboardItem(group.items[0] || null)} className={`text-left bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm transition-all ${colors.border}`}>
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{group.label}</p>
                            <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black ${colors.text} ${colors.bg}`}>{group.items.length}</span>
                          </div>
                          <p className="text-xl font-black text-slate-900 tracking-tight mt-4">{groupValue(group)}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase mt-2">{group.hint}</p>
                        </button>
                      );
                    })}
                  </section>

                  <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
                    <section className="xl:col-span-8 bg-white rounded-[2.5rem] p-7 border border-slate-100 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                        <div>
                          <h4 className="text-lg font-black text-slate-900 tracking-tight">Portfolio Overview</h4>
                          <p className="text-slate-400 text-xs font-medium mt-1">Top {Math.min(30, dashboardItems.length)} revenue-driving items · equal-size dots and automatic spacing.</p>
                        </div>
                        <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest">
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Rising</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Flat</span>
                          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Declining</span>
                        </div>
                      </div>
                      {dashboardItems.length ? renderDashboardSvg() : <div className="py-24 text-center text-slate-400 text-sm font-bold">No items in this category for the selected period.</div>}
                    </section>

                    <aside className="xl:col-span-4 bg-white rounded-[2.5rem] p-7 border border-slate-100 shadow-sm">
                      <h4 className="text-lg font-black text-slate-900 tracking-tight">Top Opportunities</h4>
                      <p className="text-slate-400 text-xs font-medium mt-1 mb-5">Largest actions for this period.</p>
                      <div className="divide-y divide-slate-100">
                        {opportunities.map((item, index) => {
                          const action = recommendationFor(item);
                          const tone = item.quadrant === 'star' ? colorClasses.emerald : item.quadrant === 'reprice' ? colorClasses.amber : item.quadrant === 'promote' ? colorClasses.indigo : colorClasses.rose;
                          return (
                            <button key={item.name} onClick={() => setSelectedDashboardItem(item)} className="w-full flex items-center gap-3 py-3 text-left group">
                              <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-black shrink-0">{index + 1}</span>
                              <span className="min-w-0 flex-1"><span className="block text-[11px] font-black text-slate-800 uppercase truncate">{item.name}</span><span className="block text-[9px] font-bold text-slate-400 mt-1">₹{Math.round(item.revenue).toLocaleString()} revenue · ₹{item.margin.toFixed(0)} margin</span></span>
                              <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase ${tone.text} ${tone.bg}`}>{action}</span>
                            </button>
                          );
                        })}
                      </div>
                      {selectedInsight && (
                        <div className="mt-5 p-5 bg-indigo-50 rounded-2xl border border-indigo-100">
                          <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700">{selectedInsight.name}</p>
                          <p className="text-xs font-bold text-indigo-900 mt-2 leading-relaxed">
                            {selectedInsight.quadrant === 'star' && 'Protect availability and consistency. This item combines strong demand and margin.'}
                            {selectedInsight.quadrant === 'reprice' && 'Review its selling price, recipe cost, and portion size. Demand is strong but margin is below the portfolio median.'}
                            {selectedInsight.quadrant === 'promote' && 'Increase its menu visibility and crew recommendations. The margin is attractive but sales volume is still low.'}
                            {selectedInsight.quadrant === 'dog' && 'Review its quality, positioning, and role on the menu before keeping or removing it.'}
                          </p>
                        </div>
                      )}
                    </aside>
                  </div>

                  <section className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
                    <div className="p-7 border-b border-slate-100">
                      <h4 className="text-lg font-black text-slate-900 tracking-tight">Items Requiring Attention</h4>
                      <p className="text-slate-400 text-xs font-medium mt-1">Ranked by estimated business impact with one clear recommendation.</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead className="bg-slate-50/80"><tr><th className="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Item</th><th className="px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Category</th><th className="px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Units</th><th className="px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Revenue</th><th className="px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Margin</th><th className="px-4 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400 text-right">Trend</th><th className="px-6 py-4 text-[9px] font-black uppercase tracking-widest text-slate-400">Recommendation</th></tr></thead>
                        <tbody className="divide-y divide-slate-50">
                          {rankedRows.map(item => {
                            const action = recommendationFor(item);
                            const tone = item.quadrant === 'star' ? colorClasses.emerald : item.quadrant === 'reprice' ? colorClasses.amber : item.quadrant === 'promote' ? colorClasses.indigo : colorClasses.rose;
                            return (
                              <tr key={item.name} onClick={() => setSelectedDashboardItem(item)} className="hover:bg-slate-50 cursor-pointer transition-colors">
                                <td className="px-6 py-4 text-[11px] font-black uppercase text-slate-800">{item.name}</td><td className="px-4 py-4 text-xs font-bold text-slate-500">{item.segment || 'Unmapped'}</td><td className="px-4 py-4 text-xs font-black text-slate-700 text-right">{item.quantity.toLocaleString()}</td><td className="px-4 py-4 text-xs font-black text-slate-700 text-right">₹{Math.round(item.revenue).toLocaleString()}</td><td className="px-4 py-4 text-xs font-black text-slate-700 text-right">₹{item.margin.toFixed(0)}</td><td className={`px-4 py-4 text-xs font-black text-right ${item.trendStatus === 'rising' ? 'text-emerald-600' : item.trendStatus === 'declining' ? 'text-rose-600' : 'text-slate-400'}`}>{item.trendPercent > 0 ? '+' : ''}{item.trendPercent.toFixed(0)}%</td><td className="px-6 py-4"><span className={`inline-block px-2.5 py-1 rounded-lg text-[9px] font-black uppercase ${tone.text} ${tone.bg}`}>{action}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              );
            })()}
            
            {activeTab === 'channels' && (
              <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                {!channelComparison || channelComparison.rows.length === 0 ? (
                  <div className="py-32 bg-white rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
                    <SearchX size={48} className="mx-auto text-slate-200 mb-4" />
                    <h3 className="text-xl font-black text-slate-900">No Dual-Channel Items</h3>
                    <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">This view compares items sold both in-store and online. Upload both POS and platform item data for this period to populate it.</p>
                  </div>
                ) : (
                  <>
                    <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Aggregator Take</p>
                        <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{channelComparison.takePercent.toFixed(1)}%</h4>
                        <p className="text-[9px] font-bold text-slate-400 uppercase mt-2">Comm + GST / Net Sales</p>
                      </div>
                      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Markup Needed</p>
                        <h4 className="text-3xl font-black text-indigo-600 tracking-tighter">{channelComparison.requiredMarkupPct.toFixed(1)}%</h4>
                        <p className="text-[9px] font-bold text-slate-400 uppercase mt-2">To match in-store net</p>
                      </div>
                      <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Items Below Parity</p>
                        <h4 className="text-3xl font-black tracking-tighter text-rose-400">
                          {channelComparison.rows.filter(r => r.gapPct < -1).length}<span className="text-lg text-slate-500"> / {channelComparison.rows.length}</span>
                        </h4>
                        <p className="text-[9px] font-bold text-slate-500 uppercase mt-2">Online margin under in-store</p>
                      </div>
                    </section>

                    <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden">
                      <div className="p-10 border-b border-slate-50">
                        <h3 className="text-2xl font-black text-slate-900 tracking-tight">Channel Margin Comparison</h3>
                        <p className="text-slate-400 text-sm font-medium mt-1">Online shown net of the aggregator's cut — worst gaps first. Both channels use the same cost basis.</p>
                      </div>
                      <div className="w-full overflow-x-auto">
                        <table className="w-full text-left table-fixed">
                          <thead className="bg-slate-50/80 border-b border-slate-100">
                            <tr>
                              <th className="pl-6 pr-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide w-[17%]">Master SKU</th>
                              <th className="px-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-right w-[9%]" title="Ingredient cost + tier-appropriate packaging — same figure used for both channels.">Cost ₹</th>
                              <th className="px-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-right w-[9%]">In-Store ₹</th>
                              <th className="px-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-right w-[9%]">Online ₹</th>
                              <th className="px-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-right w-[8%]" title="Actual markup applied to the online list price versus the in-store price.">Markup</th>
                              <th className="px-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-right w-[10%]" title="Online list price less the aggregator's commission + GST on commission.">Online Net ₹</th>
                              <th className="px-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-center w-[8%]">In-Store %</th>
                              <th className="px-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-right w-[10%]" title="In-store price minus cost, in rupees per unit.">In-Store Profit ₹</th>
                              <th className="px-2 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-center w-[10%]">Online % (Net)</th>
                              <th className="pl-2 pr-6 py-4 text-[9px] font-black text-slate-400 uppercase tracking-wide text-center w-[10%]">Gap</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {channelComparison.rows.map(r => {
                              const atParity = Math.abs(r.gapPct) <= 1;
                              const markupShort = r.markupPct < r.requiredMarkupPct - 1;
                              return (
                                <tr key={r.name} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="pl-6 pr-2 py-3">
                                    <p className="text-[11px] font-black text-slate-800 uppercase tracking-tight truncate">{r.name}</p>
                                    <p className="text-[8px] font-bold text-slate-400 uppercase truncate">
                                      {r.posQty} in-store · {r.onlineQty} online{!r.hasCost && ' · no cost'}
                                    </p>
                                  </td>
                                  <td className="px-2 py-3 text-right text-xs font-black text-slate-500">₹{r.unitCost.toFixed(0)}</td>
                                  <td className="px-2 py-3 text-right text-xs font-black text-slate-700">₹{r.posPrice.toFixed(0)}</td>
                                  <td className="px-2 py-3 text-right text-xs font-black text-slate-700">₹{r.onlinePrice.toFixed(0)}</td>
                                  <td className={`px-2 py-3 text-right text-xs font-black ${markupShort ? 'text-amber-600' : 'text-slate-500'}`} title={markupShort ? `Below the ${r.requiredMarkupPct.toFixed(1)}% needed for parity` : undefined}>
                                    {r.markupPct.toFixed(0)}%
                                  </td>
                                  <td className="px-2 py-3 text-right text-xs font-black text-amber-600">₹{r.onlineNet.toFixed(0)}</td>
                                  <td className="px-2 py-3 text-center text-xs font-black text-slate-700">{r.posMarginPct.toFixed(1)}%</td>
                                  <td className={`px-2 py-3 text-right text-xs font-black ${(r.posPrice - r.unitCost) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>₹{(r.posPrice - r.unitCost).toFixed(0)}</td>
                                  <td className="px-2 py-3 text-center text-xs font-black text-slate-700">{r.onlineMarginPct.toFixed(1)}%</td>
                                  <td className="pl-2 pr-6 py-3 text-center">
                                    <span className={`inline-block px-2 py-1 rounded-full text-[9px] font-black tracking-tight whitespace-nowrap ${atParity ? 'bg-emerald-50 text-emerald-600' : (r.gapPct < 0 ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600')}`}>
                                      {r.gapPct > 0 ? '+' : ''}{r.gapPct.toFixed(1)} pts
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                )}
              </div>
            )}

            {activeTab === 'ranking' && (
              <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex bg-slate-200/50 p-1 rounded-2xl w-fit border border-slate-100 shadow-inner">
                    <button 
                      onClick={() => setRankingMode('top')} 
                      className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${rankingMode === 'top' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Top Performers
                    </button>
                    <button 
                      onClick={() => setRankingMode('bottom')} 
                      className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${rankingMode === 'bottom' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Least Performers
                    </button>
                  </div>

                  <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-2xl border border-slate-100 shadow-sm">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Show:</span>
                    <div className="flex gap-1">
                      {[10, 20, 30].map(limit => (
                        <button
                          key={limit}
                          onClick={() => setRankingLimit(limit)}
                          className={`w-8 h-8 rounded-lg text-[10px] font-black transition-all ${rankingLimit === limit ? 'bg-slate-900 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-50'}`}
                        >
                          {limit}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                     <h3 className="text-xl font-black text-slate-900 tracking-tight mb-8 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {rankingMode === 'top' ? <Trophy size={20} className="text-indigo-600" /> : <TrendingDown size={20} className="text-rose-600" />}
                          {rankingMode === 'top' ? `Top ${rankingLimit} Volume Drivers` : `Least ${rankingLimit} Volume Drivers`}
                        </div>
                        <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">By Units</span>
                     </h3>
                     <div className="space-y-4">
                       {(rankingMode === 'top' ? intelligence.rankedByVolume : intelligence.leastByVolume).map((item, i) => (
                         <div key={item.name} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                            <div className="flex items-center gap-4">
                               <span className={`w-6 h-6 rounded-full ${rankingMode === 'top' ? 'bg-indigo-600' : 'bg-rose-600'} text-white flex items-center justify-center text-[10px] font-black`}>{i+1}</span>
                               <span className="text-xs font-black text-slate-800 uppercase">{item.name}</span>
                            </div>
                            <span className="text-sm font-black text-slate-900">{item.quantity.toLocaleString()} units</span>
                         </div>
                       ))}
                     </div>
                  </div>
                  <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                     <h3 className="text-xl font-black text-slate-900 tracking-tight mb-8 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {rankingMode === 'top' ? <TrendingUpIcon size={20} className="text-emerald-600" /> : <AlertCircle size={20} className="text-orange-600" />}
                          {rankingMode === 'top' ? `Top ${rankingLimit} Revenue Drivers` : `Least ${rankingLimit} Revenue Drivers`}
                        </div>
                        <span className="text-[10px] font-black text-slate-300 uppercase tracking-widest">By Value</span>
                     </h3>
                     <div className="space-y-4">
                       {(rankingMode === 'top' ? intelligence.rankedByRevenue : intelligence.leastByRevenue).map((item, i) => (
                         <div key={item.name} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                            <div className="flex items-center gap-4">
                               <span className={`w-6 h-6 rounded-full ${rankingMode === 'top' ? 'bg-emerald-600' : 'bg-orange-600'} text-white flex items-center justify-center text-[10px] font-black`}>{i+1}</span>
                               <span className="text-xs font-black text-slate-800 uppercase">{item.name}</span>
                            </div>
                            <span className="text-sm font-black text-slate-900">₹{item.revenue.toLocaleString()}</span>
                         </div>
                       ))}
                     </div>
                  </div>
                </div>
                
                <div className="bg-white p-10 rounded-[3rem] border border-slate-100 shadow-sm">
                   <h3 className="text-xl font-black text-slate-900 tracking-tight mb-8">Recent Demand Velocity</h3>
                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                     {(rankingMode === 'top' ? intelligence.rankedByVolume : intelligence.leastByVolume).map((item) => (
                       <div key={item.name} className="flex items-center justify-between p-4 border-b border-slate-50">
                          <span className="text-xs font-black text-slate-500 uppercase">{item.name}</span>
                          <Sparkline data={item.history} color={rankingMode === 'top' ? "#10b981" : "#f43f5e"} />
                       </div>
                     ))}
                   </div>
                </div>
              </div>
            )}

            {activeTab === 'profit' && (
              <div className="space-y-10 animate-in fade-in duration-700">
                <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-between">
                    <div>
                       <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-1">Theoretical Gross Margin</p>
                       <h4 className="text-4xl font-black tracking-tighter text-emerald-400">₹{(intelligence.totalRev - intelligence.totalTheoreticalCost).toLocaleString()}</h4>
                    </div>
                    <div className="mt-6 flex items-center gap-2 text-indigo-400 text-[10px] font-bold uppercase">
                      <Scale size={14} /> Efficiency: {(( (intelligence.totalRev - intelligence.totalTheoreticalCost) / (intelligence.totalRev || 1)) * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Theoretical COGS</p>
                    <h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{intelligence.totalTheoreticalCost.toLocaleString()}</h4>
                    <p className="text-[9px] font-bold text-slate-400 uppercase mt-4">Weighted Food Cost: {((intelligence.totalTheoreticalCost / (intelligence.totalRev || 1)) * 100).toFixed(1)}%</p>
                  </div>
                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
                    <div className="flex items-center gap-3 mb-2">
                       <Zap size={20} className="text-amber-500" />
                       <span className="text-xs font-black text-slate-900 uppercase">Strategy Insight</span>
                    </div>
                    <p className="text-slate-500 text-xs leading-relaxed font-medium">Items with &lt;65% margin are targets for price optimization or resource substitution.</p>
                  </div>
                </section>

                <div className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden">
                   <div className="p-10 border-b border-slate-50 flex items-center justify-between">
                      <div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Profitability Quadrants</h3><p className="text-slate-400 text-sm font-medium">Segmenting items by Volume (Menu Mix) and Cash Margin</p></div>
                   </div>
                   <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-b border-slate-100">
                      {[
                        { id: 'star', label: 'STARS', icon: Trophy, color: 'text-emerald-600', bg: 'bg-emerald-50', desc: 'High Volume, High Margin. Maintain standard.' },
                        { id: 'reprice', label: 'WORKHORSES', icon: Activity, color: 'text-indigo-600', bg: 'bg-indigo-50', desc: 'High Volume, Low Margin. Optimization needed.' }
                      ].map(q => (
                        <div key={q.id} className={`p-10 ${q.bg}/30 border-r border-slate-100 last:border-r-0`}>
                           <div className="flex items-center gap-3 mb-4">
                              <div className={`p-2 rounded-xl ${q.bg} ${q.color}`}><q.icon size={18}/></div>
                              <h4 className="text-sm font-black uppercase tracking-widest text-slate-900">{q.label}</h4>
                           </div>
                           <p className="text-[10px] font-bold text-slate-400 uppercase mb-8">{q.desc}</p>
                           <div className="space-y-3">
                              {intelligence.items.filter(i => i.quadrant === q.id).sort((a,b) => b.revenue - a.revenue).slice(0, 5).map(item => (
                                 <div key={item.name} className="flex justify-between items-center text-xs font-bold text-slate-600">
                                    <span className="truncate max-w-[200px] uppercase">{item.name}</span>
                                    <span className="font-black text-slate-900">₹{item.margin.toFixed(0)} / unit</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                      ))}
                   </div>
                   <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
                      {[
                        { id: 'promote', label: 'PUZZLES', icon: Gem, color: 'text-amber-600', bg: 'bg-amber-50', desc: 'Low Volume, High Margin. Needs marketing.' },
                        { id: 'dog', label: 'DOGS', icon: TrendingDown, color: 'text-rose-600', bg: 'bg-rose-50', desc: 'Low Volume, Low Margin. Reconsider presence.' }
                      ].map(q => (
                        <div key={q.id} className={`p-10 ${q.bg}/30 border-r border-slate-100 last:border-r-0`}>
                           <div className="flex items-center gap-3 mb-4">
                              <div className={`p-2 rounded-xl ${q.bg} ${q.color}`}><q.icon size={18}/></div>
                              <h4 className="text-sm font-black uppercase tracking-widest text-slate-900">{q.label}</h4>
                           </div>
                           <p className="text-[10px] font-bold text-slate-400 uppercase mb-8">{q.desc}</p>
                           <div className="space-y-3">
                              {intelligence.items.filter(i => i.quadrant === q.id).sort((a,b) => b.revenue - a.revenue).slice(0, 5).map(item => (
                                 <div key={item.name} className="flex justify-between items-center text-xs font-bold text-slate-600">
                                    <span className="truncate max-w-[200px] uppercase">{item.name}</span>
                                    <span className="font-black text-slate-900">₹{item.margin.toFixed(0)} / unit</span>
                                 </div>
                              ))}
                           </div>
                        </div>
                      ))}
                   </div>
                </div>
              </div>
            )}

            {activeTab === 'velocity' && (
              <div className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm animate-in zoom-in-95">
                 <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-8 flex items-center gap-3"><Activity size={24} className="text-indigo-600" /> Units Sold Per Day</h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                   {intelligence.items.sort((a,b) => b.velocity - a.velocity).slice(0, 20).map(item => (
                      <div key={item.name} className="space-y-2">
                         <div className="flex justify-between text-[11px] font-black text-slate-600 uppercase tracking-widest">
                            <span>{item.name}</span>
                            <span className="text-indigo-600">{item.velocity.toFixed(1)} units/day</span>
                         </div>
                         <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${(item.velocity / intelligence.maxVelocity) * 100}%` }} />
                         </div>
                      </div>
                   ))}
                 </div>
              </div>
            )}

            {activeTab === 'trends' && (
              <div className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                {channelMode !== 'all' && (
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Info size={12} /> Trend lines have no per-channel breakdown in the data and always reflect combined POS + online.</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
                {intelligence.items.sort((a,b) => b.quantity - a.quantity).slice(0, 15).map(item => (
                  <div key={item.name} className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-lg transition-all group">
                     <div className="flex justify-between items-start mb-6">
                        <div className={`p-2 rounded-xl bg-slate-50 ${item.trendStatus === 'rising' ? 'text-emerald-500' : (item.trendStatus === 'declining' ? 'text-rose-500' : 'text-slate-400')}`}>
                           {item.trendStatus === 'rising' ? <TrendingUpIcon size={18}/> : (item.trendStatus === 'declining' ? <TrendingDownIcon size={18}/> : <Minus size={18}/>)}
                        </div>
                        <span className={`text-[10px] font-black uppercase ${item.trendStatus === 'rising' ? 'text-emerald-500' : (item.trendStatus === 'declining' ? 'text-rose-500' : 'text-slate-400')}`}>
                           {item.trendStatus === 'rising' ? '+' : ''}{item.trendPercent.toFixed(0)}%
                        </span>
                     </div>
                     <h4 className="text-[11px] font-black text-slate-800 uppercase truncate mb-4">{item.name}</h4>
                     <Sparkline data={item.history} color={item.trendStatus === 'rising' ? '#10b981' : (item.trendStatus === 'declining' ? '#f43f5e' : '#94a3b8')} />
                     <div className="mt-4 pt-4 border-t border-slate-50 flex justify-between items-center text-[9px] font-black uppercase text-slate-400">
                        <span>L30 Vol</span>
                        <span className="text-slate-900">{item.quantity} units</span>
                     </div>
                  </div>
                ))}
                </div>
              </div>
            )}

            {activeTab === 'item-history' && (() => {
              const itemsForCategory = historyCategory === 'all'
                ? intelligence.items
                : intelligence.items.filter(i => i.segment === historyCategory);
              const sortedItemOptions = [...itemsForCategory].sort((a, b) => a.name.localeCompare(b.name));
              const selected = selectedItemName ? intelligence.items.find(i => i.name === selectedItemName) : null;
              const comparisonItems = comparisonItemNames
                .map(name => intelligence.items.find(item => item.name === name))
                .filter((item): item is AggregatedItem => Boolean(item));

              // The current calendar month's item_snapshots doesn't exist until the
              // CSV is uploaded at month-end, so a rolling "Last N Months" window
              // always ends on an empty bar mid-month — which the trend comparison
              // (recent vs earlier) misreads as a decline. Only rolling windows end
              // at "now"; 'custom' is a fixed calendar year and isn't affected.
              let displayHistory = selected?.history ?? [];
              let displayRevenueHistory = selected?.revenueHistory ?? [];
              let displayLabels = intelligence.monthLabels;
              let displayTrendStatus = selected?.trendStatus;
              let displayTrendPercent = selected?.trendPercent ?? 0;
              let excludedMonthLabel: string | null = null;

              if (selected && analysisPeriod !== 'custom') {
                const lastIdx = displayHistory.length - 1;
                const currentMonthEmpty = lastIdx > 0 && displayHistory[lastIdx] === 0 && displayRevenueHistory[lastIdx] === 0;
                if (currentMonthEmpty) {
                  excludedMonthLabel = intelligence.monthLabels[lastIdx];
                  displayHistory = displayHistory.slice(0, -1);
                  displayRevenueHistory = displayRevenueHistory.slice(0, -1);
                  displayLabels = intelligence.monthLabels.slice(0, -1);

                  const splitIdx = Math.max(1, Math.floor(displayHistory.length * 0.8));
                  const avgRecent = displayHistory.slice(splitIdx).reduce((a, b) => a + b, 0) / (displayHistory.length - splitIdx || 1);
                  const avgPrev = displayHistory.slice(0, splitIdx).reduce((a, b) => a + b, 0) / (splitIdx || 1);
                  displayTrendStatus = avgRecent > avgPrev * 1.1 ? 'rising' : (avgRecent < avgPrev * 0.9 ? 'declining' : 'flat');
                  displayTrendPercent = avgPrev > 0 ? ((avgRecent - avgPrev) / avgPrev) * 100 : 0;
                }
              }

              const renderBarChart = (values: number[], labels: string[], color: string, formatValue: (v: number) => string) => {
                const max = Math.max(...values, 1);
                // Extra top padding over the earlier version: every bar now carries its
                // own value label above it, and the tallest bar's label needs headroom
                // that doesn't clip against the chart's top edge.
                const W = 1000, H = 300, PAD_L = 60, PAD_B = 40, PAD_T = 40;
                const plotW = W - PAD_L - 20, plotH = H - PAD_T - PAD_B;
                const barWidth = (plotW / values.length) * 0.6;
                return (
                  <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
                    {[0, 0.5, 1].map(p => (
                      <g key={p}>
                        <line x1={PAD_L} y1={PAD_T + (1 - p) * plotH} x2={W - 20} y2={PAD_T + (1 - p) * plotH} stroke="#f1f5f9" strokeWidth="1" strokeDasharray={p === 0 ? '0' : '4 4'} />
                        <text x={PAD_L - 10} y={PAD_T + (1 - p) * plotH + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-black">{formatValue(max * p)}</text>
                      </g>
                    ))}
                    {values.map((v, i) => {
                      const x = PAD_L + (i / values.length) * plotW + ((plotW / values.length) - barWidth) / 2;
                      const h = (v / max) * plotH;
                      const barTop = PAD_T + plotH - h;
                      return (
                        <g key={i}>
                          <text x={x + barWidth / 2} y={Math.max(14, barTop - 8)} textAnchor="middle" className="fill-slate-700 text-[11px] font-black">
                            {v > 0 ? formatValue(v) : ''}
                          </text>
                          <rect x={x} y={barTop} width={barWidth} height={h} fill={color} rx="4" className="transition-all hover:opacity-80">
                            <title>{`${labels[i]}: ${formatValue(v)}`}</title>
                          </rect>
                          <text x={x + barWidth / 2} y={H - PAD_B + 16} textAnchor="middle" className="fill-slate-500 text-[10px] font-black uppercase">
                            {labels[i]}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                );
              };

              const renderComparisonChart = () => {
                const colors = ['#4f46e5', '#10b981', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6'];
                let labels = [...intelligence.monthLabels];
                let series = comparisonItems.map((item, index) => ({
                  name: item.name,
                  color: colors[index % colors.length],
                  values: [...(comparisonMetric === 'units' ? item.history : item.revenueHistory)],
                }));

                if (analysisPeriod !== 'custom' && labels.length > 1) {
                  const lastIndex = labels.length - 1;
                  const currentMonthEmpty = series.length > 0 && series.every(line => line.values[lastIndex] === 0);
                  if (currentMonthEmpty) {
                    labels = labels.slice(0, -1);
                    series = series.map(line => ({ ...line, values: line.values.slice(0, -1) }));
                  }
                }

                const max = Math.max(...series.flatMap(line => line.values), 1);
                const W = 1000, H = 380, PAD_L = 76, PAD_R = 28, PAD_T = 30, PAD_B = 55;
                const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
                const x = (index: number) => PAD_L + (labels.length <= 1 ? plotW / 2 : (index / (labels.length - 1)) * plotW);
                const y = (value: number) => PAD_T + plotH - (value / max) * plotH;
                const labelStep = Math.max(1, Math.ceil(labels.length / 12));
                const formatValue = (value: number) => comparisonMetric === 'units'
                  ? Math.round(value).toLocaleString()
                  : `₹${Math.round(value).toLocaleString()}`;

                return (
                  <div>
                    <div className="flex flex-wrap gap-x-5 gap-y-2 mb-6">
                      {series.map(line => (
                        <div key={line.name} className="flex items-center gap-2 min-w-0">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: line.color }} />
                          <span className="text-[10px] font-black uppercase text-slate-600 truncate">{line.name}</span>
                        </div>
                      ))}
                    </div>
                    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
                      {[0, 0.25, 0.5, 0.75, 1].map(p => {
                        const value = max * p;
                        const py = y(value);
                        return (
                          <g key={p}>
                            <line x1={PAD_L} y1={py} x2={W - PAD_R} y2={py} stroke="#e2e8f0" strokeWidth="1" strokeDasharray={p === 0 ? '0' : '4 4'} />
                            <text x={PAD_L - 12} y={py + 4} textAnchor="end" className="fill-slate-400 text-[10px] font-black">{formatValue(value)}</text>
                          </g>
                        );
                      })}
                      {labels.map((label, index) => (index % labelStep === 0 || index === labels.length - 1) && (
                        <text key={label + index} x={x(index)} y={H - 20} textAnchor="middle" className="fill-slate-500 text-[10px] font-black uppercase">{label}</text>
                      ))}
                      {series.map(line => {
                        const points = line.values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
                        return (
                          <g key={line.name}>
                            <polyline points={points} fill="none" stroke={line.color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                            {line.values.map((value, index) => (
                              <circle key={index} cx={x(index)} cy={y(value)} r="5" fill="white" stroke={line.color} strokeWidth="3">
                                <title>{`${line.name} · ${labels[index]}: ${formatValue(value)}`}</title>
                              </circle>
                            ))}
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                );
              };

              return (
                <div className="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
                  <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><History size={20} /></div>
                      <div>
                        <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Item history &amp; comparison</h3>
                        <p className="text-slate-400 text-xs font-medium">Choose a category and compare several dishes, or select one dish for its detailed units and revenue charts.</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4">
                      <div className="bg-slate-50 px-4 py-2.5 rounded-2xl border border-slate-100 flex items-center gap-2 min-w-[220px]">
                        <Layers size={14} className="text-indigo-500 shrink-0" />
                        <select
                          value={historyCategory}
                          onChange={e => {
                            setHistoryCategory(e.target.value);
                            // Drop the selection if it no longer belongs to the newly chosen category
                            if (selectedItemName && e.target.value !== 'all') {
                              const stillMatches = intelligence.items.find(i => i.name === selectedItemName)?.segment === e.target.value;
                              if (!stillMatches) setSelectedItemName(null);
                            }
                            setComparisonItemNames(current => current.filter(name => {
                              if (e.target.value === 'all') return true;
                              return intelligence.items.find(item => item.name === name)?.segment === e.target.value;
                            }));
                          }}
                          className="w-full bg-transparent font-bold text-xs outline-none uppercase"
                        >
                          <option value="all">All Categories</option>
                          {intelligence.availableSegments.map(seg => <option key={seg} value={seg}>{seg}</option>)}
                        </select>
                      </div>
                      <div className="bg-slate-50 px-4 py-2.5 rounded-2xl border border-slate-100 flex items-center gap-2 min-w-[260px] flex-1">
                        <Search size={14} className="text-indigo-500 shrink-0" />
                        <select
                          value={selectedItemName || ''}
                          onChange={e => setSelectedItemName(e.target.value || null)}
                          className="w-full bg-transparent font-bold text-xs outline-none uppercase"
                        >
                          <option value="">
                            {sortedItemOptions.length === 0 ? 'No items in this category, this period' : 'Select a dish…'}
                          </option>
                          {sortedItemOptions.map(i => <option key={i.name} value={i.name}>{i.name}</option>)}
                        </select>
                      </div>
                    </div>

                    <div className="mt-6 pt-6 border-t border-slate-100">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">Items to compare</p>
                          <p className="text-xs font-medium text-slate-400 mt-1">Select up to 6 items for a readable chart.</p>
                        </div>
                        {comparisonItemNames.length > 0 && (
                          <button onClick={() => setComparisonItemNames([])} className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-800">Clear selection</button>
                        )}
                      </div>
                      {historyCategory === 'all' ? (
                        <div className="rounded-2xl bg-indigo-50 border border-indigo-100 px-5 py-4 text-sm font-bold text-indigo-700">
                          Choose a category to show its menu items for comparison.
                        </div>
                      ) : sortedItemOptions.length === 0 ? (
                        <div className="rounded-2xl bg-slate-50 border border-slate-100 px-5 py-4 text-sm font-bold text-slate-400">No items sold in this category during the selected period.</div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto pr-1">
                          {sortedItemOptions.map(item => {
                            const checked = comparisonItemNames.includes(item.name);
                            const disabled = !checked && comparisonItemNames.length >= 6;
                            return (
                              <label key={item.name} className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${checked ? 'bg-indigo-50 border-indigo-300 text-indigo-900' : 'bg-white border-slate-200 text-slate-600'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-indigo-200'}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={() => setComparisonItemNames(current => checked ? current.filter(name => name !== item.name) : [...current, item.name])}
                                  className="w-4 h-4 accent-indigo-600"
                                />
                                <span className="text-[11px] font-black uppercase truncate">{item.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {!intelligence.isSingleMonth && comparisonItems.length > 0 && (
                    <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm p-8 md:p-10">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-7">
                        <div>
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2"><TrendingUp size={16} className="text-indigo-500" /> Menu Item Comparison</h4>
                          <p className="text-xs font-medium text-slate-400 mt-1">{comparisonItems.length} item{comparisonItems.length === 1 ? '' : 's'} across the selected period</p>
                        </div>
                        <div className="flex bg-slate-100 p-1 rounded-xl self-start">
                          {(['units', 'revenue'] as const).map(metric => (
                            <button key={metric} onClick={() => setComparisonMetric(metric)} className={`px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${comparisonMetric === metric ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
                              {metric}
                            </button>
                          ))}
                        </div>
                      </div>
                      {renderComparisonChart()}
                    </section>
                  )}

                  {intelligence.isSingleMonth ? (
                    <div className="py-24 bg-white rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
                      <History size={48} className="mx-auto text-slate-200 mb-4" />
                      <h3 className="text-lg font-black text-slate-900">Pick a wider period</h3>
                      <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
                        Month-by-month trend needs more than one month. Use the period selector above (e.g. "Last 6 Months")
                        instead of a single custom month.
                      </p>
                    </div>
                  ) : !selected ? (
                    <div className="py-24 bg-white rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
                      <SearchX size={48} className="mx-auto text-slate-200 mb-4" />
                      <h3 className="text-lg font-black text-slate-900">Pick a dish above</h3>
                      <p className="text-slate-400 text-sm mt-2">Its sales will plot here, one bar per month, for the period selected above.</p>
                    </div>
                  ) : (
                    <>
                      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm md:col-span-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{selected.name}</p>
                          <h4 className="text-3xl font-black text-slate-900 tracking-tighter">{selected.quantity.toLocaleString()} units</h4>
                          <p className="text-slate-400 text-xs font-bold uppercase mt-1">₹{Math.round(selected.revenue).toLocaleString()} total revenue, this period</p>
                        </div>
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-center">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Trend</p>
                          <div className={`flex items-center gap-2 text-2xl font-black ${displayTrendStatus === 'rising' ? 'text-emerald-500' : (displayTrendStatus === 'declining' ? 'text-rose-500' : 'text-slate-400')}`}>
                            {displayTrendStatus === 'rising' ? <TrendingUpIcon size={22} /> : (displayTrendStatus === 'declining' ? <TrendingDownIcon size={22} /> : <Minus size={22} />)}
                            {displayTrendStatus === 'rising' ? '+' : ''}{displayTrendPercent.toFixed(0)}%
                          </div>
                          <p className="text-slate-400 text-[10px] font-bold uppercase mt-1">Recent vs earlier{excludedMonthLabel ? ', excluding ' + excludedMonthLabel : ' in this period'}</p>
                        </div>
                        <div className="bg-slate-900 p-8 rounded-[2.5rem] text-white shadow-xl flex flex-col justify-center">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Avg Price</p>
                          <h4 className="text-2xl font-black tracking-tighter">₹{selected.avgPrice.toFixed(0)}</h4>
                        </div>
                      </section>

                      {excludedMonthLabel && (
                        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-4">
                          <div className="p-2.5 bg-amber-500/15 rounded-xl shrink-0"><Info className="text-amber-600" size={20} /></div>
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">{excludedMonthLabel} not shown</p>
                            <p className="text-sm font-bold text-amber-900 mt-1">
                              No sales data has been uploaded for {excludedMonthLabel} yet — it's excluded from the chart and the
                              trend above so an empty, still-in-progress month doesn't read as a decline.
                            </p>
                          </div>
                        </div>
                      )}

                      <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm p-10">
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-6 flex items-center gap-2"><ShoppingCart size={16} className="text-indigo-500" /> Units Sold by Month</h4>
                        {renderBarChart(displayHistory, displayLabels, '#6366f1', v => Math.round(v).toLocaleString())}
                      </section>

                      <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm p-10">
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-6 flex items-center gap-2"><Target size={16} className="text-emerald-500" /> Revenue by Month</h4>
                        {renderBarChart(displayRevenueHistory, displayLabels, '#10b981', v => `₹${Math.round(v).toLocaleString()}`)}
                      </section>

                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Info size={12} /> Reflects combined POS + online sales, regardless of the channel filter above.</p>
                    </>
                  )}
                </div>
              );
            })()}

            {activeTab === 'combos' && (
              <div className="space-y-10 animate-in zoom-in-95">
                 <div className="bg-indigo-900 p-10 rounded-[3rem] text-white shadow-2xl relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none"><ShoppingCart size={200} /></div>
                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-8">
                       <div>
                          <h3 className="text-3xl font-black tracking-tight mb-2 uppercase">Market Basket Insight</h3>
                          <p className="text-indigo-200 text-sm font-medium">Identifying frequent pairings and cross-sell correlations.{channelMode !== 'all' && ' Combos have no per-channel breakdown and always reflect combined POS + online.'}</p>
                       </div>
                    </div>
                 </div>

                 {intelligence.combos.length === 0 ? (
                    <div className="bg-white p-20 rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
                       <SearchX size={48} className="mx-auto text-slate-200 mb-4" />
                       <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">No recurring combos detected in this period</p>
                    </div>
                 ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                       {intelligence.combos.map((combo, i) => (
                          <div key={i} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex items-center justify-between group hover:border-indigo-300 transition-all">
                             <div className="space-y-4">
                                <div className="flex items-center gap-3">
                                   <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs shadow-inner">#{i+1}</div>
                                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Frequent Pairing</p>
                                </div>
                                <div className="space-y-2">
                                   {combo.items.map((item, idx) => (
                                      <div key={idx} className="flex items-center gap-2">
                                         <Plus size={10} className="text-indigo-400" />
                                         <span className="text-sm font-black text-slate-800 uppercase tracking-tight">{item}</span>
                                      </div>
                                   ))}
                                </div>
                             </div>
                             <div className="text-right">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Occurrence</p>
                                <p className="text-2xl font-black text-indigo-600">{combo.count} Times</p>
                                <p className="text-[9px] font-bold text-slate-500 uppercase mt-4">Avg Basket: ₹{combo.avgOrderValue.toFixed(0)}</p>
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
              </div>
            )}

            {activeTab === 'ledger' && (
              <section className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-slate-50"><th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase">Master SKU</th><th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-center">Volume</th><th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Avg Price</th><th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase text-right">Revenue</th></tr></thead><tbody className="divide-y divide-slate-50">{[...intelligence.items].sort((a, b) => b.revenue - a.revenue).map((item, i) => (<tr key={i} className="hover:bg-slate-50/50 transition-colors"><td className="px-6 py-4 text-sm font-black uppercase">{item.name}</td><td className="px-6 py-4 text-center font-bold">{item.quantity}</td><td className="px-6 py-4 text-right">₹{item.avgPrice.toFixed(0)}</td><td className="px-6 py-4 text-right font-black">₹{item.revenue.toLocaleString()}</td></tr>))}</tbody></table></section>
            )}
          </div>
        </>
      )}

      {hoveredBubble && (
        <div className="fixed pointer-events-none z-[1000] animate-in fade-in zoom-in-95 duration-150" style={{ left: hoveredBubble.x, top: hoveredBubble.y - 15, transform: 'translate(-50%, -100%)' }}>
          <div className="bg-slate-900 text-white p-5 rounded-[2rem] shadow-2xl border border-white/10 min-w-[220px]"><div className="flex items-center gap-3 mb-4"><div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-xs bg-indigo-500 text-white">{hoveredBubble.item.name[0]}</div><div><h4 className="text-[11px] font-black uppercase truncate max-w-[120px] tracking-tight">{hoveredBubble.item.name}</h4><p className="text-[9px] font-bold text-slate-400 uppercase">Master Identity</p></div></div><div className="space-y-2 border-t border-white/5 pt-4"><div className="flex justify-between items-center"><span className="text-[9px] font-black text-slate-500 uppercase">Unified Qty</span><span className="text-xs font-black">{hoveredBubble.item.quantity}</span></div><div className="flex justify-between items-center"><span className="text-[9px] font-black text-slate-500 uppercase">Avg Price</span><span className="text-xs font-black">₹{hoveredBubble.item.avgPrice.toFixed(0)}</span></div><div className="flex justify-between items-center"><span className="text-[9px] font-black text-slate-500 uppercase">Net Margin</span><span className="text-xs font-black text-emerald-400">₹{hoveredBubble.item.margin.toFixed(0)}</span></div></div><div className="absolute top-full left-1/2 -translate-x-1/2 w-4 h-4 bg-slate-900 rotate-45 -mt-2" /></div>
        </div>
      )}
    </div>
  );
};

export default ItemSalesHub;
