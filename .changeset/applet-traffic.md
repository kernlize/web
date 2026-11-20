---
'@kernlize/core': minor
---

`kernl.traffic$` reports every message between the shell's applets and itself, both ways, on the window and on the port, with `error` set when a message reports a failure. New exports: `appletMessageFailure`, `describeAppletMessage`, `createAppletTraffic` and the `AppletMessage` types.
