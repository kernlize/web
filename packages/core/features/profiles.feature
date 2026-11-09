Feature: Profiles
  The shell shows a person by the name they published, never only by their
  key when a name can be found. A card asks the lookup relays for the profile
  and the relay list together; when the list names the author's own servers
  and the lookup relays did not have the profile, it is asked for there too
  (NIP-65). Nothing gives up on a timer: a profile that arrives late replaces
  the short key.

  Background:
    Given an event store
    And a profile service over a recording loader

  Scenario: a key with no profile reads as its short form
    Then the card for "alice" is named with the short key and not found

  Scenario: a published profile names the person, with only a safe picture
    Given the store holds a profile for "alice" with display name "Alice A", name "alice", picture "https://img.example/a.png", address "alice@example.com" and about "hi"
    Then the card for "alice" is named "Alice A" with picture "https://img.example/a.png"
    And the card for "alice" carries address "alice@example.com" and about "hi"
    Given the store holds a profile for "bob" with display name "", name "", picture "javascript:alert(1)", address "" and about ""
    Then the card for "bob" is named with the short key and found
    And the card for "bob" has no picture

  Scenario: a profile that is not JSON is not a profile
    Given the store holds a broken profile for "carol"
    Then the card for "carol" is named with the short key and not found

  Scenario: watching a card asks for the profile and the relay list, and updates when the profile arrives
    When the shell watches the card for "alice"
    Then the loader was asked for kinds "0,10002" of "alice" on the lookup relays
    And the watched card for "alice" is named with the short key
    When the loader delivers a profile for "alice" named "Alice"
    Then the watched card for "alice" is named "Alice"

  Scenario: a profile missing from the lookup relays is found on the author's own servers
    When the shell watches the card for "alice"
    And the loader delivers a relay list for "alice" writing to "wss://own-relay.com/,wss://lookup-relay.com/"
    Then the loader was asked for kind 0 of "alice" on "wss://own-relay.com/"

  Scenario: a relay list is not followed once the profile is known
    When the shell watches the card for "alice"
    And the loader delivers a profile for "alice" named "Alice"
    And the loader delivers a relay list for "alice" writing to "wss://own-relay.com/"
    Then the loader was asked 2 times

  Scenario: a loader that fails leaves the short key
    Given a profile service over a failing loader
    When the shell watches the card for "alice"
    Then the watched card for "alice" is named with the short key

  Scenario: one card per key, shared by every watcher, and nothing asked for a malformed key
    When the shell watches the card for "alice" twice
    Then the loader was asked 2 times
    And watching "ALICE" gives the same card
    When the shell watches the card for key "not-a-key"
    Then the loader was asked 2 times

  Scenario: an unwatched card stops asking after it has been left alone
    When the shell watches the card for "alice" and stops
    Then the card lookups for "alice" were closed after the keep-alive

  Scenario: settling waits for a name or for every lookup server, never for a clock
    When the shell settles the card for "alice"
    And the loader delivers a profile for "alice" named "Alice"
    Then the settled card is named "Alice"
    When the shell settles the card for "bob"
    And the loader finishes without a profile
    Then the settled card for "bob" is the short key
    When the shell settles the card for key "not-a-key"
    Then the settled card is named "not-a-ke…"

  Scenario: settling a key whose lookup fails gives the short key
    Given a profile service over a failing loader
    When the shell settles the card for "carol"
    Then the settled card for "carol" is the short key
