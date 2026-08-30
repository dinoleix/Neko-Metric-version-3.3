// ---------------------------------------------------------------------------
// Recipe costing engine.
//
// Self-contained: reads only `fc_ingredients` and `fc_recipes`. No P&L
// collection is touched in either direction.
//
// The whole model rests on one idea — every ingredient has a cost per BASE
// unit (g, ml or pc), and every recipe is a sum of quantities times those
// costs. A prep recipe is just an ingredient whose per-base-unit cost happens
// to be computed rather than purchased.
// ---------------------------------------------------------------------------

import {
  RecipeIngredient,
  Recipe,
  RecipeComponent,
  MeasureUnit,
  UnitDimension,
  MEASURE_UNITS,
} from './types';

export interface CostedLine {
  refType: 'ingredient' | 'recipe';
  refId: string;
  name: string;
  quantity: number;
  unit: MeasureUnit;
  /** Cost of one base unit of the referenced thing. */
  costPerBaseUnit: number;
  /** quantity (converted to base units) x costPerBaseUnit. */
  lineCost: number;
  /** Set when the line could not be costed; lineCost is 0 in that case. */
  error?: string;
}

export interface CostedRecipe {
  recipeId: string;
  name: string;
  lines: CostedLine[];
  /** Sum of every line. For a prep recipe this is the cost of one full batch. */
  totalCost: number;
  /** Menu recipes only: totalCost is already per serving. */
  sellPrice?: number;
  profit?: number;
  /** Profit as a percentage of sell price. */
  marginPct?: number;
  /** Cost as a percentage of sell price — the number chefs actually watch. */
  foodCostPct?: number;
  /** Prep recipes only: batch cost divided by yield, in the yield's base unit. */
  costPerYieldBaseUnit?: number;
  /** Problems that make the total untrustworthy rather than merely absent. */
  errors: string[];
}

export const dimensionOf = (unit: MeasureUnit): UnitDimension =>
  MEASURE_UNITS[unit].dimension;

/** Convert a quantity to its family's base unit (g, ml or pc). */
export const toBaseQuantity = (quantity: number, unit: MeasureUnit): number =>
  quantity * MEASURE_UNITS[unit].toBase;

/**
 * What one base unit of an ingredient costs.
 *
 * Wastage inflates it: a 1 kg pack at 10% trim loss yields 900 usable grams,
 * so each usable gram carries 1/900th of the pack price, not 1/1000th.
 */
export const ingredientCostPerBaseUnit = (ing: RecipeIngredient): number => {
  const baseQty = toBaseQuantity(ing.purchaseSize, ing.purchaseUnit);
  if (!baseQty || baseQty <= 0) return 0;
  const wastage = Math.min(Math.max(ing.wastagePct || 0, 0), 99) / 100;
  const usable = baseQty * (1 - wastage);
  if (usable <= 0) return 0;
  return ing.purchasePrice / usable;
};

/** Human-readable price-per-base-unit, e.g. "₹0.070 / ml". */
export const formatPerBaseUnit = (ing: RecipeIngredient): string => {
  const dim = dimensionOf(ing.purchaseUnit);
  const base = dim === 'weight' ? 'g' : dim === 'volume' ? 'ml' : 'pc';
  return `₹${ingredientCostPerBaseUnit(ing).toFixed(3)} / ${base}`;
};

interface ResolveContext {
  ingredients: Map<string, RecipeIngredient>;
  recipes: Map<string, Recipe>;
  /** Memoized per-base-unit cost of prep recipes. */
  memo: Map<string, number>;
  /** Recipe ids on the current resolution path, for cycle detection. */
  visiting: Set<string>;
  /**
   * Problems found while resolving NESTED prep recipes. Those passes only
   * contribute a number to their caller, so without this their line-level
   * errors would vanish and a broken sub-recipe would read as a cost of zero.
   */
  nestedErrors: string[];
}

/**
 * Per-base-unit cost of a prep recipe: batch cost / batch yield.
 *
 * Recursive — a sauce can contain another sauce. `visiting` breaks cycles so a
 * recipe that (directly or transitively) contains itself returns 0 with an
 * error rather than blowing the stack.
 */
