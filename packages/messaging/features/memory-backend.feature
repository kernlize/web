Feature: In-memory messaging backend
  A complete backend that lives in memory, for tests and the shell's offline
  preview. Sends are stored and echoed to subscribers; deliver() plays the
  other side of the conversation.

  Background:
    Given a memory messaging backend owned by "me" at time 1000

  Scenario: status reports the owner and availability
    Then the memory backend status is available with owner "me"
    And the memory backend status implementations are "memory"

  Scenario: the defaults are an available backend owned by "owner" on the wall clock
    Given a memory messaging backend with default options
    When I send "hi" to "alice" on the memory backend
    Then the memory backend status is available with owner "owner"
    And the memory send result is from "owner" with a wall-clock time

  Scenario: sending creates a direct conversation
    When I send "hi" to "alice" on the memory backend
    Then the memory send result has id "msg-1" in "direct:alice" with status "sent" from "me" at 1000
    And the memory conversations are "direct:alice"
    And memory conversation "direct:alice" is "direct" with participants "alice" and 0 unread

  Scenario: sending to several recipients creates a group and drops the owner
    When I send "hi" to "bob, alice, me" on the memory backend
    Then the memory conversations are "group:alice,bob"
    And memory conversation "group:alice,bob" is "group" with participants "alice, bob" and 0 unread

  Scenario: a client message id becomes the message id
    When I send "hi" to "alice" with client id "c-1" on the memory backend
    Then the memory send result has id "c-1" in "direct:alice" with status "sent" from "me" at 1000

  Scenario: sending into an existing conversation appends
    When I send "hi" to "alice" on the memory backend
    And I send "again" into memory conversation "direct:alice"
    Then memory conversation "direct:alice" holds 2 messages
    And the memory message ids in "direct:alice" are "msg-1, msg-2"

  Scenario: sending into an unknown conversation is rejected
    When I send "hi" into memory conversation "direct:nobody"
    Then the messaging error is "invalid:unknown-conversation"

  Scenario: sending to nobody is rejected
    When I send "hi" to "me" on the memory backend
    Then the messaging error is "invalid:no-recipients"

  Scenario: an offline backend still serves history but refuses to send
    Given a memory messaging backend that is offline
    Then the memory backend status is unavailable
    When I send "hi" to "alice" on the memory backend
    Then the messaging error is "unavailable:offline"
    And the memory conversations are ""

  Scenario: delivered messages are unread and conversations sort by activity
    When the memory backend receives "hello" from "alice" at 1500
    And I send "hi" to "bob" on the memory backend
    Then the memory conversations are "direct:alice, direct:bob"
    And memory conversation "direct:alice" is "direct" with participants "alice" and 1 unread
    And memory conversation "direct:alice" was updated at 1500
    And the memory message "msg-1" in "direct:alice" has status "received" from "alice"

  Scenario: delivery into a named conversation uses the clock
    When I send "hi" to "bob, alice" on the memory backend
    And the memory backend receives "hello" from "alice" in conversation "group:alice,bob"
    Then memory conversation "group:alice,bob" is "group" with participants "alice, bob" and 1 unread
    And memory conversation "group:alice,bob" holds 2 messages
    And memory conversation "group:alice,bob" was updated at 1000

  Scenario: conversations are paged with offset cursors
    When the memory backend receives "a" from "alice" at 1
    And the memory backend receives "b" from "bob" at 2
    And the memory backend receives "c" from "carol" at 3
    And I list memory conversations with limit 2
    Then the memory conversations are "direct:carol, direct:bob"
    And the memory conversation cursor is "2"
    When I list memory conversations from cursor "2" with limit 2
    Then the memory conversations are "direct:alice"
    And the memory conversation page has no cursor

  Scenario: a malformed cursor starts from the beginning
    When the memory backend receives "a" from "alice" at 1
    And I list memory conversations from cursor "junk" with limit 5
    Then the memory conversations are "direct:alice"

  Scenario: messages are paged with offset cursors
    When I send "one" to "alice" on the memory backend
    And I send "two" into memory conversation "direct:alice"
    And I send "three" into memory conversation "direct:alice"
    And I list memory messages in "direct:alice" with limit 2
    Then the memory message ids are "msg-1, msg-2"
    And the memory message cursor is "2"
    When I list memory messages in "direct:alice" from cursor "2" with limit 2
    Then the memory message ids are "msg-3"
    And the memory message page has no cursor

  Scenario: an unknown conversation has no messages
    When I list memory messages in "direct:nobody"
    Then the memory message ids are ""

  Scenario: subscribers see sends and deliveries until they unsubscribe
    When I subscribe to all memory messaging conversations
    And I send "hi" to "alice" on the memory backend
    And the memory backend receives "yo" from "bob" at 1200
    Then the memory delivered message ids are "msg-1, msg-2"
    When I unsubscribe the memory messaging subscription
    And I send "later" to "alice" on the memory backend
    Then the memory unsubscribe result is ok
    And the memory delivered message ids are "msg-1, msg-2"

  Scenario: a conversation subscription filters by conversation
    When I subscribe to memory messaging conversation "direct:alice"
    And I send "hi" to "alice" on the memory backend
    And the memory backend receives "yo" from "bob" at 1200
    Then the memory delivered message ids are "msg-1"

  Scenario: unsubscribing an unknown subscription is not ok
    When I unsubscribe memory messaging subscription "nope"
    Then the memory unsubscribe result is not ok

  Scenario: closing drops every subscriber
    When I subscribe to all memory messaging conversations
    And I close the memory backend
    And I send "hi" to "alice" on the memory backend
    Then the memory delivered message ids are ""
