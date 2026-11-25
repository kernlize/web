Feature: Opening a stack
  A stack is a list of applet references. Opening one resolves and verifies every
  applet it names, each on its own, so an applet that is gone or unreachable does
  not stop the rest. The person then answers for the whole stack at once: one
  table of permissions, one row per domain, each row naming every applet in the
  stack that asks for it. Nothing is planned until that answer, and nothing in a
  stack is a grant by itself.

  Background:
    Given a preview kernl

  Scenario: every applet in a stack is looked up in the order it was listed, and none is planned yet
    When the shell looks up the preview stack "basics"
    Then the shell found 2 applets in order
    And the shell has not planned anything

  Scenario: installing a stack opens only the applets its publisher marked
    When the shell opens the applets the preview stack "basics" starts with
    Then the shell planned 1 applet
    And the shell installed "notes, profiles"

  Scenario: a stack with no marked entry points opens all of its applets
    When the shell opens the preview stack "basics"
    Then the shell planned 2 applets in order

  Scenario: opening a running stack member reuses its window without creating a waiting plan
    When the shell opens an already running preview stack member
    Then the opening reused its original plan

  Scenario: installing a stack without opening anything leaves every applet ready for a request
    When the shell installs the preview stack "basics" without opening anything
    Then the shell planned 0 applet
    And the shell installed 2 applets

  Scenario: an applet another applet asked for runs under existing grants only
    When the shell opens a preview applet for another applet
    Then the shell planned 1 applet
    And the shell wrote no new grants

  Scenario: an applet that cannot be looked up is counted, and the rest still open
    Given the preview stack "basics" names an applet the preview does not have
    When the shell opens the preview stack "basics"
    Then the shell planned 1 applet
    And the shell says "1 of 2 applets in Basics could not be opened."

  Scenario: a stack with nothing openable is reported as a whole
    Given the preview stack "basics" names only applets the preview does not have
    When the shell opens the preview stack "basics"
    Then the shell planned 0 applet
    And the shell says "None of the 2 applets in Basics could be opened."

  Scenario: a stack member keeps the relay hint its tag carried
    Given the preview stack "live" carries a relay hint
    When the shell opens the preview stack "live"
    Then the shell asked for the stack member's relay hint

  Scenario: one row per permission, naming every applet that asks for it
    When the shell asks for the preview stack "basics"
    Then the permission row "relay" names "Notes (needed)"
    And the permission row "notify" names "Notes, Profiles"
    And the permission row "identity" names "Notes (needed)"

  Scenario: what an applet needs starts on, and what it may use starts off
    When the shell asks for the preview stack "basics"
    Then the permission row "relay" is on and fixed
    And the permission row "notify" is off and free

  Scenario: switching a permission on for the stack grants it to each applet that asked
    When the shell asks for the preview stack "basics"
    And the shell switches the permission "notify" on
    Then the shell grants "notify" to "notes, profiles"

  Scenario: a permission one applet asked for is not granted to another
    When the shell asks for the preview stack "basics"
    And the shell switches the permission "config" on
    Then the shell grants "config" to "notes"

  Scenario: a domain another applet needs is not written for an applet that never asked for it
    When the shell asks for the preview stack "basics"
    And the shell confirms the stack
    Then the shell grants "identity" to "notes"

  Scenario: confirming a mixed row does not copy an existing grant to another applet
    Given the preview applet "notes" already holds "notify"
    When the shell asks for the preview stack "basics"
    And the shell confirms the stack
    Then the shell grants "identity" to "notes"
    And the shell has not written "notify"

  Scenario: what an applet may already hold is taken back when it is switched off
    Given the preview applet "notes" already holds "notify"
    When the shell asks for the preview stack "basics"
    And the shell switches the permission "notify" off
    Then the shell takes "notify" back from "notes"

  Scenario: a domain kept beside messages is granted as the exception it is
    Given a preview stack of an applet that reads messages and needs uploads
    When the shell switches the permission "upload" on
    Then the shell grants "upload" beside messages to "Notes"

  Scenario: a stack whose applets ask for nothing has no rows
    Given a preview stack of applets that ask for nothing
    Then the stack has no permission rows

  Scenario: a domain an applet already keeps beside messages is kept when the stack is opened
    Given the preview applet "notes" keeps "upload" beside messages
    When the shell asks for the preview stack "basics"
    Then the stack keeps "upload" beside messages

  Scenario: an applet that resolves but cannot be planned is counted, and the rest still open
    Given the preview applet "notes" cannot be opened
    When the shell opens the preview stack "basics"
    Then the shell planned 1 applet
    And the shell says "1 of 2 applets in Basics could not be opened."

  Scenario: a large stack mounts each applet before the shell admits the next
    Given a stack of 17 fresh applets
    When the person opens its applets
    Then all 17 applets open in stack order without leaving another admission waiting

  Scenario: a mount failure does not stop the rest of a stack
    Given a stack of 17 fresh applets
    And the first applet cannot mount
    When the person opens its applets
    Then the other 16 applets open in stack order
    And the shell says "1 of 17 applets in Large stack could not be opened."

  Scenario: reopening a running stack member that started under the stack's grants reuses its window
    Given the preview applet "notes" is running under the grants its stack offers
    When the shell confirms "notes" from its stack
    Then the stack window is reused and nothing new is planned

  Scenario: a permission the window did not start with replaces it
    Given the preview applet "notes" is running without its optional permissions
    When the shell confirms "notes" from its stack
    Then the stack window is not reused and its replacement is planned

  Scenario: a replacement that cannot mount leaves nothing granted for now behind
    When the shell confirms "notes" from its stack for now, and its replacement cannot mount
    Then the review fails with "denied:admission-expired"
    And the grants were held for now while the replacement was reviewed
    And "notes" is no longer granted for now in the preview kernl

  Scenario: a stack with no applets asks for nothing
    Then an empty stack asks for nothing
