# NekoMetrics application review — 16 September 2026

## Scope and confidence

Repository review of the 29 registered application modules, shared financial/costing services, Firebase rules, Gemini endpoint, build configuration, and the untracked read-only MCP server. Deep inspection focused on permissions, imports, edits, bank movements, P&L, recipes, and reporting. This is a broad source review, not an exhaustive line-by-line certification or an authenticated browser acceptance test.

Validation: `npm run lint` and `npm run build` passed; `node --check mcp/server.mjs` passed. Two isolated probes against the installed Firebase SDK confirmed committed-batch reuse failure and literal dotted fields in `set(..., {merge:true})`. Neither probe sent database writes. No production data, deployed rules, credentials, or live balances were tested or changed. No application implementation was changed.

The build warns about a 658.52 kB Firebase chunk and an empty vendor-react chunk. No application test/spec files or test script were found. The existing AUDIT_TRACKER.md is an older record, not reliable evidence that current behavior is correct.

## Assessment

The product has substantial useful coverage: sales, expenses, bank reconciliation, stock-adjusted P&L, recipe publishing, menu prices, waste, consumables, and staff operations. Existing improvements worth preserving include lazy module loading, shared COGS helpers, nested recipe-error propagation, recipe publication blocking, and authenticated server-side AI calls.

The highest-value work is to make financial results trustworthy and permissions enforceable. More dashboards should follow that work. The major recurring design problems are inconsistent tenant ownership, client-side multi-step financial writes, multiple representations of the same totals, and repeated calculations across screens.

## Defects and risks, ordered by priority

### D01 — Critical: general Firestore rule bypasses user-profile restrictions

Evidence: `firestore.rules:89-138`, `firestore.rules:440-465`.

The comment claiming `/users` and `/user_groups` never reach the general rule is incorrect. Matching allow rules are additive. The general `/{collection}/{docId}` rule also matches these paths. Own-profile updates permit adding non-protected fields such as `userId`; once a profile carries the caller's userId, the general rule can authorize writes to protected role/tenant fields. A missing profile can also be created through the broad rule with a caller-owned userId and privileged fields.

Impact: intended anti-escalation restrictions are bypassable under the checked-in rules. Production exposure depends on whether these rules are deployed; no live exploit was attempted.

Fix: replace the broad write rule with explicit collection permissions, or explicitly exclude protected collections; allowlist profile fields; test self-promotion, self-linking, and delegated-admin boundaries in a Firestore emulator.

Firebase confirms that any matching true allow condition grants access: https://firebase.google.com/docs/rules/rules-behavior#overlapping_match_statements

### D02 — Critical: staff can modify another tenant's crew and waste entries

Evidence: `firestore.rules:313-334`.

The update/delete conditions for `crew_entries` and `waste_entries` include `|| isTenantStaff()` without checking the record's tenant. An admin or manager can therefore modify/delete a known document in another tenant. Create rules also accept the caller's userId without validating ownerId/outlet assignment.

Fix: require tenant and role together, preserve ownership fields on update, and validate the assigned outlet for crew writes. Test with two independent tenants and known document IDs.

### D03 — High: viewer and outlet restrictions are not enforced consistently

Evidence: `firestore.rules:159-164`, `firestore.rules:209-270`, `firestore.rules:311-329`, `firestore.rules:338-347`; `moduleAccess.ts:4-36`.

Linked users can update bank accounts, expense snapshots, products, vendors, and recipe data through rules that do not distinguish viewers from editors. `crew_entries` read access includes a broad owner link, which defeats the narrower same-outlet branch. Access groups explicitly filter navigation only and fall back to broader role defaults when unavailable.

Fix: separate navigation preferences from actual permissions; enforce tenant, role, outlet, and allowed fields on the server. A finance-only group must not imply that payroll or recipe data is inaccessible unless backend rules enforce that restriction.

### D04 — High: delegated users save records outside the business they are viewing

Evidence: `components/Uploader.tsx:658-690`; `components/PnLHub.tsx:517-523`; `components/Team.tsx:127-143,180`; `components/Rentals.tsx:66,101`; `components/HolidayRegistry.tsx:42,71`.

