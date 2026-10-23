# YouTube Data Refresh

Library refresh is additive and designed to avoid unnecessary requests.

## Manual

- Card-level `Refresh` fetches one saved URL.
- `Refresh YouTube Data` refreshes stale/saved Channels, Playlists and Videos.

## Automatic

Default behavior is enabled with a 24-hour interval and 24-hour stale threshold. Settings can change the interval, startup refresh, Library-open refresh and metadata/statistics/thumbnail refresh flags.

Only saved URLs are refreshed. Missing or invalid URLs are skipped and reported.
