# About Charlie MJ YouTube

Charlie MJ YouTube 2.0.0 is a local-first Chrome MV3 extension for YouTube content intelligence, technology learning, language learning, productivity controls, filtering and library organization.

## Design goals

- Deterministic and explainable runtime behavior.
- Local JSON datasets and Chrome storage.
- One active runtime mode at a time.
- Reusable country and language intelligence across modes.
- User-controlled imports, exports and GitHub synchronization.

See `src/about/about.html` for the in-extension overview.


## In-app notifications
Normal user-facing notifications are rendered as bottom-right in-app toasts. YouTube-page notifications appear inside the YouTube page; settings, popup and Library pages render their own local toast components.
