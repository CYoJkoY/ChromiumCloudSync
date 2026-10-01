import { readLocal } from "./storage.js";
import {
  HISTORY_INDEX_FILE,
  LEGACY_MONOLITHIC_FILE,
  MANIFEST_FILE,
  META_FILE,
  MODULE_FILES,
  SYNC_MODULE_IDS,
} from "./sync-modules.js";
import { LEGACY_ALT_FILE } from "./cloud-files.js";
import type {
  FileStore,
  FileStoreReadResult,
  HistoryEntry,
} from "./cloud-files.js";
import type { SyncModuleId } from "./sync-modules.js";

/**
 * WebDAV transport.
 *
 * WebDAV is a plain file store, so the modular layout maps directly onto the
 * configured folder. WebDAV has no server-side versioning that an MV3 service
 * worker can rely on (PROPFIND responses are XML and DOMParser is unavailable
 * in a worker), so this provider maintains its own `history/` archive and
 * `history/index.json` control file.
 */

export const WEBDAV_HISTORY_LIMIT = 30;
const WEBDAV_HISTORY_INDEX_SCHEMA = 2;

interface DavConfig {
  url: string;
  folder: string;
  user: string;
  pass: string;
}

interface DavIndexEntry {
  id: string;
  createdAt: string;
  layout?: "modular" | "legacy";
  revision?: number;
  files?: string[];
  /** Modules whose payload changed in this archived revision. */
  modules?: string[];
}

interface DavIndex {
  schemaVersion?: number;
  entries?: DavIndexEntry[];
}

export async function webdavConfig(): Promise<DavConfig> {
  const state = await readLocal([
    "webdavSyncUrl",
    "webdavSyncFolder",
    "webdavSyncUsername",
    "webdavSyncPassword",
  ]);
  return {
    url: String(state.webdavSyncUrl || "")
      .trim()
      .replace(/\/+$/, ""),
    folder: String(state.webdavSyncFolder || "").trim(),
    user: String(state.webdavSyncUsername || ""),
    pass: String(state.webdavSyncPassword || ""),
  };
}

function normalizeFolder(value: string): string {
  let path = String(value || "")
    .trim()
    .replace(/\\/g, "/");
  if (!path) return "";
  if (!path.startsWith("/")) path = `/${path}`;
  return path.replace(/\/+/g, "/").replace(/\/$/, "");
}

export function webdavBound(config?: DavConfig | null): boolean {
  return !!config?.url;
}

async function ensureOrigin(url: string): Promise<void> {
  const origin = `${new URL(url).origin}/*`;
  if (!chrome.permissions?.request) return;
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  if (!(await chrome.permissions.request({ origins: [origin] })))
    throw Error("WebDAV 需要允许访问该服务器地址");
}

async function dav(
  config: DavConfig,
  relative: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!config.url) throw Error("尚未配置 WebDAV 地址");
  await ensureOrigin(config.url);
  const clean = String(relative || "").replace(/^\/+/, "");
  const target = `${config.url}${normalizeFolder(config.folder)}${clean ? `/${clean}` : ""}`;
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) || {}),
  };
  if (config.user || config.pass)
    headers.Authorization = `Basic ${btoa(unescape(encodeURIComponent(`${config.user}:${config.pass}`)))}`;
  return fetch(target, { ...init, headers });
}

/**
 * MKCOL each missing segment. Service workers cannot parse PROPFIND XML, so
 * conflicts and "already exists" responses are all treated as success.
 */
async function davMkdir(config: DavConfig, folder: string): Promise<void> {
  const relative = String(folder || "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!relative) return;
  const normalized = normalizeFolder(relative);
  let current = "";
  for (const part of normalized.split("/").filter(Boolean)) {
    current += `/${part}`;
    const response = await dav(config, current.replace(/^\//, ""), {
      method: "MKCOL",
    });
    if ([200, 201, 204, 207, 405, 409].includes(response.status)) continue;
    throw Error(`WebDAV MKCOL failed: HTTP ${response.status}`);
  }
}

async function davReadText(
  config: DavConfig,
  relative: string,
): Promise<string | null> {
  const response = await dav(config, relative, { method: "GET" });
  if (response.status === 404) return null;
  if (!response.ok)
    throw Error(`读取 WebDAV 文件失败：${relative} HTTP ${response.status}`);
  return response.text();
}

async function davWriteText(
  config: DavConfig,
  relative: string,
  text: string,
  contentType = "application/json",
): Promise<void> {
  const segments = String(relative).split("/");
  // dav() already prefixes the configured folder, so only the relative
  // directory of the target file is created here.
  if (segments.length > 1)
    await davMkdir(config, segments.slice(0, -1).join("/"));
  const response = await dav(config, relative, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: text,
  });
  if (!response.ok)
    throw Error(`写入 WebDAV 失败：${relative} HTTP ${response.status}`);
}

export async function webdavTest(): Promise<{ ok: true; detail?: string }> {
  const config = await webdavConfig();
  if (!config.url) throw Error("尚未配置 WebDAV 地址");
  const response = await dav(config, MANIFEST_FILE, { method: "GET" });
  if (![200, 204, 206, 404].includes(response.status))
    throw Error(`WebDAV 连接失败：HTTP ${response.status}`);
  return { ok: true };
}

