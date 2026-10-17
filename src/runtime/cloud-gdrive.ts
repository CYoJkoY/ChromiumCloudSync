import { readLocal, writeLocal, removeLocal } from "./storage.js";
import { detectBrowserCapabilities } from "./browser-capabilities.js";
import {
  HISTORY_INDEX_FILE,
  LEGACY_MONOLITHIC_FILE,
  MANIFEST_FILE,
  META_FILE,
  MODULE_FILES,
  SYNC_MODULE_IDS,
} from "./sync-modules.js";
import type {
  FileStore,
  FileStoreReadResult,
  HistoryEntry,
} from "./cloud-files.js";
import type { SyncModuleId } from "./sync-modules.js";

/**
 * Google Drive transport.
 *
 * Drive has no folder-less file namespace this extension can rely on, so the
 * modular layout lives inside an application-managed folder created with the
 * `drive.file` scope:
 *
 * ```text
 * Chromium Cloud Sync/
 *   manifest.json  meta.json  extensions.json  bookmarks.json  tabs.json
 *   history/
 *     index.json
 *     <label>--manifest.json  <label>--meta.json  <label>--extensions.json …
 * ```
 *
 * The pre-modular single-file payload (`chromium-cloud-sync-state.json`) is
 * detected, migrated, and preserved as a read-only archive.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
export const GDRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GDRIVE_APP_FOLDER = "Chromium Cloud Sync";
export const GDRIVE_HISTORY_FOLDER = "history";
export const GDRIVE_INDEX_FILE = "index.json";
const LEGACY_STATE_FILE = "chromium-cloud-sync-state.json";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const JSON_MIME = "application/json";
export const GDRIVE_HISTORY_LIMIT = 30;

const LOCAL_KEYS = {
  auth: "gdriveAuth",
  tokens: "gdriveTokens",
  legacyFileId: "gdriveFileId",
  folderId: "gdriveFolderId",
  historyFolderId: "gdriveHistoryFolderId",
  fileIds: "gdriveFileIds",
};

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

function randomString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface GdriveTokens {
  /** Manual fallback only: the user-provided Web application OAuth client. */
  clientId?: string;
  clientSecret?: string;
  refresh_token?: string;
  access_token?: string;
  expiry?: number;
  /** Access token delivered directly by launchWebAuthFlow using the extension client. */
  authFlow?: "identity-web";
}

/**
 * How the Drive session was authorized.
 *
 * `identity` uses Chromium's cached getAuthToken flow. `identity-web` stores
 * the short-lived access token returned by launchWebAuthFlow with the extension
 * OAuth client. `manual` uses a user-owned Web application OAuth client.
 */
export type GdriveAuthMode = "identity" | "identity-web" | "manual";

export interface GdriveAuthState {
  mode: GdriveAuthMode;
  email: string;
  accountId: string;
  displayName: string;
  photoLink: string;
  scope: string;
  connectedAt: string;
}

interface IdentityApi {
  getAuthToken?(
    details: {
      interactive?: boolean;
      scopes?: string[];
      account?: { id: string };
    },
    callback?: (result: unknown, grantedScopes?: string[]) => void,
  ): unknown;
  removeCachedAuthToken?(details: { token: string }): Promise<void>;
  clearAllCachedAuthTokens?(): Promise<void>;
  getAccounts?(): Promise<Array<{ id: string; email: string }>>;
  launchWebAuthFlow?(details: {
    url: string;
    interactive: boolean;
  }): Promise<string | undefined>;
  getRedirectURL?(path?: string): string;
}

function identityApi(): IdentityApi {
  return (chrome.identity as unknown as IdentityApi) || {};
}

/** The single minimum Drive scope this extension needs: app-created files only. */
const IDENTITY_SCOPES = [GDRIVE_SCOPE];

/* --------------------------------------------------------------------------
 * Authentication
 * ------------------------------------------------------------------------ */

async function readAuthState(): Promise<GdriveAuthState | null> {
  const state = await readLocal([LOCAL_KEYS.auth]);
  const auth = state[LOCAL_KEYS.auth] as GdriveAuthState | undefined;
  if (!auth || typeof auth !== "object") return null;
  const mode: GdriveAuthMode =
    auth.mode === "manual"
      ? "manual"
      : auth.mode === "identity-web"
        ? "identity-web"
        : "identity";
  return {
    mode,
    email: String(auth.email || ""),
    accountId: String(auth.accountId || ""),
    displayName: String(auth.displayName || ""),
    photoLink: String(auth.photoLink || ""),
    scope: String(auth.scope || GDRIVE_SCOPE),
    connectedAt: String(auth.connectedAt || ""),
  };
}

async function writeAuthState(
  mode: GdriveAuthMode,
  account: DriveAccount,
): Promise<GdriveAuthState> {
  const auth: GdriveAuthState = {
    mode,
    email: account.email,
    accountId: account.accountId,
    displayName: account.displayName,
    photoLink: account.photoLink,
    scope: GDRIVE_SCOPE,
    connectedAt: new Date().toISOString(),
  };
  await writeLocal({ [LOCAL_KEYS.auth]: auth });
  return auth;
}

interface DriveAccount {
  email: string;
  accountId: string;
  displayName: string;
  photoLink: string;
}

const EMPTY_ACCOUNT: DriveAccount = {
  email: "",
  accountId: "",
  displayName: "",
  photoLink: "",
};

