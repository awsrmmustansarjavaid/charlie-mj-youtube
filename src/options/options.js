import { getSettings, saveSettings, getStats, DEFAULTS } from "../shared/core.js";
import { loadLanguageCatalog, findLanguage, countryDefaults, languageKey, optionList } from "../shared/language-catalog.js";

let sharedLanguageCatalog = { languages: [], languagesByCountry: {} };

const TAB_META = {
  dashboard: ["Dashboard", "Overview and quick health status"],
  general: ["General", "Global YouTube experience controls"],
  modes: ["Modes", "Choose and configure General, Tech, Language Learning, Niches, Productivity and Custom"],
  distraction: ["Distraction Control", "Separate relevance from distraction and choose hide/deprioritize/allow behavior"],
  statistics: ["Statistics", "Content intelligence, filtering and focus statistics"],
  screentime: ["Screen Time", "Local YouTube time monitor by day and mode"],
  blocktube: ["BlockTube Filters", "Granular title, channel, video, regex and context blocking"],
  filtertube: ["FilterTube Controls", "Smart matching, quick blocking, shelves, playlists and watched-video controls"],
  cleantubefilters: ["ClearnTube Filters UL", "Unified distraction, feed, navigation and interface controls"],
  playback: ["Playback & Player", "Speed, quality, theater/cinema, loop, autoplay and player preferences"],
  ads: ["YouTube Ad Control", "Network, video and cosmetic advertisement blocking"],
  privacy: ["Privacy & Blocking", "Channels, video IDs, keywords and regex rules"],
  language: ["Target Country & Language", "Searchable geographic and language targeting"],
  targetfeed: ["Target Feed", "Make YouTube prioritize and display your selected country and language"],
  tools: ["YouTube Tools", "Actions for the active YouTube tab"],
  fetch: ["YouTube Fetch", "Inspect visible video cards without private APIs"],
  suggestions: ["Suggestions", "Local topic scoring and discovery"],
  algorithm: ["Algorithm Insights", "Transparent local observations"],
  sync: ["Data Sync", "Compare local JSON data with GitHub"],
  performance: ["Performance", "Runtime metrics and last scan"],
  notifications: ["Notifications", "Desktop notification preferences"],
  toolbar: ["Floating Toolbar", "Movable Windows-style YouTube control bar"],
  database: ["Database Manager", "Backup, restore and database counts"],
  profiles: ["Profiles & Backup", "Independent settings profiles, PIN protection and portable backups"]
};

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const lines = (id) => ($(id) ? $(id).value.split(/\r?\n/).map(v => v.trim()).filter(Boolean) : []);

let currentTab = "dashboard";
let settings;
let countryData;
let languageData;


// Additional country → language intelligence. The first language is the automatic suggestion;
// additional entries are offered as alternatives. Manual language choices are never overwritten
// after the user explicitly changes the language selector.
const COUNTRY_LANGUAGE_HINTS = {
  TR: ["tr"], PK: ["ur", "en"], IN: ["hi", "en"], DE: ["de"], AT: ["de"], CH: ["de", "fr", "it"],
  FR: ["fr"], BE: ["nl", "fr", "de"], NL: ["nl"], ES: ["es"], PT: ["pt"], IT: ["it"],
  GB: ["en"], IE: ["en", "ga"], US: ["en"], CA: ["en", "fr"], AU: ["en"], NZ: ["en"],
  ZA: ["en", "zu", "xh", "af"], NG: ["en"], GH: ["en"], KE: ["en", "sw"], TZ: ["sw", "en"],
  EG: ["ar"], SA: ["ar"], AE: ["ar"], QA: ["ar"], JO: ["ar"], IQ: ["ar", "ku"], MA: ["ar", "fr"],
  DZ: ["ar", "fr"], TN: ["ar", "fr"], IL: ["he", "ar"], IR: ["fa"], AF: ["ps", "fa"],
  RU: ["ru"], UA: ["uk"], PL: ["pl"], CZ: ["cs"], SK: ["sk"], HU: ["hu"], RO: ["ro"],
  BG: ["bg"], GR: ["el"], RS: ["sr"], HR: ["hr"], SI: ["sl"], AL: ["sq"], BA: ["bs", "hr", "sr"],
  GE: ["ka"], AM: ["hy"], AZ: ["az"], KZ: ["kk", "ru"], UZ: ["uz"], MN: ["mn"],
  CN: ["zh"], TW: ["zh"], HK: ["zh", "en"], MO: ["zh", "pt"], JP: ["ja"], KR: ["ko"],
  VN: ["vi"], TH: ["th"], ID: ["id"], MY: ["ms"], SG: ["en", "zh", "ms", "ta"], PH: ["en", "fil"],
  BD: ["bn"], LK: ["si", "ta"], NP: ["ne"], KH: ["km"], LA: ["lo"], MM: ["my"],
  BR: ["pt"], MX: ["es"], AR: ["es"], CL: ["es"], CO: ["es"], PE: ["es"], VE: ["es"],
  BO: ["es"], EC: ["es"], UY: ["es"], PY: ["es", "gn"], CR: ["es"], PA: ["es"], DO: ["es"],
  CU: ["es"], GT: ["es"], HN: ["es"], SV: ["es"], NI: ["es"], PR: ["es"], JM: ["en"],
  IS: ["is"], NO: ["no"], SE: ["sv"], DK: ["da"], FI: ["fi"], EE: ["et"], LV: ["lv"], LT: ["lt"],
  LU: ["lb", "fr", "de"], MT: ["mt", "en"], CY: ["el", "tr"]
};

function languageCodeForRecord(record) {
  return String(record?.alpha_2 || record?.alpha_3 || record?.terminology || record?.bibliographic || "").toLowerCase();
}

function findLanguageByCode(code) {
  const c = String(code || "").toLowerCase();
  return (languageData?.languages || []).find(x => [x.alpha_2, x.alpha_3, x.terminology, x.bibliographic].filter(Boolean).some(v => String(v).toLowerCase() === c));
}

function suggestedLanguagesForCountry(countryCode) {
  return (COUNTRY_LANGUAGE_HINTS[String(countryCode || "").toUpperCase()] || [])
    .map(findLanguageByCode).filter(Boolean);
}

function notify(message, type = "success") {
  document.querySelector(".toast")?.remove();
  const n = document.createElement("div");
  n.className = `toast ${type}`;
  n.textContent = message;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3200);
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function deriveBackupKey(passphrase, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:150000,hash:"SHA-256"}, base, {name:"AES-GCM",length:256}, false, ["encrypt","decrypt"]);
}
async function encryptBackup(data, passphrase) {
  const salt=crypto.getRandomValues(new Uint8Array(16)); const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await deriveBackupKey(passphrase,salt); const encoded=new TextEncoder().encode(JSON.stringify(data));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoded);
  return {format:"charlie-mj-encrypted-backup",version:"1.0.0",kdf:"PBKDF2-SHA256",iterations:150000,cipher:"AES-GCM",salt:btoa(String.fromCharCode(...salt)),iv:btoa(String.fromCharCode(...iv)),data:btoa(String.fromCharCode(...new Uint8Array(cipher)))};
}
async function decryptBackup(wrapper, passphrase) {
  const salt=Uint8Array.from(atob(wrapper.salt),c=>c.charCodeAt(0)); const iv=Uint8Array.from(atob(wrapper.iv),c=>c.charCodeAt(0)); const cipher=Uint8Array.from(atob(wrapper.data),c=>c.charCodeAt(0));
  const key=await deriveBackupKey(passphrase,salt); const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,cipher); return JSON.parse(new TextDecoder().decode(plain));
}

async function loadJson(path) {
  const response = await fetch(chrome.runtime.getURL(path), { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
  return response.json();
}

async function loadDatabase() {
  countryData ||= await loadJson("database/countries/countries.json");
  languageData ||= await loadJson("database/languages/languages.json");
}

function countryOptions(query = "") {
  const q = query.trim().toLowerCase();
  return (countryData?.countries || []).filter(x => !q || `${x.name} ${x.code} ${x.alpha3}`.toLowerCase().includes(q))
    .map(x => `<option value="${esc(x.code)}" ${x.code === settings.country ? "selected" : ""}>${esc(x.name)} (${esc(x.code)})</option>`).join("");
}

function languageOptions(query = "") {
  const q = query.trim().toLowerCase();
  return (languageData?.languages || []).filter(x => `${x.name||""} ${x.alpha_2||""} ${x.alpha_3||""} ${x.bibliographic||""} ${x.terminology||""}`.toLowerCase().includes(q))
    .map(x => { const code = x.alpha_2 || x.alpha_3 || x.terminology || x.bibliographic || ""; return `<option value="${esc(code)}" ${code === settings.targetLanguage ? "selected" : ""}>${esc(x.name)}${code ? ` (${esc(code)})` : ""}</option>`; }).join("");
}

async function sendToYouTube(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(www\.)?youtube\.com\//i.test(tab.url || "")) {
    notify("Open YouTube first, then try this action.", "warn");
    return { ok: false, error: "Open YouTube first" };
  }
  const send = () => new Promise(resolve => chrome.tabs.sendMessage(tab.id, message, response => {
    const error = chrome.runtime.lastError;
    resolve(error ? { ok: false, error: error.message } : (response || { ok: true }));
  }));
  let result = await send();
  if (!result.ok && /Receiving end does not exist/i.test(result.error || "")) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content/youtube.js"] });
      result = await send();
    } catch (e) { result = { ok: false, error: e.message }; }
  }
  if (!result.ok) notify(`YouTube action failed: ${result.error}`, "error");
  return result;
}

function renderDashboard() {
  return getStats().then(stats => {
    $("#content").innerHTML = `
      <div class="grid">
        <div class="card"><h3>Videos scanned</h3><div class="metric">${stats.videosScanned || 0}</div><span class="muted">Local extension metric</span></div>
        <div class="card"><h3>Videos hidden</h3><div class="metric">${stats.videosHidden || 0}</div><span class="muted">Filtering actions</span></div>
        <div class="card"><h3>Notifications</h3><div class="metric">${stats.notifications || 0}</div><span class="muted">Desktop notification events</span></div>
      </div>
      <div class="card quick-access" style="margin-top:14px">
        <div class="quick-access-head">
          <div><h3>Quick Access</h3><p class="muted">Open the dedicated management pages directly from the front panel.</p></div>
        </div>
        <div class="quick-access-grid">
          <button class="quick-card" data-page="modes"><span>🎛️</span><strong>Modes</strong><small>General, Tech, Language Learning, Niches, Productivity & Custom</small></button>
          <button class="quick-card" data-page="tech"><span>⚙️</span><strong>Tech Mode</strong><small>Professional technology profiles and Tech JSON</small></button>
          <button class="quick-card" data-page="language-learning"><span>🌐</span><strong>Language Learning</strong><small>7,910-language catalog and learning profiles</small></button>
          <button class="quick-card" data-page="niches"><span>🎯</span><strong>Niches Mode</strong><small>Interest-based niche profiles, topics and focused content</small></button>
          <button class="quick-card" data-page="library"><span>📚</span><strong>YouTube Library</strong><small>Channels, playlists, videos and collections</small></button>
          <button class="quick-card" data-page="about"><span>ℹ️</span><strong>About Me</strong><small>About Charlie MJ YouTube and documentation</small></button>
          <button class="quick-card" data-tab="statistics"><span>📊</span><strong>Statistics</strong><small>Intelligence, filtering and distraction results</small></button>
          <button class="quick-card" data-tab="screentime"><span>⏱️</span><strong>Screen Time</strong><small>Daily YouTube usage by mode</small></button>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3>Extension status</h3>
        <p class="ok">● Settings engine online</p>
        <p>Version <strong>2.0.0</strong> · Manifest V3 · JSON database</p>
        <p>Target: <strong>${esc(settings.country || "US")}</strong> / <strong>${esc(settings.targetLanguage || "en")}</strong></p>
        <p class="muted">Filtering is based on information visible to the extension. It does not access YouTube's private recommendation system.</p>
      </div>`;

    document.querySelectorAll(".quick-card").forEach(button => {
      button.addEventListener("click", () => {
        if (button.dataset.page) {
          if (button.dataset.page === "modes") {
            currentTab = "modes";
            document.querySelectorAll(".nav").forEach(x => x.classList.toggle("active", x.dataset.tab === currentTab));
            render();
            return;
          }
          const pages = {tech:"src/tech/tech.html","language-learning":"src/language-learning/language-learning.html",niches:"src/niches/niches.html",library:"src/library/library.html",about:"src/about/about.html"};
          if (pages[button.dataset.page]) chrome.tabs.create({ url: chrome.runtime.getURL(pages[button.dataset.page]) });
          return;
        }
        if (button.dataset.tab) {
          currentTab = button.dataset.tab;
          document.querySelectorAll(".nav").forEach(x => x.classList.toggle("active", x.dataset.tab === currentTab));
          render();
        }
      });
    });
  });
}

const HIDE_CONTROL_KEYS = [
  "hideHomeRecommendations", "hideRecommendations", "hideSidebar", "hideThumbnails", "disableAutoplay", "hideAds",
  "hideShorts", "hideExplore", "hideTrending", "hideSubscriptions", "hideSearchSuggestions",
  "hideComments", "hideLiveChat", "hideEndscreenRecommendations", "hideFeaturedContent", "hideMembersOnly",
  "hideMerch", "hideDonationPromos", "hideMembershipPromos", "hideMixes", "hideCommunity", "hideMusic",
  "hideGaming", "hideNews", "hideMovies", "hideLive", "hideStore", "hideChannelTabs"
];

function isFullControlActive() {
  return settings.fullControl === true;
}

