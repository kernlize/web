---
'@kernlize/core': minor
---

`KernlHost.onRevoked` takes a third argument, `AppletStopDetails`, so a host can say why an applet stopped without guessing from the reason code. It carries kehto's own `detail` line for a bridge revocation and, for a quarantine, the `limit` crossed: `flood` with its count and window, or `hidden-resource` with its allowance, each with the guard profile in force. The guard pipeline's `onQuarantine` now receives the guard's reason as well.
