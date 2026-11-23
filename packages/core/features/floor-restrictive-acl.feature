Feature: Floor: an applet holds only what the person granted, whatever modules are loaded
  The runtime ACL is restrictive. An applet starts with the read-only,
  no-network baseline and holds nothing the grants layer did not write. A
  module adds domains to offer; it never grants one (D-020, D-061).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: an applet nobody granted anything is refused the network
    Given a kernl shell over that host and pool
    Then the runtime ACL refuses "relay:read" to an applet the user never granted anything

  Scenario: a required domain nobody granted is missing from the plan
    Given a kernl shell over that host and pool
    When the shell resolves the manifest address
    And the shell plans the summary
    Then the shell plan is for window "applet-1" with domains "shell,storage,inc,theme,keys"
    And the shell plan is missing "relay"

  Scenario: the signed-in identity is not shown until it is granted
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet
    When the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet asks "identity.getPublicKey" over its port
    Then the applet received no "identity.getPublicKey.result"

  Scenario: a blocked applet is refused before it is planned
    Given a kernl shell over that host and pool
    When the shell resolves the manifest address
    And the shell blocks the resolved applet
    And the shell tries to plan the summary
    Then the shell refused with "denied:blocked"
