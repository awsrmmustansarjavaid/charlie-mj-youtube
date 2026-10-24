[← Main README](../README.md) · [Documentation index](README.md)

# Database Structure

```text
database/
├── countries/
│   ├── countries.json
│   ├── language-map.json
│   └── <country>.json
├── languages/
│   └── languages.json
├── tech/
│   ├── index.json
│   └── <profile>.json
├── language-profiles/
│   ├── index.json
│   └── <profile>.json
└── youtube-library/
    ├── channels/
    ├── playlists/
    ├── videos/
    └── collections/
```

Static databases are versioned with the extension. User-owned runtime data is stored in Chrome storage and can be exported.

## Runtime Library Snapshot

`database/youtube-library/library.json` is the runtime snapshot used for portable synchronization. It contains the canonical `channels`, `playlists`, `videos`, `favorites`, `categories` and `collections` arrays. Favorites are derived from canonical video records.

---
[← Main README](../README.md) · [Documentation index](README.md)
