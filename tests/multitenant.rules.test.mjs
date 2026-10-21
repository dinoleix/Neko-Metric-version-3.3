import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore';

const projectId = 'demo-neko-multitenant';
let env;
const dbFor = uid => env.authenticatedContext(uid).firestore();
const membership = (tenantId, userId, role, outletIds) => ({
  tenantId, userId, role, outletIds, status: 'active', createdBy: 'seed', createdAt: 1, updatedAt: 1,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8088,
      rules: await readFile(new URL('../rules/firestore.multitenant.rules', import.meta.url), 'utf8'),
    },
  });
});
after(async () => { if (env) await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'tenants', 'a'), { name: 'Restaurant A', ownerUserId: 'owner-a', createdBy: 'owner-a', status: 'active', currency: 'INR', timezone: 'Asia/Kolkata', createdAt: 1, updatedAt: 1 });
    batch.set(doc(db, 'tenants', 'b'), { name: 'Restaurant B', ownerUserId: 'owner-b', createdBy: 'owner-b', status: 'active', currency: 'EUR', timezone: 'Europe/Paris', createdAt: 1, updatedAt: 1 });
    for (const [id, record] of Object.entries({
      'a_owner-a': membership('a', 'owner-a', 'owner', ['*']),
      'a_manager': membership('a', 'manager', 'manager', ['*']),
      'a_manager-a1': membership('a', 'manager-a1', 'manager', ['a1']),
      'a_crew': membership('a', 'crew', 'crew', ['a1']),
      'a_viewer': membership('a', 'viewer', 'viewer', ['a1']),
      'b_owner-b': membership('b', 'owner-b', 'owner', ['*']),
    })) batch.set(doc(db, 'tenant_memberships', id), record);
    batch.set(doc(db, 'outlets', 'a1'), { tenantId: 'a', name: 'A Outlet 1', status: 'active' });
    batch.set(doc(db, 'outlets', 'a2'), { tenantId: 'a', name: 'A Outlet 2', status: 'active' });
    batch.set(doc(db, 'outlets', 'b1'), { tenantId: 'b', name: 'B Outlet', status: 'active' });
    batch.set(doc(db, 'tenant_test_records', 'a1-record'), { tenantId: 'a', outletId: 'a1', createdBy: 'owner-a' });
    batch.set(doc(db, 'tenant_test_records', 'a2-record'), { tenantId: 'a', outletId: 'a2', createdBy: 'owner-a' });
    batch.set(doc(db, 'tenant_test_records', 'b1-record'), { tenantId: 'b', outletId: 'b1', createdBy: 'owner-b' });
    batch.set(doc(db, 'products', 'a-product'), { tenantId: 'a', name: 'A Product', createdBy: 'owner-a', updatedBy: 'owner-a' });
    batch.set(doc(db, 'products', 'b-product'), { tenantId: 'b', name: 'B Product', createdBy: 'owner-b', updatedBy: 'owner-b' });
    await batch.commit();
  });
});

test('tenant owners and HQ managers can read records within their tenant', async () => {
  await assertSucceeds(getDoc(doc(dbFor('owner-a'), 'tenant_test_records', 'a1-record')));
  await assertSucceeds(getDoc(doc(dbFor('manager'), 'tenant_test_records', 'a2-record')));
});

test('outlet managers, crew and viewers are restricted to assigned outlets', async () => {
  for (const uid of ['manager-a1', 'crew', 'viewer']) {
    await assertSucceeds(getDoc(doc(dbFor(uid), 'tenant_test_records', 'a1-record')));
    await assertFails(getDoc(doc(dbFor(uid), 'tenant_test_records', 'a2-record')));
  }
});

test('members cannot read or write records in another tenant', async () => {
  await assertFails(getDoc(doc(dbFor('owner-a'), 'tenant_test_records', 'b1-record')));
  await assertFails(getDoc(doc(dbFor('owner-b'), 'tenant_test_records', 'a1-record')));
  await assertFails(setDoc(doc(dbFor('owner-a'), 'tenant_test_records', 'cross-write'), { tenantId: 'b', outletId: 'b1' }));
});

