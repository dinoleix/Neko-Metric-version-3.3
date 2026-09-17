# Fix 05 — Active outlet analytics scope

## Defect

Item Insights and Online Profit Center built their outlet selectors from every rental record. Closed stores, including NFC, appeared in the selector and were included whenever the user chose the all-store view.

## Change

- Use rentals with `status: 'active'` as the live outlet scope in Item Insights and Online Profit Center.
- Make the all-store calculation use that same active scope instead of aggregating every snapshot.
- Reset an already-selected outlet to the all-active view if that outlet is later closed.
- Label the all-store option as `All Active Outlets`.

Historical source records are retained; this change only controls the live analytics selector and aggregate scope.

## Verification

- Item Insights UI: the selector shows Deer Park B6 and Safdarjung only.
- Online Profit Center UI: the selector shows Deer Park B6 and Safdarjung only.
- `npm run lint` — passing (`tsc --noEmit`).
- `npm run build` — passing. Vite still reports the existing empty `vendor-react` chunk and large Firebase chunk warnings.
- `git diff --check` — passing.

This change is local only. No records or deployments were changed.