/** Return whether manifest.json declares a client ID for browser-managed OAuth. */
function hasConfiguredIdentityOAuthClient(): boolean {
  try {
    const manifest = chrome.runtime?.getManifest?.() as
      | { oauth2?: { client_id?: unknown } }
      | undefined;
    const clientId = manifest?.oauth2?.client_id;
    return typeof clientId === "string" && clientId.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Browser-managed OAuth needs both a manifest OAuth client and the relevant
 * Chromium Identity APIs; API presence alone does not guarantee registration.
 */
export function supportsBrowserManagedDriveAuth(): boolean {
  const capabilities = detectBrowserCapabilities();
  return (
    hasConfiguredIdentityOAuthClient() && capabilities.identityGetAuthToken
  );
}

/** Ask Chromium to mint (and cache) a Drive token for the signed-in account. */
const IDENTITY_TOKEN_TIMEOUT_MS = 20_000;

/** Normalize the different result shapes exposed by Chromium API versions. */
function extractIdentityToken(result: unknown): string {
  if (typeof result === "string") return result.trim();
  if (result && typeof result === "object" && "token" in result) {
    const token = (result as { token?: unknown }).token;
    return typeof token === "string" ? token.trim() : "";
  }
  return "";
}

/** Ask Chromium to mint a token, but never let a missing auth UI hang forever. */
async function identityToken(interactive: boolean): Promise<string> {
  const identity = identityApi();
  if (!identity.getAuthToken)
    throw driveAuthError(
      "当前浏览器不支持 identity.getAuthToken，请改用手动 OAuth 客户端配置",
    );

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = new Promise<unknown>((resolve, reject) => {
      const acceptResult = (result: unknown, grantedScopes?: string[]) => {
        resolve(
          typeof result === "string"
            ? { token: result, grantedScopes }
            : result,
        );
      };
      const callback = (result: unknown, grantedScopes?: string[]) => {
        const apiError = chrome.runtime?.lastError;
        if (apiError) {
          reject(new Error(apiError.message || "Google Identity API request failed"));
          return;
        }
        acceptResult(result, grantedScopes);
      };

      try {
        // Support callback-based extension bindings and Promise-only Chromium
        // wrappers with one API invocation. The Promise race settles once even
        // if a non-standard host exposes both completion styles.
        const returned = identity.getAuthToken!({
          interactive,
          scopes: IDENTITY_SCOPES,
        }, callback);
        if (
          returned &&
          typeof returned === "object" &&
          "then" in returned &&
          typeof (returned as { then?: unknown }).then === "function"
        ) {
          Promise.resolve(returned).then(
            (result) => {
              // Some wrappers return undefined while the callback is pending.
              if (result !== undefined && result !== null)
                acceptResult(result);
            },
            reject,
          );
        }
      } catch (failure) {
        reject(failure);
      }
    });
    const result = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              driveAuthError(
                interactive
                  ? "等待浏览器 Google 授权界面超时（20 秒）。请检查浏览器是否拦截授权 UI，或使用高级 OAuth 客户端连接。"
                  : "读取 Google 授权令牌超时。请重新连接 Google Drive。",
              ),
            ),
          IDENTITY_TOKEN_TIMEOUT_MS,
        );
      }),
    ]);
    const token = extractIdentityToken(result);
    if (!token) throw driveAuthError("Google 授权没有返回访问令牌");
    return token;
  } catch (failure) {
    if (failure instanceof DriveAuthError) throw failure;
    const message = failure instanceof Error ? failure.message : String(failure);
    if (/client_id|oauth|authorization page|not found/i.test(message))
      throw driveAuthError(
        `浏览器托管授权不可用（${message}）。请在下方展开“高级：使用自有 OAuth 客户端”。`,
      );
    throw driveAuthError(`Google 授权失败：${message}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Authorization failures the UI must present as "reconnect", not as Drive faults. */
export class DriveAuthError extends Error {
  readonly kind = "auth";
  constructor(message: string) {
    super(message);
    this.name = "DriveAuthError";
  }
}

function driveAuthError(message: string): DriveAuthError {
  return new DriveAuthError(message);
}

/** Read the authorized account from Drive itself, so the UI shows a real identity. */
async function fetchDriveAccount(token: string): Promise<DriveAccount> {
  try {
    const response = await fetch(
      `${DRIVE_API}/about?fields=user(emailAddress,displayName,photoLink)`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) return EMPTY_ACCOUNT;
    const data = (await response.json()) as {
      user?: {
        emailAddress?: string;
        displayName?: string;
        photoLink?: string;
      };
    };
    return {
      email: String(data?.user?.emailAddress || ""),
      accountId: "",
      displayName: String(data?.user?.displayName || ""),
      photoLink: String(data?.user?.photoLink || ""),
    };
  } catch {
    return EMPTY_ACCOUNT;
  }
}

/** Best-effort: pick the browser account id so Chromium can preselect it. */
async function pickAccountId(preferredEmail = ""): Promise<string> {
  const identity = identityApi();
  if (!identity.getAccounts) return "";
  try {
    const accounts = (await identity.getAccounts()) || [];
    if (!accounts.length) return "";
    const wanted = String(preferredEmail || "").toLowerCase();
    const match = wanted
      ? accounts.find(
          (account) => String(account.email || "").toLowerCase() === wanted,
        )
      : null;
    return String((match || accounts[0])?.id || "");
  } catch {
    return "";
  }
}

/** Forget cached folder/file ids: they belong to whichever account was connected. */
async function clearDriveIdCache(): Promise<void> {
  await removeLocal([
    LOCAL_KEYS.legacyFileId,
    LOCAL_KEYS.folderId,
    LOCAL_KEYS.historyFolderId,
    LOCAL_KEYS.fileIds,
  ]);
}

/**
 * Finish a connection with a token obtained from an explicit user action.
 * Redirect-flow tokens are stored only in extension-local storage with their
 * expiry so later Drive requests can reuse them; they are never synchronized.
 * Legacy getAuthToken tokens remain in Chromium's browser-managed cache.
 */
export async function connectGoogleDriveWithToken(
  tokenValue: string,
  preferredEmail = "",
  expiresAtValue?: number,
): Promise<GdriveAuthState> {
  const token = String(tokenValue || "").trim();
  if (!token) throw driveAuthError("Google 授权没有返回访问令牌");

  const isLaunchWebAuthFlowToken = expiresAtValue !== undefined;
  // The packaged default uses a Web application OAuth client for the explicit
  // chromiumapp.org redirect. That public client ID intentionally does not live
  // in manifest.oauth2, which is reserved for Chrome Extension getAuthToken().
  // Only the legacy cached-token route requires that manifest configuration.
  if (!isLaunchWebAuthFlowToken && !hasConfiguredIdentityOAuthClient())
    throw driveAuthError(
      "旧式浏览器托管授权不可用：当前构建使用 Web application OAuth 客户端，请从设置页重新连接 Google Drive。",
    );
  const expiry = Number(expiresAtValue);
  if (
    isLaunchWebAuthFlowToken &&
    (!Number.isFinite(expiry) ||
      expiry <= Date.now() + 1_000 ||
      expiry > Date.now() + 24 * 60 * 60 * 1_000)
  )
    throw driveAuthError("Google 授权返回的访问令牌有效期无效");

  const accountId = await pickAccountId(preferredEmail);
  const account = await fetchDriveAccount(token);
  await clearDriveIdCache();

  if (isLaunchWebAuthFlowToken) {
    // launchWebAuthFlow does not populate Chromium's getAuthToken cache. Keep
    // its short-lived token and expiry locally so later Drive requests can use
    // it without trying the broken browser-managed account chooser again.
    await writeLocal({
      [LOCAL_KEYS.tokens]: {
        authFlow: "identity-web",
        access_token: token,
        expiry,
      } satisfies GdriveTokens,
    });
    return writeAuthState("identity-web", {
      ...account,
      accountId: account.accountId || accountId,
    });
  }

  // Legacy getAuthToken sessions are cached by Chromium, not by this extension.
  await removeLocal([LOCAL_KEYS.tokens]);
  return writeAuthState("identity", {
    ...account,
    accountId: account.accountId || accountId,
  });
}

/**
 * Browser-managed connection flow for internal callers.
 *
 * The settings UI initiates the interactive token request in its click handler
 * so the browser can associate any account chooser/consent UI with user intent.
 */
export async function connectGoogleDriveBrowser(
  preferredEmail = "",
): Promise<GdriveAuthState> {
  if (!hasConfiguredIdentityOAuthClient())
    throw driveAuthError(
      "浏览器托管 Google 登录不可用：扩展 manifest.json 缺少已注册的 oauth2.client_id。请为当前扩展 ID 配置 Chrome Extension OAuth 客户端，或展开高级设置使用自有 OAuth 客户端。",
    );
  if (!supportsBrowserManagedDriveAuth())
    throw driveAuthError(
      "当前浏览器未提供完整的 Chromium Identity API，无法使用浏览器托管 Google 登录；请展开高级设置使用自有 OAuth 客户端。",
    );
  return connectGoogleDriveWithToken(
    await identityToken(true),
    preferredEmail,
  );
}

/**
 * Complete the Web Application OAuth flow after the settings page has
 * captured the authorization redirect. The refresh token stays local and is
 * never copied into the synchronized payload.
 */
export async function completeGoogleDriveManualAuth(
  clientIdValue: string,
  clientSecretValue: string,
  redirectValue: string,
  verifierValue: string,
  codeValue: string,
): Promise<GdriveAuthState> {
  const id = String(clientIdValue || "").trim();
  const clientSecret = String(clientSecretValue || "");
  const redirect = String(redirectValue || "").trim();
  const verifier = String(verifierValue || "").trim();
  const code = String(codeValue || "").trim();
  const identity = identityApi();

  if (!id) throw driveAuthError("请先填写 Google OAuth Client ID");
  if (!code || !verifier)
    throw driveAuthError("Google 授权响应缺少 authorization code 或 PKCE verifier");
  if (verifier.length < 43 || verifier.length > 128)
    throw driveAuthError("Google 授权失败：PKCE verifier 长度无效");
  if (!identity.getRedirectURL || redirect !== identity.getRedirectURL())
    throw driveAuthError("Google 授权失败：重定向 URI 与当前扩展不匹配");

  const body = new URLSearchParams({
    code,
    client_id: id,
    redirect_uri: redirect,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  if (clientSecret) body.set("client_secret", clientSecret);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw driveAuthError(
      `Google token exchange failed: ${String(data?.error_description || data?.error || response.status)}`,
    );

  const accessToken = String(data.access_token || "").trim();
  if (!accessToken)
    throw driveAuthError("Google token exchange completed without an access token");

  await writeLocal({
    [LOCAL_KEYS.tokens]: {
      clientId: id,
      clientSecret,
      refresh_token: String(data.refresh_token || ""),
      access_token: accessToken,
      expiry: Date.now() + Number(data.expires_in || 3600) * 1000,
    } satisfies GdriveTokens,
  });
  await clearDriveIdCache();
  const account = await fetchDriveAccount(accessToken);
  return writeAuthState("manual", account);
}

/**
 * Legacy/internal Web Application OAuth flow. Interactive UI should normally
 * be started by the settings page so it retains the initiating user gesture.
 */
export async function connectGoogleDriveManual(
  clientId: string,
  clientSecret = "",
): Promise<GdriveAuthState> {
  const id = String(clientId || "").trim();
  if (!id) throw driveAuthError("请先填写 Google OAuth Client ID");
  const identity = identityApi();
  if (!identity.getRedirectURL || !identity.launchWebAuthFlow)
    throw driveAuthError("当前浏览器不支持 chrome.identity 授权流程");

  const redirect = identity.getRedirectURL();
  const verifier = randomString(64);
  const challenge = await sha256B64Url(verifier);
  const state = randomString(24);
  const url =
    `${AUTH_URL}?client_id=${encodeURIComponent(id)}` +
    `&redirect_uri=${encodeURIComponent(redirect)}&response_type=code` +
    `&scope=${encodeURIComponent(GDRIVE_SCOPE)}&access_type=offline&prompt=select_account%20consent` +
    `&code_challenge=${challenge}&code_challenge_method=S256` +
    `&state=${encodeURIComponent(state)}`;
  const responseUrl = await identity.launchWebAuthFlow({
    url,
    interactive: true,
  });
  if (!responseUrl) throw driveAuthError("Google 授权已取消");

  const parsed = new URL(responseUrl);
  if (parsed.searchParams.get("state") !== state)
    throw driveAuthError("Google 授权失败：state 校验未通过");
  const code = parsed.searchParams.get("code");
  if (!code)
    throw driveAuthError(
      `Google 授权失败：${parsed.searchParams.get("error") || "no code"}`,
    );

  return completeGoogleDriveManualAuth(
    id,
    clientSecret,
    redirect,
    verifier,
    code,
  );
}
/** Revoke the active session wherever it lives, then forget local state. */
export async function disconnectGoogleDrive(): Promise<void> {
  const auth = await readAuthState();
  const state = await readLocal([LOCAL_KEYS.tokens]);
  const tokens = state[LOCAL_KEYS.tokens] as GdriveTokens | undefined;
  const identity = identityApi();

  let revoked = "";
  if (auth?.mode === "identity" && identity.getAuthToken) {
    try {
      revoked = await identityToken(false);
      if (revoked && identity.removeCachedAuthToken)
        await identity.removeCachedAuthToken({ token: revoked });
    } catch {
      revoked = "";
    }
    // Drop every cached token for this extension so a reconnect re-authorizes.
    try {
      await identity.clearAllCachedAuthTokens?.();
    } catch {
      /* non-fatal: local state is cleared regardless */
    }
  } else if (tokens?.access_token) {
    revoked = tokens.access_token;
  }

  if (revoked) {
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revoked)}`,
        { method: "POST" },
      );
    } catch {
      /* revocation is best-effort; local state is still cleared */
    }
  }

  await removeLocal([
    LOCAL_KEYS.auth,
    LOCAL_KEYS.tokens,
    LOCAL_KEYS.legacyFileId,
    LOCAL_KEYS.folderId,
    LOCAL_KEYS.historyFolderId,
    LOCAL_KEYS.fileIds,
  ]);
  await invalidateGdriveLayout();
}

