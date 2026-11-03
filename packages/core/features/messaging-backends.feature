Feature: Message backends over the account signer
  kernl's `private` and `legacy` backends carry messages with nothing but the
  active account's signer. Private messages are sealed by the account and
  wrapped under a key that exists for one wrap only; legacy messages are one
  encrypted event. Both file what they open into conversations whose id is the
  sorted set of people in them, so both sides agree on it.

  Background:
    Given a message network with alice, bob and carol

  Scenario: a private message is wrapped under a fresh key and sealed by the sender
    Given alice uses the private backend on "alice-phone"
    When "alice-phone" sends "hello bob" to "bob"
    Then the network carried 2 wraps of kind 1059 under keys that belong to nobody and differ per wrap
    And every wrap opens to a seal signed by alice
    And the wraps went to "bob" and to "alice"

  Scenario: the recipient reads the exact text and both sides share the conversation
    Given alice uses the private backend on "alice-phone"
    And bob uses the private backend on "bob-laptop"
    When "alice-phone" sends "hello bob, café ☕ at 3?" to "bob"
    Then "bob-laptop" shows a direct conversation with "alice" ending in "hello bob, café ☕ at 3?" as "received"
    And "alice-phone" shows a direct conversation with "bob" ending in "hello bob, café ☕ at 3?" as "sent"
    And "alice-phone" and "bob-laptop" use the conversation id of "alice,bob"
    When "bob-laptop" replies "see you there" in its conversation with "alice"
    Then "alice-phone" shows a direct conversation with "bob" ending in "see you there" as "received"
    And "alice-phone" holds 2 messages with "bob" and 1 unread

  Scenario: the copy to self reaches the sender's other device once
    Given alice uses the private backend on "alice-phone"
    And alice uses the private backend on "alice-laptop"
    When "alice-phone" sends "note for later" to "bob"
    Then "alice-laptop" shows a direct conversation with "bob" ending in "note for later" as "sent"
    And "alice-phone" holds 1 messages with "bob" and 0 unread

  Scenario: a message to two people is a group everyone files under one id
    Given alice uses the private backend on "alice-phone"
    And carol uses the private backend on "carol-tablet"
    When "alice-phone" sends "lunch?" to "bob,carol"
    Then "carol-tablet" shows a group conversation with "alice,bob" ending in "lunch?" as "received"
    And "alice-phone" and "carol-tablet" use the conversation id of "alice,bob,carol"
    And the network carried 3 wraps of kind 1059 under keys that belong to nobody and differ per wrap

  Scenario Outline: availability follows what the signer can do
    Given "<device>" runs the <backend> backend with <signer>
    Then "<device>" reports itself <status>
    And a send from "<device>" is refused with "<refusal>"

    Examples:
      | device | backend | signer                         | status                    | refusal                             |
      | d1     | private | nobody signed in               | unavailable               | unavailable:sign-in-required        |
      | d2     | private | a signer without encryption    | unavailable for the owner | unavailable:signer-cannot-encrypt   |
      | d3     | private | a signer with only nip04       | unavailable for the owner | unavailable:signer-cannot-encrypt   |
      | d4     | legacy  | a signer with only nip44       | unavailable for the owner | unavailable:signer-cannot-encrypt   |
      | d5     | legacy  | nobody signed in               | unavailable               | unavailable:sign-in-required        |
      | d6     | private | a signer but no public key     | unavailable               | unavailable:sign-in-required        |

  Scenario: a full signer makes both backends available and a read-only account cannot encrypt
    Given "d1" runs the private backend with a signer with only nip44
    And "d2" runs the legacy backend with a signer with only nip04
    Then "d1" reports itself available for the owner
    And "d2" reports itself available for the owner
    And a read-only account offers a signer that cannot encrypt
    And no account offers no signer and a signing account offers itself

  Scenario: a legacy message makes the round trip and reaches the sender's other device
    Given alice uses the legacy backend on "alice-phone"
    And alice uses the legacy backend on "alice-laptop"
    And bob uses the legacy backend on "bob-laptop"
    When "alice-phone" sends "the old way" to "bob"
    Then the network carried 1 events of kind 4 signed by alice
    And "bob-laptop" shows a direct conversation with "alice" ending in "the old way" as "received"
    And "alice-laptop" shows a direct conversation with "bob" ending in "the old way" as "sent"
    And "alice-phone" and "bob-laptop" use the conversation id of "alice,bob"
    When "alice-phone" sends "two of you" to "bob,carol"
    Then the last send was refused with "invalid:groups-unsupported"

  Scenario: private wraps that do not open are ignored
    Given bob uses the private backend on "bob-laptop"
    When a rogue server pushes these to everyone:
      | a note addressed to bob             |
      | a wrap addressed to carol           |
      | a wrap for bob with a broken id     |
      | a wrap for bob that does not decrypt |
      | a wrap for bob around a note        |
    Then "bob-laptop" has no conversations
    When a rogue server pushes these to everyone:
      | a message from alice wrapped for bob |
    Then "bob-laptop" shows a direct conversation with "alice" ending in "pushed" as "received"

  Scenario: legacy messages that do not open are ignored
    Given bob uses the legacy backend on "bob-laptop"
    When a rogue server pushes these to everyone:
      | a legacy message to bob with no text        |
      | a legacy message to bob with a broken id    |
      | a legacy message between alice and carol    |
      | a legacy message to bob that does not decrypt |
    Then "bob-laptop" has no conversations

  Scenario: unsubscribing stops delivery
    Given alice uses the private backend on "alice-phone"
    And bob uses the private backend on "bob-laptop"
    When "bob-laptop" subscribes to everything as "all"
    And "bob-laptop" subscribes to its conversation with "carol" as "carol-only"
    And "alice-phone" sends "first" to "bob"
    Then subscription "all" saw "first"
    And subscription "carol-only" saw nothing
    When subscription "all" is cancelled
    And "alice-phone" sends "second" to "bob"
    Then subscription "all" saw "first"
    And cancelling subscription "all" again reports false

  Scenario: the recipient's inbox list decides where a wrap goes and where they listen
    Given bob lists "wss://bob-inbox.example/" as his message inbox
    And alice uses the private backend on "alice-phone"
    And bob uses the private backend on "bob-laptop"
    When "alice-phone" sends "via the inbox" to "bob"
    Then the wrap to "bob" went to "wss://bob-inbox.example/"
    And the wrap to "alice" went to "wss://outbox.example/,wss://super.example/"
    And "bob-laptop" listens on "wss://bob-inbox.example/"
    And "alice-phone" listens on "wss://outbox.example/,wss://super.example/"
    And "bob-laptop" shows a direct conversation with "alice" ending in "via the inbox" as "received"

  Scenario: an inbox list already in the store is used without asking the network
    Given alice uses the private backend on "alice-phone"
    And "alice-phone" already holds bob's message inbox "wss://bob-held.example/"
    When "alice-phone" sends "from the store" to "bob"
    Then the wrap to "bob" went to "wss://bob-held.example/"

  Scenario: when the lookup fails the tiers carry the message
    Given the network refuses lookups
    And alice uses the private backend on "alice-phone"
    When "alice-phone" sends "fallback" to "bob"
    Then the wrap to "bob" went to "wss://outbox.example/,wss://super.example/"

  Scenario: sends that cannot go anywhere are refused
    Given alice uses the private backend on "alice-phone"
    When "alice-phone" sends "to me" to "alice"
    Then the last send was refused with "invalid:no-recipients"
    When "alice-phone" sends "to nobody" to the raw recipients "zz"
    Then the last send was refused with "invalid:recipient"
    When "alice-phone" sends "elsewhere" into the conversation of "bob,carol"
    Then the last send was refused with "invalid:unknown-conversation"
    Given the network refuses publishes
    When "alice-phone" sends "lost" to "bob"
    Then the last send was refused with "unavailable:offline"
    And "alice-phone" has no conversations

  Scenario: conversations and messages page with cursors
    Given alice uses the private backend on "alice-phone"
    When "alice-phone" sends "one" to "bob"
    And "alice-phone" sends "two" to "carol"
    And "alice-phone" sends "three" to "carol"
    Then "alice-phone" pages conversations one at a time as "carol,bob"
    And "alice-phone" pages its messages with "carol" one at a time as "two,three"
    And "alice-phone" treats an unreadable cursor as the start

  Scenario: switching accounts swaps the inbox and drops what the last account had
    Given alice uses the private backend on "shared-desk"
    And bob uses the private backend on "bob-laptop"
    When "bob-laptop" sends "for alice" to "alice"
    Then "shared-desk" shows a direct conversation with "bob" ending in "for alice" as "received"
    When "shared-desk" switches to carol
    Then "shared-desk" has no conversations
    And "shared-desk" reports itself available for the owner
    When "shared-desk" signs out
    Then "shared-desk" reports itself unavailable
    And "shared-desk" has no conversations

  Scenario: an account change reopens the inbox for live subscribers
    Given alice uses the private backend on "shared-desk"
    And bob uses the private backend on "bob-laptop"
    When "shared-desk" subscribes to everything as "desk"
    And "shared-desk" switches to carol and announces it
    And "bob-laptop" sends "hi carol" to "carol"
    Then subscription "desk" saw "hi carol"

  Scenario: a message still opening when the account changes is not shown to the next account
    Given carol uses the private backend on "shared-desk"
    And bob uses the private backend on "bob-laptop"
    When "shared-desk" subscribes to everything as "desk"
    And "bob-laptop" sends "for carol" to "carol" and "shared-desk" switches to alice at once
    Then "shared-desk" has no conversations
    And subscription "desk" saw nothing

  Scenario: an inbox still opening when the account changes is abandoned
    Given alice uses the private backend on "shared-desk"
    When "shared-desk" starts reading and switches to carol before the inbox opens
    Then the network holds 0 inbox subscriptions for alice and 1 for carol
    When "shared-desk" is closed
    Then the network holds 0 inbox subscriptions for alice and 0 for carol
