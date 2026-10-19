import { readLocal } from "./storage.js";
import {
  LEGACY_MONOLITHIC_FILE,
  MANIFEST_FILE,
  META_FILE,
  MODULE_FILES,
  SYNC_MODULE_IDS,
} from "./sync-modules.js";
import { LEGACY_ALT_FILE } from "./cloud-files.js";
import type { FileStore, FileStoreReadResult } from "./cloud-files.js";

/**
 * WebDAV transport.
 *
 * WebDAV is a plain file store, so the modular layout maps directly onto the
 * configured folder. WebDAV has no provider history that the extension needs
 * to mirror, so normal sync stores only the current modular files.
 */
interface DavConfig {
  url: string;
  folder: string;
  user: string;
  pass: string;
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

function safeDavPathSegments(value: string): string[] {
  const path = String(value || "").trim().replace(/\\/g, "/");
  const segments = path.split("/").filter(Boolean);
  if (
    segments.some(
      (segment) =>
        segment === "." || segment === ".." || /[%?#]/.test(segment),
    )
  )
    throw Error(
      "WebDAV 路径不得包含 .、.. 路径段或 URL 特殊字符（%、?、#）",
    );
  return segments;
}

export function normalizeWebdavFolder(value: string): string {
  const segments = safeDavPathSegments(value);
  return segments.length ? `/${segments.join("/")}` : "";
}

const normalizeFolder = normalizeWebdavFolder;

export function webdavBound(config?: DavConfig | null): boolean {
  return !!config?.url;
}

export function normalizeWebdavBaseUrl(value: string): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i);
  if (!match || raw.includes("\\"))
    throw Error(
      "WebDAV 地址必须是有效的绝对 HTTP(S) URL，不能包含账号密码、查询或片段、反斜杠或歧义路径编码",
    );

  const authority = match[2] || "";
  const rawPath = match[3] || "";
  if (
    authority.includes("@") ||
    authority.includes("%") ||
    rawPath.split("/").some((segment) => segment === "." || segment === "..") ||
    /%(?:2e|2f|5c|25|3f|23)/i.test(rawPath)
  )
    throw Error(
      "WebDAV 地址不能包含内嵌凭据、. / .. 路径段或编码后的路径分隔符和 URL 分隔符",
    );

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw Error("WebDAV 地址不是有效的绝对 HTTP(S) URL");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin === "null" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw Error(
      "WebDAV 地址必须是有效的 HTTP(S) URL，账号密码应填写在独立的 WebDAV 凭据字段中",
    );

  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

async function ensureOrigin(url: string): Promise<string> {
  const baseUrl = normalizeWebdavBaseUrl(url);
  const origin = `${new URL(baseUrl).origin}/*`;
  if (chrome.permissions?.request) {
    if (!(await chrome.permissions.contains({ origins: [origin] }))) {
      if (!(await chrome.permissions.request({ origins: [origin] })))
        throw Error("WebDAV 需要允许访问该服务器地址");
    }
  }
  return baseUrl;
}

async function dav(
  config: DavConfig,
  relative: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!config.url) throw Error("尚未配置 WebDAV 地址");
  const folder = normalizeFolder(config.folder);
  const clean = safeDavPathSegments(relative).join("/");
  const baseUrl = await ensureOrigin(config.url);
  const target = `${baseUrl}${folder}${clean ? `/${clean}` : ""}`;
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
  const parts = safeDavPathSegments(folder);
  if (!parts.length) return;
  let current = "";
  for (const part of parts) {
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

  };
}
