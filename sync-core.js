export const SCHEMA_VERSION = 10;
export const HISTORY_LIMIT = 30;

export function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
export function stableEqual(a,b){ return JSON.stringify(a)===JSON.stringify(b); }
function objectId(item){ return item && typeof item==='object' ? (item.syncId || item.id || item.key || null) : null; }

const MERGE_POLICIES = {
  tabs: { title:'latest', url:'conflict', pinned:'latest', active:'latest', index:'latest', group:'latest' },
  bookmarks: { title:'latest', url:'conflict', parentSyncId:'latest', index:'latest' },
  extensions: { enabled:'latest', version:'maxVersion', homepageUrl:'latest', updateUrl:'latest', installType:'latest' },
  groups: { title:'latest', color:'latest', collapsed:'latest' },
  windows: { state:'latest', focused:'latest' },
  default: {}
};

function timeOf(x){ return String(x?.updatedAt || x?.modifiedAt || ''); }
function versionTuple(v){ return String(v||'').split('.').map(x=>Number.parseInt(x,10)||0); }
function compareVersions(a,b){ const A=versionTuple(a), B=versionTuple(b); for(let i=0;i<Math.max(A.length,B.length);i++){ if((A[i]||0)!==(B[i]||0)) return (A[i]||0)-(B[i]||0); } return 0; }
function winnerByLatest(local,remote){ const lt=timeOf(local), rt=timeOf(remote); if(lt!==rt) return lt>rt?'local':'remote'; return 'local'; }

export function mergeField(base, local, remote, type, field, conflicts, path){
  if(stableEqual(local,remote)) return clone(local);
  if(stableEqual(local,base)) return clone(remote);
  if(stableEqual(remote,base)) return clone(local);
  const policy=(MERGE_POLICIES[type]||MERGE_POLICIES.default)[field] || 'conflict';
  if(policy==='latest'){
    const side=winnerByLatest(local,remote); conflicts.push({type:'field-auto-resolved',collection:type,syncId:path,field,status:'resolved',winner:side,strategy:'latest'}); return clone(side==='local'?local:remote);
  }
  if(policy==='maxVersion'){ const side=compareVersions(local,remote)>=0?'local':'remote'; conflicts.push({type:'field-auto-resolved',collection:type,syncId:path,field,status:'resolved',winner:side,strategy:'maxVersion'}); return clone(side==='local'?local:remote); }
  conflicts.push({type:'field-conflict',collection:type,syncId:path,field,base:clone(base),local:clone(local),remote:clone(remote),status:'unresolved',strategy:'manual'});
  return clone(local);
}

export function mergeEntity(base={}, local={}, remote={}, type, conflicts, path){
  if(stableEqual(local,remote)) return clone(local);
  if(stableEqual(local,base)) return clone(remote);
  if(stableEqual(remote,base)) return clone(local);
  const out={};
  const keys=new Set([...Object.keys(base||{}),...Object.keys(local||{}),...Object.keys(remote||{})]);
  for(const key of keys){
    const hasB=Object.prototype.hasOwnProperty.call(base,key), hasL=Object.prototype.hasOwnProperty.call(local,key), hasR=Object.prototype.hasOwnProperty.call(remote,key);
    const b=hasB?base[key]:undefined, l=hasL?local[key]:undefined, r=hasR?remote[key]:undefined;
    if(Array.isArray(l)&&Array.isArray(r)) { out[key]=mergeArray(b,l,r,conflicts,`${path}.${key}`); continue; }
    if(l&&r&&typeof l==='object'&&typeof r==='object'&&!Array.isArray(l)&&!Array.isArray(r)) { out[key]=mergeEntity(b||{},l,r,type,conflicts,`${path}.${key}`); continue; }
    if(!hasL&&!hasR) continue;
    if(!hasL){ if(hasB&&!stableEqual(r,b)){ conflicts.push({type:'delete-vs-modify',collection:type,syncId:path,field:key,status:'unresolved',winner:'remote'}); out[key]=clone(r);} continue; }
    if(!hasR){ if(hasB&&!stableEqual(l,b)){ conflicts.push({type:'delete-vs-modify',collection:type,syncId:path,field:key,status:'unresolved',winner:'local'}); out[key]=clone(l);} continue; }
    out[key]=mergeField(b,l,r,type,key,conflicts,`${path}.${key}`);
  }
  return out;
}

