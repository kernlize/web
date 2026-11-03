Feature: Composite messaging backend
  One backend spans every enabled provider. Ids leaving it carry the provider
  as a prefix; ids arriving are routed by that prefix.

  Background:
    Given memory messaging backends "private, legacy" owned by "me"

  Scenario: with no providers the composite is unavailable
    Given a messaging composite over providers ""
    Then the composite messaging status is unavailable without owner
    And the composite status implementations are ""

  Scenario: status is available when any provider is
    Given memory messaging backend "legacy" is offline
    And a messaging composite over providers "private, legacy"
    Then the composite messaging status is available with owner "me"
    And the composite status implementations are "memory"
    And the composite status capabilities are "send, receive, subscribe, history"

  Scenario: conversations from several providers merge by most recent activity
    Given memory messaging backend "private" received "hi" from "alice" at 100
    And memory messaging backend "legacy" received "yo" from "bob" at 200
    And memory messaging backend "private" received "again" from "carol" at 150
    And a messaging composite over providers "private, legacy"
    When I list composite messaging conversations
    Then the composite conversation ids are "legacy:direct:bob, private:direct:carol, private:direct:alice"
    And the composite conversation page has no cursor

  Scenario: a limit applies to the merged list and drops the cursor
    Given memory messaging backend "private" received "hi" from "alice" at 100
    And memory messaging backend "legacy" received "yo" from "bob" at 200
    And memory messaging backend "private" received "again" from "carol" at 150
    And a messaging composite over providers "private, legacy"
    When I list composite messaging conversations with limit 2
    Then the composite conversation ids are "legacy:direct:bob, private:direct:carol"
    And the composite conversation page has no cursor

  Scenario: conversations without activity sort last
    Given a stub messaging backend "stub" whose conversations have no activity
    And memory messaging backend "private" received "hi" from "alice" at 100
    And a messaging composite over providers "stub, private"
    When I list composite messaging conversations
    Then the composite conversation ids are "private:direct:alice, stub:idle, stub:idle-2"

  Scenario: a single provider passes its cursor through
    Given memory messaging backend "private" received "a" from "alice" at 100
    And memory messaging backend "private" received "b" from "bob" at 200
    And memory messaging backend "private" received "c" from "carol" at 300
    And a messaging composite over providers "private"
    When I list composite messaging conversations with limit 2
    Then the composite conversation ids are "private:direct:carol, private:direct:bob"
    And the composite conversation cursor is "private:2"
    When I list composite messaging conversations from cursor "private:2"
    Then the composite conversation ids are "private:direct:alice"
    And the composite conversation page has no cursor

  Scenario: a cursor for an unknown provider is rejected
    Given a messaging composite over providers "private, legacy"
    When I list composite messaging conversations from cursor "ghost:2"
    Then the messaging error is "invalid:unknown-provider"

  Scenario: messages are routed by the conversation prefix
    Given memory messaging backend "private" received "hi" from "alice" at 100
    And a messaging composite over providers "private, legacy"
    When I list composite messaging messages in "private:direct:alice"
    Then the composite message ids are "private:msg-1"
    And every composite message belongs to conversation "private:direct:alice"

  Scenario: messages in a conversation without a prefix are rejected
    Given a messaging composite over providers "private, legacy"
    When I list composite messaging messages in "orphan"
    Then the messaging error is "invalid:unknown-provider"

  Scenario: sending into a conversation routes to its provider
    Given memory messaging backend "private" received "hi" from "alice" at 100
    And a messaging composite over providers "private, legacy"
    When I send "hello" to "alice" in composite conversation "private:direct:alice"
    Then the composite send result has id "private:msg-2" in conversation "private:direct:alice"
    And memory messaging backend "private" holds 2 messages in "direct:alice"

  Scenario: a provider hint picks the provider for a new conversation
    Given a messaging composite over providers "private, legacy"
    When I send "hello" to "bob" through composite provider "legacy"
    Then the composite send result has id "legacy:msg-1" in conversation "legacy:direct:bob"

  Scenario: an unknown provider hint is rejected
    Given a messaging composite over providers "private, legacy"
    When I send "hello" to "bob" through composite provider "ghost"
    Then the messaging error is "invalid:unknown-provider"

  Scenario: without a hint the default provider is used
    Given a messaging composite over providers "private, legacy"
    And the messaging composite default is "private"
    When I send "hello" to "bob" with the composite
    Then the composite send result has id "private:msg-1" in conversation "private:direct:bob"

  Scenario: without a default the send is refused
    Given a messaging composite over providers "private, legacy"
    When I send "hello" to "bob" with the composite
    Then the messaging error is "unavailable:no-default-provider"

  Scenario: a default that is no longer enabled is refused
    Given a messaging composite over providers "private, legacy"
    And the messaging composite default is "ghost"
    When I send "hello" to "bob" with the composite
    Then the messaging error is "unavailable:no-default-provider"

  Scenario: subscribing to everything prefixes delivered ids
    Given a messaging composite over providers "private, legacy"
    When I subscribe to all composite messaging conversations
    And memory messaging backend "legacy" received "yo" from "bob" at 200
    And memory messaging backend "private" received "hi" from "alice" at 100
    Then the composite delivered message ids are "legacy:msg-1, private:msg-1"
    And the composite delivered conversation ids are "legacy:direct:bob, private:direct:alice"
    When I unsubscribe the composite messaging subscription
    And memory messaging backend "legacy" received "later" from "bob" at 300
    Then the composite unsubscribe result is ok
    And the composite delivered message ids are "legacy:msg-1, private:msg-1"

  Scenario: subscribing to one conversation delivers only its messages
    Given a messaging composite over providers "private, legacy"
    When I subscribe to composite messaging conversation "private:direct:alice"
    And memory messaging backend "private" received "hi" from "alice" at 100
    And memory messaging backend "private" received "hey" from "carol" at 100
    And memory messaging backend "legacy" received "yo" from "bob" at 200
    Then the composite delivered message ids are "private:msg-1"

  Scenario: unsubscribing an unknown subscription is not ok
    Given a messaging composite over providers "private, legacy"
    When I unsubscribe composite messaging subscription "nope"
    Then the composite unsubscribe result is not ok

  Scenario: unsubscribing skips providers removed in the meantime
    Given a messaging composite over providers "private, legacy"
    When I subscribe to all composite messaging conversations
    And messaging composite provider "legacy" is removed
    And I unsubscribe the composite messaging subscription
    Then the composite unsubscribe result is ok

  Scenario: unsubscribing reports a provider that lost the subscription
    Given a messaging composite over providers "private, legacy"
    When I subscribe to all composite messaging conversations
    And memory messaging backend "private" is closed
    And I unsubscribe the composite messaging subscription
    Then the composite unsubscribe result is not ok

  Scenario: closing the composite leaves the backends alone
    Given a messaging composite over providers "private, legacy"
    When I close the messaging composite
    And memory messaging backend "private" received "hi" from "alice" at 100
    And I list composite messaging conversations
    Then the composite conversation ids are "private:direct:alice"
