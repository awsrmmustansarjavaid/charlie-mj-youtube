# Database

All extension datasets are JSON-first.

- `countries/countries.json`: master country index.
- `countries/<iso2>.json`: per-country editable city/region dataset.
- `languages/languages.json`: language index.
- `filters/`: whitelist and blacklist.
- `youtube/`: categories, keywords, channels, trends.
- `config/`: default settings and schema-oriented configuration.

Keep data files valid JSON and increment their `version` when changing their structure.


## User database backup

The Settings → Database tab exports user-controlled `chrome.storage.local` data into a portable JSON backup. Packaged static datasets remain versioned in this directory and are not overwritten at runtime.

## Geographic matching

The extension uses the selected country's name, ISO codes, bundled country cities/regions where available, and user-defined country keywords as geographic signals. Language is treated as a separate signal and is never assumed to prove a video's geographic origin.
