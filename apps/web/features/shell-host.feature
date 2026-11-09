Feature: The shell host
  The UI's side of the contract: where state is kept, how the user is asked,
  how links leave the shell and how a stopped applet is explained.

  Scenario: the browser's storage is used when it accepts a probe
    Given the shell host storage is the browser storage
    Then the shell host uses the browser storage after probing it

  Scenario: a browser that refuses storage gets a page-lifetime store
    Given the shell host storage is refused by the browser
    Then the shell host keeps "theme" as "dark" for the page only

  Scenario: consent, notices and visibility go to the UI stores
    Given the shell host with window "w1" titled "Notes"
    Then the shell host forwards consent, notices and visibility for window "w1"

  Scenario: requests between applets reach the chooser, the desktop and the window manager
    Given the shell host with window "w1" titled "Notes"
    Then the shell host asks the chooser, opens applets through the desktop once it can, and brings windows forward

  Scenario: a link opens only after the user agrees
    Given the shell host with window "w1" titled "Notes"
    When the shell host is asked to open "https://example.org" and the user says "no"
    Then the shell host asked before opening "https://example.org"
    And the shell host opened nothing
    When the shell host is asked to open "https://example.org" and the user says "yes"
    Then the shell host opened "https://example.org" in a new, unlinked tab

  Scenario Outline: a stopped applet is explained in plain words
    Given the shell host with window "w1" titled "Notes"
    When the shell host hears window "<window>" was revoked for "<reason>"
    Then the shell host warns "<title>" because "<words>" for window "<window>"

    Examples:
      | window | reason     | title                  | words                                                    |
      | w1     | quarantine | Notes was stopped      | The guard stopped it because it kept flooding the shell. |
      | w1     | host       | Notes was stopped      | The shell closed it.                                     |
      | w9     | expired    | An applet was stopped  | expired                                                  |

  Scenario: the window itself records why it stopped
    Given the shell host with window "w1" titled "Notes"
    When the shell host hears window "w1" was revoked for "quarantine"
    Then the shell host marks window "w1" stopped because "The guard stopped it because it kept flooding the shell."
