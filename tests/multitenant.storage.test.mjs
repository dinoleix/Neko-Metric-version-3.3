import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, writeBatch } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';

const projectId = 'demo-neko-multitenant';
let env;
const userContext = uid => env.authenticatedContext(uid);
const membership = (tenantId, userId, role, outletIds) => ({
  tenantId, userId, role, outletIds, status: 'active', createdBy: 'seed', createdAt: 1, updatedAt: 1,
});
const image = () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8088,
      rules: await readFile(new URL('../rules/firestore.multitenant.rules', import.meta.url), 'utf8'),
    },
    storage: {
      host: '127.0.0.1',
      port: 9199,
      rules: await readFile(new URL('../rules/storage.multitenant.rules', import.meta.url), 'utf8'),
    },
  });
});

after(async () => { if (env) await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    const batch = writeBatch(db);
    for (const [id, record] of Object.entries({
      'a_owner': membership('a', 'owner', 'owner', ['*']),
      'a_manager-a1': membership('a', 'manager-a1', 'manager', ['a1']),
      'a_crew': membership('a', 'crew', 'crew', ['a1']),
      'b_other-owner': membership('b', 'other-owner', 'owner', ['*']),
    })) batch.set(doc(db, 'tenant_memberships', id), record);
    await batch.commit();
  });
});

test('tenant owners and assigned outlet members can access receipt objects', async () => {
  const ownerStorage = userContext('owner').storage();
  await assertSucceeds(uploadBytes(ref(ownerStorage, 'tenants/a/outlets/a1/receipts/crew/one.jpg'), image()));
  const managerStorage = userContext('manager-a1').storage();
  await assertSucceeds(getBytes(ref(managerStorage, 'tenants/a/outlets/a1/receipts/crew/one.jpg')));
});

test('receipt access is denied across tenants and unassigned outlets', async () => {
  const ownerStorage = userContext('owner').storage();
  await assertSucceeds(uploadBytes(ref(ownerStorage, 'tenants/a/outlets/a2/receipts/crew/two.jpg'), image()));
  const managerStorage = userContext('manager-a1').storage();
  await assertFails(getBytes(ref(managerStorage, 'tenants/a/outlets/a2/receipts/crew/two.jpg')));
  const otherTenantStorage = userContext('other-owner').storage();
  await assertFails(getBytes(ref(otherTenantStorage, 'tenants/a/outlets/a1/receipts/crew/one.jpg')));
});

test('crew may upload only their own receipt path at an assigned outlet', async () => {
  const storage = userContext('crew').storage();
  await assertSucceeds(uploadBytes(ref(storage, 'tenants/a/outlets/a1/receipts/crew/own.jpg'), image()));
  await assertFails(uploadBytes(ref(storage, 'tenants/a/outlets/a1/receipts/manager-a1/other.jpg'), image()));
  await assertFails(uploadBytes(ref(storage, 'tenants/a/outlets/a2/receipts/crew/wrong-outlet.jpg'), image()));
  await assertFails(uploadBytes(ref(storage, 'tenants/b/outlets/b1/receipts/crew/wrong-tenant.jpg'), image()));
});
