Feature: An applet that reads messages is sealed
  Private messages are the most private thing the shell holds. An applet the
  person lets read them keeps only the grants that cannot send what it read
  anywhere else. Every other grant is withheld for as long as it holds
  messages, whoever asked for it and whenever it was given (D-046).

  Background:
    Given a restrictive kehto ACL state in memory
    And kernl grants over empty storage offering "shell,inc,theme,identity,storage,config,notify,keys,intent,dm,relay,outbox,upload,webrtc,cvm,resource,link,llm,fs,cache,media"

  Scenario: only what cannot carry a message away may go with messages
    Then the domains that may go with messages are "shell,dm,identity,theme,storage,config,notify,keys,intent"

  Scenario Outline: a domain that could send a message on is withheld from an applet that holds messages
    When the shell allows "dm" for "chat"
    And the shell allows "<domain>" for "chat"
    Then the grant record for "chat" withholds "inc,<domain>"
    And the ACL denies "<capability>" for "chat"
    And the resolver gives "chat" domains "shell,theme,storage,dm" and services "" from "shell,inc,theme,storage,dm,<domain>" and "<domain>"

    Examples:
      | domain   | capability     |
      | relay    | relay:write    |
      | relay    | relay:read     |
      | outbox   | outbox:write   |
      | upload   | upload:write   |
      | cvm      | cvm:call       |
      | resource | resource:fetch |
      | llm      | llm:generate   |
      | fs       | fs:write       |
      | cache    | cache:write    |
      | media    | media:control  |

  Scenario: direct connections, links and anything the shell has no words for yet are withheld too
    When the shell allows "dm" for "chat"
    And the shell allows "webrtc" for "chat"
    And the shell allows "link" for "chat"
    Then the grant record for "chat" withholds "inc,webrtc,link"
    And the resolver gives "chat" domains "shell,theme,storage,dm" and services "" from "shell,inc,theme,storage,dm,webrtc,link,something-new" and "webrtc"

  Scenario: talking to other applets is baseline for everyone else, and withheld here
    When the shell allows "dm" for "chat"
    Then the grant record for "chat" withholds "inc"
    And the resolver gives "chat" domains "shell,theme,storage,dm" and services "" from "shell,inc,theme,storage,dm" and ""

  Scenario: the order of the grants does not matter
    When the shell allows "relay" for "chat"
    Then the ACL allows "relay:write" for "chat"
    When the shell allows "dm" for "chat"
    Then the ACL denies "relay:write" for "chat"
    And the ACL denies "relay:read" for "chat"
    And the ACL allows "dm:read" for "chat"
    And the grant record for "chat" has domains "relay,dm" and is not blocked
    And the grant record for "chat" withholds "inc,relay"

  Scenario: what may go with messages stays in force
    When the shell allows "dm" for "chat"
    And the shell allows "identity" for "chat"
    And the shell allows "notify" for "chat"
    And the shell allows "config" for "chat"
    And the shell allows "keys" for "chat"
    Then the grant record for "chat" withholds "inc"
    And the ACL allows "dm:write" for "chat"
    And the ACL allows "identity:read" for "chat"
    And the ACL allows "notify:send" for "chat"
    And the ACL allows "config:read" for "chat"
    And the ACL allows "keys:bind" for "chat"

  Scenario: it can be handed a request by another applet, and cannot hand one on
    When the shell allows "dm" for "chat"
    And the shell allows "intent" for "chat"
    Then the ACL allows "intent:read" for "chat"
    And the ACL denies "intent:write" for "chat"

  Scenario: an applet without messages can both take and hand on requests
    When the shell allows "intent" for "chat"
    Then the ACL allows "intent:read" for "chat"
    And the ACL allows "intent:write" for "chat"
    And the grant record for "chat" withholds ""

  Scenario: taking messages back puts the other grants in force again
    When the shell allows "relay" for "chat"
    And the shell allows "dm" for "chat"
    And the shell revokes "dm" for "chat"
    Then the ACL allows "relay:write" for "chat"
    And the ACL denies "dm:read" for "chat"
    And the grant record for "chat" withholds ""

  Scenario: a window running with a grant that messages withhold is stopped when messages are granted
    When the shell allows "relay" for "chat"
    Then a window of "chat" started with "shell,inc,theme,storage,relay" keeps running
    When the shell allows "dm" for "chat"
    Then a window of "chat" started with "shell,inc,theme,storage,relay" is stopped for "grant-narrowed"
    And a window of "chat" started with "shell,theme,storage,dm" keeps running

  Scenario: the seal is told apart from an ordinary grant
    Then grants "dm,relay" seal an applet and grants "relay,upload" do not
    And grants "dm,relay,upload" leave "shell,theme,storage,keys,dm" in force over the usual baseline
    And grants "relay" leave "shell,inc,theme,storage,keys,relay" in force over the usual baseline

  Rule: the person may keep a domain beside messages, one at a time (D-060)

    Scenario: a domain the person keeps beside messages stays in force
      When the shell allows "dm" for "chat"
      And the shell allows "upload" for "chat" beside messages
      Then the grant record for "chat" keeps "upload" beside messages
      And the grant record for "chat" withholds "inc"
      And the ACL allows "upload:write" for "chat"
      And the ACL allows "dm:read" for "chat"
      And the resolver gives "chat" domains "shell,theme,storage,dm,upload" and services "" from "shell,inc,theme,storage,dm,upload" and ""

    Scenario: keeping one domain does not free the others
      When the shell allows "dm" for "chat"
      And the shell allows "relay" for "chat"
      And the shell allows "upload" for "chat" beside messages
      Then the grant record for "chat" withholds "inc,relay"
      And the ACL denies "relay:write" for "chat"
      And the ACL allows "upload:write" for "chat"

    Scenario: handing a request on stays withheld, whatever is kept
      When the shell allows "dm" for "chat"
      And the shell allows "intent" for "chat"
      And the shell allows "upload" for "chat" beside messages
      Then the ACL allows "intent:read" for "chat"
      And the ACL denies "intent:write" for "chat"

    Scenario: a baseline domain, such as talking to other applets, can be kept too
      When the shell allows "dm" for "chat"
      And the shell allows "inc" for "chat" beside messages
      Then the grant record for "chat" keeps "inc" beside messages
      And the grant record for "chat" withholds ""
      And the grant record for "chat" has domains "dm" and is not blocked
      And the resolver gives "chat" domains "shell,inc,theme,storage,dm" and services "" from "shell,inc,theme,storage,dm" and ""

    Scenario: the exception can be dropped while the grant stays
      When the shell allows "dm" for "chat"
      And the shell allows "upload" for "chat" beside messages
      And the shell allows "upload" for "chat" not beside messages
      Then the grant record for "chat" keeps "" beside messages
      And the grant record for "chat" has domains "dm,upload" and is not blocked
      And the grant record for "chat" withholds "inc,upload"
      And the ACL denies "upload:write" for "chat"
      When the shell allows "upload" for "chat" not beside messages
      Then the grant record for "chat" keeps "" beside messages

    Scenario: taking the domain back takes the exception with it
      When the shell allows "dm" for "chat"
      And the shell allows "upload" for "chat" beside messages
      And the shell revokes "upload" for "chat"
      Then the grant record for "chat" keeps "" beside messages
      When the shell allows "upload" for "chat"
      Then the grant record for "chat" withholds "inc,upload"
      And the ACL denies "upload:write" for "chat"

    Scenario: taking the exception of a baseline domain back withholds it again
      When the shell allows "dm" for "chat"
      And the shell allows "inc" for "chat" beside messages
      And the shell revokes "inc" for "chat"
      Then the grant record for "chat" keeps "" beside messages
      And the grant record for "chat" withholds "inc"

    Scenario: the exception belongs to one applet
      When the shell allows "dm" for "chat"
      And the shell allows "upload" for "chat" beside messages
      And the shell allows "dm" for "other"
      And the shell allows "upload" for "other"
      Then the grant record for "other" keeps "" beside messages
      And the grant record for "other" withholds "inc,upload"

    Scenario: without messages there is nothing to keep it beside, and nothing is withheld
      When the shell allows "upload" for "chat" beside messages
      Then the grant record for "chat" keeps "upload" beside messages
      And the grant record for "chat" withholds ""
      And the ACL allows "upload:write" for "chat"

    Scenario: the exception is remembered
      When the shell allows "dm" for "chat"
      And the shell allows "upload" for "chat" beside messages
      And kernl grants are created again over the same storage
      Then the grant record for "chat" keeps "upload" beside messages
      And the grant record for "chat" has domains "dm,upload" and is not blocked

    Scenario: the seal is lifted for the kept domains only
      Then grants "dm,upload,relay" with "upload" kept leave "shell,theme,storage,keys,dm,upload" in force over the usual baseline

    Scenario: a domain kept beside messages for now is forgotten with it
      When the shell allows "dm" for "chat"
      And the shell allows "upload" for "chat" beside messages for now
      Then the ACL allows "upload:write" for "chat"
      And the grant record for "chat" keeps "upload" beside messages
      When the shell forgets what was granted for now for "chat"
      Then the ACL denies "upload:write" for "chat"
      And the grant record for "chat" keeps "" beside messages

