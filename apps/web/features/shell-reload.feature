Feature: Reloading an applet from its window
  An applet's frame is never used twice, so reloading plans the bytes the shell already verified
  under a new window id, and the window takes that id over where it stands.

  Scenario: a reload plans the same applet again and hands the window the new plan
    Given a window "applet-1" running "Notes"
    When the person reloads "applet-1" and the shell plans it as "applet-2"
    Then the window "applet-1" was reloaded as "applet-2"
    And the shell planned "Notes" once
    And no problem was reported

  Scenario: a second reload while the first is planning does nothing
    Given a window "applet-1" running "Notes"
    When the person reloads "applet-1" twice before the shell has planned it
    Then the shell planned "Notes" once
    When the shell plans it as "applet-2"
    Then the window "applet-1" was reloaded as "applet-2"
    When the person reloads "applet-1" and the shell plans it as "applet-3"
    Then the shell planned "Notes" twice

  Scenario: a window closed while it was planned is left closed
    Given a window "applet-1" running "Notes"
    When the person reloads "applet-1" twice before the shell has planned it
    And the window "applet-1" is closed
    And the shell plans it as "applet-2"
    Then no window was reloaded

  Scenario: a window that is not open is not reloaded
    When the person reloads "applet-9" and the shell plans it as "applet-2"
    Then the shell planned nothing
    And no window was reloaded

  Scenario Outline: a reload the shell refuses says why in plain words
    Given a window "applet-1" running "Notes"
    When the person reloads "applet-1" and the shell refuses with "<reason>"
    Then the problem "Notes could not start again" says "<words>"
    And no window was reloaded
    And the console was warned <warned> times

    Examples:
      | reason                       | words                                                        | warned |
      | denied:blocked               | You blocked this applet. Unblock it from its grants first.   | 0      |
      | denied:firewall              | The shell refused to open this applet.                       | 0      |
      | something nobody expected    | Could not open the applet. Try again, or try another address. | 1      |