const prepCostPerBaseUnit = (recipeId: string, ctx: ResolveContext): number => {
  const cached = ctx.memo.get(recipeId);
  if (cached !== undefined) return cached;

  const recipe = ctx.recipes.get(recipeId);
  if (!recipe) return 0;
  if (ctx.visiting.has(recipeId)) return 0; // cycle — caller reports it

  const yieldBase = toBaseQuantity(recipe.yieldSize || 0, recipe.yieldUnit || 'g');
  if (yieldBase <= 0) {
    ctx.memo.set(recipeId, 0);
    return 0;
  }

  ctx.visiting.add(recipeId);
  const batch = costComponents(recipe.components, ctx);
  ctx.visiting.delete(recipeId);

  for (const line of batch.lines) {
    if (line.error) ctx.nestedErrors.push(`${recipe.name} → ${line.name}: ${line.error}`);
  }

  const perUnit = batch.total / yieldBase;
  ctx.memo.set(recipeId, perUnit);
  return perUnit;
};

const costComponents = (
  components: RecipeComponent[],
  ctx: ResolveContext,
): { lines: CostedLine[]; total: number } => {
  const lines: CostedLine[] = [];
  let total = 0;

  for (const c of components) {
    const line: CostedLine = {
      refType: c.refType,
      refId: c.refId,
      name: c.refName,
      quantity: c.quantity,
      unit: c.unit,
      costPerBaseUnit: 0,
      lineCost: 0,
    };

    if (c.refType === 'ingredient') {
      const ing = ctx.ingredients.get(c.refId);
      if (!ing) {
        line.error = 'Ingredient no longer exists';
      } else if (dimensionOf(ing.purchaseUnit) !== dimensionOf(c.unit)) {
        line.error = `Cannot measure ${ing.name} in ${c.unit} — it is bought by ${ing.purchaseUnit}`;
      } else {
        line.name = ing.name;
        line.costPerBaseUnit = ingredientCostPerBaseUnit(ing);
        line.lineCost = toBaseQuantity(c.quantity, c.unit) * line.costPerBaseUnit;
      }
    } else {
      const sub = ctx.recipes.get(c.refId);
      if (!sub) {
        line.error = 'Prep recipe no longer exists';
      } else if (ctx.visiting.has(c.refId)) {
        line.error = `Circular reference — ${sub.name} contains itself`;
      } else if (!sub.yieldSize || !sub.yieldUnit) {
        line.error = `${sub.name} has no batch yield, so a per-unit cost cannot be derived`;
      } else if (dimensionOf(sub.yieldUnit) !== dimensionOf(c.unit)) {
        line.error = `Cannot measure ${sub.name} in ${c.unit} — its batch yields ${sub.yieldUnit}`;
      } else {
        line.name = sub.name;
        line.costPerBaseUnit = prepCostPerBaseUnit(c.refId, ctx);
        line.lineCost = toBaseQuantity(c.quantity, c.unit) * line.costPerBaseUnit;
      }
    }

    total += line.lineCost;
    lines.push(line);
  }

  return { lines, total };
};

/**
 * Cost a single recipe against the current ingredient and recipe books.
 * Pure — pass the arrays in, get numbers out, nothing is fetched or written.
 */
export const costRecipe = (
  recipe: Recipe,
  ingredients: RecipeIngredient[],
  recipes: Recipe[],
  /**
   * Menu prices, keyed by uppercased item name. Authoritative when it has an
   * entry: a price raised on the Menu Prices page must move every food cost %
   * immediately, which a copy stored on the recipe could never do.
   * `recipe.sellPrice` is the fallback for recipes saved before that page.
   */
  priceByName?: Record<string, number>,
): CostedRecipe => {
  const ctx: ResolveContext = {
    ingredients: new Map(ingredients.filter(i => i.id).map(i => [i.id!, i])),
    recipes: new Map(recipes.filter(r => r.id).map(r => [r.id!, r])),
    memo: new Map(),
    visiting: new Set(recipe.id ? [recipe.id] : []),
    nestedErrors: [],
  };

  const { lines, total } = costComponents(recipe.components, ctx);
  const errors = Array.from(new Set([
    ...lines.filter(l => l.error).map(l => `${l.name}: ${l.error}`),
    ...ctx.nestedErrors,
  ]));

  const result: CostedRecipe = {
    recipeId: recipe.id || '',
    name: recipe.name,
    lines,
    totalCost: total,
    errors,
  };

  const sellPrice = priceByName?.[recipe.name.trim().toUpperCase()] ?? recipe.sellPrice;
  if (recipe.kind === 'menu' && sellPrice && sellPrice > 0) {
    result.sellPrice = sellPrice;
    result.profit = sellPrice - total;
    result.marginPct = (result.profit / sellPrice) * 100;
    result.foodCostPct = (total / sellPrice) * 100;
  }

  if (recipe.kind === 'prep') {
    const yieldBase = toBaseQuantity(recipe.yieldSize || 0, recipe.yieldUnit || 'g');
    if (yieldBase > 0) result.costPerYieldBaseUnit = total / yieldBase;
  }

  return result;
};

