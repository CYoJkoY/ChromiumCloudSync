const i = CCSyncI18n;
const theme = CCSyncTheme;
const { request, storageGet, storageSet, bindAction } = CCSyncRuntime;
const $ = (id) => document.getElementById(id),
  tokenEl = $("token"),
  gistEl = $("gist"),
  statusEl = $("status"),
  autoSyncEnabledEl = $("autoSyncEnabled"),
  syncIntervalEl = $("syncInterval"),
  appVersionEl = $("appVersion");
const providerEl = $("provider"),
  gdriveCard = $("gdriveCard"),
  webdavCard = $("webdavCard"),
  restoreModeEl = $("restoreGroupMode");

function toggleProvider() {
  const v = providerEl?.value || "gist";
  if (gdriveCard) {
    gdriveCard.hidden = v !== "gdrive";
    gdriveCard.classList.toggle("ccsync-ext-hidden", v !== "gdrive");
  }
  if (webdavCard) {
    webdavCard.hidden = v !== "webdav";
    webdavCard.classList.toggle("ccsync-ext-hidden", v !== "webdav");
  }
  const gh = v === "gist";
  for (const el of [
    $("token")?.closest(".sync-field-group"),
    $("gist")?.closest(".sync-field-group"),
    $("create"),
    $("save"),
  ])
    if (el) {
      el.hidden = !gh;
      el.classList.toggle("ccsync-ext-hidden", !gh);
    }
}
providerEl?.addEventListener("change", async () => {
  toggleProvider();
  try {
    await request("setProvider", { provider: providerEl.value });
    showFeedback("success", i.t("providerSaved"), providerEl.value);
  } catch (e) {
    showError(e);
  }
});
$("gdriveConnect")?.addEventListener("click", async () => {
  try {
    await request("connectGdrive", {
      clientId: $("gdriveClientId")?.value || "",
      clientSecret: $("gdriveClientSecret")?.value || "",
    });
    showFeedback("success", i.t("gdriveConnected"), "");
    await refresh();
  } catch (e) {
    showError(e);
  }
});
$("gdriveDisconnect")?.addEventListener("click", async () => {
  try {
    await request("disconnectGdrive");
    showFeedback("success", i.t("gdriveDisconnected"), "");
    await refresh();
  } catch (e) {
    showError(e);
  }
});
$("webdavSave")?.addEventListener("click", async () => {
  try {
    await request("saveWebdav", {
      url: $("webdavSyncUrl")?.value || "",
      folder: $("webdavSyncFolder")?.value || "",
      user: $("webdavSyncUsername")?.value || "",
      pass: $("webdavSyncPassword")?.value || "",
    });
    showFeedback("success", i.t("providerSaved"), "WebDAV");
    await refresh();
  } catch (e) {
    showError(e);
  }
});
for (const id of ["providerTest", "webdavTest"])
  $(id)?.addEventListener("click", async () => {
    try {
      await request("testProvider");
      showFeedback("success", i.t("connectionOk"), "");
    } catch (e) {
      showError(e);
    }
  });
