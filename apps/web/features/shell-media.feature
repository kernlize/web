Feature: How the shell's player words media
  The player names a session by its title, says who plays it and how far along
  it is, and the Media section of Settings offers each choice in plain words.
  What happens to an earlier session is only asked while one plays at a time (D-061).

  Scenario Outline: times read as the player shows them
    Then the player shows "<seconds>" seconds as "<shown>"

    Examples:
      | seconds | shown   |
      | 0       | 0:00    |
      | 75.9    | 1:15    |
      | 3725    | 1:02:05 |
      | -4      | 0:00    |

  Scenario: a session with no time shows none
    Then the player shows no time as "0:00"

  Scenario Outline: a session is called by its title, or by what it is
    Then a <kind> session titled "<title>" is called "<called>"

    Examples:
      | kind  | title    | called   |
      | audio | Nightly  | Nightly  |
      | audio |          | Audio    |
      | video |          | Video    |

  Scenario: a title of only spaces is no title
    Then a video session titled with only spaces is called "Video"

  Scenario: the line under a title says who plays it and how far along
    Then a "playing" session by "Ada" from "Radio" reads "Ada · Radio · Playing"
    And a "buffering" session by "" from "Radio" reads "Radio · Loading"
    And a "stopped" session by "" from "Radio" reads "Radio · Stopped"
    And a "paused" session by "" from "Radio" reads "Radio · Paused"
    And a "rewinding" session by "" from "Radio" reads "Radio · Paused"
    And a session with no state from "Radio" reads "Radio · Paused"
    And a "playing" session from "Radio" played on after it closed reads "Radio (closed) · Playing"

  Scenario: the main button pauses what is playing or loading
    Then a "playing" session shows the pause button
    And a "buffering" session shows the pause button
    And a "paused" session shows the play button

  Scenario: video windows are named after their session
    Then the video window for "clip" is "media:clip"
    And the window "media:clip" shows session "clip"
    And the window "settings" shows no session

  Scenario: the settings section asks about an earlier session only while one plays at a time
    Then with "one" at once the media settings ask "Playing at once,When another starts,Videos,Hidden windows,Starting on its own,When its applet closes"
    And with "many" at once the media settings ask "Playing at once,Videos,Hidden windows,Starting on its own,When its applet closes"

  Scenario: the full-screen button says what it does
    Then the full-screen button reads "Full screen" outside full screen
    And the full-screen button reads "Exit full screen" in full screen

  Scenario: the shell fills the screen with its own box around a video, and leaves on a second press
    Given a video box the shell can show full screen
    When the person presses full screen on it
    Then the video box fills the screen
    When the person presses full screen on it
    Then nothing fills the screen

  Scenario: a browser that refuses full screen leaves the player as it was
    Given a video box the browser will not show full screen
    When the person presses full screen on it
    Then nothing fills the screen