function renderGeneral(){const s=settings,f=s.followedChannelFeed||{};$('#content').innerHTML=`<div class="grid"><div class="card form"><div class="section-heading"><h3>Extension Control Center</h3><div class="actions"><button class="btn danger-btn" id="resetGeneral">Reset General</button><button class="btn danger-btn" id="factoryRestore">Restore Factory Settings</button></div></div><label class="check"><input id="extEnabled" type="checkbox" ${s.extensionEnabled!==false?'checked':''}> Enable Charlie MJ YouTube</label><label class="check"><input id="notifGeneral" type="checkbox" ${s.notifications!==false?'checked':''}> Enable extension notifications</label><label class="check"><input id="targetShortcut" type="checkbox" ${s.targetFeedEnabled?'checked':''}> Enable Target Feed</label><label class="check"><input id="profileGeneral" type="checkbox" ${s.applyYouTubeProfile!==false?'checked':''}> Apply selected YouTube country/language profile</label><label class="check"><input id="toolbarGeneral" type="checkbox" ${s.toolbarEnabled!==false?'checked':''}> Enable floating toolbar</label></div><div class="card form"><h3>General Intelligence</h3><label class="check"><input id="generalFeedIntelligence" type="checkbox"> Enable General Feed Intelligence</label><label class="check"><input id="generalFallback" type="checkbox"> Use General as fallback</label><label class="check"><input id="generalCountryInfluence" type="checkbox"> Country influence</label><label class="check"><input id="generalLanguageInfluence" type="checkbox"> Language influence</label><label class="check"><input id="generalChannelInfluence" type="checkbox"> Channel/profile influence</label><label class="check"><input id="generalTopicInfluence" type="checkbox"> Topic relevance</label><label class="check"><input id="generalLibraryInfluence" type="checkbox"> Library influence</label><label class="check"><input id="generalDistraction" type="checkbox"> Distraction filtering</label><div class="field"><label>General strictness</label><select id="generalStrictness"><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="focused">Focused</option><option value="strict">Strict</option></select></div></div><div class="card form"><h3>Target & automation</h3><div class="field"><label>Target country</label><div class="metric">${esc(s.country||'GLOBAL')}</div></div><div class="field"><label>Target language</label><div class="metric">${esc(s.targetLanguage||'en')}</div></div><div class="actions"><button class="btn" id="openTargetSettings">Open Target Country & Language</button><button class="btn" id="openTargetFeed">Open Target Feed</button></div></div><div class="card form"><h3>Followed Channel Feed</h3><p class="muted">Channels marked Follow feed in YouTube Library can surface their new content on Home.</p><label class="check"><input id="followFeedEnabled" type="checkbox" ${f.enabled!==false?'checked':''}> Show followed-channel feed</label><label class="check"><input id="followNewOnly" type="checkbox" ${f.showOnlyNew!==false?'checked':''}> Prefer new/recent content</label><label class="check"><input id="followShorts" type="checkbox" ${f.includeShorts?'checked':''}> Include Shorts</label><div class="row"><div class="field"><label>Maximum items</label><input id="followMax" type="number" min="1" max="30" value="${Number(f.maxItems||12)}"></div><div class="field"><label>Refresh minutes</label><input id="followRefresh" type="number" min="5" max="360" value="${Number(f.refreshMinutes||30)}"></div></div><div class="field"><label>Placement</label><select id="followPlacement"><option value="home-top">Home top</option><option value="home-after-feed">After YouTube feed</option></select></div></div></div><div class="card"><h3>Compatibility</h3><p class="muted">General Mode remains the existing working engine. New intelligence features are additive and controlled from their own tabs.</p><strong>Charlie MJ YouTube · v2.0.0</strong></div>`;$('#followPlacement').value=f.placement||'home-top';const gm=s.generalMode||DEFAULTS.generalMode; ['generalFeedIntelligence','generalFallback','generalCountryInfluence','generalLanguageInfluence','generalChannelInfluence','generalTopicInfluence','generalLibraryInfluence','generalDistraction'].forEach((id,i)=>{const keys=['feedIntelligence','useAsFallback','countryInfluence','languageInfluence','channelInfluence','topicInfluence','libraryInfluence','distractionFiltering']; if($('#'+id)) $('#'+id).checked=gm[keys[i]]!==false;}); $('#generalStrictness').value=gm.strictness||'balanced';
$('#resetGeneral').onclick=async()=>{settings=await saveSettings({generalMode:JSON.parse(JSON.stringify(DEFAULTS.generalMode)),extensionEnabled:true,notifications:true,targetFeedEnabled:false,applyYouTubeProfile:true,toolbarEnabled:true,followedChannelFeed:{...DEFAULTS.followedChannelFeed}});notify('General settings reset.');renderGeneral();};
$('#factoryRestore').onclick=async()=>{if(!confirm('Restore factory settings? This will remove saved extension settings, profiles, library and statistics.'))return; await chrome.storage.local.clear(); settings=await saveSettings({...DEFAULTS}); notify('Factory settings restored.'); renderGeneral();};
['generalFeedIntelligence','generalFallback','generalCountryInfluence','generalLanguageInfluence','generalChannelInfluence','generalTopicInfluence','generalLibraryInfluence','generalDistraction','generalStrictness'].forEach(id=>$('#'+id)?.addEventListener('change',async()=>{const keys={generalFeedIntelligence:'feedIntelligence',generalFallback:'useAsFallback',generalCountryInfluence:'countryInfluence',generalLanguageInfluence:'languageInfluence',generalChannelInfluence:'channelInfluence',generalTopicInfluence:'topicInfluence',generalLibraryInfluence:'libraryInfluence',generalDistraction:'distractionFiltering'}; const gm2={...(settings.generalMode||DEFAULTS.generalMode)}; if(keys[id]) gm2[keys[id]]=$('#'+id).checked; else gm2.strictness=$('#'+id).value; settings=await saveSettings({generalMode:gm2});}));
$('#openTargetSettings').onclick=()=>{currentTab='language';document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.tab===currentTab));render()};$('#openTargetFeed').onclick=()=>{currentTab='targetfeed';document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x.dataset.tab===currentTab));render()};}
function renderClearnTubeFilters() {
  const s = settings;
  const checks = key => s[key] ? "checked" : "";
  const full = isFullControlActive();
  $("#content").innerHTML = `<div class="card form">
    <h3>Full Control</h3>
    <label class="check"><input id="fullControl" type="checkbox" ${full ? "checked" : ""}> Enable complete distraction-control profile</label>
    <p class="muted">When enabled, every hide/filter control in this tab is turned on. Turning it off restores the individual settings you had before Full Control was enabled.</p>
    <div class="actions"><button class="btn" id="enableAll">Enable All</button><button class="btn" id="disableAll">Disable All</button></div>
  </div>
  <div class="grid">
    <div class="card form"><h3>Global controls</h3>
      <div class="row"><div class="field"><label>Theme</label><select id="ctTheme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div><div class="field"><label>UI density</label><select id="ctDensity"><option value="normal">Normal</option><option value="compact">Compact</option></select></div></div>
      ${[
        ["hideHomeRecommendations","Hide homepage recommendation feed"],["hideRecommendations","Hide related/recommended videos"],["hideSidebar","Hide YouTube sidebar"],["hideThumbnails","Hide video thumbnails"],["disableAutoplay","Disable autoplay"],["hideAds","Hide visible advertisement UI elements"]
      ].map(([k,l])=>`<label class="check"><input class="ct" data-key="${k}" type="checkbox" ${checks(k)} ${full ? "disabled" : ""}> ${l}</label>`).join("")}
    </div>
    <div class="card form"><h3>Feed Filters</h3><p class="muted">Shorts, recommendations and distraction controls</p>
      <div class="actions"><button class="btn" id="ctSave">Save Changes</button></div>
      <h4>Feed & navigation</h4>
      ${[["hideShorts","Hide Shorts"],["hideExplore","Hide Explore"],["hideTrending","Hide Trending"],["hideSubscriptions","Hide Subscriptions navigation"],["hideSearchSuggestions","Hide search suggestions"]].map(([k,l])=>`<label class="check"><input class="ct" data-key="${k}" type="checkbox" ${checks(k)} ${full ? "disabled" : ""}> ${l}</label>`).join("")}
      <h4>Video page</h4>
      ${[["hideComments","Hide comments"],["hideLiveChat","Hide live chat"],["hideEndscreenRecommendations","Hide end-screen recommendations"],["hideFeaturedContent","Hide featured/members-only promotional content"]].map(([k,l])=>`<label class="check"><input class="ct" data-key="${k}" type="checkbox" ${checks(k)} ${full ? "disabled" : ""}> ${l}</label>`).join("")}
    </div>
    <div class="card form"><h3>Geographic filter behavior</h3>
      <label class="check"><input id="ctStrict" type="checkbox" ${s.strictCountry ? "checked" : ""}> Strict selected-country filtering</label>
      <div class="field"><label>Country keywords — one per line</label><textarea id="ctCountryKeywords">${esc((s.countryKeywords || []).join("\n"))}</textarea></div>
    </div>
  </div>
  <div class="card-section" style="margin-top:14px">
    <div class="section-heading"><div><h3>CleanTube UI</h3><p class="muted">Distraction-free YouTube controls, organized as a responsive grid.</p></div><div class="actions"><span class="section-badge">${full ? "FULL CONTROL ON" : "MANUAL"}</span><button class="btn danger-btn" id="resetCleanTube">Reset CleanTube</button></div></div>
    <div class="ct-grid">
      <div class="card form"><h3>Home & navigation</h3>
        ${[["hideHomeRecommendations","Hide Home recommendations"],["hideRecommendations","Hide related recommendations"],["hideSidebar","Hide sidebar"],["hideExplore","Hide Explore"],["hideTrending","Hide Trending"],["hideSubscriptions","Hide Subscriptions"],["hideCommunity","Hide Community navigation"],["hideSearchSuggestions","Hide search suggestions"]].map(([k,l])=>`<label class="check"><input class="ct" data-key="${k}" type="checkbox" ${checks(k)} ${full ? "disabled" : ""}> ${l}</label>`).join("")}
      </div>
      <div class="card form"><h3>Video experience</h3>
        ${[["hideShorts","Hide Shorts"],["hideComments","Hide comments"],["hideLiveChat","Hide live chat"],["hideEndscreenRecommendations","Hide end-screen recommendations"],["hideFeaturedContent","Hide featured content"],["hideThumbnails","Hide thumbnails"],["disableAutoplay","Disable autoplay"]].map(([k,l])=>`<label class="check"><input class="ct" data-key="${k}" type="checkbox" ${checks(k)} ${full ? "disabled" : ""}> ${l}</label>`).join("")}
      </div>
      <div class="card form"><h3>Shelves & promotions</h3>
        ${[["hideMerch","Hide merch shelves"],["hideDonationPromos","Hide donation/promotional shelves"],["hideMembershipPromos","Hide membership promotions"],["hideMixes","Hide Mixes/radio shelves"],["hideFeaturedContent","Hide featured content"]].map(([k,l])=>`<label class="check"><input class="ct" data-key="${k}" type="checkbox" ${checks(k)} ${full ? "disabled" : ""}> ${l}</label>`).join("")}
      </div>
      <div class="card form"><h3>YouTube sections</h3>
        ${[["hideMusic","Hide Music navigation"],["hideGaming","Hide Gaming navigation"],["hideNews","Hide News navigation"],["hideMovies","Hide Movies navigation"],["hideLive","Hide Live navigation"],["hideStore","Hide Store navigation"],["hideChannelTabs","Hide channel tabs"]].map(([k,l])=>`<label class="check"><input class="ct" data-key="${k}" type="checkbox" ${checks(k)} ${full ? "disabled" : ""}> ${l}</label>`).join("")}
      </div>
    </div>
    <p class="muted" style="margin-top:12px">These controls only hide interface surfaces; they do not modify your YouTube account or remove Premium features.</p>
    <div class="actions"><button class="btn" id="ctSave2">Save Changes</button></div>
  </div>`;
  $("#ctTheme").value = s.theme || "system";
  $("#ctDensity").value = s.compactMode ? "compact" : "normal";
  const applyFull = async on => {
    if (on && !settings.fullControl) {
      settings.fullControlBackup = Object.fromEntries(HIDE_CONTROL_KEYS.map(k => [k, !!settings[k]]));
      HIDE_CONTROL_KEYS.forEach(k => settings[k] = true);
      settings.fullControl = true;
    } else if (!on && settings.fullControl) {
      const backup = settings.fullControlBackup || {};
      HIDE_CONTROL_KEYS.forEach(k => settings[k] = Object.prototype.hasOwnProperty.call(backup,k) ? !!backup[k] : false);
      settings.fullControlBackup = null;
      settings.fullControl = false;
    }
    settings = await saveSettings({ fullControl: settings.fullControl, fullControlBackup: settings.fullControlBackup, ...Object.fromEntries(HIDE_CONTROL_KEYS.map(k => [k, !!settings[k]])) });
    notify(on ? "Complete distraction-control profile enabled." : "Complete distraction-control profile disabled; previous settings restored.");
    renderClearnTubeFilters();
  };
  $("#resetCleanTube").onclick = async () => { settings = await saveSettings(Object.fromEntries(HIDE_CONTROL_KEYS.map(k => [k, DEFAULTS[k]]))); notify("CleanTube filters reset."); renderClearnTubeFilters(); };
  $("#fullControl").onchange = e => { void applyFull(e.target.checked); };
  $("#enableAll").onclick = () => { void applyFull(true); };
  $("#disableAll").onclick = () => { void applyFull(false); };
  const saveLocal = async () => { settings = await saveSettings(collect()); notify("ClearnTube Filters UL saved."); };
  $("#ctSave").onclick = saveLocal; $("#ctSave2").onclick = saveLocal;
  $("#ctStrict").onchange = e => { settings.strictCountry = e.target.checked; };
  $("#ctTheme").onchange = e => { settings.theme = e.target.value; };
  $("#ctDensity").onchange = e => { settings.compactMode = e.target.value === "compact"; };
}


