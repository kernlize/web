Feature: Identity lookups
  Applets never see the event store. The identity service answers from it on
  their behalf and loads misses once from the lookup relays, the discovery
  tier then the general one; what the shell
  has not fetched is reported as empty, never invented.

  Background:
    Given kernl relay tiers over empty storage
    And a fake applesauce pool
    And an event store

  Scenario: a profile already in the store is mapped field by field
    Given the store holds a kind 0 profile for "alice" with every field
    When the identity providers look up the profile of "alice"
    Then the profile has name "alice", display name "Alice", about "dev", picture "https://img.example/a.png", banner "https://img.example/b.png", address "alice@example.com", payment "alice@pay.example" and website "https://alice.example"

  Scenario: empty profile fields are left out
    Given the store holds a kind 0 profile for "bob" with only a name
    When the identity providers look up the profile of "bob"
    Then the profile is exactly name "bob"

  Scenario: a profile without a name keeps only what it has
    Given the store holds a kind 0 profile for "frank" with only an about
    When the identity providers look up the profile of "frank"
    Then the profile is exactly about "likes relays"

  Scenario: a profile whose content is not JSON is reported as missing
    Given the store holds a kind 0 profile for "mallory" with broken content
    When the identity providers look up the profile of "mallory"
    Then the profile is null

  Scenario: a miss is loaded once through the injected loader
    Given a loader that returns a kind 0 profile for "carol" with only a name
    When the identity providers look up the profile of "carol"
    Then the profile is exactly name "carol"
    And the loader was asked for kind 0 from the lookup relays

  Scenario: a loader that fills the store without emitting still resolves
    Given a loader that stores a kind 0 profile for "dave" with only a name and emits nothing
    When the identity providers look up the profile of "dave"
    Then the profile is exactly name "dave"

  Scenario: an unresolved miss is null and the default loader asked the pool
    When the identity providers without an injected loader look up the profile of "erin"
    Then the profile is null
    And the default loader asked every lookup relay

  Scenario: follows, mutes and relays come from their replaceable events
    Given the store holds a kind 3 follow list for "alice" following "0000000000000000000000000000000000000000000000000000000000000001,0000000000000000000000000000000000000000000000000000000000000002"
    And the store holds a kind 10000 mute list for "alice" muting "0000000000000000000000000000000000000000000000000000000000000003"
    And the store holds a kind 10002 relay list for "alice" with "wss://purplepag.es=read,wss://nos.lol=write,wss://relay.damus.io="
    When the identity providers look up follows, mutes and relays of "alice"
    Then the follows are "0000000000000000000000000000000000000000000000000000000000000001,0000000000000000000000000000000000000000000000000000000000000002"
    And the mutes are "0000000000000000000000000000000000000000000000000000000000000003"
    And the relays are "wss://purplepag.es/=read,wss://nos.lol/=write,wss://relay.damus.io/=read+write"

  Scenario: missing lists are empty, and the lookups kernl does not back are empty too
    Given a loader that returns nothing
    When the identity providers look up follows, mutes and relays of "nobody"
    Then the follows are ""
    And the mutes are ""
    And the relays are ""
    And the list, zap, blocked and badge lookups return empty
