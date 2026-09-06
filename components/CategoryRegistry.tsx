import React, { useState, useMemo } from 'react';
import { doc, deleteDoc, deleteField, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import {
  BankTransaction, CategorizationRule,
  RECONCILIATION_CATEGORIES, isInternalTransfer,
} from '../types';
import { Tag, Trash2, Pencil, AlertTriangle, ArrowRightLeft, Loader2, Zap } from 'lucide-react';

/**
 * Every category the categoriser offers, in one auditable place.
 *
 * The dropdown's list is assembled at render time from four sources — the
 * built-in seed list, ad-hoc names typed on this page, categories already sitting
 * on a transaction, and categories targeted by a saved rule. It only ever grows,
 * and nothing displayed it, so a typo like OPERATONS became permanent the moment
 * it touched one transaction and quietly split spend across two names.
 *
 * Counts here are all-time: bank_statement_imports is fetched without a date
 * filter, unlike the period-scoped views elsewhere on this screen.
 */

type Source = 'built-in' | 'rule' | 'ad-hoc';

interface Row {
  name: string;
  count: number;
  source: Source;
  rule?: CategorizationRule;
  isTransfer: boolean;
}

const CategoryRegistry: React.FC<{
  transactions: BankTransaction[];
  rules: CategorizationRule[];
  onChanged: () => void;
}> = ({ transactions, rules, onChanged }) => {
  const [busy, setBusy] = useState<string | null>(null);

  const rows: Row[] = useMemo(() => {
    const counts = new Map<string, number>();
    transactions.forEach(t => {
      const c = (t.category || '').trim().toUpperCase();
      if (!c) return;
      counts.set(c, (counts.get(c) || 0) + 1);
    });

    const ruleFor = new Map<string, CategorizationRule>();
    rules.forEach(r => ruleFor.set((r.category || '').trim().toUpperCase(), r));

    const names = new Set<string>([
      ...RECONCILIATION_CATEGORIES.map(c => c.toUpperCase()),
      ...counts.keys(),
      ...ruleFor.keys(),
    ]);

    return Array.from(names).map(name => ({
      name,
      count: counts.get(name) || 0,
      source: RECONCILIATION_CATEGORIES.map(c => c.toUpperCase()).includes(name)
        ? 'built-in' as const
        : ruleFor.has(name) ? 'rule' as const : 'ad-hoc' as const,
      rule: ruleFor.get(name),
      isTransfer: isInternalTransfer(name),
    })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [transactions, rules]);

  // Rare, not built-in, and not a transfer: the shape a misspelling takes. Not an
  // error — a genuinely occasional category looks the same — so it is flagged for
  // a human to read, never acted on automatically.
  const suspects = rows.filter(r => r.source === 'ad-hoc' && r.count > 0 && r.count <= 2);

  /**
   * Renames a category across every transaction carrying it, plus any rule that
   * targets it. This is the repair for a typo: without it the misspelling stays
   * in the dropdown forever and keeps splitting one category's spend in two.
   */
  const handleRename = async (row: Row) => {
    const next = window.prompt(
      `Rename "${row.name}" across ${row.count} transaction${row.count === 1 ? '' : 's'}.\n\n` +
      `Type the correct name — usually an existing category you meant to pick.`,
      row.name,
    );
    if (next === null) return;
    const target = next.trim().toUpperCase();
    if (!target || target === row.name) return;

    const affected = transactions.filter(t => (t.category || '').trim().toUpperCase() === row.name);
    if (!window.confirm(
      `Move ${affected.length} transaction${affected.length === 1 ? '' : 's'} from "${row.name}" to "${target}"?`
    )) return;

    setBusy(row.name);
    try {
      for (let i = 0; i < affected.length; i += 400) {
        const batch = writeBatch(db);
        affected.slice(i, i + 400).forEach(t => {
          batch.update(doc(db, 'bank_statement_imports', t.id!), { category: target });
        });
        await batch.commit();
      }
      // The rule has to follow, or it re-applies the old name to the next import.
      if (row.rule?.id) {
        const batch = writeBatch(db);
        batch.update(doc(db, 'categorization_rules', row.rule.id), { category: target });
        await batch.commit();
      }
      onChanged();
    } catch (err: any) {
      console.error('[categories] rename failed:', err);
      alert(err?.code === 'permission-denied'
        ? 'You do not have permission to change these transactions.'
        : `Rename failed: ${err?.message || err}`);
    } finally { setBusy(null); }
  };

  /**
   * Retires an ad-hoc category: clears it off every transaction carrying it and
   * removes any rule that would recreate it on the next import.
   *
   * Those transactions become unmapped and un-verified, so they return to the
   * queue to be categorised properly — deleting a name must not silently leave
   * spend marked as confirmed under a category that no longer exists.
   *
   * The bill match (matchedPurchaseId / isReconciled) is deliberately left alone:
   * which bill a bank line belongs to is independent of what it is called.
   */
  const handleDeleteCategory = async (row: Row) => {
    if (row.source === 'built-in') return;

    const affected = transactions.filter(t => (t.category || '').trim().toUpperCase() === row.name);
    const parts = [
      affected.length > 0
        ? `${affected.length} transaction${affected.length === 1 ? '' : 's'} will become uncategorised and need categorising again`
        : null,
      row.rule ? `the auto-match rule for “${row.rule.keyword}” will be deleted` : null,
    ].filter(Boolean);

    if (!window.confirm(
      `Delete the category "${row.name}"?\n\n` +
      (parts.length ? parts.join(', and ') + '.' : 'Nothing currently uses it.') +
      `\n\nIf this is a misspelling, Rename is usually better — it keeps the spend attached to the right category.`
    )) return;

    setBusy(row.name);
    try {
      for (let i = 0; i < affected.length; i += 400) {
        const batch = writeBatch(db);
        affected.slice(i, i + 400).forEach(t => {
          batch.update(doc(db, 'bank_statement_imports', t.id!), {
            category: deleteField(),
            isVerified: false,
          });
        });
        await batch.commit();
      }
      if (row.rule?.id) await deleteDoc(doc(db, 'categorization_rules', row.rule.id));
      onChanged();
    } catch (err: any) {
      console.error('[categories] delete failed:', err);
      alert(err?.code === 'permission-denied'
        ? 'You do not have permission to change these transactions.'
        : `Delete failed: ${err?.message || err}`);
    } finally { setBusy(null); }
  };

  const handleDeleteRule = async (row: Row) => {
    if (!row.rule?.id) return;
    if (!window.confirm(
      `Delete the rule matching "${row.rule.keyword}" → ${row.name}?\n\n` +
      `Transactions already categorised keep their category. Only future auto-matching stops.`
    )) return;
    setBusy(row.name);
    try {
      await deleteDoc(doc(db, 'categorization_rules', row.rule.id));
      onChanged();
    } catch (err: any) {
      console.error('[categories] rule delete failed:', err);
      alert(`Could not delete the rule: ${err?.message || err}`);
    } finally { setBusy(null); }
  };

  const badge = (s: Source) => {
    const map: Record<Source, string> = {
      'built-in': 'bg-slate-100 text-slate-500 border-slate-200',
      'rule': 'bg-indigo-50 text-indigo-600 border-indigo-100',
      'ad-hoc': 'bg-amber-50 text-amber-700 border-amber-100',
    };
    const label: Record<Source, string> = {
      'built-in': 'Built in', 'rule': 'From rule', 'ad-hoc': 'Ad hoc',
    };
    return <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${map[s]}`}>{label[s]}</span>;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-8">
        <div className="flex items-start gap-4 mb-2">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><Tag size={20} /></div>
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">Categories &amp; Rules</h3>
            <p className="text-slate-500 text-sm font-medium mt-0.5 max-w-2xl">
              Every category the categoriser offers, with how often it is actually used.
              Counts cover all imported statements, not just the selected month.
            </p>
          </div>
        </div>

        {suspects.length > 0 && (
          <div className="mt-6 bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-4">
            <div className="p-2.5 bg-amber-500/15 rounded-xl shrink-0"><AlertTriangle className="text-amber-600" size={20} /></div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Possible misspellings</p>
              <p className="text-sm font-bold text-amber-900 mt-1">
                {suspects.map(s => s.name).join(', ')} — used {suspects.length === 1 ? 'only' : 'only'} once or twice
                and not a built-in category. If one is a typo, rename it onto the category you meant; spend is
                currently split across both.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left" style={{ minWidth: 720 }}>
            <thead className="bg-slate-50/80 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Source</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Transactions</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Auto-match rule</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map(row => (
                <tr key={row.name} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-black text-slate-900">{row.name}</span>
                      {row.isTransfer && (
                        <span title="Excluded from inflow and outflow totals — money moving between your own accounts"
                          className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-sky-50 text-sky-600 border border-sky-100 flex items-center gap-1">
                          <ArrowRightLeft size={9} /> Transfer
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-5">{badge(row.source)}</td>
                  <td className="px-8 py-5 text-right">
                    <span className={`text-sm font-black tabular-nums ${row.count === 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                      {row.count}
                    </span>
                    {row.count === 0 && <span className="block text-[9px] font-bold text-slate-400 uppercase">never used</span>}
                  </td>
                  <td className="px-8 py-5">
                    {row.rule ? (
                      <span className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
                        <Zap size={11} className="text-indigo-400" />
                        <span className="font-mono">“{row.rule.keyword}”</span>
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-300 uppercase">None</span>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center justify-end gap-2">
                      {busy === row.name ? (
                        <Loader2 size={15} className="animate-spin text-indigo-500" />
                      ) : (
                        <>
                          <button
                            onClick={() => handleRename(row)}
                            disabled={row.count === 0}
                            title={row.count === 0 ? 'Nothing to rename — no transactions use this' : 'Rename across every transaction using it'}
                            className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <Pencil size={13} />
                          </button>
                          {row.rule && (
                            <button
                              onClick={() => handleDeleteRule(row)}
                              title="Delete only the auto-match rule, keeping the category"
                              className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-amber-600 hover:border-amber-200 transition-colors"
                            >
                              <Zap size={13} />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteCategory(row)}
                            disabled={row.source === 'built-in'}
                            title={row.source === 'built-in'
                              ? 'Built-in categories come from the application and cannot be deleted'
                              : 'Delete this category and uncategorise its transactions'}
                            className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-8 py-5 text-[11px] font-medium text-slate-400 border-t border-slate-50">
          <b className="text-slate-500">Rename</b> moves the spend onto another category and is the right
          fix for a misspelling. <b className="text-slate-500">Delete</b> retires the category and returns its
          transactions to the uncategorised queue — use it when the name should not exist at all.
          The <b className="text-slate-500">lightning</b> button removes only the auto-match rule and keeps
          the category. Built-in categories come from the application and cannot be deleted.
        </p>
      </div>
    </div>
  );
};

export default CategoryRegistry;
