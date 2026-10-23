# Import and Export

Exports are self-identifying JSON documents.

Examples:

- `youtube-library-channel-YYYYMMDD_HHMMSS.json`
- `youtube-library-playlist-YYYYMMDD_HHMMSS.json`
- `youtube-library-video-YYYYMMDD_HHMMSS.json`
- `tech-profile-devops-YYYYMMDD_HHMMSS.json`
- `language-profile-turkish-learning-YYYYMMDD_HHMMSS.json`

Each export includes `exportType`, extension `version`, `exportedAt`, `source` and `items`. This lets import logic identify the intended dataset without relying only on the filename.

## Data Sync Comparison and Exports

The Data Sync page reads only `database/` from the selected extension directory. It can compare local and GitHub YouTube Library counts and Tech, Language Learning and Niches profile counts, while listing local-only, GitHub-only and content-different database paths. The Database Manager provides separate timestamped Channels, Playlists and Videos exports.
