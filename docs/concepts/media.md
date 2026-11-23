# Media

An applet's frame has no network and no media of its own: the guard's policy gives it `media-src 'none'`. To play something it asks the shell, through the `media` domain ([NAP-MEDIA](https://github.com/napplet/naps/pull/10)), and the shell lists everything applets play in one player at the bottom of the desktop ([D-061](../decisions.md#d-061)).

## Two ways to play

| The applet creates a session with | Who fetches and decodes | What the shell does |
| --- | --- | --- |
| `owner: "shell"` and a `source` | The shell | Fetches the source through the `resource` service, as the applet: the applet needs `resource` granted too, and the same bridges, address policy and firewall decide it as any fetch; checks the bytes are audio or video; plays them in an element of its own; reports `media.state` to the applet. |
| `owner: "napplet"` | The applet, inside its frame | Lists the session from the applet's own `media.state` reports, and sends `media.command` when the person uses the player or a setting asks for a pause. |

`onEnded` tells the applet a session is gone, with the reason. A source the shell cannot fetch, or bytes that are not media, are refused at creation: `media.session.create.result` carries `error` and nothing is listed. The shell fetches the whole source before it plays, so a source must be one the `resource` service returns whole: at most 10 MB over the web, within 20 seconds. `source.url` is supported, and `source.blossomHash` where the shell's bridges can resolve it. Live streams and Nostr references are not played yet.

```js
const media = window.napplet.media;
const { sessionId } = await media.createSession({
  owner: 'shell',
  source: { url: 'https://example.com/episode.webm', mimeType: 'audio/webm' },
  metadata: { title: 'Episode 12', artist: 'The show' },
  autoplay: true,
});
media.onState(sessionId, (state) => console.log(state.status));
```

## The person's settings

Settings → Media holds six choices, kept on this device at `kernl:media:v1`. Each takes effect on what is playing now.

| Setting | Choices (default first) | What the applet sees |
| --- | --- | --- |
| Playing at once | One at a time · Several at once | Under one at a time, a session that starts playing takes the output from every other session that is playing. |
| When another starts | Pause the earlier one · End the earlier one | Paused: `media.state` with `status: "paused"` and `reason: "focus-lost"` for a shell-played session, or `media.command` `pause` with `reason: "focus-lost"` for its own. Ended: `media.session.ended` with `reason: "preempted"`; the session is gone and a new one is needed to play again. An applet's own media that cannot pause is ended with `reason: "policy"`. Only asked while one plays at a time. |
| Videos | In their own window · In the player | A shell-played video opens in a window of its own, placed by the layout like any window, or plays in the player at the bottom. Closing a video's window ends the session with `reason: "user"`; Escape does not close it. |
| Hidden windows | Keep playing · Pause until shown | While the applet's window is minimised, or the page is hidden, its sessions are paused with `focus-lost`, and resumed with `focus-gained` when it is shown, unless the person or the applet paused or stopped it in between. |
| Starting on its own | Allowed · Wait for play | `autoplay: true` is ignored: the session is created paused and starts when the person presses Play. |
| When its applet closes | Keep playing · Pause · Stop | What the shell plays is detached from the closed applet and kept, playing or paused, in the player and its video window, marked "(closed)"; the person ends it there. Stop ends it with the applet. Nothing is sent to the closed applet either way. |

An applet's own `media.command` `play` on a session the shell plays follows the same settings: with **Wait for play** it counts only while the person is working in the applet's window, and with **Pause until shown** not while that window is hidden. Pause, stop, seek and volume always count.

A pause the shell decides is never reported as `user`. The applet is not told to resume after a takeover; the person resumes the earlier session from the player, which takes the output back.

## The player

The player appears when the first session does and goes when the last ends.

- **One at a time.** The current session (the one started last) has the full controls; the others are listed under "N more", each with Play and End. Playing one of them makes it current.
- **Several at once.** Every session has its own row and controls, newest first.
- **Controls.** Play or pause, Previous and Next when the session offers them, a position slider when it can seek, volume, Show for a video in its own window, and End. A control the session does not offer is not drawn.

The browser's media controls (media keys, the system's now-playing panel) follow the session that last started playing.

An applet whose window is hidden can report on and steer the sessions it has, but a new session waits until the window is shown: the guard holds back anything that would make the shell fetch from a window nobody sees.

Media an applet plays in its own frame ends with the applet. What the shell plays for it follows **When its applet closes**: a kept session gets an id of the form `<window>/<session>`, which no applet can name, so a new instance of the same applet cannot reach or replace it. A kept session still plays one at a time with the others. The browser's media keys do not reach it.

## Using it from core

`kernl.media` is a `KernlMedia`: `sessions$`, `settings$`, `configure(change)`, `command(sessionId, command)`, `end(sessionId)`, `element(sessionId)` and `setWindowVisible(windowId, visible)`. A host that is not the web shell draws its own player from `sessions$` and shows a video by moving `element(sessionId)` into its page; see [@kernlize/core](../packages/core.md).
