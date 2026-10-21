# Green Neko migration runbook

This runbook is intentionally a plan. Do not use it against production until every precondition is checked and the production migration is explicitly approved.

## 1. Isolated environment

Create these separately from production:

- A dedicated Firebase project for multi-tenant development.
- A dedicated Vercel project connected to the multi-tenant branch.
- Separate Firebase web configuration and environment variables.
- Test users for two unrelated restaurant tenants.
- Synthetic test CSV files, purchases, inventory counts and recipe data.

No production Auth user, Firestore document, Storage object, API secret or Vercel production environment variable is copied casually into the development environment.

## 2. Backups and baseline evidence

Before the real migration:

- Export Firestore and record the export location and timestamp.
- Back up Firebase Authentication users and document the restore method.
- Preserve Storage files and their paths.
- Record deployed Firestore rules, indexes, Vercel configuration and current production commit.
- Produce baseline totals by outlet and month for sales, purchases, expenses, inventory and P&L.

A Git tag does not replace these backups.

## 3. Migration mechanics

The migration must be a trusted, resumable, idempotent job. It should:

1. Create the `green-neko` tenant and its outlet records.
2. Create a membership for each existing Green Neko user.
3. Process one source collection at a time in small batches.
4. Add `tenantId` and preserve legacy fields unchanged.
5. Record a migration manifest: source collection, document ID, status, attempt count, checksum/version and timestamps.
6. Skip documents already migrated with the same migration version.
7. Produce an exceptions report instead of silently guessing a missing outlet or ownership mapping.

No migration may delete, rename or overwrite original production documents during its first pass.

### Current synthetic safeguard

Run `npm run rehearse:multitenant-migration` to exercise additive migration, immutable legacy fields, outlet mapping, checksums, retry manifests, exception reporting, replay idempotency and count/amount reconciliation against synthetic data. The script requires the local Firestore emulator and the exact `demo-neko-migration-rehearsal` project ID; it refuses to run against a live Firebase project. Its `rehearsal_source_*`, `rehearsal_target_*` and `rehearsal_manifest_*` collections are disposable emulator fixtures. This validates the safety mechanics only; collection-specific mappings and a production credentialed migration job still need review against an approved synthetic export.

## 4. Reconciliation gates

For each outlet and selected period, compare before and after:

- raw sales count and total revenue
- online sales count and total revenue
- purchases and expenses by category
- crew entries and daily sales logs
- inventory counts and frozen status
- recipe/ingredient master count
- closing stock values
- P&L sales, COGS, operating expenses and profit
- users, role assignments and outlet access

All differences must be zero or documented and approved before cutover.

## 5. Cutover

Use a compatibility release:

- reads use `tenantId` first and only use legacy ownership fields for an unconverted Green Neko record;
- new writes always include `tenantId`;
- every import fingerprint is tenant-scoped;
- platform and tenant support actions create an audit record;
- a tenant user cannot select or query another tenant.

Run a short, scheduled acceptance test for Green Neko owner, HQ manager, outlet manager, crew and viewer before enabling the production tenant path.

## 6. Rollback

If a reconciliation or permission test fails:

- stop the tenant-enabled release;
- return application reads to the existing production path;
- do not delete migration manifests or added fields;
- restore only from the recorded backup if an actual production data write needs reversal;
- investigate in the isolated environment before a new cutover attempt.
