Feature: The download programs the person set up
  The person tells kernl where each download program answers and how to sign
  in. The address is checked against how kernl itself was loaded before it is
  kept or used, its scheme is worked out when none was typed, and what is
  kept stays on this device (D-050).

  Scenario: an address typed without a scheme is worked out by asking the program
    Given a Transmission program on this device that wants "ann" and "s3cret"
    And download program settings on a page loaded over "https"
    When the person checks the transmission program at its bare address as "ann" with "s3cret"
    Then the checked connection is the program's "http" address, noted "cleartext-loopback"
    And the checked program reports the version "4.1.4 (a6d907d9ea)"
    And nothing is set up yet

  Scenario: a wrong sign-in is refused where the program answered
    Given a Transmission program on this device that wants "ann" and "s3cret"
    And download program settings on a page loaded over "http"
    When the person checks the transmission program at its bare address as "ann" with "wrong"
    Then the download program check fails with "denied:credentials"

  Scenario: a connection is kept, comes back after a reload and serves the torrent domain
    Given a Transmission program on this device that wants "ann" and "s3cret"
    And download program settings on a page loaded over "http"
    When the person checks and saves the transmission program as "ann" with "s3cret"
    Then the settings name "transmission" as set up and as the torrent program
    And the torrent client the services call lists 0 torrents from the real program
    And the same torrent client is kept between calls
    When the download program settings are opened again
    Then the settings name "transmission" as set up and as the torrent program
    And the settings record holds the address and name, and no password
    And the password is with the secrets provider under "download:transmission:password"

  Scenario Outline: an address the page may not call is refused before it is kept
    Given download program settings on a page loaded over "<page>"
    When the person tries to save the sabnzbd program at "<address>"
    Then saving the download program is refused with "<reason>"
    And nothing is set up yet

    Examples:
      | page  | address                         | reason                         |
      | https | http://nas.local:8080           | invalid:mixed-content          |
      | https | ftp://nas.local                 | invalid:scheme                 |
      | http  | http://ann:pw@nas.local:8080    | invalid:credentials-in-address |
      | http  | not an address                  | invalid:address                |

  Scenario: a secure page keeps a plain address only on this device
    Given download program settings on a page loaded over "https"
    When the person saves the sabnzbd program at "http://localhost:8080/sabnzbd/" with the key "k1"
    Then the "sabnzbd" connection is "http://localhost:8080/sabnzbd" with a kept key
    And 1 archive downloader is offered, called "SABnzbd"
    When the download program settings are opened again
    Then 1 archive downloader is offered, called "SABnzbd"

  Scenario: a sign-in that is not text of a sane length is refused
    Given download program settings on a page loaded over "http"
    When the person tries to save the nzbget program with a password 600 characters long
    Then saving the download program is refused with "invalid:sign-in"

  Scenario: with two torrent programs the person chooses, and the first set up serves until they do
    Given download program settings on a page loaded over "http"
    When the person saves the utorrent program at "http://localhost:8080" with the name "ann"
    And the person saves the transmission program at "http://localhost:9091" with the name "ann"
    Then the torrent program is "utorrent"
    When the person chooses "transmission" for torrents
    Then the torrent program is "transmission"
    When the person removes the "transmission" program
    Then the torrent program is "utorrent"
    And choosing "transmission" for torrents is refused with "invalid:program"
    When the person removes the "utorrent" program
    Then nothing is set up yet
    And no torrent client, archive downloader or sharing daemon is offered

  Scenario: every kind of program is offered once it is set up, and a changed connection gets a new client
    Given download program settings on a page loaded over "http"
    When the person saves the nzbget program at "http://localhost:6789" with the name "ann"
    And the person saves the sabnzbd program at "http://localhost:8080" with the key "k1"
    And the person saves the slskd program at "http://localhost:5030" with the key "k2"
    Then 2 archive downloaders are offered, called "NZBGet,SABnzbd"
    And a sharing daemon is offered
    When the person saves the slskd program at "http://localhost:5031" with the key "k2"
    Then the sharing daemon offered is a new client

  Scenario: what was stored is checked again, and what no longer passes is dropped
    Given stored download programs holding the plain address "http://nas.example:8080", a broken entry and a choice of a program that is not set up
    And download program settings on a page loaded over "https"
    Then nothing is set up yet
    Given stored download programs holding the plain address "http://nas.example:8080", a broken entry and a choice of a program that is not set up
    And download program settings on a page loaded over "http"
    Then the settings name "sabnzbd" as set up
    And the torrent program is unset

  Scenario: a password left empty is the kept one for the same address, and is forgotten for a new one
    Given a Transmission program on this device that wants "ann" and "s3cret"
    And download program settings on a page loaded over "http"
    When the person checks and saves the transmission program as "ann" with "s3cret"
    And the person checks the transmission program at its bare address as "ann" with ""
    Then the checked program reports the version "4.1.4 (a6d907d9ea)"
    When the person saves the transmission program at "http://localhost:9091" with the name "ann"
    Then the "transmission" connection keeps no password
    And the secrets provider holds nothing for "download:transmission:password"

  Scenario: a provider that will not keep a secret leaves nothing saved
    Given a secrets provider that refuses to keep anything
    And download program settings on a page loaded over "http"
    When the person tries to save the sabnzbd program at "http://localhost:8080"
    Then saving the download program is refused with "denied:secrets"
    And nothing is set up yet

  Scenario: a provider that will not hand a kept secret over locks that program until it is signed in to again
    Given download program settings on a page loaded over "http"
    When the person saves the sabnzbd program at "http://localhost:8080" with the key "k1"
    And the secrets provider stops handing secrets over
    And the download program settings are opened again
    Then the settings name "sabnzbd" as set up
    And the "sabnzbd" program is locked and no archive downloader is offered
    When the secrets provider hands secrets over again
    And the person saves the sabnzbd program at "http://localhost:8080" with the key "k2"
    Then no program is locked
    And 1 archive downloader is offered, called "SABnzbd"

  Scenario: a locked program can still be removed
    Given download program settings on a page loaded over "http"
    When the person saves the sabnzbd program at "http://localhost:8080" with the key "k1"
    And the person saves the slskd program at "http://localhost:5030" with the key "k2"
    And the secrets provider stops handing secrets over
    And the download program settings are opened again
    And the person removes the "sabnzbd" program
    Then the settings name "slskd" as set up
    And the "slskd" program is locked and no archive downloader is offered

  Scenario: a host's own fetch carries every request, and a reopened shell signs in with the kept password
    Given a Transmission program on this device that wants "ann" and "s3cret"
    And download program settings on a page loaded over "http"
    When the person checks and saves the transmission program as "ann" with "s3cret"
    And the download program settings are opened again with the host's own fetch
    Then the torrent client the services call lists 0 torrents from the real program
    And the host's own fetch carried the requests

  Scenario: a record that is not one, or a kept secret that has gone, is not trusted
    Given a stored download programs record that reads "7"
    And download program settings on a page loaded over "http"
    Then nothing is set up yet
    Given a stored download programs record that reads "{"connections":5}"
    And download program settings on a page loaded over "http"
    Then nothing is set up yet
    Given a stored download programs record that reads "{"connections":{"sabnzbd":{"url":"http://localhost:8080","hasApiKey":true,"hasPassword":true}}}"
    And download program settings on a page loaded over "http"
    When the download program settings are opened again
    Then 1 archive downloader is offered, called "SABnzbd"

  Scenario: the built-in providers say how they keep a secret, and keep it
    Then the storage provider keeps "k1" as typed on "this device" and forgets it when asked
    And the memory provider keeps "k1" for "this session" and forgets it when asked

  Scenario: the page's own scheme is read where there is a page
    Then the page scheme is "http" where there is no page
    And the page scheme is "https" on a page loaded over "https:"
    And the page scheme is "http" on a page loaded over "http:"
    And the programs kernl can drive are "transmission,utorrent,nzbget,sabnzbd,slskd"
