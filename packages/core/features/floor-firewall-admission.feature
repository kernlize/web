Feature: Floor: the firewall admits an applet before its code runs, whatever modules are loaded
  kehto's firewall is asked about every domain an applet holds when the plan is
  made, before any of its code runs. A module's domains are known by then, so
  modules are fixed when the shell is composed. A window the shell did not plan
  is never served (D-056, D-061).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario Outline: refusing a domain the applet requires refuses the start
    Given the shell loads <modules> modules
    And a kernl shell whose host answers firewall questions
    And the shell <theme> "theme"
    And the firewall rule for '{"domain":"relay"}' is set to "ask"
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    And the person answers the firewall question with "deny"
    Then planning failed with "denied:firewall"
    And the shell runtime holds no session for the planned window

    Examples:
      | modules | theme          |
      | kernl's | offers         |
      | no      | does not offer |
      | the example host's | does not offer |

  Scenario Outline: a plan whose answers were taken back cannot be mounted
    Given the shell loads <modules> modules
    And a kernl shell whose host answers firewall questions
    And the shell <theme> "theme"
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    And the plan is ready and offers "relay"
    And the person takes every firewall answer back
    Then mounting the plan fails with "denied:admission-expired"

    Examples:
      | modules | theme          |
      | kernl's | offers         |
      | no      | does not offer |
      | the example host's | does not offer |

  Scenario Outline: at most 16 plans wait unmounted
    Given the shell loads <modules> modules
    And a kernl shell whose host answers firewall questions
    And the shell <theme> "theme"
    And the applet is resolved and granted "relay"
    When the shell plans the applet 17 times without mounting
    Then mounting the first of those plans fails with "denied:admission-expired"

    Examples:
      | modules | theme          |
      | kernl's | offers         |
      | no      | does not offer |
      | the example host's | does not offer |

  Scenario Outline: a window the shell did not plan is never served
    Given the shell loads <modules> modules
    And a kernl shell over that host and pool
    And the shell <theme> "theme"
    And the shell is signed in
    When a rogue window registered outside the shell is granted "relay", sends its hello and publishes a kind 0 event
    Then the rogue window got no answer
    And the fake pool published nothing

    Examples:
      | modules | theme          |
      | kernl's | offers         |
      | no      | does not offer |
      | the example host's | does not offer |
