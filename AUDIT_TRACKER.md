# Neko Metric v3.3 — Audit Progress Tracker

Last updated: 2026-05-24 — All 15 bugs fixed ✅

---

## BUGS (15 total)

### CRITICAL
| ID | File | Description | Status |
|----|------|-------------|--------|
| BUG-01 | PnLHub.tsx ~L305,L410 | P&L Freeze uses legacy single `adjustmentAmount` instead of 4 sub-buckets → frozen vs live P&L diverge | ✅ Done |
| BUG-02 | PnLHub.tsx ~L412 | P&L Freeze double-counts CSV variable labour + payroll_entries → overstated payroll in frozen snapshots | ✅ Done |
| BUG-03 | ExecDashboard.tsx ~L113,152 | CEO Dashboard double-counts labour in OpEx Burden → Total Burden systematically overstated | ✅ Done |

### HIGH
| ID | File | Description | Status |
|----|------|-------------|--------|
| BUG-04 | CashFlowTracker.tsx ~L87 | `new Date(bt.date)` parsed as UTC → IST boundary off-by-one in EMI date matching | ✅ Done |
| BUG-05 | IntegrityAudit.tsx ~L75 | Same IST parse bug → boundary records misclassified in Integrity Guardian | ✅ Done |
| BUG-06 | RawSalesHub.tsx ~L453 | Edit path always increments online snapshot fields even for POS sales → corrupts channel split | ✅ Done |
| BUG-07 | WasteHub.tsx ~L96 + WasteManagementV2.tsx ~L138 | Type filter includes all items in entry when only one matches → overstated waste cost totals | ✅ Done |
| BUG-08 | ExpenseHub.tsx ~L241 | Bank-pushed COGS not added to cogsBucketAgg → pie/bar charts inconsistent with headline total | ✅ Done |
| BUG-09 | ExpenseHub.tsx — trajectory L944,966,988,996 | Division by zero when trajectoryData.length === 1 → invisible chart for single-month | ✅ Done |

### MEDIUM
| ID | File | Description | Status |
|----|------|-------------|--------|
| BUG-10 | SalesHub.tsx ~L252 | `avgDailyOrders` hardcodes 30-day divisor → wrong for Feb and 31-day months | ✅ Done |
| BUG-11 | OnlineProfitCenter.tsx ~L417 | Custom velocity end date hardcoded to day 28 → days 29–31 silently excluded | ✅ Done |
| BUG-12 | Reports.tsx ~L284 | "Gross Profitability" label is wrong — renamed to "Net Revenue Yield %" | ✅ Done |
| BUG-13 | PartnershipModel.tsx ~L183 | `Math.max()` of two labour sources discards the lower → uses payroll_entries when available, falls back to CSV | ✅ Done |
| BUG-14 | projectionService.ts ~L22 | No `orderBy` on snapshot query → wrong months fed to AI projections at >24 snapshots; limit raised to 60 | ✅ Done |
| BUG-15 | RawSalesHub.tsx ~L108 | Full collection fetch on every tab switch, no pagination → capped at limit(500) per query | ✅ Done |

---

## IMPROVEMENTS (10 total)

| ID | Feature | Gap | Status |
|----|---------|-----|--------|
| IMP-01 | Waste type filter | Re-aggregate cards using only filtered item subset | ⬜ Pending |
| IMP-02 | IntegrityAudit tax label | Hardcoded "5% tax" text | ⬜ Pending |
| IMP-03 | ItemSalesHub velocity | totalDays hardcoded to 30/month | ⬜ Pending |
| IMP-04 | projectionService dates | UTC `new Date()` for forecast window → IST off-by-one | ⬜ Pending |
| IMP-05 | BankReconciliation push | Does not update expense_snapshots atomically | ⬜ Pending |
| IMP-06 | Rentals escalation | Shows "+−10%" when currentRent < baseRent | ⬜ Pending |
| IMP-07 | BankManagement ledger state | Modal and inline card share state → race condition | ⬜ Pending |
| IMP-08 | Dashboard file-delete rollback | IST date parse bug on snapshot key computation | ⬜ Pending |
| IMP-09 | ExecDashboard auto-select | Can auto-select a future month if snapshot exists | ⬜ Pending |
| IMP-10 | ItemSalesHub combos | No explanation when combo data is empty for old uploads | ⬜ Pending |

---

## MODIFICATIONS (8 total)

| ID | Feature | Problem | Status |
|----|---------|---------|--------|
| MOD-01 | P&L Freeze write path | Writes legacy single `adjustmentAmount`; needs 4-bucket migration | ⬜ Pending |
| MOD-02 | WasteHub standalone page | Dead code — duplicate of WasteManagementV2 Serving Waste tab | ⬜ Pending |
| MOD-03 | BankReconciliation "Push to Purchases" | No confirmation modal, no snapshot update | ⬜ Pending |
| MOD-04 | projectionService model name | Hardcoded `"gemini-3-flash-preview"` will break on model change | ⬜ Pending |
| MOD-05 | IntegrityAudit Firestore queries | Full collection scan — unworkable at scale | ⬜ Pending |
| MOD-06 | Reports Financial Hub | Aggregates raw records in memory — use snapshots instead | ⬜ Pending |
| MOD-07 | PartnershipModel labour baseline | `Math.max()` → should be weighted average | ⬜ Pending |
| MOD-08 | Dashboard availability matrix | `slice(1,4)` may exclude current year | ⬜ Pending |

---

## NEW FEATURES (12 total)

| ID | Feature | Priority | Status |
|----|---------|----------|--------|
| NEW-01 | Cross-Outlet P&L Comparison Dashboard | High | ⬜ Pending |
| NEW-02 | Menu Price Optimization Engine | High | ⬜ Pending |
| NEW-03 | Labour Cost Per Cover Tracker | High | ⬜ Pending |
| NEW-04 | Automated Closing Stock Reconciliation Wizard | Medium | ⬜ Pending |
| NEW-05 | Daily Sales vs Budget Tracker with Alerts | High | ⬜ Pending |
| NEW-06 | Vendor Payment Matching Report | Medium | ⬜ Pending |
| NEW-07 | Item-Level Waste Probability Scoring | Medium | ⬜ Pending |
| NEW-08 | Payroll Intelligence Dashboard | Medium | ⬜ Pending |
| NEW-09 | Cash Collection Reconciliation (POS → Bank) | High | ⬜ Pending |
| NEW-10 | Franchise/Partner Financial Performance PDF | Low | ⬜ Pending |
| NEW-11 | SKU Margin Decay Alert System | High | ⬜ Pending |
| NEW-12 | Unified Transaction Search | Medium | ⬜ Pending |

---

## Legend
- ⬜ Pending
- 🔄 In Progress
- ✅ Done
