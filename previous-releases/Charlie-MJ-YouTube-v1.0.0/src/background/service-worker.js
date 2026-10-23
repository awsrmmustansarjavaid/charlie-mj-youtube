import { getSettings, incrementStats, DEFAULTS } from "../shared/core.js";

const DB_ROOT = "database/";
const TARGET_CACHE = new Map();
const TARGET_CACHE_TTL = 5 * 60 * 1000;

async function readJson(relativePath) {
  const response = await fetch(chrome.runtime.getURL(DB_ROOT + relativePath), { cache: "no-store" });
  if (!response.ok) throw new Error(`Database request failed: ${response.status} ${relativePath}`);
  return response.json();
}

async function syncAdRules(settings) {
  if (!chrome.declarativeNetRequest?.updateEnabledRulesets) return;
  const enabled = settings?.extensionEnabled !== false && settings?.adBlockEnabled !== false && settings?.adBlockNetwork !== false;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? ["youtube_ads"] : [],
      disableRulesetIds: enabled ? [] : ["youtube_ads"]
    });
  } catch (error) { console.warn("Charlie MJ ad rules update failed", error); }
}

async function ensureDefaults() {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) await chrome.storage.local.set({ settings: { ...DEFAULTS } });
}

async function applyYouTubeProfile(settings = null) {
  const s = settings || await getSettings();
  if (s.applyYouTubeProfile === false) return { ok: true, changed: false };
  const country = String(s.country || "US").toUpperCase();
  const requestedLanguage = String(s.targetLanguage || s.language || "en").toLowerCase();
  const languageData = await readJson("languages/languages.json").catch(() => ({ languages: [] }));
  const languageRecord = (languageData.languages || []).find(item =>
    [item.alpha_2, item.alpha_3, item.terminology, item.bibliographic].filter(Boolean)
      .some(code => String(code).toLowerCase() === requestedLanguage)
  );
  const language = String(languageRecord?.alpha_2 || requestedLanguage).toLowerCase();
  const url = "https://www.youtube.com/";
  const existing = await chrome.cookies.get({ url, name: "PREF" }).catch(() => null);
  let value = existing?.value || "";
  const original = value;
  const setPart = (key, part) => {
    const re = new RegExp(`(?:^|&)${key}=[^&]*`);
    if (re.test(value)) value = value.replace(re, part);
    else value = value ? `${value}&${part}` : part;
  };
  setPart("gl", `gl=${encodeURIComponent(country)}`);
  setPart("hl", `hl=${encodeURIComponent(language)}`);
  if (value === original) return { ok: true, changed: false, country, language };
  await chrome.cookies.set({
    url, name: "PREF", value, domain: ".youtube.com", path: "/", secure: true,
    sameSite: "lax", expirationDate: Math.floor(Date.now() / 1000) + 31536000
  });
  return { ok: true, changed: true, country, language };
}

function extractInitialData(html) {
  const markers = [
    "var ytInitialData = ",
    "ytInitialData = ",
    "window[\"ytInitialData\"] = ",
    "ytInitialData\":"
  ];
  let start = -1;
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i >= 0) { start = i + marker.length; break; }
  }
  if (start < 0) return null;
  while (html[start] && /\s/.test(html[start])) start++;
  if (html[start] !== "{") return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
  }
  return null;
}

function textFromRuns(node) {
  if (!node) return "";
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map(r => r.text || "").join("");
  return "";
}

function walkVideoRenderers(root, output, seen) {
  if (!root || typeof root !== "object") return;
  if (Array.isArray(root)) { for (const item of root) walkVideoRenderers(item, output, seen); return; }
  for (const [key, value] of Object.entries(root)) {
    if ((key === "videoRenderer" || key === "gridVideoRenderer" || key === "compactVideoRenderer") && value?.videoId) {
      const id = value.videoId;
      if (!seen.has(id)) {
        seen.add(id);
        const thumb = value.thumbnail?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        output.push({
          videoId: id,
          title: textFromRuns(value.title),
          channel: textFromRuns(value.ownerText) || textFromRuns(value.longBylineText),
          channelUrl: value.ownerText?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || "",
          thumbnail: thumb,
          published: textFromRuns(value.publishedTimeText),
          duration: textFromRuns(value.lengthText),
          views: textFromRuns(value.viewCountText),
          source: "youtube-search"
        });
      }
    }
    walkVideoRenderers(value, output, seen);
  }
}

