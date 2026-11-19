---
"@kernlize/core": minor
---

The person chooses, on their device, the servers that introduce them and find tool servers, the helpers that get their connections through, and the tool families they trust. `kernl.multiplayer` (`createMultiplayerSettings`, kept at `kernl:multiplayer:v1`) holds them, and each comes before the host's. `kernl.multiplayer.discover(input)` finds families from a shared reference, a tool's schema hash or a website, reading only signed announcements and checking every tool's hash again (D-043). `RemoteToolsOptions.registry` and `DirectConnectionsOptions.iceServers` are now read through functions. New exports: `createMultiplayerSettings`, `validFamily`, `discoverToolFamilies`, `TOOL_DISCOVERY_TIMEOUT_MS`, `mergeFamilies`, and their types.
