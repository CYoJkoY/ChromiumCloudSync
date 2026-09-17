import { readLocal, writeLocal } from "./storage.js";

const CURRENT = "current.json";
const HISTORY_INDEX = "history/index.json";
const HISTORY_LIMIT = 30;

interface DavConfig {
  url: string;
  folder: string;
  user: string;
  pass: string;
}

async function cfg(): Promise<DavConfig> {
  const s = await readLocal([
    "webdavSyncUrl",
    "webdavSyncFolder",
    "webdavSyncUsername",
    "webdavSyncPassword",
  ]);
  return {
    url: String(s.webdavSyncUrl || "")
      .trim()
      .replace(/\/+$/, ""),
    folder: String(s.webdavSyncFolder || "").trim(),
    user: String(s.webdavSyncUsername || ""),
    pass: String(s.webdavSyncPassword || ""),
  };
}

const normFolder = (v: string): string => {
  let x = String(v || "")
    .trim()
    .replace(/\\/g, "/");
  if (!x) return "";
  if (!x.startsWith("/")) x = `/${x}`;
  return x.replace(/\/+/g, "/").replace(/\/$/, "");
};

async function ensureOrigin(url: string): Promise<void> {
  const origin = `${new URL(url).origin}/*`;
  if (!chrome.permissions?.request) return;
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  if (!(await chrome.permissions.request({ origins: [origin] })))
    throw Error("WebDAV 需要允许访问该服务器地址");
}

async function dav(
  c: DavConfig,
  rel: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!c.url) throw Error("尚未配置 WebDAV 地址");
  await ensureOrigin(c.url);
  const target = `${c.url}${normFolder(c.folder)}${String(rel).startsWith("/") ? rel : `/${rel}`}`;
  const headers: Record<string, string> = {
    ...((init.headers as Record<string, string>) || {}),
  };
  if (c.user || c.pass)
    headers.Authorization = `Basic ${btoa(unescape(encodeURIComponent(`${c.user}:${c.pass}`)))}`;
  return fetch(target, { ...init, headers });
}

export async function webdavTest(): Promise<{ ok: true }> {
  const c = await cfg();
  const r = await dav(c, `/${CURRENT}`, { method: "GET" });
  if (![200, 204, 206, 404].includes(r.status))
    throw Error(`WebDAV 连接失败：HTTP ${r.status}`);
  return { ok: true };
}

export async function webdavLoad(): Promise<unknown> {
  const c = await cfg();
  const r = await dav(c, `/${CURRENT}`, { method: "GET" });
  if (r.status === 404) throw Error("WebDAV 上还没有同步数据，请先创建");
  if (!r.ok) throw Error(`读取 WebDAV 同步数据失败：HTTP ${r.status}`);
  return JSON.parse(await r.text());
}

export async function webdavCreate(
  state: unknown,
): Promise<{ location: string }> {
  await webdavSave(state);
  return { location: `${(await cfg()).url}` };
}

/** 保存前把旧版本归档进 history/，并在 index.json 维护最近 30 条（service worker 没有 DOMParser，不能解析 PROPFIND XML） */
export async function webdavSave(
  state: unknown,
): Promise<{ revision: number }> {
  const c = await cfg();
  const previous = await dav(c, `/${CURRENT}`, { method: "GET" });
  if (previous.ok) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bytes = new Uint8Array(await previous.arrayBuffer());
    const put = await dav(c, `/history/${stamp}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: bytes,
    });
    if (put.ok) {
      let index: { entries: Array<{ id: string; createdAt: string }> } = {
        entries: [],
      };
      const idxRes = await dav(c, `/${HISTORY_INDEX}`, { method: "GET" });
      if (idxRes.ok) {
        try {
          index = JSON.parse(await idxRes.text());
        } catch {
          /* ignore */
        }
      }
      index.entries = [
        ...(index.entries || []),
        { id: stamp, createdAt: new Date().toISOString() },
      ].slice(-HISTORY_LIMIT);
      await dav(c, `/${HISTORY_INDEX}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(index),
      });
    }
  }
  const r = await dav(c, `/${CURRENT}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!r.ok) throw Error(`写入 WebDAV 失败：HTTP ${r.status}`);
  return { revision: Number((state as { revision?: number })?.revision || 0) };
}

export async function webdavRevisions(): Promise<
  Array<{ id: string; createdAt: string; current: boolean }>
> {
  const c = await cfg();
  const r = await dav(c, `/${HISTORY_INDEX}`, { method: "GET" });
  if (!r.ok) return [];
  const index = JSON.parse(await r.text()) as {
    entries?: Array<{ id: string; createdAt: string }>;
  };
  const entries = (index.entries || []).slice().reverse();
  return entries.map((entry, i) => ({
    id: entry.id,
    createdAt: entry.createdAt,
    current: i === 0,
  }));
}

export async function webdavLoadRevision(id: string): Promise<unknown> {
  const c = await cfg();
  const r = await dav(c, `/history/${encodeURIComponent(id)}.json`, {
    method: "GET",
  });
  if (!r.ok) throw Error(`读取 WebDAV 历史版本失败：HTTP ${r.status}`);
  return JSON.parse(await r.text());
}
