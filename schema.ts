import type { CloudState, ConflictRecord, ExtensionRecord, BookmarkRecord, Snapshot, TabGroupRecord, TabRecord, Tombstone, UnknownRecord, WindowRecord } from './types.js';
import { SCHEMA_VERSION, mergeDeviceStates } from './sync-core.js';

export const SUPPORTED_SCHEMA_VERSIONS = [7, 8, 9, 10] as const;
export type SupportedSchemaVersion = typeof SUPPORTED_SCHEMA_VERSIONS[number];

export class SchemaValidationError extends Error {
  readonly code = 'SCHEMA_VALIDATION_FAILED';
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}

function flattenLegacyBookmarks(nodes: unknown, parentSyncId: string | null = null, out: UnknownRecord[] = []): UnknownRecord[] {
  if (!Array.isArray(nodes)) return out;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = isRecord(nodes[i]) ? nodes[i] : {};
    const syncId = isNonEmptyString(node.syncId) ? node.syncId : `legacy-bookmark-${crypto.randomUUID()}`;
    const item: UnknownRecord = { syncId, parentSyncId, index: i, title: typeof node.title === 'string' ? node.title : '' };
    if (typeof node.url === 'string' && node.url) item.url = node.url;
    out.push(item);
    flattenLegacyBookmarks(node.children, syncId, out);
  }
  return out;
}

function normalizeSnapshotShape(input: unknown): Snapshot {
  const value = isRecord(input) ? clone(input) : {};
  if (Array.isArray(value.bookmarks) && value.bookmarks.some((entry) => isRecord(entry) && Array.isArray(entry.children))) value.bookmarks = flattenLegacyBookmarks(value.bookmarks);
  delete value.device;
  if (isRecord(value.syncMeta)) delete value.syncMeta.devices;
  value.schemaVersion = SCHEMA_VERSION;
  if (!Array.isArray(value.extensions)) value.extensions = [];
  if (!Array.isArray(value.windows)) value.windows = [];
  if (!Array.isArray(value.bookmarks)) value.bookmarks = [];
  return value as Snapshot;
}

function migrateLegacyState(input: UnknownRecord, fromVersion: number): CloudState {
  let current: UnknownRecord = clone(input);
  if (fromVersion <= 9 && isRecord(current.devices)) {
    const merged = mergeDeviceStates(current.devices as Record<string, CloudState | null | undefined>);
    current = {
      schemaVersion: SCHEMA_VERSION,
      revision: Math.max(0, ...Object.values(current.devices).filter(isRecord).map((entry) => Number(entry.revision) || 0)),
      updatedAt: typeof current.updatedAt === 'string' ? current.updatedAt : new Date().toISOString(),
      snapshot: normalizeSnapshotShape(merged ?? {}),
      tombstones: [],
      conflicts: [],
    };
  } else {
    current = {
      schemaVersion: SCHEMA_VERSION,
      revision: Number(current.revision) || 0,
      updatedAt: typeof current.updatedAt === 'string' ? current.updatedAt : new Date().toISOString(),
      snapshot: normalizeSnapshotShape(current.snapshot ?? current),
      tombstones: Array.isArray(current.tombstones) ? current.tombstones as Tombstone[] : [],
      conflicts: Array.isArray(current.conflicts) ? current.conflicts as ConflictRecord[] : [],
    };
  }
  return current as CloudState;
}

export function migrateCloudState(input: unknown): CloudState {
  if (!isRecord(input)) throw new SchemaValidationError('Cloud state must be a JSON object.');
  const embeddedSnapshot = isRecord(input.snapshot) ? input.snapshot : input;
  const rawVersion = Number(input.schemaVersion ?? embeddedSnapshot.schemaVersion ?? 0);
  const fromVersion = Number.isFinite(rawVersion) && rawVersion > 0 ? rawVersion : SCHEMA_VERSION;
  if (fromVersion > SCHEMA_VERSION) throw new SchemaValidationError(`Unsupported future schema ${fromVersion}; current schema is ${SCHEMA_VERSION}.`);
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(fromVersion as SupportedSchemaVersion)) throw new SchemaValidationError(`Unsupported schema ${fromVersion}; supported versions are ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}.`);
  if (fromVersion === SCHEMA_VERSION) {
    return validateCloudState({
      schemaVersion: SCHEMA_VERSION,
      revision: Number(input.revision) || 0,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
      snapshot: normalizeSnapshotShape(embeddedSnapshot),
      tombstones: Array.isArray(input.tombstones) ? input.tombstones as Tombstone[] : [],
      conflicts: Array.isArray(input.conflicts) ? input.conflicts as ConflictRecord[] : [],
    });
  }
  return migrateLegacyState(input, fromVersion);
}

