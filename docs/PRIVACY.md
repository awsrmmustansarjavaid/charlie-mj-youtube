# Privacy

The extension stores settings locally with `chrome.storage.local`.

The packaged geographic/language JSON files are read locally.

GitHub Data Sync only requests the repository/path configured by the user. It does not upload private settings automatically.

The YouTube Fetch feature reads visible content from the active YouTube tab when requested.

No claim is made that the extension can access or reproduce YouTube's private recommendation algorithm.

## 2.0.0 Data Boundary Note

Data Sync and database exports operate on the `database/` scope. Runtime YouTube Library and mode/profile snapshots are designed for portable synchronization, while generated Chrome `_metadata/` content is excluded.
