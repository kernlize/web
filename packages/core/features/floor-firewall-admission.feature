Feature: Floor: the firewall admits an applet before its code runs, whatever modules are loaded
  kehto's firewall is asked about every domain an applet holds when the plan is
  made, before any of its code runs. A module's domains are known by then, so
  modules are fixed when the shell is composed. A window the shell did not plan
  is never served (D-056, D-061).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: refusing a domain the applet requires refuses the start
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"domain":"relay"}' is set to "ask"
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    And the person answers the firewall question with "deny"
    Then planning failed with "denied:firewall"
    And the shell runtime holds no session for the planned window

  Scenario: a plan whose answers were taken back cannot be mounted
    Given a kernl shell whose host answers firewall questions
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    And the plan is ready and offers "relay"
    And the person takes every firewall answer back
    Then mounting the plan fails with "denied:admission-expired"

  Scenario: at most 16 plans wait unmounted
    Given a kernl shell whose host answers firewall questions
    And the applet is resolved and granted "relay"
    When the shell plans the applet 17 times without mounting
    Then mounting the first of those plans fails with "denied:admission-expired"

  Scenario: a window the shell did not plan is never served
    Given a kernl shell over that host and pool with fake bridges
    When a rogue window registered outside the shell is granted "resource", sends its hello, asks "resource.bytes" for "https://files.example/rogue.txt" and floods "storage.get"
    Then the fake bridges were asked for nothing
    And the rogue window got no answer
