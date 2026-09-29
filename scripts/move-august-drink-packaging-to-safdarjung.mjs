import { readFileSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const serviceAccount = JSON.parse(readFileSync(new URL('../mcp/service-account.json', import.meta.url), 'utf8'));
const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(app);

const names = new Set([
  'BROWN PAPER BAG (MEDIUM)', 'BOBA CUPS LARGE', 'BOBA CUPS REGULAR', 'COFFEE CUP LID',
  'REGULAR STRAW', 'LARGE STRAW', 'SMALL SIZED CARRY BAG', 'WOODEN COFFEE STIRRER',
  'COFFEE CUP', 'LARGE COFFEE LID',
]);
const emptyTotals = () => ({ FOOD: 0, DRINKS: 0, 'FOOD SERVINGS': 0, 'DRINKS SERVINGS': 0 });
const totalsFor = lines => lines.reduce((totals, line) => {
  totals[line.bucket] += Number(line.total || 0);
  return totals;
}, emptyTotals());

const b6Ref = db.collection('inventory_counts').doc('august-2026-40543');
const safdarjungRef = db.collection('inventory_counts').doc('august-2026-40140');
const [b6Snapshot, safdarjungSnapshot] = await Promise.all([b6Ref.get(), safdarjungRef.get()]);
if (!b6Snapshot.exists || !safdarjungSnapshot.exists) throw new Error('One or both August stock counts were not found.');

const b6 = b6Snapshot.data();
const safdarjung = safdarjungSnapshot.data();
const movedLines = (b6.lines || []).filter(line => line.bucket === 'DRINKS SERVINGS' && names.has(line.name));
if (movedLines.length !== names.size) throw new Error(`Expected ${names.size} Deer Park drink-packaging lines, found ${movedLines.length}. Move stopped.`);

const b6Lines = (b6.lines || []).filter(line => !(line.bucket === 'DRINKS SERVINGS' && names.has(line.name)));
const safdarjungLines = [
  ...(safdarjung.lines || []).filter(line => !(line.bucket === 'DRINKS SERVINGS' && names.has(line.name))),
  ...movedLines,
];
const now = Date.now();
const batch = db.batch();
batch.set(b6Ref, { lines: b6Lines, totals: totalsFor(b6Lines), updatedAt: now }, { merge: true });
batch.set(safdarjungRef, { lines: safdarjungLines, totals: totalsFor(safdarjungLines), updatedAt: now }, { merge: true });
await batch.commit();

console.log(JSON.stringify({ movedLines: movedLines.length, deerParkTotal: Object.values(totalsFor(b6Lines)).reduce((sum, value) => sum + value, 0), safdarjungTotal: Object.values(totalsFor(safdarjungLines)).reduce((sum, value) => sum + value, 0), safdarjungDrinkPackaging: totalsFor(safdarjungLines)['DRINKS SERVINGS'] }));
