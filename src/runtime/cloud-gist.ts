import type { CloudState } from "./types.js";
import {
  LEGACY_MONOLITHIC_FILE,
  MANIFEST_FILE,
  META_FILE,
  MODULE_FILES,
  SYNC_MODULE_IDS,
} from "./sync-modules.js";
import {
  decryptJson,
  importAesKey,
  base64ToBytes,
  unwrapMasterWithSecret,
} from "./legacy-crypto.js";
import { readLocal } from "./storage.js";
import { LEGACY_ALT_FILE } from "./cloud-files.js";
import type {
  FileStore,
  FileStoreReadResult,
  HistoryEntry,
} from "./cloud-files.js";

/**
 * GitHub Gist transport.
 *
 * The Gist is the object store; the modular synchronization protocol lives in
 * `cloud-files.ts`. GitHub versions every file natively, so this provider needs
 * no application-managed history archive.
 */

export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_RETRIES = 2;
export const LEGACY_ENCRYPTED_FILE = "current.enc.json";
export const GIST_DESCRIPTION = "Chromium Cloud Sync | private sync state";
export const GIST_HISTORY_LIMIT = 30;

export interface GithubApiError extends Error {
  code?: string;
  status?: number;
  githubMessage?: string;
  documentationUrl?: string;
  errors?: unknown[];
  detail?: string;
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

export async function githubRequest(
  path: string,
  options: RequestInit & { headers?: Record<string, string> } = {},
  tokenOverride = "",
): Promise<{ data: never; headers: Headers; status?: number }> {
  const token =
    (tokenOverride || (await resolveToken())).trim();
  if (!token) throw Error("未配置 GitHub Token");
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= GITHUB_API_RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${GITHUB_API}${path}`, {
        ...options,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...((options.headers as Record<string, string>) || {}),
        },
      });
      const data = (await parseBody(response)) as Record<string, never> | null;
      if (response.status === 304)
        return { data: data as never, headers: response.headers, status: 304 };
      if (!response.ok) {
        const message =
          (data as { message?: string } | null)?.message ||
          `GitHub API HTTP ${response.status}`;
        const error: GithubApiError = new Error(message);
        error.code = "GITHUB_API_ERROR";
        error.status = response.status;
        error.githubMessage = message;
        error.documentationUrl =
          (data as { documentation_url?: string } | null)?.documentation_url ||
          "";
        const errors = (data as { errors?: unknown[] } | null)?.errors;
        error.errors = Array.isArray(errors) ? errors : [];
        if (response.status === 422 && error.errors.length)
          error.detail = (error.errors as Array<Record<string, unknown>>)
            .map((entry) =>
              [entry.resource, entry.field, entry.code, entry.message]
                .filter(Boolean)
                .join(": "),
            )
            .join("; ");
        throw error;
      }
      return { data: data as never, headers: response.headers };
    } catch (error) {
      lastError = error;
      const apiError = error as GithubApiError;
      const retryable =
        apiError?.code === "GITHUB_API_ERROR" &&
        [408, 429, 500, 502, 503, 504].includes(Number(apiError.status));
      if (!retryable || attempt === GITHUB_API_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError || Error("GitHub request failed");
}

let tokenResolver: (() => Promise<string>) | null = null;

/**
 * The Gist transport must not import the settings layer (that would create a
 * cycle with the background orchestrator), so the orchestrator registers the
 * token source once at startup.
 */
export function configureGithubTokenSource(
  resolver: () => Promise<string>,
): void {
  tokenResolver = resolver;
}

async function resolveToken(): Promise<string> {
  if (tokenResolver) return tokenResolver();
  const state = await readLocal(["githubToken"]);
  return String(state.githubToken || "");
}

export async function validateGithubToken(
  token = "",
): Promise<{
  login: string;
  name: string;
  avatarUrl: string;
  gistsAccessible: boolean;
}> {
  const value = (token || "").trim();
  if (!value) throw Error("GitHub Token is required");
  try {
    await githubRequest("/gists?per_page=1", {}, value);
  } catch (error) {
    const apiError = error as GithubApiError;
    const detail =
      apiError?.githubMessage || apiError?.message || String(error);
    throw Error(
      `GitHub Token validation failed${apiError?.status ? ` (HTTP ${apiError.status})` : ""}: ${detail}`,
    );
  }
  try {
    const result = await githubRequest("/user", {}, value);
    const user = result.data as unknown as {
      login?: string;
      name?: string;
      avatar_url?: string;
    };
    return {
      login: String(user?.login ?? ""),
      name: String(user?.name || user?.login || ""),
      avatarUrl: String(user?.avatar_url || ""),
      gistsAccessible: true,
    };
  } catch {
    return {
      login: "GitHub authenticated",
      name: "GitHub authenticated",
      avatarUrl: "",
      gistsAccessible: true,
    };
  }
}

export interface GistFile {
  filename?: string;
  content?: string | null;
  truncated?: boolean;
  raw_url?: string;
  size?: number;
}

export interface RawGist {
  id?: string;
  files?: Record<string, GistFile | null>;
  updated_at?: string;
  history?: GistCommit[];
}

export interface GistCommit {
  version?: string;
  committed_at?: string;
  user?: { login?: string } | null;
  change_status?: unknown;
}

/**
 * Materialize a Gist file map.
 *
 * GitHub truncates inline `content` for large files and only exposes the bytes
 * through `raw_url`. Splitting the payload into module files makes truncation
 * unlikely, but the transport still resolves it so a large `tabs.json` can never
 * be read back as a partial document.
 */
async function materializeFiles(
  files: Record<string, GistFile | null> | undefined,
  wanted: string[],
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  await Promise.all(
    wanted.map(async (name) => {
      const entry = files?.[name];
      if (!entry) {
        out[name] = null;
        return;
      }
      if (entry.truncated && entry.raw_url) {
        try {
          const response = await fetch(entry.raw_url);
          out[name] = response.ok ? await response.text() : null;
          return;
        } catch {
          out[name] = null;
          return;
        }
      }
      out[name] = typeof entry.content === "string" ? entry.content : null;
    }),
  );
  return out;
}

export async function readGistRaw(
  gistId: string,
  token = "",
): Promise<{ gist: RawGist; files: Record<string, GistFile | null>; etag: string; updatedAt: string }> {
  const result = await githubRequest(
    `/gists/${encodeURIComponent(gistId)}`,
    {},
    token,
  );
  const gist = (result.data as unknown as RawGist) || {};
  return {
    gist,
    files: gist.files || {},
    etag: result.headers.get("ETag") || "",
    updatedAt: gist.updated_at || "",
  };
}

async function legacyLocalMasterKey(): Promise<CryptoKey | null> {
  const state = await readLocal(["masterEnvelope"]);
  if (!state.masterEnvelope) return null;
  try {
    const seedState = await readLocal(["localKeySeed", "deviceSeed"]);
    const seed = String(seedState.localKeySeed || seedState.deviceSeed || "");
    if (!seed) return null;
    const encoder = new TextEncoder();
    const base = await crypto.subtle.importKey(
      "raw",
      encoder.encode(seed),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const salt = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode("chromium-cloud-sync-local-key-v1"),
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new Uint8Array(salt),
        iterations: 120000,
        hash: "SHA-256",
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const envelope = JSON.parse(String(state.masterEnvelope)) as {
      iv: string;
      ciphertext: string;
    };
    const raw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(envelope.iv), tagLength: 128 },
      key,
      base64ToBytes(envelope.ciphertext),
    );
    return importAesKey(new Uint8Array(raw), true);
  } catch {
    return null;
  }
}

/** Decrypt a legacy `current.enc.json` payload from v1.5.x installations. */
export async function decryptLegacyGistState(
  ciphertext: string,
  manifest: unknown,
): Promise<string> {
  const local = await legacyLocalMasterKey();
  if (local) {
    try {
      return JSON.stringify(await decryptJson(ciphertext, local));
    } catch {
      /* fall through to the convenience wrapper path */
    }
  }
  const state = await readLocal(["githubToken"]);
  const wrappers =
    ((manifest as { crypto?: { wrappers?: unknown[] } } | null)?.crypto
      ?.wrappers as Array<Record<string, unknown>> | undefined) || [];
  for (const wrapper of wrappers) {
    if (
      wrapper.status === "revoked" ||
      wrapper.type !== "convenience" ||
      !state.githubToken
    )
      continue;
    try {
      const key = await unwrapMasterWithSecret(
        String(state.githubToken),
        wrapper,
        "convenience",
      );
      return JSON.stringify(await decryptJson(ciphertext, key));
    } catch {
      /* try the next wrapper */
    }
  }
  throw Error(
    "此 Gist 使用旧版加密格式。请先使用 v1.5.x 版本打开并成功同步一次，再升级到当前版本。",
  );
}

export function gistContainsSyncData(
  files: Record<string, GistFile | null> | undefined,
): boolean {
  if (!files) return false;
  return [
    MANIFEST_FILE,
    META_FILE,
    LEGACY_MONOLITHIC_FILE,
    LEGACY_ENCRYPTED_FILE,
    LEGACY_ALT_FILE,
    ...SYNC_MODULE_IDS.map((moduleId) => MODULE_FILES[moduleId]),
  ].some((name) => Object.prototype.hasOwnProperty.call(files, name));
}

export interface GistFileStore extends FileStore {
  readonly gistId: string;
}

export function createGistFileStore(gistId: string): GistFileStore {
  const id = String(gistId || "");

  const read = async (names: string[]): Promise<FileStoreReadResult> => {
    if (!id) throw Error("尚未绑定 GitHub Gist");
    const wanted = [...new Set([...names, LEGACY_ENCRYPTED_FILE])];
    const raw = await readGistRaw(id);
    const files = await materializeFiles(raw.files, wanted);

    let legacyEncrypted = false;
    const encrypted = files[LEGACY_ENCRYPTED_FILE];
    if (!files[LEGACY_MONOLITHIC_FILE] && typeof encrypted === "string") {
      let manifest: unknown = null;
      const manifestText = files[MANIFEST_FILE];
      if (typeof manifestText === "string" && manifestText.trim()) {
        try {
          manifest = JSON.parse(manifestText);
        } catch {
          throw Error("Gist manifest.json 无法解析");
        }
      }
      files[LEGACY_MONOLITHIC_FILE] = await decryptLegacyGistState(
        encrypted,
        manifest,
      );
      legacyEncrypted = true;
    }

    const requested: Record<string, string | null> = {};
    for (const name of names) requested[name] = files[name] ?? null;

    return {
      files: requested,
      etag: raw.etag,
      updatedAt: raw.updatedAt,
      raw: { gist: raw.gist, legacyEncrypted, etag: raw.etag },
    };
  };

  const patch = async (
    fileEntries: Record<string, { content: string } | null>,
  ): Promise<void> => {
    if (!id) throw Error("尚未绑定 GitHub Gist");
    await githubRequest(`/gists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ description: GIST_DESCRIPTION, files: fileEntries }),
    });
  };

  return {
    id: "gist",
    gistId: id,
    read,
    async write(entries) {
      const payload: Record<string, { content: string }> = {};
      for (const [name, text] of Object.entries(entries)) payload[name] = { content: text };
      await patch(payload);
    },
    async remove(names) {
      if (!names.length) return;
      const payload: Record<string, null> = {};
      for (const name of names) payload[name] = null;
      await patch(payload);
    },
    async list() {
      const raw = await readGistRaw(id);
      return Object.keys(raw.files || {});
    },
    history: {
      // GitHub versions every Gist file natively; no app-managed archive.
      async archive() {
        return;
      },
      async list(): Promise<HistoryEntry[]> {
        if (!id) return [];
        const raw = await readGistRaw(id);
        const currentVersion = raw.gist.history?.[0]?.version || "";
        const result = await githubRequest(
          `/gists/${encodeURIComponent(id)}/commits?per_page=${GIST_HISTORY_LIMIT}`,
        );
        const commits = (result.data as unknown as GistCommit[]) || [];
        return commits.map((commit) => ({
          id: String(commit.version || ""),
          sha: String(commit.version || ""),
          createdAt: String(commit.committed_at || ""),
          user: String(commit.user?.login || ""),
          changes: commit.change_status || {},
          current: String(commit.version || "") === currentVersion,
          // A Gist commit can predate the modular migration, so the layout is
          // only known once the entry is read; it is resolved on demand.
          revision: 0,
        }));
      },
      async read(entryId) {
        if (!id) throw Error("尚未绑定 GitHub Gist");
        const result = await githubRequest(
          `/gists/${encodeURIComponent(id)}/${encodeURIComponent(entryId)}`,
        );
        const revision = (result.data as unknown as RawGist) || {};
        const names = [
          MANIFEST_FILE,
          META_FILE,
          ...SYNC_MODULE_IDS.map((moduleId) => MODULE_FILES[moduleId]),
          LEGACY_MONOLITHIC_FILE,
          LEGACY_ALT_FILE,
          LEGACY_ENCRYPTED_FILE,
        ];
        const files = await materializeFiles(revision.files, names);
        let legacyEncrypted = false;
        if (!files[LEGACY_MONOLITHIC_FILE] && files[LEGACY_ENCRYPTED_FILE]) {
          let manifest: unknown = null;
          const manifestText = files[MANIFEST_FILE];
          if (typeof manifestText === "string" && manifestText.trim()) {
            try {
              manifest = JSON.parse(manifestText);
            } catch {
              manifest = null;
            }
          }
          files[LEGACY_MONOLITHIC_FILE] = await decryptLegacyGistState(
            String(files[LEGACY_ENCRYPTED_FILE]),
            manifest,
          );
          legacyEncrypted = true;
        }
        return {
          ...files,
          __legacyEncrypted: legacyEncrypted ? "true" : null,
        } as Record<string, string | null>;
      },
    },
  };
}

export async function createSyncGist(
  files: Record<string, string>,
  token = "",
): Promise<{ id: string; headers: Headers }> {
  const payload: Record<string, { content: string }> = {};
  for (const [name, text] of Object.entries(files))
    payload[name] = { content: text };
  const result = await githubRequest(
    "/gists",
    {
      method: "POST",
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: payload,
      }),
    },
    token,
  );
  const gist = (result.data as unknown as RawGist) || {};
  return { id: String(gist.id || ""), headers: result.headers };
}

export function isLegacyGistHistoryFile(name: string): boolean {
  return (
    /^history\//.test(name) ||
    /^ccsync-history-/.test(name) ||
    /^history-/.test(name)
  );
}

export function legacyGistHistoryDeletes(
  existingFiles: string[] = [],
): string[] {
  return [...new Set((existingFiles || []).filter(isLegacyGistHistoryFile))];
}

export type { CloudState };
