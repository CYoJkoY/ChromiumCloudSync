const { request, storageGet, bindAction } = CCSyncRuntime;
const i = CCSyncI18n;
const $ = id => document.getElementById(id);
const BACKUP_MAX_BYTES = 5 * 1024 * 1024;

const ui = {
  icon: $('statusIcon'), title: $('statusTitle'), meta: $('statusMeta'), rev: $('revision'),
  missing: $('missing'), lang: $('language'), theme: $('theme'), detail: $('statusDetail')
};

function iconFor(state) {
  const map = {
    ok: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
    warn: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="M12 3 2.8 20h18.4L12 3z"/><path d="M12 9v4M12 17h.01"/></svg>',
    bad: '<svg class="icon-xl" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
    idle: '<svg class="icon-xl" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M18 3v5h-5"/></svg>'
  };
  return map[state] || map.idle;
}

function escapeHtml(value) { const div=document.createElement('div'); div.textContent=String(value??''); return div.innerHTML; }

function setStatus(state, title, meta = '', detail = '') {
  ui.icon.className = `status-icon ${state}`;
  ui.icon.innerHTML = iconFor(state);
  ui.title.textContent = title;
  ui.meta.textContent = meta;
  // Force real line breaks for the compact popup status metadata.
  ui.meta.style.setProperty('white-space', 'pre-line', 'important');
  if (ui.detail) { ui.detail.hidden = !detail; ui.detail.textContent = detail || ''; }
}

function setError(error) { const message = error?.message || String(error); setStatus('bad', i.t('actionFailed'), message, message); }

async function refresh() {
  try {
    const r = await request('status');
    const state = r.gistConfigured ? 'ok' : r.authenticated ? 'warn' : 'bad';
    const title = !r.authenticated ? i.t('needsToken') : !r.gistConfigured ? i.t('githubConnectedNoGist') : i.t('ready');
    const meta = [
      r.gistId ? i.t('gistStatus', { gist: r.gistId }) : '',
      r.lastSyncAt ? `${i.t('lastSync')} ${new Date(r.lastSyncAt).toLocaleString()}` : '',
      `${i.t('autoSyncStatus')}: ${r.autoSyncEnabled ? i.t('enabled') : i.t('disabled')}`
    ].filter(Boolean).join('\n');
    setStatus(state, title, meta, '');
    ui.rev.textContent = `${i.t('revision')} ${r.syncRevision ?? 0} · ${i.t('conflictsLabel')} ${(r.conflictCount ?? 0)}`;
  } catch (error) { setError(error); }
}

async function withButton(button, work) {
  if (!button || button.disabled) return;
  const old = button.innerHTML; button.disabled = true; button.setAttribute('aria-busy', 'true');
  try { await work(); } catch (error) { setError(error); }
  finally { button.disabled = false; button.removeAttribute('aria-busy'); button.innerHTML = old; }
}

function backupText(key, vars) {
  const dict = {
    en: {
      title:'Third-party extension backups',
      description:'Back up CRX or ZIP packages for extensions that are not available from a browser store.',
      noLocal:'No third-party extensions detected.',
      local:'Installed outside a browser store',
      backup:'Back up package',
      replace:'Replace backup',
      noCloud:'No package backups in the synced Gist.',
      cloud:'Cloud backups',
      download:'Download package',
      backedUp:'Backup saved',
      downloaded:'Package downloaded',
      selected:'Selected package',
      needsGist:'Bind a GitHub Gist before using extension package backups.',
      tooLarge:'The selected package is too large. Limit: 5 MB.',
      invalid:'Please select a .crx or .zip package.',
      failed:'Extension package backup failed',
      help:'Packages are uploaded only when you choose a file. Installation remains a manual browser action.',
    },
    'zh-CN': {
      title:'第三方扩展备份',
      description:'为无法从浏览器商店获取的扩展备份 CRX 或 ZIP 文件。',
      noLocal:'未检测到第三方扩展。',
      local:'从浏览器商店之外安装',
      backup:'备份文件',
      replace:'替换备份',
      noCloud:'同步 Gist 中暂无扩展文件备份。',
      cloud:'云端备份',
      download:'下载文件',
      backedUp:'备份已保存',
      downloaded:'文件已下载',
      selected:'已选择文件',
      needsGist:'使用扩展文件备份前，请先绑定 GitHub Gist。',
      tooLarge:'文件过大，单个备份限制为 5 MB。',
      invalid:'请选择 .crx 或 .zip 文件。',
      failed:'扩展文件备份失败',
      help:'只有在你主动选择文件后才会上传。安装仍由浏览器和用户手动完成。',
    }
  };
  let value = dict[i.currentLanguage?.() === 'zh-CN' ? 'zh-CN' : 'en']?.[key] || dict.en[key] || key;
  return String(value).replace(/\{(\w+)\}/g, (_m,k)=>vars?.[k]??'');
}

