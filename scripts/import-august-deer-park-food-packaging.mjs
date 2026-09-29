import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const rows = [
  ['SMALL BOAT TRAY', 51, 144.43],
  ['LARGE BOAT TRAY', 239, 874.26],
  ['LARGE PACKING CONTAINER', 38, 336.30],
  ['SMALL PACKING CONTAINER', 69, 366.39],
  ['POKE BOWL', 68, 425.27],
  ['RAMEN BOWL', 81, 583.04],
  ['SAUCE DIP', 288, 203.90],
  ['WOODEN FORK', 237, 172.54],
  ['WOODEN KNIFE', 457, 332.70],
  ['WOODEN SPOON', 458, 333.42],
  ['WOODEN CHOPSTICK WITH COVER (100/PACK)', 300, 571.20],
  ['TISSUE PAPER', 8, 176.00],
  ['BUTTER PAPER SQUARE (PER KG)', 2, 448.40],
  ['RAMEN BOWL LID', 47, 166.38],
];
const roundOff = -0.23;

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
    item = { id: ref.id, userId: ownerId, ownerId, name, bucket: 'FOOD SERVINGS', unit: 'pc', sourceUnit: 'PCS', unitCost: total / quantity, active: true, createdAt: now, updatedAt: now, importSource: 'August 2026 Deer Park food packaging closing count' };
    batch.set(ref, item);
    existingByKey.set(key, item);
  }
  linesByName.set(key, { inventoryItemId: item.id, name, bucket: 'FOOD SERVINGS', unit: 'pc', sourceUnit: 'PCS', quantity, unitCost: total / quantity, total });
}

// The supplier sheet explicitly includes this non-physical reconciliation row;
// keep it visible on the saved August count but inactive for future staff counts.
const adjustmentName = 'COUNT ROUNDING ADJUSTMENT';
const adjustmentKey = `FOOD SERVINGS|${adjustmentName}`;
let adjustment = existingByKey.get(adjustmentKey);
if (!adjustment) {
  const ref = db.collection('inventory_items').doc();
  adjustment = { id: ref.id, userId: ownerId, ownerId, name: adjustmentName, bucket: 'FOOD SERVINGS', unit: 'pc', sourceUnit: 'ROUND OFF', unitCost: roundOff, active: false, createdAt: now, updatedAt: now, importSource: 'August 2026 Deer Park food packaging closing count' };
  batch.set(ref, adjustment);
}
linesByName.set(adjustmentKey, { inventoryItemId: adjustment.id, name: adjustmentName, bucket: 'FOOD SERVINGS', unit: 'pc', sourceUnit: 'ROUND OFF', quantity: 1, unitCost: roundOff, total: roundOff });

const countRef = db.collection('inventory_counts').doc('august-2026-40543');
const countSnapshot = await countRef.get();
if (!countSnapshot.exists) throw new Error('Deer Park August 2026 closing count was not found.');
const count = countSnapshot.data();
const retainedLines = (count.lines || []).filter(line => line.bucket !== 'FOOD SERVINGS');
const lines = [...retainedLines, ...linesByName.values()];
const totals = { FOOD: 0, DRINKS: 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0 };
for (const line of lines) totals[line.bucket] += Number(line.total || 0);
batch.set(countRef, { ...count, lines, totals, updatedAt: now, updatedBy: ownerId }, { merge: true });
await batch.commit();

console.log(JSON.stringify({ physicalPackagingLines: rows.length, roundOff, foodPackaging: totals['FOOD SERVINGS'], total: Object.values(totals).reduce((sum, value) => sum + value, 0) }));
