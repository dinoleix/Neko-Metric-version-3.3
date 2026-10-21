#!/usr/bin/env node
/**
 * Safe, emulator-only synthetic rehearsal of the additive tenant migration.
 * This is not the production migration job. It refuses to run without the
 * exact demo project and a local Firestore emulator endpoint.
 */
import { createHash } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-neko-migration-rehearsal';
const TENANT_ID = 'tn_synthetic_green_neko';
const MIGRATION_VERSION = 'green-neko-rehearsal-v1';
const OUTLET_MAP = {
  'legacy-humayunpur': 'tn-synthetic-outlet-humayunpur',
  'legacy-b6-market': 'tn-synthetic-outlet-b6-market',
};

if (!process.env.FIRESTORE_EMULATOR_HOST || process.env.GCLOUD_PROJECT !== PROJECT_ID) {
  throw new Error(`Refusing to run outside Firestore emulator project ${PROJECT_ID}.`);
}

const app = initializeApp({ projectId: PROJECT_ID });
const db = getFirestore(app);
const records = [
  { collection: 'sales_summary', id: 'sale-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', date: '2026-09-01', totalRevenue: 1250 } },
  { collection: 'sales_summary', id: 'sale-002', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-b6-market', date: '2026-09-01', totalRevenue: 875 } },
  { collection: 'expenses', id: 'expense-001', data: { userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', date: '2026-09-01', amount: 220 } },
  { collection: 'purchases', id: 'purchase-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-b6-market', date: '2026-09-01', vendor: 'Synthetic Produce', amount: 430 } },
  { collection: 'daily_sales_logs', id: 'daily-sales-001', data: { ownerId: 'legacy-green-owner', userId: 'synthetic-crew', outletId: 'legacy-humayunpur', date: '2026-09-01', amount: 2450 } },
  { collection: 'item_sales', id: 'item-sales-001', data: { userId: 'legacy-green-owner', outletId: 'legacy-b6-market', date: '2026-09-01', itemName: 'Synthetic Bowl', totalRevenue: 560 } },
  { collection: 'online_order_details', id: 'online-order-001', data: { userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', date: '2026-09-01', platform: 'synthetic', amount: 310 } },
  { collection: 'inventory_counts', id: 'inventory-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-b6-market', date: '2026-09-01', closingValue: 640 } },
  { collection: 'bank_transactions', id: 'bank-transaction-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', date: '2026-09-01', amount: 430 } },
  { collection: 'sales_snapshots', id: 'sales-snapshot-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', month: 'September', year: 2026, totalRevenue: 2450 } },
  { collection: 'pnl_snapshots', id: 'pnl-snapshot-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', month: 'September', year: 2026, amount: 1980 } },
  { collection: 'monthly_payrolls', id: 'payroll-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', month: 'September', year: 2026, amount: 1250 } },
  { collection: 'fc_ingredients', id: 'ingredient-001', data: { ownerId: 'legacy-green-owner', name: 'Synthetic Rice', unit: 'kg', costPerUnit: 42 } },
  { collection: 'fc_recipes', id: 'recipe-001', data: { ownerId: 'legacy-green-owner', name: 'Synthetic Bowl', ingredients: [{ name: 'Rice', quantity: 1 }] } },
  { collection: 'loyalty_customers', id: 'loyalty-customer-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', customerId: 'synthetic-customer', points: 25 } },
  { collection: 'customer_name_mappings', id: 'customer-map-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', sourceName: 'Synthetic Guest', canonicalName: 'Guest 1' } },
  { collection: 'bank_statement_imports', id: 'bank-import-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-b6-market', date: '2026-09-01', amount: 430 } },
  { collection: 'files', id: 'file-metadata-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', name: 'Synthetic September Sales', type: 'sales', recordCount: 2 } },
  { collection: 'cash_flow_snapshots', id: 'cash-flow-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-humayunpur', month: 'September', year: 2026, amount: 300 } },
  // Unknown outlet must be reported instead of guessed or silently mapped.
  { collection: 'crew_entries', id: 'crew-unknown-outlet', data: { ownerId: 'legacy-green-owner', userId: 'synthetic-crew', outletId: 'legacy-unmapped', date: '2026-09-01', amount: 50 } },
];

const canonicalize = value => Array.isArray(value)
  ? value.map(canonicalize)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]))
    : value;
