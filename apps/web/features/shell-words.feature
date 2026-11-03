Feature: Shell words
  Everything the shell shows a person is plain language (DECISIONS D-006). Wire
  names, protocol words and raw reasons stay in data; the shell translates them.

  Scenario: identities are shortened for badges and lists
    Then the shell shortens "abcdef0123456789" to the badge "abcdef01"
    And the shell abbreviates "abcdef0123456789" as "abcdef0123456789"
    And the shell abbreviates "abcdef0123456789wxyz" as "abcdef01…wxyz"

  Scenario: the shell has fixed defaults for windows and storage
    Then a new shell window opens at 720 by 660
    And the shell keeps recent applets under "kernl:recent:v1" and the layout under "kernl:layout:v1"

  Scenario: protocol words are recognised wherever they appear
    Then the shell text "Open the Relay list" names the protocol
    And the shell text "verified by NIP-05" names the protocol
    And the shell text "paste your npub1xyz" names the protocol
    And the shell text "Your account and your network" does not name the protocol

  Scenario Outline: grant domains read as plain words
    Then the shell calls the domain "<domain>" "<label>"

    Examples:
      | domain   | label                    |
      | identity | your account             |
      | relay    | network                  |
      | outbox   | posting to your network  |
      | common   | social actions           |
      | zap      | another capability       |
      | toString | another capability       |

  Scenario: an applet's first run lists required domains first and presets the account
    Given an applet that requires "identity, storage" and may use "storage, relay, zap"
    And the shell baseline is "storage"
    And the applet was earlier granted "relay"
    When the shell lists the domain choices
    Then the domain choices are:
      | domain   | label              | required | baseline | granted | preset |
      | identity | your account       | yes      | no       | no      | yes    |
      | storage  | its own storage    | yes      | yes      | yes     | no     |
      | relay    | network            | no       | no       | yes     | no     |
      | zap      | another capability | no       | no       | no      | no     |

  Scenario: the account is not preset once the person has decided before
    Given an applet that requires "identity" and may use "identity"
    And the person has decided for this applet before
    When the shell lists the domain choices
    Then the domain choices are:
      | domain   | label        | required | baseline | granted | preset |
      | identity | your account | yes      | no       | no      | no     |

  Scenario Outline: byte counts read in binary units
    Then the shell shows <bytes> bytes as "<text>"

    Examples:
      | bytes         | text     |
      | 0             | 0 B      |
      | 512           | 512 B    |
      | 1536          | 1.5 KiB  |
      | 20480         | 20 KiB   |
      | 1048576       | 1.0 MiB  |
      | 2199023255552 | 2048 GiB |

  Scenario Outline: a server reads by the name someone registered
    Then the shell reads the server "<address>" as "<name>"

    Examples:
      | address                       | name           |
      | wss://relay.damus.io          | damus.io       |
      | wss://nos.lol                 | nos.lol        |
      | wss://nostr.wine              | nostr.wine     |
      | wss://relay.co.uk             | relay.co.uk    |
      | wss://relay.example.co.uk     | example.co.uk  |
      | wss://relay.ab.cd             | ab.cd          |
      | wss://relay.co.ukk            | co.ukk         |
      | wss://Example.com:7777/inbox  | example.com    |
      | Relay.Damus.IO/inbox          | damus.io       |
      | wss://[broken/inbox           | [broken        |

  Scenario: a server whose name would name the protocol is called by its tier
    Then the shell labels the server "wss://relay.nostr.band" in "Applet catalogue" at index 0 as "Applet catalogue server 1"
    And the shell labels the server "wss://relay.damus.io" in "Your network" at index 2 as "damus.io"

  Scenario: a typed server address gets the secure scheme when it has none
    Then the shell stores the typed server "  relay.damus.io " as "wss://relay.damus.io"
    And the shell stores the typed server "ws://localhost:7777" as "ws://localhost:7777"

  Scenario: messaging reasons never reach a person raw
    Then the shell explains the unavailable reason "not-implemented" as "No backend is available for this provider yet; it is not built into the shell."
    And the shell explains the unavailable reason "mystery" as "No backend is available for this provider yet."
    And the shell explains the messaging refusal "invalid:no-recipients" as "Add someone to write to."
    And the shell explains the messaging refusal "unavailable:offline after 3 tries" as "The message could not be sent right now."
    And the shell explains the messaging refusal "unavailable:no-runtime" as "No backend is available for this provider yet; this build lacks the part it needs."
    And the shell explains the messaging refusal "unavailable:mystery" as "No backend is available for this provider yet."
    And the shell explains the messaging refusal "denied:nope" as "That did not work. Try again."
    And the shell explains the thrown messaging error "invalid:unknown-provider zz" as "That provider is not part of this shell."

  Scenario: a record to sign is spelled out field by field
    Given a record to sign of type 1 by "abc" at 0 saying "hello"
    And the record to sign carries the labels:
      | p 0123456789abcdef         |
      | relay wss://relay.damus.io |
      | r wss://relay.nostr.band   |
      | x hello world              |
    And the record to sign has the identifier "ff00"
    When the shell spells out the record for the account "abc"
    Then the record reads:
      | label      | value                      |
      | Type       | post (1)                   |
      | Signed by  | your account               |
      | Created    | 1970-01-01T00:00:00.000Z   |
      | Content    | hello                      |
      | Label 1    | person · 0123456789abcdef  |
      | Label 2    | server · damus.io          |
      | Label 3    | server · a server          |
      | Label 4    | label · hello · world      |
      | Identifier | ff00                       |

  Scenario: a list signed by someone else, with nothing to say
    Given a record to sign of type 30023 by "deadbeefcafe0000" at 1700000000 saying ""
    And the record to sign has the identifier "0000"
    When the shell spells out the record with no account
    Then the record reads:
      | label     | value                    |
      | Type      | list (30023)             |
      | Signed by | person deadbeef…         |
      | Created   | 2023-11-14T22:13:20.000Z |
      | Content   | (empty)                  |

  Scenario: an unfamiliar record type is just a record
    Given a record to sign of type 40000 by "" at 0 saying "x"
    When the shell spells out the record with no account
    Then the record reads:
      | label     | value                    |
      | Type      | record (40000)           |
      | Signed by | your account             |
      | Created   | 1970-01-01T00:00:00.000Z |
      | Content   | x                        |

  Scenario: a ready bridge is named for what it does
    Given a shell bridge "http" for "downloads" that is ready
    Then the shell names the bridge "Downloads (web)"
    And the shell describes the bridge as:
      | label                       | value |
      | Availability                | Ready |
      | Shares your network address | yes   |
      | Encrypted in transit        | no    |
      | Activity visible to others  | no    |

  Scenario: a hand-off bridge without a mapped name gets its label capitalised
    Given a shell bridge "ftp" for "files" that hands off to an app
    Then the shell names the bridge "Files"
    And the shell describes the bridge as:
      | label                       | value                               |
      | Availability                | Ready (opens an app on your device) |
      | Sent through kernl          | no                                  |
      | Shares your network address | yes                                 |
      | Encrypted in transit        | no                                  |
      | Activity visible to others  | no                                  |

  Scenario Outline: an unavailable bridge says why in a sentence
    Given a shell bridge "<id>" for "mail" that is unavailable with "<reason>"
    Then the shell describes the bridge as:
      | label                       | value          |
      | Availability                | <availability> |
      | Shares your network address | yes            |
      | Encrypted in transit        | no             |
      | Activity visible to others  | no             |

    Examples:
      | id   | reason     | availability    |
      | mail | no-backend | Needs a backend |
      | post | broken     | Not available   |
