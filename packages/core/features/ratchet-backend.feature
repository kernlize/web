Feature: Ratchet sessions over the account signer
  kernl's `ratchet` backend runs the ratchet library for the active account.
  The account signer signs the account's device list; the library makes and
  keeps its own device and session keys, and kernl stores them only sealed to
  the account. Two accounts that share a relay set up a session from each
  other's published invite and then talk with keys that change every message.

  Background:
    Given a ratchet network with alice, bob and carol

  Scenario: two accounts set up a session and exchange messages
    Given alice opens ratchet sessions on "alice-phone"
    And alice opens ratchet sessions on "alice-laptop"
    And bob opens ratchet sessions on "bob-laptop"
    And "alice-phone" watches its ratchet messages
    When "alice-phone" sends "hello bob, café ☕" to "bob" over ratchet
    Then "bob-laptop" has a ratchet chat with "alice" ending in "hello bob, café ☕" as "received"
    And "alice-phone" has a ratchet chat with "bob" ending in "hello bob, café ☕" as "sent"
    And "alice-laptop" has a ratchet chat with "bob" ending in "hello bob, café ☕" as "sent"
    When "bob-laptop" replies "hi alice" in its ratchet conversation with "alice"
    Then "alice-phone" has a ratchet chat with "bob" ending in "hi alice" as "received"
    And the watcher on "alice-phone" saw "hello bob, café ☕|hi alice"
    And no event on the network carries "hello bob" or "hi alice" in the clear
    And "alice-phone" reports a ratchet status for "alice"

  Scenario: nothing the library keeps is stored readable, and a reload keeps the session
    Given alice opens ratchet sessions on "alice-phone"
    And bob opens ratchet sessions on "bob-laptop"
    When "alice-phone" sends "first" to "bob" over ratchet
    Then "bob-laptop" has a ratchet chat with "alice" ending in "first" as "received"
    And the storage of "alice-phone" holds only ciphertext sealed to "alice"
    When "alice-phone" reloads
    And "bob-laptop" replies "after the reload" in its ratchet conversation with "alice"
    Then "alice-phone" has a ratchet chat with "bob" ending in "after the reload" as "received"

  Scenario: a ratchet session is one to one
    Given alice opens ratchet sessions on "alice-phone"
    Then sending over ratchet on "alice-phone" to "bob,carol" fails with "invalid:groups-unsupported"
    And sending over ratchet on "alice-phone" to "alice" fails with "invalid:no-recipients"
    And sending over ratchet on "alice-phone" in the conversation of "bob,carol" fails with "invalid:unknown-conversation"

  Scenario: the backend follows the signer
    Given a ratchet backend on "shared" with nobody signed in
    Then the ratchet status on "shared" is unavailable
    And sending over ratchet on "shared" to "bob" fails with "unavailable:sign-in-required"
    And "shared" lists 0 ratchet conversations
    When "carol" signs in read-only on "shared"
    Then sending over ratchet on "shared" to "bob" fails with "unavailable:signer-cannot-encrypt"
    When "alice" signs in on "shared"
    And bob opens ratchet sessions on "bob-laptop"
    And "bob-laptop" sends "for alice" to "alice" over ratchet
    Then "shared" has a ratchet chat with "bob" ending in "for alice" as "received"
    When "carol" signs in on "shared"
    Then "shared" lists 0 ratchet conversations
    When the ratchet backend on "shared" is closed
    Then the ratchet status on "shared" is unavailable

  Scenario: an unreachable network fails setup with a reason and recovers
    Given alice opens ratchet sessions on "alice-phone" while the network refuses everything
    Then sending over ratchet on "alice-phone" to "bob" fails with "unavailable:offline"
    When the account on "alice-phone" announces a change
    When the network accepts again
    And bob opens ratchet sessions on "bob-laptop"
    And "alice-phone" sends "back online" to "bob" over ratchet
    Then "bob-laptop" has a ratchet chat with "alice" ending in "back online" as "received"

  Scenario: the default registry offers ratchet while the account signer can encrypt
    Given the default messaging registry with a ratchet backend following "shared"
    Then provider "ratchet" on "shared" is unavailable because "sign-in-required"
    When "carol" signs in read-only on "shared"
    Then provider "ratchet" on "shared" is unavailable because "signer-cannot-encrypt"
    When "alice" signs in on "shared"
    Then provider "ratchet" on "shared" is available

  Scenario: sealed storage keeps large values, forgets deleted ones and lists by prefix
    Given sealed ratchet storage for "alice"
    When the sealed storage puts a value of 40000 characters at "v1/big"
    And the sealed storage puts "small" at "v1/small" and "other" at "v2/other"
    And the sealed storage deletes "v1/small" and "v1/missing"
    Then the sealed storage lists "v1/big" under "v1/" and 2 keys in all
    And fresh sealed storage for "alice" over the same place reads the 40000 characters at "v1/big" and nothing at "v1/small"
    And fresh sealed storage for "alice" returns the newer value when a put lands during a read
