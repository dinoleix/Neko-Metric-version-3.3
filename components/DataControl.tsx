import React, { lazy, Suspense, useState } from 'react';
import type { User } from 'firebase/auth';
import { Activity, Database, LayoutDashboard, ShieldCheck } from 'lucide-react';

const Dashboard = lazy(() => import('./Dashboard'));
const IntegrityAudit = lazy(() => import('./IntegrityAudit'));
const DataCatalog = lazy(() => import('./DataCatalog'));
const RawSalesHub = lazy(() => import('./RawSalesHub'));

type Tab = 'overview' | 'health' | 'library' | 'records';

const loading = <div className="py-20 flex justify-center"><div className="w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" /></div>;

const DataControl: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [tab, setTab] = useState<Tab>('overview');
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={16} /> },
    { id: 'health', label: 'Data health', icon: <ShieldCheck size={16} /> },
    { id: 'library', label: 'Data library', icon: <Database size={16} /> },
    { id: 'records', label: 'Raw records', icon: <Activity size={16} /> },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm w-fit">
        {tabs.map(item => (
          <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors ${tab === item.id ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}>
            {item.icon} {item.label}
          </button>
        ))}
      </div>
      <Suspense fallback={loading}>
        {tab === 'overview' && <Dashboard user={user} dataOwnerId={dataOwnerId} />}
        {tab === 'health' && <IntegrityAudit user={user} dataOwnerId={dataOwnerId} />}
        {tab === 'library' && <DataCatalog user={user} dataOwnerId={dataOwnerId} />}
        {tab === 'records' && <RawSalesHub user={user} dataOwnerId={dataOwnerId} />}
      </Suspense>
    </div>
  );
};

export default DataControl;
