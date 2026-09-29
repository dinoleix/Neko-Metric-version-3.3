import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const users = await db.collection('users').where('email', '==', 'dino04@gmail.com').limit(2).get();
const ownerId = users.docs[0]?.id;
const normalise = value => String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
const [products, inventory] = await Promise.all([
  db.collection('products').where('ownerId', '==', ownerId).get(),
  db.collection('inventory_items').where('ownerId', '==', ownerId).get(),
]);
const inventoryNames = new Set(inventory.docs.map(snapshot => normalise(snapshot.data().name)));
const exactMatches = products.docs.filter(snapshot => inventoryNames.has(normalise(snapshot.data().name))).length;
console.log(JSON.stringify({ productCatalogItems: products.size, inventoryItems: inventory.size, exactNameMatches: exactMatches }));
