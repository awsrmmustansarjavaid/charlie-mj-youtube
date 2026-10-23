const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const toast = (message, type = 'success') => {
  document.querySelector('.library-toast')?.remove();
  const n = document.createElement('div');
  n.className = `library-toast ${type}`;
  n.textContent = message;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3200);
};

function canonicalLibraryUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    if (/^(www\.)?youtube\.com$/i.test(u.hostname) || /^youtu\.be$/i.test(u.hostname)) u.protocol='https:';
    u.hash = '';
    [...u.searchParams.keys()].filter(k => /^utm_/i.test(k) || ['si','feature'].includes(k)).forEach(k => u.searchParams.delete(k));
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch { return String(url || '').trim().toLowerCase(); }
}

function findDuplicateItem(item, target) {
  const arr = Array.isArray(db[target]) ? db[target] : [];
  const id = String(item?.id || '').trim().toLowerCase();
  const url = canonicalLibraryUrl(item?.url);
  const videoId = String(item?.videoId || '').trim().toLowerCase();
  const channelId = String(item?.channelId || '').trim().toLowerCase();
  const playlistId = String(item?.playlistId || '').trim().toLowerCase();
  const handle = String(item?.handle || '').trim().toLowerCase();
  return arr.find(existing => {
    if (id && String(existing?.id || '').trim().toLowerCase() === id) return true;
    if (url && canonicalLibraryUrl(existing?.url) === url) return true;
    if (videoId && String(existing?.videoId || '').trim().toLowerCase() === videoId) return true;
    if (channelId && String(existing?.channelId || '').trim().toLowerCase() === channelId) return true;
    if (playlistId && String(existing?.playlistId || '').trim().toLowerCase() === playlistId) return true;
    if (handle && String(existing?.handle || '').trim().toLowerCase() === handle) return true;
    return false;
  }) || null;
}



function normalizeLibraryKind(value) {
  const t=String(value||'').toLowerCase().trim();
  if (t==='channel' || t==='channels') return 'channels';
  if (t==='playlist' || t==='playlists') return 'playlists';
  if (t==='video' || t==='videos' || t==='favorite' || t==='favorites') return 'videos';
  return '';
}