async function manualAccessToken(tokens: GdriveTokens): Promise<string> {
  if (tokens.access_token && tokens.expiry && Date.now() < tokens.expiry - 60_000)
    return tokens.access_token;
  const body = new URLSearchParams({
    client_id: tokens.clientId || "",
    refresh_token: tokens.refresh_token || "",
    grant_type: "refresh_token",
  });
  if (tokens.clientSecret) body.set("client_secret", tokens.clientSecret);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok)
    throw driveError(response.status, data, "Google Drive 授权已失效，请重新连接");
  await writeLocal({
    [LOCAL_KEYS.tokens]: {
      ...tokens,
      access_token: String(data.access_token || ""),
      expiry: Date.now() + Number(data.expires_in || 3600) * 1000,
    } satisfies GdriveTokens,
  });
  return String(data.access_token || "");
}

/** Resolve a Drive access token for whichever authorization mode is active. */
export async function gdriveAccessToken(): Promise<string> {
  const auth = await readAuthState();
  const state = await readLocal([LOCAL_KEYS.tokens]);
  const tokens = state[LOCAL_KEYS.tokens] as GdriveTokens | undefined;

  if (auth?.mode === "identity-web") {
    if (
      tokens?.authFlow !== "identity-web" ||
      !tokens.access_token ||
      !Number.isFinite(tokens.expiry)
    )
      throw driveAuthError("Google Drive 本地授权会话已失效，请点击“使用 Google 账号连接”重新授权");
    if (Date.now() >= Number(tokens.expiry) - 60_000)
      throw driveAuthError("Google Drive 访问令牌已过期，请点击“使用 Google 账号连接”重新授权");
    return tokens.access_token;
  }

  if (auth?.mode === "identity" || (!auth && !tokens?.refresh_token)) {
    if (!auth && !tokens?.refresh_token) throw driveAuthError("尚未连接 Google Drive");
    if (auth?.mode === "identity" && !hasConfiguredIdentityOAuthClient())
      throw driveAuthError("旧版浏览器托管 Google 授权已失效，请点击“使用 Google 账号连接”重新授权。");
    // Non-interactive: a cached Chromium token is reused, and re-authorization is
    // an explicit user action rather than a surprise prompt mid-sync.
    return identityToken(false);
  }
  if (!tokens?.refresh_token) throw driveAuthError("尚未连接 Google Drive");
  return manualAccessToken(tokens);
}

