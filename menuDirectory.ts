// ---------------------------------------------------------------------------
// Read-only directory of sold menu items, for modules (like Recipe Costing)
// that need to name things consistently with what's actually sold, without
// pulling costs or P&L into their own aggregation.
//
// Mirrors the master-name canonicalization CategorySettings.tsx uses (source
// name -> menu_normalization -> uppercased master name), kept as one function
// so both call sites stay in sync instead of drifting apart.
// ---------------------------------------------------------------------------

import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { getCachedCollection } from './referenceCache';
import { ItemMonthlySnapshot, SkuMapping, MenuNormalization, MenuPrice, CategorySettings as CategorySettingsType } from './types';

export interface MenuDirectory {
  /** Canonical (normalized, uppercased) name of every item ever sold. */
  names: string[];
  /** Segment labels configured in Category Settings (e.g. "Poke Bowls"). */
  segments: string[];
  /** Master item name -> configured segment, where one is known. */
  segmentByName: Record<string, string>;
  /** Uppercased master item name -> stated menu price, where one is recorded. */
  priceByName: Record<string, number>;
}

/**
 * The directory as it stands before a load, and after one that failed. Shared
 * so a caller can't hand-roll a partial literal — every field here is read
 * unguarded downstream, and a missing one is a TypeError, not a blank screen.
 */
export const EMPTY_MENU_DIRECTORY: MenuDirectory = {
  names: [],
  segments: [],
  segmentByName: {},
  priceByName: {},
};

export async function getMenuDirectory(dataOwnerId: string): Promise<MenuDirectory> {
  const [itemSnaps, skuMaps, normDocs, priceDocs, settingsSnap] = await Promise.all([
    getCachedCollection<ItemMonthlySnapshot>('item_snapshots', dataOwnerId, 'userId'),
    getCachedCollection<SkuMapping>('sku_mappings', dataOwnerId, 'userId'),
    getCachedCollection<MenuNormalization>('menu_normalization', dataOwnerId, 'userId'),
    getCachedCollection<MenuPrice>('menu_prices', dataOwnerId, 'userId'),
    getDoc(doc(db, 'category_settings', dataOwnerId)),
  ]);

  const normMap: Record<string, string> = {};
  normDocs.forEach(d => {
    const key = (d.sourceName || '').trim().toUpperCase();
    if (key) normMap[key] = d.masterName;
  });

  const rawNames = new Set<string>();
  itemSnaps.forEach(snap => {
    Object.keys(snap.items || {}).forEach(name => {
      const clean = name.trim();
      if (clean && !/total|summary|count|grand/i.test(clean)) rawNames.add(clean);
    });
  });

  // Dedup by uppercase key (matching CategorySettings' canonicalization), but
  // keep the first-seen original casing for display — Recipe Costing doesn't
  // uppercase-transform names the way CategorySettings' table does.
  const displayByKey: Record<string, string> = {};
  rawNames.forEach(s => {
    const master = (normMap[s.toUpperCase()] || s).trim();
    const key = master.toUpperCase();
    if (key && !displayByKey[key]) displayByKey[key] = master;
  });

  const segmentByName: Record<string, string> = {};
  skuMaps
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .forEach(m => {
      const key = (m.itemName || '').trim().toUpperCase();
      if (key && m.segment && !segmentByName[key]) segmentByName[key] = m.segment;
    });

  const priceByName: Record<string, number> = {};
  priceDocs
    .slice()
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .forEach(p => {
      const key = (p.itemName || '').trim().toUpperCase();
      if (key && p.price > 0 && priceByName[key] === undefined) priceByName[key] = p.price;
    });

  const settingsData = settingsSnap.exists() ? (settingsSnap.data() as CategorySettingsType) : undefined;
  const segments = Array.from(new Set((settingsData?.menuSegments || []).filter(Boolean))).sort();

  return {
    names: Object.values(displayByKey).sort(),
    segments,
    segmentByName,
    priceByName,
  };
}
