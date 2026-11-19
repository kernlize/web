Feature: Remote tools for applets
  An applet calls tools on remote servers through the shell. Each window calls
  under a key of its own, never the account's, and the key is wiped when the
  window ends (D-041). These scenarios run kehto's real transport over real
  sockets against a tool server on a loopback relay.

  Background:
    Given a loopback relay
    And a tool server "Trust fixture" on the loopback relay whose "trust_score" tool answers "0.87"
    And the remote tools service looks on the loopback relay

  Scenario: an applet finds the tool server and calls its tool
    When window "w1" looks for remote tools
    Then window "w1" finds "Trust fixture" offering "trust_score"
    When window "w1" calls "trust_score" on the tool server
    Then window "w1" gets the answer "0.87"
    And every request reached the server sealed for it alone

  Scenario: each window calls under its own key
    When window "w1" calls "trust_score" on the tool server
    And window "w2" calls "trust_score" on the tool server
    Then the tool server saw 2 different callers

  Scenario: what the server pushes to one window does not reach another
    When window "w1" calls "trust_score" on the tool server
    And window "w2" calls "trust_score" on the tool server
    And the tool server pushes a notice to the caller of window "w1"
    Then window "w1" receives the notice
    And window "w2" receives no notice

  Scenario: a closed window's key is wiped and its next use starts fresh
    When window "w1" calls "trust_score" on the tool server
    And window "w1" closes
    Then the key window "w1" called under is all zeros
    When window "w1" calls "trust_score" on the tool server
    Then the tool server saw 2 different callers

  Scenario: a tool server the applet names on its own relay is reached there
    Given a second loopback relay where the tool server also listens
    And the remote tools service looks on no relays
    When window "w1" calls "trust_score" on the tool server at the second relay
    Then window "w1" gets the answer "0.87"

  Scenario: unregistering the service closes every window and wipes every key
    When window "w1" calls "trust_score" on the tool server
    And the remote tools service is unregistered
    Then the key window "w1" called under is all zeros
