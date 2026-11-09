Feature: Shell windows
The shell hands its windows to kernl's window manager, with its own spacing
  and the layout the person chose last (DECISIONS D-022). Dialogs keep keyboard
  focus, and the launcher remembers what was opened recently.

  Scenario: the shell tiles with 8 px between windows and none at the desktop edge
    Given the shell's window manager on a desktop of 1000 by 600
    When the shell opens 3 windows
    And the person picks the shell layout "dwindle"
    Then the shell windows sit at:
      | x   | y   | w   | h   |
      | 0   | 0   | 496 | 600 |
      | 504 | 0   | 496 | 296 |
      | 504 | 304 | 496 | 296 |

  Scenario: the shell offers kernl's four layouts and steps through them in order
    Then the shell layouts read "floating, tiled, columns, main and stack"
    And after the shell layout "floating" comes "dwindle"
    And after the shell layout "dwindle" comes "columns"
    And after the shell layout "master-stack" comes "floating"
    And after a shell layout nobody registered comes "floating"
    And with no shell layouts on offer nothing comes next

  Scenario Outline: the shell starts in the layout the person chose last
    Given the shell has stored the layout "<stored>"
    And the shell's window manager on a desktop of 1000 by 600
    Then the shell layout is "<layout>"

    Examples:
      | stored   | layout   |
      | columns  | columns  |
      | floating | floating |
      | tiled    | dwindle  |
      | spiral   | floating |

  Scenario: with nothing stored the shell starts floating, and the next choice is remembered
    Given the shell's window manager on a desktop of 1000 by 600
    Then the shell layout is "floating"
    When the person picks the shell layout "master-stack"
    Then the shell layout is "master-stack"
    And the shell has remembered the layout "master-stack" under "kernl:layout:v1"

  Scenario: a new shell window opens at the default size, kept on the desktop
    Given the shell's window manager on a desktop of 1000 by 600
    When the shell opens 1 windows
    Then the shell windows sit at:
      | x  | y | w   | h   |
      | 40 | 0 | 720 | 600 |

  Scenario: the applet's frame sits under the title bar, and is never taller than what is left
    Then the shell frames applets under the title bar:
      | x  | y  | w   | h   | frame x | frame y | frame w | frame h |
      | 10 | 20 | 300 | 200 | 10      | 56      | 300     | 164     |
      | 0  | 0  | 300 | 20  | 0       | 36      | 300     | 0       |

  Scenario: Tab and Shift+Tab wrap inside a dialog and focus returns on close
    Given a shell dialog with the controls "first, middle, last"
    And focus rests on the shell opener
    When the shell traps focus in the dialog
    Then shell focus is on "first"
    When the shell user focuses "last"
    And the shell user presses "Tab" in the dialog
    Then shell focus is on "first"
    And the shell dialog kept the key from the browser
    When the shell user presses "Shift+Tab" in the dialog
    Then shell focus is on "last"
    And the shell dialog kept the key from the browser
    When the shell user focuses "middle"
    And the shell user presses "Tab" in the dialog
    Then the shell dialog left the key to the browser
    When the shell user presses "Shift+Tab" in the dialog
    Then the shell dialog left the key to the browser
    When the shell user presses "Escape" in the dialog
    Then the shell dialog left the key to the browser
    When the shell user focuses "the opener"
    And the shell user presses "Shift+Tab" in the dialog
    Then shell focus is on "last"
    And the shell dialog kept the key from the browser
    When the shell releases the dialog
    Then shell focus is on "the opener"
    And the shell dialog no longer listens for keys

  Scenario: the dialog can name the control that gets focus first
    Given a shell dialog with the controls "first, middle, last"
    When the shell traps focus in the dialog starting at "middle"
    Then shell focus is on "middle"

  Scenario: with no preferred control and nothing focused before, focus stays put on close
    Given a shell dialog with the controls "first, last"
    When the shell traps focus in the dialog starting at "nothing"
    Then shell focus is on "first"
    When the shell releases the dialog
    Then shell focus is on "first"

  Scenario: a dialog with nothing to focus holds focus itself
    Given a shell dialog with the controls ""
    When the shell traps focus in the dialog
    Then shell focus is on "the dialog"
    When the shell user presses "Tab" in the dialog
    Then the shell dialog kept the key from the browser

  Scenario: hidden controls are skipped unless they hold focus
    Given a shell dialog with the controls "first, last"
    And the shell dialog control "last" is hidden
    When the shell traps focus in the dialog
    Then shell focus is on "first"
    When the shell user presses "Tab" in the dialog
    Then shell focus is on "first"
    And the shell dialog kept the key from the browser
    When the shell user focuses "last"
    And the shell user presses "Tab" in the dialog
    Then shell focus is on "first"
    And the shell dialog kept the key from the browser

  Scenario: reopening an applet moves it to the front of the recent list
    When the shell remembers "a" titled "A" from "pub" at 10
    And the shell remembers "b" titled "B" from "pub" at 20
    And the shell remembers "a" titled "A" from "pub" at 30
    Then the shell recent list is "a, b"
    And the shell recent applet "a" was opened at 30
    When the shell forgets "b"
    Then the shell recent list is "a"

  Scenario: the recent list keeps the eight latest applets
    When the shell remembers 9 applets one after another
    Then the shell recent list is "applet-9, applet-8, applet-7, applet-6, applet-5, applet-4, applet-3, applet-2"

  Scenario: an applet remembered without a time is stamped now
    When the shell remembers "a" titled "A" from "pub" just now
    Then the shell recent applet "a" was opened just now

  Scenario Outline: a damaged recent list reads as the entries that still make sense
    Given the shell has stored the recent list '<stored>'
    Then the shell reads the recent list back as "<addresses>"

    Examples:
      | stored                                                                                      | addresses |
      | {bad                                                                                        |           |
      | {"address":"x"}                                                                             |           |
      | [null, 1, {"address":"x"}, {"address":"ok","title":"T","publisher":"p","openedAt":1}]       | ok        |

  Scenario: nothing stored reads as an empty recent list
    Then the shell reads the recent list back as ""
