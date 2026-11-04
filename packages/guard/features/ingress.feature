Feature: Ingress flood control
  Each applet window has a per-second burst budget. Spent budgets queue
  traffic, full queues reject it, and sustained floods quarantine the window
  until the user intervenes. Every non-pass disposition is reported as an event.

  Background:
    Given a guard ingress guard using the "strict" profile with a drain batch of 4

  Scenario: a burst within the budget passes silently
    When the guard admits 8 "relay.subscribe" envelopes from window "w1"
    Then every guard disposition so far is "pass"
    And the guard emitted no events

  Scenario: the message after the burst is deferred
    When the guard admits 9 "relay.subscribe" envelopes from window "w1"
    Then the guard's last disposition is "defer"
    And the guard emitted 1 events
    And the guard's last event has disposition "defer" and reason "flood:burst"
    And the guard's last event names window "w1" and applet "chat" with class "relay:subscribe"

  Scenario: a caller that refuses instead of holding gets the deferral without a queue
    When the guard admits 9 "relay.subscribe" envelopes from window "w1" without holding any
    Then the guard's last disposition is "defer"
    And the guard's last event has disposition "defer" and reason "flood:burst"
    When the guard clock advances by 125 ms
    And the guard admits a "relay.subscribe" envelope from window "w1"
    Then the guard's last disposition is "pass"

  Scenario: windows have independent budgets
    When the guard admits 8 "relay.subscribe" envelopes from window "w1"
    And the guard admits 8 "relay.subscribe" envelopes from window "w2"
    Then every guard disposition so far is "pass"

  Scenario: a full queue rejects further messages
    When the guard admits 72 "relay.subscribe" envelopes from window "w1"
    Then the guard's last disposition is "defer"
    When the guard admits a "relay.subscribe" envelope from window "w1"
    Then the guard's last disposition is "reject"
    And the guard's last event has disposition "reject" and reason "flood:queue-full"

  Scenario: the budget refills over time
    When the guard admits 8 "relay.subscribe" envelopes from window "w1"
    And the guard clock advances by 1000 ms
    And the guard admits 8 "relay.subscribe" envelopes from window "w1"
    Then every guard disposition so far is "pass"

  Scenario: a clock that runs backwards does not grant tokens
    When the guard admits 8 "relay.subscribe" envelopes from window "w1"
    And the guard clock rewinds by 5000 ms
    And the guard admits a "relay.subscribe" envelope from window "w1"
    Then the guard's last disposition is "defer"

  Scenario: drain releases control first, then resources, then the rest, oldest first
    When the guard admits 8 "relay.subscribe" envelopes from window "w1"
    And the guard admits a "clipboard.write" envelope from window "w1"
    And the guard admits a "resource.fetch" envelope from window "w1"
    And the guard admits a "shell.close" envelope from window "w1"
    And the guard admits a "storage.get" envelope from window "w1"
    And the guard admits a "resource.head" envelope from window "w1"
    And the guard clock advances by 1000 ms
    And the guard drains window "w1"
    Then the guard drained envelope types "shell.close, storage.get, resource.fetch, resource.head"
    When the guard drains window "w1"
    Then the guard drained envelope types "clipboard.write"
    When the guard drains window "w1"
    Then the guard drained nothing

  Scenario: drain releases no more than the refilled budget allows
    When the guard admits 8 "relay.subscribe" envelopes from window "w1"
    And the guard admits 3 "clipboard.write" envelopes from window "w1"
    And the guard clock advances by 250 ms
    And the guard drains window "w1"
    Then the guard drained envelope types "clipboard.write, clipboard.write"

  Scenario: a new message waits behind the queue even when the budget has refilled
    When the guard admits 8 "relay.subscribe" envelopes from window "w1"
    And the guard admits a "clipboard.write" envelope from window "w1"
    And the guard clock advances by 1000 ms
    And the guard admits a "storage.set" envelope from window "w1"
    Then the guard's last disposition is "defer"
    When the guard drains window "w1"
    Then the guard drained envelope types "clipboard.write, storage.set"

  Scenario: draining an unknown window yields nothing
    When the guard drains window "ghost"
    Then the guard drained nothing

  Scenario: a flood inside ten seconds quarantines the window
    When the guard admits 299 "shell.ping" envelopes from window "w1"
    Then guard window "w1" is not quarantined
    When the guard admits a "shell.ping" envelope from window "w1"
    Then the guard's last disposition is "quarantine"
    And the guard's last event has disposition "quarantine" and reason "flood:quarantine"
    And guard window "w1" is quarantined
    When the guard admits a "relay.subscribe" envelope from window "w1"
    Then the guard's last disposition is "quarantine"
    And the guard's last event has disposition "quarantine" and reason "flood:quarantine"
    And the guard emitted 293 events

  Scenario: quarantine drops anything still queued
    When the guard admits 300 "shell.ping" envelopes from window "w1"
    And the guard clock advances by 1000 ms
    And the guard drains window "w1"
    Then the guard drained nothing

  Scenario: the quarantine window rolls
    When the guard admits 299 "shell.ping" envelopes from window "w1"
    And the guard clock advances by 10001 ms
    And the guard admits a "shell.ping" envelope from window "w1"
    Then guard window "w1" is not quarantined

  Scenario: releasing a window lifts quarantine and restores its budget
    When the guard admits 300 "shell.ping" envelopes from window "w1"
    And the guard releases window "w1"
    Then guard window "w1" is not quarantined
    When the guard admits a "relay.subscribe" envelope from window "w1"
    Then the guard's last disposition is "pass"

  Scenario: forgetting a window drops its state
    When the guard admits 300 "shell.ping" envelopes from window "w1"
    And the guard forgets window "w1"
    Then guard window "w1" is not quarantined
    And guard window "never-seen" is not quarantined

  Scenario: a hidden window may fetch only its allowance of resources
    Given guard window "w1" is hidden
    When the guard admits 8 "resource.fetch" envelopes from window "w1"
    Then guard window "w1" is not quarantined
    When the guard admits a "resource.fetch" envelope from window "w1"
    Then the guard's last disposition is "quarantine"
    And the guard's last event has disposition "quarantine" and reason "flood:hidden-resource"

  Scenario: hidden control traffic does not count against the resource allowance
    Given guard window "w1" is hidden
    When the guard admits 20 "shell.ping" envelopes from window "w1"
    Then guard window "w1" is not quarantined

  Scenario: becoming visible resets the hidden resource count
    Given guard window "w1" is hidden
    When the guard admits 8 "resource.fetch" envelopes from window "w1"
    Given guard window "w1" is visible
    When the guard admits a "resource.fetch" envelope from window "w1"
    Given guard window "w1" is hidden
    When the guard admits 8 "resource.fetch" envelopes from window "w1"
    Then guard window "w1" is not quarantined

  Scenario Outline: oversized envelopes are rejected by class
    When the guard admits a "<type>" envelope of <size> bytes from window "w1"
    Then the guard's last disposition is "reject"
    And the guard's last event has disposition "reject" and reason "<reason>"

    Examples:
      | type            | size   | reason                |
      | resource.fetch  | 65537  | size:resource:bytes   |
      | relay.subscribe | 262145 | size:relay:subscribe  |
      | outbox.query    | 262145 | size:outbox:subscribe |

  Scenario Outline: envelopes at or under the cap, and uncapped classes, pass
    When the guard admits a "<type>" envelope of <size> bytes from window "w1"
    Then the guard's last disposition is "pass"

    Examples:
      | type            | size     |
      | resource.fetch  | 65536    |
      | relay.subscribe | 262144   |
      | relay.publish   | 10000000 |

  Scenario: an envelope without a size is not size-checked
    When the guard admits a "resource.fetch" envelope from window "w1"
    Then the guard's last disposition is "pass"

  Scenario: the default drain batch is four
    Given a guard ingress guard using the "strict" profile with an injected clock only
    When the guard admits 8 "relay.subscribe" envelopes from window "w1"
    And the guard admits 6 "clipboard.write" envelopes from window "w1"
    And the guard clock advances by 1000 ms
    And the guard drains window "w1"
    Then the guard drained 4 envelopes

  Scenario: the guard runs on the wall clock when none is injected
    Given a guard ingress guard using the "strict" profile with default options
    When the guard admits 9 "relay.subscribe" envelopes from window "w1"
    Then the guard's last disposition is "defer"
