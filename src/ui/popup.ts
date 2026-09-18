const { request, storageGet, bindAction } = CCSyncRuntime;
const i = CCSyncI18n;
const $ = (id) => document.getElementById(id);

const ui = {
  icon: $("statusIcon"),
  title: $("statusTitle"),
  meta: $("statusMeta"),
  rev: $("revision"),
  missing: $("missing"),
  lang: $("language"),
  theme: $("theme"),
  detail: $("statusDetail"),
};

function iconFor(state) {
  const map = {
    ok: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
    warn: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3z"/><path d="M12 9v4M12 17h.01"/></svg>',
    bad: '<svg class="icon-xl" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    idle: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M18 3v5h-5"/></svg>',
  };
  return map[state] || map.idle;
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function setStatus(state, title, meta = "", detail = "") {
  ui.icon.className = `status-icon ${state}`;
  ui.icon.innerHTML = iconFor(state);
  ui.title.textContent = title;
  ui.meta.textContent = meta;
  // Force real line breaks for the compact popup status metadata.
  ui.meta.style.setProperty("white-space", "pre-line", "important");
  if (ui.detail) {
    ui.detail.hidden = !detail;
    ui.detail.textContent = detail || "";
  }
}

function setError(error) {
  const message = error?.message || String(error);
  setStatus("bad", i.t("actionFailed"), message, message);
}

async function refresh() {
  try {
    const r = await request("status");
    const names = { gist: i.t("providerGist"), gdrive: i.t("providerGdrive"), webdav: i.t("providerWebdav") };
    const providerName = names[r.provider] || r.provider || i.t("unknown");
    const state = r.bound ? "ok" : "warn";
    const title = r.bound ? i.t("ready") : i.t("provider") + ": " + providerName + " · " + i.t("notConfigured");
    const meta = [i.t("provider") + ": " + providerName, r.lastSyncAt ? i.t("lastSync") + " " + new Date(r.lastSyncAt).toLocaleString() : "", i.t("autoSyncStatus") + ": " + (r.autoSyncEnabled ? i.t("enabled") : i.t("disabled"))].filter(Boolean).join("\n");
    setStatus(state, title, meta, "");
    ui.rev.textContent = i.t("revision") + " " + (r.syncRevision ?? 0) + " · " + i.t("conflictsLabel") + " " + (r.conflictCount ?? 0);
    void renderCloudGroups();
  } catch (error) { setError(error); }
}
async function withButton(button, work) {
  if (!button || button.disabled) return;
  const old = button.innerHTML;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    await work();
  } catch (error) {
    setError(error);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = old;
  }
}

function createPopupCloudTabRow(tab) {
  const row = document.createElement("div");
  row.className = "popup-cloud-tab";

  const title = document.createElement("div");
  title.className = "popup-cloud-tab-title";
  title.textContent = tab.title || tab.url || "";

  const url = document.createElement("div");
  url.className = "popup-cloud-tab-url";
  url.textContent = tab.url || "";
  url.hidden = !tab.url;

  row.append(title, url);
  return row;
}

async function renderCloudGroups() {
  const card = $("cloudGroupsCard");
  const list = $("cloudGroups");

  if (!card || !list) return;

  card.hidden = false;
  list.innerHTML =
    `<div class="empty">${escapeHtml(i.t("loading"))}</div>`;

  try {
    const groups = await request("cloudGroups");

    if (!groups.length) {
      list.innerHTML =
        `<div class="empty">${escapeHtml(i.t("cloudGroupsEmpty"))}</div>`;
      return;
    }

    list.replaceChildren();

    for (const g of groups) {
      const tabs = Array.isArray(g.tabs) ? g.tabs : [];
      const details = document.createElement("details");
      details.className = "popup-cloud-group";
      details.open = false;

      const summary = document.createElement("summary");
      summary.className = "popup-cloud-group-summary";

      const main = document.createElement("div");
      main.className = "history-main";

      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = g.title || i.t("unnamedGroup");

      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = i.t("groupTabCount", {
        count: g.tabCount ?? tabs.length,
      });

      main.append(title, meta);

      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "secondary";
      restore.textContent = i.t("restoreGroup");
      restore.disabled = tabs.length === 0;

      restore.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        void withButton(restore, async () => {
          const r = await request("restoreGroup", {
            groupSyncId: g.syncId,
          });

          setStatus(
            "ok",
            i.t("groupRestoreDone"),
            i.t("restoreSummary", {
              tabs: r.tabs,
              groups: r.groups,
            }),
            "",
          );
        });
      });

      const indicator = document.createElement("span");
      indicator.className = "cloud-disclosure-indicator";
      indicator.setAttribute("aria-hidden", "true");
      indicator.textContent = "›";

      summary.append(main, restore, indicator);

      const content = document.createElement("div");
      content.className = "popup-cloud-group-content";

      if (!tabs.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = i.t("cloudGroupEmpty");
        content.append(empty);
      } else {
        const tabList = document.createElement("div");
        tabList.className = "popup-cloud-tab-list";

        for (const tab of tabs)
          tabList.append(createPopupCloudTabRow(tab));

        content.append(tabList);
      }

      details.append(summary, content);
      list.append(details);
    }
  } catch (error) {
    list.innerHTML =
      `<div class="empty error-copy">${escapeHtml(error?.message || String(error))}</div>`;
  }
}

