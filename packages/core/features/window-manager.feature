Feature: Window manager
  The window manager decides where windows are, which one has the person's
  attention, and what the guard is told about each (DECISIONS D-022). It draws
  nothing: a shell feeds it events and draws from the state it publishes.

  Rule: placement

    Scenario: new windows open in front, focused, stepping down and right
      Given new windows are 300 by 200
      And a window manager on a desktop of 1000 by 600
      When the windows "a, b" open
      Then the windows are:
        | id | x  | y  | w   | h   | focused |
        | a  | 40 | 24 | 300 | 200 | no      |
        | b  | 72 | 56 | 300 | 200 | yes     |
      And the front-to-back order is "b, a"
      And the layout is "floating" labelled "floating"
      And the windows can be moved

    Scenario: the cascade starts over after eight windows, and a window never opens larger than the desktop
      Given a window manager on a desktop of 1000 by 600
      When the windows "1, 2, 3, 4, 5, 6, 7, 8, 9, 10" open
      Then the windows include:
        | id | x  | y | w   | h   |
        | 9  | 40 | 0 | 720 | 600 |
        | 10 | 72 | 0 | 720 | 600 |

    Scenario: opening a window that is already open brings it to the front
      Given a window manager on a desktop of 1000 by 600
      When the windows "a, b" open
      And the window "a" opens
      Then the front-to-back order is "a, b"
      And "a" is focused

    Scenario Outline: a moved window stays on the desktop
      Given a window manager on a desktop of 1000 by 600
      When the window "a" opens
      And the person moves "a" to <x>,<y> sized <w> by <h>
      Then the windows are:
        | id | x    | y    | w    | h    |
        | a  | <cx> | <cy> | <cw> | <ch> |

      Examples:
        | x   | y   | w    | h   | cx  | cy  | cw   | ch  |
        | -50 | -50 | 100  | 50  | 0   | 0   | 280  | 160 |
        | 900 | 500 | 400  | 300 | 600 | 300 | 400  | 300 |
        | 0   | 0   | 2000 | 900 | 0   | 0   | 1000 | 600 |

    Scenario: a smaller minimum lets a window stay small
      Given windows may be as small as 50 by 40
      And a window manager on a desktop of 1000 by 600
      When the window "a" opens
      And the person moves "a" to 10,10 sized 100 by 50
      Then the windows are:
        | id | x  | y  | w   | h  |
        | a  | 10 | 10 | 100 | 50 |

    Scenario: a smaller desktop pulls floating windows back inside it
      Given new windows are 300 by 200
      And a window manager on a desktop of 1000 by 600
      When the window "a" opens
      And the person moves "a" to 700,400 sized 300 by 200
      And the desktop becomes 800 by 500
      Then the windows are:
        | id | x   | y   | w   | h   |
        | a  | 500 | 300 | 300 | 200 |

    Scenario: moving a window nobody opened does nothing
      Given a window manager on a desktop of 1000 by 600
      When the person moves "ghost" to 10,10 sized 300 by 200
      Then there are no windows

  Rule: layouts

    Scenario: picking a layout arranges the windows and is remembered
      Given the window manager offers the default layouts with a gap of 8 and a margin of 0
      And a window manager on a desktop of 1000 by 600
      When the windows "a, b, c" open
      And the person picks the layout "dwindle"
      Then the windows are:
        | id | x   | y   | w   | h   |
        | a  | 0   | 0   | 496 | 600 |
        | b  | 504 | 0   | 496 | 296 |
        | c  | 504 | 304 | 496 | 296 |
      And the layout is "dwindle" labelled "tiled"
      And the remembered layout is "dwindle"
      And the windows cannot be moved

    Scenario: a layout that arranges windows ignores a move
      Given a window manager on a desktop of 1000 by 600
      When the windows "a, b" open
      And the person picks the layout "columns"
      And the person moves "a" to 300,300 sized 300 by 200
      Then the windows are:
        | id | x   | y | w   | h   |
        | a  | 0   | 0 | 500 | 600 |
        | b  | 500 | 0 | 500 | 600 |

    Scenario: the manager starts in the layout it is asked for
      Given the window manager starts in the layout "columns"
      And a window manager on a desktop of 1000 by 600
      Then the layout is "columns" labelled "columns"

    Scenario: a starting layout nobody registered falls back to the first
      Given the window manager starts in the layout "tiled"
      And a window manager on a desktop of 1000 by 600
      Then the layout is "floating" labelled "floating"

    Scenario: a layout nobody registered cannot be picked
      Given a window manager on a desktop of 1000 by 600
      When the person tries to pick the layout "spiral"
      Then the window manager refuses with "invalid:unknown-layout"
      And the layout is "floating" labelled "floating"
      And nothing was remembered

    Scenario: a manager needs at least one layout
      Given the window manager offers no layouts
      Then creating the window manager fails with "invalid:no-layouts"

    Scenario: a layout registered later is on offer at once
      Given a window manager on a desktop of 1000 by 600
      Then the layouts on offer are "floating, dwindle, columns, master-stack"
      When the window manager's registry gains the layout "rows"
      Then the layouts on offer are "floating, dwindle, columns, master-stack, rows"
      When the windows "a, b" open
      And the person picks the layout "rows"
      Then the windows are:
        | id | x | y   | w    | h   |
        | a  | 0 | 0   | 1000 | 300 |
        | b  | 0 | 300 | 1000 | 300 |

    Scenario: a minimised window leaves the arrangement and returns when focused
      Given new windows are 300 by 200
      And a window manager on a desktop of 1000 by 600
      When the windows "a, b, c" open
      And the person picks the layout "columns"
      And the person minimises "b"
      Then the windows are:
        | id | x   | y  | w   | h   | minimised |
        | a  | 0   | 0  | 500 | 600 | no        |
        | b  | 72  | 56 | 300 | 200 | yes       |
        | c  | 500 | 0  | 500 | 600 | no        |
      When the person focuses "b"
      Then the windows are:
        | id | x   | y | w   | h   | minimised |
        | a  | 0   | 0 | 333 | 600 | no        |
        | b  | 333 | 0 | 334 | 600 | no        |
        | c  | 667 | 0 | 333 | 600 | no        |

    Scenario: an arrangement that follows focus keeps its place when the person turns to the shell
      Given a window manager on a desktop of 1000 by 600
      When the windows "a, b, c" open
      And the person picks the layout "master-stack"
      Then the windows are:
        | id | x   | y   | w   | h   |
        | a  | 600 | 0   | 400 | 300 |
        | b  | 600 | 300 | 400 | 300 |
        | c  | 0   | 0   | 600 | 600 |
      When the person turns to the shell
      Then nothing on the desktop is focused
      And the windows are:
        | id | x   | y   | w   | h   |
        | a  | 600 | 0   | 400 | 300 |
        | b  | 600 | 300 | 400 | 300 |
        | c  | 0   | 0   | 600 | 600 |
      When the person focuses "a"
      Then the windows are:
        | id | x   | y   | w   | h   |
        | a  | 0   | 0   | 600 | 600 |
        | b  | 600 | 0   | 400 | 300 |
        | c  | 600 | 300 | 400 | 300 |

  Rule: a narrow desktop shows one window at a time

    Scenario: at 720 wide or less every window fills the desktop, whatever the layout
      Given new windows are 300 by 200
      And a window manager on a desktop of 1000 by 600
      When the windows "a, b" open
      And the desktop becomes 600 by 800
      Then the desktop is compact
      And the windows cannot be moved
      And the windows are:
        | id | x | y | w   | h   |
        | a  | 0 | 0 | 600 | 800 |
        | b  | 0 | 0 | 600 | 800 |
      When the person moves "a" to 100,100 sized 300 by 200
      And the desktop becomes 1000 by 600
      Then the desktop is not compact
      And the windows are:
        | id | x  | y  | w   | h   |
        | a  | 40 | 24 | 300 | 200 |
        | b  | 72 | 56 | 300 | 200 |

    Scenario: the compact width can be changed, or turned off
      Given the compact width is 0
      And a window manager on a desktop of 400 by 600
      Then the desktop is not compact

  Rule: focus and stacking

    Scenario: focus follows the front-most window when the focused one goes away
      Given a window manager on a desktop of 1000 by 600
      When the windows "a, b, c" open
      And the person focuses "a"
      Then the front-to-back order is "a, c, b"
      When the person minimises "a"
      Then "c" is focused
      When the person closes "c"
      Then "b" is focused
      When the person closes "b"
      Then nothing on the desktop is focused
      And the windows are:
        | id | minimised |
        | a  | yes       |

    Scenario: minimising or closing a window that is not focused leaves focus alone
      Given a window manager on a desktop of 1000 by 600
      When the windows "a, b, c" open
      And the person minimises "a"
      And the person closes "b"
      Then "c" is focused

    Scenario: focusing the focused window again only raises it
      Given the desktop clock reads 1000
      And a window manager on a desktop of 1000 by 600
      When the window "a" opens
      And the desktop clock reads 1500
      And the person focuses "a"
      Then the guard is told "a" is visible and focused for 500 ms

    Scenario: windows nobody opened are ignored
      Given a window manager on a desktop of 1000 by 600
      When the window "a" opens
      And the person focuses "ghost"
      And the person minimises "ghost"
      And the person closes "ghost"
      And the applet in "ghost" is stopped
      Then "a" is focused
      And the state was published 2 times

    Scenario: turning to the shell twice changes nothing the second time
      Given a window manager on a desktop of 1000 by 600
      When the window "a" opens
      And the person turns to the shell
      And the person turns to the shell
      Then the state was published 3 times

    Scenario: a stopped window keeps its place, takes no focus and waits to be closed
      Given new windows are 300 by 200
      And a window manager on a desktop of 1000 by 600
      When the windows "a, b" open
      And the person picks the layout "columns"
      And the applet in "b" is stopped
      Then "a" is focused
      And the windows are:
        | id | x  | y  | w    | h   | stopped |
        | a  | 0  | 0  | 1000 | 600 | no      |
        | b  | 72 | 56 | 300  | 200 | yes     |
      When the person focuses "b"
      Then "a" is focused
      And the guard is told "b" is hidden

  Rule: the guard is told the truth

    Scenario: a window is visible while it is shown on a visible page, and focused while the person works in it
      Given the desktop clock reads 1000
      And a window manager on a desktop of 1000 by 600
      When the windows "a, b" open
      And the desktop clock reads 1250
      Then the guard is told "b" is visible and focused for 250 ms
      And the guard is told "a" is visible and not focused
      And the guard is told "ghost" is hidden
      When the person minimises "b"
      Then the guard is told "b" is hidden
      And the guard is told "a" is visible and focused for 0 ms
      When the page is hidden
      Then the guard is told "a" is hidden
      When the page is shown
      Then the guard is told "a" is visible and focused for 0 ms

    Scenario: an attached applet is told at once, and again whenever focus or visibility changes
      Given the desktop clock reads 0
      And a window manager on a desktop of 1000 by 600
      When the windows "a, b" open
      And "a" is attached
      And "b" is attached
      Then the reports to "a" are:
        | visible | focused | ms |
        | yes     | no      |    |
      And the reports to "b" are:
        | visible | focused | ms |
        | yes     | yes     | 0  |
      When the desktop clock reads 40
      And the person focuses "a"
      And the person turns to the shell
      And the page is hidden
      Then the reports to "a" are:
        | visible | focused | ms |
        | yes     | no      |    |
        | yes     | yes     | 0  |
        | yes     | no      |    |
        | no      | no      |    |
      And the reports to "b" are:
        | visible | focused | ms |
        | yes     | yes     | 0  |
        | yes     | no      |    |
        | yes     | no      |    |
        | no      | no      |    |

    Scenario: reports go only where they are owed
      Given a window manager on a desktop of 1000 by 600
      When the windows "a, b, c" open
      And "a" is attached
      And "a" is attached
      And "b" is attached
      And "ghost" is attached
      Then "a" got 1 report
      And "ghost" got 0 reports
      When the page is shown
      Then "a" got 1 report
      When the applet in "a" is stopped
      And the person closes "b"
      And the person focuses "c"
      Then "a" got 1 report
      And "b" got 2 reports

    Scenario: moving, resizing and re-arranging are not reported, because nothing the guard relies on changed
      Given a window manager on a desktop of 1000 by 600
      When the window "a" opens
      And "a" is attached
      And the person moves "a" to 10,10 sized 400 by 300
      And the desktop becomes 900 by 500
      And the person picks the layout "columns"
      Then "a" got 1 report

  Rule: the state is published after every change, and only then

    Scenario: a subscriber gets the state as it is, then one state per change
      Given a window manager on a desktop of 1000 by 600
      Then the state was published 1 time
      When the window "a" opens
      And the person moves "a" to 10,10 sized 400 by 300
      And the person picks the layout "columns"
      And the desktop becomes 900 by 500
      Then the state was published 5 times
      When the desktop becomes 900 by 500
      And the page is hidden
      Then the state was published 5 times

    Scenario: a destroyed manager publishes and reports nothing more
      Given a window manager on a desktop of 1000 by 600
      When the window "a" opens
      And "a" is attached
      And the window manager is destroyed
      And the page is hidden
      Then the state stream has ended
      And "a" got 1 report

  Rule: every option has a default

    Scenario: with no options the manager offers kernl's layouts on a 1280 by 800 desktop
      Given a window manager with every default
      When the window "a" opens
      Then the layout is "floating" labelled "floating"
      And the layouts on offer are "floating, dwindle, columns, master-stack"
      And the windows are:
        | id | x  | y  | w   | h   |
        | a  | 40 | 24 | 720 | 660 |
      And the guard is told "a" is visible and focused just now
      When the person picks the layout "dwindle"
      Then the windows are:
        | id | x | y | w    | h   |
        | a  | 0 | 0 | 1280 | 800 |
