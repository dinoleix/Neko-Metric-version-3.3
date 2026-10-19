# Isolated multi-tenant development environment

Created on 18 October 2026 and rechecked on 19 October 2026. This environment serves the isolated multi-tenant development app and uses no Green Neko production data, user accounts, or rules.

| Resource | Development value | Production impact |
| --- | --- | --- |
| Firebase project | `nekometrics-mt-dev-2026` | None |
| Firebase web app | `NekoMetrics Multi-Tenant Dev Web` | None |
| Firestore database | Default database provisioned in `nam5`; two synthetic tenants, owner memberships, and outlets seeded | None |
| Firestore rules | Multi-tenant starter rules published | None |
| Firebase Authentication | Email/Password enabled for isolated test accounts | None |
| Vercel project | `neko-metrics-multitenant-dev`; connected to `dinoleix/Neko-Metric-version-3.3`; first Production deployment from the isolated branch succeeded | None |
| Vercel Firebase configuration | Six isolated `VITE_FIREBASE_*` variables scoped to Production and Preview | None |
| Git branch | `codex/multitenant-foundation` | Separate from `main` |

## Branch behaviour

- `main` remains the production branch and continues to deploy the existing NekoMetrics site.
- `codex/multitenant-foundation` is the development branch and the Production branch for the separate Vercel development project.
- The separate Vercel project is connected to the repository and its build command is `npm run build:multitenant`. Its first Production deployment succeeded at `neko-metrics-multitenant-dev.vercel.app`.
- The existing production Vercel project and production Firebase project are not relinked or changed.

## Synthetic acceptance fixtures

| Tenant | Tenant ID | Owner test account | Outlet ID |
| --- | --- | --- | --- |
| Green Neko Demo | `tn_7f3e2a1c9b4d` | `green-neko-demo-owner@nekometrics-mt-dev.test` | `out_1a5c9f4e` |
| Separate Demo Restaurant | `tn_c4b51d8e2a76` | `demo-restaurant-owner@nekometrics-mt-dev.test` | `out_6b0d8e31` |

Both owners have active `owner` memberships. The accounts and all records above are synthetic and exist only in the isolated Firebase project. Passwords are user-chosen and are not stored in this repository. Do not import Green Neko production data.

## Remaining multi-tenant application work

The isolated app now has a runtime tenant entry path: it resolves the signed-in account's active membership, tenant, and accessible outlets, and renders a tenant-scoped preview. A dev-only data probe writes and reads synthetic notes scoped to the active tenant and outlet so the two demo accounts can be compared manually. Product Catalog is the first business module wired into this path and scopes records by `tenantId`; the isolated rules change for `products` is prepared locally but still needs publication and live acceptance. The isolated login path does not create legacy `users` profiles or expose Google sign-in. Other business modules remain outside this path until their reads and writes are migrated to tenant-scoped collections.

The membership-discovery rule is published to `nekometrics-mt-dev-2026`; it lets a signed-in user discover only their own membership before loading the tenant. This rules update applies only to the isolated Firebase project. The latest preview deployment is Ready at `neko-metrics-multitenant-dev.vercel.app`.

Remaining work includes tenant-scoping the business collections and their queries/writes, migrating user/role and outlet authorization to tenant memberships, then running the two-tenant isolation acceptance against the isolated Firebase project.

## Local development

1. Copy `.env.multitenant-dev.example` to `.env.multitenant-dev.local`.
2. Fill in the isolated Firebase browser configuration only.
3. Run `npm run dev:multitenant`.
4. Run `npm run build:multitenant` before committing.

The `.env.multitenant-dev.local` file is ignored by Git. Never put production API keys or a production Firebase project ID in it.
