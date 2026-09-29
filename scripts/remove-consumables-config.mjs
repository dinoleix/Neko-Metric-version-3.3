import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);
const users = await db.collection('users').where('email', '==', 'dino04@gmail.com').limit(2).get();
if (users.empty || users.size > 1) throw new Error('Could not uniquely identify the NekoMetrics owner account.');

const settingsRef = db.collection('category_settings').doc(users.docs[0].id);
await settingsRef.set({ trackedConsumables: FieldValue.delete(), updatedAt: Date.now() }, { merge: true });
console.log('Removed the legacy consumables configuration.');
