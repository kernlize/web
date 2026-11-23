Feature: Floor: secrets stay out of what the shell reports, whatever modules are loaded
  The signed-in key never appears in guard events, traffic, consent prompts,
  notices or anything an applet is sent. A module reports
  through the same streams and is held to the same rule (AGENTS.md, D-061).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: a change the person is asked about leaves no secret in any report
    Given a kernl shell over that host and pool
    And the shell's traffic is recorded
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
    Then the host was asked "Update your profile" marked "destructive" for applet "chat"
    When the host answers the consent prompt with no
    Then the applet's publish failed with "denied:consent"
    And nothing the shell reported holds the signed-in key

  Scenario: a note signed for an applet leaves no secret in any report
    Given a kernl shell over that host and pool
    And the shell's traffic is recorded
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a kind 1 event with content 'hello' over its port
    Then the applet's publish succeeded
    And nothing the shell reported holds the signed-in key
