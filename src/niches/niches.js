/**
 * Niches Mode profile manager page.
 *
 * Manages niche profiles (terms, target country and content languages) with the same
 * language catalog used by the other modes.
 */

import { getSettings, saveSettings } from "../shared/core.js";
import {
  loadLanguageCatalog,
  countryDefaults,
  languageKey,
  optionList,
} from "../shared/language-catalog.js";
const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
const stamp = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
const showToast = (m, t = "success") => {
  document.querySelector(".cmj-page-toast")?.remove();
  const n = document.createElement("div");
  n.className = `cmj-page-toast ${t}`;
  n.textContent = m;
  Object.assign(n.style, {
    position: "fixed",
    right: "22px",
    bottom: "22px",
    zIndex: "9999",
    maxWidth: "380px",
    padding: "12px 16px",
    borderRadius: "10px",
    background: t === "error" ? "#da3633" : t === "warn" ? "#9e6a03" : "#238636",
    color: "#fff",
    boxShadow: "0 10px 30px rgba(0,0,0,.35)",
    fontWeight: "650",
  });
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3200);
};
const defaults = [
  "technology",
  "photography",
  "travel",
  "cooking",
  "personal-finance",
  "fitness",
  "books",
  "science",
  "history",
  "cars",
  "gaming",
  "music",
  "fashion",
  "entrepreneurship",
  "productivity-lifestyle-success",
  "business-entrepreneurship",
  "fitness-health-wellness",
  "custom",
];
let profiles = [],
  selected = "technology",
  catalog = { languages: [], languagesByCountry: {} },
  countries = [];
const fallback = {
  technology: {
    name: "Technology",
    description: "Technology, tools and digital trends.",
    categories: {
      Topics: ["technology", "software", "cloud", "AI", "programming", "Linux", "open source"],
      Formats: ["tutorial", "guide", "review", "how to", "tips"],
    },
  },
  photography: {
    name: "Photography",
    description: "Photography, cameras and visual storytelling.",
    categories: {
      Topics: [
        "photography",
        "camera",
        "portrait photography",
        "street photography",
        "landscape photography",
      ],
      Formats: ["tutorial", "review", "editing", "tips"],
    },
  },
  travel: {
    name: "Travel",
    description: "Travel planning, destinations and exploration.",
    categories: {
      Topics: ["travel", "destinations", "tourism", "backpacking", "hotels", "culture"],
      Formats: ["guide", "itinerary", "tips", "vlog"],
    },
  },
  cooking: {
    name: "Cooking",
    description: "Recipes, cooking skills and food.",
    categories: {
      Topics: ["cooking", "recipes", "baking", "meal prep", "kitchen skills"],
      Formats: ["recipe", "tutorial", "tips", "review"],
    },
  },
  "personal-finance": {
    name: "Personal Finance",
    description: "Personal finance and financial education.",
    categories: {
      Topics: ["personal finance", "budgeting", "saving", "investing", "money management"],
      Formats: ["guide", "education", "tips", "explained"],
    },
  },
  fitness: {
    name: "Fitness",
    description: "Fitness, training and healthy routines.",
    categories: {
      Topics: ["fitness", "workout", "strength training", "running", "mobility"],
      Formats: ["workout", "training", "tips", "guide"],
    },
  },
  books: {
    name: "Books & Reading",
    description: "Books, reading and literary discovery.",
    categories: {
      Topics: ["books", "reading", "book review", "literature", "authors"],
      Formats: ["review", "recommendation", "discussion", "analysis"],
    },
  },
  science: {
    name: "Science",
    description: "Science, experiments and discovery.",
    categories: {
      Topics: ["science", "physics", "biology", "chemistry", "space", "astronomy"],
      Formats: ["explained", "documentary", "experiment", "lecture"],
    },
  },
  history: {
    name: "History",
    description: "History, civilizations and historical research.",
    categories: {
      Topics: ["history", "ancient history", "world history", "civilizations", "archaeology"],
      Formats: ["documentary", "lecture", "explained", "analysis"],
    },
  },
  cars: {
    name: "Cars & Automotive",
    description: "Cars, automotive technology and reviews.",
    categories: {
      Topics: ["cars", "automotive", "car review", "electric vehicles", "motorsport"],
      Formats: ["review", "test drive", "guide", "news"],
    },
  },
  gaming: {
    name: "Gaming",
    description: "Games, gaming culture and guides.",
    categories: {
      Topics: ["gaming", "games", "gameplay", "game reviews", "esports"],
      Formats: ["guide", "review", "gameplay", "tips"],
    },
  },
  music: {
    name: "Music",
    description: "Music discovery, theory and performance.",
    categories: {
      Topics: ["music", "music theory", "songs", "instruments", "production"],
      Formats: ["performance", "tutorial", "review", "analysis"],
    },
  },
  fashion: {
    name: "Fashion",
    description: "Fashion, style and design.",
    categories: {
      Topics: ["fashion", "style", "clothing", "design", "outfits"],
      Formats: ["lookbook", "guide", "review", "tips"],
    },
  },
  entrepreneurship: {
    name: "Entrepreneurship",
    description: "Business building, startups and entrepreneurship.",
    categories: {
      Topics: ["entrepreneurship", "startups", "business", "marketing", "leadership"],
      Formats: ["guide", "case study", "interview", "tips"],
    },
  },
  custom: {
    name: "Custom Niche",
    description: "Your custom niche profile.",
    categories: { Topics: [], Formats: [] },
  },
};
/** Normalize packaged/imported niche records into the editor schema. */
function normalizeNicheProfile(raw, fallbackId = "imported-niche") {
  const p = raw && typeof raw === "object" ? { ...raw } : {};
  if (!p.id) p.id = fallbackId;
  if (!p.name) p.name = p.title || p.category || "Imported Niche Profile";
  if (!p.description) p.description = "Imported niche profile.";

  // Current niche database files may use a flat `topics` array.
  if (!p.categories || typeof p.categories !== "object" || Array.isArray(p.categories)) {
    if (Array.isArray(p.topics)) {
      p.categories = { Topics: p.topics };
      if (Array.isArray(p.formats) && p.formats.length) p.categories.Formats = p.formats;
    } else {
      p.categories = {};
    }
  }

  // Also accept the standalone niche-terms JSON format:
  // { categories: [{ category: "...", terms: [...] }, ...] }.
  if (Array.isArray(p.categories)) {
    const mapped = {};
    for (const entry of p.categories) {
      if (!entry || typeof entry !== "object") continue;
      const name = String(entry.category || entry.name || "").trim();
      const terms = Array.isArray(entry.terms)
        ? entry.terms
        : String(entry.line || "").split(":").slice(1).join(":").split(",");
      if (name) mapped[name] = terms.map((x) => String(x).trim()).filter(Boolean);
    }
    p.categories = mapped;
  }

  p.categories = Object.fromEntries(
    Object.entries(p.categories || {}).map(([k, v]) => [
      k, Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [],
    ]),
  );
  return p;
}

