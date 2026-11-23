---
'@kernlize/core': minor
---

The theme module publishes a change to the applets that are open. `themeModule` now returns an api, `ThemeApi` (`kernl.theme.publish(theme)`): it sends `theme.changed` to every applet holding `theme:read` and answers the next `theme.get` with the same palette, so a shell that follows the person's colour scheme keeps the applets matching it (D-064).
