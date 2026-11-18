---
"@kernlize/core": minor
---

Narrowing a running applet's grant now stops its window (D-038). When a domain the window was started with is taken back, or the applet is blocked, the frame is removed, kehto's binding is revoked, and `host.onRevoked` hears `grant-narrowed` or `blocked`. Granting more stops nothing. New export `grantNarrowingReason`.
