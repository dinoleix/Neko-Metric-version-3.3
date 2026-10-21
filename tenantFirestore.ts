/**
 * Tenant-aware Firestore boundary for the isolated multi-tenant build.
 *
 * Production uses the same Firebase SDK calls when no tenant scope is active.
 * In tenant mode, reads are constrained by tenantId and new/updated documents
 * inherit the active tenant ID. Firestore rules remain the security boundary.
 */
import * as firestore from 'firebase/firestore';
import type { CollectionReference, DocumentReference, Query, QueryConstraint, SetOptions } from 'firebase/firestore';

export * from 'firebase/firestore';

export type TenantFirestoreScope = {
  tenantId: string;
  userId: string;
  ownerUserId: string;
  role: 'owner' | 'manager' | 'crew' | 'viewer';
  outletIds: string[];
};

let activeScope: TenantFirestoreScope | null = null;
const scopedQueries = new WeakSet<object>();

/** Called only by the isolated app after resolving a signed-in tenant membership. */
export function setTenantFirestoreScope(scope: TenantFirestoreScope | null): void {
  activeScope = scope ? { ...scope, outletIds: [...scope.outletIds] } : null;
}

export function getTenantFirestoreScope(): TenantFirestoreScope | null {
  return activeScope ? { ...activeScope, outletIds: [...activeScope.outletIds] } : null;
}

// Every business collection used by NekoMetrics is listed here. Identity and
// platform collections intentionally stay outside the tenant data wrapper.
const TENANT_COLLECTIONS = new Set([
  'bank_accounts', 'bank_statement_imports', 'bank_transactions', 'bill_counters',
  'cash_flow_snapshots', 'cash_obligations', 'categorization_rules', 'category_settings', 'customer_name_mappings',
  'cogs_adjustments', 'crew_categories', 'crew_entries', 'daily_sales_logs',
  'employees', 'events', 'expense_snapshots', 'expenses', 'fc_ingredients', 'fc_recipes',
  'files', 'holidays', 'ingredient_controls', 'ingredient_movements', 'inventory_counts',
  'inventory_items', 'item_costs', 'item_sales', 'item_snapshots', 'loan_profiles',
  'login_activity', 'loyalty_campaign_drafts', 'loyalty_customers', 'loyalty_imports',
  'loyalty_opening_balances', 'menu_normalization', 'menu_prices', 'monthly_payrolls',
  'online_customers', 'online_order_details', 'pnl_snapshots', 'products', 'purchases',
  'rentals', 'sales_analytics', 'sales_ledger', 'sales_snapshots', 'sales_summary',
  'serving_options', 'sku_mappings', 'tenant_settings', 'tenant_test_records', 'user_mappings', 'user_groups',
  'vendors', 'waste_entries', 'weather',
]);

function collectionPath(source: unknown): string | null {
  const value = source as any;
  if (typeof value?.path === 'string') return value.path;
  const segments = value?._query?.path?.segments;
  return Array.isArray(segments) ? segments.join('/') : null;
}

function isTenantCollection(source: unknown): boolean {
  const path = collectionPath(source);
  if (!path) return false;
  const parts = path.split('/');
  // Collection paths have an odd segment count; document paths are even.
  const collectionName = parts.length % 2 === 1 ? parts[parts.length - 1] : parts[parts.length - 2];
  return TENANT_COLLECTIONS.has(collectionName);
}

function scopeReadSource<T>(source: Query<T> | CollectionReference<T>): Query<T> | CollectionReference<T> {
  const sourceType = (source as any).type;
  if (!activeScope || (sourceType !== 'query' && sourceType !== 'collection') || !isTenantCollection(source) || scopedQueries.has(source as object)) return source;
  // Calling the raw SDK function avoids recursing back through this wrapper.
  const scoped = firestore.query(source as Query<T>, firestore.where('tenantId', '==', activeScope.tenantId));
  scopedQueries.add(scoped);
  return scoped;
}

function hasTenantFilter(constraints: QueryConstraint[]): boolean {
  return constraints.some(constraint => {
    const field = (constraint as any)?._field;
    return (constraint as any)?.type === 'where'
      && (field?.segments?.length === 1 && field.segments[0] === 'tenantId');
  });
}

