Feature: Uploading files
  Applets upload through the shell (NAP-UPLOAD). The shell decides where a file
  goes: the account's published file-server list (BUD-03, kind 10063), or
  well-known servers while it has none. The person is asked once per file,
  with what it is, its size and where it goes, before anything is signed or
  sent. The file is uploaded to the first server and mirrored to the others
  with the Blossom client SDK; any server that stores it makes the upload a
  success (D-028, D-032).

  Scenario: a file-server list reads in order, and a new one keeps its other tags
    Then the file servers of a list naming "https://cdn.one.test,https://two.test/,https://cdn.one.test/" are "https://cdn.one.test/,https://two.test/"
    And a list with no event names no file servers
    And new file-server tags for "blossom.primal.net,https://two.test" over a list with a "client" tag are "server https://blossom.primal.net/|server https://two.test/|client kernl"
    And new file-server tags for "not a server" are refused with "invalid:server-url"

  Scenario: the account's servers are its published list, or the defaults once the lookup has answered
    Given a file-server service for a signed-in account
    Then the file servers are "loading"
    When an upload asks for its servers while the list is being looked up
    And the file-server lookup answers with nothing
    Then the servers it was given are the defaults
    Then the file servers are "missing" using the defaults
    And the servers an upload uses are the defaults
    When the account's list naming "https://mine.test" arrives
    Then the file servers are "found" using "https://mine.test/"
    And the servers an upload uses are "https://mine.test/"

  Scenario: a lookup that fails leaves the defaults
    Given a file-server service for a signed-in account
    When the file-server lookup fails
    Then the file servers are "missing" using the defaults

  Scenario: with nobody signed in the defaults stand, and saving is refused
    Given a file-server service with nobody signed in
    Then the file servers are "missing" using the defaults
    When the account saves file servers "https://mine.test"
    Then the shell refused with "denied:read-only"

  Scenario: saving publishes to the outboxes and lookup servers, and two of three is a success
    Given a file-server service for a signed-in account
    And "wss://lookup.test" refuses the file-server list
    When the account saves file servers "https://mine.test,https://second.test"
    Then the file-server save was accepted by "wss://out.test/,wss://out2.test/" and refused by "wss://lookup.test/"
    And the file servers are "found" using "https://mine.test/,https://second.test/"
    Given every server refuses the file-server list
    When the account saves file servers "https://third.test"
    Then the file-server save was accepted by nobody
    And the file servers are "found" using "https://mine.test/,https://second.test/"

  Scenario: a file-server list nobody can be sent is still a failure, not an error
    Given a file-server service for a signed-in account
    And publishing fails outright
    When the account saves file servers "https://mine.test"
    Then the file-server save was accepted by nobody

  Scenario: the person is asked what, how big and where, and nothing is signed or sent without a yes
    Given an uploader over "https://one.test/,https://two.test/" where the person says "no"
    When an applet uploads a 2048-byte "image/png" file named "cat.png"
    Then the upload was "cancelled" with "denied:consent"
    And the person was asked about "cat.png, image/png", "2.0 KB" going to "one.test, two.test"
    And nothing was signed or sent

  Scenario: an allowed upload is signed once, stored on the first server, mirrored, and lists every copy
    Given an uploader over "https://one.test/,https://two.test/" where the person says "yes"
    When an applet uploads a 10-byte "text/plain" file
    Then the upload is complete at "https://one.test/" with a copy at "https://two.test/"
    And the authorization was signed 1 times
    And the upload's file tags carry its address, hash, type and size

  Scenario: a copy on one of two servers is a success; none is a failure that says how many were tried
    Given an uploader over "https://one.test/,https://two.test/" where the person says "yes"
    And "https://one.test/" refuses the file
    When an applet uploads a 10-byte "text/plain" file
    Then the upload is complete at "https://two.test/" with no copies
    Given every file server refuses the file
    When an applet uploads a 10-byte "text/plain" file
    Then the upload was "failed" with "unavailable:not-accepted:0/2"
    Given the transfer breaks
    When an applet uploads a 10-byte "text/plain" file
    Then the upload was "failed" with "unavailable:not-accepted:0/2"

  Scenario: raw bytes without a type, a read-only session, and no servers at all
    Given an uploader over "https://one.test/" where the person says "yes"
    When an applet uploads 4 raw bytes without a type
    Then the person was asked about "application/octet-stream", "4 bytes" going to "one.test"
    Given the uploader has no signer
    When an applet uploads a 10-byte "text/plain" file
    Then the upload was "failed" with "denied:read-only"
    Given an uploader over "" where the person says "yes"
    When an applet uploads a 10-byte "text/plain" file
    Then the upload was "failed" with "unavailable:no-file-server"

  Scenario Outline: sizes read the way a person reads them
    Then <bytes> bytes read "<words>"

    Examples:
      | bytes      | words     |
      | 1          | 1 byte    |
      | 512        | 512 bytes |
      | 1536       | 1.5 KB    |
      | 3355443    | 3.2 MB    |
      | 5368709120 | 5.0 GB    |
      | 5497558138880 | 5120.0 GB |

  Scenario: the prompt goes through the host, and an applet the shell cannot name is refused unasked
    Then asking the host about an upload from a known applet presents "Upload a file" marked "public"
    And asking the host about an upload from an unknown applet answers no without asking
