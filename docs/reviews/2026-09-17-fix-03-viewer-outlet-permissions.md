# Fix 03 — Viewer read-only and crew outlet permissions

## Defect

Navigation access groups hid modules but did not make a viewer read-only at the database layer. A linked viewer could update bank accounts, expense snapshots, vendors, products, recipe-costing records, and online customers. Generic collection rules also let a viewer create self-owned business records.

Crew bank-account queries fetched every outlet and filtered in the browser. That query shape could not safely coexist with outlet-bound Firestore reads. Crew could also change bank-account metadata and overwrite CSV-owned expense snapshot fields.

## Change

- Require an `admin` or `manager` role for business-data writes unless a collection has a specific crew-terminal write path.
- Keep viewers able to read tenant data while denying creates, updates, and deletes.
- Limit crew reads and writes for bank accounts, operational ledgers, expense snapshots, and bill counters to their assigned outlet.
- Limit crew bank-account updates to `balance` and `updatedAt`.
- Limit crew expense-snapshot writes to the `crew*` aggregate fields plus snapshot identity fields; CSV totals cannot be changed by crew.
- Keep vendor and product maintenance available in Crew Terminal, while keeping recipe costing staff-only.
- Add tenant and outlet identity to bill counters and crew-created bank transactions.
- Add the assigned outlet to all Crew Terminal bank-account queries so Firestore can authorize the query.
- Pass the viewer read-only state into Cash Reality, hide its profile, cash-payment, snapshot, and delete controls, and disable transaction-to-loan mapping selectors. Guard each write handler as well, so a stale UI cannot invoke a viewer write.
- Store delegated staff changes to bank accounts, online imports/customers, and loan profiles under the business data owner queried by those screens.
- Preserve existing admin/manager records that were historically saved under the editor's own UID.

## Regression coverage

The isolated Firestore emulator suite now checks:

- viewer reads and denied mutations across protected and generic collections;
- assigned-outlet crew bank reads and balance-only updates;
- denial of other-outlet crew reads and writes;
- separation of crew expense aggregates from imported CSV totals;
- crew vendor/product access and denied recipe-costing writes;
- crew operational logs, bank transactions, and bill counters;
- owner and delegated admin/manager workflows, including legacy editor-owned records;
- cross-tenant denial and the profile/group protections from fixes 01 and 02.

## Verification

- `npm run test:rules` — 32/32 passing against the isolated `demo-neko-rules` Firestore emulator.
- `npm run lint` — passing (`tsc --noEmit`).
- `npm run build` — passing. Vite still reports the existing empty `vendor-react` chunk and large Firebase chunk warnings.
- `git diff --check` — passing.
- Viewer UI walkthrough — Cash Reality displays the financial analysis and existing mappings, with no create, delete, save, or editable mapping control exposed.

This change is local only. No Firestore rules or application build were deployed.
