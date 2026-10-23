# YouTube Library

The Library manages Channels, Playlists, Favorite Videos, Categories and Collections.

## YouTube metadata

Adding or refreshing a YouTube URL uses the extension service worker to fetch publicly available page metadata. The record keeps the original URL, thumbnail, title, description and additional available fields such as channel, IDs, views, duration, category, keywords, publication data and social metadata where exposed by YouTube.

## Refresh

Each Channel, Playlist and Video card has a manual Refresh action. The Library also supports Refresh YouTube Data for the whole library and configurable stale-data refresh.


## Duplicate protection
Duplicate protection is enabled by default through `settings.preventLibraryDuplicates`. Channels, playlists and videos are checked using stable YouTube IDs and normalized URLs before a new record is created. Duplicate imports are skipped.

## 2.0.0 Library Type Safety Update — 2026-10-23

Library actions are tab-scoped. A Channel tab import/add operation accepts only channels, a Playlist tab accepts only playlists, and Favorite Videos accepts only videos. Mismatched imports are rejected with a clear message. Favorite Videos remain a view of canonical `videos` records so they cannot disappear during save/import normalization.
