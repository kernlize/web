Feature: Floor: the guard sees every message first, whatever modules are loaded
  The guard pipeline sits in front of kehto's bridge in every shell. A module
  may set the starting profile, which changes limits only; it cannot remove
  the guard or move a message past it (SOUL §3, D-020, D-061).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: a fresh shell starts in the strict profile
    Given a kernl shell over that host and pool without a blob fetcher
    Then the shell guard profile is "strict" with mitigations described

  Scenario: the message that crosses the limit is never answered
    Given a kernl shell over that host and pool
    And a mounted applet
    When the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet sends "storage.get" one message at a time until the guard quarantines it
    Then the host was told the window was revoked for "quarantine"
    And every message before it was answered
    And the message that crossed the limit was never answered

  Scenario: a hidden applet's requests are held until it is visible
    Given a kernl shell over that host and pool
    And a mounted applet granted "relay" that has said hello
    When the applet window becomes "hidden"
    And the applet sends 1 "storage.set" requests over its port, 0 ms apart
    Then "storage.set" requests 1 to 1 got no answer
    When the applet window becomes "focused"
    Then "storage.set" requests 1 to 1 were answered
