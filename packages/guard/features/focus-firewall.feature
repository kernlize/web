Feature: Focus-aware firewall
  kehto's pure firewall engine, fed with focus the shell observed. Rejections
  and flags become guard events; prompts are treated as denials because the
  guard runs before dispatch and the shell's consent flow prompts elsewhere.

  Background:
    Given a guard focus firewall using the "strict" profile

  Scenario: deletions within the budget pass without an event
    When the guard firewall observes 5 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "pass"
    And the guard emitted no events

  Scenario: the deletion past the budget is rejected and reported by class
    When the guard firewall observes 6 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "reject"
    And the guard firewall's decision has rule "rate:opclass"
    And the guard emitted 1 events
    And the guard's last event has disposition "reject" and reason "rate:relay:publish:delete"
    And the guard's last event names window "w1" and applet "chat" with class "relay:publish:delete"

  Scenario: an unfocused window gets a quarter of the budget
    When the guard firewall observes 5 "relay.publish" envelopes from applet "chat" in window "w1" while "unfocused"
    Then the guard firewall decided "pass"
    When the guard firewall observes 1 "relay.publish" envelopes from applet "chat" in window "w1" while "unfocused"
    Then the guard firewall decided "reject"
    And the guard's last event has disposition "reject" and reason "rate:relay:publish"

  Scenario: a focused window keeps the full budget
    When the guard firewall observes 20 "relay.publish" envelopes from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "pass"
    And the guard emitted no events

  Scenario: budgets are per applet, not per window
    When the guard firewall observes 5 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    And the guard firewall observes 1 "relay.publish" envelopes of kind 5 from applet "chat" in window "w2" while "focused"
    Then the guard firewall decided "reject"
    When the guard firewall observes 1 "relay.publish" envelopes of kind 5 from applet "notes" in window "w3" while "focused"
    Then the guard firewall decided "pass"

  Scenario: an oversized download is blocked by kehto's content matcher
    When the guard firewall observes a "resource.fetch" envelope of 65537 bytes from applet "chat" in window "w1" focused for 300 ms
    Then the guard firewall decided "reject"
    And the guard's last event has disposition "reject" and reason "matcher:size:resource:bytes"

  Scenario: a download under the cap passes with every observation field set
    When the guard firewall observes a "resource.fetch" envelope of 65536 bytes from applet "chat" in window "w1" focused for 300 ms
    Then the guard firewall decided "pass"
    And the guard emitted no events

  Scenario: a rate that only flags passes with a flag event
    Given a guard focus firewall whose applet "chat" has a flag-only budget of 1
    When the guard firewall observes 2 "clipboard.write" envelopes from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "pass"
    And the guard emitted 1 events
    And the guard's last event has disposition "flag" and reason "rate:generic"

  Scenario: an ask policy is a denial in the guard layer
    Given a guard focus firewall using the "strict" profile where applet "chat" has the "ask" policy
    When the guard firewall observes 1 "relay.publish" envelopes from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "prompt"
    And the guard's last event has disposition "reject" and reason "prompt:policy:ask"

  Scenario: a deny policy rejects
    Given a guard focus firewall using the "strict" profile where applet "chat" has the "deny" policy
    When the guard firewall observes 1 "relay.publish" envelopes from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "reject"
    And the guard's last event has disposition "reject" and reason "policy:deny"

  Scenario: an allow policy bypasses budgets without events
    Given a guard focus firewall using the "strict" profile where applet "chat" has the "allow" policy
    When the guard firewall observes 50 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "pass"
    And the guard emitted no events

  Scenario: forgetting a window resets its applet's budget
    When the guard firewall observes 6 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "reject"
    When the guard firewall forgets window "w1"
    And the guard firewall observes 1 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "pass"

  Scenario: forgetting an unknown window changes nothing
    When the guard firewall observes 5 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    And the guard firewall forgets window "ghost"
    And the guard firewall observes 1 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "reject"

  Scenario: the firewall runs on the wall clock when none is injected
    Given a guard focus firewall using the "strict" profile with default options
    When the guard firewall observes 6 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard firewall decided "reject"
