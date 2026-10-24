/**
 * Background service worker (Manifest V3, ES module).
 *
 * Owns everything that must run outside a page:
 *  - default settings, YouTube region/language cookies and declarativeNetRequest ad rules;
 *  - YouTube metadata fetching (channels, playlists, videos) and the scheduled library refresh;
 *  - the database bridge (READ_DATABASE) and the GitHub tree/file reader used by Data Sync;
 *  - the search fallback used by the Target Feed when the page bridge is unavailable;
 *  - context menus, notifications and the message router (chrome.runtime.onMessage).
 */

import { getSettings, incrementStats, DEFAULTS } from "../shared/core.js";

const DB_ROOT = "database/";
const TARGET_CACHE = new Map();
const TARGET_CACHE_TTL = 5 * 60 * 1000;

/** Read a JSON file packaged under database/ (relative path). */
async function readJson(relativePath) {
  const response = await fetch(chrome.runtime.getURL(DB_ROOT + relativePath), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Database request failed: ${response.status} ${relativePath}`);
  return response.json();
}

/** Enable or disable the packaged declarativeNetRequest ad rule set. */
async function syncAdRules(settings) {
  if (!chrome.declarativeNetRequest?.updateEnabledRulesets) return;
  const enabled =
    settings?.extensionEnabled !== false &&
    settings?.adBlockEnabled !== false &&
    settings?.adBlockNetwork !== false;
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds: enabled ? ["youtube_ads"] : [],
      disableRulesetIds: enabled ? [] : ["youtube_ads"],
    });
  } catch (error) {
    console.warn("Charlie MJ ad rules update failed", error);
  }
}

/** Create the default settings on first install without overwriting existing values. */
async function ensureDefaults() {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) await chrome.storage.local.set({ settings: { ...DEFAULTS } });
}

// Country / language requested by the active mode (Tech / Language Learning / Niches); General uses the global settings.
function modeGeo(s) {
  const m = String(s.activeMode || "general");
  const ms = s.modeSettings || {};
  const first = (a) =>
    (Array.isArray(a) ? a : []).map((x) => String(x || "").trim()).find(Boolean) || "";
  const cc = (c) => {
    const v = String(c || "").toUpperCase();
    return /^[A-Z]{2}$/.test(v) ? v : "GLOBAL";
  };
  if (m === "tech")
    return {
      country: cc(ms.tech?.country),
      language:
        String(ms.tech?.targetLanguage || first(ms.tech?.contentLanguages) || "en").trim() || "en",
    };
  if (m === "languageLearning") {
    const l = ms.languageLearning || {};
    return {
      country: cc(l.country),
      language:
        String(l.learningLanguage || "").trim() ||
        first(l.contentLanguages) ||
        String(s.targetLanguage || s.language || "en"),
    };
  }
  if (m === "niches")
    return {
      country: cc(ms.niches?.country),
      language:
        String(ms.niches?.targetLanguage || first(ms.niches?.contentLanguages) || "en").trim() ||
        "en",
    };
  return {
    country: String(s.country || "US").toUpperCase(),
    language: String(s.targetLanguage || s.language || "en"),
  };
}
const langMatches = (item, token) =>
  [item.alpha_2, item.alpha_3, item.terminology, item.bibliographic, item.name]
    .filter(Boolean)
    .some((code) => String(code).toLowerCase() === token);

/** Write YouTube's own region (gl) and language (hl) preference cookies to match the active mode. */
async function applyYouTubeProfile(settings = null) {
  const s = settings || (await getSettings());
  if (s.applyYouTubeProfile === false) return { ok: true, changed: false };
  const geo = modeGeo(s);
  const country = geo.country;
  const requestedLanguage = geo.language.toLowerCase();
  const languageData = await readJson("languages/languages.json").catch(() => ({ languages: [] }));
  const languageRecord = (languageData.languages || []).find((item) =>
    langMatches(item, requestedLanguage),
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
  if (country !== "GLOBAL") setPart("gl", `gl=${encodeURIComponent(country)}`);
  else value = value.replace(/(?:^|&)gl=[^&]*/, "").replace(/^&|&&/g, "");
  setPart("hl", `hl=${encodeURIComponent(language)}`);
  if (value === original) return { ok: true, changed: false, country, language };
  await chrome.cookies.set({
    url,
    name: "PREF",
    value,
    domain: ".youtube.com",
    path: "/",
    secure: true,
    sameSite: "lax",
    expirationDate: Math.floor(Date.now() / 1000) + 31536000,
  });
  return { ok: true, changed: true, country, language };
}

/** Pull the ytInitialData JSON object out of a YouTube HTML page. */
function extractInitialData(html) {
  const markers = [
    "var ytInitialData = ",
    "ytInitialData = ",
    'window["ytInitialData"] = ',
    'ytInitialData":',
  ];
  let start = -1;
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i >= 0) {
      start = i + marker.length;
      break;
    }
  }
  if (start < 0) return null;
  while (html[start] && /\s/.test(html[start])) start++;
  if (html[start] !== "{") return null;
  let depth = 0,
    inString = false,
    escaped = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

/** Join YouTube 'runs'/'simpleText' text nodes into a plain string. */
function textFromRuns(node) {
  if (!node) return "";
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r) => r.text || "").join("");
  return "";
}

/** Recursively collect video renderer objects from an InnerTube response. */
function walkVideoRenderers(root, output, seen) {
  if (!root || typeof root !== "object") return;
  if (Array.isArray(root)) {
    for (const item of root) walkVideoRenderers(item, output, seen);
    return;
  }
  for (const [key, value] of Object.entries(root)) {
    if (
      (key === "videoRenderer" || key === "gridVideoRenderer" || key === "compactVideoRenderer") &&
      value?.videoId
    ) {
      const id = value.videoId;
      if (!seen.has(id)) {
        seen.add(id);
        const thumb =
          value.thumbnail?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
        output.push({
          videoId: id,
          title: textFromRuns(value.title),
          channel: textFromRuns(value.ownerText) || textFromRuns(value.longBylineText),
          channelUrl:
            value.ownerText?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata
              ?.url || "",
          thumbnail: thumb,
          published: textFromRuns(value.publishedTimeText),
          duration: textFromRuns(value.lengthText),
          views: textFromRuns(value.viewCountText),
          source: "youtube-search",
        });
      }
    }
    walkVideoRenderers(value, output, seen);
  }
}

/** Discover (and cache) the InnerTube API key and client version from youtube.com. */
async function getInnertubeContext() {
  const cached = globalThis.__CMJ_INNERTUBE_CONTEXT;
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.value;
  const response = await fetch("https://www.youtube.com/", {
    cache: "no-store",
    headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8" },
  });
  if (!response.ok) throw new Error(`YouTube home HTTP ${response.status}`);
  const html = await response.text();
  const keyMatch = html.match(
    /(?:INNERTUBE_API_KEY|innertubeApiKey)[\"']?\s*[:=]\s*[\"']([^\"']+)/,
  );
  const versionMatch = html.match(
    /(?:INNERTUBE_CLIENT_VERSION|innertubeClientVersion)[\"']?\s*[:=]\s*[\"']([^\"']+)/,
  );
  const clientMatch = html.match(
    /(?:INNERTUBE_CLIENT_NAME|innertubeClientName)[\"']?\s*[:=]\s*[\"']([^\"']+)/,
  );
  if (!keyMatch) throw new Error("YouTube InnerTube API key was not available");
  const value = {
    apiKey: keyMatch[1],
    clientVersion: versionMatch?.[1] || "2.20261020.01.00",
    clientName: clientMatch?.[1] || "WEB",
  };
  globalThis.__CMJ_INNERTUBE_CONTEXT = { at: Date.now(), value };
  return value;
}

/** Search YouTube through InnerTube from the service worker; 'gl' is omitted unless valid. */
async function searchYouTubeInnerTube(query, country, language) {
  const ctx = await getInnertubeContext();
  const response = await fetch(
    `https://www.youtube.com/youtubei/v1/search?key=${encodeURIComponent(ctx.apiKey)}`,
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": `${language},en;q=0.5`,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: ctx.clientName,
            clientVersion: ctx.clientVersion,
            hl: language,
            ...(/^[A-Za-z]{2}$/.test(country || "") ? { gl: String(country).toUpperCase() } : {}),
          },
        },
        query,
        params: "EgIQAQ==",
      }),
    },
  );
  if (!response.ok) throw new Error(`YouTube InnerTube search HTTP ${response.status}`);
  const data = await response.json();
  const videos = [];
  walkVideoRenderers(data, videos, new Set());
  if (!videos.length) throw new Error("YouTube InnerTube search returned no video data");
  videos.forEach((v) => (v.source = "youtube-innertube-search"));
  return videos;
}

