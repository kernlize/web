Feature: Intents in the preview
  The preview routes requests between its applets with the core's own router
  and delivery, over an installed set and defaults kept in the host's storage.
  There is no account to publish choices to, so defaults stay on the device.

  Scenario: the preview's installed set follows what the user opens and removes
    Given preview intents over empty storage
    When the preview installs "profiles" and "notes"
    Then the preview has installed "Profiles,Notes"
    And the preview offers "Profiles" for "profile"
    When the preview uninstalls "Profiles"
    Then the preview has installed "Notes"
    And the preview offers nothing for "profile"
    When the preview intents are reloaded
    Then the preview has installed "Notes"

  Scenario: unreadable stored state starts empty
    Given preview intents over storage holding "not json" for installed and "null" for defaults
    Then the preview has installed ""
    And the preview defaults are ""

  Scenario: defaults stay on this device
    Given preview intents over empty storage
    When the preview remembers "profiles" for "profile"
    Then the preview default for "profile" is "profiles"
    And the preview defaults are "profile=profiles"
    When the preview intents are reloaded
    Then the preview default for "profile" is "profiles"
    When the preview forgets the default for "profile"
    Then the preview defaults are ""
    And the preview heard default changes "profile,profile"
    And the preview cannot share defaults and has none published

  Scenario: without a chooser or an opener a request has nowhere to go
    Given preview intents over empty storage with a bare host
    When the preview installs "profiles" and "notes"
    And "Notes" asks the preview to open a profile for "abc"
    Then the preview answered "yes" with "Profiles is taking it."
    And the preview host was told "Profiles could not take the request"
    When "Notes" asks the preview to open a note for "abc"
    Then the preview answered "no" with "Nobody took it (no handler)."

  Scenario: a request from an applet the preview does not know is credited to an applet
    Given preview intents whose handler window takes deliveries
    When the preview installs "profiles" and "notes"
    And "Stranger" asks the preview to open a profile for "abc"
    Then the preview answered "yes" with "Profiles is taking it."
    And the preview delivered "An applet asked this applet to open a profile."
