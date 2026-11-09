Feature: Messaging registry
  The shell holds one registry of messaging providers. It enables and disables
  them, keeps them in the user's order, restores saved preferences as providers
  arrive, and hands out one composite backend for the dm service. The first
  enabled provider in the order is the default.

  Background:
    Given a messaging registry

  Scenario: a registered provider starts disabled
    When I register the messaging provider "private"
    Then the messaging provider list is "private"
    And messaging provider "private" is listed as disabled
    And messaging provider "private" is listed as available

  Scenario: registering the same provider id twice is rejected
    When I register the messaging provider "private"
    And I register the messaging provider "private"
    Then the messaging error is "invalid:duplicate-provider"

  Scenario: enabling an unknown provider is rejected
    When I enable messaging provider "ghost"
    Then the messaging error is "invalid:unknown-provider"

  Scenario: enabling an unavailable provider reports why
    Given messaging provider "ratchet" is unavailable because "no-ratchet-runtime"
    When I register the messaging provider "ratchet"
    And I enable messaging provider "ratchet"
    Then the messaging error is "unavailable:no-ratchet-runtime"
    And messaging provider "ratchet" is listed as unavailable because "no-ratchet-runtime"

  Scenario: enabling creates one backend and is idempotent
    When I register the messaging provider "private"
    And I enable messaging provider "private"
    And I enable messaging provider "private"
    Then messaging provider "private" is listed as enabled
    And the backend for messaging provider "private" was created 1 time
    And the messaging preferences are enabled "private" with default "private"
    And the messaging change listener fired 1 time

  Scenario: disabling closes the backend and leaves no default when nothing else is enabled
    When I register the messaging provider "private"
    And I enable messaging provider "private"
    And I set the default messaging provider to "private"
    And I disable messaging provider "private"
    Then messaging provider "private" is listed as disabled
    And the backend for messaging provider "private" is closed
    And the messaging preferences are enabled "" with no default
    And the messaging change listener fired 3 times

  Scenario: disabling keeps a default that points elsewhere
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And I enable messaging provider "private"
    And I enable messaging provider "legacy"
    And I set the default messaging provider to "private"
    And I disable messaging provider "legacy"
    Then the messaging preferences are enabled "private" with default "private"

  Scenario: disabling a provider that is not enabled changes nothing
    When I register the messaging provider "private"
    And I disable messaging provider "private"
    Then the messaging change listener fired 0 times

  Scenario: disabling an unknown provider is rejected
    When I disable messaging provider "ghost"
    Then the messaging error is "invalid:unknown-provider"

  Scenario: a backend without a close hook is disabled without error
    Given messaging provider "legacy" has a backend that cannot be closed
    When I register the messaging provider "legacy"
    And I enable messaging provider "legacy"
    And I disable messaging provider "legacy"
    And I close the messaging registry
    Then messaging provider "legacy" is listed as disabled

  Scenario: the default must be an enabled provider
    When I register the messaging provider "private"
    And I set the default messaging provider to "private"
    Then the messaging error is "invalid:provider-not-enabled"

  Scenario: preferences are frozen snapshots
    When I register the messaging provider "private"
    And I enable messaging provider "private"
    Then the messaging preferences snapshot is frozen

  Scenario: looking providers up by id
    When I register the messaging provider "private"
    Then messaging registry lookup of "private" returns the provider
    And messaging registry lookup of "ghost" returns nothing

  Scenario: the composite backend is one stable instance over the enabled providers
    When I register the messaging provider "private"
    And I enable messaging provider "private"
    And I set the default messaging provider to "private"
    And I send "hi" to "bob" with the registry composite
    Then the messaging registry composite is the same instance on every call
    And the composite send result has id "private:msg-1" in conversation "private:direct:bob"

  Scenario: closing the registry closes every backend and keeps the preferences
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And I enable messaging provider "private"
    And I enable messaging provider "legacy"
    And I close the messaging registry
    Then the backend for messaging provider "private" is closed
    And the backend for messaging provider "legacy" is closed
    And the messaging preferences are enabled "private, legacy" with default "private"

  Scenario: a registry without options or listener still works
    Given a bare messaging registry
    When I register the messaging provider "private"
    And I enable messaging provider "private"
    And I set the default messaging provider to "private"
    Then the messaging preferences are enabled "private" with default "private"

  Scenario: saved preferences enable providers as they register
    Given a messaging registry restoring enabled "private, legacy" with default "legacy"
    When I register the messaging provider "private"
    Then the messaging preferences are enabled "private" with default "private"
    When I register the messaging provider "legacy"
    Then the messaging preferences are enabled "legacy, private" with default "legacy"
    And the messaging change listener fired 2 times

  Scenario: a saved provider that cannot run yet waits, and is not forgotten
    Given a messaging registry restoring enabled "ratchet" with default "ratchet"
    And messaging provider "ratchet" is unavailable because "no-ratchet-runtime"
    When I register the messaging provider "ratchet"
    Then messaging provider "ratchet" is listed as disabled
    And messaging provider "ratchet" is listed as unavailable because "no-ratchet-runtime"
    And the messaging preferences are enabled "ratchet" with no default
    And the messaging change listener fired 0 times

  Scenario: a waiting provider starts as soon as it can run
    Given a messaging registry restoring enabled "private, legacy" with default "private"
    And messaging provider "private" is unavailable because "sign-in-required"
    And messaging provider "legacy" is unavailable because "sign-in-required"
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And messaging provider "legacy" becomes available
    Then messaging provider "legacy" is listed as enabled
    And messaging provider "private" is listed as disabled
    And the messaging preferences are enabled "private, legacy" with default "legacy"
    And the backend for messaging provider "legacy" was created 1 time
    And the messaging change listener fired 1 time
    When messaging provider "private" becomes available
    And I send "hi" to "bob" with the registry composite
    Then the composite send result has id "private:msg-1" in conversation "private:direct:bob"

  Scenario: switching off a provider that is still waiting forgets it
    Given a messaging registry restoring enabled "private" with no default
    And messaging provider "private" is unavailable because "sign-in-required"
    When I register the messaging provider "private"
    And I disable messaging provider "private"
    And messaging provider "private" becomes available
    Then messaging provider "private" is listed as disabled
    And the messaging preferences are enabled "" with no default
    And the messaging change listener fired 1 time

  Scenario: switching on a waiting provider by hand, once it can run, stops the wait
    Given a messaging registry restoring enabled "private" with no default
    And messaging provider "private" is unavailable because "sign-in-required"
    When I register the messaging provider "private"
    And messaging provider "private" becomes available without the registry being read
    And I enable messaging provider "private"
    Then the backend for messaging provider "private" was created 1 time
    And messaging provider "private" is listed as enabled
    And the messaging preferences are enabled "private" with default "private"

  Scenario: providers outside the saved list stay disabled
    Given a messaging registry restoring enabled "private" with no default
    When I register the messaging provider "legacy"
    Then messaging provider "legacy" is listed as disabled
    And the messaging change listener fired 0 times

  Scenario: an explicit default replaces the saved one
    Given a messaging registry restoring enabled "private, legacy" with default "legacy"
    When I register the messaging provider "private"
    And I set the default messaging provider to "private"
    And I register the messaging provider "legacy"
    Then the messaging preferences are enabled "private, legacy" with default "private"

  Scenario: providers are listed in the order they were registered until the user says otherwise
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And I register the messaging provider "ratchet"
    Then the messaging provider list is "private, legacy, ratchet"
    And the messaging provider order is "private, legacy, ratchet"

  Scenario: the user reorders the providers
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And I register the messaging provider "ratchet"
    And I order the messaging providers "ratchet, private, legacy"
    Then the messaging provider list is "ratchet, private, legacy"
    And the messaging change listener fired 1 time

  Scenario: providers left out of a new order keep their place after the ones named
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And I register the messaging provider "ratchet"
    And I order the messaging providers "ratchet, ratchet"
    Then the messaging provider order is "ratchet, private, legacy"

  Scenario: an order that names an unknown provider is rejected
    When I register the messaging provider "private"
    And I order the messaging providers "ghost, private"
    Then the messaging error is "invalid:unknown-provider"
    And the messaging provider order is "private"

  Scenario: the default is the first provider in the order that is enabled
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And I enable messaging provider "private"
    And I order the messaging providers "legacy, private"
    Then the messaging preferences are enabled "private" with default "private"
    When I enable messaging provider "legacy"
    Then the messaging preferences are enabled "legacy, private" with default "legacy"

  Scenario: making a provider the default moves it to the top
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And I enable messaging provider "legacy"
    And I set the default messaging provider to "legacy"
    Then the messaging provider order is "legacy, private"

  Scenario: a saved order is restored, and a provider it does not name joins the end
    Given a messaging registry restoring the order "ratchet, legacy"
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    And I register the messaging provider "ratchet"
    Then the messaging provider order is "ratchet, legacy, private"

  Scenario: preferences saved before there was an order start with their default on top
    Given a messaging registry restoring enabled "private, legacy" with default "legacy"
    When I register the messaging provider "private"
    And I register the messaging provider "legacy"
    Then the messaging provider order is "legacy, private"
