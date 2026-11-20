Feature: Download domains in the composed shell
  The shell serves torrent, nzb and soulseek to applets by driving the
  programs the person set up. The three are offered only where an applet can
  actually call them, are grants like any other, and every question they have
  goes to the person in the applet's name (D-050).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: on a kehto that cannot bind a new domain the three are not offered, and the settings are still there
    Given a kernl shell over that host and pool
    Then the installed prelude cannot bind a domain it does not build in
    And a prelude that renders bindings can
    And the shell does not offer "torrent"
    And the shell does not offer "nzb"
    And the shell does not offer "soulseek"
    And the shell's download settings name nothing set up, kept on "this device"

  Scenario: an applet the person granted adds a torrent to their own program, after they say yes
    Given a kernl shell that offers the download domains, with a Transmission program set up
    Then the shell offers "torrent"
    Given a mounted applet granted "torrent" that has said hello
    Then the applet received a "shell.init" with domains "shell,storage,inc,theme,torrent"
    When the applet asks to add the magnet for "abcdef0123456789abcdef0123456789abcdef01" over its port
    Then the host is asked "Add a torrent to Transmission" as a "direct" question with no record to show
    When the host answers yes to the download question
    Then the applet is told the torrent was added
    And the real program was asked to add that torrent

  Scenario: a no adds nothing
    Given a kernl shell that offers the download domains, with a Transmission program set up
    And a mounted applet granted "torrent" that has said hello
    When the applet asks to add the magnet for "abcdef0123456789abcdef0123456789abcdef01" over its port
    And the host answers no to the download question
    Then the applet is told adding the torrent failed with "user-denied"
    And the real program was asked to add nothing

  Scenario: an applet without the grant reaches nothing and nobody is asked
    Given a kernl shell that offers the download domains, with a Transmission program set up
    And a mounted applet granted "notify" that has said hello
    When the applet asks to add the magnet for "abcdef0123456789abcdef0123456789abcdef01" over its port
    Then the host was not asked anything
    And the applet received no "torrent.add.result"
    And the real program was asked to add nothing

  Scenario: an applet that reads messages holds none of the three (D-046)
    Given a kernl shell that offers the download domains, with a Transmission program set up
    And a mounted applet granted each of "dm,torrent,nzb,soulseek" that has said hello
    Then the applet received a "shell.init" with domains "shell,storage,theme,dm"

  Scenario: with nothing set up each domain says so instead of failing
    Given a kernl shell that offers the download domains
    And a mounted applet granted each of "nzb,soulseek" that has said hello
    When the applet asks which archive downloaders there are over its port
    And the applet asks about the sharing daemon over its port
    Then the applet is told there are 0 archive downloaders
    And the applet is told the sharing daemon is "unconfigured"

  Scenario: an archive named by address is fetched through the shell's own fetch policy
    Given a kernl shell that offers the download domains, with an NZBGet program set up and bridges that fetch an archive listing
    And a mounted applet granted "nzb" that has said hello
    When the applet submits the archive at "https://indexer.example/get/1.nzb" over its port
    Then the host is asked a "routine" question about the download
    When the host answers yes to the download question
    Then the applet is told the archive was accepted as a job
    And the bridges were asked for "https://indexer.example/get/1.nzb" on the shell's behalf

  Scenario: an address that does not lead to a document creates no job, and nobody is asked
    Given a kernl shell that offers the download domains, with an NZBGet program set up and bridges that answer with a job
    And a mounted applet granted "nzb" that has said hello
    When the applet submits the archive at "https://indexer.example/get/1.nzb" over its port
    Then the applet is told the archive failed with "unavailable"

  Scenario: a window that closed while the shell was working is answered no without asking anyone
    Given download services over a sharing daemon, for a window that stops being an applet once the daemon is asked
    When that window searches the sharing daemon for "field recording"
    Then that window is told "denied" and nobody was asked

  Scenario: what a question is ranked as follows what it would start
    Then a download question that deletes is "destructive"
    And a download question that shows peers an address is "direct"
    And a download question that only the person's servers see is "routine"
