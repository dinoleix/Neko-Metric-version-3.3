# NekoMetrics review verification and additional findings

Reviewed checkout: `89ff319`, 16 September 2026. Companion to `2026-09-16-app-review.md`, which already existed when this review began. Application source and live records were not modified.

## Current verification

- `npm run lint` passes; this is TypeScript checking, not behavioral linting.
- `npm run build` passes, with a 658.52 kB Firebase chunk warning and an empty React vendor chunk. These are optimization signals, not measured production latency.
- `node --check mcp/server.mjs` passes.
- An isolated installed-SDK probe confirms that a committed batch rejects its next write with `failed-precondition`. The probe committed an empty batch only, with no database request.
- A second uncommitted SDK probe confirms `set(..., {merge:true})` treats `purchaseByCategory.FOOD` as one literal field segment, not a nested path.
- Current source confirms D01–D03 permission defects, D04 ownership mismatch in imports and frozen P&L, D05 raw-edit snapshot corruption, D06 batch reuse, D07 retry duplication risk, D08 bank-purchase reporting gap, D09 non-atomic settlements, D10 invalid zero-revenue margins, D11 live/frozen calculation drift, D12 truncated audit reads, D13 ambiguous order matching, D14 fixed 30-day velocity, and D15 unrestricted authenticated AI parameters from the companion report. Secondary examples in that report were not all independently rerun.
- Firebase's documented additive rule behavior confirms that a broad matching allow rule does not defer to a more specific restriction: [official documentation](https://firebase.google.com/docs/rules/rules-behavior#overlapping_match_statements). Deployed rules and real exploitation were not tested.
- Local app starts at `http://127.0.0.1:3000/`. After the user signed in, read-only browser inspection covered CEO Dashboard, P&L Command, Recipe Costing, Sales Hub, and Data Inflow/Online Entry. This used the local frontend against its configured backend. No imports, settlements, publication, or snapshot locking were executed. Mobile behavior remains a source finding; no controlled mobile viewport test was performed.

## Additional findings

### D16 — High: P&L period requests can race and freezing remains enabled during loading

Evidence: `components/PnLHub.tsx:127-176`, `467-523`, `599-600`.

Changing the period starts another asynchronous fetch. There is no request-generation check before results replace state. If request A finishes after request B, A's records overwrite B's records while the selectors still show B. Failed requests also leave previous data in state and only log to the console. The Freeze button is disabled only while freezing, not while loading or after a failed refresh. It can therefore save old-period data using the newly selected month/year.

Fix: key results by tenant and period, discard stale responses, retain an explicit loaded-period marker, and disable freeze until the selected period has a successful complete load. Include dataOwnerId in fetch dependencies. Regression: resolve two mocked period requests in reverse order; reject the second; try freezing while the second is pending. Only the successfully loaded selected period may be frozen.

### D17 — Medium: mobile navigation consumes a full viewport before report content

Evidence: `App.tsx:303`, `321`, `375`.

Below the medium breakpoint, the container becomes a column while the sidebar remains full width, sticky, and `h-screen`. The report follows that full-height navigation. Choosing a module does not close the navigation or move focus to the report. This is a source-confirmed layout concern; authenticated mobile interaction has not been tested.

Fix: use a compact mobile header and dismissible drawer, move focus to the report heading after navigation, preserve desktop sidebar behavior. Validate at 375 px and 768 px with keyboard and touch.

### D18 — Medium: selected platform controls have nearly white text on pale backgrounds

Evidence: `components/Uploader.tsx:1432-1433`.

Selected Zomato and Swiggy controls use `text-white` on `bg-rose-50` / `bg-orange-50`. The earlier equivalent control at line 1316 uses a saturated background. The same selected-state meaning therefore has inconsistent contrast. Other screens use 9–10 px uppercase labels, including low-contrast sidebar section labels at `App.tsx:342`.

Fix: define reusable selected-button styles with dark text on pale backgrounds or white text on saturated backgrounds. Increase metadata text sizes and verify contrast in rendered authenticated screens.

### D19 — Medium: sign-in errors and field labeling need recovery and accessibility improvements

Evidence: observed login error `Firebase: Error (auth/invalid-credential).`; `components/Login.tsx:27`, `72-97`, `101-103`.

The UI presents an SDK error without a useful recovery action. Email and password labels are siblings of their inputs without htmlFor/id association; browser accessibility output exposes unnamed fields. There is no password-reset link. Google login also lacks the loading guard used by email login.

