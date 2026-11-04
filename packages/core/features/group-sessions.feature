Feature: Group sessions over the account signer
  kernl's `group` backend carries messages in groups whose shared keys move
  on with every change, using the group library over the active account's
  signer. The account proves who each member is and opens invitations; the
  library's secrets are sealed to the account before they are stored; the
  messages themselves are kept in memory only, so a reload starts each group's
  history afresh. Every
  scenario runs real key agreement between test accounts over a fake network.

  Background:
    Given a message network with alice, bob and carol

  Scenario: three people read each other in one group
    Given alice sets up group sessions on "alice-phone"
    And bob sets up group sessions on "bob-laptop"
    And carol sets up group sessions on "carol-tablet"
    When "alice-phone" sends "lunch?" to "bob,carol"
    Then "carol-tablet" shows a group conversation with "alice,bob" ending in "lunch?" as "received"
    And "bob-laptop" shows a group conversation with "alice,carol" ending in "lunch?" as "received"
    And "alice-phone" shows a group conversation with "bob,carol" ending in "lunch?" as "sent"
    And "alice-phone", "bob-laptop" and "carol-tablet" file it under one group id
    When "bob-laptop" replies "yes, café ☕ at 1" in its conversation with "alice,carol"
    Then "carol-tablet" shows a group conversation with "alice,bob" ending in "yes, café ☕ at 1" as "received"
    And "alice-phone" holds 2 messages with "bob,carol" and 1 unread

  Scenario: the network sees key packages, sealed invitations and group events, never the text
    Given alice sets up group sessions on "alice-phone"
    And bob sets up group sessions on "bob-laptop"
    When "alice-phone" sends "the secret plan" to "bob"
    Then "bob-laptop" shows a direct conversation with "alice" ending in "the secret plan" as "received"
    And the network carried a key package signed by "alice" and one signed by "bob"
    And the network carried group events signed by nobody in the group
    And no event on the network contains "the secret plan"

  Scenario: a second send to the same people stays in the same group
    Given alice sets up group sessions on "alice-phone"
    And bob sets up group sessions on "bob-laptop"
    When "alice-phone" sends "one" to "bob"
    And "alice-phone" sends "two" to "bob"
    Then "bob-laptop" holds 2 messages with "alice" and 2 unread
    And "alice-phone" has 1 conversations

  Scenario: what a device stores is sealed to its account and survives a reload
    Given alice sets up group sessions on "alice-phone"
    And bob sets up group sessions on "bob-laptop"
    When "alice-phone" sends "before" to "bob"
    Then "bob-laptop" shows a direct conversation with "alice" ending in "before" as "received"
    And everything "bob-laptop" stored is sealed to bob
    When bob reloads group sessions on "bob-laptop"
    Then "bob-laptop" has no conversations
    When "alice-phone" replies "after the reload" in its conversation with "bob"
    Then "bob-laptop" shows a direct conversation with "alice" ending in "after the reload" as "received"
    When "bob-laptop" replies "still here" in its conversation with "alice"
    Then "alice-phone" holds 3 messages with "bob" and 1 unread
    And a sealed group store forgets everything when it is cleared

  Scenario: people who have not set up group sessions cannot be added
    Given alice sets up group sessions on "alice-phone"
    When "alice-phone" sends "hello?" to "carol"
    Then the last send was refused with "unavailable:recipient-not-ready"
    When the network refuses lookups
    And "alice-phone" sends "hello?" to "bob"
    Then the last send was refused with "unavailable:recipient-not-ready"
    When "alice-phone" sends "hello?" into the conversation of "alice,bob"
    Then the last send was refused with "invalid:unknown-conversation"
    When "alice-phone" sends "hello?" to the raw recipients "not-a-key"
    Then the last send was refused with "invalid:recipient"

  Scenario: a message no relay accepts is taken back
    Given alice sets up group sessions on "alice-phone"
    And bob sets up group sessions on "bob-laptop"
    When "alice-phone" sends "first" to "bob"
    And the network refuses publishes
    And "alice-phone" replies "lost" in a refused send to "bob"
    Then the last send was refused with "unavailable:offline"
    And "alice-phone" holds 1 messages with "bob" and 0 unread

  Scenario: another app's invitations and non-text payloads are handled
    Given bob sets up group sessions on "bob-laptop"
    When dave starts a group with "bob" from another app and sends a reaction and then "from dave"
    Then "bob-laptop" shows a direct conversation with "dave" ending in "from dave" as "received"
    And "bob-laptop" holds 1 messages with "dave" and 1 unread
    When a rogue server sends bob an invitation that cannot be joined and a broken group event
    Then "bob-laptop" holds 1 messages with "dave" and 1 unread

  Scenario: subscriptions see new messages and the account switch forgets them
    Given alice sets up group sessions on "alice-phone"
    And bob sets up group sessions on "bob-laptop"
    When "bob-laptop" subscribes to everything as "all"
    And "bob-laptop" subscribes to its conversation with "alice" as "one"
    And "alice-phone" sends "pushed" to "bob"
    Then subscription "all" saw "pushed"
    And subscription "one" saw nothing
    When subscription "all" is cancelled
    Then cancelling subscription "all" again reports false
    When "bob-laptop" switches to carol and announces it
    Then "bob-laptop" has no conversations
    When "bob-laptop" signs out
    Then "bob-laptop" reports itself unavailable
    And "bob-laptop" has no conversations
    When "bob-laptop" is closed

  Scenario: a person is one member of a group, so one of their devices joins
    Given alice sets up group sessions on "alice-phone"
    And alice sets up group sessions on "alice-laptop"
    And bob sets up group sessions on "bob-laptop"
    When "bob-laptop" sends "just you" to "alice"
    Then "bob-laptop" shows a direct conversation with "alice" ending in "just you" as "sent"
    And exactly one of "alice-phone" and "alice-laptop" has a conversation with "bob"

  Scenario: a message that lands as the account changes is not shown to the next account
    Given alice sets up group sessions on "alice-phone"
    And bob sets up group sessions on "bob-laptop"
    When "alice-phone" sends "first" to "bob"
    And "alice-phone" sends "racing" to "bob" and "bob-laptop" switches to carol at once
    Then "bob-laptop" has no conversations
    When carol uses the group backend on "carol-tablet"
    And "carol-tablet" starts reading and switches to alice before the inbox opens
    Then "carol-tablet" has no conversations

  Scenario Outline: availability follows what the signer can do
    Given "<device>" runs the group backend with <signer>
    Then "<device>" reports itself <status>
    And a send from "<device>" is refused with "<refusal>"

    Examples:
      | device | signer                  | status                    | refusal                           |
      | g1     | nobody signed in        | unavailable               | unavailable:sign-in-required      |
      | g2     | a signer with only nip04 | unavailable for the owner | unavailable:signer-cannot-encrypt |
