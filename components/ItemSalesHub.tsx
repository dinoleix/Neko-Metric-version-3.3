
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
  MenuNormalization,
  ServingOption,
  StoreTier,
  YEAR_OPTIONS,
  MONTH_NAMES
} from '../types';
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
  Maximize2,
  X as CloseIcon
} from 'lucide-react';
import { getItemChannelValues, CHANNEL_MODE_OPTIONS, ItemChannelMode } from '../itemChannels';

type InsightTab = 'matrix' | 'channels' | 'ranking' | 'profit' | 'velocity' | 'trends' | 'combos' | 'ledger';
type AnalysisPeriod = 'custom' | '3m' | '6m' | '9m' | '12m' | '24m';

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
  trendStatus: 'rising' | 'declining' | 'flat';
  trendPercent: number;
  segment?: string;
  quadrant?: 'star' | 'promote' | 'reprice' | 'dog';
}

interface Combo {
  items: string[];
  count: number;
  totalRevenue: number;
  avgOrderValue: number;
}

const ItemSalesHub: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [snapshots, setSnapshots] = useState<ItemMonthlySnapshot[]>([]);
  const [salesSnaps, setSalesSnaps] = useState<SalesMonthlySnapshot[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [servingOptions, setServingOptions] = useState<ServingOption[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, { category: SkuCategory, segment?: string }>>({});
  const [normalizationMap, setNormalizationMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  
  const [storeFilter, setStoreFilter] = useState('all');
  const [channelMode, setChannelMode] = useState<ItemChannelMode>('all');
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [analysisPeriod, setAnalysisPeriod] = useState<AnalysisPeriod>('custom');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [showSegmentDropdown, setShowSegmentDropdown] = useState(false);
  const [rankingMode, setRankingMode] = useState<'top' | 'bottom'>('top');
  const [rankingLimit, setRankingLimit] = useState(10);
  const [activeTab, setActiveTab] = useState<InsightTab>('matrix');
  
  const [hoveredBubble, setHoveredBubble] = useState<{ x: number, y: number, item: AggregatedItem } | null>(null);
  const [isMatrixFullscreen, setIsMatrixFullscreen] = useState(false);

  useEffect(() => {
    if (!isMatrixFullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setHoveredBubble(null); setIsMatrixFullscreen(false); } };
    window.addEventListener('keydown', onKey);
    // Stop the page behind the overlay from scrolling while it's open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; };
  }, [isMatrixFullscreen]);

  const fetchData = async () => {
    if (!user?.uid) return;
    setLoading(true);
    try {
      let constraints = [where('userId', '==', dataOwnerId)];
      
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
        getCachedCollection<StoreRental>('rentals', dataOwnerId),
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
      setRentals(rentalsArr);
      setItemCosts(costsArr);
      setServingOptions(servingArr);

      const normMap: Record<string, string> = {};
      normArr.forEach(data => {
        normMap[data.sourceName.trim().toUpperCase()] = data.masterName.trim().toUpperCase();
      });
      setNormalizationMap(normMap);

      const mappingObj: Record<string, { category: SkuCategory, segment?: string }> = {};
      skuArr.forEach(data => {
        mappingObj[data.itemName.trim().toUpperCase()] = { category: data.category, segment: data.segment };
      });
      setSkuMappings(mappingObj);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [user, selectedYear, selectedMonth, analysisPeriod]);

  const activeOutletOptions = useMemo(() => rentals.map(r => ({ id: r.outletId, name: r.storeName })), [rentals]);

  const intelligence = useMemo(() => {
    const filteredSnaps = snapshots.filter(s => storeFilter === 'all' || s.outletId === storeFilter);
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

    const itemMap: Record<string, { quantity: number; revenue: number; dailyTrend: number[]; outletQty: Record<string, number> }> = {};

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

    sortedSnaps.forEach(snap => {
      const slotIdx = getSlotIndex(snap);
      
      Object.entries(snap.items).forEach(([name, data]: [string, any]) => {
        const masterName = (normalizationMap[name.trim().toUpperCase()] || name).trim().toUpperCase();
        if (!itemMap[masterName]) itemMap[masterName] = { quantity: 0, revenue: 0, dailyTrend: new Array(historyLength).fill(0), outletQty: {} };

        const { qty: chQty, revenue: chRevenue } = getItemChannelValues(data, channelMode);
        itemMap[masterName].quantity += chQty;
        itemMap[masterName].revenue += chRevenue;
        itemMap[masterName].outletQty[snap.outletId] = (itemMap[masterName].outletQty[snap.outletId] || 0) + chQty;

        // dailyTrend has no per-channel breakdown in the schema — it always reflects
        // combined POS + online, regardless of channelMode. Trend/velocity charts
        // carry a note about this; quantity/revenue/margin figures above do not.
        const dTrend = Array.isArray(data.dailyTrend) ? data.dailyTrend : [];
        if (isSingleMonth) {
          dTrend.forEach((v: number, i: number) => {
            if (itemMap[masterName].dailyTrend[i] !== undefined) itemMap[masterName].dailyTrend[i] += v;
          });
        } else if (slotIdx !== -1) {
          itemMap[masterName].dailyTrend[slotIdx] += data.quantity;
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
        velocity: data.quantity/totalDays, history, trendStatus: status, 
        trendPercent: avgPrev > 0 ? ((avgRecent - avgPrev) / avgPrev) * 100 : 0,
        segment: mapping?.segment
      };
    }).filter(i => i.quantity > 0);

    const availableSegments = Array.from(new Set((Object.values(skuMappings) as { segment?: string }[]).map(m => m.segment).filter(Boolean))) as string[];
    const finalItems = aggregated.filter(i => selectedSegments.length === 0 || (i.segment && selectedSegments.includes(i.segment)));

    const medianQty = [...finalItems].sort((a, b) => a.quantity - b.quantity)[Math.floor(finalItems.length / 2)]?.quantity || 0;
    const medianMargin = [...finalItems].sort((a, b) => a.margin - b.margin)[Math.floor(finalItems.length / 2)]?.margin || 0;

    // Aggregated Market Basket (Merge pre-calculated combos from snapshots)
    const comboMap: Record<string, { items: string[], count: number, totalRevenue: number }> = {};
    filteredSnaps.forEach(snap => {
       (snap.combos || []).forEach(c => {
          // Check if all items in combo match the segment filter if active
          if (selectedSegments.length > 0) {
            const allMatch = c.items.every(item => {
              const masterName = (normalizationMap[item.trim().toUpperCase()] || item).trim().toUpperCase();
              const seg = skuMappings[masterName]?.segment;
              return seg && selectedSegments.includes(seg);
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
  }, [snapshots, storeFilter, channelMode, selectedMonth, itemCosts, normalizationMap, skuMappings, rentals, selectedSegments, rankingLimit]);

  // Per-item in-store vs online comparison. Online list prices are marked up to
  // absorb commission, so comparing raw prices is meaningless — the online side is
  // shown net of the aggregator's cut, which is the only basis on which the two
  // channels answer the same question.
  const channelComparison = useMemo(() => {
    const filteredSnaps = snapshots.filter(s => storeFilter === 'all' || s.outletId === storeFilter);
    const filteredSales = salesSnaps.filter(s => storeFilter === 'all' || s.outletId === storeFilter);
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
      };
    }).filter(r =>
      r.posQty > 0 && r.onlineQty > 0 &&
      (selectedSegments.length === 0 || (r.segment && selectedSegments.includes(r.segment)))
    ).sort((a, b) => a.gapPct - b.gapPct);

    return { rows, takePercent, requiredMarkupPct: takePercent < 100 ? (takePercent / (100 - takePercent)) * 100 : 0 };
  }, [snapshots, salesSnaps, storeFilter, itemCosts, normalizationMap, rentals, skuMappings, selectedSegments]);

  // Plain function rather than a component so the fullscreen and inline copies don't
  // remount (and lose hover state) on every parent render. labelCount rises in
  // fullscreen, where there's room to name far more bubbles without collisions.
  const renderMatrixSvg = (labelCount: number) => {
    if (!intelligence) return null;
    const PAD_L = 78, PAD_R = 26, PAD_T = 26, PAD_B = 54;
    const W = 1000 - PAD_L - PAD_R;
    const H = 460 - PAD_T - PAD_B;
    const maxQ = intelligence.maxQty || 1;
    const minM = Math.min(intelligence.minMargin, 0);
    const maxM = Math.max(intelligence.maxMargin, minM + 1);
    const x = (q: number) => PAD_L + (q / maxQ) * W;
    const y = (m: number) => PAD_T + (1 - (m - minM) / (maxM - minM)) * H;
    const cx = x(intelligence.medianQty);
    const cy = y(intelligence.medianMargin);
    const trendColor = (s: string) => s === 'rising' ? '#10b981' : (s === 'declining' ? '#f43f5e' : '#94a3b8');
    const byProfit = [...intelligence.items].sort((a, b) => (b.margin * b.quantity) - (a.margin * a.quantity));
    const labelled = new Set(byProfit.slice(0, labelCount).map(i => i.name));
    const quadrants = [
      { label: 'Puzzles', hint: 'Promote', qx: PAD_L + 8, qy: PAD_T + 20, color: '#6366f1' },
      { label: 'Stars', hint: 'Protect', qx: 1000 - PAD_R - 8, qy: PAD_T + 20, color: '#10b981', anchor: 'end' },
      { label: 'Dogs', hint: 'Cut or rework', qx: PAD_L + 8, qy: 460 - PAD_B - 10, color: '#f43f5e' },
      { label: 'Plow-horses', hint: 'Reprice / cut cost', qx: 1000 - PAD_R - 8, qy: 460 - PAD_B - 10, color: '#f59e0b', anchor: 'end' },
    ];

    return (
      <svg viewBox="0 0 1000 460" className="w-full h-full overflow-visible">
        <rect x={cx} y={PAD_T} width={Math.max(0, 1000 - PAD_R - cx)} height={Math.max(0, cy - PAD_T)} fill="#10b981" opacity="0.04" />
        <rect x={PAD_L} y={cy} width={Math.max(0, cx - PAD_L)} height={Math.max(0, 460 - PAD_B - cy)} fill="#f43f5e" opacity="0.04" />

        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={PAD_T + p * H} x2={1000 - PAD_R} y2={PAD_T + p * H} stroke="#e2e8f0" strokeWidth="1" />
            <text x={PAD_L - 10} y={PAD_T + p * H + 4} textAnchor="end" className="text-[11px] font-bold fill-slate-400">
              ₹{Math.round(maxM - p * (maxM - minM))}
            </text>
            <text x={PAD_L + p * W} y={460 - PAD_B + 22} textAnchor="middle" className="text-[11px] font-bold fill-slate-400">
              {Math.round(p * maxQ)}
            </text>
          </g>
        ))}

        {minM < 0 && <line x1={PAD_L} y1={y(0)} x2={1000 - PAD_R} y2={y(0)} stroke="#f43f5e" strokeWidth="1.5" strokeDasharray="2 3" />}
        <line x1={cx} y1={PAD_T} x2={cx} y2={460 - PAD_B} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" />
        <line x1={PAD_L} y1={cy} x2={1000 - PAD_R} y2={cy} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 4" />

        {quadrants.map(q => (
          <text key={q.label} x={q.qx} y={q.qy} textAnchor={(q.anchor as any) || 'start'} className="text-[13px] font-black uppercase tracking-widest" fill={q.color} opacity="0.55">
            {q.label}<tspan className="text-[10px] font-bold"> · {q.hint}</tspan>
          </text>
        ))}

        {byProfit.map((item, idx) => {
          const profit = item.margin * item.quantity;
          const r = 5 + Math.sqrt(Math.max(0, profit) / intelligence.maxProfitContribution) * 24;
          const px = x(item.quantity), py = y(item.margin);
          return (
            <g key={idx}>
              <circle
                cx={px} cy={py} r={r}
                fill={trendColor(item.trendStatus)} fillOpacity="0.28"
                stroke={trendColor(item.trendStatus)} strokeWidth="2"
                className="transition-all hover:fill-opacity-70 cursor-pointer"
                onMouseEnter={(e) => { const rect = e.currentTarget.getBoundingClientRect(); setHoveredBubble({ x: rect.left + rect.width / 2, y: rect.top, item }); }}
                onMouseLeave={() => setHoveredBubble(null)}
              />
              {labelled.has(item.name) && (
                <text x={px} y={py - r - 6} textAnchor="middle" className="text-[10px] font-black fill-slate-600 pointer-events-none">
                  {item.name.length > 18 ? `${item.name.slice(0, 18)}…` : item.name}
                </text>
              )}
            </g>
          );
        })}

        <text x={PAD_L + W / 2} y={458} textAnchor="middle" className="text-[11px] font-black uppercase tracking-widest fill-slate-400">Units Sold →</text>
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
              <option value="3m">Last 3 Months</option>
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
          
          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2"><MapPin size={14} className="text-emerald-500" /><select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} className="bg-transparent font-bold text-xs outline-none uppercase tracking-tight"><option value="all">All Units</option>{activeOutletOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>

          <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2" title="Quantity, revenue and margin respect this filter. Trend history, velocity, and combos have no per-channel breakdown in the data and always reflect combined POS + online."><Smartphone size={14} className="text-emerald-500" /><select value={channelMode} onChange={e => setChannelMode(e.target.value as ItemChannelMode)} className="bg-transparent font-bold text-xs outline-none uppercase tracking-tight">{CHANNEL_MODE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>

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
          <div className="flex items-center gap-2 bg-slate-200/40 p-1.5 rounded-[2rem] w-fit border border-slate-100 shadow-inner">{(['matrix', 'channels', 'ranking', 'profit', 'velocity', 'trends', 'combos', 'ledger'] as InsightTab[]).map((tab) => (<button key={tab} onClick={() => { setActiveTab(tab); setHoveredBubble(null); }} className={`px-6 py-2.5 rounded-[1.5rem] text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-600'}`}>{tab}</button>))}</div>
          
          <div className="mt-8">
            {activeTab === 'matrix' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in slide-in-from-bottom-4 duration-500">
                <section className="lg:col-span-9 bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm relative overflow-hidden">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
                    <div>
                      <h3 className="text-2xl font-black text-slate-900 tracking-tight">Menu Engineering Matrix</h3>
                      <p className="text-slate-400 text-sm font-medium">Popularity vs. Profitability — split at the median of each</p>
                    </div>
                    <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest">
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Rising</span>
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Declining</span>
                      <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Flat</span>
                      <span className="text-slate-400 normal-case font-bold">• bubble = total profit</span>
                      <button
                        onClick={() => { setHoveredBubble(null); setIsMatrixFullscreen(true); }}
                        title="Expand to full screen"
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-indigo-600 transition-all shadow-sm"
                      >
                        <Maximize2 size={12} /> Expand
                      </button>
                    </div>
                  </div>
                  <div className="relative w-full bg-slate-50 rounded-[2.5rem] p-6">
                    {renderMatrixSvg(8)}
                  </div>
                </section>
                <aside className="lg:col-span-3 bg-slate-900 p-8 rounded-[3rem] text-white shadow-xl flex flex-col justify-between"><div className="w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-6 text-indigo-400"><Info size={24}/></div><h4 className="text-sm font-black uppercase tracking-widest mb-4">Reading Master Metrics</h4><p className="text-slate-400 text-sm leading-relaxed mb-6">Service tiers are factored in: Tier 1 costs use disposable utensils while Tier 2 uses proper service items.</p><div className="p-6 bg-white/5 rounded-3xl border border-white/5"><p className="text-[10px] font-black uppercase text-indigo-400 mb-1">Theoretical Burn</p><p className="text-3xl font-black">₹{intelligence.totalTheoreticalCost.toLocaleString()}</p></div></aside>
              </div>
            )}
            
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
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50/80 border-b border-slate-100">
                            <tr>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Master SKU</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">In-Store ₹</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Online ₹</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right" title="Actual markup applied to the online list price versus the in-store price.">Markup</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right" title="Online list price less the aggregator's commission + GST on commission.">Online Net ₹</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">In-Store %</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Online % (Net)</th>
                              <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Gap</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {channelComparison.rows.map(r => {
                              const atParity = Math.abs(r.gapPct) <= 1;
                              const markupShort = r.markupPct < r.requiredMarkupPct - 1;
                              return (
                                <tr key={r.name} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="px-8 py-5">
                                    <p className="text-xs font-black text-slate-800 uppercase tracking-tight truncate max-w-[220px]">{r.name}</p>
                                    <p className="text-[9px] font-bold text-slate-400 uppercase">
                                      {r.posQty} in-store · {r.onlineQty} online{!r.hasCost && ' · no cost mapped'}
                                    </p>
                                  </td>
                                  <td className="px-8 py-5 text-right font-black text-slate-700">₹{r.posPrice.toFixed(0)}</td>
                                  <td className="px-8 py-5 text-right font-black text-slate-700">₹{r.onlinePrice.toFixed(0)}</td>
                                  <td className={`px-8 py-5 text-right font-black ${markupShort ? 'text-amber-600' : 'text-slate-500'}`} title={markupShort ? `Below the ${r.requiredMarkupPct.toFixed(1)}% needed for parity` : undefined}>
                                    {r.markupPct.toFixed(0)}%
                                  </td>
                                  <td className="px-8 py-5 text-right font-black text-amber-600">₹{r.onlineNet.toFixed(0)}</td>
                                  <td className="px-8 py-5 text-center font-black text-slate-700">{r.posMarginPct.toFixed(1)}%</td>
                                  <td className="px-8 py-5 text-center font-black text-slate-700">{r.onlineMarginPct.toFixed(1)}%</td>
                                  <td className="px-8 py-5 text-center">
                                    <span className={`inline-block px-3 py-1.5 rounded-full text-[10px] font-black tracking-tight ${atParity ? 'bg-emerald-50 text-emerald-600' : (r.gapPct < 0 ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600')}`}>
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

      {isMatrixFullscreen && intelligence && (
        <div className="fixed inset-0 z-[900] bg-slate-900/70 backdrop-blur-sm flex flex-col p-4 md:p-8 animate-in fade-in duration-200">
          <div className="bg-white rounded-[2.5rem] shadow-2xl flex-1 flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 px-8 py-5 border-b border-slate-100">
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight">Menu Engineering Matrix</h3>
                <p className="text-slate-400 text-xs font-medium">
                  Popularity vs. Profitability · {intelligence.items.length} SKUs · median {intelligence.medianQty} units / ₹{intelligence.medianMargin.toFixed(0)} margin
                </p>
              </div>
              <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Rising</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> Declining</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400" /> Flat</span>
                <span className="text-slate-400 normal-case font-bold">• bubble = total profit</span>
                <button
                  onClick={() => { setHoveredBubble(null); setIsMatrixFullscreen(false); }}
                  title="Close (Esc)"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white hover:bg-rose-600 transition-all shadow-sm"
                >
                  <CloseIcon size={12} /> Close
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 bg-slate-50 m-4 rounded-[2rem] p-6 flex">
              {renderMatrixSvg(30)}
            </div>
          </div>
        </div>
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
