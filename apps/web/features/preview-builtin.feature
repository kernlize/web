Feature: Applets the preview ships
  The preview opens the same built-in applets the live shell does, from the
  same pinned bytes. A built-in applet speaks over a real message port, so the
  preview answers it with the toolkit's own services for messages, the account,
  the theme and notifications, and offers it nothing it cannot answer.

  Background:
    Given a preview that ships the applet "messages" starting with "dm,identity,notify,teleport"

  Scenario: its address resolves to the pinned bytes and plans with what the preview can answer
    When the preview resolves the address "kernl:messages"
    Then the preview summary is the built-in applet "messages"
    When the preview plans that summary
    Then the preview plan offers "theme,dm,identity,notify"
    And the preview plan holds the shipped document, sealed
    And the preview lists the applet as installed

  Scenario: the domains it starts with are switched on once
    When the preview resolves the address "kernl:messages"
    And the preview user withdraws "identity" from that applet
    And the preview resolves the address "kernl:messages"
    And the preview plans that summary
    Then the preview plan offers "theme,dm,notify"

  Scenario: a name the preview does not ship is refused
    When the preview resolves the address "kernl:ghost"
    Then the preview refused with "invalid:pointer"

  Scenario: a sample applet has no shipped document
    When the preview resolves the address "preview:notes"
    And the preview plans that summary
    Then the preview plan holds a sample document

  Scenario: the applet's hello hands over its port, and messages are answered over it
    Given the shipped applet is mounted and has said hello
    Then the shipped applet is "running"
    When the shipped applet asks "dm.status" over its port
    Then the shipped applet is answered "dm.status.result" with "available" true
    When the shipped applet asks "dm.conversations" over its port
    Then the shipped applet is answered "dm.conversations.result" naming "Ada,Grace"

  Scenario: the account and the theme are answered over the port
    Given the shipped applet is mounted and has said hello
    When the shipped applet asks "identity.getPublicKey" over its port
    Then the shipped applet is answered "identity.getPublicKey.result" with the preview account
    When the shipped applet asks "theme.get" over its port
    Then the shipped applet is answered "theme.get.result" with a theme

  Scenario: a notification reaches the host, with or without a body
    Given the shipped applet is mounted and has said hello
    When the shipped applet sends the notification "Ada" saying "hello there"
    And the shipped applet sends the notification "Grace" saying ""
    Then the preview host was notified "Ada: hello there" and "Grace"

  Scenario: a domain the user withdrew is answered as unavailable
    When the preview resolves the address "kernl:messages"
    And the preview user withdraws "dm" from that applet
    And the shipped applet is mounted and has said hello
    And the shipped applet asks "dm.status" over its port
    Then the shipped applet is answered "dm.status.result" with error "unavailable"

  Scenario: what is not an envelope is ignored
    Given the shipped applet is mounted and has said hello
    When the shipped applet sends "not an envelope" over its port
    And the shipped applet sends nothing at all over its port
    Then the shipped applet has no answers

  Scenario: only the first hello with a port binds
    Given the shipped applet is mounted
    When the shipped applet says hello without a port
    Then the shipped applet is "mounting"
    When the shipped applet says something else with a port
    Then the shipped applet is "mounting"
    When the shipped applet says hello with its port
    And the shipped applet says hello with another port
    Then the shipped applet is "running"
    And the other port was never started

  Scenario: a flood over the port stops the applet and the host is told
    Given the shipped applet is mounted and has said hello
    When the shipped applet floods the shell over its port
    Then the shipped applet is "revoked"
    And the shipped applet's port is closed
    And the preview host heard the applet revoked for "quarantine"

  Scenario: closing the applet closes its port
    Given the shipped applet is mounted and has said hello
    When the shipped applet is closed
    Then the shipped applet's port is closed
    When the preview is destroyed
    Then the shipped applet is "closed"

  Scenario: the applet is told the shell's own colours
    Given a light preview that ships the applet "messages" starting with "dm"
    And the shipped applet is mounted and has said hello
    When the shipped applet asks "theme.get" over its port
    Then the shipped applet is answered "theme.get.result" with the background "#fcfaf4"

  Scenario: an applet shipped with nothing switched on holds only the baseline the preview can answer
    Given a preview that ships the applet "messages" starting with ""
    When the preview resolves the address "kernl:messages"
    And the preview plans that summary
    Then the preview plan offers "theme"
