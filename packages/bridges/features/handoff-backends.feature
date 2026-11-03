Feature: Hand-off backends
  Downloads, sharing and mail work today by handing the locator to an app on the
  user's device. Each backend rebuilds the canonical address from what kernl parsed
  and opens it exactly once; kernl itself connects to nothing.

  Scenario Outline: a hand-off bridge opens the canonical address once
    Given the <kind> bridge with hand-off backends
    Then the bridge is available by handing off to the device
    When the bridge resolves "<uri>"
    Then the device was asked to open "<opened>" once
    And bridge resolution yields a job "handoff:1" labelled "<label>"

    Examples:
      | kind     | uri                                                                                                  | opened                                                                                          | label                                    |
      | torrent  | magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night%20Mix&tr=udp%3A%2F%2Ft.example&ws=https%3A%2F%2Fw.example | magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Night%20Mix&tr=udp%3A%2F%2Ft.example | Night Mix                                |
      | torrent  | magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01                                         | magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01                                    | abcdef0123456789abcdef0123456789abcdef01 |
      | soulseek | slsk://ada%20l/Music/01%20Intro.flac                                                                 | slsk://ada%20l/Music/01%20Intro.flac                                                            | 01 Intro.flac                            |
      | soulseek | slsk://ada//                                                                                         | slsk://ada//                                                                                    | ada                                      |
      | nzb      | https://indexer.example/get/1.nzb                                                                    | https://indexer.example/get/1.nzb                                                               | 1.nzb                                    |
      | nzb      | nzb://https%3A%2F%2Findexer.example%2F                                                               | https://indexer.example/                                                                        | indexer.example                          |

  Scenario: the mail bridge opens a message with subject and body
    Given the mail bridge with hand-off backends
    Then the bridge is available by handing off to the device
    When the bridge resolves "mailto:ada@example.com,grace@example.com?subject=Hello%20there&body=See%20you%20%26%20bye"
    Then the device was asked to open "mailto:ada@example.com,grace@example.com?subject=Hello%20there&body=See%20you%20%26%20bye" once
    And bridge resolution yields a conversation "handoff:1" with "ada@example.com, grace@example.com"

  Scenario: the mail bridge opens a bare address
    Given the mail bridge with hand-off backends
    When the bridge resolves "mailto:ada@example.com"
    Then the device was asked to open "mailto:ada@example.com" once

  Scenario: hand-offs share one counter
    Given the torrent bridge with hand-off backends
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    Then bridge resolution yields a job "handoff:2" labelled "abcdef0123456789abcdef0123456789abcdef01"

  Scenario: an NZB served without encryption is not handed off
    Given the nzb bridge with hand-off backends
    When the bridge resolves "http://indexer.example/get/1.nzb"
    Then bridge resolution fails with "invalid:nzb-not-https"
    And the device was not asked to open anything

  Scenario: an opener that waits is awaited before the job is reported
    Given the mail bridge with hand-off backends whose opener waits
    When the bridge resolves "mailto:ada@example.com"
    Then bridge resolution yields a conversation "handoff:1" with "ada@example.com"

  Scenario: a hand-off bridge says it opens an app on the device and sends nothing through kernl
    Given the soulseek bridge with hand-off backends
    Then describing the bridge gives
      | label                       | value                 |
      | Used for                    | sharing               |
      | Status                      | ready                 |
      | Handled by                  | an app on your device |
      | Sent through kernl          | no                    |
      | Shares your network address | yes                   |
      | Encrypted in transit        | no                    |
      | Activity visible to others  | yes                   |
    And no description label names a protocol
