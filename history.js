function setupChoiceSwitch(root,initialValue,onChange){if(!root)return;const bs=[...root.querySelectorAll('.choice-switch-option')];const set=v=>{root.dataset.active=(v==='en'||v==='dark')?'right':'left';bs.forEach(b=>{const active=b.dataset.value===v;b.setAttribute('aria-pressed',String(active));b.setAttribute('aria-checked',String(active));});};set(initialValue);bs.forEach(b=>b.addEventListener('click',async()=>{const v=b.dataset.value;try{await onChange(v);set(v);}catch(e){console.error(e);}}));}
const i = CCSyncI18n;
const { request } = CCSyncRuntime;
const historyEl = document.getElementById('history');
const conflictsEl = document.getElementById('conflicts');
const statusEl = document.getElementById('status');
const langEl = document.getElementById('language');
const themeEl = document.getElementById('theme');
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fmt(s) { try { return new Date(s).toLocaleString(); } catch { return s || ''; } }
async function load() {
  try {
    statusEl.textContent = i.t('loading');
    const r = await request('historyData');
    historyEl.replaceChildren();
    const list = Array.isArray(r.commits) ? r.commits : [];
    if (!list.length) historyEl.innerHTML = `<div class="empty">${i.t('noHistory')}</div>`;
    for (const item of list) {
      const row = document.createElement('div'); row.className = 'history-row';
      const main = document.createElement('div'); main.className = 'history-main';
      const title = document.createElement('div'); title.className = 'history-title'; title.textContent = `${i.t('revision')} ${item.sha ? item.sha.slice(0, 12) : ''}${item.current ? ` · ${i.t('current')}` : ''}`;
      const meta = document.createElement('div'); meta.className = 'history-meta'; meta.textContent = `${fmt(item.createdAt)} · ${item.user || ''}`;
      main.append(title, meta);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'secondary'; btn.textContent = i.t('rollback');
      btn.addEventListener('click', async () => {
        if (!confirm(i.t('rollbackConfirm', { revision: item.sha || '' }))) return;
        const old = btn.textContent; btn.disabled = true; btn.textContent = i.t('processing');
        try { const x = await request('rollbackHistory', { revision: item.sha }); statusEl.textContent = i.t('rollbackDone', { revision: x.revision }); await load(); }
        catch (error) { statusEl.textContent = `${i.t('rollbackFailed')}: ${error.message}`; }
        finally { btn.disabled = false; btn.textContent = old; }
      });
      row.append(main, btn); historyEl.append(row);
    }
    conflictsEl.replaceChildren();
    const unresolved = (r.state?.conflicts || []).filter(x => x.status === 'unresolved');
    if (!unresolved.length) conflictsEl.innerHTML = `<div class="empty">${i.t('noConflicts')}</div>`;
    for (const c of unresolved.slice(-50).reverse()) {
      const div = document.createElement('div'); div.className = 'note danger';
      div.innerHTML = `<div><b>${esc(c.collection || c.type || 'conflict')}</b> · ${esc(c.field || '')}</div><div class="mono">${esc(c.syncId || '')} · ${esc(c.at || '')}</div><pre class="conflict-json">${esc(JSON.stringify({base:c.base,local:c.local,remote:c.remote}, null, 2))}</pre>`;
      conflictsEl.append(div);
    }
    statusEl.textContent = [i.t('gistStatus',{gist:r.gistId||i.t('notConfigured')}), i.t('revisionStatus',{revision:r.revision??0}), i.t('historyCount',{count:list.length}), i.t('unresolvedCount',{count:unresolved.length})].join('\n');
  } catch (error) { statusEl.textContent = `${i.t('historyReadFailed')}: ${error.message}`; }
}

document.getElementById('refresh').addEventListener('click', load);
(async () => {
  await i.initAndApply();
  const s = await new Promise((resolve, reject) => chrome.storage.local.get(['language'], v => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(v || {})));
  if (langEl) { const lv = s.language && s.language !== 'auto' ? s.language : i.currentLanguage(); setupChoiceSwitch(langEl, lv, async v => { await i.setLanguage(v); await load(); }); }
  await CCSyncTheme.initTheme();
  if (themeEl) { const tm = await CCSyncTheme.getTheme(); const tv = tm === 'dark' || tm === 'light' ? tm : (document.documentElement.dataset.theme || 'light'); setupChoiceSwitch(themeEl, tv, async v => CCSyncTheme.setTheme(v)); }
  await load();
})();
