import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const users = await db.collection('users').where('email', '==', 'dino04@gmail.com').limit(2).get();
const ownerId = users.docs[0]?.id;
const counts = await db.collection('inventory_counts').where('ownerId', '==', ownerId).where('month', '==', 'August').where('year', '==', '2026').get();
console.log(JSON.stringify(counts.docs.map(snapshot => {
  const data = snapshot.data();
  return { id: snapshot.id, outletId: data.outletId, lines: data.lines?.length ?? 0, total: Object.values(data.totals || {}).reduce((sum, value) => sum + Number(value || 0), 0) };
})));
