/**
 * Toolbar popup controller.
 *
 * Shows protection status and quick actions (scan, clean ads, block, shorts, modes,
 * library, settings) and the mode switch. Talks to the active YouTube tab through
 * chrome.tabs.sendMessage.
 */

/** Read the saved settings. */
async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return settings;
}

/** Read the ad statistics shown in the popup. */
async function getAdStats() {
  const { adStats = {} } = await chrome.storage.local.get("adStats");
  return adStats;
}

const HIDE_CONTROL_KEYS = [
  "hideHomeRecommendations",
  "hideRecommendations",
  "hideSidebar",
  "hideThumbnails",
  "disableAutoplay",
  "hideAds",
  "hideShorts",
  "hideExplore",
  "hideTrending",
  "hideSubscriptions",
  "hideSearchSuggestions",
  "hideComments",
  "hideLiveChat",
  "hideEndscreenRecommendations",
  "hideFeaturedContent",
  "hideMembersOnly",
  "hideMerch",
  "hideDonationPromos",
  "hideMembershipPromos",
  "hideMixes",
  "hideCommunity",
  "hideMusic",
  "hideGaming",
  "hideNews",
  "hideMovies",
  "hideLive",
  "hideStore",
  "hideChannelTabs",
];

/** Toggle the Full Control (distraction) profile. */
async function toggleFullControl() {
  const settings = await getSettings();
  const enabling = settings.fullControl !== true;

  if (enabling) {
    // Preserve the user's individual configuration so disabling Full Control restores it.
    const backup = {};
    for (const key of HIDE_CONTROL_KEYS) backup[key] = !!settings[key];
    settings.fullControlBackup = backup;
    for (const key of HIDE_CONTROL_KEYS) settings[key] = true;
    settings.fullControl = true;
  } else {
    const backup = settings.fullControlBackup || {};
    for (const key of HIDE_CONTROL_KEYS) {
      settings[key] = Object.prototype.hasOwnProperty.call(backup, key) ? !!backup[key] : false;
    }
    settings.fullControlBackup = null;
    settings.fullControl = false;
  }

  await chrome.storage.local.set({ settings });
  notifyPopup(
    enabling
      ? "Complete distraction-control profile enabled."
      : "Complete distraction-control profile disabled; previous settings restored.",
    enabling ? "success" : "warn",
  );

  // Refresh the live YouTube page when possible so the change takes effect immediately.
  const result = await sendToYouTube({ type: "SCAN_YOUTUBE" });
  if (!result.ok && result.error !== "Open YouTube first") {
    notifyPopup(`Profile saved. YouTube refresh failed: ${result.error}`, "warn");
  }
  await render();
}

// Country / language that are really in effect: Tech and Language Learning use their own mode settings.
function effectiveGeo(settings) {
  const m = String(settings.activeMode || "general");
  const ms = settings.modeSettings || {};
  const list = (a) =>
    (Array.isArray(a) ? a : []).map((x) => String(x || "").trim()).filter(Boolean);
  const country = (c) => {
    const v = String(c || "").toUpperCase();
    return /^[A-Z]{2}$/.test(v) ? v : "GLOBAL";
  };
  if (m === "tech")
    return {
      country: country(ms.tech?.country),
      language: list(ms.tech?.contentLanguages).join(", ") || "en",
    };
  if (m === "languageLearning") {
    const l = ms.languageLearning || {};
    const langs = [
      ...new Set(
        [String(l.learningLanguage || "").trim(), ...list(l.contentLanguages)].filter(Boolean),
      ),
    ];
    return {
      country: country(l.country),
      language: langs.join(", ") || settings.targetLanguage || "en",
    };
  }
  return {
    country: settings.country || "GLOBAL",
    language: settings.targetLanguage || settings.language || "en",
  };
}

/** Render the popup state. */
async function render() {
  const settings = await getSettings();
  const stats = await getAdStats();
  const { lastYouTubeScan = {} } = await chrome.storage.local.get("lastYouTubeScan");
  const enabled = settings.adBlockEnabled !== false;
  document.querySelector("#adStatus").textContent = enabled
    ? "YouTube Ad Protection ON"
    : "YouTube Ad Protection OFF";
  document.querySelector("#adToggle").classList.toggle("on", enabled);
  document.querySelector("#adSkipped").textContent = stats.skipped || 0;
  document.querySelector("#adHidden").textContent = stats.hidden || 0;
  document.querySelector("#videosHidden").textContent = lastYouTubeScan.hidden || 0;
  document.querySelector("#shortsLabel").textContent = settings.hideShorts
    ? "Filter ON"
    : "Filter OFF";
  const fullControl = settings.fullControl === true;
  document.querySelector("#fullControlAction")?.classList.toggle("active", fullControl);
  document.querySelector("#fullControlLabel").textContent = fullControl
    ? "Distraction profile ON"
    : "Distraction profile OFF";
  const modeSwitch = document.querySelector("#modeSwitch");
  if (modeSwitch) modeSwitch.value = settings.activeMode || "general";
  const geo = effectiveGeo(settings);
  document.querySelector("#status").innerHTML =
    `Mode: <b>${settings.activeMode || "general"}</b><br>Country: <b>${geo.country}</b><br>Language: <b>${geo.language}</b><br>Ad mode: <b>${settings.adBlockMode || "balanced"}</b><br>Shorts: <b>${settings.hideShorts ? "ON" : "OFF"}</b>`;
}

