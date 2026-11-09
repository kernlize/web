---
"@kernlize/core": patch
---

`fetchManifestEvent` asks a round of relays once more when every one of them refused the connection, after `MANIFEST_TIMING.retryDelayMs`. A busy public relay answers a websocket upgrade with 502 or 503 for a moment, and one such refusal no longer fails an applet lookup. `ManifestTiming` gains `retryDelayMs`.
