Feature: The download connections the person set up
  The person tells kernl where each download program answers and how to sign
  in, as many connections as they like, several of one program among them.
  The address is checked against how kernl itself was loaded before it is
  kept or used, its scheme is worked out when none was typed, and what is kept
  stays on this device (D-050, D-053).

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
    When the person checks and adds the transmission program as "ann" with "s3cret"
    Then the settings hold one "transmission" connection called "Transmission", the torrent default
    And the torrent client the services call lists 0 torrents from the real program
    And the same torrent client is kept between calls
    When the download program settings are opened again
    Then the settings hold one "transmission" connection called "Transmission", the torrent default
    And the settings record holds the address, name and label, and no password
    And the password is with the secrets provider under the connection's id

  Scenario Outline: an address the page may not call is refused before it is kept
    Given download program settings on a page loaded over "<page>"
    When the person tries to add the sabnzbd program at "<address>"
    Then adding the download connection is refused with "<reason>"
    And nothing is set up yet

    Examples:
      | page  | address                         | reason                         |
      | https | http://nas.local:8080           | invalid:mixed-content          |
      | https | ftp://nas.local                 | invalid:scheme                 |
      | http  | http://ann:pw@nas.local:8080    | invalid:credentials-in-address |
      | http  | not an address                  | invalid:address                |

  Scenario: a secure page keeps a plain address only on this device
    Given download program settings on a page loaded over "https"
    When the person adds the sabnzbd program at "http://localhost:8080/sabnzbd/" with the key "k1"
    Then the "SABnzbd" connection is "http://localhost:8080/sabnzbd" with a kept key
    And 1 archive downloader is offered, called "SABnzbd"
    When the download program settings are opened again
    Then 1 archive downloader is offered, called "SABnzbd"

  Scenario: a sign-in that is not text of a sane length is refused
    Given download program settings on a page loaded over "http"
    When the person tries to add the nzbget program with a password 600 characters long
    Then adding the download connection is refused with "invalid:sign-in"

  Scenario: several connections of one program are numbered until the person names them
    Given download program settings on a page loaded over "http"
    When the person adds the transmission program at "http://localhost:9091" with the name "ann"
    And the person adds the transmission program at "http://localhost:9092" with the name "ann"
    And the person adds the transmission program at "http://localhost:9093" labelled "  Office  "
    And the person adds the transmission program at "http://localhost:9094" with the name "ann"
    Then the connections are labelled "Transmission,Transmission 2,Office,Transmission 3"
    When the person relabels "Transmission 3" as "Transmission"
    Then the connections are labelled "Transmission,Transmission 2,Office,Transmission"
    And labelling a new transmission connection "   " is refused with "invalid:label"
    And labelling a new transmission connection with 61 characters is refused with "invalid:label"
    And relabelling "Office" with 61 characters is refused with "invalid:label"
    And the connections are labelled "Transmission,Transmission 2,Office,Transmission"

  Scenario: the first of a kind is the default until the person chooses, and removing the default promotes the next
    Given download program settings on a page loaded over "http"
    When the person adds the utorrent program at "http://localhost:8080" labelled "Den"
    And the person adds the transmission program at "http://localhost:9091" labelled "Attic"
    And the person adds the transmission program at "http://localhost:9092" labelled "Shed"
    And the person adds the nzbget program at "http://localhost:6789" labelled "News"
    Then the torrent default is "Den"
    When the person chooses "Attic" for torrents
    Then the torrent default is "Attic"
    And the preferred torrent connection is "Attic"
    When the person removes the "Attic" connection
    Then the torrent default is "Shed"
    When the person removes the "Shed" connection
    Then the torrent default is "Den"
    And choosing "News" for torrents is refused with "invalid:connection"
    And choosing a connection that does not exist for sharing is refused with "invalid:connection"
    When the person removes the "Den" connection
    Then there is no torrent default
    And no torrent client or sharing daemon is offered
    When the person removes the "News" connection
    Then nothing is set up yet

  Scenario: the default wraps to the first of its kind when the last one added was the default
    Given download program settings on a page loaded over "http"
    When the person adds the slskd program at "http://localhost:5030" labelled "One"
    And the person adds the slskd program at "http://localhost:5031" labelled "Two"
    And the person chooses "Two" for sharing
    And the person removes the "Two" connection
    Then the sharing default is "One"

  Scenario: a connection's routing key changes with its address and with nothing else
    Given download program settings on a page loaded over "http"
    When the person adds the slskd program at "http://localhost:5030" with the key "k2"
    Then the "slskd" connection's routing key is its id and 0
    When the person relabels "slskd" as "Loft"
    Then the "Loft" connection's routing key is its id and 0
    And the sharing daemon offered is the same client
    When the person changes "Loft" to "http://localhost:5030" with the key "k2"
    Then the "Loft" connection's routing key is its id and 0
    When the person changes "Loft" to "http://localhost:5031" with the key "k2"
    Then the "Loft" connection's routing key is its id and 1
    And the sharing daemon offered is a new client
    When the person changes "Loft" to "http://localhost:5032" with the key "k2"
    Then the "Loft" connection's routing key is its id and 2

  Scenario: every kind of program is offered once it is set up
    Given download program settings on a page loaded over "http"
    When the person adds the nzbget program at "http://localhost:6789" with the name "ann"
    And the person adds the sabnzbd program at "http://localhost:8080" with the key "k1"
    And the person adds the slskd program at "http://localhost:5030" with the key "k2"
    Then 2 archive downloaders are offered, called "NZBGet,SABnzbd"
    And a sharing daemon is offered
    And the torrent routing has nothing to offer

  Scenario: an unknown connection cannot be changed or checked against, and removing one is a no-op
    Given download program settings on a page loaded over "http"
    When the person adds the sabnzbd program at "http://localhost:8080" with the key "k1"
    Then changing a connection that does not exist is refused with "invalid:connection"
    And checking the transmission program against the "SABnzbd" connection is refused with "invalid:connection"
    When the person removes a connection that does not exist
    Then the connections are labelled "SABnzbd"

  Scenario: what was stored is checked again, and what no longer passes is dropped
    Given stored download connections holding the plain address "http://nas.example:8080", damaged entries and a default naming no connection
    And download program settings on a page loaded over "https"
    Then nothing is set up yet
    Given stored download connections holding the plain address "http://nas.example:8080", damaged entries and a default naming no connection
    And download program settings on a page loaded over "http"
    Then the connections are labelled "Kept,Second"
    And the sharing default is "Second"
    And there is no torrent default

  Scenario: a password left empty is the kept one for the same address, and is forgotten for a new one
    Given a Transmission program on this device that wants "ann" and "s3cret"
    And download program settings on a page loaded over "http"
    When the person checks and adds the transmission program as "ann" with "s3cret"
    And the person checks the "Transmission" connection at its bare address as "ann" with ""
    Then the checked program reports the version "4.1.4 (a6d907d9ea)"
    When the person changes "Transmission" to the program's own address as "ann" with ""
    Then the "Transmission" connection keeps a password
    When the person changes "Transmission" to "http://localhost:9091" as "ann" with ""
    Then the "Transmission" connection keeps no password
    And the secrets provider holds no password for "Transmission"

  Scenario: a provider that will not keep a secret leaves nothing saved
    Given a secrets provider that refuses to keep anything
    And download program settings on a page loaded over "http"
    When the person tries to add the sabnzbd program at "http://localhost:8080"
    Then adding the download connection is refused with "denied:secrets"
    And nothing is set up yet

  Scenario: a provider that will not hand a kept secret over locks that connection until it is signed in to again
    Given download program settings on a page loaded over "http"
    When the person adds the sabnzbd program at "http://localhost:8080" with the key "k1"
    And the person adds the sabnzbd program at "http://localhost:8081" with the key "k3"
    And the secrets provider stops handing over the secrets of "SABnzbd"
    And the download program settings are opened again
    Then the "SABnzbd" connection is locked and 1 archive downloader is offered
    When the secrets provider hands secrets over again
    And the person relabels "SABnzbd" as "Den"
    Then the "Den" connection is locked and 1 archive downloader is offered
    When the person changes "Den" to "http://localhost:8080" with the key "k2"
    Then no connection is locked
    And 2 archive downloaders are offered, called "Den,SABnzbd 2"

  Scenario: a locked connection can still be removed, and its secrets go with it
    Given download program settings on a page loaded over "http"
    When the person adds the sabnzbd program at "http://localhost:8080" with the key "k1"
    And the person adds the slskd program at "http://localhost:5030" with the key "k2"
    And the secrets provider stops handing over the secrets of "slskd"
    And the download program settings are opened again
    And the person removes the "SABnzbd" connection
    Then the connections are labelled "slskd"
    And the "slskd" connection is locked and 0 archive downloaders are offered
    And the secrets provider holds no key for the removed "SABnzbd"

  Scenario: a host's own fetch carries every request, and a reopened shell signs in with the kept password
    Given a Transmission program on this device that wants "ann" and "s3cret"
    And download program settings on a page loaded over "http"
    When the person checks and adds the transmission program as "ann" with "s3cret"
    And the download program settings are opened again with the host's own fetch
    Then the torrent client the services call lists 0 torrents from the real program
    And the host's own fetch carried the requests

  Scenario: a record that is not one, or a kept secret that has gone, is not trusted
    Given a stored download programs record that reads "7"
    And download program settings on a page loaded over "http"
    Then nothing is set up yet
    Given a stored download programs record that reads "{"connections":5,"defaults":7}"
    And download program settings on a page loaded over "http"
    Then nothing is set up yet
    Given a stored download programs record that reads "{"connections":[{"id":"c1","program":"sabnzbd","label":"Gone","url":"http://localhost:8080","hasApiKey":true,"hasPassword":true,"routingKey":"c1:0"}]}"
    And download program settings on a page loaded over "http"
    When the download program settings are opened again
    Then the "Gone" connection is locked and 0 archive downloaders are offered

  Scenario: storage that refuses a write keeps no secret and says so
    Then the storage provider answers "unavailable:secrets" when its storage refuses the write

  Scenario: the built-in providers say how they keep a secret, and keep it
    Then the storage provider keeps "k1" as typed on "this device" and forgets it when asked
    And the memory provider keeps "k1" for "this session" and forgets it when asked

  Scenario: the page's own scheme is read where there is a page
    Then the page scheme is "http" where there is no page
    And the page scheme is "https" on a page loaded over "https:"
    And the page scheme is "http" on a page loaded over "http:"
    And the programs kernl can drive are "transmission,utorrent,nzbget,sabnzbd,slskd"
