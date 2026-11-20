Feature: Torrent downloads through the person's own torrent program
  An applet asks the shell to download a torrent. The shell does not download
  anything itself: it drives the torrent program the person already runs, on
  their machine or their network, through that program's own interface. The
  person is asked before anything is handed over and before anything is
  deleted, an applet sees only the jobs it made, and because the shell cannot
  reach the program's files, everything that would hand an applet file
  contents is refused in so many words. These scenarios speak the NAP-TORRENT
  wire format to the service and run a torrent program that lives in memory.

  Background:
    Given the person's torrent program is running
    And the applet "films" is open in the torrent window "A"

  Rule: An applet is told plainly what the shell can and cannot do

    Scenario: the torrent service says what it offers
      When the torrent window "A" sends '{"type":"torrent.capabilities"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.capabilities.result","capabilities":{"transports":["bittorrent"],"modes":["download","download-and-seed"],"formats":["v1"],"createFormats":[],"retentions":["session","persistent"],"mutableSettings":["downloadLimitBytesPerSecond","uploadLimitBytesPerSecond","seedAfterComplete"],"maxReadBytes":1,"maxReadWaitMs":1,"maxPendingReads":1,"maxMetainfoBytes":2097152,"canSaveFiles":false,"canOpenFiles":false,"canSeedRuntimeFiles":false,"maxActiveJobs":32}}'
      And the torrent service declares every request and push type of the torrent domain
      And the torrent program was never called

    Scenario: with no torrent program set up, nothing is offered and nothing pretends to work
      Given the person takes the torrent program out of their settings
      When the torrent window "A" sends '{"type":"torrent.capabilities"}'
      Then the torrent window "A" gets back '{"capabilities":{"transports":[],"modes":[],"formats":["v1"]}}'
      When the torrent window "A" adds "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"unsupported-transport","reason":"No torrent program is set up."}}'
      And the person was asked 0 torrent questions
      When the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'

    Scenario Outline: the shell cannot reach the program's files, so <operation> is refused
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" sends '<request>'
      Then the torrent window "A" gets back exactly '{"type":"torrent.<operation>.result","result":{"ok":false,"error":"unsupported","reason":"kernl drives a torrent program and cannot reach its files."}}'

      Examples:
        | operation      | request                                                                                                    |
        | pickFiles      | {"type":"torrent.pickFiles","options":{"multiple":true}}                                                   |
        | read           | {"type":"torrent.read","request":{"jobId":"$job:ubuntu","fileIndex":0,"offset":0,"length":1}}             |
        | exportMetainfo | {"type":"torrent.exportMetainfo","jobId":"$job:ubuntu"}                                                    |
        | saveFile       | {"type":"torrent.saveFile","jobId":"$job:ubuntu","fileIndex":0}                                            |
        | openFile       | {"type":"torrent.openFile","jobId":"$job:ubuntu","fileIndex":0}                                            |

    Scenario: there is never a pending read to cancel
      When the torrent window "A" sends '{"type":"torrent.cancel","requestId":"read-2"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.cancel.result","result":{"ok":true,"cancelled":false}}'

  Rule: The person is asked before anything is handed to their torrent program

    Scenario: the question says what is added, how long it shares and who sees what
      When the torrent window "A" adds "ubuntu"
      Then the person was asked "Add a torrent to Transmission" as a torrent "add" question
      And the torrent question says "Name" is "ubuntu"
      And the torrent question says "Torrent" is "$hash:ubuntu"
      And the torrent question says "Program" is "Transmission"
      And the torrent question says "Sharing" is "Stops when the download finishes"
      And the torrent question says "Other people see" is "The network address of the machine running your torrent program"
      And the torrent question says "If you close this applet" is "The download pauses"
      And the torrent window "A" is told the job is queued
      And the torrent job the window "A" was given for "ubuntu" is not named after its hash
      And the torrent program was handed "ubuntu" started
      And the torrent program shows "ubuntu" as metadata

    Scenario: a download that keeps sharing and outlives the applet says so
      When the torrent window "A" adds "ubuntu" with '{"mode":"download-and-seed","retention":"persistent","storage":"persistent","transport":"bittorrent","seedAfterComplete":true}'
      Then the torrent question says "Sharing" is "Keeps sharing with other people after the download finishes"
      And the torrent question says "If you close this applet" is "The download carries on in your torrent program"
      And the torrent window "A" is told the job is queued

    Scenario: the person says no, and nothing happens
      Given the person will say no to the torrent question
      When the torrent window "A" adds "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"user-denied"}}'
      And the torrent program was never called
      When the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'

    Scenario: a torrent named only by its hash is asked about without a name
      When the torrent window "A" sends '{"type":"torrent.add","request":{"source":{"sourceType":"infohash","hashes":{"v1":"$hash:ubuntu"}},"options":{"retention":"persistent"}}}'
      Then the torrent question has no "Name" line
      And the torrent question says "Torrent" is "$hash:ubuntu"
      And the torrent window "A" is told the job is queued
      And the torrent program shows "ubuntu" as metadata

    Scenario Outline: a magnet link <how> is asked about by its hash alone
      When the torrent window "A" sends '{"type":"torrent.add","request":{"source":{"sourceType":"magnet","magnet":"<magnet>"}}}'
      Then the torrent question has no "Name" line
      And the torrent question says "Torrent" is "$hash:ubuntu"
      And the torrent window "A" is told the job is queued

      Examples:
        | how                | magnet                                |
        | with no name       | magnet:?xt=urn:btih:$hash:ubuntu      |
        | with an empty name | magnet:?xt=urn:btih:$hash:ubuntu&dn=  |

    Scenario Outline: a torrent file is accepted as <form>
      When the torrent window "A" sends '{"type":"torrent.add","request":{"source":{"sourceType":"metainfo","metainfo":"$<form>:ubuntu"}}}'
      Then the torrent question says "Name" is "ubuntu"
      And the torrent question says "Torrent" is "$hash:ubuntu"
      And the torrent window "A" is told the job is queued
      And the torrent program shows "ubuntu" as downloading

      Examples:
        | form           |
        | torrent        |
        | torrent-bytes  |
        | torrent-view   |
        | torrent-buffer |
        | torrent-list   |

    Scenario: a torrent file that matches the hash the applet expects is accepted
      When the torrent window "A" sends '{"type":"torrent.add","request":{"source":{"sourceType":"metainfo","metainfo":"$torrent:ubuntu","hashes":{"v1":"$hash:ubuntu"}}}}'
      Then the torrent window "A" is told the job is queued

    Scenario: a job can start paused and with speed limits
      When the torrent window "A" adds "ubuntu" with '{"startPaused":true,"downloadLimitBytesPerSecond":5000}'
      Then the torrent window "A" is told the job is paused
      And the torrent program was handed "ubuntu" paused
      And the torrent program shows "ubuntu" as paused
      And the torrent program limits "ubuntu" to 5000 down and 0 up

    Scenario: limits are in place before a limited torrent starts
      When the torrent window "A" adds "ubuntu" with '{"uploadLimitBytesPerSecond":700}'
      Then the torrent window "A" is told the job is queued
      And the torrent program was handed "ubuntu" paused
      And the torrent program limits "ubuntu" to 0 down and 700 up
      And the torrent program shows "ubuntu" as metadata

    Scenario Outline: a source that is <wrong> is refused before the person is bothered
      When the torrent window "A" sends '{"type":"torrent.add","request":{"source":<source>}}'
      Then the torrent window "A" is refused with "<error>"
      And the person was asked 0 torrent questions
      And the torrent program was never called

      Examples:
        | wrong                           | source                                                                                              | error              |
        | not a magnet link               | {"sourceType":"magnet","magnet":"https://example.com/file"}                                         | invalid-magnet     |
        | a magnet link that is not text  | {"sourceType":"magnet","magnet":7}                                                                  | invalid-magnet     |
        | a magnet link without a hash    | {"sourceType":"magnet","magnet":"magnet:?dn=ubuntu"}                                                | invalid-magnet     |
        | a BitTorrent v2 magnet link     | {"sourceType":"magnet","magnet":"magnet:?xt=urn:btmh:1220$hash:ubuntu"}                             | unsupported-format |
        | a shortened hash                | {"sourceType":"infohash","hashes":{"v1":"abc123"}}                                                  | invalid-infohash   |
        | an uppercase hash               | {"sourceType":"infohash","hashes":{"v1":"ABCDEF0123456789ABCDEF0123456789ABCDEF01"}}                 | invalid-infohash   |
        | an empty set of hashes          | {"sourceType":"infohash","hashes":{}}                                                               | invalid-infohash   |
        | hashes that are not a record    | {"sourceType":"infohash","hashes":"$hash:ubuntu"}                                                   | invalid-infohash   |
        | a BitTorrent v2 hash alone      | {"sourceType":"infohash","hashes":{"v2":"$v2hash:ubuntu"}}                                          | unsupported-format |
        | a v2 hash cut short             | {"sourceType":"infohash","hashes":{"v1":"$hash:ubuntu","v2":"$hash:ubuntu"}}                        | invalid-infohash   |
        | not a torrent file              | {"sourceType":"metainfo","metainfo":"bm90IGEgdG9ycmVudA=="}                                         | invalid-source     |
        | a torrent file in no known form | {"sourceType":"metainfo","metainfo":{"bytes":[1,2,3]}}                                              | invalid-source     |
        | text that is not base64         | {"sourceType":"metainfo","metainfo":"not base64!"}                                                  | invalid-source     |
        | a BitTorrent v2 torrent file    | {"sourceType":"metainfo","metainfo":"$torrent-v2:ubuntu"}                                           | unsupported-format |
        | a torrent file over 2 MiB       | {"sourceType":"metainfo","metainfo":"$torrent-oversized:ubuntu"}                                    | too-large          |
        | base64 text far over 2 MiB      | {"sourceType":"metainfo","metainfo":"$torrent-oversized-text:ubuntu"}                               | too-large          |
        | a file with another hash        | {"sourceType":"metainfo","metainfo":"$torrent:ubuntu","hashes":{"v1":"$hash:debian"}}               | hash-mismatch      |
        | a file claimed to be v2 as well | {"sourceType":"metainfo","metainfo":"$torrent:ubuntu","hashes":{"v1":"$hash:ubuntu","v2":"$v2hash:ubuntu"}} | hash-mismatch |
        | a file with a malformed hash    | {"sourceType":"metainfo","metainfo":"$torrent:ubuntu","hashes":{"v1":"abc"}}                        | invalid-infohash   |
        | two sources at once             | {"sourceType":"magnet","magnet":"$magnet:ubuntu","hashes":{"v1":"$hash:ubuntu"}}                    | invalid-source     |
        | missing the field it names      | {"sourceType":"magnet"}                                                                             | invalid-source     |
        | of a kind nobody knows          | {"sourceType":"usenet","magnet":"$magnet:ubuntu"}                                                   | invalid-source     |
        | without a kind                  | {"magnet":"$magnet:ubuntu"}                                                                         | invalid-source     |
        | carrying a field nobody knows   | {"sourceType":"magnet","magnet":"$magnet:ubuntu","url":"https://example.com"}                       | invalid-source     |
        | files on the person's machine   | {"sourceType":"runtime-file-set","runtimeFileSetId":"fs-1"}                                         | unsupported-source |

    Scenario Outline: a request for <what> is refused before the person is bothered
      When the torrent window "A" adds "ubuntu" with '<options>'
      Then the torrent window "A" is refused with "<error>"
      And the person was asked 0 torrent questions
      And the torrent program was never called

      Examples:
        | what                                   | options                                          | error                 |
        | seeding the person's own files         | {"mode":"seed"}                                  | unsupported-mode      |
        | an engine the shell does not have      | {"transport":"webtorrent"}                       | unsupported-transport |
        | temporary storage                      | {"storage":"temporary"}                          | storage-denied        |
        | a folder the person picks              | {"storage":"user-selected"}                      | storage-denied        |
        | extra trackers                         | {"trackers":["https://tracker.example/announce"]} | unsupported-setting  |
        | extra web seeds                        | {"webSeeds":[]}                                  | unsupported-setting   |
        | choosing files before they are known   | {"fileSelection":{"indexes":[0]}}                | unsupported           |
        | a format for a torrent it did not make | {"createFormat":"v1"}                            | invalid-request       |
        | downloading only, yet sharing after    | {"seedAfterComplete":true}                       | invalid-request       |
        | sharing after, yet not                 | {"mode":"download-and-seed","seedAfterComplete":false} | invalid-request |
        | a mode nobody knows                    | {"mode":"leech"}                                 | invalid-request       |
        | a negative speed limit                 | {"downloadLimitBytesPerSecond":-1}               | invalid-request       |
        | a fractional speed limit               | {"uploadLimitBytesPerSecond":1.5}                | invalid-request       |
        | a lifetime nobody knows                | {"retention":"forever"}                          | invalid-request       |
        | storage nobody knows                   | {"storage":"cloud"}                              | invalid-request       |
        | an option nobody knows                 | {"encrypt":true}                                 | invalid-request       |
        | trackers that are not text             | {"trackers":[7]}                                 | invalid-request       |
        | a transport that is not text           | {"transport":7}                                  | invalid-request       |

  Rule: A job belongs to the applet that made it

    Scenario: an applet may name its job, once
      When the torrent window "A" sends '{"type":"torrent.add","request":{"jobId":"my-download","source":{"sourceType":"magnet","magnet":"$magnet:ubuntu"}}}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":true,"jobId":"my-download","state":"queued"}}'
      When the torrent window "A" sends '{"type":"torrent.add","request":{"jobId":"my-download","source":{"sourceType":"magnet","magnet":"$magnet:debian"}}}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"job-conflict","reason":"This applet already has that job or that torrent."}}'
      And the person was asked 1 torrent question
      And the torrent program has never had "debian"

    Scenario: adding a torrent the applet already has is a conflict, and the first job is untouched
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" adds "ubuntu" with '{"mode":"download-and-seed"}'
      Then the torrent window "A" is refused with "job-conflict"
      And the person was asked 1 torrent question
      When the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back '{"jobs":[{"mode":"download"}]}'

    Scenario: two requests for the same torrent, both answered yes, still make one job
      Given the person is slow to answer the torrent question
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" adds "ubuntu"
      And the person answers every torrent question with yes
      Then the torrent window "A" is refused with "job-conflict"
      And the torrent window "A" has had 2 answers

    Scenario: a window that closes while the person is still deciding gets no job
      Given the person is slow to answer the torrent question
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" is closed
      And the person answers every torrent question with yes
      Then the torrent window "A" is refused with "policy-denied"
      And the torrent program was never called

    Scenario: a program taken out of the settings while the person is still deciding gets nothing, and nothing goes elsewhere
      Given the person is slow to answer the torrent question
      When the torrent window "A" adds "ubuntu"
      And the person takes the torrent program out of their settings
      And the person answers every torrent question with yes
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"unsupported-transport","reason":"That torrent program is no longer set up."}}'
      And the torrent program was never called

    Scenario: an applet from another publisher with the same name is another applet
      Given another publisher's applet, also called "reader", is open in the torrent window "B"
      When the torrent window "A" sends '{"type":"torrent.add","request":{"jobId":"shared-name","source":{"sourceType":"magnet","magnet":"$magnet:ubuntu"},"options":{"retention":"persistent"}}}'
      And the torrent window "B" sends '{"type":"torrent.jobs"}'
      Then the torrent window "B" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'
      When the torrent window "B" sends '{"type":"torrent.status","jobId":"shared-name"}'
      Then the torrent window "B" gets back exactly '{"type":"torrent.status.result","error":"job-not-found"}'

    Scenario: another applet cannot see, read or change a job by knowing its id
      Given the applet "music" is open in the torrent window "B"
      When the torrent window "A" sends '{"type":"torrent.add","request":{"jobId":"shared-name","source":{"sourceType":"magnet","magnet":"$magnet:ubuntu"},"options":{"retention":"persistent"}}}'
      And the torrent window "B" sends '{"type":"torrent.jobs"}'
      Then the torrent window "B" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'
      When the torrent window "B" sends '{"type":"torrent.status","jobId":"shared-name"}'
      Then the torrent window "B" gets back exactly '{"type":"torrent.status.result","error":"job-not-found"}'
      When the torrent window "B" sends '{"type":"torrent.pause","jobId":"shared-name"}'
      Then the torrent window "B" is refused with "job-not-found"
      When the torrent window "B" sends '{"type":"torrent.update","request":{"jobId":"shared-name","expectedRevision":0,"patch":{"uploadLimitBytesPerSecond":1}}}'
      Then the torrent window "B" gets back exactly '{"type":"torrent.update.result","result":{"ok":false,"error":"job-not-found"}}'
      When the torrent window "B" sends '{"type":"torrent.remove","jobId":"shared-name","options":{"deleteData":true}}'
      Then the torrent window "B" gets back exactly '{"type":"torrent.remove.result","result":{"ok":false,"jobId":"shared-name","error":"job-not-found"}}'
      And the person was asked 1 torrent question
      And the torrent program shows "ubuntu" as metadata
      When the torrent window "B" sends '{"type":"torrent.add","request":{"jobId":"shared-name","source":{"sourceType":"magnet","magnet":"$magnet:debian"}}}'
      Then the torrent window "B" is told the job is queued

    Scenario: an applet can hold 32 jobs and no more
      When the torrent window "A" adds 32 different torrents
      And the torrent window "A" adds "ubuntu"
      Then the torrent window "A" is refused with "quota-exceeded"
      And the person was asked 32 torrent questions

    Scenario: a window that is not a live applet is turned away
      Given the torrent window "X" is not a live applet
      When the torrent window "X" sends '{"type":"torrent.capabilities"}'
      Then the torrent window "X" gets back exactly '{"type":"torrent.capabilities.result","error":"policy-denied"}'
      When the torrent window "X" sends '{"type":"torrent.add","request":{"source":{"sourceType":"magnet","magnet":"$magnet:ubuntu"}}}'
      Then the torrent window "X" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"policy-denied"}}'
      And the torrent program was never called

  Rule: Two applets can hold the same torrent, and neither can take it from the other

    Background:
      Given the applet "music" is open in the torrent window "B"
      And the torrent window "A" adds "ubuntu" with '{"retention":"persistent"}'
      And the torrent window "B" adds "ubuntu" with '{"retention":"persistent","mode":"download-and-seed"}'

    Scenario: removing one applet's job leaves the torrent and its files for the other
      When the torrent window "B" asks to remove "ubuntu" and delete its files
      Then the torrent window "B" gets back exactly '{"type":"torrent.remove.result","result":{"ok":true,"jobId":"$job:ubuntu","deletedData":false}}'
      And the person was asked 2 torrent questions
      And the torrent program still has "ubuntu"
      And the torrent program was not told to delete any files
      When the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" is told the job is metadata
      When the torrent window "B" sends '{"type":"torrent.jobs"}'
      Then the torrent window "B" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'

    Scenario: the last applet holding the torrent can remove it, and is asked before files go
      When the torrent window "B" asks to remove "ubuntu"
      And the torrent window "A" asks to remove "ubuntu" and delete its files
      Then the person was asked "Delete the torrent's files" as a torrent "delete" question
      And the torrent question says "Name" is "ubuntu"
      And the torrent question says "Torrent" is "$hash:ubuntu"
      And the torrent question says "Deletes" is "The files this torrent downloaded, on the machine running your torrent program"
      And the torrent window "A" gets back '{"result":{"ok":true,"deletedData":true}}'
      And the torrent program no longer has "ubuntu"
      And the torrent program was told to delete the files of "ubuntu"

    Scenario: a finished torrent keeps sharing while one of its applets wants it shared
      When the torrent program reads what is in "ubuntu"
      And the torrent program finishes "ubuntu"
      Then the torrent window "A" is pushed the state "complete" for "ubuntu"
      And the torrent window "B" is pushed the state "seeding" for "ubuntu"
      And the torrent program shows "ubuntu" as seeding
      When the torrent window "B" asks to remove "ubuntu"
      And the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" is told the job is complete
      And the torrent program shows "ubuntu" as paused

    Scenario: a session job that ends leaves a torrent another applet holds running
      Given the applet "games" is open in the torrent window "C"
      When the torrent window "C" adds "ubuntu"
      And the torrent window "C" is closed
      And a few torrent refreshes pass
      Then the torrent program shows "ubuntu" as metadata

  Rule: A session job lives and dies with its window; a persistent job is found again

    Scenario: closing the window pauses a session download and leaves it in the program
      Given the applet "films" is open in the torrent window "C"
      When the torrent window "A" adds "ubuntu"
      And the torrent window "C" sends '{"type":"torrent.jobs"}'
      Then the torrent window "C" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'
      When the torrent window "C" asks to status "ubuntu"
      Then the torrent window "C" is refused with "job-not-found"
      When the torrent window "A" is closed
      Then the torrent program shows "ubuntu" as paused
      And the torrent program still has "ubuntu"
      And the torrent program was not told to delete any files
      And the torrent service has stopped asking the torrent program
      And the torrent job storage holds 0 jobs

    Scenario: taking the permission back ends a session job the same way
      When the torrent window "A" adds "ubuntu"
      And the person takes the torrent permission back from the window "A"
      Then the torrent program shows "ubuntu" as paused
      When the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" is refused with "job-not-found"

    Scenario: shutting the shell down pauses session downloads
      When the torrent window "A" adds "ubuntu"
      And the shell shuts the torrent service down
      Then the torrent program shows "ubuntu" as paused
      And the torrent service has stopped asking the torrent program

    Scenario: a window that closes while the program is out of reach still lets go of its job
      When the torrent window "A" adds "ubuntu"
      And the torrent program stops answering
      And the torrent window "A" is closed
      And the torrent program answers again
      And the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" is refused with "job-not-found"
      And the torrent program still has "ubuntu"

    Scenario: a persistent job carries on after its window closes and is found again after a reload
      Given the applet "music" is open in the torrent window "B"
      When the torrent window "A" adds "ubuntu" with '{"retention":"persistent","mode":"download-and-seed"}'
      And the torrent window "A" is closed
      And a few torrent refreshes pass
      Then the torrent program shows "ubuntu" as metadata
      And the torrent service has stopped asking the torrent program
      And the torrent job storage holds 1 job
      When the shell is reloaded and starts its torrent service again
      And the applet "films" is open in the torrent window "D"
      And the applet "music" is open in the torrent window "E"
      And the torrent window "D" sends '{"type":"torrent.jobs"}'
      Then the torrent window "D" gets back exactly '{"type":"torrent.jobs.result","jobs":[{"jobId":"$job:ubuntu","state":"metadata","mode":"download-and-seed","transport":"bittorrent","hashes":{"v1":"$hash:ubuntu"},"downloadRate":0,"uploadRate":0,"ratio":0,"title":"ubuntu","retention":"persistent"}]}'
      When the torrent window "E" sends '{"type":"torrent.jobs"}'
      Then the torrent window "E" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'
      When the torrent program reads what is in "ubuntu"
      Then the torrent window "D" is pushed the state "downloading" for "ubuntu"
      And the torrent window "E" has been pushed nothing
      And the person was asked 1 torrent question

    Scenario: every open window of the applet hears about its persistent job
      Given the applet "films" is open in the torrent window "C"
      When the torrent window "A" adds "ubuntu" with '{"retention":"persistent"}'
      And the torrent window "C" sends '{"type":"torrent.jobs"}'
      And the torrent program reads what is in "ubuntu"
      Then the torrent window "A" is pushed the state "downloading" for "ubuntu"
      And the torrent window "C" is pushed the state "downloading" for "ubuntu"

    Scenario: what comes back out of storage is checked, and damaged jobs are dropped
      Given the torrent job storage holds '[{"applet":"pk:35129:films","jobId":"kept","infoHash":"$hash:ubuntu","connection":"memory","mode":"download","revision":3,"downloadLimit":0,"uploadLimit":0,"paused":false,"title":"ubuntu"},{"applet":"pk:35129:films","jobId":"kept","infoHash":"$hash:debian","connection":"memory","mode":"download","revision":0,"downloadLimit":0,"uploadLimit":0,"paused":false},{"applet":"pk:35129:films","jobId":"no-connection","infoHash":"$hash:debian","mode":"download","revision":0,"downloadLimit":0,"uploadLimit":0,"paused":false},{"applet":"pk:35129:films","jobId":"bad-connection","infoHash":"$hash:debian","connection":7,"mode":"download","revision":0,"downloadLimit":0,"uploadLimit":0,"paused":false},{"applet":"pk:35129:films","jobId":"bad-hash","infoHash":"../../etc","mode":"download","revision":0,"downloadLimit":0,"uploadLimit":0,"paused":false},{"applet":"pk:35129:films","jobId":"bad-mode","infoHash":"$hash:debian","mode":"seed","revision":0,"downloadLimit":0,"uploadLimit":0,"paused":false},{"applet":"pk:35129:films","jobId":"extra","infoHash":"$hash:debian","mode":"download","revision":0,"downloadLimit":0,"uploadLimit":0,"paused":false,"windowId":"window-A"},{"applet":"pk:35129:films","jobId":"partial"},"nonsense",null]'
      When the shell is reloaded and starts its torrent service again
      And the applet "films" is open in the torrent window "A"
      And the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.jobs.result","jobs":[{"jobId":"kept","state":"error","mode":"download","transport":"bittorrent","hashes":{"v1":"$hash:ubuntu"},"downloadRate":0,"uploadRate":0,"ratio":0,"retention":"persistent"}]}'

    Scenario Outline: storage that holds <what> is treated as holding no torrent jobs
      Given the torrent job storage holds '<stored>'
      When the shell is reloaded and starts its torrent service again
      And the applet "films" is open in the torrent window "A"
      And the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'

      Examples:
        | what              | stored          |
        | something else    | {"jobs":"none"} |
        | unreadable text   | not json at all |

    Scenario: a persistent job that cannot be written down is not started
      Given the torrent job storage is full
      When the torrent window "A" adds "ubuntu" with '{"retention":"persistent"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"storage-denied","reason":"The job could not be kept."}}'
      And the torrent program was never called
      When the torrent window "A" adds "ubuntu"
      Then the torrent window "A" is told the job is queued

  Rule: An applet follows its job without asking, and can always ask

    Scenario: a status holds what the program knows and leaves out what it does not
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.status.result","status":{"ok":true,"jobId":"$job:ubuntu","state":"metadata","mode":"download","transport":"bittorrent","hashes":{"v1":"$hash:ubuntu"},"downloadedBytes":0,"uploadedBytes":0,"downloadRate":0,"uploadRate":0,"ratio":0,"peers":{"peers":0,"seeds":0,"leeches":0},"title":"ubuntu","settings":{"revision":0,"downloadLimitBytesPerSecond":0,"uploadLimitBytesPerSecond":0,"seedAfterComplete":false,"endpointsRedacted":true},"retention":"session"}}'
      When the torrent program reads what is in "ubuntu"
      And the torrent program has 250 of the 1000 bytes of "ubuntu"
      And the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.status.result","status":{"ok":true,"jobId":"$job:ubuntu","state":"downloading","mode":"download","transport":"bittorrent","hashes":{"v1":"$hash:ubuntu"},"downloadedBytes":250,"uploadedBytes":0,"totalBytes":1000,"progress":0.25,"downloadRate":50,"uploadRate":0,"ratio":0,"peers":{"peers":3,"seeds":2,"leeches":1},"title":"ubuntu","etaSeconds":15,"settings":{"revision":0,"downloadLimitBytesPerSecond":0,"uploadLimitBytesPerSecond":0,"seedAfterComplete":false,"endpointsRedacted":true},"retention":"session"}}'

    Scenario: a torrent with no name yet has no title
      When the torrent window "A" sends '{"type":"torrent.add","request":{"source":{"sourceType":"infohash","hashes":{"v1":"$hash:ubuntu"}}}}'
      And the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.status.result","status":{"ok":true,"jobId":"$job:ubuntu","state":"metadata","mode":"download","transport":"bittorrent","hashes":{"v1":"$hash:ubuntu"},"downloadedBytes":0,"uploadedBytes":0,"downloadRate":0,"uploadRate":0,"ratio":0,"peers":{"peers":0,"seeds":0,"leeches":0},"settings":{"revision":0,"downloadLimitBytesPerSecond":0,"uploadLimitBytesPerSecond":0,"seedAfterComplete":false,"endpointsRedacted":true},"retention":"session"}}'

    Scenario: a download is followed to its end, then stopped so nothing is shared after it
      When the torrent window "A" adds "ubuntu"
      Then the torrent window "A" is pushed the state "metadata" for "ubuntu"
      When the torrent program reads what is in "ubuntu"
      Then the torrent window "A" is pushed '{"type":"torrent.state","state":"downloading","status":{"ok":true,"state":"downloading","totalBytes":1000,"progress":0}}' for "ubuntu"
      When the torrent program has 250 of the 1000 bytes of "ubuntu"
      Then the torrent window "A" is pushed '{"type":"torrent.progress","status":{"state":"downloading","downloadedBytes":250,"progress":0.25,"downloadRate":50}}' for "ubuntu"
      When the torrent program finishes "ubuntu"
      Then the torrent window "A" is pushed '{"type":"torrent.state","state":"complete","status":{"state":"complete","mode":"download","progress":1}}' for "ubuntu"
      And the torrent program shows "ubuntu" as paused
      And the torrent service has stopped asking the torrent program
      And the torrent window "A" has been pushed the error "network-error" for "ubuntu" 0 times

    Scenario: a download that keeps sharing is left sharing, and its ratio is reported
      When the torrent window "A" adds "ubuntu" with '{"mode":"download-and-seed"}'
      And the torrent program reads what is in "ubuntu"
      And the torrent program finishes "ubuntu"
      Then the torrent window "A" is pushed the state "seeding" for "ubuntu"
      When the torrent program has shared 500 bytes of "ubuntu"
      Then the torrent window "A" is pushed '{"type":"torrent.progress","status":{"state":"seeding","uploadedBytes":500,"ratio":0.5,"uploadRate":20}}' for "ubuntu"
      And the torrent program shows "ubuntu" as seeding
      And the torrent service keeps asking the torrent program

    Scenario: a job can be listed by state and by mode
      When the torrent window "A" adds "ubuntu" with '{"startPaused":true}'
      And the torrent window "A" adds "debian" with '{"mode":"download-and-seed"}'
      And the torrent window "A" sends '{"type":"torrent.jobs","filter":{"states":["paused","seeding"]}}'
      Then the torrent window "A" gets back '{"jobs":[{"jobId":"$job:ubuntu","state":"paused"}]}'
      And the torrent window "A" is shown 1 torrent job
      When the torrent window "A" sends '{"type":"torrent.jobs","filter":{"modes":["download-and-seed"]}}'
      Then the torrent window "A" gets back '{"jobs":[{"jobId":"$job:debian","state":"metadata"}]}'
      And the torrent window "A" is shown 1 torrent job
      When the torrent window "A" sends '{"type":"torrent.jobs","filter":{"states":[],"modes":["download"]}}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'

    Scenario: left to itself, the service looks at the program every two seconds
      Given a shell that does not say how often to refresh torrents
      And the applet "films" is open in the torrent window "A"
      When the torrent window "A" adds "ubuntu"
      Then the torrent window "A" has been pushed nothing
      And the torrent window "A" is pushed the state "metadata" for "ubuntu" within 3 seconds

    Scenario: nobody is pushed anything once the shell detaches the service
      When the torrent window "A" adds "ubuntu"
      And the shell detaches the torrent service
      And the torrent program reads what is in "ubuntu"
      Then the torrent window "A" has been pushed nothing

  Rule: Pausing, resuming and choosing files go to the program

    Scenario: an applet pauses and resumes its download
      When the torrent window "A" adds "ubuntu"
      And the torrent program reads what is in "ubuntu"
      And the torrent window "A" asks to pause "ubuntu"
      Then the torrent window "A" is told the job is paused
      And the torrent program shows "ubuntu" as paused
      When the torrent window "A" asks to resume "ubuntu"
      Then the torrent window "A" is told the job is downloading
      And the torrent program shows "ubuntu" as downloading

    Scenario: resuming a finished download does not start sharing it
      When the torrent window "A" adds "ubuntu"
      And the torrent program reads what is in "ubuntu"
      And the torrent program finishes "ubuntu"
      Then the torrent window "A" is pushed the state "complete" for "ubuntu"
      When the torrent window "A" asks to pause "ubuntu"
      Then the torrent window "A" is told the job is paused
      When the torrent window "A" asks to resume "ubuntu"
      Then the torrent window "A" is told the job is complete
      And the torrent program shows "ubuntu" as paused

    Scenario: files are listed once the program knows them
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" asks to files "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.files.result","files":[]}'
      When the torrent program reads what is in "ubuntu"
      And the torrent program has 750 of the 1000 bytes of "ubuntu"
      And the torrent window "A" asks to files "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.files.result","files":[{"index":0,"path":"ubuntu/a.bin","size":600,"selected":true,"priority":0,"downloadedBytes":600,"progress":1},{"index":1,"path":"ubuntu/b.bin","size":400,"selected":true,"priority":0,"downloadedBytes":150,"progress":0.375},{"index":2,"path":"ubuntu/empty.txt","size":0,"selected":true,"priority":0,"downloadedBytes":0,"progress":1}]}'

    Scenario: an applet chooses which files to fetch, by index and by path
      When the torrent window "A" adds "ubuntu"
      And the torrent program reads what is in "ubuntu"
      And the torrent window "A" sends '{"type":"torrent.selectFiles","jobId":"$job:ubuntu","selection":{"indexes":[1],"paths":["ubuntu/empty.txt"],"priority":9}}'
      Then the torrent window "A" is told the job is downloading
      And the torrent program skips "ubuntu/a.bin" of "ubuntu"
      And the torrent program fetches "ubuntu/b.bin" of "ubuntu" at priority 1
      And the torrent program fetches "ubuntu/empty.txt" of "ubuntu" at priority 1
      When the torrent window "A" sends '{"type":"torrent.selectFiles","jobId":"$job:ubuntu","selection":{"indexes":[0,1,2]}}'
      Then the torrent window "A" is told the job is downloading
      And the torrent program fetches "ubuntu/a.bin" of "ubuntu" at priority 0
      And the torrent program fetches "ubuntu/b.bin" of "ubuntu" at priority 1

    Scenario Outline: a file selection that <wrong> is refused
      When the torrent window "A" adds "ubuntu"
      And the torrent program reads what is in "ubuntu"
      And the torrent window "A" sends '{"type":"torrent.selectFiles","jobId":"$job:ubuntu","selection":<selection>}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.selectFiles.result","error":"invalid-request"}'

      Examples:
        | wrong                         | selection                     |
        | names a file that is not there | {"paths":["ubuntu/c.bin"]}   |
        | names an index out of range   | {"indexes":[3]}               |
        | names no file                 | {"priority":1}                |
        | is empty                      | {"indexes":[],"paths":[]}     |
        | has a negative index          | {"indexes":[-1]}              |
        | has a priority that is text   | {"indexes":[0],"priority":"high"} |
        | is not a record               | [0]                           |

    Scenario: files cannot be chosen before the program knows them
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" sends '{"type":"torrent.selectFiles","jobId":"$job:ubuntu","selection":{"indexes":[0]}}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.selectFiles.result","error":"metadata-unavailable"}'

  Rule: A torrent's identity can be shared, its trackers never

    Scenario: metadata names the torrent and gives a magnet link with no tracker in it
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" asks to metadata "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.metadata.result","result":{"ok":false,"error":"metadata-unavailable"}}'
      When the torrent program reads what is in "ubuntu"
      And the torrent window "A" asks to metadata "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.metadata.result","result":{"ok":true,"format":"v1","hashes":{"v1":"$hash:ubuntu"},"name":"ubuntu","private":false,"magnet":"magnet:?xt=urn:btih:$hash:ubuntu&dn=ubuntu","endpointsRedacted":true,"metainfoReady":false}}'
      And nothing the torrent service said mentions "hunter2"
      And nothing the torrent service said mentions "tracker.example"

    Scenario: a private torrent says it is private
      When the torrent window "A" sends '{"type":"torrent.add","request":{"source":{"sourceType":"metainfo","metainfo":"$torrent-private:ubuntu"}}}'
      And the torrent window "A" asks to metadata "ubuntu"
      Then the torrent window "A" gets back '{"result":{"ok":true,"name":"ubuntu","private":true,"endpointsRedacted":true}}'

    Scenario: metadata waits when the program cannot say whether the torrent is private
      When the torrent window "A" adds "ubuntu"
      And the torrent program reads what is in "ubuntu" but cannot tell whether it is private
      And the torrent window "A" asks to metadata "ubuntu"
      Then the torrent window "A" is refused with "metadata-unavailable"

  Rule: Settings change one revision at a time

    Scenario: limits go to the program and move the revision
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" changes "ubuntu" at revision 0 with '{"uploadLimitBytesPerSecond":500000}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.update.result","result":{"ok":true,"settings":{"revision":1,"downloadLimitBytesPerSecond":0,"uploadLimitBytesPerSecond":500000,"seedAfterComplete":false,"endpointsRedacted":true}}}'
      And the torrent program limits "ubuntu" to 0 down and 500000 up
      When the torrent window "A" changes "ubuntu" at revision 0 with '{"downloadLimitBytesPerSecond":9}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.update.result","result":{"ok":false,"error":"revision-conflict","settings":{"revision":1,"downloadLimitBytesPerSecond":0,"uploadLimitBytesPerSecond":500000,"seedAfterComplete":false,"endpointsRedacted":true}}}'
      And the torrent program limits "ubuntu" to 0 down and 500000 up
      When the torrent window "A" changes "ubuntu" at revision 1 with '{"uploadLimitBytesPerSecond":500000,"seedAfterComplete":false}'
      Then the torrent window "A" gets back '{"result":{"ok":true,"settings":{"revision":1}}}'
      When the torrent window "A" changes "ubuntu" at revision 1 with '{"downloadLimitBytesPerSecond":9}'
      Then the torrent window "A" gets back '{"result":{"ok":true,"settings":{"revision":2,"downloadLimitBytesPerSecond":9,"uploadLimitBytesPerSecond":500000}}}'

    Scenario: a limit the person changes in the program is a new revision
      When the torrent window "A" adds "ubuntu" with '{"retention":"persistent"}'
      And the person limits "ubuntu" in the torrent program to 100 down and 200 up
      And the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" gets back '{"status":{"settings":{"revision":1,"downloadLimitBytesPerSecond":100,"uploadLimitBytesPerSecond":200}}}'

    Scenario Outline: a change that <wrong> is refused and changes nothing
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" sends '{"type":"torrent.update","request":<request>}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.update.result","result":{"ok":false,"error":"<error>"}}'
      And the torrent program limits "ubuntu" to 0 down and 0 up

      Examples:
        | wrong                         | request                                                                                              | error               |
        | replaces the trackers         | {"jobId":"$job:ubuntu","expectedRevision":0,"patch":{"trackers":[]}}                                 | unsupported-setting |
        | replaces the web seeds        | {"jobId":"$job:ubuntu","expectedRevision":0,"patch":{"uploadLimitBytesPerSecond":5,"webSeeds":[]}}   | unsupported-setting |
        | names a setting nobody knows  | {"jobId":"$job:ubuntu","expectedRevision":0,"patch":{"encryption":"forced"}}                         | unsupported-setting |
        | has a negative limit          | {"jobId":"$job:ubuntu","expectedRevision":0,"patch":{"uploadLimitBytesPerSecond":-5}}                | invalid-request     |
        | has a flag that is text       | {"jobId":"$job:ubuntu","expectedRevision":0,"patch":{"seedAfterComplete":"yes"}}                     | invalid-request     |
        | changes nothing at all        | {"jobId":"$job:ubuntu","expectedRevision":0,"patch":{}}                                              | invalid-request     |
        | has no revision               | {"jobId":"$job:ubuntu","patch":{"uploadLimitBytesPerSecond":5}}                                      | invalid-request     |
        | has a revision that is text   | {"jobId":"$job:ubuntu","expectedRevision":"0","patch":{"uploadLimitBytesPerSecond":5}}               | invalid-request     |
        | has no patch                  | {"jobId":"$job:ubuntu","expectedRevision":0}                                                         | invalid-request     |
        | names no job                  | {"expectedRevision":0,"patch":{"uploadLimitBytesPerSecond":5}}                                       | invalid-request     |
        | carries a field nobody knows  | {"jobId":"$job:ubuntu","expectedRevision":0,"patch":{"uploadLimitBytesPerSecond":5},"force":true}    | invalid-request     |

    Scenario: sharing after the download can be switched on and off
      When the torrent window "A" adds "ubuntu"
      And the torrent program reads what is in "ubuntu"
      And the torrent program finishes "ubuntu"
      Then the torrent window "A" is pushed the state "complete" for "ubuntu"
      And the torrent program shows "ubuntu" as paused
      When the torrent window "A" changes "ubuntu" at revision 0 with '{"seedAfterComplete":true}'
      Then the torrent window "A" gets back '{"result":{"ok":true,"settings":{"revision":1,"seedAfterComplete":true}}}'
      And the torrent window "A" is pushed '{"type":"torrent.state","state":"seeding","status":{"mode":"download-and-seed"}}' for "ubuntu"
      And the torrent program shows "ubuntu" as seeding
      When the torrent window "A" changes "ubuntu" at revision 1 with '{"seedAfterComplete":false}'
      Then the torrent window "A" gets back '{"result":{"ok":true,"settings":{"revision":2,"seedAfterComplete":false}}}'
      And the torrent program shows "ubuntu" as paused
      And the torrent window "A" is pushed '{"type":"torrent.state","state":"complete","status":{"mode":"download","settings":{"revision":2}}}' for "ubuntu"

    Scenario: a paused job stays paused when sharing is switched on
      When the torrent window "A" adds "ubuntu"
      And the torrent program reads what is in "ubuntu"
      And the torrent program finishes "ubuntu"
      Then the torrent window "A" is pushed the state "complete" for "ubuntu"
      When the torrent window "A" asks to pause "ubuntu"
      And the torrent window "A" changes "ubuntu" at revision 0 with '{"seedAfterComplete":true}'
      Then the torrent window "A" gets back '{"result":{"ok":true,"settings":{"seedAfterComplete":true}}}'
      And a few torrent refreshes pass
      And the torrent program shows "ubuntu" as paused
      When the torrent window "A" asks to resume "ubuntu"
      Then the torrent window "A" is told the job is seeding

    Scenario: switching sharing on before the download ends changes only what happens at the end
      When the torrent window "A" adds "ubuntu"
      And the torrent program reads what is in "ubuntu"
      And the torrent window "A" changes "ubuntu" at revision 0 with '{"seedAfterComplete":true}'
      And the torrent program finishes "ubuntu"
      Then the torrent window "A" is pushed the state "seeding" for "ubuntu"

  Rule: Removing a job is asked for, and deleting files is asked about

    Scenario: a removed job leaves the program, its files stay
      When the torrent window "A" adds "ubuntu"
      And the torrent window "A" asks to remove "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.remove.result","result":{"ok":true,"jobId":"$job:ubuntu","deletedData":false}}'
      And the person was asked 1 torrent question
      And the torrent program no longer has "ubuntu"
      And the torrent program was not told to delete any files
      When the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" is refused with "job-not-found"

    Scenario: the person says no to deleting files, and the job stays
      When the torrent window "A" adds "ubuntu"
      And the person will say no to the torrent question
      And the torrent window "A" asks to remove "ubuntu" and delete its files
      Then the torrent window "A" gets back exactly '{"type":"torrent.remove.result","result":{"ok":false,"jobId":"$job:ubuntu","error":"user-denied"}}'
      And the torrent program still has "ubuntu"
      When the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" is told the job is metadata

    Scenario: a job removed while the person is still deciding about its files is not removed twice
      When the torrent window "A" adds "ubuntu"
      And the person is slow to answer the torrent question
      And the torrent window "A" asks to remove "ubuntu" and delete its files
      And the torrent window "A" asks to remove "ubuntu"
      And the person answers every torrent question with yes
      Then the torrent window "A" gets back '{"type":"torrent.remove.result","result":{"ok":false,"jobId":"$job:ubuntu","error":"job-not-found"}}'
      And the torrent window "A" has had 3 answers
      And the torrent program no longer has "ubuntu"
      And the torrent program was not told to delete any files

  Rule: Trouble is reported as trouble

    Scenario: a torrent the person removed in the program ends its job
      When the torrent window "A" adds "ubuntu" with '{"retention":"persistent"}'
      And the person removes "ubuntu" from the torrent program themselves
      Then the torrent window "A" is pushed '{"type":"torrent.error","error":"source-unavailable","reason":"Your torrent program no longer has this torrent."}' for "ubuntu"
      And the torrent window "A" is pushed the state "error" for "ubuntu"
      And the torrent service has stopped asking the torrent program
      When the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.status.result","error":"source-unavailable"}'
      When the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back '{"jobs":[{"jobId":"$job:ubuntu","state":"error"}]}'
      When the torrent window "A" asks to remove "ubuntu" and delete its files
      Then the torrent window "A" gets back '{"result":{"ok":true,"deletedData":false}}'
      And the torrent job storage holds 0 jobs

    Scenario: a problem the program reports is passed on without the program's own words
      When the torrent window "A" adds "ubuntu"
      And the torrent program reports a problem with "ubuntu"
      Then the torrent window "A" is pushed the state "error" for "ubuntu"
      And the torrent window "A" is pushed '{"type":"torrent.error","error":"network-error","reason":"Your torrent program reported a problem with this torrent."}' for "ubuntu"
      And the torrent window "A" has been pushed the error "network-error" for "ubuntu" 1 time
      And nothing the torrent service said mentions "hunter2"

    Scenario: a program that cannot be reached is said once, without its address or the sign-in
      When the torrent window "A" adds "ubuntu"
      And the torrent program stops answering
      Then the torrent window "A" is pushed '{"type":"torrent.error","error":"network-error","reason":"Your torrent program could not be reached."}' for "ubuntu"
      And the torrent window "A" has been pushed the error "network-error" for "ubuntu" 1 time
      When the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.status.result","error":"network-error"}'
      When the torrent window "A" adds "debian"
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"network-error","reason":"Your torrent program could not be reached."}}'
      When the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.jobs.result","error":"network-error"}'
      When the torrent program answers again
      And a few torrent refreshes pass
      And the torrent program stops answering
      Then the torrent window "A" has been pushed the error "network-error" for "ubuntu" 2 times
      And nothing the torrent service said mentions "hunter2"
      And nothing the torrent service said mentions "nas.local"
      When the torrent program answers again
      And the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" is shown 1 torrent job

    Scenario: a program that refuses the shell's sign-in is said in words
      Given the torrent program refuses kernl's sign-in
      When the torrent window "A" adds "ubuntu"
      Then the torrent window "A" is refused with "network-error"
      And the torrent window "A" is given the reason "Your torrent program refused kernl's sign-in."
      And nothing the torrent service said mentions "hunter2"

    Scenario: a torrent the program declines makes no job
      Given the torrent program declines every torrent
      When the torrent window "A" adds "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"invalid-source","reason":"Your torrent program declined the torrent."}}'
      When the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'

    Scenario: a program that cannot set limits leaves a limited torrent paused and makes no job
      Given the torrent program cannot change limits
      When the torrent window "A" adds "ubuntu" with '{"downloadLimitBytesPerSecond":5000}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.add.result","ack":{"ok":false,"error":"unsupported","reason":"Your torrent program cannot do that."}}'
      And the torrent program shows "ubuntu" as paused
      When the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back exactly '{"type":"torrent.jobs.result","jobs":[]}'

    Scenario: a job whose torrent the program lost between two requests is not found there
      When the torrent window "A" adds "ubuntu"
      And the person removes "ubuntu" from the torrent program themselves
      And the torrent window "A" asks to pause "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.pause.result","error":"job-not-found"}'

    Scenario: a job whose program was taken out of the settings says so, and can still be removed
      When the torrent window "A" adds "ubuntu" with '{"retention":"persistent"}'
      And the person takes the torrent program out of their settings
      Then the torrent window "A" is pushed '{"type":"torrent.error","error":"source-unavailable","reason":"That torrent program is no longer set up."}' for "ubuntu"
      And the torrent window "A" is pushed the state "error" for "ubuntu"
      When the torrent window "A" asks to status "ubuntu"
      Then the torrent window "A" gets back exactly '{"type":"torrent.status.result","error":"source-unavailable"}'
      When the torrent window "A" sends '{"type":"torrent.jobs"}'
      Then the torrent window "A" gets back '{"jobs":[{"jobId":"$job:ubuntu","state":"error"}]}'
      When the torrent window "A" asks to remove "ubuntu" and delete its files
      Then the torrent window "A" gets back exactly '{"type":"torrent.remove.result","result":{"ok":true,"jobId":"$job:ubuntu","deletedData":false}}'
      And the person was asked 1 torrent question
      And the torrent job storage holds 0 jobs

    Scenario Outline: a job whose program was taken out of the settings cannot be <operation>
      When the torrent window "A" adds "ubuntu"
      And the person takes the torrent program out of their settings
      And the torrent window "A" sends '<request>'
      Then the torrent window "A" gets back '<answer>'

      Examples:
        | operation          | request                                                                                                         | answer                                                                                   |
        | paused             | {"type":"torrent.pause","jobId":"$job:ubuntu"}                                                                  | {"error":"source-unavailable"}                                                           |
        | resumed            | {"type":"torrent.resume","jobId":"$job:ubuntu"}                                                                 | {"error":"source-unavailable"}                                                           |
        | listed by file     | {"type":"torrent.files","jobId":"$job:ubuntu"}                                                                  | {"error":"source-unavailable"}                                                           |
        | described          | {"type":"torrent.metadata","jobId":"$job:ubuntu"}                                                               | {"result":{"ok":false,"error":"source-unavailable","reason":"That torrent program is no longer set up."}} |
        | narrowed to a file | {"type":"torrent.selectFiles","jobId":"$job:ubuntu","selection":{"indexes":[0]}}                                | {"error":"source-unavailable"}                                                           |
        | changed            | {"type":"torrent.update","request":{"jobId":"$job:ubuntu","expectedRevision":0,"patch":{"uploadLimitBytesPerSecond":1}}} | {"result":{"ok":false,"error":"source-unavailable","reason":"That torrent program is no longer set up."}} |

  Rule: Every request gets exactly one answer, in the shape its type has

    Scenario Outline: a malformed <type> request is answered as invalid
      When the torrent window "A" sends '<request>'
      Then the torrent window "A" gets back exactly '<answer>'
      And the torrent window "A" has had 1 answer
      And the torrent program was never called

      Examples:
        | type        | request                                                              | answer                                                                                          |
        | add         | {"type":"torrent.add"}                                               | {"type":"torrent.add.result","ack":{"ok":false,"error":"invalid-request"}}                      |
        | add         | {"type":"torrent.add","request":"magnet:?xt=urn:btih:abc"}           | {"type":"torrent.add.result","ack":{"ok":false,"error":"invalid-request"}}                      |
        | add         | {"type":"torrent.add","request":{"options":{}}}                      | {"type":"torrent.add.result","ack":{"ok":false,"error":"invalid-request"}}                      |
        | add         | {"type":"torrent.add","request":{"source":{"sourceType":"magnet","magnet":"$magnet:ubuntu"},"jobId":""}} | {"type":"torrent.add.result","ack":{"ok":false,"error":"invalid-request"}}  |
        | add         | {"type":"torrent.add","request":{"source":{"sourceType":"magnet","magnet":"$magnet:ubuntu"},"options":[]}} | {"type":"torrent.add.result","ack":{"ok":false,"error":"invalid-request"}} |
        | status      | {"type":"torrent.status"}                                            | {"type":"torrent.status.result","error":"invalid-request"}                                      |
        | status      | {"type":"torrent.status","jobId":7}                                  | {"type":"torrent.status.result","error":"invalid-request"}                                      |
        | jobs        | {"type":"torrent.jobs","filter":{"states":["flying"]}}               | {"type":"torrent.jobs.result","error":"invalid-request"}                                        |
        | jobs        | {"type":"torrent.jobs","filter":{"modes":"download"}}                | {"type":"torrent.jobs.result","error":"invalid-request"}                                        |
        | files       | {"type":"torrent.files","jobId":null}                                | {"type":"torrent.files.result","error":"invalid-request"}                                       |
        | selectFiles | {"type":"torrent.selectFiles","jobId":"tor-1"}                       | {"type":"torrent.selectFiles.result","error":"invalid-request"}                                 |
        | pause       | {"type":"torrent.pause","jobId":["tor-1"]}                           | {"type":"torrent.pause.result","error":"invalid-request"}                                       |
        | resume      | {"type":"torrent.resume"}                                            | {"type":"torrent.resume.result","error":"invalid-request"}                                      |
        | remove      | {"type":"torrent.remove","jobId":7}                                  | {"type":"torrent.remove.result","result":{"ok":false,"jobId":"","error":"invalid-request"}}     |
        | remove      | {"type":"torrent.remove","jobId":"tor-1","options":{"deleteData":"yes"}} | {"type":"torrent.remove.result","result":{"ok":false,"jobId":"tor-1","error":"invalid-request"}} |
        | metadata    | {"type":"torrent.metadata","jobId":{}}                               | {"type":"torrent.metadata.result","result":{"ok":false,"error":"invalid-request"}}              |
        | cancel      | {"type":"torrent.cancel"}                                            | {"type":"torrent.cancel.result","result":{"ok":false,"error":"invalid-request"}}                |
        | update      | {"type":"torrent.update","request":null}                             | {"type":"torrent.update.result","result":{"ok":false,"error":"invalid-request"}}                |

    Scenario: a request with no id, or of no known type, gets no answer and does nothing
      When the torrent window "A" sends '{"type":"torrent.add","request":{"source":{"sourceType":"magnet","magnet":"$magnet:ubuntu"}}}' without an id
      And the torrent window "A" sends '{"type":"torrent.status","id":7,"jobId":"tor-1"}' without an id
      And the torrent window "A" sends '{"type":"torrent.constructor","id":"c-1"}' without an id
      And the torrent window "A" sends '{"type":"constructor","id":"c-2"}' without an id
      Then the torrent window "A" has had 0 answers
      And the person was asked 0 torrent questions
      And the torrent program was never called
