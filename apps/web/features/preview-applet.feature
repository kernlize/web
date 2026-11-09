Feature: Preview applet
  The preview mounts a static applet instead of verified bytes. Its store lists
  the preview's own applets, it knows each by address, and it renders a sealed
  document whose buttons ask the shell for each capability and say when a grant
  is missing.

  Scenario: the preview's store lists its own applets as store entries
    Then the preview store lists "Notes,Pulse,Profiles"
    And the preview store entry "Profiles" takes requests to "napplet:profile/open" and carries topics "social,people"
    And the preview store entry "Notes" takes no requests and requires "relay,identity,intent"

  Scenario: an applet that takes requests says so in its manifest
    When the preview applet looks up the sample at "preview:profiles"
    Then the preview applet finds the sample "Profiles" with key "profiles"
    And the preview applet sample takes "napplet:profile/open" as role "profile" with address "preview:profiles"

  Scenario: a sample address is found regardless of case and spacing
    When the preview applet looks up the sample at "  PREVIEW:Notes "
    Then the preview applet finds the sample "Notes" with key "notes"
    And the preview applet sample requires "relay,identity,intent" and optionally uses "notify,storage"

  Scenario: the second sample has its own needs
    When the preview applet looks up the sample at "preview:pulse"
    Then the preview applet finds the sample "Pulse" with key "pulse"
    And the preview applet sample requires "relay" and optionally uses "notify,media,resource"

  Scenario: an unknown address is not a sample
    When the preview applet looks up the sample at "preview:missing"
    Then the preview applet finds no sample

  Scenario: a sample's address is found from its identity
    When the preview applet asks for the address of the sample keyed "pulse"
    Then the preview applet sample address is "preview:pulse"

  Scenario: an identity that is not a sample has no address
    When the preview applet asks for the address of the sample keyed "stranger"
    Then the preview applet has no sample address

  Scenario: the document escapes what it shows and seals itself
    Given the preview applet is granted "relay,notify" shown as "Network,Notifications"
    When the preview applet renders sample "notes" titled "Notes <&> \"quoted\""
    Then the preview applet document contains "<title>Notes &lt;&amp;&gt; &quot;quoted&quot;</title>"
    And the preview applet document contains "Granted: <strong>Network, Notifications</strong>"
    And the preview applet document contains "preview applet · notes@preview"
    And the preview applet carries kehto's locked policy in its meta tag
    And the preview applet runs kehto's locked prelude, then the insertion lock, before its own scripts

  Scenario: granted buttons are available and the rest say so
    Given the preview applet is granted "relay" shown as "Network"
    When the preview applet renders sample "notes" titled "Notes"
    Then the preview applet button "publish" is available
    And the preview applet button "link" is available
    And the preview applet button "notify" is marked not granted
    And the preview applet button "intent" is marked not granted
    And the preview applet has no "vanish" button
    And the preview applet document does not contain "More changes that ask you first"

  Scenario: an applet granted nothing beyond the baseline says so
    Given the preview applet is granted "" shown as ""
    When the preview applet renders sample "notes" titled "Notes"
    Then the preview applet document contains "Granted: <strong>nothing beyond the baseline</strong>"
    And the preview applet button "publish" is marked not granted

  Scenario: the pulse sample shows its extra changes
    Given the preview applet is granted "relay" shown as "Network"
    When the preview applet renders sample "pulse" titled "Pulse"
    Then the preview applet document contains "More changes that ask you first"
    And the preview applet button "contacts" is available
    And the preview applet button "servers" is available
    And the preview applet button "vanish" is available

  Scenario: an unknown sample shows only the common buttons
    Given the preview applet is granted "relay" shown as "Network"
    When the preview applet renders sample "stranger" titled "Stranger"
    Then the preview applet button "flood" is available
    And the preview applet has no "contacts" button
