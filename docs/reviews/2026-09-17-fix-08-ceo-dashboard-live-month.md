# Fix 08 — CEO Dashboard live-month clarity

## Problem

The CEO Dashboard built its outlet selector and league from historical sales and expense snapshots. A closed outlet could therefore appear in the current operating view. It also reported “No exceptions” and displayed a CSV-based profit result during a live month before the monthly sales CSV existed.

## Change

- Active rentals now define the CEO Dashboard’s outlet selector and outlet league.
- When the selected period is the current month and its CSV sales snapshots have no settled revenue, the dashboard shows a clear informational alert.
- The CSV-based net-profit tile and outlet-profit ranking are suppressed for that condition. Live counter-sales pace and crew-entered costs remain visible.

The separate Crew P&L remains the daily operational report; the CSV P&L remains the month-end report.

## Validation

- `npm run lint`
- `npm run build`
- `git diff --check`
