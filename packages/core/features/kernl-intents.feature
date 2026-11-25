Feature: Intents in the composed shell
  The shell offers the intent domain. Every applet it plans is installed, so
  other applets can hand it work; the sender of a request is always the verified
  identity of the window it came from. An accepted request reaches the target
  through the runtime once the target can receive it, and the user hears about a
  request that could not be delivered after the asking applet was told yes.

  Background:
    Given a kernl shell that can open applets, with "chat" asking for "intent" and "profiles" taking "profile" requests

  Scenario: the shell offers intents and lists the store from its relays
    Then the shell offers the "intent" domain
    When the shell lists the store
    Then the store lists "Profiles,Chat"
    When the shell streams the store
    Then the store lists "Profiles,Chat"

  Scenario: the shell lists the stacks over its own pool
    Given the fake pool serves stacks "mesh,games"
    When the shell lists the stacks
    Then the shell stack list is "games,mesh"
    When the shell streams the stacks
    Then the shell stack list is "games,mesh"

  Scenario: planning installs an applet, and only verified applets can be installed
    When the shell resolves and plans "profiles"
    Then the shell's installed applets are "Profiles"
    And installing an applet the shell did not verify is refused with "invalid:unresolved"
    When the shell installs "chat" without opening it
    Then the shell's installed applets are "Profiles,Chat"
    When the shell uninstalls "Profiles"
    Then the shell's installed applets are "Chat"

  Scenario: one applet asks, the other receives, and the sender is the asking window's identity
    Given "profiles" is installed and running with "intent" granted
    And "chat" is running with "intent" granted
    When "chat" asks who can take "profile"
    Then "chat" hears that "Profiles" can "open"
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then "chat" was told the request was accepted by "profiles"
    And "profiles" received "profile/open" from "chat" with pubkey "abc"
    And the host brought "profiles" forward

  Scenario: a connected hidden handler receives a no-focus request in Stacked
    Given "profiles" is installed and running with "intent" granted
    And "chat" is running with "intent" granted
    And the host puts "chat" in front in Stacked
    When "chat" invokes "napplet:profile/open?pubkey=abc" with a no-focus hint
    Then "chat" was told the request was accepted by "profiles"
    And "profiles" received "profile/open" from "chat" with pubkey "abc"
    And only "chat" is shown and focused in the stack

  Scenario: a fresh hidden handler stays behind and its handshake waits for visibility
    Given "profiles" is installed with "intent" granted
    And "chat" is running with "intent" granted
    And the host puts "chat" in front in Stacked
    When "chat" invokes "napplet:profile/open?pubkey=abc" with a no-focus hint
    Then the host was asked to open "profiles"
    And "chat" was told the request was accepted by "profiles"
    And only "chat" is shown and focused in the stack
    And the user was told "Profiles could not take the request" and asked to show it before retrying
    And "profiles" received no intent
    When the person brings "profiles" forward and returns to "chat"
    And "chat" invokes "napplet:profile/open?pubkey=def" with a no-focus hint
    Then "profiles" received "profile/open" from "chat" with pubkey "def"
    And only "chat" is shown and focused in the stack

  Scenario: a request nothing installed can take goes to the user's chooser, naming the asking applet
    Given "chat" is running with "intent" granted
    When the user removes "Chat" while it runs
    And "chat" invokes "napplet:note/open?id=n1"
    Then the chooser was asked about "note/open" from "An applet" with no installed options
    And "chat" was told the request was refused with "no handler"

  Scenario: a handler that is not running is opened by the host and then receives
    Given "profiles" is installed with "intent" granted
    And "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then the host was asked to open "profiles"
    And "profiles" received "profile/open" from "chat" with pubkey "abc"

  Scenario: waking an installed handler is not a grant
    When the shell installs "profiles" without opening it
    Given "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then the host was asked to open "profiles"
    And the user was told "Profiles could not take the request" because it needs the receiving grant

  Scenario: a retry reaches the copy the user opened with the receiving grant
    When the shell installs "profiles" without opening it
    Given "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then the user was told "Profiles could not take the request" because it needs the receiving grant
    When the user opens another copy of "profiles" with the receiving grant
    And "chat" invokes "napplet:profile/open?pubkey=def"
    Then "profiles" received "profile/open" from "chat" with pubkey "def"
    And both copies of "profiles" are still open and only the latest received the request
    And the host brought "profiles" forward
    And the host was asked to open "profiles"

  Scenario: the shell reuses the release that declares the requested convention
    Given "profiles" is running with "intent" granted
    When its publisher releases "profiles" taking "napplet:profile/edit"
    And the user opens another copy of "profiles" with the receiving grant
    Given "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/edit?pubkey=abc"
    Then "profiles" received "profile/edit" from "chat" with pubkey "abc"
    And both copies of "profiles" are still open and only the latest received the request
    And the host brought "profiles" forward

  Scenario: a release opened on demand must still declare the requested convention
    Given "profiles" is installed with "intent" granted
    When its publisher releases "profiles" taking "napplet:profile/edit"
    Given the user grants "intent" to the new release of "profiles"
    And "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then the host was asked to open "profiles"
    And the user was told "Profiles could not take the request" because that release does not take it
    And "profiles" did not receive the request

  Scenario: a handler without the receiving grant is reported to the user
    Given "profiles" is installed and running without the receiving grant
    And "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then "chat" was told the request was accepted by "profiles"
    And the user was told "Profiles could not take the request" because it needs the receiving grant

  Scenario: a shell that cannot open windows reports the handler could not be opened
    Given a kernl shell that cannot open applets, with "chat" asking for "intent" and "profiles" taking "profile" requests
    And "profiles" is installed with "intent" granted
    And "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then the user was told "Profiles could not take the request" because it could not be opened

  Scenario: the host failing while it opens a handler is reported plainly
    Given the host fails when it opens an applet
    And "profiles" is installed with "intent" granted
    And "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then the user was told "Profiles could not take the request" because it could not be reached

  Scenario: a handler closed before its session is ready does not receive a request
    Given "profiles" is installed with "intent" granted
    And a handler opened by the host closes before it can receive a request
    And "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then the host was asked to open "profiles"
    And the user was told "Profiles could not take the request"
    And "profiles" did not receive the request

  Scenario: a handler removed before delivery is reported plainly
    Given "profiles" is installed with "intent" granted
    And the host removes "Profiles" when it is asked to open it
    And "chat" is running with "intent" granted
    When "chat" invokes "napplet:profile/open?pubkey=abc"
    Then the user was told "An applet could not take the request" because it could not be opened

  Scenario: with sharing on, a choice is published by the signed-in account and never by anyone else
    When the shell logs in with a password account named "alice"
    And the user shares their choices and makes "profiles" the default for "profile"
    Then the account published its choice for "profile"
    When the shell logs in with a read-only account
    And the user makes "profiles" the default for "profile" again
    And the shell logs out
    And the user makes "profiles" the default for "profile" again
    Then the account published 1 choice

  Scenario: the signed-in account's handler preferences are read when it signs in
    When the shell logs in with a password account named "alice"
    Then the shell asked the public relays for the account's handler preferences
