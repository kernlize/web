Feature: Opening messages
  The Messages button opens an applet. The shell ships one, pinned by hash, and
  opens it unless the user made another applet their own for messages. A window
  that already shows messages is brought forward instead of opened twice.

  Scenario: the applet the shell ships is the bytes its build pinned
    Then the shipped messages applet is "kernl:messages", needs "dm" and takes "napplet:dm/open"
    And the shipped messages applet starts with "dm,identity,notify"
    And the shipped messages applet's bytes hash to its pin

  Scenario: with no choice made, the shell's own applet is opened
    Given a shell with no applet chosen for messages
    When the Messages button is pressed
    Then the shell resolved "kernl:messages" and opened its plan

  Scenario: the applet the user chose for messages is opened instead
    Given a shell where the user chose the installed applet "naddr1chat" for messages
    When the Messages button is pressed
    Then the shell resolved "naddr1chat" and opened its plan

  Scenario: a choice that is no longer installed falls back to the shell's applet
    Given a shell where the user chose an applet for messages that is no longer installed
    When the Messages button is pressed
    Then the shell resolved "kernl:messages" and opened its plan

  Scenario: a chosen applet that cannot be reached falls back to the shell's applet
    Given a shell where the user chose the installed applet "naddr1chat" for messages
    And the applet at "naddr1chat" cannot be reached
    When the Messages button is pressed
    Then the shell resolved "naddr1chat,kernl:messages" and opened its plan

  Scenario: the shell's own applet failing is reported, not swallowed
    Given a shell with no applet chosen for messages
    And the applet at "kernl:messages" cannot be reached
    When the Messages button is pressed
    Then opening messages failed with "unavailable:blob"

  Scenario: messages already on screen are brought forward
    Given a shell with no applet chosen for messages
    And a window "w7" already shows "kernl:messages"
    When the Messages button is pressed
    Then the shell focused "w7" and opened nothing
