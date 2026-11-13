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
      "The cloud snapshot contains tab groups and their HTTP(S) member tabs, bookmarks, and installed third-party extension metadata. Standalone tabs and whole-window layouts are not uploaded. Extension metadata helps detect missing extensions; it does not contain third-party extension settings.",
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
    packageTitle: "Extension packages",
    packageBody:
      "CRX / ZIP backups preserve extension program packages. They do not contain the extension's Profile data or install the extension when restored.",
    packageStepsTitle: "Package backup and restore",
    packageStepsBody:
      "1. Open Settings > Extension packages. 2. Choose a package storage backend independently from browser sync. 3. Upload packages from a folder you select, or choose existing CRX / ZIP files. 4. Select a saved package to download or restore it. If a folder scan finds no files, select the user-data folder containing Extensions or the extension's source folder.",
    fullBackupTitle: "Full extension data backup",
    fullBackupBody:
      "This advanced workflow backs up supported persistent data from a browser Profile. It is separate from sync and package backup, uses its own cloud destination, and requires building and registering the optional native helper (see native/README.md).",
    fullBackupRestoreTitle: "Full data restore",
    fullBackupRestoreBody:
      "1. In Settings > Extension packages, expand Advanced: full-file backup (native helper). 2. Connect or refresh the helper, choose the matching Profile, extension IDs, and data categories, then preview the scope. 3. Schedule the offline backup and quit every Chromium browser; ready archives upload on next start, or use Upload ready backups. 4. To restore, list cloud backups, download, verify, and preview one, then confirm the restore task. Close browsers before replacing selected data; originals remain available for rollback. Database recovery requires the same OS, browser family, and major version. Passwords, cookies, Preferences, caches, temporary files, OPFS / storage buckets, and unknown database layouts are excluded. Restoring program files does not install an extension.",
    historyTitle: "History and rollback",
    historyBody:
      "History depends on the selected provider: GitHub Gist and Google Drive keep provider-native revisions. WebDAV stores current state only, and the extension does not create application-managed archives.",
    settingsTitle: "Settings workflow",
    settingsBody:
      "Settings is organized by function. In Sync, choose GitHub Gist, Google Drive, or WebDAV and follow that provider's connection controls. GitHub Gist uses one Gist ID field: enter a compatible ID to use it, or leave it blank to create a new synchronization Gist. Google Drive normally connects through the browser's Google account chooser; an optional OAuth client is available under Advanced if that path is unavailable. WebDAV uses the configured URL, folder, and optional username/password. The Sync panel also contains automatic-sync, restore, and tab synchronization settings. Cloud tabs is available in Incremental mode and groups entries by window, tab group, and ungrouped tabs.",
    privacyTitle: "Privacy and security",
    privacyBody:
      "New sync Gists created by the extension are private. The current synchronization payload is normal JSON in the Gist and is not end-to-end encrypted. Treat access to the private Gist as access to the synchronized browser data. For package backups, use a private GitHub repository or a trusted WebDAV server and a least-privilege credential.",
    troubleTitle: "Troubleshooting",
    troubleBody:
      "If synchronization fails, first open the popup and read the detailed status message. Then verify the GitHub Token and Gist binding in Settings. For package backups, verify the selected backend, its credentials, repository or WebDAV path, and the saved extension selection. The browser cannot expose another extension’s unpacked directory automatically, so package bytes come from a folder you pick or from CRX/ZIP files you select; if a folder scan finds nothing, pick the user-data directory that contains the Extensions folder, or the extension’s own source directory. An uploaded file that cannot be matched to an installed extension is reported instead of being stored — use the per-row Back up CRX / ZIP button for it. To clear backups for removed or deselected extensions, run Clean up unused backups; deletion is confirmed and permanent.",
    scopeTitle: "Synchronization scope",
    scopeBody:
      "Chromium Cloud Sync synchronizes tab groups and their HTTP(S) member tabs, bookmarks, and third-party extension metadata. Standalone tabs and whole-window layouts are not uploaded. Third-party extension settings and private extension storage are excluded. Extension packages use the separate package-backup and recovery workflow.",
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
      "云端快照包含标签组及其 HTTP(S) 成员标签页、书签，以及已安装第三方扩展的元数据。独立标签页和整个窗口布局不会上传。扩展元数据用于检测缺失扩展，不包含第三方扩展的内部设置。",
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
    packageTitle: "扩展程序包",
    packageBody:
      "CRX / ZIP 备份保存扩展程序包，不包含扩展在浏览器 Profile 中的数据；恢复程序包也不会自动安装扩展。",
    packageStepsTitle: "程序包备份与恢复",
    packageStepsBody:
      "1. 打开“设置 → 扩展包”。2. 选择独立于浏览器同步的程序包存储后端。3. 从你选择的文件夹上传程序包，或直接选择已有 CRX / ZIP 文件。4. 选择已保存的程序包进行下载或恢复。如果扫描文件夹没有找到文件，请选择包含 Extensions 的用户数据文件夹，或该扩展的源码文件夹。",
    fullBackupTitle: "扩展完整数据备份",
    fullBackupBody:
      "此高级流程用于备份浏览器 Profile 中受支持的持久数据。它独立于同步和程序包备份，使用单独的云端存储，并需要构建、注册可选的本机助手（参见 native/README.md）。",
    fullBackupRestoreTitle: "完整数据恢复",
    fullBackupRestoreBody:
      "1. 在“设置 → 扩展包”展开“高级：完整文件备份（本机助手）”。2. 连接或刷新助手，选择对应的 Profile、扩展 ID 和数据类别，然后预览范围。3. 安排离线备份并退出所有 Chromium 浏览器；就绪归档会在下次启动时上传，也可使用“上传就绪备份”。4. 恢复时先列出云端备份，再下载、校验并预览，然后确认恢复任务。替换数据前请关闭浏览器；原数据会保留以便回滚。数据库恢复要求相同操作系统、浏览器系列和主版本。密码、Cookie、Preferences、缓存、临时数据、OPFS / Storage Buckets 和未知数据库格式不包含在内。恢复程序文件不等于安装扩展。",
    historyTitle: "历史与回滚",
    historyBody:
      "历史记录取决于所选择的存储后端：GitHub Gist 和 Google Drive 使用服务商原生修订记录；WebDAV 只保存当前状态，扩展不再创建应用自管历史归档。",
    settingsTitle: "设置工作流",
    settingsBody:
      "设置按功能组织。在“同步”中选择 GitHub Gist、Google Drive 或 WebDAV，并按页面提示连接。GitHub Gist 使用一个 Gist ID 输入框：输入兼容 ID 就使用该 Gist，留空则创建新的同步 Gist。Google Drive 通常通过浏览器的 Google 账号选择器连接；如果该方式不可用，可展开“高级”并配置自己的 OAuth client。WebDAV 使用服务器地址、目录及可选用户名/密码。“同步”还提供自动同步、恢复方式和标签页同步模式；“云端标签页”仅在增量模式下可用，并按窗口、标签组和未分组标签页展示条目。",
    privacyTitle: "隐私与安全",
    privacyBody:
      "插件创建的同步 Gist 默认是私有的。当前同步载荷以普通 JSON 保存在 Gist 中，并不是端到端加密。应将能够访问这个私有 Gist 视为能够访问同步的浏览器数据。扩展包备份建议使用私有 GitHub 仓库或可信的 WebDAV 服务，并坚持最小权限原则。",
    troubleTitle: "故障排查",
    troubleBody:
      "同步失败时，先打开 Popup 查看详细状态信息，然后在设置中检查 GitHub Token 和 Gist 绑定。扩展包备份失败时，检查所选后端、凭据、仓库或 WebDAV 路径，以及已保存的扩展选择。浏览器不会自动暴露其他扩展的解压目录，因此扩展包来自你选择的文件夹或手动选择的 CRX / ZIP；如果扫描文件夹没有找到任何文件，请改选包含 Extensions 文件夹的用户数据目录，或该扩展自己的源码目录。无法对应到已安装扩展的文件会被提示而不是被保存，请用行内的“备份 CRX / ZIP”按钮单独上传。若要清理已移除或取消选择的扩展，请运行“清理未选扩展备份”；删除前会再次确认且无法撤销。",
    scopeTitle: "同步范围",
    scopeBody:
      "Chromium Cloud Sync 同步标签组及其 HTTP(S) 成员标签页、书签以及第三方扩展元数据。独立标签页和整个窗口布局不会上传；第三方扩展设置或扩展私有存储也不在范围内。扩展安装包通过独立的备份和恢复流程处理。",
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
