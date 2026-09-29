import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const users = await db.collection('users').where('email', '==', 'dino04@gmail.com').limit(2).get();
if (users.empty || users.size > 1) throw new Error('Could not uniquely identify the NekoMetrics owner account.');
const ownerId = users.docs[0].id;

const [counts, adjustments] = await Promise.all([
  db.collection('inventory_counts').where('ownerId', '==', ownerId).where('month', '==', 'August').where('year', '==', '2026').get(),
  db.collection('cogs_adjustments').where('userId', '==', ownerId).where('month', '==', 'August').where('year', '==', '2026').get(),
]);
const countByOutlet = new Map(counts.docs.map(snapshot => [snapshot.data().outletId, snapshot.data()]));
const adjustmentByOutlet = new Map(adjustments.docs.map(snapshot => [snapshot.data().outletId, { id: snapshot.id, ...snapshot.data() }]));
const outlets = new Set([...countByOutlet.keys(), ...adjustmentByOutlet.keys()]);
const output = [...outlets].map(outletId => {
  const count = countByOutlet.get(outletId);
  const adjustment = adjustmentByOutlet.get(outletId);
  const inventory = count?.totals || {};
  const pnl = {
    FOOD: Number(adjustment?.foodIngredientsAdjustment || 0),
    DRINKS: Number(adjustment?.drinkIngredientsAdjustment || 0),
    'FOOD SERVINGS': Number(adjustment?.foodServingsAdjustment || 0),
    'DRINKS SERVINGS': Number(adjustment?.drinkServingsAdjustment || 0),
  };
  const detailed = {
    FOOD: Number(inventory.FOOD || 0), DRINKS: Number(inventory.DRINKS || 0),
    'FOOD SERVINGS': Number(inventory['FOOD SERVINGS'] || 0), 'DRINKS SERVINGS': Number(inventory['DRINKS SERVINGS'] || 0),
  };
  return {
    outletId, pnlAdjustmentId: adjustment?.id || null, detailed, pnl,
    difference: Object.fromEntries(Object.keys(pnl).map(bucket => [bucket, detailed[bucket] - pnl[bucket]])),
    detailedTotal: Object.values(detailed).reduce((sum, value) => sum + value, 0),
    pnlTotal: Object.values(pnl).reduce((sum, value) => sum + value, 0),
  };
});
console.log(JSON.stringify(output, null, 2));
