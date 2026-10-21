/** Prefix Storage paths with the active tenant in the isolated build. */
import * as storageApi from 'firebase/storage';
import type { FirebaseStorage, StorageReference } from 'firebase/storage';
import { getTenantFirestoreScope } from './tenantFirestore';

export * from 'firebase/storage';

const rawRef = storageApi.ref as any;
export const ref: typeof storageApi.ref = ((storageOrReference: FirebaseStorage | StorageReference, path?: string, ...segments: string[]) => {
  const scope = getTenantFirestoreScope();
  const isStorageInstance = typeof (storageOrReference as any)?._bucket === 'string';
  if (!scope || !isStorageInstance || typeof path !== 'string' || path.startsWith(`tenants/${scope.tenantId}/`) || path.startsWith('tenants/')) {
    return path === undefined
      ? rawRef(storageOrReference)
      : rawRef(storageOrReference, path, ...segments);
  }
  return rawRef(storageOrReference, `tenants/${scope.tenantId}/${path}`, ...segments);
}) as typeof storageApi.ref;
