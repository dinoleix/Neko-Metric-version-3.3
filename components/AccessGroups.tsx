import React, { useState, useMemo } from 'react';
import {
  collection, query, where, getDocs, addDoc, updateDoc, deleteDoc, doc, setDoc, writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserGroup, UserProfile, UserRole } from '../types';
import { MODULES, MODULE_SECTIONS, ModuleId } from '../moduleRegistry';
import {
  Layers, Plus, Pencil, Trash2, Loader2, X, ShieldAlert, Sparkles, Users as UsersIcon,
} from 'lucide-react';

/**
 * Access groups — a named set of modules an admin hands to people.
 *
 * A group REPLACES the role defaults rather than trimming them, so a tick does
 * exactly what it says and a group can widen access as well as narrow it.
 * Modules flagged `sensitive` in the registry carry a badge for that reason.
 *
 * This is sidebar tidiness, not security: nothing in firestore.rules reads
 * moduleIds. The header says so, and it should keep saying so.
 */
const AccessGroups: React.FC<{
  dataOwnerId: string;
  groups: UserGroup[];
  profiles: UserProfile[];
  onChanged: () => void;
}> = ({ dataOwnerId, groups, profiles, onChanged }) => {
  const [editing, setEditing] = useState<UserGroup | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftModules, setDraftModules] = useState<Set<ModuleId>>(new Set());
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Modules an admin can actually assign. roleLocked ones are never offered —
  // 'users' is force-granted to admins by resolveAllowedModules, so showing a
  // tick for it would imply a control that does not exist.
  const assignable = useMemo(() => MODULES.filter(m => !m.roleLocked), []);

  const memberCount = (groupId: string) => profiles.filter(p => p.groupId === groupId).length;

  const openNew = () => {
    setIsNew(true); setEditing(null); setDraftName(''); setDraftModules(new Set());
  };

  const openEdit = (g: UserGroup) => {
    setIsNew(false); setEditing(g); setDraftName(g.name);
    setDraftModules(new Set(g.moduleIds as ModuleId[]));
  };

  const closeModal = () => { setEditing(null); setIsNew(false); };

  const toggle = (id: ModuleId) => {
    setDraftModules(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSection = (section: string, on: boolean) => {
    setDraftModules(prev => {
      const next = new Set(prev);
      assignable.filter(m => m.section === section)
        .forEach(m => on ? next.add(m.id) : next.delete(m.id));
      return next;
    });
  };

  const handleSave = async () => {
    const name = draftName.trim();
    if (!name) { alert('Give the group a name.'); return; }
    setSaving(true);
    try {
      const payload = {
        name,
        moduleIds: Array.from(draftModules),
        userId: dataOwnerId,
        ownerId: dataOwnerId,
        updatedAt: Date.now(),
      };
      if (editing) await updateDoc(doc(db, 'user_groups', editing.id), payload);
      else await addDoc(collection(db, 'user_groups'), { ...payload, createdAt: Date.now() });
      closeModal();
      onChanged();
    } catch (err) {
      console.error(err);
      alert('Could not save the group. See console.');
    } finally { setSaving(false); }
  };

  const handleDelete = async (g: UserGroup) => {
    // Blocked rather than cascaded: members would silently fall back to their
    // role defaults, which is a surprising way to discover a deletion.
    const count = memberCount(g.id);
    if (count > 0) {
      alert(`${count} ${count === 1 ? 'person is' : 'people are'} still in "${g.name}". Move them to another group first.`);
      return;
    }
    if (!confirm(`Delete the "${g.name}" group?`)) return;
    try {
      await deleteDoc(doc(db, 'user_groups', g.id));
      onChanged();
    } catch (err) { console.error(err); alert('Delete failed.'); }
  };

  /**
   * Creates Admin / Viewer / Crew groups matching what each role sees today, and
   * puts un-grouped members in the matching one.
   *
   * Idempotent by two guards: a group is created only when none carries that
   * seedKey, and a user is touched only when groupId is empty. moduleIds comes
   * from defaultRoles in the registry, never hand-typed, so the seeded groups
   * cannot drift from the pre-groups behaviour they are meant to reproduce.
   */
  const handleSeed = async () => {
    if (!confirm('Create starter groups and put existing users in them?')) return;
    setSeeding(true);
    try {
      // Re-query rather than trusting props, to narrow the window where two
      // admins pressing this at once both see zero groups.
      const fresh = await getDocs(query(collection(db, 'user_groups'), where('ownerId', '==', dataOwnerId)));
      const existing = fresh.docs.map(d => ({ id: d.id, ...d.data() } as UserGroup));

      const seedIds: Record<UserRole, string> = { admin: '', manager: '', viewer: '', crew: '' };
      let created = 0;

      for (const roleKey of ['admin', 'manager', 'viewer', 'crew'] as UserRole[]) {
        const already = existing.find(g => g.seedKey === roleKey);
        if (already) { seedIds[roleKey] = already.id; continue; }
        const label = roleKey.charAt(0).toUpperCase() + roleKey.slice(1);
        const ref = await addDoc(collection(db, 'user_groups'), {
          name: label,
          // Crew never see a sidebar, so their group is legitimately empty.
          moduleIds: MODULES.filter(m => m.defaultRoles.includes(roleKey)).map(m => m.id),
          seedKey: roleKey,
          userId: dataOwnerId,
          ownerId: dataOwnerId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        seedIds[roleKey] = ref.id;
        created++;
      }

      // Only members of this tenant. Accounts auto-created at first sign-in carry
      // no ownerId and are skipped — they keep role defaults, so their behaviour
      // is unchanged, but the count is reported rather than hidden.
      const members = profiles.filter(p => p.ownerId === dataOwnerId || p.uid === dataOwnerId);
      const skippedOrphans = profiles.length - members.length;

      // Only profiles carrying one of the three known roles. `role` is unvalidated
      // in Firestore and profiles are auto-created, so a missing or misspelled one
      // is possible — and seedIds[undefined] is undefined, which Firestore rejects
      // outright ("Unsupported field value"), failing the whole batch rather than
      // that single user.
      const toAssign = members.filter(p => !p.groupId && seedIds[p.role]);
      const badRole = members.filter(p => !p.groupId && !seedIds[p.role]);

      for (let i = 0; i < toAssign.length; i += 400) {
        const batch = writeBatch(db);
        toAssign.slice(i, i + 400).forEach(p => {
          batch.set(doc(db, 'users', p.uid), { groupId: seedIds[p.role] }, { merge: true });
        });
        await batch.commit();
      }

      onChanged();
      alert(
        `Created ${created} group${created === 1 ? '' : 's'}. Assigned ${toAssign.length} user${toAssign.length === 1 ? '' : 's'}.\n` +
        `Skipped ${members.filter(p => p.groupId).length} already in a group` +
        (skippedOrphans > 0 ? `, ${skippedOrphans} not linked to your business` : '') +
        (badRole.length > 0 ? `, ${badRole.length} with an unrecognised role` : '') + '.'
      );
    } catch (err: any) {
      console.error('[seed] failed:', err);
      // Surface the actual reason. "See console" sends you hunting for a message
      // that is usually one of two things: rules not deployed, or a bad field.
      const code = err?.code ? ` (${err.code})` : '';
      const hint = err?.code === 'permission-denied'
        ? '\n\nThe user_groups security rules are probably not deployed yet. Run:\n  firebase deploy --only firestore:rules'
        : '';
      alert(`Seeding failed${code}: ${err?.message || err}${hint}`);
    } finally { setSeeding(false); }
  };

  const sorted = [...groups].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="bg-white rounded-[2.5rem] border border-slate-100 p-10 shadow-sm mt-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-sky-50 text-sky-600 rounded-2xl"><Layers size={22} /></div>
          <div>
            <h3 className="text-xl font-black text-slate-900 tracking-tight">Access Groups</h3>
            <p className="text-slate-500 text-sm font-medium mt-0.5">
              Which modules appear in a person's sidebar. This is a tidiness setting, not a
              security boundary — data stays reachable to anyone with an account.
            </p>
          </div>
        </div>
        <button onClick={openNew}
          className="shrink-0 px-5 py-3 bg-indigo-600 text-white rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center gap-2 hover:bg-indigo-700 transition-all">
          <Plus size={15} /> New Group
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center">
          <p className="text-sm font-bold text-slate-700">No groups yet</p>
          <p className="text-slate-500 text-sm mt-1 mb-5 max-w-lg mx-auto">
            Set up starter groups — creates Admin, Viewer and Crew groups matching what each
            role sees today, and puts existing users in the matching group. Nothing changes
            about what anyone can see.
          </p>
          <button onClick={handleSeed} disabled={seeding}
            className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black uppercase text-[10px] tracking-widest inline-flex items-center gap-2 disabled:opacity-50">
            {seeding ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {seeding ? 'Setting up' : 'Set up starter groups'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sorted.map(g => {
            const count = memberCount(g.id);
            return (
              <div key={g.id} className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="text-sm font-black text-slate-900 uppercase tracking-wide truncate">{g.name}</h4>
                    {g.seedKey && <span className="text-[8px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">Starter</span>}
                  </div>
                  <p className="text-[11px] font-bold text-slate-400 mt-2 flex items-center gap-3">
                    <span className="flex items-center gap-1"><UsersIcon size={11} /> {count} {count === 1 ? 'member' : 'members'}</span>
                    <span>{g.moduleIds.length} modules</span>
                  </p>
                </div>
                <div className="flex gap-2 mt-5">
                  <button onClick={() => openEdit(g)}
                    className="flex-1 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-indigo-200 hover:text-indigo-600 flex items-center justify-center gap-1.5">
                    <Pencil size={12} /> Edit
                  </button>
                  <button onClick={() => handleDelete(g)}
                    className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-rose-500 hover:border-rose-200">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {(editing || isNew) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={closeModal} />
          <div className="relative bg-white rounded-[2.5rem] p-10 w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="flex items-start justify-between mb-8">
              <div>
                <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                  {isNew ? 'New Group' : `Edit "${editing?.name}"`}
                </h3>
                <p className="text-slate-500 text-sm font-medium mt-1">
                  Tick the modules this group should see in the sidebar.
                </p>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-700"><X size={20} /></button>
            </div>

            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Group name</label>
            <input value={draftName} onChange={e => setDraftName(e.target.value)}
              placeholder="Finance, Procurement…"
              className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-700 outline-none focus:border-indigo-500 mb-8" />

            <div className="space-y-6">
              {MODULE_SECTIONS.map(section => {
                const items = assignable.filter(m => m.section === section);
                if (items.length === 0) return null;
                const allOn = items.every(m => draftModules.has(m.id));
                return (
                  <div key={section}>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{section}</p>
                      <button onClick={() => toggleSection(section, !allOn)}
                        className="text-[10px] font-black uppercase tracking-widest text-indigo-500 hover:text-indigo-700">
                        {allOn ? 'Clear all' : 'Select all'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {items.map(m => (
                        <label key={m.id}
                          className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                            draftModules.has(m.id) ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}>
                          <input type="checkbox" checked={draftModules.has(m.id)} onChange={() => toggle(m.id)}
                            className="w-4 h-4 accent-indigo-600" />
                          <span className="text-slate-400">{m.icon}</span>
                          <span className="text-xs font-bold text-slate-700 flex-1 truncate">{m.label}</span>
                          {m.sensitive && (
                            <span title="Granting this shows real financial or personal data"
                              className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-1">
                              <ShieldAlert size={9} /> Sensitive
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] font-medium text-slate-400 mt-8 leading-relaxed">
              User Access is not listed: admins always keep it, so nobody can lock themselves
              out of this screen, and it is never given to anyone else.
              <br />
              Changes take effect the next time the person reloads the page or signs in.
            </p>

            <div className="flex gap-4 mt-8">
              <button onClick={closeModal}
                className="flex-1 py-4 bg-slate-50 text-slate-400 rounded-2xl font-black uppercase text-[10px] tracking-widest">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 disabled:opacity-50">
                {saving && <Loader2 size={14} className="animate-spin" />}
                {isNew ? 'Create Group' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default AccessGroups;
