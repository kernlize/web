Feature: Relay directory
  Monitors publish what they measured about each server they watch (NIP-66,
  kind 30166). The directory streams those reports from the monitors' own
  servers, folds every monitor's latest report into one listing per server,
  and uses the listings to complete what the person types and to suggest
  servers. It never decides: with no report at all it still suggests a
  built-in list, and nothing it says stops a connection (D-029).

  Background:
    Given the directory clock reads 1800000000
    And a relay directory over the monitor servers "wss://m1.example,wss://m2.example"

  Scenario: starting opens one streaming subscription for recent clearnet reports
    When the directory starts
    And the directory starts
    Then the directory asked "wss://m1.example,wss://m2.example" once
    And it asked for kind 30166 on the "clearnet" network since 1799827200

  Scenario: the default monitor servers are the known monitors' servers
    Given a relay directory over the default monitor servers
    When the directory starts
    Then the directory asked "wss://relay.nostr.watch,wss://relaypag.es,wss://monitorlizard.nostr1.com" once

  Scenario: reports from two monitors fold into one listing as they stream in
    When the directory starts
    And monitor "alice" reports "wss://relay.one" 600 seconds ago with
      | tag      | value |
      | rtt-open | 100   |
      | rtt-read | 40    |
      | N        | 1     |
      | N        | 11    |
      | R        | !auth |
      | T        | PublicOutbox |
    And monitor "bob" reports "wss://Relay.One/" 60 seconds ago with
      | tag       | value |
      | rtt-open  | 200   |
      | rtt-write | 90    |
      | n         | clearnet |
      | N         | 65    |
      | R         | auth  |
      | R         | payment |
      | R         | writes  |
    Then the directory lists 1 server
    And "wss://relay.one/" is listed with
      | field            | value                 |
      | monitors         | 2                     |
      | lastSeen         | 1799999940            |
      | rttOpen          | 150                   |
      | rttRead          | 40                    |
      | rttWrite         | 90                    |
      | network          | clearnet              |
      | nips             | 1,11,65               |
      | types            | PublicOutbox          |
      | requiresAuth     | true                  |
      | requiresPayment  | true                  |
      | restrictedWrites | true                  |
    And the listings stream settles on 1 server

  Scenario: a monitor's newer report replaces its older one
    When the directory starts
    And monitor "alice" reports "wss://relay.one" 600 seconds ago with
      | tag      | value |
      | rtt-open | 100   |
    And monitor "alice" reports "wss://relay.one" 60 seconds ago with
      | tag      | value |
      | rtt-open | 300   |
    And monitor "alice" reports "wss://relay.one" 900 seconds ago with
      | tag      | value |
      | rtt-open | 999   |
    Then "wss://relay.one/" is listed with
      | field    | value      |
      | monitors | 1          |
      | rttOpen  | 300        |
      | lastSeen | 1799999940 |
      | nips     |            |
      | requiresAuth | false  |

  Scenario: reports the directory cannot use are left out
    When the directory starts
    And monitor "alice" reports "wss://onion.example" 60 seconds ago with
      | tag | value |
      | n   | tor   |
    And monitor "alice" reports "0f9e8d7c6b5a" 60 seconds ago with
      | tag | value |
    And monitor "alice" reports "wss://old.example" 200000 seconds ago with
      | tag | value |
    And monitor "alice" reports "https://web.example" 60 seconds ago with
      | tag | value |
    And monitor "alice" sends a kind 1 note about "wss://note.example"
    And monitor "alice" sends a report that names no server
    Then the directory lists 0 servers

  Scenario: a report ages out of the listings
    When the directory starts
    And monitor "alice" reports "wss://relay.one" 60 seconds ago with
      | tag | value |
    And the directory clock reads 1800200000
    Then the directory lists 0 servers

  Scenario: search completes what the person types
    When the directory starts
    And the directory holds these servers
      | server                  | monitors | rtt-open |
      | wss://relay.damus.io    | 3        | 120      |
      | wss://damus.example.org | 1        | 80       |
      | wss://nos.lol           | 2        | 90       |
      | wss://nostr.wine        | 2        | 60       |
      | wss://relay.nostr.band  | 3        | 50       |
      | wss://unmeasured.lol    | 2        |          |
    Then searching "damus" gives "wss://relay.damus.io/,wss://damus.example.org/"
    And searching "wss://nos" gives "wss://nostr.wine/,wss://nos.lol/"
    And searching "NOSTR" gives "wss://relay.nostr.band/,wss://nostr.wine/"
    And searching "amus" gives "wss://relay.damus.io/,wss://damus.example.org/"
    And searching "wss://damus" gives "wss://damus.example.org/"
    And searching "" with limit 2 gives "wss://relay.nostr.band/,wss://relay.damus.io/"
    And searching "lol" gives "wss://nos.lol/,wss://unmeasured.lol/"
    And searching "nowhere" gives ""

  Scenario: inbox and outbox suggestions leave out servers that ask for a login, payment or permission
    Given a relay directory with fallback ""
    When the directory starts
    And the directory holds these servers
      | server              | monitors | rtt-open | requirements |
      | wss://open.example  | 2        | 200      | !auth        |
      | wss://fast.example  | 2        | 50       |              |
      | wss://login.example | 5        | 10       | auth         |
      | wss://paid.example  | 5        | 10       | payment      |
      | wss://club.example  | 5        | 10       | writes       |
      | wss://busy.example  | 4        | 900      |              |
    Then the "inbox" suggestions are "wss://busy.example/,wss://fast.example/,wss://open.example/"
    And the "outbox" suggestions without "wss://busy.example" limited to 2 are "wss://fast.example/,wss://open.example/"

  Scenario: lookup suggestions prefer servers that index account lists, after the host's own
    Given a relay directory with fallback "wss://purplepag.es"
    When the directory starts
    And the directory holds these servers
      | server                | monitors | rtt-open | types   | nips | kinds |
      | wss://general.example | 9        | 10       |         |      |       |
      | wss://typed.example   | 2        | 100      | Indexer |      |       |
      | wss://nip.example     | 2        | 50       |         | 65   |       |
      | wss://kinds.example   | 1        | 50       |         |      | 10002 |
    Then the "lookup" suggestions limited to 4 are "wss://purplepag.es/,wss://nip.example/,wss://typed.example/,wss://kinds.example/"

  Scenario: an empty directory suggests the built-in servers
    Then the "inbox" suggestions are "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"
    And the "lookup" suggestions are "wss://purplepag.es/,wss://user.kindpag.es/,wss://indexer.coracle.social/"
    And the "outbox" suggestions without "wss://nos.lol" are "wss://relay.damus.io/,wss://relay.primal.net/"
    And every suggestion has 0 monitors

  Scenario: well-known servers come first, minus any the directory knows to refuse, then the directory's
    When the directory starts
    And the directory holds these servers
      | server               | monitors | rtt-open | requirements |
      | wss://one.example    | 2        | 100      |              |
      | wss://nos.lol        | 3        | 100      | payment      |
    Then the "inbox" suggestions are "wss://relay.damus.io/,wss://relay.primal.net/,wss://one.example/"

  Scenario: suggestions skip hosts that come and go, bare addresses, odd ports and sub-paths
    Given a relay directory with fallback ""
    When the directory starts
    And the directory holds these servers
      | server                              | monitors | rtt-open |
      | wss://tunnel.trycloudflare.com      | 9        | 10       |
      | wss://box.ts.net                    | 9        | 10       |
      | wss://203.0.113.7                   | 9        | 10       |
      | wss://ports.example:4848            | 9        | 10       |
      | wss://paths.example/inbox           | 9        | 10       |
      | wss://steady.example                | 2        | 100      |
    Then the "inbox" suggestions are "wss://steady.example/"
    And searching "tunnel" gives "wss://tunnel.trycloudflare.com/"

  Scenario: the host's own fallback replaces the built-in one
    Given a relay directory with fallback "wss://mine.example,not a url"
    Then the "inbox" suggestions are "wss://mine.example/"
    And the "lookup" suggestions are "wss://mine.example/"

  Scenario: stopping closes the subscription and keeps what was learned
    When the directory starts
    And monitor "alice" reports "wss://relay.one" 60 seconds ago with
      | tag | value |
    And the directory stops
    And the directory stops
    Then the directory has no open subscription
    And the directory lists 1 server
    When the directory starts
    Then the directory opened 2 subscriptions

  Scenario: monitor servers can change while the directory runs
    Given a relay directory over a changing list of monitor servers
    When the directory starts
    And the monitor servers become "wss://m3.example"
    Then the directory's subscription follows "wss://m3.example"

  Scenario: a failing subscription keeps the listings
    When the directory starts
    And monitor "alice" reports "wss://relay.one" 60 seconds ago with
      | tag | value |
    And the monitor servers fail
    Then the directory lists 1 server
    And the directory has no open subscription