/** Cost every recipe in one pass, sharing the lookup maps. */
export const costAll = (
  recipes: Recipe[],
  ingredients: RecipeIngredient[],
  priceByName?: Record<string, number>,
): Map<string, CostedRecipe> => {
  const out = new Map<string, CostedRecipe>();
  for (const r of recipes) {
    if (!r.id) continue;
    out.set(r.id, costRecipe(r, ingredients, recipes, priceByName));
  }
  return out;
};

/**
 * Every recipe that uses a given ingredient, directly or through a prep
 * recipe. This is the question a spreadsheet cannot answer: "milk went up,
 * what moves?"
 */
export const recipesUsingIngredient = (
  ingredientId: string,
  recipes: Recipe[],
): Recipe[] => {
  const byId = new Map(recipes.filter(r => r.id).map(r => [r.id!, r]));

  const uses = (recipe: Recipe, seen: Set<string>): boolean => {
    if (recipe.id && seen.has(recipe.id)) return false;
    if (recipe.id) seen.add(recipe.id);
    return recipe.components.some(c => {
      if (c.refType === 'ingredient') return c.refId === ingredientId;
      const sub = byId.get(c.refId);
      return sub ? uses(sub, seen) : false;
    });
  };

  return recipes.filter(r => uses(r, new Set()));
};

// ---------------------------------------------------------------------------
// Paste import
//
// Recipes arrive as tab-separated blocks copied straight out of a spreadsheet:
//
//   Ingredients          quantity used  unit  purchase unit  unit price  Cost
//   Purple cabbage       23             gm    Kg             200         4.6
//   ...
//                                             TOTAL                      115.921
//
// "purchase unit" is the pack the price refers to — a word (Kg, litre) or a
// bare number (750, 24). "unit price" is the price of that whole pack.
// ---------------------------------------------------------------------------

export interface ParsedRow {
  name: string;
  quantity: number;
  unit: MeasureUnit;
  purchaseSize: number;
  purchaseUnit: MeasureUnit;
  purchasePrice: number;
  /** The cost the source sheet claimed, when present — used to verify. */
  statedCost?: number;
  /** What our own arithmetic gives. */
  computedCost: number;
}

export interface ParseResult {
  rows: ParsedRow[];
  /** Rows we could not read at all, with the reason. */
  skipped: { line: string; reason: string }[];
  /** TOTAL row from the source, if it had one. */
  statedTotal?: number;
  computedTotal: number;
  /** Rows whose stated cost disagrees with the arithmetic by >1 paisa. */
  mismatches: { name: string; stated: number; computed: number }[];
}

const UNIT_ALIASES: Record<string, MeasureUnit> = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', mls: 'ml', millilitre: 'ml', milliliter: 'ml',
  l: 'l', lt: 'l', ltr: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  pc: 'pc', pcs: 'pc', piece: 'pc', pieces: 'pc', nos: 'pc', no: 'pc',
  unit: 'pc', units: 'pc', portion: 'pc', portions: 'pc', each: 'pc',
};

const normalizeUnit = (raw: string): MeasureUnit | null =>
  UNIT_ALIASES[raw.trim().toLowerCase().replace(/[.\s]/g, '')] ?? null;

