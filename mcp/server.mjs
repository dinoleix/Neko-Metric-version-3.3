#!/usr/bin/env node
/**
 * Neko Metrics — read-only MCP server.
 *
 * Exposes the café's Firestore data to Claude so questions can be asked directly
 * ("how has Chicken Poke Bowl performed over six months") instead of a screen
 * being built for each one.
 *
 * READ ONLY BY CONSTRUCTION. There is no write path in this file. That matters
 * more than usual here: the Admin SDK bypasses firestore.rules completely, so
 * none of the tenancy or role work in that file applies to this process. The
 * service account is effectively root on the database.
 *
 * Every query is pinned to one owner uid. Firestore has no cross-collection
 * joins, so tenancy is a per-collection field — some documents carry `userId`,
 * the crew-written ones carry `ownerId`, and a few carry both.
 *
 * Env:
 *   GOOGLE_APPLICATION_CREDENTIALS  path to the service account JSON
 *                                   (defaults to ./service-account.json next to this file —
 *                                   keep the key out of ~/Desktop or ~/Documents, macOS's
 *                                   TCC sandboxing blocks Node/tool access to those folders)
 *   NEKO_OWNER_UID                  the business owner's uid; scopes every read
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DEFAULT_KEY_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'service-account.json');
const KEY_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS || DEFAULT_KEY_PATH;
const OWNER = process.env.NEKO_OWNER_UID;

if (!OWNER) throw new Error('NEKO_OWNER_UID is not set (the business owner uid every read is scoped to).');

initializeApp({ credential: cert(JSON.parse(readFileSync(KEY_PATH, 'utf8'))) });
const db = getFirestore();

/**
 * Which field carries the owner uid, per collection.
 *
 * 'userId'  — CSV-derived and snapshot data, stamped with the owner's uid.
 * 'ownerId' — written by crew or by an admin acting for the owner.
 * 'both'    — run both and merge, de-duplicated by document id.
 * 'doc'     — the document id IS the owner uid (settings-style singletons).
 */
const TENANT_FIELD = {
  bank_accounts: 'userId',
  bank_statement_imports: 'userId',
  bank_transactions: 'both',
  bill_counters: 'userId',
  cash_flow_snapshots: 'userId',
  cash_obligations: 'userId',
  categorization_rules: 'userId',
  category_settings: 'doc',
  cogs_adjustments: 'userId',
  crew_categories: 'both',
  crew_entries: 'both',
  daily_sales_logs: 'both',
  employees: 'userId',
  events: 'userId',
  expense_snapshots: 'userId',
  expenses: 'userId',
  fc_ingredients: 'both',
  fc_recipes: 'both',
  files: 'userId',
  holidays: 'userId',
  item_costs: 'userId',
  item_sales: 'userId',
  item_snapshots: 'userId',
  loan_profiles: 'userId',
  menu_normalization: 'userId',
  menu_prices: 'both',
  monthly_payrolls: 'userId',
  online_customers: 'userId',
  online_order_details: 'userId',
  pnl_snapshots: 'userId',
  products: 'both',
  purchases: 'userId',
  rentals: 'userId',
  sales_analytics: 'userId',
  sales_ledger: 'both',
  sales_snapshots: 'userId',
  sales_summary: 'userId',
  serving_options: 'userId',
  sku_mappings: 'userId',
  user_groups: 'both',
  user_mappings: 'userId',
  users: 'ownerId',
  vendors: 'both',
  waste_entries: 'both',
  weather: 'userId',
};

