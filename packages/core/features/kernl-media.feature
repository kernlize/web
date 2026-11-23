Feature: An applet's media in the shell
  The `media` service is one of the shell's own. An applet granted it tells the
  shell what it plays, the shell lists it for the person, pauses it while its
  window is hidden when the person chose that, and ends it with the window (D-062).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"
    And a kernl shell over that host and pool

  Scenario: the shell lists what an applet plays and pauses it while its window is hidden
    Given a mounted applet granted "media" that has said hello
    And the person sets the shell's media "hidden" to "pause"
    When the applet starts playing its own "song" over its port
    Then the shell lists media "song"
    When the mounted window is hidden
    Then the applet received a "media.command" whose "reason" is "focus-lost"

  Scenario: closing the applet ends what it played
    Given a mounted applet granted "media" that has said hello
    When the applet starts playing its own "song" over its port
    And the shell closes the mounted applet
    Then the shell lists media ""

  Scenario: where there is no page to play in, a source the applet names is refused
    Given a mounted applet granted each of "media,resource" that has said hello
    When the applet asks the shell to play "https://media.test/tone.webm" over its port
    Then the applet received a "media.session.create.result" whose "error" is "source unavailable or autoplay denied"
