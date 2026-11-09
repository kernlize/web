Feature: Looking an applet up over real connections
  The other resolve scenarios script the pool. These dial local relays and a
  local blob server through the real applesauce pool and the default blob
  fetcher, so what the launcher does with an address is exercised end to end:
  decode, ask the relays, download, verify. The relays an address names and
  the apps tier are asked first; the general relays are asked when those do
  not produce the applet.

  Background:
    Given a local blob server
    And a signed "feed" manifest served from the local blob server

  Scenario: an address with relay hints opens from a live shell
    Given a local relay "catalogue" that holds the manifest
    And a live kernl shell whose apps tier is "catalogue"
    When the live shell resolves the address hinting "catalogue"
    Then the live summary is "feed" with the artifact hash
    And the local blob server was asked for the artifact

  Scenario: the same address pasted as a link opens too
    Given a local relay "catalogue" that holds the manifest
    And a live kernl shell whose apps tier is "catalogue"
    When the live shell resolves the address hinting "catalogue" pasted as a link
    Then the live summary is "feed" with the artifact hash

  Scenario: a hinted relay that is down does not stop the lookup
    Given a local relay "catalogue" that holds the manifest
    And a relay address "dead" where nothing listens
    And a live kernl shell whose apps tier is "catalogue"
    When the live shell resolves the address hinting "dead,catalogue"
    Then the live summary is "feed" with the artifact hash

  Scenario: a blob server that is down is skipped for the next one
    Given a local relay "catalogue" that holds the manifest
    And the manifest also names a blob server where nothing listens, first
    And a live kernl shell whose apps tier is "catalogue"
    When the live shell resolves the address hinting "catalogue"
    Then the live summary is "feed" with the artifact hash

  Scenario: a hint that is not a relay address is ignored
    Given a local relay "catalogue" that holds the manifest
    When the manifest is looked up over real connections from "not a relay,https://web.example,catalogue"
    Then the looked-up manifest is the signed one

  Scenario: a quick relay with nothing to say does not hide a slower catalogue
    Given a local relay "general" that holds nothing
    And a local relay "catalogue" that holds the manifest and answers after 3300 ms
    When the manifest is looked up over real connections from "general,catalogue"
    Then the looked-up manifest is the signed one

  Scenario: a relay that never answers does not hold the lookup once the manifest is in
    Given a local relay "catalogue" that holds the manifest
    And a local relay "silent" that never answers
    When the manifest is looked up over real connections from "silent,catalogue" settling after 50 ms
    Then the looked-up manifest is the signed one
    And the lookup took under 2000 ms

  Scenario: a relay that hangs up on every connection does not stop the lookup
    Given a local relay "catalogue" that holds the manifest
    And a local relay "flaky" that hangs up on every connection
    When the manifest is looked up over real connections from "flaky,catalogue" settling after 50 ms
    Then the looked-up manifest is the signed one
    And the lookup took under 2000 ms

  Scenario: a relay with nothing beside one that hangs up means no such applet, once patience runs out
    Given a local relay "general" that holds nothing
    And a local relay "flaky" that hangs up on every connection
    When the manifest is looked up over real connections from "flaky,general" with patience of 100 ms
    Then the shell refused with "unavailable:manifest"
    And the lookup took under 2000 ms

  Scenario: relays that only hang up are a network problem, said before the person gives up
    Given a local relay "flaky" that hangs up on every connection
    When the manifest is looked up over real connections from "flaky" timing out after 400 ms
    Then the shell refused with "unavailable:network"
    And the lookup took under 2000 ms

  Scenario: the newest release wins across relays
    Given a local relay "stale" that holds an older release of the manifest
    And a local relay "catalogue" that holds the manifest
    When the manifest is looked up over real connections from "stale,catalogue"
    Then the looked-up manifest is the signed one

  Scenario: relays that answer without the manifest mean there is no such applet
    Given a local relay "general" that holds nothing
    When the manifest is looked up over real connections from "general"
    Then the shell refused with "unavailable:manifest"

  Scenario: every relay being down is a network problem, not a missing applet
    Given a relay address "dead" where nothing listens
    And a relay address "gone" where nothing listens
    When the manifest is looked up over real connections from "dead,gone"
    Then the shell refused with "unavailable:network"

  Scenario: an applet the catalogue does not hold is found on the general relays
    Given a local relay "catalogue" that holds nothing
    And a local relay "general" that holds the manifest
    When the manifest is looked up over real connections from "catalogue" falling back to "general"
    Then the looked-up manifest is the signed one

  Scenario: an applet is found on the general relays when the address's relays are all down
    Given a relay address "dead" where nothing listens
    And a local relay "flaky" that hangs up on every connection
    And a local relay "general" that holds the manifest
    When the manifest is looked up over real connections from "dead,flaky" falling back to "general" timing out after 400 ms
    Then the looked-up manifest is the signed one
    And the lookup took under 2000 ms

  Scenario: a general relay already asked is not asked twice
    Given a local relay "general" that holds nothing
    When the manifest is looked up over real connections from "general" falling back to "general"
    Then the shell refused with "unavailable:manifest"
    And the local relay "general" was asked 1 time

  Scenario: general relays with nothing, after relays that were down, mean no such applet
    Given a relay address "dead" where nothing listens
    And a local relay "general" that holds nothing
    When the manifest is looked up over real connections from "dead" falling back to "general"
    Then the shell refused with "unavailable:manifest"

  Scenario: a live shell falls back to its general relays
    Given a local relay "catalogue" that holds nothing
    And a local relay "general" that holds the manifest
    And a live kernl shell whose apps tier is "catalogue" and whose general relays are "general"
    When the live shell resolves the address hinting ""
    Then the live summary is "feed" with the artifact hash

  Scenario: an address with no usable relay at all has nowhere to look
    When the manifest is looked up over real connections from "not a relay"
    Then the shell refused with "unavailable:manifest"
