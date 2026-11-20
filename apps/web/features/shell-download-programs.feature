Feature: Setting up download programs in Settings
  Settings holds the address and sign-in of each program the person runs to
  download things. The form never shows a saved secret again, never sends one
  to an address it was not typed for, and says in plain words why an address
  cannot be used, above all when the page is secure and the address is not.
  It is never handed a secret: only whether one is kept.

  Scenario: the form opens with the saved address and name, and empty secrets
    Given a saved download program at "http://localhost:9091" signed in as "ann" with a kept password
    Then the download program form shows the address "http://localhost:9091", the name "ann" and no password
    And the download program form has nothing to save
    And the form is told a password is kept, and no key

  Scenario: only what was typed, and only the fields a program takes, is sent to be checked
    Given a download program form with the address " localhost:8080 ", the name " ann ", the password "pw" and the key "k1"
    Then a program that takes a name and password would be checked at "localhost:8080" as "ann" with the password "pw"
    And a program that takes only a key would be checked at "localhost:8080" with the key "k1" and nothing else
    And a secret left empty is left out, for the shell to fill from what it keeps

  Scenario: there is something to save once anything differs
    Given a saved download program at "http://localhost:9091" signed in as "ann" with a kept password
    When the person changes the download program's name to "bea"
    Then the download program form has something to save
    And a program never set up has something to save once an address is typed

  Scenario Outline: a refused connection is explained without the raw reason
    Then the download program reason "<reason>" is explained with "<words>"

    Examples:
      | reason                                   | words                                    |
      | invalid:mixed-content                    | must be https too                        |
      | invalid:address                          | Enter an address                         |
      | invalid:scheme                           | http:// or https://                      |
      | invalid:credentials-in-address           | their own fields                         |
      | invalid:sign-in                          | too long                                 |
      | invalid:program                          | Set that program up first                |
      | denied:credentials                       | refused that sign-in                     |
      | unavailable:timeout                      | did not answer in time                   |
      | unavailable:unreachable                  | No answer                                |
      | unavailable:bad-response extra detail    | Something else answered                  |
      | unavailable:unsupported                  | too old                                  |
      | denied:secrets                           | could not be kept                        |
      | unavailable:secrets                      | could not be kept                        |
      | something nobody planned for             | That did not work                        |

  Scenario: what the person should know about a working address is said in words
    Then the download program note "cleartext" says "Not encrypted"
    And the download program note "cleartext-loopback" says "On this device"
    And the download program note "page-insecure" says "opened without encryption"
    And the download program note "something-new" says nothing

  Scenario: a program's card says where things stand
    Then a download program that is not set up reads "Not set up"
    And a download program that is saved reads "Set up"
    And a download program that answered as version "4.0.6" reads "Connected · 4.0.6"
    And a download program whose kept sign-in is locked reads "Sign-in locked"

  Scenario: the form names its fields and groups its programs by what they do
    Then the download program fields are called "Name", "Password" and "Key", and the last two are secrets
    And every download program belongs to exactly one group

  Scenario: the preview checks an address against the page and asks no program
    Given the preview's download programs
    When the preview checks the download program address "localhost:9091"
    Then the preview says it would be reached at "https://localhost:9091" and reports the version "preview"
    And the preview refuses the download program address "ftp://localhost" with "invalid:scheme"
    And the preview's own requests go nowhere
