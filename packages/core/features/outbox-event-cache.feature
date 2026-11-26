Feature: Approved Outbox reads reuse public tree events
  The shell shares verified public tree observations across applets and identities.
  Every replay still matches the filter and an observed relay in the approved plan.

  Scenario: A reopened subscription replays once before its relay opens
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet subscribes to the tree on "wss://nos.lol, wss://relay.routstr.com"
    Then the cached tree event is sent before opening the two approved relays
    And a live copy from the same relay does not repeat the event
    And a live copy from another approved relay adds its observed hint

  Scenario Outline: Cache replay requires a matching approved read
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When an Outbox read changes its <boundary>
    Then no cached Outbox event is sent

    Examples:
      | boundary          |
      | relay plan        |
      | filter author     |
      | routed author     |
      | filter tag        |
      | firewall answer   |
      | subscription close |
      | window teardown   |
      | permission revocation |
      | capability revocation |

  Scenario: A query still waits for the approved relays and merges cached matches
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries the tree on "wss://nos.lol, wss://relay.routstr.com"
    Then the one-shot query waits for the relay deadline and returns the cached event with its observed hint

  Scenario Outline: An event outside the cache policy stays live only
    Given an Outbox relay sent <event>
    When its applet subscribes to the same Outbox filters and relay again
    Then no cached Outbox event is sent

    Examples:
      | event                         |
      | a private relay's tree event  |
      | a draft on a public relay     |
      | an invalid signature          |
      | a nonmatching public event    |

  Scenario: A query merges duplicate relay results without claiming every relay saw the cached event
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries the two relays with the cached event and a new tree event online
    Then the query returns both events once and keeps the cached event's observed hint

  Scenario: Unreadable or unwritable storage does not stop live Outbox
    Given Outbox storage cannot be read or written
    When its applet subscribes with a matching event on a public relay
    Then live Outbox still sends the event

  Scenario: Query limit applies to the merged result
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries with a limit of one and a newer event online
    Then only the newer event is returned at the query deadline

  Scenario: Closing a subscription by its id leaves other subscriptions active
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When the applet opens two live reads and closes the first
    Then only the second read receives another live event

  Scenario: Closing during synchronous cache delivery prevents opening the relay
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When the applet closes its subscription while receiving the cached event
    Then the cached event is delivered but no relay is opened

  Scenario: A second denied subscription does not interrupt its sibling
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When the first subscription is approved and a second subscription is denied
    Then the cache is sent only to the approved subscription

  Scenario: Equal-timestamp query events are ordered by id when applying a limit
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries with a limit of one and another event at the same time
    Then the lower event id is returned at the query deadline

  Scenario: Lookup by id continues to use the existing Outbox router
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet looks up the event by id
    Then that id lookup contacts the relay normally

  Scenario: Another applet can reuse observations after the shell changes identity
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When a different applet subscribes after the shell changes identity
    Then it receives the cached tree event before its relay opens

  Scenario: Deletions are delivered live and do not change cached tree observations
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet explicitly subscribes to the author's deletion
    Then the deletion is delivered live but not cached and the tree event still replays

  Scenario: A filter limit applies once to the merged query
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries with a filter limit of one and a newer event online
    Then only the newer event is returned at the query deadline

  Scenario: Query filter limits are independent before applying the overall limit
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries with independently limited filters and an overall limit
    Then the query returns the newest match from each limited filter
