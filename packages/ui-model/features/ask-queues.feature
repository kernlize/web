Feature: Ask queues
  A host draws the kernel's questions one at a time. Each kind waits in a queue
  in arrival order; the one in front is what the host shows, and its answer
  goes back to the ask that raised it. A question whose window is revoked, or
  that the kernel withdraws, leaves the queue with its refusal (D-067). The
  queues are framework-free, so any UI binds to them.

  Scenario: questions wait in arrival order, and each answer goes to its own ask
    Given an ask queue for "sign.replace"
    When "sign.replace" is asked for window "w1" and for window "w2"
    Then the queue shows the ask for window "w1", with 1 waiting behind it
    When the person answers yes
    Then the ask for window "w1" was answered yes
    And the queue shows the ask for window "w2", with 0 waiting behind it
    When the person answers no
    Then the ask for window "w2" was answered no
    And the queue shows nothing

  Scenario: answering an empty queue does nothing
    Given an ask queue for "sign.replace"
    When the person answers yes
    Then the queue shows nothing

  Scenario: one queue can hold several kinds in one arrival order
    Given an ask queue for "sign.replace,upload.file"
    When "upload.file" is asked for window "w1" and "sign.replace" for window "w2"
    Then the queue shows the "upload.file" ask for window "w1", with 1 waiting behind it

  Scenario: a revoked window's questions leave with their refusal, and the others stay
    Given an ask queue for "sign.replace"
    When "sign.replace" is asked for window "w1" and for window "w2"
    And window "w1" is revoked
    Then the ask for window "w1" was answered no
    And the queue shows the ask for window "w2", with 0 waiting behind it
    And the queue holds no ask for window "w1"

  Scenario: a question the kernel withdraws leaves the queue with nothing for an answer
    Given an ask queue for "firewall.approve"
    When "firewall.approve" is asked for window "w1" with a signal
    And the kernel withdraws it
    Then the ask for window "w1" was answered with nothing
    And the queue shows nothing

  Scenario: a question answered before the kernel withdraws it keeps its answer
    Given an ask queue for "firewall.approve"
    When "firewall.approve" is asked for window "w1" with a signal
    And the person answers yes
    And the kernel withdraws it
    Then the ask for window "w1" was answered yes
    And the queue shows nothing

  Scenario: a question withdrawn before it was put in line never waits
    Given an ask queue for "firewall.approve"
    When "firewall.approve" is asked for window "w1" with a signal already aborted
    Then the ask for window "w1" was answered with nothing
    And the queue shows nothing

  Scenario: the queue's stream shows each change
    Given an ask queue for "sign.replace" that a UI watches
    When "sign.replace" is asked for window "w1" and for window "w2"
    And the person answers yes
    Then the UI saw the windows in front change "none,w1,w2"

  Scenario: the renderers put every kind in its queue, and draw nothing for a kind left out
    Given the ask queues for every kind
    Then the renderers made from them draw every kind
    And the renderers made from only the "sign.replace" queue draw only "sign.replace"
    When the "settings.present" renderer is asked for window "w1"
    Then the "settings.present" queue shows the ask for window "w1"

  Scenario: a renderer that is not Svelte draws the same queue and answers it
    Given an ask queue for "sign.replace" drawn by a plain text renderer
    When "sign.replace" is asked for window "w1" and for window "w2"
    Then the plain renderer shows "sign.replace for w1 (1 more)"
    When the plain renderer's "Allow" is pressed
    Then the ask for window "w1" was answered yes
    And the plain renderer shows "sign.replace for w2"
    When the plain renderer's "Deny" is pressed
    Then the plain renderer shows "nothing to answer"
