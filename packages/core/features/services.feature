Feature: Shell services and adapter
  kehto's reference services run over the shell's applesauce layer and the
  host's hooks. Every network path goes through the one pool; links open only
  over https and mailto; resources go through the bridges; notifications and
  links surface through the host.

  Background:
    Given kernl relay tiers over empty storage
    And a fake applesauce pool
    And an event store
    And kernl services with a signing account and a fake bridge registry

  Scenario: the registry covers the domains kernl serves
    Then the service registry has "relay,identity,theme,notify,link,resource,dm,outbox"

  Scenario: notifications surface through the host
    When service "notify" handles '{"type":"notify.send","id":"n1","title":"Hello","body":"World"}' from window "w1"
    Then the host was notified "Hello" with body "World" for window "w1"
    When service "notify" handles '{"type":"notify.send","id":"n2","title":"Quiet"}' from window "w1"
    Then the host was notified "Quiet" without a body for window "w1"

  Scenario: links open only over https and mailto
    When service "link" handles '{"type":"link.open","id":"l1","url":"https://example.com/page"}' from window "w1"
    Then the host opened "https://example.com/page"
    And the service replied with a "link.open.result" whose "status" is "opened"
    When service "link" handles '{"type":"link.open","id":"l2","url":"http://example.com/page"}' from window "w1"
    Then the service replied with a "link.open.result" whose "status" is "denied"
    And the host opened 1 links

  Scenario: identity answers from the active signer
    When service "identity" handles '{"type":"identity.getPublicKey","id":"i1"}' from window "w1"
    Then the service replied with a "identity.getPublicKey.result" whose "pubkey" is the signing pubkey

  Scenario: the theme defaults unless the host supplies a valid one
    When service "theme" handles '{"type":"theme.get","id":"t1"}' from window "w1"
    Then the service replied with a "theme.get.result" whose theme primary is "#7aa2f7"
    Given kernl services with the theme '{"colors":{"background":"#000","text":"#fff","primary":"#f0f"}}'
    When service "theme" handles '{"type":"theme.get","id":"t2"}' from window "w1"
    Then the service replied with a "theme.get.result" whose theme primary is "#f0f"
    And the theme '{"colors":{"background":"#000"}}' is not a theme
    And the theme 'null' is not a theme

  Scenario: relay subscriptions run through the shared pool
    Given the fake pool serves 2 events
    When service "relay" handles '{"type":"relay.subscribe","id":"r1","subId":"s1","filters":[{"kinds":[1]}]}' from window "w1"
    Then the service replied with envelope types containing "relay.event,relay.eose"
    And the fake pool received a "req" for the "general" tier

  Scenario: resources resolve through the bridges in the applet's name
    When service "resource" handles '{"type":"resource.bytes","id":"b1","url":"https://files.example/a.txt"}' from window "w1"
    Then the fake bridges resolved "https://files.example/a.txt" for applet "chat"
    And the service replied with a "resource.bytes.result"
    And the resource init for window "ghost" names "shell" as requester
    And the resource init keeps headers when the service passes them

  Scenario: direct messages answer through the composite backend
    When service "dm" handles '{"type":"dm.status","id":"d1"}' from window "w1"
    Then the service replied with a "dm.status.result"

  Scenario: outbox reads and writes use the router over the pool and the active signer
    Given the fake pool serves 1 events
    When service "outbox" handles '{"type":"outbox.query","id":"o1","filters":[{"kinds":[1]}]}' from window "w1"
    Then the service eventually replied with a "outbox.query.result" carrying 1 events
    When service "outbox" handles '{"type":"outbox.publish","id":"o2","event":{"kind":1,"content":"hi","tags":[],"created_at":1700000000}}' from window "w1"
    Then the service eventually replied with a "outbox.publish.result" whose "ok" is true
    And the fake pool received a "publish" for "wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net"
    Given the signing account publishes a relay list writing to "wss://nos.lol"
    When service "outbox" handles '{"type":"outbox.publish","id":"o3","event":{"kind":1,"content":"hi","tags":[],"created_at":1700000000}}' from window "w1"
    Then the service eventually replied with a "outbox.publish.result" whose "ok" is true
    And the fake pool received a "publish" for "wss://nos.lol/"
    Given kernl services without a signer
    When service "outbox" handles '{"type":"outbox.publish","id":"o4","event":{"kind":1,"content":"hi","tags":[],"created_at":1700000000}}' from window "w1"
    Then the service eventually replied with a "outbox.publish.result" whose "ok" is false

  Scenario: an outbox publish that one write relay refuses still succeeds
    Given the signing account publishes a relay list writing to "wss://nos.lol,wss://relay.damus.io"
    And the fake pool relays "wss://relay.damus.io/" answer publishes with a refusal
    When service "outbox" handles '{"type":"outbox.publish","id":"p1","event":{"kind":1,"content":"hi","tags":[],"created_at":1700000000}}' from window "w1"
    Then the service eventually replied with a "outbox.publish.result" whose "ok" is true
    Given the fake pool relays "wss://nos.lol/" answer publishes with a refusal
    When service "outbox" handles '{"type":"outbox.publish","id":"p2","event":{"kind":1,"content":"hi","tags":[],"created_at":1700000000}}' from window "w1"
    Then the service eventually replied with a "outbox.publish.result" whose "ok" is false

  Scenario: the shell adapter decides what kehto left open
    Given a kernl shell adapter
    Then the adapter creates no windows, has no worker relay, forwards no hotkeys and shows update banners
    And the adapter verifies a signed event and rejects a forged one
    And the adapter advertises the link domain and its services
    And the adapter keeps a restrictive ACL and asks the shell about focus and every port message
    When the adapter adds "wss://relay.mine" to tier "outbox" and "wss://ignored" to tier "nonsense"
    Then the adapter relay config has outbox "wss://relay.mine"
    When the adapter removes "wss://relay.mine" from tier "outbox" and "wss://ignored" from tier "nonsense"
    Then the adapter relay config has outbox ""
    And the adapter has no network suggestions
    And the adapter forwards unrouted messages when asked to

  Scenario: the default messaging registry describes what it cannot do yet
    Given the default messaging registry over empty storage
    Then provider "private" is unavailable because "sign-in-required"
    And provider "legacy" is unavailable because "sign-in-required"
    And provider "ratchet" is unavailable because "no-runtime"
    And creating the "private" backend throws "unavailable:sign-in-required"

  Scenario: a supplied runtime makes the ratchet provider available
    Given the default messaging registry over empty storage with a "ratchet" backend
    Then provider "ratchet" is available

  Scenario: a supplied backend makes a provider available and preferences persist
    Given the default messaging registry over empty storage with a "private" backend
    Then provider "private" is available
    When provider "private" is enabled
    Then storage key "kernl:messaging:v1" lists "private" as enabled
    When the default messaging registry is created again over the same storage with a "private" backend
    Then provider "private" reports enabled

  Scenario: the default bridges are the web bridge plus four honest placeholders
    Given the default bridge registry
    Then the bridges are "http,torrent,nzb,soulseek,mail"
    And bridge for scheme "magnet" is unavailable because "no-backend"
    And bridge for scheme "https" is available

  Scenario: a torrent backend wins over the hand-off for magnet links only
    Given the default bridge registry with a hand-off opener and a torrent backend
    Then bridge for scheme "magnet" is available
    And bridge for scheme "nzb" hands off to the device
    When the default bridges resolve "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01"
    Then the torrent backend was asked for "abcdef0123456789abcdef0123456789abcdef01"
    And the hand-off opener was never called

  Scenario Outline: with a hand-off opener the default bridges open an app on the device
    Given the default bridge registry with a hand-off opener
    Then bridge for scheme "<scheme>" hands off to the device
    And bridge for scheme "https" is available
    When the default bridges resolve "<uri>"
    Then the hand-off opener was called once with "<opened>"

    Examples:
      | scheme | uri                                                                     | opened                                                                  |
      | magnet | magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Mix     | magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Mix     |
      | nzb    | https://indexer.example/get/1.nzb                                       | https://indexer.example/get/1.nzb                                       |
      | slsk   | slsk://ada/Music/01.flac                                                | slsk://ada/Music/01.flac                                                |
      | mailto | mailto:ada@example.com?subject=Hi                                       | mailto:ada@example.com?subject=Hi                                       |
