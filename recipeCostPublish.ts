// ---------------------------------------------------------------------------
// Publishing recipe costs into item_costs.
//
// The one link between Recipe Costing and the P&L side, and it runs one way:
// a menu recipe's computed cost becomes `item_costs.costPerUnit`. Packaging is
// never touched — `tier1ServingsCost` / `tier2ServingsCost` stay the sole home
// of it, because packaging varies by store tier and a recipe has no tier.
//
// Split into a pure planner and a thin writer, the same shape as
// crewSnapshotService — which was split for exactly this reason after two
// duplicated copies of its aggregation drifted apart.
// ---------------------------------------------------------------------------

import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from './firebase';
import { invalidateCached } from './referenceCache';
import { Recipe, RecipeIngredient, ItemCost } from './types';
import { costAll } from './foodCostService';

/**
 * Document id for an item's cost record.
 *
 * NOT injective — punctuation collapses, so "CHIK-1" and "CHIK 1" both land on
 * CHIK_1. That is pre-existing and live documents depend on it, so the formula
 * stays; `buildPublishPlan` detects the collision and refuses to publish either
 * side rather than letting one silently overwrite the other.
 */
export const itemCostDocId = (dataOwnerId: string, itemName: string) =>
  `${dataOwnerId}_cost_${itemName.trim().toUpperCase().replace(/[^a-zA-Z0-9]/g, '_')}`;

/** Below this, a change isn't worth a write or a row in the preview. */
const EPSILON = 0.005;

/**
 * Names that look like packaging regardless of how they're categorised.
 *
 * Advisory only. Ingredient categories can't be trusted for this — the paste
 * importer files everything under 'Other' — so instead of classifying by
 * category we flag by name and let the user judge. This never changes the
 * published number; it only makes a bowl sitting inside a recipe visible.
 */
const PACKAGING_NAME = /\b(bowl|lid|box|cutlery|spoon|fork|napkin|tissue|bag|container|cup|straw|sleeve|wrap|carton|clamshell|tray|pouch|sticker|label)\b/i;

const PACKAGING_CATEGORY = 'Disposables & Packaging';

/** True when this ingredient looks like packaging, by category or by name. */
export const looksLikePackaging = (ing: RecipeIngredient): boolean =>
  ing.category?.trim().toLowerCase() === PACKAGING_CATEGORY.toLowerCase() ||
  PACKAGING_NAME.test(ing.name || '');

export type PublishStatus = 'new' | 'changed' | 'unchanged' | 'blocked';

export interface PublishRow {
  /** Uppercased master name — the item_costs key. */
  itemName: string;
  recipeId: string;
  recipeName: string;
  /** Current costPerUnit, or null when the item has no cost record yet. */
  oldCost: number | null;
  newCost: number;
  delta: number;
  status: PublishStatus;
  /** Why this row cannot be published. Always set when status is 'blocked'. */
  blockReason?: string;
  /** Ingredient names that look like packaging. Advisory — see above. */
  suspectedPackaging: string[];
}

export interface PublishPlan {
  rows: PublishRow[];
  /** The sold-item list was unavailable, so name checking was skipped. */
  masterListMissing: boolean;
  publishable: PublishRow[];
  blocked: PublishRow[];
  unchanged: PublishRow[];
  flagged: PublishRow[];
}

/**
 * Work out what publishing would do, without doing any of it.
 *
 * Pure — everything it needs is already in the Recipe Costing page's state, so
 * building a preview costs no reads.
 */