/** Drop a Chromium-cached token so the next call re-authorizes. */
export async function clearCachedDriveToken(token: string): Promise<void> {
  if (!token) return;
  const identity = identityApi();
  try {
    await identity.removeCachedAuthToken?.({ token });
  } catch {
    /* non-fatal */
  }
}

export async function gdriveConnected(): Promise<boolean> {
  const auth = await readAuthState();
  const state = await readLocal([LOCAL_KEYS.tokens]);
  const tokens = state[LOCAL_KEYS.tokens] as GdriveTokens | undefined;
  if (auth?.mode === "identity-web")
    return Boolean(
      tokens?.authFlow === "identity-web" &&
        tokens.access_token &&
        Number.isFinite(tokens.expiry) &&
        Date.now() < Number(tokens.expiry) - 60_000,
    );
  // An older browser-managed session cannot be refreshed with a Web application
  // client ID. Report it as disconnected instead of showing a false healthy state.
  if (auth?.mode === "identity")
    return hasConfiguredIdentityOAuthClient();
  if (auth) return true;
  return Boolean(tokens?.refresh_token);
}

/** Connection state for Settings: account, mode, scope, and fallback availability. */
export async function gdriveAuthState(): Promise<{
  connected: boolean;
  auth: GdriveAuthState | null;
  browserManagedAvailable: boolean;
  scope: string;
}> {
  const auth = await readAuthState();
  const connected = await gdriveConnected();
  return {
    connected,
    auth: auth || (connected ? { ...EMPTY_ACCOUNT, mode: "manual", scope: GDRIVE_SCOPE, connectedAt: "" } as GdriveAuthState : null),
    browserManagedAvailable: supportsBrowserManagedDriveAuth(),
    scope: GDRIVE_SCOPE,
  };
}

