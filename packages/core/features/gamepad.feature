Feature: Controllers an applet reads through the shell
  Every mounted frame is denied the native controller API, so an applet that
  navigates with a pad reads it through the `gamepad` domain, and the shell owns
  the only native reader (D-074). A subscribed applet receives a complete
  snapshot, but live values only while its window is the one the person is
  working in; every other subscriber gets the neutral snapshot the proposal
  requires, so a press in one window cannot be replayed in another. A window
  that gains focus gets the current sample, never a replay of a press it missed, and the
  domain is advertised only to an applet the person granted it.

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: a granted applet reads the pad while its window is the focused one
    Given a page whose controller reader holds a pad with the "A" button pressed
    And a kernl shell over that host and pool that reads controllers
    And a mounted applet granted "gamepad" that has said hello
    When the applet subscribes to controllers over its port
    Then the applet's controller snapshot is live
    And the applet's controller snapshot has the "A" button pressed

  Scenario: a window the person is not working in receives the neutral snapshot
    Given a page whose controller reader holds a pad with the "A" button pressed
    And a kernl shell over that host and pool that reads controllers
    And a mounted applet granted "gamepad" that has said hello
    When the mounted window is hidden
    And the applet subscribes to controllers over its port
    Then the applet's controller snapshot is neutral
    And the applet's controller snapshot has no button pressed
    And the applet's controller snapshot carries timestamp 0

  Scenario: losing focus takes the live values away at once
    Given a page whose controller reader holds a pad with the "A" button pressed
    And a kernl shell over that host and pool that reads controllers
    And a mounted applet granted "gamepad" that has said hello
    When the applet subscribes to controllers over its port
    And the person turns to another window
    Then the applet's controller snapshot is neutral
    And the applet's controller snapshot has no button pressed

  Scenario: a handoff between two subscribed windows does not wait for a browser event or frame
    Given a page whose controller reader holds a pad with the "A" button pressed
    And a kernl shell over that host and pool that reads controllers
    And a mounted applet granted "gamepad" that has said hello
    When the applet subscribes to controllers over its port
    And a second window subscribes to controllers in the background
    Then the applet's controller snapshot is live
    And the second window's snapshot is neutral
    When the window manager gives focus to the second window without a browser event or frame
    Then the applet's controller snapshot is neutral
    And the applet's controller snapshot has no button pressed
    And the second window receives a live snapshot with the "A" button pressed

  Scenario: the person's grant is what puts the domain in the environment
    Given a page whose controller reader holds a pad with the "A" button pressed
    And a kernl shell over that host and pool that reads controllers
    When the shell resolves the manifest address
    And the shell plans the summary
    Then the plan environment does not offer "gamepad"
    When the shell allows "gamepad" for the resolved applet
    And the shell plans the summary
    Then the plan environment offers "gamepad"

  Scenario: a shell with no controller reader never offers the domain
    Given a kernl shell over that host and pool
    Then the shell does not offer "gamepad"

  Scenario: a window without the grant cannot subscribe by asking on its port
    Given a page whose controller reader holds a pad with the "A" button pressed
    And a kernl shell over that host and pool that reads controllers
    And a mounted applet granted "relay" that has said hello
    When the applet requests controller input over its port
    Then the applet received no "gamepad.state"

  Scenario: a host can disable controller input even on a page that has a reader
    Given a page whose controller reader holds a pad with the "A" button pressed
    And a kernl shell over that host and pool with controllers disabled
    Then the shell does not offer "gamepad"

  Scenario: a host that names no gamepad module never offers controllers
    Given a page whose controller reader holds a pad with the "A" button pressed
    And the shell loads no modules
    And a kernl shell over that host and pool that reads controllers
    Then the shell does not offer "gamepad"
