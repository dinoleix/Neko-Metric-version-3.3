import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from './firebase';

// Session-level cache for slow-changing reference collections (rentals, item_costs,
// sku_mappings, menu_normalization, serving_options, employees, monthly_payrolls).
// These are re-fetched identically by many tabs; caching them means switching tabs
// costs zero Firestore reads until the TTL lapses or a writer invalidates.
const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { at: number; promise: Promise<any[]> }>();

export function getCachedCollection<T = any>(coll: string, ownerId: string, field: 'userId' | 'ownerId' = 'userId'): Promise<T[]> {
  const key = `${coll}:${ownerId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise as Promise<T[]>;

  const promise = getDocs(query(collection(db, coll), where(field, '==', ownerId)))
    .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })))
    .catch(err => {
      // Don't cache failures — next caller retries
      cache.delete(key);
      throw err;
    });
  cache.set(key, { at: Date.now(), promise });
  return promise as Promise<T[]>;
}

// Call after writing to a cached collection so the next read is fresh.
export function invalidateCached(coll: string, ownerId?: string) {
  const prefix = ownerId ? `${coll}:${ownerId}` : `${coll}:`;
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