/* --------------------------------------------------------------------------
 * Drive API error reporting
 * ------------------------------------------------------------------------ */

/**
 * Drive failures must stay distinguishable in the UI: quota, rate limit,
 * permission, and missing-file problems each need a different user action, so
 * they are reported as typed errors rather than a bare HTTP status.
 */
export type DriveErrorKind =
  | "quota"
  | "rate-limit"
  | "auth"
  | "permission"
  | "not-found"
  | "too-large"
  | "server"
  | "unknown";

export class DriveApiError extends Error {
  readonly code = "GDRIVE_API_ERROR";
  readonly status: number;
  readonly reason: string;
  readonly kind: DriveErrorKind;
  readonly context: string;
  readonly driveMessage: string;
  constructor(
    status: number,
    body: unknown,
    context = "",
  ) {
    const error = (
      body as {
        error?: { message?: string; errors?: Array<{ reason?: string }> };
      } | null
    )?.error;
    const reason = error?.errors?.[0]?.reason || "";
    const message = error?.message || "";
    const kind = classifyDriveError(status, reason);
    super(describeDriveError(status, body, context));
    this.name = "DriveApiError";
    this.status = status;
    this.reason = reason;
    this.kind = kind;
    this.context = context;
    this.driveMessage = message;
  }
}

/**
 * Classify a Drive failure so callers can branch on the kind instead of parsing
 * message text. Exported for the package-backup UI, which must surface quota,
 * permission, and size-limit problems distinctly.
 */
export function classifyDriveError(
  status: number,
  reason: string,
): DriveErrorKind {
  if (reason === "storageQuotaExceeded" || reason === "quotaExceeded")
    return "quota";
  if (
    reason === "rateLimitExceeded" ||
    reason === "userRateLimitExceeded" ||
    status === 429
  )
    return "rate-limit";
  if (status === 401 || reason === "authError" || reason === "invalidCredentials")
    return "auth";
  if (status === 403) return "permission";
  if (status === 404 || reason === "notFound") return "not-found";
  if (status === 413) return "too-large";
  if (status >= 500) return "server";
  return "unknown";
}

/** Human-readable classification of a Drive API failure. */
export function describeDriveError(
  status: number,
  body: unknown,
  context = "",
): string {
  const error = (
    body as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    } | null
  )?.error;
  const reason = error?.errors?.[0]?.reason || "";
  const message = error?.message || "";
  const prefix = context ? `${context}：` : "";
  switch (classifyDriveError(status, reason)) {
    case "quota":
      return `${prefix}Google Drive 存储空间或配额不足（${reason}）`;
    case "rate-limit":
      return `${prefix}Google Drive 请求过于频繁，请稍后重试（${reason || "rateLimitExceeded"}）`;
    case "auth":
      return `${prefix}Google Drive 授权已过期，请重新连接`;
    case "permission":
      return `${prefix}Google Drive 权限不足（${reason || message || "forbidden"}）`;
    case "not-found":
      return `${prefix}Google Drive 文件不存在（${reason || message || "notFound"}）`;
    case "too-large":
      return `${prefix}文件超过 Google Drive 上传大小限制`;
    case "server":
      return `${prefix}Google Drive 服务暂时不可用：HTTP ${status}`;
    default:
      return message
        ? `${prefix}${message}`
        : `${prefix}Google Drive 请求失败：HTTP ${status}`;
  }
}

function driveError(
  status: number,
  body: unknown,
  context = "",
): DriveApiError {
  return new DriveApiError(status, body, context);
}

/** Pull the first Drive `reason` code out of an error body. */
export function driveErrorReason(body: unknown): string {
  const error = (
    body as {
      error?: { errors?: Array<{ reason?: string }> };
    } | null
  )?.error;
  return String(error?.errors?.[0]?.reason || "");
}

