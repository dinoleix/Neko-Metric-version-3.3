# Recovery checkpoint before ownership or multi-tenant changes

Checkpoint date: 2026-09-16

- Recovery tag: `baseline-pre-tenant-2026-09-16`
- Backup branch: `checkpoint/pre-tenant-2026-09-16`
- Original application commit: `3e467e20d76e7d7045fb5e9f5ed51233ec513410`
- Local Git bundle: `recovery-pre-tenant-2026-09-16.bundle.local` in the project root.

This checkpoint preserves the application as it existed before any ownership/multi-tenant implementation in this session. The additional checkpoint files are documentation and the existing local MCP source. No tenant implementation or defect fixes are included. The baseline has known issues documented in `reviews/2026-09-16-app-review.md`; it is a recovery reference, not a guarantee that every workflow is correct.

## Safely inspect or restore the code

Preserve any later uncommitted work before switching. The following creates a new recovery branch without deleting later commits:

```sh
git switch -c restore/pre-tenant-2026-09-16 baseline-pre-tenant-2026-09-16
npm ci
npm run lint
npm run build
```

For a separate recovery directory, without touching your current working files:

```sh
git worktree add -b restore/pre-tenant-copy ../NekoMetrics-recovery baseline-pre-tenant-2026-09-16
```

The new directory needs its local environment configuration. Keep credentials out of Git.

## Recover if this Git repository is damaged

From a directory containing the bundle (adjust its path as needed):

```sh
git clone recovery-pre-tenant-2026-09-16.bundle.local NekoMetrics-recovered
cd NekoMetrics-recovered
git switch -c restore/pre-tenant baseline-pre-tenant-2026-09-16
```

The bundle contains committed Git history and the checkpoint references. It excludes ignored files, credentials, dependencies, generated build output, and the bundle itself. A bundle stored on this computer does not protect against losing the computer; retain the remote checkpoint or copy the bundle to your own backup storage.

## What code recovery does not restore

- Firestore records, Storage uploads, or Firebase Auth users.
- Deployed Firebase security rules/indexes. Their source is in Git, but switching branches does not deploy it.
- Hosting deployments or Vercel environment variables.
- Ignored `.env` configuration or `mcp/service-account.json`; keep those in your existing secure credential storage.

Before any future data migration: export the affected database data, record the export location and current deployment, and verify the restore procedure. Keep schema changes backward-compatible where possible. Reverting application code alone cannot undo migrated or deleted records.

## Development after this checkpoint

Leave the recovery tag unchanged. Create a separate implementation branch from the checkpoint for future work. Validate owner, manager, and crew workflows before deploying. Restoring production is a separate deployment decision; neither creating this checkpoint nor switching Git branches changes the live app.
