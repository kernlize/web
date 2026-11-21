Feature: Remembering grants
  Running an applet remembers what the person granted unless they say otherwise. The
  choice is theirs to change, and it stays as they left it (D-059).

  Scenario: a fresh browser remembers
    Given an empty shell storage for the remember choice
    Then the shell remembers grants

  Scenario: turning it off stays off, and turning it back on stays on
    Given an empty shell storage for the remember choice
    When the person stops remembering grants
    Then the shell does not remember grants
    And a shell opened over the same storage does not remember grants
    When the person remembers grants again
    Then the shell remembers grants
    And a shell opened over the same storage remembers grants
    And the shell storage holds nothing under the remember key

  Scenario: the offline preview keeps its own choice
    Given an empty shell storage for the remember choice
    When the person stops remembering grants in the live shell
    Then the preview's view of the storage remembers grants