async function parseErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function driveFetch(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<Response> {
  const accessToken = token ?? (await gdriveAccessToken());
  const request = (bearer: string): Promise<Response> =>
    fetch(`${DRIVE_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...((init.headers as Record<string, string>) || {}),
      },
    });
  const response = await request(accessToken);
  if (response.status !== 401) return response;

  // A browser-managed token can be revoked server-side while Chromium still has
  // it cached. Drop the cached token and retry once before surfacing an auth
  // failure, so a stale cache does not require a manual reconnect.
  const auth = await readAuthState();
  if (auth?.mode === "identity-web") {
    // A direct implicit-flow token has no refresh token. Once Google rejects it,
    // discard this session and require a new explicit connection click.
    await removeLocal([LOCAL_KEYS.tokens, LOCAL_KEYS.auth]);
    return response;
  }
  if (auth?.mode !== "identity") return response;
  await clearCachedDriveToken(accessToken);
  try {
    return await request(await gdriveAccessToken());
  } catch {
    return response;
  }
}

async function driveJson(
  path: string,
  init: RequestInit = {},
  token?: string,
  context = "",
): Promise<unknown> {
  const response = await driveFetch(path, init, token);
  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }
  if (!response.ok) throw driveError(response.status, data, context);
  return data;
}

/* --------------------------------------------------------------------------
 * Application-managed folder and file id cache
 * ------------------------------------------------------------------------ */

interface DriveFileEntry {
  id: string;
  name: string;
}

async function readIdCache(): Promise<Record<string, string>> {
  const state = await readLocal([LOCAL_KEYS.fileIds]);
  const cached = state[LOCAL_KEYS.fileIds];
  return cached && typeof cached === "object" && !Array.isArray(cached)
    ? (cached as Record<string, string>)
    : {};
}

async function writeIdCache(cache: Record<string, string>): Promise<void> {
  await writeLocal({ [LOCAL_KEYS.fileIds]: cache });
}

function escapeQueryValue(value: string): string {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function queryFiles(
  query: string,
  token: string,
  fields = "files(id,name,mimeType,modifiedTime)",
): Promise<DriveFileEntry[]> {
  const data = (await driveJson(
    `/files?q=${encodeURIComponent(query)}&spaces=drive&pageSize=200&fields=${encodeURIComponent(fields)}`,
    {},
    token,
    "查询 Google Drive 文件",
  )) as { files?: DriveFileEntry[] };
  return Array.isArray(data?.files) ? data.files : [];
}

async function ensureFolder(
  name: string,
  parentId: string | null,
  token: string,
): Promise<string> {
  const parentClause = parentId ? ` and '${escapeQueryValue(parentId)}' in parents` : " and 'root' in parents";
  const existing = await queryFiles(
    `name='${escapeQueryValue(name)}' and mimeType='${FOLDER_MIME}'${parentClause} and trashed=false`,
    token,
  );
  if (existing[0]?.id) return existing[0].id;
  const boundary = `ccsync-folder-${randomString(8)}`;
  const metadata = parentId
    ? { name, mimeType: FOLDER_MIME, parents: [parentId] }
    : { name, mimeType: FOLDER_MIME };
  const response = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body: te.encode(
      `--${boundary}\r\nContent-Type: ${JSON_MIME}; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}--`,
    ),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok)
    throw driveError(response.status, data, "创建 Google Drive 文件夹");
  const id = String((data as { id?: string })?.id || "");
  if (!id) throw Error("创建 Google Drive 文件夹失败：未返回文件 ID");
  return id;
}

interface DriveLayout {
  token: string;
  folderId: string;
  historyFolderId: string;
  ids: Record<string, string>;
}

/**
 * Resolve the application-managed Drive layout.
 *
 * Folder ids are cached in extension storage so a sync does not pay a lookup
 * round trip per file. If Drive reports the cached folder as missing, the cache
 * is invalidated and the layout is recreated once.
 */
async function resolveLayout(): Promise<DriveLayout> {
  const token = await gdriveAccessToken();
  const state = await readLocal([
    LOCAL_KEYS.folderId,
    LOCAL_KEYS.historyFolderId,
  ]);
  let folderId = String(state[LOCAL_KEYS.folderId] || "");
  if (!folderId) {
    folderId = await ensureFolder(GDRIVE_APP_FOLDER, null, token);
    await writeLocal({ [LOCAL_KEYS.folderId]: folderId });
    await writeIdCache({});
  }
  let historyFolderId = String(state[LOCAL_KEYS.historyFolderId] || "");
  if (!historyFolderId) {
    historyFolderId = await ensureFolder(
      GDRIVE_HISTORY_FOLDER,
      folderId,
      token,
    );
    await writeLocal({ [LOCAL_KEYS.historyFolderId]: historyFolderId });
  }
  return { token, folderId, historyFolderId, ids: await readIdCache() };
}

/** Drop cached folder and file ids (account change, deleted app folder). */
export async function invalidateGdriveLayout(): Promise<void> {
  await removeLocal([
    LOCAL_KEYS.folderId,
    LOCAL_KEYS.historyFolderId,
    LOCAL_KEYS.fileIds,
  ]);
}

function isMissingDriveFolder(error: unknown): boolean {
  return (
    error instanceof DriveApiError &&
    error.kind === "not-found" &&
    /文件夹|folder/i.test(error.context)
  );
}

async function withLayout<T>(
  work: (layout: DriveLayout) => Promise<T>,
): Promise<T> {
  try {
    return await work(await resolveLayout());
  } catch (error) {
    if (!isMissingDriveFolder(error)) throw error;
    await invalidateGdriveLayout();
    return work(await resolveLayout());
  }
}

/** Drive names cannot contain "/", so logical paths map onto folders. */
function driveLocation(
  logicalName: string,
): { scope: "app" | "history"; name: string } {
  const name = String(logicalName || "");
  if (name === HISTORY_INDEX_FILE)
    return { scope: "history", name: GDRIVE_INDEX_FILE };
  if (name.startsWith("history/")) {
    const rest = name.slice("history/".length);
    return { scope: "history", name: rest.replace(/\//g, "--") };
  }
  return { scope: "app", name };
}

async function resolveFileId(
  layout: DriveLayout,
  logicalName: string,
): Promise<string | null> {
  const location = driveLocation(logicalName);
  const cacheKey = `${location.scope}:${location.name}`;
  if (layout.ids[cacheKey]) return layout.ids[cacheKey];
  const parentId =
    location.scope === "history" ? layout.historyFolderId : layout.folderId;
  const found = await queryFiles(
    `name='${escapeQueryValue(location.name)}' and '${escapeQueryValue(parentId)}' in parents and trashed=false`,
    layout.token,
  );
  const id = found[0]?.id || null;
  if (id) {
    layout.ids[cacheKey] = id;
    await writeIdCache(layout.ids);
  }
  return id;
}

async function readTextById(
  layout: DriveLayout,
  fileId: string,
): Promise<string | null> {
  const response = await driveFetch(
    `/files/${encodeURIComponent(fileId)}?alt=media`,
    {},
    layout.token,
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw driveError(
      response.status,
      await parseErrorBody(response),
      "读取 Google Drive 文件",
    );
  return response.text();
}

async function uploadText(
  layout: DriveLayout,
  logicalName: string,
  text: string,
): Promise<string> {
  const location = driveLocation(logicalName);
  const cacheKey = `${location.scope}:${location.name}`;
  const existing = layout.ids[cacheKey] ?? (await resolveFileId(layout, logicalName));
  if (existing) {
    const response = await fetch(
      `${UPLOAD_API}/files/${encodeURIComponent(existing)}?uploadType=media&fields=id`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${layout.token}`,
          "Content-Type": `${JSON_MIME}; charset=UTF-8`,
        },
        body: text,
      },
    );
    if (response.ok) return existing;
    const data = await parseErrorBody(response);
    if (response.status !== 404)
      throw driveError(response.status, data, "写入 Google Drive 文件");
    // Cached id points at a deleted file: drop it and recreate below.
    delete layout.ids[cacheKey];
  }
  const parentId =
    location.scope === "history" ? layout.historyFolderId : layout.folderId;
  const boundary = `ccsync-upload-${randomString(8)}`;
  const metadata = {
    name: location.name,
    mimeType: JSON_MIME,
    parents: [parentId],
  };
  const response = await fetch(
    `${UPLOAD_API}/files?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${layout.token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: te.encode(
        `--${boundary}\r\nContent-Type: ${JSON_MIME}; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: ${JSON_MIME}; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`,
      ),
    },
  );
  const data = await parseErrorBody(response);
  if (!response.ok)
    throw driveError(response.status, data, "创建 Google Drive 文件");
  const id = String((data as { id?: string })?.id || "");
  if (!id) throw Error("创建 Google Drive 文件失败：未返回文件 ID");
  layout.ids[cacheKey] = id;
  await writeIdCache(layout.ids);
  return id;
}

/* --------------------------------------------------------------------------
 * Public helpers
 * ------------------------------------------------------------------------ */

export async function gdriveTest(): Promise<{ ok: true; folderId: string }> {
  return withLayout(async (layout) => {
    const data = (await driveJson(
      `/files/${encodeURIComponent(layout.folderId)}?fields=id,name`,
      {},
      layout.token,
      "Google Drive 连接测试",
    )) as { name?: string };
    return { ok: true as const, folderId: layout.folderId, appFolder: String(data?.name || GDRIVE_APP_FOLDER) };
  });
}

export async function gdriveStatus(): Promise<{
  connected: boolean;
  folderId: string;
  appFolder: string;
  historyFolder: string;
  legacyFile: string;
  auth: GdriveAuthState | null;
  mode: GdriveAuthMode | "";
  email: string;
  displayName: string;
  scope: string;
  connectedAt: string;
  browserManagedAvailable: boolean;
}> {
  const connected = await gdriveConnected();
  const state = await readLocal([LOCAL_KEYS.folderId, LOCAL_KEYS.legacyFileId]);
  const { auth, browserManagedAvailable } = await gdriveAuthState();
  return {
    connected,
    folderId: String(state[LOCAL_KEYS.folderId] || ""),
    appFolder: GDRIVE_APP_FOLDER,
    historyFolder: GDRIVE_HISTORY_FOLDER,
    legacyFile: state[LOCAL_KEYS.legacyFileId] ? LEGACY_STATE_FILE : "",
    auth,
    mode: auth?.mode || "",
    email: auth?.email || "",
    displayName: auth?.displayName || "",
    scope: auth?.scope || GDRIVE_SCOPE,
    connectedAt: auth?.connectedAt || "",
    browserManagedAvailable,
  };
}

/** Read the pre-modular single-file payload when it exists. */
async function readLegacyStateFile(
  layout: DriveLayout,
): Promise<string | null> {
  const state = await readLocal([LOCAL_KEYS.legacyFileId]);
  let fileId = String(state[LOCAL_KEYS.legacyFileId] || "");
  if (!fileId) {
    const found = await queryFiles(
      `name='${escapeQueryValue(LEGACY_STATE_FILE)}' and 'root' in parents and trashed=false`,
      layout.token,
    );
    fileId = found[0]?.id || "";
    if (fileId) await writeLocal({ [LOCAL_KEYS.legacyFileId]: fileId });
  }
  if (!fileId) return null;
  return readTextById(layout, fileId);
}

interface DriveHistoryIndex {
  schemaVersion?: number;
  entries?: Array<{
    id: string;
    createdAt: string;
    revision?: number;
    files?: string[];
    /** Modules whose payload changed in this archived revision. */
    modules?: string[];
  }>;
}

const PROTOCOL_FILES = [
  MANIFEST_FILE,
  META_FILE,
  ...SYNC_MODULE_IDS.map((moduleId) => MODULE_FILES[moduleId]),
];

export function createGdriveFileStore(): FileStore {
  const readIndex = async (
    layout: DriveLayout,
  ): Promise<DriveHistoryIndex> => {
    const id = await resolveFileId(layout, HISTORY_INDEX_FILE);
    if (!id) return { schemaVersion: 2, entries: [] };
    const text = await readTextById(layout, id);
    if (!text) return { schemaVersion: 2, entries: [] };
    try {
      const parsed = JSON.parse(text) as DriveHistoryIndex;
      return {
        schemaVersion: 2,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      };
    } catch {
      return { schemaVersion: 2, entries: [] };
    }
  };

  return {
    id: "gdrive",
    async read(names: string[]): Promise<FileStoreReadResult> {
      return withLayout(async (layout) => {
      const files: Record<string, string | null> = {};
      await Promise.all(
        [...new Set(names)].map(async (name) => {
          if (name === LEGACY_MONOLITHIC_FILE) {
            // The legacy payload lives outside the app folder.
            files[name] = await readLegacyStateFile(layout);
            return;
          }
          const id = await resolveFileId(layout, name);
          files[name] = id ? await readTextById(layout, id) : null;
        }),
      );
      return {
        files,
        raw: { folderId: layout.folderId, appFolder: GDRIVE_APP_FOLDER },
      };
      });
    },
    async write(entries) {
      await withLayout(async (layout) => {
        for (const [name, text] of Object.entries(entries))
          await uploadText(layout, name, text);
      });
    },
    async remove(names) {
      await withLayout(async (layout) => {
      for (const name of names) {
        const id = await resolveFileId(layout, name);
        if (!id) continue;
        const response = await driveFetch(
          `/files/${encodeURIComponent(id)}`,
          { method: "DELETE" },
          layout.token,
        );
        if (!response.ok && response.status !== 404)
          throw driveError(
            response.status,
            await parseErrorBody(response),
            "删除 Google Drive 文件",
          );
        const location = driveLocation(name);
        delete layout.ids[`${location.scope}:${location.name}`];
      }
      await writeIdCache(layout.ids);
      });
    },
    async list() {
      return withLayout(async (layout) => {
        const entries = await queryFiles(
          `'${escapeQueryValue(layout.folderId)}' in parents and trashed=false`,
          layout.token,
        );
        return entries.map((entry) => entry.name);
      });
    },
    history: {
      async archive(label, entries, meta) {
        await withLayout(async (layout) => {
        for (const entry of entries)
          await uploadText(layout, `history/${label}/${entry.name}`, entry.text);
        const index = await readIndex(layout);
        let revision = Number(meta?.revision) || 0;
        if (!revision) {
          const metaText = entries.find((entry) => entry.name === META_FILE)?.text;
          if (metaText) {
            try {
              revision =
                Number((JSON.parse(metaText) as { revision?: number }).revision) ||
                0;
            } catch {
              revision = 0;
            }
          }
        }
        index.schemaVersion = 2;
        index.entries = [
          ...(index.entries || []).filter((entry) => entry.id !== label),
          {
            id: label,
            createdAt: new Date().toISOString(),
            revision,
            files: entries.map((entry) => entry.name),
            modules: (meta?.modules || []).map((moduleId) => String(moduleId)),
          },
        ].slice(-GDRIVE_HISTORY_LIMIT);
        await uploadText(
          layout,
          HISTORY_INDEX_FILE,
          JSON.stringify(index, null, 2),
        );
        // Trim archives beyond the retention window.
        const retained = (index.entries || []).length;
        if (retained >= GDRIVE_HISTORY_LIMIT) await pruneHistory(layout, index);
        });
      },
      async list(): Promise<HistoryEntry[]> {
        return withLayout(async (layout) => {
        const index = await readIndex(layout);
        return (index.entries || [])
          .slice()
          .reverse()
          .map((entry, position) => ({
            id: entry.id,
            createdAt: entry.createdAt,
            current: position === 0,
            layout: "modular",
            revision: Number(entry.revision) || 0,
            modules: (entry.modules || []).filter((moduleId) =>
              SYNC_MODULE_IDS.includes(moduleId as SyncModuleId),
            ) as SyncModuleId[],
          }));
        });
      },
      async read(entryId) {
        return withLayout(async (layout) => {
        const files: Record<string, string | null> = {};
        await Promise.all(
          PROTOCOL_FILES.map(async (name) => {
            const id = await resolveFileId(layout, `history/${entryId}/${name}`);
            files[name] = id ? await readTextById(layout, id) : null;
          }),
        );
        if (PROTOCOL_FILES.every((name) => files[name] === null))
          throw Error(`读取 Google Drive 历史版本失败：${entryId}`);
        return files;
        });
      },
    },
  };
}

async function pruneHistory(
  layout: DriveLayout,
  index: DriveHistoryIndex,
): Promise<void> {
  const keep = new Set(
    (index.entries || []).flatMap((entry) =>
      (entry.files || []).map((name) => `history/${entry.id}/${name}`),
    ),
  );
  const entries = await queryFiles(
    `'${escapeQueryValue(layout.historyFolderId)}' in parents and trashed=false`,
    layout.token,
  );
  for (const entry of entries) {
    if (entry.name === GDRIVE_INDEX_FILE) continue;
    const logical = `history/${entry.name.replace(/--/g, "/")}`;
    if (keep.has(logical)) continue;
    delete layout.ids[`history:${entry.name}`];
    const response = await driveFetch(
      `/files/${encodeURIComponent(entry.id)}`,
      { method: "DELETE" },
      layout.token,
    );
    if (!response.ok && response.status !== 404)
      throw driveError(
        response.status,
        await parseErrorBody(response),
        "清理 Google Drive 历史文件",
      );
  }
  await writeIdCache(layout.ids);
}
