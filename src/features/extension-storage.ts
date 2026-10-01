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
    chooseDesc: () =>
      zh()
        ? "这里选择的是第三方扩展包备份范围。扩展设置本身不会同步。"
        : "This selects which third-party extension packages are backup targets. Extension settings are never synchronized.",
    all: () => (zh() ? "全选" : "Select all"),
    none: () => (zh() ? "全不选" : "Clear all"),
    saveSelection: () => (zh() ? "保存备份选择" : "Save backup selection"),
    selectionSaved: () => (zh() ? "备份选择已保存" : "Backup selection saved"),
    selectionNeedSave: () =>
      zh()
        ? "请先保存存储设置，再保存扩展备份选择。"
        : "Save the storage settings first, then save the extension backup selection.",
    backup: () => (zh() ? "备份 CRX / ZIP" : "Back up CRX / ZIP"),
    download: () => (zh() ? "下载" : "Download"),
    cloud: () => (zh() ? "云端备份" : "Cloud backups"),
    noBackups: () =>
      zh() ? "暂无云端扩展包。" : "No cloud package backups found.",
    manual: () =>
      zh()
        ? "操作说明：保存并启用存储后端后，在下方勾选扩展，点击“备份 CRX / ZIP”选择本地安装包上传。浏览器无法导出其他已安装扩展的原始文件；如果没有安装包，请先从扩展发布者获取 CRX / ZIP。"
        : "After saving and enabling a storage backend, select an extension below and click “Back up CRX / ZIP” to upload a local package. Browsers cannot export other installed extensions’ original files; obtain a CRX / ZIP from the publisher if you do not have one.",
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
  };
  const t = (k) => text[k]?.() || k;
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
      return await github(
        `/repos/${normRepo(cfg.repo)}/contents/${path}`,
        {},
        cfg.token,
      );
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
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
    const r = await fetchWithTimeout(`https://api.github.com${path}`, {
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
    const pi = PI(),
      index = await readIndex(cfg);
    if (cfg.backend !== "gdrive")
      return {
        schemaVersion: index.schemaVersion,
        updatedAt: index.updatedAt,
        backups: index.backups.slice().reverse(),
        unindexed: [],
        missing: [],
      };
    const merged = pi.mergeIndexWithListing(
      index,
      await gdriveListPackages(cfg),
    );
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
  async function putPackage(cfg, ext, bytes, fileName) {
    const pi = PI(),
      limit = backendMaxBytes(cfg);
    if (bytes.length > limit) throw Error(backendMaxMessage(cfg));
    const hash = await sha256(bytes),
      index = await readIndex(cfg),
      folder = pi.packageFolder(ext.id, ext.version || ""),
      taken = pi.takenNamesInFolder(index, ext.id, ext.version || ""),
      safeName = pi.resolveUniqueFileName(seg(fileName), taken, hash),
      path = pi.join(folder, safeName),
      item = pi.buildPackageRecord({
        extension: ext,
        fileName: safeName,
        size: bytes.length,
        sha256: hash,
        path,
        storedAt: new Date().toISOString(),
        backend: cfg.backend,
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
      ".ccsync-ext-grid{display:grid;gap:10px}.ccsync-ext-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.ccsync-ext-note{color:var(--text-2);font-size:12px;line-height:1.55;margin-top:8px}.ccsync-ext-selection,.ccsync-ext-cloud{margin-top:18px;border-top:1px solid var(--line);padding-top:14px}.ccsync-ext-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.ccsync-ext-tools{display:flex;gap:6px;flex-wrap:wrap}.ccsync-ext-row{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.ccsync-ext-row:first-child{border-top:0}.ccsync-ext-name{font-size:13px;font-weight:600;overflow-wrap:anywhere}.ccsync-ext-meta{font-size:11px;color:var(--text-2);margin-top:2px;overflow-wrap:anywhere}.ccsync-ext-status{font-size:12px;line-height:1.55;margin-top:10px}.ccsync-ext-status.ok{color:var(--success)}.ccsync-ext-status.error{color:var(--danger)}.ccsync-ext-cloud-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.ccsync-ext-cloud-name{font-size:13px;font-weight:600}.ccsync-ext-cloud-meta{font-size:11px;color:var(--text-2);margin-top:2px}.ccsync-ext-token-help{font-size:12px;line-height:1.55;color:var(--text-2)}.ccsync-ext-hidden{display:none!important}@media(max-width:600px){.ccsync-ext-row,.ccsync-ext-cloud-row{grid-template-columns:1fr}.ccsync-ext-row input[type=checkbox]{justify-self:start}.ccsync-ext-row .secondary{justify-self:start}}";
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
        await putPackage(
          cfg,
          { id, name, version },
          new Uint8Array(await file.arrayBuffer()),
          file.name,
        );
        const selected = new Set(cfg.selected);
        selected.add(id);
        await CCSyncRuntime.storageSet({ [K.selected]: [...selected] });
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

  async function render(cfg) {
    const card = $("extensionStorageSettings");
    if (!card) return;
    card
      .querySelectorAll(".ccsync-ext-selection,.ccsync-ext-cloud")
      .forEach((x) => x.remove());
    if (!cfg || cfg.backend === "disabled") return;
    const installed = await getInstalled();
    let selected = Array.isArray(cfg.selected) ? cfg.selected.map(String) : [];
    let remote = null;
    const persisted = await getCfg();
    if (sameStorageConfig(cfg, persisted)) {
      try {
        remote = await readSelection(cfg);
      } catch {
        remote = null;
      }
    }
    if (Array.isArray(remote)) selected = remote;
    else if (!selected.length) selected = installed.map((x) => x.id);
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
    desc.textContent = t("chooseDesc");
    copy.append(title, desc);
    const tools = document.createElement("div");
    tools.className = "ccsync-ext-tools";
    const all = document.createElement("button");
    all.className = "secondary";
    all.type = "button";
    all.textContent = t("all");
    const none = document.createElement("button");
    none.className = "secondary";
    none.type = "button";
    none.textContent = t("none");
    const saveSel = document.createElement("button");
    saveSel.className = "primary";
    saveSel.type = "button";
    saveSel.textContent = t("saveSelection");
    tools.append(all, none, saveSel);
    head.append(copy, tools);
    section.append(head);
    const list = document.createElement("div");
    const checks = new Map();
    for (const ext of installed) {
      const row = document.createElement("label");
      row.className = "ccsync-ext-row";
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
      main.append(name, meta);
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
        const input = fileInput();
        pendingPackageUpload = {
          id: ext.id,
          name: ext.name || ext.id,
          version: ext.version || "",
          cfg: { ...cfg },
          verifyForm: Boolean($("extensionStorageBackend")),
        };
        input.click();
      });
      cb.addEventListener("change", () => {
        b.disabled = !cb.checked;
        updateCount();
      });
      checks.set(ext.id, cb);
      row.append(cb, main, b);
      list.append(row);
    }
    section.append(list);
    card.append(section);
    function updateCount() {
      const n = [...checks.values()].filter((x) => x.checked).length;
      saveSel.textContent = `${t("saveSelection")} · ${n}`;
    }
    all.addEventListener("click", () => {
      checks.forEach((cb) => {
        cb.checked = true;
        const b = cb.closest(".ccsync-ext-row")?.querySelector("button");
        if (b) b.disabled = false;
      });
      updateCount();
    });
    none.addEventListener("click", () => {
      checks.forEach((cb) => {
        cb.checked = false;
        const b = cb.closest(".ccsync-ext-row")?.querySelector("button");
        if (b) b.disabled = true;
      });
      updateCount();
    });
    saveSel.addEventListener("click", async () => {
      try {
        const current = await getCfg();
        if (
          !sameStorageConfig(current, cfg) ||
          !sameStorageConfig(uiCfg(current), current)
        )
          throw Error(t("selectionNeedSave"));
        const ids = [...checks.entries()]
          .filter(([, cb]) => cb.checked)
          .map(([id]) => id);
        await CCSyncRuntime.storageSet({ [K.selected]: ids });
        await writeSelection(cfg, ids);
        saveSel.textContent = t("selectionSaved");
        setTimeout(updateCount, 900);
      } catch (e) {
        alert(e.message || String(e));
      }
    });
    updateCount();
    const cloud = document.createElement("section");
    cloud.className = "ccsync-ext-cloud";
    const ct = document.createElement("div");
    ct.className = "subcard-title";
    ct.textContent = t("cloud");
    cloud.append(ct);
    try {
      const listed = await listBackups(cfg),
        backups = Array.isArray(listed.backups) ? listed.backups : [],
        missing = new Set(Array.isArray(listed.missing) ? listed.missing : []);
      if (!backups.length) {
        const n = document.createElement("div");
        n.className = "ccsync-ext-note";
        n.textContent = t("noBackups");
        cloud.append(n);
      }
      for (const item of backups) {
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
      card.append(cloud);
    } catch (e) {
      const n = document.createElement("div");
      n.className = "ccsync-ext-status error";
      n.textContent = e.message || String(e);
      cloud.append(n);
      card.append(cloud);
    }
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
