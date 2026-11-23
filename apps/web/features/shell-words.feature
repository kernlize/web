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

  Scenario Outline: grant domains read as plain words, with the contract beside them
    Then the shell calls the domain "<domain>" "<label>"
    And the shell writes the contract of "<domain>" as "<contract>"

    Examples:
      | domain   | label                    | contract |
      | identity | your identity            | IDENTITY |
      | relay    | network                  | RELAY    |
      | outbox   | posting to your network  | OUTBOX   |
      | resource | web fetches              | RESOURCE |
      | common   | social actions           | COMMON   |
      | zap      | another capability       | ZAP      |
      | toString | another capability       | TOSTRING |


  Scenario: required domains are on and fixed, optional ones are off and free, and each has its group
    Given an applet that requires "identity, relay" and may use "notify, theme"
    And the shell baseline is "theme"
    And the shell can offer "identity, relay, notify"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain   | label           | on  | locked | note        |
      | required | identity | your identity   | yes | yes    |             |
      | required | relay    | network         | yes | yes    |             |
      | optional | notify   | notifications   | no  | no     |             |
      | optional | theme    | your theme      | yes | yes    | always on   |

  Scenario: what was granted before shows as on, and the required ones are on regardless
    Given an applet that requires "identity" and may use "notify, relay"
    And the shell can offer "identity, notify, relay"
    And the applet was earlier granted "relay"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain   | label         | on  | locked | note |
      | required | identity | your identity | yes | yes    |      |
      | optional | notify   | notifications | no  | no     |      |
      | optional | relay    | network       | yes | no     |      |

  Scenario: a screen that does not force the required domains shows what is granted, and locks a required one once it is on
    Given an applet that requires "identity, relay" and may use ""
    And the shell can offer "identity, relay"
    And the applet was earlier granted "relay"
    When the shell groups the grants for a running applet
    Then the grant groups are:
      | group    | domain   | label         | on  | locked | note |
      | required | identity | your identity | no  | no     |      |
      | required | relay    | network       | yes | yes    |      |

  Scenario: a domain this shell cannot offer is listed, off and fixed
    Given an applet that requires "identity, outbox" and may use "config"
    And the shell can offer "outbox"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain   | label                   | on  | locked | note                                          |
      | required | identity | your identity           | no  | yes    | needed, and this shell cannot provide it      |
      | required | outbox   | posting to your network | yes | yes    |                                               |
      | optional | config   | its settings            | no  | yes    | not available in this shell                   |

  Scenario: an applet that takes requests from others needs the receiving switch, so it is required
    Given an applet that requires "identity" and may use "notify"
    And the shell can offer "identity, notify, intent"
    And the applet takes requests from other applets
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain   | label                 | on  | locked | note |
      | required | identity | your identity         | yes | yes    |      |
      | required | intent   | opening other applets | yes | yes    |      |
      | optional | notify   | notifications         | no  | no     |      |

  Scenario: a receiving applet that lists the switch as optional still needs it, and one this shell cannot offer shows it off
    Given an applet that requires "storage" and may use "intent"
    And the shell can offer "storage, intent"
    And the applet takes requests from other applets
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain  | label                 | on  | locked | note |
      | required | storage | its own storage       | yes | yes    |      |
      | required | intent  | opening other applets | yes | yes    |      |
    Given an applet that requires "" and may use ""
    And the shell can offer "relay"
    And the applet takes requests from other applets
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label                 | on | locked | note                                     |
      | required | intent | opening other applets | no | yes    | needed, and this shell cannot provide it |

  Scenario: domains the applet did not ask for follow, for a screen that lets the person grant more
    Given an applet that requires "relay" and may use ""
    And the shell can offer "relay, notify, media"
    And the applet was earlier granted "media"
    And the screen also offers "notify, media, relay"
    When the shell groups the grants for a running applet
    Then the grant groups are:
      | group | domain | label          | on  | locked | note |
      | required | relay | network      | no  | no     |      |
      | other | notify | notifications  | no  | no     |      |
      | other | media  | media controls | yes | no     |      |

  Scenario: group captions read as plain labels
    Then the grant group captions are "unsafe: Unsafe with messages, required: Required, optional: Optional, other: Not requested"


  Scenario: required domains that cannot go with required messages move to the unsafe group, off
    Given an applet that requires "dm, upload, relay" and may use "notify"
    And the shell can offer "dm, upload, relay, notify"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label         | on  | locked | note                                |
      | unsafe   | upload | uploads       | no  | no     | |
      | unsafe   | relay  | network       | no  | no     | |
      | required | dm     | messages      | yes | yes    |                                     |
      | optional | notify | notifications | no  | no     |                                     |

  Scenario: allowing one is the person's override, and shows as on
    Given an applet that requires "dm, upload, relay" and may use ""
    And the shell can offer "dm, upload, relay"
    And the person keeps "upload" beside messages
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label    | on  | locked | note                               |
      | unsafe   | upload | uploads  | yes | no     | |
      | unsafe   | relay  | network  | no  | no     | |
      | required | dm     | messages | yes | yes    |                                    |

  Scenario: messages the person switches on make the required domains unsafe, and switching them off puts them back
    Given an applet that requires "upload" and may use "dm"
    And the shell can offer "upload, dm"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label    | on  | locked | note |
      | required | upload | uploads  | yes | yes    |      |
      | optional | dm     | messages | no  | no     |      |
    Given the person switches on "dm"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label    | on  | locked | note                               |
      | unsafe   | upload | uploads  | no  | no     | |
      | optional | dm     | messages | yes | no     |                                    |

  Scenario: an optional domain that messages withhold stays off and fixed, in the optional group
    Given an applet that requires "dm" and may use "relay, notify"
    And the shell can offer "dm, relay, notify"
    And the applet was earlier granted "relay"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label         | on  | locked | note                              |
      | required | dm     | messages      | yes | yes    |                                   |
      | optional | relay  | network       | no  | yes    | off while it can read your messages |
      | optional | notify | notifications | no  | no     |                                   |

  Scenario: a baseline domain the applet requires, such as talking to other applets, can be unsafe too
    Given an applet that requires "dm, inc" and may use ""
    And the shell baseline is "inc"
    And the shell can offer "dm"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label                    | on | locked | note                               |
      | unsafe   | inc    | talking to other applets | no | no     | |
      | required | dm     | messages                 | yes | yes   |                                    |

  Scenario: a baseline domain the applet only mentions is withheld, off and fixed
    Given an applet that requires "dm" and may use "inc"
    And the shell baseline is "inc"
    And the shell can offer "dm"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label                    | on  | locked | note                                |
      | required | dm     | messages                 | yes | yes    |                                     |
      | optional | inc    | talking to other applets | no  | yes    | off while it can read your messages |

  Scenario: required messages that this shell cannot offer seal nothing
    Given an applet that requires "dm, upload" and may use ""
    And the shell can offer "upload"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label    | on  | locked | note                                     |
      | required | dm     | messages | no  | yes    | needed, and this shell cannot provide it |
      | required | upload | uploads  | yes | yes    |                                          |


  Scenario: on Run the required domains are granted, switched-on optional ones too, and what was switched off is taken back
    Given an applet that requires "identity" and may use "notify, relay"
    And the shell can offer "identity, notify, relay"
    And the applet was earlier granted "relay"
    And the person switches on "notify"
    And the person switches off "relay"
    Then the grants to apply are "allow identity, allow notify, revoke relay"

  Scenario: nothing is applied for what already stands, for a baseline domain, or for one the shell cannot offer
    Given an applet that requires "identity, outbox" and may use "theme"
    And the shell baseline is "theme"
    And the shell can offer "identity"
    And the applet was earlier granted "identity"
    Then the grants to apply are ""

  Scenario: an overridden unsafe domain is granted beside messages, and dropping the override keeps the grant
    Given an applet that requires "dm, upload, relay" and may use ""
    And the shell can offer "dm, upload, relay"
    And the person keeps "upload" beside messages
    Then the grants to apply are "allow upload beside messages, allow dm"
    Given the applet was earlier granted "dm, upload"
    And the applet was earlier kept "upload" beside messages
    And the person keeps nothing beside messages
    Then the grants to apply are "allow upload outside messages"

  Scenario: an override that already stands is not applied again, for a granted domain or a baseline one
    Given an applet that requires "dm, upload, inc" and may use ""
    And the shell baseline is "inc"
    And the shell can offer "dm, upload"
    And the applet was earlier granted "dm, upload"
    And the applet was earlier kept "upload, inc" beside messages
    And the person keeps "upload" beside messages
    And the person keeps "inc" beside messages
    Then the grants to apply are ""

  Scenario: an unsafe domain left off is not granted, and one granted before is left as it is
    Given an applet that requires "dm, upload" and may use ""
    And the shell can offer "dm, upload"
    And the applet was earlier granted "dm, upload"
    Then the grants to apply are ""

  Scenario: a domain messages withhold is never taken back by leaving it off
    Given an applet that requires "dm" and may use "relay"
    And the shell can offer "dm, relay"
    And the applet was earlier granted "dm, relay"
    Then the grants to apply are ""

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
    And the shell explains the messaging refusal "unavailable:no-ratchet-runtime" as "Needs the live shell and a signed-in identity."
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

  Scenario: an applet that can read messages keeps only what cannot send them on (D-046)
    Then with "dm,identity" switched on, these are withheld and say "off while it can read your messages":
      | relay | outbox | upload | webrtc | inc | cvm | resource | link | llm | fs | cache | media | something-new |
    And with "dm,identity" switched on, these stay:
      | shell | dm | identity | theme | storage | config | notify | keys | intent |
    And with "relay,identity" switched on, nothing is withheld from "relay,upload,webrtc,inc"

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
