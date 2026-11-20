Feature: What an applet sends and receives
  The shell reports every message between an applet and itself, in both directions and on both
  channels, so a person can see what an applet asked for and what it got back. A reply that
  reports a failure says what failed. Messages are kept by the host, never by the core.

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"
    And a kernl shell over that host and pool
    And a mounted applet
    And the shell's traffic is watched

  Scenario: the hello, a request and its reply are reported in order, with their channel and direction
    When the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    Then the watched traffic began with:
      | direction  | via    | type          |
      | from-applet | window | napplet.hello |
      | from-applet | port   | shell.ready   |
      | to-applet   | port   | shell.init    |
    And every watched message belongs to the mounted window

  Scenario: a reply that reports a failure carries what failed
    When the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet asks "inc.channel.open" over its port
    Then the watched "inc.channel.open.result" reports the failure "denied: relay:read"
    And the watched "shell.init" reports no failure

  Scenario: a message on the window after the hello is reported before kehto stops the applet
    When the applet sends its hello through the shell
    And the applet posts "debug.log" to the parent window
    Then the watched traffic ended with a "debug.log" from the applet on the "window"

  Scenario: a reply kehto could not deliver is not reported
    When kehto sends "shell.init" to the mounted window before it has said hello
    Then nothing was watched

  Scenario: an applet cannot make a message's type or failure grow without bound
    When the applet sends its hello through the shell
    And the applet sends a message whose type and failure are 100000 characters long
    Then the last watched message's type is 129 characters and its failure 513

  Scenario: something that wraps kehto's sending after the shell is left in place when the shell stops
    Given something else wraps kehto's sending after the shell
    When the shell is destroyed
    Then kehto's sending is still wrapped by that something else
    And a new shell started now hears kehto's replies once

  Scenario: a shell that is destroyed stops watching what kehto sends
    When the shell is destroyed
    Then kehto's sending to applets is no longer watched

  Scenario Outline: what counts as a failure
    Then the envelope <envelope> reports the failure "<failure>"

    Examples:
      | envelope                                                          | failure          |
      | {"type":"inc.channel.open.result","id":"1","error":"target denied"} | target denied    |
      | {"type":"relay.error","message":"socket closed"}                   | socket closed    |
      | {"type":"relay.error","reason":"down"}                             | down             |
      | {"type":"relay.error"}                                             | relay.error      |
      | {"type":"storage.get.result","error":""}                           |                  |
      | {"type":"storage.get.result","value":"x"}                          |                  |
      | "not an envelope"                                                  |                  |
      | ["EVENT","sub",{}]                                                 |                  |
