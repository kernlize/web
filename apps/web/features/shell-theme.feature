Feature: The shell's theme for applets
  The page owns the palette, and an applet is told it in the three colours
  NAP-THEME requires. It hears them once when it opens, and again every time the
  page's colours change, so an applet that is running follows the shell's colour
  scheme instead of keeping the colours it was opened with (D-064).

  Scenario: applets are told the colours of the page the shell is on
    Given the page's style tokens "--bg-raised: #fcfaf4 ; --ink:#15171b; --accent: #9a5b00"
    Then the shell's theme is background "#fcfaf4", text "#15171b" and primary "#9a5b00"

  Scenario: a page without the shell's tokens has no theme to tell
    Given the page's style tokens "--ink:#15171b"
    Then the shell has no theme

  Scenario: an applet that is open follows a change of the page's colours
    Given the page's style tokens "--bg-raised: #fcfaf4; --ink: #15171b; --accent: #9a5b00"
    And the shell follows the page's colours
    When the page's colours change to "--bg-raised: #141720; --ink: #ebe6da; --accent: #efb449"
    Then the applets were told background "#141720", text "#ebe6da" and primary "#efb449"

  Scenario: a palette that says what it already said is not sent again
    Given the page's style tokens "--bg-raised: #141720; --ink: #ebe6da; --accent: #efb449"
    And the shell follows the page's colours
    When the page's palette is applied again
    Then the applets were told nothing

  Scenario: a page without the tokens tells nobody, and still follows them once they arrive
    Given the page's style tokens "--ink: #15171b"
    And the shell follows the page's colours
    When the page's colours change to "--bg-raised: #141720; --ink: #ebe6da; --accent: #efb449"
    Then the applets were told background "#141720", text "#ebe6da" and primary "#efb449"

  Scenario: a page that loses its tokens tells nobody, and follows them again when they come back
    Given the page's style tokens "--bg-raised: #141720; --ink: #ebe6da; --accent: #efb449"
    And the shell follows the page's colours
    When the page's colours change to "--bg-raised: ; --ink: ; --accent: "
    Then the applets were told nothing
    When the page's colours change to "--bg-raised: #fcfaf4; --ink: #15171b; --accent: #9a5b00"
    Then the applets were told background "#fcfaf4", text "#15171b" and primary "#9a5b00"

  Scenario: a shell that stops following the page leaves nothing listening
    Given the page's style tokens "--bg-raised: #141720; --ink: #ebe6da; --accent: #efb449"
    And the shell follows the page's colours
    When the shell stops following the page's colours
    Then no signal is left listening