function validateExtension(value: unknown, index: number): asserts value is ExtensionRecord {
  if (!isRecord(value)) throw new SchemaValidationError(`snapshot.extensions[${index}] must be an object.`);
  for (const field of ['syncId', 'id', 'name', 'version'] as const) if (!isNonEmptyString(value[field])) throw new SchemaValidationError(`snapshot.extensions[${index}].${field} must be a non-empty string.`);
  if (typeof value.enabled !== 'boolean') throw new SchemaValidationError(`snapshot.extensions[${index}].enabled must be boolean.`);
  for (const field of ['description', 'homepageUrl', 'updateUrl', 'installType'] as const) if (value[field] !== undefined && typeof value[field] !== 'string') throw new SchemaValidationError(`snapshot.extensions[${index}].${field} must be a string when present.`);
}

function validateTabGroup(value: unknown, path: string): asserts value is TabGroupRecord {
  if (!isRecord(value)) throw new SchemaValidationError(`${path} must be an object.`);
  if (!isNonEmptyString(value.syncId)) throw new SchemaValidationError(`${path}.syncId must be a non-empty string.`);
  if (value.localId !== undefined && (!isFiniteNumber(value.localId) || value.localId < 0)) throw new SchemaValidationError(`${path}.localId must be a non-negative finite number when present.`);
  if (value.windowId !== undefined && (!isFiniteNumber(value.windowId) || value.windowId < 0)) throw new SchemaValidationError(`${path}.windowId must be a non-negative finite number when present.`);
  if (typeof value.title !== 'string') throw new SchemaValidationError(`${path}.title must be a string.`);
  if (!isNonEmptyString(value.color)) throw new SchemaValidationError(`${path}.color must be a non-empty string.`);
  if (typeof value.collapsed !== 'boolean') throw new SchemaValidationError(`${path}.collapsed must be boolean.`);
}