const PROTOCOL_FILES = [
  MANIFEST_FILE,
  META_FILE,
  ...SYNC_MODULE_IDS.map((moduleId) => MODULE_FILES[moduleId]),
];

export function createWebdavFileStore(): FileStore {
  let cached: DavConfig | null = null;
  const config = async (): Promise<DavConfig> => {
    if (!cached) cached = await webdavConfig();
    if (!cached.url) throw Error("尚未配置 WebDAV 地址");
    return cached;
  };

  const readIndex = async (cfg: DavConfig): Promise<DavIndex> => {
    const text = await davReadText(cfg, HISTORY_INDEX_FILE);
    if (!text) return { schemaVersion: WEBDAV_HISTORY_INDEX_SCHEMA, entries: [] };
    try {
      const parsed = JSON.parse(text) as DavIndex;
      return {
        schemaVersion: WEBDAV_HISTORY_INDEX_SCHEMA,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } catch {
      return { schemaVersion: WEBDAV_HISTORY_INDEX_SCHEMA, entries: [] };
    }
  };

  return {
    id: "webdav",
    async read(names: string[]): Promise<FileStoreReadResult> {
      const cfg = await config();
      const wanted = [...new Set(names)];
      const files: Record<string, string | null> = {};
      await Promise.all(
        wanted.map(async (name) => {
          files[name] = await davReadText(cfg, name);
        }),
      );
      return { files, raw: { url: cfg.url } };
    },
    async write(entries) {
      const cfg = await config();
      for (const [name, text] of Object.entries(entries))
        await davWriteText(cfg, name, text);
    },
    async remove(names) {
      const cfg = await config();
      for (const name of names) {
        const response = await dav(cfg, name, { method: "DELETE" });
        if (!response.ok && response.status !== 404)
          throw Error(`删除 WebDAV 文件失败：${name} HTTP ${response.status}`);
      }
    },
    async list() {
      const cfg = await config();
      const present: string[] = [];
      for (const name of [...PROTOCOL_FILES, LEGACY_MONOLITHIC_FILE, LEGACY_ALT_FILE]) {
        const response = await dav(cfg, name, { method: "HEAD" });
        if (response.ok) present.push(name);
      }
      return present;
    },
    history: {
      async archive(label, entries, meta) {
        const cfg = await config();
        for (const entry of entries)
          await davWriteText(cfg, `history/${label}/${entry.name}`, entry.text);
        const index = await readIndex(cfg);
        const files = entries.map((entry) => entry.name);
        let revision = Number(meta?.revision) || 0;
        if (!revision) {
          const metaText = entries.find((entry) => entry.name === META_FILE)?.text;
          if (metaText) {
            try {
              revision = Number((JSON.parse(metaText) as { revision?: number }).revision) || 0;
            } catch {
              revision = 0;
            }
          }
        }
        index.entries = [
          ...(index.entries || []).filter((entry) => entry.id !== label),
          {
            id: label,
            createdAt: new Date().toISOString(),
            layout: "modular",
            revision,
            files,
            modules: (meta?.modules || []).map((moduleId) => String(moduleId)),
          },
        ].slice(-WEBDAV_HISTORY_LIMIT);
        index.schemaVersion = WEBDAV_HISTORY_INDEX_SCHEMA;
        await davWriteText(
          cfg,
          HISTORY_INDEX_FILE,
          JSON.stringify(index, null, 2),
        );
      },
      async list(): Promise<HistoryEntry[]> {
        const cfg = await config();
        const index = await readIndex(cfg);
        return (index.entries || [])
          .slice()
          .reverse()
          .map((entry, position) => ({
            id: entry.id,
            createdAt: entry.createdAt,
            current: position === 0,
            layout: entry.layout === "modular" ? "modular" : "legacy",
            revision: Number(entry.revision) || 0,
            modules: (entry.modules || []).filter((moduleId) =>
              SYNC_MODULE_IDS.includes(moduleId as SyncModuleId),
            ) as SyncModuleId[],
          }));
      },
      async read(entryId) {
        const cfg = await config();
        const index = await readIndex(cfg);
        const entry = (index.entries || []).find((item) => item.id === entryId);
        const layout = entry?.layout === "modular" ? "modular" : "legacy";
        if (layout === "legacy") {
          // Pre-modular archives stored one combined document per entry.
          const text = await davReadText(
            cfg,
            `history/${encodeURIComponent(entryId)}.json`,
          );
          if (text === null)
            throw Error(`读取 WebDAV 历史版本失败：${entryId}`);
          return { [LEGACY_MONOLITHIC_FILE]: text };
        }
        const files: Record<string, string | null> = {};
        await Promise.all(
          PROTOCOL_FILES.map(async (name) => {
            files[name] = await davReadText(
              cfg,
              `history/${entryId}/${name}`,
            );
          }),
        );
        if (PROTOCOL_FILES.every((name) => files[name] === null))
          throw Error(`读取 WebDAV 历史版本失败：${entryId}`);
        return files;
      },
    },
  };
}
