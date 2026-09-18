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
      "Third-party extension settings are intentionally outside the synchronization scope. Chromium Cloud Sync cannot generically read or write another extension’s private storage.",
    providerTitle: "Storage providers",
    providerBody:
      "GitHub Gist, Google Drive, and WebDAV are supported storage backends. The selected backend stores the synchronized browser-state snapshot; provider credentials remain local to the browser.",
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
    packageTitle: "Third-party extension package backup",
    packageBody:
      "CRX and ZIP backups are separate from browser-state synchronization. Open Settings → Third-party extensions, choose GitHub private repository or WebDAV, enter the required credentials, test and save the backend, then select which installed extensions should have package backups. For each selected extension, choose its CRX or ZIP file to upload. The package index and selection are stored in the configured backend; credentials remain local to the browser. Package installation remains manual.",
    historyTitle: "History and rollback",
    historyBody:
      "History depends on the selected provider: GitHub Gist uses Gist revisions, Google Drive uses file revisions, and WebDAV archives previous current-state files in its history area. The History page can inspect revisions and create a new current revision by rolling back to a selected version.",
    settingsTitle: "Settings workflow",
    settingsBody:
      "Settings is organized by synchronization function. The Sync panel selects GitHub Gist, Google Drive, or WebDAV and exposes the backend-specific connection controls. GitHub Gist uses one Gist ID field: enter a compatible ID to use it, or leave it blank to create a new synchronization Gist. Google Drive uses OAuth. WebDAV uses the configured URL, folder, and optional username/password. The same panel contains automatic-sync controls, restore behavior, and the tab synchronization mode. Settings → Cloud tabs provides hierarchical cloud-tab management in Incremental mode.",
    privacyTitle: "Privacy and security",
    privacyBody:
      "New sync Gists created by the extension are private. The current synchronization payload is normal JSON in the Gist and is not end-to-end encrypted. Treat access to the private Gist as access to the synchronized browser data. For package backups, use a private GitHub repository or a trusted WebDAV server and a least-privilege credential.",
    troubleTitle: "Troubleshooting",
    troubleBody:
      "If synchronization fails, first open the popup and read the detailed status message. Then verify the GitHub Token and Gist binding in Settings. For package backups, verify the selected backend, its credentials, repository or WebDAV path, and the saved extension selection. Remember that the browser cannot expose another extension’s installed CRX bytes automatically, so the first package backup requires manual file selection.",
    scopeTitle: "Synchronization scope",
    scopeBody:
      "Chromium Cloud Sync synchronizes windows, HTTP(S) tabs, tab groups, bookmarks, and third-party extension metadata. It does not synchronize third-party extension settings or private extension storage. Extension package backup is handled separately through the package-backup and recovery workflow.",
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
      "第三方扩展设置被明确排除在同步范围之外。Chromium Cloud Sync 无法通用地读取或修改其他扩展的私有存储。",
    providerTitle: "存储后端",
    providerBody:
      "当前支持 GitHub Gist、Google Drive 和 WebDAV。选中的后端负责保存同步的浏览器状态快照；后端凭据只保存在当前浏览器本地。",
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
    packageTitle: "第三方扩展包备份",
    packageBody:
      "CRX / ZIP 备份与浏览器状态同步完全分离。打开“设置 → 第三方扩展”，选择“GitHub 私有仓库”或 WebDAV，填写对应凭据，测试并保存后，再选择需要备份的已安装扩展。对于已选择的扩展，点击“备份 CRX / ZIP”并手动选择对应文件上传。扩展包索引和选择结果保存在所选后端；凭据只保存在当前浏览器本地。扩展安装仍然需要手动完成。",
    historyTitle: "历史与回滚",
    historyBody:
      "历史记录取决于所选择的存储后端：GitHub Gist 使用 Gist Revision，Google Drive 使用文件修订历史，WebDAV 会归档之前的当前状态文件并维护 history 索引。“历史”页面可以查看版本，并通过回滚操作创建新的当前 Revision。",
    settingsTitle: "设置工作流",
    settingsBody:
      "设置页面按照同步功能组织。“同步”面板可选择 GitHub Gist、Google Drive 或 WebDAV，并显示对应后端配置。GitHub Gist 使用一个 Gist ID 输入框：输入兼容 ID 就使用该 Gist，留空则创建新的同步 Gist。Google Drive 使用 OAuth。WebDAV 使用服务器地址、目录及可选用户名/密码。该面板同时提供自动同步、恢复方式和标签页同步模式设置；“云端标签页”页在增量模式下提供层级化管理。",
    privacyTitle: "隐私与安全",
    privacyBody:
      "插件创建的同步 Gist 默认是私有的。当前同步载荷以普通 JSON 保存在 Gist 中，并不是端到端加密。应将能够访问这个私有 Gist 视为能够访问同步的浏览器数据。扩展包备份建议使用私有 GitHub 仓库或可信的 WebDAV 服务，并坚持最小权限原则。",
    troubleTitle: "故障排查",
    troubleBody:
      "同步失败时，先打开 Popup 查看详细状态信息，然后在设置中检查 GitHub Token 和 Gist 绑定。扩展包备份失败时，检查所选后端、凭据、仓库或 WebDAV 路径，以及已保存的扩展选择。浏览器不能自动向另一个扩展暴露其已安装 CRX 的原始字节，因此首次备份扩展包需要手动选择文件。",
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