/** Read a <meta> tag value from an HTML string. */
function htmlMeta(html, key) {
  const safe = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re1 = new RegExp(
    `<meta[^>]+(?:property|name)=["']${safe}["'][^>]+content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${safe}["'][^>]*>`,
    "i",
  );
  return (html.match(re1)?.[1] || html.match(re2)?.[1] || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/** Depth-first search for the first object that owns the given key. */
function findObjectByKey(root, wantedKeys) {
  const keys = new Set(wantedKeys);
  const seen = new Set();
  function walk(node) {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    if (!Array.isArray(node)) {
      for (const key of keys) if (node[key]) return { key, value: node[key] };
      for (const value of Object.values(node)) {
        const hit = walk(value);
        if (hit) return hit;
      }
    } else {
      for (const value of node) {
        const hit = walk(value);
        if (hit) return hit;
      }
    }
    return null;
  }
  return walk(root);
}

/** Pull ytInitialPlayerResponse out of a watch page. */
function extractPlayerResponse(html) {
  const markers = [
    "var ytInitialPlayerResponse = ",
    "ytInitialPlayerResponse = ",
    'window["ytInitialPlayerResponse"] = ',
  ];
  for (const marker of markers) {
    const start0 = html.indexOf(marker);
    if (start0 < 0) continue;
    let start = start0 + marker.length;
    while (/\s/.test(html[start] || "")) start++;
    if (html[start] !== "{") continue;
    let depth = 0,
      inString = false,
      escaped = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(start, i + 1));
          } catch (_) {
            return null;
          }
        }
      }
    }
  }
  return null;
}

