# Target Feed Engine

## Purpose

Target Feed combines YouTube's web location/language preferences with local visible-content classification. It does not claim access to YouTube's private recommendation API.

## Flow

1. User selects target country and language.
2. Charlie MJ can set YouTube `PREF` cookie values for `gl` (country) and `hl` (interface language).
3. On YouTube load, the extension reads the selected country database and language signal database.
4. Home/Search/Shorts/Watch cards are scored from visible metadata.
5. Strict mode hides non-target or unknown cards.

## Limitation

YouTube does not expose a reliable public country-of-origin field for every recommendation. A video can therefore be classified using observable signals rather than guaranteed provenance. IP/account personalization remains controlled by YouTube.


## Country → language suggestion

The Target Country & Language settings provide an additional country-language helper. When a country is selected, Charlie MJ suggests a primary language and, where configured, alternative languages. A manual language choice is preserved and is not overwritten by later country changes.


## Current Target Feed architecture

1. The YouTube MAIN-world bridge reads the current `ytcfg` InnerTube configuration.
2. Target searches are sent through YouTube's own `/youtubei/v1/search` endpoint using the active page session, selected `gl` country and `hl` language.
3. Results are ranked using target-country terms, language strong/common signals and explicit non-target country signals.
4. Strict mode requires meaningful target-language evidence and rejects obvious non-target country matches.
5. The original Home recommendation grid is hidden only after a non-empty target result set is ready, preserving the blank-page safety behavior.
6. If the current YouTube page does not expose its InnerTube configuration, the service-worker public-search path remains available as a compatibility fallback.

The extension does not claim access to YouTube's private recommendation algorithm.
