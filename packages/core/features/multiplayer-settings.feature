Feature: The person's own settings for meeting people and remote tools
  On this device the person chooses the servers that introduce them and find
  tool servers, whatever helps their connections through, and which tool
  families they trust. Their choices come before the host's (D-043). Families
  are found from signed announcements, and every tool's schema hash is checked
  again before it is trusted.

  Scenario: choices are kept on this device and come back
    Given the person's settings on this device
    When the person chooses the servers "wss://meet.example,wss://meet.example,wss://also.example"
    And the person chooses the helper "turn:turn.example:3478" as "ann" with "secret"
    Then the settings come back the same after a reload, with each server once
    When the person goes back to the host's servers and helpers
    Then the settings name no servers and no helpers

  Scenario Outline: choices the shell cannot use are refused
    Given the person's settings on this device
    When the person tries, in settings, to <choice>
    Then the settings refuse it with "<error>"

    Examples:
      | choice                                            | error             |
      | choose the servers "https://meet.example"         | invalid:relay-url |
      | choose the helper "https://help.example"          | invalid:helper    |
      | trust a family with no tools                      | invalid:family    |
      | trust a family whose tool has no schema hash      | invalid:family    |
      | trust a family whose provider key is not a key    | invalid:family    |
      | trust a family that names one tool twice          | invalid:family    |
      | trust a seventeenth family                        | invalid:family    |

  Scenario: saving a family with the same label and provider replaces it, and one can be removed
    Given the person's settings on this device
    When the person trusts the family "rooms" with the tool "join"
    And the person trusts the family "rooms" with the tool "leave"
    Then the person trusts 1 family, "rooms" with the tool "leave"
    When the person trusts the family "lobby", found on the servers in use
    Then the person trusts 2 families
    When the person stops trusting the family "lobby"
    When the person stops trusting the family "rooms"
    Then the person trusts 0 families

  Scenario: settings stored by something else are read as unset rather than trusted
    Given settings on this device that hold a server that is not one, a broken helper and a broken family
    Then the settings name no servers and no helpers
    And the person trusts 0 families

  Scenario: a family is found by its schema hash, checked, and called through by an applet
    Given a loopback relay with a tool server that announces "trust_score" and says where it takes requests
    And the person's settings on this device
    When the person looks for tools by the schema hash of "trust_score"
    Then one family is found, from the tool server, with "trust_score" pinned to its schema hash, taking requests where it said
    When the person trusts it as "trust"
    And an applet asks the family "trust" to run "trust_score"
    Then the applet gets the answer "0.87"

  Scenario Outline: a family is found from a reference to its announcements
    Given a loopback relay with a tool server that announces "trust_score" and says where it takes requests
    When the person looks for tools from <reference>
    Then one family is found, from the tool server, with "trust_score" pinned to its schema hash

    Examples:
      | reference                                             |
      | a reference to the server's announcement               |
      | a reference to the tool list, naming the relay         |
      | the website that publishes the tool server             |

  Scenario: the newest inventory is the one read, and where requests go falls back to where it was found
    Given a loopback relay with a tool server that announced "old_tool", then "trust_score" with an output schema
    When the person looks for tools by the schema hash of "trust_score"
    Then one family is found, from the tool server, with "trust_score" pinned to its schema hash, taking requests on the loopback relay

  Scenario Outline: searches that find nothing the shell can trust are refused
    Given a loopback relay with <server>
    When the person looks for tools from <reference>
    Then the search is refused with "<error>"

    Examples:
      | server                                                       | reference                                 | error                  |
      | a tool server that announces "trust_score" and says where it takes requests | "naddr1notatoollist"     | invalid:tool-reference |
      | a tool server that announces "trust_score" and says where it takes requests | "http://tools.example"   | invalid:tool-reference |
      | a tool server that announces "trust_score" and says where it takes requests | "not a website at all"   | invalid:tool-reference |
      | a tool server that announces "trust_score" and says where it takes requests | a reference to a note    | invalid:tool-reference |
      | a tool server that announces "trust_score" and says where it takes requests | a schema hash nobody has | unavailable:no-tools   |
      | a tool server whose stated schema hash is not its tool's     | the schema hash it states                 | invalid:tool-inventory |
      | a tool server whose tool list is not a list                  | a reference to the tool list, naming the relay | invalid:tool-inventory |
      | a tool server that lists the same tool twice                 | a reference to the tool list, naming the relay | invalid:tool-inventory |
      | a tool server whose list leaves out the hash it is found by  | the schema hash it is found by            | unavailable:no-tools   |
      | a tool server that announces "trust_score" and says where it takes requests | a website that is down    | unavailable:website    |
      | a tool server that announces "trust_score" and says where it takes requests | a website whose document is not JSON | unavailable:website |
      | a tool server that announces "trust_score" and says where it takes requests | a website whose document names no provider | unavailable:website |
      | a tool server that announces "trust_score" and says where it takes requests | a website whose document is too large | unavailable:website |

  Scenario: the person's family takes the place of the host's with the same label and provider
    Then with the host's families "rooms,chat" and the person's "rooms" from the same provider, applets are offered "chat" from the host and "rooms" from the person

  Scenario: the shell searches over the person's servers
    Given a loopback relay with a tool server that announces "trust_score" and says where it takes requests
    And a live kernl shell
    Then a search in that shell, before the person chooses servers, finds no tools
    When the person chooses the loopback relay as their servers in that shell
    And the person looks for tools in that shell by the schema hash of "trust_score"
    Then one family is found, from the tool server, with "trust_score" pinned to its schema hash