export function buildPublishPlan(
  recipes: Recipe[],
  ingredients: RecipeIngredient[],
  existingCosts: ItemCost[],
  knownMasterNames: string[],
  dataOwnerId: string,
): PublishPlan {
  const costs = costAll(recipes, ingredients);
  const ingById = new Map(ingredients.filter(i => i.id).map(i => [i.id!, i]));

  const costByName = new Map(
    existingCosts.map(c => [(c.itemName || '').trim().toUpperCase(), c]),
  );
  const knownNames = new Set(knownMasterNames.map(n => n.trim().toUpperCase()));

  const menuRecipes = recipes.filter(r => r.kind === 'menu' && r.id);

  // Two recipes can carry the same name (fc_recipes has no uniqueness
  // constraint), and two different names can collapse onto one document id.
  // Either way there is no principled winner, so both sides are blocked.
  const nameCount = new Map<string, number>();
  const docIdCount = new Map<string, number>();
  menuRecipes.forEach(r => {
    const key = r.name.trim().toUpperCase();
    nameCount.set(key, (nameCount.get(key) || 0) + 1);
    const id = itemCostDocId(dataOwnerId, r.name);
    docIdCount.set(id, (docIdCount.get(id) || 0) + 1);
  });

  const rows: PublishRow[] = menuRecipes.map(r => {
    const itemName = r.name.trim().toUpperCase();
    const costed = costs.get(r.id!);
    const existing = costByName.get(itemName);
    const oldCost = existing ? Number(existing.costPerUnit) || 0 : null;
    const newCost = costed?.totalCost ?? 0;

    const row: PublishRow = {
      itemName,
      recipeId: r.id!,
      recipeName: r.name,
      oldCost,
      newCost,
      delta: newCost - (oldCost ?? 0),
      status: 'new',
      suspectedPackaging: collectSuspectedPackaging(r, recipes, ingById),
    };

    // An uncostable line contributes 0 and still yields a plausible-looking
    // total, so errors — not the number — are the trust signal. Publishing a
    // partial cost understates COGS and overstates profit, silently.
    if (costed?.errors.length) {
      return { ...row, status: 'blocked', blockReason: costed.errors.join('; ') };
    }
    if (newCost <= 0) {
      return { ...row, status: 'blocked', blockReason: 'Computes to ₹0 — nothing to publish.' };
    }
    // Only enforceable when we actually have the master list. An empty one means
    // the sold-item lookup failed or no sales are loaded — blocking every recipe
    // on that basis would blame the recipes for a missing input.
    if (knownNames.size > 0 && !knownNames.has(itemName)) {
      return {
        ...row, status: 'blocked',
        blockReason: 'No sold item is named exactly this, so the cost record would be read by nothing. Re-pick the name from the dropdown in the recipe.',
      };
    }
    if ((nameCount.get(itemName) || 0) > 1) {
      return {
        ...row, status: 'blocked',
        blockReason: `${nameCount.get(itemName)} recipes share this name — delete or rename all but one.`,
      };
    }
    const docId = itemCostDocId(dataOwnerId, r.name);
    if ((docIdCount.get(docId) || 0) > 1) {
      return {
        ...row, status: 'blocked',
        blockReason: 'Another recipe’s name differs only by punctuation, so both map to one cost record.',
      };
    }

    if (oldCost === null) return { ...row, status: 'new' };
    return { ...row, status: Math.abs(row.delta) < EPSILON ? 'unchanged' : 'changed' };
  });

  rows.sort((a, b) => a.itemName.localeCompare(b.itemName));

  return {
    rows,
    masterListMissing: knownNames.size === 0,
    publishable: rows.filter(r => r.status === 'new' || r.status === 'changed'),
    blocked: rows.filter(r => r.status === 'blocked'),
    unchanged: rows.filter(r => r.status === 'unchanged'),
    flagged: rows.filter(r => r.suspectedPackaging.length > 0),
  };
}

/**
 * Packaging-looking ingredients anywhere in a recipe, including inside the prep
 * batches it uses. Walks transitively because a sauce's own components are
 * collapsed to a scalar by the time the parent sees them.
 */
function collectSuspectedPackaging(
  recipe: Recipe,
  allRecipes: Recipe[],
  ingById: Map<string, RecipeIngredient>,
): string[] {
  const byId = new Map(allRecipes.filter(r => r.id).map(r => [r.id!, r]));
  const found = new Set<string>();
  const seen = new Set<string>();

  const walk = (r: Recipe) => {
    if (r.id) {
      if (seen.has(r.id)) return; // cycles are reported by the coster, not here
      seen.add(r.id);
    }
    for (const c of r.components) {
      if (c.refType === 'ingredient') {
        const ing = ingById.get(c.refId);
        if (ing && looksLikePackaging(ing)) found.add(ing.name);
      } else {
        const sub = byId.get(c.refId);
        if (sub) walk(sub);
      }
    }
  };

  walk(recipe);
  return Array.from(found).sort();
}

/**
 * Write the selected rows to item_costs.
 *
 * Only costPerUnit and provenance are in the payload — the tier fields are
 * absent, so `merge: true` guarantees packaging is untouched rather than
 * relying on reading and rewriting it. Idempotent: the id derives from the
 * name and the value is overwritten, never incremented.
 */
export async function publishRecipeCosts(
  dataOwnerId: string,
  rows: PublishRow[],
): Promise<number> {
  const writable = rows.filter(r => r.status === 'new' || r.status === 'changed');
  if (!writable.length) return 0;

  const now = Date.now();
  for (let i = 0; i < writable.length; i += 400) {
    const batch = writeBatch(db);
    writable.slice(i, i + 400).forEach(r => {
      // dataOwnerId, not the editor's uid — every reader queries by dataOwnerId,
      // so writing the editor's uid lands the doc where nobody looks.
      batch.set(doc(collection(db, 'item_costs'), itemCostDocId(dataOwnerId, r.itemName)), {
        userId: dataOwnerId,
        itemName: r.itemName,
        costPerUnit: r.newCost,
        costSource: 'recipe',
        recipeId: r.recipeId,
        recipeName: r.recipeName,
        recipePublishedAt: now,
        updatedAt: now,
      }, { merge: true });
    });
    await batch.commit();
  }

  invalidateCached('item_costs', dataOwnerId);
  return writable.length;
}

/** Hand an item back to manual editing, leaving its cost value in place. */
export async function unlinkRecipeCost(dataOwnerId: string, itemName: string): Promise<void> {
  const batch = writeBatch(db);
  batch.set(doc(collection(db, 'item_costs'), itemCostDocId(dataOwnerId, itemName)), {
    costSource: 'manual',
    recipeId: '',
    recipeName: '',
    updatedAt: Date.now(),
  }, { merge: true });
  await batch.commit();
  invalidateCached('item_costs', dataOwnerId);
}
