Feature: Backend-driven bridges
  Downloads, sharing and mail bridges ship as contracts. Without a backend they
  say so honestly; with one they turn a locator into a job or a conversation.

  Scenario Outline: a bridge without a backend is unavailable and refuses to resolve
    Given the <kind> bridge without a backend
    Then the bridge has id "<id>", label "<label>" and serves "<scheme>"
    And the bridge is unavailable because "no-backend"
    And the bridge exposure is address <address>, encrypted <encrypted>, public <public>
    When the bridge resolves "<uri>"
    Then bridge resolution fails with "unavailable:no-backend"

    Examples:
      | kind     | id       | label     | scheme | address | encrypted | public | uri                                                        |
      | torrent  | torrent  | downloads | magnet | yes     | no        | yes    | magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01 |
      | nzb      | nzb      | downloads | nzb    | yes     | yes       | no     | https://indexer.example/get/1.nzb                          |
      | soulseek | soulseek | sharing   | slsk   | yes     | no        | yes    | slsk://ada/Music/01.flac                                   |
      | mail     | mail     | mail      | mailto | no      | yes       | no     | mailto:ada@example.com                                     |

  Scenario: the torrent bridge hands the hash and trackers to its backend
    Given the torrent bridge with a fake backend
    Then the bridge is available
    When the bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix&tr=udp%3A%2F%2Ft.example"
    Then bridge resolution yields a job "job-1" labelled "Mix"
    And the backend was called with "abcdef0123456789abcdef0123456789abcdef01" and "udp://t.example"

  Scenario: the nzb bridge hands the document URL to its backend
    Given the nzb bridge with a fake backend
    When the bridge resolves "nzb://https%3A%2F%2Findexer.example%2Fget%2F1.nzb"
    Then bridge resolution yields a job "job-1" labelled "1.nzb"
    And the backend was called with "https://indexer.example/get/1.nzb"

  Scenario: the sharing bridge hands user and path to its backend
    Given the soulseek bridge with a fake backend
    When the bridge resolves "slsk://ada/Music/01.flac"
    Then bridge resolution yields a job "job-1" labelled "01.flac"
    And the backend was called with "ada" and "Music/01.flac"

  Scenario: the mail bridge opens a conversation with every address
    Given the mail bridge with a fake backend
    When the bridge resolves "mailto:ada@example.com,grace@example.com?subject=Hello"
    Then bridge resolution yields a conversation "conv-1" with "ada@example.com, grace@example.com"
    And the backend was called with "ada@example.com,grace@example.com" and "Hello"

  Scenario: the mail bridge passes no subject when the locator has none
    Given the mail bridge with a fake backend
    When the bridge resolves "mailto:ada@example.com"
    Then the backend was called with "ada@example.com" and no subject

  Scenario: a locator with only a hash yields no trackers
    Given the torrent bridge with a fake backend
    When the bridge resolves a magnet locator with only its hash
    Then the backend was called with "abcdef0123456789abcdef0123456789abcdef01" and ""

  Scenario: a locator missing a required field is rejected before the backend is called
    Given the torrent bridge with a fake backend
    When the bridge resolves a magnet locator stripped of its hash
    Then bridge resolution fails with "invalid:locator-missing-infoHash"
    And the backend was not called