test('tenant-scoped collection queries must prove their tenant and outlet scope', async () => {
  const ownerDb = dbFor('owner-a');
  const ownTenant = query(collection(ownerDb, 'tenant_test_records'), where('tenantId', '==', 'a'));
  await assertSucceeds(getDocs(ownTenant));
  await assertFails(getDocs(query(collection(ownerDb, 'tenant_test_records'), where('tenantId', '==', 'b'))));

  const crewDb = dbFor('crew');
  await assertSucceeds(getDocs(query(collection(crewDb, 'tenant_test_records'), where('tenantId', '==', 'a'), where('outletId', '==', 'a1'))));
  await assertFails(getDocs(query(collection(crewDb, 'tenant_test_records'), where('tenantId', '==', 'a'))));
});

test('viewers are read-only and crew can only create records at an assigned outlet', async () => {
  await assertFails(setDoc(doc(dbFor('viewer'), 'expenses', 'viewer-expense'), { tenantId: 'a', outletId: 'a1', amount: 2 }));
  await assertSucceeds(setDoc(doc(dbFor('crew'), 'crew_entries', 'crew-entry'), { tenantId: 'a', outletId: 'a1', userId: 'crew', createdBy: 'crew' }));
  await assertFails(setDoc(doc(dbFor('crew'), 'crew_entries', 'other-outlet'), { tenantId: 'a', outletId: 'a2', userId: 'crew', createdBy: 'crew' }));
  await assertFails(setDoc(doc(dbFor('crew'), 'products', 'crew-product'), { tenantId: 'a', name: 'Forbidden' }));
});

test('a tenant owner can provision and update member roles but cannot create another owner', async () => {
  const db = dbFor('owner-a');
  const memberRef = doc(db, 'tenant_memberships', 'a_new-manager');
  await assertSucceeds(setDoc(memberRef, { ...membership('a', 'new-manager', 'manager', ['*']), email: 'manager@example.test' }));
  await assertSucceeds(setDoc(memberRef, { ...membership('a', 'new-manager', 'crew', ['a1']), email: 'manager@example.test' }));
  await assertFails(setDoc(doc(db, 'tenant_memberships', 'a_attacker'), membership('a', 'attacker', 'owner', ['*'])));
});

test('new owner signup atomically creates the tenant, owner membership and first outlet', async () => {
  const db = dbFor('new-owner');
  const batch = writeBatch(db);
  batch.set(doc(db, 'tenants', 'new-tenant'), { name: 'New Restaurant', ownerUserId: 'new-owner', createdBy: 'new-owner', status: 'active', currency: 'INR', timezone: 'Asia/Kolkata', createdAt: 2, updatedAt: 2 });
  batch.set(doc(db, 'tenant_memberships', 'new-tenant_new-owner'), membership('new-tenant', 'new-owner', 'owner', ['*']));
  batch.set(doc(db, 'outlets', 'new-outlet'), { tenantId: 'new-tenant', name: 'First Outlet', status: 'active', createdBy: 'new-owner', createdAt: 2, updatedAt: 2 });
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(doc(db, 'tenants', 'new-tenant')));
});

test('a signed-in account cannot self-attach as owner to an existing tenant', async () => {
  const db = dbFor('attacker');
  await assertFails(setDoc(doc(db, 'tenant_memberships', 'a_attacker'), membership('a', 'attacker', 'owner', ['*'])));
});

test('product catalog is readable by tenant members but writable by its owner only', async () => {
  await assertSucceeds(getDoc(doc(dbFor('crew'), 'products', 'a-product')));
  await assertFails(getDoc(doc(dbFor('owner-a'), 'products', 'b-product')));
  await assertFails(setDoc(doc(dbFor('manager'), 'products', 'manager-product'), { tenantId: 'a', name: 'Nope', createdBy: 'manager', updatedBy: 'manager' }));
  await assertSucceeds(setDoc(doc(dbFor('owner-a'), 'products', 'new-product'), { tenantId: 'a', name: 'New', createdBy: 'owner-a', updatedBy: 'owner-a' }));
  await assertFails(setDoc(doc(dbFor('owner-a'), 'products', 'wrong-creator'), { tenantId: 'a', name: 'Nope', createdBy: 'attacker', updatedBy: 'attacker' }));
});
