import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { collection, getDocs, limit, orderBy, query, where, writeBatch } from 'firebase/firestore';
import { Clock3, ExternalLink, Loader2, MapPin, ShieldCheck, Trash2 } from 'lucide-react';
import { db } from '../firebase';
import type { LoginActivityRecord } from '../types';
import { getOutletName } from '../types';

const formatTime = (value: unknown): string => {
  const date = value && typeof value === 'object' && 'toDate' in value
    ? (value as { toDate: () => Date }).toDate()
    : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Just now';
};

const LoginActivity: React.FC<{ user: User; dataOwnerId: string }> = ({ dataOwnerId }) => {
  const [records, setRecords] = useState<LoginActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);

  const clearHistory = async () => {
    if (!window.confirm('Clear all login activity for this business? This cannot be undone.')) return;
    setClearing(true);
    setError('');
    try {
      const snap = await getDocs(query(
        collection(db, 'login_activity'),
        where('ownerId', '==', dataOwnerId),
      ));
      for (let start = 0; start < snap.docs.length; start += 450) {
        const batch = writeBatch(db);
        snap.docs.slice(start, start + 450).forEach(record => batch.delete(record.ref));
        await batch.commit();
      }
      setRecords([]);
    } catch (err) {
      console.error('[login activity] clear failed:', err);
      setError('Login history could not be cleared.');
    } finally {
      setClearing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setError('');
    getDocs(query(
      collection(db, 'login_activity'),
      where('ownerId', '==', dataOwnerId),
      orderBy('loggedInAt', 'desc'),
      limit(100),
    ))
      .then(snap => setRecords(snap.docs.map(d => ({ id: d.id, ...d.data() } as LoginActivityRecord))))
      .catch(err => {
        console.error('[login activity] load failed:', err);
        setError('Login history could not be loaded.');
      })
      .finally(() => setLoading(false));
  }, [dataOwnerId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 mb-2">
            <ShieldCheck size={20} />
            <span className="text-xs font-black uppercase tracking-widest">Admin only</span>
          </div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Login Activity</h2>
          <p className="text-sm text-slate-500 mt-2">Who signed in, when, and their reported location.</p>
        </div>
        <button
          type="button"
          onClick={clearHistory}
          disabled={clearing || loading || records.length === 0}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-rose-200 bg-rose-50 text-rose-700 text-xs font-black uppercase tracking-wider hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {clearing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          {clearing ? 'Clearing…' : 'Clear history'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-indigo-600" /></div>
        ) : error ? (
          <div className="p-8 text-center text-rose-600 font-semibold">{error}</div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No login activity recorded yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {records.map(record => {
              const hasLocation = record.locationStatus === 'available'
                && typeof record.latitude === 'number' && typeof record.longitude === 'number';
              const mapUrl = hasLocation
                ? `https://www.google.com/maps?q=${record.latitude},${record.longitude}`
                : '';
              return (
                <div key={record.id} className="p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-4">
                  <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-black uppercase">
                    {record.email?.[0] || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-900 truncate">{record.email || 'Unknown user'}</p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-1">
                      {record.role}{record.assignedOutlet ? ` · ${getOutletName(record.assignedOutlet)}` : ''}
                    </p>
                  </div>
                  <div className="md:w-56 text-sm text-slate-600 flex items-center gap-2">
                    <Clock3 size={16} className="text-slate-400 shrink-0" /> {formatTime(record.loggedInAt)}
                  </div>
                  <div className="md:w-64 text-sm flex items-center gap-2">
                    <MapPin size={16} className={hasLocation ? 'text-emerald-500 shrink-0' : 'text-slate-400 shrink-0'} />
                    {hasLocation ? (
                      <a href={mapUrl} target="_blank" rel="noreferrer" className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-1">
                        View on map <ExternalLink size={13} />
                      </a>
                    ) : (
                      <span className="text-slate-500 capitalize">Location {record.locationStatus}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default LoginActivity;
