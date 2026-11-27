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

  Scenario: a burst of one message becomes one row with a count, not a page of the same line
    When the inspector folds a "gamepad.state" message at 1 into a row, and then 42 more of them
    Then the inspector row stands for 43 messages, the first at 1
    And the inspector says "43 times, first at 00:00:00"

  Scenario Outline: only the same thing said twice is a repeat
    When the inspector folds a message whose "<field>" differs from the row before it
    Then the inspector folds nothing

    Examples:
      | field     |
      | direction |
      | type      |
      | channel   |
      | note      |

  Scenario Outline: failures and guard events each keep their own row even when they look alike
    When the inspector tries to fold two rows for "<kind>"
    Then the inspector folds nothing

    Examples:
      | kind          |
      | failed reply  |
      | guard warning |
      | held request  |

  Scenario: an arrival after a pause starts a new group
    When the inspector folds a "gamepad.state" message at 1 into a row, and then 42 more of them
    And another message of that type arrives at 2044
    Then the inspector folds nothing

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

  Scenario Outline: what the log keeps of a payload is small enough to keep
    Then the inspector keeps <payload> as <kept>

    Examples:
      | payload                     | kept                                         |
      | a 4000-character string     | its first 64 characters and its length       |
      | a 512-character string      | the whole string                             |
      | 2048 bytes                  | <Uint8Array 2048 bytes>                      |
      | a 10-byte buffer            | <ArrayBuffer 10 bytes>                       |
      | a 3-byte blob               | <Blob 3 bytes>                               |
      | an object inside itself     | a marker where it repeats                    |
      | nesting eight objects deep  | the first six levels                         |
      | nesting eight arrays deep   | the first six levels of arrays               |
      | a number                    | the number                                   |
      | a shared value used twice   | the value both times                         |
      | a million-item array        | its first 50 items and how many more         |
      | an object with 60 keys      | its first 50 keys and a marker               |
      | an object with an inherited key | only its own keys                     |
      | a big integer               | its digits and n                             |
      | 50 arrays of 50 numbers     | 2000 values, then markers                    |
