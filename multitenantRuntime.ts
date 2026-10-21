import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from './tenantFirestore';
import type { Tenant, TenantMembership, TenantOutlet } from './tenantTypes';
import { db } from './firebase';

export type TenantSession = {
  tenant: Tenant;
  membership: TenantMembership;
  outlets: TenantOutlet[];
};

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Resolve every active tenant membership available to a signed-in identity. */
export async function resolveTenantSessions(userId: string): Promise<TenantSession[]> {
  const membershipQuery = query(
    collection(db, 'tenant_memberships'),
    where('userId', '==', userId),
  );
  let activeMemberships: TenantMembership[] = [];
  // Auth can emit its signed-in event a moment before the atomic tenant signup
  // batch is visible. Retry briefly so a new owner lands in the app cleanly.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const membershipSnapshot = await getDocs(membershipQuery);
    activeMemberships = membershipSnapshot.docs
      .map(snapshot => ({ id: snapshot.id, ...snapshot.data() } as TenantMembership))
      .filter(membership => membership.userId === userId && membership.status === 'active');
    if (activeMemberships.length > 0) break;
    if (attempt < 4) await wait(300);
  }

  if (activeMemberships.length === 0) {
    throw new Error('No active restaurant membership is linked to this account. Ask your platform administrator to invite you.');
  }
  const sessions = await Promise.all(activeMemberships.map(async membership => {
    const tenantSnapshot = await getDoc(doc(db, 'tenants', membership.tenantId));
    if (!tenantSnapshot.exists()) return null;
    const tenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() } as Tenant;
    if (tenant.status !== 'active') return null;

    const membershipHasAllOutlets = membership.role === 'owner'
      || membership.role === 'manager' && membership.outletIds.includes('*');
    const outletSnapshots = membershipHasAllOutlets
      ? (await getDocs(query(collection(db, 'outlets'), where('tenantId', '==', tenant.id)))).docs
      : (await Promise.all(membership.outletIds.map(outletId => getDoc(doc(db, 'outlets', outletId)))))
        .filter(snapshot => snapshot.exists() && snapshot.data().tenantId === tenant.id);
    const outlets = outletSnapshots
      .map(snapshot => ({ id: snapshot.id, ...snapshot.data() } as TenantOutlet))
      .filter(outlet => outlet.status === 'active');
    return { tenant, membership, outlets };
  }));
  const activeSessions = sessions.filter((session): session is TenantSession => session !== null);
  if (activeSessions.length === 0) {
    throw new Error('No active restaurant is linked to this account. Contact your platform administrator.');
  }
  return activeSessions;
}
