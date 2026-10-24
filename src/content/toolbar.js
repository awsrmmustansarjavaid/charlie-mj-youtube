/**
 * Floating toolbar (content script, Shadow DOM).
 *
 * Draws the draggable CMJ toolbar over YouTube: target feed, scan, ad protection,
 * block video, shorts filter and settings. Its position, scale and auto-hide behaviour
 * come from the toolbar* settings.
 */

(() => {
  if (globalThis.__CMJ_TOOLBAR_BOOTED__) return;
  globalThis.__CMJ_TOOLBAR_BOOTED__ = true;

  const state = {
    settings: {},
    host: null,
    wrap: null,
    reveal: null,
    panel: null,
    dragging: false,
    moved: false,
    revealTimer: null,
    mountObserver: null,
  };
  const youtube = () => /^https:\/\/(www\.)?youtube\.com\//i.test(location.href);
  const safeMessage = (message) => {
    try {
      if (!globalThis.chrome?.runtime?.id) return Promise.resolve(null);
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (_) {
      return Promise.resolve(null);
    }
  };
  const getSettings = async () =>
    await new Promise((resolve) => {
      try {
        chrome.storage.local.get("settings", (result) => {
          void chrome.runtime.lastError;
          resolve(result?.settings || {});
        });
      } catch (_) {
        resolve({});
      }
    });
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  /** Place a toolbar element according to the toolbarPosition setting. */
  function positionElement(el) {
    if (!el) return;
    const s = state.settings;
    el.style.left = "";
    el.style.right = "";
    el.style.top = "";
    el.style.bottom = "";
    el.style.transform = "";
    const pos = s.toolbarPosition || "bottom-center";
    if (pos === "bottom-center") {
      el.style.left = "50%";
      el.style.bottom = "16px";
      el.style.transform = "translateX(-50%)";
    } else if (pos === "bottom-left") {
      el.style.left = "16px";
      el.style.bottom = "16px";
    } else if (pos === "bottom-right") {
      el.style.right = "16px";
      el.style.bottom = "16px";
    } else if (pos === "top-center") {
      el.style.left = "50%";
      el.style.top = "16px";
      el.style.transform = "translateX(-50%)";
    } else if (pos === "top-left") {
      el.style.left = "16px";
      el.style.top = "16px";
    } else if (pos === "top-right") {
      el.style.right = "16px";
      el.style.top = "16px";
    } else {
      el.style.left = `${clamp(Number(s.toolbarCustomX) || 24, 4, Math.max(4, innerWidth - 90))}px`;
      el.style.top = `${clamp(Number(s.toolbarCustomY) || Math.max(4, innerHeight - 90), 4, Math.max(4, innerHeight - 70))}px`;
    }
  }

  /** Attach the toolbar styles to its shadow root. */
  function makeStyles(shadow) {
    const style = document.createElement("style");
    style.textContent = `
      :host{all:initial}
      .wrap,.reveal{position:fixed;z-index:2147483647;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
      .wrap{transition:opacity .2s,transform .2s;user-select:none;pointer-events:auto;visibility:visible;display:block;}
      .bar{display:flex;align-items:center;gap:5px;padding:7px;background:rgba(10,15,25,.97);border:1px solid rgba(255,255,255,.2);border-radius:16px;box-shadow:0 10px 35px rgba(0,0,0,.4);backdrop-filter:blur(14px);}
      button{font:600 11px Inter,system-ui,sans-serif;color:#f7f9fc;background:#18243a;border:1px solid #2b3b57;border-radius:10px;padding:8px 10px;cursor:pointer;white-space:nowrap}
      button:hover{background:#243454;border-color:#ff3d68}.brand{color:#ff3d68;font-weight:900;padding:0 6px;cursor:grab}.brand:active{cursor:grabbing}
      .item{position:relative;display:flex}.tooltip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);background:#111827;color:#fff;padding:5px 7px;border-radius:6px;font:500 10px Inter,system-ui,sans-serif;opacity:0;pointer-events:none;white-space:nowrap}.item:hover .tooltip{opacity:1}
      .reveal{width:110px;height:12px;border-radius:12px;background:#ff3d68;box-shadow:0 3px 18px rgba(255,61,104,.35);cursor:pointer;opacity:.9;display:none;pointer-events:auto;visibility:visible;}
      .hidden{opacity:0;pointer-events:none;transform:translateY(14px)}
      .reveal.visible{display:block}
      .toast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%);background:#111827;color:#fff;border:1px solid #2b3b57;border-radius:10px;padding:8px 12px;font:600 12px Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.4);opacity:0;pointer-events:none;transition:opacity .2s;z-index:2147483647;white-space:nowrap}
      .toast.show{opacity:1}.toast.err{border-color:#ff3d68;color:#ffd0da}
    `;
    shadow.appendChild(style);
  }

  /** Create one toolbar button with its tooltip. */
  function button(label, title, handler) {
    const item = document.createElement("span");
    item.className = "item";
    const b = document.createElement("button");
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", handler);
    item.appendChild(b);
    const tip = document.createElement("span");
    tip.className = "tooltip";
    tip.textContent = title;
    item.appendChild(tip);
    return item;
  }

  /** Show a short message above the toolbar. */
  function toast(message, isError = false) {
    const shadow = state.host?.shadowRoot;
    if (!shadow) return;
    let t = shadow.querySelector(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      shadow.appendChild(t);
    }
    t.textContent = message;
    t.classList.toggle("err", !!isError);
    t.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  // Page-side actions are handled by youtube.js (same isolated world) through a DOM CustomEvent.
  function pageAction(type, extra = {}) {
    let answered = false;
    const onResult = (e) => {
      if (e.detail?.type !== type) return;
      answered = true;
      document.removeEventListener("cmj-action-result", onResult);
      const d = e.detail;
      if (!d.ok) toast(d.error || "Action failed", true);
      else if (type === "SCAN_YOUTUBE") toast(`Scan complete · ${d.videos ?? 0} videos checked`);
      else if (type === "SCAN_ADS") toast("Ad protection scan complete");
      else if (type === "BLOCK_VIDEO") toast("Video blocked");
    };
    document.addEventListener("cmj-action-result", onResult);
    if (type === "SCAN_YOUTUBE") toast("Scanning YouTube…");
    document.dispatchEvent(new CustomEvent("cmj-toolbar-action", { detail: { type, ...extra } }));
    setTimeout(() => {
      if (!answered) {
        document.removeEventListener("cmj-action-result", onResult);
        toast("No response from the page script — refresh this YouTube tab", true);
      }
    }, 15000);
  }

  /** Handle a toolbar button click. */
  async function action(type) {
    try {
      if (!chrome?.runtime?.id) throw new Error("Extension was reloaded");
      if (type === "settings") {
        await safeMessage({ type: "OPEN_OPTIONS" });
        return;
      }
      if (type === "target") {
        toast("Applying target feed…");
        await safeMessage({ type: "APPLY_YOUTUBE_PROFILE", reload: true });
        return;
      }
      if (type === "scan") {
        pageAction("SCAN_YOUTUBE");
        return;
      }
      if (type === "ads") {
        pageAction("SCAN_ADS");
        return;
      }
      if (type === "shorts") {
        const s = await getSettings();
        await new Promise((resolve) => {
          try {
            chrome.storage.local.set({ settings: { ...s, hideShorts: !s.hideShorts } }, () => {
              void chrome.runtime.lastError;
              resolve();
            });
          } catch (_) {
            resolve();
          }
        });
        toast(`Shorts filter ${!s.hideShorts ? "ON" : "OFF"}`);
        return;
      }
      if (type === "block") {
        pageAction("BLOCK_VIDEO", { linkUrl: location.href });
      }
    } catch (error) {
      toast(
        /context invalidated|reloaded|Extension/i.test(error?.message || "")
          ? "Extension was updated — refresh this YouTube tab"
          : error?.message || "Action failed",
        true,
      );
    }
  }

  /** Make the toolbar draggable and remember its position. */
  function setupDrag() {
    const drag = state.panel.querySelector(".brand");
    let sx = 0,
      sy = 0,
      ox = 0,
      oy = 0;
    drag.addEventListener("pointerdown", (e) => {
      state.dragging = true;
      state.moved = false;
      sx = e.clientX;
      sy = e.clientY;
      const rect = state.wrap.getBoundingClientRect();
      ox = rect.left;
      oy = rect.top;
      drag.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    drag.addEventListener("pointermove", (e) => {
      if (!state.dragging) return;
      const dx = e.clientX - sx,
        dy = e.clientY - sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true;
      state.wrap.style.left = `${clamp(ox + dx, 4, innerWidth - state.wrap.offsetWidth - 4)}px`;
      state.wrap.style.top = `${clamp(oy + dy, 4, innerHeight - state.wrap.offsetHeight - 4)}px`;
      state.wrap.style.right = "";
      state.wrap.style.bottom = "";
      state.wrap.style.transform = "";
      state.reveal.style.left = `${clamp(ox + dx, 4, innerWidth - 120)}px`;
      state.reveal.style.top = `${clamp(oy + dy + state.wrap.offsetHeight + 8, 4, innerHeight - 16)}px`;
      state.reveal.style.right = "";
      state.reveal.style.bottom = "";
    });
    drag.addEventListener("pointerup", async () => {
      if (!state.dragging) return;
      state.dragging = false;
      if (state.moved) {
        const r = state.wrap.getBoundingClientRect();
        state.settings = {
          ...state.settings,
          toolbarPosition: "custom",
          toolbarCustomX: Math.round(r.left),
          toolbarCustomY: Math.round(r.top),
        };
        await new Promise((resolve) => {
          try {
            chrome.storage.local.set({ settings: state.settings }, () => {
              void chrome.runtime.lastError;
              resolve();
            });
          } catch (_) {
            resolve();
          }
        });
      }
    });
  }

  /** Show the toolbar and restart its auto-hide timer. */
  function show() {
    state.wrap?.classList.remove("hidden");
    state.reveal?.classList.remove("visible");
    clearTimeout(state.revealTimer);
    if (state.settings.toolbarAutoHide !== false) state.revealTimer = setTimeout(hide, 5000);
  }
  /** Hide the toolbar (auto-hide mode). */
  function hide() {
    if (state.settings.toolbarAutoHide === false) return;
    state.wrap?.classList.add("hidden");
    state.reveal?.classList.add("visible");
  }

  /** Create the toolbar inside a Shadow DOM host appended to <html>. */
  function build() {
    if (state.mountObserver) state.mountObserver.takeRecords();
    const oldHost = state.host;
    state.host = null;
    oldHost?.remove();
    if (state.settings.toolbarEnabled === false) return;
    if (state.settings.toolbarShowOnYouTubeOnly !== false && !youtube()) return;
    const host = document.createElement("cmj-floating-toolbar");
    host.id = "cmj-floating-toolbar";
    host.style.cssText =
      "position:fixed !important;left:0 !important;top:0 !important;width:100vw !important;height:100vh !important;z-index:2147483647 !important;pointer-events:none !important;margin:0 !important;padding:0 !important;border:0 !important;background:transparent !important;display:block !important;visibility:visible !important;opacity:1 !important;overflow:visible !important;";
    const shadow = host.attachShadow({ mode: "open" });
    makeStyles(shadow);
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    const bar = document.createElement("div");
    bar.className = "bar";
    const brand = document.createElement("span");
    brand.className = "brand";
    brand.textContent = "CMJ";
    brand.title = "Drag Charlie MJ toolbar";
    bar.appendChild(brand);
    bar.appendChild(button("🎯", "Apply Target Feed", () => action("target")));
    bar.appendChild(button("↻", "Scan YouTube", () => action("scan")));
    bar.appendChild(button("🛡", "Ad Protection", () => action("ads")));
    bar.appendChild(button("🚫", "Block Current Video", () => action("block")));
    bar.appendChild(button("◉", "Toggle Shorts Filter", () => action("shorts")));
    bar.appendChild(button("⚙", "Settings", () => action("settings")));
    wrap.appendChild(bar);
    const reveal = document.createElement("div");
    reveal.className = "reveal";
    reveal.title = "Show Charlie MJ toolbar";
    reveal.addEventListener("mouseenter", show);
    reveal.addEventListener("click", show);
    shadow.appendChild(wrap);
    shadow.appendChild(reveal);
    document.documentElement.appendChild(host);
    state.host = host;
    state.wrap = wrap;
    state.panel = bar;
    state.reveal = reveal;
    wrap.style.zoom = String(state.settings.toolbarScale || 1);
    reveal.style.zoom = String(state.settings.toolbarScale || 1);
    positionElement(wrap);
    positionElement(reveal);
    setupDrag();
    host.addEventListener("mouseenter", show);
    show();
    if (!state.mountObserver) {
      state.mountObserver = new MutationObserver(() => {
        if (state.host && !document.documentElement.contains(state.host)) {
          try {
            document.documentElement.appendChild(state.host);
          } catch (_) {}
        }
      });
      state.mountObserver.observe(document.documentElement, { childList: true, subtree: false });
    }
  }

  document.addEventListener(
    "mousemove",
    (e) => {
      if (
        !state.wrap ||
        !state.settings.toolbarAutoHide ||
        !state.wrap.classList.contains("hidden")
      )
        return;
      const r = state.wrap.getBoundingClientRect();
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      if (Math.hypot(dx, dy) <= Number(state.settings.toolbarRevealDistance || 120)) show();
    },
    { passive: true },
  );
  window.addEventListener("resize", () => {
    positionElement(state.wrap);
    positionElement(state.reveal);
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.settings) {
      state.settings = { ...state.settings, ...changes.settings.newValue };
      build();
    }
  });
  const fallbackSettings = {
    toolbarEnabled: true,
    toolbarShowOnYouTubeOnly: true,
    toolbarAutoHide: false,
    toolbarRevealDistance: 120,
    toolbarPosition: "bottom-center",
    toolbarCustomX: null,
    toolbarCustomY: null,
    toolbarScale: 1,
  };
  getSettings()
    .then((s) => {
      state.settings = { ...fallbackSettings, ...s };
      build();
    })
    .catch(() => {
      state.settings = { ...fallbackSettings };
      build();
    });
})();
