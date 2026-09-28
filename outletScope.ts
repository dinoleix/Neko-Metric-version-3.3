import { where, type QueryConstraint } from 'firebase/firestore';
import type { UserProfile } from './types';

/** Empty means HQ/all-store access. Only managers use the scoped variant. */
export const managerOutlet = (profile?: UserProfile | null): string | null =>
  profile?.role === 'manager' && profile.assignedOutlet ? profile.assignedOutlet : null;

export const outletConstraint = (profile?: UserProfile | null): QueryConstraint[] => {
  const outletId = managerOutlet(profile);
  return outletId ? [where('outletId', '==', outletId)] : [];
};

export const rowsInManagerScope = <T extends { outletId?: string }>(
  rows: T[],
  profile?: UserProfile | null,
): T[] => {
  const outletId = managerOutlet(profile);
  return outletId ? rows.filter(row => row.outletId === outletId) : rows;
};
