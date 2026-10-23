(() => {
  if (globalThis.__CMJ_MAIN_BRIDGE__) return;
  globalThis.__CMJ_MAIN_BRIDGE__ = true;

  // MAIN-world bridge. It runs inside the YouTube page so requests carry the
  // user's own cookies/visitor data. It performs localized searches for the
  // Target Feed and reports exactly which strategy worked (or why none did).

  const emit = (type, payload, requestId = null) => {
    try { window.postMessage({ source: "charlie-mj-main", type, payload, requestId }, "*"); } catch (_) {}
  };
  const originalFetch = globalThis.fetch.bind(globalThis);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const textFromRuns = node => {
    if (!node) return "";
    if (typeof node === "string") return node;
    if (typeof node.simpleText === "string") return node.simpleText;
    if (typeof node.content === "string") return node.content;
    if (Array.isArray(node.runs)) return node.runs.map(r => r.text || "").join("");
    return "";
  };

  // Collect videos from both the classic videoRenderer and the newer lockupViewModel.
  const walkVideos = (root, output, seen, depth = 0) => {
    if (!root || typeof root !== "object" || depth > 60) return output;
    if (Array.isArray(root)) { for (const x of root) walkVideos(x, output, seen, depth + 1); return output; }
    for (const key of Object.keys(root)) {
      const value = root[key];
      if (!value || typeof value !== "object") continue;
      if ((key === "videoRenderer" || key === "gridVideoRenderer" || key === "compactVideoRenderer") && value.videoId) {
        const id = value.videoId;
        if (!seen.has(id)) {
          seen.add(id);
          output.push({
            videoId: id,
            title: textFromRuns(value.title),
            channel: textFromRuns(value.ownerText) || textFromRuns(value.longBylineText) || textFromRuns(value.shortBylineText),
            channelUrl: value.ownerText?.runs?.[0]?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || "",
            thumbnail: value.thumbnail?.thumbnails?.at(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            published: textFromRuns(value.publishedTimeText),
            duration: textFromRuns(value.lengthText),
            views: textFromRuns(value.viewCountText) || textFromRuns(value.shortViewCountText),
            source: "youtube-innertube"
          });
        }
      } else if (key === "lockupViewModel" && value.contentId && /VIDEO/.test(String(value.contentType || ""))) {
        const id = value.contentId;
        if (!seen.has(id)) {
          try {
            const meta = value.metadata?.lockupMetadataViewModel;
            const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
            const parts = rows.flatMap(r => (r.metadataParts || []).map(p => textFromRuns(p.text)));
            const overlays = value.contentImage?.thumbnailViewModel?.overlays || [];
            let duration = "";
            for (const o of overlays) {
              const badge = o?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text;
              if (badge) { duration = textFromRuns(badge); break; }
            }
            seen.add(id);
            output.push({
              videoId: id,
              title: textFromRuns(meta?.title),
              channel: parts[0] || "",
              channelUrl: "",
              thumbnail: value.contentImage?.thumbnailViewModel?.image?.sources?.at(-1)?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
              published: parts[2] || "",
              duration,
              views: parts[1] || "",
              source: "youtube-innertube-lockup"
            });
          } catch (_) {}
        }
      }
      walkVideos(value, output, seen, depth + 1);
    }
    return output;
  };

  const ytcfgGet = key => {
    try {
      const c = globalThis.ytcfg;
      return c?.get?.(key) ?? c?.data_?.[key] ?? null;
    } catch (_) { return null; }
  };

  const getConfig = () => {
    const apiKey = ytcfgGet("INNERTUBE_API_KEY");
    const clientVersion = ytcfgGet("INNERTUBE_CLIENT_VERSION");
    if (!apiKey && !clientVersion) return null;
    return {
      apiKey: apiKey || "",
      clientVersion: clientVersion || "",
      clientName: String(ytcfgGet("INNERTUBE_CLIENT_NAME") || "WEB"),
      clientNameId: Number(ytcfgGet("INNERTUBE_CONTEXT_CLIENT_NAME") || 1) || 1,
      visitorData: ytcfgGet("VISITOR_DATA") || ""
    };
  };

  async function waitForConfig(ms = 3000) {
    const start = Date.now();
    let cfg = getConfig();
    while (!cfg && Date.now() - start < ms) { await sleep(250); cfg = getConfig(); }
    return cfg;
  }

  const timedFetch = async (url, options, ms = 12000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try { return await originalFetch(url, { ...options, signal: ctrl.signal }); }
    finally { clearTimeout(timer); }
  };

  // Strategy 1 / 2: YouTube InnerTube search (with and without the "Videos" filter).
  // "GLOBAL" / empty / anything that is not a 2-letter ISO region would make YouTube answer 403 or 0 videos.
  const validGl = c => { const v = String(c || "").toUpperCase(); return /^[A-Z]{2}$/.test(v) ? v : ""; };
  async function innertubeSearch(query, gl, hl, withFilter, cfg) {
    const client = {
      hl, ...(validGl(gl) ? { gl: validGl(gl) } : {}),
      clientName: cfg?.clientName || "WEB",
      clientVersion: cfg?.clientVersion || "2.20261001.00.00",
      originalUrl: location.href,
      platform: "DESKTOP"
    };
    if (cfg?.visitorData) client.visitorData = cfg.visitorData;
    const body = { context: { client, user: { lockedSafetyMode: false }, request: { useSsl: true } }, query };
    // NOTE: this is a JSON body, so the filter must be the plain base64 value.
    // (The previous build sent the URL-encoded "%3D%3D", which YouTube rejects.)
    if (withFilter) body.params = "EgIQAQ==";
    const url = "/youtubei/v1/search?prettyPrint=false" + (cfg?.apiKey ? `&key=${encodeURIComponent(cfg.apiKey)}` : "");
    const headers = {
      "Content-Type": "application/json",
      "X-YouTube-Client-Name": String(cfg?.clientNameId || 1),
      "X-YouTube-Client-Version": client.clientVersion
    };
    if (cfg?.visitorData) headers["X-Goog-Visitor-Id"] = cfg.visitorData;
    const response = await timedFetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const videos = walkVideos(data, [], new Set());
    videos.token = findToken(data);
    return videos;
  }

  function findToken(root, depth = 0) {
    if (!root || typeof root !== "object" || depth > 40) return "";
    if (Array.isArray(root)) { for (let i = root.length - 1; i >= 0; i--) { const t = findToken(root[i], depth + 1); if (t) return t; } return ""; }
    const direct = root.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
    if (direct) return direct;
    for (const k of Object.keys(root)) { const t = findToken(root[k], depth + 1); if (t) return t; }
    return "";
  }

  // Next page of an existing search (infinite scroll).
  async function continueSearch(token, gl, hl) {
    const cfg = await waitForConfig(3000);
    const client = { hl, ...(validGl(gl) ? { gl: validGl(gl) } : {}), clientName: cfg?.clientName || "WEB", clientVersion: cfg?.clientVersion || "2.20261001.00.00", originalUrl: location.href, platform: "DESKTOP" };
    if (cfg?.visitorData) client.visitorData = cfg.visitorData;
    const headers = { "Content-Type": "application/json", "X-YouTube-Client-Name": String(cfg?.clientNameId || 1), "X-YouTube-Client-Version": client.clientVersion };
    if (cfg?.visitorData) headers["X-Goog-Visitor-Id"] = cfg.visitorData;
    const url = "/youtubei/v1/search?prettyPrint=false" + (cfg?.apiKey ? `&key=${encodeURIComponent(cfg.apiKey)}` : "");
    const response = await timedFetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify({ context: { client, user: { lockedSafetyMode: false }, request: { useSsl: true } }, continuation: token }) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return { videos: walkVideos(data, [], new Set()), token: findToken(data) };
  }

  function extractInitialData(html) {
    const markers = ["var ytInitialData = ", "ytInitialData = ", "window[\"ytInitialData\"] = "];
    let start = -1;
    for (const marker of markers) { const i = html.indexOf(marker); if (i >= 0) { start = i + marker.length; break; } }
    if (start < 0) return null;
    while (html[start] && /\s/.test(html[start])) start++;
    if (html[start] !== "{") return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch (_) { return null; } } }
    }
    return null;
  }

  // Strategy 3: the regular search results page (HTML) with explicit gl/hl.
  async function htmlSearch(query, gl, hl) {
    const url = `/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%253D%253D${validGl(gl) ? "&gl=" + validGl(gl) : ""}&hl=${encodeURIComponent(hl)}`;
    const response = await timedFetch(url, { credentials: "include", cache: "no-store", headers: { "Accept": "text/html,application/xhtml+xml" } }, 15000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const data = extractInitialData(html);
    if (!data) throw new Error("no ytInitialData in results page");
    return walkVideos(data, [], new Set());
  }

  async function runSearch(query, gl, hl) {
    const attempts = [];
    const cfg = await waitForConfig(3000);
    const strategies = [
      ["innertube+filter", () => innertubeSearch(query, gl, hl, true, cfg)],
      ["innertube", () => innertubeSearch(query, gl, hl, false, cfg)],
      ["html", () => htmlSearch(query, gl, hl)]
    ];
    for (const [name, fn] of strategies) {
      try {
        const videos = await fn();
        attempts.push({ strategy: name, count: videos.length });
        if (videos.length) return { ok: true, query, strategy: name, attempts, videos: videos.slice(0, 80), token: videos.token || "" };
      } catch (error) {
        attempts.push({ strategy: name, count: 0, error: String(error?.message || error) });
      }
    }
    return { ok: false, query, attempts, error: attempts.map(a => `${a.strategy}: ${a.error || "0 videos"}`).join(" | ") };
  }

  window.addEventListener("message", async event => {
    const msg = event.data;
    if (!msg || msg.source !== "charlie-mj-content") return;
    const requestId = msg.requestId;
    if (msg.type === "CMJ_TARGET_CONTINUE") {
      try {
        const r = await continueSearch(String(msg.payload?.token || ""), validGl(msg.payload?.country), String(msg.payload?.language || "en").toLowerCase());
        emit("CMJ_TARGET_SEARCH_RESULT", { ok: true, videos: r.videos, token: r.token }, requestId);
      } catch (error) { emit("CMJ_TARGET_SEARCH_RESULT", { ok: false, error: String(error?.message || error), videos: [], token: "" }, requestId); }
      return;
    }
    if (msg.type !== "CMJ_TARGET_SEARCH") return;
    try {
      const query = String(msg.payload?.query || "").trim();
      if (!query) throw new Error("Target search query is empty");
      const gl = validGl(msg.payload?.country);
      const hl = String(msg.payload?.language || "en").toLowerCase();
      emit("CMJ_TARGET_SEARCH_RESULT", await runSearch(query, gl, hl), requestId);
    } catch (error) {
      emit("CMJ_TARGET_SEARCH_RESULT", { ok: false, error: String(error?.message || error), attempts: [] }, requestId);
    }
  });

  // Let the isolated-world script know the bridge is alive.
  const announce = () => { const c = getConfig(); if (c) emit("YT_INNERTUBE_CONFIG", c); emit("CMJ_BRIDGE_READY", { at: Date.now() }); };
  announce();
  let bursts = 0;
  const timer = setInterval(() => { announce(); if (++bursts >= 8) clearInterval(timer); }, 1000);
})();
