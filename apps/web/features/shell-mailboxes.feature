Feature: Editing the inbox and outbox in Settings
  Settings edits the account's published inbox and outbox. It starts from the
  published list, or from suggestions when the account has none, adds what the
  person types as a server address, completes it from monitored servers, and
  says how many servers took the saved list, never what they answered.

  Scenario: the draft starts from what is published, from suggestions, or from nothing yet
    Then the draft while looking is empty
    And the draft for a missing list is the suggested "wss://s.test,wss://S.test/" and "wss://t.test", spelled "wss://s.test/" and "wss://t.test/"
    And the draft for a found list is its inbox "wss://in.test" and outbox "wss://out.test", spelled "wss://in.test/" and "wss://out.test/"

  Scenario: servers are added as addresses and removed by address
    Given a draft with inbox "wss://in.test/" and outbox ""
    When the person adds "nos.lol" to the outbox
    And the person adds "wss://IN.test" to the inbox
    And the person adds "wss://nos.lol/" to the outbox
    Then the draft has inbox "wss://in.test/" and outbox "wss://nos.lol/"
    When the person removes "wss://in.test/" from the inbox
    Then the draft has inbox "" and outbox "wss://nos.lol/"
    And adding "not a server" to the inbox is refused with "invalid:relay-url"
    And adding "localhost" to the inbox is refused with "invalid:relay-url"

  Scenario: there is something to save when nothing is published, or when a side differs
    Given a draft with inbox "wss://in.test/" and outbox "wss://out.test/"
    Then the draft needs saving against a missing list
    And the draft does not need saving against the found list with inbox "wss://in.test/" and outbox "wss://out.test/"
    And the draft does not need saving against the found list with inbox "wss://IN.test" and outbox "wss://out.test"
    And the draft needs saving against the found list with inbox "wss://other.test/" and outbox "wss://out.test/"
    And the draft needs saving against the found list with inbox "wss://in.test/" and outbox ""

  Scenario: what the person types is completed from monitored servers they do not already have
    Given a directory that knows "wss://nos.lol/,wss://nostr.mom/,wss://relay.nos.social/"
    Then completing "n" offers ""
    And completing "nos" without "wss://nos.lol/" offers "nostr.mom,nos.social"
    And suggestions for the inbox of a draft holding "wss://nos.lol/" are "nostr.mom,nos.social"
    And suggestions for the outbox of a draft holding "" are "nos.lol,nostr.mom,nos.social"

  Scenario: a save is described by how many servers took it
    Then a save accepted by "a,b" and refused by "c" reads "2 of 3"
    And a save refused by "a" reads "none. Your list is unchanged; try again or pick other servers."
