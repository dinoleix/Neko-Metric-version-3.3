import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, getDocs, collection, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';

// Never fall back to the configured production project or a remote endpoint.
const projectId = 'demo-neko-rules';
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8088') {
  throw new Error('Run npm run test:rules against the isolated demo emulator.');
}
let env;
const profile = (uid, role = 'viewer', extra = {}) => ({ uid, email: `${uid}@example.test`, role, createdAt: 1, ...extra });
const dbFor = uid => env.authenticatedContext(uid).firestore();
const group = (tenant = 'owner') => ({ userId: tenant, ownerId: tenant, name: 'Finance', moduleIds: ['sales'], createdAt: 1 });

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { host: '127.0.0.1', port: 8088, rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const batch = writeBatch(db);
    const profiles = [
      profile('owner', 'admin'), // Existing owner has no ownerId in Firestore.
      profile('other-owner', 'admin'),
      profile('admin', 'admin', { ownerId: 'owner' }),
      profile('manager', 'manager', { ownerId: 'owner' }),
      profile('manager-store', 'manager', { ownerId: 'owner', assignedOutlet: 'outlet-a' }),
      profile('viewer', 'viewer', { ownerId: 'owner' }),
      profile('crew', 'crew', { ownerId: 'owner', assignedOutlet: 'outlet-a' }),
      profile('crew-mate', 'crew', { ownerId: 'owner', assignedOutlet: 'outlet-a' }),
      profile('crew-b', 'crew', { ownerId: 'owner', assignedOutlet: 'outlet-b' }),
      profile('other-admin', 'admin', { ownerId: 'other-owner' }),
      profile('other-manager', 'manager', { ownerId: 'other-owner' }),
      profile('other-crew', 'crew', { ownerId: 'other-owner', assignedOutlet: 'outlet-a' }),
      profile('other-viewer', 'viewer', { ownerId: 'other-owner' }),
      profile('unlinked'),
      profile('legacy-viewer', 'viewer', { ownerId: 'owner', userId: 'legacy-viewer' }),
    ];
    profiles.forEach(p => batch.set(doc(db, 'users', p.uid), p));
    batch.set(doc(db, 'user_groups', 'finance'), group());
    batch.set(doc(db, 'user_groups', 'foreign'), group('other-owner'));
    batch.set(doc(db, 'sales_snapshots', 'sales'), { userId: 'owner', total: 100 });
    batch.set(doc(db, 'sales_snapshots', 'sales-a'), { userId: 'owner', outletId: 'outlet-a', total: 100 });
    batch.set(doc(db, 'sales_snapshots', 'sales-b'), { userId: 'owner', outletId: 'outlet-b', total: 200 });
    batch.set(doc(db, 'crew_entries', 'entry'), { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', amount: 20, status: 'pending' });
    batch.set(doc(db, 'crew_entries', 'delete-by-crew'), { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', amount: 10, status: 'pending' });
    batch.set(doc(db, 'crew_entries', 'delete-by-manager'), { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', amount: 10, status: 'pending' });
    batch.set(doc(db, 'waste_entries', 'waste'), { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', totalCost: 8, date: '2026-09-16' });
    batch.set(doc(db, 'waste_entries', 'delete-waste-by-crew'), { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', totalCost: 5, date: '2026-09-16' });
    batch.set(doc(db, 'waste_entries', 'delete-waste-by-manager'), { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', totalCost: 5, date: '2026-09-16' });
    batch.set(doc(db, 'daily_sales_logs', 'sales-a'), { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', date: '2026-09-16', totalNet: 100 });
    batch.set(doc(db, 'daily_sales_logs', 'sales-b'), { userId: 'crew-b', ownerId: 'owner', outletId: 'outlet-b', date: '2026-09-16', totalNet: 200 });
    batch.set(doc(db, 'bank_accounts', 'outlet-a'), { userId: 'owner', outletId: 'outlet-a', name: 'A cash', balance: 100, updatedAt: 1 });
    batch.set(doc(db, 'bank_accounts', 'outlet-b'), { userId: 'owner', outletId: 'outlet-b', name: 'B cash', balance: 100, updatedAt: 1 });
    batch.set(doc(db, 'expense_snapshots', 'outlet-a'), {
      userId: 'owner', outletId: 'outlet-a', month: 'September', year: '2026',
      totalPurchase: 500, crewTotalPurchase: 20, crewLastUpdated: 1,
    });
    batch.set(doc(db, 'expense_snapshots', 'outlet-b'), {
      userId: 'owner', outletId: 'outlet-b', month: 'September', year: '2026',
      totalPurchase: 600, crewTotalPurchase: 30, crewLastUpdated: 1,
    });
    batch.set(doc(db, 'inventory_counts', 'frozen-count'), {
      userId: 'owner', ownerId: 'owner', outletId: 'outlet-a', month: 'September', year: '2026',
      status: 'frozen', totals: {}, lines: [], countedAt: 1, updatedAt: 1,
    });
    batch.set(doc(db, 'inventory_counts', 'draft-count'), {
      userId: 'owner', ownerId: 'owner', outletId: 'outlet-a', month: 'October', year: '2026',
      status: 'draft', totals: {}, lines: [], countedAt: 1, updatedAt: 1,
    });
    batch.set(doc(db, 'vendors', 'vendor'), { userId: 'crew', ownerId: 'owner', name: 'Supplier' });
    batch.set(doc(db, 'products', 'product'), { userId: 'crew', ownerId: 'owner', name: 'Rice' });
    batch.set(doc(db, 'fc_ingredients', 'ingredient'), { userId: 'manager', ownerId: 'owner', name: 'Rice' });
    batch.set(doc(db, 'fc_recipes', 'recipe'), { userId: 'manager', ownerId: 'owner', name: 'Bowl' });
    await batch.commit();
  });
});

test('first sign-in reads missing own profile and creates default viewer', async () => {
  const ref = doc(dbFor('new-user'), 'users', 'new-user');
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref, profile('new-user')));
  await assertSucceeds(getDoc(ref));
});

for (const payload of [
  profile('new-user', 'admin', { userId: 'new-user' }),
  profile('new-user', 'viewer', { userId: 'new-user', ownerId: 'owner' }),
  profile('wrong-uid'),
  profile('new-user', 'viewer', { groupId: 'finance' }),
]) {
  test(`self-provision rejects privileged or forged fields: ${JSON.stringify(payload)}`, async () => {
    await assertFails(setDoc(doc(dbFor('new-user'), 'users', 'new-user'), payload));
  });
}

for (const uid of ['viewer', 'crew', 'manager', 'admin', 'legacy-viewer']) {
  test(`${uid} can read own profile but cannot elevate, re-link, or delete it`, async () => {
    const ref = doc(dbFor(uid), 'users', uid);
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { email: 'updated@example.test' }));
    await assertFails(updateDoc(ref, { role: uid === 'admin' ? 'manager' : 'admin', userId: uid }));
    await assertFails(updateDoc(ref, { ownerId: 'other-owner' }));
    await assertFails(updateDoc(ref, { assignedOutlet: 'outlet-b' }));
    await assertFails(updateDoc(ref, { groupId: 'foreign' }));
    await assertFails(updateDoc(ref, { uid: 'owner' }));
    await assertFails(deleteDoc(ref));
  });
}

test('cannot prepare a two-step escalation by adding userId to a profile', async () => {
  await assertFails(updateDoc(doc(dbFor('viewer'), 'users', 'viewer'), { userId: 'viewer' }));
});

test('users can record only their own truthful login activity', async () => {
  const valid = {
    userId: 'crew', ownerId: 'owner', email: 'crew@example.test', role: 'crew',
    assignedOutlet: 'outlet-a', loggedInAt: serverTimestamp(), locationStatus: 'denied',
  };
  await assertSucceeds(setDoc(doc(dbFor('crew'), 'login_activity', 'crew-login'), valid));
  await assertFails(setDoc(doc(dbFor('crew'), 'login_activity', 'forged-user'), { ...valid, userId: 'crew-mate' }));
  await assertFails(setDoc(doc(dbFor('crew'), 'login_activity', 'forged-tenant'), { ...valid, ownerId: 'other-owner' }));
  await assertFails(setDoc(doc(dbFor('crew'), 'login_activity', 'forged-role'), { ...valid, role: 'admin' }));
  await assertFails(updateDoc(doc(dbFor('crew'), 'login_activity', 'crew-login'), { locationStatus: 'available' }));
  await assertFails(deleteDoc(doc(dbFor('crew'), 'login_activity', 'crew-login')));
});

test('login activity is visible only to administrators in the same tenant', async () => {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'login_activity', 'seed-login'), {
      userId: 'crew', ownerId: 'owner', email: 'crew@example.test', role: 'crew',
      assignedOutlet: 'outlet-a', loggedInAt: new Date(), locationStatus: 'available',
      latitude: 28.57, longitude: 77.20, accuracyMeters: 25,
    });
  });
  for (const uid of ['owner', 'admin']) {
    await assertSucceeds(getDocs(query(collection(dbFor(uid), 'login_activity'), where('ownerId', '==', 'owner'))));
  }
  for (const uid of ['manager', 'viewer', 'crew', 'other-admin']) {
    await assertFails(getDoc(doc(dbFor(uid), 'login_activity', 'seed-login')));
    await assertFails(deleteDoc(doc(dbFor(uid), 'login_activity', 'seed-login')));
  }
  await assertSucceeds(deleteDoc(doc(dbFor('admin'), 'login_activity', 'seed-login')));
});

test('unlinked viewer cannot create or adopt another account as tenant owner', async () => {
  const db = dbFor('unlinked');
  await assertFails(setDoc(doc(db, 'users', 'new-member'), profile('new-member', 'admin', { ownerId: 'unlinked' })));
  await assertFails(updateDoc(doc(db, 'users', 'other-viewer'), { ownerId: 'unlinked', role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users', 'owner'), { role: 'viewer', ownerId: 'unlinked' }));
});

test('owner retains user list, account creation, adoption, role/outlet/group edits, and revocation', async () => {
  const db = dbFor('owner');
  await assertSucceeds(getDocs(collection(db, 'users')));
  await assertSucceeds(setDoc(doc(db, 'users', 'new-member'), profile('new-member', 'crew', { ownerId: 'owner', assignedOutlet: 'outlet-a' })));
  await assertSucceeds(updateDoc(doc(db, 'users', 'unlinked'), { ownerId: 'owner', role: 'viewer' }));
  await assertSucceeds(setDoc(doc(db, 'users', 'new-member'), { role: 'manager', assignedOutlet: '', groupId: 'finance', ownerId: 'owner' }, { merge: true }));
  await assertSucceeds(deleteDoc(doc(db, 'users', 'new-member')));
  await assertFails(updateDoc(doc(db, 'users', 'other-viewer'), { role: 'admin' }));
  await assertFails(deleteDoc(doc(db, 'users', 'owner')));
});

test('delegated admin can inspect profiles but cannot assign roles or delete accounts', async () => {
  const db = dbFor('admin');
  await assertSucceeds(getDocs(collection(db, 'users')));
  await assertFails(updateDoc(doc(db, 'users', 'viewer'), { role: 'admin' }));
  await assertFails(deleteDoc(doc(db, 'users', 'viewer')));
});

for (const uid of ['owner', 'admin']) {
  test(`${uid} retains tenant group creation, editing, listing, and deletion`, async () => {
    const db = dbFor(uid);
    await assertSucceeds(getDocs(query(collection(db, 'user_groups'), where('ownerId', '==', 'owner'))));
    const ref = doc(db, 'user_groups', 'new-group');
    await assertSucceeds(setDoc(ref, group()));
    await assertSucceeds(updateDoc(ref, { name: 'Operations', moduleIds: ['expenses'] }));
    await assertFails(updateDoc(ref, { ownerId: 'other-owner', userId: 'other-owner' }));
    await assertFails(updateDoc(doc(db, 'user_groups', 'foreign'), { name: 'Hijacked' }));
    await assertSucceeds(deleteDoc(ref));
  });
}

for (const uid of ['viewer', 'crew', 'manager', 'unlinked']) {
  test(`${uid} cannot bypass group administration through generic ownership`, async () => {
    const db = dbFor(uid);
    await assertFails(setDoc(doc(db, 'user_groups', 'forged'), group(uid)));
    await assertFails(updateDoc(doc(db, 'user_groups', 'finance'), { name: 'Hijacked' }));
    await assertFails(deleteDoc(doc(db, 'user_groups', 'finance')));
    if (uid !== 'unlinked') await assertSucceeds(getDoc(doc(db, 'user_groups', 'finance')));
  });
}

test('unrelated working financial reads/writes and crew entry updates remain supported', async () => {
  for (const uid of ['owner', 'admin', 'manager']) {
    await assertSucceeds(updateDoc(doc(dbFor(uid), 'sales_snapshots', 'sales'), { total: 120 }));
  }
  await assertSucceeds(getDoc(doc(dbFor('viewer'), 'sales_snapshots', 'sales')));
  await assertFails(updateDoc(doc(dbFor('viewer'), 'sales_snapshots', 'sales'), { total: 0 }));
  await assertSucceeds(updateDoc(doc(dbFor('crew'), 'crew_entries', 'entry'), { status: 'paid' }));
});

test('a frozen inventory count is view-only except for an auditable admin unfreeze', async () => {
  const frozen = doc(dbFor('owner'), 'inventory_counts', 'frozen-count');
  await assertSucceeds(getDoc(frozen));
  await assertFails(updateDoc(frozen, { lines: [{ name: 'Changed' }] }));
  await assertFails(setDoc(frozen, { userId: 'owner', ownerId: 'owner', outletId: 'outlet-a', status: 'draft' }, { merge: true }));
  await assertFails(deleteDoc(frozen));
  await assertFails(updateDoc(doc(dbFor('manager-store'), 'inventory_counts', 'frozen-count'), { updatedAt: 2 }));
  await assertFails(updateDoc(doc(dbFor('viewer'), 'inventory_counts', 'frozen-count'), { status: 'draft', updatedAt: 2 }));
  await assertSucceeds(updateDoc(frozen, {
    status: 'draft', updatedAt: 2, updatedBy: 'owner', unfrozenAt: 2, unfrozenBy: 'owner',
  }));
});

test('only an admin can delete a draft inventory count', async () => {
  await assertFails(deleteDoc(doc(dbFor('manager-store'), 'inventory_counts', 'draft-count')));
  await assertSucceeds(deleteDoc(doc(dbFor('owner'), 'inventory_counts', 'draft-count')));
});

test('store manager is restricted to the assigned outlet while HQ manager keeps all stores', async () => {
  const scoped = dbFor('manager-store');
  await assertSucceeds(getDoc(doc(scoped, 'sales_snapshots', 'sales-a')));
  await assertFails(getDoc(doc(scoped, 'sales_snapshots', 'sales-b')));
  await assertSucceeds(getDocs(query(
    collection(scoped, 'sales_snapshots'),
    where('userId', '==', 'owner'),
    where('outletId', '==', 'outlet-a'),
  )));
  await assertFails(getDocs(query(collection(scoped, 'sales_snapshots'), where('userId', '==', 'owner'))));
  await assertSucceeds(updateDoc(doc(scoped, 'sales_snapshots', 'sales-a'), { total: 125 }));
  await assertFails(updateDoc(doc(scoped, 'sales_snapshots', 'sales-b'), { total: 225 }));
  await assertFails(setDoc(doc(scoped, 'crew_entries', 'manager-wrong-store'), {
    userId: 'manager-store', ownerId: 'owner', outletId: 'outlet-b', amount: 20, status: 'pending',
  }));

  const hq = dbFor('manager');
  await assertSucceeds(getDoc(doc(hq, 'sales_snapshots', 'sales-a')));
  await assertSucceeds(getDoc(doc(hq, 'sales_snapshots', 'sales-b')));
});

test('crew creation is pinned to the caller, tenant, and assigned outlet', async () => {
  const validCrewEntry = { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', amount: 25, status: 'pending' };
  const validWasteEntry = { userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', totalCost: 9, date: '2026-09-16' };
  await assertSucceeds(setDoc(doc(dbFor('crew'), 'crew_entries', 'created-by-crew'), validCrewEntry));
  await assertSucceeds(setDoc(doc(dbFor('crew'), 'waste_entries', 'created-waste-by-crew'), validWasteEntry));
  for (const collectionName of ['crew_entries', 'waste_entries']) {
    const base = collectionName === 'crew_entries' ? validCrewEntry : validWasteEntry;
    await assertFails(setDoc(doc(dbFor('crew'), collectionName, `${collectionName}-foreign-tenant`), { ...base, ownerId: 'other-owner' }));
    await assertFails(setDoc(doc(dbFor('crew'), collectionName, `${collectionName}-other-outlet`), { ...base, outletId: 'outlet-b' }));
    await assertFails(setDoc(doc(dbFor('crew'), collectionName, `${collectionName}-forged-author`), { ...base, userId: 'crew-mate' }));
    await assertFails(setDoc(doc(dbFor('viewer'), collectionName, `${collectionName}-viewer`), { ...base, userId: 'viewer' }));
  }
});

test('owner and delegated staff retain writes inside their tenant only', async () => {
  for (const uid of ['owner', 'admin', 'manager']) {
    const db = dbFor(uid);
    await assertSucceeds(updateDoc(doc(db, 'crew_entries', 'entry'), { amount: 21 }));
    await assertSucceeds(updateDoc(doc(db, 'waste_entries', 'waste'), { totalCost: 9 }));
    await assertSucceeds(setDoc(doc(db, 'crew_entries', `created-${uid}`), { userId: uid, ownerId: 'owner', outletId: 'outlet-b', amount: 30, status: 'paid' }));
    await assertSucceeds(setDoc(doc(db, 'waste_entries', `created-waste-${uid}`), { userId: uid, ownerId: 'owner', outletId: 'outlet-b', totalCost: 4, date: '2026-09-16' }));
  }
  await assertSucceeds(deleteDoc(doc(dbFor('manager'), 'crew_entries', 'delete-by-manager')));
  await assertSucceeds(deleteDoc(doc(dbFor('manager'), 'waste_entries', 'delete-waste-by-manager')));
});

test('same-outlet shift handover works without allowing ownership or outlet changes', async () => {
  const mateDb = dbFor('crew-mate');
  await assertSucceeds(getDoc(doc(mateDb, 'crew_entries', 'entry')));
  await assertSucceeds(updateDoc(doc(mateDb, 'crew_entries', 'entry'), { status: 'paid' }));
  await assertFails(updateDoc(doc(mateDb, 'crew_entries', 'entry'), { ownerId: 'other-owner' }));
  await assertFails(updateDoc(doc(mateDb, 'crew_entries', 'entry'), { userId: 'crew-mate' }));
  await assertFails(updateDoc(doc(mateDb, 'crew_entries', 'entry'), { outletId: 'outlet-b' }));
  await assertFails(deleteDoc(doc(mateDb, 'crew_entries', 'entry')));
  await assertSucceeds(deleteDoc(doc(dbFor('crew'), 'crew_entries', 'delete-by-crew')));
  await assertSucceeds(deleteDoc(doc(dbFor('crew'), 'waste_entries', 'delete-waste-by-crew')));
  await assertFails(updateDoc(doc(dbFor('crew-b'), 'crew_entries', 'entry'), { status: 'paid' }));
  await assertFails(getDoc(doc(dbFor('crew-b'), 'crew_entries', 'entry')));
  await assertFails(getDoc(doc(dbFor('crew-b'), 'waste_entries', 'waste')));
});

test('staff from another tenant cannot read, update, delete, or adopt operational entries', async () => {
  for (const uid of ['other-owner', 'other-admin', 'other-manager', 'other-crew']) {
    const db = dbFor(uid);
    for (const [collectionName, id] of [['crew_entries', 'entry'], ['waste_entries', 'waste']]) {
      const ref = doc(db, collectionName, id);
      await assertFails(getDoc(ref));
      await assertFails(updateDoc(ref, { ownerId: 'other-owner', amount: 1, totalCost: 1 }));
      await assertFails(deleteDoc(ref));
    }
  }
});

test('viewer remains read-only across protected and generic business data', async () => {
  const db = dbFor('viewer');
  for (const [collectionName, id] of [
    ['bank_accounts', 'outlet-a'],
    ['expense_snapshots', 'outlet-a'],
    ['vendors', 'vendor'],
    ['products', 'product'],
    ['fc_ingredients', 'ingredient'],
    ['fc_recipes', 'recipe'],
  ]) {
    const ref = doc(db, collectionName, id);
    await assertSucceeds(getDoc(ref));
    await assertFails(updateDoc(ref, { viewerTamper: true }));
    await assertFails(deleteDoc(ref));
  }
  await assertFails(setDoc(doc(db, 'vendors', 'viewer-vendor'), { userId: 'viewer', ownerId: 'owner', name: 'Forged' }));
  await assertFails(setDoc(doc(db, 'rentals', 'viewer-rental'), { userId: 'viewer', outletId: 'outlet-a' }));
  const viewerCreates = [
    ['online_customers', { userId: 'viewer', name: 'Customer' }],
    ['daily_sales_logs', { userId: 'viewer', ownerId: 'owner', outletId: 'outlet-a' }],
    ['sales_ledger', { userId: 'viewer', ownerId: 'owner', outletId: 'outlet-a' }],
    ['bank_transactions', { userId: 'viewer', ownerId: 'owner', outletId: 'outlet-a' }],
    ['menu_prices', { userId: 'viewer', price: 1 }],
    ['bill_counters', { userId: 'owner', ownerId: 'owner', outletId: 'outlet-a', seq: 1 }],
    ['cash_flow_snapshots', { userId: 'viewer', total: 1 }],
    ['loan_profiles', { userId: 'viewer', name: 'Loan' }],
  ];
  for (const [collectionName, payload] of viewerCreates) {
    await assertFails(setDoc(doc(db, collectionName, `viewer-${collectionName}`), payload));
  }
});

test('crew bank access is limited to the assigned outlet and balance movements', async () => {
  const db = dbFor('crew');
  await assertSucceeds(getDocs(query(
    collection(db, 'bank_accounts'),
    where('userId', '==', 'owner'),
    where('outletId', '==', 'outlet-a'),
  )));
  await assertSucceeds(updateDoc(doc(db, 'bank_accounts', 'outlet-a'), { balance: 90, updatedAt: 2 }));
  await assertFails(updateDoc(doc(db, 'bank_accounts', 'outlet-a'), { name: 'Renamed' }));
  await assertFails(updateDoc(doc(db, 'bank_accounts', 'outlet-a'), { outletId: 'outlet-b' }));
  await assertFails(getDoc(doc(db, 'bank_accounts', 'outlet-b')));
  await assertFails(updateDoc(doc(db, 'bank_accounts', 'outlet-b'), { balance: 90, updatedAt: 2 }));
  await assertFails(deleteDoc(doc(db, 'bank_accounts', 'outlet-a')));
});

test('crew can rebuild only crew fields in an assigned-outlet expense snapshot', async () => {
  const db = dbFor('crew');
  const own = doc(db, 'expense_snapshots', 'outlet-a');
  await assertSucceeds(getDoc(own));
  await assertSucceeds(updateDoc(own, { crewTotalPurchase: 25, crewLastUpdated: 2 }));
  await assertFails(updateDoc(own, { totalPurchase: 0 }));
  await assertFails(updateDoc(own, { outletId: 'outlet-b' }));
  await assertFails(getDoc(doc(db, 'expense_snapshots', 'outlet-b')));
  await assertFails(deleteDoc(own));
  await assertSucceeds(setDoc(doc(db, 'expense_snapshots', 'crew-new'), {
    userId: 'owner', outletId: 'outlet-a', month: 'October', year: '2026',
    crewTotalPurchase: 10, crewLastUpdated: 2,
  }));
  await assertFails(setDoc(doc(db, 'expense_snapshots', 'crew-forged-csv'), {
    userId: 'owner', outletId: 'outlet-a', month: 'October', year: '2026',
    totalPurchase: 999, crewTotalPurchase: 10, crewLastUpdated: 2,
  }));
});

test('crew terminal records stay writable only for the assigned outlet', async () => {
  const db = dbFor('crew');
  for (const collectionName of ['daily_sales_logs', 'sales_ledger', 'bank_transactions']) {
    await assertSucceeds(setDoc(doc(db, collectionName, `${collectionName}-own-outlet`), {
      userId: 'crew', ownerId: 'owner', outletId: 'outlet-a', createdAt: 1,
    }));
    await assertFails(setDoc(doc(db, collectionName, `${collectionName}-other-outlet`), {
      userId: 'crew', ownerId: 'owner', outletId: 'outlet-b', createdAt: 1,
    }));
  }
  await assertSucceeds(setDoc(doc(db, 'bill_counters', 'crew-counter'), {
    userId: 'owner', ownerId: 'owner', outletId: 'outlet-a', seq: 1, updatedAt: 1,
  }));
  await assertSucceeds(updateDoc(doc(db, 'bill_counters', 'crew-counter'), { seq: 2, updatedAt: 2 }));
  await assertFails(updateDoc(doc(db, 'bill_counters', 'crew-counter'), { outletId: 'outlet-b' }));
  await assertFails(setDoc(doc(db, 'bill_counters', 'foreign-counter'), {
    userId: 'owner', ownerId: 'owner', outletId: 'outlet-b', seq: 1, updatedAt: 1,
  }));
});

test('crew daily-sales queries must stay inside their tenant and assigned outlet', async () => {
  const db = dbFor('crew');
  await assertSucceeds(getDocs(query(
    collection(db, 'daily_sales_logs'),
    where('userId', '==', 'crew'),
    where('ownerId', '==', 'owner'),
    where('outletId', '==', 'outlet-a'),
  )));
  await assertFails(getDocs(query(
    collection(db, 'daily_sales_logs'),
    where('userId', '==', 'crew'),
  )));
});

test('crew purchase and expense queries stay inside the assigned outlet', async () => {
  const db = dbFor('crew');
  await assertSucceeds(getDocs(query(
    collection(db, 'crew_entries'),
    where('ownerId', '==', 'owner'),
    where('outletId', '==', 'outlet-a'),
  )));
  await assertFails(getDocs(query(
    collection(db, 'crew_entries'),
    where('userId', '==', 'crew'),
  )));
});

test('crew retains terminal catalog writes but recipe costing stays staff-only', async () => {
  const db = dbFor('crew');
  await assertSucceeds(updateDoc(doc(db, 'vendors', 'vendor'), { name: 'Supplier 2' }));
  await assertSucceeds(updateDoc(doc(db, 'products', 'product'), { name: 'Rice 2' }));
  await assertSucceeds(setDoc(doc(db, 'vendors', 'crew-vendor'), { userId: 'crew', ownerId: 'owner', name: 'New supplier' }));
  await assertSucceeds(setDoc(doc(db, 'products', 'crew-product'), { userId: 'crew', ownerId: 'owner', name: 'New item' }));
  await assertFails(updateDoc(doc(db, 'fc_ingredients', 'ingredient'), { name: 'Tampered' }));
  await assertFails(updateDoc(doc(db, 'fc_recipes', 'recipe'), { name: 'Tampered' }));
});

test('owner and delegated staff retain protected collection management inside the tenant', async () => {
  for (const uid of ['owner', 'admin', 'manager']) {
    const db = dbFor(uid);
    await assertSucceeds(updateDoc(doc(db, 'bank_accounts', 'outlet-a'), { balance: 110, updatedAt: 3 }));
    await assertSucceeds(updateDoc(doc(db, 'expense_snapshots', 'outlet-a'), { totalPurchase: 510 }));
    await assertSucceeds(updateDoc(doc(db, 'vendors', 'vendor'), { name: `Supplier ${uid}` }));
    await assertSucceeds(updateDoc(doc(db, 'products', 'product'), { name: `Rice ${uid}` }));
    await assertSucceeds(updateDoc(doc(db, 'fc_ingredients', 'ingredient'), { name: `Rice ${uid}` }));
    await assertSucceeds(updateDoc(doc(db, 'fc_recipes', 'recipe'), { name: `Bowl ${uid}` }));
  }
  await assertSucceeds(setDoc(doc(dbFor('manager'), 'bank_accounts', 'manager-created'), {
    userId: 'owner', outletId: 'outlet-a', name: 'Manager account', balance: 0, updatedAt: 1,
  }));
  await assertFails(setDoc(doc(dbFor('manager'), 'bank_accounts', 'foreign-account'), {
    userId: 'other-owner', outletId: 'outlet-a', name: 'Foreign', balance: 0, updatedAt: 1,
  }));
  await assertSucceeds(setDoc(doc(dbFor('manager'), 'online_order_details', 'manager-online-owner'), {
    userId: 'owner', orderId: 'ORDER-1',
  }));
  await assertSucceeds(setDoc(doc(dbFor('manager'), 'online_order_details', 'manager-online-legacy'), {
    userId: 'manager', orderId: 'ORDER-LEGACY',
  }));
  await assertSucceeds(setDoc(doc(dbFor('manager'), 'rentals', 'manager-legacy-owned'), {
    userId: 'manager', outletId: 'outlet-a',
  }));
  await assertSucceeds(setDoc(doc(dbFor('manager'), 'expense_snapshots', 'manager-legacy-snapshot'), {
    userId: 'manager', outletId: 'outlet-a', month: 'October', year: '2026', totalPurchase: 10,
  }));
});

test('unauthenticated users cannot read or modify profiles and groups', async () => {
  const db = env.unauthenticatedContext().firestore();
  for (const path of ['users/owner', 'user_groups/finance']) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, path), { userId: 'owner', role: 'admin' }));
  }
});
