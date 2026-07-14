
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getCachedCollection } from '../referenceCache';
import {
  ItemMonthlySnapshot,
  ExpenseMonthlySnapshot,
  ItemCost,
  SkuMapping,
  CogsAdjustment,
  getOutletName,
  MASTER_OUTLETS,
  CogsBucket,
  SkuCategory,
  DEFAULT_COGS,
  CategorySettings,
  StoreRental,
  MenuNormalization,
  YEAR_OPTIONS,
  MONTH_NAMES,
  WasteEntry,
  WasteType,
} from '../types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
  PieChart as RechartsPieChart, Pie, ComposedChart, Line,
} from 'recharts';
import {
  Zap,
  RefreshCw,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  ShoppingCart,
  ShoppingBag,
  Utensils,
  Coffee,
  Box,
  Grape,
  ArrowRight,
  Loader2,
  CalendarDays,
  Target,
  TrendingDown,
  Layers,
  Scale,
  Activity,
  Info,
  ChevronDown,
  LayoutGrid,
  List,
  SearchX,
  ArrowUpRight,
  ArrowDownRight,
  BarChartHorizontal,
  ChevronRight,
  ListFilter,
  PieChart,
  FileSearch,
  LayoutList,
  Filter,
  Users,
  SearchCode,
  DollarSign,
  Trash2,
  X,
  BarChart2,
  Download,
} from 'lucide-react';

type WasteTab = 'audit' | 'drift' | 'staff' | 'serving';

const PILLARS: { id: CogsBucket, label: string, icon: any, color: string, ring: string, hex: string }[] = [
  { id: 'FOOD', label: 'Food Ingredients', icon: Utensils, color: 'text-emerald-500', ring: 'ring-emerald-500', hex: '#10b981' },
  { id: 'DRINKS', label: 'Drinks Ingredients', icon: Coffee, color: 'text-indigo-500', ring: 'ring-indigo-500', hex: '#6366f1' },
  { id: 'FOOD SERVINGS', label: 'Food Packaging', icon: Box, color: 'text-amber-400', ring: 'ring-amber-500', hex: '#f59e0b' },
  { id: 'DRINKS SERVINGS', label: 'Drinks Packaging', icon: Grape, color: 'text-rose-500', ring: 'ring-rose-500', hex: '#f43f5e' }
];