function tenantPayload<T extends Record<string, unknown>>(reference: DocumentReference, data: T): T | (T & { tenantId: string }) {
  if (!activeScope || !isTenantCollection(reference)) return data;
  const existingTenantId = (data as Record<string, unknown>).tenantId;
  return {
    ...data,
    tenantId: typeof existingTenantId === 'string' ? existingTenantId : activeScope.tenantId,
  };
}

function tenantSetOptions(options?: SetOptions): SetOptions | undefined {
  if (!activeScope || !options || !('mergeFields' in options)) return options;
  if (options.mergeFields.some(field => (typeof field === 'string' ? field : field.toString()) === 'tenantId')) return options;
  return { ...options, mergeFields: [...options.mergeFields, 'tenantId'] };
}

export const query: typeof firestore.query = ((source: any, ...constraints: QueryConstraint[]) => {
  const shouldScope = activeScope && isTenantCollection(source) && !scopedQueries.has(source) && !hasTenantFilter(constraints);
  const result = firestore.query(source, ...constraints, ...(shouldScope
    ? [firestore.where('tenantId', '==', activeScope!.tenantId)]
    : []));
  if (activeScope && isTenantCollection(source) && (shouldScope || scopedQueries.has(source) || hasTenantFilter(constraints))) {
    scopedQueries.add(result);
  }
  return result;
}) as typeof firestore.query;

export const getDocs: typeof firestore.getDocs = ((source: any) =>
  firestore.getDocs(scopeReadSource(source))) as typeof firestore.getDocs;

export const getDocsFromCache: typeof firestore.getDocsFromCache = ((source: any) =>
  firestore.getDocsFromCache(scopeReadSource(source))) as typeof firestore.getDocsFromCache;

export const getDocsFromServer: typeof firestore.getDocsFromServer = ((source: any) =>
  firestore.getDocsFromServer(scopeReadSource(source))) as typeof firestore.getDocsFromServer;

export const getCountFromServer: typeof firestore.getCountFromServer = ((source: any) =>
  firestore.getCountFromServer(scopeReadSource(source))) as typeof firestore.getCountFromServer;

export const onSnapshot: typeof firestore.onSnapshot = ((source: any, ...args: any[]) =>
  (firestore.onSnapshot as any)(scopeReadSource(source), ...args)) as typeof firestore.onSnapshot;

export const addDoc: typeof firestore.addDoc = ((reference: any, data: any) =>
  firestore.addDoc(reference, tenantPayload(reference, data))) as typeof firestore.addDoc;

export const setDoc: typeof firestore.setDoc = ((reference: any, data: any, options?: SetOptions) =>
  firestore.setDoc(reference, tenantPayload(reference, data), tenantSetOptions(options))) as typeof firestore.setDoc;

export const updateDoc: typeof firestore.updateDoc = ((reference: any, data: any) =>
  firestore.updateDoc(reference, tenantPayload(reference, data))) as typeof firestore.updateDoc;

export const writeBatch: typeof firestore.writeBatch = ((db: any) => {
  const batch = firestore.writeBatch(db);
  return new Proxy(batch, {
    get(target, property) {
      if (property === 'set') return (reference: any, data: any, options?: SetOptions) =>
        target.set(reference, tenantPayload(reference, data) as any, tenantSetOptions(options));
      if (property === 'update') return (reference: any, data: any) =>
        target.update(reference, tenantPayload(reference, data) as any);
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as typeof batch;
}) as typeof firestore.writeBatch;

export const runTransaction: typeof firestore.runTransaction = ((db: any, updateFunction: any, options?: any) =>
  firestore.runTransaction(db, (transaction: any) => updateFunction(new Proxy(transaction, {
    get(target, property) {
      if (property === 'set') return (reference: any, data: any, setOptions?: SetOptions) =>
        target.set(reference, tenantPayload(reference, data) as any, tenantSetOptions(setOptions));
      if (property === 'update') return (reference: any, data: any) =>
        target.update(reference, tenantPayload(reference, data) as any);
      if (property === 'get') return (reference: any) => target.get(scopeReadSource(reference));
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  })), options)) as typeof firestore.runTransaction;
