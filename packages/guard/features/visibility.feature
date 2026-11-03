Feature: Visibility gate
  Hidden windows should not fetch or publish while the user cannot see them.
  Their traffic waits and is drained when they return; control messages are
  never held so a hidden window can still be closed or themed.

  Background:
    Given a guard visibility gate using the "strict" profile

  Scenario: an unreported window counts as visible and unfocused
    Then the guard gate reports window "w1" as visible "true" and focused "false"

  Scenario: the shell's report is what the gate believes
    When the guard gate marks window "w1" as "focused"
    Then the guard gate reports window "w1" as visible "true" and focused "true"
    When the guard gate marks window "w1" as "hidden"
    Then the guard gate reports window "w1" as visible "false" and focused "false"

  Scenario: hidden windows defer everything except control
    When the guard gate marks window "w1" as "hidden"
    Then the guard gate defers "relay:subscribe" for window "w1"
    And the guard gate defers "resource:bytes" for window "w1"
    And the guard gate does not defer "control" for window "w1"

  Scenario: visible windows defer nothing
    When the guard gate marks window "w1" as "visible"
    Then the guard gate does not defer "relay:subscribe" for window "w1"
    And the guard gate does not defer "relay:subscribe" for window "unreported"

  Scenario: deferred envelopes drain oldest first and only once
    When the guard gate defers a "relay.subscribe" envelope for window "w1"
    And the guard gate defers a "resource.fetch" envelope for window "w1"
    Then the guard gate accepted the deferral
    When the guard gate drains window "w1"
    Then the guard drained envelope types "relay.subscribe, resource.fetch"
    When the guard gate drains window "w1"
    Then the guard drained nothing

  Scenario: draining an unknown window yields nothing
    When the guard gate drains window "ghost"
    Then the guard drained nothing

  Scenario: a full defer queue refuses and reports
    When the guard gate defers 200 "relay.subscribe" envelopes for window "w1"
    Then the guard gate accepted the deferral
    And the guard emitted no events
    When the guard gate defers a "resource.fetch" envelope for window "w1"
    Then the guard gate refused the deferral
    And the guard emitted 1 events
    And the guard's last event has disposition "reject" and reason "defer:queue-full"
    And the guard's last event names window "w1" and applet "chat" with class "resource:bytes"

  Scenario: without a resolver the report names an unknown applet
    Given a guard visibility gate using the "strict" profile without a resolver
    When the guard gate defers 201 "relay.subscribe" envelopes for window "w1"
    Then the guard gate refused the deferral
    And the guard's last event names window "w1" and applet "unknown" with class "relay:subscribe"

  Scenario: forgetting a window drops its visibility and queue
    When the guard gate marks window "w1" as "hidden"
    And the guard gate defers a "relay.subscribe" envelope for window "w1"
    And the guard gate forgets window "w1"
    Then the guard gate reports window "w1" as visible "true" and focused "false"
    When the guard gate drains window "w1"
    Then the guard drained nothing

  Scenario: the gate runs on the wall clock and swallows events when none are injected
    Given a guard visibility gate using the "strict" profile with default options
    When the guard gate defers 201 "relay.subscribe" envelopes for window "w1"
    Then the guard gate refused the deferral
    And the guard emitted no events
