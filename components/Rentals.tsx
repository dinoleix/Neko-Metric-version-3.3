
import React, { useState, useEffect, useMemo } from 'react';
import type { User } from 'firebase/auth';
import { collection, query, getDocs, where, addDoc, doc, updateDoc, arrayUnion, deleteDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { StoreRental, RentalHistory, MASTER_OUTLETS, getOutletName, StoreTier } from '../types';
// COMMENT: Added Loader2 to lucide-react imports
import { 
  Building2, 
  Plus, 
  Search, 
  MapPin, 
  Calendar, 
  DollarSign, 
  TrendingUp, 
  ChevronRight, 
  X,
  History,
  Trash2,
  Save,
  Clock,
  ArrowUpRight,
  ChevronDown,
  Power,
  CalendarX,
  AlertCircle,
  ShieldCheck,
  Layers2,
  Loader2
} from 'lucide-react';

const Rentals: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [rentals, setRentals] = useState<StoreRental[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [selectedRental, setSelectedRental] = useState<StoreRental | null>(null);
  
  // New Rental Form
  const [newStoreName, setNewStoreName] = useState('');
  const [newOutletId, setNewOutletId] = useState('');
  const [newStartDate, setNewStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [newBaseRent, setNewBaseRent] = useState('');
  const [newTier, setNewTier] = useState<StoreTier>('TIER_1');
  const [newAddress, setNewAddress] = useState('');
  const [newLat, setNewLat] = useState('');
  const [newLng, setNewLng] = useState('');

  // Increment Form
  const [incAmount, setIncAmount] = useState('');
  const [incDate, setIncDate] = useState(new Date().toISOString().split('T')[0]);
  const [incReason, setIncReason] = useState('');

  // Status Change State
  const [pendingStatus, setPendingStatus] = useState<'active' | 'closed'>('active');
  const [pendingCloseDate, setPendingCloseDate] = useState(new Date().toISOString().split('T')[0]);
  const [pendingTier, setPendingTier] = useState<StoreTier>('TIER_1');
  const [pendingAddress, setPendingAddress] = useState('');
  const [pendingLat, setPendingLat] = useState('');
  const [pendingLng, setPendingLng] = useState('');

  const fetchRentals = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'rentals'), where('userId', '==', dataOwnerId));
      const snap = await getDocs(q);
      setRentals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StoreRental)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRentals(); }, [user]);

  const handleAddRental = async (e: React.FormEvent) => {
    e.preventDefault();
    const rent = parseFloat(newBaseRent);
    if (!newStoreName || !newOutletId || isNaN(rent)) return;

    try {
      const rental: Omit<StoreRental, 'id'> = {
        storeName: newStoreName,
        outletId: newOutletId,
        startDate: newStartDate,
        baseRent: rent,
        currentRent: rent,
        status: 'active',
        tier: newTier,
        address: newAddress,
        latitude: newLat ? parseFloat(newLat) : undefined,
        longitude: newLng ? parseFloat(newLng) : undefined,
        history: [{ date: newStartDate, amount: rent, reason: 'Initial Agreement' }],
        userId: user.uid
      };
      await addDoc(collection(db, 'rentals'), rental);
      setIsAdding(false);
      setNewStoreName(''); setNewOutletId(''); setNewBaseRent(''); setNewTier('TIER_1');
      setNewAddress(''); setNewLat(''); setNewLng('');
      fetchRentals();
    } catch (err) { console.error(err); }
  };

  const handleAddIncrement = async () => {
    if (!selectedRental || !selectedRental.id || isNaN(parseFloat(incAmount))) return;
    const amount = parseFloat(incAmount);

    try {
      const newHistory: RentalHistory = {
        date: incDate,
        amount: amount,
        reason: incReason
      };
      const rentalRef = doc(db, 'rentals', selectedRental.id);
      await updateDoc(rentalRef, {
        currentRent: amount,
        history: arrayUnion(newHistory)
      });
      setIncAmount(''); setIncReason('');
      fetchRentals();
      setSelectedRental({
        ...selectedRental,
        currentRent: amount,
        history: [...selectedRental.history, newHistory]
      });
    } catch (err) { console.error(err); }
  };

  const handleUpdateStoreDetails = async () => {
    if (!selectedRental || !selectedRental.id) return;
    try {
      const rentalRef = doc(db, 'rentals', selectedRental.id);
      const updates: any = {
        status: pendingStatus,
        tier: pendingTier,
        address: pendingAddress,
        latitude: pendingLat ? parseFloat(pendingLat) : deleteField(),
        longitude: pendingLng ? parseFloat(pendingLng) : deleteField(),
        closeDate: pendingStatus === 'closed' ? pendingCloseDate : deleteField()
      };
      
      await updateDoc(rentalRef, updates);
      fetchRentals();
      setSelectedRental({ ...selectedRental, ...updates });
    } catch (err) { 
      console.error("Update failed:", err);
      alert("Error updating store.");
    }
  };

  const handleDeleteRental = async (id: string) => {
    if (!confirm("Wipe store record? This will NOT delete sales data, but will affect visibility filters.")) return;
    try {
      await deleteDoc(doc(db, 'rentals', id));
      setSelectedRental(null);
      fetchRentals();
    } catch (err) { console.error(err); }
  };

  const filteredRentals = rentals.filter(r => 
    r.storeName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.outletId.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = useMemo(() => {
    const active = rentals.filter(r => r.status === 'active');
    const totalMonthlyRent = active.reduce((acc, r) => acc + r.currentRent, 0);
    return {
      totalMonthlyRent,
      activeCount: active.length,
      closedCount: rentals.filter(r => r.status === 'closed').length,
      tier1Count: active.filter(r => r.tier === 'TIER_1').length,
      tier2Count: active.filter(r => r.tier === 'TIER_2').length
    };
  }, [rentals]);

  useEffect(() => {
    if (selectedRental) {
      setPendingStatus(selectedRental.status);
      setPendingCloseDate(selectedRental.closeDate || new Date().toISOString().split('T')[0]);
      setPendingTier(selectedRental.tier || 'TIER_1');
      setPendingAddress(selectedRental.address || '');
      setPendingLat(selectedRental.latitude?.toString() || '');
      setPendingLng(selectedRental.longitude?.toString() || '');
    }
  }, [selectedRental]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Store Hub</h2>
          <p className="text-slate-500 mt-1 font-medium">Manage lease agreements and service tiers.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-6 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all"
        >
          <Plus size={18} /> Add New Store
        </button>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-900 rounded-[2rem] p-8 text-white shadow-2xl border border-white/5">
          <p className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2">Monthly Liability</p>
          <h4 className="text-3xl font-black tracking-tighter">₹{stats.totalMonthlyRent.toLocaleString()}</h4>
          <p className="text-slate-500 text-[10px] font-bold mt-2 uppercase">From {stats.activeCount} Units</p>
        </div>
        <div className="bg-white rounded-[2rem] p-8 border border-slate-100 shadow-sm">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Service Mix</p>
          <div className="flex gap-4">
             <div className="flex-1 p-3 bg-slate-50 rounded-xl">
                <p className="text-[9px] font-black text-indigo-500 uppercase mb-1">Tier 1</p>
                <p className="text-xl font-black text-slate-900">{stats.tier1Count}</p>
             </div>
             <div className="flex-1 p-3 bg-slate-50 rounded-xl">
                <p className="text-[9px] font-black text-emerald-500 uppercase mb-1">Tier 2</p>
                <p className="text-xl font-black text-slate-900">{stats.tier2Count}</p>
             </div>
          </div>
        </div>
        <div className="bg-white rounded-[2rem] p-8 border border-slate-100 shadow-sm flex flex-col justify-center">
          <div className="flex items-center gap-2 text-indigo-500 mb-1">
            <Layers2 size={16} />
            <span className="text-[10px] font-black uppercase tracking-widest">Service Context</span>
          </div>
          <p className="text-slate-400 text-xs font-medium leading-tight">Tier-based costing separates packaging waste for small format vs full-service units.</p>
        </div>
      </section>

      <div className="flex items-center gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
          <input 
            type="text" placeholder="Search by store or ID..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            className="w-full pl-12 pr-4 py-4 bg-white border border-slate-100 rounded-2xl text-sm font-medium focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 outline-none shadow-sm transition-all"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading ? (
          <div className="col-span-full py-20 text-center"><Loader2 className="animate-spin mx-auto text-indigo-600" /></div>
        ) : filteredRentals.length === 0 ? (
          <div className="col-span-full py-20 bg-white rounded-[2.5rem] border border-slate-100 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">No records found</div>
        ) : filteredRentals.map(r => (
          <div 
            key={r.id} 
            onClick={() => setSelectedRental(r)}
            className={`group bg-white rounded-[2.5rem] border shadow-sm hover:shadow-xl transition-all cursor-pointer overflow-hidden flex flex-col hover:-translate-y-1 ${r.status === 'closed' ? 'border-rose-100 opacity-80' : 'border-slate-50'}`}
          >
            <div className="p-8 flex-1">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${r.status === 'closed' ? 'bg-rose-50 text-rose-500' : 'bg-indigo-50 text-indigo-600'}`}>
                    <Building2 size={24} />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 text-lg leading-tight">{r.storeName}</h3>
                    <p className="text-slate-400 text-[10px] font-bold uppercase mt-1">ID: {r.outletId}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest ${r.tier === 'TIER_2' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-indigo-50 text-indigo-600 border border-indigo-100'}`}>
                    {r.tier === 'TIER_2' ? 'Tier 2 Service' : 'Tier 1 Service'}
                  </div>
                  <div className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-widest ${r.status === 'closed' ? 'bg-rose-100 text-rose-600' : 'bg-emerald-100 text-emerald-600'}`}>
                    {r.status}
                  </div>
                </div>
              </div>
              
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Monthly Liability</p>
                    <p className={`text-2xl font-black ${r.status === 'closed' ? 'text-slate-400' : 'text-slate-900'}`}>₹{r.currentRent.toLocaleString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Escalation</p>
                    <p className="text-xs font-black text-rose-500">
                      +{Math.round((r.currentRent - r.baseRent) / (r.baseRent || 1) * 100)}%
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className={`px-8 py-4 border-t flex items-center justify-between font-black uppercase text-[10px] tracking-widest transition-all ${r.status === 'closed' ? 'bg-rose-50/30 border-rose-50 text-rose-600 group-hover:bg-rose-50' : 'bg-slate-50/50 border-slate-50 text-indigo-600 group-hover:bg-indigo-50'}`}>
              Store Settings <ChevronRight size={14} />
            </div>
          </div>
        ))}
      </div>

      {isAdding && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsAdding(false)} />
          <form onSubmit={handleAddRental} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
             <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-2xl font-black text-slate-900">Add New Outlet</h3>
                <button type="button" onClick={() => setIsAdding(false)} className="p-2 bg-slate-50 rounded-xl text-slate-400 hover:text-slate-900"><X size={20} /></button>
             </div>
             <div className="p-8 space-y-6">
                <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Display Name</label>
                   <input required type="text" value={newStoreName} onChange={e => setNewStoreName(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-700" placeholder="e.g. South Delhi Hub" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Monthly Rent</label>
                      <input required type="number" value={newBaseRent} onChange={e => setNewBaseRent(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-700" placeholder="₹0.00" />
                   </div>
                   <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Master Outlet ID</label>
                      <select required value={newOutletId} onChange={e => setNewOutletId(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 font-bold text-slate-700 outline-none appearance-none uppercase">
                          <option value="">Choose ID</option>
                          {MASTER_OUTLETS.map(o => <option key={o.id} value={o.id}>{o.id} ({o.name})</option>)}
                      </select>
                   </div>
                </div>
                <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Service Tier</label>
                   <div className="grid grid-cols-2 gap-3">
                      <button type="button" onClick={() => setNewTier('TIER_1')} className={`py-4 rounded-xl font-black text-[10px] uppercase transition-all ${newTier === 'TIER_1' ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>Tier 1 (Small)</button>
                      <button type="button" onClick={() => setNewTier('TIER_2')} className={`py-4 rounded-xl font-black text-[10px] uppercase transition-all ${newTier === 'TIER_2' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-50 text-slate-400 border border-slate-100'}`}>Tier 2 (Service)</button>
                   </div>
                   <p className="mt-2 text-[9px] text-slate-400 font-medium uppercase leading-relaxed">Tier 1 includes disposables (cups, spoons). Tier 2 uses proper service items.</p>
                </div>
                <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Commencement Date</label>
                   <input required type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none font-bold text-slate-700" />
                </div>
                <div className="space-y-4 pt-4 border-t border-slate-100">
                   <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em]">Physical Location</h4>
                   <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Store Address</label>
                      <textarea value={newAddress} onChange={e => setNewAddress(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-700 resize-none h-24" placeholder="Full physical address..." />
                   </div>
                   <div className="grid grid-cols-2 gap-4">
                      <div>
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Latitude</label>
                         <input type="number" step="any" value={newLat} onChange={e => setNewLat(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-700" placeholder="e.g. 28.5678" />
                      </div>
                      <div>
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Longitude</label>
                         <input type="number" step="any" value={newLng} onChange={e => setNewLng(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-700" placeholder="e.g. 77.1234" />
                      </div>
                   </div>
                </div>
             </div>
             <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-4 bg-white border border-slate-200 rounded-2xl font-black uppercase text-xs tracking-widest text-slate-400">Cancel</button>
                <button type="submit" className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-100 flex items-center justify-center gap-2"><Save size={18} /> Register Outlet</button>
             </div>
          </form>
        </div>
      )}

      {selectedRental && (
        <div className="fixed inset-0 z-[60] flex items-center justify-end">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setSelectedRental(null)} />
          <div className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-500">
             <header className={`p-8 border-b border-slate-100 flex items-center justify-between text-white ${selectedRental.status === 'closed' ? 'bg-rose-900' : 'bg-slate-900'}`}>
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-indigo-500 text-white shadow-xl shadow-indigo-500/20"><Building2 size={28} /></div>
                  <div><h3 className="text-2xl font-black tracking-tight">{selectedRental.storeName}</h3><p className="font-bold text-[10px] uppercase text-indigo-300">System ID: {selectedRental.outletId}</p></div>
                </div>
                <button onClick={() => setSelectedRental(null)} className="p-3 bg-white/10 rounded-2xl text-white/60 hover:text-white transition-all"><X size={24} /></button>
             </header>

             <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 space-y-8">
                   <div className="space-y-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block ml-1">Current Operational Status</label>
                      <div className="flex bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm">
                        <button onClick={() => setPendingStatus('active')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${pendingStatus === 'active' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}>Operational</button>
                        <button onClick={() => setPendingStatus('closed')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${pendingStatus === 'closed' ? 'bg-rose-600 text-white shadow-lg' : 'text-slate-400'}`}>Closed</button>
                      </div>
                   </div>

                   <div className="space-y-4">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block ml-1">Assigned Service Tier</label>
                      <div className="flex bg-white p-1.5 rounded-2xl border border-slate-100 shadow-sm">
                        <button onClick={() => setPendingTier('TIER_1')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${pendingTier === 'TIER_1' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400'}`}>Tier 1 (Small Format)</button>
                        <button onClick={() => setPendingTier('TIER_2')} className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${pendingTier === 'TIER_2' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400'}`}>Tier 2 (Full Service)</button>
                      </div>
                      <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tight ml-1">Adjusting this will immediately update the Packaging Waste Audit logic for this store.</p>
                   </div>

                   {pendingStatus === 'closed' && (
                     <div className="p-5 bg-white rounded-2xl border border-rose-200 shadow-sm animate-in slide-in-from-top-4 duration-300">
                        <label className="text-[10px] font-black text-rose-500 uppercase tracking-widest block mb-2 flex items-center gap-2"><Calendar size={12} /> Cutoff Date</label>
                        <input type="date" value={pendingCloseDate} onChange={e => setPendingCloseDate(e.target.value)} className="w-full bg-rose-50/30 border border-rose-100 px-4 py-3 rounded-xl font-black text-rose-900 outline-none" />
                     </div>
                   )}

                   <div className="space-y-6 pt-6 border-t border-slate-200">
                      <h4 className="text-[10px] font-black text-indigo-500 uppercase tracking-[0.2em] flex items-center gap-2"><MapPin size={12} /> Location Details</h4>
                      <div>
                         <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Physical Address</label>
                         <textarea value={pendingAddress} onChange={e => setPendingAddress(e.target.value)} className="w-full bg-white border border-slate-100 px-4 py-3 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 resize-none h-20" placeholder="Store address..." />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Latitude</label>
                            <input type="number" step="any" value={pendingLat} onChange={e => setPendingLat(e.target.value)} className="w-full bg-white border border-slate-100 px-4 py-3 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Lat" />
                         </div>
                         <div>
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Longitude</label>
                            <input type="number" step="any" value={pendingLng} onChange={e => setPendingLng(e.target.value)} className="w-full bg-white border border-slate-100 px-4 py-3 rounded-xl font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Lng" />
                         </div>
                      </div>
                   </div>

                   <button onClick={handleUpdateStoreDetails} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl transition-all flex items-center justify-center gap-2 hover:bg-indigo-600"><Save size={16} /> Save Lifecycle Settings</button>
                </div>

                <div>
                   <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-6 flex items-center gap-2"><History size={16} className="text-indigo-500" /> Lease Escalation Ledger</h4>
                   <div className="relative pl-8 space-y-8 before:content-[''] before:absolute before:left-3 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-100">
                      {selectedRental.history.slice().reverse().map((h, i) => (
                        <div key={i} className="relative group">
                           <div className="absolute -left-8 top-1.5 w-6 h-6 rounded-full bg-white border-4 border-slate-100 group-first:border-indigo-500 z-10"></div>
                           <div className="flex justify-between items-start mb-1">
                              <span className="text-xs font-black text-slate-900">₹{h.amount.toLocaleString()}</span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase bg-slate-50 px-2 py-0.5 rounded">{new Date(h.date).toLocaleDateString()}</span>
                           </div>
                           <p className="text-xs text-slate-500 font-medium">{h.reason || 'Periodic Review'}</p>
                        </div>
                      ))}
                   </div>
                </div>

                <div className="p-8 bg-indigo-50 rounded-[2.5rem] border border-indigo-100 space-y-6">
                   <h4 className="text-xs font-black text-indigo-900 uppercase tracking-widest flex items-center gap-2"><ArrowUpRight size={16} /> Record Contract Escalation</h4>
                   <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                           <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Revised Rent</label>
                           <input type="number" value={incAmount} onChange={e => setIncAmount(e.target.value)} className="w-full px-4 py-3 bg-white rounded-xl border border-indigo-200 outline-none font-bold text-slate-700 text-sm" placeholder="₹0.00" />
                        </div>
                        <div className="space-y-1.5">
                           <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Effective Date</label>
                           <input type="date" value={incDate} onChange={e => setIncDate(e.target.value)} className="w-full px-4 py-3 bg-white rounded-xl border border-indigo-200 outline-none font-bold text-slate-700 text-sm" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                         <label className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">Clause Notes</label>
                         <input type="text" value={incReason} onChange={e => setIncReason(e.target.value)} className="w-full px-4 py-3 bg-white rounded-xl border border-indigo-200 outline-none font-bold text-slate-700 text-sm" placeholder="e.g. Annual Appraisal" />
                      </div>
                      <button onClick={handleAddIncrement} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-indigo-700 shadow-lg shadow-indigo-100 flex items-center justify-center gap-2">Update Agreement</button>
                   </div>
                </div>
             </div>

             <footer className="p-8 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <button onClick={() => selectedRental.id && handleDeleteRental(selectedRental.id)} className="flex items-center gap-2 text-rose-500 font-black uppercase text-[10px] tracking-widest hover:text-rose-700"><Trash2 size={16} /> Delete Store</button>
                <button onClick={() => setSelectedRental(null)} className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-slate-800 transition-all">Close</button>
             </footer>
          </div>
        </div>
      )}
    </div>
  );
};

export default Rentals;
