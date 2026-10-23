async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  return settings;
}

async function getAdStats() {
  const { adStats = {} } = await chrome.storage.local.get("adStats");
  return adStats;
}

const HIDE_CONTROL_KEYS = [
  "hideHomeRecommendations", "hideRecommendations", "hideSidebar", "hideThumbnails", "disableAutoplay", "hideAds",
  "hideShorts", "hideExplore", "hideTrending", "hideSubscriptions", "hideSearchSuggestions",
  "hideComments", "hideLiveChat", "hideEndscreenRecommendations", "hideFeaturedContent", "hideMembersOnly",
  "hideMerch", "hideDonationPromos", "hideMembershipPromos", "hideMixes", "hideCommunity", "hideMusic",
  "hideGaming", "hideNews", "hideMovies", "hideLive", "hideStore", "hideChannelTabs"
];

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
    enabling ? "Complete distraction-control profile enabled." : "Complete distraction-control profile disabled; previous settings restored.",
    enabling ? "success" : "warn"
  );

  // Refresh the live YouTube page when possible so the change takes effect immediately.
  const result = await sendToYouTube({ type: "SCAN_YOUTUBE" });
  if (!result.ok && result.error !== "Open YouTube first") {
    notifyPopup(`Profile saved. YouTube refresh failed: ${result.error}`, "warn");
  }
  await render();
}

async function render() {
  const settings = await getSettings();
  const stats = await getAdStats();
  const { lastYouTubeScan = {} } = await chrome.storage.local.get("lastYouTubeScan");
  const enabled = settings.adBlockEnabled !== false;
  document.querySelector("#adStatus").textContent = enabled ? "YouTube Ad Protection ON" : "YouTube Ad Protection OFF";
  document.querySelector("#adToggle").classList.toggle("on", enabled);
  document.querySelector("#adSkipped").textContent = stats.skipped || 0;
  document.querySelector("#adHidden").textContent = stats.hidden || 0;
  document.querySelector("#videosHidden").textContent = lastYouTubeScan.hidden || 0;
  document.querySelector("#shortsLabel").textContent = settings.hideShorts ? "Filter ON" : "Filter OFF";
  const fullControl = settings.fullControl === true;
  document.querySelector("#fullControlAction")?.classList.toggle("active", fullControl);
  document.querySelector("#fullControlLabel").textContent = fullControl ? "Distraction profile ON" : "Distraction profile OFF";
  document.querySelector("#status").innerHTML = `Country: <b>${settings.country || "—"}</b><br>Language: <b>${settings.targetLanguage || "—"}</b><br>Ad mode: <b>${settings.adBlockMode || "balanced"}</b><br>Shorts: <b>${settings.hideShorts ? "ON" : "OFF"}</b>`;
}

function notifyPopup(message, type = "success") {
  document.querySelector(".popup-toast")?.remove();
  const node = document.createElement("div");
  node.className = `popup-toast ${type}`;
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2600);
}

async function sendToYouTube(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/(?:www\.)?youtube\.com\//i.test(tab.url || "")) {
    notifyPopup("Open a YouTube page first.", "warn");
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
    } catch (error) { result = { ok: false, error: error.message }; }
  }
  if (!result.ok) notifyPopup(`YouTube connection failed: ${result.error}`, "error");
  return result;
}

async function toggleAds() {
  const settings = await getSettings();
  const next = settings.adBlockEnabled === false;
  await chrome.storage.local.set({ settings: { ...settings, adBlockEnabled: next } });
  notifyPopup(next ? "YouTube ad protection enabled." : "YouTube ad protection disabled.", next ? "success" : "warn");
  await sendToYouTube({ type: "SCAN_ADS" });
  await render();
}

document.querySelector("#adToggle").addEventListener("click", toggleAds);

document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", async () => {
  const action = button.dataset.action;
  if (action === "fullcontrol") { await toggleFullControl(); return; }
  if (action === "options") { await chrome.runtime.openOptionsPage(); return; }
  if (action === "openyt") { await chrome.tabs.create({ url: "https://www.youtube.com/" }); return; }
  if (action === "scan") { const r = await sendToYouTube({ type: "SCAN_YOUTUBE" }); notifyPopup(r.ok ? "YouTube scan completed." : r.error, r.ok ? "success" : "error"); await render(); return; }
  if (action === "adscan") { const r = await sendToYouTube({ type: "SCAN_ADS" }); notifyPopup(r.ok ? "Ad protection scan completed." : r.error, r.ok ? "success" : "error"); await render(); return; }
  if (action === "block") { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const r = await sendToYouTube({ type: "BLOCK_VIDEO", linkUrl: tab?.url || "" }); notifyPopup(r.ok ? "Current video added to the blocklist." : (r.error || "Could not block video"), r.ok ? "success" : "error"); return; }
  if (action === "shorts") { const settings = await getSettings(); settings.hideShorts = !settings.hideShorts; await chrome.storage.local.set({ settings }); notifyPopup(`Shorts filter ${settings.hideShorts ? "enabled" : "disabled"}.`); await sendToYouTube({ type: "SCAN_YOUTUBE" }); await render(); }
}));

render();
