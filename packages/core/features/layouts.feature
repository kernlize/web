Feature: Window layouts
  Layouts are pure functions over kehto's window manager types. Minimised
  windows are never arranged; the focused window leads the master-stack.

  Background:
    Given a container of 1200 by 800 at 0,0
    And windows:
      | id | focused | minimized | x   | y   | w   | h   |
      | a  | false   | false     | 10  | 20  | 300 | 200 |
      | b  | true    | false     | 50  | 60  | 400 | 300 |
      | c  | false   | true      | 0   | 0   | 100 | 100 |
      | d  | false   | false     | 500 | 500 | 200 | 200 |

  Scenario: the floating layout keeps every window where it is
    When the shell arranges with the floating layout
    Then the placements are:
      | id | x   | y   | w   | h   |
      | a  | 10  | 20  | 300 | 200 |
      | b  | 50  | 60  | 400 | 300 |
      | c  | 0   | 0   | 100 | 100 |
      | d  | 500 | 500 | 200 | 200 |

  Scenario: dwindle halves the remaining space, alternating direction
    When the shell arranges with the dwindle layout and a gap of 10
    Then the placements are:
      | id | x   | y   | w   | h   |
      | a  | 10  | 10  | 585 | 780 |
      | b  | 605 | 10  | 585 | 385 |
      | d  | 605 | 405 | 585 | 385 |

  Scenario: a single window fills the dwindle container
    Given only window "a" is shown
    When the shell arranges with the dwindle layout using defaults
    Then the placements are:
      | id | x | y | w    | h   |
      | a  | 0 | 0 | 1200 | 800 |

  Scenario: columns share the width equally
    When the shell arranges with the columns layout using defaults
    Then the placements are:
      | id | x   | y | w   | h   |
      | a  | 0   | 0 | 400 | 800 |
      | b  | 400 | 0 | 400 | 800 |
      | d  | 800 | 0 | 400 | 800 |

  Scenario: the master-stack puts the focused window first
    When the shell arranges with the master-stack layout at ratio 0.5 and a gap of 0
    Then the placements are:
      | id | x   | y   | w   | h   |
      | b  | 0   | 0   | 600 | 800 |
      | a  | 600 | 0   | 600 | 400 |
      | d  | 600 | 400 | 600 | 400 |

  Scenario: without focus the first window is the master, by default at six tenths
    Given no window is focused
    When the shell arranges with the master-stack layout using defaults
    Then the placements are:
      | id | x   | y   | w   | h   |
      | a  | 0   | 0   | 720 | 800 |
      | b  | 720 | 0   | 480 | 400 |
      | d  | 720 | 400 | 480 | 400 |

  Scenario: a lone master fills the container and an empty set arranges nothing
    Given only window "b" is shown
    When the shell arranges with the master-stack layout at ratio 0.5 and a gap of 8
    Then the placements are:
      | id | x | y | w    | h   |
      | b  | 8 | 8 | 1184 | 784 |
    Given no window is shown
    When the shell arranges with the master-stack layout using defaults
    Then there are no placements
