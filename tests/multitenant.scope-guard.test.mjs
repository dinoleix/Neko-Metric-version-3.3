import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const ignoredDirectories = new Set([
  '.git', '.next', '.vercel', 'coverage', 'dist', 'node_modules', 'scripts', 'sites', 'tests',
]);
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);

function sourceFiles(directory = repositoryRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

const directSdkImports = (source, sdk) => {
  const pattern = new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*)['"]${sdk}(?:/[^'"]*)?['"]`,
  );
  return sourceFiles().flatMap(path => {
    const relativePath = relative(repositoryRoot, path);
    if (relativePath === 'tenantFirestore.ts' && sdk === 'firebase/firestore') return [];
    if (['firebase.ts', 'tenantStorage.ts'].includes(relativePath) && sdk === 'firebase/storage') return [];
    return pattern.test(readFileSync(path, 'utf8')) ? [relativePath] : [];
  });
};

test('application code routes Firestore SDK calls through the tenant boundary', () => {
  assert.deepEqual(directSdkImports('firebase/firestore'), []);
});

test('application code routes Storage SDK calls through the tenant-aware storage boundary', () => {
  assert.deepEqual(directSdkImports('firebase/storage'), []);
});
