Feature: Modules
  Every opinion outside the kernel is a module a host loads, leaves out or
  replaces. A shell offers applets only the domains a loaded module answers,
  and a module reaches the shell only through the kernel's context: it signs
  through consent and never holds a signer or kehto's bridge (D-061).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Rule: a shell offers what its modules answer

    Scenario: a shell that names no modules loads kernl's own
      Given a kernl shell over that host and pool
      Then the shell offers "theme"
      And the shell offers "common"
      And the composed shell starts applets with "shell,inc,theme,storage,keys"
      And the shell has a "theme" member

    Scenario: without the theme module, theme is neither offered nor in the baseline
      Given a kernl shell over that host and pool with modules "profiles,people,social,keys"
      Then the shell does not offer "theme"
      And the composed shell starts applets with "shell,inc,storage,keys"
      When the shell resolves the manifest address
      And the shell plans the summary
      Then the shell plan is for window "applet-1" with domains "shell,storage,inc,keys"

    Scenario: an applet that asks for the theme of a shell without the module gets no answer
      Given a kernl shell over that host and pool with modules "keys"
      And a mounted applet
      When the applet sends its hello through the shell
      And the applet asks "shell.ready" over its port
      Then the applet received a "shell.init" with domains "shell,storage,inc,keys"
      When the applet asks "theme.get" over its port
      Then the applet received no "theme.get.result"

    Scenario: without the keys module, keys is neither offered nor in the baseline, and a binding gets no answer
      Given a kernl shell over that host and pool with modules "theme"
      Then the shell does not offer "keys"
      And the composed shell starts applets with "shell,inc,theme,storage"
      Given a mounted applet
      When the applet sends its hello through the shell
      And the applet asks "shell.ready" over its port
      Then the applet received a "shell.init" with domains "shell,storage,inc,theme"
      When the applet asks to bind "editor.save" to "Ctrl+S" over its port
      Then the applet received no "keys.registerAction.result"

    Scenario: with the keys module, the same binding is answered
      Given a kernl shell over that host and pool with modules "theme,keys"
      And a mounted applet
      When the applet sends its hello through the shell
      And the applet asks "shell.ready" over its port
      And the applet asks to bind "editor.save" to "Ctrl+S" over its port
      Then the applet received a "keys.registerAction.result"

    Scenario: an applet that requires the theme shows it missing on a shell without the module
      Given a fake applesauce pool serving a signed manifest for "chat" requiring "theme"
      And a kernl shell over that host and pool with modules "profiles,people,social"
      When the shell resolves the manifest address
      And the shell plans the summary
      Then the shell plan is missing "theme"
      And the store lists the applet only when asked for incompatible ones

    Scenario: without the social module, social actions are not offered
      Given a kernl shell over that host and pool with modules "theme"
      Then the shell does not offer "common"
      And the shell offers "theme"

    Scenario: a domain a module offers through prelude bindings waits for a kehto that renders them
      Given a kernl shell over that host and pool with modules ""
      Then modules "bound,binding-only" set up where bindings do not render answer "" and plan ""
      And modules "bound,binding-only" set up where bindings render answer "count" and plan "count,fs"

    Scenario: the social module signs a follow the person agreed to and publishes it
      Given a kernl shell over that host and pool with modules "profiles,people,social"
      And the shell is signed in
      And a mounted applet granted "common" that has said hello
      When the applet asks to follow "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" over its port
      Then the shell asks the person "Change who you follow" before signing
      When the person answers yes to the follow
      Then the applet is told its follow succeeded
      And the fake pool published a kind 3 event

    Scenario: without the directory module there is no directory, and an account with no relay list is still offered servers
      Given a kernl shell over that host and pool with modules "theme,profiles,people,social,mailboxes"
      Then the shell has no "directory" member
      Given a fresh key with no relay list
      When the shell logs in read-only as that fresh key
      Then the shell mailboxes eventually are missing, suggesting inboxes "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"

    Scenario: a shell composed for an identity already signed in reads the directory once it exists
      Given a fresh key with no relay list
      And a kernl shell over that host and pool for that fresh key, already signed in
      Then the shell has a "directory" member
      And the shell mailboxes eventually are missing, suggesting inboxes "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"

    Scenario: the mailboxes take the directory's suggestions even when it is loaded after them
      Given a kernl shell over that host and pool with modules "mailboxes,directory"
      And a fresh key with no relay list
      When the shell logs in read-only as that fresh key
      Then the shell mailboxes eventually are missing, suggesting inboxes "wss://relay.damus.io/,wss://nos.lol/,wss://relay.primal.net/"

    Scenario: without the mailboxes module the outbox tier is left as it was
      Given a kernl shell over that host and pool with modules "theme"
      And the fake pool serves a relay list writing to "wss://own.test" for a fresh key
      Then the shell has no "mailboxes" member
      When the shell logs in read-only as that fresh key
      Then the "outbox" tier stays ""

    Scenario: without the files module, uploads are not offered and there is no file server list
      Given a kernl shell over that host and pool with modules "theme"
      Then the shell does not offer "upload"
      And the shell has no "files" member

    Scenario: without the catalog module there is no store, and an applet still opens from its address
      Given a kernl shell over that host and pool with modules "theme"
      Then the shell has no "catalog" member
      When the shell resolves the manifest address
      And the shell plans the summary
      Then the shell plan is missing "relay"

    Scenario: the store lists from the relays when no cache module is loaded
      Given a kernl shell over that host and pool with modules "catalog"
      Then the shell lists its store as "Chat"

    Scenario: without the intents module, applets cannot hand each other work and nothing is installed
      Given a kernl shell over that host and pool with modules "theme"
      Then the shell does not offer "intent"
      And the shell has no "intents" member
      When the shell resolves the manifest address
      And the shell tries to install the resolved applet
      Then the shell refused with "unavailable:intents"
      When the shell plans the summary
      Then the shell plan is missing "relay"

    Scenario: kernl's own modules include the directory, which waits to be started
      Given a kernl shell over that host and pool
      Then the shell has a "directory" member
      And the shell directory suggests 3 inbox servers before it starts

    Scenario: without the profiles and people modules, the session is labelled by its key
      Given the fake pool serves a profile named "Satoshi" for a fresh key
      And a kernl shell over that host and pool with modules "theme"
      Then the shell has no "profiles" member
      And the shell has no "people" member
      When the shell logs in read-only as that fresh key
      Then the shell session label eventually is the start of that fresh key

  Rule: a theme the shell publishes reaches the applets that are open

    Scenario: the applet that is running is told the colours changed
      Given a kernl shell over that host and pool
      And a mounted applet
      When the applet sends its hello through the shell
      And the applet asks "shell.ready" over its port
      And the shell publishes a theme background "#101216" text "#f5f1e8" primary "#efb449"
      Then the applet received a "theme.changed"
      And the applet was told the theme changed to background "#101216", text "#f5f1e8" and primary "#efb449"

    Scenario: an applet that asks after the change is told the new theme
      Given a kernl shell over that host and pool
      And a mounted applet
      When the applet sends its hello through the shell
      And the applet asks "shell.ready" over its port
      And the shell publishes a theme background "#101216" text "#f5f1e8" primary "#efb449"
      And the applet asks "theme.get" over its port
      Then the applet was told the theme is background "#101216", text "#f5f1e8" and primary "#efb449"

  Rule: modules are checked before anything is built

    Scenario: a module's api appears on the shell, and a module reaches another's
      Given a kernl shell over that host and pool with modules "clock,needs-clock"
      Then the shell has a "clock" member
      And the "needs-clock" module tells the time from "clock" as 42

    Scenario Outline: a module list that cannot be composed is refused
      When a kernl shell is composed over that host and pool with modules "<modules>"
      Then the shell refused with "<reason>"

      Examples:
        | modules          | reason                          |
        | needs-clock      | invalid:module-missing:clock    |
        | theme,theme      | invalid:module-duplicate:theme  |
        | needs-directory  | invalid:module-missing:directory |
        | needs-cache      | invalid:module-missing:cache     |
        | needs-files      | invalid:module-missing:files     |
        | needs-settings   | invalid:module-missing:settings  |
        | needs-catalog    | invalid:module-missing:catalog   |
        | needs-intents    | invalid:module-missing:intents   |
        | social           | invalid:module-missing:profiles |
        | social,profiles,people | invalid:module-order:profiles |
        | grants           | invalid:module-reserved:grants  |
        | needs-clock,clock | invalid:module-order:clock     |
        | relay-thief      | invalid:module-domain:relay     |
        | storage-thief    | invalid:module-domain:storage   |

    Scenario Outline: a module refused at setup closes the ones before it, and what the shell had opened
      When a kernl shell that owns its pool is composed with modules "first,<module>"
      Then the shell refused with "<reason>"
      And the modules were disposed in the order "first"
      And the pool the shell made was closed

      Examples:
        | module       | reason                      |
        | broken-setup | invalid:broken-setup        |
        | relay-thief  | invalid:module-domain:relay |

    Scenario: a refusal at setup leaves open what the host supplied
      When a kernl shell given its own messaging is composed with modules "broken-setup"
      Then the shell refused with "invalid:broken-setup"
      And the messaging the host gave was left open

  Rule: modules close in the reverse of the order they were loaded

    Scenario: the last module loaded closes first
      Given a kernl shell over that host and pool with modules "first,second"
      When the shell is destroyed
      Then the modules were disposed in the order "second,first"

    Scenario: a module that fails to close does not keep the others open
      Given a kernl shell over that host and pool with modules "first,broken-dispose,rejecting-dispose,second"
      When the shell is destroyed
      Then the modules were disposed in the order "second,first"

  Rule: a module reaches the shell through the kernel's context

    Scenario: signed out, a module sees nobody and cannot sign
      Given a kernl shell over that host and pool with modules "probe"
      Then the probe sees nobody signed in
      And the probe holds no signer, and finds the "probe" module
      When the probe signs a kind 1 note for the mounted window
      Then the shell refused with "denied:read-only"

    Scenario: a module reaches the modules loaded before it, and nothing by a name nobody loaded
      Given a kernl shell over that host and pool with modules "profiles,people,probe"
      Then the probe reaches the modules "profiles,people"
      When the probe asks for the module "nothing"
      Then the shell refused with "invalid:module-missing:nothing"
      When the probe loads a follow list for "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
      Then the probe asked the pool for kind 3

    Scenario: a load the network fails leaves the module waiting on nothing
      Given a kernl shell over that host and pool with modules "probe"
      And the pool fails every request
      When the probe loads a follow list for "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"
      Then the probe asked the pool for kind 3

    Scenario: a module signs a routine note without asking, for a window it can name
      Given a kernl shell over that host and pool with modules "probe"
      And the shell is signed in
      And a mounted applet granted "relay" that has said hello
      Then the probe sees the signed-in identity, able to sign
      And the probe holds the signed-in signer, and finds nothing by the name "directory"
      And the probe sees "chat" in the mounted window
      When the probe signs a kind 1 note for the mounted window
      Then the probe holds a signed kind 1 note by the signed-in identity
      And the host was not asked for consent

    Scenario: a module's write that replaces the person's record waits for them
      Given a kernl shell over that host and pool with modules "probe"
      And the shell is signed in
      And a mounted applet granted "relay" that has said hello
      When the probe starts signing a kind 0 event for the mounted window
      Then the host was asked "Update your profile" marked "destructive" for applet "chat"
      When the host answers the consent prompt with no
      Then the probe's signing ended with "denied:consent"
