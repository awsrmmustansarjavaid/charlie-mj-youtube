# Import and Export

Exports are self-identifying JSON documents.

Examples:

- `youtube-library-channel-YYYYMMDD_HHMMSS.json`
- `youtube-library-playlist-YYYYMMDD_HHMMSS.json`
- `youtube-library-video-YYYYMMDD_HHMMSS.json`
- `tech-profile-devops-YYYYMMDD_HHMMSS.json`
- `language-profile-turkish-learning-YYYYMMDD_HHMMSS.json`

Each export includes `exportType`, extension `version`, `exportedAt`, `source` and `items`. This lets import logic identify the intended dataset without relying only on the filename.
