import type { SyncDiagnostics } from './types.js';
import { writeLocal, readLocal } from './storage.js';

export const DIAGNOSTICS_KEY = 'lastSyncDiagnostics' as const;

export async function saveSyncDiagnostics(diagnostics: SyncDiagnostics): Promise<void> {
  await writeLocal({ [DIAGNOSTICS_KEY]: diagnostics });
}

export async function getSyncDiagnostics(): Promise<SyncDiagnostics | null> {
  const state = await readLocal(['lastSyncDiagnostics']);
  return (state.lastSyncDiagnostics as SyncDiagnostics | undefined) ?? null;
}

export function classifySyncError(error: unknown): SyncDiagnostics['result'] {
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: unknown }).status) : 0;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (status === 401 || status === 403 || code.includes('AUTH') || code.includes('TOKEN')) return 'auth-error';
  if (code.includes('SCHEMA') || code.includes('VALIDATION')) return 'validation-error';
  if (status === 408 || status === 429 || status >= 500) return 'network-error';
  return 'unknown';
}
