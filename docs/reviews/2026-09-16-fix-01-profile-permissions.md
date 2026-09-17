# Fix 1: profile and access-group permission bypass

Status: implemented locally and emulator-tested; not deployed.

## Change

Addresses D01 from the application review. The generic Firestore match now explicitly excludes `users` and `user_groups` from both reads and writes. Specific rules can no longer be bypassed by putting a caller-owned `userId` on an identity document.

First sign-in still creates the same default viewer profile used by App and Login, but requires a matching uid and the four expected fields. Users cannot change their own uid/userId, role, tenant, outlet, or group. Existing legacy profiles carrying userId remain readable and can still update their email, without regaining the generic write bypass.

Managing another user's privileges requires an actual admin who owns that tenant, not merely an unlinked viewer whose tenant fallback is their own uid. Owners retain account creation, adoption of unlinked accounts, role/outlet/group assignment to members, and profile revocation. Delegated admins retain group administration, but cannot transfer group ownership or assign user roles. Group membership remains a navigation preference, not backend data authorization.

No operational collection rule, UI component, financial calculation, or stored record was changed. Other reviewed permission defects, including D02 cross-tenant crew/waste writes and D03 viewer/outlet authorization, remain separate work. This fix alone does not make the complete ruleset safe for multiple tenants.

## Evidence

The same 22 tests ran against the original and corrected rules:

- Original: 5 passed, 17 failed because forbidden operations were accepted.
- Corrected: 22 passed, 0 failed.
- Tests exercise first sign-in, forged self-provisioning, two-step escalation preparation, legacy injected ownership, self privilege edits/deletion, unlinked-account administration, legitimate owner workflows, delegated-admin group workflows, tenant group isolation, unauthenticated access, representative financial reads/writes, and crew entry updates.
- TypeScript checking and Vite production build are run separately; the rules tests do not replace them.
- All pre-existing runtime dependency versions in the lockfile are preserved. New dependencies are development-only Firebase testing tools.

Tests use synthetic records in `demo-neko-rules`. They reject any emulator host other than `127.0.0.1:8088` and require the demo project environment. No production writes or rule deployment occurred. These checks cover the changed permission paths and representative existing operations; they do not guarantee that every application feature is regression-free.

## Run locally

Prerequisites: Node.js 22 or 24, Java 21 or newer on PATH, and installed npm dependencies. The first run downloads the official Firestore emulator; no Firebase sign-in is required. The separate test configuration leaves the production Firebase configuration unchanged.

```sh
npm run test:rules
npm run lint
npm run build
```

On the review machine Java was unavailable, so a checksum-verified official Temurin 21 JRE was unpacked into `/tmp/neko-review-java`. Nothing was installed system-wide. For this temporary session:

```sh
env JAVA_HOME=/tmp/neko-review-java/jdk-21.0.12.1+1-jre/Contents/Home \
  PATH=/tmp/neko-review-java/jdk-21.0.12.1+1-jre/Contents/Home/bin:$PATH \
  FIREBASE_EMULATORS_PATH=/tmp/neko-review-emulators npm run test:rules
```

The temporary runtime/cache can disappear after cleanup or restart. Use an installed Java 21 runtime for a durable development or CI setup.

## Remaining compatibility limits

The existing UI offers some actions already rejected by the original explicit rules (for example, self group assignment and delegated-admin user role edits). This change preserves those restrictions rather than expanding access. The existing cross-tenant admin user-list read remains unchanged and needs its own tenant-scoped query/rules fix.

Before any production rollout, retain the previously deployed rules for rollback and verify the intended project. Do not deploy this partial permission fix as evidence that the remaining audit findings are resolved.
