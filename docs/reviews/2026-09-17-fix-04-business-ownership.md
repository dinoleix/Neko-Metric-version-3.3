# Fix 04 — Business ownership for delegated staff

## Defect

Several shared-business screens queried records by `dataOwnerId` but saved new records and deterministic document IDs with the signed-in editor's `user.uid`. For a business owner those values match. For a manager or delegated admin, the write succeeds outside the tenant view and subsequently appears missing.

The affected paths included CSV source rows and import-derived snapshots, manual online sales, event sales, monthly payroll, employee records, rentals, holidays, COGS adjustments, and frozen P&L snapshots.

## Change

- New shared-business records and deterministic IDs use `dataOwnerId`.
- Upload rows and file metadata retain the acting account in `uploadedBy`; manual source rows and newly created snapshots retain it in `createdBy`.
- Personal CSV mapping preferences and Cloud Storage paths remain keyed to the signed-in user because they are personal, not tenant-owned.
- Payroll, rentals, employees, holidays, COGS adjustments, frozen P&L, and all import-derived snapshots now land in the tenant queried by their corresponding screens.
- The crew header bank-account subscription now includes the assigned outlet filter required by the outlet-scoped Firestore rule.

## Legacy records

No historical records were moved or deleted. Existing records written under a delegated editor's UID remain untouched. A separate read-only migration audit is required before any historical repair, because an owner cannot safely infer which delegated account created a legacy record from the document alone.

## Verification

- `npm run lint` — passing (`tsc --noEmit`).
- `npm run build` — passing. Existing Vite warnings remain for the empty `vendor-react` chunk and large Firebase chunk.
- `git diff --check` — passing.

This change is local only. No Firestore records or deployed rules were changed.
