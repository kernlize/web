# @kernlize/preset

## 0.2.0

### Minor Changes

- `createMemoryRelays` gives applesauce's real `RelayPool` relays that live in the page: a WebSocket that never leaves memory, answering as NIP-01 relays do from one store every URL shares. It is the first part of `previewPreset` (#75).
- 60c4e73: `previewPreset(options)` runs the real kernel and kernl's own modules offline, over parts that live in the page (D-068). Relays are in memory, and the samples' signed manifests are served by hash for the kernel to verify. Ada and Grace have already written, download programs answer their checks, and web pages and tool searches are refused. `shippedSamples` reads the samples' `samples.json`, and `PREVIEW_CORRESPONDENTS` and `PREVIEW_REPLIES` name the scripted people and what they answer.