/** Load the niche profiles, countries and language catalog. */
async function load() {
  catalog = await loadLanguageCatalog();
  try {
    const r = await fetch(chrome.runtime.getURL("database/countries/countries.json"));
    countries = (await r.json()).countries || [];
  } catch {}
  profiles = [];
  for (const id of defaults) {
    try {
      const r = await fetch(chrome.runtime.getURL(`database/niches/${id}.json`));
      if (r.ok) profiles.push(normalizeNicheProfile(await r.json(), id));
    } catch {}
  }
  const x = await chrome.storage.local.get("nicheProfiles");
  for (const p of x.nicheProfiles || []) {
    const normalized = normalizeNicheProfile(p, p?.id || `imported-${Date.now()}`);
    if (!profiles.some((q) => q.id === normalized.id)) profiles.push(normalized);
  }
  try {
    const s = await getSettings();
    selected = s.modeSettings?.niches?.profileId || selected;
  } catch {}
  renderList();
  select(selected);
}
/** Render the searchable profile list. */
function renderList() {
  const q = ($("#search").value || "").toLowerCase();
  $("#profiles").innerHTML =
    profiles
      .filter((p) =>
        (p.name + " " + p.description + " " + JSON.stringify(p.categories))
          .toLowerCase()
          .includes(q),
      )
      .map(
        (p) =>
          `<div class="profile ${p.id === selected ? "active" : ""}" data-id="${esc(p.id)}"><input class="profileSelect" type="checkbox" data-id="${esc(p.id)}"><strong>${esc(p.name)}</strong><div class="muted">${Object.values(p.categories || {}).flat().length} terms</div></div>`,
      )
      .join("") || '<p class="muted">No profiles found.</p>';
  document.querySelectorAll(".profile").forEach((x) => (x.onclick = () => select(x.dataset.id)));
  document
    .querySelectorAll(".profileSelect")
    .forEach((x) => x.addEventListener("click", (e) => e.stopPropagation()));
}
/** <option> markup for the language picker. */
function langOptions(selected = [], query = "") {
  const set = new Set(
    (Array.isArray(selected) ? selected : [selected]).map(String).map((x) => x.toLowerCase()),
  );
  return optionList(catalog.languages, [...set], query, catalog.languages.length)
    .map(
      (x) =>
        `<option value="${esc(languageKey(x))}" ${set.has(languageKey(x).toLowerCase()) ? "selected" : ""}>${esc(x.name)}${x.alpha_2 ? ` (${esc(x.alpha_2)})` : x.alpha_3 ? ` (${esc(x.alpha_3)})` : ""}</option>`,
    )
    .join("");
}
/** Languages suggested for a country. */
function countryLanguageValues(code) {
  return (countryDefaults(catalog.languages, catalog.languagesByCountry, code) || [])
    .map(languageKey)
    .filter(Boolean);
}
/** Open a profile in the editor. */
async function select(id) {
  selected = id;
  renderList();
  const p = profiles.find((x) => x.id === id) || profiles[0];
  if (!p) return;
  const s = await getSettings(),
    ms = s.modeSettings?.niches || {};
  const country = ms.country || p.country || "GLOBAL";
  const target = ms.targetLanguage || p.targetLanguage || p.contentLanguages?.[0] || "en";
  const content =
    Array.isArray(ms.contentLanguages) && ms.contentLanguages.length
      ? ms.contentLanguages
      : p.contentLanguages || ["en"];
  $("#editor").innerHTML =
    `<h2>${esc(p.name)}</h2><p class="muted">${esc(p.description || "")}</p><div class="grid"><div class="field"><label>Profile ID</label><input id="pid" value="${esc(p.id)}"></div><div class="field"><label>Profile name</label><input id="pname" value="${esc(p.name)}"></div></div><div class="field"><label>Description</label><input id="pdesc" value="${esc(p.description || "")}"></div><div class="grid"><div class="field"><label>Target Country</label><select id="nicheCountry">${countries.map((c) => `<option value="${esc(c.code)}">${esc(c.name)} (${esc(c.code)})</option>`).join("")}</select><button class="btn" id="countryLanguage" type="button" style="margin-top:8px">Use Country Language</button></div><div class="field"><label>Target Language — 7,000+ master catalog</label><input id="nicheTargetSearch" placeholder="Search target language…"><select id="nicheTargetLanguage" class="language-single" size="8"></select></div></div><div class="field"><label>Content Languages — 7,000+ master catalog</label><input id="nicheLangSearch" placeholder="Search content languages…"><select id="nicheContentLanguages" multiple size="8"></select></div><div class="field"><label>Niche terms — one category per line: Category: term, term, term</label><textarea id="terms" rows="20">${esc(
      Object.entries(p.categories || {})
        .map(([k, v]) => `${k}: ${(v || []).join(", ")}`)
        .join("\n"),
    )}</textarea></div><button id="apply">Apply to profile</button><div class="chips">${Object.values(
      p.categories || {},
    )
      .flat()
      .map((x) => `<span class="chip">${esc(x)}</span>`)
      .join("")}</div>`;
  $("#nicheCountry").value = country;
  const targetEl = $("#nicheTargetLanguage"),
    contentEl = $("#nicheContentLanguages");
  targetEl.dataset.selected = JSON.stringify([target]);
  contentEl.dataset.selected = JSON.stringify(content);
  const refreshTarget = () => {
    const v = JSON.parse(targetEl.dataset.selected || "[]");
    targetEl.innerHTML = langOptions(v, $("#nicheTargetSearch").value);
    v.forEach((x) => {
      const o = [...targetEl.options].find((o) => o.value === x);
      if (o) o.selected = true;
    });
  };
  const refreshContent = () => {
    const v = JSON.parse(contentEl.dataset.selected || "[]");
    contentEl.innerHTML = langOptions(v, $("#nicheLangSearch").value);
    v.forEach((x) => {
      const o = [...contentEl.options].find((o) => o.value === x);
      if (o) o.selected = true;
    });
  };
  const remember = (el) => {
    const visible = [...el.options].map((o) => o.value),
      stored = JSON.parse(el.dataset.selected || "[]");
    if (el.multiple) {
      const current = [...el.selectedOptions].map((o) => o.value);
      el.dataset.selected = JSON.stringify([
        ...new Set([...stored.filter((v) => !visible.includes(v)), ...current]),
      ]);
    } else el.dataset.selected = JSON.stringify(el.value ? [el.value] : stored);
  };
  refreshTarget();
  refreshContent();
  $("#nicheTargetSearch").oninput = refreshTarget;
  $("#nicheTargetSearch").onchange = refreshTarget;
  $("#nicheTargetSearch").onsearch = refreshTarget;
  $("#nicheLangSearch").oninput = refreshContent;
  $("#nicheLangSearch").onchange = refreshContent;
  $("#nicheLangSearch").onsearch = refreshContent;
  targetEl.onchange = () => remember(targetEl);
  contentEl.onchange = () => remember(contentEl);
  const applyCountry = () => {
    const keys = countryLanguageValues($("#nicheCountry").value);
    if (!keys.length) {
      showToast("No language mapping is available for this country.", "warn");
      return;
    }
    targetEl.dataset.selected = JSON.stringify([keys[0]]);
    contentEl.dataset.selected = JSON.stringify(keys);
    refreshTarget();
    refreshContent();
    showToast("Niche languages updated from the selected country.");
  };
  $("#nicheCountry").onchange = applyCountry;
  $("#countryLanguage").onclick = applyCountry;
  $("#apply").onclick = apply;
}
/** Copy the editor fields into the selected profile. */
async function apply() {
  const p = profiles.find((x) => x.id === selected);
  if (!p) return;
  p.id = $("#pid")
    .value.trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-");
  p.name = $("#pname").value.trim() || p.id;
  p.description = $("#pdesc").value.trim();
  p.country = $("#nicheCountry").value;
  p.targetLanguage = JSON.parse($("#nicheTargetLanguage").dataset.selected || "[]")[0] || "en";
  p.contentLanguages = JSON.parse($("#nicheContentLanguages").dataset.selected || "[]");
  p.categories = {};
  for (const line of $("#terms").value.split(/\r?\n/)) {
    const [k, ...rest] = line.split(":");
    if (!k || !rest.length) continue;
    p.categories[k.trim()] = rest
      .join(":")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  }
  selected = p.id;
  const cur = await getSettings(),
    ms = JSON.parse(JSON.stringify(cur.modeSettings || {}));
  ms.niches = {
    ...(ms.niches || {}),
    profileId: selected,
    country: p.country,
    targetLanguage: p.targetLanguage,
    contentLanguages: p.contentLanguages,
  };
  await saveSettings({ modeSettings: ms });
  renderList();
  select(selected);
}
$("#save").onclick = async () => {
  await apply();
  await chrome.storage.local.set({
    nicheProfiles: profiles.filter((p) => !defaults.includes(p.id)),
  });
  showToast("Niche profile saved and set as the active Niches Mode profile.");
};
$("#refresh").onclick = load;
$("#search").oninput = renderList;
$("#back").onclick = () => chrome.runtime.openOptionsPage();
$("#add").onclick = () => {
  const id = "custom-" + Date.now();
  profiles.push({
    id,
    name: "New Niche Profile",
    description: "",
    categories: { Topics: [], Formats: [] },
    targetLanguage: "en",
    contentLanguages: ["en"],
  });
  selected = id;
  renderList();
  select(id);
};
$("#edit").onclick = () => apply();
$("#remove").onclick = () => {
  if (defaults.includes(selected)) {
    showToast(
      "Packaged profiles are protected. Create a custom copy to remove it locally.",
      "warn",
    );
    return;
  }
  profiles = profiles.filter((p) => p.id !== selected);
  selected = profiles[0]?.id || "technology";
  renderList();
  select(selected);
};
$("#export").onclick = () => {
  const chosen = [...document.querySelectorAll(".profileSelect:checked")]
    .map((x) => profiles.find((p) => p.id === x.dataset.id))
    .filter(Boolean);
  download(`niche-profile-${chosen[0]?.id || "all"}-${stamp()}.json`, {
    exportType: "niche-profile",
    version: "2.0.0",
    exportedAt: new Date().toISOString(),
    source: "Charlie MJ YouTube",
    items: chosen.length ? chosen : profiles,
  });
};
$("#download").onclick = () =>
  download(`niche-profiles-all-${stamp()}.json`, {
    exportType: "niche-profiles",
    version: "2.0.0",
    exportedAt: new Date().toISOString(),
    source: "Charlie MJ YouTube",
    items: profiles,
  });
$("#import").onclick = () => $("#file").click();
$("#file").onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    let arr;
    if (Array.isArray(data)) arr = data;
    else if (Array.isArray(data.items)) arr = data.items;
    else if (Array.isArray(data.categories) && data.categories.every((x) => x && typeof x === "object")) {
      arr = [{
        id: `imported-niche-${Date.now()}`,
        name: data.name || data.title || "Imported Niche Terms",
        description: data.description || "Imported niche terms.",
        categories: data.categories,
        targetLanguage: "en",
        contentLanguages: ["en"],
      }];
    } else arr = [data];

    const importedProfiles = arr.map((p, i) =>
      normalizeNicheProfile(p, p?.id || `imported-niche-${Date.now()}-${i + 1}`),
    );
    for (const p of importedProfiles) {
      const i = profiles.findIndex((x) => x.id === p.id);
      if (i >= 0) profiles[i] = p;
      else profiles.push(p);
    }
    selected = importedProfiles.at(-1)?.id || selected;
    renderList();
    select(selected);
    showToast(`Niche JSON imported: ${importedProfiles.length} profile(s).`);
  } catch (e) {
    showToast("Import failed: " + e.message, "error");
  }
};
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
