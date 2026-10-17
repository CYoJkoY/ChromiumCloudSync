import assert from "node:assert/strict";
import { assertNoCredentialsInPayload } from "../src/runtime/cloud-files.ts";
import { detectBrowserCapabilities } from "../src/runtime/browser-capabilities.ts";

/* --------------------------------------------------------------------------
 * Test doubles: chrome.storage.local, chrome.identity, and fetch.
 *
 * The Drive auth flow is exercised against a mocked Identity API so both the
 * browser-managed path and the manual fallback can be verified deterministically.
 * ------------------------------------------------------------------------ */

interface MockIdentity {
  getAuthTokenCalls: Array<{ interactive?: boolean; scopes?: string[] }>;
  removedTokens: string[];
  clearedAll: number;
  token: string;
  failWith: string;
  accounts: Array<{ id: string; email: string }>;
}

interface MockFetchCall {
  url: string;
  init: RequestInit;
}

const storage = new Map<string, unknown>();
const identity: MockIdentity = {
  getAuthTokenCalls: [],
  removedTokens: [],
  clearedAll: 0,
  token: "identity-access-token",
  failWith: "",
  accounts: [{ id: "account-1", email: "user@example.com" }],
};
const fetchCalls: MockFetchCall[] = [];
let fetchResponder: (call: MockFetchCall) => {
  ok: boolean;
  status: number;
  body: unknown;
};

function installChrome(
  options: {
    withGetAuthToken?: boolean;
    withOAuthClient?: boolean;
    promiseOnly?: boolean;
  } = {},
) {
  const withGetAuthToken = options.withGetAuthToken !== false;
  const withOAuthClient = options.withOAuthClient !== false;
  const promiseOnly = options.promiseOnly === true;
  const identityApi: Record<string, unknown> = {
    getRedirectURL: () => "https://example.chromiumapp.org/",
    launchWebAuthFlow: async () => undefined,
    removeCachedAuthToken: async (details: { token: string }) => {
      identity.removedTokens.push(String(details?.token || ""));
    },
    clearAllCachedAuthTokens: async () => {
      identity.clearedAll += 1;
    },
    getAccounts: async () => identity.accounts,
  };
  if (withGetAuthToken)
    identityApi.getAuthToken = (
      details: { interactive?: boolean; scopes?: string[] },
      callback?: (result: unknown, grantedScopes?: string[]) => void,
    ) => {
      identity.getAuthTokenCalls.push({
        interactive: details?.interactive,
        scopes: details?.scopes,
      });
      const extensionRuntime = (
        globalThis as unknown as {
          chrome?: {
            runtime?: { lastError?: { message?: string } };
          };
        }
      ).chrome?.runtime;
      if (identity.failWith) {
        if (promiseOnly) return Promise.reject(new Error(identity.failWith));
        if (extensionRuntime)
          extensionRuntime.lastError = { message: identity.failWith };
        callback?.(undefined);
        if (extensionRuntime) delete extensionRuntime.lastError;
        return;
      }
      if (promiseOnly) return Promise.resolve(identity.token);
      callback?.(identity.token, details?.scopes || []);
      return undefined;
    };

  (globalThis as unknown as Record<string, unknown>).chrome = {
    storage: {
      local: {
        get: async (keys: string[] | null) => {
          const out: Record<string, unknown> = {};
          for (const key of keys ?? [...storage.keys()])
            if (storage.has(key)) out[key] = storage.get(key);
          return out;
        },
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values))
            storage.set(key, value);
        },
        remove: async (keys: string[]) => {
          for (const key of keys) storage.delete(key);
        },
      },
    },
    runtime: {
      getManifest: () =>
        withOAuthClient
          ? { oauth2: { client_id: "test-extension.apps.googleusercontent.com" } }
          : {},
    },
    identity: identityApi,
  };
}

function installFetch() {
  fetchCalls.length = 0;
  (globalThis as unknown as Record<string, unknown>).fetch = async (
    url: string,
    init: RequestInit = {},
  ) => {
    const call = { url: String(url), init };
    fetchCalls.push(call);
    const result = fetchResponder(call);
    return {
      ok: result.ok,
      status: result.status,
      text: async () => JSON.stringify(result.body),
      json: async () => result.body,
    };
  };
}

