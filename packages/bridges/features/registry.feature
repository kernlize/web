Feature: Bridge registry
  The registry owns every bridge, routes a locator to the bridge that serves its scheme,
  runs the consent hook, and reports every outcome.

  Background:
    Given a bridge registry

  Scenario: registered bridges are listed and found by scheme
    When the fake bridge "alpha" serving "magnet" is registered
    And the fake bridge "beta" serving "nzb" is registered
    Then the registry lists "alpha, beta"
    And the bridge for scheme "magnet" is "alpha"
    And the bridge for scheme "NZB:" is "beta"
    And there is no bridge for scheme "slsk"

  Scenario: a bridge id can be registered once
    When the fake bridge "alpha" serving "magnet" is registered
    And the fake bridge "alpha" serving "nzb" is registered
    Then registration fails with "invalid:duplicate-bridge alpha"

  Scenario: a scheme belongs to one bridge
    When the fake bridge "alpha" serving "magnet" is registered
    And the fake bridge "beta" serving "MAGNET:" is registered
    Then registration fails with "invalid:scheme-taken magnet"
    And the registry lists "alpha"

  Scenario: a string that is not a locator is rejected and reported
    When the registry resolves "nonsense"
    Then resolution fails with "invalid:locator"
    And the registry reported bridge "none" scheme "" with "invalid:locator"

  Scenario: a scheme no bridge serves is unavailable
    When the registry resolves "ftp://files.example/x"
    Then resolution fails with "unavailable:no-bridge"
    And the registry reported bridge "none" scheme "ftp" with "unavailable:no-bridge"

  Scenario: an unavailable bridge is reported with its reason
    Given the fake bridge "alpha" serving "magnet" is registered
    And the fake bridge "alpha" is unavailable because "no-backend"
    When the registry resolves a valid magnet link
    Then resolution fails with "unavailable:no-backend"
    And the registry reported bridge "alpha" scheme "magnet" with "unavailable:no-backend"

  Scenario: the consent hook can deny
    Given a bridge registry whose consent hook denies
    And the fake bridge "alpha" serving "magnet" is registered
    When the registry resolves a valid magnet link
    Then resolution fails with "denied:bridge"
    And the registry reported bridge "alpha" scheme "magnet" with "denied:bridge"

  Scenario: the consent hook can allow asynchronously
    Given a bridge registry whose consent hook allows after a tick
    And the fake bridge "alpha" serving "magnet" is registered
    When the registry resolves a valid magnet link
    Then resolution yields a job labelled "alpha"
    And the registry reported bridge "alpha" scheme "magnet" as ok
    And the consent hook saw bridge "alpha" and scheme "magnet"

  Scenario: without a consent hook every request proceeds
    Given the fake bridge "alpha" serving "magnet" is registered
    When the registry resolves a valid magnet link
    Then resolution yields a job labelled "alpha"

  Scenario: a bridge failure is reported and rethrown
    Given the fake bridge "alpha" serving "magnet" is registered
    And the fake bridge "alpha" fails with "unavailable:engine-offline"
    When the registry resolves a valid magnet link
    Then resolution fails with "unavailable:engine-offline"
    And the registry reported bridge "alpha" scheme "magnet" with "unavailable:engine-offline"

  Scenario: a bridge failure that is not an Error is reported as text
    Given the fake bridge "alpha" serving "magnet" is registered
    And the fake bridge "alpha" fails with a bare string
    When the registry resolves a valid magnet link
    Then the registry reported bridge "alpha" scheme "magnet" with "boom"
