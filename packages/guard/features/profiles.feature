Feature: Guard profiles
  The guard ships three profiles. Strict is the shell default and the tightest;
  the others only loosen limits, never disable a mitigation (D-003).

  Scenario: the profiles are listed tightest first
    Then the guard profiles are "strict, balanced, relaxed"

  Scenario Outline: each profile sets its headline limits
    When the guard builds the "<profile>" profile
    Then the guard limit "ingressBurst" is <burst>
    And the guard limit "ingressQueue" is <queue>
    And the guard limit "quarantineThreshold" is <quarantine>
    And the guard limit "hiddenResourceAllowance" is <hidden>
    And the guard limit "deferQueue" is <defer>
    And the guard limit "maxResourceEnvelopeBytes" is <resource>
    And the guard limit "maxSubscribeEnvelopeBytes" is <subscribe>
    And the guard limit "unfocusedMultiplier" is <unfocused>

    Examples:
      | profile  | burst | queue | quarantine | hidden | defer | resource | subscribe | unfocused |
      | strict   | 8     | 64    | 300        | 8      | 200   | 65536    | 262144    | 0.25      |
      | balanced | 12    | 128   | 420        | 16     | 400   | 131072   | 524288    | 0.5       |
      | relaxed  | 24    | 192   | 800        | 32     | 600   | 196608   | 786432    | 0.75      |

  Scenario: strict rates are the baseline
    When the guard builds the "strict" profile
    Then the guard rate "relay:subscribe" is 30 per 60000 ms
    And the guard rate "relay:publish" is 20 per 60000 ms
    And the guard rate "relay:publish:delete" is 5 per 60000 ms
    And the guard rate "outbox:subscribe" is 30 per 60000 ms
    And the guard rate "outbox:publish" is 20 per 60000 ms
    And the guard rate "resource:bytes" is 120 per 10000 ms
    And the guard rate "storage:write" is 60 per 10000 ms
    And the guard rate "dm:send" is 20 per 60000 ms
    And the guard rate "intent:invoke" is 10 per 60000 ms
    And the guard rate "control" is 120 per 10000 ms
    And the guard rate "generic" is 120 per 10000 ms

  Scenario Outline: looser profiles scale every rate by a whole factor
    When the guard builds the "<profile>" profile
    Then the guard rate "relay:publish:delete" is <delete> per 60000 ms
    And the guard rate "resource:bytes" is <resource> per 10000 ms
    And the guard rate "intent:invoke" is <intent> per 60000 ms

    Examples:
      | profile  | delete | resource | intent |
      | balanced | 10     | 240      | 20     |
      | relaxed  | 15     | 360      | 30     |

  Scenario: every class gets a blocking budget scaled for unfocused windows
    When the guard builds the "strict" profile
    Then the guard budget for "relay:publish" is 20 per 60000 ms with action "block"
    And the guard budget for "relay:publish:delete" is 5 per 60000 ms with action "block"
    And the guard budget for "generic" is 120 per 10000 ms with action "block"
    And every guard budget has unfocused multiplier 0.25
    And no guard budget has a startup burst of its own

  Scenario: the balanced budgets carry the balanced multiplier
    When the guard builds the "balanced" profile
    Then the guard budget for "relay:publish" is 40 per 60000 ms with action "block"
    And every guard budget has unfocused multiplier 0.5
