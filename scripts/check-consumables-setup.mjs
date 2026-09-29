import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const users = await db.collection('users').where('email', '==', 'dino04@gmail.com').limit(2).get();
const ownerId = users.docs[0]?.id;
const settings = await db.collection('category_settings').doc(ownerId).get();
const tracked = settings.exists ? settings.data().trackedConsumables || [] : [];
console.log(JSON.stringify({ configuredConsumables: tracked.length, tracked }, null, 2));
