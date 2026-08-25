import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { User } from 'firebase/auth';
import {
  collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  RecipeIngredient, Recipe, RecipeComponent, RecipeKind, MeasureUnit,
  MEASURE_UNITS, RECIPE_INGREDIENT_CATEGORIES,
} from '../types';
import {
  costAll, costRecipe, ingredientCostPerBaseUnit, formatPerBaseUnit,
  recipesUsingIngredient, dimensionOf, parseRecipePaste, nameKey,
  CostedRecipe, ParseResult,
} from '../foodCostService';
import {
  ChefHat, Plus, Search, Edit2, Trash2, X, Loader2, Package, ClipboardPaste,
  AlertTriangle, Check, Beaker, Utensils, TrendingUp, Info,
} from 'lucide-react';

interface Props {
  user: User;
  dataOwnerId: string;
}

const UNIT_OPTIONS = Object.keys(MEASURE_UNITS) as MeasureUnit[];

const money = (n: number) => `₹${n.toFixed(2)}`;

/** Food-cost bands. Under 30% is the industry-healthy zone. */
const costBand = (foodCostPct?: number) => {
  if (foodCostPct === undefined) return { label: 'No price', cls: 'bg-slate-100 text-slate-500' };
  if (foodCostPct <= 30) return { label: 'Healthy', cls: 'bg-emerald-100 text-emerald-700' };
  if (foodCostPct <= 38) return { label: 'Watch', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Low margin', cls: 'bg-rose-100 text-rose-700' };
};

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <div className={className}>
    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1.5">{label}</label>
    {children}
  </div>
);

const inputCls = 'w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400';

