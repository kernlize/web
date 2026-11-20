Feature: kernl routes each applet's work to one of the person's connections
  The person may set up several connections, several of one program among
  them. New work goes to the connection they chose as the default for its
  kind; each job stays on the connection it was handed to, and nothing an
  applet holds can reach a job on another server (D-053). Every scenario here
  runs through the real settings store against real programs on loopback.

  Rule: A torrent goes to the default, or to the connection that already has it

    Background:
      Given the person set up two Transmission programs, "Home" then "Office"

    Scenario: a new torrent goes to the default, and the question names it
      When the applet "films" in the routed window "A" adds the torrent "ubuntu"
      Then the routed torrent question names the program "Home"
      And "Home" holds the torrent "ubuntu" and "Office" does not

    Scenario: the default the person chose takes new torrents
      When the person makes "Office" the default torrent connection
      And the applet "films" in the routed window "A" adds the torrent "ubuntu"
      Then the routed torrent question names the program "Office"
      And "Office" holds the torrent "ubuntu" and "Home" does not

    Scenario: the same torrent added by a second applet goes where it already is
      When the applet "films" in the routed window "A" adds the torrent "ubuntu"
      And the person makes "Office" the default torrent connection
      And the applet "music" in the routed window "B" adds the torrent "ubuntu"
      Then the routed torrent question names the program "Home"
      And "Home" holds the torrent "ubuntu" and "Office" does not

    Scenario: pausing a job on one connection never touches the other
      When the applet "films" in the routed window "A" adds the torrent "ubuntu"
      And the person makes "Office" the default torrent connection
      And the applet "films" in the routed window "A" adds the torrent "debian"
      And the routed window "A" pauses the torrent "ubuntu"
      Then "Home" was asked to pause a torrent and "Office" was not

    Scenario: a job whose connection is removed answers source-unavailable and can still be removed
      When the applet "films" in the routed window "A" adds the torrent "ubuntu"
      And the person removes the routed connection "Home"
      And the routed window "A" asks for the status of the torrent "ubuntu"
      Then the routed window is told the torrent is "source-unavailable"
      When the routed window "A" removes the torrent "ubuntu" and its files
      Then the routed window is told the torrent was removed and its files kept
      And "Home" was never asked to remove a torrent

    Scenario: each refresh asks each connection with live jobs once
      When the applet "films" in the routed window "A" adds the torrent "ubuntu"
      And the applet "films" in the routed window "A" adds the torrent "debian"
      And the person makes "Office" the default torrent connection
      And the applet "films" in the routed window "A" adds the torrent "arch"
      And a few routed torrent refreshes pass
      Then "Home" and "Office" were each listed once a refresh, though "Home" holds two jobs

    Scenario: the same torrent on two connections is two copies, and removing one leaves the other
      When the applet "films" in the routed window "A" keeps the torrent "ubuntu"
      And the shell is reloaded while the secrets provider withholds the sign-in of "Home"
      Then the routed settings name "Home" as locked
      When the applet "music" in the routed window "B" keeps the torrent "ubuntu"
      Then "Office" holds its own copy of the torrent "ubuntu", as "Home" does
      When the person signs in to "Home" again
      And the routed window "B" removes the torrent "ubuntu" and its files
      Then the routed window is told the torrent was removed and its files deleted
      And "Office" was told to delete the files of "ubuntu" and "Home" was not

  Rule: An archive job stays on the server it was sent to

    Background:
      Given the person set up two NZBGet programs, "Home" then "Office"

    Scenario: two servers that number their jobs alike never answer for each other
      When the applet "reader" in the routed window "A" sends the archive "one file" to "Home"
      And the applet "reader" in the routed window "A" sends the archive "holiday film" to "Office"
      Then both NZBGet programs numbered their job 1
      And the routed window "A" is told about each archive job by the program it was sent to

    Scenario: a job sent before its connection's address changed is not found at the new address
      When the applet "reader" in the routed window "A" sends the archive "one file" to "Home"
      And the person points "Home" at a third NZBGet program that already has a job numbered 1
      Then the routed window "A" asking about the "Home" archive job is told "not_found"
      And the routed window "A" is offered the archive downloaders "Home,Office"

  Rule: A search and what it found stay on the daemon that ran it

    Background:
      Given the person set up two slskd programs, "Home" then "Office"

    Scenario: a search goes to the default, and its files come from there after the default changes
      When the routed window "A" searches the sharing programs for "rain"
      Then "Home" ran a search and "Office" did not
      When "Home" finishes the search for "rain" with two files from "ann"
      And the routed window "A" reads the results of "rain"
      And the person makes "Office" the default soulseek connection
      And the routed window "A" downloads file 1 it found
      Then "Home" was asked for a file and "Office" was not
      And the routed window "A" is told the sharing program is "online"

    Scenario: work on a removed connection fails plainly, and closing the window asks nothing of it
      When the routed window "A" searches the sharing programs for "rain"
      And "Home" finishes the search for "rain" with two files from "ann"
      And the routed window "A" reads the results of "rain"
      And the routed window "A" downloads file 1 it found
      And the routed window "A" searches the sharing programs for "wind"
      And the person removes the routed connection "Home"
      And the routed window "A" reads the results of "wind"
      Then the routed window's answer fails with "backend_error" because "That sharing program is no longer set up"
      When the routed window "A" asks for the status of its download
      Then the routed window's answer fails with "backend_error" because "That sharing program is no longer set up"
      When the routed window "A" downloads file 2 it found
      Then the routed window's answer fails with "backend_error" because "That sharing program is no longer set up"
      When the routed window "A" closes
      Then "Home" was asked nothing after it was removed

    Scenario: a download paused before its connection was removed cannot be resumed or paused again
      When the routed window "A" searches the sharing programs for "rain"
      And "Home" finishes the search for "rain" with two files from "ann"
      And the routed window "A" reads the results of "rain"
      And the routed window "A" downloads file 1 it found
      And the routed window "A" downloads file 2 it found
      And the routed window "A" pauses download 1
      And the person removes the routed connection "Home"
      And the routed window "A" resumes download 1
      Then the routed window's answer fails with "backend_error" because "That sharing program is no longer set up"
      When the routed window "A" pauses download 2
      Then the routed window's answer fails with "backend_error" because "That sharing program is no longer set up"
      And the routed window "A" is told the sharing program is "online"
