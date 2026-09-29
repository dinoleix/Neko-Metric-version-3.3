import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const source = readFileSync(new URL('../components/augustStockImport.ts', import.meta.url), 'utf8');
const rows = JSON.parse(source.match(/= (\[[\s\S]*\]);\s*$/)?.[1] || '[]');

const unitForSheet = sourceUnit => {
  const value = String(sourceUnit || '').trim().toLowerCase();
  if (value === 'kg' || value.includes('gm') || value.includes('grm')) return 'kg';
  if (value === 'l' || value.includes('litre') || value.includes('liter')) return 'l';
  if (value === 'ml') return 'ml';
  return 'pc';
};
const keyFor = value => String(value).trim().toUpperCase().replace(/\s+/g, ' ');

const users = await db.collection('users').where('email', '==', 'dino04@gmail.com').limit(2).get();
if (users.empty) throw new Error('Could not find the NekoMetrics owner account.');
if (users.size > 1) throw new Error('More than one owner account matched; import stopped.');
const ownerId = users.docs[0].id;
const existing = await db.collection('inventory_items').where('ownerId', '==', ownerId).get();
const itemsByKey = new Map(existing.docs.map(snapshot => {
  const item = { id: snapshot.id, ...snapshot.data() };
  return [`${item.bucket}|${keyFor(item.name)}|${item.sourceUnit || ''}|${item.unitCost}`, item];
}));

const now = Date.now();
const batch = db.batch();
const resolved = rows.map(row => {
  const key = `${row.bucket}|${keyFor(row.name)}|${row.sourceUnit}|${row.unitCost}`;
  let item = itemsByKey.get(key);
  if (!item) {
    const ref = db.collection('inventory_items').doc();
    item = { id: ref.id, userId: ownerId, ownerId, name: row.name, bucket: row.bucket, unit: unitForSheet(row.sourceUnit), sourceUnit: row.sourceUnit, unitCost: row.unitCost, active: true, createdAt: now, updatedAt: now, importSource: 'August 2026 closing count' };
    itemsByKey.set(key, item);
    batch.set(ref, item);
  }
  return { ...row, item };
});

const countFor = (outletId, quantityField, totalField) => {
  const totals = { FOOD: 0, DRINKS: 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0 };
  const lines = resolved.map(row => {
    const quantity = Number(row[quantityField]) || 0;
    // The sheet's total is authoritative: a few rows count individual units
    // while their listed price is for a multi-unit pack.
    const total = Number(row[totalField]) || 0;
    totals[row.bucket] += total;
    return { inventoryItemId: row.item.id, name: row.item.name, bucket: row.bucket, unit: row.item.unit, sourceUnit: row.sourceUnit, quantity, unitCost: quantity ? total / quantity : row.unitCost, total };
  });
  return { userId: ownerId, ownerId, outletId, month: 'August', year: '2026', status: 'draft', lines, totals, countedAt: now, updatedAt: now, updatedBy: ownerId, importSource: 'August 2026 closing count sheet' };
};

batch.set(db.collection('inventory_counts').doc('august-2026-40543'), countFor('40543', 'b6Quantity', 'b6Total'));
batch.set(db.collection('inventory_counts').doc('august-2026-40140'), countFor('40140', 'sdjQuantity', 'sdjTotal'));
await batch.commit();

const b6 = countFor('40543', 'b6Quantity', 'b6Total');
const sdj = countFor('40140', 'sdjQuantity', 'sdjTotal');
console.log(JSON.stringify({ ownerId, rows: rows.length, deerParkB6: b6.totals, safdarjung: sdj.totals }));
