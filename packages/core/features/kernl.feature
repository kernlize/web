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
    And the shell relays "apps" tier is "wss://relay.napplet.soy"
    And the shell messaging provider "private" is unavailable
    And the shell bridges are "http,torrent,nzb,soulseek,mail"
    And the frame policy meta locks frame navigation

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

  Scenario: a supplied private backend makes the provider available
    Given a kernl shell over that host and pool with a private backend
    Then the shell messaging provider "private" is available

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

  Scenario: an oversized download request is refused before any service sees it
    Given a kernl shell over that host and pool with fake bridges
    And a mounted applet granted "resource" that has said hello
    When the applet asks "resource.bytes" for an address of 65 KiB over its port
    Then the applet received a "resource.bytes.error" naming the firewall
    And the fake bridges were asked for nothing
    And the shell guard events included "size:resource:bytes"
    When the applet asks "resource.bytes" for "https://files.example/a.txt" over its port
    Then the applet received a "resource.bytes.result"
    And the fake bridges were asked for "https://files.example/a.txt" by applet "chat"

  Scenario: a refused dispatch puts the runtime policy back as it was
    Given a kernl shell over that host and pool
    And the runtime firewall holds the policy "ask" for "asker"
    When the shell refuses the current dispatch for "asker" and for "stranger"
    Then during that dispatch the runtime firewall policies were "deny" and "deny"
    And afterwards the runtime firewall policy for "asker" is "ask" and for "stranger" is "none"

  Scenario: mounting installs the profile's rates without bypassing them
    Given a kernl shell over that host and pool
    And a mounted applet
    Then the runtime firewall holds no policy for "chat" and a "resource:fetch" rate of 120 per 10000 ms

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
    When the shell guard profile is set to "relaxed"
    Then the shell guard profile is "relaxed" with mitigations described
    And the shell guard profile stream ends with "relaxed"
    And releasing window "applet-1" from the guard does nothing harmful

  Scenario: destroying the shell closes every applet and the bridge
    Given a kernl shell over that host and pool
    And a mounted applet
    When the shell is destroyed
    Then the shell has 0 applets
    And the mounted frame was removed
