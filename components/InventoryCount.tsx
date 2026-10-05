import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, doc, getDocs, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import {
  InventoryBucket, InventoryCount as InventoryCountRecord, InventoryCountLine,
  InventoryItem, MeasureUnit, MEASURE_UNITS, MONTH_NAMES, RecipeIngredient,
  StoreRental, getOutletName,
} from '../types';
import { managerOutlet } from '../outletScope';
import { AUGUST_2026_STOCK_IMPORT } from './augustStockImport';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ClipboardCheck,
  Coffee, Loader2, PackagePlus, Plus, Save, Search, ShoppingBasket,
  Utensils, X,
} from 'lucide-react';

interface Props {
  user: User;
  dataOwnerId: string;
  userProfile?: { role?: string; assignedOutlet?: string };
}

type DraftLine = InventoryCountLine & { dirty?: boolean };

const BUCKETS: { id: InventoryBucket; label: string; short: string; activeClass: string; iconClass: string; icon: React.ReactNode }[] = [
  { id: 'FOOD', label: 'Food ingredients', short: 'Food', activeClass: 'ring-2 ring-emerald-400 border-transparent bg-emerald-50', iconClass: 'text-emerald-600', icon: <Utensils size={15} /> },
  { id: 'DRINKS', label: 'Drink ingredients', short: 'Drinks', activeClass: 'ring-2 ring-indigo-400 border-transparent bg-indigo-50', iconClass: 'text-indigo-600', icon: <Coffee size={15} /> },
  { id: 'FOOD SERVINGS', label: 'Food packaging', short: 'Food packaging', activeClass: 'ring-2 ring-amber-400 border-transparent bg-amber-50', iconClass: 'text-amber-600', icon: <ShoppingBasket size={15} /> },
  { id: 'DRINKS SERVINGS', label: 'Drink packaging', short: 'Drink packaging', activeClass: 'ring-2 ring-rose-400 border-transparent bg-rose-50', iconClass: 'text-rose-600', icon: <PackagePlus size={15} /> },
];

const unitOptions = Object.keys(MEASURE_UNITS) as MeasureUnit[];
const blankTotals = (): Record<InventoryBucket, number> => ({
  FOOD: 0, DRINKS: 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0,
});
const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;
const countTotal = (totals?: Partial<Record<InventoryBucket, number>>) => Object.values(totals || {}).reduce<number>((sum, value) => sum + (Number(value) || 0), 0);
const keyFor = (name: string) => name.trim().toUpperCase().replace(/\s+/g, ' ');
const compactKeyFor = (name: string) => keyFor(name).replace(/[^A-Z0-9]/g, '');
// Item names are not a reliable identifier on their own. This intentionally
// ignores word order, punctuation and case, so "Ajitama egg" and "EGG, AJITAMA"
// refer to the same catalogue item. Unit price is deliberately excluded: it
// belongs to each month's saved count line, not the catalogue record.
const tokenKeyFor = (name: string) => keyFor(name).split(' ').filter(Boolean).sort().join(' ');
const catalogIdentity = (item: Pick<InventoryItem, 'name' | 'unit'>) => [tokenKeyFor(item.name), item.unit].join('|');
const inventoryDocId = (ownerId: string, name: string) => `${ownerId}_inventory_${compactKeyFor(tokenKeyFor(name)).slice(0, 120)}`;

const editDistance = (a: string, b: string) => {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return previous[b.length];
};

const closeNameMatch = (name: string, candidates: InventoryItem[]) => {
  const compact = compactKeyFor(name);
  const tokens = tokenKeyFor(name);
  if (!compact) return undefined;
  return candidates
    .map(item => {
      const candidate = compactKeyFor(item.name);
      const distance = editDistance(compact, candidate);
      const similarity = 1 - distance / Math.max(compact.length, candidate.length, 1);
      return { item, exact: keyFor(item.name) === keyFor(name), compactExact: compact === candidate, reordered: tokenKeyFor(item.name) === tokens, similarity };
    })
    .filter(match => match.exact || match.compactExact || match.reordered || (compact.length >= 5 && match.similarity >= 0.88))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(b.compactExact) - Number(a.compactExact) || Number(b.reordered) - Number(a.reordered) || b.similarity - a.similarity)[0];
};

const canonicalItems = (source: InventoryItem[]) => {
  const byIdentity = new Map<string, InventoryItem>();
  source.forEach(item => {
    const identity = catalogIdentity(item);
    const current = byIdentity.get(identity);
    // Recipe-linked records remain the preferred canonical item. Otherwise the
    // most recently maintained record wins, without changing any historical row.
    if (!current || (!!item.recipeIngredientId && !current.recipeIngredientId) || (Boolean(item.recipeIngredientId) === Boolean(current.recipeIngredientId) && item.updatedAt > current.updatedAt)) {
      byIdentity.set(identity, item);
    }
  });
  return [...byIdentity.values()].sort((a, b) => a.name.localeCompare(b.name));
};
const unitForSheet = (sourceUnit: string): MeasureUnit => {
  const value = sourceUnit.trim().toLowerCase();
  if (value === 'kg' || value.includes('gm') || value.includes('grm')) return 'kg';
  if (value === 'l' || value.includes('litre') || value.includes('liter')) return 'l';
  if (value === 'ml') return 'ml';
  return 'pc';
};

