export interface BrowserCapabilities {
  tabGroups: boolean;
  downloads: boolean;
  management: boolean;
  bookmarks: boolean;
  alarms: boolean;
  storage: boolean;
  identity: boolean;
  /**
   * Browser-managed OAuth is available.
   *
   * `chrome.identity.getAuthToken` mints a token from the extension's own OAuth
   * client and drives Chromium's account chooser, which is the normal
   * user-facing authorization flow. It is unavailable in some hosts and in
   * unpacked development builds that have no registered OAuth client, so the
   * manual client-configuration path must remain as an explicit fallback.
   */
  identityGetAuthToken: boolean;
  identityWebAuthFlow: boolean;
  identityAccounts: boolean;
  identityTokenCache: boolean;
}

function hasFunction(
  value: unknown,
  name: string,
): boolean {
  return (
    !!value &&
    typeof (value as Record<string, unknown>)[name] === "function"
  );
}

export function detectBrowserCapabilities(): BrowserCapabilities {
  const c = chrome as typeof chrome & Record<string, unknown>;
  const identity = c.identity;
  return {
    tabGroups:
      !!c.tabGroups &&
      typeof (c.tabGroups as { query?: unknown }).query === "function",
    downloads:
      !!c.downloads &&
      typeof (c.downloads as { download?: unknown }).download === "function",
    management:
      !!c.management &&
      typeof (c.management as { getAll?: unknown }).getAll === "function",
    bookmarks:
      !!c.bookmarks &&
      typeof (c.bookmarks as { getTree?: unknown }).getTree === "function",
    alarms:
      !!c.alarms &&
      typeof (c.alarms as { create?: unknown }).create === "function",
    storage: !!c.storage && !!c.storage.local,
    identity: hasFunction(identity, "getRedirectURL"),
    identityGetAuthToken: hasFunction(identity, "getAuthToken"),
    identityWebAuthFlow: hasFunction(identity, "launchWebAuthFlow"),
    identityAccounts: hasFunction(identity, "getAccounts"),
    identityTokenCache:
      hasFunction(identity, "removeCachedAuthToken") &&
      hasFunction(identity, "clearAllCachedAuthTokens"),
  };
}
