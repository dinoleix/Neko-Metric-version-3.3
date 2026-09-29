import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const rows = [
  ['POKE BOWL', 100, 625.40],
  ['POKE BOWL LID', 280, 1255.52],
  ['RAMEN BOWL 500ML', 96, 600.38],
  ['SAUCE DIP', 250, 177.00],
  ['SMALL BOAT TRAY', 62, 175.58],
  ['LARGE BOAT TRAY', 208, 760.86],
  ['SMALL PACKING CONTAINER', 50, 265.50],
  ['LARGE PACKING CONTAINER', 50, 442.50],
  ['RAMEN BOWL LID', 280, 991.20],
  ['WOODEN CHOPSTICK WITH COVER (100/PACK)', 70, 133.28],
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
  const key = `FOOD SERVINGS|${normalise(name)}`;
  let item = existingByKey.get(key);
  if (!item) {
    const ref = db.collection('inventory_items').doc();
    item = {
      id: ref.id, userId: ownerId, ownerId, name, bucket: 'FOOD SERVINGS', unit: 'pc', sourceUnit: 'PCS',
      unitCost: total / quantity, active: true, createdAt: now, updatedAt: now,
      importSource: 'August 2026 Safdarjung food packaging closing count',
    };
    batch.set(ref, item);
    existingByKey.set(key, item);
  }
  linesByName.set(key, {
    inventoryItemId: item.id, name, bucket: 'FOOD SERVINGS', unit: 'pc', sourceUnit: 'PCS',
    quantity, unitCost: total / quantity, total,
  });
}

const countRef = db.collection('inventory_counts').doc('august-2026-40140');
const countSnapshot = await countRef.get();
if (!countSnapshot.exists) throw new Error('Safdarjung August 2026 closing count was not found.');
const count = countSnapshot.data();
const retainedLines = (count.lines || []).filter(line => line.bucket !== 'FOOD SERVINGS');
const lines = [...retainedLines, ...linesByName.values()];
const totals = { FOOD: 0, DRINKS: 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0 };
for (const line of lines) totals[line.bucket] += Number(line.total || 0);
batch.set(countRef, { ...count, lines, totals, updatedAt: now, updatedBy: ownerId }, { merge: true });
await batch.commit();

console.log(JSON.stringify({ addedPackagingLines: rows.length, foodPackaging: totals['FOOD SERVINGS'], total: Object.values(totals).reduce((sum, value) => sum + value, 0) }));
