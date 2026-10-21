# Multi-tenant dev acceptance and sample handoff

This checklist is for the isolated dev project only. Use synthetic accounts and records. Do not use Green Neko production credentials, customer details, receipts, or exports.

## Live preview role acceptance

Preview: <https://neko-metrics-multitenant-dev.vercel.app/>

Record each result as pass/fail with the test account role and a short note. Never record passwords or API keys.

| Check | Expected result | Result |
| --- | --- | --- |
| Tenant A owner signs in | Opens only the Green Neko Demo tenant and its outlets | Pending |
| Tenant B owner signs in | Opens only the Separate Demo Restaurant tenant and its outlets | Pending |
| A member belonging to both tenants signs in | Chooses an active tenant and can switch; each switch refreshes scoped app state | Pending |
| Owner provisions manager, crew, and viewer accounts in Tenant A | Memberships have the intended role and outlet assignment | Pending |
| Tenant B owner adds an existing account already in Tenant A | Account keeps its existing login and appears in the tenant picker with only the assigned scope in each tenant | Pending |
| HQ manager reads Tenant A records | Can read all Tenant A outlets, cannot access Tenant B | Pending |
| Outlet manager and crew read assigned outlet | Cannot read another outlet or tenant, even when given a document ID | Pending |
| Viewer reads assigned scope and attempts a write | Reads allowed records; writes are denied | Pending |
| Crew creates an operational record | New record includes the active `tenantId` and assigned `outletId` | Pending |
| Tenant member attempts owner-only Product Catalog change | Write is denied for non-owner roles | Pending |
| Login activity is inspected by a member and by the tenant owner | Member sees own activity; only owner can review other members' records | Pending |
| Receipt upload and read after Storage bucket setup | Authorized tenant/outlet access succeeds; other tenant and unassigned outlet access is denied | Pending |

Use a fresh synthetic marker for writes (for example `mt-acceptance-crew-20261021`) and remove test records after verifying them. Do not use real sales, customer, staff, or supplier values.

## Sanitized source sample format

Provide a JSON file with representative records for every collection intended for the rehearsal, plus outlet mappings. Preserve field names, nesting, data types, enum values, and relationships; replace identifiers and identifying values consistently. Amounts may be synthetic, but include expected counts and totals for the selected period so reconciliation can be checked.

```json
{
  "sampleId": "green-neko-synthetic-v1",
  "sourcePeriod": { "from": "2026-09-01", "to": "2026-09-30" },
  "outletMappings": [
    { "sourceOutletId": "source-outlet-a", "targetOutletKey": "outlet-a" }
  ],
  "collections": {
    "daily_sales_logs": [
      {
        "id": "sales-log-a1",
        "data": {
          "outletId": "source-outlet-a",
          "date": "2026-09-03",
          "totalNet": 1250,
          "paymentBreakdown": { "cash": 500, "card": 750 }
        }
      }
    ],
    "purchases": [],
    "expenses": [],
    "crew_entries": [],
    "inventory_counts": [],
    "fc_ingredients": [],
    "fc_recipes": []
  },
  "expectedReconciliation": {
    "outlet-a": {
      "dailySalesLogCount": 1,
      "salesTotal": 1250,
      "purchaseTotal": 0,
      "expenseTotal": 0
    }
  }
}
```

The collection names above are examples, not a complete migration scope. Use `COLLECTION-INVENTORY.md` to identify collections that contain Green Neko data. Include at least one representative record for each in-scope collection, or mark it explicitly as empty/not migrated. Include any source ID to outlet mapping that cannot be inferred from the record.

Before sharing, replace emails, phone numbers, names, addresses, supplier/customer identifiers, account numbers, receipt URLs, image data, and free-text notes. Keep relationships internally consistent using fake IDs. Do not include authentication exports, access tokens, API keys, or unredacted documents.

## Storage region decision

Storage has no bucket until its permanent location is selected. Choose a location before creating the bucket; the location cannot be changed afterward. Once chosen, publish the prepared tenant-scoped Storage rules and run the Storage emulator suite again. The app should not be considered receipt-ready until upload, read, and cross-tenant denial are verified against the live dev bucket.