/** Fetch original YouTube metadata for a channel, playlist or video URL. */
async function fetchYouTubeEntity(rawUrl) {
  const input = String(rawUrl || "").trim();
  let url;
  try {
    url = new URL(input);
  } catch (_) {
    throw new Error("Invalid YouTube URL");
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname) && url.hostname.toLowerCase() !== "youtu.be")
    throw new Error("Only YouTube URLs are supported");

  let kind = "";
  let id = "";
  if (url.hostname === "youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] || "";
    kind = id ? "video" : "";
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v") || "";
    kind = id ? "video" : "";
  } else if (url.pathname === "/playlist") {
    id = url.searchParams.get("list") || "";
    kind = id ? "playlist" : "";
  } else if (
    /^\/@[^/]+/.test(url.pathname) ||
    /^\/channel\/[^/]+/.test(url.pathname) ||
    /^\/c\/[^/]+/.test(url.pathname) ||
    /^\/user\/[^/]+/.test(url.pathname)
  ) {
    kind = "channel";
    id = url.pathname.split("/").filter(Boolean).at(-1) || "";
  }
  if (!kind || !id)
    throw new Error("That URL is not a recognized YouTube channel, playlist, or video URL");

  // Normalize imported http:// YouTube URLs before the extension fetch.
  // This avoids an http → https redirect being treated as a cross-origin CORS redirect.
  url.protocol = "https:";
  const response = await fetch(url.href, {
    credentials: "include",
    cache: "no-store",
    redirect: "follow",
    headers: { Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.8" },
  });
  if (!response.ok) throw new Error(`YouTube page HTTP ${response.status}`);
  const html = await response.text();
  const canonical = htmlMeta(html, "og:url") || url.href;
  const ogTitle =
    htmlMeta(html, "og:title") ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/ - YouTube$/i, "");
  const description = htmlMeta(html, "og:description") || htmlMeta(html, "description");
  const ogImage = htmlMeta(html, "og:image");
  const initial = extractInitialData(html) || {};
  const player = kind === "video" ? extractPlayerResponse(html) || {} : {};
  const details = player.videoDetails || {};
  const metaTags = {};
  for (const match of html.matchAll(
    /<meta\s+[^>]*?(?:property|name)=["']([^"']+)["'][^>]*?content=["']([^"']*)["'][^>]*>/gi,
  )) {
    metaTags[String(match[1]).toLowerCase()] = String(match[2]);
  }
  const twitterImage = metaTags["twitter:image"] || metaTags["twitter:image:src"] || "";
  const common = {
    canonicalUrl: canonical,
    language: metaTags["og:locale"] || metaTags["content-language"] || "",
    siteName: metaTags["og:site_name"] || "YouTube",
    keywords: metaTags["keywords"]
      ? metaTags["keywords"]
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 100)
      : [],
    twitterTitle: metaTags["twitter:title"] || "",
    twitterDescription: metaTags["twitter:description"] || "",
    twitterImage,
    metaTags,
  };
  const meta = {
    type: kind,
    id,
    url: canonical,
    title: ogTitle || details.title || "",
    description,
    thumbnail:
      ogImage ||
      twitterImage ||
      details.thumbnail?.thumbnails?.at(-1)?.url ||
      (kind === "video" ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ""),
    youtubeMetadata: common,
  };

  if (kind === "video") {
    meta.videoId = id;
    meta.channel = details.author || htmlMeta(html, "author") || "";
    meta.channelId = details.channelId || "";
    meta.duration = details.lengthSeconds ? Number(details.lengthSeconds) : 0;
    meta.views = details.viewCount ? String(details.viewCount) : "";
    meta.keywords = Array.isArray(details.keywords) ? details.keywords.slice(0, 40) : [];
    meta.published = htmlMeta(html, "datePublished") || htmlMeta(html, "uploadDate") || "";
    meta.embedUrl = `https://www.youtube.com/embed/${id}`;
    meta.category = details.category || "";
    meta.isLive = Boolean(details.isLive);
    meta.isLiveContent = Boolean(details.isLiveContent);
    meta.isUpcoming = Boolean(details.isUpcoming);
    meta.madeForKids = Boolean(details.isFamilySafe);
    meta.shortDescription = details.shortDescription || meta.description || "";
    meta.ownerChannelUrl = details.channelId
      ? `https://www.youtube.com/channel/${details.channelId}`
      : "";
    meta.publishDate = details.publishDate || "";
    meta.uploadDate = details.uploadDate || meta.published || "";
  } else if (kind === "channel") {
    const hit = findObjectByKey(initial, [
      "c4TabbedHeaderRenderer",
      "pageHeaderRenderer",
      "channelMetadataRenderer",
    ]);
    const v = hit?.value || {};
    const renderer =
      v.c4TabbedHeaderRenderer || v.pageHeaderRenderer || v.channelMetadataRenderer || v;
    meta.channelId = renderer.channelId || renderer.externalId || (id.startsWith("UC") ? id : "");
    meta.title = textFromRuns(renderer.title) || renderer.title?.simpleText || meta.title || id;
    meta.handle = renderer.vanityChannelUrl
      ? String(renderer.vanityChannelUrl).split("/").at(-1)
      : id.startsWith("@")
        ? id
        : "";
    meta.thumbnail =
      renderer.avatar?.thumbnails?.at(-1)?.url ||
      renderer.content?.image?.sources?.at(-1)?.url ||
      meta.thumbnail;
    meta.subscribers = textFromRuns(renderer.subscriberCountText) || "";
    meta.description = meta.description || textFromRuns(renderer.description) || "";
  } else if (kind === "playlist") {
    const hit = findObjectByKey(initial, [
      "playlistHeaderRenderer",
      "playlistSidebarPrimaryInfoRenderer",
    ]);
    const v = hit?.value || {};
    const renderer = v.playlistHeaderRenderer || v.playlistSidebarPrimaryInfoRenderer || v;
    meta.title = textFromRuns(renderer.title) || renderer.title?.simpleText || meta.title || id;
    meta.channel = textFromRuns(renderer.ownerText) || textFromRuns(renderer.byline) || "";
    meta.channelId = renderer.ownerEndpoint?.browseEndpoint?.browseId || "";
    meta.videoCount =
      textFromRuns(renderer.numVideosText) || textFromRuns(renderer.videoCountText) || "";
    meta.thumbnail =
      renderer.playlistHeaderBanner?.heroPlaylistThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)
        ?.url ||
      renderer.thumbnail?.thumbnails?.at(-1)?.url ||
      meta.thumbnail;
  }
  meta.lastFetchedAt = new Date().toISOString();
  return { ok: true, item: meta };
}

