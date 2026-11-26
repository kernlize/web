Feature: Floor: grants belong to the exact code, whatever modules are loaded
  An applet is known by its name and the hash of its verified bytes. Grants
  stay with that exact code; changed bytes start with none. No module can carry
  a grant from one build to another (SOUL §2, D-061).

  Background:
    Given a restrictive kehto ACL state in memory
    And kernl grants over empty storage offering "shell,inc,theme,identity,storage,relay,notify,resource"

  Scenario: what was granted to one build is not granted to the next
    When the shell allows "relay" for "chat"
    And the shell ensures grants for "chat" built from other code
    Then the ACL allows "relay:read" for "chat"
    And the ACL denies "relay:read" for "chat" built from other code
    And the grant record for "chat" built from other code has domains ""

  Scenario: the next build starts from the baseline only
    When the shell allows "identity" for "chat"
    And the shell ensures grants for "chat" built from other code
    Then the ACL allows "theme:read" for "chat" built from other code
    And the ACL denies "identity:read" for "chat" built from other code

  Scenario Outline: the composed shell plans changed bytes with nothing granted
    Given the shell loads <modules> modules
    And a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"
    And a kernl shell over that host and pool
    And the shell <theme> "theme"
    When the shell resolves the manifest address
    And the shell allows "relay" for the resolved applet
    And the shell plans the summary
    Then the shell plan is missing ""
    Given the pool serves a second build of "chat"
    When the shell resolves the manifest address
    And the shell plans the summary
    Then the shell plan is missing "relay"

    Examples:
      | modules | theme          |
      | kernl's | offers         |
      | no      | does not offer |
      | the example host's | does not offer |
