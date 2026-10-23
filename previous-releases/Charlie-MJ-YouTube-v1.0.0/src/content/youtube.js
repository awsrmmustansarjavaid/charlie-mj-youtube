(() => {
  if (globalThis.__CMJ_YOUTUBE_BOOTED__) return;
  globalThis.__CMJ_YOUTUBE_BOOTED__ = true;

  const CMJ = {
    settings: {}, countries: [], country: null, language: null,
    observer: null, routeTimer: null, lastUrl: location.href, languageSignals: { strong: [], common: [] }, targetFeedReady: false, targetFeedLoading: false, targetFeedData: null, mainPageData: null, mainPlayerResponse: null, mainConfig: null, targetRequestWaiters: new Map()
  };

  const CARD_SELECTOR = "ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer";
  const $all = (selector, root = document) => [...root.querySelectorAll(selector)];
  const textOf = (el) => (el?.innerText || el?.textContent || "").trim();
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  const notify = (message) => chrome.runtime.sendMessage({ type: "NOTIFY", title: "Charlie MJ YouTube", message }).catch(() => {});

  async function loadData() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    CMJ.settings = settings;
    const result = await chrome.runtime.sendMessage({ type: "LOAD_FILTER_DATA", countryCode: settings.country || "US" });
    if (!result?.ok) throw new Error(result?.error || "Could not load extension database");
    CMJ.countries = result.countries?.countries || [];
    CMJ.country = result.country || null;
    const lang = await chrome.runtime.sendMessage({ type: "LOAD_LANGUAGE", language: settings.targetLanguage || settings.language || "en" });
    CMJ.language = lang?.language || null;
    CMJ.languageSignals = lang?.signals || { strong: [], common: [] };
  }

  function routeIsHome() {
    const p = location.pathname;
    return p === "/" || p === "/feed/subscriptions";
  }
  // The Target Feed lives on the real Home page only (not Subscriptions, search or watch pages).
  function routeIsTargetHome() { return location.pathname === "/"; }
  function routeIsSupported() {
    const p = location.pathname;
    return routeIsHome() || p === "/shorts" || p === "/feed/trending" || p === "/results" || p === "/watch";
  }

  function channelInfo(card) {
    const a = card.querySelector("ytd-channel-name a, #channel-name a, a.yt-simple-endpoint[href*='/@'], a.yt-simple-endpoint[href*='/channel/']");
    const href = a?.href || "";
    const match = href.match(/\/channel\/(UC[\w-]+)/i);
    return { name: textOf(a) || textOf(card.querySelector("ytd-channel-name,#channel-name")), href, id: match?.[1] || "" };
  }

  function videoInfo(card) {
    const a = card.querySelector("a#thumbnail, a#video-title, a[href*='/watch?v='], a[href*='/shorts/']");
    const href = a?.href || "";
    let id = "";
    try { id = new URL(href, location.origin).searchParams.get("v") || (href.match(/\/shorts\/([^/?#]+)/)?.[1] || ""); } catch (_) {}
    return { id, href };
  }

  function isShort(card) { return !!card.querySelector("a[href^='/shorts/'], ytd-thumbnail-overlay-time-status-renderer[overlay-style='SHORTS']"); }

  function cardText(card) {
    return norm([
      textOf(card.querySelector("#video-title, a#video-title, h3")),
      channelInfo(card).name,
      textOf(card.querySelector("#metadata-line")),
      textOf(card.querySelector("#description, yt-formatted-string")),
      textOf(card.querySelector("#byline-container"))
    ].join(" "));
  }

  function termsForCountry() {
    const c = CMJ.country;
    const terms = [];
    if (c) {
      terms.push(c.name, c.code, c.alpha3, c.capital, ...(c.keywords || []));
      for (const item of (c.regions || [])) terms.push(item.name, item.code);
      for (const item of (c.cities || [])) terms.push(item.name);
    }
    for (const item of (CMJ.settings.countryKeywords || [])) terms.push(item);
    return terms.filter(Boolean).map(norm);
  }

  function termsForLanguage() {
    const l = CMJ.language;
    if (!l) return [];
    return [l.name, l.alpha_2, l.alpha_3, l.terminology, l.bibliographic, ...(CMJ.settings.targetLanguageKeywords || []), ...(CMJ.languageSignals?.strong || []), ...(CMJ.languageSignals?.common || [])].filter(Boolean).map(norm);
  }

  function signalHit(text, term) {
    const t = norm(text);
    const q = norm(term);
    if (!q) return false;
    if (q.includes(" ")) return t.includes(q);
    if (q.length <= 2) return (` ${t.replace(/[^\p{L}\p{N}]+/gu, " ")} `).includes(` ${q} `);
    return (` ${t.replace(/[^\p{L}\p{N}]+/gu, " ")} `).includes(` ${q} `);
  }

  function regexMatch(rule, text) {
    const raw = String(rule || "").trim();
    if (!raw) return false;
    if (raw.startsWith("/") && raw.lastIndexOf("/") > 0) {
      const end = raw.lastIndexOf("/");
      try { return new RegExp(raw.slice(1, end), raw.slice(end + 1).replace(/g/g, "")).test(text); } catch (_) { return false; }
    }
    return text.includes(norm(raw));
  }

  function durationSeconds(card) {
    const raw = textOf(card.querySelector("ytd-thumbnail-overlay-time-status-renderer, #time-status, .ytp-time-duration"));
    if (!raw) return 0;
    const parts = raw.split(":").map(Number);
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
    if (parts.length === 2) return parts[0]*60 + parts[1];
    return parts[0] || 0;
  }

  function looksWatched(card) {
    return !!card.querySelector("ytd-thumbnail-overlay-resume-playback-renderer, ytd-thumbnail-overlay-now-playing-renderer") || card.classList.contains("watched");
  }

  function classify(card) {
    const text = cardText(card);
    const title = norm(textOf(card.querySelector("#video-title, a#video-title, h3")));
    const channel = channelInfo(card);
    const video = videoInfo(card);
    const nChannel = norm(channel.name);
    const duration = durationSeconds(card);
    if (CMJ.settings.hideWatched && looksWatched(card)) return { action: "hide", reason: "watched video", confidence: "high" };
    if (CMJ.settings.minDurationSeconds && duration && duration < Number(CMJ.settings.minDurationSeconds)) return { action: "hide", reason: "below minimum duration", confidence: "high" };
    if (CMJ.settings.maxDurationSeconds && duration && duration > Number(CMJ.settings.maxDurationSeconds)) return { action: "hide", reason: "above maximum duration", confidence: "high" };
    if (CMJ.settings.filterAllCaps) {
      const letters = title.replace(/[^a-zA-Z]/g, "");
      if (letters.length >= 8 && letters === letters.toUpperCase()) return { action: "hide", reason: "ALL-CAPS title", confidence: "medium" };
    }
    const blackChannels = [...(CMJ.settings.blacklistChannels || []), ...(CMJ.settings.blacklistChannelIds || [])].map(norm);
    const whiteChannels = [...(CMJ.settings.whitelistChannels || []), ...(CMJ.settings.whitelistChannelIds || [])].map(norm);
    const blackVideoIds = (CMJ.settings.blacklistVideoIds || []).map(norm);
    const whiteVideoIds = (CMJ.settings.whitelistVideoIds || []).map(norm);

    if (blackVideoIds.includes(norm(video.id))) return { action: "hide", reason: "blocked video ID", confidence: "high" };
    if (whiteVideoIds.includes(norm(video.id))) return { action: "show", reason: "approved video ID", confidence: "high" };
    if (blackChannels.some(x => x && (nChannel === x || nChannel.includes(x) || norm(channel.id) === x))) return { action: "hide", reason: "blocked channel", confidence: "high" };
    if (whiteChannels.some(x => x && (nChannel === x || nChannel.includes(x) || norm(channel.id) === x))) return { action: "show", reason: "approved channel", confidence: "high" };

    const blocked = (CMJ.settings.blacklist || []).map(norm).filter(Boolean);
    const allowed = (CMJ.settings.whitelist || []).map(norm).filter(Boolean);
    const regexRules = CMJ.settings.regexBlockRules || [];
    if (blocked.some(x => text.includes(x)) || regexRules.some(rule => regexMatch(rule, text))) return { action: "hide", reason: "blocked keyword / regex", confidence: "high" };
    if (allowed.some(x => text.includes(x))) return { action: "show", reason: "approved keyword", confidence: "high" };

    if (CMJ.settings.hideShorts && isShort(card)) return { action: "hide", reason: "Shorts disabled", confidence: "high" };

    if (!CMJ.settings.targetFeedEnabled || !routeIsTargetHome()) {
      const countryTerms = termsForCountry();
      const languageTerms = termsForLanguage();
      const countryHits = [...new Set(countryTerms.filter(x => x && text.includes(x)))];
      const languageHits = [...new Set(languageTerms.filter(x => x && text.includes(x)))];
      const hits = [...new Set([...countryHits, ...languageHits])];
      if (hits.length >= 2) return { action: "show", reason: `target signals: ${hits.slice(0, 4).join(", ")}`, confidence: "high" };
      return { action: "show", reason: "target feed disabled", confidence: "neutral" };
    }

    const countryTerms = termsForCountry();
    const languageTerms = termsForLanguage();
    const countryHits = [...new Set(countryTerms.filter(x => x && text.includes(x)))];
    const languageHits = [...new Set(languageTerms.filter(x => x && text.includes(x)))];
    const strongLang = [...new Set((CMJ.languageSignals?.strong || []).map(norm).filter(x => x && text.includes(x)))];
    const commonLang = [...new Set((CMJ.languageSignals?.common || []).map(norm).filter(x => x && text.includes(x)))];
    let score = countryHits.length * 2 + strongLang.length * 3 + Math.min(commonLang.length, 5);
    const requireLanguage = CMJ.settings.targetRequireLanguage !== false;
    const countryMatch = countryHits.length > 0;
    const languageMatch = languageHits.length > 0 || strongLang.length > 0 || commonLang.length >= 2;
    if (countryMatch && languageMatch) score += 4;

    if (requireLanguage) {
      if (countryMatch && languageMatch) return { action: "show", reason: `target country + language: ${[...countryHits,...strongLang,...commonLang].slice(0,5).join(", ")}`, confidence: "high" };
      if (strongLang.length || commonLang.length >= 2) return { action: "show", reason: "target-language signal; country not explicitly named", confidence: "medium" };
    } else if (countryMatch || languageMatch) {
      return { action: "show", reason: "target country/language signal", confidence: countryMatch && languageMatch ? "high" : "medium" };
    }

    const mode = CMJ.settings.targetFeedMode || CMJ.settings.geoMode || "strict";
    if (mode === "strict") return { action: "hide", reason: "not classified as target content", confidence: "low" };
    return { action: "show", reason: `uncertain content kept in ${mode} mode`, confidence: "unknown" };
  }

  function addQuickBlockButton(card) {
    if (!CMJ.settings.quickBlockEnabled || card.dataset.cmjQuickBlock === "1") return;
    const info = videoInfo(card);
    if (!info.id) return;
    const button = document.createElement("button");
    button.type = "button"; button.textContent = "×"; button.title = "Charlie MJ: block this video"; button.className = "cmj-quick-block";
    button.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); addRule("video", info.id); });
    card.style.position = card.style.position || "relative";
    card.appendChild(button); card.dataset.cmjQuickBlock = "1";
  }

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
    return hidden;
  }

  let adState = { skipped: 0, hidden: 0, lastAd: false, savedRate: 1, savedMuted: false };
  let adReportPending = { skipped: 0, hidden: 0 };
  let adReportTimer = null;

  function adEnabled() {
    return CMJ.settings.extensionEnabled !== false && CMJ.settings.adBlockEnabled !== false;
  }

  function reportAdStats() {
    if (!adReportPending.skipped && !adReportPending.hidden) return;
    const payload = { ...adReportPending };
    adReportPending = { skipped: 0, hidden: 0 };
    clearTimeout(adReportTimer);
    adReportTimer = setTimeout(() => chrome.runtime.sendMessage({ type: "AD_BLOCK_STATS", stats: payload }).catch(() => {}), 50);
  }

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
      "ytd-companion-slot-renderer"
    ];
    let hidden = 0;
    $all(selectors.join(",")).forEach(el => {
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

  function handleVideoAd() {
    if (!adEnabled() || CMJ.settings.adBlockVideo === false) return false;
    const player = document.querySelector("#movie_player, ytd-player");
    const video = document.querySelector("video.html5-main-video, video");
    const showing = !!player?.classList.contains("ad-showing") || !!document.querySelector(".ad-showing");
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

    const skip = document.querySelector(".ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-ad-skip-button-modern");
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

  function handleAds() {
    document.documentElement.toggleAttribute("data-cmj-adblock", adEnabled());
    if (!adEnabled()) return;
    handleVideoAd();
    hideYouTubeAdElements();
    reportAdStats();
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#39;"}[ch]));
  }

  // ---------------------------------------------------------------------------
  // Target Feed engine
  // ---------------------------------------------------------------------------
  const TARGET_CACHE_MS = 10 * 60 * 1000;
  const TARGET_RETRY_BACKOFF_MS = 45 * 1000;
  const TARGET_MAX_AUTO_ATTEMPTS = 3;
  const TARGET_LANG_QUERY_KINDS = ["country-language", "language-country", "language", "language-signal"];

  function targetKey() {
    const s = CMJ.settings;
    return [s.country || "", s.targetLanguage || s.language || "", s.targetFeedMode || "strict"].join("|");
  }

  function setTargetView(status, data) {
    CMJ.targetView = { status, data: data || null, version: (CMJ.targetView?.version || 0) + 1 };
    CMJ.targetFeedReady = status === "ready";
    if (status === "ready" && (CMJ.settings.targetFeedMode || "strict") === "strict") document.documentElement.setAttribute("data-cmj-target-strict", "1");
    else document.documentElement.removeAttribute("data-cmj-target-strict");
    if (status === "ready") document.documentElement.setAttribute("data-cmj-target-feed", "ready");
    else document.documentElement.removeAttribute("data-cmj-target-feed");
    mountTargetFeed(true);
  }

  function clearTargetFeed() {
    document.getElementById("cmj-target-feed")?.remove();
    document.documentElement.removeAttribute("data-cmj-target-feed");
    document.documentElement.removeAttribute("data-cmj-target-strict");
    CMJ.targetFeedReady = false;
    CMJ.targetView = null;
  }

  function targetHeadline() {
    const d = CMJ.targetView?.data;
    return `${d?.country || CMJ.country?.name || "Target"} · ${d?.language || CMJ.language?.name || "Language"}`;
  }

  function diagnosticsHtml(d) {
    if (!d) return "";
    const rows = (d.diagnostics || []).map(q => {
      const status = q.error ? `✗ ${escapeHtml(q.error)}` : `✓ ${Number(q.count || 0)} videos (${escapeHtml(q.strategy || "")})`;
      return `<li><b>${escapeHtml(q.query)}</b> — ${status}</li>`;
    }).join("");
    const bg = d.backgroundFallback ? `<li><b>Background fallback</b> — ${Number(d.backgroundFallback.count || 0)} videos${d.backgroundFallback.errors?.length ? " · " + escapeHtml(d.backgroundFallback.errors.slice(0, 3).join(" | ")) : ""}</li>` : "";
    const stats = `Scanned ${Number(d.scanned || 0)} · Shown ${Number(d.videos?.length || 0)} · Wrong language ${Number(d.rejectedLanguage || 0)}`;
    return `<details class="cmj-target-diag"><summary>Search details · ${escapeHtml(stats)}</summary><ul>${rows}${bg}</ul></details>`;
  }

  function cardHtml(v) {
    const t = v.target || {};
    const why = [
      t.countryHits?.length ? `Country: ${t.countryHits.slice(0, 3).join(", ")}` : "",
      t.languageVerdict?.match === true ? `Language: ${t.languageVerdict.reason}` : ""
    ].filter(Boolean).join(" · ") || `Result of the localized "${v.searchQuery || "target"}" search`;
    const href = `/watch?v=${encodeURIComponent(v.videoId)}`;
    return `<article class="cmj-target-card" data-vid="${escapeHtml(v.videoId)}" title="${escapeHtml(why)}"><a href="${href}" class="cmj-target-thumb"><img loading="lazy" src="${escapeHtml(v.thumbnail)}" alt="">${v.duration ? `<span>${escapeHtml(v.duration)}</span>` : ""}</a><a href="${href}" class="cmj-target-title">${escapeHtml(v.title)}</a><div class="cmj-target-channel">${escapeHtml(v.channel)}</div><div class="cmj-target-meta">${escapeHtml(v.views)} ${escapeHtml(v.published)}</div></article>`;
  }

  function observeSentinel(host) {
    CMJ.sentinelObserver?.disconnect();
    const el = host.querySelector("[data-cmj-sentinel]");
    if (!el) return;
    CMJ.sentinelObserver = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMoreTarget(); }, { rootMargin: "1500px 0px" });
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
        let active = more.pages.filter(p => !p.done && p.token);
        if (!active.length && more.pendingSpecs.length) {
          // Out of result pages: start the next native-language searches.
          const specs = more.pendingSpecs.splice(0, 4);
          await runPool(specs, 4, async spec => {
            try {
              const r = await waitForTargetSearch(spec.query, more.hl);
              (r?.videos || []).forEach((item, index) => more.rawVideos.push({ ...item, searchQuery: spec.query, searchKind: spec.kind, searchRank: index }));
              if (r?.token) more.pages.push({ query: spec.query, kind: spec.kind, token: r.token, done: false });
            } catch (_) {}
          });
        } else {
          await runPool(active.slice(0, 4), 4, async page => {
            try {
              const r = await waitForTargetContinue(page.token, more.hl);
              const videos = Array.isArray(r?.videos) ? r.videos : [];
              videos.forEach((item, index) => more.rawVideos.push({ ...item, searchQuery: page.query, searchKind: page.kind, searchRank: index }));
              page.token = r?.token || "";
              if (!page.token || !videos.length) page.done = true;
            } catch (_) { page.failures = (page.failures || 0) + 1; if (page.failures >= 2) page.done = true; }
          });
        }
        const result = classifyTargetResults(more.rawVideos);
        const shown = new Set([...host.querySelectorAll(".cmj-target-card")].map(c => c.dataset.vid));
        const fresh = result.accepted.filter(v => !shown.has(v.videoId));
        if (fresh.length) host.querySelector(".cmj-target-grid")?.insertAdjacentHTML("beforeend", fresh.map(cardHtml).join(""));
        added += fresh.length;
        more.data.videos = result.accepted; more.data.scanned = result.ranked.length; more.data.rejectedLanguage = result.rejectedLanguage;
        if (CMJ.targetCache) CMJ.targetCache.data = more.data;
        const title = host.querySelector(".cmj-target-head span");
        if (title) title.textContent = `${targetHeadline()} · ${result.accepted.length} results`;
        if (!more.pages.some(p => !p.done && p.token) && !more.pendingSpecs.length) { more.exhausted = true; break; }
      }
      const host = document.getElementById("cmj-target-feed");
      const sentinel = host?.querySelector("[data-cmj-sentinel]");
      if (sentinel) sentinel.textContent = more.exhausted ? "No more videos for this country and language." : "Loading more…";
      // Re-observe so the next scroll position triggers another page.
      if (host && !more.exhausted) { CMJ.sentinelObserver?.disconnect(); const el = host.querySelector("[data-cmj-sentinel]"); if (el) CMJ.sentinelObserver.observe(el); }
    } finally { more.loading = false; }
  }

  function paintTargetFeed(host) {
    const view = CMJ.targetView;
    if (!view) return;
    host.dataset.cmjPaint = String(view.version);
    const data = view.data;
    const head = (label, button) => `<div class="cmj-target-head"><div><strong>🎯 Charlie MJ Target Feed</strong><span>${label}</span></div>${button}</div>`;
    if (view.status === "loading") {
      host.innerHTML = head(`${escapeHtml(targetHeadline())} · searching…`, "") + `<div class="cmj-target-empty">Loading ${escapeHtml(targetHeadline())} videos…</div>`;
      return;
    }
    const videos = Array.isArray(data?.videos) ? data.videos : [];
    if (view.status !== "ready" || !videos.length) {
      const why = data?.errors?.length ? `<br><small>${escapeHtml(data.errors.slice(0, 3).join(" | "))}</small>` : "";
      host.innerHTML = head(escapeHtml(targetHeadline()), `<button type="button" data-cmj-refresh>Retry</button>`) +
        `<div class="cmj-target-empty">${data?.scanned ? `YouTube returned ${Number(data.scanned)} videos but none were in the selected language/country.` : `No ${escapeHtml(targetHeadline())} videos could be loaded right now.`} Your normal YouTube feed is left visible so the page is never blank.${why}</div>` + diagnosticsHtml(data);
      return;
    }
    const cards = videos.map(cardHtml).join("");
    const note = "";
    host.innerHTML = head(`${escapeHtml(targetHeadline())} · ${videos.length} results${note}`, `<button type="button" data-cmj-refresh>↻ Refresh</button>`) +
      `<div class="cmj-target-grid">${cards}</div><div class="cmj-target-sentinel" data-cmj-sentinel>Loading more…</div>` + diagnosticsHtml(data);
    host.dataset.cmjShown = String(videos.length);
    observeSentinel(host);
  }

  // Idempotent: creates/re-attaches the feed box and repaints only when the view changed.
  function mountTargetFeed(force = false) {
    if (!routeIsTargetHome() || !CMJ.settings.targetFeedEnabled || !CMJ.targetView) return false;
    const grid = document.querySelector("ytd-browse[page-subtype='home'] ytd-rich-grid-renderer");
    if (!grid) return false;
    let host = document.getElementById("cmj-target-feed");
    if (!host) {
      host = document.createElement("section");
      host.id = "cmj-target-feed";
      host.addEventListener("click", event => {
        if (event.target.closest("[data-cmj-refresh]")) { event.preventDefault(); loadTargetFeed(true); }
      });
    }
    // Mount ABOVE the video grid (never inside the part Strict mode hides).
    const anchor = grid.querySelector(":scope > #contents");
    if (host.parentElement !== grid || (anchor && host.nextElementSibling !== anchor)) grid.insertBefore(host, anchor || null);
    if (force || host.dataset.cmjPaint !== String(CMJ.targetView.version)) paintTargetFeed(host);
    return true;
  }

  // ---- native-language helpers -------------------------------------------------
  const nonLatinName = name => /[^\u0000-ɏ]/.test(String(name || ""));
  const wordTokens = text => String(text || "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  // Whole-word match; for non-Latin scripts also allow a 1–2 letter attached prefix (e.g. Arabic "بمصر").
  function termHit(text, term) {
    const q = norm(term);
    if (!q) return false;
    if (!nonLatinName(q)) return signalHit(text, q);
    if (q.includes(" ")) return text.includes(q);
    return wordTokens(text).some(t => t === q || (t.length <= q.length + 2 && t.endsWith(q)));
  }

  function targetLangCode() {
    return String(CMJ.language?.alpha_2 || CMJ.settings.targetLanguage || CMJ.settings.language || "en").toLowerCase();
  }

  const regionNamesCache = {};
  function nativeRegionName(code, hl) {
    try {
      if (!(hl in regionNamesCache)) regionNamesCache[hl] = new Intl.DisplayNames([hl], { type: "region" });
      const n = regionNamesCache[hl].of(String(code).toUpperCase());
      return n && n.toUpperCase() !== String(code).toUpperCase() ? n : "";
    } catch (_) { return ""; }
  }

  // Short form of the target country in the target language ("المملكة العربية السعودية" -> "السعودية").
  function nativeCountryShort() {
    const full = nativeRegionName(CMJ.settings.country || "US", targetLangCode());
    const words = full.split(/\s+/).filter(Boolean);
    if (words.length > 1 && words.at(-1).length >= 4) return words.at(-1);
    return full;
  }

  function targetCountryTerms() {
    const terms = termsForCountry();
    const full = nativeRegionName(CMJ.settings.country || "US", targetLangCode());
    if (full) terms.push(norm(full));
    const short = nativeCountryShort();
    if (short) terms.push(norm(short));
    return [...new Set(terms.filter(Boolean))];
  }

  function nonTargetTerms() {
    const hl = targetLangCode(), target = String(CMJ.settings.country || "").toUpperCase();
    const key = `${target}|${hl}|${CMJ.countries?.length || 0}`;
    if (CMJ._nonTargetKey === key) return CMJ._nonTarget;
    const list = [];
    for (const c of CMJ.countries || []) {
      if (String(c.code || "").toUpperCase() === target) continue;
      // Full names only (no ISO-3 codes): "can" and "ben" are everyday words in other languages.
      for (const n of [c.name, c.capital]) if (n && String(n).length >= 5) list.push({ label: c.name || c.code, term: n });
      const native = nativeRegionName(c.code, hl);
      if (native && (nonLatinName(native) ? native.length >= 3 : native.length >= 5)) list.push({ label: c.name || c.code, term: native });
    }
    CMJ._nonTargetKey = key; CMJ._nonTarget = list;
    return list;
  }

  function targetCandidateScore(video) {
    const title = String(video?.title || "");
    const text = norm(`${title} ${video?.channel || ""}`);
    const countryHits = [...new Set(targetCountryTerms().filter(x => termHit(text, x)))];
    const lang = CMJ_LANG.verdict(title, targetLangCode());
    const obviousNonTarget = [...new Set(nonTargetTerms().filter(x => termHit(text, x.term)).map(x => x.label))];
    let score = countryHits.length * 4 + (lang.match === true ? 6 : 0);
    if (obviousNonTarget.length && !countryHits.length) score -= 6;
    return {
      score, countryHits, obviousNonTarget, languageVerdict: lang,
      languageMatch: lang.match === true, languageReject: lang.match === false,
      countryMatch: countryHits.length > 0, strongHits: [], commonHits: []
    };
  }

  function waitForTargetContinue(token, language, timeoutMs = 20000) {
    const requestId = `cmj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { CMJ.targetRequestWaiters.delete(requestId); reject(new Error("continuation timed out")); }, timeoutMs);
      CMJ.targetRequestWaiters.set(requestId, { resolve, reject, timer });
      window.postMessage({ source: "charlie-mj-content", type: "CMJ_TARGET_CONTINUE", requestId, payload: { token, country: CMJ.settings.country || "US", language } }, "*");
    });
  }

  function waitForTargetSearch(query, language, timeoutMs = 20000) {
    const requestId = `cmj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { CMJ.targetRequestWaiters.delete(requestId); reject(new Error("page bridge did not answer (reload the YouTube tab)")); }, timeoutMs);
      CMJ.targetRequestWaiters.set(requestId, { resolve, reject, timer });
      window.postMessage({ source: "charlie-mj-content", type: "CMJ_TARGET_SEARCH", requestId, payload: { query, country: CMJ.settings.country || "US", language } }, "*");
    });
  }

  async function runPool(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) { const i = next++; results[i] = await worker(items[i], i); }
    });
    await Promise.all(runners);
    return results;
  }

  function buildTargetQueries(countryName, languageName) {
    const specs = [];
    const add = (query, kind) => {
      const q = String(query || "").trim();
      if (q && !specs.some(item => item.query.toLowerCase() === q.toLowerCase())) specs.push({ query: q, kind });
    };
    const code = targetLangCode();
    const place = nativeCountryShort() || countryName;
    const topics = CMJ_LANG.topics(code);
    if (topics.length) {
      // Native-language searches: "<country in its language> <topic in its language>".
      add(place, "country-language");
      for (const t of topics) add(`${place} ${t}`, "country-language");
      for (const t of topics) add(t, "language");
    } else {
      add(`${countryName} ${languageName}`, "country-language");
      add(`${languageName} ${countryName}`, "language-country");
      add(languageName, "language");
      for (const term of (CMJ.languageSignals?.common || []).filter(x => String(x).length >= 4 && !/\s/.test(String(x))).slice(0, 8)) add(term, "language-signal");
      add(countryName, "country");
    }
    return { round1: specs.slice(0, 10), round2: specs.slice(10, 20) };
  }

  function classifyTargetResults(rawVideos) {
    const unique = new Map();
    for (const video of rawVideos) if (video?.videoId && !unique.has(video.videoId)) unique.set(video.videoId, video);
    const ranked = [...unique.values()].map(video => {
      const target = targetCandidateScore(video);
      return { ...video, target };
    }).sort((a, b) => b.target.score - a.target.score || (a.searchRank || 0) - (b.searchRank || 0));

    // 1) Language gate: drop anything that is clearly NOT in the selected language.
    const requireLanguage = CMJ.settings.targetRequireLanguage !== false;
    const inLanguage = requireLanguage ? ranked.filter(v => !v.target.languageReject) : ranked;
    // 2) Country gate: videos that name a different country (and not ours) go last / are dropped when we have enough.
    const primary = inLanguage.filter(v => !(v.target.obviousNonTarget.length && !v.target.countryMatch));
    const secondary = inLanguage.filter(v => v.target.obviousNonTarget.length && !v.target.countryMatch);
    const accepted = primary.length >= 12 ? primary : [...primary, ...secondary];
    return { ranked, accepted, rejectedLanguage: ranked.length - inLanguage.length, rejectedCountry: inLanguage.length - Math.min(inLanguage.length, accepted.length) };
  }

  async function loadTargetFeed(force = false) {
    if (!routeIsTargetHome() || !CMJ.settings.targetFeedEnabled || CMJ.targetFeedLoading) return;
    if (!force && CMJ.targetFeedReady) return;
    const now = Date.now();
    const key = targetKey();
    if (!force) {
      const cache = CMJ.targetCache;
      if (cache && cache.key === key && now - cache.at < TARGET_CACHE_MS) { setTargetView("ready", cache.data); return; }
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
    const countryName = CMJ.country?.name || CMJ.settings.country || "";
    const languageName = CMJ.language?.name || CMJ.settings.targetLanguage || "";
    const hl = String(CMJ.language?.alpha_2 || CMJ.settings.targetLanguage || CMJ.settings.language || "en").toLowerCase();
    setTargetView("loading", { country: countryName, language: languageName, videos: [] });
    try {
      const { round1, round2 } = buildTargetQueries(countryName, languageName);
      const specs = [...round1];
      const diagnostics = [];
      const rawVideos = [];
      const errors = [];
      const pages = [];   // per-query continuation tokens for infinite scroll

      const runSpecs = list => runPool(list, 4, async spec => {
        try {
          const result = await waitForTargetSearch(spec.query, hl);
          const videos = Array.isArray(result?.videos) ? result.videos : [];
          diagnostics.push({ query: spec.query, kind: spec.kind, count: videos.length, strategy: result?.strategy, error: result?.ok ? "" : (result?.error || "no result") });
          videos.forEach((item, index) => rawVideos.push({ ...item, searchQuery: spec.query, searchKind: spec.kind, searchRank: index }));
          if (result?.token) pages.push({ query: spec.query, kind: spec.kind, token: result.token, done: false });
        } catch (error) {
          diagnostics.push({ query: spec.query, kind: spec.kind, count: 0, error: error.message });
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
        const bg = await chrome.runtime.sendMessage({ type: "GET_TARGET_FEED" }).catch(error => ({ ok: false, errors: [error.message], videos: [] }));
        const videos = Array.isArray(bg?.videos) ? bg.videos : [];
        backgroundFallback = { count: videos.length, errors: bg?.errors || (bg?.error ? [bg.error] : []) };
        videos.forEach((item, index) => rawVideos.push({ ...item, searchKind: item.searchKind || "language", searchRank: index }));
        if (backgroundFallback.errors.length) errors.push(...backgroundFallback.errors);
        result = classifyTargetResults(rawVideos);
      }

      const { ranked, accepted, rejectedLanguage, rejectedCountry } = result;
      const data = {
        ok: true, country: countryName, language: languageName, videos: accepted,
        scanned: ranked.length, targetMatches: accepted.length, rejected: Math.max(0, ranked.length - accepted.length), rejectedLanguage, rejectedCountry,
        queries: specs.map(s => s.query), diagnostics, backgroundFallback, errors: [...new Set(errors)].slice(0, 6)
      };
      CMJ.targetMore = { rawVideos, pages, hl, loading: false, exhausted: false, data, pendingSpecs: specs.length > round1.length ? [] : [...round2] };
      if (accepted.length) {
        CMJ.targetCache = { key, at: Date.now(), data };
        CMJ.targetAttempts = 0;
        setTargetView("ready", data);
      } else {
        console.info("Charlie MJ target feed: no videos matched. Diagnostics:", JSON.stringify({ scanned: ranked.length, rejectedLanguage, diagnostics, backgroundFallback, errors: data.errors }));
        setTargetView("empty", data);
      }
      applyInterfaceControls();
    } catch (error) {
      console.info("Charlie MJ target feed failed:", error?.message || error);
      setTargetView("empty", { videos: [], country: countryName, language: languageName, errors: [String(error?.message || error)] });
    } finally { CMJ.targetFeedLoading = false; }
  }

  function hideBlockedComments() {
    const s = CMJ.settings;
    if (!s.filterComments && !(s.blockedCommentUsers || []).length && !(s.blockedCommentKeywords || []).length) return;
    const users = (s.blockedCommentUsers || []).map(norm).filter(Boolean);
    const words = (s.blockedCommentKeywords || []).map(norm).filter(Boolean);
    $all("ytd-comment-thread-renderer, ytd-comment-view-model, ytd-comment-renderer").forEach(comment => {
      const text = norm(textOf(comment));
      const author = norm(textOf(comment.querySelector("#author-text, #header-author, a[href*='/@']")));
      if (users.some(x => author === x || author.includes(x)) || words.some(x => text.includes(x))) {
        comment.style.display = "none"; comment.dataset.cmjCommentHidden = "1";
      }
    });
  }

  function applyPlayerPreferences() {
    const s = CMJ.settings;
    const video = document.querySelector("video.html5-main-video, video");
    if (video) {
      if (Number.isFinite(Number(s.playbackSpeed)) && Number(s.playbackSpeed) > 0 && Number(s.playbackSpeed) !== 1) video.playbackRate = Number(s.playbackSpeed);
      if (Number(s.volumeBoost) > 1) video.volume = Math.min(1, video.volume * Number(s.volumeBoost));
      if (s.loopVideo) video.loop = true;
    }
    if (s.cinemaMode || s.forceTheaterMode) {
      const btn = document.querySelector("button.ytp-size-button, .ytp-size-button");
      const theater = document.querySelector("#movie_player.ytp-big-mode");
      if (s.forceTheaterMode && btn && !theater) btn.click();
    }
  }

  function applyInterfaceControls() {
    $all("[data-cmj-ui-hidden='1']").forEach(el => { el.style.display = ""; el.removeAttribute("data-cmj-ui-hidden"); });
    const s = CMJ.settings;
    const rules = [];
    const safeHome = routeIsHome() && !(s.targetFeedEnabled && CMJ.targetFeedReady);
    if (s.hideHomeRecommendations && routeIsHome() && !s.targetFeedEnabled) rules.push("ytd-rich-grid-renderer #contents");
    if (s.hideSidebar) rules.push("#guide, #guide-inner");
    if (s.hideComments) rules.push("ytd-comments, #comments");
    if (s.hideLiveChat) rules.push("ytd-live-chat-frame, #chat");
    if (s.hideRecommendations || s.hideEndscreenRecommendations) rules.push("ytd-watch-next-secondary-results-renderer, #related, ytd-reel-shelf-renderer");
    if (s.hideExplore) rules.push("ytd-guide-entry-renderer a[href*='/feed/explore']");
    if (s.hideTrending) rules.push("ytd-guide-entry-renderer a[href*='/feed/trending']");
    if (s.hideSubscriptions) rules.push("ytd-guide-entry-renderer a[href*='/feed/subscriptions']");
    if (s.hideSearchSuggestions) rules.push("ytd-searchbox #suggestions");
    if (s.hideThumbnails) rules.push("ytd-rich-item-renderer #thumbnail, ytd-video-renderer #thumbnail, ytd-grid-video-renderer #thumbnail");
    if (s.hideAds) rules.push("ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-display-ad-renderer, #player-ads");
    if (s.hideFeaturedContent && !safeHome) rules.push("ytd-rich-section-renderer:has(ytd-rich-item-renderer)");
    if (s.hideMembersOnly) rules.push("ytd-members-only-badge");
    if (s.hideMerch) rules.push("ytd-merch-shelf-renderer, ytd-product-list-renderer");
    if (s.hideDonationPromos) rules.push("ytd-donation-shelf-renderer, ytd-statement-banner-renderer");
    if (s.hideMembershipPromos) rules.push("ytd-membership-offer-renderer, ytd-channel-membership-promo-renderer");
    if (s.hideMixes) rules.push("ytd-rich-shelf-renderer:has(a[href*='/watch_videos?video_ids=']), ytd-compact-radio-renderer");
    if (s.hideMusic) rules.push("ytd-guide-entry-renderer a[href*='/music']");
    if (s.hideGaming) rules.push("ytd-guide-entry-renderer a[href*='/gaming']");
    if (s.hideNews) rules.push("ytd-guide-entry-renderer a[href*='/news']");
    if (s.hideMovies) rules.push("ytd-guide-entry-renderer a[href*='/movies']");
    if (s.hideLive) rules.push("ytd-guide-entry-renderer a[href*='/live']");
    if (s.hideStore) rules.push("ytd-guide-entry-renderer a[href*='/store']");
    if (s.hideCommunity) rules.push("ytd-guide-entry-renderer a[href*='/feed/community']");
    if (s.hideChannelTabs) rules.push("ytd-c4-tabbed-header-renderer #tabsContent");
    if (rules.length) $all(rules.join(",")).forEach(el => { el.style.display = "none"; el.dataset.cmjUiHidden = "1"; });
    // Safety rule: never hide the entire Home contents merely because several toggles are enabled.
    if (routeIsHome() && !CMJ.targetFeedReady) {
      $all("ytd-browse[page-subtype='home'] #contents, ytd-browse[page-subtype='home'] #page-manager").forEach(el => { if (el.dataset.cmjUiHidden === "1") { el.style.display = ""; delete el.dataset.cmjUiHidden; } });
    }
    if (s.disableAutoplay) {
      const toggle = document.querySelector(".ytp-autonav-toggle-button");
      if (toggle?.getAttribute("aria-checked") === "true") toggle.click();
    }
    hideBlockedComments();
    applyPlayerPreferences();
  }

  function scan() {
    if (!routeIsSupported()) return;
    if (routeIsTargetHome() && CMJ.settings.targetFeedEnabled) {
      mountTargetFeed();            // re-attach the feed box if YouTube re-rendered the page
      if (!CMJ.targetFeedReady) {
        // Until real target videos exist, leave YouTube's own feed untouched.
        applyInterfaceControls();
        handleAds();
        loadTargetFeed();
        chrome.storage.local.set({ lastYouTubeScan: { at: new Date().toISOString(), videos: 0, hidden: 0, country: CMJ.settings.country || "", route: location.pathname, targetFeed: CMJ.targetView?.status || "loading" } });
        return;
      }
    }
    const cards = $all(CARD_SELECTOR).slice(0, Number(CMJ.settings.maxCardsPerScan || 150));
    let hidden = 0;
    for (const card of cards) if (applyCard(card)) hidden++;
    applyInterfaceControls();
    handleAds();
    chrome.storage.local.set({ lastYouTubeScan: { at: new Date().toISOString(), videos: cards.length, hidden, country: CMJ.settings.country || "", route: location.pathname, targetFeed: CMJ.targetFeedReady ? "ready" : "disabled" } });
  }

  function resetProcessed() {
    $all("[data-cmj-processed='1']").forEach(card => card.removeAttribute("data-cmj-processed"));
  }

  function startObserver() {
    if (CMJ.observer) CMJ.observer.disconnect();
    if (!routeIsSupported()) return;
    CMJ.observer = new MutationObserver(mutations => {
      if (mutations.some(m => m.addedNodes?.length)) requestAnimationFrame(scan);
      else if (adEnabled()) requestAnimationFrame(handleAds);
    });
    CMJ.observer.observe(document.documentElement, { childList: true, subtree: true });
    scan();
    if (routeIsTargetHome() && CMJ.settings.targetFeedEnabled) loadTargetFeed();
  }

  async function addRule(type, value) {
    if (!value) return;
    const { settings = {} } = await chrome.storage.local.get("settings");
    const key = type === "video" ? "blacklistVideoIds" : type === "channel" ? "blacklistChannels" : "blacklist";
    const list = Array.isArray(settings[key]) ? settings[key] : [];
    if (!list.map(norm).includes(norm(value))) list.push(value);
    await chrome.storage.local.set({ settings: { ...settings, [key]: list } });
    await loadData(); resetProcessed(); scan();
    notify(`${type === "video" ? "Video" : type === "channel" ? "Channel" : "Text"} blocked.`);
  }

  async function boot() {
    try {
      await loadData();
      if (CMJ.settings.extensionEnabled === false) return;
      if (routeIsSupported()) startObserver();
    } catch (error) {
      console.error("Charlie MJ YouTube database error", error);
      notify(`Database loading failed: ${error.message}`);
    }
    setInterval(() => { if (adEnabled()) handleAds(); }, 350);
    CMJ.routeTimer = setInterval(() => {
      if (location.href !== CMJ.lastUrl) {
        CMJ.lastUrl = location.href;
        clearTargetFeed();
        CMJ.targetAttempts = 0; CMJ.targetLastAttempt = 0;
        resetProcessed();
        startObserver();
      }
    }, 800);
  }

  chrome.storage.onChanged.addListener(async changes => {
    if (changes.settings) {
      clearTargetFeed();
      CMJ.targetCache = null; CMJ.targetAttempts = 0; CMJ.targetLastAttempt = 0;
      await loadData().catch(console.error);
      resetProcessed();
      startObserver();
    }
  });

  window.addEventListener("message", event => {
    if (event.data?.source === "charlie-mj-main") {
      if (event.data.type === "YT_INITIAL_DATA" || event.data.type === "YT_JSON_DATA" || event.data.type === "YT_FETCH_DATA") CMJ.mainPageData = event.data.payload?.data || event.data.payload;
      if (event.data.type === "YT_PLAYER_RESPONSE") CMJ.mainPlayerResponse = event.data.payload;
      if (event.data.type === "YT_INNERTUBE_CONFIG") CMJ.mainConfig = event.data.payload;
      if (event.data.type === "CMJ_BRIDGE_READY") CMJ.bridgeReady = true;
      if (event.data.type === "CMJ_TARGET_SEARCH_RESULT") {
        const pending = CMJ.targetRequestWaiters.get(event.data.requestId);
        if (pending) { clearTimeout(pending.timer); CMJ.targetRequestWaiters.delete(event.data.requestId); pending.resolve(event.data.payload || {ok:false,error:"No response"}); }
      }
      return;
    }
    if (event.data?.source !== "charlie-mj") return;
    const msg = event.data;
    if (msg.type === "SCAN_YOUTUBE") scan();
    else if (msg.type === "SCAN_ADS") handleAds();
    else if (msg.type === "BLOCK_VIDEO") addRule("video", (msg.linkUrl || location.href).match(/[?&]v=([^&]+)/)?.[1] || (msg.linkUrl || location.href).match(/\/shorts\/([^/?#]+)/)?.[1]);
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg?.type === "SCAN_YOUTUBE") { scan(); sendResponse({ ok: true }); return; }
      if (msg?.type === "GET_VIDEOS") {
        const videos = $all(CARD_SELECTOR).slice(0, 100).map(card => ({
          title: textOf(card.querySelector("#video-title, a#video-title, h3")),
          channel: channelInfo(card).name,
          channelId: channelInfo(card).id,
          videoId: videoInfo(card).id,
          href: videoInfo(card).href,
          decision: card.dataset.cmjHidden ? "hidden" : "shown",
          reason: card.dataset.cmjReason || ""
        }));
        sendResponse({ ok: true, videos }); return;
      }
      if (msg?.type === "SCAN_ADS") { handleAds(); sendResponse({ ok: true, adStats: adState }); return; }
      if (msg?.type === "BLOCK_VIDEO") { const id = (msg.linkUrl || "").match(/[?&]v=([^&]+)/)?.[1] || (msg.linkUrl || "").match(/\/shorts\/([^/?#]+)/)?.[1]; await addRule("video", id); sendResponse({ ok: true }); return; }
      if (msg?.type === "BLOCK_CHANNEL") { const id = (msg.linkUrl || "").match(/\/channel\/(UC[\w-]+)/i)?.[1]; await addRule("channel", id || msg.selectionText || ""); sendResponse({ ok: true }); return; }
      if (msg?.type === "BLOCK_TEXT") { await addRule("text", msg.selectionText || ""); sendResponse({ ok: true }); return; }
      sendResponse({ ok: false, error: "Unknown message" });
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  boot();
})();
