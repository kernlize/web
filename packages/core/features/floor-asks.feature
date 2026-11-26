Feature: Floor: the kernel decides what is asked, and a question nobody draws is refused
  The host draws every question the kernel puts to the person, one renderer
  per kind; the kernel decides that the person is asked and what they are
  told. A kind the host does not draw is refused, never allowed. A renderer
  that fails is a refusal. An answer applies only to the window that asked.
  Only a question a decision already bounds is timed out, and no ask carries
  the shell's own secrets, the passwords and keys it signs in with (D-052,
  D-067).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Rule: an ask with no renderer is answered with its refusal

    Scenario Outline: each kind nobody draws is refused
      Given an ask channel over a host that draws nothing
      When the kernel asks "<kind>"
      Then the ask was answered <refusal>

      Examples:
        | kind                   | refusal      |
        | sign.replace           | no           |
        | upload.file            | no           |
        | download.add           | no           |
        | connection.direct      | no           |
        | firewall.approve       | with nothing |
        | intent.choose-handler  | with nothing |
        | messaging.choose-reply | with nothing |
        | settings.present       | with nothing |

    Scenario Outline: a shell whose host draws nothing refuses a profile change, and nothing throws
      Given the shell loads <modules> modules
      And a kernl shell over that host and pool whose host draws nothing
      And the shell is signed in
      And a mounted applet granted "relay" that has said hello
      When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
      Then the applet was answered once the record it would replace was looked for
      And the applet's publish failed with "denied:consent"
      And the fake pool published nothing

      Examples:
        | modules |
        | kernl's |
        | no      |
        | the example host's |

    Scenario Outline: a renderer that fails is a refusal
      Given an ask channel over a host whose "sign.replace" renderer <fails>
      When the kernel asks "sign.replace"
      Then the ask was answered no

      Examples:
        | fails   |
        | throws  |
        | rejects |

  Rule: an answer applies only to the window that asked

    Scenario: an answer given after the asking window closed signs nothing
      Given a kernl shell over that host and pool whose host draws "sign.replace" and answers later
      And the shell is signed in
      And a mounted applet granted "relay" that has said hello
      When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
      Then the host drew a "sign.replace" ask for the mounted window
      When the shell closes the mounted applet
      And the host answers the ask yes
      Then the fake pool published nothing

    Scenario: the same answer while the window is open is applied
      Given a kernl shell over that host and pool whose host draws "sign.replace" and answers later
      And the shell is signed in
      And a mounted applet granted "relay" that has said hello
      When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
      Then the host drew a "sign.replace" ask for the mounted window
      When the host answers the ask yes
      Then the fake pool published a kind 0 event

    Scenario: a download the person allows after the asking window closed starts nothing
      Given a kernl shell that offers the download domains, with a Transmission program that signs in with a password, whose host draws "download.add"
      And a mounted applet granted "torrent" that has said hello
      When the applet asks to add the magnet for "abcdef0123456789abcdef0123456789abcdef01" over its port
      Then the host drew a "download.add" ask for the mounted window
      When the shell closes the mounted applet
      And the host answers the ask yes
      Then the real program was asked to add nothing

    Scenario: the same download allowed while the window is open is added
      Given a kernl shell that offers the download domains, with a Transmission program that signs in with a password, whose host draws "download.add"
      And a mounted applet granted "torrent" that has said hello
      When the applet asks to add the magnet for "abcdef0123456789abcdef0123456789abcdef01" over its port
      Then the host drew a "download.add" ask for the mounted window
      When the host answers the ask yes
      Then the applet is told the torrent was added
      And the real program was asked to add that torrent

    Scenario: an answer for a window now running another applet applies to nothing
      Given an ask channel whose windows run other applets than the ones that asked, over a host that answers "sign.replace" yes
      When the kernel asks "sign.replace" for window "applet-1"
      Then the ask was answered no

  Rule: the kernel times out only the questions a decision already bounds

    Scenario: a consent ask waits for the person however long they take
      Given an ask channel over a host whose "sign.replace" renderer answers yes after an hour
      When the kernel asks "sign.replace" and an hour passes
      Then the ask was answered yes

  Rule: no ask carries the shell's own secrets

    Scenario: a download question for a program that signs in with a password does not carry it
      Given a kernl shell that offers the download domains, with a Transmission program that signs in with a password, whose host draws "download.add"
      And a mounted applet granted "torrent" that has said hello
      When the applet asks to add the magnet for "abcdef0123456789abcdef0123456789abcdef01" over its port
      Then the host drew a "download.add" ask for the mounted window
      And no ask the host drew carries the program's password