async function githubBackupRequest(path, options = {}) {
  const s = await storageGet(['githubToken', 'gistId']);
  const token = String(s.githubToken || '').trim();
  const gistId = String(s.gistId || '').trim();
  if (!token || !gistId) throw new Error(backupText('needsGist'));
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2026-03-10', ...(options.body ? {'Content-Type':'application/json'} : {}), Authorization:`Bearer ${token}`, ...(options.headers || {}) }
  });
  const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = { raw:text }; }
  if (!response.ok) throw new Error(data?.message || `GitHub API HTTP ${response.status}`);
  return data;
}

function bytesToBase64(bytes) {
  let binary = ''; const chunk = 0x8000;
  for (let offset=0; offset<bytes.length; offset+=chunk) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset+chunk, bytes.length)));
  return btoa(binary);
}
function base64ToBytes(base64) {
  const binary = atob(base64); const bytes = new Uint8Array(binary.length);
  for (let n=0;n<binary.length;n++) bytes[n]=binary.charCodeAt(n); return bytes;
}
function formatBytes(size) { if(size<1024)return `${size} B`; if(size<1024*1024)return `${(size/1024).toFixed(1)} KB`; return `${(size/(1024*1024)).toFixed(1)} MB`; }
function safeFileName(name) { return String(name||'package').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,120) || 'package'; }

async function getCloudBackups() {
  const s = await storageGet(['githubToken', 'gistId']);
  if (!s.githubToken || !s.gistId) return [];
  const gist = await githubBackupRequest(`/gists/${encodeURIComponent(s.gistId)}`);
  const files = gist?.files || {};
  return Object.entries(files).filter(([name])=>name.startsWith('extension-backups/')).map(([name, file])=>({
    name,
    rawUrl:file.raw_url || '',
    size:Number(file.size||0),
    truncated:!!file.truncated,
    filename:name.split('/').pop() || name
  }));
}

async function extensionBackupEnabled() {
  const s = await storageGet(['extensionBackupBackend']);
  return s.extensionBackupBackend === 'github' || s.extensionBackupBackend === 'webdav';
}

async function renderExtensionBackups() {
  const card=$('extensionBackupCard');
  const title=$('extensionBackupTitle'), desc=$('extensionBackupDescription'), list=$('extensionBackupList');
  if(!card || !title || !desc || !list) return;

  // Do not render any backup UI when package backup is disabled.
  if(!(await extensionBackupEnabled())){
    card.hidden=true;
    list.replaceChildren();
    return;
  }

  card.hidden=false;
  title.textContent=backupText('title'); desc.textContent=backupText('description');
  list.replaceChildren();
  let local=[];
  try { local=(await chrome.management.getAll()).filter(x=>x.type==='extension'&&x.id!==chrome.runtime.id&&x.installType!=='normal'); } catch(error) { list.textContent=error?.message||String(error); return; }
  const localLabel=document.createElement('div'); localLabel.className='section-label'; localLabel.textContent=backupText('local'); list.append(localLabel);
  if(!local.length){ const empty=document.createElement('div'); empty.className='empty'; empty.textContent=backupText('noLocal'); list.append(empty); }
  for(const ext of local){
    const row=document.createElement('div'); row.className='extension-backup-row';
    const main=document.createElement('div'); main.className='extension-backup-main';
    const name=document.createElement('div'); name.className='extension-backup-name'; name.textContent=ext.name||ext.id;
    const meta=document.createElement('div'); meta.className='extension-backup-meta'; meta.textContent=`v${ext.version} · ${ext.installType||'external'} · ${ext.id}`;
    main.append(name,meta);
    const button=document.createElement('button'); button.type='button'; button.className='secondary extension-backup-button'; button.textContent=backupText('backup'); button.dataset.extensionId=ext.id; button.addEventListener('click',()=>{ const input=$('extensionPackageInput'); if(!input)return; input.value=''; input.dataset.extensionId=ext.id; input.dataset.extensionName=ext.name||ext.id; input.click(); });
    row.append(main,button); list.append(row);
  }
  try {
    const cloud=await getCloudBackups();
    const cloudLabel=document.createElement('div'); cloudLabel.className='section-label extension-backup-cloud-label'; cloudLabel.textContent=backupText('cloud'); list.append(cloudLabel);
    if(!cloud.length){ const empty=document.createElement('div'); empty.className='empty'; empty.textContent=backupText('noCloud'); list.append(empty); }
    for(const item of cloud){
      const row=document.createElement('div'); row.className='extension-backup-row';
      const main=document.createElement('div'); main.className='extension-backup-main'; const name=document.createElement('div'); name.className='extension-backup-name'; name.textContent=item.filename.replace(/\.json$/i,''); const meta=document.createElement('div'); meta.className='extension-backup-meta'; meta.textContent=item.size?formatBytes(item.size):'package'; main.append(name,meta);
      const button=document.createElement('button'); button.type='button'; button.className='secondary extension-backup-button'; button.textContent=backupText('download'); button.addEventListener('click',()=>void downloadCloudBackup(item)); row.append(main,button); list.append(row);
    }
  } catch(error) {
    const empty=document.createElement('div'); empty.className='empty error-copy'; empty.textContent=error?.message||String(error); list.append(empty);
  }
}

