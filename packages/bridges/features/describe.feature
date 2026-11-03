Feature: Describing a bridge
  The shell shows each bridge in rows the user can read: what it does, whether it is
  ready, and what the other side learns. No row names a protocol.

  Scenario: an available bridge
    Given a web bridge
    Then describing the web bridge gives
      | label                       | value     |
      | Used for                    | downloads |
      | Status                      | ready     |
      | Shares your network address | yes       |
      | Encrypted in transit        | yes       |
      | Activity visible to others  | no        |

  Scenario: a bridge without a backend
    Given the soulseek bridge without a backend
    Then describing the bridge gives
      | label                       | value         |
      | Used for                    | sharing       |
      | Status                      | not available |
      | Reason                      | no-backend    |
      | Shares your network address | yes           |
      | Encrypted in transit        | no            |
      | Activity visible to others  | yes           |
    And no description label names a protocol
