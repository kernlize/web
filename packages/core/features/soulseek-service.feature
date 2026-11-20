Feature: Searching and downloading through the person's own Soulseek daemon
  An applet searches the Soulseek network, looks through what one person shares
  and asks for files, all through the daemon the person already runs. The shell
  speaks NAP-SOULSEEK to the applet and the daemon's own API to the daemon. An
  applet never sees the daemon's ids, address or disk. Every handle belongs to
  the window it was given to, the person is asked once per window before it
  reaches the network, and nothing a window started outlives it. The daemon is
  a separate program whose files kernl cannot reach, so a finished file stays
  there: kernl neither reads it out to the applet nor saves it elsewhere.

  Background:
    Given a Soulseek daemon that is signed in
    And Soulseek applets run in the windows "A, B"
    And the person will say "yes" to the Soulseek question

  Rule: An applet can always ask what is there

    Scenario: the limits a window works within
      When window "A" asks for Soulseek info
      Then window "A" learns the Soulseek daemon is "online"
      And window "A" learns it cannot save Soulseek files
      And window "A" learns the Soulseek limits:
        | maxQueries     | 4     |
        | maxTransfers   | 16    |
        | maxResults     | 500   |
        | maxPageSize    | 100   |
        | maxReadBytes   | 65536 |
        | maxTextBytes   | 1024  |
        | queryTimeoutMs | 30000 |
        | pollIntervalMs | 1000  |
      And the person was asked the Soulseek question 0 times

    Scenario: the host can tighten a limit
      Given the Soulseek limit "maxTransfers" is 2
      And the Soulseek service keeps time by the real clock
      When window "A" asks for Soulseek info
      Then window "A" learns the Soulseek limits:
        | maxTransfers | 2   |
        | maxResults   | 500 |

    Scenario Outline: what the daemon's condition reads as
      Given the Soulseek daemon is "<condition>"
      When window "A" asks for Soulseek info
      Then window "A" learns the Soulseek daemon is "<state>"

      Examples:
        | condition                 | state        |
        | not set up                | unconfigured |
        | signed out                | offline      |
        | unreachable               | offline      |
        | refusing kernl's sign-in  | offline      |

  Rule: The person is asked once per window before it reaches the network

    Scenario: the first search asks, in words, and a yes lasts for the window
      When window "A" searches Soulseek for "field recording"
      Then the person was asked the Soulseek question 1 times
      And the Soulseek question is titled "Search and download through your sharing program"
      And the Soulseek question says "see your search words, the names of the files you ask for, and the network address of the machine running the program"
      And the Soulseek question says "Nothing is encrypted end to end"
      And the Soulseek question says "Downloads stop when this applet's window closes"
      And window "A"'s Soulseek query is "collecting"
      When window "A" browses the Soulseek peer "ann"
      And window "A" searches Soulseek for "rain"
      Then the person was asked the Soulseek question 1 times
      When window "B" searches Soulseek for "rain"
      Then the person was asked the Soulseek question 2 times

    Scenario: a no starts nothing, and the next request asks again
      Given the person will say "no" to the Soulseek question
      When window "A" searches Soulseek for "field recording"
      Then window "A" is refused by Soulseek with "denied"
      And the Soulseek daemon was asked to "startSearch" 0 times
      Given the person will say "yes" to the Soulseek question
      When window "A" searches Soulseek for "field recording"
      Then the person was asked the Soulseek question 2 times
      And window "A"'s Soulseek query is "collecting"

    Scenario: requests that arrive while the person is deciding share one question
      Given the person will say "nothing yet" to the Soulseek question
      When window "A" searches Soulseek for "rain"
      And window "A" browses the Soulseek peer "ann"
      Then window "A" got 0 Soulseek answers
      When the person answers the Soulseek question with "yes"
      Then the person was asked the Soulseek question 1 times
      And window "A" got 2 Soulseek answers
      And the Soulseek daemon was asked to "startSearch" 1 times
      And the Soulseek daemon was asked to "browse" 1 times

    Scenario: a question that cannot be shown counts as a no
      Given the person will say "an error" to the Soulseek question
      When window "A" searches Soulseek for "rain"
      Then window "A" is refused by Soulseek with "denied"

    Scenario: a window that closes while the person is deciding starts nothing
      Given the person will say "nothing yet" to the Soulseek question
      When window "A" searches Soulseek for "rain"
      And the Soulseek window "A" is closed
      And the person answers the Soulseek question with "yes"
      Then window "A" is refused by Soulseek with "revoked"
      And the Soulseek daemon was asked to "startSearch" 0 times

  Rule: A search gathers results as the applet polls

    Scenario: results arrive over several polls, in order, each file once
      When window "A" searches Soulseek for "rain"
      Then window "A"'s Soulseek query is "collecting"
      And window "A"'s Soulseek query holds 0 files
      When Soulseek peers answer "rain" with:
        | username | path             | size |
        | ann      | Field\rain-1.flac | 30   |
        | ben      | Tapes\rain.mp3    | 12   |
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query holds 0 files
      And the Soulseek daemon was asked to "searchResults" 0 times
      When 1000 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek page lists "Field\rain-1.flac, Tapes\rain.mp3"
      And window "A"'s Soulseek page continues at 2
      When Soulseek peers answer "rain" with:
        | username | path              | size |
        | ann      | Field\rain-1.flac | 30   |
        | ann      | Field\rain-1.flac | 31   |
        | cy       | rain-3.ogg        | 7    |
      And 1000 ms pass for Soulseek
      And window "A" reads 2 Soulseek results after 2
      Then window "A"'s Soulseek page lists "Field\rain-1.flac, rain-3.ogg"
      And window "A"'s Soulseek page continues at 4
      And window "A"'s Soulseek query is "collecting"
      And window "A"'s Soulseek query holds 4 files
      When window "A" reads 1 Soulseek results after 4
      Then window "A"'s Soulseek page lists ""
      And window "A"'s Soulseek page continues at 4
      When window "A" reads 1 Soulseek results after 5
      Then window "A" is refused by Soulseek with "invalid_request"

    Scenario: what a peer says about a file is shown, and what it got wrong is left out
      When window "A" searches Soulseek for "rain"
      And Soulseek peers answer "rain" with:
        | username | path      | size | locked | extension | bitrateKbps | durationSeconds | sampleRateHz | bitDepth |
        | ann      | a.flac    | 30   | true   | flac      | 900         | 0               | 44100        | 16       |
        | ben      | b.mp3     | 12   | false  |           | 0           | -1              | 1.5          | 0        |
        | cy       |           | 7    | false  |           |             |                 |              |          |
        |          | d.mp3     | 7    | false  |           |             |                 |              |          |
        | dee      | e.mp3     | 007  | false  |           |             |                 |              |          |
        | eve      | f.mp3     | 7    | maybe  |           |             |                 |              |          |
      And 1000 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek page shows:
        | username | path   | size | locked | extension | bitrateKbps | durationSeconds | sampleRateHz | bitDepth |
        | ann      | a.flac | 30   | true   | flac      | 900         | 0               | 44100        | 16       |
        | ben      | b.mp3  | 12   | false  |           |             |                 |              |          |

    Scenario: a search can be kept to one person
      When window "A" searches the Soulseek peer "ann" for "rain"
      Then the Soulseek daemon searched for "rain" from "ann"

    Scenario: collecting ends when its time is up, and what comes later is not added
      When window "A" searches Soulseek for "rain"
      And Soulseek peers answer "rain" with:
        | username | path   | size |
        | ann      | a.flac | 30   |
      And 30000 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query is "complete" because "deadline"
      And window "A"'s Soulseek query holds 1 files
      And the Soulseek daemon was asked to "stopSearch" 1 times
      When 5000 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query holds 1 files
      And the Soulseek daemon was asked to "searchResults" 1 times

    Scenario: collecting ends when the daemon says it has finished
      When window "A" searches Soulseek for "rain"
      And the Soulseek daemon ends the search for "rain"
      And 1000 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query is "complete" because "deadline"
      And the Soulseek daemon was asked to "stopSearch" 0 times

    Scenario: collecting ends when a window holds as many results as it may
      Given the Soulseek limit "maxResults" is 2
      When window "A" searches Soulseek for "rain"
      And Soulseek peers answer "rain" with:
        | username | path   | size |
        | ann      | a.flac | 30   |
        | ann      | b.flac | 30   |
        | ann      | c.flac | 30   |
      And 1000 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query is "complete" because "limit"
      And window "A"'s Soulseek page lists "a.flac, b.flac"
      And the Soulseek daemon was asked to "stopSearch" 1 times

    Scenario: stopping keeps what was gathered and adds nothing later
      Given window "A" has searched Soulseek for "rain" and found:
        | username | path   | size |
        | ann      | a.flac | 30   |
      When Soulseek peers answer "rain" with:
        | username | path   | size |
        | ben      | b.flac | 30   |
      And window "A" stops its Soulseek query
      Then window "A"'s Soulseek query is "stopped" because "cancelled"
      And window "A"'s Soulseek query holds 1 files
      And the Soulseek daemon was asked to "stopSearch" 1 times
      When 1000 ms pass for Soulseek
      And window "A" stops its Soulseek query
      Then window "A"'s Soulseek query is "stopped" because "cancelled"
      And the Soulseek daemon was asked to "stopSearch" 1 times
      When window "A" reads its Soulseek results
      Then window "A"'s Soulseek page lists "a.flac"
      When window "A" downloads Soulseek file 1
      Then window "A"'s Soulseek transfer is "queued" with "0" bytes

    Scenario: stopping takes one last look when a look is due
      Given window "A" has searched Soulseek for "rain" and found:
        | username | path   | size |
        | ann      | a.flac | 30   |
      When Soulseek peers answer "rain" with:
        | username | path   | size |
        | ben      | b.flac | 30   |
      And 1000 ms pass for Soulseek
      And window "A" stops its Soulseek query
      Then window "A"'s Soulseek query is "stopped" because "cancelled"
      And window "A"'s Soulseek query holds 2 files

    Scenario: releasing a search forgets it everywhere but keeps a download already accepted
      Given window "A" has searched Soulseek for "rain" and found:
        | username | path   | size |
        | ann      | a.flac | 30   |
      And window "A" downloads Soulseek file 1
      When window "A" releases its Soulseek "query"
      Then window "A" is told Soulseek released "something"
      And the Soulseek daemon holds 0 searches
      When window "A" reads its Soulseek results
      Then window "A" is refused by Soulseek with "not_found"
      When window "A" downloads Soulseek file 1
      Then window "A" is refused by Soulseek with "not_found" saying "File handle is unavailable"
      When window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "queued" with "0" bytes
      When window "A" releases its Soulseek "query"
      Then window "A" is told Soulseek released "nothing"

    Scenario: a window holds only so many searches
      Given the Soulseek limit "maxQueries" is 2
      When window "A" searches Soulseek for "rain"
      And window "A" browses the Soulseek peer "ann"
      And window "A" searches Soulseek for "wind"
      Then window "A" is refused by Soulseek with "limit_exceeded"
      And the Soulseek daemon was asked to "startSearch" 1 times
      When window "A" browses the Soulseek peer "ben"
      Then window "A" is refused by Soulseek with "limit_exceeded"
      When window "A" releases its Soulseek "query"
      And window "A" searches Soulseek for "wind"
      Then window "A"'s Soulseek query is "collecting"

    Scenario: a window holds only so many downloads, finished ones included
      Given the Soulseek limit "maxTransfers" is 1
      And window "A" holds a Soulseek transfer that is "complete"
      When window "A" downloads Soulseek file 2
      Then window "A" is refused by Soulseek with "limit_exceeded"
      And the Soulseek daemon was asked to "download" 1 times
      When window "A" lists its Soulseek transfers
      Then window "A" holds 1 Soulseek transfers

    Scenario: a daemon that stops answering fails the search but keeps what was gathered
      Given window "A" has searched Soulseek for "rain" and found:
        | username | path   | size |
        | ann      | a.flac | 30   |
      When the Soulseek daemon is "unreachable"
      And 1000 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query has failed with "backend_error"
      And window "A"'s Soulseek page lists "a.flac"

  Rule: Browsing asks one person for everything they share

    Scenario: the whole list arrives
      Given the Soulseek peer "ann" shares:
        | path         | size |
        | Music\a.flac | 30   |
        | Music\b.flac | 31   |
        | Music\a.flac | 30   |
      When window "A" browses the Soulseek peer "ann"
      Then window "A"'s Soulseek query is "collecting"
      When window "A" reads its Soulseek results
      Then window "A"'s Soulseek query is "complete" because "peer_complete"
      And window "A"'s Soulseek page lists "Music\a.flac, Music\b.flac"

    Scenario: a list too long to keep says so
      Given the Soulseek limit "maxResults" is 2
      And the Soulseek peer "ann" shares:
        | path   | size |
        | a.flac | 30   |
        | b.flac | 31   |
        | c.flac | 32   |
      When window "A" browses the Soulseek peer "ann"
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query is "complete" because "limit"
      And window "A"'s Soulseek query holds 2 files

    Scenario: a list with an entry that cannot be read is a failure, with the rest kept
      Given the Soulseek peer "ann" shares:
        | path   | size |
        | a.flac | 30   |
        | b.flac | x    |
      When window "A" browses the Soulseek peer "ann"
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query has failed with "backend_error"
      And window "A"'s Soulseek page lists "a.flac"

    Scenario Outline: a list that does not arrive
      Given the Soulseek peer "ann" is "<mood>"
      When window "A" browses the Soulseek peer "ann"
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query has failed with "<code>"

      Examples:
        | mood     | code             |
        | offline  | peer_unavailable |
        | refusing | peer_denied      |

    Scenario: a daemon that cannot fetch the list
      Given the next Soulseek daemon "browse" fails with "unavailable:bad-response"
      When window "A" browses the Soulseek peer "ann"
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query has failed with "backend_error"

    Scenario: a person who never answers runs out of time
      Given the Soulseek peer "ann" is "silent"
      When window "A" browses the Soulseek peer "ann"
      And 29999 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query is "collecting"
      When 1 ms pass for Soulseek
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query has failed with "timeout"
      When the Soulseek peer "ann" answers at last
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query has failed with "timeout"
      And window "A"'s Soulseek query holds 0 files

    Scenario: a list that arrives after its time is up is not kept
      Given the Soulseek peer "ann" is "silent"
      When window "A" browses the Soulseek peer "ann"
      And 30000 ms pass for Soulseek
      And the Soulseek peer "ann" answers at last
      And window "A" stops its Soulseek query
      Then window "A"'s Soulseek query has failed with "timeout"

    Scenario: a browse that was stopped keeps nothing that arrives later
      Given the Soulseek peer "ann" is "silent"
      When window "A" browses the Soulseek peer "ann"
      And window "A" stops its Soulseek query
      Then window "A"'s Soulseek query is "stopped" because "cancelled"
      When the Soulseek peer "ann" answers at last
      And window "A" reads its Soulseek results
      Then window "A"'s Soulseek query is "stopped" because "cancelled"
      And window "A"'s Soulseek query holds 0 files

  Rule: A download is bound to the file handle it was asked for

    Background:
      Given window "A" has searched Soulseek for "rain" and found:
        | username | path   | size |
        | ann      | a.flac | 30   |
        | ben      | b.flac | 0    |

    Scenario: asking for the same file again gives the same download
      When window "A" downloads Soulseek file 1
      Then window "A"'s Soulseek transfer is "queued" with "0" bytes
      And window "A"'s Soulseek transfer shows no queue position or speed
      When window "A" downloads Soulseek file 1
      Then window "A" has the same Soulseek transfer as before
      And the Soulseek daemon was asked to "download" 1 times
      When window "A" asks Soulseek to "cancel" its transfer
      And window "A" downloads Soulseek file 1
      Then window "A" has the same Soulseek transfer as before
      And window "A"'s Soulseek transfer is "cancelled" with "0" bytes
      When window "A" releases its Soulseek "transfer"
      Then window "A" is told Soulseek released "something"
      When window "A" downloads Soulseek file 1
      Then window "A" has a new Soulseek transfer
      And window "A"'s Soulseek transfer is "queued" with "0" bytes

    Scenario: two requests for one file at the same moment make one download
      Given the Soulseek daemon takes its time over "download"
      When window "A" downloads Soulseek file 1
      And window "A" downloads Soulseek file 1
      And the Soulseek daemon gets on with "download"
      Then window "A" got 2 Soulseek answers for one transfer
      And the Soulseek daemon was asked to "download" 1 times

    Scenario: progress is read from the daemon, no more often than the applet is told to poll
      When window "A" downloads Soulseek file 1
      And the Soulseek daemon reports "a.flac" as "queued" with "0" bytes at queue position 3
      And window "A" asks Soulseek to "status" its transfer
      Then the Soulseek daemon was asked to "transfer" 0 times
      When 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "queued" with "0" bytes
      And window "A"'s Soulseek transfer is at queue position 3
      When the Soulseek daemon reports "a.flac" as "queued" with "0" bytes at queue position 0
      And 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer shows no queue position or speed
      When the Soulseek daemon reports "a.flac" as "transferring" with "12" bytes
      And 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "transferring" with "12" bytes
      And window "A"'s Soulseek transfer shows no queue position or speed
      When the Soulseek daemon reports "a.flac" as "transferring" with "45" bytes arriving at 400 bytes a second
      And 1000 ms pass for Soulseek
      And window "A" lists its Soulseek transfers
      Then window "A"'s Soulseek transfer is "transferring" with "30" bytes
      And window "A"'s Soulseek transfer arrives at 400 bytes a second
      When the Soulseek daemon reports "a.flac" as "complete" with "30" bytes
      And 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "complete" with "30" bytes
      And window "A"'s Soulseek transfer shows no queue position or speed
      When 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then the Soulseek daemon was asked to "transfer" 5 times

    Scenario: an empty file finishes straight from the queue
      When window "A" downloads Soulseek file 2
      And the Soulseek daemon reports "b.flac" as "complete" with "0" bytes
      And 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "complete" with "0" bytes

    Scenario Outline: what the daemon reports going wrong
      When window "A" downloads Soulseek file 1
      And the Soulseek daemon <event>
      And 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer has failed with "<code>"

      Examples:
        | event                                              | code             |
        | reports "a.flac" as failed because of "peer_denied" | peer_denied      |
        | reports "a.flac" as failed because of ""            | backend_error    |
        | reports "a.flac" as "complete" with "29" bytes      | backend_error    |
        | loses the transfer of "a.flac"                      | backend_error    |
        | is "unreachable"                                    | backend_error    |

    Scenario: a file that is not the size it was listed with is not downloaded
      When window "A" downloads Soulseek file 1
      And the Soulseek daemon reports "a.flac" as "31" bytes long
      And 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer has failed with "source_changed"
      And the Soulseek daemon holds no transfer of "a.flac"

    Scenario: the person stopping it in the daemon shows as cancelled
      When window "A" downloads Soulseek file 1
      And the Soulseek daemon reports "a.flac" as "cancelled" with "12" bytes
      And 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "cancelled" with "0" bytes

  Rule: Pause, resume and cancel follow NAP-SOULSEEK's table of states

    Scenario Outline: <action> on a download that is <state>
      Given window "A" holds a Soulseek transfer that is "<state>"
      When window "A" asks Soulseek to "<action>" its transfer
      Then window "A"'s Soulseek transfer is "<outcome>" with "<bytes>" bytes

      Examples:
        | state        | action | outcome      | bytes |
        | queued       | pause  | paused       | 0     |
        | transferring | pause  | paused       | 12    |
        | paused       | pause  | paused       | 12    |
        | paused       | resume | queued       | 12    |
        | queued       | resume | queued       | 0     |
        | transferring | resume | transferring | 12    |
        | queued       | cancel | cancelled    | 0     |
        | transferring | cancel | cancelled    | 0     |
        | paused       | cancel | cancelled    | 0     |
        | complete     | cancel | complete     | 30    |
        | cancelled    | cancel | cancelled    | 0     |

    Scenario: cancelling a failed download leaves it failed
      Given window "A" holds a Soulseek transfer that is "failed"
      When window "A" asks Soulseek to "cancel" its transfer
      Then window "A"'s Soulseek transfer has failed with "peer_unavailable"

    Scenario Outline: <action> on a download that has ended is refused
      Given window "A" holds a Soulseek transfer that is "<state>"
      When window "A" asks Soulseek to "<action>" its transfer
      Then window "A" is refused by Soulseek with "invalid_state"

      Examples:
        | state     | action |
        | complete  | pause  |
        | cancelled | pause  |
        | failed    | pause  |
        | complete  | resume |
        | cancelled | resume |
        | failed    | resume |

    Scenario: the daemon cannot pause, so a pause stops it there and a resume asks again
      Given window "A" holds a Soulseek transfer that is "transferring"
      When window "A" asks Soulseek to "pause" its transfer
      Then the Soulseek daemon holds the transfer of "a.flac" as "cancelled"
      When 5000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "paused" with "12" bytes
      And the Soulseek daemon was asked to "transfer" 1 times
      When window "A" asks Soulseek to "resume" its transfer
      Then window "A"'s Soulseek transfer is "queued" with "12" bytes
      And the Soulseek daemon was asked to "download" 2 times
      And the Soulseek daemon holds 1 transfers
      And the Soulseek daemon holds the transfer of "a.flac" as "queued"
      When 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "queued" with "0" bytes

    Scenario: a daemon that picks a stopped download up again under its old id keeps it
      Given the Soulseek daemon picks a stopped download up again under its old id
      And window "A" holds a Soulseek transfer that is "paused"
      When window "A" asks Soulseek to "resume" its transfer
      Then window "A"'s Soulseek transfer is "queued" with "12" bytes
      And the Soulseek daemon holds the transfer of "a.flac" as "queued"

    Scenario: cancelling removes the download from the daemon
      Given window "A" holds a Soulseek transfer that is "paused"
      When window "A" asks Soulseek to "cancel" its transfer
      Then the Soulseek daemon holds 0 transfers

    Scenario: cancelling a finished download deletes nothing
      Given window "A" holds a Soulseek transfer that is "complete"
      When window "A" asks Soulseek to "cancel" its transfer
      And window "A" releases its Soulseek "transfer"
      Then the Soulseek daemon holds the transfer of "a.flac" as "complete"

    Scenario Outline: a daemon that cannot be told to <action> fails the download
      Given window "A" holds a Soulseek transfer that is "queued"
      And the Soulseek daemon is "unreachable"
      When window "A" asks Soulseek to "<action>" its transfer
      Then window "A"'s Soulseek transfer has failed with "backend_error"

      Examples:
        | action |
        | pause  |
        | cancel |

    Scenario: a resume the daemon turns down fails the download
      Given window "A" holds a Soulseek transfer that is "paused"
      And the next Soulseek daemon "download" fails with "unavailable:rejected"
      When window "A" asks Soulseek to "resume" its transfer
      Then window "A"'s Soulseek transfer has failed with "backend_error"

    Scenario: a paused download waits for the daemon to be signed in again
      Given window "A" holds a Soulseek transfer that is "paused"
      And the Soulseek daemon is "signed out"
      When window "A" asks Soulseek to "resume" its transfer
      Then window "A" is refused by Soulseek with "unavailable"
      When the Soulseek daemon is "signed in"
      And window "A" asks Soulseek to "resume" its transfer
      Then window "A"'s Soulseek transfer is "queued" with "12" bytes

  Rule: A finished file stays in the daemon

    Scenario: kernl cannot read a finished file out to the applet
      Given window "A" holds a Soulseek transfer that is "complete"
      When window "A" reads 16 bytes of its Soulseek transfer from "0"
      Then window "A" is refused by Soulseek with "denied" saying "kernl cannot read what the sharing program downloaded; the file is in that program"
      When window "A" reads 16 bytes of its Soulseek transfer from "30"
      Then window "A" is refused by Soulseek with "denied"
      When window "A" reads 16 bytes of its Soulseek transfer from "31"
      Then window "A" is refused by Soulseek with "invalid_request"

    Scenario: kernl cannot save a finished file somewhere else
      Given window "A" holds a Soulseek transfer that is "complete"
      When window "A" asks Soulseek to "save" its transfer
      Then window "A" is refused by Soulseek with "unsupported"

    Scenario: an unfinished download can be neither read nor saved
      Given window "A" holds a Soulseek transfer that is "transferring"
      When window "A" reads 16 bytes of its Soulseek transfer from "0"
      Then window "A" is refused by Soulseek with "invalid_state"
      When window "A" asks Soulseek to "save" its transfer
      Then window "A" is refused by Soulseek with "invalid_state"

  Rule: A handle works only in the window it was given to

    Scenario: another window of the same applet cannot use, see or release them
      Given window "A" holds a Soulseek transfer that is "transferring"
      And window "B" searches Soulseek for "wind"
      When window "B" lists its Soulseek transfers
      Then window "B" holds 0 Soulseek transfers
      When window "B" learns window "A"'s Soulseek handles
      And window "B" reads its Soulseek results
      Then window "B" is refused by Soulseek with "not_found"
      When window "B" stops its Soulseek query
      Then window "B" is refused by Soulseek with "not_found"
      When window "B" downloads Soulseek file 1
      Then window "B" is refused by Soulseek with "not_found"
      When window "B" reads 16 bytes of its Soulseek transfer from "0"
      Then window "B" is refused by Soulseek with "not_found"
      When window "B" releases its Soulseek "query"
      Then window "B" is told Soulseek released "nothing"
      When window "B" releases its Soulseek "transfer"
      Then window "B" is told Soulseek released "nothing"
      And the Soulseek daemon holds the transfer of "a.flac" as "transferring"

    Scenario Outline: another window asking to <action> a download is told it does not exist
      Given window "A" holds a Soulseek transfer that is "transferring"
      And window "B" learns window "A"'s Soulseek handles
      When window "B" asks Soulseek to "<action>" its transfer
      Then window "B" is refused by Soulseek with "not_found" saying "Transfer handle is unavailable"

      Examples:
        | action |
        | status |
        | pause  |
        | resume |
        | cancel |
        | save   |

    Scenario: nothing the applet is told names the daemon's own ids
      Given window "A" holds a Soulseek transfer that is "transferring"
      When window "A" lists its Soulseek transfers
      Then no Soulseek answer named the daemon's own ids
      And every Soulseek answer carried exactly one of a value or an error

  Rule: Nothing a window started outlives it

    Scenario: closing a window stops its work in the daemon and leaves finished files alone
      Given window "A" holds a Soulseek transfer that is "complete"
      And window "A" downloads Soulseek file 2
      And window "A" browses the Soulseek peer "ann"
      When the Soulseek window "A" is closed
      Then the Soulseek daemon holds 0 searches
      And the Soulseek daemon holds 1 transfers
      And the Soulseek daemon holds the transfer of "a.flac" as "complete"

    Scenario: a window opened again starts from nothing
      Given window "A" holds a Soulseek transfer that is "transferring"
      When the Soulseek window "A" is closed
      And window "A" asks Soulseek to "status" its transfer
      Then window "A" is refused by Soulseek with "not_found"
      When window "A" reads its Soulseek results
      Then window "A" is refused by Soulseek with "not_found"
      When window "A" searches Soulseek for "rain"
      Then the person was asked the Soulseek question 2 times

    Scenario: taking the grant back does the same
      Given window "A" holds a Soulseek transfer that is "paused"
      When the Soulseek grant of window "A" is taken back
      Then the Soulseek daemon holds 0 searches
      And the Soulseek daemon holds 0 transfers
      When window "A" lists its Soulseek transfers
      Then window "A" holds 0 Soulseek transfers

    Scenario: shutting the service down ends every window's work
      Given window "A" holds a Soulseek transfer that is "queued"
      And window "B" searches Soulseek for "wind"
      When the Soulseek service is shut down
      Then the Soulseek daemon holds 0 searches
      And the Soulseek daemon holds 0 transfers

    Scenario: unregistering the service ends every window's work
      Given window "A" holds a Soulseek transfer that is "queued"
      When the Soulseek service is unregistered
      Then the Soulseek daemon holds 0 transfers

    Scenario: closing a window that asked for nothing does nothing
      When the Soulseek window "B" is closed
      Then the Soulseek daemon was asked to "cancel" 0 times

    Scenario: a daemon that cannot be reached when a window closes is left as it is
      Given window "A" holds a Soulseek transfer that is "queued"
      And the Soulseek daemon is "unreachable"
      When the Soulseek window "A" is closed
      Then the Soulseek daemon was asked to "cancel" 1 times
      And the Soulseek daemon holds 1 transfers
      And the Soulseek daemon holds 1 searches

  Rule: Work that is released or revoked while it is under way leaves nothing behind

    Background:
      Given window "A" has searched Soulseek for "rain" and found:
        | username | path   | size |
        | ann      | a.flac | 30   |

    Scenario: a poll under way when its search is released
      Given the Soulseek daemon takes its time over "searchResults"
      When 1000 ms pass for Soulseek
      And window "A" reads its Soulseek results
      And window "A" releases its Soulseek "query"
      And the Soulseek daemon gets on with "searchResults"
      Then window "A" got Soulseek answers "cancelled, released"
      And the Soulseek daemon holds 0 searches

    Scenario: a download under way when its search is released
      Given the Soulseek daemon takes its time over "download"
      When window "A" downloads Soulseek file 1
      And window "A" releases its Soulseek "query"
      And the Soulseek daemon gets on with "download"
      Then window "A" got Soulseek answers "released, cancelled"
      And the Soulseek daemon holds 0 transfers

    Scenario: a download waiting its turn when its search is released
      Given the Soulseek daemon takes its time over "startSearch"
      When window "A" searches Soulseek for "wind"
      And window "A" downloads Soulseek file 1
      And window "A" releases its Soulseek "query"
      And the Soulseek daemon gets on with "startSearch"
      Then window "A" got Soulseek answers "released, collecting, cancelled"
      And the Soulseek daemon was asked to "download" 0 times

    Scenario: a download under way when the window closes
      Given the Soulseek daemon takes its time over "download"
      When window "A" downloads Soulseek file 1
      And the Soulseek window "A" is closed
      And the Soulseek daemon gets on with "download"
      Then window "A" is refused by Soulseek with "revoked"
      And the Soulseek daemon holds 0 transfers

    Scenario: a search under way when the window closes
      Given the Soulseek daemon takes its time over "startSearch"
      When window "A" searches Soulseek for "wind"
      And the Soulseek window "A" is closed
      And the Soulseek daemon gets on with "startSearch"
      Then window "A" is refused by Soulseek with "revoked"
      And the Soulseek daemon holds 0 searches

    Scenario: a request waiting its turn when the window closes
      Given the Soulseek daemon takes its time over "startSearch"
      When window "A" searches Soulseek for "wind"
      And window "A" searches Soulseek for "hail"
      And the Soulseek window "A" is closed
      And the Soulseek daemon gets on with "startSearch"
      Then window "A" got Soulseek answers "revoked, revoked"
      And the Soulseek daemon holds 0 searches

    Scenario: a status check under way when its download is released
      Given window "A" downloads Soulseek file 1
      And the Soulseek daemon takes its time over "transfer"
      When 1000 ms pass for Soulseek
      And window "A" asks Soulseek to "status" its transfer
      And window "A" releases its Soulseek "transfer"
      And the Soulseek daemon gets on with "transfer"
      Then window "A" got Soulseek answers "cancelled, released"
      And the Soulseek daemon holds 0 transfers

    Scenario: a resume under way when its download is released
      Given window "A" downloads Soulseek file 1
      And window "A" asks Soulseek to "pause" its transfer
      And the Soulseek daemon takes its time over "download"
      When window "A" asks Soulseek to "resume" its transfer
      And window "A" releases its Soulseek "transfer"
      And the Soulseek daemon gets on with "download"
      Then window "A" got Soulseek answers "cancelled, released"
      And the Soulseek daemon holds 0 transfers

    Scenario: a list of downloads under way when the window closes
      Given window "A" downloads Soulseek file 1
      And the Soulseek daemon takes its time over "transfer"
      When 1000 ms pass for Soulseek
      And window "A" lists its Soulseek transfers
      And the Soulseek window "A" is closed
      And the Soulseek daemon gets on with "transfer"
      Then window "A" is refused by Soulseek with "revoked"

  Rule: Without a daemon to reach, new work is refused and what is held stays readable

    Scenario Outline: new work when the daemon is <condition>
      Given window "A" holds a Soulseek transfer that is "paused"
      And window "A" stops its Soulseek query
      And the Soulseek daemon is "<condition>"
      When window "A" searches Soulseek for "wind"
      Then window "A" is refused by Soulseek with "unavailable"
      When window "A" browses the Soulseek peer "ann"
      Then window "A" is refused by Soulseek with "unavailable"
      When window "A" asks Soulseek to "resume" its transfer
      Then window "A" is refused by Soulseek with "unavailable"
      When window "A" reads its Soulseek results
      Then window "A"'s Soulseek page lists "a.flac, b.flac"
      When window "A" stops its Soulseek query
      Then window "A"'s Soulseek query is "stopped" because "cancelled"
      When window "A" downloads Soulseek file 1
      Then window "A"'s Soulseek transfer is "paused" with "12" bytes
      When window "A" downloads Soulseek file 2
      Then window "A" is refused by Soulseek with "unavailable"
      When window "A" lists its Soulseek transfers
      Then window "A" holds 1 Soulseek transfers
      When window "A" asks Soulseek to "status" its transfer
      Then window "A"'s Soulseek transfer is "paused" with "12" bytes
      When window "A" releases its Soulseek "query"
      Then window "A" is told Soulseek released "something"

      Examples:
        | condition                |
        | signed out               |
        | unreachable              |
        | refusing kernl's sign-in |

    Scenario: no daemon set up
      Given the Soulseek daemon is "not set up"
      When window "A" searches Soulseek for "wind"
      Then window "A" is refused by Soulseek with "unavailable" saying "No sharing program is set up"
      And the person was asked the Soulseek question 0 times

    Scenario Outline: a daemon that turns down new work makes nothing
      Given window "A" has searched Soulseek for "rain" and found:
        | username | path   | size |
        | ann      | a.flac | 30   |
      And the next Soulseek daemon "<call>" fails with "<reason>"
      When window "A" <request>
      Then window "A" is refused by Soulseek with "backend_error" saying "The sharing program did not do what was asked"
      And the Soulseek daemon holds 1 searches
      And the Soulseek daemon holds 0 transfers

      Examples:
        | call        | reason                   | request                    |
        | startSearch | unavailable:rejected     | searches Soulseek for "x"  |
        | startSearch | unavailable:timeout      | searches Soulseek for "x"  |
        | download    | unavailable:bad-response | downloads Soulseek file 1  |
        | download    | denied:credentials       | downloads Soulseek file 1  |

  Rule: A request that is not well formed changes nothing

    Scenario Outline: <operation> with <problem>
      Given window "A" holds a Soulseek transfer that is "complete"
      When window "A" sends Soulseek "<operation>" with '<fields>'
      Then window "A" is refused by Soulseek with "invalid_request"

      Examples:
        | operation | problem                    | fields                                                     |
        | info      | a field it does not define | {"extra":1}                                                |
        | search    | no request                 | {}                                                         |
        | search    | a request that is text     | {"request":"rain"}                                         |
        | search    | a request that is null     | {"request":null}                                           |
        | search    | an unknown request field   | {"request":{"text":"rain","limit":5}}                      |
        | search    | words that are a number    | {"request":{"text":5}}                                     |
        | search    | no words                   | {"request":{"text":""}}                                    |
        | search    | only white space           | {"request":{"text":"   "}}                                 |
        | search    | U+0000 in the words        | {"request":{"text":"ra\u0000in"}}                          |
        | search    | half a character           | {"request":{"text":"ra\ud800in"}}                          |
        | search    | words that are too long    | {"request":{"text":"$long"}}                               |
        | search    | an empty peer name         | {"request":{"text":"rain","username":""}}                  |
        | search    | a field it does not define | {"request":{"text":"rain"},"limit":5}                      |
        | browse    | no peer name               | {}                                                         |
        | browse    | a peer name that is null   | {"username":null}                                          |
        | browse    | a field it does not define | {"username":"ann","depth":2}                               |
        | results   | no query                   | {}                                                         |
        | results   | a negative start           | {"queryId":"$query","after":-1}                            |
        | results   | a start that is text       | {"queryId":"$query","after":"0"}                           |
        | results   | a fractional start         | {"queryId":"$query","after":0.5}                           |
        | results   | a page of nothing          | {"queryId":"$query","limit":0}                             |
        | results   | too large a page           | {"queryId":"$query","limit":101}                           |
        | results   | a field it does not define | {"queryId":"$query","before":3}                            |
        | stop      | a field it does not define | {"queryId":"$query","now":true}                            |
        | stop      | a query that is a number   | {"queryId":7}                                              |
        | download  | no file                    | {}                                                         |
        | download  | a place to put it          | {"fileId":"$file","path":"/tmp/x"}                         |
        | transfers | a field it does not define | {"state":"queued"}                                         |
        | status    | no transfer                | {}                                                         |
        | pause     | a field it does not define | {"transferId":"$transfer","force":true}                    |
        | resume    | a transfer that is a list  | {"transferId":["$transfer"]}                               |
        | cancel    | an empty transfer          | {"transferId":""}                                          |
        | read      | no offset                  | {"transferId":"$transfer","length":3}                      |
        | read      | an offset with a zero in front | {"transferId":"$transfer","offset":"00","length":3}    |
        | read      | an offset that is a number | {"transferId":"$transfer","offset":0,"length":3}           |
        | read      | a negative offset          | {"transferId":"$transfer","offset":"-1","length":3}        |
        | read      | an offset past 64 bits     | {"transferId":"$transfer","offset":"18446744073709551616","length":3} |
        | read      | no length                  | {"transferId":"$transfer","offset":"0"}                    |
        | read      | a length of nothing        | {"transferId":"$transfer","offset":"0","length":0}         |
        | read      | too long a length          | {"transferId":"$transfer","offset":"0","length":65537}     |
        | read      | a field it does not define | {"transferId":"$transfer","offset":"0","length":3,"as":"text"} |
        | save      | a place to put it          | {"transferId":"$transfer","path":"/tmp/x"}                 |
        | release   | no kind                    | {"handle":"$query"}                                        |
        | release   | a kind it does not know    | {"kind":"file","handle":"$file"}                           |
        | release   | no handle                  | {"kind":"query"}                                           |
        | release   | a field it does not define | {"kind":"query","handle":"$query","all":true}              |

    Scenario: a rejected request starts nothing and asks the person nothing
      When window "A" sends Soulseek "search" with '{"request":{"text":"rain","limit":5}}'
      And window "A" sends Soulseek "browse" with '{"username":""}'
      Then the person was asked the Soulseek question 0 times
      And the Soulseek daemon was asked to "startSearch" 0 times
      And the Soulseek daemon was asked to "browse" 0 times

    Scenario: the largest offset there is reads as an offset
      Given window "A" holds a Soulseek transfer that is "complete"
      When window "A" reads 16 bytes of its Soulseek transfer from "18446744073709551615"
      Then window "A" is refused by Soulseek with "invalid_request" saying "offset is past the end of the file"

  Rule: Every request is answered once

    Scenario: a request id used twice is not carried out again
      When window "A" sends the raw Soulseek message '{"type":"soulseek.search","id":"q1","request":{"text":"rain"}}'
      And window "A" sends the raw Soulseek message '{"type":"soulseek.search","id":"q1","request":{"text":"rain"}}'
      Then window "A" got 1 Soulseek answers
      And the Soulseek daemon was asked to "startSearch" 1 times
      When window "B" sends the raw Soulseek message '{"type":"soulseek.info","id":"q1"}'
      Then window "B" got 1 Soulseek answers

    Scenario Outline: a message that cannot be answered is dropped
      When window "A" sends the raw Soulseek message '<message>'
      Then window "A" got 0 Soulseek answers

      Examples:
        | message                                |
        | {"type":"soulseek.info"}               |
        | {"type":"soulseek.info","id":""}       |
        | {"type":"soulseek.info","id":7}        |
        | {"type":"soulseek.login","id":"q1"}    |

    Scenario: a request id that is too long is refused
      When window "A" sends the raw Soulseek message '{"type":"soulseek.info","id":"$long"}'
      Then window "A" is refused by Soulseek with "invalid_request"

    Scenario: a window that is not a running applet is refused
      Given the Soulseek window "A" stops being an applet
      When window "A" asks for Soulseek info
      Then window "A" is refused by Soulseek with "denied" saying "This window is not a running applet"

    Scenario: the service says which messages it takes
      Then the Soulseek service takes the messages "info, search, browse, results, stop, download, transfers, status, pause, resume, cancel, read, save, release" and asks no further grant for any
