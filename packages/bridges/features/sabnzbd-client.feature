Feature: SABnzbd client
  kernl drives a SABnzbd the person already runs through SABnzbd's own remote
  interface. The adapter reports each job in the words every downloader shares,
  offers only what SABnzbd can really do to a job in its present phase, and never
  takes SABnzbd's "true" for an answer: a change counts once the job shows it.

  Rule: It says what it is talking to, and what it can do

    Scenario: a running SABnzbd names its version, and the key never travels in an address
      Given a SABnzbd that asks for the key "24e32bb1fe4c4d99b6c7bef5c3c62ef8"
      When the SABnzbd client is asked what it is talking to
      Then the SABnzbd client reports version "5.1.3"
      And every request to the SABnzbd was a POST with nothing in its address

    Scenario: a SABnzbd without a key is asked without one
      Given a SABnzbd that asks for no key
      When the SABnzbd client is asked what it is talking to
      Then the SABnzbd client reports version "5.1.3"
      And no request to the SABnzbd carried a key

    Scenario: a wrong key is refused, and is not repeated in the refusal
      Given a SABnzbd that asks for the key "24e32bb1fe4c4d99b6c7bef5c3c62ef8"
      And the SABnzbd client uses the key "not-the-key"
      When the SABnzbd client is asked what it is talking to
      Then the SABnzbd client refuses with "denied:credentials"
      And the SABnzbd client's refusal never mentions "not-the-key"

    Scenario: a missing key is refused
      Given a SABnzbd that asks for the key "24e32bb1fe4c4d99b6c7bef5c3c62ef8"
      And the SABnzbd client has no key
      When the SABnzbd client is asked what it is talking to
      Then the SABnzbd client refuses with "denied:credentials"

    Scenario Outline: an older SABnzbd's way of refusing a key is understood too
      Given a SABnzbd that asks for the key "24e32bb1fe4c4d99b6c7bef5c3c62ef8"
      And the SABnzbd is old enough to answer a wrong key with status 200 as <form>
      And the SABnzbd client uses the key "not-the-key"
      When the SABnzbd client is asked what it is talking to
      Then the SABnzbd client refuses with "denied:credentials"

      Examples:
        | form |
        | text |
        | JSON |

    Scenario: cancel is not on offer, because SABnzbd cannot stop a job and keep a record of it
      Given a SABnzbd that asks for no key
      Then the SABnzbd client offers the actions "pause, resume, retry, forget, delete"
      And the SABnzbd client honours the add options "categoryId, priority, startPaused, password"

    Scenario: the categories are the ones SABnzbd is set up with, without its catch-all
      Given a SABnzbd that asks for no key
      When the SABnzbd client lists the categories
      Then the SABnzbd client names the categories "movies, tv, audio, software"

    Scenario: category entries that are not names are passed over
      Given a SABnzbd that asks for no key
      And the SABnzbd answers "get_cats" with the body:
        """
        {"categories":["*", 7, "", "None", "films"]}
        """
      When the SABnzbd client lists the categories
      Then the SABnzbd client names the categories "films"

  Rule: It cannot be reached, or does not answer like SABnzbd

    Scenario: a SABnzbd that is switched off cannot be reached
      Given a SABnzbd that asks for no key
      And the SABnzbd is switched off
      When the SABnzbd client is asked what it is talking to
      Then the SABnzbd client refuses with "unavailable:unreachable"

    Scenario: a SABnzbd that takes too long is given up on
      Given a SABnzbd that asks for no key
      And the SABnzbd client waits 150 ms for an answer
      And the SABnzbd never answers "queue"
      When the SABnzbd client is asked what it is talking to
      Then the SABnzbd client refuses with "unavailable:timeout"

    Scenario Outline: an answer SABnzbd would not give is not trusted
      Given a SABnzbd that asks for no key
      And the SABnzbd answers "<request>" with the body:
        """
        <body>
        """
      When the SABnzbd client <asks>
      Then the SABnzbd client refuses with "unavailable:bad-response"

      Examples:
        | request  | body                                      | asks                           |
        | queue    | <html>503</html>                          | is asked what it is talking to |
        | queue    | [1]                                       | is asked what it is talking to |
        | queue    | {"queue":"none"}                          | is asked what it is talking to |
        | queue    | {"queue":{"slots":[]}}                    | is asked what it is talking to |
        | get_cats | {"categories":"none"}                     | lists the categories           |
        | queue    | {"queue":{"slots":"none"}}                | lists the jobs                 |
        | queue    | {"queue":{"slots":[5]}}                   | lists the jobs                 |
        | history  | {"history":{"slots":[{"nzo_id":7}]}}      | lists the jobs                 |
        | history  | {"status":false,"error":"not implemented"} | lists the jobs                |

    Scenario: an error status is not read as an answer
      Given a SABnzbd that asks for no key
      And the SABnzbd answers "queue" with status 500
      When the SABnzbd client is asked what it is talking to
      Then the SABnzbd client refuses with "unavailable:bad-response"

  Rule: An NZB is handed over under a safe name, and the job SABnzbd made is the answer

    Scenario: a plain NZB joins the queue, with SABnzbd's own defaults
      Given a SABnzbd that asks for no key
      When the SABnzbd client adds an NZB named "Example"
      Then the SABnzbd client answers with the job "Example"
      And the SABnzbd was handed the file "Example.nzb" under the job name "Example"
      And the SABnzbd was handed no options

    Scenario: category, priority and an archive password are passed on
      Given a SABnzbd that asks for the key "24e32bb1fe4c4d99b6c7bef5c3c62ef8"
      When the SABnzbd client adds an NZB named "Example" with "priority high, category movies, password s3 \"c}r;et"
      Then the SABnzbd client answers with the job "Example"
      And the SABnzbd holds the job "Example" as:
        | status   | Queued      |
        | cat      | movies      |
        | priority | High        |
        | password | s3 "c}r;et  |

    Scenario Outline: a hold is asked for in the one way that sets it before anything is fetched
      Given a SABnzbd that asks for no key
      When the SABnzbd client adds an NZB named "Example" with "<options>"
      Then the SABnzbd client answers with the job "Example"
      And the SABnzbd was handed the fields:
        | priority | <priority> |

      Examples:
        | options                 | priority |
        | held                    | -2       |
        | held, priority normal   | -2       |
        | released, priority low  | -1       |
        | priority normal         | 0        |

    Scenario Outline: a hold together with a priority of its own is not something SABnzbd can do at once
      # The hold is itself a priority value, and setting a priority afterwards releases the job.
      Given a SABnzbd that asks for no key
      When the SABnzbd client adds an NZB named "Example" with "held, priority <priority>"
      Then the SABnzbd client refuses with "unavailable:unsupported"
      And the SABnzbd was handed nothing

      Examples:
        | priority |
        | high     |
        | low      |

    Scenario Outline: a name never carries a path, or a password of its own
      Given a SABnzbd that asks for no key
      When the SABnzbd client adds an NZB named "<name>"
      Then the SABnzbd was handed the file "<stem>.nzb" under the job name "<stem>"

      Examples:
        | name                  | stem        |
        | ../../etc/My Show.nzb | etc My Show |
        | Show {{hunter2}}      | Show hunter2 |
        | Show / hunter2        | Show hunter2 |
        | ..                    | download    |

    Scenario: a large NZB arrives whole
      Given a SABnzbd that asks for no key
      When the SABnzbd client adds an NZB of 100000 bytes named "Large"
      Then the SABnzbd client answers with the job "Large"
      And the SABnzbd was handed 100000 bytes

    Scenario: a document SABnzbd cannot read is declined
      Given a SABnzbd that asks for no key
      When the SABnzbd client adds something that is not an NZB, named "Broken"
      Then the SABnzbd client refuses with "unavailable:rejected"
      And the SABnzbd has no job "Broken"

    Scenario Outline: a submission whose answer is lost or says too little may still have been taken
      Given a SABnzbd that asks for no key
      And the SABnzbd client waits 150 ms for an answer
      And <failure>
      When the SABnzbd client adds an NZB named "Example"
      Then the SABnzbd client refuses with "unavailable:outcome-unknown"

      Examples:
        | failure                                       |
        | the SABnzbd hangs up on "addfile"             |
        | the SABnzbd never answers "addfile"           |
        | the SABnzbd answers "addfile" with status 500 |

    Scenario Outline: a yes that does not name the new job is not a job
      Given a SABnzbd that asks for no key
      And the SABnzbd answers "addfile" with the body:
        """
        <body>
        """
      When the SABnzbd client adds an NZB named "Example"
      Then the SABnzbd client refuses with "unavailable:outcome-unknown"

      Examples:
        | body                            |
        | {"status":true}                 |
        | {"status":true,"nzo_ids":[]}    |
        | {"status":true,"nzo_ids":[7]}   |
        | {"status":true,"nzo_ids":[""]}  |

  Rule: Queue and history are one list, each job once, in the shared words for its phase

    Scenario Outline: a job in the queue is reported by what SABnzbd is doing with it
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its queue with:
        | status | <status> |
      When the SABnzbd client looks up the job "Example"
      Then the SABnzbd client describes the job as:
        | state   | <state>   |
        | stage   | <stage>   |
        | paused  | <paused>  |
        | actions | <actions> |

      Examples:
        | status      | state   | stage                              | paused | actions |
        | Queued      | queued  | absent                             | false  | pause   |
        | Paused      | paused  | absent                             | true   | resume  |
        | Fetching    | queued  | Fetching repair data               | false  | pause   |
        | Propagating | queued  | Waiting for the articles to spread | false  | pause   |
        | Checking    | queued  | Checking                           | false  | pause   |
        | Grabbing    | queued  | Fetching the NZB                   | absent | nothing |
        | Dancing     | unknown | absent                             | absent | nothing |

    Scenario: SABnzbd's "Downloading" means downloading only for the job at the front while articles arrive
      Given a SABnzbd that asks for no key
      And the SABnzbd is transferring
      And the SABnzbd has the job "Held" held in its queue
      And the SABnzbd has the job "First" waiting in its queue
      And the SABnzbd has the job "Second" waiting in its queue
      When the SABnzbd client lists the jobs
      Then the SABnzbd client shows the jobs:
        | name   | state       | actions |
        | Held   | paused      | resume  |
        | First  | downloading | pause   |
        | Second | queued      | pause   |

    Scenario: nothing is downloading while no articles arrive
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "First" waiting in its queue
      When the SABnzbd client lists the jobs
      Then the SABnzbd client shows the jobs:
        | name  | state  | actions |
        | First | queued | pause   |

    Scenario: a SABnzbd paused as a whole leaves each job's own hold as it was
      Given a SABnzbd that asks for no key
      And the SABnzbd is paused as a whole
      And the SABnzbd has the job "Held" held in its queue
      And the SABnzbd has the job "Free" waiting in its queue
      When the SABnzbd client lists the jobs
      Then the SABnzbd client shows the jobs:
        | name | state  | actions |
        | Held | paused | resume  |
        | Free | queued | pause   |

    Scenario: sizes, progress and category come from SABnzbd's own figures
      Given a SABnzbd that asks for no key
      And the SABnzbd is transferring
      And the SABnzbd has the job "Big One" in its queue with:
        | mb       | 2048.00  |
        | mbleft   | 512.00   |
        | cat      | movies   |
        | password | hunter2  |
      When the SABnzbd client looks up the job "Big One"
      Then the SABnzbd client describes the job as:
        | name            | Big One     |
        | state           | downloading |
        | category        | movies      |
        | totalBytes      | 2147483648  |
        | downloadedBytes | 1610612736  |
        | progress        | 0.75        |
        | downloadRate    | absent      |
        | password        | absent      |

    Scenario Outline: figures SABnzbd leaves out or garbles are not invented
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its queue with:
        | mb     | <mb>     |
        | mbleft | <mbleft> |
        | cat    | <cat>    |
      When the SABnzbd client looks up the job "Example"
      Then the SABnzbd client describes the job as:
        | totalBytes      | <total>      |
        | downloadedBytes | <downloaded> |
        | progress        | <progress>   |
        | category        | absent       |

      Examples:
        | mb     | mbleft | cat  | total   | downloaded | progress |
        | 0.00   | 0.00   | *    | absent  | 0          | absent   |
        | lots   | some   | None | absent  | 0          | absent   |
        | 1.00   | 3.00   | *    | 1048576 | 0          | 0        |
        | 1.00   | -2     | *    | 1048576 | 1048576    | 1        |

    Scenario Outline: a job in the history is reported by how far SABnzbd has got with it
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its history as "<status>"
      When the SABnzbd client looks up the job "Example"
      Then the SABnzbd client describes the job as:
        | state   | <state>   |
        | stage   | <stage>   |
        | paused  | absent    |
        | actions | <actions> |

      Examples:
        | status     | state      | stage                | actions |
        | Completed  | completed  | absent               | forget  |
        | Failed     | failed     | absent               | forget  |
        | Queued     | processing | Waiting to process   | nothing |
        | QuickCheck | processing | Checking             | nothing |
        | Verifying  | processing | Verifying            | nothing |
        | Repairing  | processing | Repairing            | nothing |
        | Fetching   | processing | Fetching repair data | nothing |
        | Extracting | processing | Unpacking            | nothing |
        | Moving     | processing | Moving               | nothing |
        | Running    | processing | Running a script     | nothing |
        | Puzzling   | unknown    | absent               | nothing |
        | constructor | unknown   | absent               | nothing |

    Scenario: a failed job says why, without SABnzbd's links or folders
      Given a SABnzbd that asks for no key
      And the SABnzbd has the failed job "Example" with its partial files
      When the SABnzbd client looks up the job "Example"
      Then the SABnzbd client describes the job as:
        | state           | failed                                  |
        | message         | Download failed - Not on your server(s) |
        | downloadedBytes | 0                                       |
        | totalBytes      | absent                                  |
        | actions         | retry forget delete                     |
        | storage         | absent                                  |

    Scenario Outline: what SABnzbd says about a failure is cleaned before it is passed on
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its history with:
        | status       | Failed    |
        | category     | tv        |
        | bytes        | 4096      |
        | fail_message | <message> |
        | retry        | <retry>   |
      When the SABnzbd client looks up the job "Example"
      Then the SABnzbd client describes the job as:
        | message         | <passed on> |
        | category        | tv          |
        | downloadedBytes | 4096        |
        | actions         | <actions>   |

      Examples:
        | message                                                         | retry | passed on                                   | actions             |
        | Unpacking failed, write error or disk is full? /data/incomplete/x | 1   | Unpacking failed, write error or disk is full? | retry forget delete |
        | Repair failed, see <a href="https://example.org/why">why</a>    | false | Repair failed, see why                      | forget              |
        | https://sabnzbd.org/not-complete                                | 0     | absent                                      | forget              |
        | Could not move to C:\\Users\\me\\Downloads                      | true  | Could not move to                           | retry forget delete |

    Scenario: a completed job stays completed only because SABnzbd says so
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its history with:
        | status       | Completed    |
        | fail_message | An old worry |
      When the SABnzbd client looks up the job "Example"
      Then the SABnzbd client describes the job as:
        | state   | completed |
        | message | absent    |

    Scenario: a job caught moving from the queue to the history is listed once, as it ended
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Other" held in its queue
      And the SABnzbd lists the job "Example" in its queue and in its history as "Completed"
      When the SABnzbd client lists the jobs
      Then the SABnzbd client shows the jobs:
        | name    | state     | actions |
        | Other   | paused    | resume  |
        | Example | completed | forget  |

    Scenario: a long history is read to its end
      Given a SABnzbd that asks for no key
      And the SABnzbd has 205 completed jobs in its history
      And the SABnzbd has the job "First" waiting in its queue
      When the SABnzbd client lists the jobs
      Then the SABnzbd client shows 206 jobs

    Scenario: a job SABnzbd does not have is simply not found
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" waiting in its queue
      When the SABnzbd client looks up a job the downloader never had
      Then the SABnzbd client finds no such job

    Scenario Outline: an id that SABnzbd would read as many jobs names none
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its history as "Completed"
      And the SABnzbd has the failed job "Other" with its partial files
      When the SABnzbd client is asked to <action> a job by the id "<id>"
      Then the SABnzbd client refuses with "unavailable:not-found"
      And the SABnzbd was not asked to change anything

      Examples:
        | action | id        |
        | forget | all       |
        | delete | failed    |
        | forget | completed |

    Scenario: failing to read the history is a failure, not an empty list
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" waiting in its queue
      And the SABnzbd hangs up on "history"
      When the SABnzbd client lists the jobs
      Then the SABnzbd client refuses with "unavailable:unreachable"

  Rule: Pause and resume set and clear one job's own hold, never the whole downloader's

    Scenario: a waiting job is held
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" waiting in its queue
      When the SABnzbd client is asked to pause the job "Example"
      Then the SABnzbd client answers with the job "Example"
      And the SABnzbd was asked to "queue.pause"
      And the SABnzbd holds the job "Example" as:
        | status | Paused |
      And the SABnzbd is still not paused as a whole

    Scenario: a held job is released
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" held in its queue
      When the SABnzbd client is asked to resume the job "Example"
      Then the SABnzbd client answers with the job "Example"
      And the SABnzbd was asked to "queue.resume"
      And the SABnzbd holds the job "Example" as:
        | status | Queued |

    Scenario Outline: a hold that is already as asked needs nothing sent
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" <placed> in its queue
      When the SABnzbd client is asked to <action> the job "Example"
      Then the SABnzbd client answers with the job "Example"
      And the SABnzbd was not asked to change anything

      Examples:
        | placed  | action |
        | held    | pause  |
        | waiting | resume |

    Scenario: SABnzbd saying yes without holding the job is not taken as done
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" waiting in its queue
      And the SABnzbd answers "queue.pause" without doing it
      When the SABnzbd client is asked to pause the job "Example"
      Then the SABnzbd client refuses with "unavailable:outcome-unknown"

    Scenario: a SABnzbd that says no has changed nothing
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" waiting in its queue
      And the SABnzbd answers "queue.pause" with the body:
        """
        {"status":false,"error":"not implemented"}
        """
      When the SABnzbd client is asked to pause the job "Example"
      Then the SABnzbd client refuses with "unavailable:rejected"

    Scenario: a key that stops working is a refusal, not an unknown outcome
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" waiting in its queue
      And the SABnzbd answers "queue.pause" with status 403
      When the SABnzbd client is asked to pause the job "Example"
      Then the SABnzbd client refuses with "denied:credentials"

    Scenario Outline: a job cannot be asked for what its phase does not allow
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Waiting" waiting in its queue
      And the SABnzbd has the job "Working" in its history as "Extracting"
      And the SABnzbd has the job "Ended" in its history as "Completed"
      When the SABnzbd client is asked to <action> the job "<job>"
      Then the SABnzbd client refuses with "invalid:state"
      And the SABnzbd was not asked to change anything

      Examples:
        | action | job     |
        | retry  | Waiting |
        | forget | Waiting |
        | delete | Waiting |
        | pause  | Working |
        | resume | Working |
        | forget | Working |
        | pause  | Ended   |
        | retry  | Ended   |
        | delete | Ended   |

    Scenario: cancel is refused before anything is asked of SABnzbd
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" waiting in its queue
      When the SABnzbd client is asked to cancel the job "Example"
      Then the SABnzbd client refuses with "unavailable:unsupported"
      And the SABnzbd holds the job "Example" as:
        | status | Queued |

    Scenario: a job SABnzbd does not have cannot be changed
      Given a SABnzbd that asks for no key
      When the SABnzbd client is asked to pause a job the downloader never had
      Then the SABnzbd client refuses with "unavailable:not-found"
      And the SABnzbd was not asked to change anything

    Scenario Outline: a change whose answer is lost may still have been made
      Given a SABnzbd that asks for no key
      And the SABnzbd client waits 150 ms for an answer
      And the SABnzbd has the job "Example" waiting in its queue
      And <failure>
      When the SABnzbd client is asked to pause the job "Example"
      Then the SABnzbd client refuses with "unavailable:outcome-unknown"

      Examples:
        | failure                                                    |
        | the SABnzbd hangs up on "queue.pause"                      |
        | the SABnzbd never answers "queue.pause"                    |
        | the SABnzbd hangs up on "queue" the second time it is asked |

  Rule: Retry starts a failed job again as a new job

    Scenario: a failed job with its partial files is taken back under a new id
      Given a SABnzbd that asks for no key
      And the SABnzbd has the failed job "Example" with its partial files
      When the SABnzbd client is asked to retry the job "Example"
      Then the SABnzbd client answers with the job "Example"
      And the SABnzbd job "Example" has a new id
      And the SABnzbd still has the partial files of 1 job
      When the SABnzbd client looks up the job "Example"
      Then the SABnzbd client describes the job as:
        | state | queued |

    Scenario: a failed job whose partial files are gone offers no retry
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its history as "Failed"
      When the SABnzbd client is asked to retry the job "Example"
      Then the SABnzbd client refuses with "invalid:state"

    Scenario: a retry SABnzbd declines changes nothing
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its history with:
        | status | Failed |
        | retry  | true   |
      When the SABnzbd client is asked to retry the job "Example"
      Then the SABnzbd client refuses with "unavailable:rejected"
      When the SABnzbd client looks up the job "Example"
      Then the SABnzbd client describes the job as:
        | state | failed |

    Scenario: a retry that does not name the new job cannot be followed
      Given a SABnzbd that asks for no key
      And the SABnzbd is old enough to retry without naming the new job
      And the SABnzbd has the failed job "Example" with its partial files
      When the SABnzbd client is asked to retry the job "Example"
      Then the SABnzbd client refuses with "unavailable:outcome-unknown"

    Scenario: a new job that never shows is not called retried
      Given a SABnzbd that asks for no key
      And the SABnzbd has the failed job "Example" with its partial files
      And the SABnzbd answers "retry" with the body:
        """
        {"status":true,"nzo_id":"a-job-that-never-shows"}
        """
      When the SABnzbd client is asked to retry the job "Example"
      Then the SABnzbd client refuses with "unavailable:outcome-unknown"

  Rule: Forget drops a record and touches no files; delete also removes a failed job's partial files

    Scenario: a completed job is forgotten
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its history as "Completed"
      When the SABnzbd client is asked to forget the job "Example"
      Then the SABnzbd client succeeds in that
      And the SABnzbd was asked to remove the job with "del_files" set to "0"
      And the SABnzbd has no job "Example"

    Scenario: a failed job is forgotten and its partial files stay
      Given a SABnzbd that asks for no key
      And the SABnzbd has the failed job "Example" with its partial files
      When the SABnzbd client is asked to forget the job "Example"
      Then the SABnzbd client succeeds in that
      And the SABnzbd has no job "Example"
      And the SABnzbd still has the partial files of 1 job

    Scenario: a failed job is deleted together with its partial files
      Given a SABnzbd that asks for no key
      And the SABnzbd has the failed job "Example" with its partial files
      When the SABnzbd client is asked to delete the job "Example"
      Then the SABnzbd client succeeds in that
      And the SABnzbd was asked to remove the job with "del_files" set to "1"
      And the SABnzbd has no job "Example"
      And the SABnzbd still has the partial files of 0 jobs

    Scenario: a record SABnzbd keeps despite saying yes is not called forgotten
      Given a SABnzbd that asks for no key
      And the SABnzbd has the job "Example" in its history as "Completed"
      And the SABnzbd answers "history.delete" without doing it
      When the SABnzbd client is asked to forget the job "Example"
      Then the SABnzbd client refuses with "unavailable:outcome-unknown"
