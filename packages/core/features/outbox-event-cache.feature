Feature: Approved Outbox reads reuse public tree events
  The shell may replay verified observations for the same applet and identity
  from a public relay in the new approved read plan. The relay read still runs.

  Scenario: A reopened subscription replays once before its relay opens
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet subscribes to the tree on "wss://nos.lol, wss://relay.routstr.com"
    Then the cached tree event is sent before opening the two approved relays
    And a live copy from the same relay does not repeat the event
    And a live copy from another approved relay adds its observed hint

  Scenario Outline: Cache replay cannot cross a scope boundary
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When an Outbox read changes its <boundary>
    Then no cached Outbox event is sent

    Examples:
      | boundary          |
      | applet artifact   |
      | shell identity    |
      | relay plan        |
      | filter author     |
      | routed author     |
      | filter tag        |
      | firewall answer   |
      | subscription close |
      | window teardown   |
      | permission revocation |
      | capability revocation |
      | signed-out account    |

  Scenario: A query still waits for the approved relays and merges cached matches
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries the tree on "wss://nos.lol, wss://relay.routstr.com"
    Then the one-shot query waits for the relay deadline and returns the cached event with its observed hint

  Scenario: A verified deletion stops replay of the target, not the network read
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When that author deletes it on the same Outbox relay
    And its applet subscribes to the tree on "wss://nos.lol"
    Then no cached Outbox event is sent

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

  Scenario: A deletion also stops replay from a second public relay
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When that author deletes it on a different approved Outbox relay
    And its applet subscribes to the tree on "wss://nos.lol"
    Then no cached Outbox event is sent

  Scenario: Query limit applies to the merged result
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries with a limit of one and a newer event online
    Then only the newer event is returned at the query deadline

  Scenario: The old identity's cache is not delivered when the identity changes mid-query
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries and the shell changes identity before the deadline
    Then the query completes without the old identity's cache

  Scenario: A live copy received again after deletion does not re-enter cache
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When that author deletes it on the same Outbox relay
    And its applet subscribes with a matching event on a public relay
    And its applet subscribes to the tree on "wss://nos.lol" with no relay events
    Then no cached Outbox event is sent

  Scenario: The cached branch is skipped when no verified applet identity is available
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When the same reads arrive without a verified applet identity
    Then neither read receives cached events

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

  Scenario: An account switch during approval skips the previous identity's cache
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet subscribes and the shell changes identity before approval
    Then no cached Outbox event is sent

  Scenario: Equal-timestamp query events are ordered by id when applying a limit
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet queries with a limit of one and another event at the same time
    Then the lower event id is returned at the query deadline

  Scenario: Lookup by id continues to use the existing Outbox router
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When its applet looks up the event by id
    Then that id lookup contacts the relay normally

  Scenario: A deletion observed during a pending query prevents cached replay
    Given a previously observed Outbox tree event on "wss://nos.lol"
    When the applet queries and then observes a deletion before the query finishes
    Then the query completes without the deleted cached event

  Scenario: An address deletion observed before its target prevents later caching
    Given an Outbox subscription observes a public tree address deletion before its target
    When its applet subscribes with a matching event on a public relay
    And its applet subscribes to the tree on "wss://nos.lol" with no relay events
    Then no cached Outbox event is sent
