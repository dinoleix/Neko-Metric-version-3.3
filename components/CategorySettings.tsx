
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, writeBatch, deleteDoc, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { invalidateCached } from '../referenceCache';
import { ai } from '../geminiService';
import { 
  DEFAULT_COGS, 
  DEFAULT_LABOUR, 
  DEFAULT_OPS, 
  CogsBucket, 
  ItemMonthlySnapshot, 
  SkuMapping, 
  SkuCategory,
  MenuNormalization,
  CategorySettings as CategorySettingsType,
  ServingOption,
  ServingItem,
  ItemCost,
  TrackedConsumable,
  CREW_PURCHASE_CATEGORIES,
  CREW_EXPENSE_CATEGORIES
} from '../types';
import { 
  Settings2, 
  Save, 
  Plus, 
  X, 
  Package, 
  Users, 
  Settings, 
  Loader2, 
  CheckCircle2,
  ChevronDown,
  Sparkles,
  Utensils,
  Coffee,
  Box,
  Grape,
  ShoppingBag,
  Zap,
  Check,
  Search,
  SearchX,
  Target,
  Link2,
  ArrowRightLeft,
  Tag,
  Flame,
  Info,
  Trash2,
  ListFilter,
  Layers,
  ArrowRight,
  ShieldCheck,
  History,
  RotateCcw,
  FileText,
  Anchor,
  DollarSign,
  CheckSquare,
  Square,
  MousePointer2,
  Filter,
  Edit3,
  LayoutGrid,
  Table2,
  FileSpreadsheet
} from 'lucide-react';

const COGS_BUCKETS: {id: CogsBucket, label: string, color: string, icon: any}[] = [
  { id: 'FOOD', label: 'Food Ingredients', color: 'bg-emerald-500', icon: Utensils },
  { id: 'DRINKS', label: 'Drink Ingredients', color: 'bg-indigo-500', icon: Coffee },
  { id: 'FOOD SERVINGS', label: 'Food Packaging', color: 'bg-amber-400', icon: Box },
  { id: 'DRINKS SERVINGS', label: 'Drink Packaging', color: 'bg-rose-400', icon: Grape }
];

const SKU_CATEGORIES: {id: SkuCategory, label: string, color: string, icon: any}[] = [
  { id: 'FOOD', label: 'Food', color: 'bg-emerald-500', icon: Utensils },
  { id: 'DRINKS', label: 'Drink', color: 'bg-indigo-500', icon: Coffee },
  { id: 'MISC', label: 'Misc/Fees', color: 'bg-slate-400', icon: Box }
];

type SettingsTab = 'purchase' | 'master-menu' | 'product' | 'tiered-costs' | 'servings' | 'segments' | 'consumables';

