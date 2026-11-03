Feature: Mitigation descriptions
  The grants panel lists every protection in plain language, with the limit
  that applies in the current profile (D-003).

  Scenario: every mitigation is described once, in display order
    When the guard describes the mitigations for the "strict" profile
    Then the guard describes 11 mitigations
    And every guard mitigation is enabled
    And the guard mitigations are listed in this order:
      | id                   | provider |
      | zero-network-sandbox | both     |
      | bound-identity       | kehto    |
      | verified-artifacts   | kehto    |
      | replay-detection     | kehto    |
      | rate-limits          | both     |
      | focus-tightening     | kernl    |
      | hidden-deferral      | kernl    |
      | ingress-flood        | kernl    |
      | size-caps            | both     |
      | device-denial        | kehto    |
      | destructive-consent  | kernl    |

  Scenario: the text speaks to the user, not the protocol
    When the guard describes the mitigations for the "strict" profile
    Then no guard mitigation names a protocol

  Scenario: nothing the shell only observes is described as held or blocked
    When the guard describes the mitigations for the "strict" profile
    Then the guard mitigations "focus-tightening,hidden-deferral,ingress-flood" never claim to hold, queue, block or refuse
    And the guard mitigation "focus-tightening" says "When an applet window is not the one you are working in, the shell counts its requests against a smaller allowance and tells you when it goes over. Going over is reported, not refused: the shell counts each request as it arrives but cannot hold it back, so it is still handled. The budget above still applies."

  Scenario: the sealed frame cannot open frames of its own (D-014)
    When the guard describes the mitigations for the "strict" profile
    Then the guard mitigation "zero-network-sandbox" says "Every applet runs in a sealed frame with no direct network access, and cannot open a frame of its own inside it. Anything it sends or receives goes through the shell, where you can see it, revoke what you granted, or close the applet."

  Scenario: oversized requests are refused before they are handled
    When the guard describes the mitigations for the "strict" profile
    Then the guard mitigation "size-caps" is titled "Oversized requests are refused"
    And the guard mitigation "size-caps" says "The shell measures download and long-running query requests against a maximum size. One that is too large is refused before it is handled, so nothing it asked for is fetched, and the shell tells you."

  Scenario: quarantine drops the message that crossed the limit
    When the guard describes the mitigations for the "strict" profile
    Then the guard mitigation "ingress-flood" says "The shell counts every message an applet sends. Bursts above the per-second rate are reported to you. An applet that keeps flooding is quarantined: the message that crossed the limit is dropped, and the shell closes the applet and tells you."
    And the guard mitigation "hidden-deferral" says "While an applet is minimised or hidden, the shell counts its downloads. One that downloads past its allowance is quarantined: the download that crossed the allowance is dropped, and the shell closes the applet and tells you. Other requests from a hidden applet are recorded, not held back."

  Scenario: every overwrite or erasure of the account's record is put to the user
    When the guard describes the mitigations for the "strict" profile
    Then the guard mitigation "destructive-consent" says "Before the shell signs anything for an applet that overwrites or erases part of your account's public record (your profile, contacts, connections, lists or any other record a new version replaces, a deletion, or a request to erase your account), it shows you what changes compared with the current version and waits for your answer. If the current version cannot be loaded, it says so."

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
