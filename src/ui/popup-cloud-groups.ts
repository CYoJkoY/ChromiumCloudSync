(() => {
  const i = CCSyncI18n;
  const { request } = CCSyncRuntime;
  const $ = (id) => document.getElementById(id);
  const status = window.CCSyncPopupStatus;

  let card;

  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
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

  function cloudStateMetaText(payload) {
    const providerNames = {
      gist: i.t("providerGist"),
      gdrive: i.t("providerGdrive"),
      webdav: i.t("providerWebdav"),
    };
    const provider =
      providerNames[payload.provider] || payload.provider || i.t("unknown");
    const counts = payload.counts || {};
    const lines = [];
    if (payload.stale) lines.push(i.t("cloudStateStale"));
    lines.push(
      payload.source === "cache"
        ? i.t("cloudStateSourceCache")
        : i.t("cloudStateSourceRemote"),
    );
    lines.push(`${i.t("provider")}: ${provider}`);
    lines.push(`${i.t("revision")} ${payload.revision ?? 0}`);
    lines.push(
      i.t("cloudStateSummary", {
        groups: counts.groups ?? 0,
        tabs: counts.tabs ?? 0,
      }),
    );
    if (payload.fetchedAt) {
      try {
        lines.push(
          `${i.t("cloudStateFetchedAt")} ${new Date(payload.fetchedAt).toLocaleString()}`,
        );
      } catch {
        /* keep the remaining metadata */
      }
    }
    return lines.join("\n");
  }

  function renderCloudStateMeta(payload) {
    const meta = $("cloudGroupsMeta");
    if (!meta) return;
    meta.hidden = false;
    meta.textContent = cloudStateMetaText(payload);
    meta.classList.toggle("cloud-state-meta-stale", payload.stale === true);
    if (payload.warning)
      meta.textContent += `\n${i.t("cloudStateWarning")}: ${payload.warning}`;
  }

  async function renderCloudGroups(forceRemote = false) {
    if (!card || !listEl()) return;

    card.hidden = false;
    const list = listEl();
    list.innerHTML = `<div class="empty">${escapeHtml(i.t("loading"))}</div>`;

    try {
      const result = await request("cloudGroups", {
        forceRemote: forceRemote === true,
      });
      const payload = Array.isArray(result)
        ? { groups: result, counts: {}, source: "remote", revision: 0 }
        : result || { groups: [] };
      const groups = Array.isArray(payload.groups) ? payload.groups : [];

      renderCloudStateMeta(payload);

      if (!groups.length) {
        list.innerHTML = `<div class="empty">${escapeHtml(i.t("cloudGroupsEmpty"))}</div>`;
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

          void status.withButton(restore, async () => {
            const r = await request("restoreGroup", {
              groupSyncId: g.syncId,
            });

            status.setStatus(
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

        summary.append(main, indicator);

        const content = document.createElement("div");
        content.className = "popup-cloud-group-content";

        const actions = document.createElement("div");
        actions.className = "popup-cloud-group-actions";
        actions.append(restore);

        if (!tabs.length) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = i.t("cloudGroupEmpty");
          content.append(actions, empty);
        } else {
          const tabList = document.createElement("div");
          tabList.className = "popup-cloud-tab-list";

          for (const tab of tabs) tabList.append(createPopupCloudTabRow(tab));

          content.append(actions, tabList);
        }

        details.append(summary, content);
        list.append(details);
      }
    } catch (error) {
      list.innerHTML = `<div class="empty error-copy">${escapeHtml(error?.message || String(error))}</div>`;
    }
  }

  function listEl() {
    return document.getElementById("cloudGroups");
  }

  function observe() {
    card = $("cloudGroupsCard");
    if (!card) return;
    card.addEventListener("toggle", () => {
      if (card.open) void renderCloudGroups();
    });
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "cloudTabStateChanged") return;
      if (card.open) void renderCloudGroups();
    });
  }

  window.CCSyncPopupCloudGroups = {
    renderCloudGroups,
    cloudStateMetaText,
    renderCloudStateMeta,
    observe,
  };
})();
