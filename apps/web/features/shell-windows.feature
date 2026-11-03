Feature: Shell windows
  Windows tile and float inside the desktop, dialogs keep keyboard focus, and
  the launcher remembers what was opened recently.

  Scenario: dwindle tiling halves the remaining space, alternating direction
    Given a shell desktop of 1000 by 600 at 0,0
    When the shell tiles 3 windows
    Then the shell tiles are:
      | x   | y   | width | height |
      | 0   | 0   | 496   | 600    |
      | 504 | 0   | 496   | 296    |
      | 504 | 304 | 496   | 296    |

  Scenario: one window fills the desktop and none makes no tiles
    Given a shell desktop of 800 by 500 at 10,20
    When the shell tiles 1 windows
    Then the shell tiles are:
      | x  | y  | width | height |
      | 10 | 20 | 800   | 500    |
    When the shell tiles 0 windows
    Then the shell makes no tiles

  Scenario Outline: a floating window stays on the desktop
    Given a shell desktop of 1000 by 600 at 0,0
    And a shell window at <x>,<y> sized <w> by <h>
    When the shell keeps the window on the desktop
    Then the shell window sits at <cx>,<cy> sized <cw> by <ch>

    Examples:
      | x   | y   | w    | h   | cx  | cy  | cw   | ch  |
      | -50 | -50 | 100  | 50  | 0   | 0   | 280  | 160 |
      | 900 | 500 | 400  | 300 | 600 | 300 | 400  | 300 |
      | 0   | 0   | 2000 | 900 | 0   | 0   | 1000 | 600 |

  Scenario: a smaller minimum lets a window stay small
    Given a shell desktop of 1000 by 600 at 0,0
    And a shell window at 10,10 sized 100 by 50
    When the shell keeps the window on the desktop, at least 50 by 40
    Then the shell window sits at 10,10 sized 100 by 50

  Scenario: new windows cascade and wrap after eight
    Given a shell desktop of 1000 by 600 at 0,0
    When the shell cascades window number 2 sized 300 by 200
    Then the shell window sits at 104,88 sized 300 by 200
    When the shell cascades window number 9 sized 720 by 660
    Then the shell window sits at 72,0 sized 720 by 600

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
