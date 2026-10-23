# Unified Language Catalog

`database/languages/languages.json` is the single master language catalog and currently contains 7,000+ records.

## Consumers

- Target Language
- Tech Mode content languages
- Language Learning learning language
- Language Learning content languages
- YouTube feed intelligence

`src/shared/language-catalog.js` provides common loading, lookup, filtering and country-language suggestion helpers.

## Country suggestions

`database/countries/language-map.json` maps country codes to national/official language codes. Country selection automatically selects the mapped language(s) in both the single Target/Learning Language field and the multi-select Content Languages field. Users can then manually change, remove or add languages as required. A manual change is not locked or overwritten until the user selects another country or explicitly uses the country-language reset button.


## Mode reuse
Tech Mode and Language Learning Mode consume the same `database/languages/languages.json` catalog through the shared language-catalog module. Country selection uses the country-to-language map to select the relevant language(s) in both target/learning language and content-language controls. Manual changes remain fully editable. Tech Mode stores a dedicated `targetLanguage` plus optional multiple content languages.