const bucketForIngredient = (ingredient: RecipeIngredient): InventoryBucket => {
  const category = (ingredient.category || '').toLowerCase();
  const name = (ingredient.name || '').toLowerCase();
  if (/tea|coffee|syrup|puree/.test(category)) return 'DRINKS';
  // Word boundaries matter: the former loose `ice` match classified Japanese
  // Rice as a drink because the word "rice" ends in "ice".
  return /\b(tea|coffee|espresso|latte|matcha|syrup|puree|juice|soda|milk|ice|cocoa|chocolate|vanilla|caramel|frappe|tonic|kombucha|water)\b|double[ -]?shot/.test(name) ? 'DRINKS' : 'FOOD';
};

const InventoryCount: React.FC<Props> = ({ user, dataOwnerId, userProfile }) => {
  const scopedOutlet = managerOutlet(userProfile as any);
  const canManageItems = !scopedOutlet;
  const now = new Date();
  const [month, setMonth] = useState(MONTH_NAMES[now.getMonth()]);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [outletId, setOutletId] = useState(scopedOutlet || '40543');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [allItems, setAllItems] = useState<InventoryItem[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [savedCounts, setSavedCounts] = useState<InventoryCountRecord[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [status, setStatus] = useState<'draft' | 'reviewed'>('draft');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [importingAugust, setImportingAugust] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [bucket, setBucket] = useState<InventoryBucket | 'ALL'>('ALL');
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', unit: 'kg' as MeasureUnit, unitCost: '', bucket: 'FOOD' as InventoryBucket });

  const activeOutlets = useMemo(() => {
    const fromRentals = rentals.filter(r => r.status === 'active').map(r => ({ id: r.outletId, name: r.storeName || getOutletName(r.outletId) }));
    const fallback = [{ id: '40543', name: getOutletName('40543') }, { id: '40140', name: getOutletName('40140') }];
    const deduped = (fromRentals.length ? fromRentals : fallback).filter((row, i, all) => all.findIndex(x => x.id === row.id) === i);
    return scopedOutlet ? deduped.filter(row => row.id === scopedOutlet) : deduped;
  }, [rentals, scopedOutlet]);

  useEffect(() => {
    if (scopedOutlet) setOutletId(scopedOutlet);
    else if (!activeOutlets.some(o => o.id === outletId) && activeOutlets[0]) setOutletId(activeOutlets[0].id);
  }, [activeOutlets, outletId, scopedOutlet]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemResult, rentalResult, countResult] = await Promise.allSettled([
        getDocs(query(collection(db, 'inventory_items'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'rentals'), where('userId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'inventory_counts'), where('ownerId', '==', dataOwnerId), where('userId', '==', dataOwnerId))),
      ]);
      if (itemResult.status === 'rejected') throw itemResult.reason;
      const itemSnap = itemResult.value;
      const rentalSnap = rentalResult.status === 'fulfilled' ? rentalResult.value : null;
      const countSnap = countResult.status === 'fulfilled' ? countResult.value : null;
      const rawItems = itemSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as InventoryItem))
        .filter(item => item.active)
        .sort((a, b) => a.name.localeCompare(b.name));
      const nextItems = canonicalItems(rawItems);
      setAllItems(rawItems);
      setItems(nextItems);
      setRentals(rentalSnap?.docs.map(d => ({ id: d.id, ...d.data() } as StoreRental)) || []);

      const allSavedCounts = (countSnap?.docs || [])
        .map(d => ({ id: d.id, ...d.data() } as InventoryCountRecord))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setSavedCounts(allSavedCounts);
      const saved = allSavedCounts.find(count => count.outletId === outletId && count.month === month && count.year === year);
      setStatus(saved?.status || 'draft');
      setLines(saved?.lines?.length
        ? saved.lines.map(line => ({ ...line, quantity: Number(line.quantity || 0), unitCost: Number(line.unitCost || 0), total: Number(line.total || 0) }))
        : nextItems.map(item => ({ inventoryItemId: item.id!, name: item.name, bucket: item.bucket, unit: item.unit, sourceUnit: item.sourceUnit, quantity: 0, unitCost: Number(item.unitCost || 0), total: 0 }))
      );
    } catch (error) {
      console.error('Inventory count load failed', error);
      alert('Could not load stock-count data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [dataOwnerId, month, outletId, year]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo<Record<InventoryBucket, number>>(() => lines.reduce<Record<InventoryBucket, number>>((all, line) => {
    all[line.bucket] += (Number(line.quantity) || 0) * (Number(line.unitCost) || 0);
    return all;
  }, blankTotals()), [lines]);
  const totalValue = (Object.values(totals) as number[]).reduce((sum, value) => sum + value, 0);
  const selectedCount = savedCounts.find(count => count.outletId === outletId && count.month === month && count.year === year);
  const savedCountCards = useMemo(() => [...savedCounts].sort((a, b) => `${b.year}-${MONTH_NAMES.indexOf(b.month)}`.localeCompare(`${a.year}-${MONTH_NAMES.indexOf(a.month)}`)), [savedCounts]);
  const catalogueHealth = useMemo(() => {
    const groups = new Map<string, InventoryItem[]>();
    allItems.forEach(item => {
      const identity = catalogIdentity(item);
      groups.set(identity, [...(groups.get(identity) || []), item]);
    });
    const duplicates = [...groups.values()].filter(group => group.length > 1);
    const conflicts = duplicates.filter(group => new Set(group.map(item => item.bucket)).size > 1);
    const safeDuplicates = duplicates.filter(group => new Set(group.map(item => item.bucket)).size === 1);
    return {
      activeItems: allItems.length,
      uniqueItems: groups.size,
      duplicateGroups: duplicates.length,
      duplicateRows: duplicates.reduce((total, group) => total + group.length - 1, 0),
      safeGroups: duplicates.length - conflicts.length,
      safeRows: safeDuplicates.reduce((total, group) => total + group.length - 1, 0),
      conflicts,
    };
  }, [allItems]);
  const countedItems = lines.filter(line => line.dirty).length;
  const shownLines = useMemo(() => {
    const needle = queryText.trim().toLowerCase();
    return lines.filter(line => (bucket === 'ALL' || line.bucket === bucket) && (!needle || line.name.toLowerCase().includes(needle)));
  }, [bucket, lines, queryText]);

  const updateLine = (id: string, patch: Partial<DraftLine>) => {
    setLines(current => current.map(line => {
      if (line.inventoryItemId !== id) return line;
      const next = { ...line, ...patch, dirty: true };
      next.total = (Number(next.quantity) || 0) * (Number(next.unitCost) || 0);
      return next;
    }));
  };

  const saveCount = async (nextStatus: 'draft' | 'reviewed') => {
    if (!outletId) return;
    setSaving(true);
    try {
      const countId = `${dataOwnerId}_${outletId}_${year}_${month}`;
      const persistedLines = lines.map(({ dirty, ...line }) => ({ ...line, total: (Number(line.quantity) || 0) * (Number(line.unitCost) || 0) }));
      await setDoc(doc(db, 'inventory_counts', countId), {
        userId: dataOwnerId,
        ownerId: dataOwnerId,
        outletId,
        month,
        year,
        status: nextStatus,
        lines: persistedLines,
        totals,
        countedAt: Date.now(),
        updatedAt: Date.now(),
        updatedBy: user.uid,
      }, { merge: true });
      setStatus(nextStatus);
      setLines(current => current.map(line => ({ ...line, dirty: false })));
    } catch (error) {
      console.error('Inventory count save failed', error);
      alert('Could not save this stock count. No P&L value was changed.');
    } finally {
      setSaving(false);
    }
  };

  const addItem = async () => {
    const name = newItem.name.trim();
    const unitCost = Number(newItem.unitCost);
    if (!name || unitCost < 0) return;
    const match = closeNameMatch(name, allItems);
    if (match) {
      const relation = match.exact ? 'already exists' : `looks like "${match.item.name}"`;
      alert(`"${name}" ${relation}. Use the existing stock item instead of creating a duplicate.`);
      return;
    }
    setSaving(true);
    try {
      const ref = doc(db, 'inventory_items', inventoryDocId(dataOwnerId, name));
      const record: InventoryItem = {
        id: ref.id, userId: dataOwnerId, ownerId: dataOwnerId, name,
        unit: newItem.unit, unitCost, bucket: newItem.bucket, canonicalKey: tokenKeyFor(name), active: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await setDoc(ref, record);
      setAllItems(current => [...current, record]);
      setItems(current => canonicalItems([...current, record]));
      setLines(current => [...current, { inventoryItemId: ref.id, name, bucket: record.bucket, unit: record.unit, sourceUnit: record.sourceUnit, quantity: 0, unitCost, total: 0 }]);
      setNewItem({ name: '', unit: 'kg', unitCost: '', bucket: 'FOOD' });
      setShowAdd(false);
    } catch (error) {
      console.error('Inventory item create failed', error);
      alert('Could not add the stock item.');
    } finally {
      setSaving(false);
    }
  };

  const seedFromRecipes = async () => {
    if (!window.confirm('Add missing recipe ingredients as stock-count items? You can review and add packaging separately.')) return;
    setSeeding(true);
    try {
      const ingredientSnap = await getDocs(query(collection(db, 'fc_ingredients'), where('ownerId', '==', dataOwnerId)));
      const existingNames = new Set(allItems.map(item => catalogIdentity(item)));
      const ingredients = ingredientSnap.docs.map(d => ({ id: d.id, ...d.data() } as RecipeIngredient))
        .filter(ingredient => !/disposable|packaging/i.test(ingredient.category || ''))
        .filter(ingredient => !existingNames.has(`${tokenKeyFor(ingredient.name)}|${ingredient.purchaseUnit}`))
        .filter(ingredient => !closeNameMatch(ingredient.name, allItems));
      if (!ingredients.length) { alert('All current recipe ingredients are already in the stock list.'); return; }
      const batch = writeBatch(db);
      const created: InventoryItem[] = [];
      ingredients.forEach(ingredient => {
        const ref = doc(db, 'inventory_items', ingredient.id ? `${dataOwnerId}_recipe_inventory_${ingredient.id}` : inventoryDocId(dataOwnerId, ingredient.name));
        const item: InventoryItem = {
          id: ref.id, userId: dataOwnerId, ownerId: dataOwnerId, name: ingredient.name.trim(),
          unit: ingredient.purchaseUnit, unitCost: ingredient.purchaseSize > 0 ? ingredient.purchasePrice / ingredient.purchaseSize : 0,
          bucket: bucketForIngredient(ingredient), recipeIngredientId: ingredient.id, canonicalKey: tokenKeyFor(ingredient.name), active: true,
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        batch.set(ref, item);
        created.push(item);
      });
      await batch.commit();
      setAllItems(current => [...current, ...created]);
      setItems(current => canonicalItems([...current, ...created]));
      setLines(current => [...current, ...created.map(item => ({ inventoryItemId: item.id!, name: item.name, bucket: item.bucket, unit: item.unit, sourceUnit: item.sourceUnit, quantity: 0, unitCost: item.unitCost, total: 0 }))]);
    } catch (error) {
      console.error('Inventory recipe seed failed', error);
      alert('Could not add recipe ingredients to stock count.');
    } finally {
      setSeeding(false);
    }
  };

  const updateItemBucket = async (itemId: string, nextBucket: InventoryBucket) => {
    const current = items.find(item => item.id === itemId);
    if (!current || current.bucket === nextBucket) return;
    try {
      await updateDoc(doc(db, 'inventory_items', itemId), { bucket: nextBucket, updatedAt: Date.now() });
      setItems(existing => existing.map(item => item.id === itemId ? { ...item, bucket: nextBucket } : item));
      setAllItems(existing => existing.map(item => item.id === itemId ? { ...item, bucket: nextBucket } : item));
      setLines(existing => existing.map(line => line.inventoryItemId === itemId ? { ...line, bucket: nextBucket, dirty: true } : line));
    } catch (error) {
      console.error('Inventory item category update failed', error);
      alert('Could not update this item group.');
    }
  };

  const sortRecipeItems = async () => {
    if (!window.confirm('Move recognised drink ingredients into the Drinks group? You can still change any item manually afterwards.')) return;
    setSorting(true);
    try {
      const ingredientSnap = await getDocs(query(collection(db, 'fc_ingredients'), where('ownerId', '==', dataOwnerId)));
      const ingredientById = new Map(ingredientSnap.docs.map(row => [row.id, { id: row.id, ...row.data() } as RecipeIngredient]));
      const updates = items.flatMap(item => {
        const ingredient = item.recipeIngredientId ? ingredientById.get(item.recipeIngredientId) : undefined;
        const nextBucket = ingredient ? bucketForIngredient(ingredient) : undefined;
        return nextBucket && nextBucket !== item.bucket ? [{ item, nextBucket }] : [];
      });
      if (!updates.length) { alert('Your recipe ingredients are already grouped.'); return; }
      const batch = writeBatch(db);
      updates.forEach(({ item, nextBucket }) => batch.update(doc(db, 'inventory_items', item.id!), { bucket: nextBucket, updatedAt: Date.now() }));
      await batch.commit();
      const moved = new Map(updates.map(({ item, nextBucket }) => [item.id, nextBucket]));
      setItems(existing => existing.map(item => moved.has(item.id) ? { ...item, bucket: moved.get(item.id)! } : item));
      setAllItems(existing => existing.map(item => moved.has(item.id) ? { ...item, bucket: moved.get(item.id)! } : item));
      setLines(existing => existing.map(line => moved.has(line.inventoryItemId) ? { ...line, bucket: moved.get(line.inventoryItemId)!, dirty: true } : line));
      alert(`${updates.length} item${updates.length === 1 ? '' : 's'} moved into the correct group.`);
    } catch (error) {
      console.error('Inventory recipe category update failed', error);
      alert('Could not sort the recipe ingredients.');
    } finally {
      setSorting(false);
    }
  };

  const importAugustCount = async () => {
    if (!window.confirm('Import the 31 August 2026 closing count for Deer Park B6 and Safdarjung? This creates or replaces August draft counts only. It does not update P&L.')) return;
    setImportingAugust(true);
    try {
      const batch = writeBatch(db);
      const masterByKey = new Map<string, InventoryItem>(allItems.map(item => [catalogIdentity(item), item]));
      const importedItems: InventoryItem[] = [];
      const rows = AUGUST_2026_STOCK_IMPORT.map(row => {
        const unit = unitForSheet(row.sourceUnit);
        const key = `${tokenKeyFor(row.name)}|${unit}`;
        let item = masterByKey.get(key);
        if (!item) {
          const ref = doc(db, 'inventory_items', inventoryDocId(dataOwnerId, row.name));
          item = { id: ref.id, userId: dataOwnerId, ownerId: dataOwnerId, name: row.name, bucket: row.bucket, unit, sourceUnit: row.sourceUnit, unitCost: row.unitCost, canonicalKey: tokenKeyFor(row.name), active: true, createdAt: Date.now(), updatedAt: Date.now() };
          masterByKey.set(key, item);
          importedItems.push(item);
          batch.set(ref, item);
        }
        return { ...row, item };
      });
      const totalsFor = (key: 'b6Total' | 'sdjTotal') => rows.reduce<Record<InventoryBucket, number>>((totals, row) => {
        totals[row.bucket] += row[key];
        return totals;
      }, blankTotals());
      const countFor = (outletId: string, quantityKey: 'b6Quantity' | 'sdjQuantity', totalKey: 'b6Total' | 'sdjTotal'): InventoryCountRecord => ({
        id: `august-2026-${outletId}`, userId: dataOwnerId, ownerId: dataOwnerId, outletId, month: 'August', year: '2026', status: 'draft',
        lines: rows.map(row => ({ inventoryItemId: row.item.id!, name: row.item.name, bucket: row.bucket, unit: row.item.unit, sourceUnit: row.sourceUnit, quantity: row[quantityKey], unitCost: row[quantityKey] ? row[totalKey] / row[quantityKey] : row.unitCost, total: row[totalKey] })),
        totals: totalsFor(totalKey), countedAt: Date.now(), updatedAt: Date.now(),
      });
      batch.set(doc(db, 'inventory_counts', 'august-2026-40543'), countFor('40543', 'b6Quantity', 'b6Total'));
      batch.set(doc(db, 'inventory_counts', 'august-2026-40140'), countFor('40140', 'sdjQuantity', 'sdjTotal'));
      await batch.commit();
      if (importedItems.length) {
        setAllItems(current => [...current, ...importedItems]);
        setItems(current => canonicalItems([...current, ...importedItems]));
      }
      if (month === 'August') await load();
      alert('August closing counts imported as drafts for both stores. P&L was not changed.');
    } catch (error) {
      console.error('August inventory import failed', error);
      alert('The August count could not be imported. No P&L value was changed.');
    } finally {
      setImportingAugust(false);
    }
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>;

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 text-white p-7 md:p-9 shadow-xl">
        <div className="flex flex-col lg:flex-row justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-indigo-200 text-xs font-black uppercase tracking-[0.18em]"><ClipboardCheck size={16} /> Month-end inventory</div>
            <h1 className="text-3xl font-black tracking-tight mt-3">Count what is physically left.</h1>
            <p className="text-slate-300 mt-2 leading-relaxed">Enter quantities only. NekoMetrics calculates the stock value and keeps this detailed count separate from the current P&amp;L closing-stock total.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 min-w-0 lg:min-w-[270px]">
            <div className="rounded-2xl bg-white/10 border border-white/10 p-4"><p className="text-[10px] uppercase tracking-widest font-black text-slate-300">Counted lines</p><p className="text-2xl font-black mt-1">{countedItems}<span className="text-sm text-slate-300"> / {lines.length}</span></p></div>
            <div className="rounded-2xl bg-emerald-400/15 border border-emerald-300/20 p-4"><p className="text-[10px] uppercase tracking-widest font-black text-emerald-100">Stock value</p><p className="text-2xl font-black mt-1">{money(totalValue)}</p></div>
          </div>
        </div>
      </section>

      {!!savedCountCards.length && <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5">
        <div className="flex flex-col md:flex-row gap-2 md:items-end justify-between mb-4"><div><p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">Saved stock counts</p><h2 className="font-black text-lg text-slate-900 mt-1">Open a month-end count</h2><p className="text-sm text-slate-500 mt-1">Choose the store and date first. The amount is the full closing-stock value for that count.</p></div><p className="text-xs text-slate-400 font-semibold">Drafts can still be reviewed or corrected.</p></div>
        <div className="grid md:grid-cols-2 gap-3">{savedCountCards.map(count => {
          const total = countTotal(count.totals);
          const isSelected = count.outletId === outletId && count.month === month && count.year === year;
          return <button key={count.id} onClick={() => { setMonth(count.month); setYear(count.year); setOutletId(count.outletId); }} className={`text-left rounded-2xl border p-4 transition-colors ${isSelected ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100' : 'border-slate-100 hover:border-indigo-200 hover:bg-slate-50'}`}><div className="flex justify-between gap-3"><div><p className="font-black text-slate-900">{count.month} {count.year} closing count</p><p className="text-sm font-semibold text-slate-500 mt-1">{getOutletName(count.outletId)}</p></div><span className={`text-[10px] uppercase tracking-wider font-black px-2.5 py-1 rounded-full h-fit ${count.status === 'reviewed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{count.status}</span></div><p className="text-2xl font-black text-slate-900 mt-4">{money(total)}</p><p className="text-xs text-indigo-600 font-bold mt-1">View details →</p></button>;
        })}</div>
      </section>}

      <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 flex flex-col xl:flex-row gap-4 xl:items-end justify-between">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
          <SelectField label="Count month" value={month} onChange={setMonth} options={MONTH_NAMES} />
          <SelectField label="Year" value={year} onChange={setYear} options={['2025', '2026', '2027', '2028']} />
          <SelectField label="Store" value={outletId} onChange={setOutletId} options={activeOutlets.map(outlet => outlet.id)} labels={Object.fromEntries(activeOutlets.map(outlet => [outlet.id, outlet.name]))} disabled={!!scopedOutlet} />
        </div>
        {canManageItems && <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowAdd(true)} className="px-4 py-3 rounded-xl border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-50 flex items-center gap-2"><Plus size={16} /> Add item</button>
          <button onClick={seedFromRecipes} disabled={seeding} className="px-4 py-3 rounded-xl bg-indigo-50 text-indigo-700 font-bold text-sm hover:bg-indigo-100 flex items-center gap-2 disabled:opacity-60">{seeding ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />} Add recipe items</button>
          {!!items.length && <button onClick={sortRecipeItems} disabled={sorting} className="px-4 py-3 rounded-xl bg-sky-50 text-sky-700 font-bold text-sm hover:bg-sky-100 flex items-center gap-2 disabled:opacity-60">{sorting ? <Loader2 size={16} className="animate-spin" /> : <Coffee size={16} />} Sort drink items</button>}
        </div>}
      </section>

      {canManageItems && catalogueHealth.duplicateGroups > 0 && <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={20} />
          <div className="min-w-0">
            <p className="font-black text-amber-950">Catalogue cleanup is needed</p>
            <p className="mt-1 text-sm leading-relaxed text-amber-900">There are {catalogueHealth.activeItems} active records but {catalogueHealth.uniqueItems} unique stock items. This screen now shows one row per item and unit, so different prices do not create repeated counting rows. Each month still keeps its own unit price in the saved closing count.</p>
            <p className="mt-2 text-sm font-bold text-amber-900">{catalogueHealth.safeGroups} duplicate group{catalogueHealth.safeGroups === 1 ? '' : 's'} ({catalogueHealth.safeRows} extra record{catalogueHealth.safeRows === 1 ? '' : 's'}) can be consolidated safely. {catalogueHealth.conflicts.length ? `${catalogueHealth.conflicts.length} group${catalogueHealth.conflicts.length === 1 ? '' : 's'} also has conflicting categories and needs a manager decision before any cleanup.` : 'No category conflicts need a decision.'}</p>
            {!!catalogueHealth.conflicts.length && <details className="mt-3 text-sm text-amber-950"><summary className="cursor-pointer font-bold">Review category conflicts</summary><ul className="mt-2 space-y-1 list-disc pl-5">{catalogueHealth.conflicts.map(group => <li key={catalogIdentity(group[0])}><b>{group.map(item => item.name).join(' / ')}</b> — currently {Array.from(new Set(group.map(item => BUCKETS.find(entry => entry.id === item.bucket)?.short || item.bucket))).join(', ')}</li>)}</ul></details>}
          </div>
        </div>
      </section>}

      {!items.length ? (
        <section className="bg-white border border-slate-100 rounded-3xl shadow-sm p-12 text-center max-w-2xl mx-auto">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><PackagePlus size={25} /></div>
          <h2 className="font-black text-xl text-slate-900 mt-5">Set up your first count list</h2>
          <p className="text-slate-500 mt-2">Start by pulling in recipe ingredients, then add packaging items from your packaging sheet. Nothing reaches P&amp;L from this screen.</p>
          {canManageItems ? <button onClick={seedFromRecipes} disabled={seeding} className="mt-6 px-5 py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 inline-flex items-center gap-2">{seeding ? <Loader2 size={17} className="animate-spin" /> : <PackagePlus size={17} />} Add recipe ingredients</button> : <p className="mt-5 text-xs text-slate-500">Ask an HQ manager to set up the shared count list.</p>}
        </section>
      ) : (
        <>
          {selectedCount && <section className="rounded-2xl bg-indigo-50 border border-indigo-100 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><p className="font-black text-indigo-950">Viewing {selectedCount.month} {selectedCount.year} closing count — {getOutletName(selectedCount.outletId)}</p><p className="text-sm text-indigo-700 mt-0.5">The quantities below are the saved physical count for this date.</p></div><p className="font-black text-indigo-950">{money(countTotal(selectedCount.totals))}</p></section>}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {BUCKETS.map(entry => <button key={entry.id} onClick={() => setBucket(bucket === entry.id ? 'ALL' : entry.id)} className={`text-left p-4 rounded-2xl border transition-all ${bucket === entry.id ? entry.activeClass : 'bg-white border-slate-100 hover:border-slate-200'}`}>
              <div className={`flex items-center gap-2 ${entry.iconClass}`}><span>{entry.icon}</span><span className="text-[10px] font-black uppercase tracking-wider">{entry.short}</span></div>
              <p className="text-xl font-black text-slate-900 mt-2">{money(totals[entry.id])}</p>
              <p className="text-[10px] text-slate-400 font-semibold mt-1">Preview only</p>
            </button>)}
          </section>
          {canManageItems && <details className="text-sm text-slate-500"><summary className="cursor-pointer font-bold text-slate-500 hover:text-slate-800">Admin import tools</summary><div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 flex flex-col sm:flex-row gap-3 sm:items-center justify-between"><p>Use this only to re-import the approved August 2026 sheet. It is not needed to open an existing count.</p><button onClick={importAugustCount} disabled={importingAugust} className="shrink-0 px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-100 flex items-center gap-2 disabled:opacity-60">{importingAugust ? <Loader2 size={16} className="animate-spin" /> : <ClipboardCheck size={16} />} Re-import August count</button></div></details>}

          <section className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row gap-3 justify-between md:items-center">
              <div><h2 className="font-black text-slate-900">{getOutletName(outletId)} detailed count</h2><p className="text-xs text-slate-500 mt-1">Use 0 only when the item was checked and none remains.</p></div>
              <div className="relative"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={queryText} onChange={event => setQueryText(event.target.value)} placeholder="Find an item" className="pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-200" /></div>
            </div>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[700px] text-left">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-widest text-slate-400"><tr><th className="px-5 py-3 font-black">Item</th><th className="px-4 py-3 font-black">Group</th><th className="px-4 py-3 font-black text-right">Physical quantity</th><th className="px-4 py-3 font-black">Unit</th><th className="px-4 py-3 font-black text-right">Unit cost</th><th className="px-5 py-3 font-black text-right">Counted value</th></tr></thead>
                <tbody className="divide-y divide-slate-50">
                  {shownLines.map(line => <tr key={line.inventoryItemId} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3.5"><p className="font-bold text-sm text-slate-800">{line.name}</p></td>
                    <td className="px-4 py-3.5">{canManageItems ? <select aria-label={`Group for ${line.name}`} value={line.bucket} onChange={event => void updateItemBucket(line.inventoryItemId, event.target.value as InventoryBucket)} className="text-[10px] font-black uppercase tracking-wide text-slate-600 border border-slate-200 rounded-lg px-2 py-1.5 bg-white"><option value="FOOD">Food</option><option value="DRINKS">Drinks</option><option value="FOOD SERVINGS">Food packaging</option><option value="DRINKS SERVINGS">Drink packaging</option></select> : <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">{BUCKETS.find(entry => entry.id === line.bucket)?.short}</span>}</td>
                    <td className="px-4 py-3.5"><input type="number" min="0" step="any" value={line.quantity || ''} onChange={event => updateLine(line.inventoryItemId, { quantity: Number(event.target.value) })} placeholder="0" className="w-28 ml-auto block text-right px-3 py-2 border border-slate-200 rounded-lg font-bold text-slate-800 focus:ring-2 focus:ring-indigo-200 outline-none" /></td>
                    <td className="px-4 py-3.5 text-sm font-bold text-slate-500">{line.sourceUnit || MEASURE_UNITS[line.unit].label}</td>
                    <td className="px-4 py-3.5"><input type="number" min="0" step="any" value={line.unitCost || ''} onChange={event => updateLine(line.inventoryItemId, { unitCost: Number(event.target.value) })} placeholder="0" className="w-28 ml-auto block text-right px-3 py-2 border border-slate-200 rounded-lg font-semibold text-slate-600 focus:ring-2 focus:ring-indigo-200 outline-none" /></td>
                    <td className="px-5 py-3.5 text-right font-black text-slate-900">{money((line.quantity || 0) * (line.unitCost || 0))}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            <div className="md:hidden divide-y divide-slate-100">
              {shownLines.map(line => (
                <article key={line.inventoryItemId} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-black text-slate-900 leading-snug">{line.name}</p><p className="text-xs text-slate-500 mt-1">{line.sourceUnit || MEASURE_UNITS[line.unit].label}</p></div>
                    <p className="shrink-0 font-black text-slate-900">{money((line.quantity || 0) * (line.unitCost || 0))}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Physical quantity
                      <input type="number" min="0" step="any" value={line.quantity || ''} onChange={event => updateLine(line.inventoryItemId, { quantity: Number(event.target.value) })} placeholder="0" className="mt-1.5 w-full px-3 py-3 border border-slate-200 rounded-xl text-lg font-black text-slate-800 focus:ring-2 focus:ring-indigo-200 outline-none" />
                    </label>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Unit cost
                      <input type="number" min="0" step="any" value={line.unitCost || ''} onChange={event => updateLine(line.inventoryItemId, { unitCost: Number(event.target.value) })} placeholder="0" className="mt-1.5 w-full px-3 py-3 border border-slate-200 rounded-xl text-lg font-bold text-slate-700 focus:ring-2 focus:ring-indigo-200 outline-none" />
                    </label>
                  </div>
                  {canManageItems ? <select aria-label={`Group for ${line.name}`} value={line.bucket} onChange={event => void updateItemBucket(line.inventoryItemId, event.target.value as InventoryBucket)} className="w-full text-xs font-black uppercase tracking-wide text-slate-600 border border-slate-200 rounded-xl px-3 py-2.5 bg-white"><option value="FOOD">Food ingredients</option><option value="DRINKS">Drink ingredients</option><option value="FOOD SERVINGS">Food packaging</option><option value="DRINKS SERVINGS">Drink packaging</option></select> : <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{BUCKETS.find(entry => entry.id === line.bucket)?.short}</p>}
                </article>
              ))}
            </div>
            {!shownLines.length && <div className="py-12 text-center text-slate-400 text-sm font-semibold">No stock items match this filter.</div>}
          </section>

          <section className="rounded-3xl border border-amber-100 bg-amber-50 p-5 flex flex-col md:flex-row gap-4 md:items-center justify-between">
            <div className="flex gap-3"><AlertTriangle className="text-amber-600 shrink-0" size={20} /><div><p className="font-black text-amber-900">Review before using it in P&amp;L</p><p className="text-sm text-amber-800 mt-1">Saving this count creates an inventory record only. It does not change the current manual Closing Stock in P&amp;L Command.</p></div></div>
            <div className="flex flex-wrap gap-2 shrink-0"><button onClick={() => saveCount('draft')} disabled={saving} className="px-4 py-3 bg-white border border-amber-200 text-amber-800 rounded-xl font-bold text-sm disabled:opacity-50 flex items-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save draft</button><button onClick={() => saveCount('reviewed')} disabled={saving} className="px-4 py-3 bg-amber-600 text-white rounded-xl font-bold text-sm disabled:opacity-50 flex items-center gap-2">{saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} Mark reviewed</button></div>
          </section>
        </>
      )}

      {showAdd && <div className="fixed inset-0 z-[120] flex items-center justify-center p-4"><div className="absolute inset-0 bg-slate-950/50" onClick={() => setShowAdd(false)} /><div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl p-6"><button onClick={() => setShowAdd(false)} className="absolute right-5 top-5 p-2 text-slate-400 hover:text-slate-800"><X size={18} /></button><h2 className="font-black text-xl text-slate-900">Add stock item</h2><p className="text-sm text-slate-500 mt-1">Use this for packaging or stock not yet in Recipe Costing.</p><div className="grid grid-cols-2 gap-4 mt-6"><label className="col-span-2 text-xs font-bold text-slate-600">Item name<input autoFocus value={newItem.name} onChange={event => setNewItem(current => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-200" /></label><label className="text-xs font-bold text-slate-600">Count unit<select value={newItem.unit} onChange={event => setNewItem(current => ({ ...current, unit: event.target.value as MeasureUnit }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white">{unitOptions.map(unit => <option key={unit} value={unit}>{MEASURE_UNITS[unit].label}</option>)}</select></label><label className="text-xs font-bold text-slate-600">Cost per unit<input type="number" min="0" step="any" value={newItem.unitCost} onChange={event => setNewItem(current => ({ ...current, unitCost: event.target.value }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-200" /></label><label className="col-span-2 text-xs font-bold text-slate-600">P&amp;L group<select value={newItem.bucket} onChange={event => setNewItem(current => ({ ...current, bucket: event.target.value as InventoryBucket }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white">{BUCKETS.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label></div><button onClick={addItem} disabled={!newItem.name.trim() || saving} className="mt-6 w-full py-3 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50">Add to count list</button></div></div>}
    </div>
  );
};

const SelectField: React.FC<{ label: string; value: string; options: string[]; labels?: Record<string, string>; disabled?: boolean; onChange: (value: string) => void }> = ({ label, value, options, labels, disabled, onChange }) => <label className="block"><span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{label}</span><div className="relative"><select value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="w-full appearance-none px-3 py-3 pr-8 border border-slate-200 bg-white rounded-xl text-sm font-bold text-slate-800 disabled:bg-slate-50 disabled:text-slate-500">{options.map(option => <option key={option} value={option}>{labels?.[option] || option}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" /></div></label>;

export default InventoryCount;