Readers query dataOwnerId, but multiple writers persist user.uid in ownership fields and document IDs. For an owner these coincide; for a manager/delegated admin they do not. Imports, payroll, rental records, holidays, and frozen P&L can be saved successfully and disappear from the business view.

Fix: standardize business ownership on dataOwnerId and record the acting user separately as createdBy/updatedBy. Review existing records for this split before migrating anything.

### D05 — High: raw edits do not update nested snapshot totals correctly

Evidence: `components/RawSalesHub.tsx:494-525`.

`batch.set(..., {merge:true})` receives keys such as `purchaseByCategory.FOOD` and `cogsBucketAgg.FOOD`. The installed SDK serializes these as single literal field names, not nested paths. Reports continue reading the original nested maps, while a top-level purchase total may change. `dailyTrend.0` has the same problem; dailyTrend is an array and requires an array-aware update strategy.

A further issue at lines 522-523: moving between two categories in the same COGS bucket assigns the same object property twice, replacing the subtraction with the addition instead of combining the deltas.

Fix: use proper nested field updates, accumulate each bucket's net delta, and transactionally update daily arrays. Rebuild affected snapshots from source records after correction.

### D06 — High: large customer imports fail after the first 400 writes

Evidence: `components/Uploader.tsx:1033-1050`, `components/Uploader.tsx:1233-1262`.

Both customer loops commit a batch at 400 but reuse that same batch object for subsequent writes. The installed SDK throws `failed-precondition: A write batch can no longer be used after commit() has been called.` This happens on the next qualifying write, e.g. customer 401. Earlier source records and aggregates may already have been saved.

Fix: instantiate a fresh batch after every commit and add boundary coverage for 399/400/401/800/801 qualifying records.

### D07 — High: imports are neither resumable nor idempotent

Evidence: `components/Uploader.tsx:654-759,865-888,1012-1050,1118-1127`.

Uploads create a file entry, write randomly identified source records in batches, then update snapshots separately using increments and read/modify/write maps. A failure can leave partial source data or missing aggregates. Retrying/re-uploading creates fresh records and can count the same sales or costs again. Concurrent uploads can also overwrite read/modify/write aggregates.

Fix: stable import and source-row IDs, duplicate detection, staged/validated/committed states, resumable progress, and deterministic snapshot rebuilding. Preserve original source files and an import audit trail.

### D08 — High: bank-derived purchases can be missing from monthly reporting

Evidence: `components/BankReconciliation.tsx:978-1014`.

Push to Purchases creates a purchase and updates the bank line separately. It does not update expense_snapshots, does not assign an outlet in the new purchase, and writes the current user's ID. A failed second write leaves an unmatched purchase and a retry can create another one. Snapshot-based P&L does not receive this cost through this handler.

Fix: require outlet/category, use a deterministic purchase ID derived from the bank transaction, commit source/link changes atomically, and rebuild the affected reporting snapshot.

### D09 — High: settling a bill can double-deduct or incompletely update cash

Evidence: `components/CrewTerminal.tsx:804-875`, `components/CrewTerminal.tsx:1296-1350`.

Entry status, account balance, and bank ledger are independent writes. Bulk settlement uses locally loaded pending bills without a transactional pending-to-paid check. Two sessions can settle the same bill and each decrement the balance. A failure after marking paid or after deducting the balance leaves contradictory records; bank movement failures are caught separately.

Fix: one transaction per bill covering status, account movement, and deterministic ledger record; reject already-settled bills. Use an explicit recoverable error state for any external or derived work.

### D10 — High: incomplete P&L can display extreme percentages and be frozen

Evidence: `components/PnLHub.tsx:444-469,514-523`.

The margin denominator falls back to 1 when revenue is zero. With no sales loaded and ₹50,000 costs, this can display a -5,000,000% net margin. Freeze checks readOnly and confirmation, but not required source completeness, stock validity, or payroll validation. The break-even helper already handles missing revenue; the rest of the P&L does not consistently do so.

Fix: show unavailable percentages when their denominator is missing/zero, distinguish legitimate zero sales from missing feeds, and require an outlet/period closing checklist before freezing. Carry provenance and completeness into frozen snapshots.

### D11 — High: frozen and live P&L use different expense calculations

Evidence: `components/PnLHub.tsx:397-429` versus `components/PnLHub.tsx:482-514`.

