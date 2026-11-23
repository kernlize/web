Feature: Floor: an applet that reads messages is sealed, whatever modules are loaded
  The domains that may go with messages are an allowlist. Any domain not on it,
  including one a module adds, is withheld from an applet that reads messages,
  unless the person keeps that one domain beside messages (D-046, D-060, D-061).

  Background:
    Given a restrictive kehto ACL state in memory
    And kernl grants over empty storage offering "shell,inc,theme,identity,storage,config,notify,keys,intent,dm,relay,outbox,upload,webrtc,cvm,resource,link"

  Scenario: the allowlist is fixed
    Then the domains that may go with messages are "shell,dm,identity,theme,storage,config,notify,keys,intent"

  Scenario: a domain the shell has no words for yet is withheld
    When the shell allows "dm" for "chat"
    Then the resolver gives "chat" domains "shell,theme,storage,dm" and services "" from "shell,inc,theme,storage,dm,something-new" and "something-new"

  Scenario: handing a request on stays withheld, whatever is kept
    When the shell allows "dm" for "chat"
    And the shell allows "intent" for "chat"
    And the shell allows "upload" for "chat" beside messages
    Then the ACL allows "intent:read" for "chat"
    And the ACL denies "intent:write" for "chat"
