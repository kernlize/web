# Inspect an applet's messages

Every applet window keeps what it sent to the shell and what the shell sent back, for as long as the window is open. Use it to see which request failed, what an applet asked for, or what the guard did to it.

## In the shell

1. Click **Inspect** in the applet's title bar. When anything has gone wrong, the button carries a count: red when at least one message reports a failure.
2. The list is newest first. Each row shows the time, the direction (`applet → shell`, `shell → applet`, or `guard`), the message type, and a mark:
   - **error**: the message reports a failure. That is a non-empty `error` string, as kehto's runtime puts on a failed `*.result`, or a `*.error` type. The note is what failed, for example `denied: relay:read`.
   - **warning**: the guard refused, limited, flagged or quarantined it. Requests held while the window is minimised or hidden are shown too, without a mark: holding them is normal.
3. Open a row to read the message itself. A string longer than 512 characters, such as a fetched file, keeps its first 64 and says how long it was, bytes say only how many there were, and a list or object keeps its first 50 entries. The log never keeps more than 2000 values of one message. **Problems only** hides everything without a mark.

The log keeps the last 200 rows per window; the counts on the button cover the whole time the window has been open. A stopped window keeps its log until it is closed, so the message that stopped it can still be read ([D-058](../decisions.md#d-058)).

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
