Feature: Social actions for applets
  Applets read profiles and follows, and follow, unfollow, react and report,
  through the shell (NAP-COMMON). Reads are public data. A follow-list change
  replaces part of the person's public record, so it passes the shell's
  signing gate and is shown as what it changes; reactions and reports are
  posts. Every write succeeds when any relay accepts it (D-028, D-035).

  Background:
    Given social actions for a signed-in account following "bob"

  Scenario: a profile is read by key or shared address, and a key with none reads as none
    Given "carol" published a profile named "Carol" and displayed as "Carol C."
    Then the profile of "carol" read by key is named "Carol" and displayed as "Carol C."
    And the profile of "carol" read by shared address is named "Carol" and displayed as "Carol C."
    And the profile of "dave" reads as none
    Given "erin" published a profile named "Erin" and displayed as ""
    Then the profile of "erin" read by key is named "Erin" with no display name
    And the profile of "not a key" is refused with "invalid:pubkey"

  Scenario: the account's follows are read from its current list
    Then the account follows "bob"

  Scenario: following someone keeps everyone else, the other tags and the content, and passes the signing gate
    When the applet follows "carol"
    Then the action succeeded and the account follows "bob,carol"
    And the new follow list kept the "client" tag and the content
    And the signing gate saw a kind 3 change from window "w1"
    When the applet follows "carol"
    Then the account follows "bob,carol"

  Scenario: unfollowing removes only those people
    When the applet unfollows "bob"
    Then the action succeeded and the account follows ""

  Scenario: a follow the person refuses, a key that is not one, and no relay accepting all fail with a reason
    Given the signing gate refuses
    When the applet follows "carol"
    Then the action failed with "denied:consent"
    And the account follows "bob"
    Given the signing gate refuses with a bare reason "no thanks"
    When the applet follows "carol"
    Then the action failed with "no thanks"
    Given the signing gate allows
    When the applet follows "not a key"
    Then the action failed with "invalid:pubkey"
    Given no relay accepts
    When the applet follows "carol"
    Then the action failed with "unavailable:not-accepted:0/1"

  Scenario: a reaction names the event, its author and kind, and a custom emoji
    Given "carol" posted a note the store holds
    When the applet reacts "+" to carol's note
    Then the published reaction has tags "e,p,k" and content "+"
    When the applet reacts ":party:" with emoji "https://emoji.test/party.png" to carol's note
    Then the published reaction has tags "e,p,k,emoji" and content ":party:"
    When the applet reacts "+" with emoji "https://emoji.test/party.png" to carol's note
    Then the published reaction has tags "e,p,k" and content "+"
    When the applet reacts "+" to an event the shell has not seen
    Then the published reaction has tags "e" and content "+"

  Scenario: a report names its target and reason
    When the applet reports carol's account for "spam" saying "bot"
    Then the published report has tags "p:spam" and content "bot"
    When the applet reports an event by "carol" for "illegal" saying ""
    Then the published report has tags "e:illegal,p"
    When the applet reports an event of no known author for "other" saying "?"
    Then the published report has tags "e:other"

  Scenario: a read-only or signed-out session reads but cannot write
    Given social actions for a read-only session
    When the applet follows "carol"
    Then the action failed with "denied:read-only"
    When the applet reacts "+" to an event the shell has not seen
    Then the action failed with "denied:read-only"
    Given social actions with nobody signed in
    When the applet follows "carol"
    Then the action failed with "denied:read-only"
    And reading the account's follows fails with "denied:signed-out"

  Scenario: in the shell, a follow-list lookup that fails still lets the person follow, published to the people tier
    Given the shell's social actions over a pool that accepts and a follow-list lookup that fails
    When the applet follows "carol" through the shell's social actions
    Then the shell published a kind 3 list to the people tier
