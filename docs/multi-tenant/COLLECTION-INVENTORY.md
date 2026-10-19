# Tenant scope inventory

This is the source-review inventory for the current shared Firestore collections. It is the checklist for conversion; it is not a claim that data has been migrated.

## Platform-only collections

| Collection | Target ownership | Notes |
| --- | --- | --- |
| `users` | Global identity profile | Replace business ownership fields with memberships over time. |
| `platform_users` | Platform | New collection if platform support roles are needed. |
| `tenants` | Platform | New collection. |
| `tenant_memberships` | Tenant | New collection, one user/tenant membership. |
| `tenant_settings` | Tenant | New collection. |

## Tenant-wide master and configuration data

| Collections |
| --- |
| `category_settings`, `categorization_rules`, `crew_categories`, `products`, `vendors`, `serving_options`, `menu_prices`, `menu_normalization`, `sku_mappings`, `fc_ingredients`, `fc_recipes`, `item_costs`, `inventory_items`, `user_groups`, `user_mappings`, `holidays`, `employees`, `rentals`, `loan_profiles` |

These records must carry `tenantId`. Where a master record is outlet-specific, it must also carry `outletId`; otherwise it applies to all outlets in that tenant.

### First module slice: `products`

The isolated tenant preview now loads and writes Product Catalog records using `tenantId`; owner membership is required for catalog changes. The existing single-business Product Catalog keeps its `ownerId` query and write shape. The preview integration is available for review, while live acceptance remains pending until the updated isolated rules are published and checked against both demo tenants.

## Outlet and operational records

| Collections |
| --- |
| `purchases`, `expenses`, `crew_entries`, `waste_entries`, `daily_sales_logs`, `sales_ledger`, `sales_summary`, `sales_snapshots`, `expense_snapshots`, `item_sales`, `item_snapshots`, `inventory_counts`, `ingredient_controls`, `ingredient_movements`, `cogs_adjustments`, `cash_flow_snapshots`, `cash_obligations`, `bank_accounts`, `bank_transactions`, `bank_statement_imports`, `bill_counters`, `monthly_payrolls`, `events`, `weather` |

These records must carry both `tenantId` and `outletId` unless documented as a tenant-wide consolidated record. A consolidated record must state its aggregation scope explicitly (`scope: 'tenant'` or `scope: 'outlet'`) so an outlet result cannot be mistaken for a business total.

## Tenant customer, loyalty and file records

| Collections |
| --- |
| `online_customers`, `online_order_details`, `loyalty_customers`, `loyalty_imports`, `loyalty_opening_balances`, `loyalty_campaign_drafts`, `files` |

These records are tenant-owned. Add `outletId` only when the source or campaign is genuinely store-specific. Customer identity matching must occur only within the same tenant.

## Existing identifiers that need conversion

| Current field | Current use | Target treatment |
| --- | --- | --- |
| `userId` | Often represents the Green Neko owner in reporting/snapshot records. | Retain as legacy provenance; replace business filtering with `tenantId`. |
| `ownerId` | Often represents business owner on crew and operational records. | Retain as legacy provenance; replace business filtering with `tenantId`. |
| `outletId` | Store scope. | Retain; verify it belongs to the record's tenant. |
| `createdBy` | Acting user. | Retain and standardise on authenticated UID. |
| `assignedOutlet` | User profile field. | Move to membership-level outlet scope. |

## High-risk conversion areas

1. **Imported sales and snapshots** — IDs currently incorporate the business owner identifier. New IDs need tenant prefixes while preserving legacy lookup during the transition.
2. **Crew terminal** — crew writes contain both acting user and owner identifiers. The replacement must keep the acting user, tenant and outlet distinct.
3. **Financial reports** — P&L, Expense Radar, cash flow and CEO dashboards must never aggregate documents from another tenant.
4. **File imports** — duplicate fingerprints must become tenant-specific; the same file in two separate businesses must not block either import.
5. **Caches** — client cache keys must include `tenantId` as well as collection and outlet scope.
6. **Firestore catch-all rules** — broad generic grants must be reviewed before any new tenant collection is introduced, because Firestore `allow` rules are additive.

## Required evidence before each collection is marked converted

- Read query includes `tenantId`.
- Create payload includes immutable `tenantId`.
- Update preserves `tenantId`.
- Firestore rules reject cross-tenant reads/writes.
- Emulator test covers owner, HQ manager, outlet manager/crew, viewer and a different tenant.
- Existing Green Neko calculations reconcile in the isolated environment.
