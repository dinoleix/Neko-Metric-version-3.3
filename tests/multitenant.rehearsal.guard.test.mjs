import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = resolve(repositoryRoot, 'scripts/multitenant-rehearsal.mjs');

const runRehearsalGuard = ({ projectId, emulatorHost }) => spawnSync(
  process.execPath,
  [scriptPath],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GCLOUD_PROJECT: projectId,
      ...(emulatorHost ? { FIRESTORE_EMULATOR_HOST: emulatorHost } : { FIRESTORE_EMULATOR_HOST: '' }),
    },
  },
);

test('migration rehearsal refuses to run without an emulator endpoint', () => {
  const result = runRehearsalGuard({ projectId: 'demo-neko-migration-rehearsal' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to run outside Firestore emulator project/);
});

test('migration rehearsal refuses any non-demo project even when an emulator host is set', () => {
  const result = runRehearsalGuard({
    projectId: 'nekometrics-mt-dev-2026',
    emulatorHost: '127.0.0.1:8088',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to run outside Firestore emulator project/);
});