function reset() {
  storage.clear();
  fetchCalls.length = 0;
  identity.getAuthTokenCalls.length = 0;
  identity.removedTokens.length = 0;
  identity.clearedAll = 0;
  identity.token = "identity-access-token";
  identity.failWith = "";
  identity.accounts = [{ id: "account-1", email: "user@example.com" }];
}

installChrome();
installFetch();

const {
  GDRIVE_SCOPE,
  DriveAuthError,
  clearCachedDriveToken,
  connectGoogleDriveBrowser,
  connectGoogleDriveManual,
  connectGoogleDriveWithToken,
  disconnectGoogleDrive,
  gdriveAccessToken,
  gdriveAuthState,
  gdriveConnected,
  gdriveStatus,
  supportsBrowserManagedDriveAuth,
} = await import("../src/runtime/cloud-gdrive.ts");

/** Default responder: Drive `about` returns the authorized account. */
function respondWithAccount(email = "user@example.com") {
  fetchResponder = (call) => {
    if (call.url.includes("/about"))
      return {
        ok: true,
        status: 200,
        body: {
          user: {
            emailAddress: email,
            displayName: "Test User",
            photoLink: "https://example.com/photo.png",
          },
        },
      };
    if (call.url.includes("/revoke")) return { ok: true, status: 200, body: {} };
    return { ok: true, status: 200, body: {} };
  };
}

/* --------------------------------------------------------------------------
 * Capability detection drives which flow the UI offers.
 * ------------------------------------------------------------------------ */
{
  reset();
  installChrome({ withGetAuthToken: true });
  const capabilities = detectBrowserCapabilities();
  assert.equal(capabilities.identity, true);
  assert.equal(capabilities.identityGetAuthToken, true);
  assert.equal(capabilities.identityTokenCache, true);
  assert.equal(supportsBrowserManagedDriveAuth(), true);

  installChrome({ withOAuthClient: false });
  assert.equal(
    supportsBrowserManagedDriveAuth(),
    false,
    "browser-managed OAuth requires manifest.oauth2.client_id",
  );

  installChrome({ withGetAuthToken: false });
  const limited = detectBrowserCapabilities();
  assert.equal(limited.identityGetAuthToken, false);
  assert.equal(limited.identity, true, "extension redirect API is available");
  assert.equal(limited.identityWebAuthFlow, true);
  assert.equal(
    supportsBrowserManagedDriveAuth(),
    false,
    "browser-managed getAuthToken is unavailable even though the extension redirect API exists",
  );
  installChrome({ withGetAuthToken: true });
}

/* --------------------------------------------------------------------------
 * Promise-only Identity API compatibility.
 * ------------------------------------------------------------------------ */
{
  reset();
  installChrome({ withGetAuthToken: true, promiseOnly: true });
  respondWithAccount("promise-only@example.com");
  const auth = await connectGoogleDriveBrowser();
  assert.equal(auth.email, "promise-only@example.com");
  assert.equal(auth.mode, "identity");
}

/* --------------------------------------------------------------------------
 * Browser-managed connection: no client configuration, minimum scope.
 * ------------------------------------------------------------------------ */
{
  reset();
  respondWithAccount("user@example.com");
  const auth = await connectGoogleDriveBrowser();

  assert.equal(auth.mode, "identity");
  assert.equal(auth.email, "user@example.com");
  assert.equal(auth.displayName, "Test User");
  assert.equal(auth.accountId, "account-1");
  assert.equal(auth.scope, GDRIVE_SCOPE);
  assert.ok(auth.connectedAt, "connection time recorded locally");

  assert.equal(identity.getAuthTokenCalls.length, 1);
  assert.equal(identity.getAuthTokenCalls[0]?.interactive, true);
  assert.deepEqual(
    identity.getAuthTokenCalls[0]?.scopes,
    [GDRIVE_SCOPE],
    "only the minimum drive.file scope is requested",
  );

  // No client configuration is requested, and no token is persisted by us.
  assert.equal(
    fetchCalls.some((call) => call.url.includes("oauth2.googleapis.com/token")),
    false,
    "browser-managed flow performs no token exchange",
  );
  assert.equal(storage.has("gdriveTokens"), false, "no credentials stored");
  assert.equal(await gdriveConnected(), true);

  const state = await gdriveAuthState();
  assert.equal(state.connected, true);
  assert.equal(state.auth?.mode, "identity");
  assert.equal(state.browserManagedAvailable, true);

  const status = await gdriveStatus();
  assert.equal(status.mode, "identity");
  assert.equal(status.email, "user@example.com");
  assert.equal(status.scope, GDRIVE_SCOPE);

  // Auth state stays local to the browser profile.
  const stored = storage.get("gdriveAuth") as Record<string, unknown>;
  assert.equal(stored.mode, "identity");
  assert.equal(stored.access_token, undefined);
  assert.equal(stored.refresh_token, undefined);
}

