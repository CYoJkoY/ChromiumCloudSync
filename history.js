function setupChoiceSwitch(root,initialValue,onChange){if(!root)return;const bs=[...root.querySelectorAll('.choice-switch-option')];const set=v=>{root.dataset.active=(v==='en'||v==='dark')?'right':'left';bs.forEach(b=>{const active=b.dataset.value===v;b.setAttribute('aria-pressed',String(active));b.setAttribute('aria-checked',String(active));});};set(initialValue);bs.forEach(b=>b.addEventListener('click',async()=>{const v=b.dataset.value;try{await onChange(v);set(v);}catch(e){console.error(e);}}));}
const i = CCSyncI18n;
const { request } = CCSyncRuntime;
const historyEl = document.getElementById('history');
const conflictsEl = document.getElementById('conflicts');
const statusEl = document.getElementById('status');
const paginationEl = document.getElementById('historyPagination');
const langEl = document.getElementById('language');
const themeEl = document.getElementById('theme');
const PAGE_SIZE = 10;
let historyItems = [];
let currentPage = 1;

function esc(s) { return String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])); }
function fmt(s) { try { return new Date(s).toLocaleString(); } catch { return s || ''; } }
function paginationText(key, vars = {}) {
  const lang = i.currentLanguage?.() === 'zh-CN' ? 'zh-CN' : 'en';
  const dict = {
    en: {
      previous: 'Previous',
      next: 'Next',
      page: 'Page {current} of {total}',
      shown: 'Showing {start}-{end} of {count} history entries'
    },
    'zh-CN': {
      previous: '上一页',
      next: '下一页',
      page: '第 {current} / {total} 页',
      shown: '显示第 {start}-{end} 条，共 {count} 条历史记录'
    }
  };
  return String(dict[lang][key] || dict.en[key] || key).replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? '');
}

function installPaginationStyles() {
  if (document.getElementById('historyPaginationStyles')) return;
  const style = document.createElement('style');
  style.id = 'historyPaginationStyles';
  style.textContent = `
    .history-pagination{display:grid;grid-template-columns:auto 1fr auto;grid-template-areas:"prev state next";gap:10px;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
    .history-pagination-button{min-width:84px}
    .history-pagination-state{grid-area:state;text-align:center;font-size:13px;font-weight:600;color:var(--text)}
    .history-pagination-count{grid-column:1/-1;grid-row:2;text-align:center;font-size:11px;color:var(--text-2)}
    .history-pagination-button:first-child{grid-area:prev}
    .history-pagination-button:last-child{grid-area:next}
    @media(max-width:560px){.history-pagination{grid-template-columns:1fr 1fr;grid-template-areas:"state state" "prev next"}.history-pagination-count{grid-column:1/-1;grid-row:auto}.history-pagination-state{padding-bottom:2px}}
  `;
  document.head.append(style);
}

function renderHistoryPage() {
  historyEl.replaceChildren();
  const totalPages = Math.max(1, Math.ceil(historyItems.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);

  if (!historyItems.length) {
    historyEl.innerHTML = `<div class="empty">${i.t('noHistory')}</div>`;
    renderPagination(0, 0, 0);
    return;
  }

  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, historyItems.length);
  for (const item of historyItems.slice(startIndex, endIndex)) {
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
  renderPagination(startIndex + 1, endIndex, historyItems.length);
}

function renderPagination(start, end, count) {
  if (!paginationEl) return;
  paginationEl.replaceChildren();
  if (!count) {
    paginationEl.hidden = true;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  if (totalPages <= 1) {
    paginationEl.hidden = true;
    return;
  }

  paginationEl.hidden = false;
  const wrap = document.createElement('div');
  wrap.className = 'history-pagination';

  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'secondary history-pagination-button';
  previous.textContent = paginationText('previous');
  previous.disabled = currentPage <= 1;
  previous.addEventListener('click', () => { if (currentPage > 1) { currentPage -= 1; renderHistoryPage(); } });

  const state = document.createElement('span');
  state.className = 'history-pagination-state';
  state.textContent = paginationText('page', { current: currentPage, total: totalPages });

  const shown = document.createElement('span');
  shown.className = 'history-pagination-count';
  shown.textContent = paginationText('shown', { start, end, count });

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'secondary history-pagination-button';
  next.textContent = paginationText('next');
  next.disabled = currentPage >= totalPages;
  next.addEventListener('click', () => { if (currentPage < totalPages) { currentPage += 1; renderHistoryPage(); } });

  wrap.append(previous, state, shown, next);
  paginationEl.append(wrap);
}

async function load() {
  try {
    statusEl.textContent = i.t('loading');
    const r = await request('historyData');
    historyItems = Array.isArray(r.commits) ? r.commits : [];
    currentPage = Math.min(currentPage, Math.max(1, Math.ceil(historyItems.length / PAGE_SIZE)));
    renderHistoryPage();

    conflictsEl.replaceChildren();
    const unresolved = (r.state?.conflicts || []).filter(x => x.status === 'unresolved');
    if (!unresolved.length) conflictsEl.innerHTML = `<div class="empty">${i.t('noConflicts')}</div>`;
    for (const c of unresolved.slice(-50).reverse()) {
      const div = document.createElement('div'); div.className = 'note danger';
      div.innerHTML = `<div><b>${esc(c.collection || c.type || 'conflict')}</b> · ${esc(c.field || '')}</div><div class="mono">${esc(c.syncId || '')} · ${esc(c.at || '')}</div><pre class="conflict-json">${esc(JSON.stringify({base:c.base,local:c.local,remote:c.remote}, null, 2))}</pre>`;
      conflictsEl.append(div);
    }
    statusEl.textContent = [i.t('gistStatus',{gist:r.gistId||i.t('notConfigured')}), i.t('revisionStatus',{revision:r.revision??0}), i.t('historyCount',{count:historyItems.length}), i.t('unresolvedCount',{count:unresolved.length})].join('\n');
  } catch (error) { statusEl.textContent = `${i.t('historyReadFailed')}: ${error.message}`; }
}

document.getElementById('refresh').addEventListener('click', load);
(async () => {
  await i.initAndApply();
  installPaginationStyles();
  const s = await new Promise((resolve, reject) => chrome.storage.local.get(['language'], v => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(v || {})));
  if (langEl) { const lv = s.language && s.language !== 'auto' ? s.language : i.currentLanguage(); setupChoiceSwitch(langEl, lv, async v => { await i.setLanguage(v); currentPage = 1; await load(); }); }
  await CCSyncTheme.initTheme();
  if (themeEl) { const tm = await CCSyncTheme.getTheme(); const tv = tm === 'dark' || tm === 'light' ? tm : (document.documentElement.dataset.theme || 'light'); setupChoiceSwitch(themeEl, tv, async v => CCSyncTheme.setTheme(v)); }
  await load();
})();
