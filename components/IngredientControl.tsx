import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import { addDoc, collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import {
  IngredientControlProfile, IngredientMovement, IngredientMovementType, InventoryCount,
  InventoryItem, ItemMonthlySnapshot, MONTH_NAMES, MeasureUnit, MEASURE_UNITS,
  Recipe, RecipeIngredient, StoreRental, getOutletName,
} from '../types';
import { managerOutlet } from '../outletScope';
import { AlertTriangle, ArrowRightLeft, Beef, ClipboardCheck, Loader2, PackagePlus, Plus, Scale, TrendingDown, TrendingUp } from 'lucide-react';

interface Props {
  user: User;
  dataOwnerId: string;
  userProfile?: { role?: string; assignedOutlet?: string };
}

const money = (value: number) => `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
const key = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const toBase = (quantity: number, unit: MeasureUnit) => Number(quantity || 0) * MEASURE_UNITS[unit].toBase;
const fromBase = (quantity: number, unit: MeasureUnit) => quantity / MEASURE_UNITS[unit].toBase;
const unitLabel = (unit: MeasureUnit) => MEASURE_UNITS[unit].label.toLowerCase();

const previousPeriod = (month: string, year: string) => {
  const index = MONTH_NAMES.indexOf(month);
  if (index <= 0) return { month: MONTH_NAMES[11], year: String(Number(year) - 1) };
  return { month: MONTH_NAMES[index - 1], year };
};

const IngredientControl: React.FC<Props> = ({ user, dataOwnerId, userProfile }) => {
  const scopedOutlet = managerOutlet(userProfile as any);
  const now = new Date();
  const [month, setMonth] = useState(MONTH_NAMES[now.getMonth()]);
  const [year, setYear] = useState(String(now.getFullYear()));
  const [outletId, setOutletId] = useState(scopedOutlet || '40543');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [profiles, setProfiles] = useState<IngredientControlProfile[]>([]);
  const [movements, setMovements] = useState<IngredientMovement[]>([]);
  const [counts, setCounts] = useState<InventoryCount[]>([]);
  const [snapshots, setSnapshots] = useState<ItemMonthlySnapshot[]>([]);
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [setup, setSetup] = useState({ ingredientId: '', inventoryItemId: '' });
  const [movement, setMovement] = useState({ type: 'purchase' as IngredientMovementType, date: `${year}-${String(MONTH_NAMES.indexOf(month) + 1).padStart(2, '0')}-01`, quantity: '', unit: 'kg' as MeasureUnit, unitCost: '', note: '' });

  const activeOutlets = useMemo(() => {
    const rows = rentals.filter(row => row.status === 'active').map(row => ({ id: row.outletId, name: row.storeName || getOutletName(row.outletId) }));
    const fallback = [{ id: '40543', name: getOutletName('40543') }, { id: '40140', name: getOutletName('40140') }];
    const list = rows.length ? rows : fallback;
    return scopedOutlet ? list.filter(row => row.id === scopedOutlet) : list;
  }, [rentals, scopedOutlet]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ingredientSnap, recipeSnap, itemSnap, profileSnap, movementSnap, countSnap, snapshotSnap, rentalSnap] = await Promise.all([
        getDocs(query(collection(db, 'fc_ingredients'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'fc_recipes'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'inventory_items'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'ingredient_controls'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'ingredient_movements'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'inventory_counts'), where('ownerId', '==', dataOwnerId), where('userId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'item_snapshots'), where('userId', '==', dataOwnerId), where('year', '==', year), where('month', '==', month))),
        getDocs(query(collection(db, 'rentals'), where('userId', '==', dataOwnerId))),
      ]);
      const nextProfiles = profileSnap.docs.map(row => ({ id: row.id, ...row.data() } as IngredientControlProfile));
      setIngredients(ingredientSnap.docs.map(row => ({ id: row.id, ...row.data() } as RecipeIngredient)).sort((a, b) => a.name.localeCompare(b.name)));
      setRecipes(recipeSnap.docs.map(row => ({ id: row.id, ...row.data() } as Recipe)).filter(recipe => recipe.kind === 'menu'));
      setInventoryItems(itemSnap.docs.map(row => ({ id: row.id, ...row.data() } as InventoryItem)).filter(item => item.active));
      setProfiles(nextProfiles);
      setMovements(movementSnap.docs.map(row => ({ id: row.id, ...row.data() } as IngredientMovement)));
      setCounts(countSnap.docs.map(row => ({ id: row.id, ...row.data() } as InventoryCount)));
      setSnapshots(snapshotSnap.docs.map(row => ({ id: row.id, ...row.data() } as ItemMonthlySnapshot)));
      setRentals(rentalSnap.docs.map(row => ({ id: row.id, ...row.data() } as StoreRental)));
      setSelectedProfileId(current => current || nextProfiles.find(profile => /chicken/i.test(ingredientSnap.docs.find(row => row.id === profile.ingredientId)?.data().name || ''))?.id || nextProfiles[0]?.id || '');
    } catch (error) {
      console.error('Ingredient Control load failed', error);
      alert('Could not load ingredient-control data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [dataOwnerId, month, year]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (scopedOutlet) setOutletId(scopedOutlet); }, [scopedOutlet]);
  useEffect(() => {
    setMovement(current => ({ ...current, date: `${year}-${String(MONTH_NAMES.indexOf(month) + 1).padStart(2, '0')}-01` }));
  }, [month, year]);

  const profile = profiles.find(row => row.id === selectedProfileId);
  const ingredient = ingredients.find(row => row.id === profile?.ingredientId);
  const inventoryItem = inventoryItems.find(row => row.id === profile?.inventoryItemId);
  const baseUnit = ingredient?.purchaseUnit || inventoryItem?.unit || 'kg';
  const prior = previousPeriod(month, year);

  const countQuantity = useCallback((targetMonth: string, targetYear: string) => {
    if (!profile || !inventoryItem) return undefined;
    const count = counts.find(row => row.outletId === outletId && row.month === targetMonth && row.year === targetYear);
    const line = count?.lines.find(row => row.inventoryItemId === inventoryItem.id || key(row.name) === key(inventoryItem.name));
    if (!line || MEASURE_UNITS[line.unit].dimension !== MEASURE_UNITS[baseUnit].dimension) return undefined;
    return fromBase(toBase(line.quantity, line.unit), baseUnit);
  }, [baseUnit, counts, inventoryItem, outletId, profile]);

  const metrics = useMemo(() => {
    if (!profile || !ingredient || !inventoryItem) return null;
    const opening = countQuantity(prior.month, prior.year);
    const closing = countQuantity(month, year);
    const currentMovements = movements.filter(row => row.profileId === profile.id && row.outletId === outletId && row.date.startsWith(`${year}-${String(MONTH_NAMES.indexOf(month) + 1).padStart(2, '0')}`));
    const quantityFor = (type: IngredientMovementType) => currentMovements.filter(row => row.type === type).reduce((sum, row) => sum + fromBase(toBase(row.quantity, row.unit), baseUnit), 0);
    const purchases = quantityFor('purchase');
    const waste = quantityFor('waste');
    const transferIn = quantityFor('transfer_in');
    const transferOut = quantityFor('transfer_out');
    const purchaseCost = currentMovements.filter(row => row.type === 'purchase').reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unitCost || 0), 0);
    const averageCost = purchases > 0 && purchaseCost > 0 ? purchaseCost / purchases : ingredient.purchaseSize > 0 ? ingredient.purchasePrice / ingredient.purchaseSize : 0;
    const sales = new Map<string, number>();
    snapshots.filter(snapshot => outletId === 'all' || snapshot.outletId === outletId).forEach(snapshot => Object.entries(snapshot.items || {}).forEach(([name, data]) => {
      const item = data as { quantity?: number };
      sales.set(key(name), (sales.get(key(name)) || 0) + Number(item.quantity || 0));
    }));
    const recipeRows = recipes.map(recipe => {
      const portionBase = recipe.components.filter(component => component.refType === 'ingredient' && component.refId === ingredient.id).reduce((sum, component) => sum + toBase(component.quantity, component.unit), 0);
      if (!portionBase) return null;
      const unitsSold = sales.get(key(recipe.name)) || 0;
      return { recipe, portion: fromBase(portionBase, baseUnit), unitsSold, expected: fromBase(portionBase * unitsSold, baseUnit), matched: sales.has(key(recipe.name)) };
    }).filter(Boolean) as { recipe: Recipe; portion: number; unitsSold: number; expected: number; matched: boolean }[];
    const expected = recipeRows.reduce((sum, row) => sum + row.expected, 0);
    const actual = opening === undefined || closing === undefined ? undefined : opening + purchases + transferIn - closing - transferOut;
    const unexplained = actual === undefined ? undefined : actual - expected - waste;
    return { opening, closing, purchases, waste, transferIn, transferOut, currentMovements, averageCost, recipeRows, expected, actual, unexplained };
  }, [baseUnit, countQuantity, ingredient, inventoryItem, month, movements, outletId, prior.month, prior.year, profile, recipes, snapshots, year]);

  const createProfile = async () => {
    if (!setup.ingredientId || !setup.inventoryItemId) return;
    setSaving(true);
    try {
      const id = `${dataOwnerId}_${setup.ingredientId}`;
      const record: IngredientControlProfile = { id, userId: dataOwnerId, ownerId: dataOwnerId, ingredientId: setup.ingredientId, inventoryItemId: setup.inventoryItemId, createdAt: Date.now(), updatedAt: Date.now() };
      await setDoc(doc(db, 'ingredient_controls', id), record);
      setProfiles(current => [...current.filter(row => row.id !== id), record]);
      setSelectedProfileId(id);
    } catch (error) {
      console.error('Ingredient control setup failed', error);
      alert('Could not set up this ingredient.');
    } finally { setSaving(false); }
  };

  const addMovement = async () => {
    if (!profile || !movement.quantity || Number(movement.quantity) <= 0) return;
    setSaving(true);
    try {
      const record: Omit<IngredientMovement, 'id'> = {
        userId: dataOwnerId, ownerId: dataOwnerId, profileId: profile.id!, outletId, date: movement.date,
        type: movement.type, quantity: Number(movement.quantity), unit: movement.unit,
        ...(movement.unitCost ? { unitCost: Number(movement.unitCost) } : {}), ...(movement.note.trim() ? { note: movement.note.trim() } : {}),
        createdAt: Date.now(), createdBy: user.uid,
      };
      const ref = await addDoc(collection(db, 'ingredient_movements'), record);
      setMovements(current => [...current, { id: ref.id, ...record }]);
      setMovement(current => ({ ...current, quantity: '', unitCost: '', note: '' }));
    } catch (error) {
      console.error('Ingredient movement create failed', error);
      alert('Could not record this physical movement.');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="animate-spin text-indigo-600" size={32} /></div>;

  return <div className="max-w-7xl mx-auto space-y-6 pb-12">
    <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white p-7 md:p-9 shadow-xl">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6"><div className="max-w-2xl"><p className="flex items-center gap-2 text-emerald-200 text-xs font-black uppercase tracking-[0.18em]"><Scale size={16} /> Ingredient control</p><h1 className="text-3xl font-black tracking-tight mt-3">Physical stock against recipe usage.</h1><p className="text-slate-300 mt-2 leading-relaxed">Start with chicken. This is an operational control: it explains quantity variance without changing P&amp;L or the existing month-end stock value.</p></div><div className="rounded-2xl border border-white/10 bg-white/10 px-5 py-4"><p className="text-[10px] font-black uppercase tracking-widest text-slate-300">Pilot workflow</p><p className="font-bold mt-1">Count → buy → sell → compare</p></div></div>
    </section>

    {!profiles.length ? <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 max-w-3xl"><div className="flex gap-3"><Beef className="text-emerald-600 shrink-0" size={24} /><div><h2 className="font-black text-xl text-slate-900">Set up your first controlled ingredient</h2><p className="text-sm text-slate-500 mt-1">Choose the Recipe Costing ingredient and the matching Stock Count item. For chicken, pick the chicken ingredient and its physical stock item.</p></div></div><div className="grid md:grid-cols-2 gap-4 mt-6"><label className="text-xs font-black uppercase tracking-wider text-slate-500">Recipe ingredient<select value={setup.ingredientId} onChange={event => setSetup(current => ({ ...current, ingredientId: event.target.value }))} className="mt-1.5 w-full px-3 py-3 border border-slate-200 rounded-xl bg-white text-sm font-bold"><option value="">Choose ingredient</option>{ingredients.map(row => <option key={row.id} value={row.id}>{row.name} · {MEASURE_UNITS[row.purchaseUnit].label}</option>)}</select></label><label className="text-xs font-black uppercase tracking-wider text-slate-500">Stock Count item<select value={setup.inventoryItemId} onChange={event => setSetup(current => ({ ...current, inventoryItemId: event.target.value }))} className="mt-1.5 w-full px-3 py-3 border border-slate-200 rounded-xl bg-white text-sm font-bold"><option value="">Choose stock item</option>{inventoryItems.map(row => <option key={row.id} value={row.id}>{row.name} · {MEASURE_UNITS[row.unit].label}</option>)}</select></label></div><button onClick={createProfile} disabled={!setup.ingredientId || !setup.inventoryItemId || saving} className="mt-5 px-5 py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50">Create ingredient control</button></section> : <>
      <section className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 grid lg:grid-cols-4 gap-4"><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ingredient<select value={selectedProfileId} onChange={event => setSelectedProfileId(event.target.value)} className="mt-1.5 w-full px-3 py-3 border border-slate-200 rounded-xl bg-white text-sm font-bold">{profiles.map(row => <option key={row.id} value={row.id}>{ingredients.find(ingredient => ingredient.id === row.ingredientId)?.name || 'Unknown ingredient'}</option>)}</select></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Month<select value={month} onChange={event => setMonth(event.target.value)} className="mt-1.5 w-full px-3 py-3 border border-slate-200 rounded-xl bg-white text-sm font-bold">{MONTH_NAMES.map(value => <option key={value}>{value}</option>)}</select></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Year<select value={year} onChange={event => setYear(event.target.value)} className="mt-1.5 w-full px-3 py-3 border border-slate-200 rounded-xl bg-white text-sm font-bold">{['2025', '2026', '2027', '2028'].map(value => <option key={value}>{value}</option>)}</select></label><label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Store<select value={outletId} disabled={!!scopedOutlet} onChange={event => setOutletId(event.target.value)} className="mt-1.5 w-full px-3 py-3 border border-slate-200 rounded-xl bg-white text-sm font-bold">{activeOutlets.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></section>

      {ingredient && inventoryItem && metrics && <>
        <section className="grid grid-cols-2 xl:grid-cols-5 gap-3">{[
          ['Opening stock', metrics.opening, 'From previous frozen/saved count'], ['Purchased', metrics.purchases, 'Recorded in this module'], ['Closing stock', metrics.closing, 'From this month’s count'], ['Expected use', metrics.expected, 'From recipe portions × sales'], ['Actual use', metrics.actual, 'Opening + movements − closing'],
        ].map(([label, value, note]) => <article key={String(label)} className="bg-white rounded-2xl border border-slate-100 p-4"><p className="text-[10px] uppercase tracking-widest font-black text-slate-400">{label}</p><p className="text-2xl font-black text-slate-900 mt-2">{value === undefined ? '—' : `${Number(value).toFixed(2)} ${unitLabel(baseUnit)}`}</p><p className="text-[10px] text-slate-500 mt-1">{note}</p></article>)} </section>
        <section className={`rounded-3xl border p-5 ${metrics.unexplained === undefined ? 'border-slate-200 bg-slate-50' : Math.abs(metrics.unexplained) < 0.01 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><div className="flex flex-col md:flex-row gap-4 md:items-center justify-between"><div><p className="text-[10px] uppercase tracking-widest font-black text-slate-500">Unexplained variance</p><p className="text-3xl font-black text-slate-950 mt-1">{metrics.unexplained === undefined ? 'Complete opening and closing counts first' : `${metrics.unexplained.toFixed(2)} ${unitLabel(baseUnit)} · ${money(metrics.unexplained * metrics.averageCost)}`}</p><p className="text-sm text-slate-600 mt-1">Actual use − expected recipe use − recorded waste. Recorded waste: {metrics.waste.toFixed(2)} {unitLabel(baseUnit)}.</p></div><div className="text-sm font-bold text-slate-700">Average purchase cost<br /><span className="text-xl text-slate-950">{money(metrics.averageCost)} / {unitLabel(baseUnit)}</span></div></div></section>

        <section className="grid xl:grid-cols-[1.2fr_0.8fr] gap-6"><article className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden"><div className="p-5 border-b border-slate-100"><h2 className="font-black text-slate-900">Recipe demand for {ingredient.name}</h2><p className="text-sm text-slate-500 mt-1">Only menu recipes directly linked to this ingredient are included. A recipe without a matching sales name is shown for review.</p></div><div className="divide-y divide-slate-100">{metrics.recipeRows.map(row => <div key={row.recipe.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 justify-between"><div><p className="font-bold text-slate-900">{row.recipe.name}</p><p className="text-xs text-slate-500 mt-1">{row.portion.toFixed(2)} {unitLabel(baseUnit)} per serving · {row.unitsSold} sold</p></div><div className="text-right"><p className="font-black text-slate-900">{row.expected.toFixed(2)} {unitLabel(baseUnit)}</p><p className={`text-[10px] font-bold ${row.matched ? 'text-emerald-600' : 'text-amber-600'}`}>{row.matched ? 'Sales linked' : 'No matching sales item yet'}</p></div></div>)}{!metrics.recipeRows.length && <p className="p-6 text-sm text-slate-500">No menu recipe currently uses this ingredient. Add chicken to the relevant recipes in Recipe Costing first.</p>}</div></article>
          <article className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5"><h2 className="font-black text-slate-900">Record physical movement</h2><p className="text-sm text-slate-500 mt-1">Use this for measured purchases, waste, and store transfers. It does not alter financial purchases or P&amp;L.</p><div className="grid grid-cols-2 gap-3 mt-5"><label className="text-xs font-bold text-slate-600">Type<select value={movement.type} onChange={event => setMovement(current => ({ ...current, type: event.target.value as IngredientMovementType }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white"><option value="purchase">Purchase</option><option value="waste">Waste</option><option value="transfer_in">Transfer in</option><option value="transfer_out">Transfer out</option><option value="adjustment">Adjustment</option></select></label><label className="text-xs font-bold text-slate-600">Date<input type="date" value={movement.date} onChange={event => setMovement(current => ({ ...current, date: event.target.value }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl" /></label><label className="text-xs font-bold text-slate-600">Quantity<input type="number" min="0" step="any" value={movement.quantity} onChange={event => setMovement(current => ({ ...current, quantity: event.target.value }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl" /></label><label className="text-xs font-bold text-slate-600">Unit<select value={movement.unit} onChange={event => setMovement(current => ({ ...current, unit: event.target.value as MeasureUnit }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white">{Object.keys(MEASURE_UNITS).filter(unit => MEASURE_UNITS[unit as MeasureUnit].dimension === MEASURE_UNITS[baseUnit].dimension).map(unit => <option key={unit} value={unit}>{MEASURE_UNITS[unit as MeasureUnit].label}</option>)}</select></label><label className="col-span-2 text-xs font-bold text-slate-600">Actual cost per entered unit <span className="text-slate-400">(purchase only)</span><input type="number" min="0" step="any" value={movement.unitCost} onChange={event => setMovement(current => ({ ...current, unitCost: event.target.value }))} className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl" /></label><label className="col-span-2 text-xs font-bold text-slate-600">Note<input value={movement.note} onChange={event => setMovement(current => ({ ...current, note: event.target.value }))} placeholder="Supplier, spoilage reason, transfer reference…" className="mt-1.5 w-full px-3 py-2.5 border border-slate-200 rounded-xl" /></label></div><button onClick={addMovement} disabled={saving || !movement.quantity} className="mt-5 w-full py-3 rounded-xl bg-emerald-600 text-white font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Record movement'}</button></article></section>

        <section className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden"><div className="p-5 border-b border-slate-100"><h2 className="font-black text-slate-900">This month’s physical movements</h2><p className="text-sm text-slate-500 mt-1">{getOutletName(outletId)} · {month} {year}</p></div><div className="divide-y divide-slate-100">{metrics.currentMovements.map(row => <div key={row.id} className="px-5 py-3 flex justify-between gap-4 text-sm"><div><p className="font-bold text-slate-800 capitalize">{row.type.replace('_', ' ')}</p><p className="text-xs text-slate-500">{row.date}{row.note ? ` · ${row.note}` : ''}</p></div><div className="text-right"><p className="font-black text-slate-900">{row.quantity} {unitLabel(row.unit)}</p>{row.unitCost !== undefined && <p className="text-xs text-slate-500">{money(row.unitCost)} / {unitLabel(row.unit)}</p>}</div></div>)}{!metrics.currentMovements.length && <p className="p-6 text-sm text-slate-500">No physical movements recorded for this ingredient this month.</p>}</div></section>
      </>}
    </>}
  </div>;
};

export default IngredientControl;
