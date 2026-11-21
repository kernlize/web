Feature: Grants made for now end with the applet's last window
  A person may run an applet without the shell remembering what they gave it. What was granted
  for now is in force while any window of that applet is open or about to be, and is dropped when
  the last one ends, so the stored grants are what the next start begins from (D-059).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"
    And a kernl shell over that host and pool

  Scenario: the grant ends when the only window closes
    Given a mounted applet
    When the user grants the mounted applet "notify" for now
    Then the mounted applet is granted for now
    When the shell closes the mounted applet
    Then the mounted applet is not granted for now
    And the mounted applet's stored grants are ""

  Scenario: a window being stopped ends it too
    Given a mounted applet
    When the user grants the mounted applet "notify" for now
    And kehto revokes the mounted window
    Then the mounted applet is not granted for now

  Scenario: another window of the same applet keeps it
    Given a mounted applet
    When the user grants the mounted applet "notify" for now
    And the shell plans the applet again
    And the shell mounts the applet planned again
    And the shell closes the mounted applet
    Then the mounted applet is granted for now
    When the shell closes the applet planned again
    Then the mounted applet is not granted for now

  Scenario: an applet starting again does not lose it between the old window and the new
    Given a mounted applet
    When the user grants the mounted applet "notify" for now
    And the shell plans the applet again
    And the shell closes the mounted applet
    Then the mounted applet is granted for now
    When the shell mounts the applet planned again
    Then the mounted applet is granted for now
    When the shell closes the applet planned again
    Then the mounted applet is not granted for now

  Scenario: a plan the firewall gave up on does not keep it
    Given a mounted applet
    When the user grants the mounted applet "notify" for now
    And the shell plans the applet 17 more times
    Then mounting the first of those plans is refused with "denied:admission-expired"
    When the shell closes the mounted applet
    Then the mounted applet is granted for now

  Scenario: a window that closes with nothing granted for now changes nothing
    Given a mounted applet
    When the shell closes the mounted applet
    Then the mounted applet is not granted for now
