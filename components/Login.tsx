
import React, { useState } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  deleteUser,
  signOut,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { doc, setDoc, getDoc, writeBatch } from '../tenantFirestore';
import { auth, db } from '../firebase';
import { UserProfile } from '../types';
import { Mail, Lock, LogIn, UserPlus } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import { tenantMembershipId } from '../tenantTypes';

const Login: React.FC = () => {
  const multiTenantBuild = import.meta.env.MODE === 'multitenant-dev';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');
  const [outletName, setOutletName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // Sign in with email and password only (registration moved to admin panel)
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!multiTenantBuild) return;
    setLoading(true);
    setError('');
    let createdUser: Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user'] | null = null;
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      createdUser = credential.user;
      const tenantId = crypto.randomUUID();
      const outletId = crypto.randomUUID();
      const now = Date.now();
      const batch = writeBatch(db);
      batch.set(doc(db, 'tenants', tenantId), {
        name: restaurantName.trim(), status: 'active', currency: 'INR', timezone: 'Asia/Kolkata',
        ownerUserId: createdUser.uid, createdBy: createdUser.uid, createdAt: now, updatedAt: now,
      });
      batch.set(doc(db, 'tenant_memberships', tenantMembershipId(tenantId, createdUser.uid)), {
        tenantId, userId: createdUser.uid, email: createdUser.email || email.trim(), role: 'owner',
        outletIds: ['*'], status: 'active', createdBy: createdUser.uid, createdAt: now, updatedAt: now,
      });
      batch.set(doc(db, 'outlets', outletId), {
        tenantId, name: outletName.trim(), status: 'active', createdBy: createdUser.uid,
        createdAt: now, updatedAt: now,
      });
      await batch.commit();
    } catch (err: any) {
      if (createdUser) {
        try {
          await deleteUser(createdUser);
          await signOut(auth);
        } catch (cleanupError) {
          console.error('[tenant signup] cleanup after failed setup did not complete', cleanupError);
        }
      }
      setError(err?.code === 'auth/email-already-in-use'
        ? 'An account already exists for this email. Sign in or reset your password.'
        : err.message || 'Could not create your restaurant account. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Ensure firestore profile exists for Google logins (auto-create if missing)
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists()) {
        const profile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          role: 'viewer',
          createdAt: Date.now()
        };
        await setDoc(doc(db, 'users', user.uid), profile);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="login-shell min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-5 right-5 z-10"><ThemeToggle /></div>
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <div className="inline-flex h-28 w-36 items-center justify-center overflow-hidden rounded-2xl bg-black mb-4 shadow-xl shadow-emerald-950/40">
            <img src="/neko-tech.png" alt="NekoTech" className="h-full w-full object-contain scale-[1.65]" />
          </div>
          <h1 className="text-4xl font-semibold text-white mb-2 tracking-tight">NekoMetrics</h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.34em] text-amber-200/70">Restaurant Intelligence</p>
        </div>

        <div className="bg-white rounded-3xl p-8 shadow-2xl">
          <h2 className="text-xl font-bold text-slate-800 mb-6">
            {registering ? 'Create your restaurant account' : 'Welcome back'}
          </h2>

          <form onSubmit={registering ? handleRegister : handleSubmit} className="space-y-4">
            {registering && <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Restaurant or business name</label>
                <input type="text" required maxLength={100} value={restaurantName} onChange={e => setRestaurantName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Your restaurant group" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">First outlet name</label>
                <input type="text" required maxLength={100} value={outletName} onChange={e => setOutletName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="Main outlet" />
              </div>
            </>}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
            >
              {loading ? 'Processing...' : (
                <>
                  {registering ? <UserPlus size={20} /> : <LogIn size={20} />}
                  {registering ? 'Create account' : 'Log In'}
                </>
              )}
            </button>
          </form>

          {multiTenantBuild && <button type="button" onClick={() => { setRegistering(!registering); setError(''); }} className="mt-5 w-full text-sm font-semibold text-indigo-700 hover:text-indigo-900">
            {registering ? 'Already registered? Sign in' : 'Create a restaurant account'}
          </button>}

          {!multiTenantBuild && <div className="mt-8 flex items-center gap-4 text-slate-400">
            <div className="flex-1 h-px bg-slate-200"></div>
            <span className="text-xs font-medium uppercase tracking-wider">or continue with</span>
            <div className="flex-1 h-px bg-slate-200"></div>
          </div>}

          {!multiTenantBuild && <div className="mt-6 flex gap-3">
            <button 
              onClick={loginWithGoogle}
              className="flex-1 border border-slate-200 py-3 rounded-xl font-medium hover:bg-slate-50 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Google
            </button>
          </div>}
        </div>
      </div>
    </div>
  );
};

export default Login;
