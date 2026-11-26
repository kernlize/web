Feature: Floor: a write that replaces or erases the person's record waits for them, whatever modules are loaded
  Every write the shell signs for an applet that replaces or erases part of
  the person's public record is shown as what it changes and waits for their
  answer. A module that publishes goes through the same gate (SOUL §2, D-061).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario Outline: a profile change the person refuses is never signed or published
    Given the shell loads <modules> modules
    And a kernl shell over that host and pool
    And the shell <theme> "theme"
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
    Then the host was asked "Update your profile" marked "destructive" for applet "chat"
    When the host answers the consent prompt with no
    Then the applet's publish failed with "denied:consent"
    And the fake pool published nothing

    Examples:
      | modules | theme          |
      | kernl's | offers         |
      | no      | does not offer |
      | the example host's | does not offer |

  Scenario Outline: an outbox publish of a destructive change asks first
    Given the shell loads <modules> modules
    And a kernl shell over that host and pool
    And the shell <theme> "theme"
    And the shell is signed in
    And a mounted applet granted "outbox" that has said hello
    When the applet sends "outbox.publish" for a kind 3 event over its port
    Then the host was asked "Change who you follow" marked "destructive" for applet "chat"
    When the host answers the consent prompt with no
    Then the applet received "outbox.publish.result" failing with "denied:consent"
    And the fake pool published nothing

    Examples:
      | modules | theme          |
      | kernl's | offers         |
      | no      | does not offer |
      | the example host's | does not offer |

  Scenario Outline: a destructive publish from a window the shell did not plan goes nowhere
    Given the shell loads <modules> modules
    And a kernl shell over that host and pool
    And the shell <theme> "theme"
    And the shell is signed in
    When a rogue window registered outside the shell is granted "relay", sends its hello and publishes a kind 0 event
    Then the rogue window got no answer
    And the host was not asked for consent
    And the fake pool published nothing

    Examples:
      | modules | theme          |
      | kernl's | offers         |
      | no      | does not offer |
      | the example host's | does not offer |