Live P&L prorates rent and fallback salaries when an outlet closes during the selected month. Freeze uses full currentRent and full fallback employee salaries. The same outlet and period can therefore acquire a different profit after freezing. Live POS net is calculated as gross minus tax while freeze uses the stored posGoodNet, adding another potential divergence.

Fix: build both display and freeze payload from the same per-outlet calculation result. Assert matching values before saving, with closure-month fixtures.

### D12 — Medium: Raw Data Verify silently inspects only a subset

Evidence: `components/RawSalesHub.tsx:106-130,154 onward,611`.

Queries cap records at 500 (1,000 for platform items), then filter by date/outlet locally. No cursor pagination fetches the remaining records. Recent data may be absent despite existing in the database, and displayed audit totals are partial. The platform-items renderer applies an additional 500-row slice.

Fix: filter period/outlet in the query, use stable ordering and cursor pagination, and distinguish page subtotals from full-scope totals.

### D13 — Medium: integrity matching can join unrelated outlet orders

Evidence: `components/IntegrityAudit.tsx:68-86,103-135`.

The audit fetches the entire tenant's sales and items before filtering. Its lookup keys only by orderId/refNo, so duplicate identifiers across outlets or dates overwrite one another in All Outlets mode. This can produce false discrepancies or false matches.

Fix: use a source-defined composite order key including outlet/platform/date where required; report ambiguous matches rather than picking the last record; constrain reads to the requested period.

### D14 — Medium: item velocity assumes every month has 30 days

Evidence: `components/ItemSalesHub.tsx:291,321`.

Per-day quantities divide by 30 or historyLength × 30. February, 31-day months, and partial periods have biased velocity figures.

Fix: define whether velocity means per calendar day, elapsed day, or trading day, label it, and calculate the corresponding denominator.

### D15 — Medium: AI proxy lacks application-level usage boundaries

Evidence: `api/gemini.ts:77-122`.

The proxy verifies a Firebase token, which is good, but forwards caller-selected model, contents, and config without a tenant role check, model allowlist, or an application quota. Signed-in viewers/crew can call it directly regardless of whether the UI exposes AI tools. No explicit application-level output budget/rate limiter was found here.

Fix: authorize the operation, allowlist models/config, bound input/output, and record usage per tenant. Infrastructure protections, if any, were not inspected.

## Features to consolidate

| Current surfaces | Recommendation | Preserve |
|---|---|---|
| P&L Command + P&L Command (Crew) | One P&L workspace with explicit revenue source and paid/pending basis controls | Crew till versus imported sales reconciliation; do not add overlapping sales together |
| CEO Dashboard + Margin Intelligence + P&L trends | Keep CEO overview, put detailed profitability/trends under Finance | One calculation contract and drill-through to the underlying rows |
| Operations Control + Data Catalog + Raw Data Verify + Data Integrity + Data Inflow | One Data workspace with Imports, Records, Validation, and Mapping tabs | Import history, raw editing, and reconciliation are distinct capabilities |
| Recipe Costing + Menu Prices + Mapping cost controls + Item Insights | One Menu workspace with Costs, Prices, Performance, and Mapping views | Recipe cost, actual selling price, packaging, and realized margin remain distinct |
| Cash Reality + Bank Accounts + Bank Reconcile | One Cash & Banking workspace | Cash forecasts, account administration, and transaction reconciliation remain separate views |
| Crew Terminal + Crew Reports | Organize as Operations entry and review modes | Do not replace frontline workflows just to reduce menu count |
| Team + payroll controls + Holiday Registry | Group under People | Retain role-sensitive access to salaries |

Waste Radar and Consumables answer different questions; keep both. Vendors and bank reconciliation are complementary, not duplicates. The current source already has recipe-cost publishing and price-impact functionality; these should be improved rather than proposed again as entirely new features. Historical references to a separate WasteHub/Reports are stale for this checkout.

Neko Pulse is already the frontline system according to prior business context. Any further duplication of entry workflows across Pulse, POS, and NekoMetrics should be evaluated against current live integrations before removing a workflow.

## Improvement areas

