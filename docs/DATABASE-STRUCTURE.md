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
