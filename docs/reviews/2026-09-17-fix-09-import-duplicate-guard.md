# Fix 09 — exact CSV import duplicate guard

## Problem

Each CSV upload previously created new raw records and incremented monthly snapshots, even when it was a retry of the same source file. That could double sales, commissions, items, purchases, or expenses in reports.

## Change

The importer now fingerprints the mapped rows and import context (business, type, month, year, outlet, and platform). It uses that fingerprint as a deterministic import manifest before storage upload, raw record writes, or snapshot aggregation begins.

- A completed matching import is rejected before it changes any data.
- A matching import already in progress is rejected, preventing a second browser from starting it.
- A failed storage upload can be retried because it wrote no raw data.

The guard intentionally considers mapped content rather than the filename, so renaming an identical export does not bypass it. A revised export has a different fingerprint and imports normally.

## Validation

- `npm run lint`
- `npm run build`
- `git diff --check`
