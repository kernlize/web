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