1. **One financial calculation model.** Shared per-outlet results should feed cards, charts, exports, forecasts, and frozen snapshots. Add reconciliation invariants between source records and aggregates.
2. **One ownership model.** Separate business ID, outlet ID, and acting-user ID everywhere. Add migration diagnostics before changing historical ownership.
3. **One outlet registry and period policy.** MASTER_OUTLETS still hardcodes NFC without status; some selectors use every rental, while P&L already filters closures by period. Use active outlets for current operations and historically valid outlets for historical reporting. Prior user context says active outlets are Humayunpur and B6 Market; NFC is closed. Live rental records were not rechecked.
4. **Consistent navigation and filters.** About 29 top-level destinations are too many for routine use. Use five workspaces: Overview, Finance, Menu & Costs, Operations, and Data & Settings. Persist outlet/period in the URL so reports can be shared and browser navigation works.
5. **Better failure visibility.** Replace console-only failures with clear retryable states. Distinguish loading, no records, incomplete data, permission denied, and stale data; retain the previous period label when a refresh fails.
6. **Recipe conversions and trustworthy displays.** Publishing already blocks known costing errors. Extend ingredient-specific density/pack conversions, label partial costs, and measure valid costing coverage by sales revenue. Do not invent a universal g-to-ml conversion.
7. **Focused automated checks.** Add rules emulator tests, tenant-owner consistency checks, import retry/boundary tests, financial reconciliation fixtures, and concurrent bill-settlement tests. Type checking alone cannot detect these failures.
8. **Maintainability and delivery.** Extract database writes and calculations from 1,000–3,600-line components. Make type checking part of CI/build validation; the build script itself only runs Vite. Update the README's obsolete AI setup and deployment claims. Treat the untracked mcp directory as existing user work.
9. **Performance.** Fix query scope and pagination first, then profile rendering and bundle loading. Do not treat the build's large-chunk warning alone as proof of a slow production app.

## Valuable additions, in priority order

| Priority | Addition or extension | Practical value | Dependency |
|---|---|---|---|
| 1 | Data readiness and month-close checklist | Shows missing sales feeds, unclassified expenses, unresolved stock, pending bills, and payroll gaps before profit is trusted | Reliable source/outlet/day coverage |
| 2 | Daily closing reconciliation | Compares POS/till, payment modes, bank deposits, delivery settlements, and expenses; assigns unresolved differences | Correct IDs, atomic movements, deduplication |
| 3 | Exception inbox with owner and due date | Turns discrepancies into accountable actions rather than additional charts | Reliable validation rules and drill-through |
| 4 | Settlement recovery workbench | Tracks expected versus received Zomato/Swiggy payouts, unmatched deductions, aging, and recovered amounts | Stable order-to-settlement matching |
| 5 | Recipe cost and supplier-price change alerts | Surfaces which high-selling dishes lose contribution when costs change; extends existing costing | Valid units, purchase price history, recipe coverage |
| 6 | Actual versus theoretical food consumption | Separates waste, portion variance, stock-count errors, and purchase-price changes | Stock counts, recipe yields, sales quantities |
| 7 | Daily outlet targets with explanatory variance | Shows how far Humayunpur/B6 are from agreed targets and whether sales, mix, labour, or costs explain it | Complete, comparable outlet data |
| 8 | Unified transaction search and provenance | Follows one bill/order from source import through ledger, snapshot, and bank match | Stable source IDs and audit history |

These are product proposals; not all require new standalone pages. Reconciliation, menu costing, and outlet comparisons already exist in parts, so extend those foundations.

## Recommended delivery sequence

1. Close permission defects D01–D03 and verify deployed rules separately.
2. Correct ownership, imports, snapshot edits, and settlement writes (D04–D09). Produce read-only diagnostics for potentially affected historical records before any repair.
3. Unify live/frozen P&L and add completeness gates (D10–D11).
4. Correct bounded audits and velocity; add targeted regression coverage.
5. Consolidate navigation and launch the data-readiness/exception workflow.
6. Add settlement recovery and actual-versus-theoretical consumption once inputs are dependable.

Acceptance should include an owner, delegated manager, viewer, crew member at each of two outlets, and a separate tenant. Financial tests should cover import retries, partial failure, two simultaneous settlements, missing sales, month-end closure, and identical live/frozen P&L values. No deployment or historical repair is part of this review.