function detectImportedKind(item) {
  const explicit=normalizeLibraryKind(item?.type);
  if (explicit) return explicit;
  if (item?.channelId || item?.handle) return 'channels';
  if (item?.playlistId) return 'playlists';
  if (item?.videoId) return 'videos';
  try {
    const u=new URL(String(item?.url||'').trim());
    const host=u.hostname.toLowerCase();
    if (u.searchParams.get('list') && !u.searchParams.get('v')) return 'playlists';
    if (u.searchParams.get('v') || host==='youtu.be') return 'videos';
    if (/\/(channel|c|user)\//i.test(u.pathname) || /(^|\/)@[^/]+/.test(u.pathname)) return 'channels';
    if (/\/playlist\//i.test(u.pathname)) return 'playlists';
  } catch (_) {}
  return '';
}

const PROFILE_OPTIONS = [
  ['devops','DevOps Engineer'], ['frontend-developer','Frontend Developer'], ['backend-developer','Backend Developer'],
  ['full-stack-developer','Full Stack Developer'], ['network-engineer','Network Engineer'], ['cybersecurity','Cybersecurity'],
  ['cloud-engineer','Cloud Engineer'], ['data-engineer','Data Engineer'], ['graphic-designer','Graphic Designer'],
  ['ui-ux-designer','UI/UX Designer'], ['database-engineer','Database Engineer'], ['ai-ml-engineer','AI/ML Engineer'],
  ['student','Student'], ['researcher','Researcher'], ['general','General']
];
const PROFILE_NAMES = Object.fromEntries(PROFILE_OPTIONS);
const PAGE_INFO = {
  channels: ['Channels','Saved YouTube channels that can influence Charlie MJ feed intelligence.'],
  playlists: ['Playlists','Saved playlists for organized content discovery and profile matching.'],
  favorites: ['Favorite Videos','Videos saved as trusted/favorite learning or reference content.'],
  categories: ['Categories','Reusable labels for organizing library content.'],
  collections: ['Collections','Curated groups of channels, playlists and videos.']
};

let db = {channels:[], playlists:[], videos:[], favorites:[], categories:[], collections:[]};
let kind = 'channels';
let selected = new Set();
let activeId = null;
let techProfiles = [];
let languageProfiles = [];
let modalState = null;

function normalizeDb(raw) {
  const next = {channels:[], playlists:[], videos:[], favorites:[], categories:[], collections:[], ...(raw || {})};
  next.videos = Array.isArray(next.videos) ? next.videos : [];
  next.favorites = Array.isArray(next.favorites) ? next.favorites : [];

  // Favorite Videos is a view of the canonical `videos` bucket. Older builds
  // could store favorite-only records in `favorites`; merge those records back
  // into videos so they cannot disappear on the next Save/Import operation.
  const videoKeys = new Set(next.videos.map(v => String(v?.id || v?.videoId || canonicalLibraryUrl(v?.url) || '').toLowerCase()).filter(Boolean));
  for (const favorite of next.favorites) {
    if (!favorite) continue;
    const key = String(favorite.id || favorite.videoId || canonicalLibraryUrl(favorite.url) || '').toLowerCase();
    if (!key || videoKeys.has(key)) continue;
    next.videos.push({...favorite, type:'video', favorite:true});
    videoKeys.add(key);
  }
  const favoriteKeys = new Set(next.favorites.map(f => String(f?.id || f?.videoId || canonicalLibraryUrl(f?.url) || '').toLowerCase()).filter(Boolean));
  next.favorites = next.videos.filter(v => Boolean(v?.favorite) || favoriteKeys.has(String(v?.id || v?.videoId || canonicalLibraryUrl(v?.url) || '').toLowerCase()));
  next.favorites.forEach(v => { v.favorite = true; });
  for (const k of ['channels','playlists','categories','collections']) if (!Array.isArray(next[k])) next[k] = [];
  return next;
}

async function loadProfiles() {
  const stored = await chrome.storage.local.get(['techProfiles','languageProfiles']);
  techProfiles = Array.isArray(stored.techProfiles) ? stored.techProfiles : [];
  if (!techProfiles.length) {
    const ids = PROFILE_OPTIONS.map(x => x[0]).filter(x => x !== 'general');
    const loaded = await Promise.all(ids.map(async id => {
      try { const r = await fetch(chrome.runtime.getURL(`database/tech/${id}.json`)); return r.ok ? await r.json() : null; } catch { return null; }
    }));
    techProfiles = loaded.filter(Boolean);
  }
  languageProfiles = Array.isArray(stored.languageProfiles) ? stored.languageProfiles : [];
  if (!languageProfiles.length) {
    const ids = ['custom','english-learning','turkish-learning','arabic-learning','spanish-learning','french-learning','german-learning'];
    const loaded = await Promise.all(ids.map(async id => { try { const r=await fetch(chrome.runtime.getURL(`database/language-profiles/${id}.json`)); return r.ok ? await r.json() : null; } catch { return null; } }));
    languageProfiles = loaded.filter(Boolean);
  } else if (!languageProfiles.some(p => p.id === 'custom')) languageProfiles.unshift({id:'custom',name:'Custom Language Profile',learningLanguage:'',contentLanguages:[]});
}

async function load() {
  const stored = await chrome.storage.local.get('youtubeLibrary');
  db = normalizeDb(stored.youtubeLibrary);
  await loadProfiles();
  render();
  const {settings={}}=await chrome.storage.local.get('settings');
  if(settings.libraryRefresh?.enabled!==false && settings.libraryRefresh?.refreshOnOpen!==false) { chrome.runtime.sendMessage({type:'REFRESH_YOUTUBE_LIBRARY',force:false,maxItems:200}).then(r=>{if(r?.refreshed) load();}).catch(()=>{}); }
}

function currentItems() { return db[kind] || []; }
function selectedItems() { return [...selected].map(i => currentItems()[i]).filter(Boolean); }
function profileOptions(selectedIds = []) {
  const ids = new Set(Array.isArray(selectedIds) ? selectedIds : [selectedIds]);
  const tech = techProfiles.map(p => ({id:p.id, name:p.name || p.id}));
  const language = languageProfiles.map(p => ({id:`language:${p.id}`, name:p.name || p.id}));
  const group = (title, items) => `<optgroup label="${esc(title)}">${items.map(p => `<option value="${esc(p.id)}" ${ids.has(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</optgroup>`;
  return group('Tech Profiles', tech) + group('Language Profiles', language) + group('General', [{id:'general',name:'General'}]);
}
function profileTags(item) {
  const profiles = Array.isArray(item?.professionalProfiles) ? item.professionalProfiles : (item?.professionalProfile ? [item.professionalProfile] : []);
  return profiles.map(id => `<span class="tag">${esc(id.startsWith('language:') ? PROFILE_NAMES[id.slice(9)] || id.slice(9) : PROFILE_NAMES[id] || id)}</span>`).join('');
}
function categoryTags(item) {
  const ids = Array.isArray(item?.categoryIds) ? item.categoryIds : [];
  return ids.map(id => { const c = db.categories.find(x => x.id === id); return c ? `<span class="tag">${esc(c.name)}</span>` : ''; }).join('');
}
function thumb(item) {
  if (item.thumbnail) return item.thumbnail;
  if (item.type === 'video' && item.videoId) return `https://i.ytimg.com/vi/${encodeURIComponent(item.videoId)}/hqdefault.jpg`;
  return '';
}
function cardHtml(item, i) {
  const image = thumb(item);
  const title = item.title || item.name || item.id || 'Untitled';
  const type = item.type || kind.replace('favorites','video').replace(/s$/,'');
  const meta = [item.channel, item.subscribers, item.videoCount, item.views, item.published].filter(Boolean).slice(0,2);
  return `<article class="lib-card ${selected.has(i)?'selected':''}" data-index="${i}">
    <input class="card-check" type="checkbox" data-select="${i}" ${selected.has(i)?'checked':''} aria-label="Select ${esc(title)}">
    <div class="card-thumb">${image ? `<img src="${esc(image)}" loading="lazy" alt="">` : '<div style="height:100%;display:grid;place-items:center;color:#718096">No thumbnail</div>'}<span class="card-type">${esc(type)}</span></div>
    <div class="card-body"><div class="card-title">${esc(title)}</div><div class="card-meta">${meta.map(x=>`<span>${esc(x)}</span>`).join('')}</div><div class="card-tags">${profileTags(item)}${categoryTags(item)}</div><div class="card-actions"><button class="mini-action" data-refresh-item="${i}" title="Refresh latest YouTube data">↻ Refresh</button><button class="mini-action" data-detail-item="${i}" title="View details">Details</button></div><div class="card-updated">${item.lastFetchedAt?`Updated ${esc(new Date(item.lastFetchedAt).toLocaleString())}`:'Not refreshed yet'}</div></div>
  </article>`;
}

function render() {
  const info = PAGE_INFO[kind];
  $('#page-title').textContent = info[0];
  $('#page-description').textContent = info[1];
  for (const k of Object.keys(PAGE_INFO)) $(`#count-${k}`).textContent = (db[k] || []).length;
  const query = ($('#search').value || '').trim().toLowerCase();
  const items = currentItems().map((item, i) => ({item, i})).filter(({item}) => !query || JSON.stringify(item).toLowerCase().includes(query));
  if (!items.length) {
    $('#list').innerHTML = `<div class="empty"><strong>No ${esc(info[0].toLowerCase())} yet.</strong>${kind === 'categories' || kind === 'collections' ? 'Use Add to create your first reusable organizer.' : 'Use “＋ Add YouTube URL” to fetch real YouTube metadata.'}</div>`;
  } else if (kind === 'categories') {
    $('#list').innerHTML = items.map(({item,i}) => `<article class="category-card lib-card ${selected.has(i)?'selected':''}" data-index="${i}"><input class="card-check" type="checkbox" data-select="${i}" ${selected.has(i)?'checked':''}><h3>${esc(item.name || item.id)}</h3><p class="muted">${esc(item.description || 'No description')}</p><div class="card-tags">${(item.itemIds || []).slice(0,8).map(id=>`<span class="tag">${esc(id)}</span>`).join('')}</div></article>`).join('');
  } else if (kind === 'collections') {
    $('#list').innerHTML = items.map(({item,i}) => `<article class="collection-card lib-card ${selected.has(i)?'selected':''}" data-index="${i}"><input class="card-check" type="checkbox" data-select="${i}"><h3>${esc(item.name || item.id)}</h3><p class="muted">${esc(item.notes || 'Curated library collection')}</p><div class="collection-items">${(item.itemIds || []).length} item(s)</div></article>`).join('');
  } else {
    $('#list').innerHTML = items.map(({item,i}) => cardHtml(item,i)).join('');
  }
  $('#selectionSummary').textContent = `${selected.size} selected`;
}

function openModal(title, subtitle, body, actions = []) {
  $('#modalTitle').textContent = title;
  $('#modalSubtitle').textContent = subtitle || '';
  $('#modalBody').innerHTML = body;
  $('#modalActions').innerHTML = actions.map(a => `<button class="btn ${a.primary?'primary':''} ${a.danger?'danger':''}" data-modal-action="${esc(a.id)}">${esc(a.label)}</button>`).join('');
  $('#modal').hidden = false;
  modalState = {actions};
  $$('#modalActions [data-modal-action]').forEach(btn => btn.onclick = () => modalState.actions.find(a=>a.id===btn.dataset.modalAction)?.run());
}
function closeModal() { $('#modal').hidden = true; modalState = null; }

function categoryChoices(ids=[]) {
  const set = new Set(ids);
  if (!db.categories.length) return '<p class="help">No categories exist yet. Create one from the Categories page.</p>';
  return `<div class="check-grid">${db.categories.map(c=>`<label class="choice"><input type="checkbox" name="categoryIds" value="${esc(c.id)}" ${set.has(c.id)?'checked':''}>${esc(c.name)}</label>`).join('')}</div>`;
}
function profileChoices(ids=[]) {
  const set = new Set(ids);
  const tech = techProfiles.map(p=>`<label class="choice"><input type="checkbox" name="profileIds" value="${esc(p.id)}" ${set.has(p.id)?'checked':''}>${esc(p.name||p.id)}</label>`).join('');
  const lang = languageProfiles.map(p=>`<label class="choice"><input type="checkbox" name="profileIds" value="language:${esc(p.id)}" ${set.has(`language:${p.id}`)?'checked':''}>🌐 ${esc(p.name||p.id)}</label>`).join('');
  return `<div class="check-grid">${tech}${lang}<label class="choice"><input type="checkbox" name="profileIds" value="general" ${set.has('general')?'checked':''}>General</label></div>`;
}

async function fetchYouTubeUrl(raw) {
  const result = await chrome.runtime.sendMessage({type:'GET_YOUTUBE_URL_DATA', url:raw});
  if (!result?.ok || !result.item) throw new Error(result?.error || 'YouTube metadata could not be fetched.');
  return result.item;
}

function addUrlDialog() {
  openModal('Add YouTube URL', 'Enter a YouTube channel, playlist, or video. Charlie MJ will fetch the original YouTube metadata before saving.', `
    <div class="form-grid">
      <div class="field full"><label>YouTube URL</label><input id="ytUrl" placeholder="https://www.youtube.com/watch?v=… / playlist?list=… / @channel" autocomplete="off"><div class="help">No manual title or thumbnail is required. The extension fetches them from YouTube.</div></div>
      <div class="field"><label>Library category</label><div id="urlCategories">${categoryChoices()}</div></div>
      <div class="field"><label>Content profiles</label><div id="urlProfiles">${profileChoices(['devops'])}</div></div>
    </div>
    <div id="urlPreview" style="margin-top:18px"></div>`,
    [
      {id:'cancel',label:'Cancel',run:closeModal},
      {id:'fetch',label:'Fetch YouTube Data',primary:true,run:fetchAndPreview},
      {id:'save',label:'Save to Library',primary:true,run:saveFetched,disabled:true}
    ]
  );
  $('#modalActions [data-modal-action="save"]').disabled = true;
  let fetched = null;
  async function fetchAndPreview() {
    const raw = $('#ytUrl').value.trim();
    if (!raw) return toast('Paste a YouTube URL first.', 'warn');
    const btn = $('#modalActions [data-modal-action="fetch"]'); btn.disabled = true; btn.textContent = 'Fetching…';
    try {
      fetched = await fetchYouTubeUrl(raw);
      const fetchedKind = normalizeLibraryKind(fetched.type);
      const expectedKind = kind === 'favorites' ? 'videos' : kind;
      if (!fetchedKind || fetchedKind !== expectedKind) {
        fetched = null;
        throw new Error(`This URL is a ${fetchedKind || 'different YouTube item'} and cannot be added from the ${PAGE_INFO[kind][0]} tab.`);
      }
      const type = fetched.type;
      const img = fetched.thumbnail ? `<img src="${esc(fetched.thumbnail)}" alt="Original YouTube thumbnail">` : '<div></div>';
      $('#urlPreview').innerHTML = `<div class="preview">${img}<div><h3>${esc(fetched.title || 'Untitled')}</h3><div class="card-meta">${esc(type)}${fetched.channel?` · ${esc(fetched.channel)}`:''}${fetched.views?` · ${esc(fetched.views)} views`:''}</div><p class="help">${esc(fetched.description || 'YouTube metadata fetched successfully.')}</p></div></div>`;
      $('#modalActions [data-modal-action="save"]').disabled = false;
      btn.textContent = 'Refresh YouTube Data';
    } catch (error) { toast(error.message, 'error'); btn.textContent = 'Fetch YouTube Data'; }
    finally { btn.disabled = false; }
  }
  async function saveFetched() {
    if (!fetched) { toast('Fetch YouTube Data first.', 'warn'); return; }
    const categoryIds = $$('input[name="categoryIds"]:checked', $('#urlCategories')).map(x=>x.value);
    const professionalProfiles = $$('input[name="profileIds"]:checked', $('#urlProfiles')).map(x=>x.value);
    const item = {
      ...fetched,
      favorite: fetched.type === 'video',
      categoryIds,
      professionalProfiles: professionalProfiles.length ? professionalProfiles : ['general'],
      professionalProfile: professionalProfiles[0] || 'general',
      trusted: fetched.type === 'channel' ? true : false,
      followed: fetched.type === 'channel' ? true : false,
      followFeed: fetched.type === 'channel' ? true : undefined,
      addedAt: new Date().toISOString()
    };
    const target = fetched.type === 'channel' ? 'channels' : fetched.type === 'playlist' ? 'playlists' : 'videos';
    const { settings: currentSettings = {} } = await chrome.storage.local.get('settings');
    if (currentSettings.preventLibraryDuplicates !== false) {
      const duplicate = findDuplicateItem(item, target);
      if (duplicate) {
        toast(`Cannot save because this ${fetched.type} is already saved in YouTube Library.`, 'warn');
        return;
      }
    }
    db[target].push(item);
    if (fetched.type === 'video') {
      const favIndex = db.favorites.findIndex(x => x.id === item.id);
      if (favIndex >= 0) db.favorites[favIndex] = {...db.favorites[favIndex], ...item}; else db.favorites.push({...item, favorite:true});
    }
    kind = target === 'videos' ? 'favorites' : target;
    selected.clear(); activeId = item.id;
    await saveLibrary(false);
    closeModal(); render();
  }
}

function editItem(index = activeIndex()) {
  const item = currentItems()[index];
  if (!item) { toast('Select an item first.', 'warn'); return; }
  const categoryIds = item.categoryIds || [];
  const profiles = item.professionalProfiles || (item.professionalProfile ? [item.professionalProfile] : ['general']);
  openModal(`Edit ${kind === 'favorites' ? 'Video' : kind.slice(0,-1)}`, 'Edit local library metadata. Original YouTube data remains available in this record.', `
    <div class="form-grid">
      <div class="field"><label>Title</label><input id="editTitle" value="${esc(item.title || item.name || '')}"></div>
      <div class="field"><label>YouTube URL</label><input id="editUrl" value="${esc(item.url || '')}"></div>
      <div class="field full"><label>Description / Notes</label><textarea id="editDescription" rows="5">${esc(item.description || item.notes || '')}</textarea></div>
      <div class="field"><label>Categories</label>${categoryChoices(categoryIds)}</div>
      <div class="field"><label>Profiles</label>${profileChoices(profiles)}</div>
      ${kind==='channels'?`<div class="field full"><label>Channel behavior</label><div class="check-grid"><label class="choice"><input id="followFeed" type="checkbox" ${item.followFeed!==false?'checked':''}> Follow on Home feed</label><label class="choice"><input id="trusted" type="checkbox" ${item.trusted?'checked':''}> Trusted channel boost</label></div></div>`:''}
    </div>`,
    [{id:'cancel',label:'Cancel',run:closeModal},{id:'apply',label:'Apply Changes',primary:true,run:async()=>{
      item.title = $('#editTitle').value.trim() || item.title || 'Untitled';
      if (item.name) item.name = item.title;
      item.url = $('#editUrl').value.trim() || item.url;
      if (item.description !== undefined) item.description = $('#editDescription').value.trim(); else item.notes = $('#editDescription').value.trim();
      item.categoryIds = $$('input[name="categoryIds"]:checked').map(x=>x.value);
      item.professionalProfiles = $$('input[name="profileIds"]:checked').map(x=>x.value);
      item.professionalProfile = item.professionalProfiles[0] || 'general';
      if (kind==='channels') { item.followFeed = $('#followFeed').checked; item.trusted = $('#trusted').checked; }
      await saveLibrary(false); closeModal(); render();
    }}]
  );
}

function activeIndex() {
  if (activeId != null) { const i = currentItems().findIndex(x => x.id === activeId); if (i >= 0) return i; }
  if (selected.size === 1) return [...selected][0];
  return -1;
}

function detailItem(index = activeIndex()) {
  const item = currentItems()[index];
  if (!item) { toast('Select an item first.', 'warn'); return; }
  const rows = Object.entries(item).filter(([k,v]) => v !== undefined && v !== null && v !== '' && !['thumbnail','description'].includes(k)).map(([k,v]) => `<div class="detail-item"><small>${esc(k)}</small><div>${Array.isArray(v) ? esc(v.join(', ')) : esc(typeof v === 'object' ? JSON.stringify(v) : v)}</div></div>`).join('');
  openModal('Library Details', item.title || item.name || 'Item details', `<div class="preview">${item.thumbnail?`<img src="${esc(item.thumbnail)}" alt="">`:'<div></div>'}<div><h3>${esc(item.title || item.name || 'Untitled')}</h3><p class="help">${esc(item.description || item.notes || 'No description')}</p>${item.url?`<a href="${esc(item.url)}" target="_blank" rel="noreferrer">${esc(item.url)}</a>`:''}</div></div><div class="section-title">Metadata</div><div class="detail-grid">${rows || '<div class="muted">No extra metadata.</div>'}</div>`, [{id:'close',label:'Close',run:closeModal},{id:'edit',label:'Edit',primary:true,run:()=>{closeModal();editItem(index)}}]);
}

function addManual() {
  if (kind === 'categories') return editCategory();
  if (kind === 'collections') return editCollection();
  const target = kind === 'favorites' ? 'videos' : kind;
  const defaults = target === 'channels' ? {type:'channel',id:uid('channel'),title:'New Channel',url:'',categories:[],categoryIds:[],professionalProfiles:['devops'],professionalProfile:'devops',trusted:false,followFeed:true} : target === 'playlists' ? {type:'playlist',id:uid('playlist'),title:'New Playlist',url:'',categoryIds:[],professionalProfiles:['devops'],professionalProfile:'devops'} : {type:'video',id:uid('video'),title:'New Video',url:'',favorite:true,categoryIds:[],professionalProfiles:['devops'],professionalProfile:'devops'};
  db[target].push(defaults);
  if (target === 'videos') db.favorites = db.videos.filter(v => v.favorite);
  activeId = defaults.id; selected.clear();
  const viewItems = currentItems();
  const idx = viewItems.findIndex(x => x.id === defaults.id);
  if (idx >= 0) selected.add(idx);
  render(); editItem(idx >= 0 ? idx : viewItems.length - 1);
}

function editCategory(index = activeIndex()) {
  const item = index >= 0 ? db.categories[index] : {id:uid('category'),name:'New Category',description:'',itemIds:[]};
  if (index < 0) db.categories.push(item), index = db.categories.length - 1;
  openModal('Category', 'Create or edit a reusable library category.', `<div class="form-grid"><div class="field"><label>Category name</label><input id="catName" value="${esc(item.name)}"></div><div class="field"><label>Description</label><input id="catDesc" value="${esc(item.description)}"></div><div class="field full"><label>Items</label><div class="check-grid">${libraryItemChoices(item.itemIds || [])}</div></div></div>`, [{id:'cancel',label:'Cancel',run:()=>{if(!item.name||item.name==='New Category') db.categories.splice(index,1); closeModal();render()}},{id:'save',label:'Save Category',primary:true,run:async()=>{item.name=$('#catName').value.trim()||'Untitled Category';item.description=$('#catDesc').value.trim();item.itemIds=$$('input[name="memberIds"]:checked').map(x=>x.value);await saveLibrary(false);closeModal();render()}}]);
}
function libraryItemChoices(ids) {
  const set = new Set(ids);
  const all = [...db.channels,...db.playlists,...db.videos];
  return all.length ? all.map(x=>`<label class="choice"><input type="checkbox" name="memberIds" value="${esc(x.id)}" ${set.has(x.id)?'checked':''}>${esc(x.title||x.name||x.id)}</label>`).join('') : '<span class="help">Add channels, playlists or videos first.</span>';
}
function editCollection(index = activeIndex()) {
  const item = index >= 0 ? db.collections[index] : {id:uid('collection'),name:'New Collection',notes:'',itemIds:[]};
  if (index < 0) db.collections.push(item), index = db.collections.length - 1;
  openModal('Collection', 'Create or edit a curated collection of library items.', `<div class="form-grid"><div class="field"><label>Collection name</label><input id="colName" value="${esc(item.name)}"></div><div class="field"><label>Notes</label><input id="colNotes" value="${esc(item.notes)}"></div><div class="field full"><label>Collection items</label><div class="check-grid">${libraryItemChoices(item.itemIds || [])}</div></div></div>`, [{id:'cancel',label:'Cancel',run:()=>{if(!item.name||item.name==='New Collection') db.collections.splice(index,1);closeModal();render()}},{id:'save',label:'Save Collection',primary:true,run:async()=>{item.name=$('#colName').value.trim()||'Untitled Collection';item.notes=$('#colNotes').value.trim();item.itemIds=$$('input[name="memberIds"]:checked').map(x=>x.value);await saveLibrary(false);closeModal();render()}}]);
}

async function refreshLibraryItem(index) {
  const item = currentItems()[index]; if (!item?.url) { toast('This item has no YouTube URL to refresh.', 'warn'); return; }
  try {
    const result = await chrome.runtime.sendMessage({type:'GET_YOUTUBE_URL_DATA',url:item.url});
    if(!result?.ok || !result.item) throw new Error(result?.error || 'YouTube data could not be refreshed.');
    const fresh=result.item;
    currentItems()[index]={...item,...fresh,categoryIds:item.categoryIds||[],professionalProfiles:item.professionalProfiles||[],professionalProfile:item.professionalProfile,trusted:item.trusted,followed:item.followed,followFeed:item.followFeed,favorite:item.favorite,addedAt:item.addedAt,updatedAt:new Date().toISOString()};
    if(item.type==='video' && Array.isArray(db.favorites)){const fi=db.favorites.findIndex(x=>x.id===item.id);if(fi>=0)db.favorites[fi]={...db.favorites[fi],...currentItems()[index]};}
    await saveLibrary(false); render();
  } catch(e) { toast(`Refresh failed: ${e.message}`, 'error'); }
}

async function refreshYouTubeData(force=true) {
  const button=$('#refreshYouTube'); if(button){button.disabled=true;button.textContent='Refreshing…';}
  try { const result=await chrome.runtime.sendMessage({type:'REFRESH_YOUTUBE_LIBRARY',force,maxItems:200}); await load(); toast(`YouTube library refresh complete. Updated ${result?.refreshed||0} item(s).`); }
  catch(e){toast(`YouTube refresh failed: ${e.message}`, 'error');} finally {if(button){button.disabled=false;button.textContent='↻ Refresh YouTube Data';}}
}

async function refreshSettingsDialog() {
  const {settings={}}=await chrome.storage.local.get('settings');
  const cfg={enabled:true,intervalHours:24,staleAfterHours:24,refreshOnOpen:true,refreshOnStartup:true,refreshThumbnails:true,refreshMetadata:true,refreshStatistics:true,...(settings.libraryRefresh||{})};
  openModal('YouTube Data Refresh','Control automatic metadata refresh for saved channels, playlists and videos.',`<div class="form-grid"><label class="choice"><input id="lrEnabled" type="checkbox" ${cfg.enabled!==false?'checked':''}> Enable automatic refresh</label><label class="choice"><input id="lrOpen" type="checkbox" ${cfg.refreshOnOpen!==false?'checked':''}> Refresh stale items when Library opens</label><label class="choice"><input id="lrStartup" type="checkbox" ${cfg.refreshOnStartup!==false?'checked':''}> Refresh stale items on browser startup</label><div class="field"><label>Automatic interval (hours)</label><input id="lrInterval" type="number" min="1" max="168" value="${cfg.intervalHours||24}"></div><div class="field"><label>Stale after (hours)</label><input id="lrStale" type="number" min="1" max="720" value="${cfg.staleAfterHours||24}"></div><label class="choice"><input id="lrThumb" type="checkbox" ${cfg.refreshThumbnails!==false?'checked':''}> Refresh thumbnails</label><label class="choice"><input id="lrMeta" type="checkbox" ${cfg.refreshMetadata!==false?'checked':''}> Refresh metadata</label><label class="choice"><input id="lrStats" type="checkbox" ${cfg.refreshStatistics!==false?'checked':''}> Refresh statistics</label></div>`,[{id:'cancel',label:'Cancel',run:closeModal},{id:'save',label:'Save Refresh Settings',primary:true,run:async()=>{const next={enabled:$('#lrEnabled').checked,intervalHours:Math.max(1,Math.min(168,Number($('#lrInterval').value)||24)),staleAfterHours:Math.max(1,Math.min(720,Number($('#lrStale').value)||24)),refreshOnOpen:$('#lrOpen').checked,refreshOnStartup:$('#lrStartup').checked,refreshThumbnails:$('#lrThumb').checked,refreshMetadata:$('#lrMeta').checked,refreshStatistics:$('#lrStats').checked};await chrome.storage.local.set({settings:{...settings,libraryRefresh:next}});closeModal();toast('YouTube Library refresh settings saved.');}}]);
}

async function saveLibrary(notify=true) {
  db.videos = [...db.videos];
  db.favorites = db.videos.filter(v => v.favorite);
  await chrome.storage.local.set({youtubeLibrary:db});
  if (notify) toast('YouTube Library saved successfully.');
}
function download(name,data) { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }

$('#libraryTabs').onclick = event => {
  const tab = event.target.closest('.library-tab'); if (!tab) return;
  kind = tab.dataset.kind; selected.clear(); activeId = null;
  $$('.library-tab').forEach(x=>x.classList.toggle('active',x===tab));
  render();
};
$('#list').onclick = async event => {
  const checkbox = event.target.closest('[data-select]');
  if (checkbox) { const i=Number(checkbox.dataset.select); checkbox.checked?selected.add(i):selected.delete(i); activeId=currentItems()[i]?.id||null; render(); return; }
  const refreshButton = event.target.closest('[data-refresh-item]');
  if (refreshButton) { event.stopPropagation(); await refreshLibraryItem(Number(refreshButton.dataset.refreshItem)); return; }
  const detailButton = event.target.closest('[data-detail-item]');
  if (detailButton) { event.stopPropagation(); detailItem(Number(detailButton.dataset.detailItem)); return; }
  const card = event.target.closest('.lib-card'); if (!card) return;
  const i=Number(card.dataset.index); activeId=currentItems()[i]?.id||null; selected.clear(); selected.add(i); render(); detailItem(i);
};
$('#search').oninput = render;
$('#addUrl').onclick = addUrlDialog;
$('#add').onclick = addManual;
$('#edit').onclick = () => kind==='categories' ? editCategory() : kind==='collections' ? editCollection() : editItem();
$('#detail').onclick = detailItem;
$('#remove').onclick = async () => {
  const indices=[...selected].sort((a,b)=>b-a);
  if (!indices.length) return toast('Select one or more items first.', 'warn');
  if (!confirm(`Delete ${indices.length} selected ${kind} item(s)?`)) return;
  const arr=currentItems(); for(const i of indices) arr.splice(i,1);
  selected.clear(); activeId=null; await saveLibrary(false); render();
};
$('#refresh').onclick = load;
$('#refreshYouTube').onclick = () => refreshYouTubeData(true);
$('#refreshSettings').onclick = refreshSettingsDialog;
$('#save').onclick = () => saveLibrary(true);
$('#back').onclick = () => chrome.runtime.openOptionsPage();
$('#import').onclick = () => $('#file').click();
$('#file').onchange = async event => {
  const file=event.target.files?.[0]; if(!file)return;
  try {
    const data=JSON.parse(await file.text());
    const imported = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : (Array.isArray(data.playlists) ? data.playlists : (data[kind] || [])));
    if (!Array.isArray(imported)) throw new Error('No importable items found.');

    const expectedKind = kind === 'favorites' ? 'videos' : kind;
    const mismatches = imported.map((item,i) => ({item,i,detected:detectImportedKind(item)})).filter(x => x.detected && x.detected !== expectedKind);
    if (mismatches.length) {
      const detected = mismatches[0].detected === 'channels' ? 'Channel' : mismatches[0].detected === 'playlists' ? 'Playlist' : 'Video';
      throw new Error(`Import rejected: ${detected} data cannot be imported into the ${PAGE_INFO[kind][0]} tab. Select the matching tab and import again.`);
    }

    // Favorite Videos are backed by the canonical `videos` bucket. Importing
    // directly into `favorites` would be lost because saveLibrary() rebuilds
    // favorites from videos. Always normalize favorite imports to videos.
    const importTarget = kind === 'favorites' ? 'videos' : kind;

    // Accept exported/third-party JSON records that do not have an id yet.
    // Prefer a YouTube video/playlist/channel id from the URL, then videoId.
    for (const item of imported) {
      if (!item || item.id) {
        if (item && kind === 'favorites') { item.type = 'video'; item.favorite = true; }
        continue;
      }
      try {
        const u = new URL(String(item.url || '').trim());
        const host = u.hostname.toLowerCase();
        const listId = u.searchParams.get('list');
        const videoId = u.searchParams.get('v');
        const shortVideoId = host === 'youtu.be' ? u.pathname.replace(/^\//, '').split('/')[0] : '';
        if (listId && kind !== 'favorites') item.id = listId;
        else if (videoId) item.id = videoId;
        else if (shortVideoId) item.id = shortVideoId;
      } catch (_) {}
      if (!item.id && item.videoId) item.id = String(item.videoId).trim();
      if (!item.id) item.id = `imported-${importTarget}-${item.sourceDocumentNumber || Date.now()}-${String(item.title || 'item').toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,50)}`;
      item.type = kind === 'favorites' ? 'video' : (item.type || (kind === 'videos' ? 'video' : kind === 'channels' ? 'channel' : 'playlist'));
      if (kind === 'favorites') item.favorite = true;
    }

    const { settings: currentSettings = {} } = await chrome.storage.local.get('settings');
    let added = 0, skipped = 0;
    for (const rawItem of imported) {
      if (!rawItem?.id) continue;
      const item = kind === 'favorites' ? {...rawItem, type:'video', favorite:true} : rawItem;
      const duplicate = currentSettings.preventLibraryDuplicates !== false && ['channels','playlists','videos'].includes(importTarget)
        ? findDuplicateItem(item, importTarget)
        : null;
      const targetItems = db[importTarget] || (db[importTarget] = []);
      if (duplicate) {
        // A favorite import should still be able to mark an existing video as
        // favorite; it must not create a second library record.
        if (kind === 'favorites' && duplicate.type === 'video') {
          Object.assign(duplicate, item, {favorite:true});
        } else {
          skipped++;
        }
        continue;
      }
      const i = targetItems.findIndex(x => x.id === item.id);
      if (i >= 0) targetItems[i] = {...targetItems[i], ...item};
      else { targetItems.push(item); added++; }
    }
    if (kind === 'favorites') {
      kind = 'favorites';
    }
    await saveLibrary(false); render();
    toast(`Import complete: ${added} added${skipped ? `, ${skipped} duplicate(s) skipped` : ''}.`, skipped ? 'warn' : 'success');
  } catch(error) { toast(`Import failed: ${error.message}`, 'error'); }
  event.target.value='';
};
$('#export').onclick = () => {
  const items=selectedItems();
  download(`youtube-library-${kind}-${stamp()}.json`, {exportType:`youtube-library-${kind}`,version:'2.0.0',exportedAt:new Date().toISOString(),source:'Charlie MJ YouTube',items:items.length?items:currentItems()});
};
$$('[data-close-modal]').forEach(x=>x.onclick=closeModal);
$('#modal').addEventListener('click', e=>{if(e.target.id==='modal')closeModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#modal').hidden)closeModal()});
load();
