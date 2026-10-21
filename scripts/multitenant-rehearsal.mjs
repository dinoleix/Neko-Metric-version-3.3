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
  { collection: 'inventory_counts', id: 'inventory-001', data: { ownerId: 'legacy-green-owner', userId: 'legacy-green-owner', outletId: 'legacy-b6-market', date: '2026-09-01', closingValue: 640 } },
  { collection: 'fc_recipes', id: 'recipe-001', data: { ownerId: 'legacy-green-owner', name: 'Synthetic Bowl', ingredients: [{ name: 'Rice', quantity: 1 }] } },
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

    if (existing?.status === 'completed' && existing.sourceChecksum === sourceChecksum) {
      const target = await db.collection(targetPath(record.collection)).doc(record.id).get();
      if (!target.exists || target.data().tenantId !== TENANT_ID) {
        throw new Error(`Completed manifest has no matching target: ${record.collection}/${record.id}`);
      }
      skipped += 1;
      continue;
    }

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
    const batch = db.batch();
    batch.set(db.collection(targetPath(record.collection)).doc(record.id), targetData);
    batch.set(manifestRef, {
      migrationVersion: MIGRATION_VERSION, sourceCollection: record.collection,
      sourceDocumentId: record.id, sourceChecksum, status: 'completed',
      attemptCount: (existing?.attemptCount || 0) + 1, completedAt: Date.now(),
    });
    await batch.commit();
    migrated += 1;
  }
  return { migrated, skipped, exceptions };
}

async function reconcile() {
  const details = {};
  let totalExpected = 0;
  let totalMigrated = 0;
  for (const collection of new Set(records.map(record => record.collection))) {
    const sourceSnap = await db.collection(sourcePath(collection)).get();
    const targetSnap = await db.collection(targetPath(collection)).get();
    const expectedDocs = sourceSnap.docs.filter(doc => !(doc.data().outletId && !OUTLET_MAP[doc.data().outletId]));
    const sourceTotal = expectedDocs.reduce((sum, doc) => sum + Number(doc.data().totalRevenue || doc.data().amount || doc.data().closingValue || 0), 0);
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
    };
  }
  return { details, totalExpected, totalMigrated };
}

try {
  await seedSource();
  const firstRun = await migrateOnce();
  const secondRun = await migrateOnce();
  const reconciliation = await reconcile();
  const failures = Object.values(reconciliation.details).filter(row => row.countDelta !== 0 || row.amountDelta !== 0);
  if (firstRun.migrated !== 5 || firstRun.exceptions.length !== 1 || secondRun.migrated !== 0 || secondRun.skipped !== 5 || failures.length) {
    throw new Error(`Synthetic acceptance failed: ${JSON.stringify({ firstRun, secondRun, failures })}`);
  }
  console.log(JSON.stringify({
    project: PROJECT_ID,
    environment: 'local Firestore emulator only',
    migrationVersion: MIGRATION_VERSION,
    firstRun,
    replay: secondRun,
    reconciliation,
    result: 'PASS',
  }, null, 2));
} finally {
  await app.delete();
}
