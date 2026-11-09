Feature: Account mailboxes
  An account's inbox and outbox are its published server list (NIP-65, kind
  10002): outboxes are where it writes, inboxes are where others reach it.
  The shell streams the list from the lookup servers, keeps the newest, and
  says it is missing only once every server has finished without one. Saving
  publishes the new list to the old and new servers and to the lookup servers,
  and succeeds when any of them accepts it (D-028, D-029).

  Background:
    Given the lookup servers "wss://look1.example,wss://look2.example"

  Scenario: a list with read, write and unmarked entries
    Given "wss://look1.example" holds a mailbox list from 1700000000 with
      | tag | url             | marker |
      | r   | wss://both.example |     |
      | r   | wss://in.example   | read  |
      | r   | wss://out.example  | write |
      | r   | not a server       |       |
      | r   | wss://bad host.example |   |
      | r   | wss://odd.example  | maybe |
      | p   | 0f0f               |       |
    When the signed-in account's mailboxes are watched
    Then the mailbox state is "found"
    And the inboxes are "wss://both.example/,wss://in.example/"
    And the outboxes are "wss://both.example/,wss://out.example/"

  Scenario: the newest list wins whichever server sends it
    Given "wss://look1.example" holds a mailbox list from 1700000500 with
      | tag | url             | marker |
      | r   | wss://new.example |      |
    And "wss://look2.example" holds a mailbox list from 1700000000 with
      | tag | url             | marker |
      | r   | wss://old.example |      |
    When the signed-in account's mailboxes are watched
    Then the outboxes are "wss://new.example/"
    And the lookup asked for kind 10002 by the signed-in account

  Scenario: the shell keeps listening and takes a newer list
    Given "wss://look1.example" holds a mailbox list from 1700000000 with
      | tag | url             | marker |
      | r   | wss://old.example |      |
    When the signed-in account's mailboxes are watched
    And "wss://look2.example" sends a mailbox list from 1700000900 with
      | tag | url             | marker |
      | r   | wss://next.example | read |
    Then the inboxes are "wss://next.example/"
    And the outboxes are ""

  Scenario: the list is missing only after every server has finished
    Given "wss://look2.example" is slow to answer
    When the signed-in account's mailboxes are watched
    Then the mailbox state is "loading"
    When "wss://look2.example" finishes
    Then the mailbox state is "missing"
    And the suggested inboxes are "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"
    And the suggested outboxes are "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"

  Scenario: a server that never answers does not keep the shell waiting forever
    Given "wss://look2.example" is slow to answer
    When the signed-in account's mailboxes are watched with a patience of 20 ms
    Then the mailbox state is "loading"
    When 40 ms pass
    Then the mailbox state is "missing"

  Scenario: a missing list carries suggestions, well-known servers first
    Given a relay directory that knows "wss://open.example,wss://quick.example"
    When the signed-in account's mailboxes are watched
    Then the mailbox state is "missing"
    And the suggested inboxes are "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"
    And the suggested outboxes are "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"
    When the directory hears of "wss://late.example" from 2 monitors
    And 20 ms pass
    Then the suggested inboxes are "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"

  Scenario: with nobody signed in there is nothing to look up
    When the mailboxes are watched with nobody signed in
    Then the mailbox state is "loading"
    And the lookup asked nothing
    When someone signs in to the mailboxes
    Then the mailbox state is "missing"
    When they sign out of the mailboxes
    Then the mailbox state is "loading"
    And the lookup is no longer open
    And the state stream reported "loading,missing,loading"

  Scenario: saving reaches two of three kinds of server and is still a success
    Given "wss://look1.example" holds a mailbox list from 1700000000 with
      | tag | url               | marker |
      | r   | wss://old.example | write  |
    And "wss://look2.example" refuses publishes with "blocked: not on the list"
    When the signed-in account's mailboxes are watched
    And the account saves inboxes "wss://in.example" and outboxes "wss://out.example,wss://in.example"
    Then the save succeeded
    And the list was published to "wss://out.example/,wss://in.example/,wss://old.example/,wss://look1.example/,wss://look2.example/"
    And "wss://look2.example/" refused it with "blocked: not on the list"
    And the person is told "Saved to 4 of 5 servers"
    And the outboxes are "wss://in.example/,wss://out.example/"
    And the inboxes are "wss://in.example/"

  Scenario: a list nobody accepted is not shown as saved
    Given "wss://look1.example" holds a mailbox list from 1700000000 with
      | tag | url               | marker |
      | r   | wss://old.example |        |
    And every server refuses publishes with "error: full"
    When the signed-in account's mailboxes are watched
    And the account saves inboxes "wss://in.example" and outboxes "wss://out.example"
    Then the save failed
    And "wss://out.example/" refused it with "error: full"
    And the person is told "No server accepted it"
    And the outboxes are "wss://old.example/"

  Scenario: when the network throws, every server counts as refusing
    Given the network is down for publishes
    When the signed-in account's mailboxes are watched
    And the account saves inboxes "wss://in.example" and outboxes "wss://out.example"
    Then the save failed
    And "wss://look1.example/" refused it with "network down"

  Scenario: a read-only account cannot save
    When the mailboxes of a read-only account are watched
    And the account saves inboxes "wss://in.example" and outboxes "wss://out.example"
    Then the shell refused with "denied:read-only"
    And nothing was published

  Scenario: an address that is not a server is refused before signing
    When the signed-in account's mailboxes are watched
    And the account saves inboxes "https://in.example" and outboxes "wss://out.example"
    Then the shell refused with "invalid:relay-url"
    And nothing was published

  Scenario: a save over a pool that answers one server at a time reports as it goes, and the list shows once one holds it
    Given the servers answer publishes one at a time, "wss://look2.example" never answering, then the stream completes
    And "wss://out.example" refuses publishes with "blocked: not on the list"
    When the signed-in account's mailboxes are watched
    And the account saves inboxes "wss://in.example" and outboxes "wss://out.example", watching progress
    Then the progress went "0/1:missing,1/2:found,2/3:found"
    And the save succeeded
    And "wss://look2.example/" refused it with "no answer"
    And the person is told "Saved to 2 of 4 servers"

  Scenario: a streamed save whose stream fails still counts every server
    Given the servers answer publishes one at a time, "wss://look1.example,wss://look2.example" never answering, then the stream fails
    When the signed-in account's mailboxes are watched
    And the account saves inboxes "wss://in.example" and outboxes "wss://in.example", watching progress
    Then the progress went "1/1:found"
    And the person is told "Saved to 1 of 3 servers"

  Scenario: saving keeps the other tags and the content, and moves time forward
    Given "wss://look1.example" holds a mailbox list from 1900000000 with content "kept" and
      | tag    | url              | marker |
      | r      | wss://old.example |       |
      | client | kernl-test       |        |
      | alt    | Relay list       |        |
    When the signed-in account's mailboxes are watched
    And the account saves inboxes "wss://both.example,wss://in.example" and outboxes "wss://Both.example/,wss://out.example"
    Then the published list has the tags
      | tag    | url                 | marker |
      | r      | wss://both.example/ |        |
      | r      | wss://in.example/   | read   |
      | r      | wss://out.example/  | write  |
      | client | kernl-test          |        |
      | alt    | Relay list          |        |
    And the published list has content "kept" and was created at 1900000001

  Scenario: reading an absent list gives empty mailboxes
    Then the mailboxes of no list are empty
