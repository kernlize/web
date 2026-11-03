Feature: The preview's messaging
  The preview uses the real messaging registry and the real provider
  definitions over in-memory backends. A scripted correspondent answers every
  send after a moment, and the ratchet provider truthfully reports that it
  cannot run in a browser without its runtime.

  Scenario: a first visit enables the private provider and the correspondent says hello
    When the preview messaging opens
    Then the preview messaging offers "private,legacy,ratchet"
    And the preview messaging has "private" enabled with "private" as the default
    And the preview messaging reports "ratchet" unavailable because "no-ratchet-runtime"
    And a "ratchet" backend built anyway reports itself offline
    And the preview correspondent has opened with 2 messages

  Scenario: saved preferences are restored and every change is saved
    Given the preview messaging preferences are stored as '{"enabled":["legacy"],"defaultProvider":"legacy"}'
    When the preview messaging opens
    Then the preview messaging has "legacy" enabled with "legacy" as the default
    And the preview messaging has 0 conversations
    When the preview messaging enables "private"
    Then the preview messaging stored "legacy,private" as enabled

  Scenario Outline: unusable saved preferences fall back to the defaults
    Given the preview messaging preferences are stored as '<raw>'
    When the preview messaging opens
    Then the preview messaging has "private" enabled with "private" as the default

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
    Then the preview messaging thread holds a reply from "correspondent" saying "Got it. Which provider did that come through?"
    When the preview messaging sends "again" to "correspondent" through "private"
    And the preview correspondent takes its time
    Then the preview messaging thread holds a reply from "correspondent" saying "The shell shows the provider on each thread, so you always know who could read what."

  Scenario: whoever the message went to is the one who answers
    Given the preview messaging preferences are stored as '{"enabled":["legacy"],"defaultProvider":"legacy"}'
    When the preview messaging opens
    And the preview messaging sends "hello" to "another account" through "legacy"
    And the preview correspondent takes its time
    Then the preview messaging thread holds a reply from "another account" saying "Got it. Which provider did that come through?"

  Scenario: an answer in the opening thread that names no one is answered by the correspondent
    When the preview messaging opens
    And the preview messaging answers "memo" in the opening thread without naming anyone
    And the preview correspondent takes its time
    Then the preview messaging thread holds a reply from "correspondent" saying "Got it. Which provider did that come through?"
