Feature: uTorrent client
  A person who already runs uTorrent can let kernl drive it through the program's
  WebUI. That interface says little: it hands out a token that must come back with a
  cookie, lists torrents as bare rows, and does not say what an added torrent is
  called. kernl fills the gaps by working out the info hash itself and by looking
  again, and reports every torrent in its own words.

  Background:
    Given a uTorrent that asks for the name "ada" and password "s3cret-pass"
    And the uTorrent client signs in as "ada" with password "s3cret-pass"

  Scenario: the first request fetches a token and every request carries it with its cookie
    When the uTorrent client probes the program
    Then the uTorrent client reports version "30470"
    And the uTorrent handed out 1 token
    And every uTorrent request carried its token first and the cookie that came with it

  Scenario: one token serves every later request
    When the uTorrent client probes the program
    And the uTorrent client lists the torrents
    Then the uTorrent client reports 0 torrents
    And the uTorrent handed out 1 token

  Scenario: a token the program has forgotten is replaced and the request sent again
    When the uTorrent client probes the program
    And the uTorrent is started again
    And the uTorrent client probes the program
    Then the uTorrent client reports version "30470"
    And the uTorrent handed out 2 tokens

  Scenario: a program that sets no cookie is sent none
    Given the uTorrent sets no cookie with its token
    When the uTorrent client probes the program
    Then the uTorrent client reports version "30470"
    And no uTorrent request carried a cookie

  Scenario Outline: a token page answering <status> with <body> is a bad response
    Given the uTorrent answers "token" with status <status> and the body <body>
    When the uTorrent client probes the program
    Then the uTorrent client fails with "unavailable:bad-response"

    Examples:
      | status | body                               |
      | 200    | <html><div id='other'></div></html> |
      | 404    | invalid request                    |

  Scenario: a program that keeps refusing the token is a bad response
    Given the uTorrent answers "list" with status 400 and the body invalid request
    When the uTorrent client probes the program
    Then the uTorrent client fails with "unavailable:bad-response"
    And the uTorrent handed out 2 tokens

  Scenario Outline: a wrong name or password is refused, and the password is never repeated
    Given the uTorrent client signs in as "<name>" with password "<password>"
    When the uTorrent client probes the program
    Then the uTorrent client fails with "denied:credentials"

    Examples:
      | name | password    |
      | ada  | wrong-pass  |
      | eve  | s3cret-pass |

  Scenario: a client with no name or password is refused
    Given the uTorrent client signs in with nothing
    When the uTorrent client probes the program
    Then the uTorrent client fails with "denied:credentials"

  Scenario Outline: the address the person typed leads to the WebUI
    Given the uTorrent client uses the program's address followed by "<typed>"
    When the uTorrent client probes the program
    Then the uTorrent client reports version "30470"

    Examples:
      | typed  |
      |        |
      | /      |
      | /gui   |
      | /gui/  |

  Scenario: a host that supplies its own fetch has every request go through it
    Given the uTorrent client is given its host's own fetch
    When the uTorrent client probes the program
    Then the uTorrent client reports version "30470"
    And the uTorrent client's requests all went through its host's fetch

  Scenario: a magnet link is named by its info hash once the program lists it
    When the uTorrent client adds the magnet link "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night+Mix"
    Then the uTorrent client names the torrent "abcdef0123456789abcdef0123456789abcdef01"
    And the uTorrent was asked to fetch exactly "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night+Mix"
    And the uTorrent holds the torrent "Night Mix" running
    And the uTorrent requests ran in the order "list, add-url, list"

  Scenario: a magnet link that names its hash in base32 is found under the same hash in hex
    When the uTorrent client adds the magnet link "magnet:?xt=urn:btih:VPG66AJDIVTYTK6N54ASGRLHRGV433YB&dn=Night+Mix"
    Then the uTorrent client names the torrent "abcdef0123456789abcdef0123456789abcdef01"
    And the uTorrent holds the torrent "Night Mix" running

  Scenario: a magnet link written in capitals is still handed over as a magnet link
    When the uTorrent client adds the magnet link "MAGNET:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01"
    Then the uTorrent client names the torrent "abcdef0123456789abcdef0123456789abcdef01"
    And the uTorrent was asked to fetch exactly "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01"

  Scenario: the program has no way to add a torrent paused, so it is stopped as soon as it is listed
    When the uTorrent client adds the magnet link "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Night+Mix" paused
    Then the uTorrent client names the torrent "abcdef0123456789abcdef0123456789abcdef01"
    And the uTorrent holds the torrent "Night Mix" stopped
    And the uTorrent requests ran in the order "list, add-url, list, stop"

  Scenario: a torrent told to start at once is left as the program started it
    When the uTorrent client adds the magnet link "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Night+Mix" to start at once
    Then the uTorrent holds the torrent "Night Mix" running
    And the uTorrent was never asked "stop"

  Scenario: a torrent file is uploaded whole and named by the SHA-1 of its info dictionary
    When the uTorrent client adds the torrent file "Field Recordings"
    Then the uTorrent client names the torrent file "Field Recordings" by the SHA-1 of its info dictionary
    And the uTorrent received the torrent file "Field Recordings" byte for byte as the upload "torrent_file"
    And the uTorrent holds the torrent "Field Recordings" running

  Scenario: a torrent the program already has is found without being sent again
    Given the uTorrent has the torrent file "Field Recordings" stopped
    When the uTorrent client adds the torrent file "Field Recordings" paused
    Then the uTorrent client names the torrent file "Field Recordings" by the SHA-1 of its info dictionary
    And the uTorrent was never asked "add-file"
    And the uTorrent was never asked "stop"

  Scenario: a torrent that takes a moment to show up is waited for
    Given the uTorrent shows a torrent it was sent only after 400 ms
    When the uTorrent client adds the torrent file "night-mix.flac"
    Then the uTorrent client names the torrent file "night-mix.flac" by the SHA-1 of its info dictionary
    And the uTorrent holds 1 torrent

  Scenario: a torrent that never shows up may or may not have been added
    Given the uTorrent client gives up after 400 ms
    And the uTorrent never shows a torrent it was sent
    When the uTorrent client adds the torrent file "night-mix.flac"
    Then the uTorrent client fails with "unavailable:outcome-unknown"

  Scenario: a list that cannot be read after sending leaves the outcome unknown
    Given the uTorrent hangs up on its 2nd "list" request
    When the uTorrent client adds the torrent file "night-mix.flac"
    Then the uTorrent client fails with "unavailable:outcome-unknown"

  Scenario: an add that gets no answer in time may still have happened
    Given the uTorrent client gives up after 200 ms
    And the uTorrent goes silent on "add-url"
    When the uTorrent client adds the magnet link "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01"
    Then the uTorrent client fails with "unavailable:outcome-unknown"

  Scenario: a torrent the program will not take is reported as declined, in the program's words
    Given the uTorrent answers "add-file" with status 200 and the body {"build":30470,"error":"Can't add torrent: torrent is not valid bencoding"}
    When the uTorrent client adds the torrent file "night-mix.flac"
    Then the uTorrent client fails with "unavailable:rejected: Can't add torrent: torrent is not valid bencoding"

  Scenario Outline: what is not a torrent is refused before anything is sent
    When the uTorrent client adds the <kind> "<what>"
    Then the uTorrent client fails with "<reason>"
    And the uTorrent was asked nothing at all

    Examples:
      | kind         | what                             | reason           |
      | magnet link  | https://example.com/file.torrent | invalid:magnet   |
      | magnet link  | magnet:?dn=only-a-name           | invalid:magnet   |
      | torrent file | broken                           | invalid:metainfo |

  Scenario Outline: the program's status <status> at <progress> per mille of <size> bytes is the job state <state>
    Given the uTorrent has a torrent with status <status>, size <size> and progress <progress> per mille
    When the uTorrent client is asked to "look up" the torrent
    Then the uTorrent client reports the torrent as "<state>"

    Examples:
      | status | size  | progress | state       |
      | 201    | 40000 | 500      | downloading |
      | 201    | 40000 | 1000     | seeding     |
      | 137    | 40000 | 1000     | seeding     |
      | 201    | 0     | 0        | metadata    |
      | 233    | 40000 | 500      | paused      |
      | 233    | 40000 | 1000     | paused      |
      | 136    | 40000 | 500      | paused      |
      | 136    | 40000 | 1000     | complete    |
      | 200    | 40000 | 500      | queued      |
      | 200    | 40000 | 1000     | complete    |
      | 128    | 40000 | 1000     | paused      |
      | 130    | 40000 | 1000     | queued      |
      | 203    | 40000 | 1000     | queued      |
      | 152    | 40000 | 1000     | error       |
      | 217    | 40000 | 500      | error       |

  Scenario: a downloading torrent is reported in bytes, with its limits and privacy from its properties
    Given the uTorrent is half way through the torrent file "Field Recordings"
    When the uTorrent client lists the torrents
    Then the uTorrent client reports 1 torrent
    And the uTorrent client reports the job:
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

  Scenario: a public torrent is reported as not private
    Given the uTorrent has the torrent file "night-mix.flac"
    When the uTorrent client is asked to "look up" the torrent
    Then the uTorrent client reports the job:
      | private       | false  |
      | downloadLimit | 0      |
      | etaSeconds    | absent |

  Scenario: a magnet link still waiting for its metadata has no size or progress to report
    Given the uTorrent has a magnet torrent still waiting for its metadata
    When the uTorrent client is asked to "look up" the torrent
    Then the uTorrent client reports the job:
      | infoHash   | "abcdef0123456789abcdef0123456789abcdef01" |
      | name       | "Night Mix"                                |
      | state      | "metadata"                                 |
      | totalBytes | absent                                     |
      | progress   | absent                                     |

  Scenario: a program that says nothing about properties leaves limits at none and privacy unknown
    Given the uTorrent is half way through the torrent file "Field Recordings"
    And the uTorrent answers nothing about torrent properties
    When the uTorrent client is asked to "look up" the torrent
    Then the uTorrent client reports the job:
      | state         | "downloading" |
      | downloadLimit | 0             |
      | uploadLimit   | 0             |
      | private       | absent        |

  Scenario: a failed torrent carries the program's own status line when it sends one
    Given the uTorrent has a torrent in error saying "Error: Files missing from job. Please recheck."
    When the uTorrent client is asked to "look up" the torrent
    Then the uTorrent client reports the job:
      | state | "error"                                          |
      | error | "Error: Files missing from job. Please recheck." |

  Scenario: a failed torrent from a program that sends no status line is still explained
    Given the uTorrent has a torrent in error without saying why
    When the uTorrent client is asked to "look up" the torrent
    Then the uTorrent client reports the job:
      | state | "error"                                      |
      | error | "uTorrent reports an error for this torrent" |

  Scenario: a long list has its properties asked for in batches
    Given the uTorrent has 45 torrents
    When the uTorrent client lists the torrents
    Then the uTorrent client reports 45 torrents
    And the uTorrent was asked "getprops" 2 times

  Scenario: a torrent the program does not have is simply not there
    When the uTorrent client is asked to "look up" the torrent "1111111111111111111111111111111111111111"
    Then the uTorrent client finds no such torrent

  Scenario: the files of a folder torrent are listed by their path inside the torrent
    Given the uTorrent has the torrent file "Field Recordings"
    And the uTorrent holds 5000 bytes of file 1, skips file 2 and has file 0 at high priority
    When the uTorrent client is asked to "list the files of" the torrent
    Then the uTorrent client reports the files:
      | index | path              | size  | downloaded | selected | priority |
      | 0     | notes.txt         | 10000 | 0          | yes      | 1        |
      | 1     | day one/dawn.flac | 20000 | 5000       | yes      | 0        |
      | 2     | day two/dusk.flac | 30000 | 0          | no       | 0        |

  Scenario: a low priority file is reported as such
    Given the uTorrent has the torrent file "night-mix.flac"
    And the uTorrent has file 0 of the torrent at low priority
    When the uTorrent client is asked to "list the files of" the torrent
    Then the uTorrent client reports the files:
      | index | path           | size  | downloaded | selected | priority |
      | 0     | night-mix.flac | 40000 | 0          | yes      | -1       |

  Scenario: a magnet link still waiting for its metadata has no files yet
    Given the uTorrent has a magnet torrent still waiting for its metadata
    When the uTorrent client is asked to "list the files of" the torrent
    Then the uTorrent client reports no files

  Scenario: the files of a torrent the program does not have are not found from the files answer alone
    When the uTorrent client is asked to "list the files of" the torrent "1111111111111111111111111111111111111111"
    Then the uTorrent client fails with "unavailable:not-found"
    And the uTorrent was never asked "list"

  Scenario Outline: files <files> marked as <change> reach the program as one priority change
    Given the uTorrent has the torrent file "Field Recordings"
    And the uTorrent holds 0 bytes of file 0, skips file 1 and has file 2 at high priority
    When the uTorrent client marks files "<files>" of the torrent as <change>
    Then the uTorrent client succeeds
    And the uTorrent was last asked "setprio" with <sent>

    Examples:
      | files   | change                  | sent         |
      | 0, 2    | skipped                 | p=0&f=0&f=2  |
      | 1       | wanted                  | p=2&f=1      |
      | 0, 1, 2 | wanted                  | p=2&f=1      |
      | 0, 1    | low priority            | p=1&f=0      |
      | 0, 2    | normal priority         | p=2&f=2      |
      | 0, 1    | wanted at high priority | p=3&f=0&f=1  |
      | 2       | skipped at low priority | p=0&f=2      |
      | 0, 0    | skipped                 | p=0&f=0      |

  Scenario: what was marked shows in the file list afterwards
    Given the uTorrent has the torrent file "Field Recordings"
    When the uTorrent client marks files "0" of the torrent as skipped
    And the uTorrent client marks files "2" of the torrent as high priority
    And the uTorrent client is asked to "list the files of" the torrent
    Then the uTorrent client reports the files:
      | index | path              | size  | downloaded | selected | priority |
      | 0     | notes.txt         | 10000 | 0          | no       | 0        |
      | 1     | day one/dawn.flac | 20000 | 0          | yes      | 0        |
      | 2     | day two/dusk.flac | 30000 | 0          | yes      | 1        |

  Scenario Outline: marking files "<files>" as <change> changes nothing, so nothing is sent
    Given the uTorrent has the torrent file "Field Recordings"
    And the uTorrent holds 0 bytes of file 0, skips file 1 and has file 2 at high priority
    When the uTorrent client marks files "<files>" of the torrent as <change>
    Then the uTorrent client succeeds
    And the uTorrent was never asked "setprio"

    Examples:
      | files | change        |
      |       | skipped       |
      | 0, 2  | unchanged     |
      | 0, 2  | wanted        |
      | 1     | skipped       |
      | 1     | high priority |
      | 2     | high priority |

  Scenario Outline: marking files "<files>" as <change> is refused before anything is changed
    Given the uTorrent has the torrent file "Field Recordings"
    When the uTorrent client marks files "<files>" of the torrent as <change>
    Then the uTorrent client fails with "<reason>"
    And the uTorrent was never asked "setprio"

    Examples:
      | files | change     | reason             |
      | 3     | skipped    | invalid:file-index |
      | -1    | skipped    | invalid:file-index |
      | 1.5   | wanted     | invalid:file-index |
      | 0     | priority 5 | invalid:priority   |

  Scenario: pausing stops a torrent and resuming starts it again
    Given the uTorrent has the torrent file "Field Recordings"
    When the uTorrent client is asked to "pause" the torrent
    Then the uTorrent client succeeds
    And the uTorrent holds the torrent "Field Recordings" stopped
    When the uTorrent client is asked to "resume" the torrent
    Then the uTorrent client succeeds
    And the uTorrent holds the torrent "Field Recordings" running
    And the uTorrent was asked "start" 1 time

  Scenario: a torrent held by the program's own pause is resumed by lifting that pause
    Given the uTorrent has the torrent file "Field Recordings" paused by its own pause
    When the uTorrent client is asked to "resume" the torrent
    Then the uTorrent client succeeds
    And the uTorrent holds the torrent "Field Recordings" running
    And the uTorrent was asked "unpause" 1 time
    And the uTorrent was never asked "start"

  Scenario Outline: to "<action>" a torrent leaves its data <fate>
    Given the uTorrent has the torrent file "Field Recordings"
    When the uTorrent client is asked to "<action>" the torrent
    Then the uTorrent client succeeds
    And the uTorrent removed the torrent and <fate> its data
    And the uTorrent holds 0 torrents

    Examples:
      | action               | fate    |
      | remove               | kept    |
      | remove with its data | deleted |

  Scenario: limits are set in bytes a second, as the program counts them
    Given the uTorrent has the torrent file "Field Recordings"
    When the uTorrent client limits the torrent to 250000 down and 64000 up
    Then the uTorrent client succeeds
    And the uTorrent was last asked "setprops" with s=dlrate&v=250000&s=ulrate&v=64000
    And the uTorrent limits the torrent to 250000 down and 64000 up

  Scenario: a limit of zero removes the torrent's own limit, and one direction can be set alone
    Given the uTorrent is half way through the torrent file "Field Recordings"
    When the uTorrent client limits only the torrent's download to 0
    Then the uTorrent was last asked "setprops" with s=dlrate&v=0
    When the uTorrent client limits only the torrent's upload to 5000
    Then the uTorrent limits the torrent to 0 down and 5000 up
    When the uTorrent client is asked to "look up" the torrent
    Then the uTorrent client reports the job:
      | downloadLimit | 0    |
      | uploadLimit   | 5000 |

  Scenario: setting no limit sends nothing
    Given the uTorrent has the torrent file "Field Recordings"
    When the uTorrent client sets no limit on the torrent
    Then the uTorrent client succeeds
    And the uTorrent was never asked "setprops"

  Scenario: a limit below zero is refused before anything is asked
    Given the uTorrent has the torrent file "Field Recordings"
    When the uTorrent client limits only the torrent's download to -1
    Then the uTorrent client fails with "invalid:limit"
    And the uTorrent was asked nothing at all

  Scenario Outline: to "<action>" a torrent the program does not have is not found
    When the uTorrent client is asked to "<action>" the torrent "1111111111111111111111111111111111111111"
    Then the uTorrent client fails with "unavailable:not-found"
    And the uTorrent was never asked "<never>"

    Examples:
      | action                 | never    |
      | pause                  | stop     |
      | resume                 | start    |
      | remove                 | remove   |
      | limit                  | setprops |
      | skip the first file of | setprio  |
      | list the files of      | setprio  |

  Scenario Outline: "<id>" is not an info hash, so nothing is asked about it
    When the uTorrent client is asked to "<action>" the torrent "<id>"
    Then the uTorrent client fails with "invalid:info-hash"
    And the uTorrent was asked nothing at all

    Examples:
      | action            | id                                       |
      | look up           | ABCDEF0123456789ABCDEF0123456789ABCDEF01 |
      | pause             | abcdef                                   |
      | list the files of | 7                                        |

  Scenario: an address where nothing listens is unreachable
    Given the uTorrent client is pointed at an address where nothing listens
    When the uTorrent client probes the program
    Then the uTorrent client fails with "unavailable:unreachable"

  Scenario: a program that drops the connection is unreachable
    Given the uTorrent hangs up on "list"
    When the uTorrent client probes the program
    Then the uTorrent client fails with "unavailable:unreachable"

  Scenario Outline: a program that does not answer "<request>" in time is a timeout
    Given the uTorrent client gives up after 200 ms
    And the uTorrent <fault> "<request>"
    When the uTorrent client probes the program
    Then the uTorrent client fails with "unavailable:timeout"

    Examples:
      | fault                  | request |
      | goes silent on         | token   |
      | goes silent on         | list    |
      | stalls while answering | list    |
      | stalls while answering | token   |

  Scenario: an answer that is cut off half way is a bad response
    Given the uTorrent breaks off while answering "list"
    When the uTorrent client probes the program
    Then the uTorrent client fails with "unavailable:bad-response"

  Scenario: a change that gets no answer in time may still have happened
    Given the uTorrent has the torrent file "Field Recordings"
    And the uTorrent client gives up after 200 ms
    And the uTorrent goes silent on "stop"
    When the uTorrent client is asked to "pause" the torrent
    Then the uTorrent client fails with "unavailable:outcome-unknown"

  Scenario Outline: the program answering "<request>" with <status> and <body> is a bad response
    Given the uTorrent has the torrent file "Field Recordings"
    And the uTorrent answers "<request>" with status <status> and the body <body>
    When the uTorrent client is asked to "<action>" the torrent
    Then the uTorrent client fails with "unavailable:bad-response"

    Examples:
      | request  | action            | status | body                                                   |
      | list     | look up           | 500    | Internal Server Error                                  |
      | list     | look up           | 200    | <html>WebUI</html>                                     |
      | list     | look up           | 200    | []                                                     |
      | list     | look up           | 200    | {"build":30470}                                        |
      | list     | look up           | 200    | {"build":30470,"torrents":["night-mix"]}               |
      | list     | look up           | 200    | {"build":30470,"torrents":[["night-mix",201]]}         |
      | list     | look up           | 200    | {"build":30470,"torrents":[[7,201]]}                   |
      | getprops | look up           | 200    | {"build":30470,"props":[{"hash":"night-mix"}]}         |
      | getprops | look up           | 200    | {"build":30470,"props":{}}                             |
      | getfiles | list the files of | 200    | {"build":30470,"files":["ABCDEF"]}                     |
      | getfiles | list the files of | 200    | {"build":30470,"files":["ABCDEF",[["a.txt","1",0,2]]]} |

  Scenario: a program that does not say which build it is cannot be probed
    Given the uTorrent answers "list" with status 200 and the body {"torrents":[]}
    When the uTorrent client probes the program
    Then the uTorrent client fails with "unavailable:bad-response"
