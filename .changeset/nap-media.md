---
"@kernlize/core": minor
"@kernlize/guard": patch
---

The `media` domain: `kernl.media` lists what applets play and plays a source for them under six settings the person chooses (one at a time or several, pause or end the earlier, videos in a window or in the player, hidden windows, starting on its own, and whether what the shell plays keeps playing, pauses or stops when its applet closes). `createKernlServices` registers it and now needs `host.storage`.

The guard no longer holds back an applet's reports on a media session while its window is hidden; making a session still waits until it is shown.