function renderPrivacy() {
  $("#content").innerHTML = `<div class="grid"><div class="card form"><h3>Channel rules</h3><div class="field"><label>Channel whitelist</label><textarea id="whiteChannels">${esc((settings.whitelistChannels || []).join("\n"))}</textarea></div><div class="field"><label>Channel blocklist</label><textarea id="blackChannels">${esc((settings.blacklistChannels || []).join("\n"))}</textarea></div><div class="field"><label>Channel ID blocklist</label><textarea id="blackChannelIds">${esc((settings.blacklistChannelIds || []).join("\n"))}</textarea></div></div>
  <div class="card form"><h3>Video & text rules</h3><div class="field"><label>Video ID blocklist</label><textarea id="blackVideoIds">${esc((settings.blacklistVideoIds || []).join("\n"))}</textarea></div><div class="field"><label>Keyword whitelist</label><textarea id="white">${esc((settings.whitelist || []).join("\n"))}</textarea></div><div class="field"><label>Keyword blocklist</label><textarea id="black">${esc((settings.blacklist || []).join("\n"))}</textarea></div></div>
  <div class="card form"><h3>Regex rules</h3><div class="field"><label>Block regex /pattern/flags — one per line</label><textarea id="regex">${esc((settings.regexBlockRules || []).join("\n"))}</textarea></div><p class="muted">Inspired by rule-based blockers: plain lines are case-insensitive keywords; slash-delimited rules are regular expressions.</p><div class="actions"><button class="btn" id="exportRules">Export Rules</button><button class="btn" id="importRules">Import Rules</button><input id="ruleFile" type="file" accept="application/json,.json" hidden></div></div></div>`;
  $("#exportRules").onclick = () => { downloadJson(`youtube-rules-${stamp()}.json`, {exportType:"youtube-rules",version:"2.0.0", exportedAt:new Date().toISOString(), whitelist:settings.whitelist||[], blacklist:settings.blacklist||[], whitelistChannels:settings.whitelistChannels||[], blacklistChannels:settings.blacklistChannels||[], blacklistChannelIds:settings.blacklistChannelIds||[], blacklistVideoIds:settings.blacklistVideoIds||[], regexBlockRules:settings.regexBlockRules||[]}); notify("Rules exported."); };
  $("#importRules").onclick = () => $("#ruleFile").click();
  $("#ruleFile").onchange = async e => { try { const f=e.target.files?.[0]; if(!f)return; const d=JSON.parse(await f.text()); settings=await saveSettings({whitelist:d.whitelist||[],blacklist:d.blacklist||[],whitelistChannels:d.whitelistChannels||[],blacklistChannels:d.blacklistChannels||[],blacklistChannelIds:d.blacklistChannelIds||[],blacklistVideoIds:d.blacklistVideoIds||[],regexBlockRules:d.regexBlockRules||[]}); notify("Rules imported."); render(); } catch(err){notify(`Import failed: ${err.message}`,"error");} };
}

async function renderLanguage() {
  await loadDatabase();
  $("#content").innerHTML = `<div class="card form target-language-card"><div class="section-heading"><div><h3>Target country & language</h3></div><button class="btn danger-btn" id="resetTargetLanguage">Reset Target</button></div><div class="row"><div class="field"><label>Search country (${countryData.countries.length})</label><input id="countrySearch" placeholder="Search name, ISO-2 or ISO-3…"></div><div class="field"><label>Search language (${languageData.languages.length})</label><input id="languageSearch" placeholder="Search all languages A–Z…"></div></div><div class="row"><div class="field"><label>Target country</label><select id="country" size="10">${countryOptions()}</select></div><div class="field"><label>Target language</label><select id="lang" size="10">${languageOptions()}</select><div id="countryLanguageSuggestion" class="muted" style="margin-top:8px"></div></div></div><div class="row"><div class="field"><label>Geographic mode</label><select id="geoMode"><option value="strict">Strict</option><option value="balanced">Balanced</option><option value="priority">Priority</option><option value="whitelist">Whitelist</option></select></div><div class="field"><label>Unknown location</label><select id="unknownPolicy"><option value="keep">Keep visible</option><option value="hide">Hide</option></select></div></div><div class="card" style="margin-top:14px"><h3>Target Feed quick setup</h3><label class="check"><input id="languageTargetEnabled" type="checkbox" ${settings.targetFeedEnabled ? "checked" : ""}> Enable Target Feed for this country + language</label><p class="muted">For the full Target Feed Engine, use the dedicated Target Feed tab. Strict mode hides content that cannot be classified as your selected target.</p></div><p class="muted">The extension uses visible country/city/region signals plus language signals. It cannot access YouTube's private recommendation API.</p></div>`;
  $("#geoMode").value=settings.geoMode||"balanced"; $("#unknownPolicy").value=settings.unknownPolicy||"keep";
  $("#countrySearch").oninput=e=>$("#country").innerHTML=countryOptions(e.target.value); 
  $("#languageSearch").oninput=e=>$("#lang").innerHTML=languageOptions(e.target.value);
  const applyCountryLanguageSuggestion = () => {
    const code = $("#country")?.value;
    const suggestions = suggestedLanguagesForCountry(code);
    const box = $("#countryLanguageSuggestion");
    if (!box) return;
    if (!suggestions.length) { box.textContent = "No automatic language mapping is configured for this country. You can choose any language manually."; return; }
    const previousAuto = settings.targetLanguageAutoSuggested;
    const current = String(settings.targetLanguage || "").toLowerCase();
    const codes = suggestions.map(languageCodeForRecord);
    if (!settings.targetLanguageManual || current === String(previousAuto || "").toLowerCase()) {
      const first = languageCodeForRecord(suggestions[0]);
      settings.targetLanguage = first;
      settings.targetLanguageAutoSuggested = first;
      $("#lang").value = first;
    }
    box.innerHTML = `Suggested language for <strong>${esc($("#country")?.selectedOptions?.[0]?.textContent || code)}</strong>: <strong>${esc(suggestions[0].name)}</strong>${suggestions.length > 1 ? ` · alternatives: ${suggestions.slice(1,4).map(x=>esc(x.name)).join(", ")}` : ""}. You can override this manually.`;
  };
  $("#country").onchange = applyCountryLanguageSuggestion;
  $("#lang").onchange = () => { settings.targetLanguageManual = true; settings.targetLanguageAutoSuggested = null; };
  applyCountryLanguageSuggestion();
  $("#resetTargetLanguage").onclick = async () => {
    settings = await saveSettings({country: DEFAULTS.country, targetLanguage: DEFAULTS.targetLanguage, language: DEFAULTS.language, geoMode: DEFAULTS.geoMode, unknownPolicy: DEFAULTS.unknownPolicy, targetFeedEnabled: false, targetLanguageManual:false, targetLanguageAutoSuggested:null});
    notify("Target Country & Language reset.");
    renderLanguage();
  };
}

function renderTargetFeed() {
  const enabled = settings.targetFeedEnabled === true;
  const mode = settings.targetFeedMode || "strict";
  const unknown = settings.targetUnknownPolicy || "hide";
  const requireLanguage = settings.targetRequireLanguage !== false;
  const applyProfile = settings.applyYouTubeProfile !== false;
  const autoApply = settings.autoApplyTargetProfile !== false;
  $("#content").innerHTML = `<div class="grid">
    <div class="card form"><h3>🎯 Target Feed Engine</h3>
      <label class="check"><input id="targetEnabled" type="checkbox" ${enabled ? "checked" : ""}> Enable Target Feed Mode</label>
      <div class="field"><label>Feed mode</label><select id="targetMode"><option value="strict">Strict — only target content</option><option value="balanced">Balanced — target content first, uncertain content allowed</option><option value="priority">Priority — target signals preferred</option></select></div>
      <label class="check"><input id="targetRequireLanguage" type="checkbox" ${requireLanguage ? "checked" : ""}> Require target language signal with country signal</label>
      <div class="field"><label>Unknown / unclassified content</label><select id="targetUnknown"><option value="hide">Hide — recommended for strict mode</option><option value="keep">Keep visible</option></select></div>
    </div>
    <div class="card form"><h3>🌍 YouTube profile preferences</h3>
      <label class="check"><input id="applyProfile" type="checkbox" ${applyProfile ? "checked" : ""}> Set YouTube Location to selected country</label>
      <label class="check"><input id="autoApplyProfile" type="checkbox" ${autoApply ? "checked" : ""}> Automatically apply profile when YouTube starts</label>
      <p class="muted">This changes YouTube's web preference cookie (Location and interface language). It does not change your Google Account's permanent country or your IP address.</p>
      <div class="actions"><button class="btn" id="applyTarget">Apply Target Profile Now</button><button class="btn" id="openHome">Open / Reload YouTube</button></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3>How Strict Target Feed works</h3><p>Charlie MJ combines YouTube's supported Location preference with local country, region, city, channel, title and language signals. In Strict mode, cards that cannot be classified as target content are hidden. Charlie MJ does not access YouTube's private recommendation algorithm.</p><div class="code">Selected country → YouTube Location\nSelected language → YouTube interface preference + language signals\n↓\nTarget Feed scoring\n↓\nTarget content: SHOW\nNon-target / unknown: HIDE in Strict mode</div></div>`;
  $("#targetMode").value = mode; $("#targetUnknown").value = unknown;
  $("#applyTarget").onclick = async () => { settings = await saveSettings({ targetFeedEnabled: $("#targetEnabled").checked, targetFeedMode: $("#targetMode").value, targetUnknownPolicy: $("#targetUnknown").value, targetRequireLanguage: $("#targetRequireLanguage").checked, applyYouTubeProfile: $("#applyProfile").checked, autoApplyTargetProfile: $("#autoApplyProfile").checked }); const r = await chrome.runtime.sendMessage({ type:"APPLY_YOUTUBE_PROFILE", reload:true }); notify(r?.ok ? "Target Feed profile applied. YouTube will reload if needed." : `Profile failed: ${r?.error || "Unknown error"}`, r?.ok ? "success" : "error"); };
  $("#openHome").onclick = () => chrome.tabs.create({url:"https://www.youtube.com/"});
}

function isYouTubeUrl(url) {
  return /^https:\/\/(?:www\.)?youtube\.com\//i.test(String(url || ""));
}

function renderToolbar() {
  const s = settings;
  $("#content").innerHTML = `<div class="grid">
    <div class="card form"><h3>🧭 Floating toolbar</h3>
      <label class="check"><input id="tbEnabled" type="checkbox" ${s.toolbarEnabled !== false ? "checked" : ""}> Enable Charlie MJ floating toolbar</label>
      <label class="check"><input id="tbYoutubeOnly" type="checkbox" ${s.toolbarShowOnYouTubeOnly !== false ? "checked" : ""}> Show on YouTube pages only</label>
      <label class="check"><input id="tbAuto" type="checkbox" ${s.toolbarAutoHide !== false ? "checked" : ""}> Auto-hide toolbar until the mouse comes near it</label>
      <div class="field"><label>Mouse reveal distance (px)</label><input id="tbReveal" type="number" min="20" max="400" value="${Number(s.toolbarRevealDistance || 120)}"></div>
    </div>
    <div class="card form"><h3>📍 Default position</h3>
      <div class="field"><label>Position</label><select id="tbPosition"><option value="bottom-center">Bottom center — above Windows taskbar</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option><option value="top-center">Top center</option><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="custom">Custom — use drag position</option></select></div>
      <div class="row"><div class="field"><label>Custom X</label><input id="tbX" type="number" value="${s.toolbarCustomX ?? ""}"></div><div class="field"><label>Custom Y</label><input id="tbY" type="number" value="${s.toolbarCustomY ?? ""}"></div></div>
      <div class="field"><label>Scale</label><input id="tbScale" type="number" min="0.75" max="1.5" step="0.05" value="${Number(s.toolbarScale || 1)}"></div>
    </div>
  </div>
  <div class="card" style="margin-top:14px"><h3>Toolbar controls</h3><p>Users can drag the <strong>CMJ</strong> handle anywhere on YouTube. The default position is bottom-center, just above the Windows taskbar area. When Auto-hide is enabled, a small edge handle remains and the toolbar reappears when the mouse approaches its current position.</p><div class="actions"><button class="btn" id="tbReset">Reset to bottom-center</button><button class="btn" id="tbPreview">Preview on current YouTube tab</button></div></div>`;
  $("#tbPosition").value = s.toolbarPosition || "bottom-center";
  $("#tbReset").onclick = async () => { settings = await saveSettings({toolbarPosition:"bottom-center", toolbarCustomX:null, toolbarCustomY:null}); notify("Toolbar position reset to bottom-center."); };
  $("#tbPreview").onclick = async () => { const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); if(tab?.id && isYouTubeUrl(tab.url)) { try { await chrome.tabs.reload(tab.id); notify("YouTube reloaded with the toolbar settings."); } catch(e){ notify(e.message,"error"); } } else notify("Open YouTube first.","warn"); };
}

function renderTools() {
  $("#content").innerHTML = `<div class="grid"><div class="card"><h3>Scan active page</h3><p>Re-scan visible cards after settings change.</p><button class="btn" id="scan">Scan YouTube</button></div><div class="card"><h3>Shorts quick control</h3><p>Toggle Shorts immediately.</p><button class="btn" id="shorts">${settings.hideShorts?"Disable":"Enable"} Shorts</button></div><div class="card"><h3>Open YouTube</h3><p>Apply changes on a live YouTube page.</p><button class="btn" id="openyt">Open YouTube</button></div></div>`;
  $("#scan").onclick=()=>sendToYouTube({type:"SCAN_YOUTUBE"}).then(r=>r.ok&&notify("YouTube scan completed."));
  $("#shorts").onclick=async()=>{settings=await saveSettings({hideShorts:!settings.hideShorts});notify(`Shorts ${settings.hideShorts?"enabled":"disabled"}.`);await sendToYouTube({type:"SCAN_YOUTUBE"});render();};
  $("#openyt").onclick=()=>chrome.tabs.create({url:"https://www.youtube.com/"});
}

async function renderFetch() {
  $("#content").innerHTML=`<div class="card"><h3>Visible video fetch</h3><p class="muted">Only reads DOM data already visible on the active YouTube page.</p><div class="actions"><button class="btn" id="fetchVideos">Fetch videos</button><button class="btn" id="copyFetch">Copy JSON</button></div><pre id="fetchResult" class="code">No data fetched.</pre></div>`;
  let last={videos:[]}; $("#fetchVideos").onclick=async()=>{last=await sendToYouTube({type:"GET_VIDEOS"});$("#fetchResult").textContent=JSON.stringify(last,null,2);}; $("#copyFetch").onclick=async()=>{await navigator.clipboard.writeText(JSON.stringify(last,null,2));notify("JSON copied.");};
}

function renderSuggestions() { $("#content").innerHTML=`<div class="card form"><h3>Local suggestion engine</h3><label class="check"><input id="score" type="checkbox" ${settings.enableSuggestionScoring?"checked":""}> Enable local scoring</label><div class="field"><label>Preferred topics — one per line</label><textarea id="topics">${esc((settings.preferredTopics||[]).join("\n"))}</textarea></div><button class="btn" id="rank">Score active-page videos</button><pre id="ranked" class="code">Not scored yet.</pre></div>`; $("#rank").onclick=async()=>{const r=await sendToYouTube({type:"GET_VIDEOS"});const topics=(settings.preferredTopics||[]).map(x=>x.toLowerCase());const ranked=(r.videos||[]).map(v=>({...v,score:topics.reduce((n,t)=>n+(v.title||"").toLowerCase().includes(t)?2:0,0)})).sort((a,b)=>b.score-a.score);$("#ranked").textContent=JSON.stringify(ranked,null,2);}; }

