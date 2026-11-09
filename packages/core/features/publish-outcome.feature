Feature: Publish outcome
  A publish goes to several servers at once. It succeeds when any one of them
  accepts it, and the person is told how many did (D-028). A refusal keeps the
  server's own reason for the developer; the sentence for the person never
  repeats it.

  Scenario: two of three servers accept
    Given the servers answered a publish with
      | server          | accepted | reason        |
      | wss://a.example | yes      |               |
      | wss://b.example | yes      |               |
      | wss://c.example | no       | blocked: spam |
    Then the publish succeeded
    And it was accepted by "wss://a.example/,wss://b.example/"
    And "wss://c.example/" refused it with "blocked: spam"
    And the person is told "Saved to 2 of 3 servers"

  Scenario: every server refuses
    Given the servers answered a publish with
      | server          | accepted | reason                |
      | wss://a.example | no       | auth-required: log in |
      | wss://b.example | no       | rate-limited: slow    |
    Then the publish failed
    And it was accepted by ""
    And "wss://a.example/" refused it with "auth-required: log in"
    And "wss://b.example/" refused it with "rate-limited: slow"
    And the person is told "No server accepted it"

  Scenario: every server accepts
    Given the servers answered a publish with
      | server          | accepted | reason |
      | wss://a.example | yes      |        |
      | wss://b.example | yes      |        |
      | wss://c.example | yes      |        |
    Then the publish succeeded
    And the person is told "Saved to all 3 servers"

  Scenario: the only server accepts
    Given the servers answered a publish with
      | server          | accepted | reason |
      | wss://a.example | yes      |        |
    Then the person is told "Saved to 1 server"

  Scenario: a refusal without a reason still has one
    Given the servers answered a publish with
      | server          | accepted | reason |
      | wss://a.example | yes      |        |
      | wss://b.example | no       |        |
    Then "wss://b.example/" refused it with "refused"
    And the person is told "Saved to 1 of 2 servers"

  Scenario: a server that answers twice counts once, and an acceptance wins
    Given the servers answered a publish with
      | server           | accepted | reason        |
      | wss://a.example  | no       | error: busy   |
      | wss://A.example/ | yes      |               |
      | wss://a.example  | no       | late          |
      | not a server     | no       | invalid: url  |
    Then the publish succeeded
    And it was accepted by "wss://a.example/"
    And "not a server" refused it with "invalid: url"
    And the person is told "Saved to 1 of 2 servers"

  Scenario: nothing was asked
    Given the servers answered a publish with
      | server | accepted | reason |
    Then the publish failed
    And the person is told "There was no server to save it to"
