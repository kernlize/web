Feature: Downloads inside kernl
  A magnet link downloads inside the shell page through a WebTorrent client. A page can
  reach peers only over WebRTC, so the backend keeps the link's secure-socket trackers,
  adds the default WebRTC trackers and drops the rest (D-017). It carries no hand-off
  trait, so the bridge describes the transfer as kernl's own.

  Background:
    Given a download backend over a fake client announcing to "wss://d.example"

  Scenario: a magnet link becomes a download with only reachable trackers
    Then the bridge is available
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night%20Mix&tr=udp%3A%2F%2Ft.example%3A80&tr=WSS%3A%2F%2Fw.example&tr=wss%3A%2F%2Fd.example"
    Then bridge resolution yields a job "download:1" labelled "Night Mix"
    And the fake client was asked to add "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Night%20Mix&tr=WSS%3A%2F%2Fw.example&tr=wss%3A%2F%2Fd.example"
    And the downloads are
      | id         | name      | infoHash | state      | progress | received | size | peers | speed | error |
      | download:1 | Night Mix | abcdef0123456789abcdef0123456789abcdef01       | connecting | 0        | 0        | -    | 0     | 0     | -     |

  Scenario: a link without a name is named by its hash until the swarm says otherwise
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    Then bridge resolution yields a job "download:1" labelled "abcdef0123456789abcdef0123456789abcdef01"
    And the fake client was asked to add "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&tr=wss%3A%2F%2Fd.example"
    When torrent 1 learns it is "film.mkv" of 1000 bytes
    Then the downloads are
      | name     | size | progress |
      | film.mkv | 1000 | 0        |

  Scenario: progress, peers and completion
    Given a downloads listener
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And torrent 1 learns it is "film.mkv" of 1000 bytes
    And torrent 1 meets 2 peers
    And torrent 1 has received 250 bytes at 100 bytes per second
    Then the downloads are
      | state       | progress | received | peers | speed |
      | downloading | 0.25     | 250      | 2     | 100   |
    When torrent 1 finishes
    Then the downloads are
      | state | progress | received | speed |
      | done  | 1        | 1000     | 0     |
    And the downloads listener heard 6 updates

  Scenario: progress is reported at most twice a second
    Given a downloads listener
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And torrent 1 has received 10 bytes at 10 bytes per second
    And torrent 1 has received 20 bytes at 10 bytes per second
    And the clock reads 499
    And torrent 1 has received 30 bytes at 10 bytes per second
    And the clock reads 500
    And torrent 1 has received 40 bytes at 10 bytes per second
    Then the downloads listener heard 4 updates
    When the downloads listener stops
    And torrent 1 meets 1 peers
    Then the downloads listener heard 4 updates

  Scenario: the same link twice is one download
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix"
    And the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Other"
    Then bridge resolution yields a job "download:1" labelled "Mix"
    And the fake client was asked to add "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Mix&tr=wss%3A%2F%2Fd.example"

  Scenario: pausing and resuming
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And torrent 1 meets 3 peers
    And torrent 1 has received 5 bytes at 50 bytes per second
    And the user pauses download "download:1"
    Then torrent 1 was told to pause
    And the downloads are
      | state  | speed |
      | paused | 0     |
    When the user resumes download "download:1"
    Then torrent 1 was told to resume
    And the downloads are
      | state       | speed |
      | downloading | 50    |

  Scenario: removing a download drops what it stored
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And the user removes download "download:1"
    Then the download action succeeds
    And there are no downloads
    And torrent 1 was removed with its stored data

  Scenario: a client that fails to remove still leaves the list
    Given the fake client fails to remove downloads
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And the user removes download "download:1"
    Then the download action succeeds
    And there are no downloads

  Scenario: a finished download hands over its files
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And torrent 1 learns it is "song.flac" of 12 bytes
    And the user saves download "download:1"
    Then the download action fails with "unavailable:not-finished"
    When torrent 1 finishes
    And the user saves download "download:1"
    Then the saved files are
      | name      | size | text               |
      | song.flac | 12   | bytes of song.flac |

  Scenario Outline: an unknown download is refused
    When the user <action> download "download:9"
    Then the download action fails with "denied:unknown-download"

    Examples:
      | action  |
      | pauses  |
      | resumes |
      | removes |
      | saves   |

  Scenario Outline: a download that fails says why
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And torrent 1 <failure>
    Then the downloads are
      | state  | error   |
      | failed | <error> |

    Examples:
      | failure                  | error        |
      | fails with "no metadata" | no metadata  |
      | fails with a bare string | wire dropped |

  Scenario: a malformed hash is refused before the client loads
    Given a download backend that loads a fake client announcing to ""
    When the download backend adds the hash "not-a-hash"
    Then the download action fails with "invalid:info-hash"
    And the fake client was loaded 0 times

  Scenario: the client loads on the first download, once
    Given a download backend that loads a fake client announcing to ""
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And the download backend adds the hash "abcdef0123456789abcdef0123456789abcdef01"
    Then the fake client was loaded 1 time
    And the fake client was asked to add "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01"

  Scenario: a client that fails to load is tried again on the next download
    Given a download backend whose client fails to load once with "no peer connections in this browser"
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    Then bridge resolution fails with "unavailable:no peer connections in this browser"
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    Then bridge resolution yields a job "download:1" labelled "abcdef0123456789abcdef0123456789abcdef01"
    And the fake client was loaded 2 times

  Scenario: a loader that rejects with a bare string
    Given a download backend whose client fails to load with a bare string
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    Then bridge resolution fails with "unavailable:no peers here"

  Scenario: a client that refuses a download
    Given the fake client refuses new downloads with "client is destroyed"
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    Then bridge resolution fails with "unavailable:client is destroyed"
    And there are no downloads

  Scenario: the defaults announce to public WebRTC trackers and report progress
    Given a download backend with default options
    And a downloads listener
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And torrent 1 has received 1 bytes at 1 bytes per second
    Then the fake client was asked to add "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&tr=wss%3A%2F%2Ftracker.openwebtorrent.com&tr=wss%3A%2F%2Ftracker.webtorrent.dev&tr=wss%3A%2F%2Ftracker.btorrent.xyz"
    And the downloads listener heard 3 updates
    And the reachable trackers of "udp://t.example, wss://t.example" are "wss://t.example, wss://tracker.openwebtorrent.com, wss://tracker.webtorrent.dev, wss://tracker.btorrent.xyz"

  Scenario: an in-kernl download is described as kernl's own
    Then describing the bridge gives
      | label                       | value     |
      | Used for                    | downloads |
      | Status                      | ready     |
      | Shares your network address | yes       |
      | Encrypted in transit        | no        |
      | Activity visible to others  | yes       |
    And no description label names a protocol
