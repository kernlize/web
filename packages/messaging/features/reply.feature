Feature: Which provider carries a message
  A message to someone new leaves through the first enabled provider in the
  user's order, and falls to the next one when that provider cannot reach the
  person. A reply is different: when the person last wrote through another
  provider, the shell asks before it sends, because they may not read a reply
  that arrives another way. The user can settle the question for one person or
  for everyone.

  Rule: the order picks the provider for someone new

    Background:
      Given memory messaging backends "private, legacy" owned by "me"

    Scenario: the default cannot reach the person, so the next provider is tried
      Given a messaging backend "group" that cannot reach anyone
      And a messaging composite over providers "group, private, legacy"
      And the messaging composite default is "group"
      When I send "hello" to "bob" with the composite
      Then the composite send result has id "private:msg-1" in conversation "private:direct:bob"

    Scenario: providers ahead of the default are not tried
      Given a messaging backend "group" that cannot reach anyone
      And a messaging composite over providers "private, group, legacy"
      And the messaging composite default is "group"
      When I send "hello" to "bob" with the composite
      Then the composite send result has id "legacy:msg-1" in conversation "legacy:direct:bob"

    Scenario: when no provider can reach the person the first refusal is reported
      Given a messaging backend "group" that cannot reach anyone
      And a messaging backend "ratchet" that cannot reach anyone
      And a messaging composite over providers "group, ratchet"
      And the messaging composite default is "group"
      When I send "hello" to "bob" with the composite
      Then the messaging error is "unavailable:recipient-not-ready group"

    Scenario: any other refusal stops the send
      Given a stub messaging backend "stub" whose conversations have no activity
      And a messaging composite over providers "stub, private"
      And the messaging composite default is "stub"
      When I send "hello" to "bob" with the composite
      Then the messaging error is "unavailable:stub"
      And memory messaging backend "private" holds 0 messages in "direct:bob"

  Rule: a reply follows the correspondent only when the host says so

    Background:
      Given memory messaging backends "private, legacy" owned by "me"
      And a messaging composite over providers "private, legacy" that follows the correspondent
      And the messaging composite default is "private"

    Scenario: a message to someone who last wrote through another provider is offered theirs
      Given memory messaging backend "legacy" received "yo" from "bob" at 100
      When I send "hello" to "bob" with the composite
      Then the reply choice was "bob" theirs "legacy" mine "private"
      And the composite send result has id "legacy:msg-2" in conversation "legacy:direct:bob"

    Scenario: the most recent message decides which provider is theirs
      Given memory messaging backend "legacy" received "old" from "bob" at 100
      And memory messaging backend "private" received "new" from "bob" at 200
      When I send "hello" to "bob" with the composite
      Then no reply choice was offered
      And the composite send result has id "private:msg-2" in conversation "private:direct:bob"

    Scenario: my own messages do not count as theirs
      Given memory messaging backend "private" received "hi" from "bob" at 100
      And memory messaging backend "legacy" holds my message "sent" to "bob"
      When I send "hello" to "bob" with the composite
      Then no reply choice was offered

    Scenario: someone who never wrote gets the default without a question
      When I send "hello" to "bob" with the composite
      Then no reply choice was offered
      And the composite send result has id "private:msg-1" in conversation "private:direct:bob"

    Scenario: a reply into a conversation is offered the provider they moved to
      Given memory messaging backend "private" received "first" from "bob" at 100
      And memory messaging backend "legacy" received "later" from "bob" at 200
      When I send "hello" to "bob" in composite conversation "private:direct:bob"
      Then the reply choice was "bob" theirs "legacy" mine "private"
      And the composite send result has id "legacy:msg-2" in conversation "legacy:direct:bob"
      And memory messaging backend "private" holds 1 messages in "direct:bob"

    Scenario: a client message id travels with a reply that moved
      Given memory messaging backend "private" received "first" from "bob" at 100
      And memory messaging backend "legacy" received "later" from "bob" at 200
      When I send "hello" as "draft-7" in composite conversation "private:direct:bob"
      Then the composite send result has id "legacy:draft-7" in conversation "legacy:direct:bob"

    Scenario: a reply into a conversation they still use is not questioned
      Given memory messaging backend "private" received "first" from "bob" at 100
      When I send "hello" to "bob" in composite conversation "private:direct:bob"
      Then no reply choice was offered
      And the composite send result has id "private:msg-2" in conversation "private:direct:bob"

    Scenario: a message to several people is never moved
      Given memory messaging backend "legacy" received "yo" from "bob" at 100
      When I send "hello" to the people "bob, carol, me" with the composite
      Then no reply choice was offered
      And the composite send result has id "private:msg-1" in conversation "private:group:bob,carol"

    Scenario: a group conversation is never moved
      Given memory messaging backend "legacy" received "yo" from "bob" at 100
      And memory messaging backend "private" holds my message "hi all" to "bob, carol"
      When I send "hello" to "bob" in composite conversation "private:group:bob,carol"
      Then no reply choice was offered
      And memory messaging backend "private" holds 2 messages in "group:bob,carol"

    Scenario: a conversation with nobody else in it is never moved
      Given a stub messaging backend "stub" whose conversations have no activity
      And a messaging composite over providers "private, legacy, stub" that follows the correspondent
      When I send "note" to "me" in composite conversation "stub:idle"
      Then the messaging error is "unavailable:stub"
      And no reply choice was offered

    Scenario: a conversation the provider does not know is refused by the provider
      When I send "hello" to "bob" in composite conversation "private:direct:ghost"
      Then the messaging error is "invalid:unknown-conversation"

    Scenario: naming the provider is not second-guessed
      Given memory messaging backend "legacy" received "yo" from "bob" at 100
      When I send "hello" to "bob" through composite provider "private"
      Then no reply choice was offered
      And the composite send result has id "private:msg-1" in conversation "private:direct:bob"

    Scenario: with one provider there is nothing to choose
      Given memory messaging backend "legacy" received "yo" from "bob" at 100
      And messaging composite provider "legacy" is removed
      When I send "hello" to "bob" with the composite
      Then no reply choice was offered

    Scenario: a long history is read to its end
      Given memory messaging backend "legacy" received 120 messages from other people
      And memory messaging backend "legacy" received 150 messages from "bob" starting at 1000
      And memory messaging backend "private" received "hi" from "bob" at 1100
      When I send "hello" to "bob" with the composite
      Then the reply choice was "bob" theirs "legacy" mine "private"

    Scenario: a conversation with nothing newer is not read
      Given memory messaging backend "private" received "hi" from "bob" at 200
      And a messaging backend "old" whose conversation with "bob" at 100 cannot be read
      And a messaging composite over providers "private, old" that follows the correspondent
      When I send "hello" to "bob" with the composite
      Then no reply choice was offered

    Scenario: a conversation that does not say when it was last active is read
      Given memory messaging backend "private" received "hi" from "bob" at 200
      And a messaging backend "undated" whose conversation with "bob" holds a message at 300
      And a messaging composite over providers "private, undated" that follows the correspondent
      When I send "hello" to "bob" with the composite
      Then the reply choice was "bob" theirs "undated" mine "private"

    Scenario: the choice names the person the way their provider does
      Given a messaging backend "named" that knows "bob" as "Bob" and holds his message at 300
      And a messaging composite over providers "private, named" that follows the correspondent
      When I send "hello" to "bob" with the composite
      Then the reply choice named the person "Bob"

    Scenario: a backend whose pages never end is not followed forever
      Given memory messaging backend "private" received "hi" from "bob" at 200
      And a messaging backend "endless" whose conversation pages never end
      And a messaging backend "bottomless" whose message pages never end for "bob"
      And a messaging composite over providers "private, endless, bottomless" that follows the correspondent
      When I send "hello" to "bob" with the composite
      Then no reply choice was offered
      When I send "hello" to "bob" in composite conversation "endless:direct:bob"
      Then the messaging error is "unavailable:stub"

  Rule: the registry asks the user, and remembers what they settle

    Background:
      Given a messaging registry that asks about replies
      And I register the messaging provider "private"
      And I register the messaging provider "legacy"
      And I enable messaging provider "private"
      And I enable messaging provider "legacy"
      And the registry's "legacy" backend received "yo" from "bob" at 100

    Scenario: the question names both providers and the person
      Given the user will answer the reply question with "theirs" for "once"
      When I send "hello" to "bob" with the registry composite
      Then the reply question was asked 1 time
      And the reply question named "bob", theirs "Legacy messages" and mine "Private messages"
      And the composite send result has id "legacy:msg-2" in conversation "legacy:direct:bob"
      And the messaging reply rule is "ask"
      And the messaging change listener fired 2 times

    Scenario: keeping my own provider
      Given the user will answer the reply question with "mine" for "once"
      When I send "hello" to "bob" with the registry composite
      Then the composite send result has id "private:msg-1" in conversation "private:direct:bob"

    Scenario: dismissing the question stops the send
      Given the user will dismiss the reply question
      When I send "hello" to "bob" with the registry composite
      Then the messaging error is "denied:cancelled"
      And the registry's "private" backend holds 0 messages in "direct:bob"

    Scenario: an answer kept for the conversation is not asked again
      Given the user will answer the reply question with "theirs" for "conversation"
      When I send "hello" to "bob" with the registry composite
      And I send "again" to "bob" with the registry composite
      Then the reply question was asked 1 time
      And the messaging reply choices are "bob=theirs"
      And the composite send result has id "legacy:msg-3" in conversation "legacy:direct:bob"
      And the messaging change listener fired 3 times

    Scenario: an answer kept for the conversation leaves other people undecided
      Given the user will answer the reply question with "mine" for "conversation"
      And the registry's "legacy" backend received "hey" from "carol" at 100
      When I send "hello" to "bob" with the registry composite
      And I send "hello" to "carol" with the registry composite
      Then the reply question was asked 2 times

    Scenario: an answer kept for everyone becomes the rule
      Given the user will answer the reply question with "theirs" for "always"
      And the registry's "legacy" backend received "hey" from "carol" at 100
      When I send "hello" to "bob" with the registry composite
      And I send "hello" to "carol" with the registry composite
      Then the reply question was asked 1 time
      And the messaging reply rule is "theirs"
      And the composite send result has id "legacy:msg-4" in conversation "legacy:direct:carol"

    Scenario: the rule to keep my order never asks
      When I set the messaging reply rule to "mine"
      And I send "hello" to "bob" with the registry composite
      Then the reply question was asked 0 times
      And the composite send result has id "private:msg-1" in conversation "private:direct:bob"

    Scenario: what was settled for a person outranks the rule
      Given the user will answer the reply question with "mine" for "conversation"
      When I send "hello" to "bob" with the registry composite
      And I set the messaging reply rule to "theirs"
      And I send "again" to "bob" with the registry composite
      Then the composite send result has id "private:msg-2" in conversation "private:direct:bob"

    Scenario: forgetting one person's answer asks again
      Given the user will answer the reply question with "theirs" for "conversation"
      When I send "hello" to "bob" with the registry composite
      And I forget the messaging reply choice for "bob"
      And I send "again" to "bob" with the registry composite
      Then the reply question was asked 2 times

    Scenario: forgetting every answer at once
      Given the user will answer the reply question with "theirs" for "conversation"
      When I send "hello" to "bob" with the registry composite
      And I forget every messaging reply choice
      Then the messaging reply choices are ""

  Rule: saved answers come back, and a host that cannot ask keeps the order

    Scenario: a saved rule and saved answers are restored
      Given a messaging registry restoring the reply rule "theirs" and choices "bob=mine"
      Then the messaging reply rule is "theirs"
      And the messaging reply choices are "bob=mine"

    Scenario: without a way to ask, the order's provider is used
      Given a messaging registry
      And I register the messaging provider "private"
      And I register the messaging provider "legacy"
      And I enable messaging provider "private"
      And I enable messaging provider "legacy"
      And the registry's "legacy" backend received "yo" from "bob" at 100
      When I send "hello" to "bob" with the registry composite
      Then the composite send result has id "private:msg-1" in conversation "private:direct:bob"
