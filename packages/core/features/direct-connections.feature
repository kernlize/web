Feature: Direct connections between people
  An applet opens a session with other people running it: the shell introduces
  them through relays and connects their devices directly. Each window signs
  under a key of its own, the person is asked about every session, and only an
  applet they granted direct connections may ask (D-042). These scenarios run
  real peer connections over loopback, introduced through a loopback relay.

  Background:
    Given a loopback relay that introduces people
    And "Ann" runs the applet "chess" with direct connections granted
    And "Ben" runs the applet "chess" with direct connections granted, using the page's own peer connections

  Scenario: two people in the same room connect and send each other messages
    When "Ann" opens the room "lobby-1234"
    And "Ben" opens the room "lobby-1234"
    Then "Ann" and "Ben" see each other join and the session open
    When "Ann" sends '{"move":"e4"}'
    Then "Ben" receives '{"move":"e4"}' from "Ann"
    When "Ben" sends '{"move":"e5"}'
    Then "Ann" receives '{"move":"e5"}' from "Ben"
    And every signal was signed by a window's own key
    And every offer and answer was sealed for the one peer it is for
    And after 3 seconds of hellos each has met the other once

  Scenario: a room can be open only to the people the applet names
    Given "Eve" speaks the signaling herself, with a key above "Ann"'s
    When "Ann" opens the room "lobby-1234" open only to "Ben"
    And "Ben" opens the room "lobby-1234"
    And "Eve" joins the room "lobby-1234" in the applet "chess"
    Then "Ann" and "Ben" see each other join and the session open
    And after 3 seconds "Ann" has seen "Eve" join 0 times

  Scenario: a relay that turns signals away holds a session back without breaking it
    Given the relay turns signals away
    When "Ann" opens the room "lobby-1234"
    And "Ben" opens the room "lobby-1234"
    Then after 3 seconds "Ann" has seen no one join
    When the relay takes signals again
    Then "Ann" and "Ben" see each other join and the session open

  Scenario: the person is asked about each session, in words
    Given "Ann" is helped by the server "stun:stun.example:3478"
    And "Ann" will say no
    When "Ann" opens the room "lobby-1234"
    Then "Ann" was asked "Connect directly to other people", marked "direct"
    And the question says "With" is 'Anyone who joins "lobby-1234" in this applet'
    And the question says "They learn" is "Your network address, which can show roughly where you are"
    And the question says "They see" is "Whatever this applet sends them. The shell cannot see it."
    And the question says "Helped by" is "stun:stun.example:3478"
    And the question says "They know you as" is "A new name for this window, not your identity"
    And the question names the loopback relay as what introduces them
    And "Ann" is told "policy denied"
    And nothing was published for "Ann"

  Scenario: a direct session reaches the one person it names
    When "Ann" opens a direct session with "Ben"
    And "Ben" opens a direct session with "Ann"
    Then "Ann" was asked with "With" saying "One person this applet chose"
    And "Ann" and "Ben" see each other join and the session open

  Scenario: an applet without the grant is refused before anyone is asked
    Given "Ann" has not granted direct connections
    When "Ann" opens the room "lobby-1234"
    Then "Ann" is told "policy denied"
    And "Ann" was not asked
    And nothing was published for "Ann"

  Scenario: a grant taken back while the person is asked opens nothing
    Given "Ann" takes the grant back while she is asked
    When "Ann" opens the room "lobby-1234"
    Then "Ann" is told "policy denied"
    And nothing was published for "Ann"

  Scenario: a window whose applet the shell cannot name is refused
    Given "Cy" runs an applet the shell cannot name, with direct connections granted
    When "Cy" opens the room "lobby-1234"
    Then "Cy" is told "policy denied"
    And "Cy" was not asked

  Scenario: different applets never meet in a room of the same name
    Given "Dee" runs the applet "draughts" with direct connections granted
    When "Ann" opens the room "lobby-1234"
    And "Dee" opens the room "lobby-1234"
    Then after 3 seconds "Ann" has seen no one join

  Scenario: leaving a session tells the others, and a closed window's key is wiped
    When "Ann" opens the room "lobby-1234"
    And "Ben" opens the room "lobby-1234"
    Then "Ann" and "Ben" see each other join and the session open
    When "Ben" closes the session saying "bye"
    Then "Ben" is told the session closed saying "bye"
    And "Ann" sees "Ben" leave
    When "Ann" closes the session
    Then "Ann" is told the session closed
    When "Ann" closes her window
    Then the key "Ann"'s window signed under is all zeros

  Scenario: what cannot be sent is refused
    When "Ann" opens the room "lobby-1234"
    And "Ann" sends '{"early":true}'
    Then "Ann" is told "peer unavailable"
    When "Ben" opens the room "lobby-1234"
    Then "Ann" and "Ben" see each other join and the session open
    When "Ann" sends a message of 17000 bytes
    Then "Ann" is told "payload is not JSON of at most 16 KiB"
    When "Ann" sends nothing at all
    Then "Ann" is told "payload is not JSON of at most 16 KiB"

  Scenario Outline: requests the shell will not open
    When "Ann" asks to open <request>
    Then "Ann" is told "<error>"

    Examples:
      | request                                         | error                  |
      | a room whose name is 257 characters long        | invalid room           |
      | the room "lobby-1234" with the peer "not-a-key" | invalid peers          |
      | a direct session with "not-a-key"               | invalid scope          |
      | the room "lobby-1234" on the channel ""         | invalid channel        |
      | the room "lobby-1234" with a 129-character protocol | invalid protocol   |
      | a direct session with herself                   | cannot connect to self |

  Scenario: a window opens at most four sessions, and each room once
    When "Ann" opens the room "room-0001"
    And "Ann" opens the room "room-0001" again
    Then "Ann" is told "scope already open"
    When "Ann" opens the rooms "room-0002,room-0003,room-0004" on the channel "game" with the protocol "chess/1"
    And "Ann" opens the room "room-0005"
    Then "Ann" is told "session limit reached"

  Scenario: what a peer sends that is not a message for the applet never reaches it
    Given "Eve" speaks the signaling herself, with a key above "Ann"'s
    When "Ann" opens the room "lobby-1234"
    And "Eve" joins the room "lobby-1234" in the applet "chess"
    Then "Ann" sees "Eve" join
    When "Eve" sends "not json", a binary message, a message of 17000 bytes and '{"ok":true}'
    Then "Ann" receives only '{"ok":true}' from "Eve"
    When "Eve" opens a second channel "side"
    Then "Eve" sees her second channel closed
    When "Eve" sends 300 messages within a second
    Then "Ann" received at most 240 of them
    When "Eve" waits a second and sends '{"later":true}'
    Then "Ann" receives '{"later":true}' from "Eve"

  Scenario: a peer that reloads is met again, and what its old self sends is ignored
    Given "Eve" speaks the signaling herself, with a key above "Ann"'s
    When "Ann" opens the room "lobby-1234"
    And "Eve" joins the room "lobby-1234" in the applet "chess"
    Then "Ann" sees "Eve" join
    When "Eve" reloads and joins again
    Then "Ann" sees "Eve" leave and join again
    When "Eve" says hello as her old self
    Then after 3 seconds "Ann" has seen "Eve" join 2 times

  Scenario: signals that do not fit the session are ignored, and a peer whose offer breaks is dropped
    Given "Eve" speaks the signaling herself, with a key below "Ann"'s
    When "Ann" opens the room "lobby-1234"
    And "Eve" says hello in "lobby-1234" asking for unreliable delivery
    And "Eve" sends an offer to no one in particular
    And "Eve" sends "Ann" an offer before saying hello
    And "Eve" sends an offer meant for someone else
    And "Eve" sends a signal that is not JSON
    And "Eve" says hello in "lobby-1234" asking for reliable delivery
    And "Eve" sends "Ann" an answer she did not ask for
    And "Eve" sends "Ann" an offer that is not a session description
    Then "Ann" never answered "Eve"
    And after 3 seconds "Ann" has seen no one join

  Scenario: an offer sent twice gets the same answer, and the peers connect
    Given "Eve" speaks the signaling herself, with a key below "Ann"'s
    When "Ann" opens the room "lobby-1234"
    And "Eve" joins the room "lobby-1234" in the applet "chess" and offers "Ann" a connection twice
    Then "Ann" answered "Eve" twice with the same answer
    And "Ann" sees "Eve" join

  Scenario: a room holds at most eight others, and those who never connect are let go
    Given nine strangers with keys above "Ann"'s
    When "Ann" opens the room "lobby-1234"
    And the nine strangers say hello in "lobby-1234"
    Then "Ann" offers a connection to 8 of them, again and again
    When 61 seconds pass
    Then "Ann" stops offering to them
    When the ninth stranger says hello in "lobby-1234" again
    Then "Ann" offers a connection to the ninth stranger

  Scenario Outline: rooms are kept apart by the applet's publisher, kind and name, the same for every version
    Then the rooms of an applet catalogued as "<catalogue id>" by "<publisher>" are kept under "<namespace>"

    Examples:
      | catalogue id                   | publisher | namespace        |
      | nip5d:35129:ab12:chess         | ab12      | ab12:35129:chess |
      | nip5d:15129:ab12               | ab12      | ab12:15129:      |
      | nip5d:5129:9f00                | ab12      | ab12:5129:9f00   |

  Scenario: the signaling refuses a scope it does not know and a session it does not hold
    Then a signaling session for a "broadcast" scope is refused with "invalid scope"
    And a send for a session the window does not hold is refused with "session not found"
    And a session with no relays to introduce it is refused with "signaling unavailable"
    And a window that ends closes the sessions it opened, even without an approval signal