function renderAlgorithm() { $("#content").innerHTML=`<div class="card"><h3>Algorithm Insights</h3><div class="code">Charlie MJ does not access YouTube's private recommendation algorithm.

The local intelligence engine combines language, country, topic, profession, channel, library, title and distraction signals. Relevance and distraction are separate scores.</div></div><div class="card" style="margin-top:14px"><h3>🧠 Intelligence Debugger</h3><p class="muted">Select a visible YouTube video to inspect its local decision.</p><div class="actions"><button class="btn" id="debugVideos">Fetch visible videos</button><select id="debugSelect"><option value="">Select a video…</option></select><button class="btn" id="debugWhy">Explain decision</button></div><pre id="debugResult" class="code">No video selected.</pre></div>`;let videos=[];$('#debugVideos').onclick=async()=>{const r=await sendToYouTube({type:'GET_VIDEOS'});videos=r.videos||[];$('#debugSelect').innerHTML=videos.map((v,i)=>`<option value="${i}">${esc(v.title||v.videoId||'Video')}</option>`).join('')||'<option>No videos</option>';};$('#debugWhy').onclick=()=>{const v=videos[Number($('#debugSelect').value)];$('#debugResult').textContent=v?JSON.stringify(v,null,2):'Select a video first.'}; }

function renderSync(){
 const g=settings.github||{}; let localFiles=[]; let compareReport=null;
 $('#content').innerHTML=`<div class="grid"><div class="card form"><h3>GitHub Repository</h3><div class="row"><div class="field"><label>Owner</label><input id="owner" value="${esc(g.owner||'awsrmmustansarjavaid')}"></div><div class="field"><label>Repository</label><input id="repo" value="${esc(g.repo||'charlie-mj-youtube')}"></div></div><div class="row"><div class="field"><label>Branch</label><input id="branch" value="${esc(g.branch||'main')}"></div><div class="field"><label>Scope</label><input id="path" value="${esc(g.path||'database/')}"></div></div><button class="btn" id="saveGithub">Save Repository</button></div><div class="card form"><h3>Local Workspace</h3><input id="localDir" type="file" webkitdirectory directory multiple><p id="dirInfo" class="muted">No local directory selected.</p></div><div class="card form"><h3>Library Duplicate Protection</h3><label class="check"><input id="preventLibraryDuplicates" type="checkbox" ${settings.preventLibraryDuplicates!==false?'checked':''}> Prevent duplicate YouTube channels, playlists and videos</label><p class="muted">When enabled, saving an already-saved YouTube item is rejected with a bottom-right notification instead of creating another copy.</p></div></div><div class="card form" style="margin-top:14px"><h3>Sync Operations</h3><div class="field"><label>Scope</label><select id="syncScope"><option value="database">Entire Database</option><option value="tech">Tech</option><option value="language-profiles">Language Profiles</option><option value="youtube-library">YouTube Library</option><option value="filters">Filters</option><option value="countries">Countries</option></select></div><div class="actions"><button class="btn" id="pull">Pull from GitHub</button><button class="btn" id="compare">Compare</button><button class="btn" id="prepare">Prepare for GitHub — Download Whole Database</button><button class="btn" id="downloadDiff" disabled>Download Local-New / Modified Files</button><button class="btn" id="exportSync">Export</button><button class="btn" id="refreshSync">Refresh</button></div><pre id="syncResult" class="code">Ready.</pre></div><div class="card" style="margin-top:14px"><h3>Detailed Comparison</h3><div id="compareTable" class="code">Run Compare to generate a file-level report.</div></div>`;
 $('#localDir').onchange=e=>{localFiles=[...e.target.files];$('#dirInfo').textContent=`${localFiles.length} files selected.`};
 $('#saveGithub').onclick=async()=>{settings=await saveSettings({github:{owner:$('#owner').value.trim(),repo:$('#repo').value.trim(),branch:$('#branch').value.trim()||'main',path:$('#path').value.trim()||'database/'}});notify('GitHub repository settings saved.');};
 const remoteTree=async()=>{const x=settings.github||{};const r=await chrome.runtime.sendMessage({type:"GITHUB_TREE",owner:x.owner,repo:x.repo,branch:x.branch||"main"});if(!r?.ok)throw new Error(r?.error||"Could not fetch GitHub repository tree.");return Array.isArray(r.tree)?r.tree:[]};
 $('#pull').onclick=async()=>{try{const tree=await remoteTree();const scope=$('#syncScope').value;const files=tree.filter(x=>x.type==='blob'&& (scope==='database'||x.path.startsWith(`database/${scope}/`)));$('#syncResult').textContent=`GitHub pull index completed.\n${files.length} remote files in scope.\n\n${files.slice(0,200).map(x=>x.path).join('\n')}`;notify('GitHub pull index completed.');}catch(e){notify(e.message,'error')}};
 $('#compare').onclick=async()=>{try{if(!localFiles.length)throw new Error('Select a local repository/database directory first.');const tree=await remoteTree();const scope=$('#syncScope').value;const remoteFiles=tree.filter(x=>x.type==='blob'&&(scope==='database'||x.path.startsWith(`database/${scope}/`)));const lm=new Map(localFiles.map(f=>{let p=f.webkitRelativePath||f.name;p=p.startsWith('database/')?p:p.replace(/^[^/]+\//,'');return [p,f]}));const rm=new Map(remoteFiles.map(f=>[f.path,f]));const paths=[...new Set([...lm.keys(),...rm.keys()])].filter(p=>p.startsWith('database/')).sort();let same=0,localOnly=0,remoteOnly=0,modified=0;const rows=[];const localNew=[];for(const path of paths){const l=lm.get(path),r=rm.get(path);let state='IDENTICAL';if(l&&!r){state='LOCAL ONLY';localOnly++;localNew.push(l)}else if(!l&&r){state='GITHUB ONLY';remoteOnly++}else if(l&&r&&Number(l.size)!==Number(r.size)){state='MODIFIED';modified++;localNew.push(l)}else same++;rows.push(`${state.padEnd(12)} ${path}${l&&r?` local=${l.size}B remote=${r.size}B`:''}`)}compareReport={localNew};$('#downloadDiff').disabled=!localNew.length;$('#compareTable').textContent=`Database Comparison\n\nFiles checked: ${paths.length}\nIdentical: ${same}\nLocal only / new: ${localOnly}\nGitHub only: ${remoteOnly}\nModified: ${modified}\n\n${rows.join('\n')}`;$('#syncResult').textContent=localNew.length?'Differences found. The local-new/modified download button is active.':'No local-new or modified files found.';notify('GitHub/local comparison completed.');}catch(e){notify(e.message,'error')}};
 async function zipFiles(files){const parts=[];let offset=0;const enc=new TextEncoder();const crcTable=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();const crc32=b=>{let c=0xffffffff;for(const v of b)c=crcTable[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0};const u16=(a,n)=>a.push(n&255,(n>>>8)&255);const u32=(a,n)=>a.push(n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255);for(const f of files){const data=new Uint8Array(await f.arrayBuffer());const raw=f.__cmjPath||f.webkitRelativePath||f.name;const path=raw.startsWith('database/')?raw:raw.replace(/^[^/]+\//,'');const name=enc.encode(path);const local=[];u32(local,0x04034b50);u16(local,20);u16(local,0);u16(local,0);u16(local,0);u16(local,0);u32(local,crc32(data));u32(local,data.length);u32(local,data.length);u16(local,name.length);u16(local,0);const localBytes=new Uint8Array([...local,...name,...data]);parts.push({name,data,local:localBytes,offset});offset+=localBytes.length}const central=[];let csize=0;for(const x of parts){const a=[];u32(a,0x02014b50);u16(a,20);u16(a,20);u16(a,0);u16(a,0);u16(a,0);u16(a,0);u32(a,crc32(x.data));u32(a,x.data.length);u32(a,x.data.length);u16(a,x.name.length);u16(a,0);u16(a,0);u16(a,0);u16(a,0);u32(a,0);u32(a,x.offset);const b=new Uint8Array([...a,...x.name]);central.push(b);csize+=b.length}const end=[];u32(end,0x06054b50);u16(end,0);u16(end,0);u16(end,parts.length);u16(end,parts.length);u32(end,csize);u32(end,offset);u16(end,0);return new Blob([...parts.map(x=>x.local),...central,new Uint8Array(end)],{type:'application/zip'})}
 $('#prepare').onclick=async()=>{try{const index=await loadJson('database/file-index.json');const paths=Array.isArray(index.files)?index.files:[];if(!paths.length)throw new Error('Database file index is empty.');const files=[];for(const path of paths){let response;try{response=await fetch(chrome.runtime.getURL(path),{cache:'no-store'});}catch(fetchError){throw new Error(`Failed to fetch packaged file: ${path}. ${fetchError.message}`)}if(!response.ok)throw new Error(`Could not package ${path} (HTTP ${response.status})`);const blob=await response.blob();const f=new File([blob],path,{type:path.endsWith('.json')?'application/json':'application/octet-stream'});Object.defineProperty(f,'__cmjPath',{value:path});files.push(f)}const blob=await zipFiles(files);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`charlie-mj-youtube-database-v2.0.0-${stamp()}.zip`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);notify(`Prepared ${files.length} packaged files for GitHub.`);}catch(e){notify(`Prepare for GitHub failed: ${e.message}`,'error')}};
 $('#downloadDiff').onclick=async()=>{try{if(!compareReport?.localNew?.length)throw new Error('No local-new or modified files were found.');const blob=await zipFiles(compareReport.localNew);const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`charlie-mj-youtube-github-local-new-modified-v2.0.0-${stamp()}.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);notify('Local-new and modified files downloaded.');}catch(e){notify(e.message,'error')}};
 $('#exportSync').onclick=async()=>downloadJson(`charlie-mj-youtube-sync-export-${stamp()}.json`,{exportType:'charlie-mj-sync',version:'2.0.0',settings:await chrome.storage.local.get(null),exportedAt:new Date().toISOString(),source:'Charlie MJ YouTube'}); $('#refreshSync').onclick=()=>renderSync();
}
async function renderPerformance(){const stats=await getStats();const {lastYouTubeScan={},performanceMetrics={}}=await chrome.storage.local.get(['lastYouTubeScan','performanceMetrics']);const p=settings;$('#content').innerHTML=`<div class="grid"><div class="card form"><div class="section-heading"><h3>Master performance</h3><button class="btn danger-btn" id="resetPerformance">Reset</button></div><label class="check"><input id="perfEnabled" type="checkbox" ${p.extensionEnabled!==false?'checked':''}> Keep extension engine enabled</label><div class="field"><label>Performance mode</label><select id="perfMode"><option value="light">Lightweight</option><option value="balanced">Balanced</option><option value="maximum">Maximum filtering</option></select></div><div class="field"><label>Observer debounce (ms)</label><input id="perfDebounce" type="number" min="20" max="1000" value="${Number(p.observerDebounceMs||80)}"></div><div class="field"><label>Maximum cards per scan</label><input id="perfCards" type="number" min="25" max="500" value="${Number(p.maxCardsPerScan||150)}"></div><div class="field"><label>Statistics retention (days)</label><input id="perfRetention" type="number" min="7" max="3650" value="${Number(p.statsRetentionDays||90)}"></div><label class="check"><input id="perfDiag" type="checkbox" ${p.diagnosticsEnabled!==false?'checked':''}> Diagnostics</label><label class="check"><input id="perfDebug" type="checkbox" ${p.debugLogging?'checked':''}> Debug logging</label><button class="btn" id="perfSave">Save Performance Settings</button></div><div class="card"><h3>Runtime metrics</h3><p>Scanned: <strong>${stats.videosScanned||0}</strong></p><p>Hidden: <strong>${stats.videosHidden||0}</strong></p><p>Deprioritized: <strong>${stats.videosDeprioritized||0}</strong></p><p>Syncs: <strong>${stats.syncs||0}</strong></p><p>Screen time: <strong>${((stats.screenTimeSeconds||0)/3600).toFixed(2)}h</strong></p></div><div class="card"><h3>Last scan</h3><pre class="code">${esc(JSON.stringify(lastYouTubeScan,null,2))}</pre></div><div class="card"><h3>Measured metrics</h3><pre class="code">${esc(JSON.stringify(performanceMetrics,null,2))}</pre></div></div>`;$('#perfMode').value=p.performanceMode||'balanced';$('#perfSave').onclick=async()=>{settings=await saveSettings({extensionEnabled:$('#perfEnabled').checked,performanceMode:$('#perfMode').value,observerDebounceMs:Math.max(20,Math.min(1000,Number($('#perfDebounce').value)||80)),maxCardsPerScan:Math.max(25,Math.min(500,Number($('#perfCards').value)||150)),statsRetentionDays:Math.max(7,Math.min(3650,Number($('#perfRetention').value)||90)),diagnosticsEnabled:$('#perfDiag').checked,debugLogging:$('#perfDebug').checked});notify('Performance settings saved.');};$('#resetPerformance').onclick=async()=>{settings=await saveSettings({extensionEnabled:DEFAULTS.extensionEnabled,performanceMode:DEFAULTS.performanceMode,observerDebounceMs:DEFAULTS.observerDebounceMs,maxCardsPerScan:DEFAULTS.maxCardsPerScan,statsRetentionDays:DEFAULTS.statsRetentionDays,diagnosticsEnabled:DEFAULTS.diagnosticsEnabled,debugLogging:DEFAULTS.debugLogging});notify('Performance settings reset.');renderPerformance();};}
function renderAds() {
  return chrome.storage.local.get("adStats").then(({ adStats = {} }) => {
    const enabled = settings.adBlockEnabled !== false;
    const mode = settings.adBlockMode || "balanced";
    $("#content").innerHTML = `<div class="grid">
      <div class="card form"><h3>Master ad protection</h3>
        <label class="check"><input id="adEnabled" type="checkbox" ${enabled ? "checked" : ""}> Enable YouTube ad protection</label>
        <div class="field"><label>Protection mode</label><select id="adMode">
          <option value="basic">Basic — cosmetic cleanup</option>
          <option value="balanced">Balanced — network + cleanup + skip assist</option>
          <option value="aggressive">Aggressive — maximum local skip/fast-forward assist</option>
        </select></div>
        <p class="muted">YouTube changes its ad delivery frequently. Charlie MJ combines Chrome network rules with page-level detection; no method can guarantee permanent coverage.</p>
      </div>
      <div class="card form"><h3>Protection layers</h3>
        <label class="check"><input id="adNetwork" type="checkbox" ${settings.adBlockNetwork !== false ? "checked" : ""}> Network ad/tracker request blocking</label>
        <label class="check"><input id="adVideo" type="checkbox" ${settings.adBlockVideo !== false ? "checked" : ""}> Video-ad detection</label>
        <label class="check"><input id="adCosmetic" type="checkbox" ${settings.adBlockCosmetic !== false ? "checked" : ""}> Hide ad slots, banners and overlays</label>
        <label class="check"><input id="adSkip" type="checkbox" ${settings.adBlockSkip !== false ? "checked" : ""}> Automatically click Skip Ad / fast-forward detected ads</label>
      </div>
    </div>
    <div class="grid" style="margin-top:14px">
      <div class="card"><h3>Local ad statistics</h3><div class="metric">${Number(adStats.skipped || 0) + Number(adStats.hidden || 0)}</div><span class="muted">Detected, skipped or hidden events</span></div>
      <div class="card"><h3>Video ads skipped</h3><div class="metric">${Number(adStats.skipped || 0)}</div><span class="muted">Best-effort player actions</span></div>
      <div class="card"><h3>Ad UI hidden</h3><div class="metric">${Number(adStats.hidden || 0)}</div><span class="muted">Cosmetic ad elements</span></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>Test protection</h3><p class="muted">Open or reload YouTube after changing network protection. Page-level controls can be tested without leaving this settings page.</p><div class="actions"><button class="btn" id="scanAds">Scan active YouTube page for ads</button><button class="btn" id="allowAds">Temporarily allow ads</button><button class="btn" id="enableAds">Enable ad protection</button></div></div>`;
    $("#adMode").value = mode;
    $("#scanAds").onclick = async () => { const r = await sendToYouTube({ type: "SCAN_ADS" }); notify(r?.ok ? "Ad protection scan completed." : `Ad scan failed: ${r?.error || "Unknown error"}`, r?.ok ? "success" : "error"); };
    $("#allowAds").onclick = async () => { settings = await saveSettings({ adBlockEnabled: false }); notify("YouTube ad protection disabled.", "warn"); render(); };
    $("#enableAds").onclick = async () => { settings = await saveSettings({ adBlockEnabled: true }); notify("YouTube ad protection enabled."); render(); };
  });
}

function renderBlockTube() {
  const s=settings;
  document.querySelector("#content").innerHTML=`<div class="grid">
    <div class="card form"><h3>Filtering syntax</h3>
      <div class="field"><label>Match mode</label><select id="btMatch"><option value="partial">Partial text</option><option value="whole-word">Whole word</option><option value="exact">Exact</option></select></div>
      <label class="check"><input id="btCase" type="checkbox" ${s.filterCaseSensitive?"checked":""}> Case-sensitive matching</label>
      <p class="muted">One rule per line. Plain text is a keyword; <code>/pattern/flags</code> is regular expression syntax. The global <code>g</code> flag is ignored for deterministic matching.</p>
    </div>
    <div class="card form"><h3>Block targets</h3>
      <label class="check"><input id="btContext" type="checkbox" ${s.contextBlockEnabled!==false?"checked":""}> Enable context-menu blocking</label>
      <label class="check"><input id="btQuick" type="checkbox" ${s.quickBlockEnabled!==false?"checked":""}> Show quick block button on video cards</label>
      <label class="check"><input id="btMenu" type="checkbox" ${s.quickBlockMenuEnabled!==false?"checked":""}> Add Charlie MJ action to YouTube 3-dot menus</label>
      <div class="field"><label>Blocked video behavior</label><select id="btVideoAction"><option value="hide">Hide the video</option><option value="message">Show a blocked message</option><option value="redirect">Redirect to Home</option></select></div>
    </div>
  </div>
  <div class="card form" style="margin-top:14px"><h3>Rule lists</h3><div class="row"><div class="field"><label>Video titles / keywords</label><textarea id="btKeywords">${esc((s.blacklist||[]).join("\n"))}</textarea></div><div class="field"><label>Channels / @handles / custom URLs</label><textarea id="btChannels">${esc((s.blacklistChannels||[]).join("\n"))}</textarea></div></div><div class="row"><div class="field"><label>Channel IDs</label><textarea id="btChannelIds">${esc((s.blacklistChannelIds||[]).join("\n"))}</textarea></div><div class="field"><label>Video IDs</label><textarea id="btVideoIds">${esc((s.blacklistVideoIds||[]).join("\n"))}</textarea></div></div><div class="field"><label>Raw regex rules</label><textarea id="btRegex">${esc((s.regexBlockRules||[]).join("\n"))}</textarea></div></div>`;
  $("#btMatch").value=s.filterMatchMode||"whole-word"; $("#btVideoAction").value=s.blockedVideoAction||"hide";
}

function renderFilterTube() {
  const s=settings;
  $("#content").innerHTML=`<div class="grid"><div class="card form"><h3>Smart filtering</h3>
    <div class="field"><label>Text matching</label><select id="ftMatch"><option value="partial">Partial</option><option value="whole-word">Whole word</option><option value="exact">Exact</option></select></div>
    <label class="check"><input id="ftShelves" type="checkbox" ${s.filterShelves!==false?"checked":""}> Refilter shelves continuously</label>
    <label class="check"><input id="ftPlaylists" type="checkbox" ${s.filterPlaylists!==false?"checked":""}> Filter playlists and playlist shelves</label>
    <label class="check"><input id="ftWatched" type="checkbox" ${s.hideWatched?"checked":""}> Hide watched videos when YouTube marks them as watched</label>
  </div><div class="card form"><h3>Quick actions</h3>
    <label class="check"><input id="ftQuick" type="checkbox" ${s.quickBlockEnabled!==false?"checked":""}> Hover quick-block cross</label>
    <label class="check"><input id="ftMenu" type="checkbox" ${s.quickBlockMenuEnabled!==false?"checked":""}> Charlie MJ item in YouTube's 3-dot menu</label>
    <label class="check"><input id="ftHistory" type="checkbox" ${s.watchHistoryFiltering?"checked":""}> Track locally blocked/watched IDs for deterministic filtering</label>
  </div></div><div class="card form" style="margin-top:14px"><h3>Content filters</h3><div class="row"><div class="field"><label>Minimum duration (seconds)</label><input id="ftMinDuration" type="number" min="0" value="${Number(s.minDurationSeconds||0)}"></div><div class="field"><label>Maximum duration (seconds)</label><input id="ftMaxDuration" type="number" min="0" value="${Number(s.maxDurationSeconds||0)}"></div></div><label class="check"><input id="ftCaps" type="checkbox" ${s.filterAllCaps?"checked":""}> Filter clickbait ALL-CAPS titles</label></div>`;
  $("#ftMatch").value=s.filterMatchMode||"whole-word";
}

function renderPlayback() {
  const s=settings;
  $("#content").innerHTML=`<div class="grid"><div class="card form"><h3>Playback</h3>
    <div class="field"><label>Default playback speed</label><select id="pbSpeed"><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="1.75">1.75×</option><option value="2">2×</option></select></div>
    <div class="field"><label>Preferred quality</label><select id="pbQuality"><option value="auto">Auto</option><option value="2160">2160p</option><option value="1440">1440p</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select></div>
    <div class="field"><label>Volume boost</label><select id="pbVolume"><option value="1">100%</option><option value="1.1">110%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></div>
  </div><div class="card form"><h3>Player behavior</h3>
    <label class="check"><input id="pbCinema" type="checkbox" ${s.cinemaMode?"checked":""}> Cinema mode</label>
    <label class="check"><input id="pbTheater" type="checkbox" ${s.forceTheaterMode?"checked":""}> Prefer theater mode</label>
    <label class="check"><input id="pbLoop" type="checkbox" ${s.loopVideo?"checked":""}> Loop videos</label>
    <label class="check"><input id="pbPause" type="checkbox" ${s.pauseWhenHidden?"checked":""}> Pause when browser tab becomes hidden</label>
    <label class="check"><input id="pbAnnotations" type="checkbox" ${s.disableAnnotations?"checked":""}> Disable legacy annotations/overlays where possible</label>
  </div></div>`;
  $("#pbSpeed").value=String(s.playbackSpeed||1); $("#pbQuality").value=s.preferredQuality||"auto"; $("#pbVolume").value=String(s.volumeBoost||1);
}

async function renderProfiles() {
  const stored=(await chrome.storage.local.get("profileStore")).profileStore || { activeId: settings.activeProfileId||"default", profiles: settings.profiles||[{id:"default",name:"Master",pin:"",settings:null}] };
  const profiles=stored.profiles||[];
  $("#content").innerHTML=`<div class="grid"><div class="card form"><h3>Profiles</h3><div class="field"><label>Profile name</label><input id="profileName" placeholder="Focused Work"></div><div class="field"><label>PIN (optional)</label><input id="profilePin" type="password" inputmode="numeric" maxlength="12"></div><div class="field"><label>Modes included in this profile</label><div class="row"><label class="check"><input class="profileMode" value="general" type="checkbox" checked> General</label><label class="check"><input class="profileMode" value="tech" type="checkbox"> Tech</label><label class="check"><input class="profileMode" value="languageLearning" type="checkbox"> Language Learning</label><label class="check"><input class="profileMode" value="niches" type="checkbox"> Niches</label><label class="check"><input class="profileMode" value="productivity" type="checkbox"> Productivity</label><label class="check"><input class="profileMode" value="custom" type="checkbox"> Custom</label></div></div><div class="actions"><button class="btn" id="addProfile">Add profile</button><button class="btn" id="saveProfile">Save current settings to active profile</button></div><div class="field"><label>Active profile</label><select id="profileSelect">${profiles.map(x=>`<option value="${esc(x.id)}" ${x.id===stored.activeId?"selected":""}>${esc(x.name)}</option>`).join("")}</select></div><button class="btn" id="switchProfile">Switch profile</button></div>
  <div class="card form"><h3>Backup</h3><label class="check"><input id="backupAuto" type="checkbox" ${settings.backupAuto?"checked":""}> Automatic local backup</label><div class="field"><label>Backup interval (hours)</label><input id="backupHours" type="number" min="1" value="${Number(settings.backupIntervalHours||24)}"></div><label class="check"><input id="backupEncrypted" type="checkbox" ${settings.backupEncrypted?"checked":""}> Prefer encrypted backup format</label><div class="actions"><button class="btn" id="exportProfile">Export active profile</button><button class="btn" id="exportAllProfiles">Export all profiles</button><button class="btn" id="importProfile">Import backup</button><input id="profileFile" type="file" accept="application/json,.json" hidden></div><p class="muted">When encrypted format is enabled, export prompts for a passphrase and uses PBKDF2-SHA256 (150,000 iterations) + AES-GCM.</p></div></div>`;
  $("#addProfile").onclick=async()=>{const name=$("#profileName").value.trim();if(!name)return notify("Enter a profile name.","warn");const id="p_"+Date.now();profiles.push({id,name,pin:$("#profilePin").value||"",modes:[...document.querySelectorAll(".profileMode:checked")].map(x=>x.value),settings:{...settings,profiles:undefined}});await chrome.storage.local.set({profileStore:{activeId:id,profiles}});settings=await saveSettings({activeProfileId:id,profiles});notify(`Profile ${name} created.`);renderProfiles();};
  $("#saveProfile").onclick=async()=>{const active=profiles.find(x=>x.id===stored.activeId);if(!active)return;active.modes=active.modes||settings.enabledModes||["general"];active.settings={...settings,enabledModes:active.modes,profiles:undefined};await chrome.storage.local.set({profileStore:{activeId:stored.activeId,profiles}});notify("Active profile updated.");};
  $("#switchProfile").onclick=async()=>{const id=$("#profileSelect").value;const target=profiles.find(x=>x.id===id);if(!target)return;const patch=target.settings?{...target.settings,activeProfileId:id,enabledModes:target.modes||target.settings.enabledModes||["general"],profiles}: {activeProfileId:id,enabledModes:target.modes||["general"],profiles};settings=await saveSettings(patch);await chrome.storage.local.set({profileStore:{activeId:id,profiles}});notify(`Switched to ${target.name}.`);render();};
  $("#exportProfile").onclick=async()=>{const payload={format:"charlie-mj-profile",version:"1.0.0",exportedAt:new Date().toISOString(),profile:profiles.find(x=>x.id===stored.activeId),settings};if(settings.backupEncrypted){const pass=prompt("Enter a passphrase for the encrypted backup:");if(!pass)return;downloadJson(`profile-${stored.activeId}-encrypted-${stamp()}.json`,await encryptBackup(payload,pass));}else downloadJson(`profile-${stored.activeId}-${stamp()}.json`,payload);};
  $("#exportAllProfiles").onclick=async()=>{const payload={format:"charlie-mj-profiles",version:"1.0.0",exportedAt:new Date().toISOString(),profiles,activeId:stored.activeId};if(settings.backupEncrypted){const pass=prompt("Enter a passphrase for the encrypted backup:");if(!pass)return;downloadJson(`profiles-all-encrypted-${stamp()}.json`,await encryptBackup(payload,pass));}else downloadJson(`profiles-all-${stamp()}.json`,payload);};
  $("#importProfile").onclick=()=>$("#profileFile").click();
  $("#profileFile").onchange=async e=>{try{const f=e.target.files?.[0];if(!f)return;let payload=JSON.parse(await f.text());if(payload.format==="charlie-mj-encrypted-backup"){const pass=prompt("Enter the backup passphrase:");if(!pass)return;payload=await decryptBackup(payload,pass);}if(payload.format!=="charlie-mj-profile"&&payload.format!=="charlie-mj-profiles")throw new Error("Unsupported backup format");if(payload.format==="charlie-mj-profile"&&payload.settings){settings=await saveSettings(payload.settings);notify("Profile backup restored.");}else if(payload.profiles){await chrome.storage.local.set({profileStore:{activeId:payload.activeId||"default",profiles:payload.profiles}});settings=await getSettings();notify("Profiles backup restored.");}render();}catch(err){notify(`Backup import failed: ${err.message}`,"error");}};
}

function renderNotifications(){const n=settings.notificationSettings||{};$('#content').innerHTML=`<div class="grid"><div class="card form"><h3>Notification master</h3><label class="check"><input id="notif" type="checkbox" ${settings.notifications?'checked':''}> Enable in-app bottom-right notifications</label><div class="field"><label>Minimum priority</label><select id="notifPriority"><option value="all">All</option><option value="important">Important only</option><option value="critical">Critical only</option></select></div><label class="check"><input id="notifQuiet" type="checkbox" ${settings.notificationQuietHours?'checked':''}> Quiet hours</label><div class="row"><div class="field"><label>Quiet start</label><input id="quietStart" type="time" value="${settings.quietStart||'22:00'}"></div><div class="field"><label>Quiet end</label><input id="quietEnd" type="time" value="${settings.quietEnd||'07:00'}"></div></div><button class="btn" id="notifSave">Save Notification Settings</button></div><div class="card form"><h3>Events</h3>${[['save','Settings saved'],['import','Imports completed'],['sync','GitHub sync/compare'],['feed','Followed-channel feed updates'],['filter','Major filtering events'],['intelligence','Intelligence decisions'],['screenTime','Screen-time reminders']].map(([k,l])=>`<label class="check"><input class="notifEvent" data-key="${k}" type="checkbox" ${n[k]?'checked':''}> ${l}</label>`).join('')}</div></div><div class="card" style="margin-top:14px"><h3>Test</h3><button class="btn" id="testNotif">Send test notification</button></div>`;$('#notifPriority').value=settings.notificationPriority||'important';$('#notifSave').onclick=async()=>{settings=await saveSettings({notifications:$('#notif').checked,notificationPriority:$('#notifPriority').value,notificationQuietHours:$('#notifQuiet').checked,quietStart:$('#quietStart').value,quietEnd:$('#quietEnd').value,notificationSettings:Object.fromEntries([...document.querySelectorAll('.notifEvent')].map(x=>[x.dataset.key,x.checked]))});notify('Notification settings saved.');};$('#testNotif').onclick=async()=>{const r=await chrome.runtime.sendMessage({type:'NOTIFY',title:'Charlie MJ YouTube',message:'Notification system is working.',priority:'important'});notify(r?.ok?'Test notification sent.':'Notification service unavailable.',r?.ok?'success':'error');};}
async function renderDatabase(){await loadDatabase();const x=await chrome.storage.local.get(['techProfiles','languageProfiles','nicheProfiles','youtubeLibrary']);const lib={channels:[],playlists:[],favorites:[],categories:[],collections:[],...(x.youtubeLibrary||{})};const tech=x.techProfiles||[];const langs=x.languageProfiles||[]; const niches=x.nicheProfiles||[];$('#content').innerHTML=`<div class="grid"><div class="card"><h3>Countries</h3><div class="metric">${countryData.countries.length}</div><select id="countryPick"><option value="">Select country…</option>${countryData.countries.map(c=>`<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`).join('')}</select><button class="btn" id="downloadCountry">Download Country JSON</button></div><div class="card"><h3>Languages</h3><div class="metric">${languageData.languages.length}</div><input id="languagePick" placeholder="Language name/code"><button class="btn" id="downloadLanguage">Download Language JSON</button></div><div class="card"><h3>Tech Profiles</h3><div class="metric">${tech.length}</div><button class="btn" id="downloadTech">Download Tech Profiles</button></div><div class="card"><h3>Language Profiles</h3><div class="metric">${langs.length}</div><button class="btn" id="downloadLangProfiles">Download Language Profiles</button></div><div class="card"><h3>Niche Profiles</h3><div class="metric">${niches.length}</div><button class="btn" id="downloadNicheProfiles">Download Niche Profiles</button></div><div class="card"><h3>YouTube Library</h3><div class="metric">${lib.channels.length+lib.playlists.length+lib.favorites.length+lib.categories.length+lib.collections.length}</div><button class="btn" id="downloadLibrary">Download Library JSON</button></div></div><div class="grid" style="margin-top:14px"><div class="card form"><h3>JSON managers</h3><div class="actions"><button class="btn" id="openTechDb">Tech Profiles</button><button class="btn" id="openLangDb">Language Profiles</button><button class="btn" id="openNicheDb">Niche Profiles</button><button class="btn" id="openLibraryDb">YouTube Library</button></div></div><div class="card form"><h3>Database settings</h3><label class="check"><input id="dbAuto" type="checkbox" ${settings.databaseManager?.autoRefresh?'checked':''}> Auto-refresh indexes</label><label class="check"><input id="dbConfirm" type="checkbox" ${settings.databaseManager?.confirmImports!==false?'checked':''}> Confirm imports</label><label class="check"><input id="dbPreserve" type="checkbox" ${settings.databaseManager?.preservePackaged!==false?'checked':''}> Preserve packaged masters</label><button class="btn" id="dbSave">Save Database Settings</button></div></div><div class="card" style="margin-top:14px"><h3>Database paths</h3><pre class="code">countries/*.json\nlanguages/languages.json\nlanguage-profiles/*.json\ntech/*.json\nyoutube-library/channels/*.json\nyoutube-library/playlists/*.json\nyoutube-library/videos/*.json\nyoutube-library/collections/*.json\nfilters/*.json</pre></div>`;$('#downloadCountry').onclick=async()=>{const c=$('#countryPick').value;if(!c)return notify('Select a country first.','warn');const r=await chrome.runtime.sendMessage({type:'READ_DATABASE',path:`database/countries/${c.toLowerCase()}.json`});if(r?.ok)downloadJson(`country-${c.toLowerCase()}-${stamp()}.json`,{exportType:'country',version:'2.0.0',exportedAt:new Date().toISOString(),source:'Charlie MJ YouTube',data:r.data})};$('#downloadLanguage').onclick=()=>{const q=$('#languagePick').value.trim().toLowerCase();const rec=languageData.languages.find(x=>`${x.name||''} ${x.alpha_2||''} ${x.alpha_3||''}`.toLowerCase().includes(q));if(!rec)return notify('Language not found.','warn');downloadJson(`language-${(rec.alpha_2||rec.alpha_3||'record')}-${stamp()}.json`,{exportType:'language-record',version:'2.0.0',exportedAt:new Date().toISOString(),source:'Charlie MJ YouTube',data:rec})};$('#downloadTech').onclick=()=>downloadJson(`tech-profiles-all-${stamp()}.json`,{exportType:'tech-profiles',version:'2.0.0',exportedAt:new Date().toISOString(),source:'Charlie MJ YouTube',items:tech});$('#downloadLangProfiles').onclick=()=>downloadJson(`language-profiles-all-${stamp()}.json`,{exportType:'language-profiles',version:'2.0.0',exportedAt:new Date().toISOString(),source:'Charlie MJ YouTube',items:langs}); $('#downloadNicheProfiles').onclick=()=>downloadJson(`niche-profiles-all-${stamp()}.json`,{exportType:'niche-profiles',version:'2.0.0',exportedAt:new Date().toISOString(),source:'Charlie MJ YouTube',items:niches});$('#downloadLibrary').onclick=()=>downloadJson(`youtube-library-all-${stamp()}.json`,{exportType:'youtube-library',version:'2.0.0',exportedAt:new Date().toISOString(),source:'Charlie MJ YouTube',data:lib});$('#openTechDb').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/tech/tech.html')});$('#openLangDb').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/language-learning/language-learning.html')}); $('#openNicheDb').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/niches/niches.html')});$('#openLibraryDb').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/library/library.html')});$('#dbSave').onclick=async()=>{settings=await saveSettings({databaseManager:{...(settings.databaseManager||{}),autoRefresh:$('#dbAuto').checked,confirmImports:$('#dbConfirm').checked,preservePackaged:$('#dbPreserve').checked}});notify('Database settings saved.');};}

// ---- Modes: single source of truth for reading the Modes form -------------
function collectModes(){
  if(!$('#techProfile')) return null; // Modes tab is not rendered
  const next=JSON.parse(JSON.stringify(settings.modeSettings||{}));
  document.querySelectorAll('.modeEnable').forEach(x=>next[x.dataset.mode]={...(next[x.dataset.mode]||{}),enabled:x.checked});
  document.querySelectorAll('.threshold').forEach(x=>next[x.dataset.mode]={...(next[x.dataset.mode]||{}),[x.dataset.key]:Number(x.value)});
  const selectedValues=id=>{const el=$(id);if(!el)return[];try{if(el.dataset.selected){const parsed=JSON.parse(el.dataset.selected);if(Array.isArray(parsed))return parsed.filter(Boolean);if(parsed!=null&&parsed!=='')return[String(parsed)];}}catch(_){}return Array.from(el.selectedOptions||[]).map(v=>v.value).filter(Boolean)};
  next.tech={...(next.tech||{}),profileId:$('#techProfile').value||'devops',targetLanguage:$('#techTargetLanguage').value||'en',contentLanguages:selectedValues('#techLangs'),country:$('#techCountry').value||'GLOBAL'};
  next.languageLearning={...(next.languageLearning||{}),learningLanguage:$('#learnLang').value,contentLanguages:selectedValues('#learnContentLangs'),country:$('#learnCountry').value||'GLOBAL',focus:Number($('#learnFocus').value||70),goals:lines('#learnGoals')};
  next.niches={...(next.niches||{}),profileId:$('#nicheProfile').value||'technology',targetLanguage:$('#nicheTargetLanguage').value||'en',contentLanguages:selectedValues('#nicheLangs'),country:$('#nicheCountry').value||'GLOBAL'};
  next.productivity={...(next.productivity||{}),focusLevel:$('#focusLevel').value};
  const active=$('#activeMode').value;
  Object.keys(next).forEach(k=>{if(next[k]) next[k]={...next[k],enabled:k===active};}); next[active]={...(next[active]||{}),enabled:true};
  return {modeSettings:next,activeMode:active,enabledModes:[active],intelligenceEnabled:true};
}
async function saveModesNow(){
  const patch=collectModes(); if(!patch) return null;
  settings=await saveSettings(patch);
  // Keep YouTube's own region/language preference in sync with the active mode.
  try{ if(settings.applyYouTubeProfile!==false) await chrome.runtime.sendMessage({type:'APPLY_YOUTUBE_PROFILE',reload:false}); }catch(_){}
  notify('Modes saved.');
  return settings;
}

async function renderModes(){
  sharedLanguageCatalog = await loadLanguageCatalog();
  const ms = settings.modeSettings || {};
  const modes = [
    ["general", "General", "Existing working engine — compatibility baseline."],
    ["tech", "Tech", "Professional technology and career learning."],
    ["languageLearning", "Language Learning", "International/human language learning."],
    ["niches", "Niches", "Interest-based niche discovery and focused content."],
    ["productivity", "Productivity", "Focus and time-management behavior."],
    ["custom", "Custom", "User-defined rules."]
  ];
  const countryOpts = countryData?.countries?.map(c => `<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`).join("") || "";
  const tech = ms.tech || {}, lang = ms.languageLearning || {};
  const techLangs = Array.isArray(tech.contentLanguages) ? tech.contentLanguages : [];
  const learnLangs = Array.isArray(lang.contentLanguages) ? lang.contentLanguages : [];
  const langOptionMarkup = (selected, query='') => { const safeSelected=Array.isArray(selected)?selected.filter(Boolean):selected==null||selected===''?[]:[String(selected)]; const selectedSet=new Set(safeSelected.map(String).map(v=>v.toLowerCase())); return optionList(sharedLanguageCatalog.languages,safeSelected,query,sharedLanguageCatalog.languages.length).map(x=>`<option value="${esc(languageKey(x))}" ${selectedSet.has(languageKey(x))?'selected':''}>${esc(x.name)}${x.alpha_2?` (${esc(x.alpha_2)})`:x.alpha_3?` (${esc(x.alpha_3)})`:''}</option>`).join(''); };
  $('#content').innerHTML = `<div class="grid mode-grid">${modes.map(([id,n,d])=>{
    const c=ms[id]||{};
    return `<div class="card form mode-card">
      <div class="section-heading"><div><h3>${n}</h3><p class="muted">${d}</p></div>${id==='tech'?'<button class="btn danger-btn" id="resetTechMode">Reset Tech</button>':id==='languageLearning'?'<button class="btn danger-btn" id="resetLanguageMode">Reset Language Learning</button>':id==='niches'?'<button class="btn danger-btn" id="resetNicheMode">Reset Niches</button>':''}</div>
      <label class="check"><input class="modeEnable" data-mode="${id}" type="checkbox" ${c.enabled?'checked':''}> Enable mode</label>
      ${id==='tech'?`<div class="field"><label>Tech profile</label><select id="techProfile"><option value="devops">DevOps Engineer</option><option value="frontend-developer">Frontend Developer</option><option value="backend-developer">Backend Developer</option><option value="full-stack-developer">Full Stack Developer</option><option value="network-engineer">Network Engineer</option><option value="cybersecurity">Cybersecurity</option><option value="cloud-engineer">Cloud Engineer</option><option value="data-engineer">Data Engineer</option><option value="graphic-designer">Graphic Designer</option><option value="ui-ux-designer">UI/UX Designer</option><option value="database-engineer">Database Engineer</option><option value="ai-ml-engineer">AI/ML Engineer</option><option value="student">Student</option><option value="researcher">Researcher</option><option value="custom">Custom</option></select></div>
      <div class="field"><label>Target Language — 7,000+ master catalog</label><input id="techTargetLanguageSearch" placeholder="Search target language…"><select id="techTargetLanguage" class="language-single" size="7">${langOptionMarkup(tech.targetLanguage?[tech.targetLanguage]:["en"])}</select><small class="muted">Country selection automatically suggests the country's primary/national language. You can manually change it.</small></div>
      <div class="field"><label>Content languages — 7,000+ master catalog</label><input id="techLangSearch" placeholder="Search languages…"><select id="techLangs" class="language-multi" multiple size="7">${langOptionMarkup(techLangs)}</select><small class="muted">Hold Ctrl/Cmd to select multiple. The same master catalog is used here and in Language Learning Mode.</small></div>
      <div class="field"><label>Target Country</label><select id="techCountry">${countryOpts}</select><button class="btn" id="techCountryLanguage" type="button" style="margin-top:8px">Use Country Language</button><small class="muted">Selecting a country automatically sets Target Language and Content Languages. You can then change either field manually.</small></div>`:''}
      ${id==='languageLearning'?`<div class="field"><label>Target / Learning Language — 7,000+ master catalog</label><input id="learnLangSearch" placeholder="Search learning languages…"><select id="learnLang" class="language-single" size="7">${langOptionMarkup(lang.learningLanguage?[lang.learningLanguage]:[])}</select></div>
      <div class="field"><label>Content languages — 7,000+ master catalog</label><input id="learnContentLangSearch" placeholder="Search content languages…"><select id="learnContentLangs" class="language-multi" multiple size="7">${langOptionMarkup(learnLangs)}</select></div>
      <div class="field"><label>Target Country</label><select id="learnCountry">${countryOpts}</select><button class="btn" id="learnCountryLanguage" type="button" style="margin-top:8px">Use Country Language</button><small class="muted">Selecting a country automatically sets Target / Learning Language and Content Languages. You can then change either field manually.</small></div>
      <div class="field"><label>Learning Focus: Strict ↔ Relaxed</label><input id="learnFocus" type="range" min="0" max="100" value="${c.focus??70}"></div>
      <div class="field"><label>Goals</label><textarea id="learnGoals" rows="5">${esc((c.goals||['learn-language','listening','vocabulary','grammar','conversation','culture','news','reading','pronunciation']).join('\n'))}</textarea></div>`:''}
      ${id==='niches'?`<div class="field"><label>Niche profile</label><select id="nicheProfile"><option value="technology">Technology</option><option value="photography">Photography</option><option value="travel">Travel</option><option value="cooking">Cooking</option><option value="personal-finance">Personal Finance</option><option value="fitness">Fitness</option><option value="books">Books & Reading</option><option value="science">Science</option><option value="history">History</option><option value="cars">Cars & Automotive</option><option value="gaming">Gaming</option><option value="music">Music</option><option value="fashion">Fashion</option><option value="entrepreneurship">Entrepreneurship</option><option value="custom">Custom</option></select></div>
      <div class="field"><label>Target Language — 7,000+ master catalog</label><input id="nicheTargetLanguageSearch" placeholder="Search target language…"><select id="nicheTargetLanguage" class="language-single" size="7">${langOptionMarkup(c.targetLanguage?[c.targetLanguage]:["en"])}</select></div>
      <div class="field"><label>Content languages — 7,000+ master catalog</label><input id="nicheLangSearch" placeholder="Search languages…"><select id="nicheLangs" class="language-multi" multiple size="7">${langOptionMarkup(Array.isArray(c.contentLanguages)?c.contentLanguages:[])}</select></div>
      <div class="field"><label>Target Country</label><select id="nicheCountry">${countryOpts}</select><button class="btn" id="nicheCountryLanguage" type="button" style="margin-top:8px">Use Country Language</button><small class="muted">Selecting a country automatically sets Target Language and Content Languages. You can then change either field manually.</small></div>`:''}
      ${id==='productivity'?`<div class="field"><label>Focus level</label><select id="focusLevel"><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="focused">Focused</option><option value="deep">Deep Focus</option></select></div>`:''}
      <div class="row"><div class="field"><label>Show threshold</label><input class="threshold" data-mode="${id}" data-key="showThreshold" type="number" value="${c.showThreshold??60}"></div><div class="field"><label>Deprioritize threshold</label><input class="threshold" data-mode="${id}" data-key="deprioritizeThreshold" type="number" value="${c.deprioritizeThreshold??30}"></div></div>
    </div>`;
  }).join('')}</div>
  <div class="grid" style="margin-top:14px">
    <div class="card form"><h3>Mode Switch</h3><div class="field"><label>Active mode</label><select id="activeMode"><option value="general">General</option><option value="tech">Tech</option><option value="languageLearning">Language Learning</option><option value="niches">Niches</option><option value="productivity">Productivity</option><option value="custom">Custom</option></select></div><div class="actions"><button class="btn" id="saveModes">Save Mode Settings</button><button class="btn danger-btn" id="resetModes">Reset Modes</button></div><p class="muted">Selecting Tech, Language Learning or Niches activates its matching feed shelf and intelligence engine.</p></div>
    <div class="card form"><h3>Management Pages</h3><p class="muted">Detailed JSON managers remain dedicated pages.</p><div class="quick-access-grid"><button class="btn" id="openTech">⚙️ Tech Mode</button><button class="btn" id="openLangLearning">🌐 Language Learning</button><button class="btn" id="openNiches">🧭 Niches</button><button class="btn" id="openLibrary">📚 YouTube Library</button></div></div>
  </div>`;
  $('#techProfile').value=tech.profileId||'devops';
  $('#techTargetLanguage').value=tech.targetLanguage||tech.contentLanguages?.[0]||'en';
  $('#techCountry').value=tech.country||'GLOBAL'; if(!$('#techCountry').value)$('#techCountry').value='GLOBAL';
  $('#learnCountry').value=lang.country||'GLOBAL'; if(!$('#learnCountry').value)$('#learnCountry').value='GLOBAL';
  $('#nicheProfile').value=c.nicheProfile||'technology';
  $('#nicheTargetLanguage').value=c.targetLanguage||c.contentLanguages?.[0]||'en';
  $('#nicheCountry').value=c.country||'GLOBAL'; if(!$('#nicheCountry').value)$('#nicheCountry').value='GLOBAL';
  $('#focusLevel').value=ms.productivity?.focusLevel||'balanced';
  $('#activeMode').value=settings.activeMode||'general';
  const selectedValues = id => { const el=$(id); if(!el)return[]; try { if(el.dataset.selected){ const parsed=JSON.parse(el.dataset.selected); if(Array.isArray(parsed)) return parsed.filter(Boolean); if(parsed!=null&&parsed!=='') return [String(parsed)]; } } catch(_){} return Array.from(el.selectedOptions||[]).map(v=>v.value).filter(Boolean); };
  const rememberSelection=el=>{if(!el)return;const visible=[...el.options].map(o=>o.value);let stored=selectedValues(el.id);if(el.multiple){const current=[...el.selectedOptions].map(o=>o.value);stored=stored.filter(v=>!visible.includes(v));stored=[...new Set([...stored,...current])];}else{stored=el.value?[el.value]:stored.slice(0,1)}el.dataset.selected=JSON.stringify(stored)};
  const refreshLanguageOptions = (searchId, selectId, fallback, multi) => {
    const el=$(selectId);
    const search=$(searchId);
    if(!el||!search)return;
    const q=String(search.value||'');
    let stored=[];
    try{stored=selectedValues(selectId)}catch(_){stored=[]}
    const safeFallback=Array.isArray(fallback)?fallback.filter(Boolean):[];
    const values=stored.length?stored:safeFallback;
    el.innerHTML=langOptionMarkup(values,q);
    values.forEach(v=>{const o=Array.from(el.options||[]).find(x=>x.value===String(v));if(o)o.selected=true;});
    el.dataset.selected=JSON.stringify(values);
  };
  $('#techLangs').onchange=()=>rememberSelection($('#techLangs')); $('#learnContentLangs').onchange=()=>rememberSelection($('#learnContentLangs')); $('#learnLang').onchange=()=>rememberSelection($('#learnLang'));
  $('#techTargetLanguage').onchange=()=>rememberSelection($('#techTargetLanguage'));
  $('#nicheLangs').onchange=()=>rememberSelection($('#nicheLangs')); $('#nicheTargetLanguage').onchange=()=>rememberSelection($('#nicheTargetLanguage'));
  const bindLanguageSearch=(searchId,selectId,fallback,multi)=>{
    const input=$(searchId);
    if(!input)return;
    const run=()=>refreshLanguageOptions(searchId,selectId,fallback,multi);
    input.addEventListener('input',run);
    input.addEventListener('search',run);
    input.addEventListener('change',run);
  };
  bindLanguageSearch('#techTargetLanguageSearch','#techTargetLanguage',tech.targetLanguage?[tech.targetLanguage]:['en'],false);
  bindLanguageSearch('#techLangSearch','#techLangs',techLangs,true);
  bindLanguageSearch('#learnLangSearch','#learnLang',lang.learningLanguage?[lang.learningLanguage]:[],false);
  bindLanguageSearch('#learnContentLangSearch','#learnContentLangs',learnLangs,true);
  bindLanguageSearch('#nicheTargetLanguageSearch','#nicheTargetLanguage',c.targetLanguage?[c.targetLanguage]:['en'],false);
  bindLanguageSearch('#nicheLangSearch','#nicheLangs',Array.isArray(c.contentLanguages)?c.contentLanguages:[],true);
  $('#techTargetLanguage').dataset.selected=JSON.stringify([tech.targetLanguage||tech.contentLanguages?.[0]||'en']); $('#nicheTargetLanguage').dataset.selected=JSON.stringify([c.targetLanguage||c.contentLanguages?.[0]||'en']); $('#nicheLangs').dataset.selected=JSON.stringify(Array.isArray(c.contentLanguages)?c.contentLanguages:[]); $('#techLangs').dataset.selected=JSON.stringify(techLangs); $('#learnContentLangs').dataset.selected=JSON.stringify(Array.isArray(lang.contentLanguages)?lang.contentLanguages:[]); $('#learnLang').dataset.selected=JSON.stringify(lang.learningLanguage?[lang.learningLanguage]:[]);
  const applyCountryLanguages=(countryId,targetId,contentId)=>{
    const country=$(countryId), target=$(targetId), content=$(contentId);
    if(!country||!target||!content)return false;
    const rawCodes=countryDefaults(sharedLanguageCatalog.languages,sharedLanguageCatalog.languagesByCountry,country.value);
    const codes=Array.isArray(rawCodes)?rawCodes:[];
    const keys=codes.map(languageKey).filter(Boolean);
    if(!keys.length)return false;
    const targetKey=keys[0];
    target.innerHTML=langOptionMarkup([targetKey]);
    target.value=targetKey;
    target.dataset.selected=JSON.stringify([targetKey]);
    content.innerHTML=langOptionMarkup(keys);
    keys.forEach(v=>{const o=Array.from(content.options||[]).find(x=>x.value===v);if(o)o.selected=true;});
    content.dataset.selected=JSON.stringify(keys);
    return true;
  };
  const applyTechCountryLanguages=()=>applyCountryLanguages('#techCountry','#techTargetLanguage','#techLangs');
  const applyLearnCountryLanguages=()=>applyCountryLanguages('#learnCountry','#learnLang','#learnContentLangs');
  const applyNicheCountryLanguages=()=>applyCountryLanguages('#nicheCountry','#nicheTargetLanguage','#nicheLangs');
  $('#techCountry').onchange=()=>{if(applyTechCountryLanguages())notify('Tech languages updated from the selected country.');};
  $('#learnCountry').onchange=()=>{if(applyLearnCountryLanguages())notify('Language Learning languages updated from the selected country.');};
  $('#nicheCountry').onchange=()=>{if(applyNicheCountryLanguages())notify('Niche languages updated from the selected country.');};
  $('#techCountryLanguage').onclick=()=>{if(applyTechCountryLanguages())notify('Tech languages reset to the selected country.');else notify('No language mapping is available for this country.','warn');};
  $('#learnCountryLanguage').onclick=()=>{if(applyLearnCountryLanguages())notify('Language Learning languages reset to the selected country.');else notify('No language mapping is available for this country.','warn');};
  $('#nicheCountryLanguage').onclick=()=>{if(applyNicheCountryLanguages())notify('Niche languages reset to the selected country.');else notify('No language mapping is available for this country.','warn');};
  if($('#techCountry')?.value&&$('#techCountry').value!=='GLOBAL'&&(!tech.targetLanguage||!techLangs.length))applyTechCountryLanguages();
  if($('#learnCountry')?.value&&$('#learnCountry').value!=='GLOBAL'&&(!lang.learningLanguage||!learnLangs.length))applyLearnCountryLanguages();
  if($('#nicheCountry')?.value&&$('#nicheCountry').value!=='GLOBAL'&&(!c.targetLanguage||!(Array.isArray(c.contentLanguages)&&c.contentLanguages.length)))applyNicheCountryLanguages();
  document.querySelectorAll('.modeEnable').forEach(cb=>cb.addEventListener('change',()=>{if(!cb.checked)return; document.querySelectorAll('.modeEnable').forEach(x=>{if(x!==cb)x.checked=false;}); $('#activeMode').value=cb.dataset.mode;}));
  $('#saveModes').onclick=async()=>{ await saveModesNow(); };
  $('#resetModes').onclick=async()=>{settings=await saveSettings({activeMode:'general',enabledModes:['general'],modeSettings:JSON.parse(JSON.stringify(DEFAULTS.modeSettings)),intelligenceEnabled:true});notify('Modes reset to defaults.');renderModes();};
  $('#resetTechMode').onclick=async()=>{const m={...(settings.modeSettings||{})};m.tech=JSON.parse(JSON.stringify(DEFAULTS.modeSettings.tech));m.tech.enabled=settings.activeMode==='tech';settings=await saveSettings({modeSettings:m,enabledModes:[settings.activeMode||'general']});notify('Tech mode reset.');renderModes();};
  $('#resetNicheMode').onclick=async()=>{const m={...(settings.modeSettings||{})};m.niches=JSON.parse(JSON.stringify(DEFAULTS.modeSettings.niches));m.niches.enabled=settings.activeMode==='niches';settings=await saveSettings({modeSettings:m,enabledModes:[settings.activeMode||'general']});notify('Niches mode reset.');renderModes();};
  $('#resetLanguageMode').onclick=async()=>{const m={...(settings.modeSettings||{})};m.languageLearning=JSON.parse(JSON.stringify(DEFAULTS.modeSettings.languageLearning));m.languageLearning.enabled=settings.activeMode==='languageLearning';settings=await saveSettings({modeSettings:m,enabledModes:[settings.activeMode||'general']});notify('Language Learning mode reset.');renderModes();};
  $('#openTech').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/tech/tech.html')});
  $('#openLangLearning').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/language-learning/language-learning.html')});
  $('#openNiches').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/niches/niches.html')});
  $('#openLibrary').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/library/library.html')});
}
function renderDistraction(){const cats=Object.keys(settings.distraction?.categories||{});$('#content').innerHTML=`<div class="card form"><div class="section-heading"><h3>Distraction engine</h3><button class="btn danger-btn" id="resetDistraction">Reset</button></div><label class="check"><input id="dcEnabled" type="checkbox" ${settings.distraction?.enabled?'checked':''}> Enable distraction scoring</label><div class="field"><label>Default action</label><select id="dcAction"><option value="allow">Allow</option><option value="deprioritize">Deprioritize</option><option value="hide">Hide</option></select></div><div class="field"><label>Threshold</label><input id="dcThreshold" type="number" value="${settings.distraction?.threshold??60}"></div></div><div class="grid">${cats.map(c=>`<div class="card form"><strong>${c}</strong><select class="dcCat" data-cat="${c}"><option value="allow">Allow</option><option value="deprioritize">Deprioritize</option><option value="hide">Hide</option></select></div>`).join('')}</div>`;$('#dcAction').value=settings.distraction?.action||'deprioritize';cats.forEach(c=>document.querySelector(`.dcCat[data-cat="${c}"]`).value=settings.distraction.categories[c]);$('#resetDistraction').onclick=async()=>{settings=await saveSettings({distraction:JSON.parse(JSON.stringify(DEFAULTS.distraction))});notify('Distraction settings reset.');renderDistraction();};}
async function renderStatistics() {
  const st = await getStats();
  const safe = value => Number(value || 0);
  $("#content").innerHTML = `
    <div class="grid">
      <div class="card"><h3>Scanned</h3><div class="metric">${safe(st.videosScanned)}</div></div>
      <div class="card"><h3>Shown</h3><div class="metric">${safe(st.videosShown)}</div></div>
      <div class="card"><h3>Deprioritized</h3><div class="metric">${safe(st.videosDeprioritized)}</div></div>
      <div class="card"><h3>Hidden</h3><div class="metric">${safe(st.videosHidden)}</div></div>
      <div class="card"><h3>Distraction blocked</h3><div class="metric">${safe(st.distractionBlocked)}</div></div>
      <div class="card"><h3>Distraction deprioritized</h3><div class="metric">${safe(st.distractionDeprioritized)}</div></div>
    </div>
    <div class="card" style="margin-top:14px">
      <h3>Explainability</h3>
      <p>Every intelligence decision stores relevance, distraction, mode and reason on the video card for local debugging.</p>
      <button class="btn" id="resetStats">Reset statistics</button>
    </div>`;

  $("#resetStats").onclick = async () => {
    await chrome.storage.local.set({
      stats: {
        videosScanned: 0,
        videosHidden: 0,
        videosShown: 0,
        videosDeprioritized: 0,
        intelligenceDecisions: 0,
        distractionBlocked: 0,
        distractionDeprioritized: 0,
        screenTimeSeconds: 0,
        syncs: 0,
        lastSync: null,
        notifications: 0
      }
    });
    notify("Statistics reset.");
    await renderStatistics();
  };
}

async function renderScreenTime(){const x=await chrome.storage.local.get('screenTime');const data=x.screenTime||{};const rows=Object.values(data).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,30);$('#content').innerHTML=`<div class="card form"><h3>Screen Time Monitor</h3><label class="check"><input id="stEnabled" type="checkbox" ${settings.screenTimeEnabled!==false?'checked':''}> Enable local screen-time monitor</label><div class="field"><label>Heartbeat seconds</label><input id="stBeat" type="number" min="15" max="300" value="${settings.screenTimeHeartbeatSeconds||30}"></div><button class="btn" id="stSave">Save</button></div><div class="card" style="margin-top:14px"><h3>Daily usage</h3>${rows.map(r=>`<p><strong>${r.date}</strong> — YouTube ${(r.youtubeSeconds/3600).toFixed(2)}h · Tech ${(r.techSeconds/3600).toFixed(2)}h · Language ${(r.languageSeconds/3600).toFixed(2)}h · Productivity ${(r.productivitySeconds/3600).toFixed(2)}h</p>`).join('')||'<p class="muted">No screen-time data yet.</p>'}</div>`;$('#stSave').onclick=async()=>{settings=await saveSettings({screenTimeEnabled:$('#stEnabled').checked,screenTimeHeartbeatSeconds:Math.max(15,Math.min(300,Number($('#stBeat').value)||30))});notify('Screen-time settings saved.')}}

function collect(){const p={}; if(currentTab==="modes"){Object.assign(p,collectModes()||{});} if(currentTab==="blocktube"){p.filterMatchMode=$("#btMatch").value;p.filterCaseSensitive=$("#btCase").checked;p.contextBlockEnabled=$("#btContext").checked;p.quickBlockEnabled=$("#btQuick").checked;p.quickBlockMenuEnabled=$("#btMenu").checked;p.blockedVideoAction=$("#btVideoAction").value;p.blacklist=lines("#btKeywords");p.blacklistChannels=lines("#btChannels");p.blacklistChannelIds=lines("#btChannelIds");p.blacklistVideoIds=lines("#btVideoIds");p.regexBlockRules=lines("#btRegex");}if(currentTab==="filtertube"){p.filterMatchMode=$("#ftMatch").value;p.filterShelves=$("#ftShelves").checked;p.filterPlaylists=$("#ftPlaylists").checked;p.hideWatched=$("#ftWatched").checked;p.quickBlockEnabled=$("#ftQuick").checked;p.quickBlockMenuEnabled=$("#ftMenu").checked;p.watchHistoryFiltering=$("#ftHistory").checked;p.minDurationSeconds=Math.max(0,Number($("#ftMinDuration").value)||0);p.maxDurationSeconds=Math.max(0,Number($("#ftMaxDuration").value)||0);p.filterAllCaps=$("#ftCaps").checked;}if(currentTab==="cleantubefilters"||currentTab==="filters"||currentTab==="cleantube"){document.querySelectorAll(".ct").forEach(x=>p[x.dataset.key]=x.checked);p.fullControl=!!settings.fullControl;p.fullControlBackup=settings.fullControlBackup||null;p.hideMembersOnly=!!p.hideFeaturedContent;p.theme=$("#ctTheme")?.value||settings.theme;p.compactMode=$("#ctDensity")?.value==="compact";p.strictCountry=$("#ctStrict")?.checked ?? settings.strictCountry;p.countryKeywords=lines("#ctCountryKeywords");}if(currentTab==="playback"){p.playbackSpeed=Number($("#pbSpeed").value)||1;p.preferredQuality=$("#pbQuality").value;p.volumeBoost=Number($("#pbVolume").value)||1;p.cinemaMode=$("#pbCinema").checked;p.forceTheaterMode=$("#pbTheater").checked;p.loopVideo=$("#pbLoop").checked;p.pauseWhenHidden=$("#pbPause").checked;p.disableAnnotations=$("#pbAnnotations").checked;}if(currentTab==="general"){p.extensionEnabled=$("#extEnabled").checked;p.notifications=$("#notifGeneral").checked;p.targetFeedEnabled=$("#targetShortcut").checked;p.applyYouTubeProfile=$("#profileGeneral").checked;p.toolbarEnabled=$("#toolbarGeneral").checked;p.followedChannelFeed={...(settings.followedChannelFeed||{}),enabled:$("#followFeedEnabled").checked,showOnlyNew:$("#followNewOnly").checked,includeShorts:$("#followShorts").checked,maxItems:Math.max(1,Math.min(30,Number($("#followMax").value)||12)),refreshMinutes:Math.max(5,Math.min(360,Number($("#followRefresh").value)||30)),placement:$("#followPlacement").value};}if(currentTab==="ads"){p.adBlockEnabled=$("#adEnabled").checked;p.adBlockMode=$("#adMode").value;p.adBlockNetwork=$("#adNetwork").checked;p.adBlockVideo=$("#adVideo").checked;p.adBlockCosmetic=$("#adCosmetic").checked;p.adBlockSkip=$("#adSkip").checked;}if(currentTab==="privacy"){p.whitelistChannels=lines("#whiteChannels");p.blacklistChannels=lines("#blackChannels");p.blacklistChannelIds=lines("#blackChannelIds");p.blacklistVideoIds=lines("#blackVideoIds");p.whitelist=lines("#white");p.blacklist=lines("#black");p.regexBlockRules=lines("#regex");}if(currentTab==="sync"){p.preventLibraryDuplicates=$("#preventLibraryDuplicates").checked;}if(currentTab==="language"){p.country=$("#country").value;p.targetLanguage=$("#lang").value;p.targetLanguageAutoSuggested=settings.targetLanguageAutoSuggested||null;p.targetLanguageManual=!!settings.targetLanguageManual;p.geoMode=$("#geoMode").value;p.unknownPolicy=$("#unknownPolicy").value;p.targetFeedEnabled=$("#languageTargetEnabled").checked;}if(currentTab==="targetfeed"){p.targetFeedEnabled=$("#targetEnabled").checked;p.targetFeedMode=$("#targetMode").value;p.targetUnknownPolicy=$("#targetUnknown").value;p.targetRequireLanguage=$("#targetRequireLanguage").checked;p.applyYouTubeProfile=$("#applyProfile").checked;p.autoApplyTargetProfile=$("#autoApplyProfile").checked;}if(currentTab==="toolbar"){p.toolbarEnabled=$("#tbEnabled").checked;p.toolbarShowOnYouTubeOnly=$("#tbYoutubeOnly").checked;p.toolbarAutoHide=$("#tbAuto").checked;p.toolbarRevealDistance=Math.max(20,Math.min(400,Number($("#tbReveal").value)||120));p.toolbarPosition=$("#tbPosition").value;p.toolbarCustomX=$("#tbX").value===""?null:Number($("#tbX").value);p.toolbarCustomY=$("#tbY").value===""?null:Number($("#tbY").value);p.toolbarScale=Math.max(.75,Math.min(1.5,Number($("#tbScale").value)||1));}if(currentTab==="suggestions"){p.enableSuggestionScoring=$("#score").checked;p.preferredTopics=lines("#topics");}if(currentTab==="distraction"){p.distraction={...(settings.distraction||{}),enabled:$("#dcEnabled").checked,action:$("#dcAction").value,threshold:Number($("#dcThreshold").value)||60,categories:Object.fromEntries([...document.querySelectorAll('.dcCat')].map(x=>[x.dataset.cat,x.value]))};}if(currentTab==="screentime"){p.screenTimeEnabled=$("#stEnabled").checked;p.screenTimeHeartbeatSeconds=Math.max(15,Math.min(300,Number($("#stBeat").value)||30));}if(currentTab==="notifications"){p.notifications=$("#notif").checked;p.notificationPriority=$("#notifPriority").value;p.notificationQuietHours=$("#notifQuiet").checked;p.quietStart=$("#quietStart").value;p.quietEnd=$("#quietEnd").value;p.notificationSettings=Object.fromEntries([...document.querySelectorAll(".notifEvent")].map(x=>[x.dataset.key,x.checked]));}if(currentTab==="performance"){p.extensionEnabled=$("#perfEnabled").checked;p.performanceMode=$("#perfMode").value;p.observerDebounceMs=Math.max(20,Math.min(1000,Number($("#perfDebounce").value)||80));p.maxCardsPerScan=Math.max(25,Math.min(500,Number($("#perfCards").value)||150));p.statsRetentionDays=Math.max(7,Math.min(3650,Number($("#perfRetention").value)||90));p.diagnosticsEnabled=$("#perfDiag").checked;p.debugLogging=$("#perfDebug").checked;}if(currentTab==="profiles"){p.backupAuto=$("#backupAuto").checked;p.backupIntervalHours=Math.max(1,Number($("#backupHours").value)||24);p.backupEncrypted=$("#backupEncrypted").checked;}return p;}

async function render(){const [title,subtitle]=TAB_META[currentTab]||TAB_META.dashboard;$("#title").textContent=title;$("#subtitle").textContent=subtitle;$("#content").innerHTML='<div class="card"><p>Loading…</p></div>';try{switch(currentTab){case"dashboard":await renderDashboard();break;case"general":renderGeneral();break;case"modes":await loadDatabase();renderModes();break;case"distraction":renderDistraction();break;case"statistics":renderStatistics();break;case"screentime":await renderScreenTime();break;case"cleantubefilters":renderClearnTubeFilters();break;case"blocktube":renderBlockTube();break;case"filtertube":renderFilterTube();break;case"playback":renderPlayback();break;case"ads":await renderAds();break;case"privacy":renderPrivacy();break;case"language":await renderLanguage();break;case"targetfeed":renderTargetFeed();break;case"tools":renderTools();break;case"fetch":await renderFetch();break;case"suggestions":renderSuggestions();break;case"algorithm":renderAlgorithm();break;case"sync":renderSync();break;case"performance":await renderPerformance();break;case"notifications":renderNotifications();break;case"toolbar":renderToolbar();break;case"database":await renderDatabase();break;case"profiles":await renderProfiles();break;default:await renderDashboard();}}catch(e){console.error(e);$("#content").innerHTML=`<div class="card"><h3 class="danger">Settings tab failed</h3><p>${esc(e.message)}</p><p class="muted">The rest of the extension remains available.</p></div>`;notify(`Settings error: ${e.message}`,"error");}}

$("#save").onclick=async()=>{try{settings=await saveSettings(collect());$("#save").textContent="Saved ✓";notify("Changes saved successfully.");if(currentTab==="modes"&&settings.applyYouTubeProfile!==false){try{await chrome.runtime.sendMessage({type:"APPLY_YOUTUBE_PROFILE",reload:false});}catch(_){}}if((currentTab==="targetfeed"||currentTab==="language")&&settings.applyYouTubeProfile!==false){const r=await chrome.runtime.sendMessage({type:"APPLY_YOUTUBE_PROFILE",reload:settings.targetFeedEnabled===true});if(!r?.ok)notify(`Profile apply failed: ${r?.error||"Unknown error"}`,"error");}setTimeout(()=>$("#save").textContent="Save Changes",1200);}catch(e){notify(`Save failed: ${e.message}`,"error");}};

document.querySelectorAll(".nav").forEach(button=>button.addEventListener("click",async()=>{document.querySelectorAll(".nav").forEach(x=>x.classList.remove("active"));button.classList.add("active");currentTab=button.dataset.tab;await render();}));

async function init(){settings=await getSettings();await render();}
init().catch(e=>{console.error(e);$("#content").innerHTML=`<div class="card"><h3 class="danger">Charlie MJ settings could not start</h3><p>${esc(e.message)}</p></div>`;});

function stamp(){return new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}