/** Search with InnerTube first and fall back to the HTML results page. */
async function searchYouTubeResilient(query, country, language) {
  try {
    return await searchYouTubeInnerTube(query, country, language);
  } catch (firstError) {
    try {
      const fallback = await searchYouTube(query, country, language);
      if (fallback.length) return fallback;
      throw new Error("YouTube web search returned no videos");
    } catch (secondError) {
      throw new Error(`${firstError.message}; fallback: ${secondError.message}`);
    }
  }
}

/** Search by scraping the HTML /results page. */
async function searchYouTube(query, country, language) {
  const params = new URLSearchParams({ search_query: query, sp: "EgIQAQ==", hl: language });
  if (/^[A-Za-z]{2}$/.test(country || "")) params.set("gl", String(country).toUpperCase());
  const url = `https://www.youtube.com/results?${params.toString()}`;
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": `${language},en;q=0.5`,
      "Cache-Control": "no-cache",
    },
  });
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

/** Background fallback that builds a localized Target Feed (cached for a few minutes). */
async function getTargetFeed(settings = null) {
  const s = settings || (await getSettings());
  const countryCode = String(s.country || "US").toUpperCase();
  const languageCode = String(s.targetLanguage || s.language || "en").toLowerCase();
  const cacheKey = `${countryCode}:${languageCode}`;
  const cached = TARGET_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < TARGET_CACHE_TTL)
    return { ok: true, ...cached.data, cached: true };

  const countries = await readJson("countries/countries.json").catch(() => ({ countries: [] }));
  const country =
    (countries.countries || []).find((c) => String(c.code).toUpperCase() === countryCode) || {};
  const languageData = await readJson("languages/languages.json").catch(() => ({ languages: [] }));
  const language =
    (languageData.languages || []).find((item) =>
      [item.alpha_2, item.alpha_3, item.terminology, item.bibliographic]
        .filter(Boolean)
        .some((code) => String(code).toLowerCase() === languageCode),
    ) || {};
  const countryName = country.name || countryCode;
  const languageName = language.name || languageCode;
  const languageSignalsForFeed = await readJson(
    `languages/signals/${String(language?.alpha_2 || languageCode).toLowerCase()}.json`,
  ).catch(() => ({ strong: [], common: [] }));
  const signalTerms = [
    ...(Array.isArray(languageSignalsForFeed?.strong) ? languageSignalsForFeed.strong : []),
    ...(Array.isArray(languageSignalsForFeed?.common) ? languageSignalsForFeed.common : []),
  ]
    .filter(Boolean)
    .slice(0, 4);
  const queries = [
    `${countryName} ${languageName}`,
    countryName,
    languageName,
    ...signalTerms.map((term) => `${languageName} ${term}`),
  ].filter((query, index, list) => query && list.indexOf(query) === index);
  const all = [],
    seen = new Set(),
    errors = [];
  for (const query of queries) {
    try {
      let items;
      try {
        items = await searchYouTubeInnerTube(query, countryCode, languageCode);
      } catch (innerError) {
        try {
          items = await searchYouTube(query, countryCode, languageCode);
        } catch (htmlError) {
          throw new Error(`${innerError.message}; ${htmlError.message}`);
        }
      }
      for (const item of items)
        if (!seen.has(item.videoId)) {
          seen.add(item.videoId);
          all.push(item);
        }
    } catch (error) {
      errors.push(`${query}: ${error.message}`);
    }
    if (all.length >= 48) break;
  }
  all.forEach((v) => {
    v.searchKind = v.searchKind || "language";
  });
  const data = {
    ok: true,
    country: countryName,
    countryCode,
    language: languageName,
    languageCode,
    queries,
    videos: all.slice(0, 48),
    errors,
  };
  if (data.videos.length) TARGET_CACHE.set(cacheKey, { at: Date.now(), data });
  return data;
}

