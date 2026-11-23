Feature: The Settings window's sections
  Settings is a window with one section showing at a time, picked from a list
  of tabs (DECISIONS D-049). The list is short and fixed, the keyboard moves
  along it the way tabs do everywhere, and the shell remembers which section
  the person was in. Escape closes the shell-drawn window the person is
  working in.

  Scenario: the sections are the six a person looks for, in order
    Then the Settings sections read "General, Servers, Messages, Connections, Downloads, Media"
    And no Settings section is named after a protocol
    And the Settings tab for "servers" is "settings-tab-servers" and controls "settings-panel-servers"

  Scenario Outline: the keyboard moves along the tabs, and wraps at the ends
    Then pressing "<key>" on the Settings tab "<from>" in a <orientation> list goes to "<to>"

    Examples:
      | orientation | from      | key        | to        |
      | vertical    | general   | ArrowDown  | servers   |
      | vertical    | media     | ArrowDown  | general   |
      | vertical    | downloads | ArrowDown  | media     |
      | vertical    | servers   | ArrowUp    | general   |
      | vertical    | general   | ArrowUp    | media     |
      | horizontal  | general   | ArrowRight | servers   |
      | horizontal  | media     | ArrowRight | general   |
      | horizontal  | messages  | ArrowLeft  | servers   |
      | horizontal  | general   | ArrowLeft  | media     |
      | vertical    | messages  | Home       | general   |
      | horizontal  | messages  | End        | media     |

  Scenario Outline: keys that do not belong to the list are left alone
    Then pressing "<key>" on the Settings tab "messages" in a <orientation> list goes nowhere

    Examples:
      | orientation | key        |
      | vertical    | ArrowRight |
      | vertical    | ArrowLeft  |
      | horizontal  | ArrowDown  |
      | horizontal  | ArrowUp    |
      | vertical    | Enter      |
      | horizontal  | a          |

  Scenario: Settings opens on General until the person chooses a section
    Then Settings opens on the section "general"
    When the person chooses the Settings section "downloads"
    Then Settings opens on the section "downloads"
    And the shell has remembered the Settings section "downloads" under "kernl:settings:section:v1"

  Scenario Outline: a remembered section nobody offers any more reads as General
    Given the shell has stored the Settings section "<stored>"
    Then Settings opens on the section "<section>"

    Examples:
      | stored      | section     |
      | connections | connections |
      | network     | general     |
      |             | general     |

  Scenario: a section named by another part of the shell is checked before it is used
    Then "downloads" is a Settings section
    And "bridges" is not a Settings section

  Scenario: Escape closes the shell-drawn window the person is working in
    Given the shell-drawn windows:
      | id             | z | focused | minimised |
      | panel:launcher | 3 | no      | no        |
      | panel:settings | 2 | yes     | no        |
    Then Escape closes the shell-drawn window "panel:settings"

  Scenario: with an applet in focus, Escape closes the shell-drawn window in front
    Given the shell-drawn windows:
      | id             | z | focused | minimised |
      | panel:launcher | 2 | no      | no        |
      | panel:settings | 5 | no      | no        |
    Then Escape closes the shell-drawn window "panel:settings"
    Given the shell-drawn windows:
      | id             | z | focused | minimised |
      | panel:launcher | 6 | no      | no        |
      | panel:settings | 5 | no      | no        |
    Then Escape closes the shell-drawn window "panel:launcher"

  Scenario: a minimised window is not closed behind the person's back
    Given the shell-drawn windows:
      | id             | z | focused | minimised |
      | panel:launcher | 4 | no      | yes       |
      | panel:settings | 1 | no      | no        |
    Then Escape closes the shell-drawn window "panel:settings"
    Given the shell-drawn windows:
      | id             | z | focused | minimised |
      | panel:settings | 1 | no      | yes       |
    Then Escape closes no shell-drawn window
    Given the shell-drawn windows:
      | id | z | focused | minimised |
    Then Escape closes no shell-drawn window
