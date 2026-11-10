Feature: The composed shell
  createKernl builds one store, one pool, one account manager, the guard, the
  grants and kehto's bridge, and runs an applet through decode, resolve, plan
  and mount with the guard in front of the bridge.

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: a fresh shell has no session, the strict guard and the default relays
    Given a kernl shell over that host and pool without a blob fetcher
    Then the shell session is null
    And the shell guard profile is "strict" with mitigations described
    And the shell relays "apps" tier is "wss://relay.napplet.soy,wss://relay.ditto.pub,wss://relay.nostr.com"
    And the shell messaging provider "private" is unavailable
    And the shell bridges are "http,torrent,nzb,soulseek,mail"
    And the frame policy meta locks frame navigation
    And the runtime ACL refuses "relay:read" to an applet the user never granted anything
    And the runtime firewall scales unfocused budgets by 0.25 and allows 8 operations in a window's first 1000 ms

  Scenario: the shell's downloads, sharing and mail hand off through the host's link opener
    Given a kernl shell over that host and pool without a blob fetcher
    Then the shell bridge for "magnet" hands off to the device
    When the shell bridges resolve "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix"
    Then the host was asked to open "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Mix" once

  Scenario: a torrent backend makes magnet links download inside kernl
    Given a kernl shell over that host and pool with a torrent backend
    Then the shell bridge for "magnet" downloads inside kernl
    And the shell bridge for "mailto" hands off to the device
    When the shell bridges resolve "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix"
    Then the torrent backend was asked for "abcdef0123456789abcdef0123456789abcdef01"
    And the host was asked to open nothing

  Scenario: host-supplied parts are used as they are
    Given a kernl shell over that host and pool with its own store, accounts, messaging, bridges, relays, a "balanced" guard, a theme, a clock and a blob fetcher
    Then the shell guard profile is "balanced" with mitigations described
    And the shell relays "apps" tier is "wss://apps.example"
    And the shell uses the supplied store, accounts, messaging and bridges
    When the shell resolves the manifest address
    Then the shell summary is "chat" requiring "relay"
    And the host blob fetcher was used
    And the supplied artifact cache was consulted

  Scenario: a shell without a supplied pool owns one and closes it when destroyed
    Given a kernl shell over that host without a pool
    Then the shell pool is its own
    When the shell is destroyed
    Then the shell pool is closed

  Scenario: a supplied private backend is available while the signed-in account can encrypt
    Given a kernl shell over that host and pool with a private backend
    Then the shell messaging provider "private" is unavailable because "sign-in-required"
    When the shell logs in with a password account named "alice"
    Then the shell messaging provider "private" is available
    When the shell logs in with a read-only account
    Then the shell messaging provider "private" is unavailable because "signer-cannot-encrypt"
    When the shell logs out
    Then the shell messaging provider "private" is unavailable because "sign-in-required"

  Scenario: kernl's own message backends follow the active account
    Given a kernl shell over that host and pool
    Then the shell messaging provider "legacy" is unavailable because "sign-in-required"
    And the shell messaging provider "ratchet" is unavailable because "sign-in-required"
    When the shell logs in with a password account named "alice"
    Then the shell messaging provider "ratchet" is available
    When the shell enables messaging provider "private" and "legacy"
    And the shell enables messaging provider "ratchet"
    Then the shell messaging status is available for the signed-in account
    When the shell is destroyed

  Scenario: someone who never chose a provider has two switched on once they sign in
    Given a kernl shell over that host and pool
    Then the shell's switched-on messaging providers are ""
    When the shell logs in with a password account named "alice"
    Then the shell's switched-on messaging providers are "private,legacy"
    And the shell's first messaging provider is "private"
    When the shell is destroyed

  Scenario: an applet reaches ratchet sessions through the dm domain
    Given a kernl shell over a message network serving that manifest
    And bob opens ratchet sessions on the same relays
    When the shell logs in with a password account named "alice"
    And the shell enables messaging provider "ratchet"
    And the shell resolves the manifest address
    And the shell allows "dm" for the resolved applet
    And the shell plans the summary
    And the shell mounts the plan into a fake frame
    And the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet subscribes to its messages over its port
    And the applet sends "hello from an applet" to bob with provider "ratchet" over its port
    Then the applet's sent message is namespaced "ratchet"
    And bob reads "hello from an applet" from the shell's account
    When bob replies "hello applet" to the shell's account
    Then the applet is pushed "hello applet" namespaced "ratchet"
    When the applet reads its "ratchet" conversation with bob over its port
    Then the applet's page holds "hello from an applet|hello applet" with every id namespaced "ratchet"
    And bob closes his ratchet sessions

  Scenario: an applet reaches group sessions through the dm domain
    Given a kernl shell over a message network serving that manifest
    And bob opens group sessions on the same relays
    Then the shell messaging provider "group" is unavailable because "sign-in-required"
    When the shell logs in with a password account named "alice"
    Then the shell messaging provider "group" is available
    When the shell enables messaging provider "group"
    And the shell resolves the manifest address
    And the shell allows "dm" for the resolved applet
    And the shell plans the summary
    And the shell mounts the plan into a fake frame
    And the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet asks for its message status over its port
    And the applet subscribes to its messages over its port
    And the applet sends "hello group" to bob in a new group over its port
    Then the applet's sent message is filed under a "group" group
    And bob reads "hello group" in his group with the shell's account
    When bob replies "hello from the group" in that group
    Then the applet is pushed "hello from the group" in that group
    And the applet lists that group among its conversations over its port
    When the applet reads that group over its port
    Then the applet's page holds "hello group|hello from the group" with every id namespaced "group"
    And bob closes his group sessions

  Scenario: logging in and out drives the session
    Given a kernl shell over that host and pool
    When the shell logs in with a password account named "alice"
    Then the shell session is for "alice" and can sign
    And the shell session stream saw 2 values
    When the shell logs in with the same account again
    Then the shell session stream saw 2 values
    When the shell logs in with a read-only account
    Then the shell session is read-only with an abbreviated label
    When the shell logs in with an account that has a name but no metadata
    Then the shell session label is "named"
    When the shell logs out
    Then the shell session is null

  Scenario: an account without a name of its own is labelled by its published profile
    Given a kernl shell over that host and pool
    And the fake pool serves a profile named "Satoshi" for a fresh key
    When the shell logs in read-only as that fresh key
    Then the shell session label eventually is "Satoshi"
    And the shell profile card for that fresh key is named "Satoshi"

  Scenario: the shell publishes where the signed-in account says it does
    Given a kernl shell over that host and pool
    And the fake pool serves a relay list writing to "wss://own.test" for a fresh key
    When the shell logs in read-only as that fresh key
    Then the "outbox" tier eventually is "wss://own.test/"
    And the shell mailboxes are found with outbox "wss://own.test/"
    And the shell directory suggests 3 inbox servers before it starts
    When the shell saves the account's inbox and outbox as "wss://own.test"
    Then the shell refused with "denied:read-only"
    When the shell logs out
    And the shell saves the account's inbox and outbox as "wss://own.test"
    Then the shell refused with "denied:read-only"
    When the shell logs in with a password account named "alice"
    And the shell saves the account's inbox and outbox as "wss://own.test"
    Then the shell's last save was accepted by "wss://own.test/"

  Scenario: an applet granted uploads asks the person before a file leaves, and a no cancels it
    Given a kernl shell over that host and pool
    Then the shell offers the "upload" domain
    When the shell logs in with a password account named "alice"
    And the shell resolves the manifest address
    And the shell allows "upload" for the resolved applet
    And the shell plans the summary
    And the shell mounts the plan into a fake frame
    And the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet uploads an 8-byte "image/png" file over its port
    Then the shell asks the person "Upload a file" marked "public", sending it to "blossom.primal.net, nostr.download, blossom.band"
    When the person answers no to the upload
    Then the applet is told its upload was "cancelled" with "denied:consent"
    When the shell saves the account's file servers as "https://mine.test"
    Then the shell's file servers are "https://mine.test/"

  Scenario: an applet granted social actions follows someone only after the person sees the change
    Given a kernl shell over that host and pool
    Then the shell offers the "common" domain
    When the shell logs in with a password account named "alice"
    And the shell resolves the manifest address
    And the shell allows "common" for the resolved applet
    And the shell plans the summary
    And the shell mounts the plan into a fake frame
    And the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet asks to follow "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" over its port
    Then the shell asks the person "Change who you follow" before signing
    When the person answers no to the follow
    Then the applet is told its follow failed with "denied:consent"

  Scenario: an applet granted settings registers its schema and opens the shell's form
    Given a kernl shell over that host and pool whose host shows settings
    When the shell logs in with a password account named "alice"
    And the shell resolves the manifest address
    And the shell allows "config" for the resolved applet
    And the shell plans the summary
    And the shell mounts the plan into a fake frame
    And the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet registers a settings schema with a "level" number and opens its settings over its port
    Then the host was shown the settings form for the resolved applet with "level" in its schema
    When the person sets "level" to 4 in the form
    Then the applet reads its settings as '{"level":4}' over its port

  Scenario: an applet is resolved, planned and mounted
    Given a kernl shell over that host and pool
    When the shell resolves the manifest address
    Then the shell summary is "chat" requiring "relay"
    When the shell plans the summary
    Then the shell plan is for window "applet-1" with domains "shell,storage,inc,theme"
    And the shell plan is missing "relay"
    When the shell mounts the plan into a fake frame
    Then the shell has 1 applets and the frame holds the plan srcdoc
    When the shell closes the mounted applet
    Then the shell has 0 applets
    When the shell plans the summary
    Then the shell plan is for window "applet-2" with domains "shell,storage,inc,theme"

  Scenario: planning an applet that was never resolved is refused
    Given a kernl shell over that host and pool
    When the shell plans an unresolved summary
    Then the shell refused with "invalid:unresolved"

  Scenario: a blocked applet is refused before it is planned
    Given a kernl shell over that host and pool
    When the shell resolves the manifest address
    And the shell blocks the resolved applet
    And the shell tries to plan the summary
    Then the shell refused with "denied:blocked"

  Scenario: a manifest nobody serves is unavailable
    Given a kernl shell over that host and pool
    And the fake pool serves nothing
    When the shell resolves the manifest address
    Then the shell refused with "unavailable:manifest"

  Scenario: the bridge revoking a binding removes the frame and tells the host
    Given a kernl shell over that host and pool
    And a mounted applet
    When kehto revokes the mounted window
    Then the host was told the window was revoked for "host"
    And the mounted frame was removed
    And the shell has 0 applets

  Scenario: an applet binds its port, completes the handshake and is observed by the guard
    Given a kernl shell over that host and pool
    And a mounted applet
    When the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    Then the applet received a "shell.init" with domains "shell,storage,inc,theme"
    When the applet asks "theme.get" over its port
    Then the applet received a "theme.get.result"
    When the applet asks "identity.getPublicKey" over its port
    Then the applet received no "identity.getPublicKey.result"
    When the applet floods "storage.get" over its port until the guard quarantines it
    Then the host was told the window was revoked for "quarantine"
    And the mounted frame was removed
    And the shell guard events included "flood:quarantine"
    And the shell has 0 applets

  Scenario: the guard sees each message before it is handled, and quarantine drops the one that crossed the limit
    Given a kernl shell over that host and pool
    And a mounted applet
    When the applet sends its hello through the shell
    And the applet asks "shell.ready" over its port
    And the applet sends "storage.get" one message at a time until the guard quarantines it
    Then the host was told the window was revoked for "quarantine"
    And every message before it was answered
    And the message that crossed the limit was never answered

  Scenario: a granted applet fetches resources through the bridges
    Given a kernl shell over that host and pool with fake bridges
    When the shell resolves the manifest address
    And the shell allows "resource" for the resolved applet
    And the shell plans the summary
    Then the shell plan is for window "applet-1" with domains "shell,storage,inc,theme,resource"
    When the shell mounts the plan into a fake frame
    And the applet sends its hello through the shell
    And the applet asks "resource.bytes" for "https://files.example/a.txt" over its port
    Then the applet received a "resource.bytes.result"
    And the fake bridges were asked for "https://files.example/a.txt" by applet "chat"

  Scenario: an applet learns the signed-in account only after the user grants it
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet granted "identity" that has said hello
    When the applet asks "identity.getPublicKey" over its port
    Then the applet received a "identity.getPublicKey.result"

  Scenario: a read-only account is still an account a granted applet can be shown
    Given a kernl shell over that host and pool
    When the shell logs in with a read-only account
    And a mounted applet granted "identity" that has said hello
    And the applet asks "identity.getPublicKey" over its port
    Then the applet received a "identity.getPublicKey.result" whose "pubkey" is "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"

  Scenario: a granted applet is told nobody is signed in when nobody is
    Given a kernl shell over that host and pool
    And a mounted applet granted "identity" that has said hello
    When the applet asks "identity.getPublicKey" over its port
    Then the applet received a "identity.getPublicKey.result" whose "pubkey" is ""

  Scenario: an oversized download request is dropped before any service sees it
    Given a kernl shell over that host and pool with fake bridges
    And a mounted applet granted "resource" that has said hello
    When the applet asks "resource.bytes" for an address of 65 KiB over its port
    Then the oversized "resource.bytes" request got no answer
    And the fake bridges were asked for nothing
    And the shell guard events included "size:resource:bytes"
    When the applet asks "resource.bytes" for "https://files.example/a.txt" over its port
    Then the applet received a "resource.bytes.result"
    And the fake bridges were asked for "https://files.example/a.txt" by applet "chat"

  Scenario: an applet you are not using is stopped past its smaller budget until you focus it
    Given a kernl shell over that host and pool with fake bridges and a manual clock
    And a mounted applet granted "resource" that has said hello
    When the applet window becomes "visible but not focused"
    And the applet sends 25 "storage.set" requests over its port, 125 ms apart
    Then "storage.set" requests 1 to 15 were answered
    And at least one "storage.set" request got no answer
    And the shell guard events included "rate:storage:write"
    When the applet window becomes "focused"
    And the applet sends 1 "storage.set" requests over its port, 125 ms apart
    Then "storage.set" requests 26 to 26 were answered

  Scenario: a burst above the per-second rate is dropped, and control messages still get through
    Given a kernl shell over that host and pool with fake bridges and a manual clock
    And a mounted applet granted "resource" that has said hello
    When the applet sends 9 "resource.bytes" requests over its port, 0 ms apart
    Then "resource.bytes" requests 1 to 7 were answered
    And "resource.bytes" requests 8 to 9 got no answer
    And the shell guard events included "flood:burst"
    When the applet sends 1 "storage.get" requests over its port, 0 ms apart
    Then "storage.get" requests 1 to 1 were answered

  Scenario: a hidden applet's requests are held until it is visible, while control messages are answered
    Given a kernl shell over that host and pool with fake bridges and a manual clock
    And a mounted applet granted "resource" that has said hello
    When the applet window becomes "hidden"
    And the applet sends 1 "theme.get" requests over its port, 1000 ms apart
    Then "theme.get" requests 1 to 1 were answered
    When the applet sends 1 "resource.bytes" requests over its port, 1000 ms apart
    Then "resource.bytes" requests 1 to 1 got no answer
    And the fake bridges were asked for nothing
    And the shell guard events included "hidden:resource:bytes"
    When the applet window becomes "focused"
    Then "resource.bytes" requests 1 to 1 were answered
    And the fake bridges were asked for "https://files.example/a.txt" by applet "chat"

  Scenario: held requests meet the runtime's smaller unfocused budget when they are released
    Given a kernl shell over that host and pool with fake bridges and a manual clock
    And a mounted applet granted "resource" that has said hello
    And the applet's startup window has passed
    When the applet window becomes "hidden"
    And the applet sends 20 "storage.set" requests over its port, 125 ms apart
    Then "storage.set" requests 1 to 20 got no answer
    When the applet window becomes "visible but not focused"
    Then "storage.set" requests 1 to 15 were answered
    And "storage.set" requests 16 to 20 were refused by the firewall
    And the shell guard events included "rate:storage:write"
    And no guard event carries the applet's message

  Scenario: a window kehto revokes for holding too many messages is removed
    Given a kernl shell over that host and pool
    And a mounted applet
    When kehto revokes the mounted window for "deferred-overflow"
    Then the host was told the window was revoked for "deferred-overflow"
    And the mounted frame was removed
    And the shell has 0 applets

  Scenario: mounting installs the profile's rates without bypassing them, and stores them through the host
    Given a kernl shell over that host and pool
    And a mounted applet
    Then the runtime firewall holds no policy for "chat" and a "resource:fetch" rate of 120 per 10000 ms
    And the host storage holds the runtime firewall config under "kernl:firewall:v1"

  Scenario: messages from windows the shell does not know go to the bridge unguarded
    Given a kernl shell over that host and pool with fake bridges
    When a window message with no source reaches the shell
    And a rogue window registered outside the shell is granted "resource", sends its hello, asks "resource.bytes" for "https://files.example/rogue.txt" and floods "storage.get"
    Then the fake bridges were asked for "https://files.example/rogue.txt" by the shell itself
    And the shell survived and kehto can revoke the rogue window

  Scenario: an applet's profile change is shown to the user and published only after yes
    Given a kernl shell over that host and pool
    And the shell is signed in and its store holds the profile '{"name":"alice"}'
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
    Then the host was asked "Update your profile" marked "destructive" for applet "chat"
    And the consent prompt lines are:
      | label | before | after |
      | Name  | alice  | bob   |
    And the fake pool published nothing
    When the host answers the consent prompt with yes
    Then the applet's publish succeeded
    And the fake pool published a kind 0 event

  Scenario: a profile the store does not hold is loaded from the network before the user is asked
    Given a kernl shell over that host and pool
    And the shell is signed in and only the network holds the profile '{"name":"alice","about":"hi"}'
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
    Then the host was asked "Update your profile" marked "destructive" for applet "chat"
    And the consent prompt lines are:
      | label | before | after |
      | Name  | alice  | bob   |
      | About | hi     |       |

  Scenario: a profile nobody can load is reported before the user is asked
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
    Then the host was asked "Update your profile" marked "destructive" for applet "chat"
    And the consent prompt lines are:
      | label           | before | after                                          |
      | Current version |        | could not be loaded; this replaces it entirely |
      | Name            |        | bob                                            |

  Scenario: an applet's profile change the user refuses is never signed or published
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a kind 0 event with content '{"name":"bob"}' over its port
    Then the host was asked "Update your profile" marked "destructive" for applet "chat"
    When the host answers the consent prompt with no
    Then the applet's publish failed with "denied:consent"
    And the fake pool published nothing

  Scenario: a deletion that carries nothing but its kind is still put to the user
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a bare kind 5 template over its port
    Then the host was asked "Delete 0 items" marked "destructive" for applet "chat"
    When the host answers the consent prompt with no
    Then the applet's publish failed with "denied:consent"

  Scenario: a routine note is signed and published without a prompt
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a kind 1 event with content 'hello' over its port
    Then the host was not asked for consent
    And the applet's publish succeeded
    And the fake pool published a kind 1 event

  Scenario: a publish whose kind is not a number is refused before signing
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet granted "relay" that has said hello
    When the applet publishes a template whose kind is the text "0" over its port
    Then the applet's publish failed with "invalid:event-kind"
    And the host was not asked for consent
    And the fake pool published nothing

  Scenario: a destructive publish from a window the shell did not mount is refused without asking
    Given a kernl shell over that host and pool
    And the shell is signed in
    When a rogue window registered outside the shell is granted "relay", sends its hello and publishes a kind 0 event
    Then the applet's publish failed with "denied:unknown-applet"
    And the host was not asked for consent
    And the fake pool published nothing

  Scenario: an outbox publish of a destructive change asks first, and a refusal is reported
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet granted "outbox" that has said hello
    When the applet sends "outbox.publish" for a kind 3 event over its port
    Then the host was asked "Change who you follow" marked "destructive" for applet "chat"
    When the host answers the consent prompt with no
    Then the applet received "outbox.publish.result" failing with "denied:consent"
    And the fake pool published nothing

  Scenario: a destructive outbox publish while nobody is signed in is refused without asking
    Given a kernl shell over that host and pool
    And a mounted applet granted "outbox" that has said hello
    When the applet sends "outbox.publish" for a kind 3 event over its port
    Then the applet received "outbox.publish.result" failing with "denied:signed-out"
    And the host was not asked for consent

  Scenario: an outbox publish without an event is refused, and a routine one is not asked about
    Given a kernl shell over that host and pool
    And the shell is signed in
    And a mounted applet granted "outbox" that has said hello
    When the applet sends "outbox.publish" without an id or an event over its port
    Then the applet received "outbox.publish.result" failing with "invalid:event-kind"
    When the applet sends "outbox.publish" for a kind 1 event over its port
    Then the host was not asked for consent

  Scenario: the guard facade changes the profile and lifts quarantine
    Given a kernl shell over that host and pool
    And a mounted applet
    When the shell guard profile is set to "relaxed"
    Then the shell guard profile is "relaxed" with mitigations described
    And the shell guard profile stream ends with "relaxed"
    And the runtime firewall scales unfocused budgets by 0.75 and allows 24 operations in a window's first 1000 ms
    And the runtime firewall holds no policy for "chat" and a "resource:fetch" rate of 360 per 10000 ms
    And releasing window "applet-1" from the guard does nothing harmful

  Scenario: destroying the shell closes every applet and the bridge
    Given a kernl shell over that host and pool
    And a mounted applet
    When the shell is destroyed
    Then the shell has 0 applets
    And the mounted frame was removed
