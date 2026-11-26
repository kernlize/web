Feature: Relays that live in the page
  kernl's preview runs the real kernel over relays that never leave the page (#75). applesauce's
  own RelayPool dials them through a WebSocket that stays in memory, and they answer as NIP-01
  relays do, from one store every URL shares.

  Scenario: A publish to four relays is saved once and every relay says yes
    Given relays that live in the page
    When a note is published to 4 of them
    Then every one of the 4 relays accepted it
    And the relays hold 1 event

  Scenario: A relay that refuses says no while the others say yes
    Given relays that live in the page, where "wss://refuse.example" refuses everything
    When a note is published to "wss://a.example" and "wss://refuse.example"
    Then "wss://a.example" accepted it and "wss://refuse.example" refused it

  Scenario: A request gets what matches, newest first, each filter's limit applied
    Given relays that live in the page, seeded with 3 notes and a profile
    When the pool requests notes with a limit of 2
    Then it gets the 2 newest notes, newest first

  Scenario: A newer replaceable event takes the older one's place; an ephemeral one is never kept
    Given relays that live in the page
    When a profile is published, then a newer profile, then an ephemeral event, then addressable events with and without a d tag
    Then the relays hold the newer profile and the two addressable events only

  Scenario: A subscription hears what is published after it opens, until it is closed
    Given relays that live in the page
    When the pool subscribes to notes, then a profile and a note are published, then the subscription closes and another note is published
    Then the subscription heard exactly the first note

  Scenario: A socket closed twice says it closed once, and is silent after
    Given a socket to one of the relays that live in the page
    When the socket is closed twice
    Then it reported closing once, and a later message gets no answer
