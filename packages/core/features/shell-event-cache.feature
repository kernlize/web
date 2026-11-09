Feature: The shell's event cache
  The shell opens its event cache in the background and starts at once. Loaders
  ask the cache before any relay, so what was seen on an earlier visit shows
  immediately and the relays are still asked for anything newer. A cache that
  fails to open, or is not configured, leaves the shell working from memory
  (D-030).

  Scenario: without a cache, or with one that fails to open, nothing is cached and closing is harmless
    Given the shell connects no event cache
    Then a cache request for kind 0 returns 0 events
    And closing the connected cache succeeds
    Given the shell connects an event cache that fails to open
    Then a cache request for kind 0 returns 0 events
    And closing the connected cache succeeds

  Scenario: a connected cache answers loaders with events marked as from the cache, and closes
    Given the shell connects a memory event cache holding a profile named "Cached"
    Then a cache request for kind 0 returns 1 events marked as from the cache
    And closing the connected cache closes it

  Scenario: the store lists cached applets before any relay answers, then keeps them alongside the relays'
    Given the fake pool streams catalogue manifests "fresh@5" seen on "wss://seen.example/", then fails
    And the catalogue cache holds manifests "cached@3"
    When the catalogue is streamed from the cache and the relays
    Then the first streamed list is "cached@3"
    And the catalogue lists "fresh@5,cached@3"
    And the store kept the relays' manifest "fresh"

  Scenario: a catalogue cache that fails is skipped
    Given the fake pool serves catalogue manifests "fresh@5"
    And the catalogue cache fails
    When the catalogue is streamed from the cache and the relays
    Then the catalogue lists "fresh@5"

  Scenario: a shell with a cache names its account from a profile cached on an earlier visit
    Given a kernl host over empty storage
    And a fake applesauce pool
    And a kernl shell whose event cache holds a profile named "From last time" for a fresh key
    When the shell logs in read-only as that fresh key
    Then the shell session label eventually is "From last time"
    And the shell's event cache closes when the shell is destroyed
