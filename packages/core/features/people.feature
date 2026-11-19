Feature: Finding a person
  Wherever the shell looks for someone, every form of their identity works:
  64 hex characters, an npub or an nprofile. An nprofile says where the
  person's data is kept, and the shell asks there first.

  Scenario Outline: every form of an identity names the same person
    Given a person "ada"
    When the shell reads ada's identity written as <form>
    Then the shell found ada with <hints> hinted servers

    Examples:
      | form                         | hints |
      | hex                          | 0     |
      | upper-case hex with spaces   | 0     |
      | an npub                      | 0     |
      | an npub behind a scheme      | 0     |
      | an upper-case npub           | 0     |
      | an nprofile with two servers | 2     |
      | an nprofile with no servers  | 0     |

  Scenario Outline: text that is not a person is not read as one
    When the shell reads the identity "<text>"
    Then the shell found nobody

    Examples:
      | text                                                                |
      | hello                                                               |
      |                                                                     |
      | npub1qqqqqqqqqqqqqqqq                                               |
      | 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459    |

  Scenario: a secret key, a note or an applet address is not a person
    Given a person "ada"
    Then ada's secret key, a note of hers and an applet of hers are each read as nobody

  Scenario: an nprofile's server that is not a socket address is left out
    Given a person "ada"
    When the shell reads ada's identity written as an nprofile naming "https://not-a-socket.example"
    Then the shell found ada with 0 hinted servers

  Scenario: the servers an nprofile names are asked for the person before anyone else is
    Given a person "ada" whose profile, server list and inboxes are on "wss://hinted.example/"
    And a people finder
    When the finder locates ada by an nprofile naming "wss://hinted.example/"
    Then the finder answered with ada's key
    And "wss://hinted.example/" was asked for kinds 0, 10002 and 10050 by ada
    And the event store holds ada's profile, server list and inboxes

  Scenario: the same person and servers are asked once
    Given a person "ada" whose profile, server list and inboxes are on "wss://hinted.example/"
    And a people finder
    When the finder locates ada by an nprofile naming "wss://hinted.example/"
    And the finder locates ada by an nprofile naming "wss://hinted.example/"
    Then the hinted servers were asked 1 time

  Scenario: an identity with no servers asks nobody
    Given a person "ada"
    And a people finder
    When the finder locates ada by her npub
    Then the finder answered with ada's key
    And the hinted servers were asked 0 times

  Scenario: a hinted server that fails costs nothing
    Given a person "ada"
    And a people finder whose servers fail
    When the finder locates ada by an nprofile naming "wss://down.example/"
    Then the finder answered with ada's key

  Scenario: a hinted server that never answers is waited for only so long
    Given a person "ada"
    And a people finder whose servers never answer, bounded at 20 ms
    When the finder locates ada by an nprofile naming "wss://silent.example/"
    Then the finder answered with ada's key

  Scenario: locating text that is not a person is refused
    Given a people finder
    When the finder locates "nobody at all"
    Then the finder refused with "invalid:person"

  Scenario: an applet writes to people named in any form
    Given a person "ada"
    And a people finder
    And a messaging adapter that reads its recipients through the finder
    When an applet sends "hi" to ada by her npub and by an nprofile naming "wss://hinted.example/"
    Then the adapter underneath was sent "hi" for ada's key twice

  Scenario: an applet that names somebody who is not a person is told so
    Given a people finder
    And a messaging adapter that reads its recipients through the finder
    When an applet sends "hi" to "not a person"
    Then the send was refused with "invalid:recipient"
