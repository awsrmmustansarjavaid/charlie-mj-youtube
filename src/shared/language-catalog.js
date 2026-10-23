const BASE = 'database/';
let catalogPromise = null;

export async function loadLanguageCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      fetch(chrome.runtime.getURL(`${BASE}languages/languages.json`)).then(r => { if (!r.ok) throw new Error(`Language catalog HTTP ${r.status}`); return r.json(); }),
      fetch(chrome.runtime.getURL(`${BASE}countries/language-map.json`)).then(r => r.ok ? r.json() : ({languagesByCountry:{}})).catch(() => ({languagesByCountry:{}}))
    ]).then(([catalog, countryMap]) => ({
      languages: Array.isArray(catalog.languages) ? catalog.languages : [],
      languagesByCountry: countryMap.languagesByCountry || {}
    }));
  }
  return catalogPromise;
}

export function languageKey(record) {
  return String(record?.alpha_2 || record?.alpha_3 || record?.terminology || record?.bibliographic || '').toLowerCase();
}

export function findLanguage(languages, token) {
  const q = String(token || '').trim().toLowerCase();
  if (!q) return null;
  return languages.find(item => [item.alpha_2,item.alpha_3,item.terminology,item.bibliographic,item.name].filter(Boolean).some(v => String(v).toLowerCase() === q)) || null;
}

export function countryLanguageCodes(map, countryCode) {
  return Array.isArray(map?.[String(countryCode || '').toUpperCase()]) ? [...map[String(countryCode).toUpperCase()]] : [];
}

export function optionList(languages, selected = [], query = '', limit = 600) {
  const source = Array.isArray(languages) ? languages : [];
  const selectedSet = new Set((Array.isArray(selected) ? selected : [selected])
    .filter(x => x != null && x !== '')
    .map(x => String(x).toLowerCase()));
  const q = String(query || '').trim().toLowerCase();
  const filtered = source.filter(item => {
    if (!q) return true;
    return `${item.name || ''} ${item.alpha_2 || ''} ${item.alpha_3 || ''} ${item.terminology || ''} ${item.bibliographic || ''}`
      .toLowerCase()
      .includes(q);
  });
  const selectedRows = filtered.filter(x => selectedSet.has(languageKey(x)));
  const rest = filtered.filter(x => !selectedSet.has(languageKey(x)));
  // Search results must never be truncated: the master catalog is the same
  // 7,910-record dataset used by Target Country & Language.
  const max = q ? source.length : Math.max(0, Number(limit) || source.length);
  return [...selectedRows, ...rest].slice(0, max);
}

export function countryDefaults(languages, map, countryCode) {
  return countryLanguageCodes(map, countryCode).map(code => findLanguage(languages, code)).filter(Boolean);
}
