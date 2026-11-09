Feature: The preview kernl
  The preview is the shell with nothing behind it: the real guard, grants,
  messaging and bridge packages over in-memory state, two sample applets and a
  static applet document instead of verified bytes. It answers the sample
  applet's requests under the grants in its mount plan, asks before destructive
  publishes as the live core does, and stops an applet that floods the shell.

  Background:
    Given a preview kernl

  Scenario: a fresh preview is signed out behind a strict guard, with its bridges routed
    Then the preview kernl has no session
    And the preview kernl guard profile is "strict"
    And every preview kernl bridge is routed by each of its schemes

  Scenario: a guard profile change lasts until reload
    When the preview kernl guard profile is set to "relaxed"
    Then the preview kernl guard profile is "relaxed"
    And the preview kernl guard describes its mitigations and can release window "preview-1"

  Scenario: a read-only account without a name is labelled by its key
    When the preview kernl logs in a read-only account
    And the preview kernl logs in the same account again
    Then the preview kernl session is labelled with the abbreviated key
    And the preview kernl session read-only is "true"
    And the preview kernl holds 1 account

  Scenario: a named key account is labelled by its name and can sign
    When the preview kernl logs in a key account named "Ada"
    Then the preview kernl session is labelled "Ada"
    And the preview kernl session read-only is "false"

  Scenario: signing out closes every applet and forgets the session
    Given the preview kernl logs in a read-only account
    And the preview kernl mounts "notes" in frame "a"
    When the preview kernl logs out
    Then the preview kernl has no session
    And the preview kernl applet in frame "a" is "closed"
    And the preview kernl frame "a" is removed
    And the preview kernl lists 0 applets

  Scenario: an empty pointer is refused
    When the preview kernl decodes "   "
    Then the preview kernl refused with "invalid:pointer"

  Scenario: a sample address decodes and resolves to its applet
    When the preview kernl decodes " preview:notes "
    Then the preview kernl pointer is an address for "notes"
    When the preview kernl resolves the decoded pointer
    Then the preview kernl resolved the applet "Notes"

  Scenario: anything else is an event the offline preview cannot fetch
    When the preview kernl decodes "nevent1abc"
    Then the preview kernl pointer is an event "nevent1abc"
    When the preview kernl resolves the decoded pointer
    Then the preview kernl refused with "unavailable:preview-offline"

  Scenario: an address that is not a sample cannot be fetched either
    When the preview kernl resolves the address "elsewhere"
    Then the preview kernl refused with "unavailable:preview-offline"

  Scenario: a plan without grants carries only the baseline and names what is missing
    When the preview kernl plans "notes"
    Then the preview kernl plan is for window "preview-1"
    And the preview kernl plan grants "" beyond the baseline
    And the preview kernl plan is missing "relay,identity,intent"

  Scenario: granted domains join the plan and every plan gets its own window
    Given the preview kernl user granted "relay" to "notes"
    When the preview kernl plans "pulse"
    And the preview kernl plans "notes"
    Then the preview kernl plan is for window "preview-2"
    And the preview kernl plan grants "relay" beyond the baseline
    And the preview kernl plan is missing "identity,intent"

  Scenario: a blocked applet is not planned
    Given the preview kernl user blocked "notes"
    When the preview kernl plans "notes"
    Then the preview kernl refused with "denied:blocked"

  Scenario: mounting sandboxes the frame before it gets the document, and closing removes it once
    When the preview kernl mounts "notes" in frame "a"
    Then the preview kernl frame "a" is sandboxed and holds the applet document
    And the preview kernl applet in frame "a" is "mounting"
    And the preview kernl lists 1 applet
    When the preview kernl hides the applet in frame "a"
    And the preview kernl closes the applet in frame "a"
    And the preview kernl closes the applet in frame "a"
    Then the preview kernl applet in frame "a" is "closed"
    And the preview kernl frame "a" is removed
    And the preview kernl lists 0 applets

  Scenario: the applet's hello marks it running
    Given the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"hello"}'
    Then the preview kernl applet in frame "a" is "running"
    And the preview kernl frame "a" is answered "yes" with "Connected to the shell."

  Scenario Outline: a request the applet has no grant for is refused in plain words
    Given the preview kernl mounts "pulse" in frame "a"
    When the preview kernl frame "a" posts '<message>'
    Then the preview kernl frame "a" is answered "no" with "Refused: this applet has no grant for"
    And the preview kernl user was asked 0 times

    Examples:
      | message                                   |
      | {"kernlPreview":"publish","text":"hi"}    |
      | {"kernlPreview":"profile","text":"Ada"}   |
      | {"kernlPreview":"delete"}                 |
      | {"kernlPreview":"contacts"}               |
      | {"kernlPreview":"servers"}                |
      | {"kernlPreview":"vanish"}                 |
      | {"kernlPreview":"notify","text":"hello"}  |
      | {"kernlPreview":"subscribe"}              |
      | {"kernlPreview":"intent","text":"abc"}    |

  Scenario Outline: a routine publish goes straight out
    Given the preview kernl user granted "relay" to "notes"
    And the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '<message>'
    Then the preview kernl frame "a" is answered "yes" with "done (preview)."
    And the preview kernl user was asked 0 times

    Examples:
      | message                                |
      | {"kernlPreview":"publish","text":"hi"} |
      | {"kernlPreview":"publish"}             |

  Scenario Outline: a destructive publish waits for the user
    Given the preview kernl user granted "relay" to "pulse"
    And the preview kernl mounts "pulse" in frame "a"
    And the preview kernl user will answer "<answer>"
    When the preview kernl frame "a" posts '<message>'
    Then the preview kernl frame "a" is answered "<answer>" with "<words>"
    And the preview kernl user was asked 1 time

    Examples:
      | message                                 | answer | words           |
      | {"kernlPreview":"profile","text":"Ada"} | yes    | done (preview). |
      | {"kernlPreview":"delete"}               | no     | you said no.    |
      | {"kernlPreview":"contacts"}             | yes    | done (preview). |
      | {"kernlPreview":"servers"}              | no     | you said no.    |
      | {"kernlPreview":"vanish"}               | yes    | done (preview). |

  Scenario: a granted notification is shown by the host
    Given the preview kernl user granted "notify" to "notes"
    And the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"notify","text":"Saved"}'
    Then the preview kernl host was notified "Saved" for frame "a"
    And the preview kernl frame "a" is answered "yes" with "Notification shown."

  Scenario: a granted notification without words still shows
    Given the preview kernl user granted "notify" to "notes"
    And the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"notify"}'
    Then the preview kernl host was notified "" for frame "a"

  Scenario: a granted subscription is silent in the preview
    Given the preview kernl user granted "relay" to "notes"
    And the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"subscribe"}'
    Then the preview kernl frame "a" hears nothing

  Scenario: only secure links are handed to the host
    Given the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"link","url":"https://example.org/a"}'
    And the preview kernl frame "a" posts '{"kernlPreview":"link","url":"http://example.org/b"}'
    And the preview kernl frame "a" posts '{"kernlPreview":"link"}'
    Then the preview kernl host opened "https://example.org/a"
    And the preview kernl frame "a" hears nothing

  Scenario: an unknown request is answered with its name
    Given the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"dance"}'
    Then the preview kernl frame "a" is answered "no" with "Unknown request dance."

  Scenario Outline: messages that are not the applet's requests are ignored
    Given the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '<data>'
    And a stranger posts '{"kernlPreview":"hello"}' to the preview kernl
    Then the preview kernl frame "a" hears nothing
    And the preview kernl applet in frame "a" is "mounting"

    Examples:
      | data                  |
      | null                  |
      | "hello"               |
      | {"kernlPreview":3}    |

  Scenario: a frame that has lost its window is still served without a reply
    Given the preview kernl mounts "notes" in a detached frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"hello"}'
    Then the preview kernl applet in frame "a" is "running"

  Scenario: an applet that floods the shell is stopped and the host is told
    Given the preview kernl mounts "pulse" in frame "a"
    When the preview kernl frame "a" floods the shell
    And the preview kernl closes the applet in frame "a"
    Then the preview kernl applet in frame "a" is "revoked"
    And the preview kernl frame "a" is removed
    And the preview kernl host heard frame "a" revoked for "quarantine"
    And the preview kernl host heard 1 revocation
    And the preview kernl lists 0 applets

  Scenario: a message that arrives while the applet is being stopped does not stop it twice
    Given the preview kernl mounts "pulse" in frame "a"
    When the preview kernl frame "a" floods the shell and keeps sending while it is stopped
    Then the preview kernl applet in frame "a" is "revoked"
    And the preview kernl host heard 1 revocation

  Scenario: a flood that lands while the applet is closing does not turn the close into a revocation
    Given the preview kernl mounts "pulse" in frame "a"
    When the preview kernl frame "a" nearly floods the shell and floods it while closing
    Then the preview kernl applet in frame "a" is "closed"
    And the preview kernl host heard 0 revocations

  Scenario: destroying the preview closes every applet
    Given the preview kernl mounts "notes" in frame "a"
    And the preview kernl mounts "pulse" in frame "b"
    When the preview kernl is destroyed
    Then the preview kernl frame "a" is removed
    And the preview kernl frame "b" is removed
    And the preview kernl lists 0 applets

  Scenario: a shared download is handed to an app on the user's device
    Given the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"download","url":"magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix"}'
    Then the preview kernl frame "a" is answered "yes" with "Handed to an app on your device."
    And the preview kernl host opened 1 link

  Scenario: a shared download joins the user's downloads when kernl downloads them
    Given a preview kernl that downloads in kernl
    And the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"download","url":"magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix"}'
    Then the preview kernl frame "a" is answered "yes" with "Added to your downloads."
    And the preview kernl host opened 0 links

  Scenario Outline: a download that cannot be handed off is answered in plain words
    Given the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '<message>'
    Then the preview kernl frame "a" is answered "no" with "The download could not be handed off."
    And the preview kernl host opened 0 links

    Examples:
      | message                                            |
      | {"kernlPreview":"download","url":"nope"}           |
      | {"kernlPreview":"download","url":"http://x/a.nzb"} |
      | {"kernlPreview":"download"}                        |

  Scenario: the preview's people are named, and anyone else reads as a short key
    Then the preview kernl names the correspondent "Ada", the publisher "kernl samples" and its own account "Preview account"
    And the preview kernl names key "ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef0123456789" by its short form

  Scenario: the preview account has no inbox or outbox until it saves one, and every server accepts it
    Then the preview kernl mailboxes are missing, suggesting 3 inboxes and 3 outboxes
    And the preview kernl directory suggests 3 lookup servers and completes nothing for "nos"
    When the preview kernl saves inbox "wss://in.test" and outbox "wss://out.test,wss://in.test"
    Then the preview kernl save was accepted by 2 servers
    And the preview kernl mailboxes are found with inbox "wss://in.test" and outbox "wss://out.test,wss://in.test"
    When the preview kernl saves inbox "" and outbox ""
    Then the preview kernl save was accepted by 0 servers

  Scenario: the preview's tiers can be replaced at once
    When the preview kernl sets the "outbox" tier to "wss://a.test,wss://a.test"
    Then the preview kernl "outbox" tier is "wss://a.test"
    And the preview kernl refuses to set the "outbox" tier to "https://a.test"

  Scenario: the store lists the preview's applets, and running one installs it
    Then the preview kernl store lists "Notes,Pulse,Profiles"
    And the preview kernl store streams "Notes,Pulse,Profiles"
    When the preview kernl plans "notes"
    And the preview kernl installs "profiles" without running it
    Then the preview kernl has installed "Notes,Profiles"

  Scenario: an applet asks for a profile, none of the user's applets can show one, and the user picks one from the store
    Given the preview kernl user granted "relay,identity,intent" to "notes"
    And the preview kernl user granted "intent" to "profiles"
    And the preview kernl user will pick "profiles" from the store
    When the preview kernl mounts "notes" in frame "n"
    And the preview kernl frame "n" posts '{"kernlPreview":"hello"}'
    And the preview kernl frame "n" posts '{"kernlPreview":"intent","text":"abc"}'
    Then the preview kernl frame "n" is answered "yes" with "Profiles is taking it."
    And the preview kernl user was offered no installed applet for "profile/open" from "Notes"
    And the preview kernl desktop opened "preview:profiles"
    And the preview kernl frame "opened-profiles" was handed "Notes asked this applet to open a profile."

  Scenario: a running applet that can take the request gets it without a question
    Given the preview kernl user granted "relay,identity,intent" to "notes"
    And the preview kernl user granted "intent" to "profiles"
    When the preview kernl mounts "profiles" in frame "p"
    And the preview kernl frame "p" posts '{"kernlPreview":"hello"}'
    And the preview kernl mounts "notes" in frame "n"
    And the preview kernl frame "n" posts '{"kernlPreview":"intent","text":"abc"}'
    Then the preview kernl frame "n" is answered "yes" with "Profiles is taking it."
    And the preview kernl frame "p" was handed "Notes asked this applet to open a profile."
    And the preview kernl desktop opened nothing and brought the applet in frame "p" forward
    And the preview kernl user was not asked to choose an applet

  Scenario: the user cancels the choice
    Given the preview kernl user granted "relay,identity,intent" to "notes"
    When the preview kernl mounts "notes" in frame "n"
    And the preview kernl frame "n" posts '{"kernlPreview":"intent","text":"abc"}'
    Then the preview kernl frame "n" is answered "no" with "Nobody took it (no handler)."

  Scenario Outline: a request that cannot be delivered is reported to the user
    Given the preview kernl user granted "relay,identity,intent" to "notes"
    And the preview kernl has "profiles" installed
    And <setup>
    When the preview kernl mounts "notes" in frame "n"
    And the preview kernl frame "n" posts '{"kernlPreview":"intent","text":"abc"}'
    Then the preview kernl frame "n" is answered "yes" with "Profiles is taking it."
    And the preview kernl host was warned "Profiles could not take the request" because '<because>'

    Examples:
      | setup                                                   | because                                                    |
      | the preview kernl desktop opens a window that is gone   | It needs "opening other applets" switched on in its grants. |
      | the preview kernl mounts "profiles" in frame "p"        | It needs "opening other applets" switched on in its grants. |
      | the preview kernl runs "profiles" in frame "p"          | It needs "opening other applets" switched on in its grants. |
