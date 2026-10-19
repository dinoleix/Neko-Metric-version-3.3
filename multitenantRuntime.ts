import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import type { Tenant, TenantMembership, TenantOutlet } from './tenantTypes';
import { db } from './firebase';

export type TenantSession = {
  tenant: Tenant;
  membership: TenantMembership;
  outlets: TenantOutlet[];
};

/** Resolve the signed-in identity to exactly one active tenant for this session. */
export async function resolveTenantSession(userId: string): Promise<TenantSession> {
  const membershipQuery = query(
    collection(db, 'tenant_memberships'),
    where('userId', '==', userId),
  );
  const membershipSnapshot = await getDocs(membershipQuery);
  const activeMemberships = membershipSnapshot.docs
    .map(snapshot => ({ id: snapshot.id, ...snapshot.data() } as TenantMembership))
    .filter(membership => membership.status === 'active');

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
