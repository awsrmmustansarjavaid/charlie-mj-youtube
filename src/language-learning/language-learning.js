/**
 * Language Learning profile manager page.
 *
 * Manages language-learning profiles (learning language, content languages, country,
 * goals) with search over the 7,910-language catalog.
 */

import { getSettings, saveSettings } from "../shared/core.js";
import {
  loadLanguageCatalog,
  findLanguage,
  countryDefaults,
  languageKey,
  optionList,
} from "../shared/language-catalog.js";
const showToast = (message, type = "success") => {
  document.querySelector(".cmj-page-toast")?.remove();
  const n = document.createElement("div");
  n.className = `cmj-page-toast ${type}`;
  n.textContent = message;
  Object.assign(n.style, {
    position: "fixed",
    right: "22px",
    bottom: "22px",
    zIndex: "9999",
    maxWidth: "380px",
    padding: "12px 16px",
    borderRadius: "10px",
    background: type === "error" ? "#da3633" : type === "warn" ? "#9e6a03" : "#238636",
    color: "#fff",
    boxShadow: "0 10px 30px rgba(0,0,0,.35)",
    fontWeight: "650",
  });
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3200);
};
const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
let catalog = { languages: [], languagesByCountry: {} },
  profiles = [],
  selected = "custom",
  countries = [];
