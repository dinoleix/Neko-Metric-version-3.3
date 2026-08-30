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
import { getMenuDirectory, EMPTY_MENU_DIRECTORY, MenuDirectory } from '../menuDirectory';
import {
  ChefHat, Plus, Search, Edit2, Trash2, X, Loader2, Package, ClipboardPaste,
  AlertTriangle, Check, Beaker, Utensils, TrendingUp, Info, Upload, Eye, Printer,
} from 'lucide-react';
import { getCachedCollection } from '../referenceCache';
import { ItemCost } from '../types';
import {
  buildPublishPlan, publishRecipeCosts, looksLikePackaging,
  PublishPlan, PublishRow,
} from '../recipeCostPublish';

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
  const [menuDirectory, setMenuDirectory] = useState<MenuDirectory>(EMPTY_MENU_DIRECTORY);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [showRecipeForm, setShowRecipeForm] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<RecipeIngredient | null>(null);
  const [showIngredientForm, setShowIngredientForm] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ingSnap, recSnap, directory] = await Promise.all([
        getDocs(query(collection(db, 'fc_ingredients'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'fc_recipes'), where('ownerId', '==', dataOwnerId))),
        getMenuDirectory(dataOwnerId).catch(err => {
          // Recipe Costing works fine without this — it just falls back to free text.
          console.error('Menu directory load failed', err);
          return EMPTY_MENU_DIRECTORY;
        }),
      ]);
      setIngredients(
        ingSnap.docs.map(d => ({ id: d.id, ...d.data() } as RecipeIngredient))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setRecipes(
        recSnap.docs.map(d => ({ id: d.id, ...d.data() } as Recipe))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      setMenuDirectory(directory);
    } catch (err) {
      console.error('Recipe costing: load failed', err);
    } finally {
      setLoading(false);
    }
  }, [dataOwnerId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const costs = useMemo(
    () => costAll(recipes, ingredients, menuDirectory.priceByName),
    [recipes, ingredients, menuDirectory.priceByName],
  );

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
          <button
            onClick={() => setShowPublish(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-500/25"
          >
            <Upload size={15} /> Publish Costs
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
          onView={setViewingRecipe}
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
          menuDirectory={menuDirectory}
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
          recipes={recipes}
          menuDirectory={menuDirectory}
          onClose={() => setShowPaste(false)}
          onImported={() => { setShowPaste(false); loadAll(); }}
        />
      )}

      {viewingRecipe && (
        <RecipeViewModal
          recipe={viewingRecipe}
          costed={costs.get(viewingRecipe.id!)}
          onClose={() => setViewingRecipe(null)}
          onEdit={() => { setEditingRecipe(viewingRecipe); setViewingRecipe(null); setShowRecipeForm(true); }}
        />
      )}

      {showPublish && (
        <PublishModal
          dataOwnerId={dataOwnerId}
          recipes={recipes}
          ingredients={ingredients}
          menuDirectory={menuDirectory}
          onClose={() => setShowPublish(false)}
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
  onView: (r: Recipe) => void;
  onEdit: (r: Recipe) => void;
  onDelete: (r: Recipe) => void;
}> = ({ recipes, costs, onView, onEdit, onDelete }) => {
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
                    {/* Cash, not another percentage — margin % is just
                        100 − food cost %, so it would restate the column beside
                        it. What that percentage hides is scale: a 75% margin on
                        a ₹80 drink earns less than 62% on a ₹600 bowl. */}
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Profit</p>
                      <p className={`text-lg font-black ${c.profit! < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {money(c.profit!)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Food Cost</p>
                      <p className="text-lg font-black text-indigo-600">{c.foodCostPct!.toFixed(1)}%</p>
                    </div>
                    <span className={`text-[9px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg ${band.cls}`}>{band.label}</span>
                  </>
                )}
                <div className="flex gap-1.5">
                  <button onClick={() => onView(r)} title="View recipe" className="p-2 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all">
                    <Eye size={15} />
                  </button>
                  <button onClick={() => onEdit(r)} title="Edit recipe" className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all">
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
  // The print: variants let a modal be printed on its own — a fixed, scrolling,
  // blurred overlay otherwise clips whatever sits inside it. Only the recipe
  // card is ever printed; the rest is inert.
  <div className="fixed inset-0 z-[100] bg-slate-900/50 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto print:static print:block print:overflow-visible print:bg-transparent print:backdrop-blur-none print:p-0">
    <div className={`bg-slate-50 rounded-2xl shadow-2xl w-full my-8 ${wide ? 'max-w-5xl' : 'max-w-xl'} print:my-0 print:max-w-none print:shadow-none print:rounded-none`}>
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
// Menu name + category pickers
// ---------------------------------------------------------------------------

/**
 * State for the "which menu item is this?" pair of dropdowns.
 *
 * Both directions are wired: choosing a category narrows the name list to that
 * segment, and choosing a name backfills the category while it's still blank.
 * Kept in one hook because the New Recipe form and the Paste importer ask the
 * same question — two copies of this logic would drift.
 */
const useMenuPickers = (
  menuDirectory: MenuDirectory,
  recipes: Recipe[],
  existing?: Recipe | null,
) => {
  const [name, setName] = useState(existing?.name || '');
  const [category, setCategory] = useState(existing?.category || '');

  const segmentOf = useCallback(
    (item: string) => menuDirectory.segmentByName[item.trim().toUpperCase()],
    [menuDirectory],
  );

  /** Names in scope: every sold item, or just the chosen category's. The
   * recipe's own saved name stays selectable so editing never strands it. */
  const nameOptions = useMemo(() => {
    const scoped = category
      ? menuDirectory.names.filter(n => segmentOf(n) === category)
      : menuDirectory.names;
    const opts = new Set(scoped);
    if (existing?.name) opts.add(existing.name);
    return Array.from(opts).sort();
  }, [menuDirectory, category, segmentOf, existing]);

  /** Category choices: the app-wide menu segments, plus any category already
   * used on a saved recipe (covers prep-only labels like "Sauces"). */
  const categoryOptions = useMemo(() => {
    const opts = new Set(menuDirectory.segments);
    recipes.forEach(r => { if (r.category) opts.add(r.category); });
    if (existing?.category) opts.add(existing.category);
    opts.add('Uncategorized');
    return Array.from(opts).sort();
  }, [menuDirectory.segments, recipes, existing]);

  /** A category with nothing sold under it — worth saying so, rather than
   * rendering a dropdown with nothing in it and no reason why. */
  const emptyCategory = !!category && !!menuDirectory.names.length && !nameOptions.length;

  const pickName = (value: string) => {
    setName(value);
    if (!value) return;
    if (!category) {
      const segment = segmentOf(value);
      if (segment) setCategory(segment);
    }
  };

  /** Re-scoping the list can orphan the current name; drop it rather than leave
   * the select displaying a value it no longer offers. */
  const pickCategory = (value: string) => {
    setCategory(value);
    if (value && name && name !== existing?.name && segmentOf(name) !== value) setName('');
  };

  /** For the paste importer's guessed title — taken only if it names a real
   * menu item that the current category scope still allows. */
  const trySelectName = (guess: string) => {
    const match = menuDirectory.names.find(n => n.toUpperCase() === guess.toUpperCase());
    if (!match) return;
    if (category && segmentOf(match) !== category) return;
    pickName(match);
  };

  return {
    name, setName, category,
    nameOptions, categoryOptions, emptyCategory,
    pickName, pickCategory, trySelectName,
  };
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
  menuDirectory: MenuDirectory;
  onClose: () => void;
  onSaved: (r: Recipe) => void;
}> = ({ user, dataOwnerId, existing, ingredients, recipes, menuDirectory, onClose, onSaved }) => {
  const {
    name, setName, category,
    nameOptions, categoryOptions, emptyCategory,
    pickName, pickCategory,
  } = useMenuPickers(menuDirectory, recipes, existing);

  /**
   * Read from Menu Prices, never typed here — one price per item, in one place.
   * Falls back to whatever this recipe stored before that page existed.
   */
  const sellPrice = menuDirectory.priceByName[name.trim().toUpperCase()] ?? existing?.sellPrice;
  const priceFromMenu = menuDirectory.priceByName[name.trim().toUpperCase()] !== undefined;
  const [kind, setKind] = useState<RecipeKind>(existing?.kind || 'menu');

  /** Switching back to a menu item re-imposes the master-list constraint — a
   * name free-typed while this was a prep batch would otherwise survive into
   * the select as a value it never offered. */
  const pickKind = (next: RecipeKind) => {
    setKind(next);
    if (next === 'menu' && name && !nameOptions.includes(name)) setName('');
  };

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
    sellPrice,
    yieldSize: parseFloat(yieldSize) || undefined,
    yieldUnit,
    ownerId: dataOwnerId, userId: user.uid,
    createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now(),
  }), [existing, name, category, kind, components, sellPrice, yieldSize, yieldUnit, dataOwnerId, user.uid]);

  const costed = useMemo(
    () => costRecipe(draft, ingredients, recipes, menuDirectory.priceByName),
    [draft, ingredients, recipes, menuDirectory.priceByName],
  );

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
    if (!name.trim()) return alert(kind === 'menu' ? 'Select which menu item this recipe is for.' : 'Give the recipe a name.');
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
        // Menu Prices is authoritative; this is only refreshed so a recipe keeps
        // a usable fallback if its item is ever missing from that page.
        ...(kind === 'menu'
          ? { sellPrice: sellPrice ?? 0 }
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
            {kind !== 'menu' ? (
              <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Chili Oil Batch" autoFocus />
            ) : !menuDirectory.names.length ? (
              <p className="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                No sold items found yet — upload some sales data first, or switch this to a Prep Batch.
              </p>
            ) : emptyCategory ? (
              <p className="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                No sold items are in “{category}” yet. Assign items to it in Category Settings, or clear the category to see every item.
              </p>
            ) : (
              <select value={name} onChange={e => pickName(e.target.value)} className={inputCls} autoFocus>
                <option value="">— select a menu item —</option>
                {nameOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </Field>
          <Field label="Category">
            <select value={category} onChange={e => pickCategory(e.target.value)} className={inputCls}>
              <option value="">— all categories —</option>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
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
                onClick={() => pickKind(o.k)}
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
            <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className={`text-sm font-black ${sellPrice ? 'text-slate-800' : 'text-slate-300'}`}>
                {sellPrice ? money(sellPrice) : '— not set —'}
              </span>
              <span className="text-[10px] font-bold text-slate-400 ml-auto">
                {!name ? 'Pick an item first'
                  : priceFromMenu ? 'From Menu Prices'
                  : sellPrice ? 'Saved on this recipe — add it to Menu Prices'
                  : 'Set it on the Menu Prices page'}
              </span>
            </div>
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
                    // Packaging belongs in the Tier 1 / Tier 2 columns of Tiered
                    // SKU Costs, which vary by store tier. Left in a recipe it is
                    // counted twice once the cost is published.
                    const packaging = c.refType === 'ingredient'
                      && (() => { const i = ingredients.find(x => x.id === c.refId); return !!i && looksLikePackaging(i); })();
                    return (
                      <tr key={idx} className={line?.error ? 'bg-rose-50/50' : packaging ? 'bg-amber-50/50' : ''}>
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
                          {!line?.error && packaging && (
                            <p className="text-[10px] font-bold text-amber-600 mt-1">
                              Looks like packaging — keep it in Tiered SKU Costs, or it gets counted twice.
                            </p>
                          )}
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
        <div className="bg-slate-900 rounded-2xl p-5 grid grid-cols-2 md:grid-cols-3 gap-5">
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
              {/* Margin % is deliberately absent: it is exactly 100 − food
                  cost %, so it restated the tile beside it. */}
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-500 mb-1">Food Cost</p>
                <p className="text-2xl font-black text-indigo-400">{costed.foodCostPct !== undefined ? `${costed.foodCostPct.toFixed(1)}%` : '—'}</p>
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
  recipes: Recipe[];
  menuDirectory: MenuDirectory;
  onClose: () => void;
  onImported: () => void;
}> = ({ user, dataOwnerId, ingredients, recipes, menuDirectory, onClose, onImported }) => {
  const [text, setText] = useState('');

  const {
    name, setName, category,
    nameOptions, categoryOptions, emptyCategory,
    pickName, pickCategory, trySelectName,
  } = useMenuPickers(menuDirectory, recipes);

  /** From Menu Prices, never typed here — see RecipeForm. */
  const sellPrice = menuDirectory.priceByName[name.trim().toUpperCase()];
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
      // The title usually sits on the first non-tabular line of the paste —
      // used only to guess which menu item this is, not as the stored name.
      const first = text.split(/\r?\n/).map(l => l.trim()).find(l => l && !/\t/.test(l) && !/^ingredient/i.test(l));
      const guess = first?.replace(/\s+/g, ' ').trim();
      if (guess) trySelectName(guess);
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
        category: category || 'Uncategorized',
        kind: 'menu' as RecipeKind,
        components,
        sellPrice: sellPrice ?? 0,
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
            {!menuDirectory.names.length ? (
              <input value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Chicken Poke Bowl" />
            ) : emptyCategory ? (
              <p className="text-[11px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                No sold items are in “{category}” yet. Assign items to it in Category Settings, or clear the category to see every item.
              </p>
            ) : (
              <select value={name} onChange={e => pickName(e.target.value)} className={inputCls}>
                <option value="">— select a menu item —</option>
                {nameOptions.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </Field>
          <Field label="Category">
            <select value={category} onChange={e => pickCategory(e.target.value)} className={inputCls}>
              <option value="">— all categories —</option>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Selling Price ₹">
            <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <span className={`text-sm font-black ${sellPrice ? 'text-slate-800' : 'text-slate-300'}`}>
                {sellPrice ? money(sellPrice) : '— not set —'}
              </span>
              <span className="text-[10px] font-bold text-slate-400 ml-auto">
                {sellPrice ? 'From Menu Prices' : 'Set it on Menu Prices'}
              </span>
            </div>
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

// ---------------------------------------------------------------------------
// Recipe view / print card
// ---------------------------------------------------------------------------

/**
 * Read-only view of a recipe, and the thing you print for the kitchen.
 *
 * Separate from the editor because reading a recipe should not put you one
 * stray keystroke away from changing it. Costs are hidden from the print by
 * default: a line cook needs quantities, and a sheet on a pass is not where
 * margins belong.
 */
const RecipeViewModal: React.FC<{
  recipe: Recipe;
  costed?: CostedRecipe;
  onClose: () => void;
  onEdit: () => void;
}> = ({ recipe, costed, onClose, onEdit }) => {
  const [printCosts, setPrintCosts] = useState(false);
  const isPrep = recipe.kind === 'prep';
  const baseUnit = dimensionOf(recipe.yieldUnit || 'g') === 'weight' ? 'g'
    : dimensionOf(recipe.yieldUnit || 'g') === 'volume' ? 'ml' : 'pc';

  /** Costs are hidden on paper unless asked for, always shown on screen. */
  const costCls = printCosts ? '' : 'print:hidden';

  return (
    <Modal title="Recipe" subtitle={recipe.name} onClose={onClose} wide>
      <div className="space-y-5">
        <div id="recipe-print" className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          {/* Header — doubles as the printed title block */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-2xl font-black text-slate-900">{recipe.name}</h2>
              <p className="text-xs font-bold text-slate-500 mt-1 uppercase tracking-widest">
                {recipe.category}
                {isPrep
                  ? ` · Prep batch → ${recipe.yieldSize} ${recipe.yieldUnit}`
                  : ' · Menu item · one serving'}
              </p>
            </div>
            <span className={`p-2.5 rounded-xl ${isPrep ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
              {isPrep ? <Beaker size={18} /> : <Utensils size={18} />}
            </span>
          </div>

          {/* Money. Screen always; paper only on request. */}
          {costed && (
            <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${costCls}`}>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">{isPrep ? 'Batch Cost' : 'Cost'}</p>
                <p className="text-xl font-black text-slate-900">{money(costed.totalCost)}</p>
              </div>
              {isPrep ? (
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Per {baseUnit}</p>
                  <p className="text-xl font-black text-amber-600">
                    {costed.costPerYieldBaseUnit !== undefined ? `₹${costed.costPerYieldBaseUnit.toFixed(3)}` : '—'}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Sells</p>
                    <p className="text-xl font-black text-slate-700">{costed.sellPrice !== undefined ? money(costed.sellPrice) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Profit</p>
                    <p className={`text-xl font-black ${(costed.profit ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {costed.profit !== undefined ? money(costed.profit) : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Food Cost</p>
                    <p className="text-xl font-black text-indigo-600">
                      {costed.foodCostPct !== undefined ? `${costed.foodCostPct.toFixed(1)}%` : '—'}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Components — the part the kitchen actually reads */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
              {recipe.components.length} Component{recipe.components.length === 1 ? '' : 's'}
            </p>
            <table className="w-full text-sm border-t border-slate-200">
              <thead>
                <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                  <th className="text-left py-2">Ingredient</th>
                  <th className="text-right py-2 w-32">Quantity</th>
                  <th className={`text-right py-2 w-28 ${costCls}`}>Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recipe.components.map((c, i) => {
                  const line = costed?.lines[i];
                  return (
                    <tr key={i}>
                      <td className="py-2.5 font-bold text-slate-800">
                        {line?.name || c.refName}
                        {c.refType === 'recipe' && (
                          <span className="ml-2 text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Prep</span>
                        )}
                        {line?.error && <p className="text-[10px] font-bold text-rose-600 mt-0.5">{line.error}</p>}
                      </td>
                      <td className="py-2.5 text-right font-black text-slate-900 tabular-nums">{c.quantity} {c.unit}</td>
                      <td className={`py-2.5 text-right font-bold text-slate-600 ${costCls}`}>{money(line?.lineCost ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {!!costed && (
                <tfoot className={costCls}>
                  <tr className="border-t-2 border-slate-200">
                    <td className="py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500">Total</td>
                    <td />
                    <td className="py-2.5 text-right font-black text-slate-900">{money(costed.totalCost)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {!!costed?.errors.length && (
            <div className="flex items-start gap-2 text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>{costed.errors.join(' · ')}</span>
            </div>
          )}
        </div>

        {/* Controls — never printed */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center print-hide">
          <label className="flex items-center gap-2 text-[11px] font-bold text-slate-500 cursor-pointer flex-1">
            <input type="checkbox" checked={printCosts} onChange={e => setPrintCosts(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-600" />
            Include costs when printing
          </label>
          <div className="flex gap-3">
            <button onClick={onEdit} className="px-5 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[11px] uppercase tracking-widest hover:border-indigo-300 hover:text-indigo-600 transition-all flex items-center gap-2">
              <Edit2 size={14} /> Edit
            </button>
            <button onClick={() => window.print()} className="px-5 py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2">
              <Printer size={14} /> Print
            </button>
            <button onClick={onClose} className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-700 transition-all">
              Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Publish to Item Costs
// ---------------------------------------------------------------------------

/**
 * The one action that leaves this module. Shows exactly what would change in
 * `item_costs` and writes nothing until the user confirms — these numbers drive
 * the P&L, so a silent write is not acceptable.
 */
const PublishModal: React.FC<{
  dataOwnerId: string;
  recipes: Recipe[];
  ingredients: RecipeIngredient[];
  menuDirectory: MenuDirectory;
  onClose: () => void;
}> = ({ dataOwnerId, recipes, ingredients, menuDirectory, onClose }) => {
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await getCachedCollection<ItemCost>('item_costs', dataOwnerId);
        if (cancelled) return;
        const built = buildPublishPlan(recipes, ingredients, existing, menuDirectory.names, dataOwnerId);
        setPlan(built);
        // Everything publishable starts selected — including rows flagged for
        // suspected packaging. The flag is there to be noticed, not to veto.
        setSelected(new Set(built.publishable.map(r => r.recipeId)));
      } catch (err) {
        console.error('Publish preview failed', err);
        if (!cancelled) setError('Could not read current item costs.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dataOwnerId, recipes, ingredients, menuDirectory.names]);

  const chosen = useMemo(
    () => plan?.publishable.filter(r => selected.has(r.recipeId)) ?? [],
    [plan, selected],
  );
  const netChange = chosen.reduce((s, r) => s + r.delta, 0);

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const run = async () => {
    if (!chosen.length) return;
    setPublishing(true);
    setError('');
    try {
      const n = await publishRecipeCosts(dataOwnerId, chosen);
      setDone(n);
    } catch (err) {
      console.error('Publish failed', err);
      setError('Publish failed. Check the console for details.');
    } finally {
      setPublishing(false);
    }
  };

  const statusBadge = (r: PublishRow) => {
    if (r.status === 'blocked') return <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase bg-rose-100 text-rose-700">Blocked</span>;
    if (r.status === 'unchanged') return <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase bg-slate-100 text-slate-500">Unchanged</span>;
    if (r.status === 'new') return <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase bg-emerald-100 text-emerald-700">New</span>;
    return <span className="px-2 py-0.5 rounded-full text-[8px] font-black uppercase bg-indigo-100 text-indigo-700">Changed</span>;
  };

  return (
    <Modal
      title="Publish Costs to Item Costs"
      subtitle="Sends each menu recipe's cost to the Tiered SKU Costs ingredient column. Packaging is not touched."
      onClose={onClose}
      wide
    >
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-emerald-600" size={28} />
        </div>
      ) : done !== null ? (
        <div className="py-12 text-center space-y-4">
          <div className="inline-flex p-4 bg-emerald-100 rounded-2xl"><Check className="text-emerald-600" size={28} /></div>
          <p className="text-lg font-black text-slate-900">{done} item{done === 1 ? '' : 's'} published</p>
          <p className="text-xs font-semibold text-slate-500 max-w-md mx-auto">
            Tiered SKU Costs now shows these as recipe-driven. Reopen that tab to see them — a tab
            left open from before still holds the old numbers.
          </p>
          <button onClick={onClose} className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-all">Done</button>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="flex items-start gap-2 text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
            <Info size={13} className="mt-0.5 flex-shrink-0" />
            This writes the ingredient cost read by P&amp;L Command, Item Insights, Online Profit Center,
            Waste Radar and the Data Catalog. Tier 1 and Tier 2 packaging costs are left exactly as they are.
          </p>

          {error && (
            <p className="flex items-start gap-2 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" /> {error}
            </p>
          )}

          {plan?.masterListMissing && (
            <p className="flex items-start gap-2 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              Could not load the list of sold items, so recipe names were not checked against it.
              Publishing still works, but a name that matches no sold item creates a cost record nothing reads.
            </p>
          )}

          {!!plan?.rows.length && !plan.publishable.length && (
            <p className="flex items-start gap-2 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2.5">
              <Info size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                Nothing to publish, so no rows are selectable.
                {plan.unchanged.length > 0 && ` ${plan.unchanged.length} already match the saved cost.`}
                {plan.blocked.length > 0 && ` ${plan.blocked.length} cannot be published — the reason is under each name.`}
              </span>
            </p>
          )}

          {!!plan?.flagged.length && (
            <p className="flex items-start gap-2 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
              <span>
                {plan.flagged.length} recipe{plan.flagged.length === 1 ? '' : 's'} contain{plan.flagged.length === 1 ? 's' : ''} something
                that looks like packaging. Packaging belongs in the Tier columns — leaving it in a recipe
                counts it twice. Check these before publishing.
              </span>
            </p>
          )}

          {!plan?.rows.length ? (
            <div className="bg-white border border-dashed border-slate-200 rounded-xl py-12 text-center">
              <p className="text-xs font-bold text-slate-400">No menu recipes to publish yet.</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden max-h-[46vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 sticky top-0">
                  <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <th className="w-10 px-3 py-2.5" />
                    <th className="text-left px-3 py-2.5">Item</th>
                    <th className="text-right px-3 py-2.5 w-24">Current</th>
                    <th className="text-right px-3 py-2.5 w-24">New</th>
                    <th className="text-right px-3 py-2.5 w-24">Change</th>
                    <th className="text-left px-3 py-2.5 w-28">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {plan.rows.map(r => {
                    const selectable = r.status === 'new' || r.status === 'changed';
                    const isOn = selected.has(r.recipeId);
                    return (
                      <tr key={r.recipeId} className={r.status === 'blocked' ? 'bg-rose-50/40' : !selectable ? 'opacity-50' : ''}>
                        <td className="px-3 py-2.5">
                          {selectable && (
                            <input type="checkbox" checked={isOn} onChange={() => toggle(r.recipeId)}
                              className="w-4 h-4 rounded accent-emerald-600 cursor-pointer" />
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-xs font-black text-slate-800 uppercase">{r.itemName}</p>
                          {r.blockReason && <p className="text-[10px] font-bold text-rose-600 mt-0.5">{r.blockReason}</p>}
                          {!!r.suspectedPackaging.length && (
                            <p className="text-[10px] font-bold text-amber-600 mt-0.5">
                              Looks like packaging: {r.suspectedPackaging.join(', ')}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-bold text-slate-400">
                          {r.oldCost === null ? '—' : money(r.oldCost)}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs font-black text-slate-800">{money(r.newCost)}</td>
                        <td className={`px-3 py-2.5 text-right text-xs font-black ${
                          r.status === 'blocked' || r.status === 'unchanged' ? 'text-slate-300'
                            : r.delta > 0 ? 'text-rose-600' : 'text-emerald-600'
                        }`}>
                          {r.status === 'blocked' || r.oldCost === null ? '—' : `${r.delta > 0 ? '+' : ''}${money(r.delta)}`}
                        </td>
                        <td className="px-3 py-2.5">{statusBadge(r)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
            <p className="flex-1 text-[11px] font-bold text-slate-500">
              {chosen.length} item{chosen.length === 1 ? '' : 's'} selected
              {chosen.length > 0 && (
                <> · net cost change {netChange >= 0 ? '+' : ''}{money(netChange)} per unit</>
              )}
              {!!plan?.blocked.length && <> · {plan.blocked.length} blocked</>}
            </p>
            <div className="flex gap-3">
              <button onClick={onClose} className="px-5 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-100 transition-all">
                Cancel
              </button>
              <button onClick={run} disabled={publishing || !chosen.length}
                className="px-5 py-3 bg-emerald-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                {publishing ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />}
                Publish {chosen.length || ''}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default RecipeCostLab;
