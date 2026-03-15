
import React, { useState, useEffect } from 'react';
import type { User } from '@firebase/auth';
import { collection, query, getDocs, where, addDoc, doc, deleteDoc, writeBatch, serverTimestamp } from '@firebase/firestore';
import { db } from '../firebase';
import { Holiday, StoreRental, MASTER_OUTLETS } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Calendar, 
  Plus, 
  Trash2, 
  Sparkles, 
  Loader2, 
  MapPin, 
  Info,
  AlertCircle,
  CheckCircle2,
  X,
  Globe
} from 'lucide-react';

const HolidayRegistry: React.FC<{ user: User }> = ({ user }) => {
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [outlets, setOutlets] = useState<StoreRental[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Form state
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newType, setNewType] = useState<'public' | 'regional' | 'custom'>('public');
  const [newRegion, setNewRegion] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch Holidays
      const hQuery = query(collection(db, 'holidays'), where('userId', '==', user.uid));
      const hSnap = await getDocs(hQuery);
      const hList = hSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Holiday));
      setHolidays(hList.sort((a, b) => a.date.localeCompare(b.date)));

      // Fetch Outlets for region context
      const oQuery = query(collection(db, 'rentals'), where('userId', '==', user.uid));
      const oSnap = await getDocs(oQuery);
      setOutlets(oSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as StoreRental)));
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleAddHoliday = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newDate) return;

    try {
      const holiday: Omit<Holiday, 'id'> = {
        name: newName,
        date: newDate,
        type: newType,
        region: newRegion || undefined,
        userId: user.uid,
        createdAt: Date.now()
      };
      await addDoc(collection(db, 'holidays'), holiday);
      setIsAdding(false);
      setNewName('');
      setNewRegion('');
      fetchData();
      setStatus({ type: 'success', message: 'Holiday added successfully' });
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: 'Failed to add holiday' });
    }
  };

  const handleDeleteHoliday = async (id: string) => {
    if (!confirm("Delete this holiday?")) return;
    try {
      await deleteDoc(doc(db, 'holidays', id));
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const seedHolidays = async () => {
    setIsSeeding(true);
    setStatus(null);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
      
      // Get unique regions from outlets
      const regions = Array.from(new Set(outlets.map(o => o.address || '').filter(a => a.length > 0)));
      const regionContext = regions.length > 0 
        ? `The stores are located in: ${regions.join(', ')}.` 
        : "The stores are primarily in India.";

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `List all major public and regional holidays for the year 2025 and 2026. ${regionContext} 
        Return the data as a JSON array of objects with properties: name (string), date (YYYY-MM-DD), type (string: "public" or "regional"), and region (string).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                date: { type: Type.STRING },
                type: { type: Type.STRING },
                region: { type: Type.STRING }
              },
              required: ["name", "date", "type"]
            }
          }
        }
      });

      const aiHolidays = JSON.parse(response.text);
      const batch = writeBatch(db);
      
      aiHolidays.forEach((h: any) => {
        // Check if holiday already exists (simple date/name check)
        const exists = holidays.some(existing => existing.date === h.date && existing.name === h.name);
        if (!exists) {
          const newHolidayRef = doc(collection(db, 'holidays'));
          batch.set(newHolidayRef, {
            ...h,
            userId: user.uid,
            createdAt: Date.now()
          });
        }
      });

      await batch.commit();
      fetchData();
      setStatus({ type: 'success', message: `Successfully seeded ${aiHolidays.length} holidays.` });
    } catch (err) {
      console.error("Seeding failed:", err);
      setStatus({ type: 'error', message: 'AI Seeding failed. Please check your API key or try again.' });
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter">Holiday Registry</h2>
          <p className="text-slate-500 mt-1 font-medium">Manage public and regional holidays for sales context.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={seedHolidays}
            disabled={isSeeding}
            className="flex items-center gap-2 px-6 py-4 bg-indigo-50 text-indigo-600 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-indigo-100 transition-all disabled:opacity-50"
          >
            {isSeeding ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            Smart Seed (AI)
          </button>
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-6 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all"
          >
            <Plus size={18} /> Add Holiday
          </button>
        </div>
      </header>

      {status && (
        <div className={`p-4 rounded-2xl flex items-center gap-3 animate-in slide-in-from-top-2 duration-300 ${status.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-rose-50 text-rose-700 border border-rose-100'}`}>
          {status.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <p className="text-xs font-bold uppercase tracking-wider">{status.message}</p>
          <button onClick={() => setStatus(null)} className="ml-auto p-1 hover:bg-black/5 rounded-lg"><X size={14} /></button>
        </div>
      )}

      <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <Calendar className="text-indigo-600" size={20} />
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">Upcoming Calendar</h3>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-xl border border-slate-100 shadow-sm">
            <Globe size={14} className="text-slate-400" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
              {outlets.length} Outlets Tracked
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-50">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Holiday Name</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Region</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center">
                    <Loader2 className="animate-spin mx-auto text-indigo-600 mb-4" size={32} />
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading Registry...</p>
                  </td>
                </tr>
              ) : holidays.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center">
                    <div className="max-w-xs mx-auto">
                      <Calendar className="mx-auto text-slate-200 mb-4" size={48} />
                      <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">No Holidays Registered</p>
                      <p className="text-xs text-slate-400 font-medium">Use the Smart Seed button to automatically populate holidays based on your store locations.</p>
                    </div>
                  </td>
                </tr>
              ) : holidays.map(h => (
                <tr key={h.id} className="group hover:bg-slate-50/50 transition-all">
                  <td className="px-8 py-5">
                    <div className="flex flex-col">
                      <span className="text-sm font-black text-slate-900">{new Date(h.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">{new Date(h.date).getFullYear()}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    <span className="text-sm font-bold text-slate-700">{h.name}</span>
                  </td>
                  <td className="px-8 py-5">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                      h.type === 'public' ? 'bg-indigo-50 text-indigo-600' : 
                      h.type === 'regional' ? 'bg-emerald-50 text-emerald-600' : 
                      'bg-amber-50 text-amber-600'
                    }`}>
                      {h.type}
                    </span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2 text-slate-500">
                      <MapPin size={12} />
                      <span className="text-xs font-medium">{h.region || 'National'}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button 
                      onClick={() => h.id && handleDeleteHoliday(h.id)}
                      className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-indigo-900 rounded-[2.5rem] p-10 text-white shadow-2xl relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-white/10 rounded-xl backdrop-blur-md">
              <Info className="text-indigo-300" size={20} />
            </div>
            <h4 className="text-xl font-black tracking-tight uppercase">Why track holidays?</h4>
          </div>
          <p className="text-indigo-200 text-sm font-medium leading-relaxed mb-8">
            Holidays are a primary driver of sales volatility. By maintaining this registry, the Neko Metrics AI can automatically adjust its projections, accounting for expected foot traffic spikes or drops during national and regional events.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl border border-white/10">
              <div className="p-2 bg-emerald-500/20 rounded-lg text-emerald-400">
                <CheckCircle2 size={16} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-widest mb-1">Smart Projections</p>
                <p className="text-[11px] text-indigo-300/80 leading-snug">AI uses these dates to predict high-volume days.</p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-white/5 rounded-2xl border border-white/10">
              <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                <CheckCircle2 size={16} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-widest mb-1">Regional Context</p>
                <p className="text-[11px] text-indigo-300/80 leading-snug">Holidays are filtered by store location automatically.</p>
              </div>
            </div>
          </div>
        </div>
        <Calendar className="absolute -right-20 -bottom-20 w-80 h-80 text-white/5 rotate-12" />
      </div>

      {isAdding && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsAdding(false)} />
          <form onSubmit={handleAddHoliday} className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
             <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-2xl font-black text-slate-900">Add Holiday</h3>
                <button type="button" onClick={() => setIsAdding(false)} className="p-2 bg-slate-50 rounded-xl text-slate-400 hover:text-slate-900"><X size={20} /></button>
             </div>
             <div className="p-8 space-y-6">
                <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Holiday Name</label>
                   <input required type="text" value={newName} onChange={e => setNewName(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-700" placeholder="e.g. Diwali" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Date</label>
                      <input required type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-700" />
                   </div>
                   <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Type</label>
                      <select value={newType} onChange={e => setNewType(e.target.value as any)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 font-bold text-slate-700 outline-none appearance-none">
                          <option value="public">Public</option>
                          <option value="regional">Regional</option>
                          <option value="custom">Custom</option>
                      </select>
                   </div>
                </div>
                <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Region (Optional)</label>
                   <input type="text" value={newRegion} onChange={e => setNewRegion(e.target.value)} className="w-full px-5 py-4 bg-slate-50 rounded-2xl border border-slate-100 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-slate-700" placeholder="e.g. Delhi" />
                </div>
             </div>
             <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-4 bg-white border border-slate-200 rounded-2xl font-black uppercase text-xs tracking-widest text-slate-400">Cancel</button>
                <button type="submit" className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-indigo-100 flex items-center justify-center gap-2">Register Holiday</button>
             </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default HolidayRegistry;
