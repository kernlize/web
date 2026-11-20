Feature: The shell host
  The UI's side of the contract: where state is kept, how the user is asked,
  how links leave the shell and how a stopped applet is explained.

  Scenario: the browser's storage is used when it accepts a probe
    Given the shell host storage is the browser storage
    Then the shell host uses the browser storage after probing it

  Scenario: a browser that refuses storage gets a page-lifetime store
    Given the shell host storage is refused by the browser
    Then the shell host keeps "theme" as "dark" for the page only

  Scenario: the offline preview keeps its state apart from the live shell's
    Given a store that holds "kernl:recent:v1" as "live applets"
    When the preview writes "kernl:recent:v1" as "samples" through its own view of that store
    Then the store holds "kernl:recent:v1" as "live applets" and "preview:kernl:recent:v1" as "samples"
    And the preview reads "kernl:recent:v1" as "samples", and nothing once it removes it

  Scenario: consent, notices and visibility go to the UI stores
    Given the shell host with window "w1" titled "Notes"
    Then the shell host forwards consent, notices and visibility for window "w1"

  Scenario: an applet's settings open in the settings form
    Given the shell host with window "w1" titled "Notes"
    Then the shell host shows an applet's settings in the settings form

  Scenario: requests between applets reach the chooser, the desktop and the window manager
    Given the shell host with window "w1" titled "Notes"
    Then the shell host asks the chooser, opens applets through the desktop once it can, and brings windows forward

  Scenario: a link the firewall did not decide opens only after the user agrees
    Given the shell host with window "w1" titled "Notes"
    When the shell host is asked to open "https://example.org" and the user says "no"
    Then the shell host asked before opening "https://example.org"
    And the shell host opened nothing
    When the shell host is asked to open "https://example.org" and the user says "yes"
    Then the shell host opened "https://example.org" in a new, unlinked tab

  Scenario: a link the firewall already let through opens without a second question
    Given the shell host with window "w1" titled "Notes"
    When the shell host is asked to open "https://example.org", which the firewall already let through
    Then the shell host did not ask again
    And the shell host opened "https://example.org" in a new, unlinked tab

  Scenario: firewall questions wait in their own queue
    Given the shell host with window "w1" titled "Notes"
    Then the shell host puts a firewall question in the firewall queue

  Scenario Outline: a stopped applet is explained in one plain line, never by its code
    Given the shell host with window "w1" titled "Notes"
    When the shell host hears window "<window>" was revoked for "<reason>"
    Then the shell host warns "<title>" because "<words>" for window "<window>"
    And window "<window>" stopped by "<by>", with "<next>" next and code "<reason>"

    Examples:
      | window | reason            | title                 | words                                                | by     | next                                                |
      | w1     | quarantine        | Notes was stopped     | It sent too many messages.                           | applet | Open it again, or loosen the guard profile.         |
      | w1     | host              | Notes was stopped     | The shell closed it.                                 | shell  | Open it again.                                      |
      | w1     | grant-narrowed    | Notes was stopped     | You took back something it was using.                | you    | Open it again to run it with what it may use now.   |
      | w1     | blocked           | Notes was stopped     | You blocked it.                                      | you    | Unblock it in its grants to run it.                 |
      | w1     | firewall          | Notes was stopped     | A firewall rule or answer it ran under changed.      | you    | Open it again.                                      |
      | w1     | window-message    | Notes was stopped     | It sent a message outside its channel.               | applet | Open it again. If it repeats, the applet has a bug. |
      | w1     | second-hello      | Notes was stopped     | It tried to connect to the shell twice.              | applet | Open it again. If it repeats, the applet has a bug. |
      | w1     | invalid-hello     | Notes was stopped     | It connected to the shell the wrong way.             | applet | Open it again. If it repeats, the applet has a bug. |
      | w1     | second-load       | Notes was stopped     | It reloaded or left its own page.                    | applet | Open it again.                                      |
      | w1     | port-closed       | Notes was stopped     | Its connection to the shell closed.                  |        | Open it again.                                      |
      | w1     | deferred-overflow | Notes was stopped     | It sent too much while waiting to be seen.           | applet | Open it again.                                      |
      | w9     | expired           | An applet was stopped | It was stopped for a reason the shell does not know. |        | Open it again.                                      |

  Scenario: kehto's own detail is kept for a bug report
    Given the shell host with window "w1" titled "Notes"
    When the shell host hears window "w1" was revoked for "window-message" with the detail "A window-level message other than the single napplet.hello arrived from the frame"
    Then window "w1" stopped with the detail "A window-level message other than the single napplet.hello arrived from the frame" and no limit

  Scenario Outline: a quarantine names the limit it crossed
    Given the shell host with window "w1" titled "Notes"
    When the shell host hears window "w1" was quarantined for "<cause>" at <count> per <span> ms under "<profile>"
    Then the shell host warns "Notes was stopped" because "<words>" for window "w1"
    And window "w1" stopped at the limit "<limit>"

    Examples:
      | cause           | count | span  | profile  | words                                       | limit                                |
      | flood           | 300   | 10000 | strict   | It sent too many messages.                  | 300 messages in 10 s · strict        |
      | hidden-resource | 16    | 0     | balanced | It kept fetching from the web while hidden. | 16 web fetches while hidden · balanced |

  Scenario: the reply question reaches its dialog and the answer comes back
    Given the shell host with window "w1" titled "Notes"
    Then the shell host puts the reply question to the reply dialog

  Scenario: a key an applet had no shortcut for reaches the shell once it is on screen
    Given the shell host with window "w1" titled "Notes"
    When the shell host is handed the key "/" at "Slash" with Alt "held"
    Then the shell ran the shortcuts ""
    When the shell is on screen
    And the shell host is handed the key "/" at "Slash" with Alt "held"
    And the shell host is handed the key "Escape" at "Escape" with Alt "up"
    And the shell host is handed the key "k" at "KeyK" with Alt "held"
    Then the shell ran the shortcuts "launcher,dismiss"

  Scenario Outline: the shell knows its own keys by what they type or where they sit
    Then the key "<key>" at "<code>" with Alt "<alt>" is the shell's "<shortcut>" shortcut
    And an applet cannot bind "Alt+/"

    Examples:
      | key    | code   | alt  | shortcut |
      | Escape | Escape | up   | dismiss  |
      | /      | Slash  | held | launcher |
      | ÷      | Slash  | held | launcher |
      | /      | Minus  | held | launcher |
      | /      | Slash  | up   | none     |
      | k      | KeyK   | held | none     |
