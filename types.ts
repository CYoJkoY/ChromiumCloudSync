export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }
export type UnknownRecord = Record<string, unknown>;

export interface ExtensionRecord extends UnknownRecord {
  syncId: string;
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  description?: string;
  homepageUrl?: string;
  updateUrl?: string;
  installType?: string;
}

export interface TabGroupRecord extends UnknownRecord {
  syncId: string;
  localId?: number;
  windowId?: number;
  title: string;
  color: string;
  collapsed: boolean;
}

export interface TabRecord extends UnknownRecord {
  syncId: string;
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  index?: number;
  group?: TabGroupRecord | null;
}

export interface WindowRecord extends UnknownRecord {
  syncId: string;
  state: string;
  focused: boolean;
  tabs: TabRecord[];
}

export interface BookmarkRecord extends UnknownRecord {
  syncId: string;
  parentSyncId: string | null;
  index: number;
  title: string;
  url?: string;
}

export interface Snapshot extends UnknownRecord {
  schemaVersion: number;
  updatedAt?: string;
  extensions: ExtensionRecord[];
  windows: WindowRecord[];
  bookmarks: BookmarkRecord[];
  syncMeta?: UnknownRecord;
  device?: UnknownRecord;
}

export interface Tombstone extends UnknownRecord {
  collection: string;
  syncId: string;
  deletedAt: string;
  revision: number;
}

export interface ConflictRecord extends UnknownRecord {
  type: string;
  collection?: string;
  syncId?: string;
  field?: string;
  status: 'resolved' | 'unresolved' | 'ignored' | string;
  winner?: 'local' | 'remote' | string;
  strategy?: string;
}

export interface CloudState {
  schemaVersion: number;
  revision: number;
  updatedAt: string;
  snapshot: Snapshot;
  tombstones: Tombstone[];
  conflicts: ConflictRecord[];
}

export interface MergeResult {
  snapshot: Snapshot;
  conflicts: ConflictRecord[];
}

export interface SyncDiagnostics {
  startedAt: string;
  finishedAt: string;
  result: 'success' | 'conflict' | 'remote-changed' | 'network-error' | 'auth-error' | 'validation-error' | 'unknown';
  baseRevision: number;
  localRevision: number;
  remoteRevision: number;
  uploadedRevision?: number;
  errorCode?: string;
  errorMessage?: string;
  changedCounts?: Record<string, number>;
}