async function getInnertubeContext() {
  const cached = globalThis.__CMJ_INNERTUBE_CONTEXT;
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.value;
  const response = await fetch("https://www.youtube.com/", { cache: "no-store", headers: { "Accept": "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8" } });
  if (!response.ok) throw new Error(`YouTube home HTTP ${response.status}`);
  const html = await response.text();
  const keyMatch = html.match(/(?:INNERTUBE_API_KEY|innertubeApiKey)[\"']?\s*[:=]\s*[\"']([^\"']+)/);
  const versionMatch = html.match(/(?:INNERTUBE_CLIENT_VERSION|innertubeClientVersion)[\"']?\s*[:=]\s*[\"']([^\"']+)/);
  const clientMatch = html.match(/(?:INNERTUBE_CLIENT_NAME|innertubeClientName)[\"']?\s*[:=]\s*[\"']([^\"']+)/);
  if (!keyMatch) throw new Error("YouTube InnerTube API key was not available");
  const value = { apiKey: keyMatch[1], clientVersion: versionMatch?.[1] || "2.20261020.01.00", clientName: clientMatch?.[1] || "WEB" };
  globalThis.__CMJ_INNERTUBE_CONTEXT = { at: Date.now(), value };
  return value;
}

async function searchYouTubeInnerTube(query, country, language) {
  const ctx = await getInnertubeContext();
  const response = await fetch(`https://www.youtube.com/youtubei/v1/search?key=${encodeURIComponent(ctx.apiKey)}`, {
    method: "POST", credentials: "include", cache: "no-store",
    headers: { "Content-Type": "application/json", "Accept": "application/json", "Accept-Language": `${language},en;q=0.5` },
    body: JSON.stringify({
      context: { client: { clientName: ctx.clientName, clientVersion: ctx.clientVersion, hl: language, gl: country } },
      query, params: "EgIQAQ=="
    })
  });
  if (!response.ok) throw new Error(`YouTube InnerTube search HTTP ${response.status}`);
  const data = await response.json();
  const videos = [];
  walkVideoRenderers(data, videos, new Set());
  if (!videos.length) throw new Error("YouTube InnerTube search returned no video data");
  videos.forEach(v => v.source = "youtube-innertube-search");
  return videos;
}

async function searchYouTube(query, country, language) {
  const params = new URLSearchParams({ search_query: query, sp: "EgIQAQ==", gl: country, hl: language });
  const url = `https://www.youtube.com/results?${params.toString()}`;
  const response = await fetch(url, { credentials: "include", cache: "no-store", headers: {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": `${language},en;q=0.5`,
    "Cache-Control": "no-cache"
  } });
  if (!response.ok) throw new Error(`YouTube search HTTP ${response.status}`);
  const html = await response.text();
  const data = extractInitialData(html);
  if (!data) {
    const lower = html.toLowerCase();
    if (lower.includes("consent.youtube.com") || lower.includes("before you continue to youtube")) {
      throw new Error("YouTube returned a consent page instead of search results");
    }
    throw new Error("YouTube search data was not available");
  }
  const videos = [];
  walkVideoRenderers(data, videos, new Set());
  return videos;
}

async function getTargetFeed(settings = null) {
  const s = settings || await getSettings();
  const countryCode = String(s.country || "US").toUpperCase();
  const languageCode = String(s.targetLanguage || s.language || "en").toLowerCase();
  const cacheKey = `${countryCode}:${languageCode}`;
  const cached = TARGET_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < TARGET_CACHE_TTL) return { ok: true, ...cached.data, cached: true };

  const countries = await readJson("countries/countries.json").catch(() => ({ countries: [] }));
  const country = (countries.countries || []).find(c => String(c.code).toUpperCase() === countryCode) || {};
  const languageData = await readJson("languages/languages.json").catch(() => ({ languages: [] }));
  const language = (languageData.languages || []).find(item => [item.alpha_2, item.alpha_3, item.terminology, item.bibliographic].filter(Boolean).some(code => String(code).toLowerCase() === languageCode)) || {};
  const countryName = country.name || countryCode;
  const languageName = language.name || languageCode;
  const languageSignalsForFeed = await readJson(`languages/signals/${String(language?.alpha_2 || languageCode).toLowerCase()}.json`).catch(() => ({ strong: [], common: [] }));
  const signalTerms = [
    ...(Array.isArray(languageSignalsForFeed?.strong) ? languageSignalsForFeed.strong : []),
    ...(Array.isArray(languageSignalsForFeed?.common) ? languageSignalsForFeed.common : [])
  ].filter(Boolean).slice(0, 4);
  const queries = [
    `${countryName} ${languageName}`,
    countryName,
    languageName,
    ...signalTerms.map(term => `${languageName} ${term}`)
  ].filter((query, index, list) => query && list.indexOf(query) === index);
  const all = [], seen = new Set(), errors = [];
  for (const query of queries) {
    try {
      let items;
      try { items = await searchYouTubeInnerTube(query, countryCode, languageCode); }
      catch (innerError) {
        try { items = await searchYouTube(query, countryCode, languageCode); }
        catch (htmlError) { throw new Error(`${innerError.message}; ${htmlError.message}`); }
      }
      for (const item of items) if (!seen.has(item.videoId)) { seen.add(item.videoId); all.push(item); }
    } catch (error) { errors.push(`${query}: ${error.message}`); }
    if (all.length >= 48) break;
  }
  all.forEach(v => { v.searchKind = v.searchKind || "language"; });
  const data = { ok: true, country: countryName, countryCode, language: languageName, languageCode, queries, videos: all.slice(0, 48), errors };
  if (data.videos.length) TARGET_CACHE.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function applyAdRulesFromStorage() { const { settings = {} } = await chrome.storage.local.get("settings"); await syncAdRules(settings); }
async function setupContextMenus() {
  if (!chrome.contextMenus) return;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: "cmj-block-video", title: "Charlie MJ: Block this video", contexts: ["link"], documentUrlPatterns: ["https://www.youtube.com/*"] });
  chrome.contextMenus.create({ id: "cmj-block-channel", title: "Charlie MJ: Block this channel", contexts: ["link"], documentUrlPatterns: ["https://www.youtube.com/*"] });
  chrome.contextMenus.create({ id: "cmj-block-selection", title: "Charlie MJ: Block selected text", contexts: ["selection"], documentUrlPatterns: ["https://www.youtube.com/*"] });
}

chrome.runtime.onInstalled.addListener(async () => { await ensureDefaults(); await applyAdRulesFromStorage(); await setupContextMenus(); });
chrome.runtime.onStartup?.addListener(async () => { await applyAdRulesFromStorage(); await setupContextMenus(); });
chrome.storage.onChanged.addListener(async changes => { if (changes.settings) { TARGET_CACHE.clear(); await syncAdRules(changes.settings.newValue || {}); } });

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  let type = info.menuItemId === "cmj-block-video" ? "BLOCK_VIDEO" : info.menuItemId === "cmj-block-channel" ? "BLOCK_CHANNEL" : info.menuItemId === "cmj-block-selection" ? "BLOCK_TEXT" : null;
  if (!type) return;
  try { await chrome.tabs.sendMessage(tab.id, { type, linkUrl: info.linkUrl || "", selectionText: info.selectionText || "" }); } catch (_) {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "OPEN_OPTIONS") { await chrome.runtime.openOptionsPage(); sendResponse({ ok: true }); return; }
      if (msg?.type === "APPLY_YOUTUBE_PROFILE") {
        const result = await applyYouTubeProfile();
        if (msg.reload && result.changed) {
          const tabId = sender?.tab?.id;
          if (tabId) setTimeout(() => chrome.tabs.reload(tabId).catch(() => {}), 150);
        }
        sendResponse(result); return;
      }
      if (msg?.type === "GET_TARGET_FEED") { sendResponse(await getTargetFeed()); return; }
      if (msg?.type === "NOTIFY") {
        const s = await getSettings();
        if (s.notifications) {
          await chrome.notifications.create("cmj-" + Date.now(), { type: "basic", iconUrl: chrome.runtime.getURL("assets/icons/icon128.png"), title: msg.title || "Charlie MJ YouTube", message: msg.message || "" });
          await incrementStats({ notifications: 1 });
        }
        sendResponse({ ok: true }); return;
      }
      if (msg?.type === "LOAD_FILTER_DATA") {
        const countryCode = String(msg.countryCode || "US").toLowerCase();
        const [countries, country] = await Promise.all([readJson("countries/countries.json"), readJson(`countries/${countryCode}.json`).catch(() => null)]);
        sendResponse({ ok: true, countries, country }); return;
      }
      if (msg?.type === "LOAD_LANGUAGE") {
        const language = String(msg.language || "").toLowerCase();
        const data = await readJson("languages/languages.json");
        const record = (data.languages || []).find(item => [item.alpha_2, item.alpha_3, item.terminology, item.bibliographic].filter(Boolean).some(code => String(code).toLowerCase() === language));
        const signals = await readJson(`languages/signals/${language}.json`).catch(() => null);
        sendResponse({ ok: true, language: record || null, signals: signals || { strong: [], common: [] } }); return;
      }
      if (msg?.type === "AD_BLOCK_STATS") {
        const stats = msg.stats || {};
        const current = (await chrome.storage.local.get("adStats")).adStats || { skipped: 0, hidden: 0, lastEvent: null };
        current.skipped += Number(stats.skipped || 0); current.hidden += Number(stats.hidden || 0); current.lastEvent = new Date().toISOString();
        await chrome.storage.local.set({ adStats: current });
        const total = current.skipped + current.hidden;
        await chrome.action.setBadgeText({ text: total ? (total > 999 ? "999+" : String(total)) : "" });
        sendResponse({ ok: true, adStats: current }); return;
      }
      if (msg?.type === "AD_RULES_STATUS") {
        const enabled = msg.enabled !== false; const current = (await chrome.storage.local.get("settings")).settings || {};
        current.adBlockEnabled = enabled; await chrome.storage.local.set({ settings: current }); await syncAdRules(current); sendResponse({ ok: true, enabled }); return;
      }
      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (error) { sendResponse({ ok: false, error: error.message }); }
  })();
  return true;
});