bindAction("sync", async (_event, button) =>
  withButton(button, async () => {
    button.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-3.8L3 10"/><path d="M3 5v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.8L21 14"/><path d="M21 19v-5h-5"/></svg><span>${i.t("syncing")}</span>`;
    const r = await request("sync");
    if (!r || r.ok === false)
      throw new Error(r?.error || "Sync returned no result");
    setStatus(
      "ok",
      `${i.t("syncDone")} · ${i.t("revision")} ${r.revision}`,
      i.t("syncedSummary", {
        tabs: r.tabCount,
        groups: r.groupCount,
        bookmarks: r.bookmarkCount,
        extensions: r.extensionCount,
      }),
      i.t("syncCompletedDetail", {
        revision: r.revision,
        conflicts: r.conflicts ?? 0,
      }),
    );
    await refresh();
  }),
);

bindAction("restore", async (_event, button) =>
  withButton(button, async () => {
    const s = await request("pull");
    const r = await request("restoreTabs", {
      windows: s.windows || [],
      restoreGroupMode: "ondemand",
    });
    setStatus(
      "ok",
      i.t("tabsRestoreDone"),
      i.t("restoreSummaryDeferred", { tabs: r.tabs, groups: r.groups }),
      i.t("restoreCompletedDetail"),
    );
  }),
);
bindAction("restoreBookmarks", async (_event, button) =>
  withButton(button, async () => {
    const s = await request("pull");
    const r = await request("restoreBookmarks", {
      bookmarks: s.bookmarks || [],
    });
    setStatus(
      "ok",
      i.t("bookmarksRestoreDone"),
      i.t("bookmarkSummary", {
        added: r.added,
        moved: r.moved,
        updated: r.updated,
      }),
      i.t("bookmarkCompletedDetail"),
    );
  }),
);

bindAction("checkExtensions", async (_event, button) =>
  withButton(button, async () => {
    ui.missing.innerHTML = `<div class="empty">${i.t("loading")}</div>`;
    const r = await request("missingExtensions");
    if (r.remoteUnavailable) {
      const message =
        r.errorCode === "GIST_NOT_BOUND"
          ? i.t("remoteExtNeedGist")
          : `${i.t("remoteExtUnavailable")} ${r.errorMessage || ""}`;
      ui.missing.innerHTML = `<div class="empty error-copy">${escapeHtml(message)}</div>`;
      setStatus("bad", i.t("checkFailed"), message, "");
      return;
    }
    if (!r.missing.length) {
      ui.missing.innerHTML = `<div class="empty success-copy"><strong>${i.t("noMissing")}</strong><br><span>${i.t("checkedCloudExtensions", { count: r.remote.length })}</span></div>`;
      setStatus(
        "ok",
        i.t("extensionsReady"),
        i.t("checkedCloudExtensions", { count: r.remote.length }),
        i.t("allExtensionsInstalled"),
      );
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.innerHTML = `<div class="section-label">${escapeHtml(i.t("missingCount", { count: r.missing.length }))}</div>`;
    for (const ext of r.missing) {
      const row = document.createElement("div");
      row.className = "history-row";
      const main = document.createElement("div");
      main.className = "history-main";
      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = ext.name || ext.id;
      const meta = document.createElement("div");
      meta.className = "history-meta";
      meta.textContent = ext.id;
      main.append(title, meta);
      const a = document.createElement("a");
      const edgeHost = /Edg\//.test(navigator.userAgent);
      const useEdge = ext.store?.source === "edge" && edgeHost;
      a.href = useEdge
        ? ext.store.edgeUrl
        : ext.store?.source === "chrome"
          ? ext.store.chromeUrl
          : ext.store?.crxsosoUrl || ext.store.chromeUrl;
      a.textContent =
        useEdge || ext.store?.source === "chrome"
          ? i.t("openInstall")
          : i.t("searchCrxsoso");
      a.target = "_blank";
      a.rel = "noreferrer";
      a.className = "secondary";
      a.textContent = i.t("openInstall");
      row.append(main, a);
      wrap.append(row);
    }
    ui.missing.replaceChildren(wrap);
    setStatus(
      "warn",
      i.t("missingFound", { count: r.missing.length }),
      i.t("checkedCloudExtensions", { count: r.remote.length }),
      i.t("installMissingHint"),
    );
  }),
);
bindAction("history", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }),
);
bindAction("options", () => chrome.runtime.openOptionsPage());
bindAction("guide", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") }),
);

function setupChoiceSwitch(root, initialValue, onChange) {
  if (!root) return;
  const buttons = [...root.querySelectorAll(".choice-switch-option")];
  const set = (value) => {
    root.dataset.active = value === "en" || value === "dark" ? "right" : "left";
    for (const b of buttons)
      b.setAttribute("aria-pressed", String(b.dataset.value === value));
  };
  set(initialValue);
  for (const b of buttons)
    b.addEventListener("click", async () => {
      const value = b.dataset.value;
      try {
        await onChange(value);
        set(value);
      } catch (error) {
        console.error(error);
      }
    });
}

(async () => {
  try {
    await i.initAndApply();
    const s = await storageGet(["language"]);
    if (ui.lang) {
      const lv =
        s.language && s.language !== "auto" ? s.language : i.currentLanguage();
      setupChoiceSwitch(ui.lang, lv, async (v) => {
        await i.setLanguage(v);
        await refresh();
      });
    }
    await CCSyncTheme.initTheme();
    if (ui.theme) {
      const tm = await CCSyncTheme.getTheme();
      const tv =
        tm === "dark" || tm === "light"
          ? tm
          : document.documentElement.dataset.theme || "light";
      setupChoiceSwitch(ui.theme, tv, async (v) => CCSyncTheme.setTheme(v));
    }
    await refresh();
  } catch (error) {
    setError(error);
  }
})();
