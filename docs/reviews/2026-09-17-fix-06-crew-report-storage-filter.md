# Fix 06 — Storage in Crew Reports

## Defect

Crew Terminal exposes `STORAGE` as a purchase category, but Crew Reports built its category selectors solely from entries found in the currently selected date, store, and type scope. If that slice had no Storage entry, staff could not select Storage at all.

## Change

- Keep the built-in inventory category `STORAGE` available in the Purchases & Expenses category filter and the category-trend selector.
- Retain the existing data-driven category options for all other categories.

Selecting Storage with no matching entry now produces a zero-total, empty report rather than hiding the category.

## Source boundary

Crew Reports reads `crew_entries` only. Expense Hub's Storage card may include imported purchases (`purchaseByCategory`), paid crew purchases (`crewPurchaseByCategory`), and pending crew purchases (`crewPendingPurchaseByCategory`). A Storage total can therefore exist in Expense Hub while the current Crew Report slice has no matching crew entry.

## Verification

- Crew Reports UI: `STORAGE` is visible and selectable in the Purchases & Expenses category filter.
- With the current report scope selected, the filter correctly shows zero entries and zero spend.
- `npm run lint` — passing (`tsc --noEmit`).
- `npm run build` — passing. Vite still reports the existing empty `vendor-react` chunk and large Firebase chunk warnings.
- `git diff --check` — passing.

This change is local only. No records or deployments were changed.
