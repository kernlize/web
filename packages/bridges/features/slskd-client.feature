Feature: slskd client
  kernl reaches the Soulseek network through a slskd daemon the person already
  runs. The client speaks slskd's own REST API and hands the shell the same plain
  shapes whatever the daemon's version: sizes as exact decimal text, a peer's paths
  as the peer sent them, entries that cannot be represented left out, and failures
  as stable reasons that never repeat a key, an address or a path on the daemon's disk.

  Background:
    Given a slskd daemon

  Rule: the daemon is opened with the key or the session it asks for

    Scenario: a key opens the daemon
      Given the slskd daemon asks for the key "0123456789abcdef-key"
      And the slskd client holds the key "0123456789abcdef-key"
      When the slskd client asks which version is running
      Then the slskd client answers:
        """
        { "version": "0.26.2.0" }
        """
      And every slskd request carried "0123456789abcdef-key" as "x-api-key" and nothing else that opens the daemon

    Scenario: a key is used even when a name and password are also known
      Given the slskd daemon asks for the key "0123456789abcdef-key"
      And the slskd daemon asks for the name "admin" and the password "correct horse"
      And the slskd client holds the key "0123456789abcdef-key"
      When the slskd client asks whether the daemon is signed in
      Then the slskd client answers:
        """
        "offline"
        """
      And the slskd daemon was asked "POST /session" 0 times

    Scenario: a name and password start one session that later requests share
      Given the slskd daemon asks for the name "admin" and the password "correct horse"
      And the slskd client holds the name "admin" and the password "correct horse"
      When the slskd client asks which version is running
      And the slskd client asks whether the daemon is signed in
      Then the slskd client answers:
        """
        "offline"
        """
      And the slskd daemon was asked "POST /session" 1 time
      And the slskd daemon received "POST /session" with the body:
        """
        {"username":"admin","password":"correct horse"}
        """

    Scenario: a daemon that started again and forgot the session is signed in to once more
      Given the slskd daemon asks for the name "admin" and the password "correct horse"
      And the slskd client holds the name "admin" and the password "correct horse"
      When the slskd client asks which version is running
      And the slskd daemon starts again and forgets its sessions
      And the slskd client asks which version is running
      Then the slskd client answers:
        """
        { "version": "0.26.2.0" }
        """
      And the slskd daemon was asked "POST /session" 2 times

    Scenario: a daemon that keeps refusing a fresh session is not asked a third time
      Given the slskd daemon asks for the name "admin" and the password "correct horse"
      And the slskd client holds the name "admin" and the password "correct horse"
      And the slskd daemon will answer "GET /application" with status 401 and body ""
      And the slskd daemon will answer "GET /application" with status 403 and body ""
      When the slskd client asks which version is running
      Then the slskd client fails with "denied:credentials"
      And the slskd daemon was asked "GET /application" 2 times

    Scenario: a daemon with no lock is asked without credentials
      When the slskd client asks which version is running
      Then the slskd client answers:
        """
        { "version": "0.26.2.0" }
        """

    Scenario: the wrong key is refused, and the failure does not repeat it
      Given the slskd daemon asks for the key "0123456789abcdef-key"
      And the slskd client holds the key "a-key-from-somewhere-else"
      When the slskd client asks which version is running
      Then the slskd client fails with "denied:credentials"
      And the slskd failure says exactly "denied:credentials"

    Scenario: the wrong password is refused, and the failure does not repeat it
      Given the slskd daemon asks for the name "admin" and the password "correct horse"
      And the slskd client holds the name "admin" and the password "battery staple"
      When the slskd client asks which version is running
      Then the slskd client fails with "denied:credentials"
      And the slskd failure says exactly "denied:credentials"
      And the slskd daemon was asked "GET /application" 0 times

    Scenario: a name without a password is refused by the daemon
      Given the slskd daemon asks for the name "admin" and the password "correct horse"
      And the slskd client holds only the name "admin"
      When the slskd client asks which version is running
      Then the slskd client fails with "denied:credentials"

    Scenario: a password without a name is refused by the daemon
      Given the slskd daemon asks for the name "admin" and the password "correct horse"
      And the slskd client holds only the password "correct horse"
      When the slskd client asks which version is running
      Then the slskd client fails with "denied:credentials"

    Scenario: a locked daemon refuses a client that holds nothing
      Given the slskd daemon asks for the key "0123456789abcdef-key"
      When the slskd client asks which version is running
      Then the slskd client fails with "denied:credentials"

    Scenario Outline: a sign-in the daemon does not complete is a failure, and no request follows it
      Given the slskd daemon asks for the name "admin" and the password "correct horse"
      And the slskd client holds the name "admin" and the password "correct horse"
      And the slskd daemon will answer "POST /session" with status <status> and body '<body>'
      When the slskd client asks which version is running
      Then the slskd client fails with "unavailable:bad-response"
      And the slskd daemon was asked "GET /application" 0 times

      Examples:
        | status | body                                                 |
        | 200    | {"name":"admin"}                                     |
        | 200    | {"token":""}                                         |
        | 200    | "a token"                                            |
        | 500    | "Login disabled, check application logs for details" |

  Rule: the daemon says what it is and whether it is on the network

    Scenario: a daemon signed in to the network is online
      Given the slskd daemon is signed in to the network
      When the slskd client asks whether the daemon is signed in
      Then the slskd client answers:
        """
        "online"
        """

    Scenario: a daemon with no Soulseek login is offline
      When the slskd client asks whether the daemon is signed in
      Then the slskd client answers:
        """
        "offline"
        """

    Scenario Outline: an answer that is not slskd's is not trusted
      Given the slskd daemon will answer "<request>" with status <status> and body '<body>'
      When the slskd client asks <question>
      Then the slskd client fails with "<reason>"

      Examples:
        | question                        | request          | status | body                                                    | reason                   |
        | which version is running        | GET /application | 200    | <html>router login</html>                               | unavailable:bad-response |
        | which version is running        | GET /application | 200    | []                                                      | unavailable:bad-response |
        | which version is running        | GET /application | 200    | {}                                                      | unavailable:bad-response |
        | which version is running        | GET /application | 200    | {"version":"0.26.2.0"}                                  | unavailable:bad-response |
        | which version is running        | GET /application | 200    | {"version":{"current":""}}                              | unavailable:bad-response |
        | which version is running        | GET /application | 500    | "Object reference not set to an instance of an object." | unavailable:bad-response |
        | which version is running        | GET /application | 404    |                                                         | unavailable:not-found    |
        | whether the daemon is signed in | GET /server      | 200    | {"state":"None"}                                        | unavailable:bad-response |
        | whether the daemon is signed in | GET /server      | 200    | null                                                    | unavailable:bad-response |

    Scenario: a daemon that does not answer in time
      Given the slskd client waits at most 50 ms for an answer
      And the slskd daemon will stay silent on "GET /application"
      When the slskd client asks which version is running
      Then the slskd client fails with "unavailable:timeout"

    Scenario: a daemon that is not running
      Given the slskd daemon is switched off
      When the slskd client asks which version is running
      Then the slskd client fails with "unavailable:unreachable"

  Rule: a search gathers what peers offer

    Scenario: a search is started with an id of the client's own, the time allowed and the number of files wanted
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "field recording" for 20000 ms keeping at most 300 files
      Then the slskd search id is a random identifier of the kind the daemon makes itself
      And the slskd daemon received "POST /searches" with the body:
        """
        {"id":"$search","searchText":"field recording","searchTimeout":20000,"responseLimit":300,"fileLimit":300}
        """

    Scenario: the daemon keeps a search's answers to itself until the search ends
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "field recording"
      And the slskd client reads the search
      Then the slskd client answers:
        """
        { "complete": false, "files": [] }
        """

    Scenario: a finished search lists every file, open and locked, as the peers described them
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "field recording"
      And the slskd daemon finishes the search with these answers:
        """
        [
          {
            "username": "field-recorder", "fileCount": 2, "lockedFileCount": 1, "hasFreeUploadSlot": true, "queueLength": 0, "token": 7, "uploadSpeed": 120000,
            "files": [
              { "code": 1, "filename": "@@abc\\Recordings\\rain.flac", "size": 31415926, "extension": "flac", "bitDepth": 24, "sampleRate": 96000, "length": 185, "isLocked": false },
              { "code": 1, "filename": "@@abc\\Recordings\\wind.mp3", "size": 4200000, "extension": "", "bitRate": 320, "isVariableBitRate": false, "length": 0, "isLocked": false }
            ],
            "lockedFiles": [
              { "code": 1, "filename": "@@abc\\Private\\voice memo.txt", "size": 0, "extension": "txt", "isLocked": false }
            ]
          },
          {
            "username": "Tape Head", "fileCount": 1, "lockedFileCount": 0, "hasFreeUploadSlot": false, "queueLength": 12, "token": 7, "uploadSpeed": 0,
            "files": [ { "code": 1, "filename": "music/field/Rain (take 2).ogg", "size": 9007199254740991, "isLocked": false } ],
            "lockedFiles": []
          }
        ]
        """
      And the slskd client reads the search
      Then the slskd client answers:
        """
        {
          "complete": true,
          "files": [
            { "username": "field-recorder", "path": "@@abc\\Recordings\\rain.flac", "size": "31415926", "locked": false, "extension": "flac", "durationSeconds": 185, "sampleRateHz": 96000, "bitDepth": 24 },
            { "username": "field-recorder", "path": "@@abc\\Recordings\\wind.mp3", "size": "4200000", "locked": false, "bitrateKbps": 320, "durationSeconds": 0 },
            { "username": "field-recorder", "path": "@@abc\\Private\\voice memo.txt", "size": "0", "locked": true, "extension": "txt" },
            { "username": "Tape Head", "path": "music/field/Rain (take 2).ogg", "size": "9007199254740991", "locked": false }
          ]
        }
        """

    Scenario: what a peer sent that cannot be represented is left out, and the rest is kept
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "field recording"
      And the slskd daemon finishes the search with these answers:
        """
        [
          {
            "username": "field-recorder",
            "files": [
              { "filename": "kept.flac", "size": 3, "extension": 7, "bitRate": 0, "length": -1, "sampleRate": 44100.5, "bitDepth": "16" },
              { "filename": "", "size": 3 },
              { "filename": 12, "size": 3 },
              { "size": 3 },
              { "filename": "a\u0000b.flac", "size": 3 },
              { "filename": "half \ud83d a pair.flac", "size": 3 },
              { "filename": "pair \ud83c\udfa4 kept.flac", "size": 3 },
              { "filename": "tail \udfa4.flac", "size": 3 },
              { "filename": "negative.flac", "size": -1 },
              { "filename": "fraction.flac", "size": 1.5 },
              { "filename": "past what a number holds.flac", "size": 9007199254740993 },
              { "filename": "text size.flac", "size": "3" },
              { "filename": "no size.flac" },
              "not a file"
            ]
          },
          { "files": [ { "filename": "nobody.flac", "size": 3 } ] },
          { "username": "", "files": [ { "filename": "empty name.flac", "size": 3 } ] },
          { "username": "no-lists" },
          "not an answer"
        ]
        """
      And the slskd client reads the search
      Then the slskd client answers:
        """
        {
          "complete": true,
          "files": [
            { "username": "field-recorder", "path": "kept.flac", "size": "3", "locked": false },
            { "username": "field-recorder", "path": "pair 🎤 kept.flac", "size": "3", "locked": false }
          ]
        }
        """

    Scenario: no more files are handed on than were asked for
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "rain" for 15000 ms keeping at most 2 files
      And the slskd daemon finishes the search with these answers:
        """
        [ { "username": "field-recorder", "files": [ { "filename": "a.flac", "size": 1 }, { "filename": "b.flac", "size": 2 }, { "filename": "c.flac", "size": 3 } ] } ]
        """
      And the slskd client reads the search
      Then the slskd client answers:
        """
        {
          "complete": true,
          "files": [
            { "username": "field-recorder", "path": "a.flac", "size": "1", "locked": false },
            { "username": "field-recorder", "path": "b.flac", "size": "2", "locked": false }
          ]
        }
        """

    Scenario: a search of one peer is a network search with everyone else's answers left out
      Given the slskd daemon is signed in to the network
      When the slskd client searches the peer "Tape Head" for "rain" keeping at most 1 files
      And the slskd daemon finishes the search with these answers:
        """
        [
          { "username": "field-recorder", "files": [ { "filename": "a.flac", "size": 1 } ] },
          { "username": "tape head", "files": [ { "filename": "b.flac", "size": 2 } ] },
          { "username": "Tape Head", "files": [ { "filename": "c.flac", "size": 3 }, { "filename": "d.flac", "size": 4 } ] }
        ]
        """
      And the slskd client reads the search
      Then the slskd client answers:
        """
        { "complete": true, "files": [ { "username": "Tape Head", "path": "c.flac", "size": "3", "locked": false } ] }
        """
      And the slskd daemon received "POST /searches" with the body:
        """
        {"id":"$search","searchText":"rain","searchTimeout":15000}
        """

    Scenario: the daemon is never given less time than the least it accepts
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "rain" for 1 ms keeping at most 10 files
      Then the slskd daemon received "POST /searches" with the body:
        """
        {"id":"$search","searchText":"rain","searchTimeout":5,"responseLimit":10,"fileLimit":10}
        """

    Scenario: a search the client did not start is read whole
      Given the slskd daemon holds a finished search "11111111-2222-4333-8444-555555555555" with these answers:
        """
        [ { "username": "field-recorder", "files": [ { "filename": "a.flac", "size": 1 } ] } ]
        """
      When the slskd client reads the search
      Then the slskd client answers:
        """
        { "complete": true, "files": [ { "username": "field-recorder", "path": "a.flac", "size": "1", "locked": false } ] }
        """

    Scenario: an offline daemon declines a search, and the record it leaves behind is taken back
      When the slskd client searches for "field recording"
      Then the slskd client fails with "unavailable:rejected"
      And the slskd failure says exactly "unavailable:rejected: the daemon is not signed in to the network"
      And the slskd daemon holds 0 searches

    Scenario: an offline daemon's refusal stands even when the record cannot be taken back
      Given the slskd daemon will hang up on "DELETE /searches"
      When the slskd client searches for "field recording"
      Then the slskd client fails with "unavailable:rejected"
      And the slskd daemon holds 1 search

    Scenario Outline: a daemon that declines a search for its own reasons
      Given the slskd daemon is signed in to the network
      And the slskd daemon will answer "POST /searches" with status <status> and body '<body>'
      When the slskd client searches for "field recording"
      Then the slskd client fails with "<reason>"

      Examples:
        | status | body                                                                                    | reason                   |
        | 429    | "Only one concurrent operation is permitted. Wait until the previous request completes" | unavailable:rejected     |
        | 409    | "The search could not be started"                                                       | unavailable:rejected     |
        | 400    | "An active search with token 7 is already in progress"                                  | unavailable:rejected     |
        | 500    | "Object reference not set to an instance of an object."                                 | unavailable:bad-response |
        | 200    | {"id":"99999999-2222-4333-8444-555555555555","state":"InProgress"}                      | unavailable:bad-response |

    Scenario Outline: a search that could not be meant is refused before the daemon hears of it
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "<text>" for <time> ms keeping at most <limit> files
      Then the slskd client fails with "<reason>"
      And the slskd daemon was never asked

      Examples:
        | text | time  | limit | reason          |
        |      | 15000 | 500   | invalid:text    |
        | rain | 0     | 500   | invalid:timeout |
        | rain | 1.5   | 500   | invalid:timeout |
        | rain | 15000 | 0     | invalid:limit   |
        | rain | 15000 | 2.5   | invalid:limit   |

    Scenario Outline: search text that is blank or broken is refused before the daemon hears of it
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "<text>"
      Then the slskd client fails with "invalid:text"
      And the slskd daemon was never asked

      Examples:
        | text       |
        | \t         |
        | a\u0000b   |
        | half \ud83d |

    Scenario: a search of a peer with no name is refused before the daemon hears of it
      Given the slskd daemon is signed in to the network
      When the slskd client searches the peer "" for "rain" keeping at most 10 files
      Then the slskd client fails with "invalid:username"
      And the slskd daemon was never asked

    Scenario: stopping a search ends it and keeps what it gathered readable
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "field recording"
      And the slskd client stops the search
      Then the slskd client answers nothing
      When the slskd client reads the search
      Then the slskd client answers:
        """
        { "complete": true, "files": [] }
        """

    Scenario: forgetting a search removes it from the daemon
      Given the slskd daemon is signed in to the network
      When the slskd client searches for "field recording"
      And the slskd client forgets the search
      Then the slskd client answers nothing
      And the slskd daemon holds 0 searches
      When the slskd client reads the search
      Then the slskd client fails with "unavailable:not-found"

    Scenario: forgetting a search the daemon no longer has is already done
      Given the slskd client knows of a search "11111111-2222-4333-8444-555555555555"
      When the slskd client forgets the search
      Then the slskd client answers nothing

    Scenario: a daemon that fails to forget a search says so
      Given the slskd client knows of a search "11111111-2222-4333-8444-555555555555"
      And the slskd daemon will answer "DELETE /searches" with status 500 and body '"database is locked"'
      When the slskd client forgets the search
      Then the slskd client fails with "unavailable:bad-response"
      And the slskd failure says exactly "unavailable:bad-response: the daemon answered 500"

    Scenario: a search the daemon does not know cannot be read or stopped
      Given the slskd client knows of a search "11111111-2222-4333-8444-555555555555"
      When the slskd client reads the search
      Then the slskd client fails with "unavailable:not-found"
      When the slskd client stops the search
      Then the slskd client fails with "unavailable:not-found"

    Scenario: a search answer that is not a search is not trusted
      Given the slskd client knows of a search "11111111-2222-4333-8444-555555555555"
      And the slskd daemon will answer "GET /searches" with status 200 and body '{"responses":[]}'
      When the slskd client reads the search
      Then the slskd client fails with "unavailable:bad-response"

    Scenario Outline: an id that would send the request somewhere else is refused before the daemon hears of it
      Given the slskd client knows of a search "<id>"
      When the slskd client reads the search
      Then the slskd client fails with "invalid:id"
      And the slskd daemon was never asked

      Examples:
        | id |
        |    |
        | .  |
        | .. |

  Rule: a peer's shared files are listed flat, each with its whole path

    Scenario: folders and files are joined the way the peer writes paths
      Given the slskd daemon is signed in to the network
      And the slskd peer "field-recorder" shares:
        """
        {
          "directories": [
            { "name": "@@abc\\Recordings", "fileCount": 2, "files": [
              { "code": 1, "filename": "rain.flac", "size": 31415926, "extension": "flac", "attributeCount": 2, "attributes": [ { "type": "Length", "value": 185 }, { "type": "SampleRate", "value": 96000 } ], "length": 185, "sampleRate": 96000 },
              { "code": 1, "filename": "wind.mp3", "size": 4200000, "extension": "mp3", "attributeCount": 1, "attributes": [ { "type": "BitRate", "value": 320 } ], "bitRate": 320 }
            ] },
            { "name": "@@abc\\Recordings\\Empty", "fileCount": 0, "files": [] }
          ],
          "directoryCount": 2,
          "lockedDirectories": [
            { "name": "@@abc\\Private", "fileCount": 1, "files": [ { "code": 1, "filename": "voice memo.txt", "size": 0, "extension": "txt", "attributeCount": 0, "attributes": [] } ] }
          ],
          "lockedDirectoryCount": 1
        }
        """
      When the slskd client browses the peer "field-recorder"
      Then the slskd client answers:
        """
        [
          { "username": "field-recorder", "path": "@@abc\\Recordings\\rain.flac", "size": "31415926", "locked": false, "extension": "flac", "durationSeconds": 185, "sampleRateHz": 96000 },
          { "username": "field-recorder", "path": "@@abc\\Recordings\\wind.mp3", "size": "4200000", "locked": false, "extension": "mp3", "bitrateKbps": 320 },
          { "username": "field-recorder", "path": "@@abc\\Private\\voice memo.txt", "size": "0", "locked": true, "extension": "txt" }
        ]
        """

    Scenario: a peer that writes paths with forward slashes keeps them
      Given the slskd daemon is signed in to the network
      And the slskd peer "Tape Head" shares:
        """
        {
          "directories": [
            { "name": "music", "files": [ { "filename": "top.ogg", "size": 1 } ] },
            { "name": "music/field", "files": [ { "filename": "Rain (take 2).ogg", "size": 2 } ] }
          ],
          "lockedDirectories": []
        }
        """
      When the slskd client browses the peer "Tape Head"
      Then the slskd client answers:
        """
        [
          { "username": "Tape Head", "path": "music/top.ogg", "size": "1", "locked": false },
          { "username": "Tape Head", "path": "music/field/Rain (take 2).ogg", "size": "2", "locked": false }
        ]
        """

    Scenario: a listing whose folders show no separator is joined the usual way
      Given the slskd daemon is signed in to the network
      And the slskd peer "field-recorder" shares:
        """
        {
          "directories": [
            { "name": "shared", "files": [ { "filename": "a.flac", "size": 1 } ] },
            { "name": "", "files": [ { "filename": "loose.flac", "size": 2 } ] }
          ]
        }
        """
      When the slskd client browses the peer "field-recorder"
      Then the slskd client answers:
        """
        [
          { "username": "field-recorder", "path": "shared\\a.flac", "size": "1", "locked": false },
          { "username": "field-recorder", "path": "loose.flac", "size": "2", "locked": false }
        ]
        """

    Scenario: folders and files that cannot be represented are left out of a listing
      Given the slskd daemon is signed in to the network
      And the slskd peer "field-recorder" shares:
        """
        {
          "directories": [
            { "files": [ { "filename": "in a folder with no name.flac", "size": 1 } ] },
            { "name": 7, "files": [ { "filename": "in a numbered folder.flac", "size": 1 } ] },
            "not a folder",
            { "name": "a\\b", "files": [
              { "filename": "kept.flac", "size": 1 },
              { "filename": "", "size": 1 },
              { "size": 1 },
              { "filename": "nul\u0000.flac", "size": 1 },
              { "filename": "negative.flac", "size": -5 }
            ] },
            { "name": "bro\u0000ken", "files": [ { "filename": "in a broken folder.flac", "size": 1 } ] }
          ],
          "lockedDirectories": "none"
        }
        """
      When the slskd client browses the peer "field-recorder"
      Then the slskd client answers:
        """
        [ { "username": "field-recorder", "path": "a\\b\\kept.flac", "size": "1", "locked": false } ]
        """

    Scenario: a peer's name is sent whole, whatever characters it holds
      Given the slskd daemon is signed in to the network
      And the slskd peer "some body/else?#" shares:
        """
        { "directories": [ { "name": "x\\y", "files": [ { "filename": "a.flac", "size": 1 } ] } ] }
        """
      When the slskd client browses the peer "some body/else?#"
      Then the slskd client answers:
        """
        [ { "username": "some body/else?#", "path": "x\\y\\a.flac", "size": "1", "locked": false } ]
        """

    Scenario: a peer who is not on the network
      Given the slskd daemon is signed in to the network
      When the slskd client browses the peer "gone-home"
      Then the slskd client fails with "unavailable:peer-unavailable"

    Scenario: a peer the daemon cannot connect to, whose address stays with the daemon
      Given the slskd daemon is signed in to the network
      And the slskd peer "behind-a-wall" cannot be reached
      When the slskd client browses the peer "behind-a-wall"
      Then the slskd client fails with "unavailable:peer-unavailable"
      And the slskd failure says exactly "unavailable:peer-unavailable"

    Scenario: an offline daemon cannot browse anyone
      When the slskd client browses the peer "field-recorder"
      Then the slskd client fails with "unavailable:rejected"
      And the slskd failure says exactly "unavailable:rejected: the daemon is not signed in to the network"

    Scenario: a listing that is not a listing is not trusted
      Given the slskd daemon will answer "GET /users/field-recorder/browse" with status 200 and body '[]'
      When the slskd client browses the peer "field-recorder"
      Then the slskd client fails with "unavailable:bad-response"

    Scenario Outline: a peer name that would send the request somewhere else is refused before the daemon hears of it
      When the slskd client browses the peer "<name>"
      Then the slskd client fails with "invalid:username"
      And the slskd daemon was never asked

      Examples:
        | name |
        |      |
        | .    |
        | ..   |

  Rule: a download is queued from one peer, and its id is the daemon's own

    Background:
      Given the slskd daemon is signed in to the network
      And the slskd peer "field-recorder" is online

    Scenario: a file is queued and the daemon's id for the transfer comes back
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "31415926" from the peer "field-recorder"
      Then the slskd client answers with the daemon's own id for its transfer of "@@abc\\Recordings\\rain.flac"
      And the slskd daemon received "POST /transfers/downloads/field-recorder" with the body:
        """
        [{"filename":"@@abc\\Recordings\\rain.flac","size":31415926}]
        """
      When the slskd client reads the transfer
      Then the slskd client answers:
        """
        { "id": "$transfer", "username": "field-recorder", "path": "@@abc\\Recordings\\rain.flac", "size": "31415926", "state": "queued", "received": "0" }
        """

    Scenario: the largest size the daemon can hold is sent digit for digit
      When the slskd client downloads "big.bin" of size "9223372036854775807" from the peer "field-recorder"
      Then the slskd daemon received "POST /transfers/downloads/field-recorder" with the body:
        """
        [{"filename":"big.bin","size":9223372036854775807}]
        """

    Scenario: an older daemon that does not say what it queued is asked for its list
      Given the slskd daemon is from before downloads were answered with what was queued
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "field-recorder"
      Then the slskd client answers with the daemon's own id for its transfer of "@@abc\\Recordings\\rain.flac"
      And the slskd daemon was asked "GET /transfers/downloads/field-recorder" 1 time

    Scenario: a file the daemon is already fetching keeps its one transfer
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "field-recorder"
      And the slskd client downloads "@@abc\\Recordings\\wind.flac" of size "4" from the peer "field-recorder"
      And the slskd client downloads "@@abc\\Recordings\\wind.flac" of size "4" from the peer "field-recorder"
      Then the slskd client answers with the daemon's own id for its transfer of "@@abc\\Recordings\\wind.flac"
      And the slskd daemon holds 2 transfers
      When the slskd client reads the transfer
      Then the slskd transfer is queued

    Scenario: a daemon that queues nothing, and whose finished copy is not a new transfer
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "field-recorder"
      And the slskd daemon reports the transfer in state "Completed, Succeeded" saying ""
      And the slskd daemon will answer "POST /transfers/downloads/field-recorder" with status 201 and body '{"enqueued":[],"failed":[{}]}'
      And the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "field-recorder"
      Then the slskd client fails with "unavailable:rejected"

    Scenario: a daemon that queues nothing and has nothing for the peer
      Given the slskd daemon will answer "POST /transfers/downloads/field-recorder" with status 201 and body '{"enqueued":[],"failed":[{}]}'
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "field-recorder"
      Then the slskd client fails with "unavailable:rejected"

    Scenario Outline: a download the daemon accepted but that cannot be found afterwards is not called queued
      Given the slskd daemon will answer "POST /transfers/downloads/field-recorder" with status 201 and body '<body>'
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "field-recorder"
      Then the slskd client fails with "unavailable:outcome-unknown"

      Examples:
        | body                                                              |
        |                                                                   |
        | []                                                                |
        | {"enqueued":[{"filename":"@@abc\\\\Recordings\\\\rain.flac"}],"failed":[]} |
        | {"enqueued":[{"filename":"another file","id":"x"}],"failed":[]}   |

    Scenario: an older daemon whose list cannot be read leaves the outcome unknown
      Given the slskd daemon is from before downloads were answered with what was queued
      And the slskd daemon will hang up on "GET /transfers/downloads/field-recorder"
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "field-recorder"
      Then the slskd client fails with "unavailable:outcome-unknown"

    Scenario: a peer who is not on the network cannot be downloaded from
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "gone-home"
      Then the slskd client fails with "unavailable:peer-unavailable"
      And the slskd failure says exactly "unavailable:peer-unavailable"

    Scenario: a path the daemon finds dangerous is declined by the daemon
      When the slskd client downloads "@@abc\\..\\..\\etc\\passwd" of size "3" from the peer "field-recorder"
      Then the slskd client fails with "unavailable:rejected"
      And the slskd failure says exactly "unavailable:rejected: the daemon declined the request"

    Scenario Outline: a download that could not be meant is refused before the daemon hears of it
      When the slskd client downloads "<path>" of size "<size>" from the peer "<peer>"
      Then the slskd client fails with "<reason>"
      And the slskd daemon was never asked

      Examples:
        | path      | size                 | peer           | reason           |
        | rain.flac | 3                    |                | invalid:username |
        | rain.flac | 3                    | ..             | invalid:username |
        |           | 3                    | field-recorder | invalid:path     |
        | a\u0000b  | 3                    | field-recorder | invalid:path     |
        | rain.flac |                      | field-recorder | invalid:size     |
        | rain.flac | 03                   | field-recorder | invalid:size     |
        | rain.flac | -1                   | field-recorder | invalid:size     |
        | rain.flac | 1.5                  | field-recorder | invalid:size     |
        | rain.flac | 3e2                  | field-recorder | invalid:size     |
        | rain.flac | 9223372036854775808  | field-recorder | invalid:size     |
        | rain.flac | 18446744073709551615 | field-recorder | invalid:size     |

  Rule: an offline daemon cannot queue a download

    Scenario: an offline daemon declines a download
      When the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "3" from the peer "field-recorder"
      Then the slskd client fails with "unavailable:rejected"
      And the slskd failure says exactly "unavailable:rejected: the daemon is not signed in to the network"

  Rule: a transfer is reported in NAP-SOULSEEK's words

    Background:
      Given the slskd daemon is signed in to the network
      And the slskd peer "field-recorder" is online
      And the slskd client downloads "@@abc\\Recordings\\rain.flac" of size "31415926" from the peer "field-recorder"

    Scenario Outline: a transfer that has not failed
      When the slskd daemon reports the transfer in state "<reported>" saying "<words>"
      And the slskd client reads the transfer
      Then the slskd transfer is <state>
      And the slskd transfer carries no failure

      Examples:
        | reported             | words                       | state        |
        | None                 |                             | queued       |
        | Requested            |                             | queued       |
        | Queued, Locally      |                             | queued       |
        | Queued, Remotely     |                             | queued       |
        | Initializing         |                             | queued       |
        | InProgress           |                             | transferring |
        | Completed, Succeeded |                             | complete     |
        | Completed, Cancelled | The operation was canceled. | cancelled    |

    Scenario Outline: a transfer that failed says why, in words that name no address and no path
      When the slskd daemon reports the transfer in state "<reported>" saying "<words>"
      And the slskd client reads the transfer
      Then the slskd transfer has failed as "<failure>" with the words "<message>"

      Examples:
        | reported            | words                                                                              | failure          | message                                      |
        | Completed, TimedOut | The operation has timed out                                                        | timeout          | The operation has timed out                  |
        | Completed, TimedOut |                                                                                    | timeout          | The transfer timed out                       |
        | Completed, Rejected | Transfer rejected: Queue full                                                      | peer_denied      | Transfer rejected: Queue full                |
        | Completed, Rejected | Transfer rejected: File not shared.                                                | peer_denied      | Transfer rejected: File not shared.          |
        | Completed, Errored  | User field-recorder appears to be offline                                          | peer_unavailable | User field-recorder appears to be offline    |
        | Completed, Errored  | Failed to establish a direct or indirect transfer connection to field-recorder     | peer_unavailable | Failed to establish a direct or indirect transfer connection to field-recorder |
        | Completed, Errored  | Failed to connect to 203.0.113.7:2234                                              | peer_unavailable | The peer could not be reached                |
        | Completed, Errored  | Failed to connect to [2001:db8::7]:2234                                            | peer_unavailable | The peer could not be reached                |
        | Completed, Errored  | Failed to connect to peer-host:2234                                                | peer_unavailable | The peer could not be reached                |
        | Completed, Errored  | Download reported as failed by remote client                                       | peer_denied      | Download reported as failed by remote client |
        | Completed, Errored  | Access to the path '/app/downloads/Recordings/rain.flac' is denied.                | backend_error    | The transfer failed in the daemon            |
        | Completed, Errored  | Could not find a part of the path 'C:\\slskd\\incomplete\\rain.flac'.              | backend_error    | The transfer failed in the daemon            |
        | Completed, Errored  | Unable to resolve vps.slsknet.org                                                  | backend_error    | The transfer failed in the daemon            |
        | Completed, Errored  | No space left on device                                                            | backend_error    | No space left on device                      |
        | Completed, Errored  |                                                                                    | backend_error    | The transfer failed in the daemon            |
        | Completed, Aborted  | Transfer aborted: the peer reported a different size                               | backend_error    | Transfer aborted: the peer reported a different size |
        | Completed           |                                                                                    | backend_error    | The transfer failed in the daemon            |

    Scenario: words too long to show are replaced
      When the slskd daemon reports the transfer as:
        """
        { "state": "Completed, Errored", "exception": "An error occurred and then another and then another and then another and then another and then another and then another and then another and then another and then another and then another and then another and so on" }
        """
      And the slskd client reads the transfer
      Then the slskd transfer has failed as "backend_error" with the words "The transfer failed in the daemon"

    Scenario: a transfer waiting on the peer says where it stands in the peer's queue
      When the slskd daemon reports the transfer as:
        """
        { "state": "Queued, Remotely", "placeInQueue": 4, "averageSpeed": 0 }
        """
      And the slskd client reads the transfer
      Then the slskd client answers:
        """
        { "id": "$transfer", "username": "field-recorder", "path": "@@abc\\Recordings\\rain.flac", "size": "31415926", "state": "queued", "received": "0", "queuePosition": 4 }
        """

    Scenario: a place in the queue that is not a place is left out
      When the slskd daemon reports the transfer as:
        """
        { "state": "Queued, Remotely", "placeInQueue": 0 }
        """
      And the slskd client reads the transfer
      Then the slskd client answers:
        """
        { "id": "$transfer", "username": "field-recorder", "path": "@@abc\\Recordings\\rain.flac", "size": "31415926", "state": "queued", "received": "0" }
        """

    Scenario: a transfer under way says how much has arrived and how fast
      When the slskd daemon reports the transfer as:
        """
        { "state": "InProgress", "bytesTransferred": 1048576, "averageSpeed": 262143.6, "placeInQueue": 4 }
        """
      And the slskd client reads the transfer
      Then the slskd client answers:
        """
        { "id": "$transfer", "username": "field-recorder", "path": "@@abc\\Recordings\\rain.flac", "size": "31415926", "state": "transferring", "received": "1048576", "bytesPerSecond": 262144 }
        """

    Scenario: a speed that is not a speed is left out
      When the slskd daemon reports the transfer as:
        """
        { "state": "InProgress", "bytesTransferred": 5, "averageSpeed": -1 }
        """
      And the slskd client reads the transfer
      Then the slskd client answers:
        """
        { "id": "$transfer", "username": "field-recorder", "path": "@@abc\\Recordings\\rain.flac", "size": "31415926", "state": "transferring", "received": "5" }
        """

    Scenario Outline: a transfer answer that is not a transfer is not trusted
      Given the slskd daemon will answer "GET /transfers/downloads/field-recorder/" with status 200 and body '<body>'
      When the slskd client reads the transfer
      Then the slskd client fails with "unavailable:bad-response"

      Examples:
        | body                                                                                                  |
        | []                                                                                                    |
        | {"username":"field-recorder","filename":"a","size":1,"bytesTransferred":0,"state":"InProgress"}       |
        | {"id":"x","filename":"a","size":1,"bytesTransferred":0,"state":"InProgress"}                          |
        | {"id":"x","username":"field-recorder","size":1,"bytesTransferred":0,"state":"InProgress"}             |
        | {"id":"x","username":"field-recorder","filename":"a","size":-1,"bytesTransferred":0,"state":"InProgress"} |
        | {"id":"x","username":"field-recorder","filename":"a","size":1,"bytesTransferred":0.5,"state":"InProgress"} |
        | {"id":"x","username":"field-recorder","filename":"a","size":1,"bytesTransferred":0,"state":8}         |

    Scenario: a transfer that belongs to another peer is not the one asked for
      When the slskd client reads the transfer as one from the peer "someone-else"
      Then the slskd client answers nothing

    Scenario: cancelling stops a transfer and keeps its record
      When the slskd client cancels the transfer
      Then the slskd client answers nothing
      And the slskd daemon was asked "DELETE /transfers/downloads/field-recorder/$transfer" 1 time
      When the slskd client reads the transfer
      Then the slskd transfer is cancelled

    Scenario: cancelling with removal makes the daemon forget the transfer
      When the slskd client cancels the transfer and has the daemon forget it
      Then the slskd client answers nothing
      And the slskd daemon still holds the transfer, marked removed
      When the slskd client reads the transfer
      Then the slskd client answers nothing

    Scenario: a daemon version that reports a transfer it does not have
      Given the slskd daemon will answer "DELETE /transfers/downloads/field-recorder/" with status 404 and body ''
      When the slskd client cancels the transfer
      Then the slskd client fails with "unavailable:not-found"

  Rule: a transfer the daemon does not have is simply absent

    Scenario: an id the daemon has no transfer for
      Given the slskd client knows of a transfer "11111111-2222-4333-8444-555555555555" from the peer "field-recorder"
      When the slskd client reads the transfer
      Then the slskd client answers nothing

    Scenario: an id that is not one of the daemon's own
      Given the slskd client knows of a transfer "t1" from the peer "field-recorder"
      When the slskd client reads the transfer
      Then the slskd client answers nothing
      When the slskd client cancels the transfer
      Then the slskd client fails with "unavailable:not-found"

    Scenario Outline: a transfer id or peer name that would send the request somewhere else is refused
      Given the slskd client knows of a transfer "<id>" from the peer "<peer>"
      When the slskd client reads the transfer
      Then the slskd client fails with "<reason>"
      When the slskd client cancels the transfer
      Then the slskd client fails with "<reason>"
      And the slskd daemon was never asked

      Examples:
        | id | peer           | reason           |
        | .. | field-recorder | invalid:id       |
        |    | field-recorder | invalid:id       |
        | t1 | ..             | invalid:username |
        | t1 |                | invalid:username |