function validateTab(value: unknown, path: string): asserts value is TabRecord {
  if (!isRecord(value)) throw new SchemaValidationError(`${path} must be an object.`);
  if (!isNonEmptyString(value.syncId)) throw new SchemaValidationError(`${path}.syncId must be a non-empty string.`);
  if (!isNonEmptyString(value.url) || !/^https?:\/\//i.test(value.url)) throw new SchemaValidationError(`${path}.url must be a non-empty http(s) URL.`);
  if (typeof value.title !== 'string') throw new SchemaValidationError(`${path}.title must be a string.`);
  if (typeof value.pinned !== 'boolean' || typeof value.active !== 'boolean') throw new SchemaValidationError(`${path}.pinned and ${path}.active must be boolean.`);
  if (value.index !== undefined && (!isFiniteNumber(value.index) || value.index < 0)) throw new SchemaValidationError(`${path}.index must be a non-negative finite number when present.`);
  if (value.group !== undefined && value.group !== null) validateTabGroup(value.group, `${path}.group`);
}

function validateWindow(value: unknown, index: number): asserts value is WindowRecord {
  const path = `snapshot.windows[${index}]`;
  if (!isRecord(value)) throw new SchemaValidationError(`${path} must be an object.`);
  if (!isNonEmptyString(value.syncId)) throw new SchemaValidationError(`${path}.syncId must be a non-empty string.`);
  if (!isNonEmptyString(value.state)) throw new SchemaValidationError(`${path}.state must be a non-empty string.`);
  if (typeof value.focused !== 'boolean') throw new SchemaValidationError(`${path}.focused must be boolean.`);
  if (!Array.isArray(value.tabs)) throw new SchemaValidationError(`${path}.tabs must be an array.`);
  value.tabs.forEach((tab, tabIndex) => validateTab(tab, `${path}.tabs[${tabIndex}]`));
}

function validateBookmark(value: unknown, index: number): asserts value is BookmarkRecord {
  const path = `snapshot.bookmarks[${index}]`;
  if (!isRecord(value)) throw new SchemaValidationError(`${path} must be an object.`);
  if (!isNonEmptyString(value.syncId)) throw new SchemaValidationError(`${path}.syncId must be a non-empty string.`);
  if (value.parentSyncId !== null && !isNonEmptyString(value.parentSyncId)) throw new SchemaValidationError(`${path}.parentSyncId must be null or a non-empty string.`);
  if (!isFiniteNumber(value.index) || value.index < 0) throw new SchemaValidationError(`${path}.index must be a non-negative finite number.`);
  if (typeof value.title !== 'string') throw new SchemaValidationError(`${path}.title must be a string.`);
  if (value.url !== undefined && (!isNonEmptyString(value.url) || !/^https?:\/\//i.test(value.url))) throw new SchemaValidationError(`${path}.url must be a non-empty http(s) URL when present.`);
}

function validateTombstone(value: unknown, index: number): asserts value is Tombstone {
  const path = `tombstones[${index}]`;
  if (!isRecord(value)) throw new SchemaValidationError(`${path} must be an object.`);
  if (!isNonEmptyString(value.collection) || !isNonEmptyString(value.syncId)) throw new SchemaValidationError(`${path}.collection and ${path}.syncId must be non-empty strings.`);
  if (!isNonEmptyString(value.deletedAt)) throw new SchemaValidationError(`${path}.deletedAt must be a non-empty string.`);
  if (!isFiniteNumber(value.revision) || value.revision < 0) throw new SchemaValidationError(`${path}.revision must be a non-negative finite number.`);
}

function validateConflict(value: unknown, index: number): asserts value is ConflictRecord {
  const path = `conflicts[${index}]`;
  if (!isRecord(value)) throw new SchemaValidationError(`${path} must be an object.`);
  if (!isNonEmptyString(value.type) || !isNonEmptyString(value.status)) throw new SchemaValidationError(`${path}.type and ${path}.status must be non-empty strings.`);
  for (const field of ['collection', 'syncId', 'field', 'winner', 'strategy'] as const) if (value[field] !== undefined && typeof value[field] !== 'string') throw new SchemaValidationError(`${path}.${field} must be a string when present.`);
}

export function validateCloudState(state: CloudState): CloudState {
  if (!isRecord(state)) throw new SchemaValidationError('Cloud state must be an object.');
  if (state.schemaVersion !== SCHEMA_VERSION) throw new SchemaValidationError(`Expected schema ${SCHEMA_VERSION}, received ${state.schemaVersion}.`);
  if (!isFiniteNumber(state.revision) || state.revision < 0) throw new SchemaValidationError('Revision must be a non-negative finite number.');
  if (typeof state.updatedAt !== 'string' || !state.updatedAt) throw new SchemaValidationError('updatedAt must be a non-empty timestamp string.');
  if (!isRecord(state.snapshot)) throw new SchemaValidationError('snapshot must be an object.');
  if (!Array.isArray(state.snapshot.extensions)) throw new SchemaValidationError('snapshot.extensions must be an array.');
  if (!Array.isArray(state.snapshot.windows)) throw new SchemaValidationError('snapshot.windows must be an array.');
  if (!Array.isArray(state.snapshot.bookmarks)) throw new SchemaValidationError('snapshot.bookmarks must be an array.');
  state.snapshot.extensions.forEach((item, index) => validateExtension(item, index));
  state.snapshot.windows.forEach((item, index) => validateWindow(item, index));
  state.snapshot.bookmarks.forEach((item, index) => validateBookmark(item, index));
  if (!Array.isArray(state.tombstones)) throw new SchemaValidationError('tombstones must be an array.');
  if (!Array.isArray(state.conflicts)) throw new SchemaValidationError('conflicts must be an array.');
  state.tombstones.forEach((item, index) => validateTombstone(item, index));
  state.conflicts.forEach((item, index) => validateConflict(item, index));
  const seen = new Set<string>();
  for (const collection of ['extensions', 'windows', 'bookmarks'] as const) for (const item of state.snapshot[collection]) {
    const syncId = item.syncId;
    const key = `${collection}:${syncId}`;
    if (seen.has(key)) throw new SchemaValidationError(`Duplicate syncId detected: ${key}.`);
    seen.add(key);
  }
  return state;
}

export function parseAndValidateCloudState(input: unknown): CloudState {
  return validateCloudState(migrateCloudState(input));
}
