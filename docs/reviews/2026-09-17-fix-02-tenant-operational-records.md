# Fix 2: tenant-bound crew and waste records

Status: implemented locally and emulator-tested; not deployed.

## Change

Addresses D02 from the application review. `crew_entries` and `waste_entries` no longer fall through to the generic Firestore write rule. Their explicit rules now validate the acting user, business owner, role, and outlet.

- Crew can create records only with their own `userId`, their actual tenant's `ownerId`, and their assigned outlet.
- Owner admins and delegated admins/managers can create and edit records across outlets inside their own tenant.
- Crew can still update a teammate's crew entry during a same-outlet shift handover.
- An update cannot change the original author or move a record to another tenant. Crew also cannot move records to another outlet.
- Tenant staff can delete records only inside their tenant. Crew can delete only records they authored in their assigned outlet, preserving the previous delete boundary.
- Viewers remain unable to write. Existing same-tenant read behavior is unchanged by this fix.

No React component, financial calculation, historical record, or production rule was changed. Other permission findings, especially D03's broader viewer and outlet authorization, remain separate work.

## Evidence

Four new two-tenant scenarios were added to the existing rules suite. Against the pre-fix rules, 23 of 26 tests passed and three scenarios failed because forbidden operations succeeded. Against the corrected rules, all 26 pass.

The suite confirms:

- Valid crew creation for the assigned outlet.
- Rejection of forged author, foreign tenant, other outlet, and viewer creation.
- Same-outlet shift handover reads and status updates.
- Rejection of crew ownership/outlet changes and teammate deletion.
- Owner/admin/manager create, update, and delete operations inside their tenant.
- Rejection of reads, updates, deletes, and attempted adoption by another tenant's owner, admin, manager, and crew member.
- The 22 profile/access-group and representative financial regression checks from Fix 1 still pass.

Validation completed:

```text
npm run test:rules  26 passed, 0 failed
npm run lint        passed
npm run build       passed
git diff --check    passed
```

The build retains its existing large Firebase chunk and empty React vendor chunk warnings. Those warnings were present before this rules change and are unrelated to it.

## Deployment boundary

The local frontend continues using the currently configured backend until rules are deployed. No Firebase project was selected, queried, or modified during this fix. Before production deployment, preserve the deployed rules for rollback, verify the exact Firebase project, and run the emulator suite again from the deployment commit.
