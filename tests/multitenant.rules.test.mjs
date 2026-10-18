import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, writeBatch } from 'firebase/firestore';

const projectId = 'demo-neko-multitenant';
let env;
const dbFor = uid => env.authenticatedContext(uid).firestore();
const membership = (tenantId, userId, role, outletIds) => ({ tenantId, userId, role, outletIds, status: 'active', createdBy: 'seed', createdAt: 1, updatedAt: 1 });

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8088, rules: await readFile(new URL('../rules/firestore.multitenant.rules', import.meta.url), 'utf8') } });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, 'tenants', 'a'), { name: 'Restaurant A', ownerUserId: 'owner-a', createdBy: 'owner-a', status: 'active', createdAt: 1, updatedAt: 1 });
    batch.set(doc(db, 'tenants', 'b'), { name: 'Restaurant B', ownerUserId: 'owner-b', createdBy: 'owner-b', status: 'active', createdAt: 1, updatedAt: 1 });
    for (const [id, record] of Object.entries({
      'a_owner-a': membership('a', 'owner-a', 'owner', ['*']),
      'a_manager': membership('a', 'manager', 'manager', ['*']),
      'a_crew': membership('a', 'crew', 'crew', ['a1']),
      'b_owner-b': membership('b', 'owner-b', 'owner', ['*']),
    })) batch.set(doc(db, 'tenant_memberships', id), record);
    batch.set(doc(db, 'tenant_test_records', 'a1'), { tenantId: 'a', outletId: 'a1' });
    batch.set(doc(db, 'tenant_test_records', 'b1'), { tenantId: 'b', outletId: 'b1' });
    await batch.commit();
  });
});

test('tenant owner and HQ manager can read their tenant', async () => {
  await assertSucceeds(getDoc(doc(dbFor('owner-a'), 'tenant_test_records', 'a1')));
  await assertSucceeds(getDoc(doc(dbFor('manager'), 'tenant_test_records', 'a1')));
});
test('crew is limited to its assigned outlet', async () => {
  await assertSucceeds(getDoc(doc(dbFor('crew'), 'tenant_test_records', 'a1')));
  await assertFails(getDoc(doc(dbFor('crew'), 'tenant_test_records', 'b1')));
});
test('no tenant member can cross the tenant boundary', async () => {
  await assertFails(getDoc(doc(dbFor('owner-a'), 'tenant_test_records', 'b1')));
  await assertFails(getDoc(doc(dbFor('owner-b'), 'tenant_test_records', 'a1')));
});