const COLLECTION_NOTES = {
  sales_snapshots: 'Monthly sales per outlet: POS and online gross/net/tax, commission, ads, TDS, daily and hourly trends, per-platform breakdown.',
  item_snapshots: 'Monthly per-item sales per outlet. items{} is keyed by master item name with quantity, revenue, a 31-slot dailyTrend, POS/online split and staff (NC-bill) consumption.',
  expense_snapshots: 'Monthly spend per outlet. CSV figures and Crew Terminal figures are kept in SEPARATE fields (crew*) so the two sources never double-count.',
  pnl_snapshots: 'Locked monthly P&L per outlet. Only written when a month is frozen — recomputed figures elsewhere may differ if data changed after locking.',
  cogs_adjustments: 'Opening and closing stock per bucket. Consumption = opening + purchases − closing. Closing is stored in fields named *Adjustment.',
  crew_entries: 'Counter-recorded spend. type "purchase" means paid online/bank, "expense" means cash. status paid|pending|cancelled. userId is the CREW MEMBER, ownerId the business.',
  item_costs: 'Per-dish ingredient and serving costs. tier1/tier2 serving costs are selected by the outlet tier in `rentals`.',
  purchases: 'Purchase records. Those with _fileId "BANK_PUSH" were generated from a bank line, not imported from a supplier bill.',
  bank_statement_imports: 'Imported bank statement lines. type debit = money out, credit = money in.',
  rentals: 'Outlet registry — the source of the outlet list app-wide, plus rent, tier and open/close dates.',
  waste_entries: 'Recorded waste with per-item quantity and cost.',
  daily_sales_logs: 'Crew-submitted daily takings split by cash / card / UPI.',
  holidays: 'Holidays, which projections adjust for.',
  weather: 'Cached daily weather per outlet, for correlating sales.',
};

/** Applies the owner scope, running two queries and merging where needed. */
async function scopedDocs(collection, build = q => q) {
  const mode = TENANT_FIELD[collection];
  if (!mode) throw new Error(`Unknown collection "${collection}". Call list_collections first.`);

  if (mode === 'doc') {
    const snap = await db.collection(collection).doc(OWNER).get();
    return snap.exists ? [{ id: snap.id, ...snap.data() }] : [];
  }

  const fields = mode === 'both' ? ['ownerId', 'userId'] : [mode];
  const seen = new Set();
  const out = [];
  for (const field of fields) {
    let q = db.collection(collection).where(field, '==', OWNER);
    q = build(q);
    const snap = await q.get();
    snap.docs.forEach(d => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      out.push({ id: d.id, ...d.data() });
    });
  }
  return out;
}

const ok = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

const TOOLS = [
  {
    name: 'list_collections',
    description:
      'Every collection available, with what it holds and which field carries the owner uid. ' +
      'Call this first when you do not know where something lives.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'describe_collection',
    description:
      'Field shape of a collection, inferred from a sample document, plus the document count seen. ' +
      'Use before querying an unfamiliar collection so filters name real fields.',
    inputSchema: {
      type: 'object',
      properties: { collection: { type: 'string' } },
      required: ['collection'],
    },
  },
  {
    name: 'query',
    description:
      'Read documents from any collection, always scoped to the owner. Filters are [field, op, value] ' +
      'triples using Firestore operators (==, !=, <, <=, >, >=, in, array-contains). ' +
      'Results are capped — narrow with filters rather than raising the limit.',
    inputSchema: {
      type: 'object',
      properties: {
        collection: { type: 'string' },
        where: {
          type: 'array',
          description: 'e.g. [["month","==","August"],["year","==","2026"]]',
          items: { type: 'array' },
        },
        order_by: { type: 'string', description: 'field to sort by' },
        direction: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number', description: 'default 50, max 300' },
      },
      required: ['collection'],
    },
  },
  {
    name: 'item_performance',
    description:
      'Monthly series for one or more menu items across a year: quantity, revenue, average realised price, ' +
      'and the POS/online split — assembled from item_snapshots so you do not have to join them yourself. ' +
      'Average price is revenue divided by quantity, i.e. what customers actually paid, not the menu price.',
    inputSchema: {
      type: 'object',
      properties: {
        year: { type: 'string', description: 'e.g. "2026"' },
        item: { type: 'string', description: 'Item name or part of one, case-insensitive. Omit for every item.' },
        outlet_id: { type: 'string', description: 'Omit to combine all outlets.' },
      },
      required: ['year'],
    },
  },
  {
    name: 'monthly_summary',
    description:
      'Sales and spend for a month across outlets, from sales_snapshots and expense_snapshots. ' +
      'Expense figures separate CSV-uploaded spend from Crew Terminal spend, which are distinct sources ' +
      'and must not be added twice.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: 'e.g. "August"' },
        year: { type: 'string' },
      },
      required: ['month', 'year'],
    },
  },
];

