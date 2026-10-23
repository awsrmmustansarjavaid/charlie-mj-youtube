# Charlie MJ YouTube — Architecture

Version remains **1.0.0**.

Application, packaged static JSON databases, and user settings are separated.

- `src/content/`: route-aware YouTube filtering engine
- `src/options/`: settings/dashboard UI
- `src/popup/`: quick controls
- `src/background/`: notifications and lifecycle
- `src/shared/`: storage helpers
- `database/`: country, language, filters and YouTube datasets
- `assets/icons/`: extension identity

The geographic engine is heuristic and transparent. It controls what is visible in the browser; it does not alter YouTube's server-side recommendation algorithm.

## Sync Boundaries

The sync UI separates packaged database content from runtime snapshots. Runtime YouTube Library data is stored in `database/youtube-library/library.json` during Prepare-for-GitHub, while runtime mode/profile snapshots are stored under `database/runtime/`. Chrome-generated `_metadata/` content is never included.