const toNumber = (raw: string): number | null => {
  const cleaned = raw.replace(/[₹,\s]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/**
 * Resolve the "purchase unit" column into a pack size + unit.
 *
 * A word means one of that unit ("Kg" → 1 kg). A bare number means that many
 * of the USED unit ("750" against a row measured in ml → 750 ml), which is how
 * the source sheets express odd pack sizes like a 750 ml bottle or a 24-egg
 * tray.
 */
const resolvePurchasePack = (
  raw: string,
  usedUnit: MeasureUnit,
): { size: number; unit: MeasureUnit } | null => {
  const asUnit = normalizeUnit(raw);
  if (asUnit) return { size: 1, unit: asUnit };
  const asNumber = toNumber(raw);
  if (asNumber && asNumber > 0) return { size: asNumber, unit: usedUnit };
  return null;
};

const splitCells = (line: string): string[] =>
  (line.includes('\t') ? line.split('\t') : line.split(/\s{2,}|\s*\|\s*/))
    .map(c => c.trim());

/**
 * Parse a pasted recipe block. Header rows, blank rows and the TOTAL row are
 * recognized and set aside; everything else is expected to be an ingredient.
 */
export const parseRecipePaste = (text: string): ParseResult => {
  const rows: ParsedRow[] = [];
  const skipped: { line: string; reason: string }[] = [];
  const mismatches: { name: string; stated: number; computed: number }[] = [];
  let statedTotal: number | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const cells = splitCells(line).filter((c, i, arr) =>
      // drop trailing empties, keep interior ones so column positions hold
      c !== '' || i < arr.length - 1
    );
    if (cells.length === 0) continue;

    const first = cells[0].toLowerCase();

    // TOTAL row — the label can sit in any column, the number is the last one.
    if (cells.some(c => /^total$/i.test(c.trim()))) {
      const nums = cells.map(toNumber).filter((n): n is number => n !== null);
      if (nums.length) statedTotal = nums[nums.length - 1];
      continue;
    }

    // Header rows and the recipe-title row.
    if (/^(ingredient|indgredient|ingriedient)/i.test(first)) continue;
    if (cells.filter(c => c).length < 4) continue;

    const [name, qtyRaw, unitRaw, packRaw, priceRaw, costRaw] = cells;

    if (!name) { skipped.push({ line, reason: 'no ingredient name' }); continue; }

    const quantity = toNumber(qtyRaw ?? '');
    if (quantity === null || quantity <= 0) {
      skipped.push({ line, reason: 'quantity is not a number' });
      continue;
    }

    const unit = normalizeUnit(unitRaw ?? '');
    if (!unit) {
      skipped.push({ line, reason: `unrecognized unit "${unitRaw}"` });
      continue;
    }

    const pack = resolvePurchasePack(packRaw ?? '', unit);
    if (!pack) {
      skipped.push({ line, reason: `unrecognized purchase unit "${packRaw}"` });
      continue;
    }
    if (MEASURE_UNITS[pack.unit].dimension !== MEASURE_UNITS[unit].dimension) {
      skipped.push({ line, reason: `${unit} cannot be measured against a ${pack.unit} pack` });
      continue;
    }

    const purchasePrice = toNumber(priceRaw ?? '');
    if (purchasePrice === null || purchasePrice <= 0) {
      skipped.push({ line, reason: 'unit price is not a number' });
      continue;
    }

    const packBase = toBaseQuantity(pack.size, pack.unit);
    const computedCost = (toBaseQuantity(quantity, unit) / packBase) * purchasePrice;
    const statedCost = toNumber(costRaw ?? '') ?? undefined;

    if (statedCost !== undefined && Math.abs(statedCost - computedCost) > 0.01) {
      mismatches.push({ name: name.trim(), stated: statedCost, computed: computedCost });
    }

    rows.push({
      name: name.trim(),
      quantity,
      unit,
      purchaseSize: pack.size,
      purchaseUnit: pack.unit,
      purchasePrice,
      statedCost,
      computedCost,
    });
  }

  return {
    rows,
    skipped,
    statedTotal,
    computedTotal: rows.reduce((s, r) => s + r.computedCost, 0),
    mismatches,
  };
};

/** Case- and whitespace-insensitive key for matching ingredient names. */
export const nameKey = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/g, ' ');
