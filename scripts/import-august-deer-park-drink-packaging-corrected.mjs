import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const rows = [
  ['BROWN BAG (SMALL)', 40, 160.00],
  ['BROWN BAG (MEDIUM)', 41, 246.00],
  ['BOBA CUP REGULAR', 220, 1272.04],
  ['BOBA CUP LARGE', 165, 1265.55],
  ['REGULAR STRAW', 663, 704.11],
  ['LARGE STRAW', 107, 132.57],
  ['COFFEE CUP', 50, 150.45],
  ['COFFEE CUP LARGE (350ML)', 24, 82.80],
  ['COFFEE LID', 322, 883.57],
  ['LARGE COFFEE LID', 24, 76.61],
  ['WOODEN COFFEE STIRRER', 73, 14.72],
];
const roundOff = -0.41;

const users = await db.collection('users').where('email', '==', 'dino04@gmail.com').limit(2).get();
if (users.empty || users.size > 1) throw new Error('Could not uniquely identify the NekoMetrics owner account.');
const ownerId = users.docs[0].id;
const normalise = value => String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
const inventory = await db.collection('inventory_items').where('ownerId', '==', ownerId).get();
const existingByKey = new Map(inventory.docs.map(snapshot => {
  const value = snapshot.data();
  return [`${value.bucket}|${normalise(value.name)}`, { id: snapshot.id, ...value }];
}));
const batch = db.batch();
const now = Date.now();
const linesByName = new Map();
for (const [name, quantity, total] of rows) {
  const key = `DRINKS SERVINGS|${normalise(name)}`;
  let item = existingByKey.get(key);
  if (!item) {
    const ref = db.collection('inventory_items').doc();
    item = { id: ref.id, userId: ownerId, ownerId, name, bucket: 'DRINKS SERVINGS', unit: 'pc', sourceUnit: 'PCS', unitCost: total / quantity, active: true, createdAt: now, updatedAt: now, importSource: 'August 2026 Deer Park drink packaging closing count' };
    batch.set(ref, item);
    existingByKey.set(key, item);
  }
  linesByName.set(key, { inventoryItemId: item.id, name, bucket: 'DRINKS SERVINGS', unit: 'pc', sourceUnit: 'PCS', quantity, unitCost: total / quantity, total });
}

const adjustmentName = 'COUNT ROUNDING ADJUSTMENT';
const adjustmentKey = `DRINKS SERVINGS|${adjustmentName}`;
let adjustment = existingByKey.get(adjustmentKey);
if (!adjustment) {
  const ref = db.collection('inventory_items').doc();
  adjustment = { id: ref.id, userId: ownerId, ownerId, name: adjustmentName, bucket: 'DRINKS SERVINGS', unit: 'pc', sourceUnit: 'ROUND OFF', unitCost: roundOff, active: false, createdAt: now, updatedAt: now, importSource: 'August 2026 Deer Park drink packaging closing count' };
  batch.set(ref, adjustment);
}
linesByName.set(adjustmentKey, { inventoryItemId: adjustment.id, name: adjustmentName, bucket: 'DRINKS SERVINGS', unit: 'pc', sourceUnit: 'ROUND OFF', quantity: 1, unitCost: roundOff, total: roundOff });

const countRef = db.collection('inventory_counts').doc('august-2026-40543');
const countSnapshot = await countRef.get();
if (!countSnapshot.exists) throw new Error('Deer Park August 2026 closing count was not found.');
const count = countSnapshot.data();
const retainedLines = (count.lines || []).filter(line => line.bucket !== 'DRINKS SERVINGS');
const lines = [...retainedLines, ...linesByName.values()];
const totals = { FOOD: 0, DRINKS: 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0 };
for (const line of lines) totals[line.bucket] += Number(line.total || 0);
batch.set(countRef, { ...count, lines, totals, updatedAt: now, updatedBy: ownerId }, { merge: true });
await batch.commit();

console.log(JSON.stringify({ physicalPackagingLines: rows.length, roundOff, drinkPackaging: totals['DRINKS SERVINGS'], total: Object.values(totals).reduce((sum, value) => sum + value, 0) }));
