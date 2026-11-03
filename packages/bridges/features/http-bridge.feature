Feature: HTTP bridge
  The bridge that fetches web resources never becomes a way to reach the user's
  own machine or network, follows a bounded number of redirects, and stops
  reading once a response exceeds the size limit.

  Scenario: the default policy is strict
    Then the default web policy allows only "https:"
    And the default web policy caps redirects at 3, bytes at 10485760 and time at 20000 ms

  Scenario Outline: literal addresses in blocked ranges are recognised
    Then the address "<ip>" is <verdict>

    Examples:
      | ip                 | verdict |
      | 0.0.0.0            | blocked |
      | 10.1.2.3           | blocked |
      | 100.64.0.1         | blocked |
      | 100.127.255.255    | blocked |
      | 100.128.0.1        | allowed |
      | 127.0.0.1          | blocked |
      | 169.254.169.254    | blocked |
      | 172.16.0.1         | blocked |
      | 172.31.255.255     | blocked |
      | 172.32.0.1         | allowed |
      | 192.168.1.1        | blocked |
      | 192.0.0.170        | blocked |
      | 198.18.0.1         | blocked |
      | 198.19.255.255     | blocked |
      | 198.17.255.255     | allowed |
      | 198.20.0.1         | allowed |
      | 224.0.0.1          | blocked |
      | 255.255.255.255    | blocked |
      | 8.8.8.8            | allowed |
      | 93.184.216.34      | allowed |
      | 1.2.3              | allowed |
      | 256.1.1.1          | allowed |
      | 1.2.3.x            | allowed |
      | ::                 | blocked |
      | ::1                | blocked |
      | [::1]              | blocked |
      | 0:0:0:0:0:0:0:1    | blocked |
      | ::2                | blocked |
      | ::8.8.8.8          | allowed |
      | fe80::1            | blocked |
      | FE80::             | blocked |
      | febf::1            | blocked |
      | fec0::1            | blocked |
      | fe7f::1            | allowed |
      | fc00::1            | blocked |
      | fd12:3456::1       | blocked |
      | fb00::1            | allowed |
      | ff02::1            | blocked |
      | 2001:db8::1        | allowed |
      | ::ffff:127.0.0.1   | blocked |
      | ::ffff:7f00:1      | blocked |
      | [::ffff:7f00:1]    | blocked |
      | ::FFFF:A9FE:A9FE   | blocked |
      | 0:0:0:0:0:ffff:c0a8:101 | blocked |
      | ::ffff:8.8.8.8     | allowed |
      | ::ffff:808:808     | allowed |
      | ::ffff:0:127.0.0.1 | blocked |
      | ::ffff:0:808:808   | allowed |
      | ::ffff:1.2.3       | allowed |
      | 64:ff9b::127.0.0.1 | blocked |
      | 64:ff9b::a00:5     | blocked |
      | 64:ff9b::808:808   | allowed |
      | 64:ff9b:1::808:808 | blocked |
      | 2002:7f00:1::      | blocked |
      | 2002:808:808::     | blocked |
      | 2001:0:4136:e378:8000:63bf:3fff:fdd2 | blocked |
      | 100::1             | blocked |
      | 100:0:0:1::1       | allowed |
      | fe80::1%eth0       | blocked |
      | 2001:4860:4860::8888 | allowed |
      | 2001:db8::127.0.0.1 | allowed |
      | 1::2::3            | allowed |
      | 1:2:3              | allowed |
      | 1:2:3:4:5:6:7:8::  | allowed |
      | 12345::            | allowed |
      | fe80:              | allowed |
      | example.com        | allowed |

  Scenario Outline: hostnames that name the local machine or network are recognised
    Then the hostname "<host>" is <verdict>

    Examples:
      | host             | verdict |
      | localhost        | blocked |
      | LOCALHOST.       | blocked |
      | app.localhost    | blocked |
      | printer.local    | blocked |
      | db.internal      | blocked |
      | example.com      | allowed |
      | localhost.example| allowed |

  Scenario: the bridge serves only encrypted schemes by default
    Given a web bridge
    Then the web bridge serves "https"
    And the web bridge is encrypted in transit

  Scenario: the shell can admit the unencrypted scheme and the bridge says so
    Given a web bridge allowing "https:, http:"
    Then the web bridge serves "https, http"
    And the web bridge is not encrypted in transit

  Scenario: the web bridge is always available and describes its exposure
    Given a web bridge
    Then the web bridge is available
    And the web bridge is labelled "downloads" with id "http"
    And the web bridge reveals the address, is not public activity

  Scenario: a scheme outside the policy is denied before any request
    Given a web bridge
    When the web bridge resolves "http://example.com/file"
    Then the web request fails with "denied:scheme http:"
    And no request was sent

  Scenario Outline: local and private destinations are denied before any request
    Given a web bridge
    When the web bridge resolves "<url>"
    Then the web request fails with "denied:private-address"
    And no request was sent

    Examples:
      | url                          |
      | https://127.0.0.1/secret     |
      | https://localhost/secret     |
      | https://[fe80::1]/secret     |
      | https://169.254.169.254/meta |
      | https://db.internal/         |
      | https://[::ffff:127.0.0.1]/admin |
      | https://[::ffff:7f00:1]/admin    |
      | https://[::ffff:169.254.169.254]/meta |
      | https://[::127.0.0.1]/admin      |
      | https://[64:ff9b::10.0.0.1]/     |
      | https://[2002:7f00:1::]/         |
      | https://198.18.0.1/              |

  Scenario: an IPv4-mapped loopback is denied under the form the URL normalises it to
    Given a web bridge
    When the web bridge resolves "https://[::ffff:127.0.0.1]/admin"
    Then the web request fails with "denied:private-address ::ffff:7f00:1"
    And no request was sent

  Scenario: a hostname resolving to a mapped or translated private address is denied
    Given a web bridge whose resolver maps "sneaky.example" to "::ffff:10.0.0.5"
    When the web bridge resolves "https://sneaky.example/"
    Then the web request fails with "denied:private-address sneaky.example -> ::ffff:10.0.0.5"
    And no request was sent

  Scenario: a NAT64 address for a public host is fetched
    Given a web bridge whose resolver maps "v4only.example" to "64:ff9b::5db8:d822"
    When the web bridge resolves "https://v4only.example/"
    Then the web response status is 200

  Scenario: a hostname resolving to a private address is denied
    Given a web bridge whose resolver maps "intranet.example" to "10.0.0.5"
    When the web bridge resolves "https://intranet.example/"
    Then the web request fails with "denied:private-address intranet.example -> 10.0.0.5"
    And no request was sent

  Scenario: a hostname resolving publicly is fetched
    Given a web bridge whose resolver maps "cdn.example" to "93.184.216.34"
    When the web bridge resolves "https://cdn.example/file"
    Then the web response status is 200
    And 1 request was sent

  Scenario: an explicitly allowed private host is fetched
    Given a web bridge allowing private host "intranet.example"
    When the web bridge resolves "https://intranet.example/"
    Then the web response status is 200

  Scenario: the default fetch is used when none is supplied
    Given a web bridge with the platform fetch
    When the web bridge resolves "https://localhost/"
    Then the web request fails with "denied:private-address"

  Scenario: redirects are followed manually, re-checking every hop
    Given a web bridge
    And the server redirects "https://a.example/" to "https://b.example/"
    And the server redirects "https://b.example/" to "/final"
    When the web bridge resolves "https://a.example/"
    Then the web response status is 200
    And 3 requests were sent
    And every request asked for manual redirects
    And the last request was for "https://b.example/final"

  Scenario: a redirect to a private destination is denied
    Given a web bridge
    And the server redirects "https://a.example/" to "https://127.0.0.1/"
    When the web bridge resolves "https://a.example/"
    Then the web request fails with "denied:private-address 127.0.0.1"
    And 1 request was sent

  Scenario: a redirect to a scheme outside the policy is denied
    Given a web bridge
    And the server redirects "https://a.example/" to "http://a.example/plain"
    When the web bridge resolves "https://a.example/"
    Then the web request fails with "denied:scheme http:"

  Scenario: redirect chains beyond the cap are denied
    Given a web bridge capped at 1 redirect
    And the server redirects "https://a.example/" to "https://b.example/"
    And the server redirects "https://b.example/" to "https://c.example/"
    When the web bridge resolves "https://a.example/"
    Then the web request fails with "denied:too-many-redirects"
    And 2 requests were sent

  Scenario Outline: a redirect without a usable location is invalid
    Given a web bridge
    And the server redirects "https://a.example/" to "<location>"
    When the web bridge resolves "https://a.example/"
    Then the web request fails with "invalid:redirect"

    Examples:
      | location          |
      |                   |
      | https://exa mple/ |

  Scenario: a redirect the browser hides from the bridge is refused, not followed
    Given a web bridge
    And the server answers with a redirect the browser hides
    When the web bridge resolves "https://a.example/"
    Then the web request fails with "denied:redirect-unverifiable"
    And 1 request was sent

  Scenario: an opaque answer is reported as unavailable
    Given a web bridge
    And the server answers with an opaque response
    When the web bridge resolves "https://a.example/"
    Then the web request fails with "unavailable:network opaque response"

  Scenario: a request the browser blocks for cross-origin reasons is reported as unavailable
    Given a web bridge
    And the browser blocks the request with "Failed to fetch"
    When the web bridge resolves "https://a.example/"
    Then the web request fails with "unavailable:network Failed to fetch"

  Scenario: a request that outlives the time limit is abandoned
    Given a web bridge with a 10 ms time limit
    And the server never answers
    When the web bridge resolves "https://slow.example/"
    Then the web request fails with "unavailable:timeout"

  Scenario: a request the caller cancels is reported as aborted
    Given a web bridge
    And the server never answers
    When the web bridge resolves "https://slow.example/" and the caller cancels
    Then the web request fails with "unavailable:aborted"

  Scenario: a network failure is reported with its message
    Given a web bridge
    And the server fails with "connection reset"
    When the web bridge resolves "https://down.example/"
    Then the web request fails with "unavailable:network connection reset"

  Scenario: a network failure that is not an Error is reported as text
    Given a web bridge
    And the server fails with a bare string
    When the web bridge resolves "https://down.example/"
    Then the web request fails with "unavailable:network boom"

  Scenario: a declared size over the limit is denied before reading
    Given a web bridge capped at 100 bytes
    And the server declares a content length of 101
    When the web bridge resolves "https://big.example/"
    Then the web request fails with "denied:too-large"

  Scenario: a body within the limit streams through with its headers
    Given a web bridge capped at 100 bytes
    And the server answers with 3 chunks of 30 bytes
    When the web bridge resolves "https://ok.example/"
    Then the web response status is 200
    And the web response header "x-served-by" is "fake"
    And reading the web response yields 90 bytes

  Scenario: a body that grows past the limit fails while streaming
    Given a web bridge capped at 100 bytes
    And the server answers with 4 chunks of 30 bytes
    When the web bridge resolves "https://big.example/"
    Then the web response status is 200
    And reading the web response fails with "denied:too-large"

  Scenario: a response without a body passes through
    Given a web bridge
    And the server answers 204 with no body
    When the web bridge resolves "https://empty.example/"
    Then the web response status is 204
    And the web response has no body

  Scenario: caller headers are forwarded
    Given a web bridge
    When the web bridge resolves "https://api.example/" with header "accept" set to "application/json"
    Then the last request carried header "accept" set to "application/json"
