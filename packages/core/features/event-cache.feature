Feature: Event cache
  Events the shell has seen are kept between visits through one adapter contract (D-027). The first
  adapter that opens in this context wins; a browser tries sqlite over OPFS, then IndexedDB, then
  memory. Every backend keeps the same rules, a damaged sqlite database is wiped or rotated and never
  read, and a cache that cannot answer is treated as empty: it is an accelerator, never identity.

  Rule: the first adapter that opens wins

    Scenario: an adapter that cannot open is skipped and reported
      Given a cache adapter "first" that rejects with "unavailable:opfs"
      And a working cache adapter "second"
      And a working cache adapter "third"
      When the shell opens the event cache
      Then the event cache is "second"
      And the fallbacks reported are "first: unavailable:opfs"

    Scenario: with no adapter that opens, events are cached in memory
      Given a cache adapter "first" that rejects with "unavailable:opfs"
      And a cache adapter "second" that rejects with the bare value "boom"
      When the shell opens the event cache
      Then the event cache is "memory"
      And the fallbacks reported are "first: unavailable:opfs, second: boom"

    Scenario: the web defaults are sqlite over OPFS, then IndexedDB, then memory
      Then the default web cache adapters are "sqlite-opfs, indexeddb, memory"

    Scenario: a context with neither OPFS nor IndexedDB caches in memory
      When the shell opens the event cache with the web defaults
      Then the event cache is "memory"
      And the fallbacks reported are "sqlite-opfs: unavailable:opfs, indexeddb: unavailable:indexeddb"

    Scenario: a context with IndexedDB but no OPFS caches in IndexedDB
      Given the page has IndexedDB
      When the shell opens the event cache with the web defaults
      Then the event cache is "indexeddb"

    Scenario: an IndexedDB database the shell cannot open is skipped
      Given an IndexedDB database "kernl-events" from a newer version of the shell
      When the shell opens the event cache with IndexedDB
      Then the event cache is "memory"
      And the fallbacks reported are "indexeddb: unavailable:indexeddb (VersionError)"

  Rule: every backend keeps the newest version, honours deletions and answers filters

    Scenario Outline: a replaceable event keeps only its newest version in <cache>
      Given an open "<cache>" event cache
      When the cache stores a kind 0 event "old" by "alice" at 1000
      And the cache stores a kind 0 event "new" by "alice" at 2000
      And the cache stores a kind 0 event "stale" by "alice" at 1500
      Then a query for kind 0 by "alice" returns "new"
      When the cache stores a kind 0 event "tie" by "alice" at 2000
      Then a query for kind 0 by "alice" returns whichever of "new, tie" has the lower id

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

    Scenario Outline: one batch with several versions keeps the newest in <cache>
      Given an open "<cache>" event cache
      When the cache stores in one batch a kind 10002 event "a" by "alice" at 1000 and "b" at 3000 and "c" at 2000
      Then a query for kind 10002 by "alice" returns "b"

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

    Scenario Outline: an addressable event keeps the newest per identifier in <cache>
      Given an open "<cache>" event cache
      When the cache stores a kind 30023 event "first" by "alice" with d "post" at 1000
      And the cache stores a kind 30023 event "second" by "alice" with d "post" at 2000
      And the cache stores a kind 30023 event "other" by "alice" with d "draft" at 500
      And the cache stores a kind 30023 event "bare" by "alice" with no d at 700
      And the cache stores a kind 30023 event "bare-newer" by "alice" with no d at 800
      Then a query for kind 30023 by "alice" returns "second, bare-newer, other"

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

    Scenario Outline: a deletion by the author removes its target and keeps it out of <cache>
      Given an open "<cache>" event cache
      And the cache stores a kind 1 event "note" by "alice" at 1000
      And the cache stores a kind 1 event "kept" by "alice" at 1100
      When "alice" deletes "note" at 1200
      Then a query for kind 1 by "alice" returns "kept"
      When the cache stores "note" again
      Then a query for kind 1 by "alice" returns "kept"

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

    Scenario Outline: a deletion by someone else is ignored by <cache>
      Given an open "<cache>" event cache
      And the cache stores a kind 1 event "note" by "alice" at 1000
      When "bob" deletes "note" at 1200
      Then a query for kind 1 by "alice" returns "note"

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

    Scenario Outline: deleting an address removes the versions up to the deletion in <cache>
      Given an open "<cache>" event cache
      And the cache stores a kind 30023 event "post" by "alice" with d "post" at 1000
      And the cache stores a kind 30023 event "bare" by "alice" with no d at 1000
      When "alice" deletes the addresses of "post, bare" at 1500
      Then a query for kind 30023 by "alice" returns nothing
      When the cache stores a kind 30023 event "older" by "alice" with d "post" at 1400
      And the cache stores a kind 30023 event "rewritten" by "alice" with d "post" at 1600
      Then a query for kind 30023 by "alice" returns "rewritten"

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

    Scenario Outline: filters select by ids, authors, kinds, time, tags and limit in <cache>
      Given an open "<cache>" event cache
      And the cache holds these events:
        | name   | author | kind | created_at | tags        |
        | hello  | alice  | 1    | 1000       | t=nostr     |
        | world  | alice  | 1    | 2000       | t=kernl     |
        | reply  | bob    | 1    | 3000       | e=hello     |
        | react  | bob    | 7    | 4000       | t=nostr     |
        | ping   | carol  | 20001| 5000       |             |
        | again  | carol  | 1    | 1000       |             |
        | twice  | carol  | 1    | 1000       |             |
      Then these filters return:
        | filter                                  | events                   |
        | {"ids":["world","nobody"]}              | world                    |
        | {"authors":["bob"]}                     | react, reply             |
        | {"authors":["carol"]}                   | again, twice             |
        | {"kinds":[1],"since":1500,"until":2500} | world                    |
        | {"kinds":[1],"until":1000}              | again, hello, twice      |
        | {"since":2500}                          | react, reply             |
        | {"#t":["nostr"]}                        | react, hello             |
        | {"#t":["nostr"],"kinds":[1]}            | hello                    |
        | {"#e":["hello"]}                        | reply                    |
        | {"kinds":[1],"limit":2}                 | reply, world             |
        | {"search":"hello"}                      |                          |
        | {"since":2000}                          | react, reply, world      |
      And the filters {"kinds":[7]} and {"authors":["alice"],"limit":1} together return "react, world"

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

    Scenario: an IndexedDB write the browser aborts is refused
      Given the page's IndexedDB aborts every write
      And an open "indexeddb" event cache
      Then storing an event fails with "unavailable:indexeddb (aborted)"
      And a query for every event returns nothing

    Scenario Outline: an event stored twice is kept once in <cache>
      Given an open "<cache>" event cache
      And the cache stores a kind 1 event "note" by "alice" at 1000
      When the cache stores "note" again
      Then a query for kind 1 by "alice" returns "note"

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

    Scenario Outline: events are removed by filter and cleared from <cache>
      Given an open "<cache>" event cache
      And the cache stores a kind 1 event "note" by "alice" at 1000
      And the cache stores a kind 1 event "other" by "bob" at 1000
      And the cache stores a kind 0 event "profile" by "alice" at 1000
      When the cache removes the events matching {"kinds":[1]}
      Then 2 events were removed
      And a query for every event returns "profile"
      When the cache removes the events matching {"kinds":[9]}
      Then 0 events were removed
      When the cache is cleared
      Then a query for every event returns nothing

      Examples:
        | cache       |
        | memory      |
        | indexeddb   |
        | sqlite-opfs |

  Rule: a cache wired to the event store writes new events and answers loaders

    Scenario: events the store receives are written to the cache
      Given an open "memory" event cache attached to an event store
      When the event store receives a kind 1 event "note" by "alice" at 1000
      And the next batch is written
      Then a query for kind 1 by "alice" returns "note"

    Scenario: events read from the cache are marked as from the cache
      Given an open "memory" event cache attached to an event store
      And the cache stores a kind 1 event "note" by "alice" at 1000
      When a loader asks the cache for kind 1 by "alice"
      Then the loader is answered "note" marked as from the cache
      When the event store receives the events the loader was answered
      And the next batch is written
      Then the cache was not written again

    Scenario: a cache that cannot answer is treated as empty
      Given an event cache whose reads fail attached to an event store
      When a loader asks the cache for kind 1 by "alice"
      Then the loader is answered nothing

    Scenario: any applesauce event database becomes a cache
      Given an asynchronous applesauce event database wrapped as the "server" cache
      When the cache stores a kind 0 event "old" by "alice" at 1000
      And the cache stores a kind 0 event "new" by "alice" at 2000
      Then the event cache is "server"
      And a query for kind 0 by "alice" returns "new"
      When the cache is closed
      Then the database was released

  Rule: a damaged sqlite database is wiped or rotated, never read

    Scenario: a healthy database keeps its events across visits
      Given a sqlite pool
      And an open "sqlite-opfs" event cache
      And the cache stores a kind 1 event "note" by "alice" at 1000
      When the cache is closed
      And the shell opens the sqlite cache again
      Then a query for kind 1 by "alice" returns "note"
      And the cache reported no recovery

    Scenario Outline: a database that is <damage> is detected, wiped and opened fresh
      Given a sqlite pool whose database file is <damage>
      When the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "sqlite-opfs"
      And the cache reported recovery "wiped" because "<reason>"
      And a query for every event returns nothing
      And the cache stores a kind 1 event "fresh" by "alice" at 1000
      And a query for kind 1 by "alice" returns "fresh"

      Examples:
        | damage            | reason                      |
        | not a database    | file is not a database      |
        | malformed         | database disk image is malformed |
        | inconsistent      | NULL value in filler.value  |

    Scenario: when the file cannot be wiped the cache moves to a new file
      Given a sqlite pool whose database file is not a database
      And the sqlite pool cannot remove files
      When the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "sqlite-opfs"
      And the cache reported recovery "rotated" because "cannot remove"
      And the cache's filename is now "/kernl-events-1.sqlite3"
      When the cache stores a kind 1 event "fresh" by "alice" at 1000
      And the cache is closed
      And the shell opens the sqlite cache again
      Then a query for kind 1 by "alice" returns "fresh"
      When the open database becomes damaged
      Then a query for every event returns nothing
      And the cache's filename is now "/kernl-events-2.sqlite3"

    Scenario: a database file without an extension rotates to a numbered file
      Given a sqlite pool whose "/events" file is not a database
      And the sqlite pool cannot remove files
      When the shell opens the event cache with sqlite at "/events" then IndexedDB
      Then the event cache is "sqlite-opfs"
      And the cache's filename is now "/events-1"

    Scenario: a database that stays damaged falls back to the next adapter
      Given a sqlite pool where every database file is not a database
      When the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "indexeddb"
      And the cache reported recoveries "disabled"
      And the fallbacks reported are "sqlite-opfs: unavailable:corrupt"

    Scenario: a database that fails for another reason falls back without repair
      Given a sqlite pool that cannot open files
      When the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "indexeddb"
      And the cache reported no recovery
      And the fallbacks reported are "sqlite-opfs: unavailable:sqlite (disk full)"

    Scenario: another tab holding the database falls back
      Given a sqlite pool
      And another tab holds the event cache
      When the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "indexeddb"
      And the fallbacks reported are "sqlite-opfs: unavailable:locked"

    Scenario: the database is free for the next tab once the cache closes
      Given a sqlite pool
      And an open "sqlite-opfs" event cache
      When the cache is closed
      And the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "sqlite-opfs"

    Scenario: a lock manager that refuses the request falls back
      Given a sqlite pool
      And a lock manager that refuses every request
      When the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "indexeddb"
      And the fallbacks reported are "sqlite-opfs: unavailable:locks refused"

    Scenario: damage found during use is repaired once and the work retried
      Given a sqlite pool
      And an open "sqlite-opfs" event cache
      And the cache stores a kind 1 event "note" by "alice" at 1000
      When the open database becomes damaged
      And two queries for kind 1 by "alice" run at once
      Then both queries answered nothing
      And the cache reported recovery "wiped" because "file is not a database"
      When the cache stores a kind 1 event "fresh" by "alice" at 2000
      Then a query for kind 1 by "alice" returns "fresh"

    Scenario: a damaged database that also fails to close is still repaired
      Given a sqlite pool
      And an open "sqlite-opfs" event cache
      When the open database becomes damaged
      And the open database fails to close once
      Then a query for every event returns nothing
      And the cache reported recovery "wiped" because "file is not a database"

    Scenario: a query that meets damage after another has repaired it only retries
      Given a sqlite pool
      And an open "sqlite-opfs" event cache whose damaged queries answer late
      And the cache stores a kind 1 event "note" by "alice" at 1000
      When the open database becomes damaged
      And two queries for kind 1 by "alice" run at once
      Then both queries answered nothing
      And the cache reported recovery "wiped" because "file is not a database"

    Scenario: damage during use that cannot be repaired disables the cache
      Given a sqlite pool
      And an open "sqlite-opfs" event cache
      When the open database becomes damaged
      And every new database file is not a database
      And the sqlite pool cannot remove files
      Then a query for every event fails with "unavailable:corrupt"
      And the cache reported recoveries "disabled"
      And a query for every event fails with "unavailable:corrupt"
      And clearing the cache fails with "unavailable:corrupt"
      And the cache can still be closed

    Scenario: an ordinary sqlite error is not mistaken for damage
      Given a sqlite pool
      And an open "sqlite-opfs" event cache
      When the open database is busy
      Then a query for every event fails with "SQLITE_BUSY"
      And the cache reported no recovery

    Scenario Outline: sqlite errors are classified as damage or not
      Then the error "<message>" is damage: <damage>

      Examples:
        | message                                              | damage |
        | SQLITE_CORRUPT: sqlite3 result code 11               | yes    |
        | SQLITE_NOTADB: sqlite3 result code 26                | yes    |
        | database disk image is malformed                     | yes    |
        | file is not a database                               | yes    |
        | SQLITE_BUSY: database is locked                      | no     |

  Rule: sqlite runs in a dedicated worker over the OPFS SAH pool

    Scenario: the web defaults start the sqlite worker when the page has OPFS
      Given the page has workers and OPFS backed by a sqlite pool
      When the shell opens the event cache with the web defaults
      Then the event cache is "sqlite-opfs"
      And the sqlite worker was started as a module from "sqlite-worker.js"
      And the cache stores a kind 1 event "note" by "alice" at 1000
      And a query for kind 1 by "alice" returns "note"
      When the cache is closed
      Then the sqlite worker was stopped

    Scenario: a worker whose sqlite has no SAH pool falls back
      Given the page has workers and OPFS running the real sqlite worker entry
      When the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "indexeddb"
      And the fallback reason for "sqlite-opfs" starts with "unavailable:opfs"
      And the sqlite worker was stopped

    Scenario: a worker that crashes fails its requests
      Given the page has workers and OPFS backed by a sqlite pool
      And the sqlite worker crashes on start
      When the shell opens the event cache with sqlite then IndexedDB
      Then the event cache is "indexeddb"
      And the fallback reason for "sqlite-opfs" starts with "unavailable:worker"

    Scenario: a request for a database the worker does not hold open is refused
      Given a sqlite worker backed by a sqlite pool
      When the main thread queries "/missing.sqlite3" in the worker
      Then the worker answers "invalid:closed (/missing.sqlite3)"
