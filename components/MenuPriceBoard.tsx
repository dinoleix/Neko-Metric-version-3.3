// ---------------------------------------------------------------------------
// Menu Prices
//
// The stated dine-in / POS list price of every sold item. Deliberately NOT
// derived from sales: revenue ÷ quantity is a realized average, contaminated by
// discounts and platform markup, and Recipe Costing divides by this number to
// get food cost % — a silently-low price makes every margin read worse than it
// is. So the price is always something a person asserted, by one of three
// routes: typed in the grid, imported from a POS price list, or read off a
// photographed menu and confirmed.
// ---------------------------------------------------------------------------

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { User } from 'firebase/auth';
import { collection, doc, writeBatch, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { invalidateCached } from '../referenceCache';
import { parseCsvRecords } from '../csvParse';
import { ai } from '../geminiService';
import { EMPTY_MENU_DIRECTORY, getMenuDirectory, MenuDirectory } from '../menuDirectory';
import { MenuPrice, MenuPriceSource } from '../types';
import {
  IndianRupee, Search, Save, Loader2, Check, X, Camera, Upload, Sparkles,
  AlertTriangle, Info, ImageIcon, FileSpreadsheet, Keyboard,
} from 'lucide-react';

interface Props {
  user: User;
  dataOwnerId: string;
}

const money = (n: number) => `₹${n.toFixed(2)}`;

/** Loose key for matching an imported/scanned label to a master item name:
 *  case, spacing and punctuation all vary between a menu board, a POS export
 *  and the sales data, and none of those differences mean a different dish. */
const matchKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Models are asked for raw JSON but still sometimes fence it. */
const parseJsonLoose = (raw: string): any => {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
};

const inputCls = 'w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-400';

const SOURCE_BADGE: Record<MenuPriceSource, { label: string; cls: string }> = {
  manual: { label: 'Typed', cls: 'bg-slate-100 text-slate-600' },
  csv: { label: 'Imported', cls: 'bg-indigo-100 text-indigo-700' },
  scan: { label: 'Scanned', cls: 'bg-amber-100 text-amber-700' },
};

/** One proposed name→price pair from an import or a scan, before it is applied. */
interface StagedRow {
  rawName: string;
  price: number;
  /** Master item name it resolved to, or '' when nothing matched. */
  matched: string;
}

const MenuPriceBoard: React.FC<Props> = ({ user, dataOwnerId }) => {
  const [directory, setDirectory] = useState<MenuDirectory>(EMPTY_MENU_DIRECTORY);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [sources, setSources] = useState<Record<string, MenuPriceSource>>({});
  const [savedPrices, setSavedPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [search, setSearch] = useState('');
  const [segmentFilter, setSegmentFilter] = useState('all');
  const [gapFilter, setGapFilter] = useState<'all' | 'missing' | 'priced'>('all');

  const [staged, setStaged] = useState<StagedRow[] | null>(null);
  const [stagedLabel, setStagedLabel] = useState('');
  const [stagedSource, setStagedSource] = useState<MenuPriceSource>('csv');
  const [scanning, setScanning] = useState(false);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [dir, priceSnap] = await Promise.all([
        getMenuDirectory(dataOwnerId),
        getDocs(query(collection(db, 'menu_prices'), where('userId', '==', dataOwnerId))),
      ]);
      setDirectory(dir);

      // Newest-first so a duplicate left by an older write never wins.
      const docs = priceSnap.docs
        .map(d => d.data() as MenuPrice)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      const initial: Record<string, string> = {};
      const initialSrc: Record<string, MenuPriceSource> = {};
      const saved: Record<string, number> = {};
      docs.forEach(p => {
        const key = (p.itemName || '').trim().toUpperCase();
        if (!key || initial[key] !== undefined) return;
        initial[key] = String(p.price ?? '');
        initialSrc[key] = p.source || 'manual';
        saved[key] = p.price;
      });
      setPrices(initial);
      setSources(initialSrc);
      setSavedPrices(saved);
    } catch (err) {
      console.error('Menu prices: load failed', err);
      setError('Could not load menu prices.');
    } finally {
      setLoading(false);
    }
  }, [dataOwnerId]);

  useEffect(() => { load(); }, [load]);

  const keyed = useMemo(
    () => directory.names.map(n => ({ name: n, key: n.trim().toUpperCase() })),
    [directory.names],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return keyed.filter(({ name, key }) => {
      if (q && !name.toLowerCase().includes(q)) return false;
      if (segmentFilter !== 'all' && (directory.segmentByName[key] || '') !== segmentFilter) return false;
      const has = parseFloat(prices[key] || '') > 0;
      if (gapFilter === 'missing' && has) return false;
      if (gapFilter === 'priced' && !has) return false;
      return true;
    });
  }, [keyed, search, segmentFilter, gapFilter, prices, directory.segmentByName]);

  const stats = useMemo(() => {
    const total = keyed.length;
    const priced = keyed.filter(({ key }) => parseFloat(prices[key] || '') > 0).length;
    return { total, priced, missing: total - priced };
  }, [keyed, prices]);

  /** Only what actually changed is written — a full-collection rewrite on every
   *  save would burn quota and touch rows the user never looked at. */
  const dirtyKeys = useMemo(
    () => keyed
      .map(({ key }) => key)
      .filter(key => {
        const val = parseFloat(prices[key] || '');
        const was = savedPrices[key];
        if (!(val > 0)) return false;
        return was === undefined || Math.abs(was - val) > 0.0001;
      }),
    [keyed, prices, savedPrices],
  );

  const setPrice = (key: string, value: string, source: MenuPriceSource = 'manual') => {
    setPrices(prev => ({ ...prev, [key]: value }));
    setSources(prev => ({ ...prev, [key]: source }));
  };

  const save = async () => {
    if (!dirtyKeys.length) return;
    setSaving(true);
    setError('');
    try {
      for (let i = 0; i < dirtyKeys.length; i += 400) {
        const batch = writeBatch(db);
        dirtyKeys.slice(i, i + 400).forEach(key => {
          // Deterministic id keyed on the uppercased name: two casings of the
          // same dish must land on ONE document, or an untouched duplicate can
          // overwrite the row just edited.
          const safeId = key.replace(/[^a-zA-Z0-9]/g, '_');
          // dataOwnerId, not user.uid — a delegated admin's edits must land on
          // the doc this page reads back.
          batch.set(doc(db, 'menu_prices', `${dataOwnerId}_price_${safeId}`), {
            itemName: key,
            price: parseFloat(prices[key]),
            source: sources[key] || 'manual',
            userId: dataOwnerId,
            updatedAt: Date.now(),
          } as MenuPrice, { merge: true });
        });
        await batch.commit();
      }
      invalidateCached('menu_prices', dataOwnerId);
      setSavedPrices(prev => {
        const next = { ...prev };
        dirtyKeys.forEach(key => { next[key] = parseFloat(prices[key]); });
        return next;
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      console.error('Menu prices: save failed', err);
      setError('Save failed. Check the console for details.');
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Import routes — both land in the same staging table for confirmation.
  // -------------------------------------------------------------------------

  const stage = (rows: { rawName: string; price: number }[], label: string, source: MenuPriceSource) => {
    const byKey = new Map<string, string>(keyed.map(({ name, key }) => [matchKey(name), key]));
    const resolved: StagedRow[] = rows
      .filter(r => r.rawName && r.price > 0)
      .map(r => ({ ...r, matched: byKey.get(matchKey(r.rawName)) || '' }));
    if (!resolved.length) {
      setError(`Nothing usable found in ${label}.`);
      return;
    }
    setStaged(resolved);
    setStagedLabel(label);
    setStagedSource(source);
  };

  const handleCsv = (file: File) => {
    setError('');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const records = parseCsvRecords((e.target?.result as string) || '');
        if (records.length < 2) throw new Error('Needs a header row and at least one data row.');
        const header = records[0].map(h => h.toLowerCase());
        // Accept any reasonable column naming rather than demanding a template.
        const nameIdx = header.findIndex(h => /name|item|product|dish/.test(h));
        const priceIdx = header.findIndex(h => /price|rate|amount|mrp/.test(h));
        if (nameIdx < 0 || priceIdx < 0) {
          throw new Error('Could not find an item-name column and a price column.');
        }
        stage(
          records.slice(1).map(r => ({
            rawName: (r[nameIdx] || '').trim(),
            price: parseFloat((r[priceIdx] || '').replace(/[^0-9.]/g, '')) || 0,
          })),
          file.name,
          'csv',
        );
      } catch (err: any) {
        setError(err.message || 'Could not read that file.');
      }
    };
    reader.readAsText(file);
  };

  const handleImage = async (file: File) => {
    setError('');
    setScanning(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(((reader.result as string) || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('Could not read the image.'));
        reader.readAsDataURL(file);
      });

      const prompt = [
        'Read this restaurant menu image and extract every sellable item with its price.',
        'Return ONLY a JSON array: [{"name": string, "price": number}].',
        'Rules: price is a plain number, no currency symbol or commas.',
        'Skip section headings, descriptions and anything with no price.',
        'If one item lists several sizes or variants, emit one entry per variant and put the variant in the name.',
        'Do not invent items or prices — omit anything you cannot read clearly.',
      ].join(' ');

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: { mimeType: file.type || 'image/jpeg', data: base64 } },
          ],
        }],
        config: { responseMimeType: 'application/json' },
      });

      const parsed = parseJsonLoose(response.text || '[]');
      const rows = (Array.isArray(parsed) ? parsed : parsed.items || []).map((r: any) => ({
        rawName: String(r?.name ?? '').trim(),
        price: Number(r?.price) || 0,
      }));
      stage(rows, file.name, 'scan');
    } catch (err: any) {
      console.error('Menu scan failed', err);
      setError(err?.message || 'Could not read that menu image.');
    } finally {
      setScanning(false);
    }
  };

  /** Staged rows are applied to the grid, not written straight to Firestore —
   *  a scan in particular should never reach the database unreviewed. */
  const applyStaged = () => {
    if (!staged) return;
    staged.forEach(r => { if (r.matched) setPrice(r.matched, String(r.price), stagedSource); });
    setStaged(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  const matchedCount = staged?.filter(r => r.matched).length ?? 0;

  /** The price already in the grid for a staged row's item, if any. Surfaced so
   *  an import overwriting an existing number is a decision, not an accident —
   *  with three sources feeding this page, silent clobbering is the real risk. */
  const currentOf = (r: StagedRow) => (r.matched ? parseFloat(prices[r.matched] || '') : NaN);
  const isConflict = (r: StagedRow) => {
    const cur = currentOf(r);
    return cur > 0 && Math.abs(cur - r.price) > 0.0001;
  };
  const conflicts = staged?.filter(isConflict) ?? [];

  /** Drops every disagreeing row in one go, keeping what's already recorded. */
  const skipConflicts = () =>
    setStaged(prev => prev!.map(r => (isConflict(r) ? { ...r, matched: '' } : r)));

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-500/25">
            <IndianRupee className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">Menu Prices</h1>
            <p className="text-xs font-bold text-slate-500 mt-0.5">
              The list price Recipe Costing divides by — {stats.priced} of {stats.total} items priced
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCsv(f); e.target.value = ''; }} />
          <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImage(f); e.target.value = ''; }} />

          <button onClick={() => imgInputRef.current?.click()} disabled={scanning}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50">
            {scanning ? <Loader2 className="animate-spin" size={15} /> : <Camera size={15} />}
            {scanning ? 'Reading…' : 'Scan Menu Photo'}
          </button>
          <button onClick={() => csvInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl font-black text-[11px] uppercase tracking-widest hover:border-indigo-300 hover:text-indigo-600 transition-all">
            <Upload size={15} /> Import Price List
          </button>
          <button onClick={save} disabled={saving || !dirtyKeys.length}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-emerald-700 transition-all disabled:opacity-40 shadow-lg shadow-emerald-500/25">
            {saving ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
            Save{dirtyKeys.length ? ` (${dirtyKeys.length})` : ''}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-2xl px-4 py-3">
          <AlertTriangle size={16} className="text-rose-600 mt-0.5 flex-shrink-0" />
          <p className="text-xs font-bold text-rose-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-2xl px-4 py-3">
          <Check size={16} className="text-emerald-600" />
          <p className="text-xs font-bold text-emerald-700">Menu prices saved.</p>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Items Sold</p>
          <p className="text-3xl font-black text-slate-900">{stats.total}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Priced</p>
          <p className="text-3xl font-black text-emerald-600">{stats.priced}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Still Missing</p>
          <p className={`text-3xl font-black ${stats.missing ? 'text-amber-600' : 'text-emerald-600'}`}>{stats.missing}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items…"
            className={`${inputCls} pl-10`} />
        </div>
        <select value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} className={`${inputCls} lg:w-56`}>
          <option value="all">All categories</option>
          {directory.segments.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="flex bg-slate-100 rounded-xl p-1">
          {([
            { k: 'all' as const, label: 'All' },
            { k: 'missing' as const, label: 'Missing' },
            { k: 'priced' as const, label: 'Priced' },
          ]).map(o => (
            <button key={o.k} onClick={() => setGapFilter(o.k)}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                gapFilter === o.k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {!keyed.length ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-16 text-center">
          <ImageIcon className="mx-auto text-slate-200 mb-3" size={40} />
          <p className="text-sm font-black text-slate-500">No sold items yet</p>
          <p className="text-xs font-semibold text-slate-400 mt-1">Upload sales data first — this page prices the items your POS has seen.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                <th className="text-left px-6 py-3">Item</th>
                <th className="text-left px-4 py-3 w-44">Category</th>
                <th className="text-right px-4 py-3 w-40">Menu Price ₹</th>
                <th className="text-left px-4 py-3 w-28">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {visible.map(({ name, key }) => {
                const val = prices[key] || '';
                const isDirty = dirtyKeys.includes(key);
                return (
                  <tr key={key} className={isDirty ? 'bg-emerald-50/40' : ''}>
                    <td className="px-6 py-3 font-bold text-slate-800 uppercase text-xs">{name}</td>
                    <td className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase">
                      {directory.segmentByName[key] || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <input type="number" step="any" min="0" value={val}
                        onChange={e => setPrice(key, e.target.value)}
                        placeholder="—"
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-black text-right text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500/40" />
                    </td>
                    <td className="px-4 py-3">
                      {val && sources[key] ? (
                        <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase ${SOURCE_BADGE[sources[key]].cls}`}>
                          {SOURCE_BADGE[sources[key]].label}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!visible.length && (
            <p className="py-12 text-center text-xs font-bold text-slate-400">Nothing matches those filters.</p>
          )}
        </div>
      )}

      <p className="flex items-start gap-2 text-[11px] font-semibold text-slate-400">
        <Info size={13} className="mt-0.5 flex-shrink-0" />
        Enter the price on your menu, not what an order averaged after discounts — Recipe Costing divides by this to
        get food cost %, so a discounted figure makes every margin look worse than it is.
      </p>

      {/* Import / scan review */}
      {staged && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-50 rounded-3xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-6 py-5 bg-white border-b border-slate-100">
              <div className="flex items-center gap-3">
                {stagedSource === 'scan'
                  ? <Sparkles className="text-amber-500" size={20} />
                  : <FileSpreadsheet className="text-indigo-500" size={20} />}
                <div>
                  <h2 className="text-lg font-black text-slate-900">Review {stagedSource === 'scan' ? 'Scanned' : 'Imported'} Prices</h2>
                  <p className="text-[11px] font-bold text-slate-400">
                    {stagedLabel} — {matchedCount} of {staged.length} matched a sold item
                    {conflicts.length > 0 && (
                      <span className="text-amber-600"> · {conflicts.length} disagree with a price you already have</span>
                    )}
                  </p>
                </div>
              </div>
              <button onClick={() => setStaged(null)} className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {stagedSource === 'scan' && (
                <p className="flex items-start gap-2 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-4">
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                  Read off an image — check every number before applying. Nothing is saved until you press Save on the grid.
                </p>
              )}
              {conflicts.length > 0 && (
                <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-4">
                  <p className="flex items-start gap-2 text-[11px] font-semibold text-amber-700">
                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
                    {conflicts.length} row{conflicts.length === 1 ? '' : 's'} would overwrite a price you already recorded.
                  </p>
                  <button onClick={skipConflicts}
                    className="flex-shrink-0 px-3 py-1.5 bg-white border border-amber-300 text-amber-700 rounded-lg font-black text-[9px] uppercase tracking-widest hover:bg-amber-100 transition-all">
                    Keep Mine
                  </button>
                </div>
              )}
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200">
                  <tr className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                    <th className="text-left py-2">From File</th>
                    <th className="text-left py-2">Matched Item</th>
                    <th className="text-right py-2 w-24">Current</th>
                    <th className="text-right py-2 w-24">Incoming</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staged.map((r, i) => {
                    const cur = currentOf(r);
                    const clash = isConflict(r);
                    return (
                      <tr key={i} className={!r.matched ? 'opacity-50' : clash ? 'bg-amber-50/60' : ''}>
                        <td className="py-2.5 text-xs font-bold text-slate-700">{r.rawName}</td>
                        <td className="py-2.5">
                          <select
                            value={r.matched}
                            onChange={e => setStaged(prev => prev!.map((x, xi) => xi === i ? { ...x, matched: e.target.value } : x))}
                            className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
                          >
                            <option value="">— skip —</option>
                            {keyed.map(({ name, key }) => <option key={key} value={key}>{name}</option>)}
                          </select>
                        </td>
                        <td className={`py-2.5 text-right text-xs font-bold ${clash ? 'text-amber-700' : 'text-slate-300'}`}>
                          {cur > 0 ? money(cur) : '—'}
                        </td>
                        <td className={`py-2.5 text-right text-xs font-black ${clash ? 'text-amber-700' : 'text-slate-800'}`}>
                          {money(r.price)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-3 px-6 py-5 bg-white border-t border-slate-100">
              <button onClick={() => setStaged(null)}
                className="flex-1 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-100 transition-all">
                Cancel
              </button>
              <button onClick={applyStaged} disabled={!matchedCount}
                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-700 transition-all disabled:opacity-40 flex items-center justify-center gap-2">
                <Keyboard size={15} /> Apply {matchedCount} to Grid
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuPriceBoard;
