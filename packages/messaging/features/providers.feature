Feature: Messaging providers describe themselves
  Providers state their security properties truthfully and are never ranked.
  The shell injects the backend and the availability check.

  Scenario Outline: the built-in providers carry fixed copy and properties
    Given the built-in messaging provider "<id>"
    Then the messaging provider name is "<name>"
    And the messaging provider description is "<description>"
    And the messaging provider security properties are <fs>, <pcs>, "<metadata>", <sameClient>, <groups>, <experimental>
    And the messaging provider specification is "<specification>"

    Examples:
      | id      | name             | description                                                                                                        | fs    | pcs   | metadata | sameClient | groups | experimental | specification                |
      | private | Private messages | Sealed messages that hide who is talking to whom from the network.                                                 | false | false | partial  | false      | true   | false        | NIP-17                       |
      | legacy  | Legacy messages  | The original direct-message format. Readable by the widest range of apps, but who you talk to is visible on the network. | false | false | none     | false      | false  | false        | NIP-04                       |
      | ratchet | Ratchet sessions | Per-session keys that change with every message. Both sides need an app that supports it.                          | true  | true  | partial  | true       | false  | true         | nostr-double-ratchet (draft) |

  Scenario: the description rows state facts without protocol names
    Given the built-in messaging provider "ratchet"
    Then the messaging provider description rows are:
      | Forward secrecy                   | yes     |
      | Recovers after a key compromise   | yes     |
      | Metadata protection               | partial |
      | Correspondent needs the same app  | yes     |
      | Group conversations               | no      |
      | Experimental                      | yes     |
    And no messaging description row mentions "ratchet" or "nostr"

  Scenario: the legacy provider rows say no to everything
    Given the built-in messaging provider "legacy"
    Then the messaging provider description rows are:
      | Forward secrecy                   | no   |
      | Recovers after a key compromise   | no   |
      | Metadata protection               | none |
      | Correspondent needs the same app  | no   |
      | Group conversations               | no   |
      | Experimental                      | no   |
    And no messaging description row mentions "NIP" or "legacy"

  Scenario: availability and the backend come from the shell
    Given the built-in messaging provider "private" that is unavailable because "signed-out"
    Then the messaging provider availability is unavailable because "signed-out"
    When the messaging provider becomes available
    Then the messaging provider availability is available
    And the messaging provider builds the injected backend
