# Charlie MJ YouTube 2.0.0

Charlie MJ YouTube is a lightweight, local-first Chrome MV3 extension for YouTube content intelligence, target country/language control, professional technology learning, language learning, productivity, filtering and a metadata-rich YouTube Library.

![Charlie MJ Language v1.0.0 Stable Beta](assets/Charlie%20MJ%20YouTube%20Extension%20Infographic.png)

## Modes
- **General** — compatibility baseline and general content intelligence.
- **Tech** — professional technology profiles such as DevOps Engineer, Frontend Developer, Backend Developer, Cloud Engineer and Cybersecurity.
- **Language Learning** — learning-language profiles backed by the same 7,000+ master language catalog used throughout the extension.
- **Productivity** — focus and distraction behavior.
- **Custom** — user-defined rules.

## Download

<p align="center">
  <a href="/downloads/Charlie-MJ-YouTube-v1.0.0.zip">
    <img src="https://img.shields.io/badge/%E2%AC%87%20Download%20Chrome%20Extension-2ea44f?style=for-the-badge" alt="Download Chrome Extension Charlie-MJ-YouTube-v1.0.0">
  </a>
</p>

<p align="center">
  <a href="/downloads/Charlie-MJ-YouTube-v2.0.0.zip">
    <img src="https://img.shields.io/badge/%E2%AC%87%20Download%20Chrome%20Extension-2ea44f?style=for-the-badge" alt="Download Chrome Extension Charlie-MJ-YouTube-v2.0.0">
  </a>
</p>

Only one runtime mode is active at a time, preventing mode conflicts.

## Unified language system
`database/languages/languages.json` is the single language source for Target Language, Tech Mode and Language Learning Mode. Country selection can automatically suggest national/official languages using `database/countries/language-map.json`, while manual language selection remains fully available.

## Profile databases
Every packaged Tech profile and Language Learning profile has its own JSON file and index. Runtime-created custom profiles remain in Chrome storage and can be exported independently.

## YouTube Library
The Library provides Channels, Playlists, Favorite Videos, Categories and Collections in a grid-style workspace. Saved YouTube URLs can fetch original thumbnails and publicly available metadata. Channel, playlist and video cards support manual refresh; stale data can also refresh automatically.

## Self-identifying exports
Exports include a clear filename and metadata such as `exportType`, `version`, `exportedAt`, `source` and `items`.

Examples:
- `youtube-library-channel-YYYYMMDD_HHMMSS.json`
- `youtube-library-playlist-YYYYMMDD_HHMMSS.json`
- `youtube-library-video-YYYYMMDD_HHMMSS.json`
- `tech-profile-devops-YYYYMMDD_HHMMSS.json`
- `language-profile-turkish-learning-YYYYMMDD_HHMMSS.json`

## Duplicate protection
YouTube Library duplicate protection is enabled by default and is configurable in **Settings → Data Sync**. Channel, playlist and video saves are checked by stable YouTube IDs and normalized URLs. A duplicate save is rejected with a bottom-right in-app notification instead of creating a second record. Imports also respect the duplicate-protection setting.

## Notifications
User-facing notifications use an in-app bottom-right toast style. The extension does not rely on Chrome desktop notification popups for normal extension events. YouTube-page notifications are rendered inside the YouTube page at the bottom-right.

## Documentation
See the bundled `docs/` directory:

- `ABOUT.md`
- `LANGUAGE-CATALOG.md`
- `PROFILE-DATABASE.md`
- `DATABASE-STRUCTURE.md`
- `LIBRARY.md`
- `EXPORTS.md`
- `REFRESH.md`
- `DEVELOPMENT.md`
- `ARCHITECTURE.md`
- `FEATURES.md`
- `TARGET-FEED.md`
- `PRIVACY.md`
- `TOOLBAR.md`

## Privacy / architecture
No required backend or AI API is needed. Runtime intelligence is local and deterministic. Settings and user library data are stored in Chrome storage. Optional GitHub synchronization remains user-controlled.

## Version
**2.0.0** — Charlie MJ YouTube


## Niches Mode
Niches is a dedicated focused-discovery mode with its own HTML manager, JSON profiles, target country, target language, 7,910-language content catalog, import/export/download/refresh/search controls, and a focused YouTube feed. It is independent from Tech and Language Learning.

## 2.0.0 Data Safety & Sync Update — 2026-10-23

Charlie MJ YouTube keeps YouTube Library data type-safe and database sync scoped.

### YouTube Library type safety
- **Channels** can only receive channel records.
- **Playlists** can only receive playlist records.
- **Favorite Videos** can only receive video records and remain backed by the canonical `videos` collection.
- Importing or adding a different YouTube entity from the wrong Library tab is rejected instead of silently saving it into the wrong database.
- Duplicate protection remains enabled by default.

### Data Sync
- **Select Extension Directory** reads only the selected extension's `database/` directory. Non-database extension files are not uploaded or compared.
- Compare now reports YouTube Library counts for channels, playlists, videos, favorite videos, categories and collections.
- Compare also reports Tech, Language Learning and Niches profile counts and content/file differences.
- GitHub Pull restores runtime Library, mode settings and profile snapshots.
- Prepare for GitHub creates a timestamped ZIP containing only `database/`; Chrome-generated `_metadata/` content is excluded.

### Database Manager
The YouTube Library section has separate exports for **Channels**, **Playlists** and **Videos** instead of one combined button.

All extension release ZIPs use the format `Charlie-MJ-YouTube-v2.0.0-<timestamp>.zip`.
