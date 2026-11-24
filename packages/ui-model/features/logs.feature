Feature: Logs, notices and the unread count
  The guard log, the traffic log, the notices and the unread count behind a
  shell's panels, framework-free and kept in memory only (#74). Words are the
  host's; these models keep order, caps and counts.

  Scenario: the guard log keeps the newest events, counts them all, and follows quarantine
    Given a guard log that keeps 2 events
    When the guard reports "pass" for window "w1", "quarantine" for window "w2" and "quarantine" for window "w2"
    Then the guard log holds 2 events and counts 3
    And window "w2" is in quarantine, and window "w1" is not
    And the guard log holds 2 events for window "w2"
    When the guard releases window "w2" and window "w1"
    Then no window is in quarantine

  Scenario: the traffic log keeps each window's newest rows and counts its marks past them
    Given a traffic log that keeps 2 rows per window
    When window "w1" logs rows marked "error,warning,none" and window "w2" logs a row marked "error"
    Then window "w1" shows 2 rows, newest first, with 1 error and 1 warning counted
    And window "w3" shows 0 rows, newest first, with 0 errors and 0 warnings counted
    When the traffic log keeps only window "w2"
    Then window "w1" shows 0 rows, newest first, with 0 errors and 0 warnings counted
    And window "w2" shows 1 rows, newest first, with 1 error and 0 warnings counted
    When the traffic log keeps only window "w2"
    Then the traffic log changed 5 times

  Scenario: notices go by themselves after their tone's time, or when dismissed
    Given a notice store with a clock the scenario moves
    When the shell notifies "Saved" as "info" and "Stopped" as "warning"
    Then the notices on screen are "Saved,Stopped"
    When 6000 ms go by on the notice clock
    Then the notices on screen are "Stopped"
    When the person dismisses "Stopped"
    Then the notices on screen are ""

  Scenario: the unread count counts what others send while the person is elsewhere
    Given an unread count over a backend owned by "me"
    When "you" writes while the person is elsewhere, "me" writes, and "you" writes while the person reads
    Then the unread count is 1
    When the count is cleared
    Then the unread count is 0
    When the watch is stopped
    Then the backend was unsubscribed

  Scenario: a watch stopped before the backend answered never keeps its subscription
    Given an unread count over a backend owned by "me"
    When the watch is stopped before the backend answers
    Then the backend was unsubscribed
