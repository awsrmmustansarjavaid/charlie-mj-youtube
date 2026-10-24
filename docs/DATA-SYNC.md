[← Main README](../README.md) · [Documentation index](README.md)

# Data Sync

**Settings → Data Sync** connects the extension to a GitHub repository (default `awsrmmustansarjavaid/charlie-mj-youtube`, branch `main`). Only the `database/` folder is ever read or packaged.

## Live Local vs GitHub compare

Press **Compare Local vs GitHub**. A small closable window (X button, `Esc`) shows a table, and the same table stays on the page under **Counts & Differences**.

| Column | Meaning |
| --- | --- |
| Local (live) | What is saved in this browser **right now** (`chrome.storage.local`), not the number of bundled files |
| GitHub | Records found inside the repository files |
| Only local / Only GitHub | Items that exist on one side only |
| Status | `Match` or `Different` |

Rows: Channels, Playlists, Videos, Favorite Videos, Categories, Collections, Tech Profiles, Language Learning Profiles and Niches Profiles. Expand a row below the table to see *which* items differ.

### How counts are produced
- **Local library** — records stored in `youtubeLibrary`. An empty library shows `0`.
- **Local profiles** — profile files shipped with the extension plus custom profiles stored locally.
- **GitHub library** — `database/youtube-library/library.json`, or the per-bucket folders when that file does not exist.
- **GitHub profiles** — profile files under `database/tech/`, `database/language-profiles/`, `database/niches/` plus `database/runtime/profiles.json`.
- Counts do not depend on the selected sync scope.

### File comparison
File-level differences (local only, GitHub only, size different, content different) compare the GitHub tree with either the directory you selected or, if none is selected, the files packaged with the installed extension.

## Other operations
- **Select Extension Directory** — reads only `database/` from the chosen folder.
- **Pull from GitHub** — restores library, mode settings and profile snapshots.
- **Prepare for GitHub** — downloads a timestamped ZIP that contains only `database/`.
- **Download Local-New / Modified Files** — ZIP of files that differ.
- **Export** — JSON snapshot of the local storage.

---
[← Main README](../README.md) · [Documentation index](README.md)