const RecipeCostLab: React.FC<Props> = ({ user, dataOwnerId }) => {
  const [view, setView] = useState<'recipes' | 'ingredients'>('recipes');
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<RecipeIngredient | null>(null);
  const [showIngredientForm, setShowIngredientForm] = useState(false);
  const [showPaste, setShowPaste] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ingSnap, recSnap] = await Promise.all([
        getDocs(query(collection(db, 'fc_ingredients'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'fc_recipes'), where('ownerId', '==', dataOwnerId))),
      ]);
      setIngredients(
        ingSnap.docs.map(d => ({ id: d.id, ...d.data() } as RecipeIngredient))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setRecipes(
        recSnap.docs.map(d => ({ id: d.id, ...d.data() } as Recipe))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (err) {
      console.error('Recipe costing: load failed', err);
    } finally {
      setLoading(false);
    }
  }, [dataOwnerId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const costs = useMemo(() => costAll(recipes, ingredients), [recipes, ingredients]);

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? recipes.filter(r => r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)) : recipes;
  }, [recipes, search]);

  const filteredIngredients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? ingredients.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)) : ingredients;
  }, [ingredients, search]);

  const menuStats = useMemo(() => {
    const priced = recipes
      .filter(r => r.kind === 'menu')
      .map(r => costs.get(r.id!))
      .filter((c): c is CostedRecipe => !!c && c.foodCostPct !== undefined);
    if (!priced.length) return null;
    return {
      count: priced.length,
      avgFoodCost: priced.reduce((s, c) => s + c.foodCostPct!, 0) / priced.length,
      atRisk: priced.filter(c => c.foodCostPct! > 38).length,
    };
  }, [recipes, costs]);

  const handleDeleteIngredient = async (ing: RecipeIngredient) => {
    const used = recipesUsingIngredient(ing.id!, recipes);
    if (used.length) {
      alert(`"${ing.name}" is used by ${used.length} recipe(s):\n\n${used.map(r => `• ${r.name}`).join('\n')}\n\nRemove it from those first.`);
      return;
    }
    if (!confirm(`Delete ingredient "${ing.name}"?`)) return;
    await deleteDoc(doc(db, 'fc_ingredients', ing.id!));
    setIngredients(prev => prev.filter(i => i.id !== ing.id));
  };

  const handleDeleteRecipe = async (r: Recipe) => {
    const dependents = recipes.filter(other =>
      other.id !== r.id && other.components.some(c => c.refType === 'recipe' && c.refId === r.id)
    );
    if (dependents.length) {
      alert(`"${r.name}" is used inside ${dependents.length} recipe(s):\n\n${dependents.map(d => `• ${d.name}`).join('\n')}\n\nRemove it from those first.`);
      return;
    }
    if (!confirm(`Delete recipe "${r.name}"?`)) return;
    await deleteDoc(doc(db, 'fc_recipes', r.id!));
    setRecipes(prev => prev.filter(x => x.id !== r.id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-500/25">
            <ChefHat className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Recipe Costing</h1>
            <p className="text-xs font-bold text-slate-500 mt-0.5">
              {recipes.length} recipe{recipes.length === 1 ? '' : 's'} · {ingredients.length} ingredient{ingredients.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setShowPaste(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-all"
          >
            <ClipboardPaste size={15} /> Paste Recipe
          </button>
          <button
            onClick={() => { setEditingIngredient(null); setShowIngredientForm(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl font-black text-[11px] uppercase tracking-widest hover:border-indigo-300 hover:text-indigo-600 transition-all"
          >
            <Package size={15} /> Ingredient
          </button>
          <button
            onClick={() => { setEditingRecipe(null); setShowRecipeForm(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/25"
          >
            <Plus size={15} /> New Recipe
          </button>
        </div>
      </div>

      {/* Summary */}
      {menuStats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Menu Items Priced</p>
            <p className="text-3xl font-black text-slate-900">{menuStats.count}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Avg Food Cost</p>
            <p className="text-3xl font-black text-indigo-600">{menuStats.avgFoodCost.toFixed(1)}%</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Above 38%</p>
            <p className={`text-3xl font-black ${menuStats.atRisk ? 'text-rose-600' : 'text-emerald-600'}`}>{menuStats.atRisk}</p>
          </div>
        </div>
      )}

      {/* View switch + search */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="flex bg-slate-100 rounded-xl p-1">
          {(['recipes', 'ingredients'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-5 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest transition-all ${
                view === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${view}...`}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>
      </div>

      {view === 'recipes' ? (
        <RecipeList
          recipes={filteredRecipes}
          costs={costs}
          onEdit={r => { setEditingRecipe(r); setShowRecipeForm(true); }}
          onDelete={handleDeleteRecipe}
        />
      ) : (
        <IngredientList
          ingredients={filteredIngredients}
          recipes={recipes}
          onEdit={i => { setEditingIngredient(i); setShowIngredientForm(true); }}
          onDelete={handleDeleteIngredient}
        />
      )}

      {showRecipeForm && (
        <RecipeForm
          user={user}
          dataOwnerId={dataOwnerId}
          existing={editingRecipe}
          ingredients={ingredients}
          recipes={recipes}
          onClose={() => setShowRecipeForm(false)}
          onSaved={saved => {
            setRecipes(prev => {
              const next = prev.some(r => r.id === saved.id)
                ? prev.map(r => (r.id === saved.id ? saved : r))
                : [...prev, saved];
              return next.sort((a, b) => a.name.localeCompare(b.name));
            });
            setShowRecipeForm(false);
          }}
        />
      )}

      {showIngredientForm && (
        <IngredientForm
          user={user}
          dataOwnerId={dataOwnerId}
          existing={editingIngredient}
          allIngredients={ingredients}
          onClose={() => setShowIngredientForm(false)}
          onSaved={saved => {
            setIngredients(prev => {
              const next = prev.some(i => i.id === saved.id)
                ? prev.map(i => (i.id === saved.id ? saved : i))
                : [...prev, saved];
              return next.sort((a, b) => a.name.localeCompare(b.name));
            });
            setShowIngredientForm(false);
          }}
        />
      )}

      {showPaste && (
        <PasteImport
          user={user}
          dataOwnerId={dataOwnerId}
          ingredients={ingredients}
          onClose={() => setShowPaste(false)}
          onImported={() => { setShowPaste(false); loadAll(); }}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Recipe list
// ---------------------------------------------------------------------------

const RecipeList: React.FC<{
  recipes: Recipe[];
  costs: Map<string, CostedRecipe>;
  onEdit: (r: Recipe) => void;
  onDelete: (r: Recipe) => void;
}> = ({ recipes, costs, onEdit, onDelete }) => {
  if (!recipes.length) {
    return (
      <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-20 text-center">
        <ChefHat className="mx-auto text-slate-300 mb-3" size={36} />
        <p className="text-sm font-bold text-slate-500">No recipes yet.</p>
        <p className="text-xs text-slate-400 mt-1">Use <span className="font-black">Paste Recipe</span> to drop one in from a spreadsheet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recipes.map(r => {
        const c = costs.get(r.id!);
        const band = costBand(c?.foodCostPct);
        return (
          <div key={r.id} className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:border-indigo-200 transition-all">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className={`p-1.5 rounded-lg ${r.kind === 'prep' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
                    {r.kind === 'prep' ? <Beaker size={13} /> : <Utensils size={13} />}
                  </span>
                  <h3 className="font-black text-slate-900 truncate">{r.name}</h3>
                  <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 bg-slate-100 text-slate-500 rounded-md">{r.category}</span>
                  {r.kind === 'prep' && (
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 bg-amber-50 text-amber-700 rounded-md">
                      Batch → {r.yieldSize} {r.yieldUnit}
                    </span>
                  )}
                </div>
                <p className="text-xs font-semibold text-slate-400 mt-1.5">
                  {r.components.length} component{r.components.length === 1 ? '' : 's'}
                  {c?.costPerYieldBaseUnit !== undefined &&
                    ` · ₹${c.costPerYieldBaseUnit.toFixed(3)} per ${dimensionOf(r.yieldUnit || 'g') === 'weight' ? 'g' : dimensionOf(r.yieldUnit || 'g') === 'volume' ? 'ml' : 'pc'}`}
                </p>
                {!!c?.errors.length && (
                  <div className="mt-2 flex items-start gap-1.5 text-[11px] font-bold text-rose-600">
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                    <span>{c.errors.join(' · ')}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{r.kind === 'prep' ? 'Batch Cost' : 'Cost'}</p>
                  <p className="text-lg font-black text-slate-900">{money(c?.totalCost ?? 0)}</p>
                </div>
                {c?.sellPrice !== undefined && (
                  <>
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Sells</p>
                      <p className="text-lg font-black text-slate-700">{money(c.sellPrice)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Food Cost</p>
                      <p className="text-lg font-black text-indigo-600">{c.foodCostPct!.toFixed(1)}%</p>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg ${band.cls}`}>{band.label}</span>
                  </>
                )}
                <div className="flex gap-1.5">
                  <button onClick={() => onEdit(r)} className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
                    <Edit2 size={15} />
                  </button>
                  <button onClick={() => onDelete(r)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Ingredient list
// ---------------------------------------------------------------------------

const IngredientList: React.FC<{
  ingredients: RecipeIngredient[];
  recipes: Recipe[];
  onEdit: (i: RecipeIngredient) => void;
  onDelete: (i: RecipeIngredient) => void;
}> = ({ ingredients, recipes, onEdit, onDelete }) => {
  if (!ingredients.length) {
    return (
      <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-20 text-center">
        <Package className="mx-auto text-slate-300 mb-3" size={36} />
        <p className="text-sm font-bold text-slate-500">No ingredients yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
              <th className="text-left px-5 py-3">Ingredient</th>
              <th className="text-left px-5 py-3">Category</th>
              <th className="text-right px-5 py-3">Pack</th>
              <th className="text-right px-5 py-3">Pack Price</th>
              <th className="text-right px-5 py-3">Waste</th>
              <th className="text-right px-5 py-3">Effective Cost</th>
              <th className="text-right px-5 py-3">Used In</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {ingredients.map(i => {
              const usedIn = recipesUsingIngredient(i.id!, recipes).length;
              return (
                <tr key={i.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3.5 font-black text-slate-800">{i.name}</td>
                  <td className="px-5 py-3.5">
                    <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 bg-slate-100 text-slate-500 rounded-md">{i.category}</span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-600">{i.purchaseSize} {i.purchaseUnit}</td>
                  <td className="px-5 py-3.5 text-right font-black text-slate-800">{money(i.purchasePrice)}</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-500">{i.wastagePct ? `${i.wastagePct}%` : '—'}</td>
                  <td className="px-5 py-3.5 text-right font-black text-indigo-600 whitespace-nowrap">{formatPerBaseUnit(i)}</td>
                  <td className="px-5 py-3.5 text-right font-bold text-slate-500">{usedIn || '—'}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => onEdit(i)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => onDelete(i)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Modal shell
// ---------------------------------------------------------------------------

const Modal: React.FC<{ title: string; subtitle?: string; onClose: () => void; wide?: boolean; children: React.ReactNode }> =
({ title, subtitle, onClose, wide, children }) => (
  <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto">
    <div className={`bg-slate-50 rounded-2xl shadow-2xl w-full my-8 ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>
      <div className="flex items-start justify-between p-6 border-b border-slate-200 bg-white rounded-t-2xl sticky top-0 z-10">
        <div>
          <h2 className="text-lg font-black tracking-tight text-slate-900">{title}</h2>
          {subtitle && <p className="text-xs font-semibold text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
          <X size={18} />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Ingredient form
// ---------------------------------------------------------------------------

const IngredientForm: React.FC<{
  user: User;
  dataOwnerId: string;
  existing: RecipeIngredient | null;
  allIngredients: RecipeIngredient[];
  onClose: () => void;
  onSaved: (i: RecipeIngredient) => void;
}> = ({ user, dataOwnerId, existing, allIngredients, onClose, onSaved }) => {
  const [name, setName] = useState(existing?.name || '');
  const [category, setCategory] = useState(existing?.category || 'Other');
  const [purchaseSize, setPurchaseSize] = useState(existing ? String(existing.purchaseSize) : '1');
  const [purchaseUnit, setPurchaseUnit] = useState<MeasureUnit>(existing?.purchaseUnit || 'kg');
  const [purchasePrice, setPurchasePrice] = useState(existing ? String(existing.purchasePrice) : '');
  const [wastagePct, setWastagePct] = useState(existing?.wastagePct ? String(existing.wastagePct) : '');
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => {
    const size = parseFloat(purchaseSize);
    const price = parseFloat(purchasePrice);
    if (!size || !price) return null;
    return ingredientCostPerBaseUnit({
      purchaseSize: size, purchaseUnit, purchasePrice: price,
      wastagePct: parseFloat(wastagePct) || 0,
    } as RecipeIngredient);
  }, [purchaseSize, purchaseUnit, purchasePrice, wastagePct]);

  const baseLabel = dimensionOf(purchaseUnit) === 'weight' ? 'g' : dimensionOf(purchaseUnit) === 'volume' ? 'ml' : 'pc';

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return alert('Give the ingredient a name.');
    const size = parseFloat(purchaseSize);
    const price = parseFloat(purchasePrice);
    if (!size || size <= 0) return alert('Pack size must be greater than zero.');
    if (!price || price <= 0) return alert('Pack price must be greater than zero.');

    const clash = allIngredients.find(i => nameKey(i.name) === nameKey(trimmed) && i.id !== existing?.id);
    if (clash) return alert(`"${clash.name}" already exists. Edit that one instead — duplicate ingredients are how price drift starts.`);

    setSaving(true);
    try {
      const data = {
        name: trimmed,
        category,
        purchaseSize: size,
        purchaseUnit,
        purchasePrice: price,
        wastagePct: parseFloat(wastagePct) || 0,
        ownerId: dataOwnerId,
        userId: user.uid,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      if (existing?.id) {
        await updateDoc(doc(db, 'fc_ingredients', existing.id), data);
        onSaved({ ...data, id: existing.id });
      } else {
        const ref = await addDoc(collection(db, 'fc_ingredients'), data);
        onSaved({ ...data, id: ref.id });
      }
    } catch (err) {
      console.error('Ingredient save failed', err);
      alert('Could not save. Check the console for details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={existing ? 'Edit Ingredient' : 'New Ingredient'} subtitle="Price it by the pack you actually buy." onClose={onClose}>
      <div className="space-y-4">
        <Field label="Name">
          <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Japanese Rice" autoFocus />
        </Field>
        <Field label="Category">
          <select value={category} onChange={e => setCategory(e.target.value)} className={inputCls}>
            {RECIPE_INGREDIENT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Pack Size">
            <input type="number" step="any" value={purchaseSize} onChange={e => setPurchaseSize(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Unit">
            <select value={purchaseUnit} onChange={e => setPurchaseUnit(e.target.value as MeasureUnit)} className={inputCls}>
              {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
          <Field label="Pack Price ₹">
            <input type="number" step="any" value={purchasePrice} onChange={e => setPurchasePrice(e.target.value)} className={inputCls} placeholder="130" />
          </Field>
        </div>
        <Field label="Wastage / Trim Loss %">
          <input type="number" step="any" value={wastagePct} onChange={e => setWastagePct(e.target.value)} className={inputCls} placeholder="0" />
          <p className="text-[11px] font-semibold text-slate-400 mt-1.5">
            Leave blank unless the ingredient loses weight before it reaches the plate. 10% on a 1 kg pack means you pay for 1000 g but cook with 900 g.
          </p>
        </Field>

        {preview !== null && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500">Effective Cost</span>
            <span className="text-lg font-black text-indigo-700">₹{preview.toFixed(4)} <span className="text-xs">/ {baseLabel}</span></span>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-100 transition-all">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Save
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Recipe form
// ---------------------------------------------------------------------------

const RecipeForm: React.FC<{
  user: User;
  dataOwnerId: string;
  existing: Recipe | null;
  ingredients: RecipeIngredient[];
  recipes: Recipe[];
  onClose: () => void;
  onSaved: (r: Recipe) => void;
}> = ({ user, dataOwnerId, existing, ingredients, recipes, onClose, onSaved }) => {
  const [name, setName] = useState(existing?.name || '');
  const [category, setCategory] = useState(existing?.category || '');
  const [kind, setKind] = useState<RecipeKind>(existing?.kind || 'menu');
  const [sellPrice, setSellPrice] = useState(existing?.sellPrice ? String(existing.sellPrice) : '');
  const [yieldSize, setYieldSize] = useState(existing?.yieldSize ? String(existing.yieldSize) : '');
  const [yieldUnit, setYieldUnit] = useState<MeasureUnit>(existing?.yieldUnit || 'ml');
  const [components, setComponents] = useState<RecipeComponent[]>(existing?.components || []);
  const [saving, setSaving] = useState(false);

  /** Prep recipes are selectable as components; the recipe being edited is not. */
  const prepOptions = useMemo(
    () => recipes.filter(r => r.kind === 'prep' && r.id !== existing?.id),
    [recipes, existing]
  );

  const draft: Recipe = useMemo(() => ({
    id: existing?.id,
    name, category, kind, components,
    sellPrice: parseFloat(sellPrice) || undefined,
    yieldSize: parseFloat(yieldSize) || undefined,
    yieldUnit,
    ownerId: dataOwnerId, userId: user.uid,
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  }), [existing, name, category, kind, components, sellPrice, yieldSize, yieldUnit, dataOwnerId, user.uid]);

  const costed = useMemo(() => costRecipe(draft, ingredients, recipes), [draft, ingredients, recipes]);

  const addComponent = () => setComponents(prev => [...prev, { refType: 'ingredient', refId: '', refName: '', quantity: 0, unit: 'g' }]);

  const updateComponent = (idx: number, patch: Partial<RecipeComponent>) =>
    setComponents(prev => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const removeComponent = (idx: number) => setComponents(prev => prev.filter((_, i) => i !== idx));

  /** Picking a source also snaps the unit to something compatible with it. */
  const pickSource = (idx: number, value: string) => {
    if (!value) return updateComponent(idx, { refId: '', refName: '' });
    const [refType, refId] = value.split(':') as ['ingredient' | 'recipe', string];
    if (refType === 'ingredient') {
      const ing = ingredients.find(i => i.id === refId);
      if (!ing) return;
      updateComponent(idx, { refType, refId, refName: ing.name, unit: dimensionOf(ing.purchaseUnit) === 'weight' ? 'g' : dimensionOf(ing.purchaseUnit) === 'volume' ? 'ml' : 'pc' });
    } else {
      const rec = prepOptions.find(r => r.id === refId);
      if (!rec) return;
      const dim = dimensionOf(rec.yieldUnit || 'g');
      updateComponent(idx, { refType, refId, refName: rec.name, unit: dim === 'weight' ? 'g' : dim === 'volume' ? 'ml' : 'pc' });
    }
  };

  const save = async () => {
    if (!name.trim()) return alert('Give the recipe a name.');
    if (!components.length) return alert('A recipe needs at least one component.');
    if (components.some(c => !c.refId)) return alert('Every line needs an ingredient or prep recipe selected.');
    if (components.some(c => !c.quantity || c.quantity <= 0)) return alert('Every line needs a quantity greater than zero.');
    if (kind === 'prep' && (!parseFloat(yieldSize) || parseFloat(yieldSize) <= 0)) {
      return alert('A prep batch needs a yield — how much one batch produces. Without it, no per-unit cost can be derived.');
    }

    setSaving(true);
    try {
      const data: Omit<Recipe, 'id'> = {
        name: name.trim(),
        category: category.trim() || 'Uncategorized',
        kind,
        components,
        ownerId: dataOwnerId,
        userId: user.uid,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        ...(kind === 'menu'
          ? { sellPrice: parseFloat(sellPrice) || 0 }
          : { yieldSize: parseFloat(yieldSize), yieldUnit }),
      };
      if (existing?.id) {
        await updateDoc(doc(db, 'fc_recipes', existing.id), data as any);
        onSaved({ ...data, id: existing.id });
      } else {
        const ref = await addDoc(collection(db, 'fc_recipes'), data);
        onSaved({ ...data, id: ref.id });
      }
    } catch (err) {
      console.error('Recipe save failed', err);
      alert('Could not save. Check the console for details.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={existing ? 'Edit Recipe' : 'New Recipe'}
      subtitle={kind === 'prep' ? 'A batch you make once and use inside other recipes.' : 'Something you sell, costed per serving.'}
      onClose={onClose}
      wide
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Recipe Name">
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Chicken Poke Bowl" autoFocus />
          </Field>
          <Field label="Category">
            <input value={category} onChange={e => setCategory(e.target.value)} className={inputCls} placeholder="Poke Bowls" />
          </Field>
        </div>

        <Field label="Type">
          <div className="grid grid-cols-2 gap-3">
            {([
              { k: 'menu' as const, icon: <Utensils size={15} />, title: 'Menu Item', sub: 'Sold to a customer' },
              { k: 'prep' as const, icon: <Beaker size={15} />, title: 'Prep Batch', sub: 'Used inside other recipes' },
            ]).map(o => (
              <button
                key={o.k}
                onClick={() => setKind(o.k)}
                className={`flex items-center gap-3 p-3.5 rounded-xl border-2 text-left transition-all ${
                  kind === o.k ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className={kind === o.k ? 'text-indigo-600' : 'text-slate-400'}>{o.icon}</span>
                <div>
                  <p className={`text-xs font-black ${kind === o.k ? 'text-indigo-700' : 'text-slate-700'}`}>{o.title}</p>
                  <p className="text-[10px] font-semibold text-slate-400">{o.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </Field>

        {kind === 'menu' ? (
          <Field label="Selling Price ₹">
            <input type="number" step="any" value={sellPrice} onChange={e => setSellPrice(e.target.value)} className={inputCls} placeholder="644" />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Batch Yields">
              <input type="number" step="any" value={yieldSize} onChange={e => setYieldSize(e.target.value)} className={inputCls} placeholder="1" />
            </Field>
            <Field label="Yield Unit">
              <select value={yieldUnit} onChange={e => setYieldUnit(e.target.value as MeasureUnit)} className={inputCls}>
                {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
          </div>
        )}

        {/* Components */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Components</label>
            <button onClick={addComponent} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all">
              <Plus size={12} /> Add Line
            </button>
          </div>

          {!components.length ? (
            <div className="bg-white border border-dashed border-slate-200 rounded-xl py-10 text-center">
              <p className="text-xs font-bold text-slate-400">No components yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <th className="text-left px-4 py-2.5">Ingredient / Prep</th>
                    <th className="text-right px-3 py-2.5 w-28">Qty</th>
                    <th className="text-left px-3 py-2.5 w-24">Unit</th>
                    <th className="text-right px-4 py-2.5 w-28">Cost</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {components.map((c, idx) => {
                    const line = costed.lines[idx];
                    return (
                      <tr key={idx} className={line?.error ? 'bg-rose-50/50' : ''}>
                        <td className="px-4 py-2">
                          <select
                            value={c.refId ? `${c.refType}:${c.refId}` : ''}
                            onChange={e => pickSource(idx, e.target.value)}
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                          >
                            <option value="">— select —</option>
                            {!!ingredients.length && (
                              <optgroup label="Ingredients">
                                {ingredients.map(i => <option key={i.id} value={`ingredient:${i.id}`}>{i.name}</option>)}
                              </optgroup>
                            )}
                            {!!prepOptions.length && (
                              <optgroup label="Prep Batches">
                                {prepOptions.map(r => <option key={r.id} value={`recipe:${r.id}`}>{r.name}</option>)}
                              </optgroup>
                            )}
                          </select>
                          {line?.error && <p className="text-[10px] font-bold text-rose-600 mt-1">{line.error}</p>}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number" step="any" value={c.quantity || ''}
                            onChange={e => updateComponent(idx, { quantity: parseFloat(e.target.value) || 0 })}
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-right focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={c.unit}
                            onChange={e => updateComponent(idx, { unit: e.target.value as MeasureUnit })}
                            className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                          >
                            {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </td>
                        <td className="px-4 py-2 text-right font-black text-slate-800">{money(line?.lineCost ?? 0)}</td>
                        <td className="px-2 py-2">
                          <button onClick={() => removeComponent(idx)} className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Live totals */}
        <div className="bg-slate-900 rounded-2xl p-5 grid grid-cols-2 md:grid-cols-4 gap-5">
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">{kind === 'prep' ? 'Batch Cost' : 'Total Cost'}</p>
            <p className="text-2xl font-black text-white">{money(costed.totalCost)}</p>
          </div>
          {kind === 'prep' ? (
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Per Unit</p>
              <p className="text-2xl font-black text-amber-400">
                {costed.costPerYieldBaseUnit !== undefined
                  ? `₹${costed.costPerYieldBaseUnit.toFixed(3)}`
                  : '—'}
              </p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Profit</p>
                <p className="text-2xl font-black text-emerald-400">{costed.profit !== undefined ? money(costed.profit) : '—'}</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Food Cost</p>
                <p className="text-2xl font-black text-indigo-400">{costed.foodCostPct !== undefined ? `${costed.foodCostPct.toFixed(1)}%` : '—'}</p>
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Margin</p>
                <p className="text-2xl font-black text-white">{costed.marginPct !== undefined ? `${costed.marginPct.toFixed(1)}%` : '—'}</p>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-100 transition-all">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />} Save Recipe
          </button>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Paste import
// ---------------------------------------------------------------------------

const PasteImport: React.FC<{
  user: User;
  dataOwnerId: string;
  ingredients: RecipeIngredient[];
  onClose: () => void;
  onImported: () => void;
}> = ({ user, dataOwnerId, ingredients, onClose, onImported }) => {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [importing, setImporting] = useState(false);

  const byName = useMemo(() => new Map(ingredients.map(i => [nameKey(i.name), i])), [ingredients]);

  /** Split parsed rows into "already known" and "will be created". */
  const classified = useMemo(() => {
    if (!parsed) return null;
    const existing: { row: typeof parsed.rows[number]; ing: RecipeIngredient }[] = [];
    const fresh: typeof parsed.rows = [];
    const repriced: { row: typeof parsed.rows[number]; ing: RecipeIngredient; oldPer: number; newPer: number }[] = [];
    for (const row of parsed.rows) {
      const match = byName.get(nameKey(row.name));
      if (!match) { fresh.push(row); continue; }
      existing.push({ row, ing: match });
      const oldPer = ingredientCostPerBaseUnit(match);
      const newPer = row.purchasePrice / (row.purchaseSize * MEASURE_UNITS[row.purchaseUnit].toBase);
      if (Math.abs(oldPer - newPer) > 0.0001) repriced.push({ row, ing: match, oldPer, newPer });
    }
    return { existing, fresh, repriced };
  }, [parsed, byName]);

  const runParse = () => {
    const result = parseRecipePaste(text);
    setParsed(result);
    if (!name.trim()) {
      // The title usually sits on the first non-tabular line of the paste.
      const first = text.split(/\r?\n/).map(l => l.trim()).find(l => l && !/\t/.test(l) && !/^ingredient/i.test(l));
      if (first) setName(first.replace(/\s+/g, ' ').trim());
    }
  };

  const doImport = async () => {
    if (!parsed || !classified) return;
    if (!name.trim()) return alert('Give the recipe a name.');
    if (!parsed.rows.length) return alert('Nothing to import — no ingredient rows were recognized.');

    setImporting(true);
    try {
      // 1. Create the ingredients this paste introduces.
      const batch = writeBatch(db);
      const newIds = new Map<string, string>();
      for (const row of classified.fresh) {
        const ref = doc(collection(db, 'fc_ingredients'));
        batch.set(ref, {
          name: row.name,
          category: 'Other',
          purchaseSize: row.purchaseSize,
          purchaseUnit: row.purchaseUnit,
          purchasePrice: row.purchasePrice,
          wastagePct: 0,
          ownerId: dataOwnerId,
          userId: user.uid,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        newIds.set(nameKey(row.name), ref.id);
      }
      await batch.commit();

      // 2. Build the recipe out of both new and pre-existing ingredients.
      //    Existing ingredients keep THEIR price — the master list wins, which
      //    is the entire point of having one.
      const components: RecipeComponent[] = parsed.rows.map(row => {
        const key = nameKey(row.name);
        const id = newIds.get(key) || byName.get(key)?.id || '';
        return { refType: 'ingredient' as const, refId: id, refName: row.name, quantity: row.quantity, unit: row.unit };
      });

      await addDoc(collection(db, 'fc_recipes'), {
        name: name.trim(),
        category: category.trim() || 'Uncategorized',
        kind: 'menu' as RecipeKind,
        components,
        sellPrice: parseFloat(sellPrice) || 0,
        ownerId: dataOwnerId,
        userId: user.uid,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      onImported();
    } catch (err) {
      console.error('Paste import failed', err);
      alert('Import failed. Check the console for details.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title="Paste a Recipe"
      subtitle="Copy the rows straight out of your sheet — name, quantity, unit, purchase unit, unit price."
      onClose={onClose}
      wide
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Recipe Name">
            <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Chicken Poke Bowl" />
          </Field>
          <Field label="Category">
            <input value={category} onChange={e => setCategory(e.target.value)} className={inputCls} placeholder="Poke Bowls" />
          </Field>
          <Field label="Selling Price ₹">
            <input type="number" step="any" value={sellPrice} onChange={e => setSellPrice(e.target.value)} className={inputCls} placeholder="644" />
          </Field>
        </div>

        <Field label="Paste Rows">
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setParsed(null); }}
            rows={9}
            className={`${inputCls} font-mono text-xs leading-relaxed`}
            placeholder={'Purple cabbage\t23\tgm\tKg\t200\t4.6\nCucumber\t16\tgm\tKg\t70\t1.12'}
          />
          <p className="text-[11px] font-semibold text-slate-400 mt-1.5 flex items-start gap-1.5">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            Purchase unit can be a word (Kg, litre) or a number for odd packs — 750 on an ml row means a 750 ml bottle, 24 on a piece row means a 24-egg tray.
          </p>
        </Field>

        {!parsed ? (
          <button onClick={runParse} disabled={!text.trim()} className="w-full py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-40">
            Parse & Preview
          </button>
        ) : (
          <div className="space-y-4">
            {/* Total check */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Rows Read</p>
                <p className="text-xl font-black text-slate-900">{parsed.rows.length}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Computed Total</p>
                <p className="text-xl font-black text-indigo-600">{money(parsed.computedTotal)}</p>
              </div>
              <div className={`rounded-xl p-4 border ${
                parsed.statedTotal === undefined ? 'bg-white border-slate-200'
                  : Math.abs(parsed.statedTotal - parsed.computedTotal) < 0.02 ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-rose-50 border-rose-200'
              }`}>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Sheet Said</p>
                <p className="text-xl font-black text-slate-900">
                  {parsed.statedTotal !== undefined ? money(parsed.statedTotal) : '—'}
                  {parsed.statedTotal !== undefined && Math.abs(parsed.statedTotal - parsed.computedTotal) < 0.02 && (
                    <Check className="inline ml-2 text-emerald-600" size={16} />
                  )}
                </p>
              </div>
            </div>

            {!!parsed.mismatches.length && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {parsed.mismatches.length} row(s) where the sheet's cost disagrees with its own arithmetic
                </p>
                <ul className="space-y-1">
                  {parsed.mismatches.map((m, i) => (
                    <li key={i} className="text-xs font-semibold text-amber-800">
                      <span className="font-black">{m.name}</span> — sheet {money(m.stated)}, arithmetic {money(m.computed)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!!parsed.skipped.length && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-rose-700 mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> {parsed.skipped.length} row(s) skipped
                </p>
                <ul className="space-y-1">
                  {parsed.skipped.map((s, i) => (
                    <li key={i} className="text-xs font-semibold text-rose-800 truncate">{s.reason} — <span className="font-mono opacity-70">{s.line}</span></li>
                  ))}
                </ul>
              </div>
            )}

            {!!classified?.repriced.length && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700 mb-2">
                  {classified.repriced.length} ingredient(s) already exist at a different price — the master list price is kept
                </p>
                <ul className="space-y-1">
                  {classified.repriced.map((r, i) => (
                    <li key={i} className="text-xs font-semibold text-indigo-800">
                      <span className="font-black">{r.ing.name}</span> — keeping ₹{r.oldPer.toFixed(4)}, paste said ₹{r.newPer.toFixed(4)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <th className="text-left px-4 py-2.5">Ingredient</th>
                    <th className="text-right px-3 py-2.5">Qty</th>
                    <th className="text-right px-3 py-2.5">Pack</th>
                    <th className="text-right px-3 py-2.5">Price</th>
                    <th className="text-right px-4 py-2.5">Cost</th>
                    <th className="text-right px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {parsed.rows.map((r, i) => {
                    const known = byName.has(nameKey(r.name));
                    return (
                      <tr key={i}>
                        <td className="px-4 py-2 font-black text-slate-800">{r.name}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-600">{r.quantity} {r.unit}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-500">{r.purchaseSize} {r.purchaseUnit}</td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-600">{money(r.purchasePrice)}</td>
                        <td className="px-4 py-2 text-right font-black text-slate-900">{money(r.computedCost)}</td>
                        <td className="px-4 py-2 text-right">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-md ${known ? 'bg-slate-100 text-slate-500' : 'bg-emerald-100 text-emerald-700'}`}>
                            {known ? 'Existing' : 'New'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setParsed(null)} className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-100 transition-all">
                Back to Edit
              </button>
              <button onClick={doImport} disabled={importing} className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {importing ? <Loader2 className="animate-spin" size={15} /> : <TrendingUp size={15} />}
                Create Recipe {classified?.fresh.length ? `+ ${classified.fresh.length} New Ingredient${classified.fresh.length === 1 ? '' : 's'}` : ''}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default RecipeCostLab;