Fix: associate labels and fields, set appropriate autocomplete attributes, announce errors, translate authentication errors into clear neutral instructions, provide password recovery, and consistently prevent repeated submissions.

### D20 — High: incomplete recipe costs are labeled Healthy and included in averages

Evidence: `components/RecipeCostLab.tsx:38-41`, `115-125`, `363-416`; authenticated browser observation.

Chicken Teriyaki Bowl shows an unresolved Garlic oil g-to-l conversion while reporting food cost 24.2%, profit ₹333.62, and Healthy. Shrimp Tempura reports a shrimp pc-to-kg conversion error alongside food cost 7.4%, profit ₹324.23, and Healthy. The average food-cost calculation filters for a price but not for costing errors, so incomplete costs also affect summary statistics.

Fix: mark these costs incomplete, suppress profit/health verdicts, exclude invalid recipes from valid-cost averages, and show coverage. Resolve conversions per ingredient. Preserve the existing publication error block; this finding concerns displayed calculations, not a demonstrated bypass of that block.

### D21 — High: CEO readiness message and outlet ranking imply confidence without sales coverage

Evidence: `components/ExecDashboard.tsx:370-396`, `436-468`, `520-525`; authenticated browser observation.

September shows counter sales ₹8,92,947 but no imported sales in the channel panel; the green status nevertheless says No exceptions for this period. Net profit is presented as ₹-10,10,619. Sales Hub separately shows ₹0 revenue. These are different source bases, not proof that till sales were lost, but the primary status does not communicate that the financial result is incomplete. The outlet league ranks New Friends Colony first at ₹0 revenue/₹0 profit, ahead of outlets with costs but no imported sales.

Fix: make completeness a separate mandatory status, show the basis of each total beside it, suppress definitive profitability/ranking when required feeds are missing, and filter current league eligibility by outlet status. Sales Hub's current selector excludes NFC while CEO and Online Entry include it, confirming inconsistent current-period outlet treatment. NFC's closed status comes from prior user context; rental status itself was not edited or inspected.

### D22 — Medium: financial KPI values overflow cards at ordinary desktop widths

Evidence: `components/PnLHub.tsx:629-696`; authenticated screenshot at approximately 1115 px wide.

The four-column grid allocates narrow cards beside the sidebar. Operating burn and net profit extend past card edges, while the erroneous long percentages overlap neighboring content. Ordinary six/seven-digit amounts also do not fit comfortably, so fixing the percentages alone does not resolve this layout defect. Selected Zomato's white-on-pale-rose text was also confirmed visually in Online Entry (D18).

Fix: choose card columns from available content width, use tabular numerals and consistent Indian currency grouping, allow compact units with full-value detail, and test long positive/negative amounts at intermediate desktop widths and zoom.

### Browser confirmation of D10

P&L displays gross revenue ₹0, net margin -101061878.0%, and net monthly profit ₹-1,010,618.78 while its break-even card says no sales are loaded. Lock P&L Snapshot remains enabled. The page also claims that all line items map 1:1 with source records. No snapshot was locked during the review. Replace that unconditional assurance with the actual validation state.

## Recommended stabilization order

1. **Access enforcement:** replace permissive catch-all writes; require tenant plus role plus outlet; make viewer permissions read-only on the backend. Add two-tenant and role-matrix rules tests before deployment.
2. **Financial write integrity:** standardize tenant ownership and acting-user metadata; make bill settlement atomic and once-only; introduce stable import IDs, resumable states, and deterministic snapshot rebuilding. Test retries, 400/401 boundaries, and simultaneous settlement.
3. **Trustworthy reporting:** use one calculation for live and frozen P&L; fix nested snapshot edits; prevent stale-period freezing; display missing-data states and unavailable ratios. Diagnose historical inconsistencies read-only before proposing repairs.
4. **Operational usability:** group the 29 destinations into Overview, Finance, Menu & Costs, Operations, and Data & Settings. Share outlet/period state through URLs; standardize form controls, loading/error states, typography, and mobile navigation.
5. **Release discipline:** make type checking and focused behavioral tests deployment gates. Add error reporting for failed writes and imports, document backup/restore procedures, and verify restoration in a non-production environment.

The most useful product extension is a data-readiness/month-close checklist with drill-through to missing feeds and unresolved discrepancies. Follow it with a daily reconciliation exception queue. These help establish whether existing numbers can be trusted before adding more dashboards.

Earlier business context identifies Humayunpur and B6 Market as the active outlets and NFC as closed. That context was not freshly verified against rental records; retain historical NFC reporting while checking current-period selectors against the outlet registry.
