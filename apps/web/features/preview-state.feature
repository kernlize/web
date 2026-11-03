Feature: Preview state
  The preview keeps grants and network tiers in the host's storage, so a visitor's
  choices survive a reload. It never connects to the networks it lists.

  Scenario: the baseline comes from the core on first use
    Given the preview state baseline has not been loaded
    When the preview state baseline is loaded twice
    Then the preview state baseline was empty before loading
    And the preview state baseline includes "theme"

  Scenario: an applet with no choices has no record
    When the preview state grants are opened
    Then the preview state has no record for "notes@aa"
    And the preview state lists the applets ""
    And the preview state offers every available domain

  Scenario: allowing a domain records, persists and announces it once
    When the preview state grants are opened
    And the preview state allows "notify" for "notes@aa"
    And the preview state allows "notify" for "notes@aa"
    And the preview state allows "media" for "notes@aa"
    Then the preview state grants "notes@aa" the domains "notify,media"
    And the preview state quota of "notes@aa" is 5242880 bytes
    And the preview state shows "notes@aa" as not blocked
    And the preview state emitted 3 grant changes
    And the preview state survives reopening with "notes@aa" granted "notify,media"

  Scenario: revoking a domain removes only that domain
    When the preview state grants are opened
    And the preview state allows "notify" for "notes@aa"
    And the preview state allows "media" for "notes@aa"
    And the preview state revokes "notify" for "notes@aa"
    Then the preview state grants "notes@aa" the domains "media"

  Scenario: blocking, unblocking and the storage quota
    When the preview state grants are opened
    And the preview state blocks "pulse@bb"
    Then the preview state shows "pulse@bb" as blocked
    When the preview state unblocks "pulse@bb"
    Then the preview state shows "pulse@bb" as not blocked
    When the preview state sets the quota of "pulse@bb" to 1024 bytes
    Then the preview state quota of "pulse@bb" is 1024 bytes
    And the preview state lists the applets "pulse@bb"

  Scenario: stored grants are listed under the identity they were saved for
    Given the preview state storage holds grants "{\"notes:aa\":{\"domains\":[\"relay\"],\"blocked\":false,\"stateQuotaBytes\":10},\"orphan\":{\"domains\":[],\"blocked\":true,\"stateQuotaBytes\":10}}"
    When the preview state grants are opened
    Then the preview state lists the applets "notes@aa,orphan@"
    And the preview state grants "notes@aa" the domains "relay"

  Scenario: an identity seen this session is listed as given
    When the preview state grants are opened
    And the preview state allows "relay" for "notes@aa"
    Then the preview state lists the applets "notes@aa"

  Scenario: unreadable stored grants are discarded
    Given the preview state storage holds grants "not json"
    When the preview state grants are opened
    Then the preview state lists the applets ""
    And the preview state storage no longer holds grants

  Scenario: fresh storage yields the default networks
    When the preview state relays are opened
    Then the preview state "discovery" relays are "wss://purplepag.es"
    And the preview state "apps" relays are "wss://relay.damus.io"
    And the preview state "outbox" relays are "wss://nos.lol"
    And the preview state "super" relays are "wss://relay.primal.net"
    And the preview state observed the relays 1 times

  Scenario: stored networks override only the tiers they name
    Given the preview state storage holds relays "{\"apps\":[\"wss://apps.example\"],\"discovery\":[],\"outbox\":[\"ws://local\"],\"super\":[]}"
    When the preview state relays are opened
    Then the preview state "apps" relays are "wss://apps.example"
    And the preview state "discovery" relays are ""
    And the preview state "outbox" relays are "ws://local"

  Scenario: a partial stored config keeps the remaining defaults
    Given the preview state storage holds relays "{\"apps\":[\"wss://apps.example\"]}"
    When the preview state relays are opened
    Then the preview state "apps" relays are "wss://apps.example"
    And the preview state "super" relays are "wss://relay.primal.net"

  Scenario: adding a network trims it, persists it and ignores duplicates
    When the preview state relays are opened
    And the preview state adds "  wss://relay.mine  " to the "outbox" relays
    And the preview state adds "wss://relay.mine" to the "outbox" relays
    Then the preview state "outbox" relays are "wss://nos.lol,wss://relay.mine"
    And the preview state observed the relays 2 times
    And the preview state storage holds the current relays

  Scenario: a malformed network address is refused
    When the preview state relays are opened
    And the preview state adds "https://not-a-relay" to the "super" relays
    Then the preview state refused the relay with "invalid:url"
    And the preview state "super" relays are "wss://relay.primal.net"

  Scenario: removing a network persists the change
    When the preview state relays are opened
    And the preview state removes "wss://nos.lol" from the "outbox" relays
    Then the preview state "outbox" relays are ""
    And the preview state storage holds the current relays

  Scenario: unreadable stored networks fall back to the defaults
    Given the preview state storage holds relays "{broken"
    When the preview state relays are opened
    Then the preview state "apps" relays are "wss://relay.damus.io"
