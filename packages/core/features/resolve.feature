Feature: Resolving an applet
  Verified bytes come from kehto's resolveNapplet. The shell fetches the
  manifest from the pointer's relays plus the apps tier, fetches the artifact
  from any server that answers, and refuses anything that does not verify.

  Background:
    Given kernl relay tiers over empty storage
    And a fake applesauce pool
    And a signed manifest for "chat" requiring "relay" with optional "notify"

  Scenario: the newest manifest wins
    Given the fake pool serves the manifest and an older manifest
    When the shell fetches the manifest for the address pointer with relays "wss://hint.example"
    Then the fetched manifest is the signed one
    And the fake pool received a "request" for "wss://hint.example,wss://relay.napplet.soy"

  Scenario: the newest manifest wins whatever order relays answer in
    Given the fake pool serves the manifest before an older manifest
    When the shell fetches the manifest for the address pointer with relays ""
    Then the fetched manifest is the signed one

  Scenario: an event pointer asks by id and a root address omits the identifier
    Given the fake pool serves the manifest and an older manifest
    When the shell fetches the manifest for the event pointer
    Then the manifest request filter was by ids
    When the shell fetches the manifest for a root address pointer
    Then the manifest request filter had no identifier

  Scenario: no manifest anywhere is unavailable
    When the shell fetches the manifest for the address pointer with relays ""
    Then the shell refused with "unavailable:manifest"

  Scenario: blob servers are tried in turn
    Given a blob server "https://empty.example/" that does not have the artifact
    And a blob server "https://full.example" that has the artifact
    When the shell fetches the artifact blob through the default fetcher
    Then the fetched bytes are the artifact

  Scenario: a server that throws is skipped and the next one asked
    Given a blob server "https://down.example" that is down
    And a blob server "https://full.example" that has the artifact
    When the shell fetches the artifact blob through the default fetcher
    Then the fetched bytes are the artifact

  Scenario: no server has the blob
    Given a blob server "https://empty.example" that does not have the artifact
    When the shell fetches the artifact blob through the default fetcher
    Then the shell refused with "unavailable:blob"

  Scenario: a verified manifest and artifact become a summary and index html
    When the shell resolves the manifest with the artifact available
    Then the summary identity is "chat" with the artifact hash
    And the summary title is "Chat" by the author requiring "relay" with optional "notify"
    And the resolved index html is the artifact
    And the summary has no icon and no source

  Scenario: icon and source are carried when declared
    Given a signed manifest for "chat" with an icon and a source
    When the shell resolves the manifest with the artifact available
    Then the summary has an icon and source "https://github.com/example/chat"

  Scenario: a tampered artifact is refused
    When the shell resolves the manifest with a different artifact
    Then the shell refused with "invalid:blob-hash-mismatch"

  Scenario: a missing artifact is unavailable
    When the shell resolves the manifest with no artifact
    Then the shell refused with "unavailable:blob"

  Scenario: kehto's own blob fetcher reports a missing blob the same way
    When the shell resolves the manifest with kehto's blob fetcher over a server that is down
    Then the shell refused with "unavailable:blob"

  Scenario: a manifest whose signature does not verify is refused
    Given the manifest signature is corrupted
    When the shell resolves the manifest with the artifact available
    Then the shell refused with "invalid:invalid-signature"

  Scenario: a fetcher failure that is not a resolution error passes through
    When the shell resolves the manifest with a fetcher that explodes
    Then the shell refused with "boom"

  Scenario: a verified-artifact cache is read and written
    Given a fake artifact cache
    When the shell resolves the manifest with the artifact available and the cache
    Then the cache received the verified resolution
    And the resolved index html is the artifact

  Scenario: summaries fall back sensibly
    Then summarizing a resolved napplet without title, description or archetype slugs uses the d tag and archetype slugs
    And summarizing a root napplet without a title is called "Untitled applet"

  Scenario: the default artifact cache exists only where Cache Storage does
    Then the default artifact cache is absent without Cache Storage
    And the default artifact cache is present with Cache Storage
