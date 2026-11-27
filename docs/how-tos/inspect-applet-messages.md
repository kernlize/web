# Inspect an applet's messages

Every applet window keeps what it sent to the shell and what the shell sent back, for as long as the window is open. Use it to see which request failed, what an applet asked for, or what the guard did to it.

## In the shell

1. Click **Inspect** in the applet's title bar. When anything has gone wrong, the button carries a count: red when at least one message reports a failure.
2. The list is newest first. Each row shows the time, the direction (`applet → shell`, `shell → applet`, or `guard`), the message type, and a mark:
   - **error**: the message reports a failure. That is a non-empty `error` string, as kehto's runtime puts on a failed `*.result`, or a `*.error` type. The note is what failed, for example `denied: relay:read`.
   - **warning**: the guard refused, limited, flagged or quarantined it. Requests held while the window is minimised or hidden are shown too, without a mark: holding them is normal.
   A burst of matching messages becomes one row with a count, such as `×43`, even when requests, replies and guard entries are interleaved. The shell looks back up to 12 rows for the same direction, type, channel and note, no more than two seconds after the last occurrence. Groups are ordered by their latest message; hover over a count to see when the group started. Errors and guard entries always keep their own rows ([D-077](../decisions.md#d-077)).
3. Open a row to read its latest payload. It stays fixed while the row is open; close and reopen the row to see any update. A string longer than 512 characters, such as a fetched file, keeps its first 64 and says how long it was, bytes say only how many there were, and a list or object keeps its first 50 entries. The log never keeps more than 2000 values of one message. **Problems only** hides everything without a mark.

The log keeps the newest 200 rows per window and counts every message it has seen, including repeats. Guard entries do not add to the message total; they count separately as warnings when marked. The count in the panel and the marks on the button cover the whole time the window has been open, so a failure whose row has gone still shows in the count: with **Problems only** on, the panel then says "No problems among the messages kept." A stopped window keeps its log until it is closed, so the message that stopped it can still be read ([D-058](../decisions.md#d-058)).

Messages can hold private messages, signed events and stored values. The shell keeps them in this page's memory only: nothing is written to storage, and a reload or closing the window clears them.

## In code

`kernl.traffic$` reports every message between the shell's applets and itself. Each `AppletMessage` has `windowId`, `direction` (`from-applet` or `to-applet`), `via` (`window` or `port`), `type`, `error` when it reports a failure, the `message` itself and `at`.

```ts
import { createKernl, type AppletMessage, type KernlHost } from '@kernlize/core';

declare const host: KernlHost;
const kernl = createKernl({ host });

const failures: AppletMessage[] = [];
const watching = kernl.traffic$.subscribe((message) => {
  if (message.error) failures.push(message);
});

// later
watching.unsubscribe();
```

Window-level messages are reported before kehto sees them, so a stray `postMessage` that gets an applet stopped is in the stream. kernl's guard events stay on `kernl.guard.events$`; the shell's inspector shows both. `appletMessageFailure(message)` is the rule `error` comes from, for a host that reads messages from elsewhere.
