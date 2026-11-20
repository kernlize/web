Feature: NZBGet client
  kernl drives an NZBGet the person already runs through NZBGet's own remote
  interface. The adapter reports each job in the words every downloader shares,
  offers only what NZBGet can really do to a job in its present phase, and never
  takes NZBGet's "true" for an answer: a change counts once the job shows it.

  Rule: It says what it is talking to, and what it can do

    Scenario: a running NZBGet names its version
      Given an NZBGet that asks for the name "nzbget" and password "tegbzn6789"
      When the NZBGet client is asked what it is talking to
      Then the NZBGet client reports version "26.3"
      And every request to the NZBGet carried the login and asked it to close the connection

    Scenario: an NZBGet without a login is asked without one
      Given an NZBGet that asks for no login
      When the NZBGet client is asked what it is talking to
      Then the NZBGet client reports version "26.3"
      And no request to the NZBGet carried a login

    Scenario: a wrong password is refused, and is not repeated in the refusal
      Given an NZBGet that asks for the name "nzbget" and password "tegbzn6789"
      And the NZBGet client signs in as "nzbget" with "hunter2-wrong"
      When the NZBGet client is asked what it is talking to
      Then the NZBGet client refuses with "denied:credentials"
      And the NZBGet client's refusal never mentions "hunter2-wrong"

    Scenario: every job action is on offer for some job
      Given an NZBGet that asks for no login
      Then the NZBGet client offers the actions "pause, resume, cancel, retry, forget, delete"
      And the NZBGet client honours the add options "categoryId, priority, startPaused, password"

    Scenario: the categories are the ones NZBGet is set up with
      Given an NZBGet that asks for no login
      When the NZBGet client lists the categories
      Then the NZBGet client names the categories "Movies, Series, Music, Software"

    Scenario: settings that are not a named category are left out
      Given an NZBGet that asks for no login
      And the NZBGet has the settings:
        | Category1.Name    | Films  |
        | Category1.DestDir | /films |
        | Category2.Name    |        |
        | MainDir           | /data  |
      When the NZBGet client lists the categories
      Then the NZBGet client names the categories "Films"

  Rule: It cannot be reached, or does not answer like NZBGet

    Scenario: an NZBGet that is switched off cannot be reached
      Given an NZBGet that asks for no login
      And the NZBGet is switched off
      When the NZBGet client is asked what it is talking to
      Then the NZBGet client refuses with "unavailable:unreachable"

    Scenario: an NZBGet that takes too long is given up on
      Given an NZBGet that asks for no login
      And the NZBGet client waits 150 ms for an answer
      And the NZBGet never answers "version"
      When the NZBGet client is asked what it is talking to
      Then the NZBGet client refuses with "unavailable:timeout"

    Scenario Outline: an answer NZBGet would not give is not trusted
      Given an NZBGet that asks for no login
      And the NZBGet answers "<method>" with the body:
        """
        <body>
        """
      When the NZBGet client <asks>
      Then the NZBGet client refuses with "unavailable:bad-response"

      Examples:
        | method     | body                                     | asks                           |
        | version    | <html>503</html>                         | is asked what it is talking to |
        | version    | [1]                                      | is asked what it is talking to |
        | version    | {"version":"1.1","result":26}            | is asked what it is talking to |
        | config     | {"version":"1.1","result":"none"}        | lists the categories           |
        | listgroups | {"version":"1.1","result":"none"}        | lists the jobs                 |
        | listgroups | {"version":"1.1","result":[5]}           | lists the jobs                 |
        | listgroups | {"version":"1.1","result":[{"NZBID":"7"}]} | lists the jobs               |
        | history    | {"version":"1.1","result":[{"NZBID":0}]} | lists the jobs                 |

    Scenario: an error status is not read as an answer
      Given an NZBGet that asks for no login
      And the NZBGet answers "version" with status 500
      When the NZBGet client is asked what it is talking to
      Then the NZBGet client refuses with "unavailable:bad-response"

    Scenario: settings entries that are not settings are passed over
      Given an NZBGet that asks for no login
      And the NZBGet answers "config" with the result "[7, {\"Name\":\"Category1.Name\",\"Value\":\"Films\"}]"
      When the NZBGet client lists the categories
      Then the NZBGet client names the categories "Films"

  Rule: An NZB is handed over under a safe name, and the job NZBGet made is the answer

    Scenario: a plain NZB joins the queue
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB named "Example"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet was handed the file name "Example.nzb"
      And the NZBGet holds the job "Example" as:
        | Status      | QUEUED       |
        | Category    |              |
        | MaxPriority | 0            |
        | Parameters  | *Unpack:=yes |

    Scenario: category, priority, a hold and an archive password are all passed on
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB named "Example" with "held, priority high, category Movies, password s3cret"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet holds the job "Example" as:
        | Status      | PAUSED                               |
        | Category    | Movies                               |
        | MaxPriority | 50                                   |
        | Parameters  | *Unpack:Password=s3cret *Unpack:=yes |

    Scenario: a low priority and an explicit release are passed on
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB named "Example" with "released, priority low"
      Then the NZBGet holds the job "Example" as:
        | Status      | QUEUED |
        | MaxPriority | -50    |

    Scenario Outline: a name never carries a path
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB named "<name>"
      Then the NZBGet was handed the file name "<file name>"

      Examples:
        | name                        | file name           |
        | ../../etc/My Show.nzb       | etc My Show.nzb     |
        | C:\\Windows\\evil           | C Windows evil.nzb  |
        | ..                          | download.nzb        |
        | a<b>c:d\|e?f*g              | a b c d e f g.nzb   |
        | .hidden.NZB.                | hidden.nzb          |

    Scenario: a name never carries control characters
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB whose name holds a tab and a line break
      Then the NZBGet was handed the file name "tabs and lines.nzb"

    Scenario: a very long name is cut short
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB named "0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789"
      Then the NZBGet was handed the file name "0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456789 0123456.nzb"

    Scenario: a large NZB arrives whole
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB of 100000 bytes named "Large"
      Then the NZBGet client answers with the job "Large"
      And the NZBGet was handed 100000 bytes

    Scenario Outline: a password NZBGet would store wrongly is not sent
      # NZBGet keeps the backslashes of an escaped parameter value, so it would unpack with a different password.
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB named "Example" with a password holding a <character>
      Then the NZBGet client refuses with "unavailable:unsupported"
      And the NZBGet was handed nothing
      And the NZBGet client's refusal never mentions "s3cret"

      Examples:
        | character |
        | quote     |
        | backslash |
        | tab       |

    Scenario: a document NZBGet has already been given becomes a skipped job
      Given an NZBGet that asks for no login
      When the NZBGet client adds an NZB named "Example"
      And the NZBGet client adds an NZB named "Example"
      And the NZBGet client lists the jobs
      Then the NZBGet client shows the jobs:
        | name    | state   | actions      |
        | Example | queued  | pause cancel |
        | Example | skipped | delete       |

    Scenario: a document that is not an NZB becomes a failed job
      Given an NZBGet that asks for no login
      When the NZBGet client adds something that is not an NZB, named "Broken"
      Then the NZBGet client answers with the job "Broken"
      When the NZBGet client looks up the job "Broken"
      Then the NZBGet client describes the job as:
        | state   | failed                    |
        | message | The NZB could not be read |

    Scenario: an NZBGet that cannot store the document declines it
      Given an NZBGet that asks for no login
      And the NZBGet cannot write to its disk
      When the NZBGet client adds an NZB named "Example"
      Then the NZBGet client refuses with "unavailable:rejected"

    Scenario Outline: a submission whose answer is lost may still have been taken
      Given an NZBGet that asks for no login
      And the NZBGet client waits 150 ms for an answer
      And <failure>
      When the NZBGet client adds an NZB named "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

      Examples:
        | failure                                                |
        | the NZBGet hangs up on "append"                        |
        | the NZBGet never answers "append"                      |
        | the NZBGet answers "append" with status 500            |
        | the NZBGet answers "append" with the result "\"yes\"" |

    Scenario: an NZBGet that does not know the request says so
      Given an NZBGet that asks for no login
      And the NZBGet answers "append" with the body:
        """
        {"version":"1.1","error":{"name":"JSONRPCError","code":2,"message":"Invalid parameter (DupeMode)"}}
        """
      When the NZBGet client adds an NZB named "Example"
      Then the NZBGet client refuses with "unavailable:unsupported"

  Rule: Queue and history are one list, each job once, in the shared words for its phase

    Scenario Outline: a job in the queue is reported by what NZBGet is doing with it
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its queue with:
        | Status          | <status>    |
        | RemainingSizeLo | <remaining> |
        | PausedSizeLo    | <held>      |
      When the NZBGet client looks up the job "Example"
      Then the NZBGet client describes the job as:
        | state   | <state>   |
        | stage   | <stage>   |
        | paused  | <paused>  |
        | actions | <actions> |

      Examples:
        | status                 | remaining | held | state       | stage              | paused | actions       |
        | QUEUED                 | 8         | 0    | queued      | absent             | false  | pause cancel  |
        | PAUSED                 | 8         | 8    | paused      | absent             | true   | resume cancel |
        | DOWNLOADING            | 4         | 0    | downloading | absent             | false  | pause cancel  |
        | DOWNLOADING            | 4         | 4    | downloading | absent             | true   | resume cancel |
        | DOWNLOADING            | 8         | 4    | downloading | absent             | false  | pause cancel  |
        | PP_QUEUED              | 0         | 0    | processing  | Waiting to process | absent | nothing       |
        | QS_QUEUED              | 0         | 0    | processing  | Waiting to process | absent | nothing       |
        | QS_EXECUTING           | 0         | 0    | processing  | Running a script   | absent | nothing       |
        | LOADING_PARS           | 0         | 0    | processing  | Checking           | absent | nothing       |
        | VERIFYING_SOURCES      | 0         | 0    | processing  | Verifying          | absent | nothing       |
        | REPAIRING              | 0         | 0    | processing  | Repairing          | absent | nothing       |
        | VERIFYING_REPAIRED     | 0         | 0    | processing  | Verifying          | absent | nothing       |
        | RENAMING               | 0         | 0    | processing  | Renaming           | absent | nothing       |
        | POST_UNPACK_RENAMING   | 0         | 0    | processing  | Renaming           | absent | nothing       |
        | POST_DOWNLOAD_RENAMING | 0         | 0    | processing  | Renaming           | absent | nothing       |
        | UNPACKING              | 0         | 0    | processing  | Unpacking          | absent | nothing       |
        | MOVING                 | 0         | 0    | processing  | Moving             | absent | nothing       |
        | EXECUTING_SCRIPT       | 0         | 0    | processing  | Running a script   | absent | nothing       |
        | PP_FINISHED            | 0         | 0    | processing  | Finishing          | absent | nothing       |
        | SOMETHING_NEW          | 8         | 0    | unknown     | absent             | absent | nothing       |

    Scenario: sizes, progress and category come from NZBGet's own figures
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Big One" in its queue with:
        | Status           | DOWNLOADING |
        | Category         | Movies      |
        | FileSizeLo       | 0           |
        | FileSizeHi       | 2           |
        | RemainingSizeLo  | 0           |
        | RemainingSizeHi  | 1           |
        | DownloadedSizeLo | -294967296  |
        | DownloadedSizeHi | 0           |
      When the NZBGet client looks up the job "Big One"
      Then the NZBGet client describes the job as:
        | name            | Big One     |
        | state           | downloading |
        | category        | Movies      |
        | totalBytes      | 8589934592  |
        | downloadedBytes | 4000000000  |
        | progress        | 0.5         |
        | downloadRate    | absent      |

    Scenario: a job NZBGet says little about is still listed, without invented figures
      Given an NZBGet that asks for no login
      And the NZBGet answers "listgroups" with the result "[{\"NZBID\":7,\"Kind\":\"NZB\",\"Status\":\"QUEUED\"}]"
      When the NZBGet client lists the jobs
      Then the NZBGet client shows the jobs:
        | name | state  | actions      |
        |      | queued | pause cancel |

    Scenario: an NZB still being fetched from an address is waiting, and is left alone
      Given an NZBGet that asks for no login
      And the NZBGet has the job "From A Link" in its queue with:
        | Status | FETCHING |
        | Kind   | URL      |
      When the NZBGet client looks up the job "From A Link"
      Then the NZBGet client describes the job as:
        | state   | queued           |
        | stage   | Fetching the NZB |
        | paused  | absent           |
        | actions | nothing          |

    Scenario Outline: a job in the history is reported by how NZBGet says it ended
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "<status>"
      When the NZBGet client looks up the job "Example"
      Then the NZBGet client describes the job as:
        | state   | <state>   |
        | message | <message> |
        | paused  | absent    |
        | actions | <actions> |

      Examples:
        | status             | state     | message                                                                 | actions      |
        | SUCCESS/ALL        | completed | absent                                                                  | forget       |
        | SUCCESS/HEALTH     | completed | absent                                                                  | forget       |
        | SUCCESS/MARK       | completed | absent                                                                  | forget       |
        | WARNING/SCRIPT     | failed    | A processing script failed                                              | retry forget |
        | WARNING/SPACE      | failed    | There was not enough room to unpack                                     | retry forget |
        | WARNING/PASSWORD   | failed    | The archive needs a password, or the one given is wrong                 | retry delete |
        | WARNING/DAMAGED    | failed    | The download is damaged and repair is switched off                      | retry forget |
        | WARNING/REPAIRABLE | failed    | The download is damaged; it can be repaired, but repair is switched off | retry forget |
        | WARNING/HEALTH     | failed    | Some articles were missing                                              | retry forget |
        | FAILURE/PAR        | failed    | Repair failed                                                           | retry delete |
        | FAILURE/UNPACK     | failed    | Unpacking failed                                                        | retry delete |
        | FAILURE/MOVE       | failed    | The files could not be moved into place                                 | retry forget |
        | FAILURE/SCAN       | failed    | The NZB could not be read                                               | retry delete |
        | FAILURE/BAD        | failed    | Marked as bad                                                           | retry delete |
        | FAILURE/HEALTH     | failed    | Too many articles were missing                                          | retry delete |
        | DELETED/MANUAL     | cancelled | absent                                                                  | retry delete |
        | DELETED/DUPE       | skipped   | Left out as a duplicate                                                 | delete       |
        | DELETED/COPY       | skipped   | Left out: the same NZB was already added                                | delete       |
        | DELETED/GOOD       | skipped   | Left out: a good copy already exists                                    | delete       |
        | PUZZLING/NEW       | unknown   | absent                                                                  | nothing      |
        | constructor        | unknown   | absent                                                                  | nothing      |

    Scenario: being in the history, fully downloaded, is not the same as completed
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history with:
        | Status           | FAILURE/UNPACK |
        | DownloadedSizeLo | 8              |
        | UnpackStatus     | FAILURE        |
      When the NZBGet client looks up the job "Example"
      Then the NZBGet client describes the job as:
        | state           | failed |
        | downloadedBytes | 8      |
        | totalBytes      | 8      |
        | progress        | absent |

    Scenario: a history entry that is not an NZB job offers nothing
      Given an NZBGet that asks for no login
      And the NZBGet has the job "From A Link" in its history with:
        | Status | FAILURE/FETCH |
        | Kind   | URL           |
      When the NZBGet client looks up the job "From A Link"
      Then the NZBGet client describes the job as:
        | state   | failed                       |
        | message | The NZB could not be fetched |
        | actions | nothing                      |

    Scenario: a history entry without its status fields is never offered as a mere forget
      Given an NZBGet that asks for no login
      And the NZBGet answers "history" with the result "[{\"NZBID\":3,\"NZBName\":\"Old\",\"Kind\":\"NZB\",\"Status\":\"SUCCESS/ALL\"}]"
      When the NZBGet client lists the jobs
      Then the NZBGet client shows the jobs:
        | name | state     | actions |
        | Old  | completed | delete  |

    Scenario: a job caught moving from the queue to the history is listed once, as it ended
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Other" held in its queue
      And the NZBGet lists the job "Example" in its queue and in its history as "SUCCESS/ALL"
      When the NZBGet client lists the jobs
      Then the NZBGet client shows the jobs:
        | name    | state     | actions       |
        | Other   | paused    | resume cancel |
        | Example | completed | forget        |

    Scenario: a job NZBGet does not have is simply not found
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" waiting in its queue
      When the NZBGet client looks up a job the downloader never had
      Then the NZBGet client finds no such job

    Scenario: failing to read the history is a failure, not an empty list
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" waiting in its queue
      And the NZBGet hangs up on "history"
      When the NZBGet client lists the jobs
      Then the NZBGet client refuses with "unavailable:unreachable"

  Rule: Pause and resume set and clear one job's own hold

    Scenario: a waiting job is held
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" waiting in its queue
      When the NZBGet client is asked to pause the job "Example"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet was asked to "GroupPause"
      And the NZBGet holds the job "Example" as:
        | Status | PAUSED |

    Scenario: a held job is released
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" held in its queue
      When the NZBGet client is asked to resume the job "Example"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet was asked to "GroupResume"
      And the NZBGet holds the job "Example" as:
        | Status | QUEUED |

    Scenario Outline: a hold that is already as asked needs nothing sent
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" <placed> in its queue
      When the NZBGet client is asked to <action> the job "Example"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet was not asked to change anything

      Examples:
        | placed  | action |
        | held    | pause  |
        | waiting | resume |

    Scenario: NZBGet saying yes without holding the job is not taken as done
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" waiting in its queue
      And the NZBGet answers "GroupPause" without doing it
      When the NZBGet client is asked to pause the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

    Scenario Outline: a job that is being processed, or has ended, cannot be held or released
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Working" in its queue with:
        | Status | UNPACKING |
      And the NZBGet has the job "Ended" in its history as "SUCCESS/ALL"
      When the NZBGet client is asked to <action> the job "<job>"
      Then the NZBGet client refuses with "invalid:state"
      And the NZBGet was not asked to change anything

      Examples:
        | action | job     |
        | pause  | Working |
        | resume | Working |
        | cancel | Working |
        | pause  | Ended   |
        | resume | Ended   |
        | cancel | Ended   |
        | retry  | Ended   |
        | delete | Ended   |

    Scenario: a job NZBGet does not have cannot be changed
      Given an NZBGet that asks for no login
      When the NZBGet client is asked to pause a job the downloader never had
      Then the NZBGet client refuses with "unavailable:not-found"
      And the NZBGet was not asked to change anything

    Scenario Outline: a change whose answer is lost may still have been made
      Given an NZBGet that asks for no login
      And the NZBGet client waits 150 ms for an answer
      And the NZBGet has the job "Example" waiting in its queue
      And the NZBGet <fails> "editqueue"
      When the NZBGet client is asked to pause the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

      Examples:
        | fails         |
        | hangs up on   |
        | never answers |

  Rule: Cancel stops a job, keeps what it downloaded, and leaves a record

    Scenario: a job in the queue is parked in the history as cancelled
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" held in its queue
      And the NZBGet still has the directory of the job "Example"
      When the NZBGet client is asked to cancel the job "Example"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet was asked to "GroupParkDelete"
      And the NZBGet still has the files of the job "Example"
      When the NZBGet client looks up the job "Example"
      Then the NZBGet client describes the job as:
        | state   | cancelled    |
        | actions | retry delete |

    Scenario: a job whose last articles are still arriving is waited for
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" waiting in its queue
      And the NZBGet needs 2 looks to let go of a removed job
      When the NZBGet client is asked to cancel the job "Example"
      Then the NZBGet client answers with the job "Example"

    Scenario: a job that never leaves the queue is not called cancelled
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" waiting in its queue
      And the NZBGet needs 9 looks to let go of a removed job
      When the NZBGet client is asked to cancel the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

    Scenario: an NZBGet that keeps no history leaves no record to confirm
      Given an NZBGet that asks for no login
      And the NZBGet keeps no history
      And the NZBGet has the job "Example" waiting in its queue
      When the NZBGet client is asked to cancel the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

    Scenario: an NZBGet too old to park a job cannot cancel, and changes nothing
      Given an NZBGet that asks for no login
      And the NZBGet is too old to park a job
      And the NZBGet has the job "Example" waiting in its queue
      When the NZBGet client is asked to cancel the job "Example"
      Then the NZBGet client refuses with "unavailable:unsupported"
      And the NZBGet holds the job "Example" as:
        | Status | QUEUED |

    Scenario: losing sight of the job after the change is not a success
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" waiting in its queue
      And the NZBGet hangs up on "listgroups" the second time it is asked
      When the NZBGet client is asked to cancel the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

  Rule: Retry starts a failed or cancelled job again under the same id

    Scenario: a failed job whose files are still there is taken back as it is
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "FAILURE/HEALTH"
      And the NZBGet still has the directory of the job "Example"
      When the NZBGet client is asked to retry the job "Example"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet was asked to "HistoryRetryFailed"
      And the NZBGet still has the files of the job "Example"
      When the NZBGet client looks up the job "Example"
      Then the NZBGet client describes the job as:
        | state | queued |

    Scenario: a cancelled job with nothing on disk is downloaded again
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "DELETED/MANUAL"
      When the NZBGet client is asked to retry the job "Example"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet was asked to "HistoryRetryFailed, HistoryRedownload"
      When the NZBGet client looks up the job "Example"
      Then the NZBGet client describes the job as:
        | state | queued |

    Scenario: a job that fails again before anyone can look was still taken back
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "FAILURE/HEALTH"
      And the NZBGet still has the directory of the job "Example"
      And the NZBGet job fails again at once when it is taken back
      When the NZBGet client is asked to retry the job "Example"
      Then the NZBGet client answers with the job "Example"
      And the NZBGet was asked to "HistoryRetryFailed"

    Scenario: a job NZBGet cannot start again is declined, unchanged
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "FAILURE/SCAN"
      And the NZBGet no longer has the NZB of the job "Example"
      When the NZBGet client is asked to retry the job "Example"
      Then the NZBGet client refuses with "unavailable:rejected"
      When the NZBGet client looks up the job "Example"
      Then the NZBGet client describes the job as:
        | state | failed |

    Scenario: a job that vanishes during the retry is not called retried
      Given an NZBGet that asks for no login
      And the NZBGet keeps no history
      And the NZBGet has the job "Example" in its history as "FAILURE/HEALTH"
      And the NZBGet still has the directory of the job "Example"
      And the NZBGet job fails again at once when it is taken back
      When the NZBGet client is asked to retry the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

  Rule: Forget drops the record of a job whose files NZBGet keeps; delete is for a job whose files go with it

    Scenario: a completed job is forgotten and its output stays
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "SUCCESS/ALL"
      And the NZBGet still has the directory of the job "Example"
      When the NZBGet client is asked to forget the job "Example"
      Then the NZBGet client answers with the job id "1"
      And the NZBGet was asked to "HistoryDelete"
      And the NZBGet has no job "Example"
      When the NZBGet client looks up a job by the id "1"
      Then the NZBGet client finds no such job

    Scenario: a failed job is deleted together with what it downloaded
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "FAILURE/PAR"
      And the NZBGet still has the directory of the job "Example"
      When the NZBGet client is asked to delete the job "Example"
      Then the NZBGet client answers with the job id "1"
      And the NZBGet has no job "Example"
      And the NZBGet has deleted the files it had for job 1

    Scenario: a failed job cannot be merely forgotten, because NZBGet would delete its files
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "FAILURE/PAR"
      When the NZBGet client is asked to forget the job "Example"
      Then the NZBGet client refuses with "invalid:state"
      And the NZBGet was not asked to change anything

    Scenario: a deletion NZBGet could not finish is not called done
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "FAILURE/PAR"
      And the NZBGet cannot delete the directory of the job "Example"
      When the NZBGet client is asked to delete the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

    Scenario Outline: a deletion whose aftermath cannot be read is not called done
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "FAILURE/PAR"
      And <failure>
      When the NZBGet client is asked to delete the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"

      Examples:
        | failure                                              |
        | the NZBGet hangs up on "log"                         |
        | the NZBGet answers "log" with the result "\"none\"" |

    Scenario: log lines about other things do not spoil a deletion
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "FAILURE/PAR"
      And the NZBGet answers "log" with the result "[3, {\"Kind\":\"ERROR\",\"Text\":\"Could not delete directory /downloads/intermediate/Other.#9: Permission denied\"}]"
      When the NZBGet client is asked to delete the job "Example"
      Then the NZBGet client answers with the job id "1"

    Scenario: a record NZBGet keeps despite saying yes is not called forgotten
      Given an NZBGet that asks for no login
      And the NZBGet has the job "Example" in its history as "SUCCESS/ALL"
      And the NZBGet answers "HistoryDelete" without doing it
      When the NZBGet client is asked to forget the job "Example"
      Then the NZBGet client refuses with "unavailable:outcome-unknown"
