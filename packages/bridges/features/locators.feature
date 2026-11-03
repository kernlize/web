Feature: Locator parsing
  A locator is a protocol-specific address the shell resolves on the user's behalf.
  Parsing extracts the fields a bridge needs and rejects strings that are not locators.

  Scenario: a magnet link yields its hash, name, trackers and web seeds
    When the locator "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Spring%20Mix&tr=udp%3A%2F%2Fa.example%3A6969&tr=udp%3A%2F%2Fb.example%3A6969&ws=https%3A%2F%2Fseed.example%2Ffile" is parsed
    Then the locator scheme is "magnet"
    And the locator field "infoHash" is "abcdef0123456789abcdef0123456789abcdef01"
    And the locator field "name" is "Spring Mix"
    And the locator list "trackers" is "udp://a.example:6969, udp://b.example:6969"
    And the locator list "webSeeds" is "https://seed.example/file"

  Scenario: a magnet link with a base32 hash is normalised to hex
    When the locator "magnet:?xt=urn:btih:VPL6MAXR6UUYBNS2PQIJMHHS5T4EYHBZ" is parsed
    Then the locator field "infoHash" is "abd7e602f1f52980b65a7c10961cf2ecf84c1c39"
    And the locator has no field "name"
    And the locator list "trackers" is ""

  Scenario Outline: a magnet link without an info hash is rejected
    When the locator "<uri>" is parsed
    Then parsing fails with "invalid:magnet-missing-hash"

    Examples:
      | uri                                    |
      | magnet:                                |
      | magnet:?dn=Nothing                     |
      | magnet:?xt=urn:sha1:ABCDEFGHIJKLMNOPQRST |
      | magnet:?xt=urn:btih:tooshort           |

  Scenario: a wrapped NZB locator yields its URL and the name it carries
    When the locator "nzb://https%3A%2F%2Findexer.example%2Fapi%3Fid%3D42%26name%3DSpring%2520Mix" is parsed
    Then the locator scheme is "nzb"
    And the locator field "url" is "https://indexer.example/api?id=42&name=Spring%20Mix"
    And the locator field "name" is "Spring Mix"

  Scenario: a wrapped NZB locator names itself after the last path segment
    When the locator "nzb://https%3A%2F%2Findexer.example%2Fget%2FSpring%2520Mix.nzb" is parsed
    Then the locator field "name" is "Spring Mix.nzb"

  Scenario: a web URL ending in .nzb is routed as an NZB locator
    When the locator "https://indexer.example/get/123.NZB" is parsed
    Then the locator scheme is "nzb"
    And the locator field "url" is "https://indexer.example/get/123.NZB"
    And the locator field "name" is "123.NZB"

  Scenario Outline: NZB detection by URL path
    Then the URL "<url>" is <verdict> as an NZB document

    Examples:
      | url                                    | verdict      |
      | https://indexer.example/get/1.nzb      | recognised   |
      | https://indexer.example/get/1.nzb?x=1  | recognised   |
      | https://indexer.example/index.html     | not recognised |
      | not a url                              | not recognised |

  Scenario Outline: malformed NZB locators are rejected
    When the locator "<uri>" is parsed
    Then parsing fails with "invalid:locator"

    Examples:
      | uri                                 |
      | nzb://%E0%A4%A                      |
      | nzb://ftp%3A%2F%2Fhost%2Ffile.nzb   |
      | nzb://not-a-url                     |
      | https://indexer.example/%zz.nzb     |

  Scenario: a peer share locator yields user and path
    When the locator "slsk://ada%20l/Music/Spring%20Mix/01.flac" is parsed
    Then the locator scheme is "slsk"
    And the locator field "user" is "ada l"
    And the locator field "path" is "Music/Spring Mix/01.flac"

  Scenario Outline: a peer share locator needs both user and path
    When the locator "<uri>" is parsed
    Then parsing fails with "invalid:locator"

    Examples:
      | uri          |
      | slsk://ada   |
      | slsk://ada/  |
      | slsk:///path |

  Scenario: a mail locator yields addresses, subject and body
    When the locator "mailto:ada@example.com,%20grace@example.com?subject=Hello&body=See%20you" is parsed
    Then the locator scheme is "mailto"
    And the locator field "address" is "ada@example.com, grace@example.com"
    And the locator list "addresses" is "ada@example.com, grace@example.com"
    And the locator field "subject" is "Hello"
    And the locator field "body" is "See you"

  Scenario: a mail locator without subject or body carries neither
    When the locator "mailto:ada@example.com" is parsed
    Then the locator has no field "subject"
    And the locator has no field "body"

  Scenario: a mail locator without an address is rejected
    When the locator "mailto:?subject=Hello" is parsed
    Then parsing fails with "invalid:locator"

  Scenario Outline: web locators yield origin, host and path
    When the locator "<uri>" is parsed
    Then the locator scheme is "<scheme>"
    And the locator field "origin" is "<origin>"
    And the locator field "host" is "<host>"
    And the locator field "path" is "<path>"

    Examples:
      | uri                                   | scheme | origin                      | host                 | path       |
      | HTTPS://Example.com:8443/a/b?c=1#frag | https  | https://example.com:8443    | example.com:8443     | /a/b?c=1   |
      | http://[::1]/                         | http   | http://[::1]                | [::1]                | /          |
      | wss://relay.example                   | wss    | wss://relay.example         | relay.example        | /          |
      | ws://relay.example/sub                | ws     | ws://relay.example          | relay.example        | /sub       |

  Scenario: a web locator that does not parse as a URL is rejected
    When the locator "https://exa mple.com/" is parsed
    Then parsing fails with "invalid:locator"

  Scenario: an unknown scheme is still a locator with no fields
    When the locator "ftp://files.example/pub/x" is parsed
    Then the locator scheme is "ftp"
    And the locator has no fields

  Scenario Outline: strings that are not locators are rejected
    When the locator "<uri>" is parsed
    Then parsing fails with "invalid:locator"

    Examples:
      | uri              |
      |                  |
      | just words       |
      | 1abc:not-scheme  |
      | /relative/path   |

  Scenario Outline: a locator is labelled for the user without its scheme
    When the locator "<uri>" is parsed
    Then the locator label is "<label>"

    Examples:
      | uri                                                                     | label                                    |
      | magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Spring  | Spring                                   |
      | magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01            | abcdef0123456789abcdef0123456789abcdef01 |
      | nzb://https%3A%2F%2Findexer.example%2Fget%2Fmix.nzb                     | mix.nzb                                  |
      | slsk://ada/Music/01.flac                                                | 01.flac                                  |
      | slsk://ada//                                                            | ada                                      |
      | mailto:ada@example.com,grace@example.com                                | ada@example.com, grace@example.com       |
      | https://example.com/a/b                                                 | example.com                              |
      | ftp://files.example/pub                                                 | files.example/pub                        |
