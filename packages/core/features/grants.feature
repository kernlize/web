Feature: Grants
  A grant is something the user gave and can take back. Every applet starts
  with the read-only, no-network baseline, which does not include the signed-in
  account. The runtime ACL is restrictive, so an applet holds nothing the
  grants layer did not write (D-020).

  Background:
    Given a restrictive kehto ACL state in memory
    And kernl grants over empty storage offering "shell,inc,theme,identity,storage,relay,notify,resource"

  Scenario: the baseline is read-only and offline
    Then the baseline domains are "shell,inc,theme,storage"
    And the available domains are "shell,inc,theme,identity,storage,relay,notify,resource"
    And the grants list is empty
    And there is no grant record for "chat"

  Scenario: ensuring an applet writes the baseline into the ACL and nothing more
    When the shell ensures grants for "chat"
    Then the grant record for "chat" has domains "" and is not blocked
    And the grant record for "chat" has capabilities "state:read,state:write,theme:read"
    And the ACL allows "theme:read" for "chat"
    And the ACL denies "identity:read" for "chat"
    And the ACL denies "relay:read" for "chat"
    And the ACL denies "relay:write" for "chat"
    And 1 grant changes were observed

  Scenario: an applet the shell never ran holds nothing
    Then the ACL denies "theme:read" for "stranger"
    And the ACL denies "relay:read" for "stranger"

  Scenario: an ACL entry from an earlier posture is narrowed to the record
    Given the ACL already grants "relay:read" to "chat"
    When the shell ensures grants for "chat"
    Then the ACL denies "relay:read" for "chat"
    And the ACL allows "theme:read" for "chat"

  Scenario: allowing a domain grants its capabilities
    When the shell allows "relay" for "chat"
    Then the grant record for "chat" has domains "relay" and is not blocked
    And the ACL allows "relay:read" for "chat"
    And the ACL allows "relay:write" for "chat"
    And the ACL denies "notify:send" for "chat"
    And storage key "kernl:grants:v1" records "relay" for "chat"
    When the shell allows "relay" for "chat"
    Then 1 grant changes were observed

  Scenario: a baseline domain is already granted and an unknown domain is refused
    When the shell allows "theme" for "chat"
    Then 0 grant changes were observed
    When the shell allows "llm" for "chat"
    Then the shell refused with "invalid:domain"

  Scenario: revoking a domain takes its capabilities away at once
    Given the shell allows "relay" for "chat"
    When the shell revokes "relay" for "chat"
    Then the grant record for "chat" has domains "" and is not blocked
    And the ACL denies "relay:write" for "chat"
    When the shell revokes "relay" for "chat"
    Then 2 grant changes were observed

  Scenario: an applet learns which account is signed in only after the user grants it
    When the shell ensures grants for "chat"
    Then the ACL denies "identity:read" for "chat"
    And the resolver gives "chat" domains "shell,inc,theme,storage" and services "theme" from "shell,inc,theme,identity,storage,relay" and "theme"
    When the shell allows "identity" for "chat"
    Then the ACL allows "identity:read" for "chat"
    And the resolver gives "chat" domains "shell,inc,theme,identity,storage" and services "theme" from "shell,inc,theme,identity,storage,relay" and "theme"
    When the shell revokes "identity" for "chat"
    Then the ACL denies "identity:read" for "chat"

  Scenario: the baseline cannot be revoked
    When the shell revokes "storage" for "chat"
    Then the shell refused with "denied:baseline-domain"

  Scenario: blocking an applet denies everything until unblocked
    Given the shell allows "relay" for "chat"
    When the shell blocks "chat"
    Then the grant record for "chat" has domains "relay" and is blocked
    And the ACL denies "theme:read" for "chat"
    When the shell unblocks "chat"
    Then the grant record for "chat" has domains "relay" and is not blocked
    And the ACL allows "theme:read" for "chat"

  Scenario: the storage quota is set on the ACL and reported
    When the shell sets the state quota for "chat" to 4096 bytes
    Then the grant record for "chat" has a state quota of 4096 bytes
    And 1 grant changes were observed

  Scenario: records survive a restart
    Given the shell allows "relay" for "chat"
    And the shell blocks "other"
    When kernl grants are created again over the same storage
    Then the grants list names "chat,other"
    And the grant record for "other" has domains "" and is blocked

  Scenario: the environment resolver narrows what kehto advertises
    Given the shell allows "relay" for "chat"
    And the shell blocks "other"
    Then the resolver gives "chat" domains "shell,inc,theme,storage,relay" and services "relay,theme" from "shell,inc,theme,identity,storage,relay,notify,resource" and "relay,theme,notify"
    And the resolver gives "unknown" domains "shell,inc,theme,storage" and services "theme" from "shell,inc,theme,identity,storage,relay,notify,resource" and "relay,theme,notify"
    And the resolver gives "other" domains "shell" and services "" from "shell,inc,theme,identity,storage,relay,notify,resource" and "relay,theme,notify"

  Scenario: the domain table is explicit
    Then the capabilities for domain "relay" are "relay:read,relay:write"
    And the capabilities for domain "shell" are ""
    And the capabilities for domain "made-up" are ""
    And the capabilities for domains "storage,dm" are "state:read,state:write,dm:read,dm:write"
