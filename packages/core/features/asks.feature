Feature: Asks: the host draws each question the kernel puts to the person
  A host registers one renderer per kind of question in `KernlHost.asks`. Each
  ask carries its facts and kernl's own words, which the host may reword. A kind
  the host has no renderer for is refused. A module asks only the kinds it
  declared (D-067).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Rule: a renderer gets the facts and kernl's words, and its answer is applied

    Scenario: the signing renderer gets the draft, the applet and kernl's words
      Given a kernl shell over that host and pool whose host draws "sign.replace" and answers later
      And the shell is signed in
      And a mounted applet granted "relay" that has said hello
      When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
      Then the host drew a "sign.replace" ask for the mounted window
      And the ask names the applet "chat", carries a kind 0 draft and says "Update your profile"
      When the host answers the ask no
      Then the applet's publish failed with "denied:consent"
      And the fake pool published nothing

    Scenario: the firewall renderer draws a link question with its facts and kernl's words
      Given a kernl shell over that host and pool whose host draws "firewall.approve" and answers later
      And a mounted applet granted "link" that has said hello
      When the applet asks to open link 1 at "https://example.com/a"
      Then the host drew a firewall ask saying "Open a link outside kernl" about "link.open" of "https://example.com/a"
      When the host answers the ask with "allow-once"
      Then link 1 was "opened"

  Rule: a module asks only the kinds it declared

    Scenario: a kind a module did not declare is refused before anyone is asked
      Given a kernl shell over that host and pool whose host draws nothing, with modules "asker"
      When the "asker" module asks "upload.file"
      Then the module's ask was refused with "invalid:ask-undeclared:upload.file"
      When the "asker" module asks "connection.direct"
      Then the module's ask was answered no
      And the "asker" module is told the host draws no "connection.direct"
