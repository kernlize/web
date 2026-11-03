Feature: Applet pointers
  The shell decodes what a user typed or clicked into the event to fetch.
  A pointer only says which event to look for; trust comes from verifying it.

  Scenario: a bare event id is an event pointer
    When the shell decodes pointer "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
    Then the pointer is an event with id "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
    And the pointer has no relay hints

  Scenario: the nostr: prefix and surrounding whitespace are ignored
    When the shell decodes pointer "  nostr:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d "
    Then the pointer is an event with id "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

  Scenario: a pubkey-first coordinate is an address pointer
    When the shell decodes pointer "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:35129:chat"
    Then the pointer is an address for kind 35129 by "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" with identifier "chat"
    And the pointer has no relay hints

  Scenario: a kind-first coordinate is an address pointer too
    When the shell decodes pointer "35129:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:chat"
    Then the pointer is an address for kind 35129 by "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" with identifier "chat"

  Scenario: a root manifest coordinate has an empty identifier
    When the shell decodes pointer "15129:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:"
    Then the pointer is an address for kind 15129 by "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" with identifier ""

  Scenario: an naddr carries its relay hints
    Given an naddr for kind 35129 by "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" with identifier "chat" and relays "wss://relay.napplet.soy"
    When the shell decodes that encoded pointer
    Then the pointer is an address for kind 35129 by "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" with identifier "chat"
    And the pointer has relay hints "wss://relay.napplet.soy"

  Scenario: an nevent carries its author and relays
    Given an nevent for id "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" by "0000000000000000000000000000000000000000000000000000000000000001" with relays "wss://a.example,wss://b.example"
    When the shell decodes that encoded pointer
    Then the pointer is an event with id "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
    And the pointer author is "0000000000000000000000000000000000000000000000000000000000000001"
    And the pointer has relay hints "wss://a.example,wss://b.example"

  Scenario: an nevent without an author
    Given an nevent for id "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" without an author
    When the shell decodes that encoded pointer
    Then the pointer is an event with id "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
    And the pointer has no author

  Scenario: a note1 id is an event pointer
    Given a note for id "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
    When the shell decodes that encoded pointer
    Then the pointer is an event with id "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

  Scenario Outline: anything else is refused
    When the shell decodes pointer "<input>"
    Then the shell refused with "invalid:pointer"

    Examples:
      | input                   |
      | hello                   |
      | naddr1notreallyvalid    |
      | nevent1notreallyvalid   |
      | npub1qqqqqqqqqqqqqqqq   |
      |                         |
