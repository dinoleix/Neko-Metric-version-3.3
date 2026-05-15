
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, addDoc, doc, deleteDoc, updateDoc, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { BankAccount, SalesLedgerEntry, BankTransaction, MASTER_OUTLETS, getOutletName, StoreRental } from '../types';
import { Star } from 'lucide-react';
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
  MapPin,
  Banknote,
  Smartphone,
  ListOrdered,
  ChevronDown,
  ChevronUp,
  ArrowDownToLine,
  ArrowUpFromLine
} from 'lucide-react';

const BankManagement: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [activeOutletIds, setActiveOutletIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<Array<{
    id: string; description: string; date: string;
    amount: number; type: 'credit' | 'debit'; createdAt: number; channel?: string;
    source: 'sales_ledger' | 'bank_transactions';
  }>>([]);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<BankAccount | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [balance, setBalance] = useState('');
  const [outletId, setOutletId] = useState('');
  const [accountType, setAccountType] = useState<'cash' | 'digital' | '10kcash'>('digital');

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
      const data: any = {
        name,
        bankName,
        accountNumber,
        balance: parseFloat(balance) || 0,
        outletId: outletId || null,
        accountType,
        userId: user.uid,
        updatedAt: Date.now()
      };

      if (editingId) {
        // Don't overwrite isPrimary when editing other fields
        await updateDoc(doc(db, 'bank_accounts', editingId), data);
      } else {
        data.isPrimary = false;
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

  const handleSetPrimary = async (acc: BankAccount) => {
    try {
      // Unset any existing primary for same outlet + account type
      const toUnset = accounts.filter((a: BankAccount) =>
        a.id !== acc.id &&
        a.outletId === acc.outletId &&
        a.accountType === acc.accountType &&
        a.isPrimary
      );
      await Promise.all(toUnset.map((a: BankAccount) =>
        updateDoc(doc(db, 'bank_accounts', a.id!), { isPrimary: false })
      ));
      await updateDoc(doc(db, 'bank_accounts', acc.id!), { isPrimary: !acc.isPrimary });
      fetchAccounts();
    } catch (err) {
      console.error("Error setting primary:", err);
    }
  };

  const handleEdit = (acc: BankAccount) => {
    setEditingId(acc.id!);
    setName(acc.name);
    setBankName(acc.bankName || '');
    setAccountNumber(acc.accountNumber || '');
    setBalance(acc.balance.toString());
    setOutletId(acc.outletId || '');
    setAccountType(acc.accountType || 'digital');
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
    setAccountType('digital');
    setEditingId(null);
    setIsAdding(false);
  };

  const toggleLedger = async (accId: string) => {
    if (expandedAccountId === accId) {
      setExpandedAccountId(null);
      setLedgerEntries([]);
      return;
    }
    setExpandedAccountId(accId);
    setLoadingLedger(true);
    try {
      // Two queries for bank_transactions: admin-written (userId) and crew-written (ownerId).
      // Deduplicate by document ID so overlapping results aren't doubled.
      const [salesSnap, txByUser, txByOwner] = await Promise.all([
        getDocs(query(collection(db, 'sales_ledger'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'bank_transactions'), where('userId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'bank_transactions'), where('ownerId', '==', dataOwnerId))),
      ]);

      const fromSales = salesSnap.docs
        .filter(d => d.data().bankAccountId === accId)
        .map(d => {
          const e = d.data() as SalesLedgerEntry;
          return { id: d.id, description: e.description, date: e.date, amount: e.amount, type: 'credit' as const, createdAt: e.createdAt, channel: e.channel, source: 'sales_ledger' as const };
        });

      const txDocMap = new Map<string, any>();
      txByUser.docs.forEach(d => txDocMap.set(d.id, d));
      txByOwner.docs.forEach(d => txDocMap.set(d.id, d));

      const fromTx = Array.from(txDocMap.values())
        .filter(d => d.data().bankAccountId === accId && !d.data()._fileId)
        .map(d => {
          const e = d.data() as BankTransaction;
          return { id: d.id, description: e.description, date: e.date, amount: e.amount, type: e.type, createdAt: e.createdAt, source: 'bank_transactions' as const };
        });

      const merged = [...fromSales, ...fromTx].sort((a, b) => b.createdAt - a.createdAt);
      setLedgerEntries(merged);
    } catch (err) {
      console.error('Error fetching ledger:', err);
    } finally {
      setLoadingLedger(false);
    }
  };

  const handleDeleteLedgerEntry = async (entryId: string, source: 'sales_ledger' | 'bank_transactions') => {
    setDeletingEntryId(entryId);
    try {
      await deleteDoc(doc(db, source, entryId));
      setLedgerEntries(prev => prev.filter(e => e.id !== entryId));
    } catch (err) {
      console.error('Error deleting entry:', err);
    } finally {
      setDeletingEntryId(null);
    }
  };

  const openAccountModal = async (acc: BankAccount) => {
    setSelectedAccount(acc);
    setLedgerEntries([]);
    setLoadingLedger(true);
    try {
      const [salesSnap, txByUser, txByOwner] = await Promise.all([
        getDocs(query(collection(db, 'sales_ledger'), where('ownerId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'bank_transactions'), where('userId', '==', dataOwnerId))),
        getDocs(query(collection(db, 'bank_transactions'), where('ownerId', '==', dataOwnerId))),
      ]);
      const fromSales = salesSnap.docs
        .filter(d => d.data().bankAccountId === acc.id)
        .map(d => {
          const e = d.data() as SalesLedgerEntry;
          return { id: d.id, description: e.description, date: e.date, amount: e.amount, type: 'credit' as const, createdAt: e.createdAt, channel: e.channel, source: 'sales_ledger' as const };
        });
      const txDocMap = new Map<string, any>();
      txByUser.docs.forEach(d => txDocMap.set(d.id, d));
      txByOwner.docs.forEach(d => txDocMap.set(d.id, d));
      const fromTx = Array.from(txDocMap.values())
        .filter(d => d.data().bankAccountId === acc.id && !d.data()._fileId)
        .map(d => {
          const e = d.data() as BankTransaction;
          return { id: d.id, description: e.description, date: e.date, amount: e.amount, type: e.type, createdAt: e.createdAt, source: 'bank_transactions' as const };
        });
      setLedgerEntries([...fromSales, ...fromTx].sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      console.error('Error loading account modal:', err);
    } finally {
      setLoadingLedger(false);
    }
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

              <div className="space-y-2 md:col-span-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2">Account Type</label>
                <div className="grid grid-cols-3 gap-3 bg-slate-100 p-1.5 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setAccountType('digital')}
                    className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all ${accountType === 'digital' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    <Smartphone size={15} /> Digital
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('cash')}
                    className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all ${accountType === 'cash' ? 'bg-emerald-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    <Banknote size={15} /> Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('10kcash')}
                    className={`flex items-center justify-center gap-2 py-3.5 rounded-xl font-black uppercase text-xs tracking-widest transition-all ${accountType === '10kcash' ? 'bg-amber-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    <Banknote size={15} /> 10K Cash
                  </button>
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
            <div key={acc.id} onClick={() => openAccountModal(acc)} className={`bg-white rounded-[2.5rem] border p-8 shadow-sm hover:shadow-xl transition-all group relative cursor-pointer ${acc.isPrimary ? 'border-amber-300 ring-2 ring-amber-100' : 'border-slate-200'}`}>
              <div className="absolute top-0 right-0 p-5 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={e => { e.stopPropagation(); handleEdit(acc); }} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all active:scale-95">
                  <Edit2 size={14} />
                </button>
                <button onClick={e => { e.stopPropagation(); handleDelete(acc.id!); }} className="p-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-600 hover:text-white transition-all active:scale-95">
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="flex items-center gap-4 mb-6">
                <div className="p-4 bg-slate-900 text-white rounded-2xl shadow-lg">
                  <Building2 size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="font-black text-slate-900 uppercase tracking-tight">{acc.name}</h4>
                    {acc.accountType === 'cash' ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-lg text-[8px] font-black uppercase tracking-widest border border-emerald-200">
                        <Banknote size={9} /> Cash
                      </span>
                    ) : acc.accountType === '10kcash' ? (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-lg text-[8px] font-black uppercase tracking-widest border border-amber-200">
                        <Banknote size={9} /> 10K Cash
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-lg text-[8px] font-black uppercase tracking-widest border border-indigo-200">
                        <Smartphone size={9} /> Digital
                      </span>
                    )}
                  </div>
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

                <button
                  onClick={e => { e.stopPropagation(); handleSetPrimary(acc); }}
                  className={`w-full mt-2 py-3 rounded-2xl flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all active:scale-95 border ${
                    acc.isPrimary
                      ? 'bg-amber-50 text-amber-600 border-amber-300'
                      : 'bg-slate-50 text-slate-400 border-slate-200 hover:border-amber-300 hover:text-amber-500 hover:bg-amber-50'
                  }`}
                >
                  <Star size={13} fill={acc.isPrimary ? 'currentColor' : 'none'} />
                  {acc.isPrimary ? 'Primary Account' : 'Set as Primary'}
                </button>

                <button
                  onClick={e => { e.stopPropagation(); toggleLedger(acc.id!); }}
                  className="w-full mt-2 py-3 rounded-2xl flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all active:scale-95 border bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100"
                >
                  <ListOrdered size={13} />
                  {expandedAccountId === acc.id ? 'Hide Transactions' : 'View Transactions'}
                  {expandedAccountId === acc.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>
              </div>

              {/* Ledger panel */}
              {expandedAccountId === acc.id && (
                <div className="mt-6 border-t border-slate-100 pt-5">
                  {loadingLedger ? (
                    <div className="flex items-center justify-center py-6 gap-2 text-slate-400">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-xs font-bold uppercase tracking-widest">Loading...</span>
                    </div>
                  ) : ledgerEntries.length === 0 ? (
                    <p className="text-center text-xs font-bold text-slate-300 uppercase tracking-widest py-6">No transactions yet</p>
                  ) : (
                    <div className="space-y-2">
                      {ledgerEntries.map(entry => (
                        <div key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={`p-1.5 rounded-lg shrink-0 ${entry.type === 'credit' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-500'}`}>
                              {entry.type === 'credit' ? <ArrowDownToLine size={12} /> : <ArrowUpFromLine size={12} />}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-[11px] font-black text-slate-700 truncate">{entry.description}</p>
                                {entry.channel && entry.channel !== 'digital' && (
                                  <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shrink-0 ${
                                    entry.channel === 'card' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' :
                                    entry.channel === 'upi' ? 'bg-violet-50 text-violet-600 border border-violet-200' :
                                    'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                  }`}>
                                    {entry.channel.toUpperCase()}
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-slate-400 font-medium">{entry.date}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-sm font-black ${entry.type === 'credit' ? 'text-emerald-600' : 'text-rose-500'}`}>
                              {entry.type === 'credit' ? '+' : '-'}₹{entry.amount.toLocaleString('en-IN')}
                            </span>
                            <button
                              onClick={() => handleDeleteLedgerEntry(entry.id, entry.source)}
                              disabled={deletingEntryId === entry.id}
                              className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all disabled:opacity-50"
                              title="Delete transaction"
                            >
                              {deletingEntryId === entry.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Account Detail Modal */}
      <AnimatePresence>
        {selectedAccount && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedAccount(null)}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-[3rem] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-100"
            >
              {/* Modal header */}
              <div className="bg-slate-900 px-10 py-8 flex items-start justify-between gap-4 shrink-0">
                <div className="flex items-center gap-5">
                  <div className="p-4 bg-white/10 text-white rounded-2xl">
                    <Building2 size={28} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-xl font-black text-white uppercase tracking-tight">{selectedAccount.name}</h2>
                      {selectedAccount.isPrimary && (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-400/20 text-amber-300 rounded-lg text-[8px] font-black uppercase tracking-widest border border-amber-400/30">
                          <Star size={8} fill="currentColor" /> Primary
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{selectedAccount.bankName || 'Unknown Bank'}</span>
                      {selectedAccount.outletId && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-white/10 text-slate-300 rounded-md text-[8px] font-black uppercase tracking-tighter">
                          <MapPin size={8} /> {getOutletName(selectedAccount.outletId)}
                        </div>
                      )}
                      {selectedAccount.accountType === 'cash' ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-emerald-400/20 text-emerald-300 rounded-lg text-[8px] font-black uppercase tracking-widest border border-emerald-400/30"><Banknote size={8} /> Cash</span>
                      ) : selectedAccount.accountType === '10kcash' ? (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-400/20 text-amber-300 rounded-lg text-[8px] font-black uppercase tracking-widest border border-amber-400/30"><Banknote size={8} /> 10K Cash</span>
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-0.5 bg-indigo-400/20 text-indigo-300 rounded-lg text-[8px] font-black uppercase tracking-widest border border-indigo-400/30"><Smartphone size={8} /> Digital</span>
                      )}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedAccount(null)} className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all shrink-0">
                  <X size={20} />
                </button>
              </div>

              {/* Balance strip */}
              <div className="px-10 py-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between gap-4 shrink-0">
                <div>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Available Balance</p>
                  <div className="flex items-baseline gap-1">
                    <span className="text-sm font-black text-slate-400">₹</span>
                    <span className="text-4xl font-black text-slate-900 tracking-tighter">{selectedAccount.balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
                <div className="text-right">
                  {selectedAccount.accountNumber && (
                    <p className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-100">
                      {selectedAccount.accountNumber.slice(-4).padStart(selectedAccount.accountNumber.length, '*')}
                    </p>
                  )}
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                    Updated {new Date(selectedAccount.updatedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
              </div>

              {/* Transactions */}
              <div className="flex-1 overflow-y-auto px-10 py-6">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">
                  Transaction History
                </p>
                {loadingLedger ? (
                  <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
                    <Loader2 size={20} className="animate-spin" />
                    <span className="text-xs font-bold uppercase tracking-widest">Loading...</span>
                  </div>
                ) : ledgerEntries.length === 0 ? (
                  <div className="py-16 text-center">
                    <ListOrdered size={32} className="mx-auto text-slate-200 mb-3" />
                    <p className="text-xs font-black text-slate-300 uppercase tracking-widest">No transactions yet</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ledgerEntries.map(entry => (
                      <div key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 hover:bg-slate-100/60 transition-colors group">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`p-2 rounded-xl shrink-0 ${entry.type === 'credit' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-500'}`}>
                            {entry.type === 'credit' ? <ArrowDownToLine size={14} /> : <ArrowUpFromLine size={14} />}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-black text-slate-800 truncate">{entry.description}</p>
                              {entry.channel && entry.channel !== 'digital' && (
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest shrink-0 ${
                                  entry.channel === 'card' ? 'bg-indigo-50 text-indigo-600 border border-indigo-200' :
                                  entry.channel === 'upi' ? 'bg-violet-50 text-violet-600 border border-violet-200' :
                                  'bg-emerald-50 text-emerald-600 border border-emerald-200'
                                }`}>{entry.channel.toUpperCase()}</span>
                              )}
                            </div>
                            <p className="text-[10px] text-slate-400 font-medium mt-0.5">{entry.date}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`text-base font-black ${entry.type === 'credit' ? 'text-emerald-600' : 'text-rose-500'}`}>
                            {entry.type === 'credit' ? '+' : '-'}₹{entry.amount.toLocaleString('en-IN')}
                          </span>
                          <button
                            onClick={() => handleDeleteLedgerEntry(entry.id, entry.source)}
                            disabled={deletingEntryId === entry.id}
                            className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all disabled:opacity-50 opacity-0 group-hover:opacity-100"
                            title="Delete transaction"
                          >
                            {deletingEntryId === entry.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BankManagement;