/** Re-fetch metadata for stored library items, respecting the refresh limits. */
async function refreshStoredLibrary(options = {}) {
  const stored = await chrome.storage.local.get(["youtubeLibrary", "settings"]);
  const db = stored.youtubeLibrary || {
    channels: [],
    playlists: [],
    videos: [],
    favorites: [],
    categories: [],
    collections: [],
    courses: [],
  };
  const settings = stored.settings || {};
  const cfg = {
    enabled: true,
    staleAfterHours: 24,
    refreshThumbnails: true,
    refreshMetadata: true,
    refreshStatistics: true,
    ...(settings.libraryRefresh || {}),
  };
  if (cfg.enabled === false && !options.force)
    return { ok: true, refreshed: 0, skipped: 0, disabled: true };
  const max = Math.max(1, Math.min(200, Number(options.maxItems || 60)));
  const cutoff =
    Date.now() -
    Math.max(1, Number(options.staleAfterHours || cfg.staleAfterHours || 24)) * 3600000;
  const buckets = ["channels", "playlists", "videos", "courses"];
  let refreshed = 0,
    skipped = 0;
  const errors = [];
  for (const bucket of buckets) {
    if (bucket === "courses" && settings.youtubeCourses?.enabled === false) continue;
    if (bucket === "courses" && settings.youtubeCourses?.autoRefresh === false && !options.force) continue;
    for (const item of Array.isArray(db[bucket]) ? db[bucket].slice() : []) {
      if (refreshed >= max) break;
      if (!item?.url) {
        skipped++;
        continue;
      }
      const fetchedAt =
        Date.parse(
          item.lastFetchedAt ||
            item.youtubeMetadata?.lastFetchedAt ||
            item.updatedAt ||
            item.addedAt ||
            0,
        ) || 0;
      if (!options.force && fetchedAt && fetchedAt > cutoff) {
        skipped++;
        continue;
      }
      try {
        const result = await fetchYouTubeEntity(item.url);
        const fresh = result.item || {};
        const merged = {
          ...item,
          ...fresh,
          type: item.type === "course" ? "course" : fresh.type,
          categoryIds: item.categoryIds || [],
          professionalProfiles: item.professionalProfiles || [],
          professionalProfile: item.professionalProfile,
          trusted: item.trusted,
          followed: item.followed,
          followFeed: item.followFeed,
          favorite: item.favorite,
          addedAt: item.addedAt,
          updatedAt: new Date().toISOString(),
        };
        const i = db[bucket].findIndex((x) => x.id === item.id);
        if (i >= 0) db[bucket][i] = merged;
        if (bucket === "videos" && Array.isArray(db.favorites)) {
          const fi = db.favorites.findIndex((x) => x.id === item.id);
          if (fi >= 0) db.favorites[fi] = { ...db.favorites[fi], ...merged };
        }
        refreshed++;
      } catch (e) {
        errors.push(`${bucket}:${item.id}: ${e.message}`);
      }
    }
  }
  db.favorites = Array.isArray(db.videos) ? db.videos.filter((v) => v.favorite) : [];
  await chrome.storage.local.set({ youtubeLibrary: db });
  return { ok: true, refreshed, skipped, errors };
}

