/**
 * YouTube content script (isolated world).
 *
 * Runs on every youtube.com page. Responsibilities:
 *  - classify and hide/deprioritise video cards (country, language, blacklist, intelligence);
 *  - the Target Feed engine used by General, Tech, Language Learning and Niches modes
 *    (query building, language/country gating, ranking, infinite scroll, diagnostics);
 *  - ad handling, interface controls, screen-time monitor and followed-channel feed;
 *  - talks to the MAIN-world bridge (youtube-main.js) through window.postMessage.
 */

(() => {
  if (globalThis.__CMJ_YOUTUBE_BOOTED__) return;
  globalThis.__CMJ_YOUTUBE_BOOTED__ = true;

  const CMJ = {
    settings: {},
    countries: [],
    country: null,
    language: null,
    observer: null,
    routeTimer: null,
    lastUrl: location.href,
    languageSignals: { strong: [], common: [] },
    targetFeedReady: false,
    targetFeedLoading: false,
    targetFeedData: null,
    mainPageData: null,
    mainPlayerResponse: null,
    mainConfig: null,
    targetRequestWaiters: new Map(),
    followedFeedMounted: false,
    followedFeedLoading: false,
    modeFeedMounted: false,
    modeFeedLoading: false,
  };

  let cmjScreenTimer = null;
  /** Count watch time while a video is playing and report it to the service worker. */
  function startScreenTimeMonitor() {
    clearInterval(cmjScreenTimer);
    if (CMJ.settings.screenTimeEnabled === false) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const video = document.querySelector("video");
      if (!video || video.paused) return;
      const modes = Array.isArray(CMJ.settings.enabledModes) ? CMJ.settings.enabledModes : [];
      safeRuntimeMessage({
        type: "SCREEN_TIME_HEARTBEAT",
        seconds: Number(CMJ.settings.screenTimeHeartbeatSeconds) || 30,
        modes,
      });
    };
    cmjScreenTimer = setInterval(
      tick,
      Math.max(15, Number(CMJ.settings.screenTimeHeartbeatSeconds) || 30) * 1000,
    );
  }

  const CARD_SELECTOR =
    "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer";
  const $all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const textOf = (el) => (el?.innerText || el?.textContent || "").trim();
  const norm = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "");

  const safeRuntimeMessage = (message) => {
    try {
      if (!globalThis.chrome?.runtime?.id) return Promise.resolve(null);
      const request = chrome.runtime.sendMessage(message);
      return request && typeof request.catch === "function"
        ? request.catch(() => null)
        : Promise.resolve(request);
    } catch (_) {
      return Promise.resolve(null);
    }
  };
  const notify = (message) =>
    safeRuntimeMessage({ type: "NOTIFY", title: "Charlie MJ YouTube", message });
  const safeStorageGet = (keys) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          void chrome.runtime.lastError;
          resolve(result || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  const safeStorageSet = (items) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.set(items, () => {
          void chrome.runtime.lastError;
          resolve(true);
        });
      } catch (_) {
        resolve(false);
      }
    });

  /** Load settings, the country database and the target language into the CMJ state. */
  async function loadData() {
    const stored = await safeStorageGet("settings");
    const { settings = {} } = stored;
    CMJ.settings = settings;
    const geo = modeGeo(settings);
    const result = await safeRuntimeMessage({
      type: "LOAD_FILTER_DATA",
      countryCode: geo.country || settings.country || "US",
    });
    if (!result?.ok) throw new Error(result?.error || "Could not load extension database");
    CMJ.countries = result.countries?.countries || [];
    CMJ.country = result.country || null;
    const lang = await safeRuntimeMessage({
      type: "LOAD_LANGUAGE",
      language: geo.language || settings.targetLanguage || settings.language || "en",
    });
    CMJ.language = lang?.language || null;
    CMJ.languageSignals = lang?.signals || { strong: [], common: [] };
    startScreenTimeMonitor();
  }

  // Country + language that the ACTIVE MODE asks for (Tech / Language Learning).
  // General mode returns empty values so the global Target Country & Language settings apply.
  function modeGeo(settings) {
    const s = settings || CMJ.settings || {};
    const m = String(s.activeMode || "general");
    const ms = s.modeSettings || {};
    const first = (a) =>
      (Array.isArray(a) ? a : []).map((x) => String(x || "").trim()).find(Boolean) || "";
    const cc = (c) => {
      const v = String(c || "").toUpperCase();
      return /^[A-Z]{2}$/.test(v) ? v : "";
    };
    if (m === "tech")
      return {
        country: cc(ms.tech?.country),
        language:
          String(ms.tech?.targetLanguage || first(ms.tech?.contentLanguages) || "en").trim() ||
          "en",
      };
    if (m === "languageLearning") {
      const l = ms.languageLearning || {};
      return {
        country: cc(l.country),
        language: String(l.learningLanguage || "").trim() || first(l.contentLanguages),
      };
    }
    if (m === "niches")
      return {
        country: cc(ms.niches?.country),
        language:
          String(ms.niches?.targetLanguage || first(ms.niches?.contentLanguages) || "en").trim() ||
          "en",
      };
    return { country: "", language: "" };
  }

  /** True on the Home or Subscriptions feed. */
  function routeIsHome() {
    const p = location.pathname;
    return p === "/" || p === "/feed/subscriptions";
  }
  // The Target Feed lives on the real Home page only (not Subscriptions, search or watch pages).
  function routeIsTargetHome() {
    return location.pathname === "/";
  }
  // General, Tech and Language Learning all use the Target Feed engine; Productivity/Custom keep the legacy ranked feed.
  function modeKind() {
    const m = String(CMJ.settings.activeMode || "general");
    return m === "tech" || m === "languageLearning" || m === "niches" ? m : "general";
  }
  /** True for modes that still use the legacy ranked feed (Productivity, Custom). */
  function activeModeUsesDedicatedFeed() {
    const m = String(CMJ.settings.activeMode || "general");
    return routeIsTargetHome() && m !== "general" && modeKind() === "general";
  }
  // The Target Feed is always on for Tech / Language Learning; General follows the targetFeedEnabled setting.
  function targetFeedWanted() {
    return modeKind() !== "general" || !!CMJ.settings.targetFeedEnabled;
  }
  const validGl = (c) => {
    const v = String(c || "").toUpperCase();
    return /^[A-Z]{2}$/.test(v) ? v : "";
  };
  /** Settings object of the active mode. */
  function modeCfg() {
    return CMJ.settings.modeSettings?.[modeKind()] || {};
  }
  // Country used for searching: only a real 2-letter code ("GLOBAL" means "no country").
  function effectiveCountry() {
    return validGl(modeKind() === "general" ? CMJ.settings.country : modeCfg().country);
  }
  // Hide YouTube's own Home grid whenever our feed replaces it (General with Target Feed, Tech, Language Learning).
  function syncHomeHiding() {
    const on = routeIsTargetHome() && targetFeedWanted() && CMJ.settings.extensionEnabled !== false;
    if (on) document.documentElement.setAttribute("data-cmj-hide-home", "1");
    else document.documentElement.removeAttribute("data-cmj-hide-home");
  }
  /** True on pages the extension processes (home, shorts, trending, results, watch). */
  function routeIsSupported() {
    const p = location.pathname;
    return (
      routeIsHome() ||
      p === "/shorts" ||
      p === "/feed/trending" ||
      p === "/results" ||
      p === "/watch"
    );
  }

  /** Extract channel name, link and id from a video card. */
  function channelInfo(card) {
    const a = card.querySelector(
      "ytd-channel-name a, #channel-name a, a.yt-simple-endpoint[href*='/@'], a.yt-simple-endpoint[href*='/channel/']",
    );
    const href = a?.href || "";
    const match = href.match(/\/channel\/(UC[\w-]+)/i);
    return {
      name: textOf(a) || textOf(card.querySelector("ytd-channel-name,#channel-name")),
      href,
      id: match?.[1] || "",
    };
  }

  /** Extract video id and link from a video card. */
  function videoInfo(card) {
    const a = card.querySelector(
      "a#thumbnail, a#video-title, a[href*='/watch?v='], a[href*='/shorts/']",
    );
    const href = a?.href || "";
    let id = "";
    try {
      id =
        new URL(href, location.origin).searchParams.get("v") ||
        href.match(/\/shorts\/([^/?#]+)/)?.[1] ||
        "";
    } catch (_) {}
    return { id, href };
  }

  /** True when the card is a YouTube Short. */
  function isShort(card) {
    return !!card.querySelector(
      "a[href^='/shorts/'], ytd-thumbnail-overlay-time-status-renderer[overlay-style='SHORTS']",
    );
  }

  /** Lower-cased searchable text of a card (title, channel, metadata). */
  function cardText(card) {
    return norm(
      [
        textOf(card.querySelector("#video-title, a#video-title, h3")),
        channelInfo(card).name,
        textOf(card.querySelector("#metadata-line")),
        textOf(card.querySelector("#description, yt-formatted-string")),
        textOf(card.querySelector("#byline-container")),
      ].join(" "),
    );
  }

  /** Search terms that identify the selected country (names, cities, regions). */
  function termsForCountry() {
    const c = CMJ.country;
    const terms = [];
    if (c) {
      terms.push(c.name, c.code, c.alpha3, c.capital, ...(c.keywords || []));
      for (const item of c.regions || []) terms.push(item.name, item.code);
      for (const item of c.cities || []) terms.push(item.name);
    }
    for (const item of CMJ.settings.countryKeywords || []) terms.push(item);
    return terms.filter(Boolean).map(norm);
  }

  /** Search terms that identify the selected language. */
  function termsForLanguage() {
    const l = CMJ.language;
    if (!l) return [];
    return [
      l.name,
      l.alpha_2,
      l.alpha_3,
      l.terminology,
      l.bibliographic,
      ...(CMJ.settings.targetLanguageKeywords || []),
      ...(CMJ.languageSignals?.strong || []),
      ...(CMJ.languageSignals?.common || []),
    ]
      .filter(Boolean)
      .map(norm);
  }

  /** Whole-word match of a term inside text. */
  function signalHit(text, term) {
    const t = norm(text);
    const q = norm(term);
    if (!q) return false;
    if (q.includes(" ")) return t.includes(q);
    if (q.length <= 2) return ` ${t.replace(/[^\p{L}\p{N}]+/gu, " ")} `.includes(` ${q} `);
    return ` ${t.replace(/[^\p{L}\p{N}]+/gu, " ")} `.includes(` ${q} `);
  }

  /** Safely test a user-defined regular-expression rule against text. */
  function regexMatch(rule, text) {
    const raw = String(rule || "").trim();
    if (!raw) return false;
    if (raw.startsWith("/") && raw.lastIndexOf("/") > 0) {
      const end = raw.lastIndexOf("/");
      try {
        return new RegExp(raw.slice(1, end), raw.slice(end + 1).replace(/g/g, "")).test(text);
      } catch (_) {
        return false;
      }
    }
    return text.includes(norm(raw));
  }

  /** Video length of a card in seconds. */
  function durationSeconds(card) {
    const raw = textOf(
      card.querySelector(
        "ytd-thumbnail-overlay-time-status-renderer, #time-status, .ytp-time-duration",
      ),
    );
    if (!raw) return 0;
    const parts = raw.split(":").map(Number);
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }

  /** True when the card shows a watched-progress bar. */
  function looksWatched(card) {
    return (
      !!card.querySelector(
        "ytd-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-now-playing-renderer",
      ) || card.classList.contains("watched")
    );
  }

  /** Decide show/hide/deprioritise for a card from blacklist, country, language and intelligence rules. */
  function classify(card) {
    const text = cardText(card);
    const title = norm(textOf(card.querySelector("#video-title, a#video-title, h3")));
    const channel = channelInfo(card);
    const video = videoInfo(card);
    const nChannel = norm(channel.name);
    const duration = durationSeconds(card);
    if (CMJ.settings.hideWatched && looksWatched(card))
      return { action: "hide", reason: "watched video", confidence: "high" };
    if (
      CMJ.settings.minDurationSeconds &&
      duration &&
      duration < Number(CMJ.settings.minDurationSeconds)
    )
      return { action: "hide", reason: "below minimum duration", confidence: "high" };
    if (
      CMJ.settings.maxDurationSeconds &&
      duration &&
      duration > Number(CMJ.settings.maxDurationSeconds)
    )
      return { action: "hide", reason: "above maximum duration", confidence: "high" };
    if (CMJ.settings.filterAllCaps) {
      const letters = title.replace(/[^a-zA-Z]/g, "");
      if (letters.length >= 8 && letters === letters.toUpperCase())
        return { action: "hide", reason: "ALL-CAPS title", confidence: "medium" };
    }
    const blackChannels = [
      ...(CMJ.settings.blacklistChannels || []),
      ...(CMJ.settings.blacklistChannelIds || []),
    ].map(norm);
    const whiteChannels = [
      ...(CMJ.settings.whitelistChannels || []),
      ...(CMJ.settings.whitelistChannelIds || []),
    ].map(norm);
    const blackVideoIds = (CMJ.settings.blacklistVideoIds || []).map(norm);
    const whiteVideoIds = (CMJ.settings.whitelistVideoIds || []).map(norm);

    if (blackVideoIds.includes(norm(video.id)))
      return { action: "hide", reason: "blocked video ID", confidence: "high" };
    if (whiteVideoIds.includes(norm(video.id)))
      return { action: "show", reason: "approved video ID", confidence: "high" };
    if (
      blackChannels.some(
        (x) => x && (nChannel === x || nChannel.includes(x) || norm(channel.id) === x),
      )
    )
      return { action: "hide", reason: "blocked channel", confidence: "high" };
    if (
      whiteChannels.some(
        (x) => x && (nChannel === x || nChannel.includes(x) || norm(channel.id) === x),
      )
    )
      return { action: "show", reason: "approved channel", confidence: "high" };

    const blocked = (CMJ.settings.blacklist || []).map(norm).filter(Boolean);
    const allowed = (CMJ.settings.whitelist || []).map(norm).filter(Boolean);
    const regexRules = CMJ.settings.regexBlockRules || [];
    if (blocked.some((x) => text.includes(x)) || regexRules.some((rule) => regexMatch(rule, text)))
      return { action: "hide", reason: "blocked keyword / regex", confidence: "high" };
    if (allowed.some((x) => text.includes(x)))
      return { action: "show", reason: "approved keyword", confidence: "high" };

    if (CMJ.settings.hideShorts && isShort(card))
      return { action: "hide", reason: "Shorts disabled", confidence: "high" };

    const intelligence = globalThis.__CMJ_INTELLIGENCE__?.classify?.(card, CMJ.settings);
    if (intelligence) {
      card.dataset.cmjIntelligence = JSON.stringify(intelligence);
      if (intelligence.action === "hide")
        return {
          action: "hide",
          reason: `Intelligence: ${intelligence.reasons.join("; ")}`,
          confidence: "high",
          intelligence,
        };
      if (intelligence.action === "deprioritize") {
        card.dataset.cmjDeprioritized = "1";
        return {
          action: "show",
          reason: `Deprioritized: ${intelligence.reasons.join("; ")}`,
          confidence: "medium",
          intelligence,
          deprioritized: true,
        };
      }
      return {
        action: "show",
        reason: `Intelligence: ${intelligence.reasons.join("; ")}`,
        confidence: "high",
        intelligence,
      };
    }

    if (!CMJ.settings.targetFeedEnabled || !routeIsTargetHome()) {
      const countryTerms = termsForCountry();
      const languageTerms = termsForLanguage();
      const countryHits = [...new Set(countryTerms.filter((x) => x && text.includes(x)))];
      const languageHits = [...new Set(languageTerms.filter((x) => x && text.includes(x)))];
      const hits = [...new Set([...countryHits, ...languageHits])];
      if (hits.length >= 2)
        return {
          action: "show",
          reason: `target signals: ${hits.slice(0, 4).join(", ")}`,
          confidence: "high",
        };
      return { action: "show", reason: "target feed disabled", confidence: "neutral" };
    }

    const countryTerms = termsForCountry();
    const languageTerms = termsForLanguage();
    const countryHits = [...new Set(countryTerms.filter((x) => x && text.includes(x)))];
    const languageHits = [...new Set(languageTerms.filter((x) => x && text.includes(x)))];
    const strongLang = [
      ...new Set(
        (CMJ.languageSignals?.strong || []).map(norm).filter((x) => x && text.includes(x)),
      ),
    ];
    const commonLang = [
      ...new Set(
        (CMJ.languageSignals?.common || []).map(norm).filter((x) => x && text.includes(x)),
      ),
    ];
    let score = countryHits.length * 2 + strongLang.length * 3 + Math.min(commonLang.length, 5);
    const requireLanguage = CMJ.settings.targetRequireLanguage !== false;
    const countryMatch = countryHits.length > 0;
    const languageMatch =
      languageHits.length > 0 || strongLang.length > 0 || commonLang.length >= 2;
    if (countryMatch && languageMatch) score += 4;

    if (requireLanguage) {
      if (countryMatch && languageMatch)
        return {
          action: "show",
          reason: `target country + language: ${[...countryHits, ...strongLang, ...commonLang].slice(0, 5).join(", ")}`,
          confidence: "high",
        };
      if (strongLang.length || commonLang.length >= 2)
        return {
          action: "show",
          reason: "target-language signal; country not explicitly named",
          confidence: "medium",
        };
    } else if (countryMatch || languageMatch) {
      return {
        action: "show",
        reason: "target country/language signal",
        confidence: countryMatch && languageMatch ? "high" : "medium",
      };
    }

    const mode = CMJ.settings.targetFeedMode || CMJ.settings.geoMode || "strict";
    if (mode === "strict")
      return { action: "hide", reason: "not classified as target content", confidence: "low" };
    return {
      action: "show",
      reason: `uncertain content kept in ${mode} mode`,
      confidence: "unknown",
    };
  }

  /** Add the hover 'block' button to a card. */
  function addQuickBlockButton(card) {
    if (!CMJ.settings.quickBlockEnabled || card.dataset.cmjQuickBlock === "1") return;
    const info = videoInfo(card);
    if (!info.id) return;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "×";
    button.title = "Charlie MJ: block this video";
    button.className = "cmj-quick-block";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      addRule("video", info.id);
    });
    card.style.position = card.style.position || "relative";
    card.appendChild(button);
    card.dataset.cmjQuickBlock = "1";
  }

  /** Classify a card once and apply the result to the DOM. */
  function applyCard(card) {
    if (!card) return false;
    addQuickBlockButton(card);
    card.dataset.cmjProcessed = "1";
    const result = classify(card);
    const hidden = result.action === "hide";
    card.style.display = hidden ? "none" : "";
    card.dataset.cmjHidden = hidden ? result.reason : "";
    card.dataset.cmjReason = result.reason;
    card.dataset.cmjConfidence = result.confidence;
    if (result.intelligence) {
      card.dataset.cmjRelevance = String(result.intelligence.relevance ?? "");
      card.dataset.cmjDistraction = String(result.intelligence.distraction ?? "");
      card.title = `Charlie MJ — ${result.action === "hide" ? "Hidden" : result.deprioritized ? "Deprioritized" : "Shown"} | Relevance: ${result.intelligence.relevance} | Distraction: ${result.intelligence.distraction} | ${result.reason}`;
      if (result.deprioritized) card.style.opacity = "0.72";
      safeRuntimeMessage({
        type: "INTELLIGENCE_DECISION",
        action: hidden ? "hide" : result.deprioritized ? "deprioritize" : "show",
        relevance: result.intelligence.relevance,
        distraction: result.intelligence.distraction,
      });
    }
    return hidden;
  }

  let adState = { skipped: 0, hidden: 0, lastAd: false, savedRate: 1, savedMuted: false };
  let adReportPending = { skipped: 0, hidden: 0 };
  let adReportTimer = null;

  /** True when any ad handling option is enabled. */
  function adEnabled() {
    return CMJ.settings.extensionEnabled !== false && CMJ.settings.adBlockEnabled !== false;
  }

  /** Send ad-handling counters to the service worker. */
  function reportAdStats() {
    if (!adReportPending.skipped && !adReportPending.hidden) return;
    const payload = { ...adReportPending };
    adReportPending = { skipped: 0, hidden: 0 };
    clearTimeout(adReportTimer);
    adReportTimer = setTimeout(
      () => safeRuntimeMessage({ type: "AD_BLOCK_STATS", stats: payload }),
      50,
    );
  }

  /** Hide ad surfaces (banners, promoted cards, masthead ads). */
  function hideYouTubeAdElements() {
    if (!adEnabled() || CMJ.settings.adBlockCosmetic === false) return 0;
    const selectors = [
      "ytd-ad-slot-renderer",
      "ytd-in-feed-ad-layout-renderer",
      "ytd-display-ad-renderer",
      "ytd-promoted-sparkles-web-renderer",
      "ytd-search-pyv-renderer",
      "ytd-action-companion-ad-renderer",
      "ytd-banner-promo-renderer",
      "#player-ads",
      ".ytp-ad-overlay-container",
      ".ytp-ad-message-container",
      ".ytp-ad-image-overlay",
      ".ytp-ad-overlay-slot",
      ".ytp-ad-text-overlay",
      ".ytp-ad-player-overlay",
      "ytd-companion-slot-renderer",
    ];
    let hidden = 0;
    $all(selectors.join(",")).forEach((el) => {
      if (el.dataset.cmjAdHidden !== "1") {
        el.dataset.cmjAdHidden = "1";
        el.style.display = "none";
        hidden++;
      }
    });
    if (hidden) {
      adState.hidden += hidden;
      adReportPending.hidden += hidden;
    }
    return hidden;
  }

  /** Skip or speed through in-video ads. */
  function handleVideoAd() {
    if (!adEnabled() || CMJ.settings.adBlockVideo === false) return false;
    const player = document.querySelector("#movie_player, ytd-player");
    const video = document.querySelector("video.html5-main-video, video");
    const showing =
      !!player?.classList.contains("ad-showing") || !!document.querySelector(".ad-showing");
    if (!showing || !video) {
      if (adState.lastAd) {
        adState.lastFastForward = false;
        video?.pause?.();
        video?.play?.().catch?.(() => {});
        video?.playbackRate && (video.playbackRate = adState.savedRate || 1);
        if (typeof adState.savedMuted === "boolean") video.muted = adState.savedMuted;
        adState.lastAd = false;
      }
      return false;
    }

    if (!adState.lastAd) {
      adState.savedRate = video.playbackRate || 1;
      adState.savedMuted = video.muted;
      adState.lastAd = true;
    }

    const skip = document.querySelector(
      ".ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button-modern",
    );
    if (CMJ.settings.adBlockSkip !== false && skip) {
      skip.click();
      adState.skipped++;
      adReportPending.skipped++;
      reportAdStats();
      return true;
    }

    if (CMJ.settings.adBlockMode === "aggressive" || CMJ.settings.adBlockSkip !== false) {
      try {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = video.duration;
          video.playbackRate = 16;
          video.muted = true;
          video.play().catch(() => {});
          if (!adState.lastFastForward) {
            adState.lastFastForward = true;
            adState.skipped++;
            adReportPending.skipped++;
          }
        }
      } catch (_) {}
    }
    reportAdStats();
    return true;
  }

  /** Run all ad handling for the current page. */
  function handleAds() {
    document.documentElement.toggleAttribute("data-cmj-adblock", adEnabled());
    if (!adEnabled()) return;
    handleVideoAd();
    hideYouTubeAdElements();
    reportAdStats();
  }

  /** Escape text for safe insertion into HTML. */
  function escapeHtml(value) {
    return String(value || "").replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
    );
  }

  // ---------------------------------------------------------------------------
  // Target Feed engine
  // ---------------------------------------------------------------------------
  const TARGET_CACHE_MS = 10 * 60 * 1000;
  const TARGET_RETRY_BACKOFF_MS = 45 * 1000;
  const TARGET_MAX_AUTO_ATTEMPTS = 3;
  const TARGET_LANG_QUERY_KINDS = [
    "country-language",
    "language-country",
    "language",
    "language-signal",
  ];

  /** Cache key that changes whenever the feed inputs (mode, profile, country, language) change. */
  function targetKey() {
    const s = CMJ.settings;
    return [
      modeKind(),
      JSON.stringify(modeKind() === "general" ? "" : modeCfg()),
      s.country || "",
      s.targetLanguage || s.language || "",
      s.targetFeedMode || "strict",
    ].join("|");
  }

  /** Store the Target Feed state (loading/ready/empty) and repaint it. */
  function setTargetView(status, data) {
    CMJ.targetView = { status, data: data || null, version: (CMJ.targetView?.version || 0) + 1 };
    CMJ.targetFeedReady = status === "ready";
    if (status === "ready" && (CMJ.settings.targetFeedMode || "strict") === "strict")
      document.documentElement.setAttribute("data-cmj-target-strict", "1");
    else document.documentElement.removeAttribute("data-cmj-target-strict");
    if (status === "ready") document.documentElement.setAttribute("data-cmj-target-feed", "ready");
    else document.documentElement.removeAttribute("data-cmj-target-feed");
    mountTargetFeed(true);
  }

  /** Remove the Target Feed box and reset its state. */
  function clearTargetFeed() {
    document.getElementById("cmj-target-feed")?.remove();
    document.documentElement.removeAttribute("data-cmj-target-feed");
    document.documentElement.removeAttribute("data-cmj-target-strict");
    CMJ.targetFeedReady = false;
    CMJ.targetView = null;
  }

  /** Display name of the active mode (shown as the 'Mode:' subtitle). */
  function activeModeLabel() {
    const mode = String(CMJ.settings.activeMode || "general");
    return mode === "languageLearning"
      ? "Language Learning"
      : mode === "tech"
        ? "Tech"
        : mode === "niches"
          ? "Niches"
          : mode === "productivity"
            ? "Productivity"
            : mode === "custom"
              ? "Custom"
              : "General";
  }

  /** Headline text under the Target Feed title (country · language, or profile for Tech/Niches). */
  function targetHeadline() {
    const d = CMJ.targetView?.data;
    const kind = modeKind();
    const place = effectiveCountry() ? CMJ.modeCountryName || effectiveCountry() : "Global";
    if (kind === "tech")
      return `${CMJ.techProfile?.data?.name || CMJ.techProfile?.id || "Tech"} · ${(CMJ.modeLangs || []).map((l) => l.name).join(", ") || "English"} · ${place}`;
    if (kind === "languageLearning")
      return `Learning ${CMJ.modeLangs?.[0]?.name || "a language"} · ${place}`;
    const c = validGl(CMJ.settings.country)
      ? d?.country || CMJ.country?.name || CMJ.settings.country
      : "Global";
    return `${c} · ${d?.language || CMJ.language?.name || "Language"}`;
  }

  /** HTML of the collapsible 'Search details' diagnostics block. */
  function diagnosticsHtml(d) {
    if (!d) return "";
    const rows = (d.diagnostics || [])
      .map((q) => {
        const status = q.error
          ? `✗ ${escapeHtml(q.error)}`
          : `✓ ${Number(q.count || 0)} videos (${escapeHtml(q.strategy || "")})`;
        return `<li><b>${escapeHtml(q.query)}</b> — ${status}</li>`;
      })
      .join("");
    const bg = d.backgroundFallback
      ? `<li><b>Background fallback</b> — ${Number(d.backgroundFallback.count || 0)} videos${d.backgroundFallback.errors?.length ? " · " + escapeHtml(d.backgroundFallback.errors.slice(0, 3).join(" | ")) : ""}</li>`
      : "";
    const stats = `Scanned ${Number(d.scanned || 0)} · Shown ${Number(d.videos?.length || 0)} · Wrong language ${Number(d.rejectedLanguage || 0)}`;
    return `<details class="cmj-target-diag"><summary>Search details · ${escapeHtml(stats)}</summary><ul>${rows}${bg}</ul></details>`;
  }

  /** HTML of one Target Feed video card. */
  function cardHtml(v) {
    const t = v.target || {};
    const why =
      [
        t.modeHits?.length ? `Matches: ${t.modeHits.slice(0, 4).join(", ")}` : "",
        t.countryHits?.length ? `Country: ${t.countryHits.slice(0, 3).join(", ")}` : "",
        t.languageVerdict?.match === true ? `Language: ${t.languageVerdict.reason}` : "",
      ]
        .filter(Boolean)
        .join(" · ") || `Result of the localized "${v.searchQuery || "target"}" search`;
    const href = `/watch?v=${encodeURIComponent(v.videoId)}`;
    return `<article class="cmj-target-card" data-vid="${escapeHtml(v.videoId)}" title="${escapeHtml(why)}"><a href="${href}" class="cmj-target-thumb"><img loading="lazy" src="${escapeHtml(v.thumbnail)}" alt="">${v.duration ? `<span>${escapeHtml(v.duration)}</span>` : ""}</a><a href="${href}" class="cmj-target-title">${escapeHtml(v.title)}</a><div class="cmj-target-channel">${escapeHtml(v.channel)}</div><div class="cmj-target-meta">${escapeHtml(v.views)} ${escapeHtml(v.published)}</div></article>`;
  }

  /** Observe the bottom sentinel so more results load while scrolling. */
  function observeSentinel(host) {
    CMJ.sentinelObserver?.disconnect();
    const el = host.querySelector("[data-cmj-sentinel]");
    if (!el) return;
    CMJ.sentinelObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreTarget();
      },
      { rootMargin: "1500px 0px" },
    );
    CMJ.sentinelObserver.observe(el);
  }

  // Infinite scroll: fetch the next result page of every active query, re-classify, append new cards.
  async function loadMoreTarget() {
    const more = CMJ.targetMore;
    if (!more || more.loading || !CMJ.targetFeedReady) return;
    more.loading = true;
    try {
      let added = 0;
      // Keep going until a useful number of new cards is found (many results get filtered out).
      for (let pass = 0; pass < 6 && added < 8; pass++) {
        const host = document.getElementById("cmj-target-feed");
        if (!host) return;
        let active = more.pages.filter((p) => !p.done && p.token);
        if (!active.length && more.pendingSpecs.length) {
          // Out of result pages: start the next native-language searches.
          const specs = more.pendingSpecs.splice(0, 4);
          await runPool(specs, 4, async (spec) => {
            try {
              const r = await waitForTargetSearch(spec.query, more.hl);
              (r?.videos || []).forEach((item, index) =>
                more.rawVideos.push({
                  ...item,
                  searchQuery: spec.query,
                  searchKind: spec.kind,
                  searchRank: index,
                }),
              );
              if (r?.token)
                more.pages.push({
                  query: spec.query,
                  kind: spec.kind,
                  token: r.token,
                  done: false,
                });
            } catch (_) {}
          });
        } else {
          await runPool(active.slice(0, 4), 4, async (page) => {
            try {
              const r = await waitForTargetContinue(page.token, more.hl);
              const videos = Array.isArray(r?.videos) ? r.videos : [];
              videos.forEach((item, index) =>
                more.rawVideos.push({
                  ...item,
                  searchQuery: page.query,
                  searchKind: page.kind,
                  searchRank: index,
                }),
              );
              page.token = r?.token || "";
              if (!page.token || !videos.length) page.done = true;
            } catch (_) {
              page.failures = (page.failures || 0) + 1;
              if (page.failures >= 2) page.done = true;
            }
          });
        }
        const result = classifyTargetResults(more.rawVideos);
        const shown = new Set(
          [...host.querySelectorAll(".cmj-target-card")].map((c) => c.dataset.vid),
        );
        const fresh = result.accepted.filter((v) => !shown.has(v.videoId));
        if (fresh.length)
          host
            .querySelector(".cmj-target-grid")
            ?.insertAdjacentHTML("beforeend", fresh.map(cardHtml).join(""));
        added += fresh.length;
        more.data.videos = result.accepted;
        more.data.scanned = result.ranked.length;
        more.data.rejectedLanguage = result.rejectedLanguage;
        if (CMJ.targetCache) CMJ.targetCache.data = more.data;
        const title = host.querySelector(".cmj-target-head span");
        if (title) title.textContent = `${targetHeadline()} · ${result.accepted.length} results`;
        if (!more.pages.some((p) => !p.done && p.token) && !more.pendingSpecs.length) {
          more.exhausted = true;
          break;
        }
      }
      const host = document.getElementById("cmj-target-feed");
      const sentinel = host?.querySelector("[data-cmj-sentinel]");
      if (sentinel)
        sentinel.textContent = more.exhausted
          ? "No more videos for this country and language."
          : "Loading more…";
      // Re-observe so the next scroll position triggers another page.
      if (host && !more.exhausted) {
        CMJ.sentinelObserver?.disconnect();
        const el = host.querySelector("[data-cmj-sentinel]");
        if (el) CMJ.sentinelObserver.observe(el);
      }
    } finally {
      more.loading = false;
    }
  }

  /** Render the Target Feed box for the current state. */
  function paintTargetFeed(host) {
    const view = CMJ.targetView;
    if (!view) return;
    host.dataset.cmjPaint = String(view.version);
    const data = view.data;
    const head = (label, button) =>
      `<div class="cmj-target-head"><div><strong>🎯 Charlie MJ Target Feed</strong><span>${label}</span><small>Mode: ${escapeHtml(activeModeLabel())}</small></div>${button}</div>`;
    if (view.status === "loading") {
      host.innerHTML =
        head(`${escapeHtml(targetHeadline())} · searching…`, "") +
        `<div class="cmj-target-empty">Loading ${escapeHtml(targetHeadline())} videos…</div>`;
      return;
    }
    const videos = Array.isArray(data?.videos) ? data.videos : [];
    if (view.status !== "ready" || !videos.length) {
      const why = data?.errors?.length
        ? `<br><small>${escapeHtml(data.errors.slice(0, 3).join(" | "))}</small>`
        : "";
      host.innerHTML =
        head(
          escapeHtml(targetHeadline()),
          `<button type="button" data-cmj-refresh>Retry</button>`,
        ) +
        `<div class="cmj-target-empty">${data?.scanned ? `YouTube returned ${Number(data.scanned)} videos but none were in the selected language/country.` : `No ${escapeHtml(targetHeadline())} videos could be loaded right now.`} Press Retry to search again.${why}</div>` +
        diagnosticsHtml(data);
      return;
    }
    const cards = videos.map(cardHtml).join("");
    const note = "";
    host.innerHTML =
      head(
        `${escapeHtml(targetHeadline())} · ${videos.length} results${note}`,
        `<button type="button" data-cmj-refresh>↻ Refresh</button>`,
      ) +
      `<div class="cmj-target-grid">${cards}</div><div class="cmj-target-sentinel" data-cmj-sentinel>Loading more…</div>` +
      diagnosticsHtml(data);
    host.dataset.cmjShown = String(videos.length);
    observeSentinel(host);
  }

  // Idempotent: creates/re-attaches the feed box and repaints only when the view changed.
  function mountTargetFeed(force = false) {
    if (!routeIsTargetHome() || !targetFeedWanted() || !CMJ.targetView) return false;
    const grid = document.querySelector("ytd-browse[page-subtype='home'] ytd-rich-grid-renderer");
    if (!grid) return false;
    let host = document.getElementById("cmj-target-feed");
    if (!host) {
      host = document.createElement("section");
      host.id = "cmj-target-feed";
      host.addEventListener("click", (event) => {
        if (event.target.closest("[data-cmj-refresh]")) {
          event.preventDefault();
          loadTargetFeed(true);
        }
      });
    }
    // Mount ABOVE the video grid (never inside the part Strict mode hides).
    const anchor = grid.querySelector(":scope > #contents");
    if (host.parentElement !== grid || (anchor && host.nextElementSibling !== anchor))
      grid.insertBefore(host, anchor || null);
    if (force || host.dataset.cmjPaint !== String(CMJ.targetView.version)) paintTargetFeed(host);
    return true;
  }

  // ---- native-language helpers -------------------------------------------------
  const nonLatinName = (name) => /[^\u0000-ɏ]/.test(String(name || ""));
  const wordTokens = (text) =>
    String(text || "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);

  // Whole-word match; for non-Latin scripts also allow a 1–2 letter attached prefix (e.g. Arabic "بمصر").
  function termHit(text, term) {
    const q = norm(term);
    if (!q) return false;
    if (!nonLatinName(q)) return signalHit(text, q);
    if (q.includes(" ")) return text.includes(q);
    return wordTokens(text).some((t) => t === q || (t.length <= q.length + 2 && t.endsWith(q)));
  }

  /** Language code used to search and detect for the active mode. */
  function targetLangCode() {
    return String(
      CMJ.language?.alpha_2 || CMJ.settings.targetLanguage || CMJ.settings.language || "en",
    ).toLowerCase();
  }

  const regionNamesCache = {};
  /** Country name written in the given language (Intl.DisplayNames). */
  function nativeRegionName(code, hl) {
    try {
      if (!validGl(code)) return "";
      if (!(hl in regionNamesCache))
        regionNamesCache[hl] = new Intl.DisplayNames([hl], { type: "region" });
      const n = regionNamesCache[hl].of(String(code).toUpperCase());
      return n && n.toUpperCase() !== String(code).toUpperCase() ? n : "";
    } catch (_) {
      return "";
    }
  }

  // Short form of the target country in the target language ("المملكة العربية السعودية" -> "السعودية").
  function nativeCountryShort() {
    const full = nativeRegionName(validGl(CMJ.settings.country), targetLangCode());
    const words = full.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.at(-1).length >= 4) return words.at(-1);
    return full;
  }

  /** All terms that identify the target country, including native names. */
  function targetCountryTerms() {
    const terms = termsForCountry();
    const full = nativeRegionName(validGl(CMJ.settings.country), targetLangCode());
    if (full) terms.push(norm(full));
    const short = nativeCountryShort();
    if (short) terms.push(norm(short));
    return [...new Set(terms.filter(Boolean))];
  }

  /** Names of other countries, used to demote videos about the wrong country. */
  function nonTargetTerms() {
    const hl = targetLangCode(),
      target = String(CMJ.settings.country || "").toUpperCase();
    if (!validGl(target)) return [];
    const key = `${target}|${hl}|${CMJ.countries?.length || 0}`;
    if (CMJ._nonTargetKey === key) return CMJ._nonTarget;
    const list = [];
    for (const c of CMJ.countries || []) {
      if (String(c.code || "").toUpperCase() === target) continue;
      // Full names only (no ISO-3 codes): "can" and "ben" are everyday words in other languages.
      for (const n of [c.name, c.capital])
        if (n && String(n).length >= 5) list.push({ label: c.name || c.code, term: n });
      const native = nativeRegionName(c.code, hl);
      if (native && (nonLatinName(native) ? native.length >= 3 : native.length >= 5))
        list.push({ label: c.name || c.code, term: native });
    }
    CMJ._nonTargetKey = key;
    CMJ._nonTarget = list;
    return list;
  }

  /** Score a search result for country and language relevance. */
  function targetCandidateScore(video) {
    const title = String(video?.title || "");
    const text = norm(`${title} ${video?.channel || ""}`);
    const countryHits = [...new Set(targetCountryTerms().filter((x) => termHit(text, x)))];
    const lang = CMJ_LANG.verdict(title, targetLangCode());
    const obviousNonTarget = [
      ...new Set(
        nonTargetTerms()
          .filter((x) => termHit(text, x.term))
          .map((x) => x.label),
      ),
    ];
    let score = countryHits.length * 4 + (lang.match === true ? 6 : 0);
    if (obviousNonTarget.length && !countryHits.length) score -= 6;
    return {
      score,
      countryHits,
      obviousNonTarget,
      languageVerdict: lang,
      languageMatch: lang.match === true,
      languageReject: lang.match === false,
      countryMatch: countryHits.length > 0,
      strongHits: [],
      commonHits: [],
    };
  }

  /** Ask the page bridge for the next page of a search (continuation token). */
  function waitForTargetContinue(token, language, timeoutMs = 20000) {
    const requestId = `cmj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        CMJ.targetRequestWaiters.delete(requestId);
        reject(new Error("continuation timed out"));
      }, timeoutMs);
      CMJ.targetRequestWaiters.set(requestId, { resolve, reject, timer });
      window.postMessage(
        {
          source: "charlie-mj-content",
          type: "CMJ_TARGET_CONTINUE",
          requestId,
          payload: { token, country: effectiveCountry(), language },
        },
        "*",
      );
    });
  }

  /** Ask the page bridge to run a YouTube search and wait for its answer. */
  function waitForTargetSearch(query, language, timeoutMs = 20000) {
    const requestId = `cmj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        CMJ.targetRequestWaiters.delete(requestId);
        reject(new Error("page bridge did not answer (reload the YouTube tab)"));
      }, timeoutMs);
      CMJ.targetRequestWaiters.set(requestId, { resolve, reject, timer });
      window.postMessage(
        {
          source: "charlie-mj-content",
          type: "CMJ_TARGET_SEARCH",
          requestId,
          payload: { query, country: effectiveCountry(), language },
        },
        "*",
      );
    });
  }

  /** Run async workers over a list with a concurrency limit. */
  async function runPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await worker(items[i], i);
      }
    });
    await Promise.all(runners);
    return results;
  }

  /** Build the native-language search queries for General mode. */
  function buildTargetQueries(countryName, languageName) {
    const specs = [];
    const add = (query, kind) => {
      const q = String(query || "").trim();
      if (q && !specs.some((item) => item.query.toLowerCase() === q.toLowerCase()))
        specs.push({ query: q, kind });
    };
    const code = targetLangCode();
    const place = validGl(CMJ.settings.country) ? nativeCountryShort() || countryName : "";
    const topics = CMJ_LANG.topics(code);
    if (topics.length) {
      // Native-language searches: "<country in its language> <topic in its language>".
      if (place) {
        add(place, "country-language");
        for (const t of topics) add(`${place} ${t}`, "country-language");
      }
      for (const t of topics) add(t, "language");
    } else {
      add(`${countryName} ${languageName}`, "country-language");
      add(`${languageName} ${countryName}`, "language-country");
      add(languageName, "language");
      for (const term of (CMJ.languageSignals?.common || [])
        .filter((x) => String(x).length >= 4 && !/\s/.test(String(x)))
        .slice(0, 8))
        add(term, "language-signal");
      add(countryName, "country");
    }
    return { round1: specs.slice(0, 10), round2: specs.slice(10, 20) };
  }

  // ---- Tech / Language Learning mode feeds ------------------------------------
  const englishLangName = (code) => {
    try {
      return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
    } catch (_) {
      return code;
    }
  };

  /** Resolve a language code or name to {code, name} using the 7,910-language catalog. */
  async function resolveModeLang(input) {
    const raw = String(input || "")
      .trim()
      .toLowerCase();
    if (!raw) return null;
    if (/^[a-z]{2}$/.test(raw)) return { code: raw, name: englishLangName(raw) };
    if (!CMJ.langList) {
      const r = await safeRuntimeMessage({
        type: "READ_DATABASE",
        path: "database/languages/languages.json",
      });
      CMJ.langList = r?.ok ? r.data?.languages || [] : [];
    }
    const rec = CMJ.langList.find((x) =>
      [x.alpha_2, x.alpha_3, x.terminology, x.bibliographic, x.name]
        .filter(Boolean)
        .some((c) => String(c).toLowerCase() === raw),
    );
    if (rec?.alpha_2)
      return {
        code: String(rec.alpha_2).toLowerCase(),
        name: rec.name || englishLangName(rec.alpha_2),
      };
    return null;
  }

  // Resolves the language list, country name and (Tech) profile terms for the active mode.
  async function prepareMode() {
    const kind = modeKind();
    CMJ.modeLangs = [];
    CMJ.modeTerms = [];
    CMJ.techProfile = null;
    CMJ.modeCountryName = "";
    if (kind === "general") return;
    const cfg = modeCfg();
    const inputs =
      kind === "tech"
        ? cfg.contentLanguages || []
        : [cfg.learningLanguage, ...(cfg.contentLanguages || [])];
    const langs = [];
    for (const x of inputs) {
      const l = await resolveModeLang(x);
      if (l && !langs.some((y) => y.code === l.code)) langs.push(l);
    }
    if (!langs.length)
      langs.push(
        kind === "tech"
          ? { code: "en", name: "English" }
          : { code: targetLangCode(), name: englishLangName(targetLangCode()) },
      );
    CMJ.modeLangs = langs;
    const cc = effectiveCountry();
    if (cc)
      CMJ.modeCountryName =
        (CMJ.countries || []).find((c) => String(c.code).toUpperCase() === cc)?.name ||
        nativeRegionName(cc, "en") ||
        cc;
    if (kind === "tech") {
      const id = String(cfg.profileId || "devops");
      const r = await safeRuntimeMessage({
        type: "READ_DATABASE",
        path: `database/tech/${id}.json`,
      });
      let data = r?.ok ? r.data : null;
      if (!data) {
        const x = await safeStorageGet("techProfiles");
        data = (x.techProfiles || []).find((p) => p.id === id) || null;
      }
      CMJ.techProfile = { id, data };
      const cats = Object.values(data?.categories || {}).map((a) =>
        (Array.isArray(a) ? a : []).map(String).filter(Boolean),
      );
      const terms = [];
      for (let i = 0; terms.length < 400 && cats.some((c) => i < c.length); i++)
        for (const c of cats) if (i < c.length) terms.push(c[i]);
      CMJ.modeTerms = [...new Set(terms)];
    } else if (kind === "niches") {
      const id = String(cfg.profileId || "technology");
      const r = await safeRuntimeMessage({
        type: "READ_DATABASE",
        path: `database/niches/${id}.json`,
      });
      let data = r?.ok ? r.data : null;
      if (!data) {
        const x = await safeStorageGet("nicheProfiles");
        data = (x.nicheProfiles || []).find((p) => p.id === id) || null;
      }
      CMJ.nicheProfile = { id, data };
      const cats = Object.values(data?.categories || {}).map((a) =>
        (Array.isArray(a) ? a : []).map(String).filter(Boolean),
      );
      const terms = [];
      for (let i = 0; terms.length < 400 && cats.some((c) => i < c.length); i++)
        for (const c of cats) if (i < c.length) terms.push(c[i]);
      CMJ.modeTerms = [...new Set(terms)];
    }
  }

  /** Build search queries for Tech, Language Learning or Niches mode. */
  function buildModeQueries() {
    const kind = modeKind(),
      cfg = modeCfg();
    const specs = [];
    const add = (query, k) => {
      const q = String(query || "")
        .replace(/\s+/g, " ")
        .trim();
      if (q && !specs.some((x) => x.query.toLowerCase() === q.toLowerCase()))
        specs.push({ query: q, kind: k });
    };
    const main = CMJ.modeLangs[0] || { code: "en", name: "English" };
    if (kind === "tech") {
      const profile = CMJ.techProfile?.data?.name || CMJ.techProfile?.id || "technology";
      const suffix = main.code === "en" ? "" : ` ${main.name}`;
      add(`${profile} tutorial${suffix}`, "tech");
      add(`${profile} roadmap${suffix}`, "tech");
      for (const t of CMJ.modeTerms.slice(0, 40)) add(`${t} tutorial${suffix}`, "tech");
      if (main.code !== "en")
        for (const t of CMJ.modeTerms.slice(0, 6)) add(`${t} tutorial`, "tech");
    } else if (kind === "niches") {
      const profile = CMJ.nicheProfile?.data?.name || CMJ.nicheProfile?.id || "niche";
      const suffix = main.code === "en" ? "" : ` ${main.name}`;
      add(`${profile}${suffix}`, "niche");
      add(`${profile} guide${suffix}`, "niche");
      for (const t of CMJ.modeTerms.slice(0, 40)) add(`${t}${suffix}`, "niche");
      for (const t of CMJ.modeTerms.slice(0, 8)) add(`${t} tips${suffix}`, "niche");
    } else {
      const name = main.name,
        place = nativeRegionName(effectiveCountry(), main.code);
      const topics = CMJ_LANG.topics(main.code);
      for (const t of topics.slice(0, 6)) add(t, "native");
      if (place) for (const t of topics.slice(0, 3)) add(`${place} ${t}`, "native");
      const goals = (Array.isArray(cfg.goals) ? cfg.goals : [])
        .map((g) => String(g).replace(/[-_]/g, " ").trim())
        .filter((g) => g && g !== "learn language");
      add(`learn ${name}`, "lesson");
      add(`${name} for beginners`, "lesson");
      add(`${name} listening practice`, "lesson");
      add(`${name} conversation`, "lesson");
      for (const g of goals) add(`${name} ${g}`, "lesson");
      add(`${name} podcast`, "native");
      add(`${name} news`, "native");
      add(`${name} vlog`, "native");
      add(name, "native");
      for (const t of topics.slice(6)) add(t, "native");
    }
    return { round1: specs.slice(0, 10), round2: specs.slice(10, 20), rest: specs.slice(20, 40) };
  }

  /** Rank and filter search results for Tech, Language Learning or Niches mode. */
  function classifyModeResults(rawVideos) {
    const unique = new Map();
    for (const v of rawVideos) if (v?.videoId && !unique.has(v.videoId)) unique.set(v.videoId, v);
    const langs = (CMJ.modeLangs || []).map((l) => l.code);
    const kind = modeKind();
    const ranked = [...unique.values()]
      .map((video) => {
        const title = String(video.title || "");
        const text = norm(`${title} ${video.channel || ""}`);
        const modeHits =
          kind === "tech" || kind === "niches"
            ? CMJ.modeTerms.filter((t) => t.length >= 2 && signalHit(text, norm(t))).slice(0, 8)
            : [];
        const verdicts = langs.map((c) => CMJ_LANG.verdict(title, c));
        const languageMatch = verdicts.some((x) => x.match === true);
        const languageReject = verdicts.length > 0 && verdicts.every((x) => x.match === false);
        const score =
          modeHits.length * 3 + (languageMatch ? 4 : 0) + (video.searchKind === "native" ? 1 : 0);
        return {
          ...video,
          target: {
            score,
            modeHits,
            countryHits: [],
            obviousNonTarget: [],
            languageVerdict: verdicts.find((x) => x.match === true) || verdicts[0] || {},
            languageMatch,
            languageReject,
            countryMatch: false,
          },
        };
      })
      .sort((a, b) => b.target.score - a.target.score || (a.searchRank || 0) - (b.searchRank || 0));
    const requireLanguage = CMJ.settings.targetRequireLanguage !== false;
    // Language-learning "lesson" searches are lessons ABOUT the language (often taught in English), so only native content is language-gated.
    const accepted = requireLanguage
      ? ranked.filter(
          (v) =>
            !v.target.languageReject || (kind === "languageLearning" && v.searchKind === "lesson"),
        )
      : ranked;
    return {
      ranked,
      accepted,
      rejectedLanguage: ranked.length - accepted.length,
      rejectedCountry: 0,
    };
  }

  /** Rank and filter raw search results (language gate, country gate, ordering). */
  function classifyTargetResults(rawVideos) {
    if (modeKind() !== "general") return classifyModeResults(rawVideos);
    const unique = new Map();
    for (const video of rawVideos)
      if (video?.videoId && !unique.has(video.videoId)) unique.set(video.videoId, video);
    const ranked = [...unique.values()]
      .map((video) => {
        const target = targetCandidateScore(video);
        return { ...video, target };
      })
      .sort((a, b) => b.target.score - a.target.score || (a.searchRank || 0) - (b.searchRank || 0));

    // 1) Language gate: drop anything that is clearly NOT in the selected language.
    const requireLanguage = CMJ.settings.targetRequireLanguage !== false;
    const inLanguage = requireLanguage ? ranked.filter((v) => !v.target.languageReject) : ranked;
    // 2) Country gate: videos that name a different country (and not ours) go last / are dropped when we have enough.
    const primary = inLanguage.filter(
      (v) => !(v.target.obviousNonTarget.length && !v.target.countryMatch),
    );
    const secondary = inLanguage.filter(
      (v) => v.target.obviousNonTarget.length && !v.target.countryMatch,
    );
    const accepted = primary.length >= 12 ? primary : [...primary, ...secondary];
    return {
      ranked,
      accepted,
      rejectedLanguage: ranked.length - inLanguage.length,
      rejectedCountry: inLanguage.length - Math.min(inLanguage.length, accepted.length),
    };
  }

  /** Load the Target Feed: run queries, classify results and show them. */
  async function loadTargetFeed(force = false) {
    if (!routeIsTargetHome() || !targetFeedWanted() || CMJ.targetFeedLoading) return;
    if (!force && CMJ.targetFeedReady) return;
    const now = Date.now();
    const key = targetKey();
    if (!force) {
      const cache = CMJ.targetCache;
      if (cache && cache.key === key && now - cache.at < TARGET_CACHE_MS) {
        setTargetView("ready", cache.data);
        return;
      }
      // Never hammer YouTube: after a failure wait before auto-retrying, and give up after a few tries.
      if (CMJ.targetAttempts >= TARGET_MAX_AUTO_ATTEMPTS) return;
      if (now - (CMJ.targetLastAttempt || 0) < TARGET_RETRY_BACKOFF_MS) return;
    } else {
      CMJ.targetCache = null;
      CMJ.targetAttempts = 0;
    }
    CMJ.targetLastAttempt = now;
    CMJ.targetAttempts = (CMJ.targetAttempts || 0) + 1;
    CMJ.targetFeedLoading = true;
    const gen = CMJ.targetGen || 0;
    const stale = () => gen !== (CMJ.targetGen || 0);
    let countryName = validGl(CMJ.settings.country)
      ? CMJ.country?.name || CMJ.settings.country
      : "";
    let languageName = CMJ.language?.name || CMJ.settings.targetLanguage || "";
    let hl = String(
      CMJ.language?.alpha_2 || CMJ.settings.targetLanguage || CMJ.settings.language || "en",
    ).toLowerCase();
    try {
      await prepareMode();
      if (modeKind() !== "general") {
        hl = CMJ.modeLangs[0].code;
        languageName = CMJ.modeLangs[0].name;
        countryName = CMJ.modeCountryName || "";
      }
    } catch (error) {
      console.info("Charlie MJ mode preparation failed:", error?.message || error);
    }
    if (stale()) {
      return;
    }
    setTargetView("loading", { country: countryName, language: languageName, videos: [] });
    try {
      const {
        round1,
        round2,
        rest = [],
      } = modeKind() === "general"
        ? buildTargetQueries(countryName, languageName)
        : buildModeQueries();
      const specs = [...round1];
      const diagnostics = [];
      const rawVideos = [];
      const errors = [];
      const pages = []; // per-query continuation tokens for infinite scroll

      const runSpecs = (list) =>
        runPool(list, 4, async (spec) => {
          try {
            const result = await waitForTargetSearch(spec.query, hl);
            const videos = Array.isArray(result?.videos) ? result.videos : [];
            diagnostics.push({
              query: spec.query,
              kind: spec.kind,
              count: videos.length,
              strategy: result?.strategy,
              error: result?.ok ? "" : result?.error || "no result",
            });
            videos.forEach((item, index) =>
              rawVideos.push({
                ...item,
                searchQuery: spec.query,
                searchKind: spec.kind,
                searchRank: index,
              }),
            );
            if (result?.token)
              pages.push({ query: spec.query, kind: spec.kind, token: result.token, done: false });
          } catch (error) {
            diagnostics.push({
              query: spec.query,
              kind: spec.kind,
              count: 0,
              error: error.message,
            });
            errors.push(`${spec.query}: ${error.message}`);
          }
        });

      await runSpecs(round1);
      let result = classifyTargetResults(rawVideos);
      // Too few videos in the right language/country? Search with more native topics.
      if (result.accepted.length < 24 && rawVideos.length && round2.length) {
        specs.push(...round2);
        await runSpecs(round2);
        result = classifyTargetResults(rawVideos);
      }

      // Fallback: ask the background worker to do the localized search itself.
      let backgroundFallback = null;
      if (!rawVideos.length) {
        const bg = (await safeRuntimeMessage({
          type: modeKind() === "general" ? "GET_TARGET_FEED" : "GET_MODE_FEED",
        })) || { ok: false, errors: ["Extension context unavailable"], videos: [] };
        const videos = Array.isArray(bg?.videos) ? bg.videos : [];
        backgroundFallback = {
          count: videos.length,
          errors: bg?.errors || (bg?.error ? [bg.error] : []),
        };
        videos.forEach((item, index) =>
          rawVideos.push({ ...item, searchKind: item.searchKind || "language", searchRank: index }),
        );
        if (backgroundFallback.errors.length) errors.push(...backgroundFallback.errors);
        result = classifyTargetResults(rawVideos);
      }

      if (stale()) return; // settings changed while this search was running: drop the outdated result
      const { ranked, accepted, rejectedLanguage, rejectedCountry } = result;
      const data = {
        ok: true,
        country: countryName,
        language: languageName,
        videos: accepted,
        scanned: ranked.length,
        targetMatches: accepted.length,
        rejected: Math.max(0, ranked.length - accepted.length),
        rejectedLanguage,
        rejectedCountry,
        queries: specs.map((s) => s.query),
        diagnostics,
        backgroundFallback,
        errors: [...new Set(errors)].slice(0, 6),
      };
      CMJ.targetMore = {
        rawVideos,
        pages,
        hl,
        loading: false,
        exhausted: false,
        data,
        pendingSpecs: [...(specs.length > round1.length ? [] : round2), ...rest],
      };
      if (accepted.length) {
        CMJ.targetCache = { key, at: Date.now(), data };
        CMJ.targetAttempts = 0;
        setTargetView("ready", data);
      } else {
        console.info(
          "Charlie MJ target feed: no videos matched. Diagnostics:",
          JSON.stringify({
            scanned: ranked.length,
            rejectedLanguage,
            diagnostics,
            backgroundFallback,
            errors: data.errors,
          }),
        );
        setTargetView("empty", data);
      }
      applyInterfaceControls();
    } catch (error) {
      if (stale()) return;
      console.info("Charlie MJ target feed failed:", error?.message || error);
      setTargetView("empty", {
        videos: [],
        country: countryName,
        language: languageName,
        errors: [String(error?.message || error)],
      });
    } finally {
      if (!stale()) CMJ.targetFeedLoading = false;
    }
  }

  /** Hide comments that match blocked text rules. */
  function hideBlockedComments() {
    const s = CMJ.settings;
    if (
      !s.filterComments &&
      !(s.blockedCommentUsers || []).length &&
      !(s.blockedCommentKeywords || []).length
    )
      return;
    const users = (s.blockedCommentUsers || []).map(norm).filter(Boolean);
    const words = (s.blockedCommentKeywords || []).map(norm).filter(Boolean);
    $all("ytd-comment-thread-renderer, ytd-comment-view-model, ytd-comment-renderer").forEach(
      (comment) => {
        const text = norm(textOf(comment));
        const author = norm(
          textOf(comment.querySelector("#author-text, #header-author, a[href*='/@']")),
        );
        if (
          users.some((x) => author === x || author.includes(x)) ||
          words.some((x) => text.includes(x))
        ) {
          comment.style.display = "none";
          comment.dataset.cmjCommentHidden = "1";
        }
      },
    );
  }

  /** Apply playback preferences (speed, quality, autoplay) to the player. */
  function applyPlayerPreferences() {
    const s = CMJ.settings;
    const video = document.querySelector("video.html5-main-video, video");
    if (video) {
      if (
        Number.isFinite(Number(s.playbackSpeed)) &&
        Number(s.playbackSpeed) > 0 &&
        Number(s.playbackSpeed) !== 1
      )
        video.playbackRate = Number(s.playbackSpeed);
      if (Number(s.volumeBoost) > 1)
        video.volume = Math.min(1, video.volume * Number(s.volumeBoost));
      if (s.loopVideo) video.loop = true;
    }
    if (s.cinemaMode || s.forceTheaterMode) {
      const btn = document.querySelector("button.ytp-size-button, .ytp-size-button");
      const theater = document.querySelector("#movie_player.ytp-big-mode");
      if (s.forceTheaterMode && btn && !theater) btn.click();
    }
  }

  /** Legacy ranked feed for Productivity and Custom modes. */
  async function mountModeFeed(force = false) {
    if (!routeIsTargetHome()) return;
    const mode = String(CMJ.settings.activeMode || "general");
    if (mode === "general" || CMJ.modeFeedLoading) return;
    if (!force && CMJ.modeFeedMounted && document.querySelector("#cmj-target-feed")) return;

    CMJ.modeFeedLoading = true;
    try {
      // The mode feed is the primary feed for non-General modes.  First rank
      // videos that YouTube has already rendered.  This is fast, reliable and
      // does not depend on an InnerTube search request being accepted.
      const cards = $all(CARD_SELECTOR).filter(
        (card) => !card.closest("#cmj-target-feed, #cmj-mode-feed"),
      );
      const ranked = [];
      for (const card of cards) {
        const intelligence = globalThis.__CMJ_INTELLIGENCE__?.classify?.(card, CMJ.settings);
        if (!intelligence || intelligence.mode !== mode) continue;
        if (
          intelligence.relevance <
          Number(CMJ.settings.modeSettings?.[mode]?.deprioritizeThreshold || 0)
        )
          continue;
        const info = videoInfo(card);
        if (!info.id) continue;
        const title = textOf(card.querySelector("#video-title, a#video-title, h3"));
        const channel = channelInfo(card).name;
        const img = card.querySelector("#thumbnail img, ytd-thumbnail img, img");
        const thumbnail = img?.src || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`;
        const meta = textOf(card.querySelector("#metadata-line"));
        ranked.push({
          videoId: info.id,
          title,
          channel,
          thumbnail,
          published: meta,
          duration: textOf(card.querySelector("ytd-thumbnail-overlay-time-status-renderer")),
          score: intelligence.relevance,
          reason: intelligence.reasons?.slice(0, 3).join(" · ") || "",
        });
      }
      ranked.sort((a, b) => b.score - a.score);

      // If the current Home page does not contain enough relevant cards, use
      // the existing YouTube search bridge as a secondary source.
      if (ranked.length < 8) {
        const plan = (await safeRuntimeMessage({ type: "GET_MODE_FEED", onlyQueries: true })) || {
          ok: false,
          error: "Extension context unavailable",
          queries: [],
        };
        const queries = Array.isArray(plan?.queries) ? plan.queries.slice(0, 6) : [];
        const raw = [];
        const errors = [];
        await runPool(queries, 2, async (query) => {
          try {
            const result = await waitForTargetSearch(
              query,
              String(
                CMJ.language?.alpha_2 ||
                  CMJ.settings.targetLanguage ||
                  CMJ.settings.language ||
                  "en",
              ).toLowerCase(),
              12000,
            );
            if (Array.isArray(result?.videos))
              raw.push(...result.videos.map((v) => ({ ...v, modeQuery: query })));
            if (!result?.ok && result?.error) errors.push(`${query}: ${result.error}`);
          } catch (error) {
            errors.push(`${query}: ${error.message}`);
          }
        });
        for (const v of raw) {
          if (!v?.videoId || ranked.some((x) => x.videoId === v.videoId)) continue;
          const score = mode === "tech" || mode === "niches" ? 70 : 65;
          ranked.push({
            videoId: v.videoId,
            title: v.title || "Untitled",
            channel: v.channel || "",
            thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            published: v.published || v.views || v.modeQuery || "",
            duration: v.duration || "",
            score,
            reason: `${activeModeLabel()} search`,
          });
        }
        if (!ranked.length) {
          const fallback = (await safeRuntimeMessage({ type: "GET_MODE_FEED" })) || {
            ok: false,
            error: "Extension context unavailable",
            videos: [],
          };
          for (const v of fallback?.videos || [])
            if (v?.videoId && !ranked.some((x) => x.videoId === v.videoId))
              ranked.push({
                ...v,
                score: mode === "tech" || mode === "niches" ? 68 : 63,
                reason: `${activeModeLabel()} search`,
              });
          if (fallback?.errors?.length) errors.push(...fallback.errors);
        }
        CMJ.modeFeedDiagnostics = errors.slice(0, 4);
      }

      const videos = ranked
        .filter((v, i, a) => v?.videoId && a.findIndex((x) => x.videoId === v.videoId) === i)
        .slice(0, 24);
      let host = document.getElementById("cmj-target-feed");
      if (!host) {
        const grid = document.querySelector(
          "ytd-browse[page-subtype='home'] ytd-rich-grid-renderer",
        );
        if (!grid) return;
        host = document.createElement("section");
        host.id = "cmj-target-feed";
        const anchor = grid.querySelector(":scope > #contents");
        grid.insertBefore(host, anchor || null);
      }
      const label = `${CMJ.country?.name || modeGeo().country || CMJ.settings.country || "Global"} · ${CMJ.language?.name || modeGeo().language || CMJ.settings.targetLanguage || CMJ.settings.language || "English"}`;
      const head = `<div class="cmj-target-head"><div><strong>🎯 Charlie MJ Target Feed</strong><span>${escapeHtml(label)}</span><small>Mode: ${escapeHtml(activeModeLabel())}</small></div><button type="button" data-cmj-mode-retry>↻ Refresh</button></div>`;
      if (!videos.length) {
        const diagnostics = CMJ.modeFeedDiagnostics?.length
          ? `<small>${escapeHtml(CMJ.modeFeedDiagnostics.join(" | "))}</small>`
          : "";
        host.innerHTML = `${head}<div class="cmj-target-empty"><strong>${escapeHtml(activeModeLabel())} feed could not be loaded.</strong><br>${escapeHtml(activeModeLabel())} mode could not find enough relevant YouTube content on the current page.${diagnostics}<br><button type="button" data-cmj-mode-retry>Retry</button></div>`;
      } else {
        const cardsHtml = videos
          .map((v) => {
            const href = `/watch?v=${encodeURIComponent(v.videoId)}`;
            return `<article class="cmj-target-card" data-vid="${escapeHtml(v.videoId)}" title="${escapeHtml(v.reason || "")}"><a href="${href}" class="cmj-target-thumb"><img loading="lazy" src="${escapeHtml(v.thumbnail)}" alt="">${v.duration ? `<span>${escapeHtml(v.duration)}</span>` : ""}</a><a href="${href}" class="cmj-target-title">${escapeHtml(v.title || "Untitled")}</a><div class="cmj-target-channel">${escapeHtml(v.channel || "")}</div><div class="cmj-target-meta">${escapeHtml(v.published || "")}</div></article>`;
          })
          .join("");
        host.innerHTML = `${head}<div class="cmj-target-grid">${cardsHtml}</div><div class="cmj-target-sentinel">${videos.length} ${escapeHtml(activeModeLabel())} videos selected</div>`;
      }
      host.onclick = (event) => {
        if (event.target.closest("[data-cmj-mode-retry]")) {
          event.preventDefault();
          CMJ.modeFeedMounted = false;
          mountModeFeed(true);
        }
      };
      CMJ.modeFeedMounted = true;
    } finally {
      CMJ.modeFeedLoading = false;
    }
  }

  /** Show videos of followed/trusted library channels on Home. */
  async function mountFollowedChannelFeed() {
    const cfg = CMJ.settings.followedChannelFeed || {};
    if (cfg.enabled === false || !routeIsTargetHome() || CMJ.followedFeedLoading) return;
    const host =
      document.querySelector('ytd-browse[page-subtype="home"] #contents') ||
      document.querySelector("ytd-rich-grid-renderer #contents");
    if (!host) return;
    let box = document.querySelector("#cmj-followed-channel-feed");
    if (box) {
      CMJ.followedFeedMounted = true;
      return;
    }
    CMJ.followedFeedLoading = true;
    try {
      const result = await safeRuntimeMessage({ type: "GET_FOLLOWED_CHANNEL_FEED" });
      if (!result?.ok || !Array.isArray(result.videos) || !result.videos.length) return;
      box = document.createElement("section");
      box.id = "cmj-followed-channel-feed";
      box.className = "cmj-followed-channel-feed";
      box.innerHTML = `<div class="cmj-followed-head"><strong>⭐ Followed Channels</strong><span>New content from your saved channels</span></div><div class="cmj-followed-grid"></div>`;
      const grid = box.querySelector(".cmj-followed-grid");
      for (const v of result.videos) {
        const a = document.createElement("a");
        a.className = "cmj-followed-item";
        a.href = `https://www.youtube.com/watch?v=${encodeURIComponent(v.videoId)}`;
        a.innerHTML = `<img src="${String(v.thumbnail || "").replace(/"/g, "&quot;")}" loading="lazy"><div><strong>${escapeHtml(v.title || "Untitled")}</strong><span>${escapeHtml(v.followedChannel || v.channel || "")}</span><small>${escapeHtml(v.published || v.views || "")}</small></div>`;
        grid.appendChild(a);
      }
      if ((cfg.placement || "home-top") === "home-top") host.prepend(box);
      else host.appendChild(box);
      CMJ.followedFeedMounted = true;
    } catch (_) {
    } finally {
      CMJ.followedFeedLoading = false;
    }
  }

  /** Hide interface parts (sidebar, comments, shorts…) according to settings. */
  function applyInterfaceControls() {
    $all("[data-cmj-ui-hidden='1']").forEach((el) => {
      el.style.display = "";
      el.removeAttribute("data-cmj-ui-hidden");
    });
    const s = CMJ.settings;
    const rules = [];
    const safeHome = routeIsHome() && !(s.targetFeedEnabled && CMJ.targetFeedReady);
    if (s.hideHomeRecommendations && routeIsHome() && !s.targetFeedEnabled)
      rules.push("ytd-rich-grid-renderer #contents");
    if (s.hideSidebar) rules.push("#guide, #guide-inner");
    if (s.hideComments) rules.push("ytd-comments, #comments");
    if (s.hideLiveChat) rules.push("ytd-live-chat-frame, #chat");
    if (s.hideRecommendations || s.hideEndscreenRecommendations)
      rules.push("ytd-watch-next-secondary-results-renderer, #related, ytd-reel-shelf-renderer");
    if (s.hideExplore) rules.push("ytd-guide-entry-renderer a[href*='/feed/explore']");
    if (s.hideTrending) rules.push("ytd-guide-entry-renderer a[href*='/feed/trending']");
    if (s.hideSubscriptions) rules.push("ytd-guide-entry-renderer a[href*='/feed/subscriptions']");
    if (s.hideSearchSuggestions) rules.push("ytd-searchbox #suggestions");
    if (s.hideThumbnails)
      rules.push(
        "ytd-rich-item-renderer #thumbnail, ytd-video-renderer #thumbnail, ytd-grid-video-renderer #thumbnail",
      );
    if (s.hideAds)
      rules.push(
        "ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, #player-ads",
      );
    if (s.hideFeaturedContent && !safeHome)
      rules.push("ytd-rich-section-renderer:has(ytd-rich-item-renderer)");
    if (s.hideMembersOnly) rules.push("ytd-members-only-badge");
    if (s.hideMerch) rules.push("ytd-merch-shelf-renderer, ytd-product-list-renderer");
    if (s.hideDonationPromos)
      rules.push("ytd-donation-shelf-renderer, ytd-statement-banner-renderer");
    if (s.hideMembershipPromos)
      rules.push("ytd-membership-offer-renderer, ytd-channel-membership-promo-renderer");
    if (s.hideMixes)
      rules.push(
        "ytd-rich-shelf-renderer:has(a[href*='/watch_videos?video_ids=']), ytd-compact-radio-renderer",
      );
    if (s.hideMusic) rules.push("ytd-guide-entry-renderer a[href*='/music']");
    if (s.hideGaming) rules.push("ytd-guide-entry-renderer a[href*='/gaming']");
    if (s.hideNews) rules.push("ytd-guide-entry-renderer a[href*='/news']");
    if (s.hideMovies) rules.push("ytd-guide-entry-renderer a[href*='/movies']");
    if (s.hideLive) rules.push("ytd-guide-entry-renderer a[href*='/live']");
    if (s.hideStore) rules.push("ytd-guide-entry-renderer a[href*='/store']");
    if (s.hideCommunity) rules.push("ytd-guide-entry-renderer a[href*='/feed/community']");
    if (s.hideChannelTabs) rules.push("ytd-c4-tabbed-header-renderer #tabsContent");
    if (rules.length)
      $all(rules.join(",")).forEach((el) => {
        el.style.display = "none";
        el.dataset.cmjUiHidden = "1";
      });
    // Safety rule: never hide the entire Home contents merely because several toggles are enabled.
    if (routeIsHome() && !CMJ.targetFeedReady) {
      $all(
        "ytd-browse[page-subtype='home'] #contents, ytd-browse[page-subtype='home'] #page-manager",
      ).forEach((el) => {
        if (el.dataset.cmjUiHidden === "1") {
          el.style.display = "";
          delete el.dataset.cmjUiHidden;
        }
      });
    }
    if (s.disableAutoplay) {
      const toggle = document.querySelector(".ytp-autonav-toggle-button");
      if (toggle?.getAttribute("aria-checked") === "true") toggle.click();
    }
    hideBlockedComments();
    applyPlayerPreferences();
  }

  /** Main pass: mount feeds, classify visible cards and apply interface controls. */
  function scan() {
    syncHomeHiding();
    if (!routeIsSupported()) return;
    if (routeIsTargetHome()) {
      mountFollowedChannelFeed();
      if (activeModeUsesDedicatedFeed()) {
        // Productivity / Custom keep the legacy ranked feed.
        if (CMJ.targetView) clearTargetFeed();
        mountModeFeed();
      } else if (targetFeedWanted()) {
        mountTargetFeed();
        if (!CMJ.targetView || (!CMJ.targetFeedReady && !CMJ.targetFeedLoading)) loadTargetFeed();
      }
    }
    const cards = $all(CARD_SELECTOR).slice(0, Number(CMJ.settings.maxCardsPerScan || 150));
    let hidden = 0;
    for (const card of cards) if (applyCard(card)) hidden++;
    applyInterfaceControls();
    handleAds();
    safeStorageSet({
      lastYouTubeScan: {
        at: new Date().toISOString(),
        videos: cards.length,
        hidden,
        country: CMJ.settings.country || "",
        route: location.pathname,
        targetFeed: CMJ.targetFeedReady ? "ready" : "disabled",
      },
    });
  }

  // Full, forced refresh: re-read settings, drop caches and rebuild the feed. Used by the toolbar / popup Scan buttons.
  async function rescanNow() {
    await loadData();
    CMJ.targetGen = (CMJ.targetGen || 0) + 1;
    CMJ.targetFeedLoading = false;
    CMJ.modeFeedLoading = false;
    clearTargetFeed();
    document.querySelector("#cmj-mode-feed")?.remove();
    CMJ.modeFeedMounted = false;
    CMJ.targetCache = null;
    CMJ.targetAttempts = 0;
    CMJ.targetLastAttempt = 0;
    resetProcessed();
    startObserver();
    scan();
    const cards = $all(CARD_SELECTOR).length;
    const hidden = $all("[data-cmj-hidden]").length;
    return { ok: true, videos: cards, hidden };
  }
  function reportAction(type, detail) {
    try {
      document.dispatchEvent(new CustomEvent("cmj-action-result", { detail: { type, ...detail } }));
    } catch (_) {}
  }
  async function runAction(type, msg = {}) {
    try {
      if (type === "SCAN_YOUTUBE") {
        const r = await rescanNow();
        reportAction(type, r);
        return r;
      }
      if (type === "SCAN_ADS") {
        handleAds();
        const r = { ok: true };
        reportAction(type, r);
        return r;
      }
      if (type === "BLOCK_VIDEO") {
        const url = msg.linkUrl || location.href;
        const id = url.match(/[?&]v=([^&]+)/)?.[1] || url.match(/\/shorts\/([^/?#]+)/)?.[1];
        if (!id) {
          const r = { ok: false, error: "Open a video page first" };
          reportAction(type, r);
          return r;
        }
        await addRule("video", id);
        const r = { ok: true };
        reportAction(type, r);
        return r;
      }
    } catch (error) {
      const r = { ok: false, error: error?.message || String(error) };
      reportAction(type, r);
      return r;
    }
    return { ok: false, error: "Unknown action" };
  }
  document.addEventListener("cmj-toolbar-action", (event) => {
    const d = event.detail || {};
    runAction(d.type, d);
  });

  /** Forget which cards were processed so they are classified again. */
  function resetProcessed() {
    $all("[data-cmj-processed='1']").forEach((card) => card.removeAttribute("data-cmj-processed"));
  }

  /** Watch the DOM for new cards and trigger scans. */
  function startObserver() {
    if (CMJ.observer) CMJ.observer.disconnect();
    syncHomeHiding();
    if (!routeIsSupported()) return;
    CMJ.observer = new MutationObserver((mutations) => {
      if (mutations.some((m) => m.addedNodes?.length)) requestAnimationFrame(scan);
      else if (adEnabled()) requestAnimationFrame(handleAds);
    });
    CMJ.observer.observe(document.documentElement, { childList: true, subtree: true });
    scan();
    if (routeIsTargetHome()) {
      mountFollowedChannelFeed();
      if (activeModeUsesDedicatedFeed()) mountModeFeed();
      else if (targetFeedWanted() && !CMJ.targetFeedReady) loadTargetFeed();
    }
  }

  /** Add a video, channel or text rule to the blacklist. */
  async function addRule(type, value) {
    if (!value) return;
    const stored = await safeStorageGet("settings");
    const { settings = {} } = stored;
    const key =
      type === "video"
        ? "blacklistVideoIds"
        : type === "channel"
          ? "blacklistChannels"
          : "blacklist";
    const list = Array.isArray(settings[key]) ? settings[key] : [];
    if (!list.map(norm).includes(norm(value))) list.push(value);
    await safeStorageSet({ settings: { ...settings, [key]: list } });
    await loadData();
    resetProcessed();
    scan();
    notify(`${type === "video" ? "Video" : type === "channel" ? "Channel" : "Text"} blocked.`);
  }

  /** Start the content script. */
  async function boot() {
    try {
      await loadData();
      if (CMJ.settings.extensionEnabled === false) return;
      if (routeIsSupported()) startObserver();
    } catch (error) {
      console.error("Charlie MJ YouTube database error", error);
      notify(`Database loading failed: ${error.message}`);
    }
    setInterval(() => {
      if (adEnabled()) handleAds();
    }, 350);
    CMJ.routeTimer = setInterval(() => {
      if (location.href !== CMJ.lastUrl) {
        CMJ.lastUrl = location.href;
        clearTargetFeed();
        syncHomeHiding();
        document.querySelector("#cmj-mode-feed")?.remove();
        CMJ.followedFeedMounted = false;
        CMJ.modeFeedMounted = false;
        document.querySelector("#cmj-followed-channel-feed")?.remove();
        CMJ.targetAttempts = 0;
        CMJ.targetLastAttempt = 0;
        resetProcessed();
        startObserver();
      }
    }, 800);
  }

  chrome.storage.onChanged.addListener(async (changes) => {
    if (changes.settings) {
      CMJ.targetGen = (CMJ.targetGen || 0) + 1;
      CMJ.targetFeedLoading = false;
      CMJ.modeFeedLoading = false;
      clearTargetFeed();
      document.querySelector("#cmj-mode-feed")?.remove();
      CMJ.modeFeedMounted = false;
      CMJ.targetCache = null;
      CMJ.targetAttempts = 0;
      CMJ.targetLastAttempt = 0;
      await loadData().catch(console.error);
      resetProcessed();
      startObserver();
    }
  });

  window.addEventListener("message", (event) => {
    if (event.data?.source === "charlie-mj-main") {
      if (
        event.data.type === "YT_INITIAL_DATA" ||
        event.data.type === "YT_JSON_DATA" ||
        event.data.type === "YT_FETCH_DATA"
      )
        CMJ.mainPageData = event.data.payload?.data || event.data.payload;
      if (event.data.type === "YT_PLAYER_RESPONSE") CMJ.mainPlayerResponse = event.data.payload;
      if (event.data.type === "YT_INNERTUBE_CONFIG") CMJ.mainConfig = event.data.payload;
      if (event.data.type === "CMJ_BRIDGE_READY") CMJ.bridgeReady = true;
      if (event.data.type === "CMJ_TARGET_SEARCH_RESULT") {
        const pending = CMJ.targetRequestWaiters.get(event.data.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          CMJ.targetRequestWaiters.delete(event.data.requestId);
          pending.resolve(event.data.payload || { ok: false, error: "No response" });
        }
      }
      return;
    }
    if (event.data?.source !== "charlie-mj") return;
    const msg = event.data;
    if (msg.type === "SCAN_YOUTUBE" || msg.type === "SCAN_ADS" || msg.type === "BLOCK_VIDEO")
      runAction(msg.type, msg);
  });

  function showContentToast(message, type = "success") {
    if (!message) return;
    document.querySelector(".cmj-runtime-toast")?.remove();
    const node = document.createElement("div");
    node.className = `cmj-runtime-toast ${type}`;
    node.textContent = message;
    Object.assign(node.style, {
      position: "fixed",
      right: "22px",
      bottom: "22px",
      zIndex: "2147483647",
      maxWidth: "360px",
      padding: "12px 16px",
      borderRadius: "10px",
      background: type === "error" ? "#da3633" : type === "warn" ? "#9e6a03" : "#238636",
      color: "#fff",
      font: "600 13px/1.35 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
      boxShadow: "0 10px 30px rgba(0,0,0,.35)",
    });
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 3200);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg?.type === "SCAN_YOUTUBE") {
        if (msg.force) {
          sendResponse(await rescanNow());
        } else {
          scan();
          sendResponse({ ok: true });
        }
        return;
      }
      if (msg?.type === "GET_VIDEOS") {
        const videos = $all(CARD_SELECTOR)
          .slice(0, 100)
          .map((card) => ({
            title: textOf(card.querySelector("#video-title, a#video-title, h3")),
            channel: channelInfo(card).name,
            channelId: channelInfo(card).id,
            videoId: videoInfo(card).id,
            href: videoInfo(card).href,
            decision: card.dataset.cmjHidden ? "hidden" : "shown",
            reason: card.dataset.cmjReason || "",
          }));
        sendResponse({ ok: true, videos });
        return;
      }
      if (msg?.type === "SCAN_ADS") {
        handleAds();
        sendResponse({ ok: true, adStats: adState });
        return;
      }
      if (msg?.type === "BLOCK_VIDEO") {
        const id =
          (msg.linkUrl || "").match(/[?&]v=([^&]+)/)?.[1] ||
          (msg.linkUrl || "").match(/\/shorts\/([^/?#]+)/)?.[1];
        await addRule("video", id);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "BLOCK_CHANNEL") {
        const id = (msg.linkUrl || "").match(/\/channel\/(UC[\w-]+)/i)?.[1];
        await addRule("channel", id || msg.selectionText || "");
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "BLOCK_TEXT") {
        await addRule("text", msg.selectionText || "");
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "CMJ_TOAST") {
        showContentToast(msg.message || "", msg.toastType || "success");
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: "Unknown message" });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  boot();
})();
