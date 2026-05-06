
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, addDoc, doc, deleteDoc, updateDoc, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { BankAccount, MASTER_OUTLETS, getOutletName, StoreRental } from '../types';
import { 
  Building2, 
  Plus, 
  Trash2, 
  Edit2, 
  Save, 
  X, 
  Loader2, 
  IndianRupee,
  Wallet,
  ArrowUpRight,
  History,
  CheckCircle2,
  Store,
  MapPin
} from 'lucide-react';

const BankManagement: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [activeOutletIds, setActiveOutletIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [balance, setBalance] = useState('');
  const [outletId, setOutletId] = useState('');

  const fetchAccounts = async () => {
    setLoading(true);
    try {
      // Fetch Active Outlets from Store Hub (Rentals)
      const rentalsQ = query(
        collection(db, 'rentals'),
        where('userId', '==', dataOwnerId),
        where('status', '==', 'active')
      );
      const rentalsSnap = await getDocs(rentalsQ);
      const activeIds = new Set(rentalsSnap.docs.map(d => (d.data() as StoreRental).outletId));
      setActiveOutletIds(activeIds);

      const q = query(
        collection(db, 'bank_accounts'),
        where('userId', '==', dataOwnerId)
      );
      const snap = await getDocs(q);
      const fetchedAccounts = snap.docs.map(d => ({ id: d.id, ...d.data() } as BankAccount));
      setAccounts(fetchedAccounts.sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (err) {
      console.error("Error fetching bank accounts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        name,
        bankName,
        accountNumber,
        balance: parseFloat(balance) || 0,
        outletId: outletId || null,
        userId: user.uid,
        updatedAt: Date.now()
      };

      if (editingId) {
        await updateDoc(doc(db, 'bank_accounts', editingId), data);
      } else {
        await addDoc(collection(db, 'bank_accounts'), data);
      }

      resetForm();
      fetchAccounts();
    } catch (err) {
      console.error("Error saving bank account:", err);
      alert("Failed to save bank account");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (acc: BankAccount) => {
    setEditingId(acc.id!);
    setName(acc.name);
    setBankName(acc.bankName || '');
    setAccountNumber(acc.accountNumber || '');
    setBalance(acc.balance.toString());
    setOutletId(acc.outletId || '');
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this bank account?")) return;
    try {
      await deleteDoc(doc(db, 'bank_accounts', id));
      fetchAccounts();
    } catch (err) {
      console.error("Error deleting bank account:", err);
    }
  };

  const resetForm = () => {
    setName('');
    setBankName('');
    setAccountNumber('');
    setBalance('');
    setOutletId('');
    setEditingId(null);
    setIsAdding(false);
  };

  const activeOutlets = useMemo(() => {
    return MASTER_OUTLETS.filter(o => activeOutletIds.has(o.id) || o.id === 'GLOBAL');
  }, [activeOutletIds]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Bank Accounts</h2>
          <p className="text-slate-500 font-medium mt-1">Manage operational funds and balances</p>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95"
          >
            <Plus size={18} /> Add Account
          </button>
        )}
      </div>

      {isAdding && (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden animate-in slide-in-from-top-4 duration-300">
          <header className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                <Building2 size={20} />
              </div>
              <h3 className="font-black text-slate-800 uppercase tracking-tight">
                {editingId ? 'Edit Account' : 'New Bank Account'}
              </h3>
            </div>
            <button onClick={resetForm} className="p-2 text-slate-400 hover:text-slate-600 transition-colors">
              <X size={20} />
            </button>
          </header>

          <form onSubmit={handleSubmit} className="p-8 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Account Name (Internal)</label>
                <input
                  required
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Main Operations"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Bank Name</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={e => setBankName(e.target.value)}
                  placeholder="e.g. HDFC Bank"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Account Number</label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={e => setAccountNumber(e.target.value)}
                  placeholder="XXXX XXXX XXXX"
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Current Balance</label>
                <div className="relative">
                  <IndianRupee className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    required
                    type="number"
                    step="0.01"
                    value={balance}
                    onChange={e => setBalance(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Assigned Outlet</label>
                <div className="relative">
                  <Store className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <select
                    value={outletId}
                    onChange={e => setOutletId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-12 pr-6 py-4 text-sm font-bold text-slate-700 outline-none focus:border-indigo-500 transition-all appearance-none"
                  >
                    <option value="">-- No Outlet Assigned --</option>
                    {activeOutlets.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-slate-900 text-white py-4 rounded-2xl font-black uppercase text-xs tracking-widest flex items-center justify-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                {editingId ? 'Update Account' : 'Save Account'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="px-8 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-20 flex flex-col items-center justify-center text-slate-400">
            <Loader2 className="animate-spin mb-4" size={32} />
            <p className="font-bold uppercase text-xs tracking-widest">Loading accounts...</p>
          </div>
        ) : accounts.length === 0 ? (
          <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-200 rounded-[2.5rem]">
            <Wallet className="mx-auto text-slate-200 mb-4" size={48} />
            <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">No bank accounts defined</p>
          </div>
        ) : (
          accounts.map(acc => (
            <div key={acc.id} className="bg-white rounded-[2.5rem] border border-slate-200 p-8 shadow-sm hover:shadow-xl transition-all group relative overflow-hidden">
              <div className="absolute top-0 right-0 p-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleEdit(acc)} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all">
                  <Edit2 size={14} />
                </button>
                <button onClick={() => handleDelete(acc.id!)} className="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-600 hover:text-white transition-all">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="flex items-center gap-4 mb-6">
                <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-lg">
                  <Building2 size={24} />
                </div>
                <div>
                  <h4 className="font-black text-slate-900 uppercase tracking-tight">{acc.name}</h4>
                  <div className="flex items-center gap-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{acc.bankName || 'Unknown Bank'}</p>
                    {acc.outletId && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded-md text-[8px] font-black uppercase tracking-tighter">
                        <MapPin size={8} />
                        {getOutletName(acc.outletId)}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Available Balance</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-black text-slate-400">₹</span>
                    <span className="text-3xl font-black text-slate-900 tracking-tighter">{acc.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between px-2">
                  <div className="flex items-center gap-2">
                    <History size={14} className="text-slate-300" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                      Updated {new Date(acc.updatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  {acc.accountNumber && (
                    <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">
                      {acc.accountNumber.slice(-4).padStart(acc.accountNumber.length, '*')}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default BankManagement;