$("saveRestoreMode")?.addEventListener("click", async () => {
  try {
    await request("setRestoreGroupMode", {
      mode: restoreModeEl?.value || "ondemand",
    });
    showFeedback("success", i.t("restoreModeSaved"), "");
  } catch (e) {
    showError(e);
  }
});
async function loadProvider() {
  const r = await request("providerStatus");
  if (providerEl) providerEl.value = r.provider;
  if (restoreModeEl) restoreModeEl.value = r.restoreGroupMode || "ondemand";
  const w = await storageGet([
    "webdavSyncUrl",
    "webdavSyncFolder",
    "webdavSyncUsername",
    "webdavSyncPassword",
  ]);
  if ($("webdavSyncUrl")) $("webdavSyncUrl").value = w.webdavSyncUrl || "";
  if ($("webdavSyncFolder"))
    $("webdavSyncFolder").value = w.webdavSyncFolder || "";
  if ($("webdavSyncUsername"))
    $("webdavSyncUsername").value = w.webdavSyncUsername || "";
  if ($("webdavSyncPassword"))
    $("webdavSyncPassword").value = w.webdavSyncPassword || "";
  toggleProvider();
}
function renderVersion() {
  if (!appVersionEl) return;
  const version = chrome.runtime.getManifest()?.version || "";
  appVersionEl.textContent = version ? `v${version}` : "v—";
}
function setStatus(m) {
  if (statusEl) statusEl.textContent = m;
}
function showFeedback(k, t, d = "") {
  const b = $("actionFeedback");
  if (!b) return;
  b.hidden = false;
  b.className = `action-feedback ${k}`;
  const te = b.querySelector(".action-feedback-title"),
    de = b.querySelector(".action-feedback-detail");
  if (te) te.textContent = t;
  if (de) {
    de.textContent = d;
    de.hidden = !d;
  }
}
function showError(e) {
  const m = e?.message || String(e);
  setStatus(`${i.t("operationFailed")}: ${m}`);
  showFeedback("error", i.t("operationFailed"), m);
}
function refreshIntervalLabels() {
  if (!syncIntervalEl) return;
  const suffix = i.currentLanguage() === "zh-CN" ? "分钟" : "min";
  for (const option of syncIntervalEl.options)
    option.textContent = `${option.value} ${suffix}`;
}
async function refresh() {
  try {
    const r = await request("status");
    setStatus(
      [
        r.authenticated
          ? `${i.t("token")}: ${i.t("tokenConfigured")}`
          : `${i.t("token")}: ${i.t("tokenNotConfigured")}`,
        r.gistConfigured ? `Gist: ${r.gistId}` : `Gist: ${i.t("gistNotBound")}`,
        r.lastSyncAt
          ? `${i.t("lastSync")} ${new Date(r.lastSyncAt).toLocaleString()}`
          : `${i.t("lastSync")} ${i.t("never")}`,
        `${i.t("revision")}: ${r.syncRevision ?? 0}`,
        `${i.t("conflictsLabel")}: ${r.conflictCount ?? 0}`,
        `${i.t("autoSyncStatus")}: ${r.autoSyncEnabled ? i.t("enabled") : i.t("disabled")} · ${r.autoSyncIntervalMinutes ?? 5} min`,
      ].join("\n"),
    );
  } catch (e) {
    showError(e);
  }
}
async function load() {
  try {
    renderVersion();
    const s = await storageGet(["githubToken", "gistId"]);
    if (s.githubToken) tokenEl.value = s.githubToken;
    if (s.gistId) gistEl.value = s.gistId;
    const c = await request("getAutoSyncSettings");
    if (autoSyncEnabledEl) autoSyncEnabledEl.checked = !!c.enabled;
    if (syncIntervalEl) syncIntervalEl.value = String(c.intervalMinutes || 5);
    refreshIntervalLabels();
    await refresh();
  } catch (e) {
    showError(e);
  }
}
function normalizeGistId(v) {
  const r = (v || "").trim();
  if (!r) return "";
  const m = r.match(/gist\.github\.com\/(?:[^/]+\/)?([a-f0-9]+)(?:[/?#].*)?$/i);
  return m ? m[1] : r;
}
bindAction("validate", async (_e, b) => {
  const t = String(tokenEl?.value || "").trim();
  const p = String(providerEl?.value || "gist");
  if (p === "gist" && !t) throw Error(i.t("needsToken"));
  const o = b.textContent;
  b.disabled = true;
  b.textContent = i.t("processing");
  try {
    const r = await request("validateToken", { token: t });
    await storageSet({ githubToken: t });
    showFeedback(
      "success",
      i.t("tokenValid"),
      r.login ? `@${r.login}` : "GitHub authenticated",
    );
    await refresh();
  } finally {
    b.disabled = false;
    b.textContent = o;
  }
});
bindAction("save", async (_e, b) => {
  const t = tokenEl.value.trim(),
    g = normalizeGistId(gistEl.value);
  const p = String(providerEl?.value || "gist");
  if (p === "gist" && !t) throw Error(i.t("needsToken"));
  if (!g) throw Error(i.t("gistRequired"));
  const o = b.textContent;
  b.disabled = true;
  b.textContent = i.t("processing");
  try {
    const r = await request("configureGist", { gistId: g, token: t });
    gistEl.value = r.gistId || g;
    await storageSet({ githubToken: t });
    showFeedback("success", i.t("bindGist"), `Gist: ${r.gistId || g}`);
    await refresh();
  } finally {
    b.disabled = false;
    b.textContent = o;
  }
});
bindAction("create", async (_e, b) => {
  const t = tokenEl.value.trim();
  const p = String(providerEl?.value || "gist");
  if (p === "gist" && !t) throw Error(i.t("needsToken"));
  await storageSet({ githubToken: t });
  const o = b.textContent;
  b.disabled = true;
  b.textContent = i.t("processing");
  try {
    const r = await request("createGist");
    gistEl.value = r.id;
    await storageSet({ gistId: r.id });
    showFeedback("success", i.t("createGist"), `Gist: ${r.id}`);
    await refresh();
  } finally {
    b.disabled = false;
    b.textContent = o;
  }
});
bindAction("syncNowButton", async (_e, b) => {
  const o = b.textContent;
  b.disabled = true;
  b.textContent = i.t("syncing");
  try {
    const r = await request("sync");
    setStatus(`${i.t("syncDone")} · ${i.t("revision")} ${r.revision}`);
    showFeedback(
      "success",
      i.t("syncDone"),
      `${i.t("revision")} ${r.revision}`,
    );
    await refresh();
  } finally {
    b.disabled = false;
    b.textContent = o;
  }
});
bindAction("saveAutoSync", async (_e, b) => {
  const en = !!autoSyncEnabledEl?.checked,
    im = Number(syncIntervalEl?.value || 5),
    o = b.textContent;
  b.disabled = true;
  b.textContent = i.t("processing");
  try {
    const r = await request("setAutoSyncSettings", {
      enabled: en,
      intervalMinutes: im,
    });
    autoSyncEnabledEl.checked = r.enabled;
    syncIntervalEl.value = String(r.intervalMinutes);
    refreshIntervalLabels();
    showFeedback(
      "success",
      i.t("autoSyncSaved"),
      r.enabled
        ? i.t("autoSyncSavedEnabled", { minutes: r.intervalMinutes })
        : i.t("autoSyncSavedDisabled", { minutes: r.intervalMinutes }),
    );
    await refresh();
  } finally {
    b.disabled = false;
    b.textContent = o;
  }
});
bindAction("historyPage", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("history.html") }),
);
bindAction("guidePage", () =>
  chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") }),
);
function setupTabs() {
  const tabs = [...document.querySelectorAll(".nav-tab")],
    panels = [...document.querySelectorAll(".tab-panel")],
    act = (id, hash = true) => {
      const t = tabs.find((x) => x.dataset.target === id) || tabs[0];
      if (!t) return;
      for (const x of tabs) {
        const a = x === t;
        x.classList.toggle("active", a);
        x.setAttribute("aria-selected", String(a));
        x.tabIndex = a ? 0 : -1;
      }
      for (const p of panels)
        p.classList.toggle("hidden", p.id !== t.dataset.target);
      if (hash) history.replaceState(null, "", `#${id.replace(/^panel-/, "")}`);
    };
  for (const t of tabs) {
    t.addEventListener("click", () => act(t.dataset.target));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const n = tabs[(tabs.indexOf(t) + 1) % tabs.length];
        n.focus();
        act(n.dataset.target);
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const p = tabs[(tabs.indexOf(t) - 1 + tabs.length) % tabs.length];
        p.focus();
        act(p.dataset.target);
      }
    });
  }
  const k = location.hash.replace(/^#/, "");
  act(
    ["sync", "extension", "local"].includes(k) ? `panel-${k}` : "panel-sync",
    false,
  );
}
window.addEventListener("ccsync:action-error", (e) =>
  showError(e.detail?.error),
);
function setupChoiceSwitch(root, initialValue, onChange, resolveValue) {
  if (!root) return;
  const buttons = [...root.querySelectorAll(".choice-switch-option")];
  const set = (value) => {
    const v = resolveValue ? resolveValue(value) : value;
    root.dataset.active = v === "en" || v === "dark" ? "right" : "left";
    for (const b of buttons) {
      const active = b.dataset.value === v;
      b.setAttribute("aria-pressed", String(active));
      b.setAttribute("aria-checked", String(active));
    }
  };
  set(initialValue);
  for (const b of buttons)
    b.addEventListener("click", async () => {
      const v = b.dataset.value;
      try {
        await onChange(v);
        set(v);
        refreshIntervalLabels();
        window.CCSyncExtensionStorage?.refreshLanguage?.();
      } catch (e) {
        showError(e);
      }
    });
}
async function setupPreferences() {
  await i.initAndApply();
  const s = await storageGet(["language"]);
  const l = $("language");
  if (l) {
    const stored = s.language || "auto";
    const visual = i.currentLanguage
      ? i.currentLanguage()
      : stored === "zh-CN" || stored === "en"
        ? stored
        : /^zh/i.test(navigator.language || "")
          ? "zh-CN"
          : "en";
    setupChoiceSwitch(l, visual, async (v) => {
      await i.setLanguage(v);
      await refresh();
    });
  }
  await theme.initTheme();
  const th = $("theme");
  if (th) {
    const stored = await theme.getTheme();
    const visual = document.documentElement.dataset.theme || "light";
    setupChoiceSwitch(
      th,
      stored === "dark" || stored === "light" ? stored : visual,
      async (v) => theme.setTheme(v),
    );
  }
}
(async () => {
  try {
    setupTabs();
    await setupPreferences();
    await load();
  } catch (e) {
    showError(e);
  }
})();
