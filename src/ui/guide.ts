const DICT = {
  en: {
    title: "User Guide",
    subtitle: "A local-first Chromium sync tool that supports GitHub Gist, Google Drive, and WebDAV.",
    quickTitle: "Quick start",
    quickBody:
      "Open Settings → Sync and select a storage provider. GitHub Gist uses a GitHub Token and a compatible Gist ID; leave the Gist ID blank to create a new private sync Gist. Google Drive uses OAuth authorization. WebDAV uses the configured server URL, folder, and optional credentials. After the backend is ready, use Sync now or enable automatic synchronization.",
    popupTitle: "Popup overview",
    popupBody:
      "The Popup shows the active storage provider, synchronization status, last successful sync time, automatic-sync status, revision and conflict counts, and quick actions. User Guide and Settings are available at the top. The Tabs restore action handles ungrouped tabs, while cloud tab groups use their separate Restore action.",
    storageTitle: "What is synchronized",
    storageBody:
      "The cloud snapshot contains browser-state data: open windows and HTTP(S) tabs, tab groups, bookmarks, and installed third-party extension metadata. Extension metadata is used to detect missing extensions; it does not contain third-party extension settings.",
    storageNote:
      "Third-party extension settings are intentionally outside the synchronization scope. Supported persistent data uses the separate Full extension backup flow and optional native helper.",
    providerTitle: "Storage providers",
    providerBody:
      "GitHub Gist, Google Drive, and WebDAV are supported storage backends. The selected backend stores the synchronized browser-state snapshot; provider credentials remain local to the browser.",
    restoreTitle: "Restore behavior",
    restoreBody:
      "The Popup's Tabs action restores ungrouped HTTP(S) tabs and does not automatically create or restore tab groups. Use the separate Restore action on a cloud tab group to restore its restorable tabs in a new browser window and apply the group's metadata.",
    cloudTabsTitle: "Cloud tabs",
    cloudTabsBody:
      "Settings → Cloud tabs is available in Incremental mode. It provides a flat view of cloud tab groups and their member tabs. Add current browser tab groups to cloud merges the current groups and member tabs into the persistent cloud collection; it does not replace the browser's current state.",
    syncTitle: "Sync model",
    syncBody:
      "The sync engine keeps a local base snapshot and performs a three-way merge between base, local, and remote state. Stable synchronization IDs are used for tabs, windows, tab groups, and bookmarks. Deletions are represented by tombstones so stale devices do not silently recreate removed items. Conflicting field changes remain visible as conflicts instead of being silently discarded.",
    autoTitle: "Automatic sync",
    autoBody:
      "Automatic synchronization is disabled by default and uses a five-minute interval by default. In Settings you can enable it and select an interval. Browser events are debounced before a background synchronization is started.",
    extensionTitle: "Extension inventory",
    extensionBody:
      "The Extensions feature records third-party extension metadata such as ID, name, version, enabled state, installation type, update information, and store links. When another browser is missing an extension present in the cloud inventory, the Extension Recovery Center lists it for recovery.",
    recoveryTitle: "Extension Recovery Center",
    recoveryBody:
      "Use the Extension Recovery Center to review extensions that exist in the cloud inventory but are not installed locally. When a verified Chrome Web Store or Microsoft Edge Add-ons link is available, the page provides a direct installation link. Installation itself remains a manual browser action.",
    packageTitle: "Full extension backup",
    packageBody:
      "Open Settings > Full extension backup. Save the independent cloud destination, connect the optional native helper, select the matching Profile and extension IDs, and choose the data categories. Preview, schedule, and quit all Chromium browsers. The helper resolves user roots at runtime and archives Profile-relative paths; ready archives upload on next start. Download verifies chunks and the archive before a separate restore confirmation. Close browsers to replace selected scopes; originals remain available for rollback. Database restore requires the same OS, browser family and major version. Passwords, cookies, Preferences, caches, temporary files, OPFS/storage buckets and unknown database layouts are excluded. Program files do not install an extension. The legacy CRX/ZIP workflow remains below the cloud destination settings.",
    historyTitle: "History and rollback",
    historyBody:
      "History depends on the selected provider: GitHub Gist and Google Drive keep provider-native revisions. WebDAV stores current state only, and the extension does not create application-managed archives.",
    settingsTitle: "Settings workflow",
    settingsBody:
      "Settings is organized by synchronization function. The Sync panel selects GitHub Gist, Google Drive, or WebDAV and exposes the backend-specific connection controls. GitHub Gist uses one Gist ID field: enter a compatible ID to use it, or leave it blank to create a new synchronization Gist. Google Drive uses OAuth. WebDAV uses the configured URL, folder, and optional username/password. The same panel contains automatic-sync controls, restore behavior, and the tab synchronization mode. Settings → Cloud tabs provides hierarchical cloud-tab management in Incremental mode.",
    privacyTitle: "Privacy and security",
    privacyBody:
      "New sync Gists created by the extension are private. The current synchronization payload is normal JSON in the Gist and is not end-to-end encrypted. Treat access to the private Gist as access to the synchronized browser data. For package backups, use a private GitHub repository or a trusted WebDAV server and a least-privilege credential.",
    troubleTitle: "Troubleshooting",
    troubleBody:
      "If synchronization fails, first open the popup and read the detailed status message. Then verify the GitHub Token and Gist binding in Settings. For package backups, verify the selected backend, its credentials, repository or WebDAV path, and the saved extension selection. The browser cannot expose another extension’s unpacked directory automatically, so package bytes come from a folder you pick or from CRX/ZIP files you select; if a folder scan finds nothing, pick the user-data directory that contains the Extensions folder, or the extension’s own source directory. An uploaded file that cannot be matched to an installed extension is reported instead of being stored — use the per-row Back up CRX / ZIP button for it. To clear backups for removed or deselected extensions, run Clean up unused backups; deletion is confirmed and permanent.",
    scopeTitle: "Synchronization scope",
    scopeBody:
      "Chromium Cloud Sync synchronizes windows, HTTP(S) tabs, tab groups, bookmarks, and third-party extension metadata. It does not synchronize third-party extension settings or private extension storage. For missing extensions, you can save a GitHub download URL manually in the recovery workflow; the URL is remembered locally by extension ID.",
  },
  "zh-CN": {
    title: "用户指南",
    subtitle: "本地优先的 Chromium 同步工具，支持 GitHub Gist、Google Drive 和 WebDAV。",
    quickTitle: "快速开始",
    quickBody:
      "打开“设置 → 同步”并选择存储后端。GitHub Gist 使用 GitHub Token 和兼容的 Gist ID；留空 Gist ID 会创建新的私有同步 Gist。Google Drive 使用 OAuth 授权。WebDAV 使用配置的服务器地址、目录以及可选凭据。后端准备完成后，可以点击“立即同步”，也可以开启自动同步。",
    popupTitle: "Popup 界面",
    popupBody:
      "Popup 会显示当前存储后端、同步状态、最后一次成功同步时间、自动同步状态、Revision 和冲突数量，并提供主要快捷操作。“用户指南”和“设置”位于 Popup 顶部。“标签页”恢复操作处理未分组标签页；云端标签组使用独立的“恢复”操作。",
    storageTitle: "同步哪些内容",
    storageBody:
      "云端快照包含浏览器状态数据：打开的窗口和 HTTP(S) 标签页、标签组、书签，以及已安装第三方扩展的元数据。扩展元数据用于检测缺失扩展，不包含第三方扩展的内部设置。",
    storageNote:
      "第三方扩展设置被明确排除在同步范围之外。受支持的持久数据通过独立的“扩展完整备份”和可选本机助手处理。",
    providerTitle: "存储后端",
    providerBody:
      "当前支持 GitHub Gist、Google Drive 和 WebDAV。选中的后端负责保存同步的浏览器状态快照；后端凭据只保存在当前浏览器本地。",
    restoreTitle: "恢复行为",
    restoreBody:
      "Popup 中的“标签页”操作只恢复未加入标签组的 HTTP(S) 标签页，不会自动创建或恢复标签组。需要恢复标签组时，请使用云端标签组单独提供的“恢复”操作；该操作会在新的浏览器窗口中恢复可恢复的标签页并应用标签组元数据。",
    cloudTabsTitle: "云端标签页",
    cloudTabsBody:
      "“设置 → 云端标签页”仅在“增量”模式下可用。页面按照窗口、标签组和未分组标签页进行层级展示。“将当前浏览器标签页加入云端集合”会把当前浏览器的标签页、窗口和标签组合并到持久化云端集合，不会替换当前浏览器状态。",
    syncTitle: "同步模型",
    syncBody:
      "同步引擎保存本地基准快照，并在“基准 + 本地 + 远程”之间执行三方合并。标签页、窗口、标签组和书签使用稳定同步 ID。删除会记录为 tombstone，避免旧设备重新生成已经删除的项目；字段级冲突会明确保留，而不是静默丢弃。",
    autoTitle: "自动同步",
    autoBody:
      "自动同步默认关闭，默认间隔为 5 分钟。在设置中可以开启并选择同步间隔。浏览器事件会经过防抖后再启动后台同步。",
    extensionTitle: "扩展清单",
    extensionBody:
      "“扩展”功能记录第三方扩展的 ID、名称、版本、启用状态、安装类型、更新信息和商店链接。当另一台浏览器缺少云端清单中的扩展时，会在“扩展恢复中心”中列出。",
    recoveryTitle: "扩展恢复中心",
    recoveryBody:
      "打开“扩展恢复中心”，可以查看云端清单中存在但当前浏览器没有安装的扩展。如果能够确认 Chrome 网上应用店或 Microsoft Edge 加载项链接，页面会提供直接安装入口。扩展安装仍然由用户手动确认。",
    packageTitle: "扩展完整备份",
    packageBody:
      "打开“设置 → 扩展完整备份”，先保存独立云端存储，连接可选本机助手，选择对应 Profile、扩展 ID 和数据类别。预览后安排任务并退出所有 Chromium 浏览器。助手运行时解析用户目录，归档只记录 Profile 相对路径，再次启动浏览器后上传。下载会校验分块和完整归档，确认恢复并关闭浏览器后才替换所选范围，原数据保留以便回滚。数据库恢复要求相同操作系统、浏览器系列和主版本。密码、Cookie、Preferences、缓存、临时数据、OPFS/Storage Buckets 和未知数据库格式不包含在内。程序文件恢复不代替浏览器安装确认。旧版 CRX/ZIP 流程保留在云端存储设置下方。",
    historyTitle: "历史与回滚",
    historyBody:
      "历史记录取决于所选择的存储后端：GitHub Gist 和 Google Drive 使用服务商原生修订记录；WebDAV 只保存当前状态，扩展不再创建应用自管历史归档。",
    settingsTitle: "设置工作流",
    settingsBody:
      "设置页面按照同步功能组织。“同步”面板可选择 GitHub Gist、Google Drive 或 WebDAV，并显示对应后端配置。GitHub Gist 使用一个 Gist ID 输入框：输入兼容 ID 就使用该 Gist，留空则创建新的同步 Gist。Google Drive 使用 OAuth。WebDAV 使用服务器地址、目录及可选用户名/密码。该面板同时提供自动同步、恢复方式和标签页同步模式设置；“云端标签页”页在增量模式下提供层级化管理。",
    privacyTitle: "隐私与安全",
    privacyBody:
      "插件创建的同步 Gist 默认是私有的。当前同步载荷以普通 JSON 保存在 Gist 中，并不是端到端加密。应将能够访问这个私有 Gist 视为能够访问同步的浏览器数据。扩展包备份建议使用私有 GitHub 仓库或可信的 WebDAV 服务，并坚持最小权限原则。",
    troubleTitle: "故障排查",
    troubleBody:
      "同步失败时，先打开 Popup 查看详细状态信息，然后在设置中检查 GitHub Token 和 Gist 绑定。扩展包备份失败时，检查所选后端、凭据、仓库或 WebDAV 路径，以及已保存的扩展选择。浏览器不会自动暴露其他扩展的解压目录，因此扩展包来自你选择的文件夹或手动选择的 CRX / ZIP；如果扫描文件夹没有找到任何文件，请改选包含 Extensions 文件夹的用户数据目录，或该扩展自己的源码目录。无法对应到已安装扩展的文件会被提示而不是被保存，请用行内的“备份 CRX / ZIP”按钮单独上传。若要清理已移除或取消选择的扩展，请运行“清理未选扩展备份”；删除前会再次确认且无法撤销。",
    scopeTitle: "同步范围",
    scopeBody:
      "Chromium Cloud Sync 同步窗口、HTTP(S) 标签页、标签组、书签以及第三方扩展元数据。它不会同步第三方扩展设置或其他扩展的私有存储。扩展安装包通过独立的备份和恢复流程处理。",
  },
};
function detect() {
  return [navigator.language, ...(navigator.languages || [])].some((x) =>
    /^zh(?:[-_]|$)/i.test(x),
  )
    ? "zh-CN"
    : "en";
}
function apply() {
  const s = localStorage.getItem("ccsync-guide-language") || "auto",
    l = s === "auto" ? detect() : s === "zh-CN" ? "zh-CN" : "en",
    d = DICT[l] || DICT.en;
  document.documentElement.lang = l;
  document.querySelectorAll("[data-guide]").forEach((e) => {
    const value = d[e.dataset.guide];
    if (value) e.textContent = value;
  });
}
function setupChoiceSwitch(root, initialValue, onChange) {
  if (!root) return;
  const bs = [...root.querySelectorAll(".choice-switch-option")],
    set = (v) => {
      root.dataset.active = v === "en" || v === "dark" ? "right" : "left";
      bs.forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.value === v)),
      );
    };
  set(initialValue);
  bs.forEach((b) =>
    b.addEventListener("click", async () => {
      const v = b.dataset.value;
      await onChange(v);
      set(v);
    }),
  );
}
(async () => {
  const lang = document.getElementById("language");
  const s = await chrome.storage.local.get(["language"]);
  if (lang) {
    const lv = s.language && s.language !== "auto" ? s.language : detect();
    setupChoiceSwitch(lang, lv, async (v) => {
      await chrome.storage.local.set({ language: v });
      localStorage.setItem("ccsync-guide-language", v);
      apply();
    });
  }
  const theme = document.getElementById("theme");
  if (theme && window.CCSyncTheme) {
    await CCSyncTheme.initTheme();
    const tm = await CCSyncTheme.getTheme();
    const tv =
      tm === "dark" || tm === "light"
        ? tm
        : document.documentElement.dataset.theme || "light";
    setupChoiceSwitch(theme, tv, async (v) => CCSyncTheme.setTheme(v));
  }
  apply();
})();
