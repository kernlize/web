Feature: NZB downloads through the person's own downloaders
  An applet hands the shell an NZB document and the shell passes it to a
  downloader the person already runs. The shell is a remote control: it never
  reads what the downloader saved. The person is asked before anything is
  added or erased, an applet sees only the downloads it started itself, and a
  request that is sent twice is carried out once.

  Background:
    Given the NZB clock reads 1793361600
    And the person set up the NZB downloader "Home"
    And the applet "reader" may use NZB downloads

  Rule: an applet learns what each downloader can do, and nothing about where it lives

    Scenario: no downloader is set up
      Given the person removed every NZB downloader
      When "reader" asks for the NZB downloaders
      Then "reader" is offered 0 NZB downloaders

    Scenario: one downloader is described as a remote control
      Given the NZB downloader "Home" has the categories "films, shows"
      When "reader" asks for the NZB downloaders
      Then "reader" is offered 1 NZB downloaders
      And the NZB downloader "Home" is described to "reader" as:
        | canAdd        | true                                         |
        | sourceKinds   | ["bytes"]                                    |
        | addOptions    | ["categoryId","priority","startPaused","password"] |
        | actions       | ["pause","resume","cancel","retry","forget","delete"] |
        | canReadFiles  | false                                        |
        | maxNZBBytes   | 10485760                                     |
        | maxPageSize   | 100                                          |
        | maxReadBytes  | 0                                            |
        | replaySeconds | 86400                                        |
      And the NZB downloader "Home" offers "reader" the categories "films, shows"
      And every NZB category description says the downloader's own settings decide where files go
      And no NZB handle "reader" was given is a downloader's key, a category's own name or a job number

    Scenario: two downloaders are told apart only by what the person calls them
      Given the person set up the NZB downloader "Attic", which cannot cancel or retry and takes no options
      When "reader" asks for the NZB downloaders
      Then "reader" is offered 2 NZB downloaders
      And the NZB downloader "Attic" is described to "reader" as:
        | addOptions | []                                   |
        | categories | []                                   |
        | actions    | ["pause","resume","forget","delete"] |

    Scenario: a downloader the shell can fetch for also takes an address
      Given the shell can fetch NZB documents by address
      When "reader" asks for the NZB downloaders
      Then the NZB downloader "Home" is described to "reader" as:
        | sourceKinds | ["bytes","url"] |

    Scenario: the same downloader keeps its name for an applet across a reload, and differs between applets
      Given the applet "player" may use NZB downloads
      When "reader" asks for the NZB downloaders
      And "player" asks for the NZB downloaders
      And the shell is reloaded with its NZB records kept
      And "reader" asks for the NZB downloaders
      Then "reader" knows the NZB downloader "Home" by the same name as before the reload
      And "reader" and "player" know the NZB downloader "Home" by different names

    Scenario: a downloader that cannot be reached is still listed, without categories
      Given the NZB downloader "Home" has the categories "films"
      And the NZB downloader "Home" cannot be reached
      When "reader" asks for the NZB downloaders
      Then the NZB downloader "Home" is described to "reader" as:
        | categories | [] |

    Scenario: two set-ups under one key are offered once
      Given the person set up a second NZB downloader under the key of "Home", called "Copy"
      When "reader" asks for the NZB downloaders
      Then "reader" is offered 1 NZB downloaders

  Rule: the person is asked before every add

    Scenario: the person says yes and the download starts
      Given the NZB downloader "Home" has the categories "films"
      When "reader" asks for the NZB downloaders
      And "reader" adds the NZB document "holiday film" to "Home" under the key "add-1" with:
        | name        | Holiday   |
        | category    | films     |
        | priority    | high      |
        | startPaused | true      |
        | password    | open-says |
      Then the person was asked the NZB question "Add an NZB job to Home" as an "add" for "reader"
      And the NZB question says "Name" is "Holiday"
      And the NZB question says "Files" is "2 files"
      And the NZB question says "Category" is "films"
      And the NZB question says "Keeps going" is "This download carries on in Home after this applet is closed"
      And "reader" is told the NZB job "add-1" is "paused", replayable until 1793448000
      And the answer about the NZB job says:
        | name           | "Holiday"          |
        | observedAt     | 1793361600         |
        | actions        | ["resume","cancel"] |
        | canReadFiles   | false              |
        | downloadPaused | true               |
      And the NZB job's category is the one "reader" chose
      And the NZB downloader "Home" was handed "holiday film" as "Holiday" in "films" at "high" priority, paused, with the password "open-says"
      And nothing "reader" was sent contains "open-says"

    Scenario: a document without a name of its own is named plainly
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then the NZB question says "Name" is "NZB download"
      And the NZB question says "Files" is "1 file"
      And "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000

    Scenario: the document's own title is used when the applet suggests none, and its category is never obeyed
      When "reader" adds the NZB document "holiday film" to "Home" under the key "add-1"
      Then the NZB question says "Name" is "Holiday film (2019)"
      And the NZB downloader "Home" was handed "holiday film" as "Holiday film (2019)" with no category

    Scenario: the person says no and nothing happens
      Given the person will say no to NZB questions
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "permission_denied" with no replay time
      And the NZB downloader "Home" was handed nothing
      When the person will say yes to NZB questions
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000

    Scenario: an applet that is closed while the person decides adds nothing
      Given "reader" is closed while the person is asked about NZB
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1" and gets no answer
      Then the NZB downloader "Home" was handed nothing

    Scenario: an applet whose NZB permission is taken back while the person decides is told so once
      Given the NZB permission of "reader" is taken back while the person is asked
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "permission_denied" with no replay time
      And the NZB downloader "Home" was handed nothing
      And "reader" got 1 NZB answers in all

    Scenario: taking the NZB permission back from an applet that is waiting for nothing says nothing
      When the NZB permission of "reader" is taken back
      Then "reader" got 0 NZB answers in all

    Scenario: an applet the person has not granted NZB downloads is told so, and nothing else
      When the runtime turns away the NZB message '{"type":"nzb.downloaders","id":"d1"}' from "reader"
      Then "reader" is told the NZB request failed as "permission_denied" with no replay time
      When the runtime turns away the NZB message '{"type":"nzb.downloaders"}' from "reader"
      Then "reader" got 1 NZB answers in all

    Scenario: a shell that cannot put the question to the person adds nothing
      Given the shell fails to ask NZB questions
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "backend_error" with no replay time
      And the NZB downloader "Home" was handed nothing

    Scenario: a window that is not a live applet is refused
      When "stranger" asks for the NZB downloaders
      Then "stranger" is told the NZB request failed as "permission_denied" with no replay time

    Scenario: an add names its downloader, category and options truthfully
      Given the person set up the NZB downloader "Attic", which cannot cancel or retry and takes no options
      And the NZB downloader "Home" has the categories "films"
      When "reader" asks for the NZB downloaders
      And "reader" adds the NZB document "one file" to "Attic" under the key "a" with:
        | priority | low |
      Then "reader" is told the NZB request failed as "unsupported" with no replay time
      When "reader" adds the NZB document "one file" to "Attic" under the key "a" with:
        | category | films |
      Then "reader" is told the NZB request failed as "unsupported" with no replay time
      When "reader" adds the NZB document "one file" to a downloader it made up
      Then "reader" is told the NZB request failed as "not_found" with no replay time
      When "reader" adds the NZB document "one file" to "Home" in a category it made up
      Then "reader" is told the NZB request failed as "not_found" with no replay time
      When the person removes the category "films" from the NZB downloader "Home"
      And "reader" adds the NZB document "one file" to "Home" under the key "b" with:
        | category | films |
      Then "reader" is told the NZB request failed as "not_found" with no replay time
      And no NZB downloader was handed anything

    Scenario: a downloader that declines leaves no job
      Given the NZB downloader "Home" will decline the next add
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "backend_rejected", replayable until 1793448000
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "backend_rejected", replayable until 1793448000
      And the NZB downloader "Home" was asked to add 1 times
      And the person was asked about NZB 1 times

    Scenario: a downloader that answers a repeated document with the job it already has gives the applet that same job
      Given the NZB downloader "Home" answers a repeated document with the job it already has
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "reader" adds the NZB document "one file" to "Home" under the key "add-2"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000
      When "reader" lists its NZB jobs on "Home"
      Then "reader" sees 1 NZB jobs and no more to come

    Scenario: a job that cannot be looked at straight after it was accepted is reported as unknown, not invented
      Given the NZB downloader "Home" stops answering once it has taken an add
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "unknown", replayable until 1793448000

  Rule: a request sent twice is carried out once

    Scenario: the same add under the same key is answered from the record
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" finishes the job "add-1"
      And the NZB clock moves on 60 seconds
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000
      And the NZB downloader "Home" was asked to add 1 times
      And the person was asked about NZB 1 times

    Scenario: the same key with anything changed is a conflict
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1" with:
        | name | Another name |
      Then "reader" is told the NZB request failed as "conflict", replayable until 1793448000
      When "reader" asks to "pause" the NZB job "add-1" under the key "add-1"
      Then "reader" is told the NZB request failed as "conflict", replayable until 1793448000
      And the NZB downloader "Home" was asked to add 1 times

    Scenario: the same add sent again while the first is under way is not sent to the downloader again
      Given the NZB downloader "Home" holds the next "add" open
      When "reader" starts adding the NZB document "one file" to "Home" under the key "add-1"
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "outcome_unknown", replayable until 1793448000
      When the NZB downloader "Home" lets the held call go
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000
      And the NZB downloader "Home" was asked to add 1 times

    Scenario: the same add arriving twice in one moment is dispatched once
      Given the NZB downloader "Home" has the categories "films"
      When "reader" asks for the NZB downloaders
      And "reader" adds the NZB document "one file" to "Home" in "films" under the key "add-1", twice, the first held up while its category is checked
      Then both NZB answers are the same job
      And the NZB downloader "Home" was asked to add 1 times
      And the person was asked about NZB 1 times

    Scenario: an uncertain outcome stays uncertain, also across a reload
      Given the NZB downloader "Home" takes the next add but its answer is lost
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "outcome_unknown", replayable until 1793448000
      When the shell is reloaded with its NZB records kept
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "outcome_unknown", replayable until 1793448000
      And the NZB downloader "Home" was asked to add 1 times

    Scenario Outline: a downloader that <trouble> during an add leaves the outcome <outcome>
      Given the NZB downloader "Home" fails the next "add" with "<reason>"
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "<outcome>", replayable until 1793448000

      Examples:
        | trouble                  | reason                   | outcome                 |
        | does not answer in time  | unavailable:timeout      | outcome_unknown         |
        | answers unreadably       | unavailable:bad-response | outcome_unknown         |
        | breaks in an unknown way | something else           | outcome_unknown         |
        | was never reached        | unavailable:unreachable  | unavailable             |
        | refuses the sign-in      | denied:credentials       | authentication_required |
        | calls the input wrong    | invalid:name             | backend_rejected        |

    Scenario: the shell closing mid-dispatch leaves the outcome uncertain after the reload
      Given the NZB downloader "Home" holds the next "add" open
      When "reader" starts adding the NZB document "one file" to "Home" under the key "add-1"
      And the shell is reloaded with its NZB records kept
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "outcome_unknown", replayable until 1793448000
      When the NZB clock moves on 60 seconds
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "outcome_unknown", replayable until 1793448000
      And the NZB downloader "Home" was asked to add 1 times

    Scenario: the shell closing while the person decides leaves nothing behind
      Given the person never answers NZB questions
      When "reader" starts adding the NZB document "one file" to "Home" under the key "add-1"
      And the shell is reloaded with its NZB records kept
      And the person will say yes to NZB questions
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000

    Scenario: a record is forgotten once its time is up
      Given the NZB downloader "Home" will decline the next add
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB clock moves on 86401 seconds
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793534401

    Scenario: a recorded success is given only to the applet that still owns the job
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the shell loses its NZB job handles
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "permission_denied" with no replay time

    Scenario: damaged NZB records are set aside, not trusted
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the shell's NZB records are damaged
      And "reader" asks for the NZB downloaders
      And "reader" lists its NZB jobs on "Home"
      Then "reader" sees 0 NZB jobs and no more to come
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then the NZB downloader "Home" was asked to add 2 times

  Rule: an applet sees and controls only the downloads it started

    Scenario: an applet lists its own jobs and none of the person's
      Given the person added a download of their own to the NZB downloader "Home"
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "reader" lists its NZB jobs on "Home"
      Then "reader" sees 1 NZB jobs and no more to come
      And the NZB job "add-1" is among them, "queued"

    Scenario: an applet from another publisher with the same name is another applet
      Given another publisher's applet, also called "reader", may use NZB downloads as "lookalike"
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "lookalike" asks for the NZB downloaders
      And "lookalike" lists its NZB jobs on "Home"
      Then "lookalike" sees 0 NZB jobs and no more to come
      When "lookalike" asks for the status of the NZB job "add-1"
      Then "lookalike" is told the NZB request failed as "not_found" with no replay time

    Scenario: another applet can neither see nor control the job
      Given the applet "player" may use NZB downloads
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "player" asks for the NZB downloaders
      And "player" lists its NZB jobs on "Home"
      Then "player" sees 0 NZB jobs and no more to come
      When "player" asks for the status of the NZB job "add-1"
      Then "player" is told the NZB request failed as "not_found" with no replay time
      When "player" asks to "pause" the NZB job "add-1" under the key "p-1"
      Then "player" is told the NZB request failed as "not_found" with no replay time
      When "player" lists NZB jobs on the downloader as "reader" knows it
      Then "player" is told the NZB request failed as "not_found" with no replay time
      And the NZB downloader "Home" was asked to control 0 times

    Scenario: a fresh look at one job
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" reports the job "add-1" as:
        | state           | processing |
        | progress        | 1          |
        | downloadedBytes | 800        |
        | totalBytes      | 800        |
        | downloadRate    | 0          |
        | stage           | Unpacking  |
        | message         | Nearly there |
        | category        | the person's own |
      And the NZB clock moves on 100 seconds
      And "reader" asks for the status of the NZB job "add-1"
      Then the answer about the NZB job says:
        | state            | "processing"   |
        | observedAt       | 1793361700     |
        | downloadProgress | 1              |
        | downloadedBytes  | 800            |
        | totalBytes       | 800            |
        | downloadRate     | 0              |
        | stage            | "Unpacking"    |
        | message          | "Nearly there" |
        | canReadFiles     | false          |
      And the answer about the NZB job names no category

    Scenario: without a clock of the shell's own, a job is observed at the present moment
      Given the NZB clock is the real one
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then the NZB job was observed within 5 seconds of now

    Scenario: a job the downloader no longer has is gone for good
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the person removes the job "add-1" from the NZB downloader "Home"
      And "reader" asks for the status of the NZB job "add-1"
      Then "reader" is told the NZB request failed as "not_found" with no replay time
      When the NZB downloader "Home" gives the number of the job "add-1" to a download of the person's
      And "reader" asks for the status of the NZB job "add-1"
      Then "reader" is told the NZB request failed as "not_found" with no replay time
      When "reader" lists its NZB jobs on "Home"
      Then "reader" sees 0 NZB jobs and no more to come

    Scenario: a job that vanished is dropped from the list too
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the person removes the job "add-1" from the NZB downloader "Home"
      And "reader" lists its NZB jobs on "Home"
      Then "reader" sees 0 NZB jobs and no more to come
      When "reader" asks for the status of the NZB job "add-1"
      Then "reader" is told the NZB request failed as "not_found" with no replay time

    Scenario Outline: a downloader in trouble is an error, never an empty list
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" fails the next "<call>" with "<reason>"
      And "reader" <asks>
      Then "reader" is told the NZB request failed as "<code>" with no replay time

      Examples:
        | call | reason                   | asks                                        | code                    |
        | list | unavailable:unreachable  | lists its NZB jobs on "Home"                | unavailable             |
        | list | unavailable:timeout      | lists its NZB jobs on "Home"                | unavailable             |
        | list | denied:credentials       | lists its NZB jobs on "Home"                | authentication_required |
        | list | unavailable:bad-response | lists its NZB jobs on "Home"                | backend_error           |
        | get  | unavailable:unreachable  | asks for the status of the NZB job "add-1"  | unavailable             |
        | get  | denied:credentials       | asks for the status of the NZB job "add-1"  | authentication_required |
        | get  | unavailable:unsupported  | asks for the status of the NZB job "add-1"  | unsupported             |

    Scenario: a job on a downloader the person removed is no longer there
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the person removed every NZB downloader
      And "reader" asks for the status of the NZB job "add-1"
      Then "reader" is told the NZB request failed as "not_found" with no replay time

    Scenario: jobs come a page at a time, in the order of their names
      When "reader" adds 5 NZB documents to "Home"
      And "reader" lists its NZB jobs on "Home", 2 at a time
      Then "reader" sees 2 NZB jobs and more to come
      When "reader" lists its NZB jobs on "Home", 2 at a time, after the last it saw
      Then "reader" sees 2 NZB jobs and more to come
      When "reader" lists its NZB jobs on "Home", 2 at a time, after the last it saw
      Then "reader" sees 1 NZB jobs and no more to come
      And the 5 NZB jobs "reader" saw are each different and in ascending byte order
      When "reader" lists its NZB jobs on "Home", 5 at a time
      Then "reader" sees 5 NZB jobs and no more to come
      When "reader" lists its NZB jobs on "Home", 101 at a time
      Then "reader" is told the NZB request failed as "limit_exceeded" with no replay time

  Rule: one job is paused, resumed, stopped, retried, forgotten or erased, and only when that applies

    Scenario: pause and resume hold and release one job
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB clock moves on 10 seconds
      And "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the "pause" of the NZB job "add-1" worked and it is "paused", replayable until 1793448010
      And the answer about the NZB job says:
        | downloadPaused | true                |
        | actions        | ["resume","cancel"] |
      When "reader" asks to "pause" the NZB job "add-1" under the key "pause-2"
      Then "reader" is told the "pause" of the NZB job "add-1" worked and it is "paused", replayable until 1793448010
      And the NZB downloader "Home" was asked to control 1 times
      When "reader" asks to "resume" the NZB job "add-1" under the key "resume-1"
      Then "reader" is told the "resume" of the NZB job "add-1" worked and it is "queued", replayable until 1793448010
      When "reader" asks to "resume" the NZB job "add-1" under the key "resume-2"
      Then "reader" is told the "resume" of the NZB job "add-1" worked and it is "queued", replayable until 1793448010
      And the NZB downloader "Home" was asked to control 2 times

    Scenario: a control sent again under its key is answered from the record
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      And "reader" asks to "resume" the NZB job "add-1" under the key "resume-1"
      And "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the "pause" of the NZB job "add-1" worked and it is "paused", replayable until 1793448000
      And the NZB downloader "Home" was asked to control 2 times
      When "reader" asks to "cancel" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the NZB request failed as "conflict", replayable until 1793448000

    Scenario: cancel stops a job and keeps its record
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "reader" asks to "cancel" the NZB job "add-1" under the key "cancel-1"
      Then "reader" is told the "cancel" of the NZB job "add-1" worked and it is "cancelled", replayable until 1793448000
      When "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the NZB request failed as "invalid_state" with no replay time
      When "reader" asks to "resume" the NZB job "add-1" under the key "resume-1"
      Then "reader" is told the NZB request failed as "invalid_state" with no replay time

    Scenario: retry of a failed job may bring a successor, which is a different job
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" fails the job "add-1"
      And "reader" asks to "retry" the NZB job "add-1" under the key "retry-1"
      Then "reader" is told a new NZB job took over from "add-1" and is "queued"
      When "reader" lists its NZB jobs on "Home"
      Then "reader" sees 1 NZB jobs and no more to come
      When "reader" asks for the status of the NZB job "add-1"
      Then "reader" is told the NZB request failed as "not_found" with no replay time

    Scenario: retry that restarts the same job keeps its name
      Given the NZB downloader "Home" retries a job in place
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" fails the job "add-1"
      And "reader" asks to "retry" the NZB job "add-1" under the key "retry-1"
      Then "reader" is told the "retry" of the NZB job "add-1" worked and it is "queued", replayable until 1793448000

    Scenario: forget takes a finished job out of sight and erases nothing
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "reader" asks to "forget" the NZB job "add-1" under the key "forget-0"
      Then "reader" is told the NZB request failed as "invalid_state" with no replay time
      When the NZB downloader "Home" finishes the job "add-1"
      And "reader" asks to "forget" the NZB job "add-1" under the key "forget-1"
      Then "reader" is told the "forget" of the NZB job "add-1" worked with no job in the answer, replayable until 1793448000
      And the person was asked about NZB 1 times
      And the NZB downloader "Home" erased the files of 0 jobs
      When "reader" asks for the status of the NZB job "add-1"
      Then "reader" is told the NZB request failed as "not_found" with no replay time
      When "reader" asks to "forget" the NZB job "add-1" under the key "forget-1"
      Then "reader" is told the "forget" of the NZB job "add-1" worked with no job in the answer, replayable until 1793448000
      When "reader" asks to "forget" the NZB job "add-1" under the key "forget-2"
      Then "reader" is told the NZB request failed as "not_found" with no replay time

    Scenario: a forgotten job's records go once nothing can replay them
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" finishes the job "add-1"
      And "reader" asks to "forget" the NZB job "add-1" under the key "forget-1"
      And the NZB clock moves on 86401 seconds
      And "reader" adds the NZB document "one file" to "Home" under the key "add-2"
      Then the shell keeps NZB records of 1 job

    Scenario: delete asks the person, since it erases files
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1" with:
        | name | Holiday |
      And the NZB downloader "Home" finishes the job "add-1"
      And "reader" asks to "delete" the NZB job "add-1" under the key "delete-1"
      Then the person was asked the NZB question "Erase a download from Home" as a "delete" for "reader"
      And the NZB question says "Name" is "Holiday"
      And the NZB question says "Erases" is "The files this download saved, and its record in Home"
      And "reader" is told the "delete" of the NZB job "add-1" worked with no job in the answer, replayable until 1793448000
      And the NZB downloader "Home" erased the files of 1 jobs

    Scenario: the person says no to a delete and nothing is sent
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" finishes the job "add-1"
      And the person will say no to NZB questions
      And "reader" asks to "delete" the NZB job "add-1" under the key "delete-1"
      Then "reader" is told the NZB request failed as "permission_denied" with no replay time
      And the NZB downloader "Home" was asked to control 0 times
      When "reader" asks for the status of the NZB job "add-1"
      Then the answer about the NZB job says:
        | state | "completed" |

    Scenario: a delete the person took too long over is checked again before it is sent
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" finishes the job "add-1"
      And the job "add-1" starts again in the NZB downloader "Home" while the person is asked
      And "reader" asks to "delete" the NZB job "add-1" under the key "delete-1"
      Then "reader" is told the NZB request failed as "invalid_state" with no replay time
      And the NZB downloader "Home" was asked to control 0 times

    Scenario: an action the downloader does not offer at all is unsupported, and nothing is sent
      Given the person set up the NZB downloader "Attic", which cannot cancel or retry and takes no options
      When "reader" asks for the NZB downloaders
      And "reader" adds the NZB document "one file" to "Attic" under the key "add-1"
      And "reader" asks to "cancel" the NZB job "add-1" under the key "cancel-1"
      Then "reader" is told the NZB request failed as "unsupported" with no replay time
      And the NZB downloader "Attic" was asked to control 0 times

    Scenario: two actions on one job take turns, each seeing what the other left
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "reader" asks to "cancel" and to "pause" the NZB job "add-1" at once
      Then the first NZB answer is the job, "cancelled", and the second failed as "invalid_state"
      And the NZB downloader "Home" was asked to control 1 times

    Scenario Outline: a control the downloader <trouble> is reported as <code>
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" fails the next "control" with "<reason>"
      And "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the NZB request failed as "<code>", replayable until 1793448000
      When "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the NZB request failed as "<code>", replayable until 1793448000
      And the NZB downloader "Home" was asked to control 1 times

      Examples:
        | trouble               | reason                      | code             |
        | may or may not apply  | unavailable:outcome-unknown | outcome_unknown  |
        | declines              | unavailable:rejected        | backend_rejected |
        | no longer has         | unavailable:not-found       | not_found        |

    Scenario: a control whose result cannot be seen afterwards is uncertain
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" stops answering once it has taken a control
      And "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the NZB request failed as "outcome_unknown", replayable until 1793448000

    Scenario: a downloader that cannot be reached before a control leaves no record
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" fails the next "get" with "unavailable:unreachable"
      And "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the NZB request failed as "unavailable" with no replay time
      When "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the "pause" of the NZB job "add-1" worked and it is "paused", replayable until 1793448000

    Scenario: a control for a job that has vanished finds nothing
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the person removes the job "add-1" from the NZB downloader "Home"
      And "reader" asks to "pause" the NZB job "add-1" under the key "pause-1"
      Then "reader" is told the NZB request failed as "not_found" with no replay time

  Rule: a hostile or broken document never reaches the downloader

    Scenario Outline: a document that <fault> is refused
      When "reader" adds the NZB document "<document>" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "<code>" with no replay time
      And the person was asked about NZB 0 times
      And the NZB downloader "Home" was handed nothing

      Examples:
        | fault                                  | document               | code           |
        | declares an entity                     | entity declaration     | invalid_request |
        | carries an internal subset             | internal subset        | invalid_request |
        | declares an entity outside a doctype   | stray declaration      | invalid_request |
        | uses an entity it never could declare  | unknown entity         | invalid_request |
        | names a character that cannot exist    | impossible character   | invalid_request |
        | holds a forbidden control character    | control character      | invalid_request |
        | is in another namespace                | wrong namespace        | invalid_request |
        | has no namespace                       | no namespace           | invalid_request |
        | is rooted in something else            | wrong root             | invalid_request |
        | uses a prefix it never bound           | unbound prefix         | invalid_request |
        | lists no files                         | no files               | invalid_request |
        | lists a file without segments          | no segments            | invalid_request |
        | lists only empty segments              | empty segments         | invalid_request |
        | nests deeper than 16 elements          | too deep               | invalid_request |
        | holds more than 20000 elements         | too many elements      | invalid_request |
        | is larger than 10 MiB                  | oversize               | limit_exceeded  |
        | carries a processing instruction       | processing instruction | invalid_request |
        | puts its XML declaration late          | late declaration       | invalid_request |
        | has two doctypes                       | two doctypes           | invalid_request |
        | puts a doctype after the root          | late doctype           | invalid_request |
        | is cut off                             | cut off                | invalid_request |
        | closes the wrong element               | mismatched end         | invalid_request |
        | closes an element it never opened      | stray end              | invalid_request |
        | has a second root                      | two roots              | invalid_request |
        | has words outside its root             | text outside           | invalid_request |
        | repeats an attribute                   | repeated attribute     | invalid_request |
        | leaves a comment open                  | open comment           | invalid_request |
        | leaves a literal section open          | open literal           | invalid_request |
        | puts a literal section outside the root | literal outside       | invalid_request |
        | is malformed inside a tag              | broken tag             | invalid_request |
        | is not text in the encoding it claims  | bad encoding           | invalid_request |
        | claims an encoding nobody knows        | unknown encoding       | invalid_request |
        | is empty                               | empty                  | invalid_request |
        | is not XML at all                      | not xml                | invalid_request |

    Scenario: a document just under the size limit is taken
      When "reader" adds the NZB document "nearly oversize" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000

    Scenario Outline: a well-formed document that <trait> is read
      Then the NZB document "<document>" reads as <files> files called "<name>"

      Examples:
        | trait                                  | document           | files | name                |
        | has a title                            | holiday film       | 2     | Holiday film (2019) |
        | has no title                           | one file           | 1     | NZB download        |
        | has an external doctype                | external doctype   | 1     | NZB download        |
        | has a system doctype                   | system doctype     | 1     | NZB download        |
        | is declared as Latin-1                 | latin-1            | 1     | Café                |
        | starts with a byte order mark          | byte order mark    | 1     | NZB download        |
        | binds the namespace to a prefix        | prefixed           | 1     | Prefixed            |
        | has comments and a literal section     | comments           | 1     | A <literal> title   |
        | quotes attributes singly               | single quotes      | 1     | NZB download        |
        | writes characters by number            | numbered           | 1     | A&B <C>             |
        | has only a name, not a title           | named              | 1     | Only a name         |
        | has an overlong title                  | long title         | 1     | xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx |
        | has a blank title                      | blank title        | 1     | NZB download        |
        | carries elements from elsewhere        | foreign elements   | 1     | NZB download        |
        | has one file with and one without segments | mixed files    | 2     | NZB download        |

    Scenario: a document read on its own is refused in words
      Then reading the NZB document "entity declaration" fails with "invalid:nzb"
      And reading the NZB document "oversize" fails with "invalid:nzb"

  Rule: a request must be exactly what the protocol describes

    Scenario Outline: a request that <fault> is refused with no effect
      When "reader" adds the NZB document "one file" to "Home" under the key "seed"
      And "reader" sends the NZB message '<message>'
      Then "reader" is told the NZB request failed as "<code>" with no replay time
      And the NZB downloader "Home" was asked to add 1 times
      And the NZB downloader "Home" was asked to control 0 times

      Examples:
        | fault                              | code            | message |
        | has an unknown field               | invalid_request | {"type":"nzb.jobs","id":"x","request":{"downloaderId":"$Home","extra":1}} |
        | has an unknown envelope field      | invalid_request | {"type":"nzb.downloaders","id":"x","request":{}} |
        | has no request                     | invalid_request | {"type":"nzb.jobs","id":"x"} |
        | has a request that is not an object | invalid_request | {"type":"nzb.jobs","id":"x","request":[]} |
        | has a null request                 | invalid_request | {"type":"nzb.jobs","id":"x","request":null} |
        | leaves out a required field        | invalid_request | {"type":"nzb.jobs","id":"x","request":{}} |
        | has an empty identifier            | invalid_request | {"type":"nzb.jobs","id":"x","request":{"downloaderId":""}} |
        | has a fractional limit             | invalid_request | {"type":"nzb.jobs","id":"x","request":{"downloaderId":"$Home","limit":1.5}} |
        | has a zero limit                   | invalid_request | {"type":"nzb.jobs","id":"x","request":{"downloaderId":"$Home","limit":0}} |
        | has a limit written as text        | invalid_request | {"type":"nzb.jobs","id":"x","request":{"downloaderId":"$Home","limit":"5"}} |
        | has a limit beyond safe integers   | invalid_request | {"type":"nzb.jobs","id":"x","request":{"downloaderId":"$Home","limit":9007199254740993}} |
        | has a null where text belongs      | invalid_request | {"type":"nzb.jobs","id":"x","request":{"downloaderId":"$Home","after":null}} |
        | has a status without a job         | invalid_request | {"type":"nzb.status","id":"x"} |
        | has a status with a request        | invalid_request | {"type":"nzb.status","id":"x","jobId":"$seed","request":{}} |
        | names an action nobody knows       | invalid_request | {"type":"nzb.control","id":"x","request":{"jobId":"$seed","operationKey":"k","action":"explode"}} |
        | has a control without a key        | invalid_request | {"type":"nzb.control","id":"x","request":{"jobId":"$seed","action":"pause"}} |
        | has base64 with a stray space      | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":"PG56 Yj4="}}} |
        | has base64 without padding         | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":"PG56Yj4"}}} |
        | has base64 with loose pad bits     | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":"PG56Yj5="}}} |
        | has base64 in the URL alphabet     | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":"PG56-j4="}}} |
        | has a bytes source with an address | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":"","url":"https://nzb.example/a"}}} |
        | has an address source with bytes   | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"url","url":"https://nzb.example/a","dataBase64":""}}} |
        | has a source of an unknown kind    | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"magnet"}}} |
        | has a source that is not an object | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":"bytes"}} |
        | has an empty name                  | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":""},"name":""}} |
        | has a priority nobody knows        | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":""},"priority":"urgent"}} |
        | has a hold that is not yes or no   | invalid_request | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":""},"startPaused":"yes"}} |
        | has a name longer than 1024 characters | limit_exceeded | {"type":"nzb.add","id":"x","request":{"downloaderId":"$Home","operationKey":"k","source":{"kind":"bytes","dataBase64":""},"name":"$long"}} |
        | has a read of no bytes             | invalid_request | {"type":"nzb.read","id":"x","request":{"jobId":"$seed","fileId":"f","offset":0,"length":0}} |
        | has a read from before the start   | invalid_request | {"type":"nzb.read","id":"x","request":{"jobId":"$seed","fileId":"f","offset":-1,"length":1}} |

    Scenario: a message without a usable id, or of an unknown kind, is ignored
      When "reader" sends the NZB message '{"type":"nzb.downloaders"}' and gets no answer
      And "reader" sends the NZB message '{"type":"nzb.downloaders","id":""}' and gets no answer
      And "reader" sends the NZB message '{"type":"nzb.downloaders","id":7}' and gets no answer
      And "reader" sends the NZB message '{"type":"nzb.explode","id":"x"}' and gets no answer
      And "reader" sends the NZB message '{"type":"toString","id":"x"}' and gets no answer
      Then "reader" got 0 NZB answers in all

    Scenario: an id still waiting for its answer is not carried out a second time
      Given the NZB downloader "Home" holds the next "list" open
      When "reader" lists its NZB jobs on "Home" twice under one id before the first is answered
      Then the NZB downloader "Home" was asked to list 1 times
      And "reader" got 1 NZB answers in all

    Scenario: the same id from two applets is two requests
      Given the applet "player" may use NZB downloads
      When "reader" and "player" both send the NZB message '{"type":"nzb.downloaders","id":"s1"}'
      Then "reader" got 1 NZB answers in all
      And "player" got 1 NZB answers in all
      And "reader" and "player" know the NZB downloader "Home" by different names

    Scenario: an applet with too much waiting is told to slow down
      Given the NZB downloader "Home" holds the next "list" open
      When "reader" lists its NZB jobs on "Home" 17 times at once
      Then the last NZB answer to "reader" failed as "rate_limited"
      And the NZB downloader "Home" was asked to list 16 times

    Scenario: a closed applet gets no late answer, and its job carries on
      Given the NZB downloader "Home" holds the next "add" open
      When "reader" starts adding the NZB document "one file" to "Home" under the key "add-1"
      And the NZB window of "reader" is closed
      And the NZB downloader "Home" lets the held call go
      Then "reader" got 0 NZB answers in all
      And the NZB downloader "Home" holds 1 jobs
      When the applet "reader" may use NZB downloads
      And "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000
      And the NZB downloader "Home" was asked to add 1 times

    Scenario: an applet replaced by another in the same window is not given the first one's answer
      Given the NZB downloader "Home" holds the next "list" open
      When "reader" starts listing its NZB jobs on "Home"
      And the NZB window of "reader" now runs another applet
      And the NZB downloader "Home" lets the held call go
      Then "reader" is told the NZB request failed as "permission_denied" with no replay time

    Scenario: a shell that is torn down answers nobody
      Given the NZB downloader "Home" holds the next "list" open
      When "reader" starts listing its NZB jobs on "Home"
      And the NZB service is torn down
      And the NZB downloader "Home" lets the held call go
      Then "reader" got 0 NZB answers in all

  Rule: a document can be named by address when the shell can fetch it

    Scenario: the shell fetches the document itself and keeps the address to itself
      Given the shell can fetch NZB documents by address
      And the address "https://nzb.example/get?id=7&token=s3cret" serves the NZB document "holiday film"
      When "reader" adds an NZB by the address "https://nzb.example/get?id=7&token=s3cret" to "Home" under the key "add-1"
      Then the NZB question says "Name" is "Holiday film (2019)"
      And "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000
      And the NZB downloader "Home" was handed "holiday film" as "Holiday film (2019)" with no category
      And nothing "reader" was sent or the person was asked contains "s3cret" or "nzb.example"
      When "reader" adds an NZB by the address "https://nzb.example/get?id=7&token=s3cret" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000
      And the shell fetched 1 NZB documents

    Scenario: a document named by address can go into a category
      Given the shell can fetch NZB documents by address
      And the NZB downloader "Home" has the categories "films"
      And the address "https://nzb.example/a.nzb" serves the NZB document "one file"
      When "reader" asks for the NZB downloaders
      And "reader" adds an NZB by the address "https://nzb.example/a.nzb" to "Home" in "films" under the key "add-1"
      Then the NZB question says "Category" is "films"
      And "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000

    Scenario: without a fetcher an address is not offered
      When "reader" adds an NZB by the address "https://nzb.example/a.nzb" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "unsupported" with no replay time

    Scenario Outline: an address that <fault> is refused before anything is fetched
      Given the shell can fetch NZB documents by address
      When "reader" adds an NZB by the address "<address>" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "invalid_request" with no replay time
      And the shell fetched 0 NZB documents

      Examples:
        | fault                    | address                           |
        | is not secure            | http://nzb.example/a.nzb          |
        | carries a name           | https://someone@nzb.example/a.nzb |
        | carries a password       | https://a:b@nzb.example/a.nzb     |
        | has a fragment           | https://nzb.example/a.nzb#part    |
        | is relative              | /a.nzb                            |
        | has no host              | https:///a.nzb                    |
        | is of another kind       | file:///etc/passwd                |
        | cannot be an address     | https://exa mple/a.nzb            |

    Scenario: a fetch that fails makes no job, and can be tried again
      Given the shell can fetch NZB documents by address
      When "reader" adds an NZB by the address "https://nzb.example/missing.nzb" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "unavailable" with no replay time
      And the NZB downloader "Home" was handed nothing
      And nothing "reader" was sent or the person was asked contains "missing" or "nzb.example"
      Given the address "https://nzb.example/missing.nzb" serves the NZB document "one file"
      When "reader" adds an NZB by the address "https://nzb.example/missing.nzb" to "Home" under the key "add-1"
      Then "reader" is told the NZB job "add-1" is "queued", replayable until 1793448000

    Scenario Outline: a fetched document that <fault> is refused like any other
      Given the shell can fetch NZB documents by address
      And the address "https://nzb.example/a.nzb" serves the NZB document "<document>"
      When "reader" adds an NZB by the address "https://nzb.example/a.nzb" to "Home" under the key "add-1"
      Then "reader" is told the NZB request failed as "<code>" with no replay time
      And the NZB downloader "Home" was handed nothing

      Examples:
        | fault              | document           | code            |
        | declares an entity | entity declaration | invalid_request |
        | is too large       | oversize           | limit_exceeded  |

    Scenario: a fetch still running when the shell is torn down is stopped
      Given the shell can fetch NZB documents by address
      And the NZB address "https://nzb.example/slow.nzb" never finishes
      When "reader" starts adding an NZB by the address "https://nzb.example/slow.nzb" to "Home" under the key "add-1"
      And the NZB service is torn down
      Then the NZB fetch was stopped
      And the NZB downloader "Home" was handed nothing

  Rule: the shell does not read what a downloader saved

    Scenario: files and reads are not offered
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And the NZB downloader "Home" finishes the job "add-1"
      And "reader" asks for the files of the NZB job "add-1"
      Then "reader" is told the NZB request failed as "unsupported" with no replay time
      When "reader" asks to read from the NZB job "add-1"
      Then "reader" is told the NZB request failed as "unsupported" with no replay time
      When "reader" asks for the status of the NZB job "add-1"
      Then the answer about the NZB job says:
        | state        | "completed" |
        | canReadFiles | false       |

    Scenario: files of a job that is not the applet's are not found
      Given the applet "player" may use NZB downloads
      When "reader" adds the NZB document "one file" to "Home" under the key "add-1"
      And "player" asks for the files of the NZB job "add-1"
      Then "player" is told the NZB request failed as "not_found" with no replay time