/* --------------------------------------------------------------------------
 * Read Frog-style extension redirect auth keeps its short-lived token locally.
 * ------------------------------------------------------------------------ */
{
  reset();
  respondWithAccount("web-flow@example.com");
  const expiry = Date.now() + 3_600_000;
  const auth = await connectGoogleDriveWithToken(
    "launch-web-flow-token",
    "web-flow@example.com",
    expiry,
  );

  assert.equal(auth.mode, "identity-web");
  assert.equal(auth.email, "web-flow@example.com");
  assert.equal(await gdriveConnected(), true);
  assert.equal(await gdriveAccessToken(), "launch-web-flow-token");
  assert.equal(identity.getAuthTokenCalls.length, 0);

  const storedTokens = storage.get("gdriveTokens") as Record<string, unknown>;
  assert.equal(storedTokens.authFlow, "identity-web");
  assert.equal(storedTokens.access_token, "launch-web-flow-token");
  assert.equal(storedTokens.expiry, expiry);
  assert.equal(storedTokens.refresh_token, undefined);
  assert.equal(storedTokens.clientSecret, undefined);

  const state = storage.get("gdriveAuth") as Record<string, unknown>;
  assert.equal(state.mode, "identity-web");
  assert.equal(state.access_token, undefined);
  assert.equal(state.refresh_token, undefined);
  assert.equal(state.clientSecret, undefined);
}

{
  reset();
  respondWithAccount("expired-web-flow@example.com");
  await connectGoogleDriveWithToken(
    "near-expiry-token",
    "expired-web-flow@example.com",
    Date.now() + 30_000,
  );
  assert.equal(await gdriveConnected(), false);
  await assert.rejects(
    () => gdriveAccessToken(),
    (failure: unknown) => {
      assert.ok(failure instanceof DriveAuthError);
      assert.match(failure.message, /已过期/);
      return true;
    },
    "expired direct tokens require an explicit reconnect",
  );
  assert.equal(
    identity.getAuthTokenCalls.length,
    0,
    "expiry must not trigger a silent or background getAuthToken prompt",
  );
}

{
  reset();
  respondWithAccount("web-flow-disconnect@example.com");
  await connectGoogleDriveWithToken(
    "web-flow-revoke-token",
    "web-flow-disconnect@example.com",
    Date.now() + 3_600_000,
  );
  await disconnectGoogleDrive();
  assert.equal(
    fetchCalls.some((call) =>
      call.url.includes("oauth2.googleapis.com/revoke") &&
      call.url.includes("web-flow-revoke-token"),
    ),
    true,
    "disconnect revokes the locally stored launchWebAuthFlow token",
  );
  assert.equal(storage.has("gdriveAuth"), false);
  assert.equal(storage.has("gdriveTokens"), false);
  assert.equal(await gdriveConnected(), false);
}

/* --------------------------------------------------------------------------
 * Token resolution in browser-managed mode is non-interactive.
 * ------------------------------------------------------------------------ */
{
  reset();
  respondWithAccount();
  await connectGoogleDriveBrowser();
  identity.getAuthTokenCalls.length = 0;

  const token = await gdriveAccessToken();
  assert.equal(token, "identity-access-token");
  assert.equal(identity.getAuthTokenCalls.length, 1);
  assert.equal(
    identity.getAuthTokenCalls[0]?.interactive,
    false,
    "re-authorization is an explicit user action, never a mid-sync prompt",
  );
}

/* --------------------------------------------------------------------------
 * An unavailable Identity API is reported as the explicit fallback case.
 * ------------------------------------------------------------------------ */
{
  reset();
  installChrome({ withGetAuthToken: false });
  await assert.rejects(
    () => connectGoogleDriveBrowser(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /自有 OAuth 客户端/);
      return true;
    },
    "unsupported host must point at the manual fallback",
  );
  installChrome({ withGetAuthToken: true });
}