async function backupPackage(file, extensionId, extensionName) {
  if(!(await extensionBackupEnabled())) return;
  if(!file || !/\.(crx|zip)$/i.test(file.name)) throw new Error(backupText('invalid'));
  if(file.size>BACKUP_MAX_BYTES) throw new Error(`${backupText('tooLarge')} (${formatBytes(file.size)})`);
  const bytes=new Uint8Array(await file.arrayBuffer());
  const payload={schemaVersion:1,type:'chromium-cloud-sync-extension-package',extension:{id:extensionId,name:extensionName||extensionId},package:{fileName:file.name,size:file.size,mimeType:file.type||'application/octet-stream',savedAt:new Date().toISOString(),encoding:'base64',data:bytesToBase64(bytes)}};
  const path=`extension-backups/${safeFileName(extensionId)}.json`;
  await githubBackupRequest(`/gists/${encodeURIComponent((await storageGet(['gistId'])).gistId)}`,{method:'PATCH',body:JSON.stringify({files:{[path]:{content:JSON.stringify(payload)}}})});
  const status=$('extensionBackupStatus'); if(status){ status.hidden=false; status.className='backup-status ok'; status.textContent=`${backupText('backedUp')}: ${file.name}`; }
  await renderExtensionBackups();
}

async function downloadCloudBackup(item) {
  if(!(await extensionBackupEnabled())) return;
  if(!item?.rawUrl) throw new Error(backupText('failed'));
  const s=await storageGet(['githubToken']); const response=await fetch(item.rawUrl,{headers:{Authorization:`Bearer ${s.githubToken}`,Accept:'application/vnd.github+json'}});
  if(!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const payload=await response.json(); const bytes=base64ToBytes(payload?.package?.data||'');
  const blob=new Blob([bytes],{type:payload?.package?.mimeType||'application/octet-stream'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=safeFileName(payload?.package?.fileName||item.filename.replace(/\.json$/i,'')); document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  const status=$('extensionBackupStatus'); if(status){status.hidden=false; status.className='backup-status ok'; status.textContent=`${backupText('downloaded')}: ${a.download}`;}
}

function initExtensionBackups(){
  const input=$('extensionPackageInput'); if(!input)return;
  input.addEventListener('change',()=>{ const file=input.files?.[0]; if(!file)return; void backupPackage(file,input.dataset.extensionId||'',input.dataset.extensionName||'').catch(error=>{const status=$('extensionBackupStatus');if(status){status.hidden=false;status.className='backup-status error-copy';status.textContent=`${backupText('failed')}: ${error?.message||String(error)}`;}}); });
  void renderExtensionBackups();
}

bindAction('sync', async (_event, button) => withButton(button, async () => {
  button.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-3.8L3 10"/><path d="M3 5v5h5"/><path d="M4 13a8 8 0 0 0 14.9 3.8L21 14"/><path d="M21 19v-5h-5"/></svg><span>${i.t('syncing')}</span>`;
  const r = await request('sync'); if (!r || r.ok === false) throw new Error(r?.error || 'Sync returned no result');
  setStatus('ok', `${i.t('syncDone')} · ${i.t('revision')} ${r.revision}`, i.t('syncedSummary', { tabs: r.tabCount, groups: r.groupCount, bookmarks: r.bookmarkCount, extensions: r.extensionCount }), i.t('syncCompletedDetail', { revision: r.revision, conflicts: r.conflicts ?? 0 }));
  await refresh(); await renderExtensionBackups();
}));

bindAction('restore', async (_event, button) => withButton(button, async () => { const s=await request('pull'); const r=await request('restoreTabs',{windows:s.windows||[]}); setStatus('ok',i.t('tabsRestoreDone'),i.t('restoreSummary',{tabs:r.tabs,groups:r.groups}),i.t('restoreCompletedDetail')); }));
bindAction('restoreBookmarks', async (_event, button) => withButton(button, async () => { const s=await request('pull'); const r=await request('restoreBookmarks',{bookmarks:s.bookmarks||[]}); setStatus('ok',i.t('bookmarksRestoreDone'),i.t('bookmarkSummary',{added:r.added,moved:r.moved,updated:r.updated}),i.t('bookmarkCompletedDetail')); }));

bindAction('checkExtensions', async (_event, button) => withButton(button, async () => {
  ui.missing.innerHTML = `<div class="empty">${i.t('loading')}</div>`; const r=await request('missingExtensions');
  if(r.remoteUnavailable){const message=r.errorCode==='GIST_NOT_BOUND'?i.t('remoteExtNeedGist'):`${i.t('remoteExtUnavailable')} ${r.errorMessage||''}`;ui.missing.innerHTML=`<div class="empty error-copy">${escapeHtml(message)}</div>`;setStatus('bad',i.t('checkFailed'),message,'');return;}
  if(!r.missing.length){ui.missing.innerHTML=`<div class="empty success-copy"><strong>${i.t('noMissing')}</strong><br><span>${i.t('checkedCloudExtensions',{count:r.remote.length})}</span></div>`;setStatus('ok',i.t('extensionsReady'),i.t('checkedCloudExtensions',{count:r.remote.length}),i.t('allExtensionsInstalled'));return;}
  const wrap=document.createElement('div');wrap.className='card';wrap.innerHTML=`<div class="section-label">${escapeHtml(i.t('missingCount',{count:r.missing.length}))}</div>`;
  for(const ext of r.missing){const row=document.createElement('div');row.className='history-row';const main=document.createElement('div');main.className='history-main';const title=document.createElement('div');title.className='history-title';title.textContent=ext.name||ext.id;const meta=document.createElement('div');meta.className='history-meta';meta.textContent=ext.id;main.append(title,meta);const a=document.createElement('a');a.href=ext.store?.source==='edge'?ext.store.edgeUrl:ext.store.chromeUrl;a.target='_blank';a.rel='noreferrer';a.className='secondary';a.textContent=i.t('openInstall');row.append(main,a);wrap.append(row);} ui.missing.replaceChildren(wrap);setStatus('warn',i.t('missingFound',{count:r.missing.length}),i.t('checkedCloudExtensions',{count:r.remote.length}),i.t('installMissingHint'));
}));
bindAction('history',()=>chrome.tabs.create({url:chrome.runtime.getURL('history.html')}));
bindAction('options',()=>chrome.runtime.openOptionsPage());
bindAction('guide',()=>chrome.tabs.create({url:chrome.runtime.getURL('guide.html')}));

function setupChoiceSwitch(root, initialValue, onChange){if(!root)return;const buttons=[...root.querySelectorAll('.choice-switch-option')];const set=value=>{root.dataset.active=(value==='en'||value==='dark')?'right':'left';for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.value===value));};set(initialValue);for(const b of buttons)b.addEventListener('click',async()=>{const value=b.dataset.value;try{await onChange(value);set(value);await renderExtensionBackups();}catch(error){console.error(error);}});}

(async()=>{try{await i.initAndApply();const s=await storageGet(['language']);if(ui.lang){const lv=s.language&&s.language!=='auto'?s.language:i.currentLanguage();setupChoiceSwitch(ui.lang,lv,async v=>{await i.setLanguage(v);await refresh();});}await CCSyncTheme.initTheme();if(ui.theme){const tm=await CCSyncTheme.getTheme();const tv=tm==='dark'||tm==='light'?tm:(document.documentElement.dataset.theme||'light');setupChoiceSwitch(ui.theme,tv,async v=>CCSyncTheme.setTheme(v));}await refresh();initExtensionBackups();}catch(error){setError(error);}})();
