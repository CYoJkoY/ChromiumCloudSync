import { readLocal, writeLocal, removeLocal } from "./storage.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive.file"; // 最小权限：只能访问本应用创建的文件
const FILE_NAME = "chromium-cloud-sync-state.json";

const te = new TextEncoder();
async function sha256B64Url(input: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", te.encode(input)),
  );
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function randomString(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** OAuth：用户在设置页填自己的 Client ID（推荐 Desktop app 类型，Secret 可留空） */
export async function connectGoogleDrive(
  clientId: string,
  clientSecret = "",
): Promise<{ email: string }> {
  const id = String(clientId || "").trim();
  if (!id) throw Error("请先填写 Google OAuth Client ID");
  const redirect = chrome.identity.getRedirectURL(); // https://<ext-id>.chromiumapp.org/
  const verifier = randomString(64);
  const challenge = await sha256B64Url(verifier);
  const url =
    `${AUTH_URL}?client_id=${encodeURIComponent(id)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}&response_type=code` +
    `&scope=${encodeURIComponent(SCOPE)}&access_type=offline&prompt=consent` +
    `&code_challenge=${challenge}&code_challenge_method=S256`;
  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url,
    interactive: true,
  });
  if (!responseUrl) throw Error("Google 授权已取消");
  const parsed = new URL(responseUrl);
  const code = parsed.searchParams.get("code");
  if (!code)
    throw Error(
      `Google 授权失败：${parsed.searchParams.get("error") || "no code"}`,
    );
  const body = new URLSearchParams({
    code,
    client_id: id,
    redirect_uri: redirect,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      `Google token exchange failed: ${data?.error_description || data?.error || r.status}`,
    );
  await writeLocal({
    gdriveTokens: {
      clientId: id,
      clientSecret,
      refresh_token: data.refresh_token || "",
      access_token: data.access_token,
      expiry: Date.now() + Number(data.expires_in || 3600) * 1000,
    },
  });
  return { email: "" };
}

export async function disconnectGoogleDrive(): Promise<void> {
  await removeLocal(["gdriveTokens", "gdriveFileId"]);
}

async function accessToken(): Promise<string> {
  const s = await readLocal(["gdriveTokens"]);
  const t = s.gdriveTokens as
    | {
        access_token?: string;
        refresh_token?: string;
        expiry?: number;
        clientId?: string;
        clientSecret?: string;
      }
    | undefined;
  if (!t?.refresh_token) throw Error("尚未连接 Google Drive");
  if (t.access_token && t.expiry && Date.now() < t.expiry - 60_000)
    return t.access_token;
  const body = new URLSearchParams({
    client_id: t.clientId || "",
    refresh_token: t.refresh_token,
    grant_type: "refresh_token",
  });
  if (t.clientSecret) body.set("client_secret", t.clientSecret);
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await r.json();
  if (!r.ok) throw Error("Google Drive 授权已失效，请重新连接");
  await writeLocal({
    gdriveTokens: {
      ...t,
      access_token: data.access_token,
      expiry: Date.now() + Number(data.expires_in || 3600) * 1000,
    },
  });
  return data.access_token;
}

async function drive(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<Response> {
  const t = token ?? (await accessToken());
  return fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${t}`, ...(init.headers || {}) },
  });
}

export async function gdriveTest(): Promise<{ ok: true; detail?: string }> {
  const token = await accessToken();
  const r = await drive("/files?pageSize=1&fields=files(id)", {}, token);
  if (!r.ok) throw Error(`Google Drive 连接失败：HTTP ${r.status}`);
  return { ok: true };
}

async function findFileId(token: string): Promise<string | null> {
  const s = await readLocal(["gdriveFileId"]);
  if (s.gdriveFileId) return String(s.gdriveFileId);
  const q = `name='${FILE_NAME}' and 'root' in parents and trashed=false`;
  const r = await drive(
    `/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive&pageSize=1`,
    {},
    token,
  );
  const data = await r.json();
  const id = data?.files?.[0]?.id || null;
  if (id) await writeLocal({ gdriveFileId: id });
  return id;
}

export async function gdriveLoad(): Promise<unknown> {
  const token = await accessToken();
  const id = await findFileId(token);
  if (!id) throw Error("Google Drive 中还没有同步文件，请先创建");
  const r = await drive(`/files/${id}?alt=media`, {}, token);
  if (!r.ok) throw Error(`读取 Google Drive 同步文件失败：HTTP ${r.status}`);
  return JSON.parse(await r.text());
}

export async function gdriveCreate(
  state: unknown,
): Promise<{ location: string }> {
  const token = await accessToken();
  const meta = { name: FILE_NAME, mimeType: "application/json" };
  const boundary = "ccsync-boundary";
  const body = te.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(state)}\r\n--${boundary}--`,
  );
  const r = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const data = await r.json();
  if (!r.ok)
    throw Error(
      `创建 Google Drive 同步文件失败：${data?.error?.message || r.status}`,
    );
  await writeLocal({ gdriveFileId: data.id });
  return { location: data.id };
}

export async function gdriveSave(
  state: unknown,
): Promise<{ revision: number }> {
  const token = await accessToken();
  const id = await findFileId(token);
  if (!id) {
    await gdriveCreate(state);
    return {
      revision: Number((state as { revision?: number })?.revision || 0),
    };
  }
  const r = await fetch(
    `${UPLOAD_API}/files/${id}?uploadType=media&fields=id`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    },
  );
  if (!r.ok) throw Error(`写入 Google Drive 失败：HTTP ${r.status}`);
  return { revision: Number((state as { revision?: number })?.revision || 0) };
}

/** Drive 原生修订历史，替代 Gist commits */
export async function gdriveRevisions(): Promise<
  Array<{ id: string; createdAt: string; current: boolean }>
> {
  const token = await accessToken();
  const id = await findFileId(token);
  if (!id) return [];
  const r = await drive(
    `/files/${id}/revisions?pageSize=30&fields=revisions(id,modifiedTime)`,
    {},
    token,
  );
  const data = await r.json();
  const list = (data?.revisions || []) as Array<{
    id: string;
    modifiedTime: string;
  }>;
  return list.map((rev, index) => ({
    id: rev.id,
    createdAt: rev.modifiedTime,
    current: index === list.length - 1,
  }));
}

export async function gdriveLoadRevision(revisionId: string): Promise<unknown> {
  const token = await accessToken();
  const id = await findFileId(token);
  if (!id) throw Error("Google Drive 中还没有同步文件");
  const r = await drive(
    `/files/${id}/revisions/${encodeURIComponent(revisionId)}?alt=media`,
    {},
    token,
  );
  if (!r.ok) throw Error(`读取历史修订失败：HTTP ${r.status}`);
  return JSON.parse(await r.text());
}
