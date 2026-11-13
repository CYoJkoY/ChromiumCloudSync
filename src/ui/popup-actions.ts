(() => {
  const i = CCSyncI18n;
  const { request, bindAction } = CCSyncRuntime;
  const status = window.CCSyncPopupStatus;
  const cloud = window.CCSyncPopupCloudGroups;

  function mount({ statusRefresh }) {
    bindAction("sync", async (_event, button) =>
      status.withButton(button, async () => {
        button.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-3.8L3 10"/><path d="M3 5v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.8L21 14"/><path d="M21 19v-5h-5"/></svg><span>${i.t("syncing")}</span>`;
        const r = await request("sync");
        if (!r || r.ok === false)
          throw new Error(r?.error || "Sync returned no result");
        status.setStatus(
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
        await statusRefresh();
      }),
    );

    bindAction("restore", async (_event, button) =>
      status.withButton(button, async () => {
        const s = await request("pull");
        const r = await request("restoreTabs", {
          windows: s.windows || [],
          restoreGroupMode: "ondemand",
        });
        status.setStatus(
          "ok",
          i.t("tabsRestoreDone"),
          i.t("restoreSummaryDeferred", { tabs: r.tabs, groups: r.groups }),
          i.t("restoreCompletedDetail"),
        );
      }),
    );

    bindAction("restoreBookmarks", async (_event, button) =>
      status.withButton(button, async () => {
        const s = await request("pull");
        const r = await request("restoreBookmarks", {
          bookmarks: s.bookmarks || [],
        });
        status.setStatus(
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

    bindAction("refreshCloudGroups", async (_event, button) =>
      status.withButton(button, async () => {
        await cloud.renderCloudGroups(true);
        status.setStatus("ok", i.t("cloudRefreshDone"), i.t("cloudStateSourceRemote"), "");
      }),
    );
  }

  window.CCSyncPopupActions = { mount };
})();
