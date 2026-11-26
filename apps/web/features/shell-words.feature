Feature: Shell words
  Everything the shell shows a person is plain language (DECISIONS D-006). Wire
  names, protocol words and raw reasons stay in data; the shell translates them.

  Scenario: identities are shortened for badges and lists
    Then the shell shortens "abcdef0123456789" to the badge "abcdef01"
    And the shell abbreviates "abcdef0123456789" as "abcdef0123456789"
    And the shell abbreviates "abcdef0123456789wxyz" as "abcdef01…wxyz"

  Scenario: an applet is said to be from its publisher, or from the shell when it came with it
    Then an applet at "naddr1chat" published by "abcdef0123456789wxyz" is said to be "by abcdef01…wxyz"
    And an applet at "kernl:messages" published by "0000000000000000000000" is said to be "comes with kernl"

  Scenario: the shell has fixed defaults for windows and storage
    Then a new shell window opens at 720 by 660
    And the shell keeps recent applets under "kernl:recent:v1" and the layout under "kernl:layout:v1"

  Scenario: protocol words are recognised wherever they appear
    Then the shell text "Open the Nostr settings" names the protocol
    And the shell text "Open the relay list" does not name the protocol
    And the shell text "verified by NIP-05" names the protocol
    And the shell text "paste your npub1xyz" names the protocol
    And the shell text "Your identity and your network" does not name the protocol
    And the shell text "Sign in to your account" names the protocol
    And the shell text "Remembered accounts" names the protocol

  Scenario: every reason an applet cannot be opened has plain words
    Then the shell explains the open failure "invalid:pointer" as "That does not look like an applet address."
    And the shell explains the open failure "unavailable:manifest" as "No applet was found at that address. Check it and try again."
    And the shell explains the open failure "unavailable:network" as "The applet relays did not answer in time. Try again in a moment."
    And the shell explains the open failure "unavailable:unreachable" as "The shell could not connect to any relay. You may be offline, your network may block them, or the browser may have too many connections open: closing other tabs can help."
    And the shell explains the open failure "unavailable:blob" as "The applet was found, but its file could not be downloaded right now. Try again later."
    And the shell explains the open failure "invalid:domain" as "This shell cannot provide something that was switched on for this applet. Look it up again."
    And the shell explains the open failure "invalid:blob-hash-mismatch" as "This applet did not pass the shell's checks, so it was not opened."
    And the shell explains the open failure "invalid:artifact-hash" as "The copy of this applet that came with the shell is damaged. Reload the page and try again."
    And the shell explains the open failure "unavailable:somewhere else" as "The applet cannot be reached right now. Try again later."
    And the shell explains the open failure "denied:because" as "The shell refused to open this applet."
    And the shell explains the open failure "timeout" as "Looking up the applet took too long. Try again."
    And the shell explains the thrown open failure "denied:blocked" as "You blocked this applet. Unblock it from its grants first."

  Scenario: a failure the shell has no reason for is said generically and flagged as unexpected
    Then the shell explains the unexpected open failure "All relays failed" as "Could not open the applet. Try again, or try another address."
    And the shell explains the unexpected open failure "" as "Could not open the applet. Try again, or try another address."

  Scenario Outline: a relay is shown by its own host, with nothing dropped and no nickname
    Then the shell shows the relay "<address>" as "<host>"

    Examples:
      | address                       | host               |
      | wss://relay.damus.io          | relay.damus.io     |
      | wss://nos.lol                 | nos.lol            |
      | wss://relay.nostr.band        | relay.nostr.band   |
      | wss://relay.napplet.soy/      | relay.napplet.soy  |
      | wss://relay.example.co.uk     | relay.example.co.uk |
      | wss://Example.com:7777/inbox  | example.com:7777   |
      | https://files.example.net/    | files.example.net  |
      | relay.damus.io/inbox          | relay.damus.io     |
      | wss://[broken/inbox           | [broken            |

  Scenario: the vocabulary check reads the shell's words, not the addresses it shows
    Then the shell text "Remove relay.nostr.band from Inbox relays" without its addresses does not name the protocol
    And the shell text "relay · wss://relay.napplet.soy/apps?x=1, nostr.wine and nostr.example:7777" without its addresses does not name the protocol
    And the shell text "Your nostr relays" without its addresses names the protocol
    And the shell text "Paste an npub. Then sign in" without its addresses names the protocol
    And the shell text "end of one.nostr sentence" without its addresses names the protocol
    And the shell text "Saved.Nostr is next" without its addresses names the protocol

  Scenario: a typed relay address gets the secure scheme when it has none
    Then the shell stores the typed relay "  relay.damus.io " as "wss://relay.damus.io"
    And the shell stores the typed relay "ws://localhost:7777" as "ws://localhost:7777"

  Scenario: a search for tools that finds nothing to trust says why, in words
    Then the shell explains the tool search refusal "invalid:tool-reference" as "Enter a shared reference, a tool fingerprint or a website."
    And the shell explains the tool search refusal "unavailable:no-tools" as "No tools were found for that."
    And the shell explains the tool search refusal "invalid:tool-inventory" as "Those tools failed their check, so they are not offered."
    And the shell explains the tool search refusal "unavailable:website" as "That website names no tool server."
    And the shell explains the tool search refusal "unavailable:preview" as "The preview cannot look for tools."
    And the shell explains the tool search refusal "mystery" as "The search did not work. Try again."
    And the shell explains a tool search that threw something other than an error as "The search did not work. Try again."

  Scenario: a typed connection helper keeps a name and password only when they were given
    Then the shell stores the helper " turn:turn.test:3478 " named "ann" with "secret" as '{"urls":["turn:turn.test:3478"],"username":"ann","credential":"secret"}'
    And the shell stores the helper "stun:stun.test" named " " with "" as '{"urls":["stun:stun.test"]}'

  Scenario: messaging reasons never reach a person raw
    Then the shell explains the unavailable reason "sign-in-required" as "Sign in to use this provider."
    And the shell explains the unavailable reason "signer-cannot-encrypt" as "This identity cannot lock messages this way."
    And the shell explains the unavailable reason "mystery" as "Not available yet."
    And the shell explains the messaging refusal "invalid:no-recipients" as "Add someone to write to."
    And the shell explains the messaging refusal "unavailable:offline after 3 tries" as "The message could not be sent right now."
    And the shell explains the messaging refusal "unavailable:no-runtime" as "Not part of this build yet."
    And the shell explains the messaging refusal "unavailable:mystery" as "Not available yet."
    And the shell explains the messaging refusal "invalid:recipient" as "That is not an identity. Paste one as it was shared with you."
    And the shell explains the messaging refusal "invalid:groups-unsupported" as "This provider writes to one person at a time."
    And the shell explains the messaging refusal "denied:nope" as "That did not work. Try again."
    And the shell explains the messaging refusal "denied:cancelled" as "The message was not sent."
    And the shell explains the thrown messaging error "invalid:unknown-provider zz" as "That provider is not part of this shell."

  Scenario: a record to sign is spelled out field by field
    Given a record to sign of type 1 by "abc" at 0 saying "hello"
    And the record to sign carries the labels:
      | p 0123456789abcdef         |
      | relay wss://relay.damus.io |
      | r wss://relay.nostr.band   |
      | r https://example.com/page |
      | x hello world              |
    And the record to sign has the identifier "ff00"
    When the shell spells out the record for the account "abc"
    Then the record reads:
      | label      | value                      |
      | Type       | post (1)                   |
      | Signed by  | your identity               |
      | Created    | 1970-01-01T00:00:00.000Z   |
      | Content    | hello                      |
      | Label 1    | person · 0123456789abcdef  |
      | Label 2    | relay · relay.damus.io     |
      | Label 3    | relay · relay.nostr.band   |
      | Label 4    | link · https://example.com/page |
      | Label 5    | label · hello · world      |
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
      | Signed by | your identity             |
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

  Scenario: the reply question says who wrote, how, and what the order would do
    Given a reply question about "Ada" who wrote through "Legacy messages" while the order picks "Private messages"
    Then the reply question reads "Ada last wrote to you through Legacy messages. Your order would send this through Private messages, and Ada may not see it there."
    And the reply question can be kept "For this message only | Every time I write to Ada | Every time, for everyone"

  Scenario: someone the shell has no name for is called by a short account id
    Given a reply question about the account "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" who wrote through "Legacy messages" while the order picks "Private messages"
    Then the reply question can be kept "For this message only | Every time I write to 3bf0c63f…459d | Every time, for everyone"

  Scenario: someone their provider did not label is called by the name they published
    Given a reply question about the account "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" who wrote through "Legacy messages" while the order picks "Private messages"
    When the shell finds that they published the name "Grace"
    Then the reply question reads "Grace last wrote to you through Legacy messages. Your order would send this through Private messages, and Grace may not see it there."
    And the reply question can be kept "For this message only | Every time I write to Grace | Every time, for everyone"

  Scenario Outline: keeping an answer for everyone says what rule it becomes
    Then keeping "<use>" for everyone means "<words>"

    Examples:
      | use    | words                                                                                         |
      | theirs | The shell will reply through whichever provider the other person last used, without asking. |
      | mine   | The shell will always use your order, without asking.                                         |

  Scenario: Settings lists the three reply rules, asking first
    Then the reply rules are "Ask me | Reply their way | Use my order"

  Scenario Outline: Settings says for how many people the question is settled
    Then <count> settled answers read "<words>"

    Examples:
      | count | words                             |
      | 0     |                                   |
      | 1     | You settled this for one person.  |
      | 4     | You settled this for 4 people.    |

  Scenario Outline: a provider moves one step in the order, and stops at either end
    Then moving "<id>" <step> in "private,legacy,ratchet" gives "<order>"

    Examples:
      | id      | step | order                  |
      | legacy  | -1   | legacy,private,ratchet |
      | legacy  | 1    | private,ratchet,legacy |
      | private | -1   | private,legacy,ratchet |
      | ratchet | 1    | private,legacy,ratchet |
      | ghost   | 1    | private,legacy,ratchet |

  Scenario Outline: a firewall question is put in plain words
    Given a firewall question of kind "<kind>" about '<requests>'
    Then the firewall question reads "<title>"
    And its rows are "<rows>"

    Examples:
      | kind    | requests                                                                                                           | title                                 | rows                                                   |
      | link    | [{"kind":"resource","domain":"link","operation":"link.open","target":"https://example.org/a?b=1"}]                 | Open a link outside kernl             | Link=https://example.org/a?b=1; Leads to=example.org   |
      | link    | [{"kind":"resource","domain":"link","operation":"link.open","target":"mailto:ada@example.org"}]                    | Open a link outside kernl             | Link=mailto:ada@example.org; Leads to=your mail app    |
      | link    | [{"kind":"resource","domain":"link","operation":"link.open","target":"not an address"}]                            | Open a link outside kernl             | Link=not an address; Leads to=not an address           |
      | access  | [{"kind":"access","domain":"relay","operation":"access","target":"relay"}]                                         | Use network                           | Uses=network                                           |
      | access  | [{"kind":"access","domain":"relay","operation":"access","target":"relay"},{"kind":"access","domain":"dm","operation":"access","target":"dm"},{"kind":"access","domain":"upload","operation":"access","target":"upload"}] | Use network, messages and uploads | Uses=network; Uses=messages; Uses=uploads |
      | request | [{"kind":"network","domain":"relay","operation":"relay.network","target":"wss://one.example"},{"kind":"network","domain":"relay","operation":"relay.network","target":"wss://one.example"},{"kind":"resource","domain":"notify","operation":"notify.send","target":"x"}] | Go ahead with a request | Reaches=one.example; For=notifications |

  Scenario: every firewall question carries one short line, and nothing names the protocol
    Then the firewall notes for "link,access,request" each say why the person is asked
    And the firewall's words never name the protocol

  Scenario Outline: a firewall answer's button says what it does
    Then the "<choice>" answer to a "<kind>" question reads "<words>"

    Examples:
      | choice        | kind    | words                  |
      | allow-once    | link    | Open link              |
      | deny          | link    | Don’t open             |
      | allow-once    | request | Allow once             |
      | allow-session | access  | Allow while open       |
      | allow-always  | access  | Always allow           |
      | deny          | access  | Don’t allow            |

  Scenario Outline: an answer in force reads as what it lets through and for how long
    Then the firewall answer '<request>' that is "<effect>" for "<lifetime>" reads "<words>"

    Examples:
      | request                                                                                         | effect | lifetime | words                                                           |
      | {"kind":"access","domain":"relay","operation":"access","target":"relay"}                        | allow  | always   | network: allowed, kept across visits                            |
      | {"kind":"network","domain":"relay","operation":"relay.network","target":"wss://one.example"}    | deny   | session  | network, reaching one.example: refused, until its window closes |
      | {"kind":"resource","domain":"link","operation":"link.open","target":"https://example.org/a"}    | allow  | session  | opening example.org: allowed, until its window closes           |

  Scenario Outline: a rule is read at its own target and followed down to the wider ones
    Given firewall rules '<rules>'
    Then the rule set at '<target>' is "<own>", what happens there is "<in force>", and leaving it unset reads "<inherit>"

    Examples:
      | rules                                                                                               | target                                    | own     | in force | inherit                                        |
      | {"default":"allow","operations":{"link.open":"ask"}}                                                | {}                                        | allow   | allow    | Default (allow)   |
      | {"default":"allow","operations":{"link.open":"ask"}}                                                | {"operation":"link.open"}                 | ask     | ask      | Default (allow)   |
      | {"default":"allow","domains":{"link":"deny"}}                                                       | {"operation":"link.open"}                 | inherit | deny     | Default (refuse)                 |
      | {"default":"ask"}                                                                                   | {"domain":"relay"}                        | inherit | ask      | Default (ask every time)      |
      | {"default":"allow","operations":{"link.open":"ask"}}                                                | {"applet":"a1","operation":"link.open"}   | inherit | ask      | Default (ask every time)      |
      | {"default":"allow","operations":{"link.open":"ask"},"napplets":{"a1":{"domains":{},"operations":{"link.open":"allow"}}}} | {"applet":"a1","operation":"link.open"} | allow | allow | Default (ask every time) |
      | {"default":"allow","napplets":{"a1":{"default":"deny","domains":{"relay":"ask"},"operations":{}}}}  | {"applet":"a1","domain":"relay"}          | ask     | ask      | Default (refuse)                 |
      | {"default":"allow","napplets":{"a1":{"default":"deny","domains":{},"operations":{}}}}               | {"applet":"a1"}                           | deny    | deny     | Default (allow)   |
      | {"default":"allow","napplets":{"a1":{"domains":{"relay":"ask"},"operations":{}}}}                   | {"applet":"a1"}                           | inherit | allow    | Default (allow)   |

  Scenario: a rule select's value becomes an action, or nothing for the wider rule
    Then the rule choices "allow,ask,deny,inherit,anything" become "allow,ask,deny,none,none"
