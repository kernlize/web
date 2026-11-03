Feature: Mitigation descriptions
  The grants panel lists every protection in plain language, with the limit
  that applies in the current profile (D-003).

  Scenario: every mitigation is described once, in display order
    When the guard describes the mitigations for the "strict" profile
    Then the guard describes 11 mitigations
    And every guard mitigation is enabled
    And the guard mitigations are listed in this order:
      | id                   | provider |
      | zero-network-sandbox | kehto    |
      | bound-identity       | kehto    |
      | verified-artifacts   | kehto    |
      | replay-detection     | kehto    |
      | rate-limits          | both     |
      | focus-tightening     | kernl    |
      | hidden-deferral      | kernl    |
      | ingress-flood        | kernl    |
      | size-caps            | kernl    |
      | device-denial        | kehto    |
      | destructive-consent  | kernl    |

  Scenario: the text speaks to the user, not the protocol
    When the guard describes the mitigations for the "strict" profile
    Then no guard mitigation names a protocol

  Scenario: nothing observed after an applet's request was handled is described as held or blocked
    When the guard describes the mitigations for the "strict" profile
    Then the guard mitigations "focus-tightening,hidden-deferral,ingress-flood,size-caps" never claim to hold, queue, block or refuse
    And the guard mitigation "destructive-consent" says "Before the shell signs a profile, contact-list, deletion, connection-list or other list change for an applet, it shows you what changes and waits for your answer."

  Scenario: limits reflect the strict profile
    When the guard describes the mitigations for the "strict" profile
    Then the guard mitigation "rate-limits" has limit "publish 20 per 60s, delete 5 per 60s, messages 20 per 60s"
    And the guard mitigation "focus-tightening" has limit "25% of the focused budget"
    And the guard mitigation "hidden-deferral" has limit "8 downloads while hidden"
    And the guard mitigation "ingress-flood" has limit "8 messages per second, 300 per 10s"
    And the guard mitigation "size-caps" has limit "downloads 64 KiB, queries 256 KiB"
    And the guard mitigation "zero-network-sandbox" has no limit

  Scenario: limits reflect the relaxed profile
    When the guard describes the mitigations for the "relaxed" profile
    Then the guard mitigation "focus-tightening" has limit "75% of the focused budget"
    And the guard mitigation "ingress-flood" has limit "24 messages per second, 800 per 10s"
    And the guard mitigation "size-caps" has limit "downloads 192 KiB, queries 768 KiB"
