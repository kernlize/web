---
"@kernlize/core": minor
---

Applets can open direct sessions between people. Where the page has `RTCPeerConnection`, `createKernl` registers the `webrtc` service as `createDirectConnectionsService`: kehto's service over `createDirectSignaling`, which speaks Paja's `soy-rtc/1` signaling under each window's own key, never the account. A session opens only for an applet granted direct connections, and only after the person allows it in a prompt that says what the other side learns; `ConsentSummary.severity` gains `direct` (D-042). `KernlOptions.directConnections` names the relays that introduce people (the `super` tier by default), STUN and TURN servers (none by default) and a peer factory. New exports: `createDirectConnectionsService`, `createDirectSignaling`, `describeDirectConnection`, `directNamespace`, `DIRECT_SIGNALING_PROFILE`, `DIRECT_SIGNAL_KIND`, `DIRECT_MAX_PAYLOAD_BYTES`, and their option types.
