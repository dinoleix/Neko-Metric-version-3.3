# NekoMetrics multi-tenant foundation

## Purpose

Turn NekoMetrics from its current single-business ownership model into a platform that can safely serve independent restaurant businesses. This work is deliberately isolated from the production `main` branch and from the current Firebase project.

## Current model

Current documents commonly identify the Green Neko business with `userId`, `ownerId`, or both. Some operational records also carry `outletId`. This works for one business owner with managers and crew, but it is not a complete tenant boundary: the owner identifier is doing two jobs at once (person identity and business identity).

## Target model

Every business-owned record must have an immutable `tenantId`. A record can also have an `outletId` where it belongs to a specific store.

```ts
type TenantScopedRecord = {
  tenantId: string;
  outletId?: string;
  createdBy: string;
  updatedBy?: string;
  createdAt: number;
  updatedAt?: number;
};
```

The first tenant for production will be `green-neko`. Its technical ID must be generated once when the tenant is created; it must not be derived from a user UID, business name, or outlet name.

## Core collections

| Collection | Purpose |
| --- | --- |
| `tenants` | Business profile, operational settings, status, timezone and currency. |
| `tenant_memberships` | User membership, role and approved outlet access within a tenant. |
| `outlets` | Store records owned by a tenant. |
| `tenant_settings` | Business-specific report, import, financial-year and feature settings. |
| `platform_users` | Optional platform-support role only. This must stay separate from a tenant membership. |

A user can have more than one membership. A browser session has one **active tenant** at a time. Users with multiple memberships choose a restaurant after sign-in and can switch from the app navigation; each switch resets the tenant-scoped module tree and Firestore context.

## Access model

| Role | Scope |
| --- | --- |
| Platform admin | Platform setup and audited support. Not a restaurant-operational role. |
| Tenant owner | Full access to one business. |
| HQ manager | All outlets of one business. |
| Outlet manager | One assigned outlet of one business. |
| Crew | One assigned outlet of one business. |
| Viewer | Read-only, tenant-defined outlet scope. |

No role can access a record just because it knows an ID. Firestore rules must prove an active membership whose `tenantId` matches the document. Outlet-limited roles must also match `outletId`.

## Implementation rules

1. `tenantId` is assigned by trusted application code and cannot be changed after creation.
2. Queries must include `where('tenantId', '==', activeTenantId)` before any outlet, period, or category filters.
3. New IDs must use `tenantId`, not the prior owner UID, as their business prefix.
4. Legacy `userId` and `ownerId` remain readable during migration only. They must not be used as the final tenant boundary.
5. All imports, aggregates and snapshots inherit the source file's `tenantId`.
6. A change is complete only when the UI, write path, Firestore rules and emulator tests all enforce the same scope.

## Delivery phases

1. **Foundation audit** — inventory every collection, query, write path and rule.
2. **Isolated environment** — separate Firebase project, Vercel project, test users and test data.
3. **Tenant kernel** — tenant context, memberships, outlets and rules in the isolated environment.
4. **Module conversion** — master data, operations, imports, financial reports, then intelligence modules.
5. **Two-tenant acceptance** — prove isolation using Green Neko Demo and a separate demo restaurant.
6. **Green Neko migration rehearsal** — idempotent migration plus reconciliation reports in the isolated environment.
7. **Production cutover** — only after an approved backup, verified reconciliation and a rollback plan.

See `COLLECTION-INVENTORY.md` and `MIGRATION-RUNBOOK.md` for the first deliverables.