/** Apply the ad rule set according to the saved ad-blocking settings. */
async function applyAdRulesFromStorage() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  await syncAdRules(settings);
}
/** Register the right-click menu items (block video/channel/text). */
async function setupContextMenus() {
  if (!chrome.contextMenus) return;
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: "cmj-block-video",
    title: "Charlie MJ: Block this video",
    contexts: ["link"],
    documentUrlPatterns: ["https://www.youtube.com/*"],
  });
  chrome.contextMenus.create({
    id: "cmj-block-channel",
    title: "Charlie MJ: Block this channel",
    contexts: ["link"],
    documentUrlPatterns: ["https://www.youtube.com/*"],
  });
  chrome.contextMenus.create({
    id: "cmj-block-selection",
    title: "Charlie MJ: Block selected text",
    contexts: ["selection"],
    documentUrlPatterns: ["https://www.youtube.com/*"],
  });
}

/** Create or clear the alarm that refreshes the library periodically. */
async function scheduleLibraryRefresh() {
  if (!chrome.alarms) return;
  const s = await getSettings();
  const cfg = s.libraryRefresh || {};
  try {
    await chrome.alarms.clear("cmj-library-refresh");
  } catch (_) {}
  if (cfg.enabled === false) return;
  const period = Math.max(1, Number(cfg.intervalHours || 24));
  await chrome.alarms.create("cmj-library-refresh", {
    delayInMinutes: Math.max(1, period * 60),
    periodInMinutes: Math.max(1, period * 60),
  });
}
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "cmj-library-refresh") refreshStoredLibrary({ force: false }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(async () => {
  await ensureDefaults();
  await applyAdRulesFromStorage();
  await setupContextMenus();
  await scheduleLibraryRefresh();
  if ((await getSettings()).libraryRefresh?.refreshOnStartup !== false)
    refreshStoredLibrary({ force: false }).catch(() => {});
});
chrome.runtime.onStartup?.addListener(async () => {
  await applyAdRulesFromStorage();
  await setupContextMenus();
  await scheduleLibraryRefresh();
  if ((await getSettings()).libraryRefresh?.refreshOnStartup !== false)
    refreshStoredLibrary({ force: false }).catch(() => {});
});
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.settings) {
    TARGET_CACHE.clear();
    await syncAdRules(changes.settings.newValue || {});
    await scheduleLibraryRefresh();
  }
});

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;
  let type =
    info.menuItemId === "cmj-block-video"
      ? "BLOCK_VIDEO"
      : info.menuItemId === "cmj-block-channel"
        ? "BLOCK_CHANNEL"
        : info.menuItemId === "cmj-block-selection"
          ? "BLOCK_TEXT"
          : null;
  if (!type) return;
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type,
      linkUrl: info.linkUrl || "",
      selectionText: info.selectionText || "",
    });
  } catch (_) {}
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "OPEN_OPTIONS") {
        await chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "APPLY_YOUTUBE_PROFILE") {
        const result = await applyYouTubeProfile();
        if (msg.reload && result.changed) {
          const tabId = sender?.tab?.id;
          if (tabId) setTimeout(() => chrome.tabs.reload(tabId).catch(() => {}), 150);
        }
        sendResponse(result);
        return;
      }
      if (msg?.type === "GET_YOUTUBE_URL_DATA") {
        sendResponse(await fetchYouTubeEntity(msg.url));
        return;
      }
      if (msg?.type === "GITHUB_TREE") {
        const owner = String(msg.owner || "").trim();
        const repo = String(msg.repo || "").trim();
        const branch = String(msg.branch || "main").trim() || "main";
        if (!owner || !repo) throw new Error("GitHub owner and repository are required.");
        const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
        const response = await fetch(url, {
          cache: "no-store",
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!response.ok) {
          let detail = "";
          try {
            const body = await response.json();
            detail = body?.message ? ` — ${body.message}` : "";
          } catch (_) {}
          throw new Error(`GitHub tree HTTP ${response.status}${detail}`);
        }
        const data = await response.json();
        sendResponse({ ok: true, tree: Array.isArray(data?.tree) ? data.tree : [] });
        return;
      }
      if (msg?.type === "GITHUB_FILE") {
        const owner = String(msg.owner || "").trim();
        const repo = String(msg.repo || "").trim();
        const branch = String(msg.branch || "main").trim() || "main";
        const path = String(msg.path || "").replace(/^\/+/, "");
        if (!owner || !repo || !path || path.includes("..") || !path.startsWith("database/"))
          throw new Error("Invalid GitHub database file request.");
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodedPath}`;
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) throw new Error(`GitHub file HTTP ${response.status} for ${path}`);
        sendResponse({ ok: true, path, text: await response.text() });
        return;
      }
      if (msg?.type === "GET_TARGET_FEED") {
        sendResponse(await getTargetFeed());
        return;
      }
      if (msg?.type === "NOTIFY") {
        const s = await getSettings();
        if (s.notifications) {
          const tabs = await chrome.tabs
            .query({ url: ["https://www.youtube.com/*"] })
            .catch(() => []);
          await Promise.all(
            tabs.map((tab) =>
              tab?.id
                ? new Promise((resolve) => {
                    chrome.tabs.sendMessage(
                      tab.id,
                      {
                        type: "CMJ_TOAST",
                        message: msg.message || "",
                        toastType: msg.toastType || "success",
                      },
                      () => {
                        void chrome.runtime.lastError;
                        resolve();
                      },
                    );
                  })
                : Promise.resolve(),
            ),
          );
          await incrementStats({ notifications: 1 });
        }
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "READ_DATABASE") {
        const relative = String(msg.path || "").replace(/^\/+/, "");
        if (!relative.startsWith("database/") || relative.includes(".."))
          throw new Error("Invalid database path");
        sendResponse({ ok: true, data: await readJson(relative.slice("database/".length)) });
        return;
      }
      if (msg?.type === "GET_MODE_FEED") {
        const s = await getSettings();
        const active = String(s.activeMode || "general");
        if (active === "general") {
          sendResponse({ ok: true, mode: "general", videos: [] });
          return;
        }
        const geo = modeGeo(s);
        const country = geo.country;
        const ms = s.modeSettings?.[active] || {};
        const langData0 = await readJson("languages/languages.json").catch(() => ({
          languages: [],
        }));
        const language = String(
          (langData0.languages || []).find((x) => langMatches(x, geo.language.toLowerCase()))
            ?.alpha_2 || geo.language,
        ).toLowerCase();
        const queries = [];
        if (active === "tech") {
          const profile = await readJson(`tech/${String(ms.profileId || "devops")}.json`).catch(
            () => null,
          );
          const terms = Object.values(profile?.categories || {})
            .flat()
            .filter(Boolean)
            .slice(0, 24);
          for (const term of terms.slice(0, 8)) queries.push(String(term));
          if (terms.length) queries.push(terms.slice(0, 3).join(" "));
          queries.push(
            `${ms.profileId || "technology"} tutorial`,
            `${ms.profileId || "technology"} guide`,
          );
        } else if (active === "languageLearning") {
          const learn = String(ms.learningLanguage || language).trim();
          const content = Array.isArray(ms.contentLanguages)
            ? ms.contentLanguages.filter(Boolean).slice(0, 3)
            : [];
          const langData = await readJson("languages/languages.json").catch(() => ({
            languages: [],
          }));
          const rec = (langData.languages || []).find((x) => langMatches(x, learn.toLowerCase()));
          const langName = rec?.name || learn;
          const signals = await readJson(
            `languages/signals/${String(rec?.alpha_2 || learn).toLowerCase()}.json`,
          ).catch(() => ({ strong: [], common: [] }));
          for (const term of [...(signals.strong || []), ...(signals.common || [])].slice(0, 8))
            queries.push(`${langName} ${term}`);
          queries.push(
            `${langName} lessons`,
            `${langName} listening`,
            `${langName} conversation`,
            `${langName} native content`,
          );
          content.forEach((code) => queries.push(`${langName} ${code}`));
        } else if (active === "niches") {
          const profile = await readJson(
            `niches/${String(ms.profileId || "technology")}.json`,
          ).catch(() => null);
          const terms = Object.values(profile?.categories || {})
            .flat()
            .filter(Boolean)
            .map(String)
            .slice(0, 40);
          const suffix = language && language !== "en" ? ` ${language}` : "";
          for (const term of terms.slice(0, 10)) queries.push(`${term}${suffix}`);
          if (terms.length) queries.push(terms.slice(0, 3).join(" ") + suffix);
          queries.push(
            `${profile?.name || ms.profileId || "niche"} videos${suffix}`,
            `${profile?.name || ms.profileId || "niche"} guide${suffix}`,
          );
        }
        const unique = [...new Set(queries.map((q) => String(q).trim()).filter(Boolean))].slice(
          0,
          10,
        );
        if (msg?.onlyQueries) {
          sendResponse({ ok: true, mode: active, queries: unique });
          return;
        }
        const results = [];
        const seen = new Set();
        const errors = [];
        for (const q of unique) {
          try {
            const items = await searchYouTubeResilient(q, country, language);
            for (const item of items) {
              if (!seen.has(item.videoId)) {
                seen.add(item.videoId);
                results.push({ ...item, mode: active, modeQuery: q });
              }
              if (results.length >= 24) break;
            }
          } catch (e) {
            errors.push(`${q}: ${e.message}`);
          }
          if (results.length >= 24) break;
        }
        sendResponse({
          ok: true,
          mode: active,
          queries: unique,
          videos: results.slice(0, 24),
          errors,
        });
        return;
      }
      if (msg?.type === "REFRESH_YOUTUBE_LIBRARY") {
        sendResponse(
          await refreshStoredLibrary({
            force: msg.force === true,
            maxItems: msg.maxItems,
            staleAfterHours: msg.staleAfterHours,
          }),
        );
        return;
      }
      if (msg?.type === "GET_FOLLOWED_CHANNEL_FEED") {
        const s = await getSettings();
        const channels = Array.isArray(s.youtubeLibrary?.channels)
          ? s.youtubeLibrary.channels.filter(
              (c) => c?.followFeed !== false && (c?.followed || c?.trusted || c?.followFeed),
            )
          : [];
        const maxItems = Math.max(1, Math.min(30, Number(s.followedChannelFeed?.maxItems || 12)));
        const results = [];
        const seen = new Set();
        for (const ch of channels.slice(0, 10)) {
          const q = ch.handle || ch.title || ch.name || ch.id;
          if (!q) continue;
          try {
            const items = await searchYouTubeResilient(
              q,
              String(s.country || "").toUpperCase(),
              String(s.targetLanguage || s.language || "en").toLowerCase(),
            );
            for (const item of items) {
              if (!seen.has(item.videoId)) {
                seen.add(item.videoId);
                results.push({ ...item, followedChannel: ch.title || ch.name || q });
              }
              if (results.length >= maxItems) break;
            }
          } catch (_) {}
          if (results.length >= maxItems) break;
        }
        sendResponse({ ok: true, videos: results.slice(0, maxItems) });
        return;
      }
      if (msg?.type === "LOAD_FILTER_DATA") {
        const countryCode = String(msg.countryCode || "US").toLowerCase();
        const [countries, country] = await Promise.all([
          readJson("countries/countries.json"),
          readJson(`countries/${countryCode}.json`).catch(() => null),
        ]);
        sendResponse({ ok: true, countries, country });
        return;
      }
      if (msg?.type === "LOAD_LANGUAGE") {
        const language = String(msg.language || "").toLowerCase();
        const data = await readJson("languages/languages.json");
        const record = (data.languages || []).find((item) => langMatches(item, language));
        const signals = await readJson(
          `languages/signals/${String(record?.alpha_2 || language).toLowerCase()}.json`,
        ).catch(() => null);
        sendResponse({
          ok: true,
          language: record || null,
          signals: signals || { strong: [], common: [] },
        });
        return;
      }
      if (msg?.type === "INTELLIGENCE_DECISION") {
        const a = msg.action || "show";
        await incrementStats({
          intelligenceDecisions: 1,
          ...(a === "hide"
            ? { videosHidden: 1, distractionBlocked: Number(msg.distraction || 0) >= 60 ? 1 : 0 }
            : a === "deprioritize"
              ? {
                  videosDeprioritized: 1,
                  distractionDeprioritized: Number(msg.distraction || 0) >= 60 ? 1 : 0,
                }
              : { videosShown: 1 }),
        });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "SCREEN_TIME_HEARTBEAT") {
        const seconds = Math.max(1, Math.min(300, Number(msg.seconds || 30)));
        const key = new Date().toISOString().slice(0, 10);
        const data = (await chrome.storage.local.get("screenTime")).screenTime || {};
        data[key] = data[key] || {
          date: key,
          youtubeSeconds: 0,
          techSeconds: 0,
          languageSeconds: 0,
          productivitySeconds: 0,
          entertainmentSeconds: 0,
        };
        data[key].youtubeSeconds += seconds;
        const modes = Array.isArray(msg.modes) ? msg.modes : [];
        for (const mode of modes) {
          const k = mode === "languageLearning" ? "language" : mode;
          const field = k + "Seconds";
          if (field in data[key]) data[key][field] += seconds;
        }
        await chrome.storage.local.set({ screenTime: data });
        await incrementStats({ screenTimeSeconds: seconds });
        sendResponse({ ok: true, data: data[key] });
        return;
      }
      if (msg?.type === "AD_BLOCK_STATS") {
        const stats = msg.stats || {};
        const current = (await chrome.storage.local.get("adStats")).adStats || {
          skipped: 0,
          hidden: 0,
          lastEvent: null,
        };
        current.skipped += Number(stats.skipped || 0);
        current.hidden += Number(stats.hidden || 0);
        current.lastEvent = new Date().toISOString();
        await chrome.storage.local.set({ adStats: current });
        const total = current.skipped + current.hidden;
        await chrome.action.setBadgeText({
          text: total ? (total > 999 ? "999+" : String(total)) : "",
        });
        sendResponse({ ok: true, adStats: current });
        return;
      }
      if (msg?.type === "AD_RULES_STATUS") {
        const enabled = msg.enabled !== false;
        const current = (await chrome.storage.local.get("settings")).settings || {};
        current.adBlockEnabled = enabled;
        await chrome.storage.local.set({ settings: current });
        await syncAdRules(current);
        sendResponse({ ok: true, enabled });
        return;
      }
      sendResponse({ ok: false, error: "Unknown message type" });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
  })();
  return true;
});
