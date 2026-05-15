
import React, { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { initializeApp, deleteApp, getApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { collection, getDocs, getDoc, doc, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../firebase';
// Reuse config for secondary instance
import { auth as primaryAuth } from '../firebase';
const firebaseConfig = {
  apiKey: "AIzaSyB3j7skPl-ykXVLxFQEvCZLrQEYslc0e5w",
  authDomain: "nekometrics-b38b9.firebaseapp.com",
  projectId: "nekometrics-b38b9",
  storageBucket: "nekometrics-b38b9.firebasestorage.app",
  messagingSenderId: "330123207916",
  appId: "1:330123207916:web:fb2f2a21e66229fe73f1c9"
};

import { UserProfile, UserRole, MASTER_OUTLETS, getOutletName } from '../types';
import {
  ShieldCheck,
  Trash2,
  Loader2,
  UserPlus,
  Search,
  Mail,
  Lock,
  ShieldAlert,
  X,
  Plus,
  Eye,
  EyeOff,
  Package
} from 'lucide-react';

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  crew: 'bg-amber-100 text-amber-700 border-amber-200',
  viewer: 'bg-emerald-100 text-emerald-700 border-emerald-200'
};

const UserManagement: React.FC<{ user: User }> = ({ user }) => {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  
  // New User Form State
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newRole, setNewRole] = useState<UserRole>('viewer');
  const [newOutlet, setNewOutlet] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [productCatalogEnabled, setProductCatalogEnabled] = useState<boolean | null>(null);
  const [togglingCatalog, setTogglingCatalog] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'category_settings', user.uid))
      .then(snap => setProductCatalogEnabled(snap.exists() ? snap.data().productCatalogEnabled === true : false))
      .catch(() => setProductCatalogEnabled(false));
  }, []);

  const handleToggleCatalog = async () => {
    const newVal = !productCatalogEnabled;
    setTogglingCatalog(true);
    try {
      await setDoc(doc(db, 'category_settings', user.uid), { productCatalogEnabled: newVal }, { merge: true });
      setProductCatalogEnabled(newVal);
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingCatalog(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, 'users'));
      setProfiles(snap.docs.map(d => ({ ...d.data(), uid: d.id } as UserProfile)));
    } catch (err) {
      console.error("Error fetching users:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleUpdateRole = async (targetUid: string, role: UserRole, outletId?: string) => {
    if (targetUid === user.uid) {
      alert("You cannot modify your own administrative role.");
      return;
    }
    try {
      const userRef = doc(db, 'users', targetUid);
      const updates: Partial<UserProfile> = { role, ownerId: user.uid };
      if (role === 'crew' && outletId) updates.assignedOutlet = outletId;
      else updates.assignedOutlet = '';

      await setDoc(userRef, updates, { merge: true });
      fetchUsers();
    } catch (err) {
      console.error(err);
      alert("Failed to update user access.");
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!newEmail.trim() || !newPassword.trim()) return;
    if (newPassword.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }

    setSaving(true);
    let secondaryApp;
    try {
      const emailNorm = newEmail.trim().toLowerCase();

      // Check if this email already has a Firestore profile
      const existingSnap = await getDocs(query(collection(db, 'users'), where('email', '==', emailNorm)));
      if (!existingSnap.empty) {
        const existingProfile = existingSnap.docs[0].data() as UserProfile;
        const confirmed = window.confirm(
          `${emailNorm} already has a profile (role: ${existingProfile.role}).\n\nDo you want to update their role to "${newRole}"${newRole === 'crew' ? ` and assign outlet "${newOutlet}"` : ''}?`
        );
        if (!confirmed) { setSaving(false); return; }
        await setDoc(doc(db, 'users', existingProfile.uid), {
          ...existingProfile,
          role: newRole,
          assignedOutlet: newRole === 'crew' ? newOutlet : undefined,
          ownerId: user.uid,
        });
        setIsAdding(false);
        setNewEmail('');
        setNewPassword('');
        setFormError(null);
        fetchUsers();
        return;
      }

      // Create a secondary Firebase app instance to avoid logging out the admin
      const appName = `temp-user-creator-${Date.now()}`;
      secondaryApp = initializeApp(firebaseConfig, appName);
      const secondaryAuth = getAuth(secondaryApp);

      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, emailNorm, newPassword);
      const realUid = userCredential.user.uid;

      const profile: UserProfile = {
        uid: realUid,
        email: emailNorm,
        role: newRole,
        createdAt: Date.now(),
        assignedOutlet: newRole === 'crew' ? newOutlet : undefined,
        ownerId: user.uid,
      };
      await setDoc(doc(db, 'users', realUid), profile);

      setIsAdding(false);
      setNewEmail('');
      setNewPassword('');
      setFormError(null);
      fetchUsers();
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setFormError(`${newEmail} is already registered in Firebase Authentication but has no profile here. Ask them to sign in once — their profile will be auto-created — then edit their role from the user list.`);
      } else {
        setFormError(err.message || "Failed to create user.");
      }
    } finally {
      if (secondaryApp) await deleteApp(secondaryApp);
      setSaving(false);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (uid === user.uid) return;
    if (!confirm("Permanently revoke access for this user in Database? (Note: This does not delete their Authentication entry automatically).")) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      fetchUsers();
    } catch (err) { console.error(err); }
  };

  const filtered = profiles.filter(p => (p.email || '').toLowerCase().includes((searchTerm || '').toLowerCase()));

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-20">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter">User Access Control</h2>
          <p className="text-slate-500 mt-1 font-medium uppercase tracking-widest text-[10px]">Managing internal roles and permissions.</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-6 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all"
        >
          <UserPlus size={18} /> Create New Account
        </button>
      </header>

      <section className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
           <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
              <input 
                type="text" 
                placeholder="Search by email..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl text-sm focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 outline-none transition-all font-bold" 
              />
           </div>
           <div className="flex items-center gap-4 text-slate-400 text-[10px] font-black uppercase tracking-widest">
              <ShieldCheck size={16} className="text-indigo-500" />
              <span>Auth & Data Synchronized</span>
           </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Identity / Email</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Role</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Assigned Outlet</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr><td colSpan={4} className="py-20 text-center"><Loader2 className="mx-auto animate-spin text-indigo-600" /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="py-20 text-center text-slate-400 font-bold uppercase text-xs tracking-widest">No matching users found</td></tr>
              ) : filtered.map(p => (
                <tr key={p.uid} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 font-black text-xs">
                        {(p.email || 'U')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-black text-slate-900">{p.email || 'No Email Registered'}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">Registered {new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <select 
                      value={p.role} 
                      disabled={p.uid === user.uid}
                      onChange={e => handleUpdateRole(p.uid, e.target.value as UserRole, p.assignedOutlet)}
                      className={`px-3 py-1.5 rounded-lg border text-[10px] font-black uppercase outline-none cursor-pointer ${ROLE_COLORS[p.role] || ROLE_COLORS.viewer}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="crew">Crew</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </td>
                  <td className="px-8 py-6">
                    {p.role === 'crew' ? (
                      <div className="relative">
                        <select
                          value={p.assignedOutlet || ''}
                          onChange={e => handleUpdateRole(p.uid, 'crew', e.target.value)}
                          className="w-full px-3 py-1.5 rounded-lg border border-indigo-300 bg-white text-[10px] font-bold uppercase outline-none focus:border-indigo-500 cursor-pointer hover:border-indigo-400 transition-colors"
                        >
                          <option value="">-- No Outlet --</option>
                          {MASTER_OUTLETS.filter(o => o.id !== 'GLOBAL').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      </div>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">HQ ACCESS</span>
                    )}
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex justify-end gap-2">
                       {p.uid !== user.uid && (
                         <button 
                          onClick={() => handleDeleteUser(p.uid)}
                          className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                         >
                            <Trash2 size={18} />
                         </button>
                       )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* CREW FEATURES */}
      <section className="bg-white rounded-[3rem] p-10 border border-slate-100 shadow-sm">
        <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-1">Crew Features</h3>
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-8">Control which features are available to crew members</p>
        <div className="flex items-center justify-between p-6 bg-slate-50 rounded-2xl border border-slate-100">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-50 rounded-2xl">
              <Package size={20} className="text-indigo-600" />
            </div>
            <div>
              <p className="text-sm font-black text-slate-900 uppercase">Product Catalog</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-0.5">Allow crew to browse and use the product catalog when logging entries</p>
            </div>
          </div>
          <button
            onClick={handleToggleCatalog}
            disabled={productCatalogEnabled === null || togglingCatalog}
            className={`relative inline-flex h-7 w-14 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${productCatalogEnabled ? 'bg-indigo-600' : 'bg-slate-200'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${productCatalogEnabled ? 'translate-x-8' : 'translate-x-1'}`} />
          </button>
        </div>
      </section>

      {/* ADD USER MODAL */}
      {isAdding && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setIsAdding(false)} />
          <form onSubmit={handleAddUser} className="relative w-full max-w-md bg-white rounded-[3rem] shadow-2xl overflow-hidden animate-in zoom-in duration-300">
             <header className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-4">
                   <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><UserPlus size={24} /></div>
                   <div>
                      <h3 className="text-xl font-black text-slate-900 uppercase">Create Account</h3>
                      <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">Register in Auth & Database</p>
                   </div>
                </div>
                <button type="button" onClick={() => setIsAdding(false)} className="p-2 text-slate-300 hover:text-slate-900"><X /></button>
             </header>

             <div className="p-8 space-y-6">
                <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">Email Address</label>
                   <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                      <input 
                        required 
                        type="email" 
                        value={newEmail} 
                        onChange={e => setNewEmail(e.target.value)}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all"
                        placeholder="user@example.com"
                      />
                   </div>
                </div>

                <div>
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">Temp Password</label>
                   <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
                      <input 
                        required 
                        type={showPassword ? 'text' : 'password'}
                        value={newPassword} 
                        onChange={e => setNewPassword(e.target.value)}
                        className="w-full pl-12 pr-12 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all"
                        placeholder="Min 6 chars"
                      />
                      <button 
                        type="button" 
                        onClick={() => setShowPassword(!showPassword)} 
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      >
                         {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                      </button>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                   <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">Assign Role</label>
                      <select 
                        value={newRole} 
                        onChange={e => setNewRole(e.target.value as UserRole)}
                        className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none uppercase text-xs"
                      >
                         <option value="viewer">Viewer</option>
                         <option value="crew">Crew</option>
                         <option value="admin">Admin</option>
                      </select>
                   </div>
                   {newRole === 'crew' && (
                     <div className="animate-in slide-in-from-left-2 duration-200">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2 px-1">Default Store</label>
                        <select 
                          required={newRole === 'crew'}
                          value={newOutlet} 
                          onChange={e => setNewOutlet(e.target.value)}
                          className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-700 outline-none uppercase text-xs"
                        >
                           <option value="">Select Store</option>
                           {MASTER_OUTLETS.filter(o => o.id !== 'GLOBAL').map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                     </div>
                   )}
                </div>
             </div>

             {formError && (
               <div className="mx-8 mb-2 px-5 py-4 bg-rose-50 border border-rose-200 rounded-2xl flex items-start gap-3">
                 <ShieldAlert size={16} className="text-rose-500 shrink-0 mt-0.5" />
                 <p className="text-xs font-bold text-rose-700 leading-relaxed">{formError}</p>
               </div>
             )}
             <footer className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                <button type="button" onClick={() => { setIsAdding(false); setFormError(null); }} className="flex-1 py-4 bg-white border border-slate-200 rounded-2xl font-black uppercase text-xs text-slate-400">Cancel</button>
                <button type="submit" disabled={saving} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs flex items-center justify-center gap-2 shadow-xl shadow-indigo-100 transition-all hover:bg-indigo-700">
                   {saving ? <Loader2 size={18} className="animate-spin" /> : <ShieldAlert size={18} />} {saving ? 'Registering...' : 'Confirm Access'}
                </button>
             </footer>
          </form>
        </div>
      )}
    </div>
  );
};

export default UserManagement;