const server = new Server(
  { name: 'neko-metrics', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async req => {
  const { name, arguments: args = {} } = req.params;
  try {
    if (name === 'list_collections') {
      return ok(Object.keys(TENANT_FIELD).sort().map(c => ({
        collection: c,
        owner_field: TENANT_FIELD[c],
        note: COLLECTION_NOTES[c] || undefined,
      })));
    }

    if (name === 'describe_collection') {
      const docs = await scopedDocs(args.collection, q => q.limit(5));
      if (docs.length === 0) return ok({ collection: args.collection, documents: 0, note: 'No documents for this owner.' });
      const shape = {};
      docs.forEach(d => Object.entries(d).forEach(([k, v]) => {
        shape[k] = Array.isArray(v) ? `array(${v.length})`
          : v === null ? 'null'
          : typeof v === 'object' ? `object{${Object.keys(v).slice(0, 6).join(',')}}`
          : typeof v;
      }));
      return ok({ collection: args.collection, sampled: docs.length, fields: shape, example: docs[0] });
    }

    if (name === 'query') {
      const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 300);
      const docs = await scopedDocs(args.collection, q => {
        (args.where || []).forEach(([f, op, v]) => { q = q.where(f, op, v); });
        if (args.order_by) q = q.orderBy(args.order_by, args.direction || 'asc');
        return q.limit(limit);
      });
      return ok({ collection: args.collection, count: docs.length, limit, documents: docs });
    }

    if (name === 'item_performance') {
      const snaps = await scopedDocs('item_snapshots', q => q.where('year', '==', String(args.year)));
      const needle = (args.item || '').trim().toUpperCase();
      const series = {};
      snaps
        .filter(s => !args.outlet_id || s.outletId === args.outlet_id)
        .forEach(s => {
          Object.entries(s.items || {}).forEach(([itemName, d]) => {
            if (needle && !itemName.toUpperCase().includes(needle)) return;
            if (!series[itemName]) series[itemName] = {};
            const m = series[itemName][s.month] || { quantity: 0, revenue: 0, posQuantity: 0, onlineQuantity: 0 };
            m.quantity += d.quantity || 0;
            m.revenue += d.revenue || 0;
            m.posQuantity += d.posQuantity || 0;
            m.onlineQuantity += d.onlineQuantity || 0;
            series[itemName][s.month] = m;
          });
        });
      Object.values(series).forEach(months =>
        Object.values(months).forEach(m => {
          m.avgPrice = m.quantity > 0 ? Math.round((m.revenue / m.quantity) * 100) / 100 : 0;
        }));
      return ok({
        year: args.year,
        outlet: args.outlet_id || 'all outlets combined',
        items: Object.keys(series).length,
        note: 'avgPrice is revenue / quantity — what was actually realised per unit.',
        series,
      });
    }

    if (name === 'monthly_summary') {
      const [sales, expense] = await Promise.all([
        scopedDocs('sales_snapshots', q => q.where('month', '==', args.month).where('year', '==', String(args.year))),
        scopedDocs('expense_snapshots', q => q.where('month', '==', args.month).where('year', '==', String(args.year))),
      ]);
      return ok({
        month: args.month, year: args.year,
        note: 'Expense totals are split by source: total* is CSV-uploaded, crewTotal* is Crew Terminal. They are different spend — add both, never one twice.',
        sales, expense,
      });
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    return {
      isError: true,
      content: [{ type: 'text', text: `${name} failed: ${err?.message || err}` }],
    };
  }
});

await server.connect(new StdioServerTransport());
