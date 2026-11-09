Feature: Relay adapters over the one applesauce pool
  Every kehto relay surface is a thin adapter over the shell's single pool
  (D-002). Tier selection routes filters by kind: profiles, follows and relay
  lists go to the people tier (discovery, the user's outbox and the general
  servers), manifests to the applet catalogue, everything else to the general
  path. Subscriptions report the end of stored events once, after every relay
  answered. A publish succeeds when any relay accepts it (D-028).

  Background:
    Given kernl relay tiers over empty storage
    And a fake applesauce pool

  Scenario Outline: filters are routed to the tier their kinds belong to
    When the shell selects relays for kinds "<kinds>"
    Then the selected relays are the "<tier>" tier

    Examples:
      | kinds          | tier      |
      | 0,3,10002      | people    |
      | 35129,5129     | apps      |
      | 32267          | apps      |
      | 1,0            | general   |
      | 1              | general   |

  Scenario: filters without kinds take the general path
    When the shell selects relays for filters without kinds
    Then the selected relays are the "general" tier
    When the shell selects relays for an empty kinds list
    Then the selected relays are the "general" tier

  Scenario: the general tier is the super tier plus the outbox, deduplicated
    When the shell adds "wss://nos.lol" to the "outbox" tier
    And the shell selects relays for kinds "1"
    Then the selected relays are "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net"

  Scenario: a subscription delivers each event once and one EOSE after every relay answered
    Given the fake pool serves 2 events
    When the shell subscribes with EOSE on "wss://a.example,wss://b.example/"
    Then the subscription delivered 2 events and 1 EOSE
    And the fake pool received a "req" for "wss://a.example,wss://b.example/"

  Scenario: an empty relay list reports EOSE at once
    When the shell subscribes with EOSE on ""
    Then the subscription delivered 0 events and 1 EOSE

  Scenario: a relay that closes the request counts as answered, and later answers are ignored
    Given the fake pool also emits a "CLOSED" from "wss://b.example"
    And the fake pool also emits an "ERROR" from "wss://a.example"
    When the shell subscribes with EOSE on "wss://a.example,wss://b.example"
    Then the subscription delivered 0 events and 1 EOSE

  Scenario: the RelayPoolLike adapter forwards subscriptions, requests and publishes
    Given the fake pool serves 1 events
    When the shell uses the RelayPoolLike adapter to subscribe on "wss://a.example"
    Then the subscription delivered 1 events and 1 EOSE
    When the shell uses the RelayPoolLike adapter to request on "wss://a.example"
    Then the request delivered 1 events and completed
    When the shell uses the RelayPoolLike adapter to publish to "wss://a.example"
    Then the fake pool received a "publish" for "wss://a.example"

  Scenario: a failing request reports its error through the adapter
    Given the fake pool fails requests
    When the shell uses the RelayPoolLike adapter to request on "wss://a.example"
    Then the request errored
    And the request handle can be unsubscribed

  Scenario: tracked subscriptions are cleaned up when replaced or untracked
    Given kernl relay pool hooks
    When the shell tracks subscription "s1"
    And the shell tracks subscription "s1"
    Then 1 tracked cleanups ran
    When the shell untracks subscription "s1"
    Then 2 tracked cleanups ran
    When the shell untracks subscription "missing"
    Then 2 tracked cleanups ran
    And the relay pool hooks select the "people" tier for kinds "0"

  Scenario: a scoped relay posts events and EOSE to the window's port
    Given kernl relay pool hooks
    And the fake pool serves 1 events
    When the shell opens a scoped relay "wss://group.example" for window "w1"
    Then the scoped target received envelope types "relay.event,relay.eose"
    And the fake pool received a "req" for "wss://group.example"
    When the shell publishes to the scoped relay of window "w1"
    Then the scoped publish succeeded
    And the fake pool received a "publish" for "wss://group.example"
    When the shell opens a scoped relay "wss://other.example" for window "w1"
    And the shell closes the scoped relay of window "w1"
    And the shell publishes to the scoped relay of window "w1"
    Then the scoped publish failed

  Scenario: a scoped publish that the relay refuses reports failure
    Given kernl relay pool hooks
    And the fake pool refuses publishes
    When the shell opens a scoped relay "wss://group.example" for window "w1"
    And the shell publishes to the scoped relay of window "w1"
    Then the scoped publish failed

  Scenario: a scoped relay that answers with a refusal reports failure
    Given kernl relay pool hooks
    And the fake pool relays "wss://group.example" answer publishes with a refusal
    When the shell opens a scoped relay "wss://group.example" for window "w1"
    And the shell publishes to the scoped relay of window "w1"
    Then the scoped publish failed

  Scenario: a publish that two of three relays accept succeeds
    Given the fake pool relays "wss://c.example" answer publishes with a refusal
    When the shell publishes through the accepting helper to "wss://a.example,wss://b.example,wss://c.example"
    Then 2 relays accepted the publish

  Scenario: a publish no relay accepts fails and says how many were tried
    Given the fake pool relays "wss://a.example,wss://b.example" answer publishes with a refusal
    When the shell publishes through the accepting helper to "wss://a.example,wss://b.example"
    Then the shell refused with "unavailable:not-accepted:0/2"
    When the shell publishes through the accepting helper to ""
    Then the shell refused with "unavailable:not-accepted:0/0"

  Scenario: the applet relay backend routes by tier unless hinted
    Given the fake pool serves 1 events
    When the applet relay backend subscribes to kinds "0" without hints
    Then the fake pool received a "req" for the "people" tier
    And the subscription delivered 1 events and 1 EOSE
    When the applet relay backend subscribes to kinds "1" hinted to "wss://hint.example"
    Then the fake pool received a "req" for "wss://hint.example"
    When the applet relay backend publishes a kind 0 event
    Then the fake pool received a "publish" for the "people" tier
    And the applet relay backend is available

  Scenario: the messaging relay pool reads, writes and queries through the same pool
    Given the fake pool serves 2 events
    When the messaging relay pool subscribes to kinds "1059" without hints
    Then the fake pool received a "req" for the "general" tier
    When the messaging relay pool queries kinds "1059" without hints
    Then the query returned 2 events
    And the fake pool received a "request" for the "general" tier
    When the messaging relay pool queries kinds "1059" hinted to "wss://dm.example"
    Then the fake pool received a "request" for "wss://dm.example"
    When the messaging relay pool publishes a kind 1059 event
    Then the fake pool received a "publish" for the "general" tier
    And the messaging relay pool is available and selects the "general" tier for kinds "1"

  Scenario: the outbox relay pool reports per-relay outcomes
    Given the fake pool serves 1 events
    When the outbox relay pool subscribes on "wss://out.example"
    Then the subscription delivered 1 events and 1 EOSE
    When the outbox relay pool publishes to "wss://out.example,wss://two.example"
    Then the outbox publish reported "wss://out.example,wss://two.example" as accepted
    And the outbox relay pool is available
