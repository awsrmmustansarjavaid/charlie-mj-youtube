# Charlie MJ YouTube 2.0.0

Charlie MJ YouTube is a lightweight, local-first Chrome MV3 extension for YouTube content intelligence, target country/language control, professional technology learning, language learning, productivity, filtering and a metadata-rich YouTube Library.

![Charlie MJ Language v1.0.0 Stable Beta](assets/Charlie%20MJ%20YouTube%20Extension%20Infographic.png)

## Modes
- **General** — compatibility baseline and general content intelligence.
- **Tech** — professional technology profiles such as DevOps Engineer, Frontend Developer, Backend Developer, Cloud Engineer and Cybersecurity.
- **Language Learning** — learning-language profiles backed by the same 7,000+ master language catalog used throughout the extension.
- **Productivity** — focus and distraction behavior.
- **Custom** — user-defined rules.
- **Niches** — focused discovery with its own profiles, target country and content languages.

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

## Install (unpacked)
1. Download and unzip the release.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the folder that contains `manifest.json`.
4. Open YouTube. The floating **CMJ** toolbar appears at the bottom of the page.

## Highlights
- **Target Feed** — General, Tech, Language Learning and Niches replace YouTube's Home grid with a feed built from your country, language and profile, with infinite scroll and a `Mode:` subtitle. See [TARGET-FEED](docs/TARGET-FEED.md).
- **Unified language system** — `database/languages/languages.json` (7,910 languages) is the single source for Target Language, Tech, Language Learning and Niches. See [LANGUAGE-CATALOG](docs/LANGUAGE-CATALOG.md).
- **Profile databases** — every packaged Tech, Language Learning and Niches profile is its own JSON file; custom profiles live in Chrome storage. See [PROFILE-DATABASE](docs/PROFILE-DATABASE.md).
- **YouTube Library** — Channels, Playlists, Favorite Videos, Categories and Collections. Each tab accepts only its own item type; duplicates are rejected. See [LIBRARY](docs/LIBRARY.md).
- **Data Sync** — pull from GitHub and compare **live** local data with GitHub in a summary table (counts plus the items that differ). See [DATA-SYNC](docs/DATA-SYNC.md).
- **Self-identifying exports** — files carry `exportType`, `version`, `exportedAt`, `source` and `items`. See [EXPORTS](docs/EXPORTS.md).
- **Notifications** — in-app bottom-right toasts instead of desktop popups.

## Documentation
Start at the [documentation index](docs/README.md).

| Document | Topic |
| --- | --- |
| [ABOUT](docs/ABOUT.md) | What the extension is and is not |
| [FEATURES](docs/FEATURES.md) | Feature matrix |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Runtime parts and data boundaries |
| [TARGET-FEED](docs/TARGET-FEED.md) | Target Feed engine and mode feeds |
| [TOOLBAR](docs/TOOLBAR.md) | Floating toolbar |
| [LANGUAGE-CATALOG](docs/LANGUAGE-CATALOG.md) | 7,910-language master catalog |
| [PROFILE-DATABASE](docs/PROFILE-DATABASE.md) | Tech, Language Learning and Niches profiles |
| [DATABASE-STRUCTURE](docs/DATABASE-STRUCTURE.md) | The `database/` folder |
| [LIBRARY](docs/LIBRARY.md) | YouTube Library |
| [DATA-SYNC](docs/DATA-SYNC.md) | GitHub pull, live compare and counts |
| [EXPORTS](docs/EXPORTS.md) | Export and import formats |
| [REFRESH](docs/REFRESH.md) | Metadata refresh |
| [PRIVACY](docs/PRIVACY.md) | Privacy |
| [DEVELOPMENT](docs/DEVELOPMENT.md) | Development and validation |
| [CODE-STYLE](docs/CODE-STYLE.md) | Formatting and commenting conventions |

## Privacy / architecture
No required backend or AI API is needed. Runtime intelligence is local and deterministic. Settings and user library data are stored in Chrome storage. Optional GitHub synchronization remains user-controlled.

## Version
**2.0.0** — Charlie MJ YouTube. Release ZIPs are named `Charlie-MJ-YouTube-v2.0.0-<timestamp>.zip`.
