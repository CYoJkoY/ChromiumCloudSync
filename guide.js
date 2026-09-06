const DICT={
'en':{
 title:'User Guide',subtitle:'A local-first Chromium sync tool backed by your GitHub Gist.',
 quickTitle:'Quick start',quickBody:'Open Settings, enter your GitHub Token, validate it, then create a private Gist or bind an existing Chromium Cloud Sync Gist. After setup, use Sync now or enable automatic synchronization.',
 popupTitle:'Popup overview',popupBody:'The popup shows GitHub readiness, the current Gist, last successful sync time, automatic-sync status, revision and conflict counts, plus quick actions for syncing, restoring data, and opening the Extension Recovery Center.',
 storageTitle:'What is synchronized',storageBody:'The cloud snapshot contains browser-state data: open windows and HTTP(S) tabs, tab groups, bookmarks, and installed third-party extension metadata. Extension metadata is used to detect missing extensions; it does not contain third-party extension settings.',
 storageNote:'Third-party extension settings are intentionally outside the synchronization scope. Chromium Cloud Sync cannot generically read or write another extension’s private storage.',
 deviceTitle:'Device identity',deviceBody:'Device identity is intentionally lightweight. The synchronization model does not depend on copying credentials or third-party extension storage between browsers. Keep the same logical device configuration on each browser when using multi-device synchronization.',
 syncTitle:'Sync model',syncBody:'The sync engine keeps a local base snapshot and performs a three-way merge between base, local, and remote state. Stable synchronization IDs are used for tabs, windows, tab groups, and bookmarks. Deletions are represented by tombstones so stale devices do not silently recreate removed items. Conflicting field changes remain visible as conflicts instead of being silently discarded.',
 autoTitle:'Automatic sync',autoBody:'Automatic synchronization is disabled by default and uses a five-minute interval by default. In Settings you can enable it and select an interval. Browser events are debounced before a background synchronization is started.',
 extensionTitle:'Extension inventory',extensionBody:'The Extensions feature records third-party extension metadata such as ID, name, version, enabled state, installation type, update information, and store links. When another browser is missing an extension present in the cloud inventory, the Extension Recovery Center lists it for recovery.',
 recoveryTitle:'Extension Recovery Center',recoveryBody:'Use the Extension Recovery Center to review extensions that exist in the cloud inventory but are not installed locally. When a verified Chrome Web Store or Microsoft Edge Add-ons link is available, the page provides a direct installation link. Installation itself remains a manual browser action.',
 packageTitle:'Third-party extension package backup',packageBody:'CRX and ZIP backups are intentionally separate from browser-state synchronization. Configure a GitHub private repository or WebDAV backend in Settings when you need a package for an extension that is unavailable from a browser store. Package installation remains manual.',
 historyTitle:'History and rollback',historyBody:'GitHub Gist provides revision history for the synchronized state. The extension also keeps a local index of up to 30 recent entries. The History page can inspect revisions and create a new current revision by rolling back to a selected version.',
 settingsTitle:'Settings pages',settingsBody:'Settings separates synchronization configuration from extension package storage. GitHub token and Gist configuration stay local to each browser. Package-backup credentials are also kept local and are never placed into the browser-state snapshot.',
 privacyTitle:'Privacy and security',privacyBody:'New sync Gists created by the extension are private. The current synchronization payload is normal JSON in the Gist and is not end-to-end encrypted. Treat access to the private Gist as access to the synchronized browser data. Use a token with only the permissions you need.',
 troubleTitle:'Troubleshooting',troubleBody:'If synchronization fails, first open the popup and read the detailed status message. Then verify the GitHub Token and Gist binding in Settings. For missing extensions, use the Extension Recovery Center. For extensions stored outside a browser store, check the separate package-backup configuration.',
 scopeTitle:'Important scope decision',scopeBody:'Chromium Cloud Sync does not synchronize third-party extension settings. This is intentional: extension settings are private to each extension, vary widely in format, and cannot be safely handled by a generic Chromium extension. The project therefore synchronizes extension inventory and provides a separate package-recovery path instead.'
},
'zh-CN':{
 title:'用户指南',subtitle:'基于你自己的 GitHub Gist 的本地优先 Chromium 同步工具。',
 quickTitle:'快速开始',quickBody:'打开“设置”，填写 GitHub Token 并验证，然后创建新的私有 Gist 或绑定已有的 Chromium Cloud Sync Gist。完成后可以点击“立即同步”，也可以开启自动同步。',
 popupTitle:'Popup 界面',popupBody:'Popup 会显示 GitHub 连接状态、当前 Gist、最后一次成功同步时间、自动同步状态、Revision 和冲突数量，并提供同步、恢复数据以及打开“扩展恢复中心”的快捷操作。',
 storageTitle:'同步哪些内容',storageBody:'云端快照包含浏览器状态数据：打开的窗口和 HTTP(S) 标签页、标签组、书签，以及已安装第三方扩展的元数据。扩展元数据用于检测缺失扩展，不包含第三方扩展的内部设置。',
 storageNote:'第三方扩展设置被明确排除在同步范围之外。Chromium Cloud Sync 无法通用地读取或修改其他扩展的私有存储。',
 deviceTitle:'设备身份',deviceBody:'设备身份保持为轻量设计。同步模型不会依赖复制凭据或第三方扩展存储。多设备使用时，应为每台浏览器保持一致的逻辑设备配置。',
 syncTitle:'同步模型',syncBody:'同步引擎保存本地基准快照，并在“基准 + 本地 + 远程”之间执行三方合并。标签页、窗口、标签组和书签使用稳定同步 ID。删除会记录为 tombstone，避免旧设备重新生成已经删除的项目；字段级冲突会明确保留，而不是静默丢弃。',
 autoTitle:'自动同步',autoBody:'自动同步默认关闭，默认间隔为 5 分钟。在设置中可以开启并选择同步间隔。浏览器事件会经过防抖后再启动后台同步。',
 extensionTitle:'扩展清单',extensionBody:'“扩展”功能记录第三方扩展的 ID、名称、版本、启用状态、安装类型、更新信息和商店链接。当另一台浏览器缺少云端清单中的扩展时，会在“扩展恢复中心”中列出。',
 recoveryTitle:'扩展恢复中心',recoveryBody:'打开“扩展恢复中心”，可以查看云端清单中存在但当前浏览器没有安装的扩展。如果能够确认 Chrome 网上应用店或 Microsoft Edge 加载项链接，页面会提供直接安装入口。扩展安装仍然由用户手动确认。',
 packageTitle:'第三方扩展包备份',packageBody:'CRX / ZIP 备份与浏览器状态同步完全分离。对于无法从浏览器商店获取的扩展，可以在“设置”中配置 GitHub 私有仓库或 WebDAV 作为扩展包存储后端。扩展安装始终需要手动完成。',
 historyTitle:'历史与回滚',historyBody:'GitHub Gist 保存同步状态的 Revision 历史。插件还会在本地维护最多 30 条历史索引记录。“历史”页面可以查看版本，并将指定版本回滚成新的当前 Revision。',
 settingsTitle:'设置页面',settingsBody:'设置页面将同步配置与第三方扩展包存储分开。GitHub Token 和 Gist 配置只保存在当前浏览器本地。扩展包备份的凭据同样只在本地保存，不会进入浏览器状态同步快照。',
 privacyTitle:'隐私与安全',privacyBody:'插件创建的同步 Gist 默认是私有的。当前同步载荷以普通 JSON 保存在 Gist 中，并不是端到端加密。应将能够访问这个私有 Gist 视为能够访问同步的浏览器数据。GitHub Token 应尽可能使用满足需求的最小权限。',
 troubleTitle:'故障排查',troubleBody:'同步失败时，先打开 Popup 查看详细状态信息，然后在设置中检查 GitHub Token 和 Gist 绑定。缺失扩展请使用“扩展恢复中心”。对于商店之外安装的扩展，请检查独立的扩展包备份配置。',
 scopeTitle:'重要的功能边界',scopeBody:'Chromium Cloud Sync 不同步第三方扩展设置。这是有意的设计：扩展设置属于各自扩展的私有存储，格式差异很大，Chromium 扩展也无法安全地通用处理其他扩展的内部数据。因此项目只同步扩展清单，并提供独立的扩展包恢复路径。'
}
};
function detect(){return[navigator.language,...(navigator.languages||[])].some(x=>/^zh(?:[-_]|$)/i.test(x))?'zh-CN':'en';}
function apply(){const s=localStorage.getItem('ccsync-guide-language')||'auto',l=s==='auto'?detect():(s==='zh-CN'?'zh-CN':'en'),d=DICT[l]||DICT.en;document.documentElement.lang=l;document.querySelectorAll('[data-guide]').forEach(e=>{const value=d[e.dataset.guide];if(value)e.textContent=value;});}
function setupChoiceSwitch(root,initialValue,onChange){if(!root)return;const bs=[...root.querySelectorAll('.choice-switch-option')],set=v=>{root.dataset.active=(v==='en'||v==='dark')?'right':'left';bs.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.value===v)));};set(initialValue);bs.forEach(b=>b.addEventListener('click',async()=>{const v=b.dataset.value;await onChange(v);set(v);}));}
(async()=>{const lang=document.getElementById('language');const s=await chrome.storage.local.get(['language']);if(lang){const lv=s.language&&s.language!=='auto'?s.language:detect();setupChoiceSwitch(lang,lv,async v=>{await chrome.storage.local.set({language:v});localStorage.setItem('ccsync-guide-language',v);apply();});}const theme=document.getElementById('theme');if(theme&&window.CCSyncTheme){await CCSyncTheme.initTheme();const tm=await CCSyncTheme.getTheme();const tv=tm==='dark'||tm==='light'?tm:(document.documentElement.dataset.theme||'light');setupChoiceSwitch(theme,tv,async v=>CCSyncTheme.setTheme(v));}apply();})();
