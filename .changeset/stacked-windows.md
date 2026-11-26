---
'@kernlize/modules': minor
'@kernlize/preset': minor
'@kernlize/kernel': minor
---

Add the Stacked layout. It shows one window at a time and temporarily minimises the rest without closing them or changing manual minimise choices. In every layout, `focus: false` keeps the current window in front. The host receives the focus option when opening a new handler. A connected handler can receive a request while hidden, but a fresh hidden handler still needs to be shown before it can connect.
