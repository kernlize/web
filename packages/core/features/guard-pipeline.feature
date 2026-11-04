Feature: Guard pipeline
  The guard sits in front of kehto's bridge: ingress flood control, then the
  visibility gate, then the focus-aware firewall. Window-level messages can be
  held or dropped. Port traffic is decided before kehto's runtime sees it: it
  is dispatched, held until the window is visible, or dropped (D-020).

  Background:
    Given a kernl guard pipeline using the "strict" profile with a controlled clock
    And pipeline window "w1" runs applet "chat"

  Scenario: a message from an unknown window reaches the bridge so it can report it
    When a window message of type "napplet.hello" arrives from an unknown window
    Then the pipeline disposition was "unrouted"
    And 1 messages were forwarded

  Scenario: a visible window's message passes every layer
    When a window message of type "napplet.hello" arrives from window "w1"
    Then the pipeline disposition was "pass"
    And 1 messages were forwarded

  Scenario: a burst past the budget is held and released when the budget refills
    When 9 window messages of type "napplet.hello" arrive from window "w1"
    Then the pipeline disposition was "defer"
    And 8 messages were forwarded
    When the pipeline clock advances by 1000 ms
    And the pipeline drains window "w1"
    Then 9 messages were forwarded
    And the pipeline emitted guard events with reasons "flood:burst"

  Scenario: a full queue rejects
    When 73 window messages of type "napplet.hello" arrive from window "w1"
    Then the pipeline disposition was "reject"
    And 8 messages were forwarded

  Scenario: a hidden window's traffic waits until it is visible, except control traffic
    Given pipeline window "w1" is hidden
    When a window message of type "relay.subscribe" arrives from window "w1"
    Then the pipeline disposition was "defer"
    And 0 messages were forwarded
    When a window message of type "storage.get" arrives from window "w1"
    Then the pipeline disposition was "pass"
    And 1 messages were forwarded
    When the pipeline marks window "w1" visible
    Then 2 messages were forwarded

  Scenario: a hidden window cannot hold more than the defer queue
    Given pipeline window "w1" is hidden
    When 201 paced window messages of type "relay.subscribe" arrive from window "w1"
    Then the pipeline disposition was "reject"
    And the pipeline emitted guard events with reasons "defer:queue-full"

  Scenario: forgetting a window drops what it held
    Given pipeline window "w1" is hidden
    When a window message of type "relay.subscribe" arrives from window "w1"
    And the pipeline forgets window "w1"
    And the pipeline marks window "w1" visible
    Then 0 messages were forwarded

  Scenario: the firewall rejects a window that publishes past its rate
    When paced window messages of type "relay.publish" arrive from window "w1" until one is rejected, at most 40
    Then the pipeline disposition was "reject"
    And at least 20 messages were forwarded
    And the pipeline emitted guard events with reasons "rate:relay:publish"

  Scenario: port traffic is decided and a flood quarantines the window
    When the pipeline observes a port envelope of type "storage.get" from window "w1"
    Then the pipeline disposition was "dispatch"
    When the pipeline observes port envelopes of type "storage.get" from window "w1" until it quarantines, at most 400
    Then the pipeline disposition was "drop"
    And the quarantine callback named window "w1" and applet "chat"
    And window "w1" is quarantined
    When the pipeline releases window "w1"
    Then window "w1" is not quarantined

  Scenario: odd port payloads are classified as unknown and deletes by kind
    When the pipeline observes a port envelope that is not an object from window "w1"
    Then the pipeline disposition was "dispatch"
    When the pipeline observes a kind 5 "relay.publish" port envelope from window "w1"
    Then the pipeline disposition was "dispatch"

  Scenario: visibility for a window the pipeline has not met comes from the host
    Given the host reports window "w2" as hidden
    And pipeline window "w2" runs applet "notes"
    When a window message of type "relay.subscribe" arrives from window "w2"
    Then the pipeline disposition was "defer"
    And the pipeline reports window "w2" as hidden

  Scenario: a pipeline with default options still guards
    Given a kernl guard pipeline using the "strict" profile with default options
    And pipeline window "w1" runs applet "chat"
    When a window message of type "napplet.hello" arrives from window "w1"
    Then the pipeline disposition was "pass"

  Scenario: a hidden window's port traffic is held until it is visible, while its control messages pass
    Given pipeline window "w1" is hidden
    When the pipeline observes a port envelope of type "relay.subscribe" from window "w1"
    Then the pipeline disposition was "defer"
    And the pipeline emitted guard events with reasons "hidden:relay:subscribe"
    And the pipeline asked to release nothing
    When the pipeline observes a port envelope of type "theme.get" from window "w1"
    Then the pipeline disposition was "dispatch"
    When the pipeline marks window "w1" visible
    Then the pipeline asked to release window "w1"

  Scenario: a hidden window's port traffic is held with default options too
    Given a kernl guard pipeline using the "strict" profile with default options
    And pipeline window "w1" runs applet "chat"
    And pipeline window "w1" is hidden
    When the pipeline observes a port envelope of type "relay.subscribe" from window "w1"
    Then the pipeline disposition was "defer"
    When the pipeline marks window "w1" visible
    And the pipeline observes a port envelope of type "relay.subscribe" from window "w1"
    Then the pipeline disposition was "dispatch"

  Scenario: a hidden window cannot hold more port requests than the defer queue
    Given pipeline window "w1" is hidden
    When the pipeline observes 201 paced port envelopes of type "relay.subscribe" from window "w1"
    Then the pipeline disposition was "drop"
    And the pipeline emitted guard events with reasons "hidden:relay:subscribe,defer:queue-full"

  Scenario: a port burst above the per-second rate is dropped, but control is not
    When the pipeline observes 9 port envelopes of type "relay.subscribe" from window "w1"
    Then the pipeline disposition was "drop"
    And the pipeline emitted guard events with reasons "flood:burst"
    When the pipeline observes a port envelope of type "shell.ready" from window "w1"
    Then the pipeline disposition was "dispatch"

  Scenario: a port request over the firewall's budget is dropped
    When the pipeline observes 25 paced port envelopes of type "intent.invoke" from window "w1"
    Then the pipeline disposition was "drop"
    And the pipeline emitted guard events with reasons "rate:intent:invoke"

  Scenario: changing the profile rebuilds the layers but keeps visibility
    Given pipeline window "w1" is hidden
    When the pipeline profile is set to "relaxed"
    Then the pipeline profile is "relaxed"
    When a window message of type "relay.subscribe" arrives from window "w1"
    Then the pipeline disposition was "defer"

  Scenario Outline: the runtime firewall's reports are told in the guard's words, without the message
    When the runtime firewall reports rule "<rule>" with decision "<decision>" for "<runtime class>"
    Then the guard was told of a "<disposition>" of "<op class>" because "<reason>", and nothing else

    Examples:
      | rule         | decision | runtime class | disposition | op class        | reason             |
      | rate:opclass | reject   | state:write   | reject      | storage:write   | rate:storage:write |
      | burst        | reject   | relay:read    | reject      | relay:subscribe | flood:startup      |
      | policy:deny  | prompt   | made:up       | reject      | generic         | runtime:policy:deny |
      | matcher:big  | pass     | relay:write   | flag        | relay:publish   | runtime:matcher:big |
