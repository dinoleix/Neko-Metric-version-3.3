# Isolated multi-tenant development environment

Created on 18 October 2026 and rechecked on 21 October 2026. This environment serves the isolated multi-tenant development app and uses no Green Neko production data, user accounts, or rules.

| Resource | Development value | Production impact |
| --- | --- | --- |
| Firebase project | `nekometrics-mt-dev-2026` | None |
| Firebase web app | `NekoMetrics Multi-Tenant Dev Web` | None |
| Firestore database | Default database provisioned in `nam5`; two synthetic tenants, owner memberships, and outlets seeded | None |
| Firestore rules | Tenant membership, outlet, role, business collection and private login-activity rules published; 14 emulator cases pass | None |
| Firestore indexes | 39 dev indexes reconciled and published, including tenant-scoped query shapes | None |
| Firebase Storage | Tenant path helper and rules are prepared; 3 emulator cases pass; Storage API enabled, but bucket setup is pending a location choice | None |
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

## Current application scope and acceptance status

The dev build resolves the signed-in user's active memberships and tenant outlets, then opens the existing NekoMetrics modules through a tenant-aware Firestore boundary. Accounts with multiple memberships choose and switch their active restaurant. Collection queries add `tenantId`; new writes inherit it. Isolated Firestore rules enforce tenant, outlet and role access. The dev login supports email/password signup that atomically creates a tenant, owner membership and first outlet. Owners can provision and manage tenant memberships. Existing production-only user profiles and Google sign-in are not used in the isolated path.

New tenant receipts use authenticated Storage reads and tenant/outlet paths; old receipt download URLs remain legacy bearer links if present in a tenant dataset. Do not migrate those links without converting the underlying object and validating access.

The local TypeScript check, both app builds, 14 Firestore emulator cases, 3 Storage emulator cases, and the emulator-only migration rehearsal pass. The rehearsal migrates 19 synthetic records across 19 collection shapes, reports one unmapped outlet, verifies exact target checksums, refuses target collisions and detects tampering. The build emits an existing large-chunk warning. The latest Firestore rules and dev-only indexes are published. Before a Green Neko rehearsal, finish Storage bucket setup, verify the current Vercel deployment, exercise both synthetic tenants plus owner/manager/crew/viewer accounts in the live preview, then run the rehearsal with an approved synthetic export. No Green Neko data has been imported; the local rehearsal is a safeguard prototype, not the production migration job, and there is no production cutover approval.

## Local development

1. Copy `.env.multitenant-dev.example` to `.env.multitenant-dev.local`.
2. Fill in the isolated Firebase browser configuration only.
3. Run `npm run dev:multitenant`.
4. Run `npm run build:multitenant` before committing.

The `.env.multitenant-dev.local` file is ignored by Git. Never put production API keys or a production Firebase project ID in it.
