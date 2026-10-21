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

/** Resolve the signed-in identity to exactly one active tenant for this session. */
export async function resolveTenantSession(userId: string): Promise<TenantSession> {
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
      .filter(membership => membership.status === 'active');
    if (activeMemberships.length > 0) break;
    if (attempt < 4) await wait(300);
  }

  if (activeMemberships.length === 0) {
    throw new Error('No active restaurant membership is linked to this account. Ask your platform administrator to invite you.');
  }
  if (activeMemberships.length > 1) {
    throw new Error('This account belongs to more than one restaurant. Multi-tenant switching is not enabled for this account yet.');
  }

  const membership = activeMemberships[0];
  const tenantSnapshot = await getDoc(doc(db, 'tenants', membership.tenantId));
  if (!tenantSnapshot.exists()) {
    throw new Error('The restaurant linked to this account could not be found. Contact your platform administrator.');
  }

  const tenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() } as Tenant;
  if (tenant.status !== 'active') {
    throw new Error('This restaurant account is currently suspended. Contact your platform administrator.');
  }

  const outletsSnapshot = await getDocs(query(
    collection(db, 'outlets'),
    where('tenantId', '==', tenant.id),
  ));
  const outlets = outletsSnapshot.docs
    .map(snapshot => ({ id: snapshot.id, ...snapshot.data() } as TenantOutlet))
    .filter(outlet => outlet.status === 'active');

  return { tenant, membership, outlets };
}
