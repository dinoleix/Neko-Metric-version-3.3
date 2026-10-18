export type TenantRole = 'owner' | 'manager' | 'crew' | 'viewer';
export type TenantStatus = 'active' | 'suspended';

export interface Tenant {
  id: string;
  name: string;
  status: TenantStatus;
  currency: string;
  timezone: string;
  ownerUserId: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: TenantRole;
  outletIds: string[];
  status: TenantStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TenantOutlet {
  id: string;
  tenantId: string;
  name: string;
  status: TenantStatus;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export const tenantMembershipId = (tenantId: string, userId: string) => `${tenantId}_${userId}`;
