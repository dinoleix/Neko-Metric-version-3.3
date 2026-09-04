import { MODULES, MODULE_BY_ID, ModuleId } from './moduleRegistry';
import type { UserProfile, UserGroup } from './types';

/**
 * Which modules an account may open.
 *
 * A group REPLACES the role defaults rather than narrowing them: a ticked box in
 * the group editor does exactly what it says, which means a group can widen
 * access as well as trim it. That is deliberate — the alternative is an editor
 * where some ticks silently do nothing. Modules flagged `sensitive` in the
 * registry carry a warning badge so widening is a decision, not an accident.
 *
 * This is a presentation filter, NOT a security boundary. Nothing in
 * firestore.rules consults a group, so a member of any group can still read every
 * collection their `ownerId` link already permits. Hiding a nav entry hides the
 * link, not the data.
 */
export function resolveAllowedModules(
  profile: UserProfile,
  group: UserGroup | null | undefined,
): Set<ModuleId> {
  // Crew never reach the sidebar — App.tsx forks to the fullscreen Crew Terminal
  // before it renders. Belt and braces so a stray caller cannot widen them.
  if (profile.role === 'crew') return new Set<ModuleId>();

  const roleDefaults = () =>
    new Set<ModuleId>(MODULES.filter(m => m.defaultRoles.includes(profile.role)).map(m => m.id));

  // No group assigned → exactly the behaviour that existed before groups. This is
  // the fallback every un-migrated account lands on, so it must stay correct.
  if (!profile.groupId) return roleDefaults();

  // Group deleted or unreadable → same fallback, never a locked-out user.
  if (!group) {
    console.warn(`[access] group ${profile.groupId} not found for ${profile.uid}; using role defaults`);
    return roleDefaults();
  }

  // Unknown ids are dropped so a renamed or removed module cannot resurrect itself.
  const allowed = new Set<ModuleId>(
    group.moduleIds.filter((id): id is ModuleId => MODULE_BY_ID.has(id as ModuleId)),
  );

  // Role-locked modules are never group-controlled. 'users' is the only one: an
  // admin always keeps the group editor (so no group can lock them out of it),
  // and nobody else ever gets it however the group is configured.
  for (const m of MODULES) {
    if (!m.roleLocked) continue;
    if (m.roleLocked === profile.role) allowed.add(m.id);
    else allowed.delete(m.id);
  }

  return allowed;
}
