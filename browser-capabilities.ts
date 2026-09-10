export interface BrowserCapabilities {
  tabGroups: boolean;
  downloads: boolean;
  management: boolean;
  bookmarks: boolean;
  alarms: boolean;
  storage: boolean;
}

export function detectBrowserCapabilities(): BrowserCapabilities {
  const c = chrome as typeof chrome & Record<string, unknown>;
  return {
    tabGroups: !!c.tabGroups && typeof (c.tabGroups as { query?: unknown }).query === 'function',
    downloads: !!c.downloads && typeof (c.downloads as { download?: unknown }).download === 'function',
    management: !!c.management && typeof (c.management as { getAll?: unknown }).getAll === 'function',
    bookmarks: !!c.bookmarks && typeof (c.bookmarks as { getTree?: unknown }).getTree === 'function',
    alarms: !!c.alarms && typeof (c.alarms as { create?: unknown }).create === 'function',
    storage: !!c.storage && !!c.storage.local,
  };
}
