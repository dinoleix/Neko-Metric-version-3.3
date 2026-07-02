import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, getDocs, addDoc, doc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Product, CREW_PURCHASE_CATEGORIES, CREW_EXPENSE_CATEGORIES } from '../types';
import { X, Plus, Search, Edit2, Trash2, Tag, Loader2, Package, Check } from 'lucide-react';

const ALL_PRODUCT_CATEGORIES = Array.from(
  new Set([...CREW_PURCHASE_CATEGORIES, ...CREW_EXPENSE_CATEGORIES])
).sort();

interface Props {
  user: User;
  ownerId: string;
  onSelect?: (product: Product) => void;
  onClose: () => void;
}

const ProductCatalog: React.FC<Props> = ({ user, ownerId, onSelect, onClose }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [fName, setFName] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fPrice, setFPrice] = useState('');
  const [fQty, setFQty] = useState('');
  const [fUnit, setFUnit] = useState('');

  useEffect(() => { loadProducts(); }, []);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'products'), where('ownerId', '==', ownerId)));
      setProducts(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Product))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    } catch (err) {
      console.error('Error loading products:', err);
    } finally {
      setLoading(false);
    }
  };

  const openAddForm = () => {
    setEditingProduct(null);
    setFName(''); setFCategory(''); setFPrice(''); setFQty(''); setFUnit('');
    setShowForm(true);
  };

  const openEditForm = (p: Product) => {
    setEditingProduct(p);
    setFName(p.name);
    setFCategory(p.category);
    setFPrice(p.pricePerUnit != null ? p.pricePerUnit.toString() : '');
    setFQty(p.quantity != null ? p.quantity.toString() : '');
    setFUnit(p.unit || '');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!fName.trim() || !fCategory) return;
    setSaving(true);
    try {
      const data = {
        name: fName.trim().toUpperCase(),
        category: fCategory,
        pricePerUnit: fPrice ? parseFloat(fPrice) : null,
        quantity: fQty ? parseFloat(fQty) : null,
        unit: fUnit.trim() || null,
        ownerId,
        userId: user.uid,
        createdAt: Date.now(),
      };
      if (editingProduct?.id) {
        await updateDoc(doc(db, 'products', editingProduct.id), data);
        setProducts(prev =>
          prev.map(p => p.id === editingProduct.id ? { ...data, id: editingProduct.id } as Product : p)
            .sort((a, b) => a.name.localeCompare(b.name))
        );
      } else {
        const ref = await addDoc(collection(db, 'products'), data);
        setProducts(prev =>
          [...prev, { ...data, id: ref.id } as Product].sort((a, b) => a.name.localeCompare(b.name))
        );
      }
      setShowForm(false);
    } catch (err) {
      console.error('Error saving product:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteDoc(doc(db, 'products', id));
      setProducts(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error('Error deleting product:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = useMemo(() =>
    products.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.category.toLowerCase().includes(search.toLowerCase())
    ), [products, search]);

  const grouped = useMemo(() => {
    const map: Record<string, Product[]> = {};
    filtered.forEach(p => {
      if (!map[p.category]) map[p.category] = [];
      map[p.category].push(p);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg max-h-[90vh] rounded-t-[3rem] sm:rounded-[3rem] flex flex-col shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-slate-900 px-8 pt-8 pb-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-white/10 rounded-2xl">
              <Package size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-black text-white uppercase tracking-tight">Product Catalog</h2>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">
                {products.length} product{products.length !== 1 ? 's' : ''} defined
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2.5 bg-white/10 text-white rounded-2xl hover:bg-white/20 transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Search + Add */}
        <div className="px-6 pt-5 pb-3 flex items-center gap-3 shrink-0">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search products or category…"
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border-2 border-slate-100 rounded-2xl text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 transition-all"
            />
          </div>
          <button
            onClick={openAddForm}
            className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-100 active:scale-95 transition-all shrink-0"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {/* Inline Add/Edit Form */}
        {showForm && (
          <div className="mx-6 mb-3 bg-indigo-50 rounded-[2rem] p-5 border-2 border-indigo-100 shrink-0 space-y-3">
            <p className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">
              {editingProduct ? 'Edit Product' : 'New Product'}
            </p>
            <input
              value={fName}
              onChange={e => setFName(e.target.value)}
              placeholder="Product name *"
              className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-black text-slate-900 outline-none focus:border-indigo-400 uppercase placeholder:normal-case placeholder:font-medium"
            />
            <select
              value={fCategory}
              onChange={e => setFCategory(e.target.value)}
              className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-black text-slate-700 outline-none focus:border-indigo-400 appearance-none uppercase"
            >
              <option value="">-- Select Category * --</option>
              {ALL_PRODUCT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="grid grid-cols-3 gap-3">
              <input
                type="number" step="0.01" min="0"
                value={fPrice}
                onChange={e => setFPrice(e.target.value)}
                placeholder="Price / unit (₹)"
                className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-black text-slate-900 outline-none focus:border-indigo-400 placeholder:font-medium"
              />
              <input
                type="number" step="0.01" min="0"
                value={fQty}
                onChange={e => setFQty(e.target.value)}
                placeholder="Default qty"
                className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-black text-slate-900 outline-none focus:border-indigo-400 placeholder:font-medium"
              />
              <select
                value={fUnit}
                onChange={e => setFUnit(e.target.value)}
                className="w-full px-4 py-3 bg-white border-2 border-indigo-100 rounded-2xl text-sm font-medium text-slate-700 outline-none focus:border-indigo-400 appearance-none"
              >
                <option value="">-- Unit --</option>
                {['kg', 'mg', 'L', 'ml', 'cups', 'pieces', 'box', 'bottle'].map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 py-3 bg-white text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest border-2 border-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !fName.trim() || !fCategory}
                className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {editingProduct ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        )}

        {/* Product List */}
        <div className="flex-1 overflow-y-auto px-6 pb-8">
          {loading ? (
            <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-xs font-bold uppercase tracking-widest">Loading…</span>
            </div>
          ) : grouped.length === 0 ? (
            <div className="py-16 text-center">
              <Package size={40} className="mx-auto text-slate-200 mb-3" />
              <p className="text-xs font-black text-slate-300 uppercase tracking-widest">
                {search ? 'No matching products' : 'No products yet — add one above'}
              </p>
            </div>
          ) : (
            <div className="space-y-6 pt-2">
              {grouped.map(([cat, prods]) => (
                <div key={cat}>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    <Tag size={9} /> {cat}
                  </p>
                  <div className="space-y-2">
                    {prods.map(p => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-3 bg-slate-50 rounded-2xl px-4 py-3.5 border border-slate-100"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-black text-slate-900 uppercase truncate">{p.name}</p>
                          {(p.pricePerUnit != null || p.unit) && (
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                              {p.pricePerUnit != null ? `₹${p.pricePerUnit.toLocaleString('en-IN')}` : ''}
                              {p.pricePerUnit != null && p.unit ? ' / ' : ''}
                              {p.unit || ''}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {onSelect && (
                            <button
                              onClick={() => { onSelect(p); onClose(); }}
                              className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest active:scale-95 transition-all"
                            >
                              Use
                            </button>
                          )}
                          <button
                            onClick={() => openEditForm(p)}
                            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                            title="Edit"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(p.id!)}
                            disabled={deletingId === p.id}
                            className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50"
                            title="Delete"
                          >
                            {deletingId === p.id
                              ? <Loader2 size={13} className="animate-spin" />
                              : <Trash2 size={13} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductCatalog;
