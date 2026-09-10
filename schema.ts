import type { CloudState, ConflictRecord, Snapshot, Tombstone, UnknownRecord } from './types.js';
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
function clone<T>(value: T): T {
  return value == null ? value : JSON.parse(JSON.stringify(value)) as T;
}
function flattenLegacyBookmarks(nodes: unknown, parentSyncId: string | null = null, out: UnknownRecord[] = []): UnknownRecord[] {
  if (!Array.isArray(nodes)) return out;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = isRecord(nodes[i]) ? nodes[i] : {};
    const syncId = typeof node.syncId === 'string' && node.syncId ? node.syncId : `legacy-bookmark-${crypto.randomUUID()}`;
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
export function validateCloudState(state: CloudState): CloudState {
  if (!isRecord(state)) throw new SchemaValidationError('Cloud state must be an object.');
  if (state.schemaVersion !== SCHEMA_VERSION) throw new SchemaValidationError(`Expected schema ${SCHEMA_VERSION}, received ${state.schemaVersion}.`);
  if (!isFiniteNumber(state.revision) || state.revision < 0) throw new SchemaValidationError('Revision must be a non-negative finite number.');
  if (typeof state.updatedAt !== 'string' || !state.updatedAt) throw new SchemaValidationError('updatedAt must be a non-empty ISO timestamp string.');
  if (!isRecord(state.snapshot)) throw new SchemaValidationError('snapshot must be an object.');
  for (const collection of ['extensions', 'windows', 'bookmarks'] as const) if (!Array.isArray(state.snapshot[collection])) throw new SchemaValidationError(`snapshot.${collection} must be an array.`);
  if (!Array.isArray(state.tombstones)) throw new SchemaValidationError('tombstones must be an array.');
  if (!Array.isArray(state.conflicts)) throw new SchemaValidationError('conflicts must be an array.');
  return state;
}
export function parseAndValidateCloudState(input: unknown): CloudState {
  return validateCloudState(migrateCloudState(input));
}
