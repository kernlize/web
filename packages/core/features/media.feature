Feature: Media the shell plays for applets
  An applet asks the shell to play a source, or tells it about media it plays
  itself, and the shell lists every session where the person can control it.
  The shell decides what plays at once, whether a session may start on its own,
  where a video is shown and whether a hidden window keeps playing; the person
  sets each in Settings and the choice is kept (D-062).

  Background:
    Given a media player over empty storage

  Rule: Settings

    Scenario: a new shell plays one thing at a time, pausing what was playing
      Then the media settings are "one", "pause", "window", "keep", "allow" and "keep"

    Scenario: a change to the settings is kept
      When the person sets media "concurrency" to "many"
      And the person sets media "video" to "docked"
      Then a media player over the same storage has settings "many", "pause", "docked", "keep", "allow" and "keep"

    Scenario: a stored value the shell does not know falls back to the default
      Given a media player over storage holding media settings '{"concurrency":"all","video":"docked","hidden":7}'
      Then the media settings are "one", "pause", "docked", "keep", "allow" and "keep"

    Scenario Outline: storage that is not settings at all is ignored
      Given a media player over storage holding media settings '<stored>'
      Then the media settings are "one", "pause", "window", "keep", "allow" and "keep"

      Examples:
        | stored   |
        | not json |
        | 7        |
        | null     |

  Rule: One at a time

    Scenario: a newer session takes over and the older one is paused, not ended
      When window "w1" plays "first.webm"
      And window "w2" plays "second.webm"
      Then session "first.webm" is "paused" because "focus-lost"
      And session "second.webm" is "playing"
      And the current session is "second.webm"
      And the media sessions are "first.webm,second.webm"

    Scenario: playing the older one again takes the output back
      When window "w1" plays "first.webm"
      And window "w2" plays "second.webm"
      And the person presses "play" on "first.webm"
      Then session "second.webm" is "paused" because "focus-lost"
      And session "first.webm" is "playing"
      And the current session is "first.webm"

    Scenario: the older session ends instead when the person chose that
      Given the person sets media "takeover" to "end"
      When window "w1" plays "first.webm"
      And window "w2" plays "second.webm"
      Then window "w1" was told session "first.webm" ended because "preempted"
      And the media sessions are "second.webm"

    Scenario: an applet playing media itself is asked to pause
      When window "w1" plays its own "radio" that can "play,pause"
      And window "w2" plays "second.webm"
      Then window "w1" was asked to "pause" session "radio" because "focus-lost"

    Scenario: an applet playing media it cannot pause is ended
      When window "w1" plays its own "radio" that can "play"
      And window "w2" plays "second.webm"
      Then window "w1" was told session "radio" ended because "policy"

    Scenario: a paused session is left alone
      When window "w1" plays "first.webm"
      And the person presses "pause" on "first.webm"
      And window "w2" plays "second.webm"
      Then session "first.webm" is "paused" because "user"

    Scenario: switching to one at a time keeps only the latest playing
      Given the person sets media "concurrency" to "many"
      When window "w1" plays "first.webm"
      And window "w2" plays "second.webm"
      And the person sets media "concurrency" to "one"
      Then session "first.webm" is "paused" because "focus-lost"
      And session "second.webm" is "playing"

  Rule: Many at once

    Scenario: sessions play side by side
      Given the person sets media "concurrency" to "many"
      When window "w1" plays "first.webm"
      And window "w2" plays "second.webm"
      Then session "first.webm" is "playing"
      And session "second.webm" is "playing"

  Rule: Starting on its own

    Scenario: a session that asked to start on its own does
      When window "w1" plays "first.webm"
      Then session "first.webm" is "playing"

    Scenario: the person can stop sessions starting on their own
      Given the person sets media "autoplay" to "block"
      When window "w1" plays "first.webm"
      Then session "first.webm" is "paused"
      When the person presses "play" on "first.webm"
      Then session "first.webm" is "playing"

    Scenario: an applet's own Play does not start a session the person has not
      Given the person sets media "autoplay" to "block"
      When window "w1" plays "first.webm"
      And window "w1" presses its own "play" on "first.webm"
      Then session "first.webm" is "paused"

    Scenario: an applet's own Play counts while the person is working in it
      Given the person sets media "autoplay" to "block"
      And the person is working in window "w1"
      When window "w1" plays "first.webm"
      And window "w1" presses its own "play" on "first.webm"
      Then session "first.webm" is "playing"

    Scenario: an applet's own Pause always counts
      Given the person sets media "autoplay" to "block"
      When window "w1" plays "first.webm"
      And the person presses "play" on "first.webm"
      And window "w1" presses its own "pause" on "first.webm"
      Then session "first.webm" is "paused"

  Rule: Hidden windows

    Scenario: a hidden window keeps playing by default
      When window "w1" plays "first.webm"
      And window "w1" is hidden
      Then session "first.webm" is "playing"

    Scenario: a hidden window pauses and picks up again when it is shown
      Given the person sets media "hidden" to "pause"
      When window "w1" plays "first.webm"
      And window "w1" is hidden
      Then session "first.webm" is "paused" because "focus-lost"
      When window "w1" is shown
      Then session "first.webm" is "playing" because "focus-gained"

    Scenario: a session the person paused while hidden stays paused
      Given the person sets media "hidden" to "pause"
      When window "w1" plays "first.webm"
      And window "w1" is hidden
      And the person presses "pause" on "first.webm"
      And window "w1" is shown
      Then session "first.webm" is "paused" because "user"

    Scenario: a hidden applet cannot start what the shell paused
      Given the person sets media "hidden" to "pause"
      And the person is working in window "w1"
      When window "w1" plays "first.webm"
      And window "w1" is hidden
      And window "w1" presses its own "play" on "first.webm"
      Then session "first.webm" is "paused" because "focus-lost"

    Scenario: a hidden applet may start media when the person lets hidden windows play
      When window "w1" plays "first.webm"
      And the person presses "pause" on "first.webm"
      And window "w1" is hidden
      And window "w1" presses its own "play" on "first.webm"
      Then session "first.webm" is "playing"

    Scenario: a closed window is no longer hidden
      Given the person sets media "hidden" to "pause"
      When window "w1" is hidden
      And the applet in window "w1" is closed
      And window "w1" plays "first.webm"
      And the person presses "pause" on "first.webm"
      And window "w1" presses its own "play" on "first.webm"
      Then session "first.webm" is "playing"

    Scenario: an applet playing media itself is asked to pause and resume
      Given the person sets media "hidden" to "pause"
      When window "w1" plays its own "radio" that can "play,pause"
      And window "w1" is hidden
      Then window "w1" was asked to "pause" session "radio" because "focus-lost"
      When window "w1" is shown
      Then window "w1" was asked to "play" session "radio" because "focus-gained"

    Scenario: hiding one window leaves the media of others alone
      Given the person sets media "hidden" to "pause"
      And the person sets media "concurrency" to "many"
      When window "w1" starts its own "radio" without saying how it plays
      And window "w2" plays "second.webm"
      And window "w1" plays "first.webm"
      And window "w1" is hidden
      Then session "first.webm" is "paused" because "focus-lost"
      And session "second.webm" is "playing"

    Scenario: an applet's own media that cannot play again is not asked to on show
      Given the person sets media "hidden" to "pause"
      When window "w1" plays its own "radio" that can "pause"
      And window "w1" is hidden
      And window "w1" is shown
      Then window "w1" was asked to "pause" session "radio" because "focus-lost"
      And window "w1" was not asked to "play" session "radio"

  Rule: Closing the applet

    Scenario: by default what the shell plays keeps playing after its applet closes
      When window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      Then the media sessions are "w1/first.webm"
      And session "w1/first.webm" is "playing"
      And session "w1/first.webm" is detached from its applet
      And window "w1" was not told anything ended
      And the playback of "first.webm" was kept

    Scenario: what the shell plays can be paused instead when its applet closes
      Given the person sets media "closed" to "pause"
      When window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      Then session "w1/first.webm" is "paused"
      When the person presses "play" on "w1/first.webm"
      Then session "w1/first.webm" is "playing"

    Scenario: a session the person paused stays paused when its applet closes
      Given the person sets media "closed" to "pause"
      When window "w1" plays "first.webm"
      And the person presses "pause" on "first.webm"
      And the applet in window "w1" is closed
      Then session "w1/first.webm" is "paused" because "user"

    Scenario: media an applet plays itself ends with it, whatever the setting
      When window "w1" plays its own "radio" that can "play,pause"
      And the applet in window "w1" is closed
      Then the media sessions are ""

    Scenario: the person ends a session whose applet has closed
      When window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      And the person ends "w1/first.webm"
      Then the media sessions are ""
      And the playback of "first.webm" was let go

    Scenario: a session whose applet has closed still plays one at a time
      When window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      And window "w2" plays "second.webm"
      Then session "w1/first.webm" is "paused" because "focus-lost"
      And the current session is "second.webm"
      When the person presses "play" on "w1/first.webm"
      Then session "second.webm" is "paused" because "focus-lost"
      And the current session is "w1/first.webm"

    Scenario: a session whose applet has closed is ended by a newer one when the person chose that
      Given the person sets media "takeover" to "end"
      When window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      And window "w2" plays "second.webm"
      Then the media sessions are "second.webm"
      And the playback of "first.webm" was let go

    Scenario: switching to one at a time counts a session whose applet has closed
      Given the person sets media "concurrency" to "many"
      When window "w2" plays "second.webm"
      And window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      And the person sets media "concurrency" to "one"
      Then session "second.webm" is "paused" because "focus-lost"
      And session "w1/first.webm" is "playing"

    Scenario: a kept video is still shown
      When window "w1" plays "clip.webm" as video
      And the applet in window "w1" is closed
      Then session "w1/clip.webm" is a video
      And session "w1/clip.webm" has an element to show

    Scenario: a kept session ignores a control it does not offer
      When window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      And the person presses "next" on "w1/first.webm"
      Then session "w1/first.webm" is "playing"

    Scenario: a playback with nothing to show cannot be kept
      When window "w1" plays "bare.webm"
      And the applet in window "w1" is closed
      Then the media sessions are ""

    Scenario: shutting the player down lets kept playback go
      When window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      And the media player is shut down
      Then the playback of "first.webm" was let go

  Rule: Video and ending

    Scenario: a video source is shown as a video
      When window "w1" plays "clip.webm" as video
      Then session "clip.webm" is a video
      And session "clip.webm" has an element to show

    Scenario: the person ends a session
      When window "w1" plays "first.webm"
      And the person ends "first.webm"
      Then window "w1" was told session "first.webm" ended because "user"
      And the media sessions are ""

    Scenario: closing the applet's window ends its sessions when the person chose that
      Given the person sets media "closed" to "stop"
      When window "w1" plays "first.webm"
      And the applet in window "w1" is closed
      Then the media sessions are ""
      And the playback of "first.webm" was let go

    Scenario: the current session falls back to the one before
      When window "w1" plays "first.webm"
      And window "w2" plays "second.webm"
      And the person ends "second.webm"
      Then the current session is "first.webm"
      And session "first.webm" is "paused" because "focus-lost"

    Scenario: a source the shell cannot play is refused
      When window "w1" asks to play "broken.webm"
      Then window "w1" was refused with "source unavailable or autoplay denied"
      And the media sessions are ""

    Scenario: the applet's title and position are listed
      When window "w1" plays "first.webm"
      Then session "first.webm" is listed from window "w1" with title "first.webm"

    Scenario: a shell with nothing to play with refuses to play for an applet
      Given a media player with nothing to play with
      When window "w1" asks to play "first.webm"
      Then window "w1" was refused with "unsupported owner mode"

    Scenario: a playback with nothing to show is still paused when another takes over
      When window "w1" plays "bare.webm"
      And window "w2" plays "second.webm"
      Then session "bare.webm" is "paused"
      And session "bare.webm" is not a video

    Scenario: an applet's own media that has not said how it plays is left alone
      When window "w1" starts its own "radio" without saying how it plays
      And window "w2" plays "second.webm"
      Then the media sessions are "radio,second.webm"

    Scenario: shutting the player down ends its reports
      When the media player is shut down
      Then the media sessions stop being reported