const WasteManagementV2: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [itemSnaps, setItemSnaps] = useState<ItemMonthlySnapshot[]>([]);
  const [expenseSnaps, setExpenseSnaps] = useState<ExpenseMonthlySnapshot[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, { category: SkuCategory, segment?: string }>>({});
  const [normalizationMap, setNormalizationMap] = useState<Record<string, string>>({});
  const [adjustments, setAdjustments] = useState<CogsAdjustment[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  const [activeTab, setActiveTab] = useState<WasteTab>('audit');
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState(MONTH_NAMES[new Date().getMonth()]);
  const [storeFilter, setStoreFilter] = useState('all');
  const [activeDrilldown, setActiveDrilldown] = useState<'ingredients' | 'packaging'>('ingredients');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [staffChartView, setStaffChartView] = useState<'bar' | 'pie'>('bar');

  // --- Serving Waste state ---
  const [swEntries, setSwEntries] = useState<WasteEntry[]>([]);
  const [swLoading, setSwLoading] = useState(false);
  const [swError, setSwError] = useState<string | null>(null);
  const now = new Date();
  const [swYear, setSwYear] = useState(String(now.getFullYear()));
  const [swMonth, setSwMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [swOutlet, setSwOutlet] = useState('all');
  const [swType, setSwType] = useState<'all' | WasteType>('all');
  const [swExpanded, setSwExpanded] = useState<string | null>(null);
  const [swDeleting, setSwDeleting] = useState<string | null>(null);

  const fetchServingWaste = async () => {
    setSwLoading(true);
    setSwError(null);
    try {
      // Bounded read: only the selected month's entries (dates are ISO YYYY-MM-DD),
      // so cost stays constant as history grows instead of scanning all waste_entries.
      const start = `${swYear}-${swMonth}-01`;
      const end = `${swYear}-${swMonth}-31`;
      const snap = await getDocs(query(
        collection(db, 'waste_entries'),
        where('ownerId', '==', dataOwnerId),
        where('date', '>=', start),
        where('date', '<=', end),
      ));
      setSwEntries(snap.docs.map(d => ({ id: d.id, ...d.data() } as WasteEntry)));
    } catch (err: any) {
      setSwError(err?.message || 'Failed to load entries');
    } finally {
      setSwLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'serving') fetchServingWaste();
  }, [activeTab, swYear, swMonth]);

  const swFiltered = useMemo(() => {
    const monthStr = `${swYear}-${swMonth}`;
    return swEntries.filter(e => {
      if (!e.date.startsWith(monthStr)) return false;
      if (swOutlet !== 'all' && e.outletId !== swOutlet) return false;
      if (swType !== 'all' && !e.items.some(i => i.wasteType === swType)) return false;
      return true;
    });
  }, [swEntries, swYear, swMonth, swOutlet, swType]);

  // BUG-07 fix: when a type filter is active, only sum costs of matching items (not all items in the entry)
  const swTotalCost = useMemo(() => swFiltered.reduce((s, e) => s + e.items.filter(i => swType === 'all' || i.wasteType === swType).reduce((a, i) => a + i.totalCost, 0), 0), [swFiltered, swType]);
  const swExtraCost = useMemo(() => swFiltered.reduce((s, e) => s + e.items.filter(i => i.wasteType === 'extra_demand').reduce((a, i) => a + i.totalCost, 0), 0), [swFiltered]);
  const swBrokenCost = useMemo(() => swFiltered.reduce((s, e) => s + e.items.filter(i => i.wasteType === 'broken').reduce((a, i) => a + i.totalCost, 0), 0), [swFiltered]);

  const swCategoryBreakdown = useMemo(() => {
    const map: Record<string, { extra_demand: number; broken: number; total: number; extra_demand_qty: number; broken_qty: number; total_qty: number }> = {};
    swFiltered.forEach(e => e.items.forEach(item => {
      const key = item.itemName || item.servingOptionName;
      if (!map[key]) map[key] = { extra_demand: 0, broken: 0, total: 0, extra_demand_qty: 0, broken_qty: 0, total_qty: 0 };
      map[key][item.wasteType] += item.totalCost;
      map[key].total += item.totalCost;
      map[key][`${item.wasteType}_qty` as 'extra_demand_qty' | 'broken_qty'] += item.quantity;
      map[key].total_qty += item.quantity;
    }));
    return Object.entries(map).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);
  }, [swFiltered]);

  const swDailyTrend = useMemo(() => {
    const map: Record<string, number> = {};
    swFiltered.forEach(e => { const day = e.date.slice(8); map[day] = (map[day] || 0) + e.totalCost; });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([day, cost]) => ({ day: parseInt(day), cost: parseFloat(cost.toFixed(2)) }));
  }, [swFiltered]);

  const handleSwDelete = async (id: string) => {
    if (!confirm('Delete this waste entry?')) return;
    setSwDeleting(id);
    try {
      const { deleteDoc, doc: firestoreDoc } = await import('firebase/firestore');
      await deleteDoc(firestoreDoc(db, 'waste_entries', id));
      setSwEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) { console.error(err); }
    finally { setSwDeleting(null); }
  };

  const swFmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fetchPrerequisites = async () => {
    try {
      const [costsArr, skuArr, rentArr, normArr] = await Promise.all([
        getCachedCollection<ItemCost>('item_costs', dataOwnerId),
        getCachedCollection<SkuMapping>('sku_mappings', dataOwnerId),
        getCachedCollection<StoreRental>('rentals', dataOwnerId),
        getCachedCollection<MenuNormalization>('menu_normalization', dataOwnerId)
      ]);

      const latestCostsMap = new Map<string, ItemCost>();
      costsArr.forEach(data => {
        const key = (data.itemName || '').trim().toUpperCase();
        const existing = latestCostsMap.get(key);
        if (!existing || (data.updatedAt > existing.updatedAt)) {
          latestCostsMap.set(key, data);
        }
      });
      setItemCosts(Array.from(latestCostsMap.values()));
      setRentals(rentArr);

      const nMap: Record<string, string> = {};
      normArr.forEach(data => {
        nMap[data.sourceName.trim().toUpperCase()] = data.masterName.trim().toUpperCase();
      });
      setNormalizationMap(nMap);

      const mappingObj: Record<string, { category: SkuCategory, segment?: string }> = {};
      skuArr.forEach(data => {
        mappingObj[data.itemName.trim().toUpperCase()] = { category: data.category, segment: data.segment };
      });
      setSkuMappings(mappingObj);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { fetchPrerequisites(); }, [user]);

  const availableOutlets = useMemo(() => {
    const monthIdx = MONTH_NAMES.indexOf(selectedMonth);
    const yearNum = parseInt(selectedYear);
    const periodStart = new Date(yearNum, monthIdx, 1);
    return rentals.filter(r => {
      if (r.outletId === 'GLOBAL') return false;
      if (r.status === 'active') return true;
      if (r.status === 'closed' && r.closeDate) {
        return new Date(r.closeDate) >= periodStart;
      }
      return true;
    }).map(r => ({ id: r.outletId, name: r.storeName }));
  }, [rentals, selectedMonth, selectedYear]);

  const generateAudit = async () => {
    setLoading(true);
    try {
      const periodConstraints = [
        where('userId', '==', dataOwnerId),
        where('year', '==', selectedYear),
        where('month', '==', selectedMonth)
      ];
      const [iSnap, eSnap, adjSnap] = await Promise.all([
        getDocs(query(collection(db, 'item_snapshots'), ...periodConstraints)),
        getDocs(query(collection(db, 'expense_snapshots'), ...periodConstraints)),
        getDocs(query(collection(db, 'cogs_adjustments'), ...periodConstraints))
      ]);
      setItemSnaps(iSnap.docs.map(d => d.data() as ItemMonthlySnapshot));
      setExpenseSnaps(eSnap.docs.map(d => d.data() as ExpenseMonthlySnapshot));
      setAdjustments(adjSnap.docs.map(d => d.data() as CogsAdjustment));
      setHasGenerated(true);
    } catch (err) {
      console.error(err);
      alert("Audit generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const intelligence = useMemo(() => {
    if (!hasGenerated) return null;
    const currentActiveIds = availableOutlets.map(o => o.id);
    const filteredItemSnaps = itemSnaps.filter(s => storeFilter === 'all' ? currentActiveIds.includes(s.outletId) : s.outletId === storeFilter);
    const filteredExpSnaps = expenseSnaps.filter(s => storeFilter === 'all' ? currentActiveIds.includes(s.outletId) : s.outletId === storeFilter);
    const filteredAdjustments = adjustments.filter(a => storeFilter === 'all' ? currentActiveIds.includes(a.outletId) : a.outletId === storeFilter);

    const targets: Record<CogsBucket, number> = { 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 };
    const itemAnalysis: Record<string, { qty: number, revenue: number, category: SkuCategory, segment: string, theoreticalIng: number, theoreticalServ: number, hasCost: boolean }> = {};
    const staffItems: Record<string, { qty: number, potentialRevenue: number, theoreticalCost: number, segment: string, category: SkuCategory, hasCost: boolean }> = {};

    filteredItemSnaps.forEach(snap => {
      const rental = rentals.find(r => r.outletId === snap.outletId);
      const tier = rental?.tier || 'TIER_1';

      Object.entries(snap.items).forEach(([name, data]: [string, any]) => {
        const masterName = (normalizationMap[name.trim().toUpperCase()] || name).trim().toUpperCase();
        const costRec = itemCosts.find(c => (c.itemName || '').trim().toUpperCase() === masterName);
        const mapping = skuMappings[masterName] || { category: 'UNMAPPED', segment: 'UNMAPPED' };
        
        const ingUnitCost = costRec ? (Number(costRec.costPerUnit) || 0) : 0;
        let servUnitCost = 0;
        if (costRec) {
          servUnitCost = tier === 'TIER_1' ? (costRec.tier1ServingsCost ?? costRec.servingsCostPerUnit ?? 0) : (costRec.tier2ServingsCost ?? costRec.servingsCostPerUnit ?? 0);
        }

        const activeCategory = (mapping.category === 'UNMAPPED' && costRec) ? 'FOOD' : mapping.category;
        const qty = data.quantity || 0;

        if (activeCategory === 'FOOD') {
          targets['FOOD'] += (qty * ingUnitCost);
          targets['FOOD SERVINGS'] += (qty * servUnitCost);
        } else if (activeCategory === 'DRINKS') {
          targets['DRINKS'] += (qty * ingUnitCost);
          targets['DRINKS SERVINGS'] += (qty * servUnitCost);
        }

        if (!itemAnalysis[masterName]) itemAnalysis[masterName] = { qty: 0, revenue: 0, category: activeCategory as SkuCategory, segment: mapping.segment || 'UNMAPPED', theoreticalIng: 0, theoreticalServ: 0, hasCost: !!costRec };
        itemAnalysis[masterName].qty += qty;
        itemAnalysis[masterName].revenue += (data.revenue || 0);
        itemAnalysis[masterName].theoreticalIng += (qty * ingUnitCost);
        itemAnalysis[masterName].theoreticalServ += (qty * servUnitCost);

        // AGGREGATE STAFF CONSUMPTION (Now using snapshot fields)
        if (data.staffQuantity > 0) {
          if (!staffItems[masterName]) staffItems[masterName] = { qty: 0, potentialRevenue: 0, theoreticalCost: 0, segment: mapping.segment || 'UNMAPPED', category: mapping.category, hasCost: !!costRec };
          staffItems[masterName].qty += data.staffQuantity;
          staffItems[masterName].potentialRevenue += (data.staffPotentialRevenue || 0);
          staffItems[masterName].theoreticalCost += (data.staffTheoreticalCost || 0);
        }
      });
    });

    const staffDrilldown = Object.entries(staffItems).sort((a, b) => b[1].theoreticalCost - a[1].theoreticalCost);
    const actuals: Record<CogsBucket, number> = { 'FOOD': 0, 'DRINKS': 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0, 'UNCATEGORIZED': 0 };
    filteredExpSnaps.forEach(snap => {
      Object.entries(snap.cogsBucketAgg || {}).forEach(([bucket, amt]) => {
        if (actuals.hasOwnProperty(bucket)) actuals[bucket as CogsBucket] += Number(amt || 0);
        else actuals['UNCATEGORIZED'] += Number(amt || 0);
      });
    });

    const totalFoodIngOffset = filteredAdjustments.reduce((acc, a) => acc + (a.foodIngredientsAdjustment || 0), 0);
    const totalDrinkIngOffset = filteredAdjustments.reduce((acc, a) => acc + (a.drinkIngredientsAdjustment || 0), 0);
    const totalFoodPackOffset = filteredAdjustments.reduce((acc, a) => acc + (a.foodServingsAdjustment || 0), 0);
    const totalDrinkPackOffset = filteredAdjustments.reduce((acc, a) => acc + (a.drinkServingsAdjustment || 0), 0);

    actuals['FOOD'] = Math.max(0, actuals['FOOD'] - totalFoodIngOffset);
    actuals['DRINKS'] = Math.max(0, actuals['DRINKS'] - totalDrinkIngOffset);
    actuals['FOOD SERVINGS'] = Math.max(0, actuals['FOOD SERVINGS'] - totalFoodPackOffset);
    actuals['DRINKS SERVINGS'] = Math.max(0, actuals['DRINKS SERVINGS'] - totalDrinkPackOffset);

    const totalRevenue = Object.values(itemAnalysis).reduce((acc, i) => acc + i.revenue, 0);
    const totalUniqueProducts = Object.keys(itemAnalysis).length;
    const unmappedProductCount = Object.values(itemAnalysis).filter(i => !i.hasCost).length;
    const unmappedSkuPercent = totalUniqueProducts > 0 ? (unmappedProductCount / totalUniqueProducts) * 100 : 0;
    
    // Revenue coverage per category
    const coverageByBucket: Record<string, number> = { 'FOOD': 1, 'DRINKS': 1, 'FOOD SERVINGS': 1, 'DRINKS SERVINGS': 1 };
    ['FOOD', 'DRINKS'].forEach(cat => {
      const catItems = Object.values(itemAnalysis).filter(i => i.category === cat);
      const catRev = catItems.reduce((acc, i) => acc + i.revenue, 0);
      const mappedCatRev = catItems.filter(i => i.hasCost).reduce((acc, i) => acc + i.revenue, 0);
      const coverage = catRev > 0 ? mappedCatRev / catRev : 1;
      coverageByBucket[cat] = coverage;
      coverageByBucket[`${cat} SERVINGS`] = coverage;
    });

    const pillarMetrics = PILLARS.map(p => {
      const actual = Math.max(0, actuals[p.id] || 0);
      const theoretical = targets[p.id] || 0;
      const coverage = coverageByBucket[p.id] || 1;
      
      // Adjusted Actual: We only compare the portion of the actual cost that corresponds to mapped revenue
      const adjustedActual = actual * coverage;
      const variance = Math.max(0, adjustedActual - theoretical);
      const leakage = adjustedActual > 0 ? (variance / adjustedActual) * 100 : 0;
      
      return { ...p, actual, theoretical, variance, leakage, coveragePct: coverage * 100 };
    });

    const totalActualCOGS = Object.values(actuals).reduce((a, b) => a + (b || 0), 0);
    const totalTheoreticalCOGS = Object.values(targets).reduce((a, b) => a + (b || 0), 0);
    
    const ingMappedActual = (actuals['FOOD'] * coverageByBucket['FOOD']) + (actuals['DRINKS'] * coverageByBucket['DRINKS']);
    const packMappedActual = (actuals['FOOD SERVINGS'] * coverageByBucket['FOOD SERVINGS']) + (actuals['DRINKS SERVINGS'] * coverageByBucket['DRINKS SERVINGS']);
    
    const ingWaste = Math.max(0, ingMappedActual - (targets['FOOD'] + targets['DRINKS']));
    const packWaste = Math.max(0, packMappedActual - (targets['FOOD SERVINGS'] + targets['DRINKS SERVINGS']));
    const coverageGap = totalActualCOGS - (ingMappedActual + packMappedActual);
    const totalWastage = ingWaste + packWaste;

    return { 
      pillarMetrics, totalActual: totalActualCOGS, totalTheoretical: totalTheoreticalCOGS, totalRevenue, totalWastage, 
      unmappedSkuPercent, unmappedProductCount,
      itemDrilldown: Object.entries(itemAnalysis).filter(([_, d]) => d.category !== 'MISC' && d.qty > 0 && (segmentFilter === 'all' || d.segment === segmentFilter)).sort((a,b) => (activeDrilldown === 'ingredients' ? b[1].theoreticalIng - a[1].theoreticalIng : b[1].theoreticalServ - a[1].theoreticalServ)),
      availableSegments: Array.from(new Set(Object.values(itemAnalysis).map(i => i.segment))).filter(Boolean).sort(),
      staffDrilldown,
      waterfall: [
        { label: 'Gross Yield', val: totalRevenue, color: '#1e293b', isPositive: true },
        { label: 'Ing. Costs', val: targets['FOOD'] + targets['DRINKS'], color: '#6366f1', isPositive: false },
        { label: 'Ing. Waste', val: ingWaste, color: '#f43f5e', isPositive: false },
        { label: 'Pack. Costs', val: targets['FOOD SERVINGS'] + targets['DRINKS SERVINGS'], color: '#f59e0b', isPositive: false },
        { label: 'Pack. Waste', val: packWaste, color: '#fb7185', isPositive: false },
        { label: 'Coverage Gap', val: coverageGap, color: '#94a3b8', isPositive: false },
        { label: 'Realized Margin', val: Math.max(0, totalRevenue - totalActualCOGS), color: '#10b981', isPositive: true, isFinal: true }
      ]
    };
  }, [itemSnaps, expenseSnaps, itemCosts, skuMappings, normalizationMap, adjustments, hasGenerated, storeFilter, selectedMonth, selectedYear, rentals, activeDrilldown, segmentFilter, availableOutlets]);

  const exportAuditPDF = useCallback(() => {
    if (!intelligence) return;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const scopeLabel = storeFilter === 'all' ? 'All Active Outlets' : (availableOutlets.find(o => o.id === storeFilter)?.name ?? storeFilter);
    const periodLabel = `${selectedMonth} ${selectedYear}`;
    const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const retentionRate = ((Math.max(0, intelligence.totalRevenue - intelligence.totalActual) / (intelligence.totalRevenue || 1)) * 100).toFixed(1);

    // ── Header band ─────────────────────────────────────────────────
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 210, 42, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(17);
    doc.setTextColor(255, 255, 255);
    doc.text('WASTE RADAR v2 — EXECUTIVE AUDIT', 14, 16);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(`Scope: ${scopeLabel}  |  Period: ${periodLabel}  |  Generated: ${dateStr}`, 14, 25);
    doc.text('Multi-Pillar Material Reconciliation  •  Confidential', 14, 32);

    // ── KPI summary row ──────────────────────────────────────────────
    const kpis = [
      { label: 'Gross Revenue', val: `₹${Math.round(intelligence.totalRevenue).toLocaleString()}` },
      { label: 'Actual COGS', val: `₹${Math.round(intelligence.totalActual).toLocaleString()}` },
      { label: 'Theoretical COGS', val: `₹${Math.round(intelligence.totalTheoretical).toLocaleString()}` },
      { label: 'Total Drift / Waste', val: `₹${Math.round(intelligence.totalWastage).toLocaleString()}` },
      { label: 'Retention Rate', val: `${retentionRate}%` },
    ];
    const kpiW = (210 - 28) / kpis.length;
    kpis.forEach((k, i) => {
      const x = 14 + i * kpiW;
      doc.setFillColor(i === 3 ? 255 : (i === 4 ? 240 : 248), i === 3 ? 241 : (i === 4 ? 253 : 250), i === 3 ? 242 : (i === 4 ? 244 : 252));
      doc.roundedRect(x, 47, kpiW - 2, 18, 3, 3, 'F');
      doc.setFontSize(6.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 116, 139);
      doc.text(k.label.toUpperCase(), x + (kpiW - 2) / 2, 53, { align: 'center' });
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(i === 3 ? 239 : (i === 4 ? 5 : 30), i === 3 ? 68 : (i === 4 ? 150 : 27), i === 3 ? 68 : (i === 4 ? 105 : 75));
      doc.text(k.val, x + (kpiW - 2) / 2, 61, { align: 'center' });
    });

    // ── Pillar Metrics table ─────────────────────────────────────────
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 27, 75);
    doc.text('PILLAR PERFORMANCE BREAKDOWN', 14, 74);

    autoTable(doc, {
      head: [['Pillar', 'Actual Spend', 'Target Burn', 'Variance', 'Leakage %', 'Coverage %']],
      body: intelligence.pillarMetrics.map(p => [
        p.label,
        `₹${Math.round(p.actual).toLocaleString()}`,
        `₹${Math.round(p.theoretical).toLocaleString()}`,
        `₹${Math.round(p.variance).toLocaleString()}`,
        `${p.leakage.toFixed(1)}%`,
        `${p.coveragePct.toFixed(0)}%`,
      ]),
      startY: 77,
      styles: { fontSize: 8, cellPadding: 3.5, font: 'helvetica' },
      headStyles: { fillColor: [79, 70, 229], textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { fontStyle: 'bold', textColor: [30, 27, 75] },
        1: { halign: 'center' },
        2: { halign: 'center' },
        3: { halign: 'center' },
        4: { halign: 'center' },
        5: { halign: 'center' },
      },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const val = parseFloat(String(data.cell.raw).replace('%', ''));
          if (val > 8) data.cell.styles.textColor = [239, 68, 68];
          else data.cell.styles.textColor = [5, 150, 105];
        }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    const afterPillars = (doc as any).lastAutoTable?.finalY ?? 140;

    // ── Strategic Yield Waterfall table ─────────────────────────────
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 27, 75);
    doc.text('STRATEGIC YIELD WATERFALL', 14, afterPillars + 10);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('Revenue erosion audit — snapshot aggregated data', 14, afterPillars + 16);

    let runningBalance = intelligence.totalRevenue;
    const waterfallRows = intelligence.waterfall.map((step, i) => {
      let display: string;
      if (i === 0) {
        display = `₹${Math.round(step.val).toLocaleString()}`;
        runningBalance = step.val;
      } else if (step.isFinal) {
        display = `₹${Math.round(step.val).toLocaleString()}`;
      } else {
        runningBalance -= step.val;
        display = `₹${Math.round(step.val).toLocaleString()}`;
      }
      const pct = intelligence.totalRevenue > 0 ? ((step.val / intelligence.totalRevenue) * 100).toFixed(1) + '%' : '—';
      return [step.label, display, pct, step.isFinal ? `₹${Math.round(step.val).toLocaleString()}` : (i === 0 ? display : `₹${Math.round(runningBalance + step.val - step.val).toLocaleString()}`)];
    });

    autoTable(doc, {
      head: [['Step', 'Amount (₹)', '% of Revenue', 'Running Balance']],
      body: intelligence.waterfall.map((step, i) => {
        let runBal = 0;
        let cumulative = intelligence.totalRevenue;
        for (let j = 0; j <= i; j++) {
          const s = intelligence.waterfall[j];
          if (j === 0) cumulative = s.val;
          else if (!s.isFinal) cumulative -= s.val;
          else cumulative = s.val;
        }
        const pct = intelligence.totalRevenue > 0 ? ((step.val / intelligence.totalRevenue) * 100).toFixed(1) + '%' : '—';
        return [
          step.label,
          `${step.isPositive ? '' : '−'}₹${Math.round(step.val).toLocaleString()}`,
          pct,
          `₹${Math.round(cumulative).toLocaleString()}`,
        ];
      }),
      startY: afterPillars + 19,
      styles: { fontSize: 8, cellPadding: 3.5, font: 'helvetica' },
      headStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold', halign: 'center' },
      columnStyles: {
        0: { fontStyle: 'bold' },
        1: { halign: 'right' },
        2: { halign: 'center' },
        3: { halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const step = intelligence.waterfall[data.row.index];
          if (step?.isFinal) {
            data.cell.styles.fillColor = [236, 253, 245];
            data.cell.styles.textColor = [5, 150, 105];
            data.cell.styles.fontStyle = 'bold';
          } else if (!step?.isPositive && data.column.index === 1) {
            data.cell.styles.textColor = [239, 68, 68];
          }
        }
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    const finalY = (doc as any).lastAutoTable?.finalY ?? 250;
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text('Neko Metric  |  Waste Radar v2  |  Confidential — Internal Use Only', 14, finalY + 10);

    doc.save(`Waste-Radar-Executive-Audit-${scopeLabel.replace(/\s+/g, '-')}-${periodLabel.replace(/\s/g, '-')}.pdf`);
  }, [intelligence, storeFilter, availableOutlets, selectedMonth, selectedYear]);

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100"><Zap size={28} /></div>
          <div><h2 className="text-3xl font-black text-slate-900 tracking-tight">Waste Radar <span className="text-indigo-600">v2</span></h2><p className="text-slate-400 text-sm font-medium uppercase tracking-widest flex items-center gap-2"><RefreshCw size={14} className="text-indigo-400" /> Multi-Pillar Material Reconciliation</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-[2rem] border border-slate-100 shadow-sm">
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-100"><MapPin size={14} className="text-indigo-500" /><select value={storeFilter} onChange={e => { setStoreFilter(e.target.value); setHasGenerated(false); }} className="bg-transparent font-bold text-xs outline-none uppercase cursor-pointer"><option value="all">All Active Outlets</option>{availableOutlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div className="bg-slate-50 px-4 py-2 rounded-xl flex items-center gap-2 border border-slate-100"><CalendarDays size={14} className="text-indigo-500" /><select value={selectedMonth} onChange={e => { setSelectedMonth(e.target.value); setHasGenerated(false); }} className="bg-transparent font-bold text-xs outline-none uppercase cursor-pointer">{MONTH_NAMES.map(m => <option key={m} value={m}>{m}</option>)}</select><select value={selectedYear} onChange={e => { setSelectedYear(e.target.value); setHasGenerated(false); }} className="bg-transparent font-bold text-xs outline-none cursor-pointer">{YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}</select></div>
          <button onClick={generateAudit} disabled={loading} className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-indigo-700 transition-all shadow-lg"><Activity size={14} /> Run Audit</button>
        </div>
      </header>

      {/* Tab bar — always visible; serving waste tab works independently of audit */}
      <div className="flex flex-wrap bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner gap-1">
        <button onClick={() => setActiveTab('audit')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'audit' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><PieChart size={16}/> Executive Audit</button>
        <button onClick={() => setActiveTab('drift')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'drift' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><LayoutList size={16}/> SKU Drift</button>
        <button onClick={() => setActiveTab('staff')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'staff' ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Users size={16}/> Staff Consumption</button>
        <button onClick={() => setActiveTab('serving')} className={`px-8 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'serving' ? 'bg-white text-rose-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}><Trash2 size={16}/> Serving Waste</button>
      </div>

      {activeTab === 'serving' ? (
        /* ── SERVING WASTE TAB ─────────────────────────────────── */
        <div className="animate-in fade-in duration-500 space-y-6">
          {/* Filters */}
          <div className="bg-white border border-slate-100 rounded-3xl p-5 shadow-sm flex flex-wrap items-center gap-3">
            <Filter size={14} className="text-slate-400 shrink-0" />
            <div className="relative">
              <select value={swYear} onChange={e => setSwYear(e.target.value)} className="h-10 pl-4 pr-8 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black text-slate-700 appearance-none outline-none uppercase">
                {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
            </div>
            <div className="relative">
              <select value={swMonth} onChange={e => setSwMonth(e.target.value)} className="h-10 pl-4 pr-8 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black text-slate-700 appearance-none outline-none uppercase">
                {MONTH_NAMES.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
            </div>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
              <select value={swOutlet} onChange={e => setSwOutlet(e.target.value)} className="h-10 pl-8 pr-8 bg-slate-50 border border-slate-200 rounded-2xl text-[11px] font-black text-slate-700 appearance-none outline-none uppercase">
                <option value="all">All Outlets</option>
                {MASTER_OUTLETS.filter(o => o.id !== 'GLOBAL').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={12} />
            </div>
            <div className="flex bg-slate-50 border border-slate-200 p-1 rounded-2xl gap-1">
              {(['all', 'extra_demand', 'broken'] as const).map(t => (
                <button key={t} onClick={() => setSwType(t)} className={`h-8 px-4 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${swType === t ? (t === 'broken' ? 'bg-orange-500 text-white' : t === 'extra_demand' ? 'bg-rose-500 text-white' : 'bg-slate-700 text-white') : 'text-slate-400'}`}>
                  {t === 'all' ? 'All' : t === 'extra_demand' ? 'Extra Demand' : 'Broken'}
                </button>
              ))}
            </div>
            <button onClick={fetchServingWaste} className="ml-auto h-10 w-10 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors">
              <RefreshCw size={16} className={swLoading ? 'animate-spin' : ''} />
            </button>
          </div>

          {swError && (
            <div className="flex items-center gap-3 px-5 py-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-700 text-sm font-medium">
              <AlertTriangle size={16} className="shrink-0 text-rose-500" /> {swError}
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Total Waste Cost</p>
              <p className="text-3xl font-black text-slate-900 tracking-tighter">₹{swFmt(swTotalCost)}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1">{swFiltered.length} entr{swFiltered.length !== 1 ? 'ies' : 'y'}</p>
            </div>
            <div className="bg-rose-50 border border-rose-100 rounded-3xl p-6">
              <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest mb-2">Extra Demand</p>
              <p className="text-3xl font-black text-rose-700 tracking-tighter">₹{swFmt(swExtraCost)}</p>
              <p className="text-[10px] font-bold text-rose-400 mt-1">{swTotalCost > 0 ? ((swExtraCost / swTotalCost) * 100).toFixed(1) : '0'}% of waste</p>
            </div>
            <div className="bg-orange-50 border border-orange-100 rounded-3xl p-6">
              <p className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-2">Broken / Damaged</p>
              <p className="text-3xl font-black text-orange-700 tracking-tighter">₹{swFmt(swBrokenCost)}</p>
              <p className="text-[10px] font-bold text-orange-400 mt-1">{swTotalCost > 0 ? ((swBrokenCost / swTotalCost) * 100).toFixed(1) : '0'}% of waste</p>
            </div>
          </div>

          {swFiltered.length === 0 && !swLoading && !swError && (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-300 bg-white rounded-3xl border border-slate-100">
              <SearchX size={40} />
              <p className="text-sm font-black uppercase tracking-widest">No waste entries for this period</p>
            </div>
          )}

          {swCategoryBreakdown.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <BarChart2 size={16} className="text-rose-500" />
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Waste by Item</h3>
                </div>
                <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-400 inline-block" />Extra Demand ₹</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block" />Broken ₹</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-indigo-400 inline-block" />Total Qty</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={swCategoryBreakdown} margin={{ top: 4, right: 40, left: -10, bottom: 40 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fontWeight: 700, fill: '#475569' }} interval={0} angle={-30} textAnchor="end" height={50} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="cost" tick={{ fontSize: 9, fill: '#94a3b8' }} tickFormatter={v => `₹${v}`} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="qty" orientation="right" tick={{ fontSize: 9, fill: '#818cf8' }} tickFormatter={v => `${v}u`} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number, key: string) => key === 'Total Qty' ? [`${v} units`, key] : [`₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, key]} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700 }} />
                  <Bar yAxisId="cost" dataKey="extra_demand" name="Extra Demand" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={32} fillOpacity={0.85} />
                  <Bar yAxisId="cost" dataKey="broken" name="Broken" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={32} fillOpacity={0.85} />
                  <Line yAxisId="qty" type="monotone" dataKey="total_qty" name="Total Qty" stroke="#6366f1" strokeWidth={2} dot={{ r: 4, fill: '#6366f1', strokeWidth: 0 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {swDailyTrend.length > 1 && (
            <div className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-5">
                <TrendingDown size={16} className="text-rose-500" />
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Daily Waste Cost — {MONTH_NAMES[parseInt(swMonth) - 1]} {swYear}</h3>
              </div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={swDailyTrend} margin={{ top: 4, right: 4, left: -10, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `₹${v}`} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [`₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Cost']} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700 }} />
                  <Bar dataKey="cost" fill="#f43f5e" radius={[4, 4, 0, 0]} fillOpacity={0.8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Entry list */}
          {swFiltered.length > 0 && (
            <div className="bg-white border border-slate-100 rounded-3xl shadow-sm overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">All Entries</h3>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{swFiltered.length} record{swFiltered.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {[...swFiltered].sort((a, b) => b.createdAt - a.createdAt).map(entry => {
                  const extraCost = entry.items.filter(i => i.wasteType === 'extra_demand').reduce((s, i) => s + i.totalCost, 0);
                  const brknCost = entry.items.filter(i => i.wasteType === 'broken').reduce((s, i) => s + i.totalCost, 0);
                  const isOpen = swExpanded === entry.id;
                  return (
                    <div key={entry.id}>
                      <div className="flex items-center gap-4 px-6 py-4 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => setSwExpanded(isOpen ? null : (entry.id ?? null))}>
                        <div className="p-2.5 bg-rose-100 rounded-xl shrink-0"><Trash2 size={14} className="text-rose-600" /></div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-black text-slate-900">{entry.date}</p>
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded-full">{getOutletName(entry.outletId)}</span>
                            <span className="text-[9px] font-bold text-slate-400">{entry.items.length} item{entry.items.length !== 1 ? 's' : ''}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-1">
                            {extraCost > 0 && <span className="text-[10px] font-bold text-rose-500">Demand ₹{swFmt(extraCost)}</span>}
                            {brknCost > 0 && <span className="text-[10px] font-bold text-orange-500">Broken ₹{swFmt(brknCost)}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <p className="text-base font-black text-slate-900">₹{swFmt(entry.totalCost)}</p>
                          <button onClick={e => { e.stopPropagation(); entry.id && handleSwDelete(entry.id); }} disabled={swDeleting === entry.id} className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors rounded-xl disabled:opacity-50">
                            {swDeleting === entry.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                          </button>
                          <ChevronRight size={14} className={`text-slate-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                        </div>
                      </div>
                      {isOpen && (
                        <div className="px-6 pb-5 bg-slate-50 border-t border-slate-100 pt-4 space-y-2">
                          {entry.items.map((item, idx) => (
                            <div key={idx} className="flex items-center justify-between gap-3 bg-white border border-slate-100 rounded-2xl px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-sm font-black text-slate-900 uppercase truncate">{item.itemName || item.servingOptionName}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {item.itemName && <span className="text-[9px] font-bold text-slate-400 uppercase">{item.servingOptionName}</span>}
                                  <span className="text-[10px] font-bold text-slate-500">{item.quantity} × ₹{item.costPerUnit}</span>
                                  <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${item.wasteType === 'broken' ? 'bg-orange-100 text-orange-600' : 'bg-rose-100 text-rose-600'}`}>{item.wasteType === 'extra_demand' ? 'Extra Demand' : 'Broken'}</span>
                                </div>
                              </div>
                              <p className="text-sm font-black text-slate-900 shrink-0">₹{swFmt(item.totalCost)}</p>
                            </div>
                          ))}
                          {entry.notes && <p className="text-[11px] font-medium text-slate-500 italic px-1">"{entry.notes}"</p>}
                          <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest px-1">Submitted by {entry.submittedBy} · {new Date(entry.createdAt).toLocaleString('en-IN')}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

      ) : !hasGenerated ? (
        <section className="py-40 bg-white rounded-[3.5rem] border-2 border-dashed border-slate-200 text-center animate-in zoom-in-95"><div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-8 text-indigo-300"><Layers size={48} /></div><h3 className="text-3xl font-black text-slate-900 tracking-tight">Performance Aggregation Active</h3><p className="text-slate-500 mt-3 font-medium max-w-md mx-auto leading-relaxed uppercase tracking-widest text-[10px]">Select scope and run audit to view relational drift.</p></section>
      ) : intelligence && (
        <div className="animate-in fade-in duration-500 space-y-12">

           {intelligence.unmappedProductCount > 0 && (
             <div className="bg-rose-50 border border-rose-100 p-6 rounded-[2rem] flex items-center gap-5 slide-in-from-top-4 animate-in duration-500">
               <div className="p-3 bg-rose-500 text-white rounded-2xl shadow-lg shadow-rose-200">
                 <AlertTriangle size={20} />
               </div>
               <div className="flex-1">
                 <h4 className="text-sm font-black text-rose-900 uppercase tracking-tight">{intelligence.unmappedSkuPercent.toFixed(1)}% of SKUs have no cost assigned</h4>
                 <p className="text-rose-600 text-xs font-medium">Fix {intelligence.unmappedProductCount} items in <strong>Item Costs</strong> to improve reconciliation accuracy and remove drift noise.</p>
               </div>
               <button onClick={() => setActiveTab('drift')} className="px-6 py-2.5 bg-rose-100 text-rose-700 rounded-xl font-black uppercase text-[10px] tracking-widest hover:bg-rose-200 transition-all">Identify Items</button>
             </div>
           )}

           {activeTab === 'audit' && (
             <div className="space-y-12 animate-in slide-in-from-left-4 duration-500">
                <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                  {intelligence.pillarMetrics.map((p) => (
                    <div key={p.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm flex flex-col justify-between group hover:shadow-xl transition-all hover:-translate-y-1">
                      <div className="flex justify-between items-start mb-6">
                        <div className={`p-3 rounded-2xl bg-slate-50 ${p.color} shadow-inner`}><p.icon size={20} /></div>
                        <div className="flex flex-col items-end gap-1.5">
                          <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${p.leakage > 8 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                            {(p.leakage ?? 0).toFixed(1)}% Leakage
                          </div>
                          <div className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-tight ${p.coveragePct < 90 ? 'text-amber-500 bg-amber-50' : 'text-slate-400 bg-slate-50'}`}>
                            {p.coveragePct.toFixed(0)}% Coverage
                          </div>
                        </div>
                      </div>
                      <div><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{p.label}</p><h4 className="text-3xl font-black text-slate-900 tracking-tighter">₹{(p.actual ?? 0).toLocaleString()}</h4><div className="mt-4 space-y-2"><div className="flex justify-between text-[9px] font-bold uppercase tracking-tight"><span className="text-slate-400">Target Burn</span><span className="text-slate-700">₹{(p.theoretical ?? 0).toLocaleString()}</span></div><div className="h-1.5 bg-slate-100 rounded-full overflow-hidden shadow-inner"><div className={`h-full rounded-full transition-all duration-1000 ${p.leakage > 8 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(5, 100 - (p.leakage * 5))}%` }} /></div></div></div>
                    </div>
                  ))}
                </section>
                <section className="bg-white p-12 rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden">
                  <div className="flex flex-col md:flex-row md:items-center justify-between mb-16 gap-8">
                    <div><h3 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3"><BarChartHorizontal className="text-indigo-600" /> Strategic Yield Waterfall</h3><p className="text-slate-400 text-sm font-medium mt-1 uppercase tracking-widest">Revenue Erosion Audit: Snapshot Aggregated Data</p></div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-10 bg-slate-50 p-6 rounded-[2rem] border border-slate-100 shadow-inner">
                          <div className="text-center"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total Drift (Waste)</p><p className="text-2xl font-black text-rose-500">₹{(intelligence.totalWastage ?? 0).toLocaleString()}</p></div>
                          <div className="h-10 w-px bg-slate-200" /><div className="text-center"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Retention Rate</p><p className="text-2xl font-black text-emerald-600">{((Math.max(0, intelligence.totalRevenue - intelligence.totalActual) / (intelligence.totalRevenue || 1)) * 100).toFixed(1)}%</p></div>
                      </div>
                      <button onClick={exportAuditPDF} className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 hover:bg-slate-700 active:scale-95 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-md transition-all shrink-0">
                        <Download size={13} /> Export PDF
                      </button>
                    </div>
                  </div>
                  <div className="relative w-full h-[400px]"><svg viewBox="0 0 1000 400" className="w-full h-full overflow-visible" preserveAspectRatio="none">{[0, 0.5, 1].map((p, idx) => (<line key={idx} x1="60" y1={350 - (p * 300)} x2="950" y2={350 - (p * 300)} stroke="#f1f5f9" strokeWidth="1" />))}<line x1="60" y1={350} x2="950" y2={350} stroke="#e2e8f0" strokeWidth="2" />{(() => { const max = intelligence.totalRevenue || 1; const steps = intelligence.waterfall; const barWidth = 100; const spacing = (890 - steps.length * barWidth) / (steps.length + 1); let currentBaseline = 0; return steps.map((step, i) => { const x = 60 + spacing + i * (barWidth + spacing); let y, height; if (i === 0) { const vH = (step.val / max) * 300; y = 350 - vH; height = vH; currentBaseline = step.val; } else if (step.isFinal) { const vH = (step.val / max) * 300; y = 350 - vH; height = vH; } else { const sV = currentBaseline; const eV = currentBaseline - step.val; const sY = 350 - (sV / max) * 300; const eY = 350 - (eV / max) * 300; y = Math.min(sY, eY); height = Math.max(4, Math.abs(sY - eY)); currentBaseline = eV; } return (<g key={i} className="group"><rect x={x} y={y} width={barWidth} height={height} fill={step.color} rx="8" className="transition-all duration-1000 ease-out hover:opacity-80 shadow-md" /><text x={x + barWidth/2} y="380" textAnchor="middle" className="text-[10px] font-black fill-slate-400 uppercase tracking-tighter">{step.label}</text><text x={x + barWidth/2} y={y - 12} textAnchor="middle" className={`text-[11px] font-black ${step.isPositive ? 'fill-slate-900' : 'fill-rose-500'}`}>{step.isPositive ? '' : '-'}{Math.round(step.val).toLocaleString()}</text>{i > 0 && !step.isFinal && (<line x1={x - spacing} y1={y} x2={x} y2={y} stroke="#e2e8f0" strokeDasharray="4 4" />)}</g>); }); })()}</svg></div>
                </section>
             </div>
           )}

           {activeTab === 'drift' && (
             <section className="bg-white rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden animate-in slide-in-from-right-4 duration-500">
                <div className="p-12 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-8 bg-slate-50/50">
                  <div className="flex items-center gap-4"><div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><List size={28}/></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Theoretical SKU Drift</h3><p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Snapshot Aggregated Multi-layer Audit</p></div></div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="bg-white px-4 py-2 rounded-xl border border-slate-100 shadow-sm flex items-center gap-2"><Filter size={14} className="text-indigo-500" /><select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} className="bg-transparent font-bold text-[10px] outline-none uppercase cursor-pointer min-w-[120px]"><option value="all">All Segments</option>{intelligence.availableSegments.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                    <div className="flex bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm"><button onClick={() => setActiveDrilldown('ingredients')} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeDrilldown === 'ingredients' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-500'}`}><Utensils size={14}/> Ingredients</button><button onClick={() => setActiveDrilldown('packaging')} className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${activeDrilldown === 'packaging' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-500'}`}><Box size={14}/> Packaging</button></div>
                  </div>
                </div>
                <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="bg-slate-50/80 border-b border-slate-100"><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Menu Item SKU</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Unit Sales</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Target Burn</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Revenue Yield</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Audit Status</th></tr></thead><tbody className="divide-y divide-slate-50">{intelligence.itemDrilldown.map(([name, data]) => { const theoreticalCost = activeDrilldown === 'ingredients' ? data.theoreticalIng : data.theoreticalServ; return (<tr key={name} className="group hover:bg-slate-50/50 transition-colors"><td className="px-12 py-6"><div className="flex items-center gap-4"><div className={`p-2 rounded-xl text-white ${data.category === 'FOOD' ? 'bg-emerald-500' : 'bg-indigo-500'}`}>{data.category === 'FOOD' ? <Utensils size={12}/> : <Coffee size={12}/>}</div><div><p className="text-sm font-black text-slate-900 uppercase tracking-tight">{name}</p><p className="text-[9px] font-bold text-slate-400 uppercase">{data.segment} • {data.category} DIVISION</p></div></div></td><td className="px-12 py-6 text-center font-black text-slate-600">{data.qty}</td><td className="px-12 py-6 text-right font-black text-slate-900">₹{Math.round(theoreticalCost).toLocaleString()}</td><td className="px-12 py-6 text-right font-black text-indigo-600">₹{Math.round(data.revenue).toLocaleString()}</td><td className="px-12 py-6"><div className="flex justify-center">{data.hasCost ? <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase tracking-widest"><CheckCircle2 size={12}/> Mapped</div> : <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-500 rounded-full text-[9px] font-black uppercase animate-pulse"><AlertTriangle size={12}/> Unlinked</div>}</div></td></tr>); })}</tbody></table></div>
             </section>
           )}

           {activeTab === 'staff' && (
             <section className="bg-white rounded-[3.5rem] border border-slate-100 shadow-sm overflow-hidden animate-in zoom-in-95 duration-500">
                <div className="p-12 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-8 bg-slate-50/50">
                   <div className="flex items-center gap-4"><div className="p-4 bg-indigo-50 text-indigo-600 rounded-2xl shadow-inner"><Users size={28}/></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight">Staff Consumption Audit</h3><p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Aggregated NC- bill tracking (Pre-calculated in Snapshots)</p></div></div>
                   <div className="flex gap-4"><div className="bg-white px-6 py-4 rounded-2xl border border-slate-100 shadow-sm"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Lost Market Value</p><p className="text-xl font-black text-indigo-600">₹{Math.round(intelligence.staffDrilldown.reduce((acc, item) => acc + item[1].potentialRevenue, 0)).toLocaleString()}</p></div><div className="bg-white px-6 py-4 rounded-2xl border border-slate-100 shadow-sm"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Internal Cost Burn</p><p className="text-xl font-black text-rose-500">₹{Math.round(intelligence.staffDrilldown.reduce((acc, item) => acc + item[1].theoreticalCost, 0)).toLocaleString()}</p></div></div>
                </div>

                {/* Wide visualization chart */}
                {intelligence.staffDrilldown.length > 0 && (
                  <div className="px-10 py-8 border-b border-slate-50">
                    <div className="flex items-center justify-between mb-6">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        {staffChartView === 'bar' ? 'Cost Burn vs Market Value — per SKU' : 'Burn Cost Distribution — by SKU'}
                      </p>
                      <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
                        <button onClick={() => setStaffChartView('bar')}
                          className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${staffChartView === 'bar' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}
                        >Bar</button>
                        <button onClick={() => setStaffChartView('pie')}
                          className={`px-4 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${staffChartView === 'pie' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}
                        >Pie</button>
                      </div>
                    </div>

                    {staffChartView === 'bar' ? (
                      <>
                        <ResponsiveContainer width="100%" height={Math.max(260, intelligence.staffDrilldown.length * 56)}>
                          <BarChart
                            data={intelligence.staffDrilldown.map(([name, d]) => ({
                              name: name.length > 14 ? name.slice(0, 13) + '…' : name,
                              fullName: name,
                              'Burn Cost': Math.round(d.theoreticalCost),
                              'Market Value': Math.round(d.potentialRevenue),
                              category: d.category,
                            }))}
                            margin={{ top: 8, right: 16, left: 0, bottom: 60 }}
                            barCategoryGap="35%"
                            barGap={3}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 9, fontWeight: 700, fill: '#475569' }}
                              angle={-35}
                              textAnchor="end"
                              interval={0}
                              axisLine={false}
                              tickLine={false}
                            />
                            <YAxis
                              tick={{ fontSize: 9, fill: '#94a3b8' }}
                              tickFormatter={v => `₹${(v as number) >= 1000 ? ((v as number) / 1000).toFixed(1) + 'k' : v}`}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              formatter={(v: number, key: string) => [`₹${v.toLocaleString('en-IN')}`, key]}
                              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
                              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700 }}
                            />
                            <Legend iconType="square" wrapperStyle={{ fontSize: 10, fontWeight: 700, paddingTop: 8 }} />
                            <Bar dataKey="Burn Cost" radius={[6, 6, 0, 0]} maxBarSize={28}>
                              {intelligence.staffDrilldown.map(([name, d]) => (
                                <Cell key={name} fill={d.category === 'FOOD' ? '#f43f5e' : '#818cf8'} />
                              ))}
                            </Bar>
                            <Bar dataKey="Market Value" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={28} fillOpacity={0.35} />
                          </BarChart>
                        </ResponsiveContainer>
                        <p className="text-[9px] font-bold text-slate-300 uppercase tracking-widest mt-1 text-right">Food in rose · Drinks in indigo</p>
                      </>
                    ) : (
                      <div className="flex flex-col md:flex-row items-center gap-8">
                        <ResponsiveContainer width="100%" height={280}>
                          <RechartsPieChart>
                            <Pie
                              data={intelligence.staffDrilldown.map(([name, d]) => ({
                                name,
                                value: Math.round(d.theoreticalCost),
                                category: d.category,
                              }))}
                              cx="50%"
                              cy="50%"
                              innerRadius={70}
                              outerRadius={120}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {intelligence.staffDrilldown.map(([name, d], i) => {
                                const palette = d.category === 'FOOD'
                                  ? ['#f43f5e','#fb7185','#fda4af','#fecdd3','#ffe4e6']
                                  : ['#6366f1','#818cf8','#a5b4fc','#c7d2fe','#e0e7ff'];
                                return <Cell key={name} fill={palette[i % palette.length]} />;
                              })}
                            </Pie>
                            <Tooltip
                              formatter={(v: number, _: any, props: any) => [`₹${v.toLocaleString('en-IN')}`, props.payload.name]}
                              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 11, fontWeight: 700 }}
                            />
                          </RechartsPieChart>
                        </ResponsiveContainer>
                        <div className="flex flex-col gap-2 min-w-[200px] w-full md:w-auto">
                          {intelligence.staffDrilldown.map(([name, d], i) => {
                            const palette = d.category === 'FOOD'
                              ? ['#f43f5e','#fb7185','#fda4af','#fecdd3','#ffe4e6']
                              : ['#6366f1','#818cf8','#a5b4fc','#c7d2fe','#e0e7ff'];
                            const total = intelligence.staffDrilldown.reduce((s, [, x]) => s + x.theoreticalCost, 0);
                            const pct = total > 0 ? ((d.theoreticalCost / total) * 100).toFixed(1) : '0';
                            return (
                              <div key={name} className="flex items-center gap-3">
                                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: palette[i % palette.length] }} />
                                <span className="text-[10px] font-black text-slate-700 uppercase truncate flex-1">{name}</span>
                                <span className="text-[10px] font-bold text-slate-400 shrink-0">{pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr className="bg-slate-50/80 border-b border-slate-100"><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">Consumed SKU</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Unit Count</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Burn Cost (₹)</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Market Value (₹)</th><th className="px-12 py-6 text-[10px] font-black text-slate-400 uppercase text-center">Integrity</th></tr></thead><tbody className="divide-y divide-slate-50">{intelligence.staffDrilldown.length === 0 ? (<tr><td colSpan={5} className="py-20 text-center"><SearchCode size={40} className="mx-auto text-slate-200 mb-4" /><p className="text-slate-400 font-black uppercase text-xs">No aggregate staff logs detected</p></td></tr>) : intelligence.staffDrilldown.map(([name, data]) => (<tr key={name} className="group hover:bg-slate-50/50 transition-colors"><td className="px-12 py-6"><div className="flex items-center gap-4"><div className={`p-2 rounded-xl text-white ${data.category === 'FOOD' ? 'bg-emerald-500' : 'bg-indigo-500'}`}>{data.category === 'FOOD' ? <Utensils size={12}/> : <Coffee size={12}/>}</div><div><p className="text-sm font-black text-slate-900 uppercase tracking-tight">{name}</p><p className="text-[9px] font-bold text-slate-400 uppercase">{data.segment} • {data.category}</p></div></div></td><td className="px-12 py-6 text-center font-black text-slate-600">{data.qty}</td><td className="px-12 py-6 text-right font-black text-rose-500">₹{Math.round(data.theoreticalCost).toLocaleString()}</td><td className="px-12 py-6 text-right font-black text-indigo-600">₹{Math.round(data.potentialRevenue).toLocaleString()}</td><td className="px-12 py-6"><div className="flex justify-center">{data.hasCost ? (<div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg shadow-inner"><CheckCircle2 size={14}/></div>) : (<div className="p-1.5 bg-rose-50 text-rose-500 rounded-lg animate-pulse"><AlertTriangle size={14}/></div>)}</div></td></tr>))}</tbody></table></div>
             </section>
           )}
        </div>
      )}
    </div>
  );
};

export default WasteManagementV2;
