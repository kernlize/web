Feature: What the firewall needs from the shell's services
  Under the firewall kehto has each request's destinations approved before it
  runs, and charges what it carries out against a rate limiter the host
  supplies. These are the pieces kernl hands it (D-049).

  Scenario: the relays put to the firewall are the shell's tiers as bare origins
    Given relay tiers of "wss://a.example,wss://a.example/,wss://b.example/path,https://c.example,wss://user@d.example"
    Then the shell's relay origins are "wss://a.example"

  Scenario Outline: a download's server is put to the firewall only when it is a web address
    When a download of "<address>" runs <firewall> the firewall's network approval
    Then the download was resolved <how>

    Examples:
      | address                 | firewall | how                              |
      | https://files.example/a | with     | under the firewall's approval    |
      | HTTP://files.example/a  | with     | under the firewall's approval    |
      | magnet:?xt=urn:btih:abc | with     | under the request's own signal   |
      | https://files.example/a | without  | under the request's own signal   |

  Scenario: a publish one relay accepted is a success on the planned path too
    Given an outbox router whose publishes are accepted by one relay of two
    Then both its plain and its planned publish report success and keep the per-relay results
    And an outbox router with no planned publish gains none

  Scenario: a publish no relay accepted stays a failure
    Given an outbox router whose publishes are accepted by no relay
    Then both its plain and its planned publish report failure

  Scenario: the runtime's limiter charges by class, softens what cannot be refused, and charges a download once
    Given a runtime rate limiter over the "strict" profile
    When the runtime charges 21 "relay.publish" operations for "chat"
    Then the last charge was refused as "rate-exceeded" with action "block"
    When the runtime observes 1 "relay.publish" operations for "chat"
    Then the last charge was allowed as "rate-exceeded" with action "flag"
    When the runtime charges 500 "resource.network" operations for "chat"
    Then the last charge was allowed as "within-budget" with action "ignore"
    When the runtime charges 1 "relay.publish" operations for "notes"
    Then the last charge was allowed as "within-budget" with action "ignore"

  Scenario: a budget that only flags is not softened further
    Given a runtime rate limiter whose "generic" budget flags past 1
    When the runtime observes 2 "link.open" operations for "chat"
    Then the last charge was allowed as "rate-exceeded" with action "flag"
    And retiring "chat" from the runtime limiter does nothing harmful

  Scenario: a send's recipients are read before kehto sees them
    Given a messaging service that reads a send's recipients through a finder knowing "npub-ada"
    When an applet's "dm.send" names "npub-ada"
    Then the service underneath was handed "dm.send" for "hex-ada"
    When an applet's "dm.send" names "nobody"
    Then the applet was told the send failed with "invalid:recipient"
    When an applet's "dm.send" with no id names "nobody"
    Then the applet was told a send with no id failed with "invalid:recipient"
    When an applet's "dm.conversations" names "npub-ada"
    Then the service underneath was handed "dm.conversations" for "npub-ada"
    When an applet's "dm.send" names no recipients at all
    Then the service underneath was handed "dm.send" untouched

  Scenario: admission refuses when kehto has no firewall
    Given applet admissions over a runtime without a firewall
    Then admitting a window fails with "unavailable:firewall" and opens no session

  Scenario: the answers in force leave out what is used up or not an applet's
    Given a firewall over a grant store holding a used-once answer, a development answer, a network answer and a resource answer
    Then the firewall lists a "network" answer and a "resource" answer and nothing else
    And taking an answer back and taking them all back reach the grant store
