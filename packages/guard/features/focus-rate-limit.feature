Feature: Focus-aware rate limiter
  kehto's pure rate evaluator, fed one budget per operation class and the focus
  the shell observed. Rejections and flags become guard events. It is temporal
  protection only: whether an applet may do something at all is decided by its
  grants and by the firewall.

  Background:
    Given a guard rate limiter using the "strict" profile

  Scenario: deletions within the budget pass without an event
    When the guard rate limiter observes 5 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "pass"
    And the guard emitted no events

  Scenario: the deletion past the budget is rejected and reported by class
    When the guard rate limiter observes 6 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "reject"
    And the guard rate limiter gave reason "rate-exceeded" with action "block"
    And the guard emitted 1 events
    And the guard's last event has disposition "reject" and reason "rate:relay:publish:delete"
    And the guard's last event names window "w1" and applet "chat" with class "relay:publish:delete"

  Scenario: an unfocused window gets a quarter of the budget
    When the guard rate limiter observes 5 "relay.publish" envelopes from applet "chat" in window "w1" while "unfocused"
    Then the guard rate limiter decided "pass"
    When the guard rate limiter observes 1 "relay.publish" envelopes from applet "chat" in window "w1" while "unfocused"
    Then the guard rate limiter decided "reject"
    And the guard's last event has disposition "reject" and reason "rate:relay:publish"

  Scenario: a focused window keeps the full budget
    When the guard rate limiter observes 20 "relay.publish" envelopes from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "pass"
    And the guard emitted no events

  Scenario: budgets are per applet, not per window
    When the guard rate limiter observes 5 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    And the guard rate limiter observes 1 "relay.publish" envelopes of kind 5 from applet "chat" in window "w2" while "focused"
    Then the guard rate limiter decided "reject"
    When the guard rate limiter observes 1 "relay.publish" envelopes of kind 5 from applet "notes" in window "w3" while "focused"
    Then the guard rate limiter decided "pass"

  Scenario: a download passes whatever its size, which the ingress guard caps
    When the guard rate limiter observes a "resource.fetch" envelope of 65537 bytes from applet "chat" in window "w1" focused for 300 ms
    Then the guard rate limiter decided "pass"
    And the guard rate limiter gave reason "within-budget" with action "ignore"
    And the guard emitted no events

  Scenario: a budget that only flags passes with a flag event
    Given a guard rate limiter whose "generic" budget only flags past 1
    When the guard rate limiter observes 2 "clipboard.write" envelopes from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "pass"
    And the guard emitted 1 events
    And the guard's last event has disposition "flag" and reason "rate:generic"

  Scenario: a budget that is ignored passes without an event
    Given a guard rate limiter whose "generic" budget is ignored past 1
    When the guard rate limiter observes 2 "clipboard.write" envelopes from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "pass"
    And the guard emitted no events

  Scenario: forgetting a window resets its applet's budget
    When the guard rate limiter observes 6 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "reject"
    When the guard rate limiter forgets window "w1"
    And the guard rate limiter observes 1 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "pass"

  Scenario: forgetting an unknown window changes nothing
    When the guard rate limiter observes 5 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    And the guard rate limiter forgets window "ghost"
    And the guard rate limiter observes 1 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "reject"

  Scenario: the rate limiter runs on the wall clock when none is injected
    Given a guard rate limiter using the "strict" profile with default options
    When the guard rate limiter observes 6 "relay.publish" envelopes of kind 5 from applet "chat" in window "w1" while "focused"
    Then the guard rate limiter decided "reject"
