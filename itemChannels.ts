// Shared channel split for item_snapshots' per-item records. Every item-level
// report (Unit Economics, Product Intelligence, Waste Radar, Consumables
// Efficiency) used to re-derive its own pos/online split inline, and most of
// them forgot to split at all — blending online (Zomato/Swiggy) sales into
// in-store POS figures. This is the one place that logic lives now.

export type ItemChannelMode = 'all' | 'pos' | 'online';

export const CHANNEL_MODE_OPTIONS: { id: ItemChannelMode; label: string }[] = [
  { id: 'all', label: 'Combined' },
  { id: 'pos', label: 'In-Store' },
  { id: 'online', label: 'Online' },
];

interface ItemSnapshotEntry {
  quantity: number;
  revenue: number;
  posQuantity?: number;
  onlineQuantity?: number;
  platformBreakdown?: Record<string, { quantity: number; revenue: number }>;
}

// Older snapshots (pre platformBreakdown) only distinguish channel when an
// item was sold exclusively online that period — matches the fallback
// OnlineProfitCenter.tsx already used before this helper existed.
function onlineRevenueOf(data: ItemSnapshotEntry): number {
  if (data.platformBreakdown) {
    return Object.values(data.platformBreakdown).reduce((sum, p) => sum + (p.revenue || 0), 0);
  }
  if ((data.onlineQuantity || 0) > 0 && (data.posQuantity || 0) === 0) {
    return data.revenue || 0;
  }
  return 0;
}

export function getItemChannelValues(data: ItemSnapshotEntry, mode: ItemChannelMode): { qty: number; revenue: number } {
  if (mode === 'all') {
    return { qty: data.quantity || 0, revenue: data.revenue || 0 };
  }

  const onlineRev = onlineRevenueOf(data);

  if (mode === 'online') {
    return { qty: data.onlineQuantity || 0, revenue: onlineRev };
  }

  // pos
  const posQty = data.posQuantity ?? data.quantity;
  return { qty: posQty || 0, revenue: Math.max(0, (data.revenue || 0) - onlineRev) };
}
