
import React, { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, addDoc, doc, deleteDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Vendor } from '../types';
import {
  Store, Plus, Trash2, Edit2, Save, X, Loader2, CheckCircle2,
  Phone, Mail, MapPin, FileText, Search, SearchX, Building2
} from 'lucide-react';

const VendorManagement: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Form state
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [gst, setGst] = useState('');
  const [email, setEmail] = useState('');

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'vendors'), where('ownerId', '==', dataOwnerId));
      const snap = await getDocs(q);
      setVendors(snap.docs.map(d => ({ id: d.id, ...d.data() } as Vendor)).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  useEffect(() => { fetchVendors(); }, [user]);

  const resetForm = () => {
    setName(''); setAddress(''); setPhone(''); setGst(''); setEmail('');
    setEditingId(null); setShowForm(false);
  };

  const handleEdit = (v: Vendor) => {
    setEditingId(v.id!);
    setName(v.name); setAddress(v.address || ''); setPhone(v.phone || '');
    setGst(v.gst || ''); setEmail(v.email || '');
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const data: Omit<Vendor, 'id'> = {
        userId: user.uid, ownerId: dataOwnerId,
        name: name.trim().toUpperCase(),
        address: address.trim(), phone: phone.trim(),
        gst: gst.trim().toUpperCase(), email: email.trim().toLowerCase(),
        createdAt: Date.now(),
      };
      if (editingId) {
        await updateDoc(doc(db, 'vendors', editingId), data as any);
      } else {
        await addDoc(collection(db, 'vendors'), data);
      }
      resetForm();
      await fetchVendors();
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this vendor?')) return;
    await deleteDoc(doc(db, 'vendors', id));
    setVendors(prev => prev.filter(v => v.id !== id));
  };

  const filtered = vendors.filter(v =>
    !searchTerm ||
    v.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.phone || '').includes(searchTerm) ||
    (v.gst || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-violet-600 rounded-2xl flex items-center justify-center text-white shadow-xl">
            <Building2 size={28} />
          </div>
          <div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Vendor Directory</h2>
            <p className="text-slate-400 text-sm font-medium uppercase tracking-widest">Manage suppliers & service providers</p>
          </div>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="flex items-center gap-2 px-6 py-3 bg-violet-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl hover:bg-violet-700 transition-all"
        >
          <Plus size={16} /> Add Vendor
        </button>
      </header>

      {/* Add/Edit Form */}
      {showForm && (
        <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-10 animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
              {editingId ? 'Edit Vendor' : 'New Vendor'}
            </h3>
            <button onClick={resetForm} className="p-2 text-slate-400 hover:text-slate-900 bg-slate-50 rounded-xl transition-all">
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Name */}
              <div className="md:col-span-2 space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Vendor Name *</label>
                <div className="relative">
                  <Store className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                  <input
                    required type="text" value={name} onChange={e => setName(e.target.value)}
                    placeholder="e.g. FRESH FARMS SUPPLY CO."
                    className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-violet-500 outline-none pl-12 pr-5 rounded-2xl text-sm font-bold text-slate-700 uppercase transition-all"
                  />
                </div>
              </div>
              {/* Phone */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Phone</label>
                <div className="relative">
                  <Phone className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                  <input
                    type="tel" value={phone} onChange={e => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-violet-500 outline-none pl-12 pr-5 rounded-2xl text-sm font-bold text-slate-700 transition-all"
                  />
                </div>
              </div>
              {/* Email */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Email</label>
                <div className="relative">
                  <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="vendor@example.com"
                    className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-violet-500 outline-none pl-12 pr-5 rounded-2xl text-sm font-bold text-slate-700 transition-all"
                  />
                </div>
              </div>
              {/* GST */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">GST Number</label>
                <div className="relative">
                  <FileText className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" size={18} />
                  <input
                    type="text" value={gst} onChange={e => setGst(e.target.value)}
                    placeholder="27AAAAA0000A1Z5"
                    className="w-full h-14 bg-slate-50 border-2 border-slate-100 focus:border-violet-500 outline-none pl-12 pr-5 rounded-2xl text-sm font-bold text-slate-700 uppercase tracking-widest transition-all"
                  />
                </div>
              </div>
              {/* Address */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 block">Address</label>
                <div className="relative">
                  <MapPin className="absolute left-5 top-4 text-slate-300 pointer-events-none" size={18} />
                  <textarea
                    value={address} onChange={e => setAddress(e.target.value)}
                    placeholder="Full address…"
                    rows={2}
                    className="w-full bg-slate-50 border-2 border-slate-100 focus:border-violet-500 outline-none pl-12 pr-5 py-4 rounded-2xl text-sm font-medium text-slate-700 resize-none transition-all"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-4 pt-2">
              <button type="button" onClick={resetForm} className="flex-1 h-14 bg-slate-50 text-slate-400 rounded-2xl font-black uppercase text-[10px] tracking-widest border border-slate-100 hover:bg-slate-100 transition-all">
                Cancel
              </button>
              <button
                type="submit" disabled={saving}
                className="flex-1 h-14 bg-violet-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-xl shadow-violet-100 hover:bg-violet-700 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {editingId ? 'Update Vendor' : 'Save Vendor'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          placeholder="Search vendors by name, phone, GST…"
          className="w-full h-14 bg-white border-2 border-slate-100 focus:border-violet-500 outline-none pl-14 pr-5 rounded-2xl text-sm font-bold text-slate-700 transition-all shadow-sm"
        />
      </div>

      {/* Vendor List */}
      {loading ? (
        <div className="py-32 text-center"><Loader2 className="w-10 h-10 text-violet-500 animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="py-32 bg-white rounded-[3rem] border-2 border-dashed border-slate-200 text-center">
          <SearchX size={48} className="mx-auto text-slate-200 mb-4" />
          <h3 className="text-xl font-black text-slate-900">No Vendors Found</h3>
          <p className="text-slate-400 text-xs font-medium uppercase tracking-widest mt-2">Add your first vendor to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map(vendor => (
            <div key={vendor.id} className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm p-8 flex flex-col gap-5 hover:shadow-md transition-all group">
              <div className="flex items-start justify-between gap-4">
                <div className="w-12 h-12 bg-violet-50 rounded-2xl flex items-center justify-center text-violet-600 font-black text-lg shrink-0">
                  {vendor.name[0]}
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleEdit(vendor)} className="p-2.5 bg-slate-50 text-slate-400 hover:text-violet-600 rounded-xl transition-all border border-slate-100"><Edit2 size={16} /></button>
                  <button onClick={() => vendor.id && handleDelete(vendor.id)} className="p-2.5 bg-slate-50 text-slate-400 hover:text-rose-600 rounded-xl transition-all border border-slate-100"><Trash2 size={16} /></button>
                </div>
              </div>
              <div>
                <h4 className="text-base font-black text-slate-900 uppercase tracking-tight leading-tight">{vendor.name}</h4>
                {vendor.gst && <p className="text-[10px] font-black text-violet-500 uppercase tracking-widest mt-1">{vendor.gst}</p>}
              </div>
              <div className="space-y-2 border-t border-slate-50 pt-4">
                {vendor.phone && (
                  <div className="flex items-center gap-2.5 text-xs font-bold text-slate-500">
                    <Phone size={13} className="text-slate-300 shrink-0" /> {vendor.phone}
                  </div>
                )}
                {vendor.email && (
                  <div className="flex items-center gap-2.5 text-xs font-bold text-slate-500 truncate">
                    <Mail size={13} className="text-slate-300 shrink-0" /> {vendor.email}
                  </div>
                )}
                {vendor.address && (
                  <div className="flex items-start gap-2.5 text-xs font-medium text-slate-400 leading-snug">
                    <MapPin size={13} className="text-slate-300 shrink-0 mt-0.5" /> {vendor.address}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default VendorManagement;
