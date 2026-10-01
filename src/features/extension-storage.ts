(function () {
  const K = {
    backend: "extensionBackupBackend",
    repo: "extensionBackupGithubRepo",
    branch: "extensionBackupGithubBranch",
    folder: "extensionBackupGithubFolder",
    token: "extensionBackupGithubToken",
    davUrl: "extensionBackupWebdavUrl",
    davFolder: "extensionBackupWebdavFolder",
    davUser: "extensionBackupWebdavUsername",
    davPass: "extensionBackupWebdavPassword",
    gdriveFolder: "extensionBackupGdriveFolder",
    selected: "extensionBackupSelectedIds",
  };
  const KC = {
    rootId: "extensionBackupGdriveRootId",
    folderIds: "extensionBackupGdriveFolderIds",
  };
  const D = {
    backend: "disabled",
    repo: "",
    branch: "",
    folder: "",
    token: "",
    davUrl: "",
    davFolder: "",
    davUser: "",
    davPass: "",
    gdriveFolder: "",
    selected: [],
  };
  const MAX = 95 * 1024 * 1024;
  const GITHUB_API_VERSION = "2022-11-28";
  const GITHUB_FETCH_TIMEOUT_MS = 15000;
  const $ = (id) => document.getElementById(id);
  const lang = () =>
    window.CCSyncI18n?.currentLanguage?.() ||
    document.documentElement.lang ||
    "en";
  const zh = () => lang() === "zh-CN";
  const text = {
    title: () =>
      zh() ? "第三方扩展云存储" : "Third-party extension cloud storage",
    desc: () =>
      zh()
        ? "第三方扩展包使用独立云存储，不写入同步 Gist。"
        : "Third-party extension packages use a separate cloud store and never enter the sync Gist.",
    panelTitle: () =>
      zh() ? "第三方扩展包存储" : "Third-party extension file storage",
    panelDesc: () =>
      zh()
        ? "单独备份和管理第三方 CRX / ZIP 扩展包，不写入同步数据库。"
        : "Back up and manage third-party CRX / ZIP packages separately from the sync database.",
    nav: () => (zh() ? "第三方扩展" : "Third-party extensions"),
    backend: () => (zh() ? "存储后端" : "Storage backend"),
    disabled: () => (zh() ? "关闭" : "Disabled"),
    github: () => (zh() ? "GitHub 私有仓库" : "GitHub private repository"),
    repo: () => (zh() ? "GitHub 仓库" : "GitHub repository"),
    branch: () => (zh() ? "分支（可选）" : "Branch (optional)"),
    folder: () => (zh() ? "存储文件夹" : "Storage folder"),
    token: () => (zh() ? "扩展备份 Token" : "Extension backup Token"),
    tokenHelp: () =>
      zh()
        ? "建议创建 Fine-grained Token，仅授权目标私有仓库的 Contents: Read and write。Token 只需要 repo 权限，不需要其它权限。"
        : "Create a fine-grained token limited to the target private repository with Contents: Read and write. Only repository contents access is required.",
    tokenLink: () => (zh() ? "创建 GitHub Token" : "Create GitHub Token"),
    davUrl: () => (zh() ? "WebDAV 地址" : "WebDAV URL"),
    davFolder: () => (zh() ? "WebDAV 文件夹" : "WebDAV folder"),
    user: () => (zh() ? "用户名" : "Username"),
    pass: () => (zh() ? "密码" : "Password"),
    test: () => (zh() ? "测试连接" : "Test connection"),
    save: () => (zh() ? "保存存储设置" : "Save storage settings"),
    saved: () => (zh() ? "存储设置已保存" : "Storage settings saved"),
    tested: () => (zh() ? "连接成功" : "Connection successful"),
    needRepo: () =>
      zh()
        ? "请输入 owner/repository 格式的 GitHub 仓库。"
        : "Enter the GitHub repository as owner/repository.",
    needToken: () =>
      zh()
        ? "请配置扩展备份用 GitHub Token。"
        : "Configure the extension-backup GitHub Token first.",
    privateRepo: () =>
      zh()
        ? "目标仓库必须是私有仓库。"
        : "The target repository must be private.",
    notWritable: () =>
      zh()
        ? "该 Token 没有仓库写入权限，请确认 Contents 为 Read and write。"
        : "This token cannot write to the repository. Grant Contents: Read and write.",
    needDav: () => (zh() ? "请输入 WebDAV 地址。" : "Enter a WebDAV URL."),
    permission: () =>
      zh()
        ? "WebDAV 需要允许访问填写的服务器地址。"
        : "WebDAV needs permission to access the configured server origin.",
    choose: () => (zh() ? "选择要备份的扩展" : "Choose extensions to back up"),
    all: () => (zh() ? "全选" : "Select all"),
    none: () => (zh() ? "全不选" : "Clear all"),
    selectionSaved: () => (zh() ? "备份选择已保存" : "Backup selection saved"),
    selectionNeedSave: () =>
      zh()
        ? "请先保存存储设置，再保存扩展备份选择。"
        : "Save the storage settings first, then save the extension backup selection.",
    saveSelectionFirst: () =>
      zh()
        ? "请先保存当前备份选择，再清理未使用的云端扩展包。"
        : "Save the current backup selection before cleaning up unused cloud packages.",
    cleanupUnused: () =>
      zh() ? "清理未选扩展备份" : "Clean up unused backups",
    cleanupUnusedHelp: () =>
      zh()
        ? "取消选择或卸载扩展不会自动删除云端文件。确认后可清理所有未纳入当前备份选择的扩展包及其旧版本；备份选择对同一云端目标的其他设备也生效，请核对确认列表。"
        : "Deselecting or uninstalling an extension does not delete cloud files automatically. Review and confirm to remove packages and older versions outside the saved selection. The selection is shared by profiles using this destination, so check the confirmation list first.",
    cleanupConfirm: () =>
      zh()
        ? "将从云端永久删除 {count} 个未选扩展包（{size}），涉及：{names}。此操作不可撤销，是否继续？"
        : "Permanently delete {count} unused cloud package(s) ({size}) for: {names}. This cannot be undone. Continue?",
    cleanupNothing: () =>
      zh() ? "没有需要清理的未选扩展包。" : "There are no unused cloud packages to clean up.",
    cleanupComplete: () =>
      zh()
        ? "已清理 {count} 个云端扩展包（{size}）。"
        : "Cleaned up {count} cloud package(s) ({size}).",
    cleanupPartial: () =>
      zh()
        ? "已删除 {count} 个扩展包；{failed} 个扩展包删除失败并保留在索引中；{metadataFailed} 个元数据文件未能整理。请检查权限或网络后重试。"
        : "Deleted {count} package(s); {failed} package(s) could not be deleted and remain indexed; {metadataFailed} metadata sidecar(s) could not be reconciled. Check access and retry.",
    packageFormatInvalid: () =>
      zh() ? "仅支持 CRX 或 ZIP 扩展包。" : "Only CRX or ZIP extension packages are supported.",
    backup: () => (zh() ? "备份 CRX / ZIP" : "Back up CRX / ZIP"),
    download: () => (zh() ? "下载" : "Download"),
    cloud: () => (zh() ? "云端备份" : "Cloud backups"),
    noBackups: () =>
      zh() ? "暂无云端扩展包。" : "No cloud package backups found.",
    manual: () =>
      zh()
        ? "操作说明：① 保存并启用存储后端；② 在下方勾选要备份的扩展（默认不选，勾选后自动保存）；③ 点击“从本地文件夹备份”，选择浏览器的用户数据目录或解包扩展的源码目录，扩展会自动打包并上传其中的文件，也可以改用“上传多个 CRX / ZIP”或直接把文件拖到列表上。扩展包按扩展 ID 和版本保存，内容没有变化时不会重复上传。由本地解包文件打成的 ZIP 需要通过“加载已解压的扩展”恢复，并会得到新的扩展 ID；若该扩展仍在商店上架，优先从商店重新安装以保留原 ID。取消选择或卸载不会自动删除云端备份，请先保存备份选择，再用下方清理按钮检查并删除未使用包。"
        : "How this works: 1) save and enable a storage backend; 2) check the extensions you want to back up (nothing is selected by default, and the selection saves itself); 3) click “Back up from a local folder” and pick the browser user-data directory or an unpacked extension's source directory — the files found there are packaged and uploaded for you. “Upload several CRX / ZIP”, or dropping files onto the list, remains available for packages you already have. Packages are stored per extension ID and version, and unchanged content is never uploaded twice. A ZIP built from local unpacked files is restored with “Load unpacked” and receives a new extension ID, so prefer reinstalling from the store when the extension is still published. Deselecting or uninstalling does not automatically delete cloud data: save the backup selection, then review and clean unused packages below.",
    uploading: () => (zh() ? "上传中…" : "Uploading…"),
    createToken: () =>
      zh()
        ? "请先在 GitHub 创建 Fine-grained Token，再粘贴到这里。"
        : "Create a fine-grained GitHub Token first, then paste it here.",
    max: () =>
      zh()
        ? "超过 95 MB 的文件不会通过当前 GitHub Contents API 上传。"
        : "Files larger than 95 MB are rejected by the current GitHub Contents API path.",
    gdrive: () => (zh() ? "Google Drive" : "Google Drive"),
    gdriveFolder: () =>
      zh() ? "Drive 子文件夹（可选）" : "Drive subfolder (optional)",
    gdriveHelp: () =>
      zh()
        ? "扩展包保存到 Google Drive 中由本扩展管理的“Chromium Cloud Sync Packages”文件夹，与浏览器状态同步文件完全分开，并复用同步设置里已授权的 Google 账号。"
        : "Packages are stored in the app-managed \u201cChromium Cloud Sync Packages\u201d folder on Google Drive, completely separate from the browser-state sync files, reusing the Google account already authorized in sync settings.",
    gdriveGuide: () =>
      zh()
        ? "使用步骤：① 先在“设置 → 同步”里把同步提供方设为 Google Drive 并点击“使用 Google 账号连接”完成授权；② 回到本页，把存储后端切换到 Google Drive；③ 可选填写子文件夹；④ 点击“保存存储设置”。本页不会再次要求任何 OAuth 客户端 ID/Secret。"
        : "Steps: 1) In Settings → Sync, set the sync provider to Google Drive and click \u201cConnect with Google account\u201d to authorize; 2) return here and set the storage backend to Google Drive; 3) optionally enter a subfolder; 4) click \u201cSave storage settings\u201d. No OAuth client ID/secret is ever requested on this page.",
    gdriveNotConnected: () =>
      zh()
        ? "尚未连接 Google Drive。请先在“云端同步提供方”中选择 Google Drive 并完成授权，再回到本页保存。"
        : "Google Drive is not connected yet. Choose Google Drive under Cloud sync provider and authorize it first, then return here to save.",
    gdriveConnectedAs: () =>
      zh()
        ? "已连接 Google 账号：{email}"
        : "Connected Google account: {email}",
    gdriveSeparate: () =>
      zh()
        ? "扩展包备份与同步提供方相互独立：可以在不更改主同步提供方的情况下使用 Google Drive 备份扩展包。"
        : "Package backup is independent of the sync provider: Google Drive can back up packages without changing the main sync provider.",
    needGdrive: () =>
      zh()
        ? "请先连接 Google Drive 后再使用扩展包备份。"
        : "Connect Google Drive before using package backup.",
    source: () => (zh() ? "来源" : "Source"),
    storedAt: () => (zh() ? "备份时间" : "Backed up"),
    unindexed: () =>
      zh() ? "云端存在但未登记" : "On provider but not indexed",
    missingFile: () => (zh() ? "云端文件缺失" : "Missing on provider"),
    sourceChromeWebStore: () => (zh() ? "Chrome 应用商店" : "Chrome Web Store"),
    sourceEdgeAddOns: () => (zh() ? "Edge 外接程序" : "Edge Add-ons"),
    sourceSelfHosted: () =>
      zh() ? "自托管更新地址" : "Self-hosted update URL",
    sourceUnpacked: () =>
      zh() ? "未打包（开发模式）" : "Unpacked (development)",
    sourceSideLoaded: () => (zh() ? "旁加载" : "Side-loaded"),
    sourcePolicy: () => (zh() ? "策略安装" : "Installed by policy"),
    sourceUnknown: () => (zh() ? "未知来源" : "Unknown source"),
    driveQuota: () =>
      zh()
        ? "Google Drive 存储空间或配额不足，无法上传扩展包。"
        : "Google Drive is out of storage or quota; the package cannot be uploaded.",
    driveRateLimit: () =>
      zh()
        ? "Google Drive 请求过于频繁，请稍后重试。"
        : "Google Drive is rate-limiting requests; try again shortly.",
    driveAuth: () =>
      zh()
        ? "Google Drive 授权已过期，请在同步设置中重新连接。"
        : "Google Drive authorization expired; reconnect it in sync settings.",
    drivePermission: () =>
      zh()
        ? "Google Drive 权限不足，无法访问该扩展包位置。"
        : "Google Drive permissions are insufficient for this package location.",
    driveNotFound: () =>
      zh()
        ? "Google Drive 上找不到该文件或文件夹，可能已被删除。"
        : "The file or folder was not found on Google Drive; it may have been deleted.",
    driveTooLarge: () =>
      zh()
        ? "扩展包超过 Google Drive 上传大小限制。"
        : "The package exceeds the Google Drive upload size limit.",
    driveServer: () =>
      zh()
        ? "Google Drive 服务暂时不可用，请稍后重试。"
        : "Google Drive is temporarily unavailable; try again later.",
    githubTimeout: () =>
      zh()
        ? "访问 GitHub API 超时，请检查网络或代理后重试。"
        : "GitHub API request timed out; check your network or proxy and retry.",
    githubNetwork: () =>
      zh()
        ? "无法连接 GitHub API，请检查网络或代理。"
        : "Cannot reach the GitHub API; check your network or proxy.",
    saveFailedHint: () =>
      zh()
        ? "存储设置保存失败。请检查上方红色错误信息，修正后重试。"
        : "Saving storage settings failed. Read the error message above and retry.",
    /* ----------------------------- selection ----------------------------- */
    search: () => (zh() ? "搜索扩展" : "Search extensions"),
    searchPlaceholder: () =>
      zh() ? "按名称或 ID 搜索" : "Search by name or ID",
    invert: () => (zh() ? "反选" : "Invert"),
    selectedCount: () =>
      zh() ? "已选 {selected} / {total}" : "{selected} of {total} selected",
    selectionHint: () =>
      zh()
        ? "勾选状态会自动保存到云端；默认不选择任何扩展，只备份你真正需要的部分。取消选择不会删除已有云端备份。"
        : "The selection is saved automatically. Nothing is selected by default, so only the extensions you check are backed up. Deselecting never deletes an existing cloud backup.",
    selectionSaving: () =>
      zh() ? "正在保存备份选择…" : "Saving backup selection…",
    selectionSaved: () => (zh() ? "备份选择已保存" : "Backup selection saved"),
    selectionUnsaved: () =>
      zh()
        ? "勾选任意扩展后会自动保存到云端"
        : "Toggle any extension to save the selection to the cloud",
    selectionSaveFailed: () =>
      zh()
        ? "备份选择保存失败：{error}"
        : "Could not save the backup selection: {error}",
    cloudStateNone: () => (zh() ? "未备份" : "not backed up"),
    cloudStateSame: () =>
      (zh() ? "已备份 v{version}" : "backed up v{version}"),
    cloudStateOther: () =>
      (zh() ? "云端为 v{version}" : "cloud has v{version}"),
    localChip: () => (zh() ? "本地可备份" : "found locally"),
    /* --------------------------- local sources --------------------------- */
    localButton: () =>
      zh() ? "从本地文件夹备份" : "Back up from a local folder",
    localButtonCount: () =>
      zh()
        ? "从本地文件夹备份 · 找到 {count} 个"
        : "Back up from a local folder · {count} found",
    localButtonBusy: () =>
      (zh() ? "正在扫描本地文件…" : "Scanning local files…"),
    localHint: () =>
      zh()
        ? "选择浏览器的用户数据目录（包含 Extensions 文件夹），或某个解包扩展的源码目录：Windows 为 %LOCALAPPDATA%\\Google\\Chrome\\User Data，macOS 为 ~/Library/Application Support/Google/Chrome，Linux 为 ~/.config/google-chrome；Edge 把 Chrome 换成 Microsoft/Edge。chrome://version 会显示当前配置文件路径。"
        : "Pick the browser user-data directory (the one containing the Extensions folder), or an unpacked extension's source directory: %LOCALAPPDATA%\\Google\\Chrome\\User Data on Windows, ~/Library/Application Support/Google/Chrome on macOS, ~/.config/google-chrome on Linux; replace Chrome with Microsoft/Edge for Edge. chrome://version shows the exact profile path.",
    localRemembered: () =>
      zh()
        ? "已记住文件夹：{name}"
        : "Remembered folder: {name}",
    localChange: () => (zh() ? "更换文件夹" : "Change folder"),
    localForget: () => (zh() ? "不再记住" : "Forget"),
    localScanFailed: () =>
      zh()
        ? "读取本地扩展文件失败：{error}"
        : "Could not read the local extension files: {error}",
    localNothingFound: () =>
      zh()
        ? "所选文件夹里没有找到可备份的扩展文件。请选择包含 Extensions 文件夹的用户数据目录，或解包扩展的源码目录。"
        : "No backable extension files were found in the selected folder. Pick the user-data directory that contains the Extensions folder, or an unpacked extension's source directory.",
    localPreviewTitle: () =>
      zh() ? "选择要备份的本地扩展" : "Choose local extensions to back up",
    localPreviewDesc: () =>
      zh()
        ? "下面是刚才在所选文件夹里找到的扩展文件。扩展包会按扩展 ID 和版本保存，内容没有变化时不会重复上传。"
        : "These are the extension files found in the selected folder. Packages are stored per extension ID and version, and unchanged content is never uploaded twice.",
    localFiles: () =>
      (zh() ? "{count} 个文件 · {size}" : "{count} files · {size}"),
    localMatchId: () =>
      (zh() ? "按扩展 ID 匹配" : "matched by extension ID"),
    localMatchManifest: () =>
      (zh() ? "按 manifest.json 匹配" : "matched by manifest.json"),
    localMatchOrphan: () =>
      (zh() ? "本地文件（当前未安装）" : "local files (not installed)"),
    localCloudNone: () => (zh() ? "未备份" : "not backed up"),
    localCloudSame: () =>
      (zh() ? "云端已有该版本" : "cloud already has this version"),
    localCloudOther: () =>
      (zh() ? "云端为 v{version}" : "cloud has v{version}"),
    localVersionMismatch: () =>
      zh()
        ? "本地版本与已安装版本不一致"
        : "local version differs from the installed one",
    localMissing: () =>
      zh()
        ? "{count} 个已安装扩展在所选文件夹里没有文件：解包/开发模式扩展请直接选择它的源码目录。"
        : "{count} installed extension(s) had no files in the selected folder: for unpacked or development extensions, pick their source directory directly.",
    localStart: () => (zh() ? "开始备份 {count} 个" : "Back up {count}"),
    localCancel: () => (zh() ? "取消" : "Cancel"),
    localClose: () => (zh() ? "关闭" : "Close"),
    localProgress: () =>
      (zh() ? "正在备份 {done}/{total}：{name}" : "Backing up {done}/{total}: {name}"),
    localItemPending: () => (zh() ? "等待中" : "waiting"),
    localItemWorking: () => (zh() ? "打包中…" : "packaging…"),
    localItemUploading: () => (zh() ? "上传中…" : "uploading…"),
    localItemDone: () => (zh() ? "已备份" : "backed up"),
    localItemSkipped: () => (zh() ? "内容未变化" : "unchanged"),
    localItemFailed: () => (zh() ? "失败" : "failed"),
    localTooManyFiles: () =>
      zh()
        ? "该扩展文件过多（超过 {count} 个），已跳过以保证备份完整。"
        : "This extension has too many files (over {count}) and was skipped so no partial backup is stored.",
    localSummary: () =>
      zh()
        ? "已备份 {done} 个扩展包（{size}）；{skipped} 个内容未变化；{failed} 个失败。"
        : "Backed up {done} package(s) ({size}); {skipped} unchanged; {failed} failed.",
    localOrigin: () => (zh() ? "本地解包文件" : "local unpacked files"),
    /* ---------------------------- batch upload --------------------------- */
    uploadMany: () =>
      (zh() ? "上传多个 CRX / ZIP…" : "Upload several CRX / ZIP…"),
    dropHint: () =>
      zh()
        ? "也可以把多个 CRX / ZIP 文件直接拖到上面的列表上"
        : "You can also drop several CRX / ZIP files straight onto the list above",
    uploadProgress: () =>
      (zh() ? "正在上传 {done}/{total}…" : "Uploading {done}/{total}…"),
    uploadSummary: () =>
      zh()
        ? "已上传 {uploaded} 个扩展包；{failed} 个失败。"
        : "Uploaded {uploaded} package(s); {failed} failed.",
    uploadUnmatched: () =>
      zh()
        ? "{count} 个文件无法识别对应扩展：{names}。请使用行内“备份 CRX / ZIP”按钮单独上传。"
        : "{count} file(s) could not be matched to an extension: {names}. Use the per-row “Back up CRX / ZIP” button for those.",
  };
  const t = (k) => text[k]?.() || k;
  const formatText = (template, values) =>
    Object.entries(values).reduce(
      (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
      template,
    );
  const getCfg = async () => {
    const stored = await CCSyncRuntime.storageGet(Object.values(K));
    // Storage uses namespaced keys; the UI and transports use short names.
    // Spreading stored over D silently left every short name at its default.
    return Object.fromEntries(
      Object.entries(K).map(([name, key]) => [name, stored[key] ?? D[name]]),
    );
  };
  const normRepo = (v) =>
    String(v || "")
      .trim()
      .replace(/^https?:\/\/github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/^\/+|\/+$/g, "");
  const normFolder = (v) =>
    String(v || "")
      .trim()
      .replace(/^\/+|\/+$/g, "")
      .replace(/\\+/g, "/");
  const normDav = (v) => {
    let x = String(v || "")
      .trim()
      .replace(/\\/g, "/");
    if (!x) return "";
    if (!x.startsWith("/")) x = "/" + x;
    return x.replace(/\/+/g, "/").replace(/\/$/, "") || "";
  };
  const join = (...parts) =>
    parts
      .filter(Boolean)
      .map((x, i) =>
        i ? String(x).replace(/^\/+|\/+$/g, "") : String(x).replace(/\/+$/, ""),
      )
      .filter(Boolean)
      .join("/");
  const seg = (v) =>
    String(v || "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "package";
  const bytes64 = (b) => {
    let s = "",
      step = 0x8000;
    for (let i = 0; i < b.length; i += step)
      s += String.fromCharCode(...b.subarray(i, Math.min(i + step, b.length)));
    return btoa(s);
  };
  const decode = (b) => new TextDecoder().decode(b);
  const fmt = (n) =>
    n < 1024
      ? `${n} B`
      : n < 1048576
        ? `${(n / 1024).toFixed(1)} KB`
        : `${(n / 1048576).toFixed(1)} MB`;
  async function sha256(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  }

  /** Fetch with timeout so a hung request cannot lock the save button. */
  async function fetchWithTimeout(
    url,
    init = {},
    timeoutMs = GITHUB_FETCH_TIMEOUT_MS,
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (
        error &&
        (error.name === "AbortError" ||
          /aborted/i.test(String(error.message || error)))
      ) {
        throw Error(t("githubTimeout"));
      }
      throw Error(`${t("githubNetwork")}: ${error?.message || String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  async function github(path, opt = {}, token) {
    const value =
      String(token || "").trim() ||
      String((await CCSyncRuntime.storageGet([K.token]))[K.token] || "").trim();
    if (!value) throw Error(t("needToken"));
    const r = await fetchWithTimeout(`https://api.github.com${path}`, {
      ...opt,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        Authorization: `Bearer ${value}`,
        ...(opt.headers || {}),
      },
    });
    const raw = await r.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = { raw };
    }
    if (!r.ok) {
      const e = new Error(data?.message || `GitHub API HTTP ${r.status}`);
      e.status = r.status;
      throw e;
    }
    return data;
  }
  async function githubInfo(cfg) {
    const repo = normRepo(cfg.repo);
    if (!/^[^/]+\/[^/]+$/.test(repo)) throw Error(t("needRepo"));
    const d = await github(`/repos/${repo}`, {}, cfg.token);
    if (!d.private) throw Error(t("privateRepo"));
    if (d.permissions && !d.permissions.push) throw Error(t("notWritable"));
    return d;
  }
  async function githubFile(cfg, path) {
    try {
      const ref = String(cfg.branch || "").trim();
      const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      return await github(
        `/repos/${normRepo(cfg.repo)}/contents/${path}${query}`,
        {},
        cfg.token,
      );
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }
  async function githubDelete(cfg, path, message) {
    const old = await githubFile(cfg, path);
    if (!old?.sha) return false;
    const body = { message, sha: old.sha };
    if (cfg.branch) body.branch = String(cfg.branch).trim();
    await github(
      `/repos/${normRepo(cfg.repo)}/contents/${path}`,
      {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      cfg.token,
    );
    return true;
  }
  async function githubPut(cfg, path, bytes, message) {
    if (bytes.length > MAX) throw Error(t("max"));
    const repo = normRepo(cfg.repo),
      old = await githubFile(cfg, path),
      body = { message, content: bytes64(bytes) };
    if (cfg.branch) body.branch = String(cfg.branch).trim();
    if (old?.sha) body.sha = old.sha;
    await github(
      `/repos/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      cfg.token,
    );
  }
  async function githubRaw(cfg, path) {
    const ref = String(cfg.branch || "").trim();
    const query = ref
      ? `${String(path).includes("?") ? "&" : "?"}ref=${encodeURIComponent(ref)}`
      : "";
    const r = await fetchWithTimeout(`https://api.github.com${path}${query}`, {
      headers: {
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        Authorization: `Bearer ${cfg.token}`,
      },
    });
    if (!r.ok) throw Error(`GitHub API HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async function githubReadJson(cfg, path, fallback) {
    try {
      return JSON.parse(
        decode(
          await githubRaw(cfg, `/repos/${normRepo(cfg.repo)}/contents/${path}`),
        ),
      );
    } catch (e) {
      if (String(e?.message || "").includes("HTTP 404")) return fallback;
      throw e;
    }
  }
  function packageFromRepoPath(rawPath, cfg, size = 0) {
    const root = normFolder(cfg.folder);
    const full = String(rawPath || "");
    const relative = root
      ? full.startsWith(`${root}/`)
        ? full.slice(root.length + 1)
        : ""
      : full;
    const parts = relative.split("/");
    if (parts.length !== 4 || parts[0] !== "extensions") return null;
    const version = parts[2].replace(/^v/, "");
    if (!PI().isPackagePath(relative, parts[1], version, parts[3])) return null;
    return {
      path: relative,
      name: parts[3],
      size: Number(size || 0),
      modifiedTime: "",
    };
  }
  async function githubListPackageFiles(cfg) {
    const repo = normRepo(cfg.repo);
    const info = await githubInfo(cfg);
    const ref = String(cfg.branch || info.default_branch || "").trim();
    if (!ref) throw Error("GitHub repository has no default branch");
    let tree;
    try {
      tree = await github(
        `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        {},
        cfg.token,
      );
    } catch (error) {
      // GitHub returns 404 for the default branch of an empty repository.
      if (error?.status === 404 && ref === info.default_branch) return [];
      throw error;
    }
    if (Array.isArray(tree?.tree) && !tree.truncated) {
      return tree.tree
        .filter((entry) => entry?.type === "blob")
        .map((entry) => packageFromRepoPath(entry.path, cfg, entry.size))
        .filter(Boolean);
    }

    // GitHub truncates very large trees. Fall back to the fixed three-level
    // package layout so cleanup can still find old and interrupted uploads.
    const root = normFolder(cfg.folder);
    const branchQuery = `?ref=${encodeURIComponent(ref)}`;
    const readDirectory = async (relative) => {
      try {
        const value = await github(
          `/repos/${repo}/contents/${join(root, relative)}${branchQuery}`,
          {},
          cfg.token,
        );
        return Array.isArray(value) ? value : [];
      } catch (error) {
        if (error?.status === 404) return [];
        throw error;
      }
    };
    const out = [];
    let directories = ["extensions"];
    for (let depth = 0; depth < 3 && directories.length; depth += 1) {
      const next = [];
      for (const directory of directories) {
        const entries = await readDirectory(directory);
        for (const entry of entries) {
          const child = `${directory}/${String(entry.name || "")}`;
          if (entry.type === "dir") next.push(child);
          else if (entry.type === "file") {
            const item = packageFromRepoPath(join(root, child), cfg, entry.size);
            if (item) out.push(item);
          }
        }
      }
      directories = next;
    }
    return out;
  }
  async function davPermission(url) {
    const u = new URL(url),
      origin = `${u.origin}/*`;
    if (!chrome.permissions?.request) return true;
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return chrome.permissions.request({ origins: [origin] });
  }
  const davAuth = (u, p) =>
    u || p ? `Basic ${bytes64(new TextEncoder().encode(`${u}:${p}`))}` : "";
  async function dav(cfg, relative, opt = {}) {
    if (!(await davPermission(cfg.davUrl))) throw Error(t("permission"));
    const base = cfg.davUrl.replace(/\/+$/, "");
    const folder = normDav(cfg.davFolder);
    const root = base + (folder || "");
    const clean = String(relative || "").replace(/^\/+/, "");
    const url = root + (clean ? `/${clean}` : "");
    const h = { ...(opt.headers || {}) },
      a = davAuth(cfg.davUser, cfg.davPass);
    if (a) h.Authorization = a;
    return fetch(url, { ...opt, headers: h });
  }
  async function davAt(cfg, path, opt = {}) {
    if (!(await davPermission(cfg.davUrl))) throw Error(t("permission"));
    const root = cfg.davUrl.replace(/\/+$/, "");
    const clean = String(path || "").replace(/^\/+/, "");
    const url = root + (clean ? `/${clean}` : "");
    const h = { ...(opt.headers || {}) },
      a = davAuth(cfg.davUser, cfg.davPass);
    if (a) h.Authorization = a;
    return fetch(url, { ...opt, headers: h });
  }
  async function davMkdir(cfg, folder) {
    const n = normDav(folder);
    if (!n) return;
    let cur = "";
    for (const part of n.split("/").filter(Boolean)) {
      cur += "/" + part;
      const r = await davAt(cfg, cur, { method: "MKCOL" });
      if ([200, 201, 204, 207, 405, 409].includes(r.status)) continue;
      throw Error(`WebDAV MKCOL failed: HTTP ${r.status}`);
    }
  }
  async function davPut(
    cfg,
    relative,
    bytes,
    type = "application/octet-stream",
  ) {
    const dir = String(relative).split("/").slice(0, -1).join("/");
    if (dir) await davMkdir(cfg, join(normDav(cfg.davFolder), dir));
    const r = await dav(cfg, relative, {
      method: "PUT",
      headers: { "Content-Type": type },
      body: bytes,
    });
    if (!r.ok) throw Error(`WebDAV upload failed: HTTP ${r.status}`);
  }
  async function davGet(cfg, relative) {
    const r = await dav(cfg, relative, { method: "GET" });
    if (!r.ok) throw Error(`WebDAV download failed: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async function davDelete(cfg, relative) {
    const r = await dav(cfg, relative, { method: "DELETE" });
    if ([200, 202, 204].includes(r.status)) return true;
    if (r.status === 404) return false;
    throw Error(`WebDAV delete failed: HTTP ${r.status}`);
  }
  function webdavTagBody(xml, name) {
    const match = String(xml).match(
      new RegExp(
        `<(?:[A-Za-z_][\\w.-]*:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${name}\\s*>`,
        "i",
      ),
    );
    return match?.[1] || "";
  }
  function webdavXmlText(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .trim();
  }
  function parseWebdavListing(xml, cfg) {
    const rootText = `${String(cfg.davUrl || "").replace(/\/+$/, "")}${normDav(cfg.davFolder)}`;
    const rootUrl = new URL(rootText);
    const rootPath = decodeURIComponent(rootUrl.pathname).replace(/\/+$/, "");
    const baseUrl = rootUrl.href.endsWith("/") ? rootUrl.href : `${rootUrl.href}/`;
    const responsePattern = /<(?:[A-Za-z_][\w.-]*:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?response\s*>/gi;
    const entries = [];
    for (const match of String(xml || "").matchAll(responsePattern)) {
      const block = match[1];
      const href = webdavXmlText(webdavTagBody(block, "href"));
      if (!href) continue;
      const responseStatus = webdavXmlText(webdavTagBody(block, "status"));
      if (responseStatus && !/\s2\d\d\s/.test(`${responseStatus} `)) continue;
      try {
        const target = new URL(href, baseUrl);
        if (target.origin !== rootUrl.origin) continue;
        const targetPath = decodeURIComponent(target.pathname).replace(/\/+$/, "");
        let path = "";
        if (targetPath === rootPath) path = "";
        else if (targetPath.startsWith(`${rootPath}/`))
          path = targetPath.slice(rootPath.length + 1);
        else continue;
        const resourceType = webdavTagBody(block, "resourcetype");
        entries.push({
          path,
          isCollection: /<(?:[A-Za-z_][\w.-]*:)?collection\b/i.test(resourceType),
          size: Number(webdavXmlText(webdavTagBody(block, "getcontentlength")) || 0),
          modifiedTime: webdavXmlText(webdavTagBody(block, "getlastmodified")),
        });
      } catch {
        // Ignore malformed or unrelated provider responses, never use them as a
        // delete path.
      }
    }
    return entries;
  }
  const WEBDAV_PROPFIND_BODY =
    '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';
  async function davListPackageFiles(cfg) {
    const out = [];
    let directories = ["extensions"];
    for (let depth = 0; depth < 3 && directories.length; depth += 1) {
      const next = [];
      for (const directory of directories) {
        const response = await dav(cfg, directory, {
          method: "PROPFIND",
          headers: {
            Depth: "1",
            "Content-Type": "application/xml; charset=UTF-8",
          },
          body: WEBDAV_PROPFIND_BODY,
        });
        if (response.status === 404) continue;
        if (![200, 207].includes(response.status))
          throw Error(`WebDAV listing failed: HTTP ${response.status}`);
        const entries = parseWebdavListing(await response.text(), cfg);
        for (const entry of entries) {
          if (!entry.path || entry.path === directory) continue;
          const parts = entry.path.split("/");
          if (
            entry.isCollection &&
            parts[0] === "extensions" &&
            parts.length > 1 &&
            parts.length <= 3
          ) {
            next.push(entry.path);
            continue;
          }
          if (!entry.isCollection && parts.length === 4 && parts[0] === "extensions") {
            const version = parts[2].replace(/^v/, "");
            if (PI().isPackagePath(entry.path, parts[1], version, parts[3]))
              out.push({
                path: entry.path,
                name: parts[3],
                size: entry.size,
                modifiedTime: entry.modifiedTime,
              });
          }
        }
      }
      directories = next;
    }
    return out;
  }
  const PI = () => window.CCSyncPackageIndex;
  const gdrive = window.CCSyncGdrivePackages.createGdrivePackages({
    request: (type, extra) => CCSyncRuntime.request(type, extra),
    storageGet: (keys) => CCSyncRuntime.storageGet(keys),
    storageSet: (values) => CCSyncRuntime.storageSet(values),
    fetch: (url, init) => fetch(url, init),
    t,
    cacheKeys: KC,
  });
  const gdriveSession = () => gdrive.session();
  const gdriveDestination = (cfg) => gdrive.destination(cfg);
  const gdriveUpload = (cfg, relative, bytes, mimeType) =>
    gdrive.upload(cfg, relative, bytes, mimeType);
  const gdriveDownload = (cfg, relative) => gdrive.download(cfg, relative);
  const gdriveRemove = (cfg, relative) => gdrive.remove(cfg, relative);
  const gdriveReadJson = (cfg, relative, fallback) =>
    gdrive.readJson(cfg, relative, fallback);
  const gdriveWriteJson = (cfg, relative, value) =>
    gdrive.writeJson(cfg, relative, value);
  const gdriveListPackages = (cfg) => gdrive.listPackages(cfg);

  async function readIndex(cfg) {
    const pi = PI();
    if (cfg.backend === "gdrive")
      return pi.normalizeIndex(
        await gdriveReadJson(cfg, "index.json", pi.emptyIndex()),
      );
    if (cfg.backend === "github")
      return pi.normalizeIndex(
        await githubReadJson(
          cfg,
          join(normFolder(cfg.folder), "index.json"),
          pi.emptyIndex(),
        ),
      );
    try {
      return pi.normalizeIndex(
        JSON.parse(decode(await davGet(cfg, "index.json"))),
      );
    } catch (e) {
      if (String(e?.message || "").includes("HTTP 404")) return pi.emptyIndex();
      throw e;
    }
  }
  async function writeIndex(cfg, index) {
    const bytes = new TextEncoder().encode(JSON.stringify(index, null, 2));
    if (cfg.backend === "gdrive")
      return gdriveUpload(cfg, "index.json", bytes, "application/json");
    return cfg.backend === "github"
      ? githubPut(
          cfg,
          join(normFolder(cfg.folder), "index.json"),
          bytes,
          "Update extension backup index",
        )
      : davPut(cfg, "index.json", bytes, "application/json");
  }
  async function listBackups(cfg) {
    const pi = PI();
    const index = await readIndex(cfg);
    const listing =
      cfg.backend === "gdrive"
        ? await gdriveListPackages(cfg)
        : cfg.backend === "github"
          ? await githubListPackageFiles(cfg)
          : await davListPackageFiles(cfg);
    const merged = pi.mergeIndexWithListing(index, listing);
    return {
      schemaVersion: merged.schemaVersion,
      updatedAt: merged.updatedAt,
      backups: [...merged.backups.slice().reverse(), ...merged.unindexed],
      unindexed: merged.unindexed,
      missing: merged.missing,
    };
  }
  async function readSelection(cfg) {
    if (cfg.backend === "gdrive") {
      const x = await gdriveReadJson(cfg, "selection.json", null);
      return Array.isArray(x?.selectedIds) ? x.selectedIds.map(String) : null;
    }
    if (cfg.backend === "github") {
      return githubReadJson(
        cfg,
        join(normFolder(cfg.folder), "selection.json"),
        null,
      ).then((x) =>
        Array.isArray(x?.selectedIds) ? x.selectedIds.map(String) : null,
      );
    }
    try {
      const x = JSON.parse(decode(await davGet(cfg, "selection.json")));
      return Array.isArray(x?.selectedIds) ? x.selectedIds.map(String) : null;
    } catch (e) {
      if (String(e?.message || "").includes("HTTP 404")) return null;
      throw e;
    }
  }
  async function writeSelection(cfg, ids) {
    const payload = {
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      selectedIds: [...new Set(ids.map(String))].sort(),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    if (cfg.backend === "gdrive")
      return gdriveUpload(cfg, "selection.json", bytes, "application/json");
    return cfg.backend === "github"
      ? githubPut(
          cfg,
          join(normFolder(cfg.folder), "selection.json"),
          bytes,
          "Update extension backup selection",
        )
      : davPut(cfg, "selection.json", bytes, "application/json");
  }
  /**
   * Store one package.
   *
   * `options.index` lets a batch pass the index it already read forward, so
   * backing up twenty extensions does not re-read the index twenty times while
   * still writing a cumulative one. `options.origin` records where the bytes
   * came from, which distinguishes a package this extension built from local
   * unpacked files from an archive the user uploaded.
   */
  async function putPackage(cfg, ext, bytes, fileName, options = {}) {
    const pi = PI(),
      limit = backendMaxBytes(cfg);
    if (!/\.(crx|zip)$/i.test(String(fileName || "")))
      throw Error(t("packageFormatInvalid"));
    if (bytes.length > limit) throw Error(backendMaxMessage(cfg));
    const hash = await sha256(bytes),
      index = options.index
        ? pi.normalizeIndex(options.index)
        : await readIndex(cfg),
      folder = pi.packageFolder(ext.id, ext.version || ""),
      existing = pi.findIndexEntry(index, {
        extensionId: ext.id,
        version: ext.version || "",
        sha256: hash,
      }),
      reusable =
        existing &&
        pi.isPackagePath(
          existing.path,
          existing.extensionId,
          existing.version,
          existing.fileName,
        )
          ? existing
          : null,
      taken = pi.takenNamesInFolder(index, ext.id, ext.version || ""),
      // Same bytes always reuse their original location. Otherwise a retry
      // would suffix the filename again and strand the previous cloud object.
      safeName = reusable?.fileName || pi.resolveUniqueFileName(seg(fileName), taken, hash),
      path = reusable?.path || pi.join(folder, safeName),
      item = pi.buildPackageRecord({
        extension: ext,
        fileName: safeName,
        size: bytes.length,
        sha256: hash,
        path,
        storedAt: new Date().toISOString(),
        backend: cfg.backend,
        origin: String(options.origin || ""),
      }),
      metadata = pi.packageMetadata(item),
      metadataBytes = new TextEncoder().encode(
        JSON.stringify(metadata, null, 2),
      ),
      packageType =
        item.format === "zip"
          ? "application/zip"
          : "application/x-chrome-extension";
    if (cfg.backend === "gdrive") {
      await gdriveUpload(cfg, path, bytes, packageType);
      await gdriveWriteJson(cfg, pi.join(folder, "metadata.json"), metadata);
    } else if (cfg.backend === "github") {
      const root = normFolder(cfg.folder);
      await githubPut(
        cfg,
        join(root, path),
        bytes,
        `Back up ${item.name} v${item.version}`,
      );
      await githubPut(
        cfg,
        join(root, folder, "metadata.json"),
        metadataBytes,
        "Update extension backup metadata",
      );
    } else {
      await davPut(cfg, path, bytes, packageType);
      await davPut(
        cfg,
        join(folder, "metadata.json"),
        metadataBytes,
        "application/json",
      );
    }
    await writeIndex(cfg, pi.upsertIndexEntry(index, item));
    return item;
  }
  function backendMaxBytes(cfg) {
    return cfg?.backend === "github" ? MAX : Number.MAX_SAFE_INTEGER;
  }
  function backendMaxMessage(cfg) {
    return cfg?.backend === "github"
      ? t("max")
      : zh()
        ? "扩展包超过当前存储后端允许的大小。"
        : "The package exceeds the size allowed by the selected storage backend.";
  }
  async function getPackage(cfg, item) {
    if (cfg.backend === "gdrive") return gdriveDownload(cfg, item.path);
    return cfg.backend === "github"
      ? githubRaw(
          cfg,
          `/repos/${normRepo(cfg.repo)}/contents/${join(normFolder(cfg.folder), item.path)}`,
        )
      : davGet(cfg, item.path);
  }
  async function removePackagePath(cfg, relative, message) {
    if (cfg.backend === "gdrive") return gdriveRemove(cfg, relative);
    if (cfg.backend === "github")
      return githubDelete(
        cfg,
        join(normFolder(cfg.folder), relative),
        message || "Remove unused extension package",
      );
    return davDelete(cfg, relative);
  }
  const sameIds = (left, right) =>
    [...new Set((Array.isArray(left) ? left : []).map(String))].sort().join("\n") ===
    [...new Set((Array.isArray(right) ? right : []).map(String))].sort().join("\n");

  /**
   * Remove only unselected, validated package files. Selection is a user-owned
   * cloud manifest: deselecting never deletes data implicitly; this maintenance
   * action first verifies that the saved selection has not changed elsewhere.
   */
  async function cleanupUnusedBackups(cfg, expectedSelectedIds) {
    const current = await getCfg();
    if (!sameStorageConfig(current, cfg)) throw Error(t("selectionNeedSave"));
    const selectedIds = await readSelection(cfg);
    if (
      !Array.isArray(selectedIds) ||
      !sameIds(selectedIds, expectedSelectedIds)
    )
      throw Error(t("saveSelectionFirst"));

    const pi = PI();
    const listed = await listBackups(cfg);
    const candidates = pi.findUnusedPackages(listed.backups, selectedIds);
    if (!candidates.length) return { cleaned: 0, failed: 0, size: 0 };

    const index = await readIndex(cfg);
    const removedPaths = new Set();
    const changedFolders = new Set();
    const packageFailures = [];
    const metadataFailures = [];
    let size = 0;

    for (const item of candidates) {
      const path = String(item.path);
      try {
        // Drive can tell us a file is already missing. Other providers report
        // that case through their normal delete/not-found response.
        if (!listed.missing?.includes(path) && item.present !== false)
          await removePackagePath(cfg, path, `Remove unused package ${item.name || item.extensionId}`);
        removedPaths.add(path);
        size += Number(item.size || 0);
        changedFolders.add(pi.packageFolder(item.extensionId, item.version || ""));
      } catch (error) {
        packageFailures.push({ path, error });
      }
    }

    const nextIndex = pi.removeIndexEntries(index, removedPaths);
    if (removedPaths.size) await writeIndex(cfg, nextIndex);

    // metadata.json is a small sidecar per extension/version. Keep it aligned
    // with the newest surviving package, or remove it when the folder is empty.
    for (const folder of changedFolders) {
      const remaining = nextIndex.backups
        .filter(
          (item) =>
            item.path.startsWith(`${folder}/`) &&
            pi.isPackagePath(item.path, item.extensionId, item.version, item.fileName),
        )
        .sort((a, b) => Date.parse(a.storedAt || "") - Date.parse(b.storedAt || ""));
      const sidecar = pi.join(folder, "metadata.json");
      try {
        if (remaining.length) {
          const record = remaining[remaining.length - 1];
          const bytes = new TextEncoder().encode(
            JSON.stringify(pi.packageMetadata(record), null, 2),
          );
          if (cfg.backend === "gdrive")
            await gdriveUpload(cfg, sidecar, bytes, "application/json");
          else if (cfg.backend === "github")
            await githubPut(
              cfg,
              join(normFolder(cfg.folder), sidecar),
              bytes,
              "Update extension backup metadata",
            );
          else await davPut(cfg, sidecar, bytes, "application/json");
        } else {
          await removePackagePath(cfg, sidecar, "Remove unused extension metadata");
        }
      } catch (error) {
        metadataFailures.push({ path: sidecar, error });
      }
    }

    return {
      cleaned: removedPaths.size,
      failed: packageFailures.length,
      metadataFailed: metadataFailures.length,
      size,
      failures: [...packageFailures, ...metadataFailures],
    };
  }
  async function test(cfg) {
    if (cfg.backend === "disabled") return true;
    if (cfg.backend === "gdrive") {
      const session = await gdriveSession();
      if (!session?.token) throw Error(t("gdriveNotConnected"));
      await gdriveDestination(cfg);
      await gdriveReadJson(cfg, "index.json", PI().emptyIndex());
      return true;
    }
    if (cfg.backend === "github") {
      await githubInfo(cfg);
      return true;
    }
    if (cfg.backend === "webdav") {
      if (!cfg.davUrl) throw Error(t("needDav"));
      const r = await dav(cfg, "index.json", { method: "GET" });
      if (![200, 206, 404].includes(r.status))
        throw Error(`WebDAV connection failed: HTTP ${r.status}`);
      return true;
    }
    throw Error("Unsupported storage backend.");
  }
  async function getInstalled() {
    return (await chrome.management.getAll())
      .filter((x) => x.type === "extension" && x.id !== chrome.runtime.id)
      .sort((a, b) =>
        String(a.name || a.id).localeCompare(String(b.name || b.id)),
      );
  }
  function field(label, id, type = "text", placeholder = "") {
    const l = document.createElement("label");
    l.className = "field-label";
    const s = document.createElement("span");
    s.className = "field-label-text";
    s.textContent = label;
    const i = document.createElement("input");
    i.className = "field";
    i.id = id;
    i.type = type;
    i.placeholder = placeholder;
    l.append(s, i);
    return { l, i, s };
  }
  const SOURCE_LABELS = {
    "chrome-web-store": "sourceChromeWebStore",
    "edge-add-ons": "sourceEdgeAddOns",
    "self-hosted": "sourceSelfHosted",
    unpacked: "sourceUnpacked",
    "side-loaded": "sourceSideLoaded",
    policy: "sourcePolicy",
  };
  function sourceLabel(source) {
    const key = SOURCE_LABELS[String(source || "")];
    return key ? t(key) : String(source || t("sourceUnknown"));
  }
  function fmtDate(value) {
    const when = new Date(value);
    return Number.isNaN(when.getTime())
      ? String(value || "")
      : when.toLocaleString();
  }
  function addStyles() {
    if ($("ccsync-extension-storage-styles")) return;
    const s = document.createElement("style");
    s.id = "ccsync-extension-storage-styles";
    s.textContent =
      ".ccsync-ext-grid{display:grid;gap:10px}.ccsync-ext-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.ccsync-ext-note{color:var(--text-2);font-size:12px;line-height:1.55;margin-top:8px}.ccsync-ext-selection,.ccsync-ext-cloud{margin-top:18px;border-top:1px solid var(--line);padding-top:14px}.ccsync-ext-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.ccsync-ext-tools{display:flex;gap:6px;flex-wrap:wrap}.ccsync-ext-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.ccsync-ext-row:first-child{border-top:0}.ccsync-ext-name{font-size:13px;font-weight:600;overflow-wrap:anywhere}.ccsync-ext-meta{font-size:11px;color:var(--text-2);margin-top:2px;overflow-wrap:anywhere}.ccsync-ext-status{font-size:12px;line-height:1.55;margin-top:10px}.ccsync-ext-status.ok{color:var(--success)}.ccsync-ext-status.error{color:var(--danger)}.ccsync-ext-cloud-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.ccsync-ext-cloud-name{font-size:13px;font-weight:600}.ccsync-ext-cloud-meta{font-size:11px;color:var(--text-2);margin-top:2px}.ccsync-ext-token-help{font-size:12px;line-height:1.55;color:var(--text-2)}.ccsync-ext-hidden{display:none!important}.ccsync-ext-search{max-width:220px}.ccsync-ext-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}.ccsync-ext-chip{display:inline-block;font-size:11px;line-height:1.6;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--text-2);white-space:nowrap}.ccsync-ext-chip.ok{color:var(--success);border-color:color-mix(in srgb,var(--success) 45%,var(--line))}.ccsync-ext-chip.warn{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 45%,var(--line))}.ccsync-ext-row[hidden]{display:none!important}.ccsync-ext-drop{outline:2px dashed var(--accent,#315efb);outline-offset:6px;border-radius:8px}.ccsync-ext-modal{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.55)}.ccsync-ext-modal[hidden]{display:none}.ccsync-ext-modal-card{display:flex;flex-direction:column;width:100%;max-width:760px;max-height:86vh;background:var(--surface,#fff);color:var(--text-1,#0f172a);border:1px solid var(--line);border-radius:14px;box-shadow:0 24px 60px rgba(15,23,42,.3)}.ccsync-ext-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line)}.ccsync-ext-modal-body{padding:6px 18px 12px;overflow:auto}.ccsync-ext-modal-foot{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;padding:14px 18px;border-top:1px solid var(--line)}.ccsync-ext-local-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.ccsync-ext-local-row:first-child{border-top:0}@media(max-width:600px){.ccsync-ext-row,.ccsync-ext-cloud-row,.ccsync-ext-local-row{grid-template-columns:1fr}.ccsync-ext-row input[type=checkbox]{justify-self:start}.ccsync-ext-row .secondary{justify-self:start}}";
    document.head.appendChild(s);
  }
  function setHidden(el, hidden) {
    if (!el) return;
    el.hidden = hidden;
    el.classList.toggle("ccsync-ext-hidden", hidden);
  }
  // Keep the pending package request outside the input element so calling
  // input.click() can stay synchronous in the user's click handler. Chromium
  // blocks file pickers opened after an awaited storage read loses user
  // activation.
  let pendingPackageUpload = null;
  function fileInput() {
    let input = $("ccsyncExtensionPackageInput");
    if (input) return input;
    input = document.createElement("input");
    input.type = "file";
    input.id = "ccsyncExtensionPackageInput";
    input.accept = ".crx,.zip,application/zip,application/x-chrome-extension";
    input.hidden = true;
    document.body.append(input);
    input.addEventListener("change", async () => {
      const request = pendingPackageUpload,
        file = input.files?.[0];
      pendingPackageUpload = null;
      input.value = "";
      if (!request || !file) return;
      const { id, name, version, cfg: expectedCfg, verifyForm } = request;
      let button = null;
      try {
        const cfg = await getCfg();
        if (
          !sameStorageConfig(cfg, expectedCfg) ||
          (verifyForm && !sameStorageConfig(uiCfg(cfg), cfg))
        ) {
          alert(t("selectionNeedSave"));
          return;
        }
        if (cfg.backend === "disabled") {
          alert(
            zh()
              ? "请先保存并启用第三方扩展云存储。"
              : "Save and enable third-party extension cloud storage first.",
          );
          return;
        }
        button = document.querySelector(
          `[data-backup-for="${CSS.escape(id)}"]`,
        );
        if (button) {
          button.disabled = true;
          button.textContent = t("uploading");
        }
        const remoteSelection = await readSelection(cfg);
        await putPackage(
          cfg,
          { id, name, version },
          new Uint8Array(await file.arrayBuffer()),
          file.name,
        );
        const selected = new Set(
          Array.isArray(remoteSelection) ? remoteSelection : cfg.selected,
        );
        selected.add(id);
        const selectedIds = [...selected];
        await CCSyncRuntime.storageSet({ [K.selected]: selectedIds });
        await writeSelection(cfg, selectedIds);
        if (button) {
          button.disabled = false;
          button.textContent = t("backup");
        }
        await render(cfg);
      } catch (e) {
        if (button) {
          button.disabled = false;
          button.textContent = t("backup");
        }
        alert(e.message || String(e));
      }
    });
    return input;
  }
  function uiCfg(saved) {
    return {
      ...saved,
      backend: $("extensionStorageBackend")?.value || saved.backend,
      repo: $("extensionStorageGithubRepo")?.value?.trim() || "",
      branch: $("extensionStorageGithubBranch")?.value?.trim() || "",
      folder: $("extensionStorageGithubFolder")?.value?.trim() || "",
      token: $("extensionStorageGithubToken")?.value?.trim() || "",
      davUrl: $("extensionStorageWebdavUrl")?.value?.trim() || "",
      davFolder: $("extensionStorageWebdavFolder")?.value?.trim() || "",
      davUser: $("extensionStorageWebdavUsername")?.value || "",
      davPass: $("extensionStorageWebdavPassword")?.value || "",
      gdriveFolder: $("extensionStorageGdriveFolder")?.value?.trim() || "",
    };
  }
  function sameStorageConfig(a, b) {
    if (!a || !b || a.backend !== b.backend) return false;
    if (a.backend === "github")
      return (
        normRepo(a.repo) === normRepo(b.repo) &&
        String(a.branch || "").trim() === String(b.branch || "").trim() &&
        normFolder(a.folder) === normFolder(b.folder) &&
        String(a.token || "").trim() === String(b.token || "").trim()
      );
    if (a.backend === "webdav")
      return (
        String(a.davUrl || "").trim() === String(b.davUrl || "").trim() &&
        normDav(a.davFolder) === normDav(b.davFolder) &&
        String(a.davUser || "") === String(b.davUser || "") &&
        String(a.davPass || "") === String(b.davPass || "")
      );
    if (a.backend === "gdrive")
      return normFolder(a.gdriveFolder) === normFolder(b.gdriveFolder);
    return true;
  }
  let refreshLanguage = () => {};
  async function initOptions() {
    addStyles();
    fileInput();
    const host = $("extensionStorageHost");
    if (!host || $("extensionStorageSettings")) return;
    try {
      await window.CCSyncI18n?.initI18n?.();
    } catch {}
    const saved = await getCfg();
    const card = document.createElement("div");
    card.id = "extensionStorageSettings";
    card.className = "subcard";
    host.append(card);
    const title = document.createElement("div");
    title.className = "subcard-title";
    const desc = document.createElement("p");
    desc.className = "subcard-desc";
    card.append(title, desc);
    const grid = document.createElement("div");
    grid.className = "ccsync-ext-grid";
    const backend = field(t("backend"), "extensionStorageBackend");
    backend.i.outerHTML = `<select class="field" id="extensionStorageBackend"><option value="disabled">${t("disabled")}</option><option value="github">${t("github")}</option><option value="webdav">WebDAV</option><option value="gdrive">${t("gdrive")}</option></select>`;
    backend.i = backend.l.querySelector("select");
    const repo = field(
        t("repo"),
        "extensionStorageGithubRepo",
        "text",
        "owner/repository",
      ),
      branch = field(t("branch"), "extensionStorageGithubBranch"),
      folder = field(
        t("folder"),
        "extensionStorageGithubFolder",
        "text",
        zh() ? "留空 = 根目录" : "Leave blank = root directory",
      ),
      token = field(
        t("token"),
        "extensionStorageGithubToken",
        "password",
        "github_pat_…",
      );
    const tokenHelp = document.createElement("div");
    tokenHelp.className = "ccsync-ext-token-help";
    const tokenLink = document.createElement("a");
    tokenLink.href =
      "https://github.com/settings/personal-access-tokens/new?name=ChromiumCloudSync%20Extension%20Backup&description=Private%20CRX%20ZIP%20backup";
    tokenLink.target = "_blank";
    tokenLink.rel = "noopener noreferrer";
    tokenLink.className = "ccsync-ext-storage-link";
    tokenHelp.append(tokenLink);
    const davUrl = field(
        t("davUrl"),
        "extensionStorageWebdavUrl",
        "url",
        "https://example.com/dav",
      ),
      davFolder = field(
        t("davFolder"),
        "extensionStorageWebdavFolder",
        "text",
        zh() ? "留空 = 根目录" : "Leave blank = root directory",
      ),
      user = field(t("user"), "extensionStorageWebdavUsername"),
      pass = field(t("pass"), "extensionStorageWebdavPassword", "password");
    const gdriveFolder = field(
      t("gdriveFolder"),
      "extensionStorageGdriveFolder",
      "text",
      zh() ? "留空 = 应用托管根目录" : "Leave blank = app-managed root",
    );
    const gdriveGuide = document.createElement("div");
    gdriveGuide.className = "ccsync-ext-token-help";
    gdriveGuide.id = "ccsyncGdrivePackageGuide";
    const gdriveHelp = document.createElement("div");
    gdriveHelp.className = "ccsync-ext-token-help";
    const gdriveState = document.createElement("div");
    gdriveState.className = "ccsync-ext-token-help";
    gdriveState.id = "ccsyncGdrivePackageState";
    grid.append(
      backend.l,
      repo.l,
      branch.l,
      folder.l,
      token.l,
      tokenHelp,
      davUrl.l,
      davFolder.l,
      user.l,
      pass.l,
      gdriveFolder.l,
      gdriveGuide,
      gdriveHelp,
      gdriveState,
    );
    card.append(grid);
    const actions = document.createElement("div");
    actions.className = "ccsync-ext-actions";
    const testBtn = document.createElement("button");
    testBtn.className = "secondary";
    testBtn.type = "button";
    const saveBtn = document.createElement("button");
    saveBtn.className = "primary";
    saveBtn.type = "button";
    actions.append(testBtn, saveBtn);
    card.append(actions);
    const status = document.createElement("div");
    status.className = "ccsync-ext-status";
    status.hidden = true;
    card.append(status);
    const note = document.createElement("div");
    note.className = "ccsync-ext-note";
    card.append(note);
    backend.i.value = saved.backend;
    repo.i.value = saved.repo;
    branch.i.value = saved.branch;
    folder.i.value = saved.folder;
    token.i.value = saved.token;
    davUrl.i.value = saved.davUrl;
    davFolder.i.value = saved.davFolder;
    user.i.value = saved.davUser;
    pass.i.value = saved.davPass;
    gdriveFolder.i.value = saved.gdriveFolder;
    const refreshOuterText = () => {
      const nav = $("extensionStorageNavLabel"),
        pt = $("extensionStoragePanelTitle"),
        pd = $("extensionStoragePanelDescription");
      if (nav) nav.textContent = t("nav");
      if (pt) pt.textContent = t("panelTitle");
      if (pd) pd.textContent = t("panelDesc");
    };
    const refreshSettingsText = () => {
      refreshOuterText();
      title.textContent = t("title");
      desc.textContent = t("desc");
      backend.s.textContent = t("backend");
      backend.i.querySelector('option[value="disabled"]').textContent =
        t("disabled");
      backend.i.querySelector('option[value="github"]').textContent =
        t("github");
      backend.i.querySelector('option[value="gdrive"]').textContent =
        t("gdrive");
      repo.s.textContent = t("repo");
      branch.s.textContent = t("branch");
      folder.s.textContent = t("folder");
      token.s.textContent = t("token");
      tokenHelp.textContent = t("tokenHelp");
      tokenHelp.append(" ", tokenLink);
      tokenLink.textContent = t("tokenLink");
      davUrl.s.textContent = t("davUrl");
      davFolder.s.textContent = t("davFolder");
      user.s.textContent = t("user");
      pass.s.textContent = t("pass");
      gdriveFolder.s.textContent = t("gdriveFolder");
      gdriveGuide.textContent = t("gdriveGuide");
      gdriveHelp.textContent = `${t("gdriveHelp")} ${t("gdriveSeparate")}`;
      gdriveFolder.i.placeholder = zh()
        ? "留空 = 应用托管根目录"
        : "Leave blank = app-managed root";
      void refreshGdriveState();
      testBtn.textContent = t("test");
      saveBtn.textContent = t("save");
      note.textContent = t("manual");
      for (const input of [folder.i, davFolder.i])
        input.placeholder = zh()
          ? "留空 = 根目录"
          : "Leave blank = root directory";
    };
    const toggle = () => {
      const mode = backend.i.value,
        gh = mode === "github",
        dv = mode === "webdav",
        gd = mode === "gdrive",
        active = gh || dv || gd;
      for (const el of [repo.l, branch.l, folder.l, token.l, tokenHelp])
        setHidden(el, !gh);
      for (const el of [davUrl.l, davFolder.l, user.l, pass.l])
        setHidden(el, !dv);
      for (const el of [gdriveFolder.l, gdriveGuide, gdriveHelp, gdriveState])
        setHidden(el, !gd);
      setHidden(actions, false);
      setHidden(testBtn, !active);
      setHidden(note, !active);
      if (gd) void refreshGdriveState();
    };
    const refreshVisible = async () => {
      toggle();
      // The extension list and its actions must always use the persisted
      // backend configuration. Rendering the form draft here made a newly
      // selected backend look usable before its settings had been saved.
      await render(await getCfg());
    };
    backend.i.addEventListener("change", () => void refreshVisible());
    toggle();
    refreshSettingsText();
    refreshLanguage = async () => {
      refreshSettingsText();
      toggle();
      await render(await getCfg());
    };
    const report = (kind, message) => {
      status.hidden = false;
      status.className = `ccsync-ext-status ${kind}`;
      status.textContent = message;
      // Also surface errors on the options page's shared feedback banner so a
      // narrow settings view cannot hide the failure below the fold.
      if (typeof window.CCSyncOptionsFeedback === "function") {
        window.CCSyncOptionsFeedback(kind, message);
      }
    };
    testBtn.addEventListener("click", async () => {
      try {
        testBtn.disabled = true;
        report("", zh() ? "正在测试…" : "Testing…");
        await test(uiCfg(saved));
        report("ok", t("tested"));
      } catch (e) {
        report("error", e.message || String(e));
      } finally {
        testBtn.disabled = false;
      }
    });
    saveBtn.addEventListener("click", async () => {
      try {
        saveBtn.disabled = true;
        // Re-read the form every time so we never save a stale snapshot of
        // fields that were typed after the initial render.
        const next = uiCfg(await getCfg());
        if (next.backend === "github") {
          next.repo = normRepo(next.repo);
          next.folder = normFolder(next.folder);
          if (!next.token) throw Error(t("needToken"));
          await githubInfo(next);
        } else if (next.backend === "webdav") {
          next.davUrl = String(next.davUrl).trim();
          next.davFolder = normDav(next.davFolder);
          if (!next.davUrl) throw Error(t("needDav"));
        } else if (next.backend === "gdrive") {
          next.gdriveFolder = normFolder(next.gdriveFolder);
          await test(next);
        } else {
          next.repo = "";
          next.branch = "";
          next.folder = "";
          next.token = "";
          next.davUrl = "";
          next.davFolder = "";
          next.davUser = "";
          next.davPass = "";
          next.gdriveFolder = "";
        }
        await CCSyncRuntime.storageSet({
          [K.backend]: next.backend,
          [K.repo]: next.repo,
          [K.branch]: next.branch,
          [K.folder]: next.folder,
          [K.token]: next.token,
          [K.davUrl]: next.davUrl,
          [K.davFolder]: next.davFolder,
          [K.davUser]: next.davUser,
          [K.davPass]: next.davPass,
          [K.gdriveFolder]: next.gdriveFolder,
        });
        Object.assign(saved, await getCfg());
        report("ok", t("saved"));
        refreshSettingsText();
        toggle();
        await render({ ...saved });
      } catch (e) {
        report("error", e.message || String(e));
      } finally {
        saveBtn.disabled = false;
      }
    });
    // Load the saved package-backup view on page open as well. Without this,
    // users only saw the list after changing the backend selector, which could
    // accidentally render unsaved form values as though they were active.
    await render(saved);
    // Resolving the remembered folder's permission here keeps the folder
    // button's click handler free of awaits, which Chromium's directory picker
    // requires.
    void loadRememberedRoot();
  }
  async function refreshGdriveState() {
    const el = $("ccsyncGdrivePackageState");
    if (!el) return;
    try {
      const session = await CCSyncRuntime.request("gdrivePackageSession");
      el.textContent = session?.email
        ? t("gdriveConnectedAs").replace("{email}", session.email)
        : t("gdrive");
      el.classList.remove("error");
    } catch {
      el.textContent = t("gdriveNotConnected");
      el.classList.add("error");
    }
  }

  /* ------------------------------------------------------------------ *
   * Local extension sources.
   *
   * Chromium will not hand one extension another extension's files, but the
   * user can point this page at the folder that holds them — the browser
   * user-data directory, a single `Extensions` directory, or an unpacked
   * source tree — once. Everything selected in the backup list that can be
   * found there is packaged and uploaded in one pass, which replaces the
   * per-extension CRX/ZIP picker for the common case.
   * ------------------------------------------------------------------ */

  const LS = () => window.CCSyncExtensionLocalSource;
  const LOCAL_ROOT_KEY = "ccsync-local-extension-root";
  /** Latest successful folder scan; feeds the "found locally" row chips. */
  let lastLocalScan = null;
  /**
   * Debounced selection write. Module level so a re-render can cancel a save
   * that still closes over the previous list: writing it afterwards would
   * restore checkboxes the user has already changed.
   */
  let selectionSaveTimer = null;
  /**
   * Remembered folder plus its permission state.
   *
   * Chromium's directory picker needs the user gesture that opened it, so the
   * decision "reuse the remembered folder or open the picker" has to be made
   * synchronously inside the click handler. The permission state is resolved
   * once at page load instead of on click, which keeps that decision free of
   * `await`.
   */
  let rememberedRoot = null;

  /* ------------------------------ IndexedDB ------------------------------ */

  /**
   * A directory handle is a live object, so it cannot live in
   * `chrome.storage.local`. It is kept in IndexedDB instead, which also means
   * the remembered folder survives browser restarts.
   */
  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined")
        return reject(Error("indexedDB is unavailable"));
      let request;
      try {
        request = indexedDB.open("ccsync-extension-backup", 1);
      } catch (error) {
        return reject(error);
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("local-roots"))
          db.createObjectStore("local-roots");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error("indexedDB failed"));
      request.onblocked = () => reject(Error("indexedDB is blocked"));
    });
  }
  async function idbRead(key) {
    try {
      const db = await idbOpen();
      return await new Promise((resolve, reject) => {
        const request = db
          .transaction("local-roots", "readonly")
          .objectStore("local-roots")
          .get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }
  async function idbWrite(key, value) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("local-roots", "readwrite");
        tx.objectStore("local-roots").put(value, key);
        tx.oncomplete = () => resolve(null);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } catch {
      return false;
    }
  }
  async function idbRemove(key) {
    try {
      const db = await idbOpen();
      await new Promise((resolve, reject) => {
        const tx = db.transaction("local-roots", "readwrite");
        tx.objectStore("local-roots").delete(key);
        tx.oncomplete = () => resolve(null);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      /* Forgetting a folder is best effort. */
    }
  }

  /** Re-using a stored handle needs permission to be re-granted each session. */
  async function directoryPermission(handle) {
    if (!handle?.queryPermission) return "granted";
    try {
      const state = await handle.queryPermission({ mode: "read" });
      if (state !== "prompt" || typeof handle.requestPermission !== "function")
        return state;
      return await handle.requestPermission({ mode: "read" });
    } catch {
      return "denied";
    }
  }

  /** Resolve the remembered folder's permission once, away from any gesture. */
  async function loadRememberedRoot() {
    const stored = await idbRead(LOCAL_ROOT_KEY);
    if (!stored) {
      rememberedRoot = null;
      return;
    }
    const state = await directoryPermission(stored);
    rememberedRoot = { handle: stored, granted: state === "granted" };
  }

  function rememberRoot(handle) {
    rememberedRoot = { handle, granted: true };
    void idbWrite(LOCAL_ROOT_KEY, handle);
  }

  /**
   * Ask for one folder: the remembered one when it still has permission,
   * otherwise the platform picker (or a `webkitdirectory` input where the File
   * System Access API is missing).
   *
   * The picker is opened synchronously so Chromium still sees the click that
   * asked for it; only the scan that follows is awaited.
   */
  function pickLocalRoot() {
    if (rememberedRoot?.granted && rememberedRoot.handle)
      return Promise.resolve({
        name: String(rememberedRoot.handle.name || ""),
        remembered: true,
        scan: () => LS().scanDirectoryHandle(rememberedRoot.handle),
      });
    if (typeof window.showDirectoryPicker === "function") {
      const pending = window.showDirectoryPicker({
        mode: "read",
        id: LOCAL_ROOT_KEY,
      });
      return pending.then((handle) => {
        if (!handle) return null;
        rememberRoot(handle);
        return {
          name: String(handle.name || ""),
          remembered: false,
          scan: () => LS().scanDirectoryHandle(handle),
        };
      });
    }
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.hidden = true;
      input.setAttribute("webkitdirectory", "");
      document.body.append(input);
      input.addEventListener(
        "change",
        () => {
          const picked = Array.from(input.files || []);
          input.remove();
          if (!picked.length) return resolve(null);
          resolve({
            name: String(
              (picked[0]?.webkitRelativePath || "").split("/")[0] || "",
            ),
            remembered: false,
            scan: () => LS().scanPickedFiles(picked),
          });
        },
        { once: true },
      );
      input.click();
    });
  }

  /** Scan the picked folder and plan what can be backed up from it. */
  async function scanLocalRoot(installed) {
    const pick = await pickLocalRoot();
    if (!pick) return null;
    const scan = await pick.scan();
    if (!scan?.files?.length) return { ...pick, plan: null };
    const manifests = await LS().readLocalManifests(scan.files, { installed });
    const plan = LS().planLocalPackages({
      files: scan.files,
      manifests,
      installed,
    });
    return { ...pick, plan, rootName: scan.rootName };
  }

  /* -------------------------------- modal -------------------------------- */

  function openModal(titleText, descText) {
    const overlay = document.createElement("div");
    overlay.className = "ccsync-ext-modal";
    overlay.hidden = false;
    const card = document.createElement("div");
    card.className = "ccsync-ext-modal-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const head = document.createElement("div");
    head.className = "ccsync-ext-modal-head";
    const headText = document.createElement("div");
    const title = document.createElement("div");
    title.className = "subcard-title";
    title.textContent = titleText;
    const desc = document.createElement("div");
    desc.className = "ccsync-ext-note";
    desc.textContent = descText;
    headText.append(title, desc);
    const dismiss = document.createElement("button");
    dismiss.className = "secondary";
    dismiss.type = "button";
    dismiss.textContent = "×";
    dismiss.setAttribute("aria-label", t("localClose"));
    head.append(headText, dismiss);
    const body = document.createElement("div");
    body.className = "ccsync-ext-modal-body";
    const foot = document.createElement("div");
    foot.className = "ccsync-ext-modal-foot";
    card.append(head, body, foot);
    overlay.append(card);
    document.body.append(overlay);
    return { overlay, body, foot, dismiss };
  }

  /* --------------------------- local backup flow -------------------------- */

  /**
   * Package and upload every selected extension that exists on disk.
   *
   * The preview step matters: the user sees which extensions were found, under
   * which identity, and whether the cloud already holds the same bytes, before
   * anything is uploaded.
   */
  async function localBackupFlow(cfg, installed, selectedIds) {
    let scan = null;
    try {
      scan = await scanLocalRoot(installed);
    } catch (error) {
      // A dismissed directory picker surfaces as AbortError.
      if (error?.name === "AbortError") return null;
      alert(formatText(t("localScanFailed"), { error: error?.message || String(error) }));
      return null;
    }
    if (!scan) return null;
    lastLocalScan = scan;
    if (!scan.plan || !scan.plan.packages.length) {
      alert(t("localNothingFound"));
      return null;
    }
    const plan = scan.plan;
    let cloud = { backups: [] };
    try {
      cloud = await listBackups(cfg);
    } catch {
      cloud = { backups: [] };
    }
    const cloudById = new Map();
    for (const item of Array.isArray(cloud.backups) ? cloud.backups : []) {
      const id = String(item.extensionId || "");
      if (!id) continue;
      const current = cloudById.get(id);
      if (
        !current ||
        LS().compareVersions(String(item.version || ""), String(current.version || "")) >= 0
      )
        cloudById.set(id, item);
    }
    const selected = new Set((selectedIds || []).map(String));
    const modal = openModal(t("localPreviewTitle"), t("localPreviewDesc"));
    const rows = [];
    const body = modal.body;

    const ordered = [
      ...plan.packages.filter((item) => item.installed),
      ...plan.packages.filter((item) => !item.installed),
    ];
    for (const item of ordered) {
      const row = document.createElement("label");
      row.className = "ccsync-ext-local-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = item.installed ? selected.has(item.extensionId) : false;
      const main = document.createElement("div");
      const name = document.createElement("div");
      name.className = "ccsync-ext-name";
      name.textContent = item.name || item.extensionId;
      const meta = document.createElement("div");
      meta.className = "ccsync-ext-meta";
      const remote = cloudById.get(item.extensionId);
      const chips = [
        `v${item.version || "?"}`,
        formatText(t("localFiles"), {
          count: item.fileCount,
          size: fmt(item.totalSize),
        }),
        item.matchKind === "id"
          ? t("localMatchId")
          : item.matchKind === "manifest"
            ? t("localMatchManifest")
            : t("localMatchOrphan"),
        !remote
          ? t("localCloudNone")
          : String(remote.version || "") === String(item.version || "")
            ? t("localCloudSame")
            : formatText(t("localCloudOther"), { version: remote.version || "?" }),
        item.versionMismatch ? t("localVersionMismatch") : "",
      ].filter(Boolean);
      meta.textContent = chips.join(" · ");
      main.append(name, meta);
      const state = document.createElement("span");
      state.className = "ccsync-ext-chip";
      state.textContent = t("localItemPending");
      row.append(cb, main, state);
      body.append(row);
      rows.push({ item, cb, state });
    }

    if (plan.missing.length) {
      const note = document.createElement("div");
      note.className = "ccsync-ext-note";
      note.textContent = formatText(t("localMissing"), {
        count: plan.missing.length,
      });
      body.append(note);
    }
    if (scan.remembered) {
      const note = document.createElement("div");
      note.className = "ccsync-ext-note";
      note.textContent = formatText(t("localRemembered"), { name: scan.name });
      body.append(note);
    }

    const cancel = document.createElement("button");
    cancel.className = "secondary";
    cancel.type = "button";
    cancel.textContent = t("localCancel");
    const change = document.createElement("button");
    change.className = "secondary";
    change.type = "button";
    change.textContent = t("localChange");
    const forget = document.createElement("button");
    forget.className = "secondary";
    forget.type = "button";
    forget.textContent = t("localForget");
    forget.hidden = !scan.remembered;
    const start = document.createElement("button");
    start.className = "primary";
    start.type = "button";
    const chosen = () => rows.filter((row) => row.cb.checked);
    const refreshStart = () => {
      start.textContent = formatText(t("localStart"), {
        count: chosen().length,
      });
      start.disabled = chosen().length === 0;
    };
    rows.forEach((row) =>
      row.cb.addEventListener("change", () => refreshStart()),
    );
    refreshStart();
    const status = document.createElement("div");
    status.className = "ccsync-ext-note";
    modal.foot.append(change, forget, cancel, start);
    body.append(status);

    const decision = await new Promise((resolve) => {
      modal.dismiss.addEventListener("click", () => resolve(null), { once: true });
      cancel.addEventListener("click", () => resolve(null), { once: true });
      change.addEventListener("click", () => resolve("change"), { once: true });
      forget.addEventListener("click", async () => {
        rememberedRoot = null;
        await idbRemove(LOCAL_ROOT_KEY);
        forget.hidden = true;
      });
      start.addEventListener("click", () => resolve("start"), { once: true });
    });
    if (decision === "change") {
      // Drop the remembered folder so the next pass opens the picker again.
      rememberedRoot = null;
      modal.overlay.remove();
      return await localBackupFlow(cfg, installed, selectedIds);
    }
    if (decision !== "start") {
      modal.overlay.remove();
      return null;
    }
    return await runLocalBackup(cfg, chosen(), selected, {
      modal,
      rows,
      status,
      start,
      cancel,
      change,
      forget,
    });
  }

  /** Upload the chosen local packages, reporting per-item progress. */
  async function runLocalBackup(cfg, chosen, selected, ui) {
    const pi = PI();
    const total = chosen.length;
    let done = 0,
      skipped = 0,
      failed = 0,
      size = 0;
    const failures = [];
    let index = null;
    try {
      index = await readIndex(cfg);
    } catch {
      index = pi.emptyIndex();
    }
    ui.change.disabled = true;
    ui.forget.disabled = true;
    ui.start.disabled = true;
    ui.start.hidden = true;
    ui.cancel.textContent = t("localClose");
    for (const row of chosen) {
      row.cb.disabled = true;
      row.state.textContent = t("localItemWorking");
      row.state.className = "ccsync-ext-chip";
      ui.status.textContent = formatText(t("localProgress"), {
        done,
        total,
        name: row.item.name || row.item.extensionId,
      });
      try {
        const built = await LS().buildLocalPackage(row.item);
        const hash = await sha256(built.bytes);
        const existing = pi.findIndexEntry(index, {
          extensionId: row.item.extensionId,
          version: row.item.version,
          sha256: hash,
        });
        if (
          existing &&
          pi.isPackagePath(
            existing.path,
            existing.extensionId,
            existing.version,
            existing.fileName,
          )
        ) {
          // Identical bytes are already stored: keep the existing object.
          skipped += 1;
          row.state.textContent = t("localItemSkipped");
          row.state.className = "ccsync-ext-chip ok";
        } else {
          row.state.textContent = t("localItemUploading");
          const record = await putPackage(
            cfg,
            {
              id: row.item.extensionId,
              name: row.item.name || row.item.extensionId,
              version: row.item.version,
            },
            built.bytes,
            built.fileName,
            { index, origin: "local-unpacked" },
          );
          index = pi.upsertIndexEntry(index, record);
          done += 1;
          size += Number(record.size || 0);
          row.state.textContent = t("localItemDone");
          row.state.className = "ccsync-ext-chip ok";
        }
        selected.add(row.item.extensionId);
      } catch (error) {
        failed += 1;
        failures.push({
          name: row.item.name || row.item.extensionId,
          error:
            error?.message === "too-many-files"
              ? formatText(t("localTooManyFiles"), {
                  count: LS().MAX_PACKAGE_FILES,
                })
              : error?.message || String(error),
        });
        row.state.textContent = t("localItemFailed");
        row.state.className = "ccsync-ext-chip warn";
      }
    }
    for (const row of chosen) row.cb.disabled = false;
    const ids = [...selected];
    try {
      await CCSyncRuntime.storageSet({ [K.selected]: ids });
      if (cfg.backend !== "disabled") await writeSelection(cfg, ids);
    } catch {
      /* The cloud selection is re-saved by the next explicit change. */
    }
    ui.status.textContent = formatText(t("localSummary"), {
      done,
      skipped,
      failed,
      size: fmt(size),
    });
    if (failures.length)
      ui.status.textContent += ` ${failures
        .map((item) => `${item.name}: ${item.error}`)
        .join("; ")}`;
    await new Promise((resolve) => {
      ui.cancel.addEventListener("click", () => resolve(null), { once: true });
      ui.modal.dismiss.addEventListener("click", () => resolve(null), { once: true });
    });
    ui.modal.overlay.remove();
    await render(await getCfg());
    return { done, skipped, failed, size };
  }

  /* ---------------------------- batch uploading --------------------------- */

  /**
   * Upload several CRX/ZIP files at once.
   *
   * Each archive identifies its own extension — a CRX carries the ID, a ZIP
   * carries its manifest — so the user never has to rename files or pick an
   * extension first. Anything that cannot be identified is reported instead of
   * being filed under a guessed ID.
   */
  async function uploadPackageFiles(cfg, installed, files, baseSelectedIds) {
    const list = Array.from(files || []);
    if (!list.length) return null;
    const status = $("ccsyncExtUploadStatus");
    if (status) {
      status.hidden = false;
      status.className = "ccsync-ext-status";
      status.textContent = formatText(t("uploadProgress"), {
        done: 0,
        total: list.length,
      });
    }
    const selected = new Set(
      (Array.isArray(baseSelectedIds) && baseSelectedIds.length
        ? baseSelectedIds
        : Array.isArray(cfg.selected)
          ? cfg.selected
          : []
      ).map(String),
    );
    let uploaded = 0,
      failed = 0,
      at = 0;
    const unmatched = [];
    const problems = [];
    for (const file of list) {
      at += 1;
      if (status)
        status.textContent = formatText(t("uploadProgress"), {
          done: at - 1,
          total: list.length,
        });
      let bytes;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch {
        failed += 1;
        continue;
      }
      let target = null;
      try {
        const identified = await LS().identifyUploadedPackage({
          fileName: file.name,
          bytes,
          installed,
        });
        target = identified?.extension || null;
      } catch {
        target = null;
      }
      if (!target) {
        unmatched.push(file.name);
        continue;
      }
      try {
        await putPackage(cfg, target, bytes, file.name);
        uploaded += 1;
        selected.add(target.id);
      } catch (error) {
        failed += 1;
        problems.push(`${file.name}: ${error?.message || String(error)}`);
      }
    }
    try {
      await CCSyncRuntime.storageSet({ [K.selected]: [...selected] });
      if (cfg.backend !== "disabled") await writeSelection(cfg, [...selected]);
    } catch {
      /* Selection persistence is best effort here; the row state still shows. */
    }
    const message = [
      formatText(t("uploadSummary"), { uploaded, failed }),
      unmatched.length
        ? formatText(t("uploadUnmatched"), {
            count: unmatched.length,
            names: unmatched.slice(0, 5).join(", "),
          })
        : "",
      problems.length ? problems.slice(0, 5).join("; ") : "",
    ]
      .filter(Boolean)
      .join(" ");
    if (status) {
      status.className = `ccsync-ext-status ${failed || unmatched.length ? "error" : "ok"}`;
      status.textContent = message;
    }
    alert(message);
    await render(await getCfg());
    return { uploaded, failed, unmatched };
  }

  async function render(cfg) {
    const card = $("extensionStorageSettings");
    if (!card) return;
    if (selectionSaveTimer) {
      clearTimeout(selectionSaveTimer);
      selectionSaveTimer = null;
    }
    card
      .querySelectorAll(".ccsync-ext-selection,.ccsync-ext-cloud,.ccsync-ext-modal")
      .forEach((x) => x.remove());
    if (!cfg || cfg.backend === "disabled") return;
    const installed = await getInstalled();
    let selected = Array.isArray(cfg.selected) ? cfg.selected.map(String) : [];
    let savedSelectionIds = null;
    const persisted = await getCfg();
    if (sameStorageConfig(cfg, persisted)) {
      try {
        const remote = await readSelection(cfg);
        if (Array.isArray(remote)) {
          selected = remote.map(String);
          savedSelectionIds = remote.map(String);
        }
      } catch {
        savedSelectionIds = null;
      }
    }
    let cloudBackups = [];
    let missingPaths = new Set();
    const cloudById = new Map();
    try {
      const listed = await listBackups(cfg);
      cloudBackups = Array.isArray(listed.backups) ? listed.backups : [];
      missingPaths = new Set(
        (Array.isArray(listed.missing) ? listed.missing : []).map(String),
      );
    } catch {
      cloudBackups = [];
    }
    for (const item of cloudBackups) {
      const id = String(item.extensionId || "");
      if (!id) continue;
      const current = cloudById.get(id);
      if (
        !current ||
        LS().compareVersions(String(item.version || ""), String(current.version || "")) >= 0
      )
        cloudById.set(id, item);
    }
    const localById = new Map(
      (lastLocalScan?.plan?.packages || []).map((item) => [item.extensionId, item]),
    );
    const section = document.createElement("section");
    section.className = "ccsync-ext-selection";
    const head = document.createElement("div");
    head.className = "ccsync-ext-head";
    const copy = document.createElement("div");
    const title = document.createElement("div");
    title.className = "subcard-title";
    title.textContent = t("choose");
    const desc = document.createElement("div");
    desc.className = "ccsync-ext-note";
    desc.textContent = t("selectionHint");
    copy.append(title, desc);
    const tools = document.createElement("div");
    tools.className = "ccsync-ext-tools";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "field ccsync-ext-search";
    search.id = "ccsyncExtensionSearch";
    search.placeholder = t("searchPlaceholder");
    search.setAttribute("aria-label", t("search"));
    const all = document.createElement("button");
    all.className = "secondary";
    all.type = "button";
    all.textContent = t("all");
    const none = document.createElement("button");
    none.className = "secondary";
    none.type = "button";
    none.textContent = t("none");
    const invert = document.createElement("button");
    invert.className = "secondary";
    invert.type = "button";
    invert.textContent = t("invert");
    tools.append(search, all, none, invert);
    head.append(copy, tools);
    section.append(head);

    const list = document.createElement("div");
    const checks = new Map();
    const currentSelectionIds = () =>
      [...checks.entries()]
        .filter(([, checkbox]) => checkbox.checked)
        .map(([id]) => id);
    const visibleIds = () =>
      installed
        .filter((ext) => matchesFilter(ext, search.value))
        .map((ext) => ext.id);

    for (const ext of installed) {
      const row = document.createElement("label");
      row.className = "ccsync-ext-row";
      row.dataset.extensionId = ext.id;
      row.dataset.search = `${ext.name || ""} ${ext.id}`.toLowerCase();
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.includes(ext.id);
      cb.dataset.extensionId = ext.id;
      const main = document.createElement("div");
      const name = document.createElement("div");
      name.className = "ccsync-ext-name";
      name.textContent = ext.name || ext.id;
      const meta = document.createElement("div");
      meta.className = "ccsync-ext-meta";
      meta.textContent = `v${ext.version || "?"} · ${ext.installType || "unknown"} · ${ext.id}`;
      const chips = document.createElement("div");
      chips.className = "ccsync-ext-chips";
      const remote = cloudById.get(ext.id);
      const cloudChip = document.createElement("span");
      cloudChip.className = `ccsync-ext-chip${remote ? " ok" : ""}`;
      cloudChip.textContent = !remote
        ? t("cloudStateNone")
        : String(remote.version || "") === String(ext.version || "")
          ? formatText(t("cloudStateSame"), { version: remote.version || "?" })
          : formatText(t("cloudStateOther"), { version: remote.version || "?" });
      chips.append(cloudChip);
      if (localById.has(ext.id)) {
        const localChip = document.createElement("span");
        localChip.className = "ccsync-ext-chip ok";
        localChip.textContent = t("localChip");
        chips.append(localChip);
      }
      main.append(name, meta, chips);
      const b = document.createElement("button");
      b.className = "secondary";
      b.type = "button";
      b.textContent = t("backup");
      b.dataset.backupFor = ext.id;
      b.disabled = !cb.checked;
      b.addEventListener("click", (e) => {
        e.preventDefault();
        // Read the form synchronously, then open the native picker in this
        // click event. Awaiting chrome.storage.local first loses the transient
        // user activation required by Chromium's file chooser.
        if (!sameStorageConfig(uiCfg(cfg), cfg)) {
          alert(t("selectionNeedSave"));
          return;
        }
        if (cfg.backend === "disabled") {
          alert(
            zh()
              ? "请先保存并启用第三方扩展云存储。"
              : "Save and enable third-party extension cloud storage first.",
          );
          return;
        }
        pendingPackageUpload = {
          id: ext.id,
          name: ext.name || ext.id,
          version: ext.version || "",
          cfg: { ...cfg },
          verifyForm: Boolean($("extensionStorageBackend")),
        };
        fileInput().click();
      });
      cb.addEventListener("change", () => {
        b.disabled = !cb.checked;
        updateCount();
        queueSelectionSave();
      });
      checks.set(ext.id, cb);
      row.append(cb, main, b);
      list.append(row);
    }
    section.append(list);

    /* ------------------------------- toolbar ------------------------------ */
    function matchesFilter(ext, value) {
      const needle = String(value || "").trim().toLowerCase();
      if (!needle) return true;
      return (
        String(ext.name || "").toLowerCase().includes(needle) ||
        String(ext.id || "").toLowerCase().includes(needle)
      );
    }
    const applyFilter = () => {
      const visible = new Set(visibleIds());
      for (const row of list.querySelectorAll(".ccsync-ext-row"))
        row.hidden = !visible.has(row.dataset.extensionId);
      updateCount();
    };
    search.addEventListener("input", () => applyFilter());
    const setVisible = (value) => {
      for (const id of visibleIds()) {
        const cb = checks.get(id);
        if (!cb) continue;
        cb.checked = value;
        const button = cb
          .closest(".ccsync-ext-row")
          ?.querySelector("button[data-backup-for]");
        if (button) button.disabled = !value;
      }
      updateCount();
      queueSelectionSave();
    };
    all.addEventListener("click", () => setVisible(true));
    none.addEventListener("click", () => setVisible(false));
    invert.addEventListener("click", () => {
      for (const id of visibleIds()) {
        const cb = checks.get(id);
        if (!cb) continue;
        cb.checked = !cb.checked;
        const button = cb
          .closest(".ccsync-ext-row")
          ?.querySelector("button[data-backup-for]");
        if (button) button.disabled = !cb.checked;
      }
      updateCount();
      queueSelectionSave();
    });

    const count = document.createElement("div");
    count.className = "ccsync-ext-note";
    const saveState = document.createElement("div");
    saveState.className = "ccsync-ext-status";
    saveState.id = "ccsyncExtSelectionState";
    const uploadStatus = document.createElement("div");
    uploadStatus.className = "ccsync-ext-status";
    uploadStatus.id = "ccsyncExtUploadStatus";
    uploadStatus.hidden = true;
    section.append(count, saveState, uploadStatus);

    function updateCount() {
      const visible = visibleIds().length;
      const chosen = currentSelectionIds().length;
      count.textContent = formatText(t("selectedCount"), {
        selected: chosen,
        total: visible,
      });
    }
    let saving = false;
    function queueSelectionSave() {
      if (selectionSaveTimer) clearTimeout(selectionSaveTimer);
      saveState.hidden = false;
      saveState.className = "ccsync-ext-status";
      saveState.textContent = t("selectionSaving");
      selectionSaveTimer = setTimeout(() => void persistSelection(), 350);
    }
    async function persistSelection() {
      if (selectionSaveTimer) {
        clearTimeout(selectionSaveTimer);
        selectionSaveTimer = null;
      }
      if (saving) return;
      saving = true;
      const ids = currentSelectionIds();
      try {
        await CCSyncRuntime.storageSet({ [K.selected]: ids });
        if (cfg.backend !== "disabled") await writeSelection(cfg, ids);
        savedSelectionIds = ids;
        saveState.className = "ccsync-ext-status ok";
        saveState.textContent = t("selectionSaved");
        updateCleanupButton();
      } catch (error) {
        saveState.className = "ccsync-ext-status error";
        saveState.textContent = formatText(t("selectionSaveFailed"), {
          error: error?.message || String(error),
        });
      } finally {
        saving = false;
      }
    }
    saveState.hidden = false;
    saveState.className = "ccsync-ext-status";
    saveState.textContent = savedSelectionIds
      ? t("selectionSaved")
      : t("selectionUnsaved");

    /* ---------------------------- batch actions --------------------------- */
    const actions = document.createElement("div");
    actions.className = "ccsync-ext-actions";
    const localButton = document.createElement("button");
    localButton.className = "primary";
    localButton.type = "button";
    localButton.textContent = localById.size
      ? formatText(t("localButtonCount"), { count: localById.size })
      : t("localButton");
    localButton.addEventListener("click", async () => {
      localButton.disabled = true;
      const label = localButton.textContent;
      localButton.textContent = t("localButtonBusy");
      try {
        await localBackupFlow(cfg, installed, currentSelectionIds());
      } finally {
        localButton.disabled = false;
        localButton.textContent = label;
      }
    });
    const uploadMany = document.createElement("button");
    uploadMany.className = "secondary";
    uploadMany.type = "button";
    uploadMany.textContent = t("uploadMany");
    uploadMany.addEventListener("click", () => {
      pendingPackageUpload = {
        cfg: { ...cfg },
        verifyForm: Boolean($("extensionStorageBackend")),
        multiple: true,
      };
      batchFileInput().click();
    });
    actions.append(localButton, uploadMany);
    const hint = document.createElement("div");
    hint.className = "ccsync-ext-note";
    hint.textContent = `${t("localHint")} ${t("dropHint")}`;
    section.append(actions, hint);

    section.addEventListener("dragover", (event) => {
      event.preventDefault();
      section.classList.add("ccsync-ext-drop");
    });
    section.addEventListener("dragleave", () =>
      section.classList.remove("ccsync-ext-drop"),
    );
    section.addEventListener("drop", (event) => {
      event.preventDefault();
      section.classList.remove("ccsync-ext-drop");
      const dropped = Array.from(event.dataTransfer?.files || []).filter(
        (file) => /\.(crx|zip)$/i.test(file.name),
      );
      if (dropped.length)
        void uploadPackageFiles(cfg, installed, dropped, currentSelectionIds());
    });

    /* ------------------------- cloud backups section ---------------------- */
    const cloud = document.createElement("section");
    cloud.className = "ccsync-ext-cloud";
    const cloudHead = document.createElement("div");
    cloudHead.className = "ccsync-ext-head";
    const ct = document.createElement("div");
    ct.className = "subcard-title";
    ct.textContent = t("cloud");
    const cleanupButton = document.createElement("button");
    cleanupButton.className = "secondary";
    cleanupButton.type = "button";
    cleanupButton.textContent = t("cleanupUnused");
    cleanupButton.disabled = true;
    const updateCleanupButton = () => {
      const unchanged =
        Array.isArray(savedSelectionIds) &&
        sameIds(currentSelectionIds(), savedSelectionIds);
      cleanupButton.textContent = `${t("cleanupUnused")} · ${cleanupCandidates.length}`;
      cleanupButton.disabled = !unchanged || cleanupCandidates.length === 0;
    };
    let cleanupCandidates = [];
    cleanupButton.addEventListener("click", async () => {
      if (
        !Array.isArray(savedSelectionIds) ||
        !sameIds(currentSelectionIds(), savedSelectionIds)
      ) {
        alert(t("saveSelectionFirst"));
        return;
      }
      try {
        const current = await getCfg();
        if (
          !sameStorageConfig(current, cfg) ||
          !sameStorageConfig(uiCfg(current), current)
        )
          throw Error(t("selectionNeedSave"));
        const remoteSelection = await readSelection(cfg);
        if (
          !Array.isArray(remoteSelection) ||
          !sameIds(remoteSelection, savedSelectionIds)
        )
          throw Error(t("saveSelectionFirst"));
        const latest = await listBackups(cfg);
        const candidates = PI().findUnusedPackages(
          latest.backups,
          remoteSelection,
        );
        if (!candidates.length) {
          alert(t("cleanupNothing"));
          return;
        }
        const names = [...new Set(candidates.map((item) => item.name || item.extensionId))];
        const shownNames = `${names.slice(0, 5).join(", ")}${names.length > 5 ? `, +${names.length - 5}` : ""}`;
        const size = candidates.reduce((total, item) => total + Number(item.size || 0), 0);
        const confirmText = formatText(t("cleanupConfirm"), {
          count: candidates.length,
          size: fmt(size),
          names: shownNames,
        });
        if (!confirm(confirmText)) return;
        cleanupButton.disabled = true;
        const result = await cleanupUnusedBackups(cfg, remoteSelection);
        alert(
          result.failed || result.metadataFailed
            ? formatText(t("cleanupPartial"), {
                count: result.cleaned,
                failed: result.failed,
                metadataFailed: result.metadataFailed,
              })
            : formatText(t("cleanupComplete"), {
                count: result.cleaned,
                size: fmt(result.size),
              }),
        );
        await render(await getCfg());
      } catch (error) {
        alert(error.message || String(error));
      } finally {
        updateCleanupButton();
      }
    });
    cloudHead.append(ct, cleanupButton);
    const cleanupHelp = document.createElement("div");
    cleanupHelp.className = "ccsync-ext-note";
    cleanupHelp.textContent = t("cleanupUnusedHelp");
    cloud.append(cloudHead, cleanupHelp);
    try {
      const missing = missingPaths;
      cleanupCandidates = Array.isArray(savedSelectionIds)
        ? PI().findUnusedPackages(cloudBackups, savedSelectionIds)
        : [];
      updateCleanupButton();
      if (!cloudBackups.length) {
        const n = document.createElement("div");
        n.className = "ccsync-ext-note";
        n.textContent = t("noBackups");
        cloud.append(n);
      }
      for (const item of cloudBackups) {
        const row = document.createElement("div");
        row.className = "ccsync-ext-cloud-row";
        const m = document.createElement("div"),
          n = document.createElement("div"),
          meta = document.createElement("div");
        n.className = "ccsync-ext-cloud-name";
        n.textContent = item.name || item.extensionId;
        meta.className = "ccsync-ext-cloud-meta";
        const parts = [
          `v${item.version || "?"}`,
          fmt(item.size),
          `${(item.format || "file").toUpperCase()}`,
          item.sha256 ? `SHA-256 ${String(item.sha256).slice(0, 12)}…` : "",
          item.source ? `${t("source")}: ${sourceLabel(item.source)}` : "",
          item.origin ? `${t("source")}: ${t("localOrigin")}` : "",
          item.storedAt ? `${t("storedAt")}: ${fmtDate(item.storedAt)}` : "",
          item.extensionId,
        ].filter(Boolean);
        if (item.indexed === false) parts.unshift(t("unindexed"));
        if (missing.has(item.path) || item.present === false)
          parts.unshift(t("missingFile"));
        meta.textContent = parts.join(" · ");
        m.append(n, meta);
        const b = document.createElement("button");
        b.className = "secondary";
        b.type = "button";
        b.textContent = t("download");
        if (missing.has(item.path) || item.present === false) {
          b.disabled = true;
          b.title = t("driveNotFound");
        }
        b.addEventListener("click", async () => {
          try {
            b.disabled = true;
            const bytes = await getPackage(cfg, item),
              blob = new Blob([bytes], {
                type:
                  item.format === "zip"
                    ? "application/zip"
                    : "application/x-chrome-extension",
              }),
              url = URL.createObjectURL(blob),
              a = document.createElement("a");
            a.href = url;
            a.download = seg(
              item.fileName || `${seg(item.name)}.${item.format || "crx"}`,
            );
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            alert(e.message || String(e));
          } finally {
            b.disabled = false;
          }
        });
        row.append(m, b);
        cloud.append(row);
      }
      card.append(section, cloud);
    } catch (e) {
      const n = document.createElement("div");
      n.className = "ccsync-ext-status error";
      n.textContent = e.message || String(e);
      cloud.append(n);
      card.append(section, cloud);
    }
    updateCount();
  }

  /** Multi-file picker used by the batch upload button and drop target. */
  function batchFileInput() {
    let input = $("ccsyncExtensionPackageBatchInput");
    if (input) return input;
    input = document.createElement("input");
    input.type = "file";
    input.id = "ccsyncExtensionPackageBatchInput";
    input.accept = ".crx,.zip,application/zip,application/x-chrome-extension";
    input.multiple = true;
    input.hidden = true;
    document.body.append(input);
    input.addEventListener("change", async () => {
      const request = pendingPackageUpload,
        files = Array.from(input.files || []);
      pendingPackageUpload = null;
      input.value = "";
      if (!request || !files.length) return;
      const { cfg: expectedCfg, verifyForm } = request;
      try {
        const cfg = await getCfg();
        if (
          !sameStorageConfig(cfg, expectedCfg) ||
          (verifyForm && !sameStorageConfig(uiCfg(cfg), cfg))
        ) {
          alert(t("selectionNeedSave"));
          return;
        }
        if (cfg.backend === "disabled") {
          alert(
            zh()
              ? "请先保存并启用第三方扩展云存储。"
              : "Save and enable third-party extension cloud storage first.",
          );
          return;
        }
        await uploadPackageFiles(
          cfg,
          await getInstalled(),
          files,
          Array.isArray(cfg.selected) ? cfg.selected : [],
        );
      } catch (e) {
        alert(e.message || String(e));
      }
    });
    return input;
  }

  window.CCSyncExtensionStorage = {
    initOptions,
    renderPopup: render,
    refresh: render,
    refreshLanguage: () => refreshLanguage(),
  };
  window.addEventListener(
    "ccsync:language-changed",
    () => void refreshLanguage(),
  );
  if (document.readyState === "loading")
    document.addEventListener(
      "DOMContentLoaded",
      () =>
        void initOptions().catch((e) =>
          console.error("Extension storage init failed:", e),
        ),
    );
  else
    void initOptions().catch((e) =>
      console.error("Extension storage init failed:", e),
    );
})();
