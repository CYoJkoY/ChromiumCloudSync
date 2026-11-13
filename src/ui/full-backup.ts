import { CATEGORIES, isObject, parseJob, parseRecord, type BackupRecord } from "../features/full-backup.js";

const zh = () => document.documentElement.lang.toLowerCase().startsWith("zh");
const t = (cn: string, en: string) => zh() ? cn : en;
const labels: Record<string, [string, string]> = {
  program: ["扩展程序文件", "Extension program files"], local: ["storage.local 本地设置", "storage.local settings"],
  sync: ["storage.sync 本地副本", "storage.sync local copy"], indexeddb: ["IndexedDB 数据库与附件", "IndexedDB databases and blobs"],
  localStorage: ["localStorage 来源记录", "Origin localStorage records"], files: ["持久文件系统", "Persistent file system"],
};
async function call(action: string, data: Record<string, unknown> = {}): Promise<unknown> {
  const response: unknown = await chrome.runtime.sendMessage({ type: "fullBackup", action, ...data });
  if (isObject(response) && typeof response.error === "string") throw Error(response.error);
  return response;
}
const native = (op: string, data: Record<string, unknown> = {}) => call("native", { request: { op, ...data } });
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function mount(): void {
  const host = document.getElementById("fullBackupHost"); if (!host) return;
  if (host.getAttribute("aria-busy") === "true") return;
  host.replaceChildren();
  const status = element("p", t("连接本机助手后，选择浏览器配置和备份范围。", "Connect the native helper, then select a browser profile and backup scope."), "note"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const controls = element("div", "", "btn-row");
  const profiles = element("select"); profiles.setAttribute("aria-label", t("目标浏览器配置", "Target browser profile"));
  const profilePlaceholder = () => { const option = element("option", t("请选择目标 Profile", "Select a target profile")); option.value = ""; return option; };
  profiles.append(profilePlaceholder());
  const selections = element("div", "", "full-backup-extensions");
  const scopes = element("fieldset"); scopes.append(element("legend", t("备份 / 恢复内容", "Backup / restore scope")));
  for (const category of CATEGORIES) {
    const label = element("label", "", "full-backup-choice"); const input = element("input"); input.type = "checkbox"; input.value = category; input.name = "backupCategory"; input.checked = true;
    const words = labels[category]; label.append(input, document.createTextNode(words ? t(...words) : category)); scopes.append(label);
  }
  const preview = element("div", "", "status-box full-backup-preview"); preview.hidden = true;
  const describePlan = (plan: Record<string, unknown>) => {
    preview.replaceChildren(element("p", t("目标配置：", "Target profile: ") + profiles.selectedOptions[0]?.textContent));
    const table = element("table"); const head = element("tr");
    for (const title of [t("扩展 / 内容", "Extension / category"), t("文件数 / 大小", "Files / size"), t("支持情况", "Support")]) head.append(element("th", title));
    const thead = element("thead"); thead.append(head); table.append(thead); const body = element("tbody");
    if (Array.isArray(plan.capabilities)) for (const value of plan.capabilities) {
      if (!isObject(value) || typeof value.extensionId !== "string" || typeof value.category !== "string") continue;
      const row = element("tr"); const words = labels[value.category];
      row.append(element("td", value.extensionId + " / " + (words ? t(...words) : value.category)),
        element("td", String(value.files) + " / " + (Number(value.bytes) / 1048576).toFixed(2) + " MiB"),
        element("td", (value.supported ? t("支持", "Supported") : t("不支持", "Unsupported")) + (typeof value.reason === "string" && value.reason ? " · " + value.reason : ""))); body.append(row);
    }
    const excluded = element("tr"); excluded.append(element("td", "Storage Buckets / OPFS"), element("td", "—"), element("td", t("不支持，不会备份", "Unsupported; excluded"))); body.append(excluded);
    table.append(body); preview.append(table, element("p", t("共享数据库的文件数与大小将在关闭浏览器后计算。0 不表示没有数据。", "Shared database counts and sizes are determined after browsers close. Zero does not mean empty data."), "note")); preview.hidden = false;
  };
  const jobWords: Record<string, [string, string]> = {
    backup: ["备份", "Backup"], restore: ["恢复", "Restore"], rollback: ["回滚", "Rollback"],
    waiting: ["等待浏览器退出", "Waiting for browser exit"], running: ["处理中", "Running"], recovering: ["正在恢复原始数据", "Recovering originals"],
    receiving: ["接收中", "Receiving"], preview: ["等待恢复确认", "Awaiting restore confirmation"], ready: ["等待上传", "Ready to upload"], uploaded: ["已上传", "Uploaded"],
    restored: ["已恢复", "Restored"], rolledBack: ["已回滚", "Rolled back"], failed: ["失败", "Failed"], timedOut: ["等待超时", "Wait timed out"], cancelled: ["已取消", "Cancelled"],
  };
  const word = (value: string) => { const pair = jobWords[value]; return pair ? t(...pair) : value; };
  const jobs = element("div"); const records = element("div");
  const transferStatus = element("p", "", "note"); transferStatus.setAttribute("role", "status");
  const pause = element("button", t("暂停云端传输", "Pause cloud transfer"), "secondary"); pause.type = "button"; pause.hidden = true;
  pause.addEventListener("click", () => { void call("cancelTransfer").catch(error => { status.textContent = String(error); }); });
  const run = async (action: () => Promise<void>) => {
    if (host.getAttribute("aria-busy") === "true") return;
    host.setAttribute("aria-busy", "true");
    const timer = setInterval(() => { void chrome.storage.local.get("fullBackupProgress").then(saved => {
      const value: unknown = saved.fullBackupProgress;
      if (!isObject(value) || typeof value.completed !== "number" || typeof value.total !== "number") return;
      pause.hidden = false;
      transferStatus.textContent = (value.phase === "upload" ? t("上传", "Upload") : t("下载", "Download")) + " · " + (value.completed / 1048576).toFixed(2) + " / " + (value.total / 1048576).toFixed(2) + " MiB";
    }).catch(error => { status.textContent = String(error); }); }, 1000);
    try { await action(); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
    finally { clearInterval(timer); pause.hidden = true; transferStatus.textContent = ""; host.removeAttribute("aria-busy"); }
  };
  const button = (parent: HTMLElement, text: string, action: () => Promise<void>, primary = false) => {
    const b = element("button", text, primary ? "primary" : "secondary"); b.type = "button"; b.addEventListener("click", () => { void run(action); }); parent.append(b); return b;
  };
  const selected = (name: string) => [...host.querySelectorAll<HTMLInputElement>('input[name="' + name + '"]:checked')].map(x => x.value);
  const selection = () => {
    const extensionIds = selected("backupExtension"), categories = selected("backupCategory");
    if (!profiles.value || !extensionIds.length || !categories.length) throw Error(t("请选择配置、扩展和备份内容。", "Select a profile, extensions and categories."));
    return { profileId: profiles.value, extensionIds, categories };
  };
  const refreshJobs = async () => {
    const values = await native("jobs"); if (!Array.isArray(values)) throw Error("Invalid task list"); jobs.replaceChildren();
    const saved = await chrome.storage.local.get("fullBackupLastError");
    if (typeof saved.fullBackupLastError === "string") jobs.append(element("p", t("自动上传：", "Automatic upload: ") + saved.fullBackupLastError, "note"));
    for (const value of values) {
      const job = parseJob(value); const row = element("article", "", "full-backup-job");
      row.append(element("strong", word(job.kind) + " · " + word(job.state)), element("p", job.id + " · " + (job.size / 1048576).toFixed(2) + " MiB"),
        element("p", t("目标 Profile：", "Target profile: ") + job.plan.profileId),
        element("p", job.plan.extensionIds.join(", ") + " · " + job.plan.categories.map(c => labels[c] ? t(...labels[c]) : c).join(" / ")));
      if (job.error) row.append(element("p", job.error, "note"));
      const actions = element("div", "", "btn-row");
      const action = (op: string, label: string) => button(actions, label, async () => { await native(op, { jobId: job.id }); await refreshJobs(); });
      if (job.state === "preview") action("scheduleRestore", t("确认覆盖所选范围，关闭浏览器后恢复", "Confirm selected replacement; restore after browser closes"));
      if (["failed", "timedOut"].includes(job.state)) action("retry", t("重试", "Retry"));
      if (job.state === "restored") action("rollback", t("关闭浏览器后回滚", "Roll back after browser closes"));
      if (["receiving", "preview", "waiting", "failed", "timedOut"].includes(job.state)) action("cancel", t("取消任务", "Cancel task"));
      row.append(actions); jobs.append(row);
    }
  };
  button(controls, t("连接 / 刷新本机助手", "Connect / refresh native helper"), async () => {
    await native("hello"); const values = await native("profiles"); if (!Array.isArray(values)) throw Error("Invalid profiles"); const previous = profiles.value; profiles.replaceChildren(profilePlaceholder());
    for (const value of values) if (isObject(value) && typeof value.id === "string" && typeof value.name === "string" && typeof value.browser === "string") { const option = element("option", value.browser + " · " + value.name); option.value = value.id; profiles.append(option); }
    if ([...profiles.options].some(option => option.value === previous)) profiles.value = previous;
    status.textContent = t("助手已连接。请核对配置名称与 chrome://version 或 edge://version 中的 Profile Path。", "Helper connected. Match the profile with Profile Path in chrome://version or edge://version.");
    await refreshJobs();
  });
  const custom = element("details"); custom.append(element("summary", t("注册自定义配置目录", "Register a custom profile directory")));
  const path = element("input"); path.placeholder = t("包含 Preferences 的配置文件夹", "Profile folder containing Preferences"); path.setAttribute("aria-label", path.placeholder);
  const browser = element("select"); browser.setAttribute("aria-label", "Browser family");
  for (const name of ["chrome", "edge", "chromium"]) { const option = element("option", name); option.value = name; browser.append(option); }
  custom.append(path, browser); button(custom, t("注册配置", "Register profile"), async () => { await native("registerProfile", { path: path.value, browser: browser.value }); status.textContent = t("已注册，请刷新助手列表。", "Registered. Refresh the helper list."); });
  let planId = ""; let planSelection = "";
  button(controls, t("预览备份范围", "Preview backup scope"), async () => {
    const pick = selection(); const plan = await native("plan", pick); if (!isObject(plan) || typeof plan.id !== "string") throw Error("Invalid plan"); planId = plan.id; planSelection = JSON.stringify(pick);
    describePlan(plan); status.textContent = t("检查预览后安排备份。所选类别不存在的数据记为空；不包含下方列出的排除项。", "Review the preview before scheduling. Missing selected data is recorded as empty. Exclusions below still apply.");
  });
  button(controls, t("安排离线备份", "Schedule offline backup"), async () => {
    if (!planId || JSON.stringify(selection()) !== planSelection) throw Error(t("请先重新预览当前选择。", "Preview the current selection first."));
    await native("scheduleBackup", { planId }); await chrome.storage.local.set({ fullBackupEnabled: true });
    status.textContent = t("任务已安排。退出所有 Chromium 浏览器后助手开始备份；再次启动后自动上传。", "Scheduled. Quit all Chromium browsers to create the backup; it uploads automatically after the next start."); await refreshJobs();
  }, true);
  button(controls, t("上传就绪备份", "Upload ready backups"), async () => { await call("upload"); await refreshJobs(); status.textContent = t("就绪任务已上传。", "Ready tasks uploaded."); });
  button(controls, t("刷新任务", "Refresh tasks"), refreshJobs);
  const loadRecords = async () => {
    const values = await call("records"); if (!Array.isArray(values)) throw Error("Invalid cloud records"); records.replaceChildren();
    if (!values.length) records.append(element("p", t("云端尚无完整备份。", "No full backups in this destination yet.")));
    for (const value of values) {
      const record: BackupRecord = parseRecord(value); const row = element("article", "", "full-backup-job");
      row.append(element("strong", new Date(record.createdAt * 1000).toLocaleString()), element("p", record.extensionIds.join(", ")), element("p", record.categories.map(c => { const pair = labels[c]; return pair ? t(...pair) : c; }).join(" · ")));
      button(row, t("下载校验并预览恢复", "Download, verify and preview restore"), async () => { const pick = selection(); await call("download", { record, ...pick }); await refreshJobs(); status.textContent = t("已下载校验。任务中确认恢复后，关闭所有浏览器才会覆盖所选数据；恢复完成可回滚。", "Downloaded and verified. Confirm the restore in Tasks, then close all browsers to replace selected data. Rollback remains available."); }); records.append(row);
    }
  };
  const archiveControls = element("div", "", "btn-row"); button(archiveControls, t("读取云端备份", "List cloud backups"), loadRecords);
  const setup = element("details"); setup.append(element("summary", t("首次使用：安装本机助手", "First use: set up the native helper")),
    element("p", t("完整文件备份需要单独构建并注册本机助手。请在项目 native/README.md 中按当前操作系统的步骤构建；注册会修改当前用户的 Native Messaging 配置，应由你手动执行。", "Full file backups require a separately built and registered native helper. Follow native/README.md in the source project for your OS. Registration changes user Native Messaging settings and must be run manually.")),
    element("pre", "cargo build --manifest-path native/Cargo.toml --locked --release"),
    element("p", t("在扩展管理页面复制本扩展 ID，然后注册实际构建出的可执行文件（Windows 使用 .exe）：", "Copy this extension ID from the browser extension manager, then register the built binary (use .exe on Windows):")),
    element("pre", "node native/register.mjs " + chrome.runtime.id + " PATH_TO_CCSYNC_NATIVE"),
    element("p", t("配置下方的私有 GitHub / WebDAV / Google Drive 后端后，再连接助手。助手不会自动关闭浏览器；安排任务后需退出所有 Chromium 浏览器，并等待离线处理完成再启动。", "Configure the private GitHub / WebDAV / Google Drive destination below, then connect the helper. The helper never closes browsers. After scheduling, quit every Chromium browser and let offline processing finish before restarting.")));
  host.append(status, setup, element("h3", t("01 / 配置与范围", "01 / Profile and scope")), profiles, custom, selections, scopes,
    element("p", t("排除：密码、Cookie、账号令牌库、浏览器 Preferences、安全注册信息、缓存、临时文件、Storage Buckets / OPFS 和未识别的 SQLite 存储。localStorage 与文件系统仅支持已识别的传统 LevelDB 格式，未知格式会报错。备份可能包含所选扩展自身保存的敏感数据。", "Excluded: passwords, cookies, browser credential stores, Preferences, secure registration, caches, temporary files, Storage Buckets / OPFS and unrecognized SQLite storage. localStorage and file-system support is limited to recognized legacy LevelDB layouts; unknown formats fail. Selected extension data may itself contain secrets."), "note"),
    element("p", t("恢复按扩展 ID 写入所选目标 Profile，不使用归档中的机器绝对路径。数据库恢复要求相同操作系统、浏览器系列和主版本；程序文件恢复不会替代浏览器安装确认。恢复会替换所选范围；storage.sync 可能随后被浏览器账号同步覆盖。", "Restore resolves extension IDs under the selected target profile without archive machine paths. Database restore requires the same OS, browser family and major version. Program files do not register an extension; browser installation is still required. Restore replaces selected scopes; browser account sync may later overwrite storage.sync."), "note"),
    element("p", t("目标尚未安装时，请先从浏览器商店安装并核对扩展 ID；解压安装的扩展也必须具有同一个 ID。仅复制程序目录不会完成安装。", "If absent, install from the browser store first and verify the extension ID. An unpacked extension must also retain the same ID. Copying program folders alone does not complete installation."), "note"),
    controls, transferStatus, pause, preview, element("h3", t("02 / 离线任务与回滚", "02 / Offline tasks and rollback")), jobs,
    element("h3", t("03 / 云端恢复", "03 / Cloud restore")), archiveControls, records);
  void chrome.management.getAll().then(async extensions => {
    const saved = await chrome.storage.local.get(["fullBackupSelection"]);
    const savedSelection = isObject(saved.fullBackupSelection) ? saved.fullBackupSelection : {};
    const ids: unknown = Array.isArray(savedSelection.extensionIds) ? savedSelection.extensionIds : [];
    if (Array.isArray(savedSelection.categories)) for (const check of scopes.querySelectorAll<HTMLInputElement>("input")) check.checked = savedSelection.categories.includes(check.value);
    const persist = () => { void chrome.storage.local.set({ fullBackupSelection: { extensionIds: selected("backupExtension"), categories: selected("backupCategory") } }).catch(error => { status.textContent = String(error); }); };
    scopes.addEventListener("change", persist); selections.addEventListener("change", persist);
    for (const extension of extensions.filter(e => e.type === "extension" && e.id !== chrome.runtime.id)) {
      const label = element("label", "", "full-backup-choice"); const check = element("input"); check.type = "checkbox"; check.name = "backupExtension"; check.value = extension.id; check.checked = Array.isArray(ids) && ids.includes(extension.id);
      label.append(check, element("span", extension.name + " · " + extension.id)); selections.append(label);
    }
    if (Array.isArray(ids)) for (const id of ids) {
      if (typeof id !== "string" || !/^[a-p]{32}$/.test(id) || extensions.some(extension => extension.id === id)) continue;
      const label = element("label", "", "full-backup-choice"); const check = element("input"); check.type = "checkbox"; check.name = "backupExtension"; check.value = id; check.checked = true; label.append(check, document.createTextNode(id)); selections.append(label);
    }
    selections.addEventListener("keydown", event => { if (event.key === "Enter") queueMicrotask(persist); });
    const manual = element("input"); manual.placeholder = t("恢复未安装的扩展：输入 32 位扩展 ID 后按 Enter", "Restore an absent extension: enter its 32-character ID and press Enter"); manual.setAttribute("aria-label", manual.placeholder);
    manual.addEventListener("keydown", event => { if (event.key !== "Enter") return; event.preventDefault(); const id = manual.value.trim(); if (!/^[a-p]{32}$/.test(id)) { status.textContent = "Invalid extension ID"; return; } if ([...selections.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].some(x => x.value === id)) return; const label = element("label", "", "full-backup-choice"); const check = element("input"); check.type = "checkbox"; check.name = "backupExtension"; check.value = id; check.checked = true; label.append(check, document.createTextNode(id)); selections.append(label); manual.value = ""; }); selections.append(manual);
  }).catch(error => { status.textContent = String(error); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
document.addEventListener("ccsync:languagechange", mount);