function mergeArray(base,local,remote,conflicts,path){
  const B=Array.isArray(base)?base:[], L=Array.isArray(local)?local:[], R=Array.isArray(remote)?remote:[];
  if(stableEqual(L,R)) return clone(L); if(stableEqual(L,B)) return clone(R); if(stableEqual(R,B)) return clone(L);
  const ids=[...B,...L,...R].map(objectId);
  if(ids.some(x=>!x)) { conflicts.push({type:'array-conflict',collection:path,syncId:path,status:'unresolved',winner:'local',base:clone(B),local:clone(L),remote:clone(R)}); return clone(L); }
  const bm=new Map(B.map(x=>[String(objectId(x)),x])), lm=new Map(L.map(x=>[String(objectId(x)),x])), rm=new Map(R.map(x=>[String(objectId(x)),x]));
  const keys=new Set([...bm.keys(),...lm.keys(),...rm.keys()]); const out=[];
  for(const id of keys){ const b=bm.get(id), l=lm.get(id), r=rm.get(id), type=path.split('.')[0] || 'objects';
    if(!l&&!r) continue;
    if(l&&!r){ if(b&&!stableEqual(l,b)) conflicts.push({type:'delete-vs-modify',collection:type,syncId:id,status:'unresolved',winner:'local'}); out.push(clone(l)); continue; }
    if(!l&&r){ if(b&&!stableEqual(r,b)) conflicts.push({type:'delete-vs-modify',collection:type,syncId:id,status:'unresolved',winner:'remote'}); out.push(clone(r)); continue; }
    out.push(mergeEntity(b||{},l,r,type,conflicts,`${type}.${id}`));
  }
  out.sort((a,b)=>Number(a.index??0)-Number(b.index??0));
  return out;
}

function mergeExtensionSettings(base={}, local={}, remote={}, conflicts){
  const B=base&&typeof base==='object'&&!Array.isArray(base)?base:{};
  const L=local&&typeof local==='object'&&!Array.isArray(local)?local:{};
  const R=remote&&typeof remote==='object'&&!Array.isArray(remote)?remote:{};
  if(stableEqual(L,R)) return clone(L);
  if(stableEqual(L,B)) return clone(R);
  if(stableEqual(R,B)) return clone(L);
  const out={};
  const keys=new Set([...Object.keys(B),...Object.keys(L),...Object.keys(R)]);
  for(const key of keys){
    const hasB=Object.prototype.hasOwnProperty.call(B,key), hasL=Object.prototype.hasOwnProperty.call(L,key), hasR=Object.prototype.hasOwnProperty.call(R,key);
    const b=hasB?B[key]:undefined, l=hasL?L[key]:undefined, r=hasR?R[key]:undefined;
    if(stableEqual(l,r)){ if(hasL) out[key]=clone(l); continue; }
    if(hasL&&hasR&&stableEqual(l,b)){ out[key]=clone(r); continue; }
    if(hasL&&hasR&&stableEqual(r,b)){ out[key]=clone(l); continue; }
    if(!hasL&&hasR){
      if(hasB&&!stableEqual(r,b)) conflicts.push({type:'setting-delete-vs-modify',collection:'extensionSettings',setting:key,base:clone(b),local:undefined,remote:clone(r),status:'unresolved',winner:'remote'});
      if(hasR) out[key]=clone(r);
      continue;
    }
    if(hasL&&!hasR){
      if(hasB&&!stableEqual(l,b)) conflicts.push({type:'setting-delete-vs-modify',collection:'extensionSettings',setting:key,base:clone(b),local:clone(l),remote:undefined,status:'unresolved',winner:'local'});
      out[key]=clone(l);
      continue;
    }
    conflicts.push({type:'setting-conflict',collection:'extensionSettings',setting:key,base:clone(b),local:clone(l),remote:clone(r),status:'unresolved',strategy:'manual'});
    out[key]=clone(l);
  }
  return out;
}

export function mergeSnapshots(base={},local={},remote={}){
  const conflicts=[]; const out={schemaVersion:SCHEMA_VERSION};
  const scalarKeys=new Set(['updatedAt','schemaVersion','device']);
  for(const key of Object.keys(local||{})) if(!scalarKeys.has(key)&&!['extensions','windows','bookmarks'].includes(key)) out[key]=clone(local[key]);
  const BWin=Array.isArray(base?.windows)?base.windows:[], LWin=Array.isArray(local?.windows)?local.windows:[], RWin=Array.isArray(remote?.windows)?remote.windows:[];
  if(stableEqual(LWin,RWin)) out.windows=clone(LWin);
  else if(stableEqual(LWin,BWin)) out.windows=clone(RWin);
  else if(stableEqual(RWin,BWin)) out.windows=clone(LWin);
  else {
    out.windows=clone(LWin);
    conflicts.push({type:'collection-auto-resolved',collection:'windows',status:'resolved',winner:'local',strategy:'device-live-state'});
  }
  out.extensions=mergeArray(base?.extensions,local?.extensions,remote?.extensions,conflicts,'extensions');
  out.bookmarks=mergeArray(base?.bookmarks,local?.bookmarks,remote?.bookmarks,conflicts,'bookmarks');
  delete out.extensionSettings;
  out.device=clone(local.device||remote.device||base.device);
  out.updatedAt=new Date().toISOString();
  return {snapshot:out,conflicts};
}

