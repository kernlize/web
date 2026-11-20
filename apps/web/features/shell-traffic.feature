Feature: An applet's messages, as the inspector shows them
  Each applet window keeps what it sent and received this page. A reply that reports a failure is
  an error; anything the guard refused, limited or quarantined is a warning. Requests held while
  the window is hidden are normal and carry no mark.

  Scenario Outline: a message is marked an error only when it reports a failure
    When the inspector reads a "<direction>" "<type>" message whose failure is "<failure>"
    Then the inspector row is marked "<mark>" with the note "<failure>"
    And the inspector row reads "<label>"

    Examples:
      | direction   | type                    | failure            | mark  | label          |
      | to-applet   | inc.channel.open.result | denied: relay:read | error | shell → applet |
      | to-applet   | shell.init              |                    |       | shell → applet |
      | from-applet | shell.ready             |                    |       | applet → shell |

  Scenario Outline: what the guard did is a warning, except holding a hidden window's requests
    When the inspector reads a guard "<disposition>" for "<reason>" on "<op>" described as "<words>"
    Then the inspector row is marked "<mark>" with the note "<words>"
    And the inspector row reads "guard"
    And the inspector row's type is "<reason>"

    Examples:
      | disposition | reason                    | op            | words                                              | mark    |
      | reject      | rate:storage:write        | storage:write | went over a limit: too many storage writes         | warning |
      | quarantine  | flood:quarantine          | storage:write | was quarantined: it kept flooding the shell        | warning |
      | flag        | size:resource:bytes       | resource:bytes | was flagged: an oversized request (web fetches)   | warning |
      | defer       | flood:burst               | generic       | went over its allowance: a burst of messages       | warning |
      | defer       | hidden:relay:publish      | relay:publish | is waiting until you can see it: its publishes are held |   |

  Scenario: a message the guard let through is not a row
    Then the inspector shows nothing for a guard "pass"

  Scenario: errors and warnings are counted, and say so in a few words
    When the inspector counts marks "error,warning,,warning,error,error"
    Then the inspector counts read "3 errors · 2 warnings"
    When the inspector counts marks "warning"
    Then the inspector counts read "1 warning"
    When the inspector counts marks "error"
    Then the inspector counts read "1 error"
    When the inspector counts marks ","
    Then the inspector counts read ""

  Scenario Outline: a payload is shown as indented JSON, or as text when it is not JSON
    Then the payload <payload> is shown as <shown>

    Examples:
      | payload   | shown                          |
      | object    | two-space JSON of its type     |
      | undefined | undefined                      |
      | circular  | [object Object]                |
