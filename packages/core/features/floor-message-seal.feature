Feature: Floor: an applet that reads messages is sealed, whatever modules are loaded
  The domains that may go with messages are an allowlist. Any domain not on it,
  including one a module adds, is withheld from an applet that reads messages,
  unless the person keeps that one domain beside messages (D-046, D-060, D-061).
  Messages themselves come from the messaging module; the seal is the kernel's.

  Scenario: the allowlist is fixed
    Given a restrictive kehto ACL state in memory
    And kernl grants over empty storage offering "shell,inc,theme,identity,storage,config,notify,keys,intent,dm,relay,outbox,upload,webrtc,cvm,resource,link"
    Then the domains that may go with messages are "shell,dm,identity,theme,storage,config,notify,keys,intent"

  Scenario: a domain the shell has no words for yet is withheld
    Given a restrictive kehto ACL state in memory
    And kernl grants over empty storage offering "shell,inc,theme,identity,storage,config,notify,keys,intent,dm,relay,outbox,upload,webrtc,cvm,resource,link"
    When the shell allows "dm" for "chat"
    Then the resolver gives "chat" domains "shell,theme,storage,dm" and services "" from "shell,inc,theme,storage,dm,something-new" and "something-new"

  Scenario: handing a request on stays withheld, whatever is kept
    Given a restrictive kehto ACL state in memory
    And kernl grants over empty storage offering "shell,inc,theme,identity,storage,config,notify,keys,intent,dm,relay,outbox,upload,webrtc,cvm,resource,link"
    When the shell allows "dm" for "chat"
    And the shell allows "intent" for "chat"
    And the shell allows "upload" for "chat" beside messages
    Then the ACL allows "intent:read" for "chat"
    And the ACL denies "intent:write" for "chat"

  Scenario Outline: granting messages to a running applet that holds the network stops it
    Given the shell loads <modules>
    And a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"
    And a kernl shell over that host and pool
    And the shell <theme> "theme"
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the user also grants the mounted applet "dm"
    Then the host was told the window was revoked for "grant-narrowed"
    And the mounted frame was removed

    Examples:
      | modules                    | theme          |
      | kernl's modules            | offers         |
      | only the messaging module  | does not offer |
      | the example host's modules | does not offer |

  Scenario: a shell with no modules offers no messages, so no grant can seal an applet
    Given the shell loads no modules
    And a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"
    And a kernl shell over that host and pool
    Then the shell does not offer "dm"
