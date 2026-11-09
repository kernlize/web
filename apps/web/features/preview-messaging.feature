Feature: The preview's messaging
  The preview uses the real messaging registry and the real provider
  definitions over in-memory backends. Two providers start switched on, each
  with someone who already wrote through it, so the reply question can be
  tried. A scripted correspondent answers every send after a moment, and the
  ratchet provider truthfully reports that it
  cannot run in a browser without its runtime. The group provider asks for a
  signed-in account, which the preview does not have.

  Scenario: a first visit switches on two providers and each correspondent has already written
    When the preview messaging opens
    Then the preview messaging offers "private,legacy,ratchet,group"
    And the preview messaging has "private,legacy" enabled with "private" as the default
    And the preview messaging reports "ratchet" unavailable because "no-ratchet-runtime"
    And a "ratchet" backend built anyway reports itself offline
    And the preview messaging reports "group" unavailable because "sign-in-required"
    And a "group" backend built anyway reports itself offline
    And the preview correspondent has opened with 2 messages
    And the preview knows its correspondents as "Ada,Grace"
    And "Grace" last wrote through "legacy"

  Scenario: saved preferences are restored and every change is saved
    Given the preview messaging preferences are stored as '{"enabled":["legacy"],"defaultProvider":"legacy"}'
    When the preview messaging opens
    Then the preview messaging has "legacy" enabled with "legacy" as the default
    And the preview messaging has 1 conversation
    When the preview messaging enables "private"
    Then the preview messaging stored "legacy,private" as enabled

  Scenario Outline: unusable saved preferences fall back to the defaults
    Given the preview messaging preferences are stored as '<raw>'
    When the preview messaging opens
    Then the preview messaging has "private,legacy" enabled with "private" as the default

    Examples:
      | raw                 |
      | not json            |
      | 42                  |
      | {"enabled":"legacy"} |

  Scenario: the correspondent answers after a moment, one reply after another
    When the preview messaging opens
    And the preview messaging sends "hi" to "correspondent" through "private"
    Then the preview messaging thread has 2 received messages
    When the preview correspondent takes its time
    Then the preview messaging thread holds a reply from "correspondent" saying "Got it. That arrived the way you sent it."
    When the preview messaging sends "again" to "correspondent" through "private"
    And the preview correspondent takes its time
    Then the preview messaging thread holds a reply from "correspondent" saying "Your providers and their order are under Settings, Messages. The first one that is switched on is used first."

  Scenario: whoever the message went to is the one who answers
    Given the preview messaging preferences are stored as '{"enabled":["legacy"],"defaultProvider":"legacy"}'
    When the preview messaging opens
    And the preview messaging sends "hello" to "another account" through "legacy"
    And the preview correspondent takes its time
    Then the preview messaging thread holds a reply from "another account" saying "Got it. That arrived the way you sent it."

  Scenario: an answer in the opening thread that names no one is answered by the correspondent
    When the preview messaging opens
    And the preview messaging answers "memo" in the opening thread without naming anyone
    And the preview correspondent takes its time
    Then the preview messaging thread holds a reply from "correspondent" saying "Got it. That arrived the way you sent it."

  Scenario: answering the person who wrote another way puts the question to the user
    Given the preview user answers the reply question with "theirs"
    When the preview messaging opens
    And the preview messaging sends "hello Grace" to "the legacy correspondent" without naming a provider
    Then the preview user was asked about "Grace", theirs "Legacy messages" and mine "Private messages"
    And the preview message left through "legacy"

  Scenario: an account the preview does not know keeps its id for a name
    When the preview messaging opens
    And the preview messaging sends "hello" to "another account" through "private"
    Then the preview names nobody in the conversation that message started
