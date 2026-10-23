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
