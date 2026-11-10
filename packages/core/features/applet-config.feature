Feature: Applet settings
  An applet declares its settings as a schema and the person sets them in a
  form the shell draws (NAP-CONFIG). kehto validates the schema and every value;
  kernl keeps the values per applet, so an update keeps them, and opens the
  form through the host. A host with no settings form offers no settings
  (D-036).

  Scenario: values are kept per applet and an unknown window has none
    Given applet settings for window "w1" running "chess"
    Then the settings of window "w1" are "{}"
    When the shell saves '{"level":3}' for window "w1"
    Then the settings of window "w1" are '{"level":3}'
    And the settings of window "w9" are "{}"
    When the shell saves '{"level":9}' for window "w9"
    Then the settings of window "w1" are '{"level":3}'

  Scenario: asking for settings opens the shell's form, with the section asked for
    Given applet settings for window "w1" running "chess"
    When window "w1" asks for its settings at section "board"
    Then the shell showed the settings form for "chess" at section "board"
    When window "w1" asks for its settings
    Then the shell showed the settings form for "chess"
    When window "w9" asks for its settings
    Then the shell showed 2 settings forms

  Scenario: the shell offers settings only when its host can show them
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"
    And a kernl shell over that host and pool whose host shows settings
    Then the shell offers the "config" domain
    Given a kernl shell over that host and pool
    Then the shell does not offer the "config" domain
