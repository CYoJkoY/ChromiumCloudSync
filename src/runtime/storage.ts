import type { SyncDiagnostics, UnknownRecord } from './types.js';

export interface SyncStorageState extends UnknownRecord {
  githubToken?: string;
  gistId?: string;
  gistEtag?: string;
  syncRevision?: number;
  syncBaseRevision?: number;
  syncBaseSnapshot?: UnknownRecord;
  lastSyncAt?: string;
  lastRemoteUpdatedAt?: string;
  lastSyncConflicts?: unknown[];
  autoSyncEnabled?: boolean;
  autoSyncIntervalMinutes?: number;
  tabSyncIds?: Record<string, string>;
  windowSyncIds?: Record<string, string>;
  groupSyncIds?: Record<string, string>;
  bookmarkSyncIds?: Record<string, string>;
  lastSyncDiagnostics?: SyncDiagnostics;
}

type StorageMutation<T> = () => Promise<T>;
let mutationTail: Promise<unknown> = Promise.resolve();

export async function readLocal<T extends keyof SyncStorageState>(keys: readonly T[]): Promise<Pick<SyncStorageState, T>>;
export async function readLocal(keys: string[]): Promise<Record<string, unknown>>;
export async function readLocal(keys: readonly string[]): Promise<Record<string, unknown>> {
  return chrome.storage.local.get([...keys]);
}

export async function writeLocal(values: Partial<SyncStorageState>): Promise<void> {
  await enqueueMutation(() => chrome.storage.local.set(values));
}

export async function removeLocal(keys: readonly string[]): Promise<void> {
  await enqueueMutation(() => chrome.storage.local.remove([...keys]));
}

export async function updateLocal<T extends Record<string, unknown>>(mutator: (current: SyncStorageState) => T | Promise<T>): Promise<T> {
  return enqueueMutation(async () => {
    const current = await chrome.storage.local.get(null) as SyncStorageState;
    const next = await mutator(current);
    await chrome.storage.local.set(next);
    return next;
  });
}

export function enqueueMutation<T>(mutation: StorageMutation<T>): Promise<T> {
  const run = mutationTail.then(mutation, mutation);
  mutationTail = run.catch(() => undefined);
  return run;
}

export function resetMutationQueueForTests(): void {
  mutationTail = Promise.resolve();
}
