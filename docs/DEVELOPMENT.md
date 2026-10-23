# Development Notes

## Runtime

- Manifest V3.
- Service worker: `src/background/service-worker.js`.
- YouTube content runtime: `src/content/`.
- Settings: `src/options/`.
- Tech manager: `src/tech/`.
- Language Learning manager: `src/language-learning/`.
- Library manager: `src/library/`.
- About page: `src/about/`.

## Compatibility rule

Additive changes should preserve the existing working General, Tech, Language Learning and filtering engines. Packaged JSON is read-only at runtime; user edits belong in Chrome storage or exported files.

## Validation

Before packaging, validate all JSON files and run `node --check` against JavaScript files. Verify ZIP integrity after packaging.