{
  reset();
  respondWithAccount();
  identity.failWith = "Authorization page is empty";
  await assert.rejects(
    () => connectGoogleDriveBrowser(),
    (error: unknown) => {
      assert.ok(error instanceof DriveAuthError, "typed auth failure");
      assert.match(error.message, /浏览器托管授权不可用/);
      return true;
    },
    "a missing OAuth client (unpacked build) must surface the fallback",
  );
}

{
  reset();
  respondWithAccount();
  identity.failWith = "User canceled the authorization flow";
  await assert.rejects(
    () => connectGoogleDriveBrowser(),
    (error: unknown) => {
      assert.ok(error instanceof DriveAuthError);
      assert.match(error.message, /授权失败/);
      return true;
    },
  );
}

/* --------------------------------------------------------------------------
 * Disconnect revokes and forgets the session without touching cloud files.
 * ------------------------------------------------------------------------ */
{
  reset();
  respondWithAccount();
  await connectGoogleDriveBrowser();
  storage.set("gdriveFolderId", "folder-1");
  storage.set("gdriveFileIds", { "meta.json": "file-1" });

  await disconnectGoogleDrive();

  assert.deepEqual(
    identity.removedTokens,
    ["identity-access-token"],
    "cached browser token removed",
  );
  assert.equal(identity.clearedAll, 1, "all cached tokens cleared");
  assert.equal(
    fetchCalls.some((call) => call.url.includes("oauth2.googleapis.com/revoke")),
    true,
    "the session is revoked server-side",
  );
  assert.equal(storage.has("gdriveAuth"), false);
  assert.equal(storage.has("gdriveTokens"), false);
  assert.equal(storage.has("gdriveFolderId"), false, "account-scoped id cache cleared");
  assert.equal(storage.has("gdriveFileIds"), false);
  assert.equal(await gdriveConnected(), false);

  const after = await gdriveStatus();
  assert.equal(after.connected, false);
  assert.equal(after.auth, null);
  assert.equal(after.mode, "");
}

/* --------------------------------------------------------------------------
 * Manual fallback still works and is labelled as manual.
 * ------------------------------------------------------------------------ */
{
  reset();
  respondWithAccount("manual@example.com");
  fetchResponder = (call) => {
    if (call.url.includes("/about"))
      return {
        ok: true,
        status: 200,
        body: { user: { emailAddress: "manual@example.com", displayName: "M" } },
      };
    if (call.url.includes("oauth2.googleapis.com/token"))
      return {
        ok: true,
        status: 200,
        body: {
          access_token: "manual-access",
          refresh_token: "manual-refresh",
          expires_in: 3600,
        },
      };
    return { ok: true, status: 200, body: {} };
  };

  // launchWebAuthFlow must return an authorization code redirect.
  const chromeMock = (globalThis as unknown as { chrome: { identity: Record<string, unknown> } }).chrome;
  chromeMock.identity.launchWebAuthFlow = async (details: unknown) => {
    const requestUrl = new URL(
      String((details as { url?: unknown })?.url || "https://example.com/"),
    );
    const state = requestUrl.searchParams.get("state") || "";
    return `https://example.chromiumapp.org/?code=auth-code-123&state=${encodeURIComponent(state)}`;
  };

  const auth = await connectGoogleDriveManual("client-id-1", "secret-1");
  assert.equal(auth.mode, "manual");
  assert.equal(auth.email, "manual@example.com");
  assert.equal(await gdriveConnected(), true);

  const tokens = storage.get("gdriveTokens") as Record<string, unknown>;
  assert.equal(tokens.refresh_token, "manual-refresh");
  assert.equal(tokens.clientId, "client-id-1");

  // Manual mode refreshes through the token endpoint, not the Identity API.
  identity.getAuthTokenCalls.length = 0;
  storage.set("gdriveTokens", { ...tokens, access_token: "", expiry: 0 });
  const refreshed = await gdriveAccessToken();
  assert.equal(refreshed, "manual-access");
  assert.equal(identity.getAuthTokenCalls.length, 0);

  await assert.rejects(
    () => connectGoogleDriveManual(""),
    (error: unknown) => {
      assert.ok(error instanceof DriveAuthError);
      assert.match(error.message, /Client ID/);
      return true;
    },
  );

  // Disconnecting a manual session clears local credentials without the
  // Identity API cache calls.
  identity.removedTokens.length = 0;
  identity.clearedAll = 0;
  await disconnectGoogleDrive();
  assert.equal(identity.clearedAll, 0);
  assert.equal(storage.has("gdriveTokens"), false);
  assert.equal(await gdriveConnected(), false);
}