export function extractEntities(snapshot){
  const m=new Map(); const put=(c,x)=>{const id=objectId(x);if(id)m.set(`${c}:${id}`,clone(x));};
  for(const x of snapshot?.extensions||[])put('extensions',x);
  for(const w of snapshot?.windows||[]){put('windows',w); for(const t of w.tabs||[]){put('tabs',t);if(t.group?.syncId)put('groups',t.group);}}
  for(const b of snapshot?.bookmarks||[])put('bookmarks',b);
  return m;
}
export function deriveTombstones(base,local,prior=[],revision=0,updatedAt=new Date().toISOString()){
  const bm=extractEntities(base), lm=extractEntities(local), map=new Map((prior||[]).map(t=>[`${t.collection}:${t.syncId}`,clone(t)]));
  for(const [key] of bm) if(!lm.has(key)){const [collection,syncId]=key.split(/:(.+)/);map.set(key,{collection,syncId,deletedAt:updatedAt,revision});}
  for(const key of lm) map.delete(key); return [...map.values()];
}
export function mergeTombstones(...sources){ const map=new Map(); for(const list of sources){for(const t of list||[]){const k=`${t.collection}:${t.syncId}`,old=map.get(k);if(!old||String(t.deletedAt)>String(old.deletedAt))map.set(k,clone(t));}} return [...map.values()]; }
export function applyTombstones(snapshot,tombstones=[]){
  const d=new Set((tombstones||[]).map(t=>`${t.collection}:${t.syncId}`)); const out=clone(snapshot||{});
  out.extensions=(out.extensions||[]).filter(x=>!d.has(`extensions:${objectId(x)}`));
  out.windows=(out.windows||[]).filter(w=>!d.has(`windows:${objectId(w)}`));
  for(const w of out.windows) w.tabs=(w.tabs||[]).filter(t=>!d.has(`tabs:${objectId(t)}`));
  out.bookmarks=(out.bookmarks||[]).filter(b=>!d.has(`bookmarks:${objectId(b)}`)); return out;
}
export function mergeDeviceStates(devices){
  const entries=Object.values(devices||{}).filter(Boolean).sort((a,b)=>String(a.updatedAt||'').localeCompare(String(b.updatedAt||'')));
  if(!entries.length)return null;
  const merged={schemaVersion:SCHEMA_VERSION,updatedAt:entries.at(-1)?.updatedAt||new Date().toISOString()};
  const chooseByLatest=new Map();
  const mergeCollection=(collection)=>{
    const map=new Map();
    for(const entry of entries){
      const arr=Array.isArray(entry.snapshot?.[collection])?entry.snapshot[collection]:[];
      for(const item of arr){
        const id=objectId(item); if(!id) continue;
        const key=String(id), candidate={item,updatedAt:entry.updatedAt||'',deviceName:entry.deviceName||entry.snapshot?.device?.name||''};
        const prev=map.get(key);
        if(!prev || String(candidate.updatedAt)>=String(prev.updatedAt)) map.set(key,candidate);
      }
    }
    return [...map.values()].map(x=>clone(x.item));
  };
  merged.extensions=mergeCollection('extensions');
  merged.bookmarks=mergeCollection('bookmarks');
  merged.windows=mergeCollection('windows');
  const latest=entries.at(-1);
  merged.device=clone(latest?.snapshot?.device||{name:latest?.deviceName||''});
  const tombstoneMap=new Map();
  for(const entry of entries){
    for(const t of entry.tombstones||[]){
      const k=`${t.collection}:${t.syncId}`, prev=tombstoneMap.get(k);
      if(!prev||String(t.deletedAt)>String(prev.deletedAt)) tombstoneMap.set(k,clone(t));
    }
  }
  const tombstones=[...tombstoneMap.values()];
  Object.assign(merged, applyTombstones(merged,tombstones));
  merged.syncMeta={devices:entries.map(e=>({deviceId:e.deviceId,deviceName:e.deviceName||e.snapshot?.device?.name||'',revision:e.revision||0,updatedAt:e.updatedAt||''})),tombstones};
  return merged;
}

export function cleanConflicts(conflicts=[]){
  return (conflicts||[]).filter(c=>{
    if(!c || c.status==='resolved' || c.status==='ignored') return false;
    const vals=[c.base,c.local,c.remote].filter(v=>v!==undefined&&v!==null);
    const hasMeaningful=vals.some(v=>typeof v==='object' ? Object.keys(v).length>0 : String(v)!=='');
    if(!hasMeaningful && c.type!=='rollback') return false;
    return !!c.collection || !!c.type;
  });
}

export function checksum(value){let h=2166136261;const s=JSON.stringify(value);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');}
export function pushHistoryIndex(history,entry){return [entry,...(history||[])].slice(0,HISTORY_LIMIT);}