const CategorySettings: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('purchase');
  const [trackedConsumables, setTrackedConsumables] = useState<TrackedConsumable[]>([]);
  const [crewCategories, setCrewCategories] = useState<string[]>([]);

  // Same merged list the Crew Terminal dropdown shows, so a configured category
  // always corresponds to something a crew member can actually pick
  const consumableCategoryOptions = useMemo(() => Array.from(new Set([
    ...CREW_PURCHASE_CATEGORIES, ...CREW_EXPENSE_CATEGORIES, ...crewCategories,
  ].map(c => c.trim().toUpperCase()).filter(Boolean))).sort(), [crewCategories]);
  
  // Basic UI State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  // Data State
  const [cogsKeywords, setCogsKeywords] = useState<string[]>(DEFAULT_COGS);
  const [cogsBucketMapping, setCogsBucketMapping] = useState<Record<string, CogsBucket>>({});
  const [labourKeywords, setLabourKeywords] = useState<string[]>(DEFAULT_LABOUR);
  const [opsKeywords, setOpsKeywords] = useState<string[]>(DEFAULT_OPS);
  const [menuSegments, setMenuSegments] = useState<string[]>([]);
  const [servingOptions, setServingOptions] = useState<ServingOption[]>([]);
  const [itemCosts, setItemCosts] = useState<ItemCost[]>([]);
  const [skuList, setSkuList] = useState<string[]>([]);
  const [skuMappings, setSkuMappings] = useState<Record<string, { category: SkuCategory, segment?: string, isInherited?: boolean }>>({});
  const [normalizationMap, setNormalizationMap] = useState<Record<string, string>>({});
  const [allSourceStrings, setAllSourceStrings] = useState<string[]>([]);

  // Input State
  const [newCogs, setNewCogs] = useState('');
  const [newLabour, setNewLabour] = useState('');
  const [newOps, setNewOps] = useState('');
  const [newSegment, setNewSegment] = useState('');
  const [isAddingServing, setIsAddingServing] = useState(false);
  const [editingServingId, setEditingServingId] = useState<string | null>(null);
  const [newServingName, setNewServingName] = useState('');
  const [newServingItems, setNewServingItems] = useState<ServingItem[]>([]);
  const [curItemName, setCurItemName] = useState('');
  const [curItemPrice, setCurItemPrice] = useState('');
  const [skuSearchTerm, setSkuSearchTerm] = useState('');
  const [masterSearchTerm, setMasterSearchTerm] = useState('');
  const [masterView, setMasterView] = useState<'detailed' | 'sheet'>('detailed');
  const [isAnalyzingAI, setIsAnalyzingAI] = useState(false);
  const [aiPlan, setAiPlan] = useState<{ canonical: string; action: 'normalize' | 'retain'; members: string[] }[] | null>(null);
  const [aiPlanSelected, setAiPlanSelected] = useState<Set<number>>(new Set());
  const [costsSearchTerm, setCostsSearchTerm] = useState('');
  const [costsSegmentFilter, setCostsSegmentFilter] = useState('all');
  const [costsView, setCostsView] = useState<'cards' | 'sheet'>('cards');

  // Multi-select state
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

  // AI & Editing State
  const [isMappingAI, setIsMappingAI] = useState(false);
  const [isNormalizingAI, setIsNormalizingAI] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, string>>({});
  const [editingCosts, setEditingCosts] = useState<Record<string, { ingredient: string, tier1: string, tier2: string }>>({});

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const constraints = [where('userId', '==', dataOwnerId)];
      const settingsRef = doc(db, 'category_settings', dataOwnerId);
      
      const [setSnap, itemSnapDocs, skuMapSnaps, normSnap, servingSnap, costSnap] = await Promise.all([
        getDoc(settingsRef),
        getDocs(query(collection(db, 'item_snapshots'), ...constraints)),
        getDocs(query(collection(db, 'sku_mappings'), ...constraints)),
        getDocs(query(collection(db, 'menu_normalization'), ...constraints)),
        getDocs(query(collection(db, 'serving_options'), ...constraints)),
        getDocs(query(collection(db, 'item_costs'), ...constraints))
      ]);
      
      if (setSnap.exists()) {
        const data = setSnap.data() as CategorySettingsType;
        if (data.cogsKeywords) setCKeywords(data.cogsKeywords);
        if (data.labourKeywords) setLabourKeywords(data.labourKeywords);
        if (data.opsKeywords) setOpsKeywords(data.opsKeywords);
        if (data.cogsBucketMapping) setCogsBucketMapping(data.cogsBucketMapping);
        if (data.menuSegments) setMenuSegments(data.menuSegments);
        if (data.trackedConsumables) setTrackedConsumables(data.trackedConsumables);
      }

      // Crew-defined categories, so the consumables picker offers the same list
      // the Crew Terminal shows rather than only the hardcoded ones
      try {
        const ccSnap = await getDocs(query(collection(db, 'crew_categories'), where('ownerId', '==', dataOwnerId)));
        setCrewCategories(ccSnap.docs.map(d => (d.data() as any).name as string).filter(Boolean));
      } catch { /* optional — the hardcoded lists still populate the picker */ }

      setServingOptions(servingSnap.docs.map(d => ({ id: d.id, ...d.data() } as ServingOption)));
      
      // CRITICAL FIX: Sort costs by updatedAt DESC. If duplicates exist, the newest one is found first.
      const costsArr = costSnap.docs
        .map(d => ({ ...d.data(), id: d.id } as ItemCost))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        
      setItemCosts(costsArr);

      const rawUniqueStrings = new Set<string>();
      itemSnapDocs.docs.forEach(d => {
        const data = d.data() as ItemMonthlySnapshot;
        Object.keys(data.items || {}).forEach(name => {
          const clean = name.trim();
          if (clean && !/total|summary|count|grand/i.test(clean)) rawUniqueStrings.add(clean);
        });
      });
      setAllSourceStrings(Array.from(rawUniqueStrings).sort());

      const normMap: Record<string, string> = {};
      normSnap.docs.forEach(d => {
        const data = d.data() as MenuNormalization;
        normMap[data.sourceName] = data.masterName;
      });
      setNormalizationMap(normMap);

      const dbMappings: Record<string, { category: SkuCategory, segment?: string }> = {};
      const sortedSkuDocs = skuMapSnaps.docs
        .map(d => d.data() as SkuMapping)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      sortedSkuDocs.forEach(data => {
        const key = data.itemName.trim().toUpperCase();
        if (!dbMappings[key]) {
          dbMappings[key] = { category: data.category, segment: data.segment };
        }
      });

      const uniqueMasterSkus = new Set<string>();
      rawUniqueStrings.forEach(s => {
        uniqueMasterSkus.add(normMap[s] || s);
      });
      const masterList = Array.from(uniqueMasterSkus).sort();
      setSkuList(masterList);

      const finalMappings: Record<string, { category: SkuCategory, segment?: string, isInherited?: boolean }> = {};
      const initialCosts: Record<string, { ingredient: string, tier1: string, tier2: string }> = {};

      masterList.forEach(masterName => {
        const upperMaster = masterName.trim().toUpperCase();
        
        if (dbMappings[upperMaster]) {
          finalMappings[masterName] = { ...dbMappings[upperMaster], isInherited: false };
        } else {
          const sources = Array.from(rawUniqueStrings).filter(s => (normMap[s] || s) === masterName);
          for (const src of sources) {
            const upperSrc = src.trim().toUpperCase();
            if (dbMappings[upperSrc]) {
              finalMappings[masterName] = { ...dbMappings[upperSrc], isInherited: true };
              break; 
            }
          }
        }

        // FIND COST RECORD (Using newest-first array and strict uppercase trimmed comparison)
        const existingCost = costsArr.find(c => (c.itemName || '').trim().toUpperCase() === upperMaster);
        
        initialCosts[masterName] = {
          ingredient: existingCost ? existingCost.costPerUnit.toString() : '0',
          tier1: existingCost ? (existingCost.tier1ServingsCost ?? existingCost.servingsCostPerUnit ?? 0).toString() : '0',
          tier2: existingCost ? (existingCost.tier2ServingsCost ?? existingCost.servingsCostPerUnit ?? 0).toString() : '0'
        };
      });
      
      setSkuMappings(finalMappings);
      setEditingCosts(initialCosts);

    } catch (err) {
      console.error(err);
      setError("Failed to load workshop data.");
    } finally {
      setLoading(false);
    }
  };

  const setCKeywords = (kws: string[]) => {
    setCogsKeywords(kws);
  };

  useEffect(() => { fetchData(); }, [user]);

  const handleSavePurchaseMapping = async () => {
    setSaving(true); setSuccess(false);
    try {
      // dataOwnerId, not user.uid — fetchData reads from dataOwnerId, so writing
      // to user.uid meant a delegated admin's edits landed on a doc nobody reads
      // Store keywords canonically (trimmed, upper-cased, de-duped). Every consumer
      // compares against an upper-cased category, so saving them as typed left
      // matching dependent on each screen remembering to normalize on read.
      const canon = (l: string[]) =>
        Array.from(new Set((l || []).map(k => (k || '').trim().toUpperCase()).filter(Boolean)));

      await setDoc(doc(db, 'category_settings', dataOwnerId), {
        cogsKeywords: canon(cogsKeywords),
        labourKeywords: canon(labourKeywords),
        opsKeywords: canon(opsKeywords),
        cogsBucketMapping, menuSegments,
        trackedConsumables, updatedAt: Date.now()
      }, { merge: true });
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch (err) { setError("Sync failed."); } finally { setSaving(false); }
  };

  const handleSaveNormalization = async () => {
    setSaving(true); setSuccess(false);
    try {
      const entries = Object.entries(normalizationMap);
      for (let i = 0; i < entries.length; i += 400) {
        const batch = writeBatch(db);
        entries.slice(i, i + 400).forEach(([sourceName, masterName]) => {
          if (!masterName) return;
          const safeId = sourceName.trim().toUpperCase().replace(/[^a-zA-Z0-9]/g, '_');
          batch.set(doc(db, 'menu_normalization', `${user.uid}_norm_${safeId}`), {
            sourceName, masterName, userId: user.uid, updatedAt: Date.now()
          }, { merge: true });
        });
        await batch.commit();
      }
      invalidateCached('menu_normalization', user.uid);
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
      fetchData();
    } catch (err) { setError("Normalization save failed."); } finally { setSaving(false); }
  };

  const handleSaveProductMappings = async () => {
    setSaving(true); setSuccess(false);
    try {
      const entries = Object.entries(skuMappings);
      for (let i = 0; i < entries.length; i += 400) {
        const batch = writeBatch(db);
        entries.slice(i, i + 400).forEach(([itemName, val]) => {
          const data = val as { category: SkuCategory; segment?: string };
          const safeId = itemName.trim().toUpperCase().replace(/[^a-zA-Z0-9]/g, '_');
          batch.set(doc(db, 'sku_mappings', `${user.uid}_sku_${safeId}`), {
            itemName, category: data.category || 'UNMAPPED', segment: data.segment || '', userId: user.uid, updatedAt: Date.now()
          }, { merge: true });
        });
        await batch.commit();
      }
      invalidateCached('sku_mappings', user.uid);
      setSuccess(true); setTimeout(() => setSuccess(false), 3000);
    } catch (err) { setError("Product mapping failed."); } finally { setSaving(false); }
  };

  const handleSaveCosts = async () => {
    setSaving(true); setSuccess(false);
    try {
      const entries = Object.entries(editingCosts);
      for (let i = 0; i < entries.length; i += 400) {
        const batch = writeBatch(db);
        const chunk = entries.slice(i, i + 400);
        
        chunk.forEach(([itemName, val]) => {
          const costData = val as { ingredient: string; tier1: string; tier2: string };
          const ingVal = parseFloat(costData.ingredient) || 0;
          const t1Val = parseFloat(costData.tier1) || 0;
          const t2Val = parseFloat(costData.tier2) || 0;
          
          if (!itemName.trim()) return;
          
          const masterNameUpper = itemName.trim().toUpperCase();
          const safeId = masterNameUpper.replace(/[^a-zA-Z0-9]/g, '_');
          
          batch.set(doc(db, 'item_costs', `${user.uid}_cost_${safeId}`), { 
            userId: user.uid, 
            itemName: masterNameUpper, 
            costPerUnit: ingVal, 
            tier1ServingsCost: t1Val, 
            tier2ServingsCost: t2Val, 
            updatedAt: Date.now() 
          }, { merge: true });
        });
        
        await batch.commit();
      }
      invalidateCached('item_costs', user.uid);

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      fetchData(); // Force re-fetch to update local state with newest documents
    } catch (err) { 
      console.error("Failed to save costs:", err);
      setError("Failed to save costs. Check connection."); 
    } finally { 
      setSaving(false); 
    }
  };

  const autoNormalizeWithAI = async () => {
    if (allSourceStrings.length === 0) return;
    setIsNormalizingAI(true);
    try {
      const prompt = `You are a menu normalization engine. Standardize names to Upper Case, correct typos, and group identical items. PRESERVE sizes/portions (Full/Half/Regular/Large). Return ONLY a JSON object. Strings: ${allSourceStrings.join('\n')}`;
      const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: { responseMimeType: 'application/json' } });
      setAiSuggestions(JSON.parse(response.text || '{}'));
    } catch (err) { setError("AI Normalization failed."); } finally { setIsNormalizingAI(false); }
  };

  // Robustly pull a JSON array out of an AI response: handles bare arrays,
  // markdown-fenced blocks, an object wrapping the array, and trailing garbage.
  const extractJsonArray = (text: string): any[] | null => {
    let t = text.trim();
    // Strip ```json ... ``` or ``` ... ``` fences
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    // Direct parse
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        const arr = Object.values(v).find(x => Array.isArray(x));
        if (arr) return arr as any[];
      }
    } catch { /* fall through to bracket slice */ }
    // Slice from the first '[' to the last ']'
    const s = t.indexOf('['), e = t.lastIndexOf(']');
    if (s !== -1 && e > s) {
      try { const v = JSON.parse(t.slice(s, e + 1)); if (Array.isArray(v)) return v; } catch { /* fall through to salvage */ }
    }
    // Truncated array: salvage every complete top-level {...} object
    if (s !== -1) {
      const body = t.slice(s + 1);
      const objs: any[] = [];
      let depth = 0, startObj = -1, inStr = false, esc = false;
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') { if (depth === 0) startObj = i; depth++; }
        else if (ch === '}') { depth--; if (depth === 0 && startObj !== -1) { try { objs.push(JSON.parse(body.slice(startObj, i + 1))); } catch { /* skip */ } startObj = -1; } }
      }
      if (objs.length > 0) return objs;
    }
    return null;
  };

  // Clusters near-duplicate source strings and proposes a canonical name +
  // a normalize/retain action per group, surfaced in a review panel to apply.
  const analyzeSimilarWithAI = async () => {
    if (allSourceStrings.length === 0) return;
    setIsAnalyzingAI(true);
    setError('');
    try {
      const prompt = `You are a menu data-deduplication engine. Below is a list of raw menu item strings imported from POS/CSV exports. Many are near-duplicates of each other: typos, spacing, casing, abbreviations, or minor wording differences that refer to the SAME sellable item. Group strings that refer to the same item.

RULES:
- Preserve genuinely different sizes/portions (Full/Half/Regular/Large/Small) as SEPARATE groups.
- Preserve genuinely different items as separate groups.
- For each group choose ONE clean canonical name in UPPER CASE (fix typos, standardize spacing/wording).
- If a group has 2 or more members, OR a single member needs a spelling/casing fix, set action to "normalize".
- If a single string is already clean and needs no change, set action to "retain".
- Every input string must appear in exactly one group's members, spelled EXACTLY as given in the input.

Return ONLY a JSON array. Each element: {"canonical":"<CLEAN NAME>","action":"normalize"|"retain","members":["<raw string>", ...]}.

Strings:
${allSourceStrings.join('\n')}`;
      const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: { responseMimeType: 'application/json' } });
      const raw = response.text || '';
      const parsed = extractJsonArray(raw);
      if (parsed === null) {
        console.error('[AnalyzeSimilar] could not parse AI response:', raw.slice(0, 2000));
        setError('AI returned an unreadable response. Try again, or narrow the list with search first.');
        return;
      }
      const plan = (Array.isArray(parsed) ? parsed : [])
        .filter((g: any) => g && typeof g.canonical === 'string' && Array.isArray(g.members) && g.members.length > 0)
        .map((g: any) => ({
          canonical: String(g.canonical).toUpperCase().trim(),
          action: g.action === 'retain' ? 'retain' as const : 'normalize' as const,
          members: g.members.map((m: any) => String(m)),
        }))
        // Surface the impactful groups first: multi-member merges, then renames
        .sort((a: any, b: any) => b.members.length - a.members.length);
      if (plan.length === 0) { setError('AI returned no groups to review.'); return; }
      setAiPlan(plan);
      setAiPlanSelected(new Set(plan.map((_: any, i: number) => i)));
    } catch (err: any) {
      console.error('[AnalyzeSimilar] failed:', err);
      setError(`AI similarity analysis failed: ${err?.message || err}`);
    } finally { setIsAnalyzingAI(false); }
  };

  // Resolve an AI-returned member back to the exact source string (case/space tolerant)
  const sourceKeyLookup = useMemo(
    () => new Map(allSourceStrings.map(s => [s.trim().toLowerCase(), s])),
    [allSourceStrings]
  );

  const applyAiPlan = () => {
    if (!aiPlan) return;
    const next = { ...normalizationMap };
    aiPlan.forEach((g, i) => {
      if (!aiPlanSelected.has(i)) return;
      g.members.forEach(m => {
        const realSource = sourceKeyLookup.get(m.trim().toLowerCase());
        if (realSource) next[realSource] = g.action === 'retain' ? realSource : g.canonical;
      });
    });
    setNormalizationMap(next);
    setAiPlan(null);
    setAiPlanSelected(new Set());
  };

  const autoCategorizeWithAI = async () => {
    const itemsToMap = skuList.filter(name => !skuMappings[name] || skuMappings[name].category === 'UNMAPPED');
    if (itemsToMap.length === 0) return;
    setIsMappingAI(true);
    try {
      const prompt = `Categorize these Master SKUs into 'FOOD', 'DRINKS', or 'MISC' AND assign a segment from: [${menuSegments.join(', ')}]. Return ONLY JSON. Items: ${itemsToMap.join('\n')}`;
      const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: { responseMimeType: 'application/json' } });
      setSkuMappings(prev => ({ ...prev, ...JSON.parse(response.text || '{}') }));
    } catch (err) { setError("AI Classification failed."); } finally { setIsMappingAI(false); }
  };

  const filteredMasterItems = useMemo(() => allSourceStrings.filter(s => s.toLowerCase().includes(masterSearchTerm.toLowerCase())), [allSourceStrings, masterSearchTerm]);

  const masterMapStatus = (source: string): string => {
    const target = normalizationMap[source];
    if (!target) return 'Unmapped';
    return target === source ? 'Retained' : 'Normalized';
  };

  // Export the currently filtered source → master-SKU mappings to a real .xlsx
  const exportMasterExcel = async () => {
    const XLSX = await import('xlsx');
    const headers = ['Source String (CSV)', 'Target Master SKU', 'Status'];
    const rows = filteredMasterItems.map(source => [source, normalizationMap[source] || '', masterMapStatus(source)]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.min(48, Math.max(h.length, ...rows.slice(0, 80).map(r => String(r[i] ?? '').length), 10) + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Master Menu');
    XLSX.writeFile(wb, `master-menu_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const filteredSkuList = useMemo(() => skuList.filter(s => s.toLowerCase().includes(skuSearchTerm.toLowerCase())), [skuList, skuSearchTerm]);
  
  const filteredCostsList = useMemo(() => {
    return skuList.filter(s => {
      const matchesSearch = s.toLowerCase().includes(costsSearchTerm.toLowerCase());
      const matchesSegment = costsSegmentFilter === 'all' || (skuMappings[s]?.segment === costsSegmentFilter);
      return matchesSearch && matchesSegment;
    });
  }, [skuList, costsSearchTerm, costsSegmentFilter, skuMappings]);

  const toggleSkuSelection = (sku: string) => {
    const next = new Set(selectedSkus);
    if (next.has(sku)) next.delete(sku);
    else next.add(sku);
    setSelectedSkus(next);
  };

  // Number helper for the spreadsheet view: reads the edited value, falling back
  // to the field's default rendering ('' shows as 0)
  const costNum = (v: string | undefined) => parseFloat(v || '0') || 0;

  // Export the currently filtered tiered costs to a real .xlsx (SheetJS, lazy-loaded)
  const exportCostsExcel = async () => {
    const XLSX = await import('xlsx');
    const headers = ['Master SKU', 'Segment', 'Category', 'Ingredient Cost', 'Tier 1 Cost', 'Tier 2 Cost', 'T1 Total (Ingr+T1)', 'T2 Total (Ingr+T2)'];
    const rows = filteredCostsList.map(name => {
      const c = editingCosts[name] || { ingredient: '0', tier1: '0', tier2: '0' };
      const ingr = costNum(c.ingredient), t1 = costNum(c.tier1), t2 = costNum(c.tier2);
      return [name, skuMappings[name]?.segment || 'UNSEGMENTED', skuMappings[name]?.category || 'UNMAPPED', ingr, t1, t2, ingr + t1, ingr + t2];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h, i) => ({ wch: Math.min(40, Math.max(h.length, ...rows.slice(0, 80).map(r => String(r[i] ?? '').length), 8) + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tiered Costs');
    XLSX.writeFile(wb, `tiered-costs_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const toggleAllVisibleCosts = () => {
    if (selectedSkus.size === filteredCostsList.length && filteredCostsList.length > 0) {
      setSelectedSkus(new Set());
    } else {
      setSelectedSkus(new Set(filteredCostsList));
    }
  };

  const applyBatchIngredient = (val: string) => {
    const next = { ...editingCosts };
    selectedSkus.forEach(sku => {
      if (!next[sku]) next[sku] = { ingredient: '0', tier1: '0', tier2: '0' };
      next[sku].ingredient = val;
    });
    setEditingCosts(next);
  };

  const applyBatchTier1 = (templateId: string) => {
    const opt = servingOptions.find(o => o.id === templateId);
    if (!opt) return;
    const next = { ...editingCosts };
    selectedSkus.forEach(sku => {
      if (!next[sku]) next[sku] = { ingredient: '0', tier1: '0', tier2: '0' };
      next[sku].tier1 = opt.totalCost.toString();
    });
    setEditingCosts(next);
  };

  const applyBatchTier2 = (templateId: string) => {
    const opt = servingOptions.find(o => o.id === templateId);
    if (!opt) return;
    const next = { ...editingCosts };
    selectedSkus.forEach(sku => {
      if (!next[sku]) next[sku] = { ingredient: '0', tier1: '0', tier2: '0' };
      next[sku].tier2 = opt.totalCost.toString();
    });
    setEditingCosts(next);
  };

  const onEditServing = (opt: ServingOption) => {
    setEditingServingId(opt.id || null);
    setNewServingName(opt.name);
    setNewServingItems([...opt.items]);
    setIsAddingServing(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetServingForm = () => {
    setEditingServingId(null);
    setNewServingName('');
    setNewServingItems([]);
    setIsAddingServing(false);
  };

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-4 mb-2">
            <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl">
              <Settings2 size={24} />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tighter">Intelligence Hub</h2>
          </div>
          <p className="text-slate-500 font-medium uppercase text-xs tracking-widest flex items-center gap-2">
             <ShieldCheck size={14} className="text-indigo-500"/> Multi-layer Menu Normalization Suite
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {error && (
            <p className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 rounded-xl px-4 py-2">{error}</p>
          )}
          <button
            onClick={() => {
              setError('');
              if (activeTab === 'purchase' || activeTab === 'segments' || activeTab === 'consumables') handleSavePurchaseMapping();
              else if (activeTab === 'master-menu') handleSaveNormalization();
              else if (activeTab === 'product') handleSaveProductMappings();
              else if (activeTab === 'tiered-costs') handleSaveCosts();
            }}
            disabled={saving || activeTab === 'servings'}
            className={`flex items-center gap-2 px-8 py-4 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl transition-all ${activeTab === 'servings' ? 'hidden' : (success ? 'bg-emerald-500 text-white shadow-emerald-200' : 'bg-indigo-600 text-white shadow-indigo-200 hover:bg-indigo-700')}`}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : (success ? <CheckCircle2 size={16} /> : <Save size={16} />)}
            {saving ? 'Saving...' : (success ? 'Synced' : 'Commit Logic')}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap bg-slate-200/50 p-1.5 rounded-[1.5rem] w-fit border border-slate-100 shadow-inner gap-1">
         {[
           { id: 'purchase', label: 'Purchase', icon: Package },
           { id: 'master-menu', label: 'Master Menu', icon: Zap },
           { id: 'product', label: 'Allocation', icon: ShoppingBag },
           { id: 'tiered-costs', label: 'Tiered Costs', icon: DollarSign },
           { id: 'servings', label: 'Servings', icon: Box },
           { id: 'segments', label: 'Segments', icon: Tag },
           { id: 'consumables', label: 'Consumables', icon: Flame }
         ].map(tab => (
           <button 
              key={tab.id}
              onClick={() => { setActiveTab(tab.id as SettingsTab); setSelectedSkus(new Set()); }} 
              className={`px-6 py-3 rounded-2xl flex items-center gap-3 text-xs font-black uppercase tracking-widest transition-all ${activeTab === tab.id ? 'bg-white text-indigo-600 shadow-lg translate-y-[-1px]' : 'text-slate-500 hover:text-slate-800'}`}
           >
              <tab.icon size={16} /> {tab.label}
           </button>
         ))}
      </div>

      {loading ? (
        <div className="py-40 text-center">
           <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-6" />
           <p className="text-slate-400 font-black uppercase tracking-widest text-[10px]">Accessing Workshop Data...</p>
        </div>
      ) : (
        <div className="animate-in slide-in-from-bottom-4 duration-500 relative">
           {activeTab === 'purchase' && (
             <div className="space-y-10">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                   {[
                     { label: 'COGS Keywords', icon: Package, color: 'text-amber-500', list: cogsKeywords, setFn: setCKeywords, input: newCogs, setInput: setNewCogs },
                     { label: 'Labour Keywords', icon: Users, color: 'text-indigo-500', list: labourKeywords, setFn: setLabourKeywords, input: newLabour, setInput: setNewLabour },
                     { label: 'Operations Keywords', icon: Settings, color: 'text-pink-500', list: opsKeywords, setFn: setOpsKeywords, input: newOps, setInput: setNewOps }
                   ].map((group) => (
                     <section key={group.label} className="bg-white rounded-[3rem] border border-slate-100 p-8 flex flex-col h-[500px]">
                        <div className="flex items-center gap-3 mb-6">
                           <group.icon className={group.color} size={20} />
                           <h3 className="text-sm font-black uppercase tracking-widest text-slate-900">{group.label}</h3>
                        </div>
                        <div className="flex gap-2 mb-6">
                           <input type="text" value={group.input} onChange={e => group.setInput(e.target.value)} placeholder="Add tag..." className="flex-1 bg-slate-50 border border-slate-100 rounded-xl px-4 py-3 text-xs font-bold outline-none" onKeyPress={e => e.key === 'Enter' && (group.list.includes(group.input.toUpperCase()) ? null : (group.setFn([...group.list, group.input.toUpperCase()].sort()), group.setInput('')))}/>
                           <button onClick={() => { if(group.input.trim() && !group.list.includes(group.input.toUpperCase())) { group.setFn([...group.list, group.input.toUpperCase()].sort()); group.setInput(''); } }} className="p-3 bg-indigo-600 text-white rounded-xl shadow-lg"><Plus size={16}/></button>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-wrap gap-2 content-start">
                           {group.list.map(kw => (
                             <div key={kw} className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg group hover:border-indigo-200 transition-all">
                                <span className="text-[10px] font-black text-slate-600">{kw}</span>
                                <button onClick={() => group.setFn(group.list.filter(k => k !== kw))} className="text-slate-300 hover:text-rose-500"><X size={12} /></button>
                             </div>
                           ))}
                        </div>
                     </section>
                   ))}
                </div>
                <section className="bg-white rounded-[3rem] border border-slate-100 p-10 shadow-sm">
                   <div className="flex items-center gap-4 mb-10"><div className="p-3 bg-amber-50 text-amber-600 rounded-2xl"><Target size={24} /></div><div><h3 className="text-xl font-black text-slate-900 tracking-tight uppercase">Functional Silo Assignment</h3><p className="text-slate-400 text-sm font-medium">Map inventory categories to specific COGS segments.</p></div></div>
                   <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                      {cogsKeywords.map(kw => (
                         <div key={kw} className="p-6 bg-slate-50 border border-slate-100 rounded-3xl hover:bg-white hover:shadow-xl transition-all">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 truncate">{kw}</p>
                            <select value={cogsBucketMapping[kw] || 'FOOD'} onChange={e => setCogsBucketMapping({...cogsBucketMapping, [kw]: e.target.value as CogsBucket})} className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase outline-none">{COGS_BUCKETS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
                         </div>
                      ))}
                   </div>
                </section>
             </div>
           )}

           {activeTab === 'master-menu' && (
             <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                <div className="p-10 border-b border-slate-50 bg-indigo-500 bg-opacity-5 flex flex-col md:flex-row md:items-center justify-between gap-6">
                   <div className="flex items-center gap-5"><div className="w-16 h-16 bg-slate-900 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl"><Zap size={32} /></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Master Menu Hub</h3><p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Unify varying names into a single financial SKU</p></div></div>
                   <div className="flex flex-wrap gap-4 items-center">
                      {/* Detailed / Spreadsheet view toggle */}
                      <div className="flex bg-white border border-slate-100 p-1 rounded-xl shadow-sm gap-1">
                         {([['detailed', LayoutGrid, 'Detailed'], ['sheet', Table2, 'Spreadsheet']] as const).map(([v, Icon, label]) => (
                           <button key={v} onClick={() => setMasterView(v)} className={`px-3 py-2 rounded-lg flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${masterView === v ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-700'}`}>
                              <Icon size={13} /> {label}
                           </button>
                         ))}
                      </div>
                      <button onClick={exportMasterExcel} disabled={filteredMasterItems.length === 0} className="flex items-center gap-2 px-4 py-3 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all disabled:opacity-40">
                         <FileSpreadsheet size={14} /> Excel
                      </button>
                      <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} /><input type="text" placeholder="Search item strings..." value={masterSearchTerm} onChange={e => setMasterSearchTerm(e.target.value)} className="pl-11 pr-4 py-3 bg-white border border-slate-100 rounded-xl text-sm outline-none shadow-sm min-w-[240px]"/></div>
                      <button onClick={analyzeSimilarWithAI} disabled={isAnalyzingAI || isNormalizingAI} className="px-6 py-4 bg-indigo-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-indigo-700 transition-all shadow-xl disabled:opacity-50">{isAnalyzingAI ? <Loader2 size={16} className="animate-spin" /> : <Layers size={16} />} Analyze Similar</button>
                      <button onClick={autoNormalizeWithAI} disabled={isNormalizingAI || isAnalyzingAI} className="px-6 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-all shadow-xl disabled:opacity-50">{isNormalizingAI ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} AI Normalize</button>
                   </div>
                </div>
                {masterView === 'sheet' && (
                  <div className="p-6 md:p-8 overflow-x-auto max-h-[800px] overflow-y-auto custom-scrollbar">
                     <table className="w-full text-left border-collapse min-w-[720px]">
                        <thead className="sticky top-0 z-10">
                           <tr className="bg-slate-900 text-white">
                              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Source String (CSV)</th>
                              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Target Master SKU</th>
                              <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-center">Status</th>
                              <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-right">Reset</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                           {filteredMasterItems.map((source, idx) => {
                             const status = masterMapStatus(source);
                             return (
                               <tr key={source} className={`transition-colors ${idx % 2 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-indigo-50/40`}>
                                  <td className="px-4 py-2 text-xs font-black text-slate-800 uppercase max-w-[300px] truncate">{source}</td>
                                  <td className="px-4 py-2">
                                     <input type="text" value={normalizationMap[source] || ''} onChange={e => setNormalizationMap({ ...normalizationMap, [source]: e.target.value })} placeholder={source} className="w-full min-w-[200px] px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black text-slate-700 outline-none uppercase focus:border-indigo-400 focus:bg-white" />
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                     {status === 'Normalized' ? <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase border border-emerald-100"><Check size={10} /> Normalized</span>
                                       : status === 'Retained' ? <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-400 rounded-full text-[9px] font-black uppercase border border-slate-100"><FileText size={10} /> Retained</span>
                                       : <button onClick={() => setNormalizationMap({ ...normalizationMap, [source]: source })} className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-50 text-amber-600 rounded-full text-[9px] font-black uppercase border border-amber-100 hover:bg-amber-100"><Anchor size={10} /> Retain</button>}
                                  </td>
                                  <td className="px-3 py-2 text-right">
                                     {normalizationMap[source] && <button onClick={() => { const next = { ...normalizationMap }; delete next[source]; setNormalizationMap(next); }} className="p-1.5 text-slate-300 hover:text-rose-500"><RotateCcw size={13} /></button>}
                                  </td>
                               </tr>
                             );
                           })}
                        </tbody>
                     </table>
                     {filteredMasterItems.length === 0 && (
                       <div className="py-20 text-center"><SearchX size={48} className="mx-auto text-slate-200 mb-4" /><p className="text-slate-400 font-black uppercase text-xs tracking-widest">No matching source strings</p></div>
                     )}
                  </div>
                )}

                {masterView === 'detailed' && (
                <div className="p-10 overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-slate-100"><th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest">Source String (CSV)</th><th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase text-center"></th><th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest">Target Master SKU</th><th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-50">{filteredMasterItems.map(source => (
                  <tr key={source} className="group hover:bg-slate-50/50 transition-colors">
                     <td className="px-6 py-6"><p className="text-sm font-black text-slate-800 uppercase">{source}</p></td>
                     <td className="px-6 py-6 text-center text-slate-300"><ArrowRightLeft size={16} /></td>
                     <td className="px-6 py-6"><div className="flex flex-col gap-2"><input type="text" value={normalizationMap[source] || ''} onChange={e => setNormalizationMap({...normalizationMap, [source]: e.target.value})} placeholder={source} className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-black text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/5 uppercase"/>{aiSuggestions[source] && (<div className="flex items-center gap-3 p-3 bg-indigo-50 border border-indigo-100 rounded-xl animate-in slide-in-from-top-2 shadow-sm"><div className="flex items-center gap-2 flex-1"><Sparkles size={12} className="text-indigo-600"/><span className="text-[10px] font-black text-indigo-700 uppercase">AI:</span><span className="text-[10px] font-bold text-slate-700 uppercase">{aiSuggestions[source]}</span></div><button onClick={() => { setNormalizationMap({...normalizationMap, [source]: aiSuggestions[source]}); const next = {...aiSuggestions}; delete next[source]; setAiSuggestions(next); }} className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-[8px] font-black uppercase flex items-center gap-1.5 hover:bg-indigo-700"><Check size={10}/> Accept</button></div>)}</div></td>
                     <td className="px-6 py-6 text-right"><div className="flex items-center justify-end gap-2">{!normalizationMap[source] && (<button onClick={() => { setNormalizationMap({...normalizationMap, [source]: source}); const next = {...aiSuggestions}; delete next[source]; setAiSuggestions(next); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 rounded-xl text-[9px] font-black uppercase hover:bg-slate-200 transition-all"><Anchor size={12} /> Retain</button>)}{normalizationMap[source] === source && (<div className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-50 text-slate-400 rounded-full text-[9px] font-black uppercase tracking-widest border border-slate-100"><FileText size={12} /> Retained</div>)}{normalizationMap[source] && normalizationMap[source] !== source && (<div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase tracking-widest border border-emerald-100"><Check size={12} /> Normalized</div>)}{normalizationMap[source] && (<button onClick={() => { const next = {...normalizationMap}; delete next[source]; setNormalizationMap(next); }} className="p-2 text-slate-300 hover:text-rose-500"><RotateCcw size={14} /></button>)}</div></td>
                  </tr>
                ))}</tbody></table></div>
                )}</section>
           )}

           {/* AI similarity review panel */}
           {aiPlan && (
             <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={() => { setAiPlan(null); setAiPlanSelected(new Set()); }}>
                <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                   <div className="p-8 bg-slate-900 text-white flex items-center justify-between gap-4 shrink-0">
                      <div className="flex items-center gap-4">
                         <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg"><Layers size={24} /></div>
                         <div>
                            <h3 className="text-lg font-black uppercase tracking-tight">Similarity Review</h3>
                            <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mt-0.5">{aiPlan.length} groups · {aiPlan.filter(g => g.action === 'normalize').length} to normalize · {aiPlan.filter(g => g.action === 'retain').length} to retain</p>
                         </div>
                      </div>
                      <button onClick={() => { setAiPlan(null); setAiPlanSelected(new Set()); }} className="p-2 text-slate-400 hover:text-white"><X size={22} /></button>
                   </div>

                   <div className="px-8 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 shrink-0">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{aiPlanSelected.size} of {aiPlan.length} groups selected</p>
                      <div className="flex items-center gap-3">
                         <button onClick={() => setAiPlanSelected(new Set(aiPlan.map((_, i) => i)))} className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline">Select all</button>
                         <span className="text-slate-200">|</span>
                         <button onClick={() => setAiPlanSelected(new Set())} className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:underline">Clear</button>
                      </div>
                   </div>

                   <div className="overflow-y-auto custom-scrollbar p-6 space-y-3">
                      {aiPlan.map((g, i) => {
                        const isSel = aiPlanSelected.has(i);
                        return (
                          <div key={i} className={`rounded-2xl border p-4 transition-all cursor-pointer ${isSel ? 'border-indigo-300 bg-indigo-50/40 ring-1 ring-indigo-500/10' : 'border-slate-100 bg-white opacity-70'}`}
                            onClick={() => { const n = new Set(aiPlanSelected); n.has(i) ? n.delete(i) : n.add(i); setAiPlanSelected(n); }}>
                             <div className="flex items-center gap-3 mb-3">
                                <button className={`shrink-0 ${isSel ? 'text-indigo-600' : 'text-slate-300'}`}>{isSel ? <CheckSquare size={18} /> : <Square size={18} />}</button>
                                {g.action === 'normalize'
                                  ? <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase border border-emerald-100"><Layers size={10} /> Normalize</span>
                                  : <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 text-slate-500 rounded-full text-[9px] font-black uppercase border border-slate-200"><Anchor size={10} /> Retain</span>}
                                <ArrowRight size={13} className="text-slate-300" />
                                <span className="text-sm font-black text-slate-900 uppercase truncate">{g.canonical}</span>
                             </div>
                             <div className="flex flex-wrap gap-1.5 pl-8">
                                {g.members.map((m, mi) => {
                                  const known = sourceKeyLookup.has(m.trim().toLowerCase());
                                  const isCanonical = m.toUpperCase().trim() === g.canonical;
                                  return (
                                    <span key={mi} className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase border ${!known ? 'bg-rose-50 text-rose-400 border-rose-100 line-through' : isCanonical ? 'bg-white text-slate-400 border-slate-200' : 'bg-white text-slate-600 border-slate-200'}`}>{m}</span>
                                  );
                                })}
                             </div>
                          </div>
                        );
                      })}
                   </div>

                   <div className="p-6 border-t border-slate-100 flex items-center justify-between gap-4 shrink-0 bg-white">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Applying fills the targets — review, then Commit Logic to save</p>
                      <div className="flex items-center gap-3">
                         <button onClick={() => { setAiPlan(null); setAiPlanSelected(new Set()); }} className="px-6 py-3.5 text-slate-500 font-black uppercase text-[10px] tracking-widest hover:text-slate-800">Cancel</button>
                         <button onClick={applyAiPlan} disabled={aiPlanSelected.size === 0} className="px-8 py-3.5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl hover:bg-indigo-700 transition-all disabled:opacity-40 flex items-center gap-2"><Check size={14} /> Apply {aiPlanSelected.size} groups</button>
                      </div>
                   </div>
                </div>
             </div>
           )}

           {activeTab === 'product' && (
             <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                <div className="p-10 border-b border-slate-50 bg-indigo-500 bg-opacity-5 flex flex-col md:flex-row md:items-center justify-between gap-6">
                   <div className="flex items-center gap-5"><div className="w-16 h-16 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl"><ShoppingBag size={32} /></div><div><h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Master SKU Allocation</h3><p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Assign categories to Normalized Master SKUs</p></div></div>
                   <div className="flex flex-wrap gap-4 items-center">
                      <div className="relative"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} /><input type="text" placeholder="Find SKU..." value={skuSearchTerm} onChange={e => setSkuSearchTerm(e.target.value)} className="pl-11 pr-4 py-3 bg-white border border-slate-100 rounded-xl text-sm outline-none shadow-sm min-w-[240px]"/></div>
                      <button onClick={autoCategorizeWithAI} disabled={isMappingAI || menuSegments.length === 0} className="px-6 py-4 bg-slate-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-all shadow-xl disabled:opacity-50">{isMappingAI ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Auto-Categorize</button>
                   </div>
                </div>
                <div className="p-10 overflow-x-auto"><table className="w-full text-left"><thead><tr className="border-b border-slate-100"><th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest">Master Menu Item</th><th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase text-center">Core Pillar</th><th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase text-center">POS Segment</th><th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase text-right">Integrity</th></tr></thead><tbody className="divide-y divide-slate-50">{filteredSkuList.map(name => (
                  <tr key={name} className="group hover:bg-slate-50/50 transition-colors">
                     <td className="px-6 py-5"><p className="text-sm font-black text-slate-800 uppercase">{name}</p></td>
                     <td className="px-6 py-5"><div className="flex items-center justify-center gap-2">{SKU_CATEGORIES.map(cat => (<button key={cat.id} onClick={() => setSkuMappings(prev => ({ ...prev, [name]: { ...prev[name], category: cat.id, isInherited: false } }))} className={`px-3 py-2 rounded-xl text-[8px] font-black uppercase transition-all flex items-center gap-1.5 ${skuMappings[name]?.category === cat.id ? `${cat.color} text-white shadow-md` : 'bg-white text-slate-400 border border-slate-100 hover:border-indigo-200'}`}><cat.icon size={10} /> {cat.label}</button>))}</div></td>
                     <td className="px-6 py-5"><div className="relative max-w-[180px] mx-auto"><select value={skuMappings[name]?.segment || ''} onChange={e => setSkuMappings(prev => ({ ...prev, [name]: { ...prev[name], segment: e.target.value, isInherited: false } }))} className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none uppercase text-center"><option value="">-- Unsegmented --</option>{menuSegments.map(seg => <option key={seg} value={seg}>{seg}</option>)}</select><ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" /></div></td>
                     <td className="px-6 py-5 text-right">{skuMappings[name]?.isInherited ? (<div className="inline-flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-[9px] font-black uppercase border border-indigo-100"><History size={10} /> Inherited</div>) : (skuMappings[name]?.category !== 'UNMAPPED' && skuMappings[name]?.segment) ? (<div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-[9px] font-black uppercase"><Check size={10} /> Ready</div>) : (<div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-600 rounded-full text-[9px] font-black uppercase"><Zap size={10} /> Missing Info</div>)}</td>
                  </tr>
                ))}</tbody></table></div></section>
           )}

           {activeTab === 'tiered-costs' && (
             <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
                <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm overflow-hidden flex flex-col">
                   <div className="p-10 border-b border-slate-50 bg-indigo-500 bg-opacity-5 flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="flex items-center gap-5">
                         <div className="w-16 h-16 bg-slate-900 rounded-[1.5rem] flex items-center justify-center text-white shadow-xl"><DollarSign size={32} /></div>
                         <div>
                            <h3 className="text-2xl font-black text-slate-900 tracking-tight uppercase">Tiered SKU Costs</h3>
                            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest mt-1">Contextual packaging for service styles</p>
                         </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-4">
                         {/* Cards / Spreadsheet view toggle */}
                         <div className="flex bg-white border border-slate-100 p-1 rounded-xl shadow-sm gap-1">
                            {([['cards', LayoutGrid, 'Cards'], ['sheet', Table2, 'Spreadsheet']] as const).map(([v, Icon, label]) => (
                              <button key={v} onClick={() => setCostsView(v)} className={`px-3 py-2 rounded-lg flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest transition-all ${costsView === v ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-700'}`}>
                                 <Icon size={13} /> {label}
                              </button>
                            ))}
                         </div>
                         <button onClick={exportCostsExcel} disabled={filteredCostsList.length === 0} className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all disabled:opacity-40">
                            <FileSpreadsheet size={14} /> Excel
                         </button>
                         <div className="bg-white px-4 py-2.5 rounded-xl border border-slate-100 flex items-center gap-2 shadow-sm">
                            <Filter size={14} className="text-indigo-500" />
                            <select value={costsSegmentFilter} onChange={e => { setCostsSegmentFilter(e.target.value); setSelectedSkus(new Set()); }} className="bg-transparent font-bold text-xs outline-none uppercase min-w-[140px]">
                               <option value="all">All Segments</option>
                               {menuSegments.map(s => <option key={s} value={s}>{s}</option>)}
                            </select>
                         </div>
                         <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                            <input type="text" placeholder="Find Master SKU..." value={costsSearchTerm} onChange={e => setCostsSearchTerm(e.target.value)} className="pl-11 pr-4 py-3 bg-white border border-slate-100 rounded-xl text-sm outline-none shadow-sm min-w-[240px]"/>
                         </div>
                      </div>
                   </div>

                   <div className="p-10 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                         <button onClick={toggleAllVisibleCosts} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-indigo-500 transition-all">
                            {selectedSkus.size > 0 && selectedSkus.size === filteredCostsList.length ? <CheckSquare size={16} className="text-indigo-600"/> : <Square size={16} />}
                            Select Visible
                         </button>
                         <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                           {selectedSkus.size} Items Selected
                         </p>
                      </div>
                      <div className="flex items-center gap-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                         <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-indigo-500" /> Tier 1 focus</span>
                         <span className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Tier 2 focus</span>
                      </div>
                   </div>

                   {costsView === 'sheet' && (
                     <div className="p-6 md:p-8 overflow-x-auto max-h-[800px] overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse min-w-[820px]">
                           <thead className="sticky top-0 z-10">
                              <tr className="bg-slate-900 text-white">
                                 <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Master SKU</th>
                                 <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest">Segment</th>
                                 <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest">Category</th>
                                 <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-center">Ingredient ₹</th>
                                 <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-center text-indigo-300">Tier 1 ₹</th>
                                 <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-center text-emerald-300">Tier 2 ₹</th>
                                 <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-right">T1 Total</th>
                                 <th className="px-3 py-3 text-[10px] font-black uppercase tracking-widest text-right">T2 Total</th>
                              </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                              {filteredCostsList.map((itemName, idx) => {
                                const c = editingCosts[itemName] || { ingredient: '', tier1: '', tier2: '' };
                                const ingr = costNum(c.ingredient), t1 = costNum(c.tier1), t2 = costNum(c.tier2);
                                const isSelected = selectedSkus.has(itemName);
                                return (
                                  <tr key={itemName} className={`transition-colors ${isSelected ? 'bg-indigo-50/60' : idx % 2 ? 'bg-slate-50/50' : 'bg-white'} hover:bg-indigo-50/40`}>
                                     <td className="px-4 py-2">
                                        <div className="flex items-center gap-2.5">
                                           <button onClick={() => toggleSkuSelection(itemName)} className={`shrink-0 transition-colors ${isSelected ? 'text-indigo-600' : 'text-slate-300 hover:text-slate-500'}`}>
                                              {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                                           </button>
                                           <span className="text-xs font-black text-slate-800 uppercase truncate max-w-[220px]">{itemName}</span>
                                        </div>
                                     </td>
                                     <td className="px-3 py-2 text-[10px] font-bold text-slate-500 uppercase">{skuMappings[itemName]?.segment || 'UNSEGMENTED'}</td>
                                     <td className="px-3 py-2 text-[10px] font-bold text-indigo-500 uppercase">{skuMappings[itemName]?.category || 'UNMAPPED'}</td>
                                     <td className="px-2 py-2">
                                        <input type="number" value={c.ingredient || ''} onChange={e => setEditingCosts({ ...editingCosts, [itemName]: { ...editingCosts[itemName], ingredient: e.target.value } })} className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg font-black text-slate-700 outline-none text-xs text-center focus:border-slate-400 focus:bg-white" placeholder="0" />
                                     </td>
                                     <td className="px-2 py-2">
                                        <div className="flex items-center gap-1.5">
                                           <input type="number" value={c.tier1 || ''} onChange={e => setEditingCosts({ ...editingCosts, [itemName]: { ...editingCosts[itemName], tier1: e.target.value } })} className="w-24 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg font-black text-indigo-600 outline-none text-xs text-center focus:border-indigo-400 focus:bg-white" placeholder="0" />
                                           <div className="relative">
                                              <select className="w-8 h-8 opacity-0 absolute inset-0 cursor-pointer" title="Apply serving template" onChange={e => { const opt = servingOptions.find(o => o.id === e.target.value); if (opt) setEditingCosts({ ...editingCosts, [itemName]: { ...editingCosts[itemName], tier1: opt.totalCost.toString() } }); }} value="">
                                                 <option value="">Template</option>
                                                 {servingOptions.map(o => <option key={o.id} value={o.id}>{o.name} (₹{o.totalCost})</option>)}
                                              </select>
                                              <div className="w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-400 rounded-lg pointer-events-none"><ChevronDown size={13} /></div>
                                           </div>
                                        </div>
                                     </td>
                                     <td className="px-2 py-2">
                                        <div className="flex items-center gap-1.5">
                                           <input type="number" value={c.tier2 || ''} onChange={e => setEditingCosts({ ...editingCosts, [itemName]: { ...editingCosts[itemName], tier2: e.target.value } })} className="w-24 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg font-black text-emerald-600 outline-none text-xs text-center focus:border-emerald-400 focus:bg-white" placeholder="0" />
                                           <div className="relative">
                                              <select className="w-8 h-8 opacity-0 absolute inset-0 cursor-pointer" title="Apply serving template" onChange={e => { const opt = servingOptions.find(o => o.id === e.target.value); if (opt) setEditingCosts({ ...editingCosts, [itemName]: { ...editingCosts[itemName], tier2: opt.totalCost.toString() } }); }} value="">
                                                 <option value="">Template</option>
                                                 {servingOptions.map(o => <option key={o.id} value={o.id}>{o.name} (₹{o.totalCost})</option>)}
                                              </select>
                                              <div className="w-8 h-8 flex items-center justify-center bg-slate-100 text-slate-400 rounded-lg pointer-events-none"><ChevronDown size={13} /></div>
                                           </div>
                                        </div>
                                     </td>
                                     <td className="px-3 py-2 text-right text-xs font-black text-indigo-600">₹{(ingr + t1).toLocaleString('en-IN')}</td>
                                     <td className="px-3 py-2 text-right text-xs font-black text-emerald-600">₹{(ingr + t2).toLocaleString('en-IN')}</td>
                                  </tr>
                                );
                              })}
                           </tbody>
                        </table>
                        {filteredCostsList.length === 0 && (
                          <div className="py-20 text-center"><SearchX size={48} className="mx-auto text-slate-200 mb-4" /><p className="text-slate-400 font-black uppercase text-xs tracking-widest">No matching Master SKUs found</p></div>
                        )}
                     </div>
                   )}

                   {costsView === 'cards' && (
                   <div className="p-10 space-y-6 max-h-[800px] overflow-y-auto custom-scrollbar">
                      {filteredCostsList.map(itemName => {
                        const isSelected = selectedSkus.has(itemName);
                        return (
                          <div key={itemName} className={`bg-slate-50 rounded-[2.5rem] border shadow-sm overflow-hidden group transition-all ${isSelected ? 'border-indigo-400 ring-2 ring-indigo-500/10' : 'border-slate-100 hover:border-indigo-100'}`}>
                             <div className="p-6 bg-slate-900 text-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                                <div className="flex items-center gap-5">
                                   <button onClick={() => toggleSkuSelection(itemName)} className={`transition-colors ${isSelected ? 'text-indigo-400' : 'text-slate-600 hover:text-white'}`}>
                                      {isSelected ? <CheckSquare size={24} /> : <Square size={24} />}
                                   </button>
                                   <div>
                                      <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-0.5">Master SKU Identity</p>
                                      <div className="flex items-center gap-3">
                                         <h4 className="text-md font-black uppercase tracking-tight truncate max-w-[300px]">{itemName}</h4>
                                         <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-lg text-[8px] font-black uppercase text-indigo-300 tracking-tighter">
                                            {skuMappings[itemName]?.segment || 'UNSEGMENTED'}
                                         </span>
                                      </div>
                                   </div>
                                </div>
                                <div className="flex items-center gap-5">
                                   <div className="text-right"><p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Base Category</p><p className="text-[10px] font-black text-indigo-300 uppercase">{skuMappings[itemName]?.category || 'UNMAPPED'}</p></div>
                                   <div className="h-10 w-px bg-white/10" />
                                   <div className="flex flex-col">
                                      <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Ingredient Cost (₹)</label>
                                      <input type="number" value={editingCosts[itemName]?.ingredient || ''} onChange={e => setEditingCosts({...editingCosts, [itemName]: { ...editingCosts[itemName], ingredient: e.target.value }})} className="w-28 px-4 py-2 bg-white/10 border border-white/10 rounded-xl font-black text-emerald-400 outline-none text-sm transition-all focus:bg-white/20" placeholder="0.00" />
                                   </div>
                                </div>
                             </div>
                             <div className={`p-8 grid grid-cols-1 lg:grid-cols-2 gap-12 transition-colors ${isSelected ? 'bg-indigo-50/30' : 'bg-white'}`}>
                                <div className="space-y-6">
                                   <div className="flex items-center gap-4">
                                      <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-xs shadow-inner">T1</div>
                                      <div><h5 className="text-xs font-black text-slate-900 uppercase">Tier 1 Service (Disposable focus)</h5><p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Small outlet, disposable utensils</p></div>
                                   </div>
                                   <div className="flex gap-4">
                                      <div className="flex-1 relative">
                                         <select className="w-full px-5 py-4 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none text-[11px] appearance-none bg-slate-50 uppercase hover:bg-slate-100 transition-colors" onChange={e => { const opt = servingOptions.find(o => o.id === e.target.value); if (opt) setEditingCosts({...editingCosts, [itemName]: { ...editingCosts[itemName], tier1: opt.totalCost.toString() }}); }} value="">
                                            <option value="">-- Apply Template --</option>
                                            {servingOptions.map(o => <option key={o.id} value={o.id}>{o.name} (₹{o.totalCost})</option>)}
                                         </select>
                                         <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                      </div>
                                      <input type="number" value={editingCosts[itemName]?.tier1 || ''} onChange={e => setEditingCosts({...editingCosts, [itemName]: { ...editingCosts[itemName], tier1: e.target.value }})} className="w-32 px-5 py-4 bg-indigo-50 border border-indigo-100 rounded-2xl font-black text-indigo-600 outline-none text-sm text-center" placeholder="₹ T1" />
                                   </div>
                                </div>
                                <div className="space-y-6 border-l border-slate-50 pl-12">
                                   <div className="flex items-center gap-4">
                                      <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center font-black text-xs shadow-inner">T2</div>
                                      <div><h5 className="text-xs font-black text-slate-900 uppercase">Tier 2 Service (Proper service)</h5><p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Full service, reusable utensils</p></div>
                                   </div>
                                   <div className="flex gap-4">
                                      <div className="flex-1 relative">
                                         <select className="w-full px-5 py-4 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none text-[11px] appearance-none bg-slate-50 uppercase hover:bg-slate-100 transition-colors" onChange={e => { const opt = servingOptions.find(o => o.id === e.target.value); if (opt) setEditingCosts({...editingCosts, [itemName]: { ...editingCosts[itemName], tier2: opt.totalCost.toString() }}); }} value="">
                                            <option value="">-- Apply Template --</option>
                                            {servingOptions.map(o => <option key={o.id} value={o.id}>{o.name} (₹{o.totalCost})</option>)}
                                         </select>
                                         <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                      </div>
                                      <input type="number" value={editingCosts[itemName]?.tier2 || ''} onChange={e => setEditingCosts({...editingCosts, [itemName]: { ...editingCosts[itemName], tier2: e.target.value }})} className="w-32 px-5 py-4 bg-emerald-50 border border-emerald-100 rounded-2xl font-black text-emerald-600 outline-none text-sm text-center" placeholder="₹ T2" />
                                   </div>
                                </div>
                             </div>
                          </div>
                        );
                      })}
                      {filteredCostsList.length === 0 && (
                        <div className="py-20 text-center"><SearchX size={48} className="mx-auto text-slate-200 mb-4" /><p className="text-slate-400 font-black uppercase text-xs tracking-widest">No matching Master SKUs found</p></div>
                      )}
                   </div>
                   )}
                </section>

                {selectedSkus.size > 0 && (
                  <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-10 duration-500 w-full max-w-5xl px-4">
                     <div className="bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-[3rem] p-6 flex flex-col md:flex-row items-center justify-between shadow-2xl gap-8">
                        <div className="flex items-center gap-6 pl-4 border-r border-white/10 pr-8">
                           <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg">
                              <MousePointer2 size={28} />
                           </div>
                           <div>
                              <p className="text-white font-black text-xl leading-tight">{selectedSkus.size} Items</p>
                              <p className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.2em]">Batch Commando</p>
                           </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-center gap-6 flex-1 px-4">
                           <div className="flex flex-col gap-2 min-w-[120px]">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Ingredients</label>
                              <input 
                                type="number" 
                                placeholder="₹ Core" 
                                onChange={(e) => applyBatchIngredient(e.target.value)}
                                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-xs font-black text-emerald-400 outline-none"
                              />
                           </div>
                           
                           <div className="flex flex-col gap-2 min-w-[180px]">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Tier 1 Servings</label>
                              <div className="relative">
                                 <select 
                                   onChange={(e) => applyBatchTier1(e.target.value)}
                                   className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-10 py-2.5 text-[10px] font-black text-indigo-300 outline-none appearance-none uppercase"
                                 >
                                    <option value="">-- Apply T1 --</option>
                                    {servingOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                 </select>
                                 <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                              </div>
                           </div>

                           <div className="flex flex-col gap-2 min-w-[180px]">
                              <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Tier 2 Servings</label>
                              <div className="relative">
                                 <select 
                                   onChange={(e) => applyBatchTier2(e.target.value)}
                                   className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-10 py-2.5 text-[10px] font-black text-emerald-300 outline-none appearance-none uppercase"
                                 >
                                    <option value="">-- Apply T2 --</option>
                                    {servingOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                                 </select>
                                 <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500" />
                              </div>
                           </div>
                        </div>

                        <div className="flex items-center gap-4 border-l border-white/10 pl-8">
                           <button onClick={() => setSelectedSkus(new Set())} className="text-slate-400 hover:text-white font-black uppercase text-[10px] tracking-widest transition-colors">Clear</button>
                           <button 
                             onClick={() => { setActiveTab('tiered-costs'); handleSaveCosts(); }}
                             className="px-8 py-4 bg-emerald-500 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-emerald-900/40 hover:bg-emerald-600 transition-all flex items-center gap-2"
                           >
                              <Save size={16} /> Batch Commit
                           </button>
                        </div>
                     </div>
                  </div>
                )}
             </div>
           )}

           {activeTab === 'segments' && (
              <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm p-12">
                <div className="flex items-center gap-4 mb-10"><div className="p-3 bg-indigo-500 rounded-2xl text-white"><Tag size={24} /></div><h3 className="text-xl font-black text-slate-900 uppercase">Segment Registry</h3></div>
                <div className="flex gap-4 mb-10">
                  <input type="text" value={newSegment} onChange={e => setNewSegment(e.target.value)} placeholder="New POS Category..." className="flex-1 px-6 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold outline-none" onKeyPress={e => e.key === 'Enter' && (newSegment.trim() && !menuSegments.includes(newSegment.toUpperCase()) && (setMenuSegments([...menuSegments, newSegment.toUpperCase()].sort()), setNewSegment('')))}/>
                  <button onClick={() => { if(newSegment.trim() && !menuSegments.includes(newSegment.toUpperCase())) { setMenuSegments([...menuSegments, newSegment.toUpperCase()].sort()); setNewSegment(''); } }} className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs shadow-xl"><Plus size={18}/> Add</button>
                </div>
                <div className="flex flex-wrap gap-4">{menuSegments.map(seg => (<div key={seg} className="flex items-center gap-3 px-5 py-3 bg-indigo-50 border border-indigo-100 rounded-2xl animate-in zoom-in"><span className="text-xs font-black text-indigo-600 uppercase tracking-widest">{seg}</span><button onClick={() => setMenuSegments(menuSegments.filter(s => s !== seg))} className="text-indigo-300 hover:text-rose-500"><X size={14} /></button></div>))}</div>
              </section>
           )}

           {activeTab === 'consumables' && (
              <section className="bg-white rounded-[3rem] border border-slate-100 shadow-sm p-12">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 bg-orange-500 rounded-2xl text-white"><Flame size={24} /></div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase">Tracked Consumables</h3>
                    <p className="text-slate-400 text-sm font-medium">Items counted by unit, not just by spend — so consumption can be compared against sales.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 mb-10 p-5 bg-amber-50 border border-amber-100 rounded-2xl">
                  <Info size={16} className="text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-xs font-medium text-amber-800 leading-relaxed">
                    Adding a category here makes <strong>quantity mandatory</strong> in the Crew Terminal for that category.
                    Tell your crew before saving. Historical entries without a quantity show as "not recorded", not zero —
                    set an estimated unit cost below to reconstruct them from the amount spent.
                  </p>
                </div>

                <div className="space-y-5">
                  {trackedConsumables.length === 0 && (
                    <p className="text-sm font-medium text-slate-400 py-8 text-center">No consumables tracked yet.</p>
                  )}
                  {trackedConsumables.map((c, idx) => {
                    const patch = (next: Partial<TrackedConsumable>) =>
                      setTrackedConsumables(trackedConsumables.map((x, i) => i === idx ? { ...x, ...next } : x));
                    return (
                      <div key={c.id} className={`p-6 rounded-3xl border transition-all ${c.active === false ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200 shadow-sm'}`}>
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
                          <div className="lg:col-span-4 space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</label>
                            <select value={c.category} onChange={e => patch({ category: e.target.value })}
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-indigo-400">
                              <option value="">Select…</option>
                              {consumableCategoryOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          </div>
                          <div className="lg:col-span-3 space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Label</label>
                            <input type="text" value={c.label} onChange={e => patch({ label: e.target.value })} placeholder="Gas cylinders"
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-indigo-400" />
                          </div>
                          <div className="lg:col-span-2 space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unit</label>
                            <input type="text" value={c.unitLabel} onChange={e => patch({ unitLabel: e.target.value })} placeholder="cylinder"
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-indigo-400" />
                          </div>
                          <div className="lg:col-span-2 space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest" title="Used to estimate months where no quantity was recorded">Est. ₹/unit</label>
                            <input type="number" min="0" value={c.estimatedUnitCost ?? ''} onChange={e => patch({ estimatedUnitCost: e.target.value ? parseFloat(e.target.value) : undefined })} placeholder="1900"
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-indigo-400" />
                          </div>
                          <div className="lg:col-span-1 flex items-center gap-2 justify-end pb-1">
                            <button onClick={() => patch({ active: c.active === false })} title={c.active === false ? 'Enable' : 'Disable'}
                              className={`p-2.5 rounded-xl transition-all ${c.active === false ? 'bg-slate-100 text-slate-400' : 'bg-emerald-50 text-emerald-600'}`}>
                              <Check size={16} />
                            </button>
                            <button onClick={() => setTrackedConsumables(trackedConsumables.filter((_, i) => i !== idx))}
                              className="p-2.5 bg-rose-50 text-rose-400 rounded-xl hover:bg-rose-500 hover:text-white transition-all">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 pt-4 border-t border-slate-100">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Units per entry</label>
                            <input type="number" min="1" value={c.unitsPerPurchase ?? 1} onChange={e => patch({ unitsPerPurchase: e.target.value ? parseFloat(e.target.value) : undefined })}
                              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-indigo-400" />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Alert threshold %</label>
                            <input type="number" min="1" value={c.alertThresholdPct ?? 15} onChange={e => patch({ alertThresholdPct: e.target.value ? parseFloat(e.target.value) : undefined })}
                              className="w-full px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl font-bold text-sm outline-none focus:border-indigo-400" />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  onClick={() => setTrackedConsumables([...trackedConsumables, {
                    id: `c-${Date.now()}`, category: '', label: '', unitLabel: 'unit',
                    unitsPerPurchase: 1, alertThresholdPct: 15, active: true,
                  }])}
                  className="mt-8 flex items-center gap-2 px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs shadow-xl hover:bg-indigo-700 transition-all">
                  <Plus size={18} /> Add Consumable
                </button>
              </section>
           )}

           {activeTab === 'servings' && (
              <section className="bg-white rounded-[3.5rem] p-12 border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-10">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-amber-500 rounded-2xl text-white"><Box size={24} /></div>
                    <h3 className="text-xl font-black text-slate-900 uppercase">
                      {editingServingId ? `Edit Template: ${newServingName}` : 'Packaging Architecture'}
                    </h3>
                  </div>
                  <button 
                    onClick={() => { if(isAddingServing) resetServingForm(); else setIsAddingServing(true); }} 
                    className={`px-6 py-3 rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg transition-all ${isAddingServing ? 'bg-slate-200 text-slate-600' : 'bg-indigo-600 text-white'}`}
                  >
                    {isAddingServing ? 'Cancel' : 'New Template'}
                  </button>
                </div>

                {isAddingServing && (
                  <div className="bg-slate-50 rounded-[2.5rem] border border-slate-200 p-8 mb-10 animate-in zoom-in">
                    <div className="max-w-3xl space-y-6">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Template Title</label>
                        <input type="text" value={newServingName} onChange={e => setNewServingName(e.target.value)} placeholder="e.g., Ramen Delivery Bundle..." className="w-full px-6 py-4 rounded-2xl bg-white border border-slate-200 font-bold outline-none" />
                      </div>
                      <div className="flex gap-3 items-end">
                        <div className="flex-[2] space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Add Resource</label>
                          <input type="text" value={curItemName} onChange={e => setCurItemName(e.target.value)} placeholder="Resource name..." className="w-full px-6 py-3 rounded-xl bg-white border outline-none" />
                        </div>
                        <div className="flex-1 space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Unit Cost (₹)</label>
                          <input type="number" value={curItemPrice} onChange={e => setCurItemPrice(e.target.value)} placeholder="₹" className="w-full px-6 py-3 rounded-xl bg-white border outline-none" />
                        </div>
                        <button onClick={() => { if(curItemName.trim() && !isNaN(parseFloat(curItemPrice))) { setNewServingItems([...newServingItems, { name: curItemName.toUpperCase(), price: parseFloat(curItemPrice) }]); setCurItemName(''); setCurItemPrice(''); } }} className="p-3 bg-slate-900 text-white rounded-xl shadow-md hover:bg-indigo-600 transition-colors mb-0.5"><Plus size={18}/></button>
                      </div>
                      <div className="space-y-2">
                        {newServingItems.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center bg-white px-5 py-3 rounded-xl border border-slate-100 text-xs font-black uppercase tracking-tight text-slate-600 group">
                            <span>{item.name}</span>
                            <div className="flex items-center gap-6">
                              <span className="text-slate-900">₹{item.price}</span>
                              <button onClick={() => setNewServingItems(newServingItems.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-rose-500 transition-colors">
                                <Trash2 size={14}/>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button 
                        onClick={async () => { 
                          if(!newServingName.trim() || newServingItems.length === 0) return; 
                          setSaving(true); 
                          try { 
                            const totalCost = newServingItems.reduce((sum, item) => sum + item.price, 0); 
                            const data = { name: newServingName.toUpperCase(), items: newServingItems, totalCost, userId: user.uid, updatedAt: Date.now() };
                            if (editingServingId) {
                              await setDoc(doc(db, 'serving_options', editingServingId), data, { merge: true });
                              invalidateCached('serving_options', user.uid);
                            } else {
                              await addDoc(collection(db, 'serving_options'), data);
                              invalidateCached('serving_options', user.uid);
                            }
                            resetServingForm();
                            fetchData(); 
                          } catch(e) { setError("Failed to save."); } finally { setSaving(false); } 
                        }} 
                        disabled={saving}
                        className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs shadow-xl flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all disabled:opacity-50"
                      >
                        {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                        {editingServingId ? 'Update Template' : 'Commit New Template'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {servingOptions.map((opt) => (
                    <div key={opt.id} className="bg-slate-50 rounded-[2rem] p-8 border border-slate-100 relative group flex flex-col hover:border-indigo-100 transition-all">
                      <div className="absolute top-6 right-6 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => onEditServing(opt)} className="p-2 text-indigo-400 hover:text-indigo-600 bg-white rounded-lg shadow-sm border border-indigo-50">
                          <Edit3 size={16}/>
                        </button>
                        <button onClick={async () => { if(confirm("Permanently delete this template?")) { await deleteDoc(doc(db, 'serving_options', opt.id!)); invalidateCached('serving_options', user.uid); fetchData(); } }} className="p-2 text-rose-300 hover:text-rose-500 bg-white rounded-lg shadow-sm border border-rose-50">
                          <Trash2 size={16}/>
                        </button>
                      </div>
                      <h4 className="text-lg font-black text-slate-900 truncate mb-4 pr-16">{opt.name}</h4>
                      <div className="space-y-2 mb-8 flex-1">
                        {opt.items.map((i, idx) => (
                          <div key={idx} className="flex justify-between text-[9px] font-bold text-slate-500 uppercase tracking-tight">
                            <span>{i.name}</span>
                            <span>₹{i.price}</span>
                          </div>
                        ))}
                      </div>
                      <div className="pt-4 border-t border-slate-200 flex justify-between items-center">
                        <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Aggregate Cost</span>
                        <span className="text-xl font-black text-slate-900">₹{opt.totalCost.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                  {servingOptions.length === 0 && (
                    <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-200 rounded-[2.5rem]">
                      <Box size={48} className="mx-auto text-slate-200 mb-4" />
                      <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">No Serving Templates Configured</p>
                    </div>
                  )}
                </div>
              </section>
           )}
        </div>
      )}
    </div>
  );
};

export default CategorySettings;
