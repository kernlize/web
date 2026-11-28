Feature: Open an applet address from another applet
  An applet asking to open another applet cannot choose its permissions or open it on its own.

  Scenario: The link firewall is checked before looking up the target
    Given an applet with a link to a named applet
    When the person clicks the applet's link
    Then the shell asks to look up an applet, not to open a new tab
    When the person refuses the firewall request
    Then the shell does not look up, install or open the target

  Scenario: Review a verified target before installing and opening it
    Given an applet with a link to a named applet
    When the person allows looking up the target
    Then the review names both applets and the target publisher, not the link label
    And required and optional permissions are shown separately
    When the person cancels the review
    Then the target is not installed or granted any permissions
    When the person requests the same link again and chooses to install and open it
    Then the target runs in the shell with the reviewed grants and no tab opens
    And the applet gets an opened result

  Scenario: An installed artifact with its required grants still asks before opening
    Given the linked applet is installed and its required permissions are already granted
    When the person allows looking it up again
    Then the review says Open instead of Install and open
    When the person chooses Open
    Then an already running compatible window is focused without opening a duplicate