const checksum = value => createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
const sourcePath = collection => `rehearsal_source_${collection}`;
const targetPath = collection => `rehearsal_target_${collection}`;
const migratableCount = records.filter(record => !record.data.outletId || OUTLET_MAP[record.data.outletId]).length;
const exceptionCount = records.length - migratableCount;

async function seedSource() {
  const batch = db.batch();
  for (const record of records) {
    batch.set(db.collection(sourcePath(record.collection)).doc(record.id), record.data);
  }
  await batch.commit();
}

async function migrateOnce() {
  let migrated = 0;
  let skipped = 0;
  const exceptions = [];

  for (const record of records) {
    const source = await db.collection(sourcePath(record.collection)).doc(record.id).get();
    if (!source.exists) throw new Error(`Synthetic source disappeared: ${record.collection}/${record.id}`);
    const sourceData = source.data();
    const sourceChecksum = checksum(sourceData);
    const manifestRef = db.collection(`rehearsal_manifest_${MIGRATION_VERSION}`).doc(`${record.collection}_${record.id}`);
    const manifest = await manifestRef.get();
    const existing = manifest.exists ? manifest.data() : null;
    const outletId = sourceData.outletId ? OUTLET_MAP[sourceData.outletId] : undefined;
    if (sourceData.outletId && !outletId) {
      const attempts = (existing?.attemptCount || 0) + 1;
      await manifestRef.set({
        migrationVersion: MIGRATION_VERSION, sourceCollection: record.collection,
        sourceDocumentId: record.id, sourceChecksum, status: 'exception', attemptCount: attempts,
        exception: `No outlet mapping for ${sourceData.outletId}`, updatedAt: Date.now(),
      });
      exceptions.push({ collection: record.collection, documentId: record.id, reason: `No outlet mapping for ${sourceData.outletId}` });
      continue;
    }

    const targetData = {
      ...sourceData,
      tenantId: TENANT_ID,
      ...(outletId ? { outletId } : {}),
      migrationVersion: MIGRATION_VERSION,
    };
    const targetChecksum = checksum(targetData);
    const targetRef = db.collection(targetPath(record.collection)).doc(record.id);

    if (existing?.status === 'completed' && existing.sourceChecksum === sourceChecksum) {
      const target = await targetRef.get();
      if (!target.exists || existing.targetChecksum !== targetChecksum || checksum(target.data()) !== targetChecksum) {
        throw new Error(`Completed manifest target failed checksum verification: ${record.collection}/${record.id}`);
      }
      skipped += 1;
      continue;
    }

    const target = await targetRef.get();
    if (target.exists) {
      throw new Error(`Refusing to overwrite an untracked target: ${record.collection}/${record.id}`);
    }

    const batch = db.batch();
    batch.create(targetRef, targetData);
    batch.set(manifestRef, {
      migrationVersion: MIGRATION_VERSION, sourceCollection: record.collection,
      sourceDocumentId: record.id, sourceChecksum, targetChecksum, status: 'completed',
      attemptCount: (existing?.attemptCount || 0) + 1, completedAt: Date.now(),
    });
    await batch.commit();
    migrated += 1;
  }
  return { migrated, skipped, exceptions };
}

async function verifyTargetCollisionGuard() {
  const record = records[0];
  const targetRef = db.collection(targetPath(record.collection)).doc(record.id);
  await targetRef.create({ tenantId: 'collision-fixture', preserved: true });
  let refusal;
  try {
    await migrateOnce();
  } catch (error) {
    refusal = error;
  }
  const existing = await targetRef.get();
  const preserved = existing.exists
    && existing.data().tenantId === 'collision-fixture'
    && existing.data().preserved === true;
  await targetRef.delete();
  if (!String(refusal?.message || '').includes('Refusing to overwrite an untracked target') || !preserved) {
    throw new Error(`Target collision guard failed: ${refusal?.message || 'no refusal'}; preserved=${preserved}`);
  }
  return { refused: true, existingTargetPreserved: true };
}

async function verifyTargetChecksumGuard() {
  const record = records[0];
  const targetRef = db.collection(targetPath(record.collection)).doc(record.id);
  const original = await targetRef.get();
  if (!original.exists) throw new Error('Checksum guard fixture target is missing.');
  const originalData = original.data();
  await targetRef.update({ checksumProbe: 'tampered' });

  let refusal;
  try {
    await migrateOnce();
  } catch (error) {
    refusal = error;
  }
  const tampered = await targetRef.get();
  const tamperingPreserved = tampered.exists && tampered.data().checksumProbe === 'tampered';
  await targetRef.set(originalData);
  if (!String(refusal?.message || '').includes('target failed checksum verification') || !tamperingPreserved) {
    throw new Error(`Target checksum guard failed: ${refusal?.message || 'no refusal'}; tamperingPreserved=${tamperingPreserved}`);
  }
  return { tamperingDetected: true, targetNotRewritten: true };
}

