Feature: Relay tiers
  The shell keeps four relay tiers: discovery for profiles and lists, apps for
  applet manifests, the user's outbox, and the super tier for everything else.
  Choices persist and replay to whoever subscribes.

  Scenario: fresh storage yields the defaults
    Given kernl relay tiers over empty storage
    Then the "discovery" tier is "wss://purplepag.es,wss://relay.nos.social"
    And the "apps" tier is "wss://relay.napplet.soy"
    And the "outbox" tier is ""
    And the "super" tier is "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net"

  Scenario: the host can override a tier's defaults
    Given kernl relay tiers over empty storage with "apps" defaulting to "wss://apps.example"
    Then the "apps" tier is "wss://apps.example"
    And the "super" tier is "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net"

  Scenario: adding a relay persists and is observed
    Given kernl relay tiers over empty storage
    When the shell adds "wss://relay.mine" to the "outbox" tier
    Then the "outbox" tier is "wss://relay.mine"
    And the tier configuration was observed 2 times
    And storage key "kernl:relays:v1" holds the current tiers

  Scenario: adding the same relay twice changes nothing
    Given kernl relay tiers over empty storage
    When the shell adds "wss://relay.mine" to the "outbox" tier
    And the shell adds "wss://relay.mine" to the "outbox" tier
    Then the "outbox" tier is "wss://relay.mine"
    And the tier configuration was observed 2 times

  Scenario: removing a relay
    Given kernl relay tiers over empty storage
    When the shell removes "wss://nos.lol" from the "super" tier
    Then the "super" tier is "wss://relay.damus.io,wss://relay.primal.net"
    When the shell removes "wss://nos.lol" from the "super" tier
    Then the tier configuration was observed 2 times

  Scenario: persisted tiers win over defaults, ignoring malformed entries
    Given storage key "kernl:relays:v1" holding '{"apps":["wss://saved.example", 7],"super":"not-a-list"}'
    And kernl relay tiers over that storage with "apps" defaulting to "wss://ignored.example"
    Then the "apps" tier is "wss://saved.example"
    And the "super" tier is "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net"

  Scenario: corrupt persisted tiers fall back to defaults
    Given storage key "kernl:relays:v1" holding 'not json'
    And kernl relay tiers over that storage
    Then the "apps" tier is "wss://relay.napplet.soy"

  Scenario: a relay must be a websocket URL
    Given kernl relay tiers over empty storage
    When the shell adds "https://relay.mine" to the "outbox" tier
    Then the shell refused with "invalid:relay-url"

  Scenario: a tier can be replaced at once, and an unchanged list is not observed again
    Given kernl relay tiers over empty storage
    When the shell sets the "outbox" tier to "wss://a.test,wss://b.test,wss://a.test"
    Then the "outbox" tier is "wss://a.test,wss://b.test"
    When the shell sets the "outbox" tier to "wss://a.test,wss://b.test"
    Then the tier configuration was observed 2 times
    When the shell sets the "outbox" tier to "wss://b.test"
    Then the "outbox" tier is "wss://b.test"
    When the shell sets the "outbox" tier to "wss://b.test,wss://c.test"
    Then the tier configuration was observed 4 times
    When the shell sets the "outbox" tier to "https://b.test"
    Then the shell refused with "invalid:relay-url"
