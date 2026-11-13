import { CloudNotFound, encode64, type CloudPort, isObject } from "./full-backup.js";

export interface CloudDependencies { settings(): Promise<Record<string, unknown>>; token(): Promise<string>; fetch: typeof fetch }
const key = (name: string) => 'extensionBackup' + name;
function relative(path: string): string[] {
  const parts = path.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[\\%?#\x00-\x1f]/.test(p))) throw Error("Unsafe backup path");
  return parts;
}
export async function createBackupCloud(deps: CloudDependencies): Promise<CloudPort> {
  const s = await deps.settings(); const value = (name: string) => String(s[key(name)] ?? '').trim();
  const backend = value('Backend');
  const config = [backend, value('GithubRepo'), value('GithubBranch'), value('GithubFolder'), value('WebdavUrl'), value('WebdavFolder'), value('GdriveFolder')];
  // No credentials are persisted in transfer checkpoints.
  const destination = JSON.stringify(config);
  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    let response: Response | undefined;
    for (let i = 0; i < 3; i++) {
      try { response = await deps.fetch(url, { ...init, signal: AbortSignal.timeout(25_000) }); }
      catch (e) { if (i === 2 || init.method === 'POST') throw e; continue; }
      if (init.method === 'POST') break;
      if (![429, 500, 502, 503, 504].includes(response.status) || i === 2) break;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** i));
    }
    if (!response) throw Error("Cloud request failed");
    if (response.status === 404) throw new CloudNotFound("Backup object was not found");
    if (!response.ok && response.status !== 207 && !(init.method === 'MKCOL' && response.status === 405)) throw Error('Backup cloud HTTP ' + response.status);
    return response;
  };
  const bytes = async (response: Response): Promise<Uint8Array> => {
    const maximum = 4 * 1024 * 1024;
    if (Number(response.headers.get('content-length')) > maximum) throw Error("Cloud object exceeds chunk limit");
    if (!response.body) throw Error("Missing cloud response body");
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > maximum) throw Error("Cloud object exceeds chunk limit"); parts.push(part.value); } }
    finally { await reader.cancel(); }
    const out = new Uint8Array(length); let offset = 0; for (const part of parts) { out.set(part, offset); offset += part.length; } return out;
  };
  const json = async (response: Response): Promise<unknown> => JSON.parse(new TextDecoder().decode(await bytes(response))) as unknown;
  const encoded = (path: string) => relative(path).map(encodeURIComponent).join('/');
  if (backend === 'github') {
    const repo = value('GithubRepo').replace(/^https?:\/\/github.com\//, '').replace(/\.git$/, '');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !value('GithubToken')) throw Error("Save a private backup repository and token first");
    const root = 'https://api.github.com/repos/' + repo;
    const headers = { Authorization: 'Bearer ' + value('GithubToken'), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const info = await json(await request(root, { headers }));
    if (!isObject(info) || info.private !== true) throw Error("Extension data requires a private GitHub repository");
    const folder = value('GithubFolder').replace(/^\/+|\/+$/g, '');
    const url = (p: string) => root + '/contents/' + encoded((folder ? folder + '/' : '') + p);
    const branch = value('GithubBranch'); const query = branch ? '?ref=' + encodeURIComponent(branch) : '';
    return { destination,
      async get(p) { return bytes(await request(url(p) + query, { headers: { ...headers, Accept: 'application/vnd.github.raw+json' } })); },
      async put(p, data) {
        let old: unknown = null;
        try { old = await json(await request(url(p) + query, { headers })); } catch (e) { if (!(e instanceof CloudNotFound)) throw e; }
        const body: Record<string, unknown> = { message: 'Store extension backup snapshot', content: encode64(data) };
        if (isObject(old) && typeof old.sha === 'string') body.sha = old.sha;
        if (branch) body.branch = branch;
        await request(url(p), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      },
      async list(prefix) {
        try {
          const list = await json(await request(url(prefix) + query, { headers }));
          if (!Array.isArray(list)) throw Error("Invalid GitHub backup listing");
          if (list.length >= 1000) throw Error("GitHub directory limit reached; choose another backup folder");
          return list.filter((v: unknown) => isObject(v) && v.type === 'dir' && typeof v.name === 'string').map(v => String(v.name));
        } catch (e) { if (e instanceof CloudNotFound) return []; throw e; }
      }
    };
  }
  if (backend === 'webdav') {
    const raw = value('WebdavUrl'); const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || /[\\%]/.test(raw) || /(?:^|\/)\.\.?($|\/)/.test(raw)) throw Error("Unsafe WebDAV URL");
    const folder = value('WebdavFolder').replace(/^\/+|\/+$/g, '');
    if (folder) relative(folder);
    const root = raw.replace(/\/+$/, '') + (folder ? '/' + encoded(folder) : '');
    const auth = encode64(new TextEncoder().encode(value('WebdavUsername') + ':' + value('WebdavPassword')));
    const headers = { Authorization: 'Basic ' + auth };
    const mkdir = async (p: string) => {
      const parts = [...(folder ? relative(folder) : []), ...relative(p)]; parts.pop();
      let current = raw.replace(/\/+$/, '');
      for (const part of parts) { current += '/' + encodeURIComponent(part); await request(current, { method: 'MKCOL', headers }); }
    };
    return { destination,
      async get(p) { return bytes(await request(root + '/' + encoded(p), { headers })); },
      async put(p, data) { await mkdir(p); await request(root + '/' + encoded(p), { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: data as Uint8Array<ArrayBuffer> }); },
      async list(prefix) {
        try {
          const response = await request(root + '/' + encoded(prefix) + '/', { method: 'PROPFIND', headers: { ...headers, Depth: '1', 'Content-Type': 'application/xml' }, body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>' });
          const xml = new TextDecoder().decode(await bytes(response)); const out: string[] = [];
          for (const match of xml.matchAll(/<(?:\w+:)?href\b[^>]*>([^<]+)<\/(?:\w+:)?href>/g)) {
            const href = match[1]; if (!href) continue;
            const name = decodeURIComponent(href.replace(/\/$/, '').split('/').pop() ?? ''); if (name && name !== prefix.split('/').pop()) out.push(name);
          }
          return [...new Set(out)];
        } catch (e) { if (e instanceof CloudNotFound) return []; throw e; }
      }
    };
  }
  if (backend === 'gdrive') {
    const api = 'https://www.googleapis.com/drive/v3/files'; const cache = new Map<string, string>();
    const headers = async () => ({ Authorization: 'Bearer ' + await deps.token() });
    const query = async (q: string): Promise<Record<string, unknown>[]> => {
      const all: Record<string, unknown>[] = []; let page = '';
      do {
        const v = await json(await request(api + '?q=' + encodeURIComponent(q) + '&fields=nextPageToken,files(id,name,mimeType)&pageSize=1000' + (page ? '&pageToken=' + encodeURIComponent(page) : ''), { headers: await headers() }));
        if (!isObject(v) || !Array.isArray(v.files) || !v.files.every(isObject)) throw Error("Invalid Drive listing");
        all.push(...v.files); if (all.length > 10000) throw Error("Drive listing exceeds limit"); page = typeof v.nextPageToken === 'string' ? v.nextPageToken : '';
      } while (page);
      return all;
    };
    const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const find = async (parent: string, name: string) => {
      const all = await query("'" + escape(parent) + "' in parents and trashed=false and name='" + escape(name) + "'");
      if (all.length > 1) throw Error("Ambiguous Drive backup path"); return all[0];
    };
    const pathId = async (path: string, create: boolean): Promise<string> => {
      let parent = 'root'; const folders = ['Chromium Cloud Sync Packages', ...(value('GdriveFolder') ? relative(value('GdriveFolder').replace(/^\/+|\/+$/g, '')) : []), ...relative(path)]; let prefix = '';
      for (const name of folders) {
        prefix += '/' + name;
        const cached = cache.get(prefix); if (cached) { parent = cached; continue; }
        let item = await find(parent, name);
        if (!item && create) {
          const result = await json(await request(api + '?fields=id,name,mimeType', { method: 'POST', headers: { ...await headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: [parent], mimeType: 'application/vnd.google-apps.folder' }) }));
          if (!isObject(result)) throw Error("Invalid Drive folder"); item = result;
        }
        if (!item) throw new CloudNotFound("Drive backup folder not found");
        if (typeof item.id !== 'string' || item.mimeType !== 'application/vnd.google-apps.folder') throw Error("Drive folder name collision");
        parent = item.id; cache.set(prefix, parent);
      }
      return parent;
    };
    const file = async (p: string, create: boolean) => { const parts = relative(p); const name = parts.pop(); if (!name) throw Error("Missing file name"); const parent = await pathId(parts.join('/'), create); return { parent, name, old: await find(parent, name) }; };
    return { destination,
      async get(p) { const { old } = await file(p, false); if (!old || typeof old.id !== 'string') throw new CloudNotFound("Drive object not found"); return bytes(await request(api + '/' + encodeURIComponent(old.id) + '?alt=media', { headers: await headers() })); },
      async put(p, data) {
        const { parent, name, old } = await file(p, true);
        if (old && typeof old.id === 'string') { await request('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(old.id) + '?uploadType=media', { method: 'PATCH', headers: await headers(), body: data as Uint8Array<ArrayBuffer> }); return; }
        const boundary = 'ccsync-' + crypto.randomUUID();
        const body = new Blob(['--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify({ name, parents: [parent] }) + '\r\n--' + boundary + '\r\nContent-Type: application/octet-stream\r\n\r\n', data as Uint8Array<ArrayBuffer>, '\r\n--' + boundary + '--']);
        await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { ...await headers(), 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
      },
      async list(prefix) { try { const parent = await pathId(prefix, false); return (await query("'" + parent + "' in parents and trashed=false")).filter(v => typeof v.name === 'string' && v.mimeType === 'application/vnd.google-apps.folder').map(v => String(v.name)); } catch (e) { if (e instanceof CloudNotFound) return []; throw e; } }
    };
  }
  throw Error("Save and enable a backup storage backend first");
}