async function reconcile() {
  const details = {};
  let totalExpected = 0;
  let totalMigrated = 0;
  for (const collection of new Set(records.map(record => record.collection))) {
    const sourceSnap = await db.collection(sourcePath(collection)).get();
    const targetSnap = await db.collection(targetPath(collection)).get();
    const collectionRecords = records.filter(record => record.collection === collection);
    const expectedDocs = sourceSnap.docs.filter(snapshot => !(snapshot.data().outletId && !OUTLET_MAP[snapshot.data().outletId]));
    const targetChecksumMismatchIds = [];
    const unexpectedTargetIds = [];
    const sourceChecksumMismatchIds = [];
    const expectedById = new Map(collectionRecords.map(record => [record.id, record]));

    for (const source of sourceSnap.docs) {
      const expectedSource = expectedById.get(source.id)?.data;
      if (!expectedSource || checksum(source.data()) !== checksum(expectedSource)) sourceChecksumMismatchIds.push(source.id);
    }
    for (const target of targetSnap.docs) {
      const source = expectedById.get(target.id);
      if (!source || (source.data.outletId && !OUTLET_MAP[source.data.outletId])) {
        unexpectedTargetIds.push(target.id);
        continue;
      }
      const mappedOutletId = source.data.outletId ? OUTLET_MAP[source.data.outletId] : undefined;
      const expectedTarget = {
        ...source.data,
        tenantId: TENANT_ID,
        ...(mappedOutletId ? { outletId: mappedOutletId } : {}),
        migrationVersion: MIGRATION_VERSION,
      };
      if (checksum(target.data()) !== checksum(expectedTarget)) targetChecksumMismatchIds.push(target.id);
    }

    const sourceTotal = expectedDocs.reduce((sum, snapshot) => sum + Number(snapshot.data().totalRevenue || snapshot.data().amount || snapshot.data().closingValue || 0), 0);
    const targetTotal = targetSnap.docs.reduce((sum, doc) => sum + Number(doc.data().totalRevenue || doc.data().amount || doc.data().closingValue || 0), 0);
    totalExpected += expectedDocs.length;
    totalMigrated += targetSnap.size;
    details[collection] = {
      sourceCount: sourceSnap.size,
      expectedMigratedCount: expectedDocs.length,
      targetCount: targetSnap.size,
      sourceAmountTotal: sourceTotal,
      targetAmountTotal: targetTotal,
      countDelta: targetSnap.size - expectedDocs.length,
      amountDelta: targetTotal - sourceTotal,
      targetChecksumMismatchIds,
      unexpectedTargetIds,
      sourceChecksumMismatchIds,
    };
  }
  return { details, totalExpected, totalMigrated };
}

try {
  await seedSource();
  const collisionGuard = await verifyTargetCollisionGuard();
  const firstRun = await migrateOnce();
  const checksumGuard = await verifyTargetChecksumGuard();
  const secondRun = await migrateOnce();
  const reconciliation = await reconcile();
  const failures = Object.values(reconciliation.details).filter(row =>
    row.countDelta !== 0 || row.amountDelta !== 0
      || row.targetChecksumMismatchIds.length > 0
      || row.unexpectedTargetIds.length > 0
      || row.sourceChecksumMismatchIds.length > 0,
  );
  if (firstRun.migrated !== migratableCount || firstRun.exceptions.length !== exceptionCount || secondRun.migrated !== 0 || secondRun.skipped !== migratableCount || failures.length) {
    throw new Error(`Synthetic acceptance failed: ${JSON.stringify({ collisionGuard, firstRun, checksumGuard, secondRun, failures })}`);
  }
  console.log(JSON.stringify({
    project: PROJECT_ID,
    environment: 'local Firestore emulator only',
    migrationVersion: MIGRATION_VERSION,
    collisionGuard,
    firstRun,
    checksumGuard,
    replay: secondRun,
    reconciliation,
    result: 'PASS',
  }, null, 2));
} finally {
  await app.delete();
}
