import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const users = await db.collection('users').where('email', '==', 'dino04@gmail.com').limit(2).get();
if (users.empty || users.size > 1) throw new Error('Could not uniquely identify the NekoMetrics owner account.');

const ownerId = users.docs[0].id;
const augustCounts = await db.collection('inventory_counts')
  .where('ownerId', '==', ownerId)
  .where('month', '==', 'August')
  .where('year', '==', '2026')
  .get();

const batch = db.batch();
augustCounts.docs.forEach(snapshot => batch.delete(snapshot.ref));
if (!augustCounts.empty) await batch.commit();

console.log(JSON.stringify({ deletedCountIds: augustCounts.docs.map(snapshot => snapshot.id) }));
await import('./import-august-stock.mjs');
