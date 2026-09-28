import React, { useState } from 'react';
import type { User } from 'firebase/auth';
import { MapPin, Users } from 'lucide-react';
import LoginActivity from './LoginActivity';
import UserManagement from './UserManagement';

type Tab = 'users' | 'activity';

const AccessAdministration: React.FC<{ user: User; dataOwnerId: string }> = ({ user, dataOwnerId }) => {
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm w-fit">
        <button
          type="button"
          onClick={() => setTab('users')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors ${tab === 'users' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
        >
          <Users size={16} /> User access
        </button>
        <button
          type="button"
          onClick={() => setTab('activity')}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-colors ${tab === 'activity' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
        >
          <MapPin size={16} /> Login activity
        </button>
      </div>

      {tab === 'users'
        ? <UserManagement user={user} dataOwnerId={dataOwnerId} />
        : <LoginActivity user={user} dataOwnerId={dataOwnerId} />}
    </div>
  );
};

export default AccessAdministration;
