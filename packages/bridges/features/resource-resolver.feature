Feature: Resource resolver
  The registry is offered to a resource service as a single fetch-shaped function.

  Background:
    Given a bridge registry
    And the fake bridge "alpha" serving "magnet" is registered
    And the fake bridge "web" serving "https" is registered

  Scenario: byte results are returned as the response
    Given the fake bridge "web" answers with bytes "hello"
    And a resource resolver over the registry
    When the resolver fetches "https://example.com/hello.txt"
    Then the resolved response status is 200
    And the resolved response body is "hello"

  Scenario: job results become an accepted description
    Given a resource resolver over the registry
    When the resolver fetches a valid magnet link
    Then the resolved response status is 202
    And the resolved response JSON has kind "job" and label "alpha"

  Scenario: conversation results become an accepted description
    Given the fake bridge "alpha" answers with a conversation
    And a resource resolver over the registry
    When the resolver fetches a valid magnet link
    Then the resolved response status is 202
    And the resolved response JSON has kind "conversation"

  Scenario: the requester defaults to the shell
    Given a resource resolver over the registry
    When the resolver fetches a valid magnet link
    Then the bridge saw requester "shell"

  Scenario: the requester can be derived from the init
    Given a resource resolver over the registry deriving the requester from the init
    When the resolver fetches a valid magnet link with window "w1"
    Then the bridge saw requester "applet:w1"

  Scenario: a requester named in the init wins
    Given a resource resolver over the registry deriving the requester from the init
    When the resolver fetches a valid magnet link as applet "notes"
    Then the bridge saw requester "applet:notes"

  Scenario: signal and headers reach the bridge
    Given a resource resolver over the registry
    When the resolver fetches a valid magnet link with a signal and header "accept" set to "*/*"
    Then the bridge saw the signal and header "accept" set to "*/*"

  Scenario: failures reject with their prefixed reason
    Given a resource resolver over the registry
    When the resolver fetches "ftp://files.example/x"
    Then the resolver fails with "unavailable:no-bridge"
