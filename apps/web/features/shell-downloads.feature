Feature: Downloads in the shell
  Links from peers download inside kernl by default where the browser can reach peers.
  Opening them in an app on the device stays a choice the user makes in Settings, and
  the choice is remembered (D-017). The preview downloads from nobody.

  Scenario: kernl downloads by default where the browser can reach peers
    Given shell downloads where the browser can reach peers
    Then shell downloads go to "kernl"
    And the downloads bridge is ready in kernl
    When the downloads bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix"
    Then the downloads bridge yields "download:1" and the device opened nothing
    And the shell has 1 download

  Scenario: the user chooses an app on the device, and kernl remembers
    Given shell downloads where the browser can reach peers
    When the user sends downloads to "device"
    Then shell downloads go to "device"
    And the downloads bridge hands off to the device
    And the stored download choice is "device"
    When the downloads bridge resolves "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix"
    Then the downloads bridge yields "handoff:1" and the device opened 1 link
    And the shell has 0 downloads
    When shell downloads start again over the same storage
    Then shell downloads go to "device"
    When the user sends downloads to "kernl"
    Then shell downloads go to "kernl"

  Scenario: a browser that cannot reach peers can only hand off
    Given shell downloads where the browser cannot reach peers
    Then shell downloads go to "device"
    When the user sends downloads to "kernl"
    Then shell downloads go to "device"
    And the stored download choice is "device"

  Scenario Outline: whether the browser can reach peers
    Then <browser> can reach peers: <answer>

    Examples:
      | browser                            | answer |
      | a browser with peer connections    | yes    |
      | a browser without peer connections | no     |
      | the test runner                    | no     |

  Scenario: a preview download fills in and hands over a text file
    Given a preview download client
    When the preview client adds "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night%20Mix"
    Then the preview download is "-" at 0 bytes with 0 peers
    When the preview clock ticks 1 time
    Then the preview download is "Night Mix" at 0 bytes with 3 peers
    When the preview clock ticks 4 times
    Then the preview download is "Night Mix" at 32768 bytes with 3 peers
    When the preview download is paused
    And the preview clock ticks 4 times
    Then the preview download is "Night Mix" at 32768 bytes with 3 peers
    When the preview download is resumed
    And the preview download is resumed
    And the preview clock ticks 4 times
    Then the preview download is finished with "Night Mix.txt" reading "This file came from the kernl preview"
    When the preview download is resumed
    And the preview clock ticks 2 times
    Then the preview download is finished with "Night Mix.txt" reading "Nothing left your device"

  Scenario: a preview link without a name, removed before it finishes
    Given a preview download client
    When the preview client adds "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    And the preview clock ticks 1 time
    Then the preview download is "Sample download" at 0 bytes with 3 peers
    When the preview client removes the download
    And the preview clock ticks 3 times
    Then the preview download is "Sample download" at 0 bytes with 3 peers

  Scenario: the preview client runs on the page clock by default
    Given a preview download client on the page clock
    When the preview client adds "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Clocked"
    And 400 milliseconds pass on the page clock
    Then the preview download is "Clocked" at 0 bytes with 3 peers
    When the preview client removes the download
    And 4000 milliseconds pass on the page clock
    Then the preview download is "Clocked" at 0 bytes with 3 peers

  Scenario Outline: a download reads as one plain line
    Given a download that is "<state>" with <received> of <size> bytes from <peers> peers at <speed> bytes a second
    Then the download reads "<words>"

    Examples:
      | state       | received   | size       | peers | speed   | words                                                   |
      | connecting  | 0          | -          | 0     | 0       | Looking for peers                                       |
      | downloading | 1536       | 1048576    | 1     | 512     | Downloading · 1.5 KB of 1.0 MB · 1 peer · 512 B/s       |
      | downloading | 1073741824 | 2199023255552 | 4  | 2097152 | Downloading · 1.0 GB of 2.0 TB · 4 peers · 2.0 MB/s     |
      | paused      | 10         | 20         | 0     | 0       | Paused · 10 B of 20 B                                   |
      | done        | 20         | 20         | 0     | 0       | Finished · 20 B of 20 B                                 |
      | failed      | 0          | -          | 0     | 0       | Could not finish                                        |

  Scenario: a failed download says why
    Given a download that failed because "no peers answered"
    Then the download reads "Could not finish: no peers answered"
