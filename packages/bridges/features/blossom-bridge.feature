Feature: Blossom bridge
  A `blossom:` reference names a blob by its hash. The bridge asks the servers
  the reference hints at, then the servers named for the applet that asked,
  under the web bridge's policy, and returns only bytes whose hash matches.
  No other server is asked (D-055).

  Scenario Outline: references are read in both forms applets use
    Then the Blossom reference "<reference>" has extension "<extension>" and hints "<hints>"

    Examples:
      | reference                                                                              | extension | hints                                         |
      | blossom:HASH.png                                                                       | .png      |                                               |
      | blossom:HASH.PNG?xs=cdn.example.com&xs=https://b.example.org/&as=npub1x&sz=12          | .png      | https://cdn.example.com,https://b.example.org |
      | blossom:sha256:HASH                                                                    |           |                                               |
      | blossom:sha256:HASH.webp?xs=http://plain.example&xs=ftp://files.example&xs=::          | .webp     |                                               |

  Scenario Outline: strings that are not Blossom references are refused
    When the Blossom reference "<reference>" is read
    Then the Blossom bridge failed with "invalid:blossom"

    Examples:
      | reference                    |
      | blossom:abc.png              |
      | blossom:sha1:HASH            |
      | blossom:HASH/../x.png        |

  Scenario: the bridge describes itself
    Given a Blossom bridge over fake servers
    Then the Blossom bridge is labelled "files" with id "blossom", serves "blossom" and is available
    And the Blossom bridge reveals the address, is encrypted in transit and is not public activity

  Scenario: the applet's own server holds the blob
    Given a Blossom bridge over fake servers whose applet servers are "https://applet.example/"
    And "https://applet.example" holds the blob
    When the Blossom bridge resolves "blossom:sha256:HASH" for an applet
    Then the Blossom bridge returned the blob as "application/octet-stream"
    And the Blossom bridge asked "https://applet.example/HASH"

  Scenario: hints are asked before the applet's servers, and the first match wins
    Given a Blossom bridge over fake servers whose applet servers are "https://applet.example"
    And "https://hint.example" holds the blob
    And "https://applet.example" holds the blob
    When the Blossom bridge resolves "blossom:HASH.png?xs=hint.example" for an applet
    Then the Blossom bridge returned the blob as "image/png"
    And the Blossom bridge asked "https://hint.example/HASH"

  Scenario: a server that answers with other bytes is passed over
    Given a Blossom bridge over fake servers whose applet servers are "https://liar.example,https://good.example"
    And "https://liar.example" answers with other bytes
    And "https://good.example" holds the blob
    When the Blossom bridge resolves "blossom:HASH.webp" for an applet
    Then the Blossom bridge returned the blob as "image/webp"
    And the Blossom bridge asked "https://liar.example/HASH,https://good.example/HASH"

  Scenario: missing, unreachable and private servers are passed over
    Given a Blossom bridge over fake servers whose applet servers are "https://missing.example,https://down.example,https://127.0.0.1,not a url,https://good.example/blobs/"
    And "https://missing.example" answers 404
    And "https://down.example" is unreachable
    And "https://good.example/blobs" holds the blob
    When the Blossom bridge resolves "blossom:HASH.json" for an applet
    Then the Blossom bridge returned the blob as "application/json"
    And the Blossom bridge asked "https://missing.example/HASH,https://down.example/HASH,https://good.example/blobs/HASH"

  Scenario: a blob no named server holds is not found, and only named servers were asked
    Given a Blossom bridge over fake servers whose applet servers are "https://applet.example"
    And "https://applet.example" answers 404
    When the Blossom bridge resolves "blossom:HASH.png" for an applet
    Then the Blossom bridge failed with "unavailable:not-found"
    And the Blossom bridge asked "https://applet.example/HASH"

  Scenario: with nowhere to ask, nothing is asked
    Given a Blossom bridge over fake servers
    When the Blossom bridge resolves "blossom:HASH.png" for the shell
    Then the Blossom bridge failed with "unavailable:no-servers"
    And the Blossom bridge asked ""

  Scenario: a request the caller abandoned stops the search
    Given a Blossom bridge over fake servers whose applet servers are "https://slow.example,https://good.example"
    And "https://slow.example" never answers
    And "https://good.example" holds the blob
    When the Blossom bridge resolves "blossom:HASH.png" for an applet that gives up
    Then the Blossom bridge failed with "unavailable:aborted"
    And the Blossom bridge asked "https://slow.example/HASH"

  Scenario: a bridge told of no applet servers asks only the hints
    Given a Blossom bridge over fake servers that knows no applet servers
    And "https://hint.example" holds the blob
    When the Blossom bridge resolves "blossom:HASH.png?xs=hint.example" for an applet
    Then the Blossom bridge returned the blob as "image/png"
    And the Blossom bridge asked "https://hint.example/HASH"