/* --------------------------------------------------------------------------
 * Reconnect after a revoked cached token does not need credentials again.
 * ------------------------------------------------------------------------ */
{
  reset();
  respondWithAccount();
  await connectGoogleDriveBrowser();
  await clearCachedDriveToken("identity-access-token");
  assert.deepEqual(identity.removedTokens, ["identity-access-token"]);

  identity.getAuthTokenCalls.length = 0;
  const auth = await connectGoogleDriveBrowser();
  assert.equal(auth.mode, "identity");
  assert.equal(
    identity.getAuthTokenCalls[0]?.interactive,
    true,
    "re-authorization goes through the browser account chooser again",
  );
  assert.equal(
    fetchCalls.some((call) => call.url.includes("oauth2.googleapis.com/token")),
    false,
    "still no manual credentials involved",
  );
}

/* --------------------------------------------------------------------------
 * The synchronization payload can never carry OAuth credentials.
 * ------------------------------------------------------------------------ */
{
  const legitimate = {
    "manifest.json": JSON.stringify({
      layout: "modular-v1",
      schemaVersion: 11,
      modules: [{ module: "tabs", file: "tabs.json" }],
    }),
    "meta.json": JSON.stringify({ revision: 3, tombstones: [] }),
    "bookmarks.json": JSON.stringify({
      module: "bookmarks",
      data: {
        bookmarks: [
          {
            syncId: "b1",
            title: "OAuth docs",
            // A credential-looking query string in ordinary synchronized data
            // must not be mistaken for a leaked credential.
            url: "https://example.com/callback?access_token=abc&code=xyz",
          },
        ],
      },
      tombstones: [],
    }),
  };
  assert.doesNotThrow(() => assertNoCredentialsInPayload(legitimate));
  assert.doesNotThrow(() =>
    assertNoCredentialsInPayload(JSON.parse(legitimate["bookmarks.json"])),
  );

  for (const [label, payload] of [
    ["access token", { access_token: "ya29.secret" }],
    ["refresh token", { refresh_token: "1//secret" }],
    ["client secret", { client_secret: "GOCSPX" }],
    ["client id", { client_id: "1234.apps.googleusercontent.com" }],
    ["stored token blob", { gdriveTokens: { refresh_token: "x" } }],
    ["auth state", { gdriveAuth: { mode: "identity" } }],
    ["nested credential", { snapshot: { bookmarks: [{ id_token: "x" }] } }],
    ["authorization header", { headers: { authorization: "Bearer x" } }],
  ] as Array<[string, unknown]>)
    assert.throws(
      () => assertNoCredentialsInPayload(payload),
      /授权凭据/,
      `${label} must be rejected`,
    );

  // Deeply nested and array-wrapped credentials are caught too.
  assert.throws(() =>
    assertNoCredentialsInPayload({
      a: { b: [{ c: { code_verifier: "x" } }] },
    }),
  );
  // A cyclic structure must not hang or blow the stack: the guard is depth
  // bounded, so it stops descending instead of following the cycle forever.
  const cyclic: Record<string, unknown> = { name: "x" };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => assertNoCredentialsInPayload(cyclic));
  // A credential sitting directly on a cyclic object is still caught.
  const cyclicLeak: Record<string, unknown> = { access_token: "ya29.secret" };
  cyclicLeak.self = cyclicLeak;
  assert.throws(() => assertNoCredentialsInPayload(cyclicLeak), /授权凭据/);
}

/* --------------------------------------------------------------------------
 * Credentials never reach a serialized payload key path.
 * ------------------------------------------------------------------------ */
{
  reset();
  respondWithAccount();
  await connectGoogleDriveBrowser();
  const auth = storage.get("gdriveAuth") as Record<string, unknown>;
  const forbidden = [
    "access_token",
    "refresh_token",
    "id_token",
    "client_secret",
    "client_id",
    "code_verifier",
  ];
  for (const key of forbidden)
    assert.equal(auth[key], undefined, `local auth state omits ${key}`);
  assert.deepEqual(Object.keys(auth).sort(), [
    "accountId",
    "connectedAt",
    "displayName",
    "email",
    "mode",
    "photoLink",
    "scope",
  ]);
}

console.log("gdrive-auth tests: OK");