/** Show a message inside the popup. */
function notifyPopup(message, type = "success") {
  document.querySelector(".popup-toast")?.remove();
  const node = document.createElement("div");
  node.className = `popup-toast ${type}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

/** Send a message to the active YouTube tab. */
async function sendToYouTube(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(?:www\.)?youtube\.com\//i.test(tab.url || "")) {
    notifyPopup("Open a YouTube page first.", "warn");
    return { ok: false, error: "Open YouTube first" };
  }
  const send = () =>
    new Promise((resolve) =>
      chrome.tabs.sendMessage(tab.id, message, (response) => {
        const error = chrome.runtime.lastError;
        resolve(error ? { ok: false, error: error.message } : response || { ok: true });
      }),
    );
  let result = await send();
  if (!result.ok && /Receiving end does not exist/i.test(result.error || "")) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["src/content/youtube.js"],
      });
      result = await send();
    } catch (error) {
      result = { ok: false, error: error.message };
    }
  }
  if (!result.ok) notifyPopup(`YouTube connection failed: ${result.error}`, "error");
  return result;
}

/** Toggle YouTube ad protection. */
async function toggleAds() {
  const settings = await getSettings();
  const next = settings.adBlockEnabled === false;
  await chrome.storage.local.set({ settings: { ...settings, adBlockEnabled: next } });
  notifyPopup(
    next ? "YouTube ad protection enabled." : "YouTube ad protection disabled.",
    next ? "success" : "warn",
  );
  await sendToYouTube({ type: "SCAN_ADS" });
  await render();
}

document.querySelector("#adToggle").addEventListener("click", toggleAds);

document.querySelectorAll("[data-action]").forEach((button) =>
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    if (action === "fullcontrol") {
      await toggleFullControl();
      return;
    }
    if (action === "options") {
      await chrome.runtime.openOptionsPage();
      return;
    }
    if (action === "about") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/about/about.html") });
      return;
    }
    if (action === "modes") {
      await chrome.runtime.openOptionsPage();
      return;
    }
    if (action === "library") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/library/library.html") });
      return;
    }
    if (action === "tech") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/tech/tech.html") });
      return;
    }
    if (action === "languageLearning") {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("src/language-learning/language-learning.html"),
      });
      return;
    }
    if (action === "niches") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/niches/niches.html") });
      return;
    }
    if (action === "openyt") {
      await chrome.tabs.create({ url: "https://www.youtube.com/" });
      return;
    }
    if (action === "scan") {
      const r = await sendToYouTube({ type: "SCAN_YOUTUBE", force: true });
      notifyPopup(r.ok ? "YouTube scan completed." : r.error, r.ok ? "success" : "error");
      await render();
      return;
    }
    if (action === "adscan") {
      const r = await sendToYouTube({ type: "SCAN_ADS" });
      notifyPopup(r.ok ? "Ad protection scan completed." : r.error, r.ok ? "success" : "error");
      await render();
      return;
    }
    if (action === "block") {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const r = await sendToYouTube({ type: "BLOCK_VIDEO", linkUrl: tab?.url || "" });
      notifyPopup(
        r.ok ? "Current video added to the blocklist." : r.error || "Could not block video",
        r.ok ? "success" : "error",
      );
      return;
    }
    if (action === "shorts") {
      const settings = await getSettings();
      settings.hideShorts = !settings.hideShorts;
      await chrome.storage.local.set({ settings });
      notifyPopup(`Shorts filter ${settings.hideShorts ? "enabled" : "disabled"}.`);
      await sendToYouTube({ type: "SCAN_YOUTUBE" });
      await render();
    }
  }),
);

render();

const modeSwitch = document.querySelector("#modeSwitch");
modeSwitch?.addEventListener("change", async (e) => {
  const mode = e.target.value;
  const { settings = {} } = await chrome.storage.local.get("settings");
  const modeSettings = { ...(settings.modeSettings || {}) };
  Object.keys(modeSettings).forEach((k) => {
    if (modeSettings[k]) modeSettings[k] = { ...modeSettings[k], enabled: k === mode };
  });
  modeSettings[mode] = { ...(modeSettings[mode] || {}), enabled: true };
  await chrome.storage.local.set({
    settings: { ...settings, activeMode: mode, enabledModes: [mode], modeSettings },
  });
  notifyPopup(`Mode switched to ${mode}. Other modes were disabled to prevent conflicts.`);
  await sendToYouTube({ type: "SCAN_YOUTUBE" });
  render();
});