const PROFILE_IDS = [
  "custom",
  "english-learning",
  "turkish-learning",
  "arabic-learning",
  "spanish-learning",
  "french-learning",
  "german-learning",
];
/** Load the profiles, countries and the 7,910-language catalog. */
async function load() {
  catalog = await loadLanguageCatalog();
  const cr = await fetch(chrome.runtime.getURL("database/countries/countries.json"));
  countries = (await cr.json()).countries || [];
  profiles = [];
  for (const id of PROFILE_IDS) {
    try {
      const r = await fetch(chrome.runtime.getURL(`database/language-profiles/${id}.json`));
      if (r.ok) profiles.push(await r.json());
    } catch {}
  }
  const x = await chrome.storage.local.get("languageProfiles");
  for (const p of x.languageProfiles || []) {
    if (!profiles.some((q) => q.id === p.id)) profiles.push(p);
    else profiles[profiles.findIndex((q) => q.id === p.id)] = p;
  }
  const cur = await getSettings();
  selected = cur.modeSettings?.languageLearning?.profileId || selected;
  renderLanguages();
  renderCountries();
  renderList();
  select(selected);
}
/** Render the language list. */
function renderLanguages() {
  const q = $("#search").value.toLowerCase();
  const selected = $("#language").dataset.value || "";
  const arr = optionList(
    catalog.languages,
    selected ? [selected] : [],
    q,
    catalog.languages.length,
  );
  $("#language").innerHTML =
    '<option value="">Select learning language…</option>' +
    arr
      .map(
        (x) =>
          `<option value="${esc(languageKey(x))}">${esc(x.name)}${x.alpha_2 ? ` (${esc(x.alpha_2)})` : x.alpha_3 ? ` (${esc(x.alpha_3)})` : ""}</option>`,
      )
      .join("");
  if (selected) $("#language").value = selected;
}
/** Render the country list. */
function renderCountries() {
  const opts = countries
    .map((c) => `<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`)
    .join("");
  if ($("#country")) $("#country").innerHTML = opts;
}
/** <option> markup for the language pickers. */
function languageOptions(selected = [], query = "") {
  return optionList(catalog.languages, selected, query, catalog.languages.length)
    .map(
      (x) =>
        `<option value="${esc(languageKey(x))}" ${
          selected
            .map(String)
            .map((v) => v.toLowerCase())
            .includes(languageKey(x))
            ? "selected"
            : ""
        }>${esc(x.name)}${x.alpha_2 ? ` (${esc(x.alpha_2)})` : x.alpha_3 ? ` (${esc(x.alpha_3)})` : ""}</option>`,
    )
    .join("");
}
/** Render the searchable profile list. */
function renderList() {
  const q = $("#search").value.toLowerCase();
  $("#profiles").innerHTML = profiles
    .filter((p) => (p.name + " " + p.learningLanguage).toLowerCase().includes(q) || !q)
    .map(
      (p) =>
        `<div class="profile ${p.id === selected ? "active" : ""}" data-id="${esc(p.id)}"><input class="profileSelect" type="checkbox" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><div class="muted">Learning: ${esc(p.learningLanguage || "not set")}</div></div>`,
    )
    .join("");
  document.querySelectorAll(".profile").forEach((x) => (x.onclick = () => select(x.dataset.id)));
  document
    .querySelectorAll(".profileSelect")
    .forEach((x) => x.addEventListener("click", (e) => e.stopPropagation()));
}
/** Open a profile in the editor. */
function select(id) {
  selected = id;
  renderList();
  const p = profiles.find((x) => x.id === id) || profiles[0];
  if (!p) return;
  $("#language").dataset.value = p.learningLanguage || "";
  $("#languageSearch").value = "";
  renderLanguages();
  $("#language").value = p.learningLanguage || "";
  $("#country").value = p.country || "GLOBAL";
  const langs = p.contentLanguages || [];
  $("#editor").innerHTML =
    `<h2>${esc(p.name)}</h2><div class="grid"><div class="field"><label>Profile ID</label><input id="pid" value="${esc(p.id)}"></div><div class="field"><label>Profile name</label><input id="pname" value="${esc(p.name)}"></div></div><div class="grid"><div class="field"><label>Learning language — full 7,000+ catalog</label><input id="languageSearch" placeholder="Search 7,000+ languages…"><select id="learningLanguageSelect" size="8">${languageOptions(p.learningLanguage ? [p.learningLanguage] : [])}</select></div><div class="field"><label>Content languages — multi-select</label><input id="contentLanguageSearch" placeholder="Search content languages…"><select id="contentLanguages" multiple size="8">${languageOptions(langs)}</select></div></div><div class="field"><label>Target Country</label><select id="country">${countries.map((c) => `<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`).join("")}</select><small class="muted">Changing country automatically suggests its national/official languages; you can freely change them.</small></div><div class="field"><label>Learning Focus: Strict ↔ Relaxed (<span id="focusv">${p.focus ?? 70}</span>)</label><input id="focus" type="range" min="0" max="100" value="${p.focus ?? 70}"></div><div class="field"><label>Goals</label><textarea id="goals" rows="6">${esc((p.goals || []).join("\n"))}</textarea></div><div class="field"><label>Preferred content</label><textarea id="preferred" rows="7">${esc((p.preferredContent || []).join("\n"))}</textarea></div><div class="field"><label>Notes</label><textarea id="notes" rows="5">${esc(p.notes || "")}</textarea></div><button id="apply">Apply</button>`;
  $("#focus").oninput = (e) => ($("#focusv").textContent = e.target.value);
  const learningEl = $("#learningLanguageSelect"),
    contentEl = $("#contentLanguages");
  learningEl.dataset.selected = JSON.stringify(p.learningLanguage ? [p.learningLanguage] : []);
  contentEl.dataset.selected = JSON.stringify(langs);
  const readSelected = (el) => {
    try {
      const parsed = JSON.parse(el?.dataset?.selected || "[]");
      return Array.isArray(parsed) ? parsed.filter(Boolean) : parsed ? [String(parsed)] : [];
    } catch (_) {
      return [];
    }
  };
  const refreshLanguageSelect = (el, input, multi) => {
    if (!el || !input) return;
    const values = readSelected(el);
    el.innerHTML = languageOptions(values, input.value || "");
    values.forEach((v) => {
      const o = [...el.options].find((x) => x.value === String(v));
      if (o) o.selected = true;
    });
  };
  const bindSearch = (inputId, selectEl, multi) => {
    const input = $(inputId);
    if (!input) return;
    const run = () => refreshLanguageSelect(selectEl, input, multi);
    input.addEventListener("input", run);
    input.addEventListener("search", run);
    input.addEventListener("change", run);
  };
  bindSearch("#languageSearch", learningEl, false);
  bindSearch("#contentLanguageSearch", contentEl, true);
  learningEl.onchange = (e) => {
    learningEl.dataset.selected = JSON.stringify(e.target.value ? [e.target.value] : []);
    $("#language").value = e.target.value;
  };
  contentEl.onchange = () => {
    const visible = [...contentEl.options].map((o) => o.value);
    const stored = JSON.parse(contentEl.dataset.selected || "[]").filter(
      (v) => !visible.includes(v),
    );
    const current = [...contentEl.selectedOptions].map((o) => o.value);
    contentEl.dataset.selected = JSON.stringify([...new Set([...stored, ...current])]);
  };
  $("#country").onchange = () => {
    const defaults = countryDefaults(
      catalog.languages,
      catalog.languagesByCountry,
      $("#country").value,
    )
      .map(languageKey)
      .filter(Boolean);
    if (defaults.length) {
      const primary = defaults[0];
      learningEl.innerHTML = languageOptions([primary]);
      learningEl.value = primary;
      learningEl.dataset.selected = JSON.stringify([primary]);
      contentEl.innerHTML = languageOptions(defaults);
      defaults.forEach((v) => {
        const o = [...contentEl.options].find((x) => x.value === String(v));
        if (o) o.selected = true;
      });
      contentEl.dataset.selected = JSON.stringify(defaults);
    }
  };
  $("#apply").onclick = apply;
}
/** Copy the editor fields into the selected profile. */
function apply() {
  const p = profiles.find((x) => x.id === selected);
  if (!p) return;
  p.id = $("#pid")
    .value.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  p.name = $("#pname").value.trim() || p.id;
  p.learningLanguage = $("#learningLanguageSelect").value;
  p.contentLanguages = [...$("#contentLanguages").selectedOptions]
    .map((x) => x.value)
    .filter(Boolean);
  p.country = $("#country").value;
  p.focus = Number($("#focus").value);
  p.goals = $("#goals")
    .value.split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  p.preferredContent = $("#preferred")
    .value.split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  p.notes = $("#notes").value.trim();
  selected = p.id;
  renderList();
}
$("#search").oninput = renderList;
$("#language").onchange = () => {
  const p = profiles.find((x) => x.id === selected);
  if (p) {
    p.learningLanguage = $("#language").value;
    select(selected);
  }
};
$("#save").onclick = async () => {
  apply();
  const custom = profiles.filter((p) => !PROFILE_IDS.includes(p.id));
  await chrome.storage.local.set({ languageProfiles: custom });
  const cur = await getSettings();
  const ms = JSON.parse(JSON.stringify(cur.modeSettings || {}));
  const p = profiles.find((x) => x.id === selected);
  ms.languageLearning = {
    ...(ms.languageLearning || {}),
    profileId: selected,
    learningLanguage: p?.learningLanguage || "",
    contentLanguages: p?.contentLanguages || [],
    country: p?.country || "GLOBAL",
    focus: p?.focus ?? 70,
    goals: p?.goals || [],
  };
  await saveSettings({ modeSettings: ms });
  showToast(
    "Language-learning profiles saved locally. The same 7,000+ master language catalog is shared with Tech Mode.",
  );
};
$("#back").onclick = () => chrome.runtime.openOptionsPage();
$("#refresh").onclick = load;
$("#add").onclick = () => {
  const id = "custom-" + Date.now();
  profiles.push({
    id,
    name: "New Language Profile",
    learningLanguage: "",
    contentLanguages: [],
    country: "GLOBAL",
    goals: ["learn-language", "listening", "vocabulary", "grammar", "conversation"],
    preferredContent: ["subtitles", "lessons", "native-content", "drama", "music"],
    focus: 70,
    notes: "",
  });
  selected = id;
  renderList();
  select(id);
};
$("#remove").onclick = async () => {
  if (PROFILE_IDS.includes(selected)) {
    showToast("Packaged profiles are protected. Create a custom copy to remove it.", "warn");
    return;
  }
  profiles = profiles.filter((p) => p.id !== selected);
  selected = profiles[0]?.id || "custom";
  await chrome.storage.local.set({
    languageProfiles: profiles.filter((p) => !PROFILE_IDS.includes(p.id)),
  });
  renderList();
  select(selected);
};
$("#export").onclick = () => {
  const chosen = [...document.querySelectorAll(".profileSelect:checked")]
    .map((x) => profiles.find((p) => p.id === x.dataset.id))
    .filter(Boolean);
  download(`language-profile-${chosen[0]?.id || "all"}-${stamp()}.json`, {
    exportType: "language-profile",
    version: "2.0.0",
    exportedAt: new Date().toISOString(),
    source: "Charlie MJ YouTube",
    items: chosen.length ? chosen : profiles,
  });
};
$("#download").onclick = () =>
  download(`language-profiles-all-${stamp()}.json`, {
    exportType: "language-profiles",
    version: "2.0.0",
    exportedAt: new Date().toISOString(),
    source: "Charlie MJ YouTube",
    items: profiles,
  });
$("#import").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  try {
    const d = JSON.parse(await e.target.files[0].text());
    for (const p of Array.isArray(d) ? d : d.items || [d])
      if (p?.id) {
        const i = profiles.findIndex((x) => x.id === p.id);
        if (i >= 0) profiles[i] = p;
        else profiles.push(p);
      }
    renderList();
    select(profiles.at(-1).id);
  } catch (e) {
    showToast("Import failed: " + e.message, "error");
  }
};
/** Compact timestamp used in download file names. */
function stamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
/** Download an object as a JSON file. */
function download(n, d) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }),
  );
  a.download = n;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
load();
