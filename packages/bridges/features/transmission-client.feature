Feature: Transmission client
  A person who already runs Transmission can let kernl drive it. kernl speaks the
  daemon's own RPC interface: it signs in with the name and password the person gave,
  follows the daemon's session handshake, and reports every torrent in kernl's own
  words and by its info hash, whatever the daemon calls things.

  Background:
    Given a Transmission daemon that asks for the name "ada" and password "s3cret-pass"
    And the Transmission client signs in as "ada" with password "s3cret-pass"

  Scenario: the first request picks up the daemon's session id and is sent again
    When the Transmission client probes the program
    Then the Transmission client reports version "4.1.4 (a6d907d9ea)"
    And the Transmission daemon turned away 1 request for lacking its session id
    And the Transmission daemon was asked "session-get" 1 time

  Scenario: a session id the daemon has replaced is picked up again
    When the Transmission client probes the program
    And the Transmission daemon starts a new session
    And the Transmission client probes the program
    Then the Transmission client reports version "4.1.4 (a6d907d9ea)"
    And the Transmission daemon turned away 2 requests for lacking its session id

  Scenario: a daemon that never names its session id cannot be used
    Given the Transmission daemon keeps its session id to itself
    When the Transmission client probes the program
    Then the Transmission client fails with "unavailable:bad-response"

  Scenario Outline: a wrong name or password is refused, and the password is never repeated
    Given the Transmission client signs in as "<name>" with password "<password>"
    When the Transmission client probes the program
    Then the Transmission client fails with "denied:credentials"

    Examples:
      | name | password    |
      | ada  | wrong-pass  |
      | eve  | s3cret-pass |

  Scenario: a daemon that wants a password refuses a client that has none
    Given the Transmission client signs in with nothing
    When the Transmission client probes the program
    Then the Transmission client fails with "denied:credentials"

  Scenario: a name and password outside ASCII reach the daemon intact
    Given a Transmission daemon that asks for the name "zoë" and password "pässwörd ✓"
    And the Transmission client signs in as "zoë" with password "pässwörd ✓"
    When the Transmission client probes the program
    Then the Transmission client reports version "4.1.4 (a6d907d9ea)"

  Scenario: a daemon set up with a name and no password is signed in to with the name alone
    Given a Transmission daemon that asks for the name "ada" and password ""
    And the Transmission client signs in with only the name "ada"
    When the Transmission client probes the program
    Then the Transmission client reports version "4.1.4 (a6d907d9ea)"

  Scenario: a daemon set up with a password and no name is signed in to with the password alone
    Given a Transmission daemon that asks for the name "" and password "s3cret-pass"
    And the Transmission client signs in with only the password "s3cret-pass"
    When the Transmission client probes the program
    Then the Transmission client reports version "4.1.4 (a6d907d9ea)"

  Scenario: a daemon that asks for no password is used without signing in
    Given a Transmission daemon that asks for no password
    And the Transmission client signs in with nothing
    When the Transmission client probes the program
    Then the Transmission client reports version "4.1.4 (a6d907d9ea)"

  Scenario Outline: the address the person typed leads to the RPC interface
    Given the Transmission daemon serves its RPC at "<served>"
    And the Transmission client uses the program's address followed by "<typed>"
    When the Transmission client probes the program
    Then the Transmission client reports version "4.1.4 (a6d907d9ea)"

    Examples:
      | served            | typed              |
      | /transmission/rpc |                    |
      | /transmission/rpc | /                  |
      | /transmission/rpc | /transmission      |
      | /transmission/rpc | /transmission/web/ |
      | /transmission/rpc | /transmission/rpc  |
      | /seedbox/rpc      | /seedbox/rpc       |

  Scenario: a host that supplies its own fetch has every request go through it
    Given the Transmission client is given its host's own fetch
    When the Transmission client probes the program
    Then the Transmission client reports version "4.1.4 (a6d907d9ea)"
    And the Transmission client's requests all went through its host's fetch

  Scenario: a magnet link is added paused and named by its info hash
    When the Transmission client adds the magnet link "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night+Mix" paused
    Then the Transmission client names the torrent "abcdef0123456789abcdef0123456789abcdef01"
    And the Transmission daemon holds the torrent "Night Mix" stopped
    And the Transmission daemon was last asked "torrent-add" with {"filename":"magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night+Mix","paused":true}

  Scenario: unless told, the daemon's own setting decides whether a new torrent starts
    Given the Transmission daemon keeps added torrents stopped
    When the Transmission client adds the magnet link "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Night+Mix"
    Then the Transmission client names the torrent "abcdef0123456789abcdef0123456789abcdef01"
    And the Transmission daemon holds the torrent "Night Mix" stopped
    And the Transmission daemon was last asked "torrent-add" with {"filename":"magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Night+Mix"}

  Scenario: a torrent can be told to start at once whatever the daemon's setting
    Given the Transmission daemon keeps added torrents stopped
    When the Transmission client adds the magnet link "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Night+Mix" to start at once
    Then the Transmission daemon holds the torrent "Night Mix" downloading

  Scenario: a magnet link written in capitals is still handed over as a magnet link
    When the Transmission client adds the magnet link "MAGNET:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01"
    Then the Transmission client names the torrent "abcdef0123456789abcdef0123456789abcdef01"
    And the Transmission daemon was last asked "torrent-add" with {"filename":"magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01"}

  Scenario: adding a torrent the daemon already has finds the one that is there
    When the Transmission client adds the magnet link "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01" paused
    And the Transmission client adds the magnet link "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    Then the Transmission client names the torrent "abcdef0123456789abcdef0123456789abcdef01"
    And the Transmission daemon holds 1 torrent

  Scenario: a torrent file is handed over whole and named by the SHA-1 of its info dictionary
    When the Transmission client adds the torrent file "Field Recordings" paused
    Then the Transmission client names the torrent file "Field Recordings" by the SHA-1 of its info dictionary
    And the Transmission daemon received the torrent file "Field Recordings" byte for byte
    And the Transmission daemon holds the torrent "Field Recordings" stopped

  Scenario Outline: what is not a torrent is refused before anything is sent
    When the Transmission client adds the <kind> "<what>"
    Then the Transmission client fails with "<reason>"
    And the Transmission daemon was never asked "torrent-add"

    Examples:
      | kind         | what                             | reason           |
      | magnet link  | https://example.com/file.torrent | invalid:magnet   |
      | magnet link  | /etc/passwd                      | invalid:magnet   |
      | magnet link  | magnet:?dn=only-a-name           | invalid:magnet   |
      | torrent file | broken                           | invalid:metainfo |

  Scenario: a torrent the daemon will not take is reported as declined, in the daemon's words
    Given the Transmission daemon answers "torrent-add" with status 200 and the body {"arguments":{},"result":"unrecognized info"}
    When the Transmission client adds the torrent file "night-mix.flac"
    Then the Transmission client fails with "unavailable:rejected: unrecognized info"

  Scenario: an add that gets no answer in time may still have happened
    Given the Transmission client gives up after 200 ms
    And the Transmission daemon goes silent on "torrent-add"
    When the Transmission client adds the torrent file "night-mix.flac"
    Then the Transmission client fails with "unavailable:outcome-unknown"

  Scenario Outline: the daemon's status <status> with error <error> is the job state <state>
    Given the Transmission daemon has a torrent with status <status>, error <error>, <metadata> of its metadata and <left> bytes left
    When the Transmission client is asked to "look up" the torrent
    Then the Transmission client reports the torrent as "<state>"

    Examples:
      | status | error | metadata | left  | state       |
      | 0      | 0     | all      | 500   | paused      |
      | 0      | 0     | all      | 0     | complete    |
      | 0      | 0     | none     | 0     | paused      |
      | 1      | 0     | all      | 0     | queued      |
      | 2      | 0     | all      | 0     | queued      |
      | 3      | 0     | all      | 500   | queued      |
      | 4      | 0     | all      | 500   | downloading |
      | 4      | 0     | none     | 0     | metadata    |
      | 5      | 0     | all      | 0     | complete    |
      | 6      | 0     | all      | 0     | seeding     |
      | 6      | 2     | all      | 0     | seeding     |
      | 4      | 1     | all      | 500   | downloading |
      | 0      | 3     | all      | 0     | error       |
      | 4      | 3     | all      | 500   | error       |

  Scenario: a downloading torrent is reported in bytes, with the swarm its trackers last counted
    Given the Transmission daemon is half way through the torrent file "Field Recordings"
    When the Transmission client lists the torrents
    Then the Transmission client reports 1 torrent
    And the Transmission client reports the job:
      | name            | "Field Recordings" |
      | state           | "downloading"      |
      | downloadedBytes | 30000              |
      | uploadedBytes   | 1234               |
      | totalBytes      | 60000              |
      | progress        | 0.5                |
      | downloadRate    | 2048               |
      | uploadRate      | 512                |
      | peers           | 7                  |
      | seeds           | 12                 |
      | leeches         | 40                 |
      | etaSeconds      | 90                 |
      | downloadLimit   | 250000             |
      | uploadLimit     | 0                  |
      | private         | true               |
      | error           | absent             |

  Scenario: a magnet link still waiting for its metadata has no size, progress or privacy to report
    Given the Transmission daemon has a magnet torrent still waiting for its metadata
    When the Transmission client is asked to "look up" the torrent
    Then the Transmission client reports the job:
      | infoHash    | "abcdef0123456789abcdef0123456789abcdef01" |
      | name        | "Night Mix"                                |
      | state       | "metadata"                                 |
      | totalBytes  | absent                                     |
      | progress    | absent                                     |
      | private     | absent                                     |
      | etaSeconds  | absent                                     |
      | seeds       | 0                                          |
      | leeches     | 0                                          |

  Scenario: a failed torrent carries the daemon's explanation
    Given the Transmission daemon has a torrent whose data went missing
    When the Transmission client is asked to "look up" the torrent
    Then the Transmission client reports the job:
      | state | "error"                                                                                                                                                                   |
      | error | "Paused torrent as no data was found! Ensure your drives are connected or use \"Set Location\", then use \"Verify Local Data\" again. To re-download, start the torrent." |

  Scenario: a torrent the daemon does not have is simply not there
    When the Transmission client is asked to "look up" the torrent "1111111111111111111111111111111111111111"
    Then the Transmission client finds no such torrent

  Scenario: with no torrents the list is empty
    When the Transmission client lists the torrents
    Then the Transmission client reports 0 torrents

  Scenario: the files of a folder torrent are listed by their path inside the torrent
    Given the Transmission daemon has the torrent file "Field Recordings"
    And the Transmission daemon holds 5000 bytes of file 1 and skips file 2 at low priority
    When the Transmission client is asked to "list the files of" the torrent
    Then the Transmission client reports the files:
      | index | path              | size  | downloaded | selected | priority |
      | 0     | notes.txt         | 10000 | 0          | yes      | 0        |
      | 1     | day one/dawn.flac | 20000 | 5000       | yes      | 0        |
      | 2     | day two/dusk.flac | 30000 | 0          | no       | -1       |

  Scenario: a torrent that is one file lists that file by its name
    Given the Transmission daemon has the torrent file "night-mix.flac"
    When the Transmission client is asked to "list the files of" the torrent
    Then the Transmission client reports the files:
      | index | path           | size  | downloaded | selected | priority |
      | 0     | night-mix.flac | 40000 | 0          | yes      | 0        |

  Scenario: a magnet link still waiting for its metadata has no files yet
    Given the Transmission daemon has a magnet torrent still waiting for its metadata
    When the Transmission client is asked to "list the files of" the torrent
    Then the Transmission client reports no files

  Scenario Outline: files <files> marked as <change> reach the daemon by their position
    Given the Transmission daemon has the torrent file "Field Recordings"
    When the Transmission client marks files "<files>" of the torrent as <change>
    Then the Transmission client succeeds
    And the Transmission daemon was last asked "torrent-set" with <sent>

    Examples:
      | files | change                  | sent                                       |
      | 0, 2  | skipped                 | {"files-unwanted":[0,2]}                   |
      | 1     | wanted                  | {"files-wanted":[1]}                       |
      | 1     | low priority            | {"priority-low":[1]}                       |
      | 1, 2  | normal priority         | {"priority-normal":[1,2]}                  |
      | 0     | wanted at high priority | {"files-wanted":[0],"priority-high":[0]}   |
      | 2     | skipped at low priority | {"files-unwanted":[2],"priority-low":[2]}  |

  Scenario: what was marked shows in the file list afterwards
    Given the Transmission daemon has the torrent file "Field Recordings"
    When the Transmission client marks files "0" of the torrent as skipped
    And the Transmission client marks files "2" of the torrent as high priority
    And the Transmission client is asked to "list the files of" the torrent
    Then the Transmission client reports the files:
      | index | path              | size  | downloaded | selected | priority |
      | 0     | notes.txt         | 10000 | 0          | no       | 0        |
      | 1     | day one/dawn.flac | 20000 | 0          | yes      | 0        |
      | 2     | day two/dusk.flac | 30000 | 0          | yes      | 1        |

  Scenario Outline: marking files "<files>" as <change> changes nothing, so nothing is sent
    Given the Transmission daemon has the torrent file "Field Recordings"
    When the Transmission client marks files "<files>" of the torrent as <change>
    Then the Transmission client succeeds
    And the Transmission daemon was never asked "torrent-set"

    Examples:
      | files | change    |
      |       | skipped   |
      | 0, 1  | unchanged |

  Scenario Outline: marking files "<files>" as <change> is refused before anything is changed
    Given the Transmission daemon has the torrent file "Field Recordings"
    When the Transmission client marks files "<files>" of the torrent as <change>
    Then the Transmission client fails with "<reason>"
    And the Transmission daemon was never asked "torrent-set"

    Examples:
      | files | change     | reason             |
      | 3     | skipped    | invalid:file-index |
      | -1    | skipped    | invalid:file-index |
      | 1.5   | wanted     | invalid:file-index |
      | 0     | priority 5 | invalid:priority   |

  Scenario: pausing stops a torrent and resuming starts it again
    Given the Transmission daemon is half way through the torrent file "Field Recordings"
    When the Transmission client is asked to "pause" the torrent
    Then the Transmission client succeeds
    And the Transmission daemon holds the torrent "Field Recordings" stopped
    When the Transmission client is asked to "resume" the torrent
    Then the Transmission client succeeds
    And the Transmission daemon holds the torrent "Field Recordings" downloading

  Scenario Outline: to "<action>" a torrent leaves its data <fate>
    Given the Transmission daemon has the torrent file "Field Recordings"
    When the Transmission client is asked to "<action>" the torrent
    Then the Transmission client succeeds
    And the Transmission daemon removed the torrent and <fate> its data
    And the Transmission daemon holds 0 torrents

    Examples:
      | action               | fate    |
      | remove               | kept    |
      | remove with its data | deleted |

  Scenario Outline: limits of <down> and <up> bytes a second reach the daemon in its own kB/s
    Given the Transmission daemon has the torrent file "Field Recordings"
    When the Transmission client limits the torrent to <down> down and <up> up
    Then the Transmission client succeeds
    And the Transmission daemon was last asked "torrent-set" with <sent>

    Examples:
      | down   | up   | sent                                                                              |
      | 250000 | 0    | {"downloadLimited":true,"downloadLimit":250,"uploadLimited":false}                |
      | 1      | 999  | {"downloadLimited":true,"downloadLimit":1,"uploadLimited":true,"uploadLimit":1}   |
      | 1500   | 1001 | {"downloadLimited":true,"downloadLimit":2,"uploadLimited":true,"uploadLimit":2}   |
      | 0      | 0    | {"downloadLimited":false,"uploadLimited":false}                                   |

  Scenario: a limit set on one direction leaves the other alone and reads back in bytes
    Given the Transmission daemon is half way through the torrent file "Field Recordings"
    When the Transmission client limits only the torrent's upload to 64000
    Then the Transmission daemon was last asked "torrent-set" with {"uploadLimited":true,"uploadLimit":64}
    When the Transmission client is asked to "look up" the torrent
    Then the Transmission client reports the job:
      | downloadLimit | 250000 |
      | uploadLimit   | 64000  |

  Scenario: a limit below zero is refused before anything is changed
    Given the Transmission daemon has the torrent file "Field Recordings"
    When the Transmission client limits only the torrent's download to -1
    Then the Transmission client fails with "invalid:limit"
    And the Transmission daemon was never asked "torrent-set"

  Scenario Outline: the daemon would accept a request to "<action>" a torrent it does not have, so kernl checks first
    When the Transmission client is asked to "<action>" the torrent "1111111111111111111111111111111111111111"
    Then the Transmission client fails with "unavailable:not-found"
    And the Transmission daemon was never asked "<method>"

    Examples:
      | action                 | method         |
      | pause                  | torrent-stop   |
      | resume                 | torrent-start  |
      | remove                 | torrent-remove |
      | limit                  | torrent-set    |
      | skip the first file of | torrent-set    |
      | list the files of      | torrent-set    |

  Scenario Outline: "<id>" is not an info hash, so nothing is asked about it
    When the Transmission client is asked to "<action>" the torrent "<id>"
    Then the Transmission client fails with "invalid:info-hash"
    And the Transmission daemon was never asked "torrent-get"

    Examples:
      | action  | id                                       |
      | look up | ABCDEF0123456789ABCDEF0123456789ABCDEF01 |
      | pause   | abcdef                                   |
      | remove  | 7                                        |

  Scenario: an address where nothing listens is unreachable
    Given the Transmission client is pointed at an address where nothing listens
    When the Transmission client probes the program
    Then the Transmission client fails with "unavailable:unreachable"

  Scenario: a daemon that drops the connection is unreachable
    Given the Transmission daemon hangs up on "session-get"
    When the Transmission client probes the program
    Then the Transmission client fails with "unavailable:unreachable"

  Scenario: a daemon that does not answer in time is a timeout
    Given the Transmission client gives up after 200 ms
    And the Transmission daemon goes silent on "session-get"
    When the Transmission client probes the program
    Then the Transmission client fails with "unavailable:timeout"

  Scenario: an answer that stops arriving half way is a timeout
    Given the Transmission client gives up after 200 ms
    And the Transmission daemon stalls while answering "session-get"
    When the Transmission client probes the program
    Then the Transmission client fails with "unavailable:timeout"

  Scenario: an answer that is cut off half way is a bad response
    Given the Transmission daemon breaks off while answering "session-get"
    When the Transmission client probes the program
    Then the Transmission client fails with "unavailable:bad-response"

  Scenario: a change that gets no answer in time may still have happened
    Given the Transmission daemon has the torrent file "Field Recordings"
    And the Transmission client gives up after 200 ms
    And the Transmission daemon goes silent on "torrent-stop"
    When the Transmission client is asked to "pause" the torrent
    Then the Transmission client fails with "unavailable:outcome-unknown"

  Scenario Outline: the daemon answering "<method>" with <status> and <body> is a bad response
    Given the Transmission daemon has the torrent file "Field Recordings"
    And the Transmission daemon answers "<method>" with status <status> and the body <body>
    When the Transmission client is asked to "<action>" the torrent
    Then the Transmission client fails with "unavailable:bad-response"

    Examples:
      | method      | action            | status | body                                                                         |
      | torrent-get | look up           | 500    | <h1>500: Internal Server Error</h1>                                          |
      | torrent-get | look up           | 200    | <h1>200: OK</h1>                                                             |
      | torrent-get | look up           | 200    | ["success"]                                                                  |
      | torrent-get | look up           | 200    | null                                                                         |
      | torrent-get | look up           | 200    | {"jsonrpc":"2.0","result":{"torrents":[]},"id":1}                            |
      | torrent-get | look up           | 200    | {"result":"success"}                                                         |
      | torrent-get | look up           | 200    | {"arguments":{"torrents":{}},"result":"success"}                             |
      | torrent-get | look up           | 200    | {"arguments":{"torrents":["night-mix"]},"result":"success"}                  |
      | torrent-get | look up           | 200    | {"arguments":{"torrents":[{"metadataPercentComplete":"1"}]},"result":"success"} |
      | torrent-get | list the files of | 200    | {"arguments":{"torrents":[{"name":7,"files":[],"fileStats":[]}]},"result":"success"} |

  Scenario Outline: a torrent the daemon names by <named> instead of an info hash is a bad response
    Given the Transmission daemon answers "torrent-add" with status 200 and the body {"arguments":{"torrent-added":{"hashString":"<named>","id":1,"name":"x"}},"result":"success"}
    When the Transmission client adds the torrent file "night-mix.flac"
    Then the Transmission client fails with "unavailable:bad-response"

    Examples:
      | named     |
      | night-mix |
      | abcdef01  |
