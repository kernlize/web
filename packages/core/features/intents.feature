Feature: Applets handing work to each other
  An applet asks for a role and an action ("open a profile"), never for another
  applet. The shell resolves the request against the applets the user has
  installed, using the user's defaults, their published handler preferences and,
  when that does not settle it, their own choice. A handler the user picks from
  the store is used for that request only. Accepted requests are delivered to the
  target once it can receive them, whether or not the asking applet is still open.

  Rule: the installed set

    Scenario: installing a verified applet records what it takes
      Given an intent store
      When the user installs "profiles" taking "profile" requests "napplet:profile/open,napplet:profile/edit"
      Then the installed applets are "profiles"
      And the intent catalogue offers "profiles" for role "profile" with conventions "napplet:profile/open,napplet:profile/edit"

    Scenario: re-installing keeps its place and install time, and removing forgets it
      Given an intent store
      When the user installs "profiles" taking "profile" requests "napplet:profile/open"
      And the user installs "notes" taking "" requests ""
      And the clock moves on
      And the user installs "profiles" taking "profile" requests "napplet:profile/edit"
      Then the installed applets are "profiles,notes"
      And "profiles" was installed at the first time
      And the intent catalogue offers "profiles" for role "profile" with conventions "napplet:profile/edit"
      When the user removes "profiles"
      And the user removes "missing"
      Then the installed applets are "notes"
      And the intent catalogue is empty

    Scenario: the installed set survives a reload and ignores what it cannot read
      Given an intent store
      When the user installs "profiles" taking "profile" requests "napplet:profile/open"
      And the intent store is reloaded
      Then the installed applets are "profiles"
      When the stored installed list is "{\"not\":\"a list\"}"
      And the intent store is reloaded
      Then the installed applets are ""
      When the stored installed list is "[{\"catalogId\":1},null,\"x\"]"
      And the intent store is reloaded
      Then the installed applets are ""

    Scenario: a contract the dispatcher would refuse is dropped, not fatal
      Given an intent store
      When the user installs "odd" with raw contracts "Bad Slug>napplet:bad/open,profile>napplet:other/open,profile>napplet:profile/open"
      Then the intent catalogue offers "odd" for role "profile" with conventions "napplet:profile/open"
      When the user installs "odd" with raw contracts "profile>napplet:other/open"
      Then the intent catalogue is empty

  Rule: handler preferences, as the user's account publishes them

    Scenario Outline: references and catalogue ids map both ways
      Then the reference "<ref>" is catalogue id "<id>"

      Examples:
        | ref                                                                                  | id                                                                                         |
        | 35129:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:notes:v2       | nip5d:35129:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:notes:v2       |
        | 15129:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:              | nip5d:15129:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa                |
        | bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb                     | nip5d:5129:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb                 |

    Scenario Outline: what is not a reference
      Then "<value>" is neither a reference nor a catalogue id

      Examples:
        | value                                                                           |
        | 35129:nothex:notes                                                              |
        | 15129:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:extra    |
        | other:35129:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x  |
        | nip5d:35129:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa    |
        | nip5d:15129:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:x  |
        | nip5d:5129:nothex                                                               |
        | nip5d:35129:nothex:x                                                            |
        | nip5d:1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa        |

    Scenario: a preference event is read leniently
      Given a handler preference event for "profile" with tags:
        | tag | value                       | extra                     |
        | a   | named:viewer                | wss://relay.one           |
        | a   | named:viewer                |                           |
        | e   | snapshot:pinned             |                           |
        | a   | named-bad                   |                           |
        | e   | not-hex                     |                           |
        | a   | root                        |                           |
        | i   | napplet:profile/edit        | named:editor              |
        | i   | napplet:profile/edit        | snapshot:pinned           |
        | i   | napplet:note/edit           | named:editor              |
        | i   | napplet:profile/edit?x=1    | named:editor              |
        | i   | napplet:profile/open        | nonsense                  |
        | x   | anything                    |                           |
        | a   | -                           |                           |
      Then the preferences for "profile" list handlers "named:viewer,snapshot:pinned,root"
      And the preferences for "profile" list "napplet:profile/edit" handlers "named:editor,snapshot:pinned"
      And the preferred handlers for "napplet:profile/edit" are "named:editor,snapshot:pinned"
      And the preferred handlers for "napplet:profile/open" are "named:viewer,snapshot:pinned,root"

    Scenario: an event that is not a preference is not read
      Then a kind 1 event is not a handler preference
      And a preference event without an archetype is not a handler preference
      And with no preferences nothing is preferred

    Scenario: choosing a handler puts it first and keeps everything else
      Given a handler preference event for "profile" with tags:
        | tag | value                | extra        |
        | a   | named:viewer         |              |
        | a   | named:editor         |              |
        | i   | napplet:profile/edit | named:editor |
      When the shell writes "named:editor" as the preference for "profile"
      Then the written preference tags are "d:profile,a:named:editor,a:named:viewer,i:napplet:profile/edit" with the old content
      When the shell writes "snapshot:pinned" as the preference for "profile" with nothing before
      Then the written preference tags are "d:profile,e:snapshot:pinned" with empty content
      And a preference cannot be written for "nip5d:1:x"

  Rule: the user's defaults

    Scenario: defaults are remembered on this device and stay private unless the user shares them
      Given handler defaults for a signed-in account that can sign
      When the user makes "named:viewer" the default for "profile"
      Then the default for "profile" is "named:viewer"
      And the defaults are "profile=named:viewer"
      And no preference was published
      When the handler defaults are reloaded
      Then the default for "profile" is "named:viewer"
      When the user forgets the default for "profile"
      Then the defaults are ""
      And the default changes heard were "profile,profile"

    Scenario: with sharing on, a choice is published to the account's relays
      Given handler defaults for a signed-in account that can sign
      When the user turns sharing on
      And the user makes "named:viewer" the default for "profile"
      And the user makes "named:editor" the default for "profile"
      Then the last published preference for "profile" lists "a:named:editor,a:named:viewer" on "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net"
      And sharing is on after a reload
      When the user turns sharing off
      Then sharing is off after a reload

    Scenario: sharing does nothing an account cannot sign or a relay refuses
      Given handler defaults for a read-only account
      When the user turns sharing on
      And the user makes "named:viewer" the default for "profile"
      Then no preference was published
      Given handler defaults for a signed-in account that can sign
      And relays refuse publishes
      When the user turns sharing on
      And the user makes "named:viewer" the default for "profile"
      Then the default for "profile" is "named:viewer"

    Scenario: the account's published preferences are read, newest and genuine only
      Given handler defaults for a signed-in account that can sign
      And the account published preferences "profile@1:named:old,profile@5:named:viewer,note@2:named:notes"
      And someone else published a preference for "profile"
      And a forged preference for "profile" is on the relays
      When the handler defaults load the account's preferences
      Then the published preferences for "profile" list handlers "named:viewer"
      And the published preferences for "note" list handlers "named:notes"
      And the default changes heard were "profile,note"
      And the preference request asked for the account's kind 31129 events

    Scenario: preferences are forgotten when the account changes, and a dead relay is no error
      Given handler defaults for a signed-in account that can sign
      And the account published preferences "profile@5:named:viewer"
      When the handler defaults load the account's preferences
      And the account signs out
      And the handler defaults load the account's preferences
      Then there are no published preferences for "profile"
      Given the fake pool fails requests
      And the account signs back in
      When the handler defaults load the account's preferences
      Then there are no published preferences for "profile"

  Rule: routing a request

    Background:
      Given an intent router over installed applets "viewer:profile/open,editor:profile/open+profile/edit,notes:"
      And the asking applet is "notes"

    Scenario: the one applet that can do it gets it
      When the asking applet invokes "napplet:profile/edit" with payload "pubkey=abc"
      Then the request went to "editor"
      And "editor" received "profile/edit" from "notes" with payload "pubkey=abc"
      And nobody was asked to choose

    Scenario: the user's default is used without asking
      Given the user's default for "profile" is "viewer"
      When the asking applet invokes "napplet:profile/open"
      Then the request went to "viewer"
      And nobody was asked to choose

    Scenario: a default for an applet that is no longer installed is ignored
      Given the user's default for "profile" is "gone"
      And the user will pick "editor"
      When the asking applet invokes "napplet:profile/open"
      Then the request went to "editor"

    Scenario: the user chooses, and can make it the default
      Given the user will pick "viewer" and remember it
      When the asking applet invokes "napplet:profile/open"
      Then the request went to "viewer"
      And the user was asked about "profile/open" from "Notes" with options "Viewer,Editor" none preferred
      And the default for "profile" is "viewer"

    Scenario: the user cancels
      Given the user will cancel
      When the asking applet invokes "napplet:profile/open"
      Then the request was refused with "user cancelled"
      And nothing was delivered

    Scenario: without a chooser several handlers cannot be decided
      Given the shell has no chooser
      When the asking applet invokes "napplet:profile/open"
      Then the request was refused with "invoke rejected"

    Scenario: a published preference decides between handlers
      Given the account prefers "editor" for "profile"
      When the asking applet invokes "napplet:profile/open"
      Then the request went to "editor"
      And nobody was asked to choose

    Scenario: several published preferences are offered first
      Given the account prefers "editor,viewer" for "profile"
      And the user will pick "viewer"
      When the asking applet invokes "napplet:profile/open"
      Then the user was asked about "profile/open" from "Notes" with options "Editor,Viewer" preferred "Editor,Viewer"

    Scenario: an applet that asks to choose always gets the chooser
      Given the account prefers "editor" for "profile"
      And the user will pick "viewer"
      When the asking applet invokes "napplet:profile/open" asking to choose
      Then the request went to "viewer"

    Scenario: a recommendation the user has installed is used
      Given the user will cancel
      When the asking applet invokes "napplet:profile/open" recommending "viewer"
      Then the request went to "viewer"
      And nobody was asked to choose

    Scenario: a recommendation that is not installed is passed to the chooser
      Given the user will pick "editor"
      When the asking applet invokes "napplet:profile/open" recommending "elsewhere"
      Then the request went to "editor"
      And the chooser was shown the recommendation "elsewhere"

    Scenario: an applet cannot address a handler the user did not choose
      Given the user will pick "viewer"
      When the asking applet invokes "napplet:profile/open" addressed to "editor"
      Then the request was refused with "invoke rejected"
      And nobody was asked to choose

    Scenario: with nothing installed that can do it, the user can install one from the store
      Given the user will install "maps" taking "place/open" and pick it
      When the asking applet invokes "napplet:place/open"
      Then the request went to "maps"
      And the user was asked about "place/open" from "Notes" with options "" none preferred
      And "notes" cannot address "maps" again without the user

    Scenario: an applet installed from the store while choosing between installed ones is used
      Given the user will install "atlas" taking "profile/open" and pick it
      When the asking applet invokes "napplet:profile/open"
      Then the request went to "atlas"

    Scenario: nothing installed and nothing chosen keeps the original reason
      Given the user will pick "nobody"
      When the asking applet invokes "napplet:place/open"
      Then the request was refused with "no handler"
      When the asking applet invokes "napplet:profile/delete"
      Then the request was refused with "unsupported action"

    Scenario: an addressed request is not offered the store
      Given the user will pick "viewer"
      When the asking applet invokes "napplet:place/open" addressed to "viewer"
      Then the request was refused with "no handler"
      And nobody was asked to choose

    Scenario: a choice the user cannot save is still used
      Given saving defaults fails
      And the user will pick "viewer" and remember it
      When the asking applet invokes "napplet:profile/open"
      Then the request went to "viewer"

    Scenario: availability comes from the installed set and changes are announced
      When the asking applet asks who can take "profile"
      Then the availability for "profile" lists "viewer,editor"
      And every role the installed applets take is listed as "profile"
      When the router announces a change to "profile"
      Then a change to "profile" was heard

  Rule: delivering an accepted request

    Background:
      Given an intent delivery over installed applets "viewer:profile/open"

    Scenario: a running handler is reused and brought forward
      Given "viewer" is running in window "w1"
      When the shell delivers "profile/open" to "viewer" with payload "pubkey=abc"
      Then window "w1" received "profile/open" with payload "pubkey=abc"
      And window "w1" was brought forward
      And nothing was opened

    Scenario: hints ask for a new window, or for no focus
      Given "viewer" is running in window "w1"
      And the host opens new windows as "w2"
      When the shell delivers "profile/open" to "viewer" asking not to reuse
      Then window "w2" received "profile/open" without a payload
      When the shell delivers "profile/open" to "viewer" asking not to focus
      Then window "w1" was not brought forward

    Scenario: a handler that is not running is opened, then delivered to once it can receive
      Given the host opens new windows as "w2"
      And window "w2" can receive after 3 tries
      When the shell delivers "profile/open" to "viewer"
      Then the host opened the viewer's address
      And window "w2" received "profile/open" without a payload

    Scenario Outline: deliveries that fail for good
      Given <setup>
      When the shell delivers "profile/open" to "<handler>" expecting failure
      Then the delivery failed with "<reason>"

      Examples:
        | setup                                    | handler | reason                |
        | the host opens nothing                   | viewer  | unavailable:window    |
        | the host opens new windows as "w2"       | gone    | unavailable:handler   |
        | the host opens a window that never receives | viewer  | unavailable:delivery  |

    Scenario: with no focus hook a reused window is simply delivered to
      Given a delivery without a focus hook running "viewer" in window "w1"
      When the shell delivers "profile/open" to "viewer"
      Then window "w1" received "profile/open" without a payload
