# Charlie MJ YouTube

A Chrome Manifest V3 extension for YouTube productivity, filtering, target-language content controls, local JSON databases, transparent suggestion scoring, notifications, performance monitoring, and GitHub data comparison.

## Features

- Dashboard and modular settings tabs
- **ClearnTube Filters UL** as the single home for all requested YouTube hiding/distraction controls
- Full Control master switch with reversible per-setting preferences
- Country database: `database/countries/countries.json` plus one editable JSON file per country
- Language database: `database/languages/languages.json`
- Whitelist / blacklist datasets
- Target country and target-language settings
- YouTube Shorts/sidebar filtering
- Active-page YouTube video fetch
- Local transparent suggestion scoring
- Performance and notification tabs
- GitHub data compare/pull preview
- JSON-first architecture with no runtime npm dependency
- Chrome Manifest V3
- Charlie MJ YouTube logo assets

## Install locally

1. Extract the ZIP.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extracted `charlie-mj-youtube` folder.
6. Open YouTube and use the extension.

## GitHub data sync

Open **Settings → Data Sync** and enter:
- GitHub owner
- Repository
- Branch
- Data path, for example `database/config/defaults.json`

The extension compares a local JSON dataset with public GitHub data. The Pull action displays remote JSON for review; it intentionally does not overwrite local files automatically because Chrome extensions cannot safely mutate their packaged files at runtime.

For production data updates, publish updated JSON through your GitHub repository and distribute a new extension build or implement an external writable storage/API layer.

## Important YouTube API note

The extension does not pretend to reproduce YouTube's proprietary recommendation algorithm. Its Algorithm tab documents a transparent local scoring model. The Fetch feature reads information visible on the active YouTube page.

If you later add the official YouTube Data API, keep API credentials out of the extension package and use a secure backend for sensitive credentials.

## Project layout

- `src/background/` service worker
- `src/content/` YouTube content script
- `src/options/` full settings application
- `src/popup/` quick controls
- `src/shared/` shared storage helpers
- `database/` JSON datasets
- `assets/icons/` extension branding

## Version

1.0.0

## Updated in this build

- Target Country and Target Language search boxes
- Full language dataset remains available; the UI no longer truncates it
- Country-aware geographic filtering with selected-country signals
- Türkiye/Pakistan/Germany-style country targeting through country + city/region + keyword signals
- Visible save/test notification toasts
- Privacy Rules tab with channel and keyword whitelist/blocklist
- Database Import/Export backup
- More robust YouTube SPA route detection
- YouTube popup no longer reports a hard failure simply because the current tab is not YouTube
- Architecture and feature documentation



## YouTube Ad Control

Charlie MJ YouTube includes a dedicated **YouTube Ad Control** settings tab. It combines:

- Manifest V3 `declarativeNetRequest` network rules for common advertising endpoints initiated by YouTube.
- Cosmetic hiding of YouTube ad slots, overlays, companion ads and feed ad containers.
- Best-effort detection of YouTube video-ad playback state.
- Automatic Skip Ad clicking when available.
- Optional fast-forward/mute assistance for detected ads.
- Basic, Balanced and Aggressive protection modes.
- Local counters for skipped ads and hidden ad UI.
- One-click toolbar enable/disable control.

YouTube ad delivery changes over time, so the extension treats ad blocking as a layered, best-effort feature rather than a permanent guarantee.

## Target Feed Engine

Charlie MJ can optionally run a strict Target Feed mode. The selected country and target language are applied to YouTube's web preference cookie (`gl`/`hl`) without changing the user's permanent Google Account country. The primary Target Feed path now asks YouTube's own InnerTube search endpoint from the already-loaded YouTube page session through a MAIN-world bridge, then ranks returned videos using country, region, city, channel, title and language signals. HTML search parsing remains only a compatibility fallback. In Strict mode, unrelated/unknown results are rejected and the original Home recommendation grid is replaced only after target results are ready.

The Target Feed tab also reports scanned, target, rejected and unknown counts, and each target card exposes the signals used for its local decision. This is still a best-effort feed control layer: YouTube's private recommendation algorithm, account personalization and IP-based location remain outside extension control.

## Floating Toolbar

The YouTube page toolbar is enabled by default and starts bottom-center, above the browser viewport/Windows taskbar area. It can be dragged anywhere, reset to an edge position, auto-hidden, and revealed when the pointer approaches its current position. Its settings live under **Floating Toolbar** in the options page.
