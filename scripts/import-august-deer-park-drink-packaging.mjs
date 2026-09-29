import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const rows = [
  ['BROWN PAPER BAG (MEDIUM)', 50, 300.00],
  ['BOBA CUPS LARGE', 50, 383.50],
  ['BOBA CUPS REGULAR', 325, 2070.90],
  ['COFFEE CUP LID', 158, 447.71],
  ['REGULAR STRAW', 700, 743.40],
  ['LARGE STRAW', 300, 371.70],
  ['SMALL SIZED CARRY BAG', 35, 338.66],
  ['WOODEN COFFEE STIRRER', 70, 14.11],
  ['COFFEE CUP', 25, 75.22],
  ['LARGE COFFEE LID', 155, 494.76],
];

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
    item = {
      id: ref.id, userId: ownerId, ownerId, name, bucket: 'DRINKS SERVINGS', unit: 'pc', sourceUnit: 'PCS',
      unitCost: total / quantity, active: true, createdAt: now, updatedAt: now,
      importSource: 'August 2026 Deer Park drink packaging closing count',
    };
    batch.set(ref, item);
    existingByKey.set(key, item);
  }
  linesByName.set(key, {
    inventoryItemId: item.id, name, bucket: 'DRINKS SERVINGS', unit: 'pc', sourceUnit: 'PCS',
    quantity, unitCost: total / quantity, total,
  });
}

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

console.log(JSON.stringify({ addedPackagingLines: rows.length, drinkPackaging: totals['DRINKS SERVINGS'], total: Object.values(totals).reduce((sum, value) => sum + value, 0) }));
