Feature: The preview runs the real kernel over parts that live in the page
  kernl.run's preview is the real kernel and kernl's own modules over relays, samples and
  correspondents that never leave the page (D-068). A host hands it the signed samples it ships;
  everything an applet or the person reaches is answered from memory.

  Background:
    Given a preview with two signed samples, "notes" and "pulse"
    And a shell composed from that preview, signed in with a throwaway identity

  Scenario: A seeded sample resolves and verifies against its manifest
    When the person opens the "notes" sample by its address
    Then the shell verified "notes" from its publisher with the bytes its manifest names

  Scenario: Bytes that do not hash to the manifest are refused
    Given a preview whose "notes" sample is served with one byte changed
    And a shell composed from that preview, signed in with a throwaway identity
    When the person opens the "notes" sample by its address
    Then the shell refused it as "invalid:blob-hash-mismatch"

  Scenario: A hash the preview does not hold is unavailable
    When the shell asks the preview for a blob it does not hold
    Then the blob is refused as "unavailable:blob"

  Scenario: The store lists the samples
    When the store loads its catalogue
    Then it lists "notes, pulse" from the samples' publisher

  Scenario: Seeded people and the publisher have names
    Then the profiles read "Ada", "Grace" and "kernl samples"

  Scenario: Ada and Grace have already written, each through their own provider
    Then the "private" provider holds 2 lines from Ada, the first 600 seconds ago
    And the "legacy" provider holds 1 line from Grace, 7200 seconds ago

  Scenario: A send gets a scripted reply after a moment
    When the person writes "hello" to Ada and then again to Ada
    Then Ada replies "Got it. That arrived the way you sent it." after about 900 ms
    And then "Your providers and their order are under Settings, Messages. The first one that is switched on is used first."

  Scenario: Answering Grace in her conversation gets Grace's reply
    When the person answers Grace in her conversation
    Then Grace replies "Got it. That arrived the way you sent it." after about 900 ms

  Scenario: Every provider is listed, the first two switched on
    Then the messaging providers are "private, legacy, ratchet, group", with "private, legacy" switched on

  Scenario: The preview hides keyboard shortcuts
    Then the shell offers no "keys" domain, not even as a baseline

  Scenario Outline: Every kind of download program answers its check
    When the person checks a "<program>" program at "<address>" with a sign-in
    Then the check says it is connected, version "<version>"

    Examples:
      | program      | address                 | version |
      | transmission | http://127.0.0.1:9091   | preview |
      | utorrent     | http://127.0.0.1:8080   | 0       |
      | sabnzbd      | http://127.0.0.1:8085   | preview |
      | nzbget       | http://127.0.0.1:6789   | preview |
      | slskd        | http://127.0.0.1:5030   | preview |

  Scenario Outline: Past its check, a download program holds nothing or is refused as offline
    When a "<program>" program at "<address>" is set up and asked what it holds
    Then it answers "<answer>"

    Examples:
      | program      | address               | answer                   |
      | transmission | http://127.0.0.1:9091 | unavailable:unreachable  |
      | utorrent     | http://127.0.0.1:8080 | no jobs                  |
      | sabnzbd      | http://127.0.0.1:8085 | unavailable:unreachable  |
      | nzbget       | http://127.0.0.1:6789 | unavailable:unreachable  |
      | slskd        | http://127.0.0.1:5030 | unavailable:unreachable  |

  Scenario: Nothing reaches a real network
    When the person opens the "notes" sample, loads the store, reads profiles, writes to Ada, checks a download program, fetches a web page through the bridges and searches for tools
    Then the pool only ever dialled sockets that live in the page
    And nothing called the page's fetch, opened its WebSocket or its Cache Storage
    And the web page was refused as "unavailable:network unavailable:preview"
    And the tool search was refused as "unavailable:preview"

  Scenario: A magnet link is handed to the host, which asks before anything leaves
    When an applet's magnet link is resolved through the bridges
    Then the preview's host was asked to open "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567"

  Scenario: A host's torrent engine takes magnet links inside the preview
    Given a preview with a torrent engine of the host's own
    And a shell composed from that preview, signed in with a throwaway identity
    When an applet's magnet link is resolved through the bridges
    Then the host's engine took it and the host was asked to open nothing

  Scenario: A preview given nothing still has its people and an empty store
    Given a preview given nothing
    And a shell composed from that preview, signed in with a throwaway identity
    When the store loads its catalogue
    Then the store lists nothing
    And Ada and Grace have names

  Scenario: The preview offers no uploads, since every file server is on the network
    Then the shell offers no "upload" domain

  Scenario: The preview offers no direct connections, even where the page can make them
    Given a page that can make peer connections
    And a shell composed from that preview, signed in with a throwaway identity
    Then the shell offers no "webrtc" domain
    And the preview offers the "cvm" domain

  Scenario: History keeps the host's clock
    Given a preview whose clock reads 1800000000
    And a shell composed from that preview, signed in with a throwaway identity
    Then Ada's lines arrived at 1799999400 and 1799999460, and Grace's at 1799992800

  Scenario Outline: A provider the person switches on runs over the page's relays
    When the person switches on "<provider>" and reads its conversations
    Then it has no conversations, and nothing reached the network

    Examples:
      | provider |
      | ratchet  |
      | group    |

  Scenario: A host passes the samples as the build ships them
    Given a preview built from a shipped samples listing with its publisher's profile
    And a shell composed from that preview, signed in with a throwaway identity
    When the person opens the "notes" sample by its address
    Then the shell verified "notes" from its publisher with the bytes its manifest names
    And the profiles read "Ada", "Grace" and "kernl samples"
    And the same listing without the profile seeds nothing but the samples
