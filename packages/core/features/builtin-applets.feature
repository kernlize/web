Feature: Applets that come with the shell
  A host can ship an applet with itself and open it by name. No manifest is
  looked up: the bytes are pinned by hash in the host's own code, which is the
  trust the shell already rests on. A built-in applet still runs in the sealed
  frame, under grants the user can withdraw.

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: a name under the shell's own scheme is a built-in pointer
    When the shell decodes pointer " kernl:messages "
    Then the pointer is the built-in applet "messages"
    And the pointer has no relay hints

  Scenario: a name the scheme does not allow is not an address
    When the shell decodes pointer "kernl:Not A Name"
    Then the shell refused with "invalid:pointer"

  Scenario: a built-in applet opens without asking the network
    Given a kernl shell that ships the applet "messages" requiring "dm" and starting with "dm,identity"
    And the fake pool serves nothing
    When the shell resolves the address "kernl:messages"
    Then the shell summary is the built-in applet "messages" requiring "dm"
    And the shell summary takes "napplet:dm/open" with parameters "pubkey"
    And the shell summary takes "napplet:dm/list" with parameters ""
    When the shell plans the summary
    Then the shell plan is for window "applet-1" with domains "shell,storage,inc,theme,dm,identity"
    And the shell plan is missing ""
    And the shell lists "messages" as installed at "kernl:messages"

  Scenario: the domains it starts with are switched on once, and stay the user's to withdraw
    Given a kernl shell that ships the applet "messages" requiring "dm" and starting with "dm,identity"
    When the shell resolves the address "kernl:messages"
    And the shell revokes "identity" for the resolved applet
    And the shell resolves the address "kernl:messages"
    And the shell plans the summary
    Then the shell plan is for window "applet-1" with domains "shell,storage,inc,theme,dm"

  Scenario: a domain this shell cannot provide is not switched on
    Given a kernl shell that ships the applet "messages" requiring "dm" and starting with "dm,teleport"
    When the shell resolves the address "kernl:messages"
    And the shell plans the summary
    Then the shell plan is for window "applet-1" with domains "shell,storage,inc,theme,dm"

  Scenario: an applet shipped with no starting domains and no requests holds only the baseline
    Given a kernl shell that ships the bare applet "clock"
    When the shell resolves the address "kernl:clock"
    And the shell plans the summary
    Then the shell plan is for window "applet-1" with domains "shell,storage,inc,theme"

  Scenario: bytes that are not the pinned bytes are refused
    Given a kernl shell that ships the applet "messages" with a hash its bytes do not match
    When the shell resolves the address "kernl:messages"
    Then the shell refused with "invalid:artifact-hash"

  Scenario: a built-in applet whose file cannot be loaded is unavailable
    Given a kernl shell that ships the applet "messages" whose file cannot be loaded
    When the shell resolves the address "kernl:messages"
    Then the shell refused with "unavailable:blob"

  Scenario: a name the host does not ship is not an applet
    Given a kernl shell over that host and pool
    When the shell resolves the address "kernl:ghost"
    Then the shell refused with "invalid:pointer"

  Scenario: the host is asked which provider carries a reply
    Given a kernl shell whose host answers the reply question with "theirs", over memory backends for "private" and "legacy"
    When the shell logs in with a password account named "alice"
    And the shell enables messaging provider "private" and "legacy"
    And "bob" writes to the account through "legacy"
    And an applet's message to "bob" is sent through the shell's messaging
    Then the host was asked about a reply to "bob" from "Private messages" to "Legacy messages"
    And the message left through "legacy"
