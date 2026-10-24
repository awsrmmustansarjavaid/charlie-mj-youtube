[← Main README](../README.md) · [Documentation index](README.md)

# Profile Database

## Tech profiles

Each Tech profile has its own JSON file under `database/tech/`. The profile index is `database/tech/index.json`.

Examples include DevOps Engineer, Frontend Developer, Backend Developer, Cloud Engineer, Cybersecurity and AI/ML Engineer.

## Language Learning profiles

Each packaged Language Learning profile has its own JSON file under `database/language-profiles/`. The profile index is `database/language-profiles/index.json`.

Runtime-created custom profiles remain in Chrome storage and can be exported as standalone JSON.

## 2.0.0 Data Boundary Note

Data Sync and database exports operate on the `database/` scope. Runtime YouTube Library and mode/profile snapshots are designed for portable synchronization, while generated Chrome `_metadata/` content is excluded.

---
[← Main README](../README.md) · [Documentation index](README.md)
