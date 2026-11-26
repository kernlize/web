Feature: Applet stacks
  People publish stacks of applets as NIP-51 app curation sets: one event per
  stack, whose `a` tags name napplet manifests. The shell lists the stacks it
  finds on the relays it reads and opens every applet a stack names. A set
  holding no napplet is not a stack the launcher shows: that is how AppStore
  deletes one, since napplet shells refuse deletions.

  Scenario: a stack becomes a list of applets
    Given a stack "mesh" titled "Mesh" holding "dingdong,ics@wss://nos.lol"
    When the shell reads that stack
    Then the stack "mesh" is titled "Mesh" holding 2
    And the stack "mesh" names "dingdong,ics"
    And the applet "dingdong" is a named applet with kehto's catalogue id
    And the applet "ics" carries the relay hint "wss://nos.lol"

  Scenario: repeated coordinates are one applet, even with different hints
    Given a stack "mesh" titled "Mesh" holding "notes,notes@wss://nos.lol"
    When the shell reads that stack
    Then the stack "mesh" is titled "Mesh" holding 1

  Scenario: a stack is named the way AppStore names it
    Given a stack "bits" named "Bits" holding "notes"
    When the shell reads that stack
    Then the stack "bits" is titled "Bits" holding 1

  Scenario: an untitled stack is named for its identifier
    Given an untitled stack "solo" holding "notes"
    When the shell reads that stack
    Then the stack "solo" is titled "solo" holding 1

  Scenario: a blank title falls back to the identifier
    Given a stack "gaps" titled "  " holding "notes"
    When the shell reads that stack
    Then the stack "gaps" is titled "gaps" holding 1

  Scenario: a stack's description is the one its publisher wrote
    Given a stack "tools" titled "Tools" described "Small helpers" holding "notes"
    When the shell reads that stack
    Then the stack "tools" is described "Small helpers"

  Scenario: a publisher marks which applets a stack starts with
    Given a stack "rocket-stack" titled "Rocket Stack" holding "toy-rocket,view-module,view-problem" starting "toy-rocket,view-module"
    When the shell reads that stack
    Then the stack "rocket-stack" is titled "Rocket Stack" holding 3
    And the stack "rocket-stack" starts with "toy-rocket,view-module"

  Scenario: a stack that marks nothing starts with nothing
    Given a stack "loose" titled "Loose" holding "notes,ics"
    When the shell reads that stack
    Then the stack "loose" starts with nothing

  Scenario: a marker naming no member is ignored rather than promoted
    Given a stack "ghost" titled "Ghost" holding "notes" starting "stranger"
    When the shell reads that stack
    Then the stack "ghost" is titled "Ghost" holding 1
    And the stack "ghost" starts with nothing

  Scenario: a marker still matches a member that carries a relay hint
    Given a stack "hinted" titled "Hinted" holding "notes,ics@wss://nos.lol" starting "ics"
    When the shell reads that stack
    Then the applet "ics" carries the relay hint "wss://nos.lol"
    And the stack "hinted" starts with "ics"

  Scenario: a marker with no coordinate marks nothing
    Given a stack "blank" titled "Blank" holding "notes" starting "novalue"
    When the shell reads that stack
    Then the stack "blank" starts with nothing

  Scenario: the shell does not attribute an unsigned change to a stack's publisher
    Given a stack "mesh" titled "Mesh" holding "notes"
    And the stack title was changed after signing
    When the shell reads that stack
    Then the shell has no stack

  Scenario: an event that is not a stack is not read as one
    Given a stack of kind 30000 titled "Other" holding "notes"
    When the shell reads that stack
    Then the shell has no stack

  Scenario: a set without an identifier is not a stack
    Given a stack "loose" with no identifier holding "notes"
    When the shell reads that stack
    Then the shell has no stack

  Scenario Outline: a stack keeps only the applets it can open
    Given a stack "mixed" titled "Mixed" holding "<entry>"
    When the shell reads that stack
    Then the stack "mixed" is titled "Mixed" holding <count>

    Examples:
      | entry       | count |
      | notes       | 1     |
      | zapstore    | 0     |
      | nokey       | 0     |
      | rootsuffix  | 0     |
      | novalue     | 0     |

  Scenario: a root applet has no identifier
    Given a stack "sites" titled "Sites" holding "root:"
    When the shell reads that stack
    Then the applet "root:" is a root applet with kehto's catalogue id

  Scenario: the newest version of each stack wins
    Given a stack "mesh" titled "Mesh" holding "notes" published at 10
    And a stack "mesh" titled "Mesh again" holding "notes,ics" published at 20
    When the shell keeps the newest of the stacks
    Then the shell lists stacks "mesh"
    And the stack "mesh" is titled "Mesh again" holding 2

  Scenario: an older version never replaces a newer one
    Given a stack "mesh" titled "Newest" holding "notes" published at 30
    And a stack "mesh" titled "Older" holding "notes,ics" published at 20
    When the shell keeps the newest of the stacks
    Then the stack "mesh" is titled "Newest" holding 1

  Scenario: a stack republished empty is gone
    Given a stack "mesh" titled "Mesh" holding "notes"
    And an empty stack "mesh" published at 1700000001
    When the shell keeps the newest of the stacks
    Then the stack list is empty

  Scenario: the launcher reads the applet relays and the public relays
    Given the fake pool serves stacks "mesh,mesh@wss://nos.lol,games"
    When the stacks load from the shell's relays
    Then the shell lists stacks "mesh,games"
    And the stacks asked "wss://relay.napplet.soy,wss://relay.ditto.pub,wss://relay.nostr.com,wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net" for kind 30267 limited to 500

  Scenario: the limit and the relays a read asks for are the caller's
    Given the fake pool serves stacks "mesh"
    When the stacks load from the shell's relays limited to 7
    Then the stacks asked the shell's relays for kind 30267 limited to 7

  Scenario: stacks seen before are listed while the relays are asked
    Given stacks already seen "mesh,games"
    When the stacks stream with that cache
    Then the shell listed "games,mesh"

  Scenario: a relay that fails keeps the cached stacks
    Given stacks already seen "mesh"
    And the fake pool refuses every request
    When the stacks stream with that cache
    Then the shell listed "mesh"

  Scenario: nothing yet is said out loud, and then the stack arrives
    Given the fake pool serves stacks "mesh" after 40 ms
    When the stacks stream settling after 10 ms
    Then the stream emitted an empty list first
    And the shell listed "mesh"

  Scenario: a stack read from the relays is kept in the event cache
    Given the fake pool serves stacks "mesh"
    When the stacks stream storing what it reads
    Then the event cache holds 1 stack event

  Scenario: a relay that sends something else contributes no stack
    Given the fake pool serves stacks "mesh" and a note
    When the stacks stream with that cache
    Then the shell listed "mesh"

  Scenario: a cache that cannot be read does not stop the relays
    Given the fake pool serves stacks "mesh"
    When the stacks stream with a cache that cannot be read
    Then the shell listed "mesh"
