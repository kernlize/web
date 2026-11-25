Feature: What a host bundles
  A host on the kernel alone imports `@kernlize/kernel`, which holds no module
  (D-068). A host that names kernl's modules imports them with the kernel from
  `@kernlize/core/kernel` and bundles only what it lists. The ratchet and group
  providers are their own imports, so their libraries reach a bundle only when
  a host lists them. kernl's own list, behind `createKernl`, lists all four.
  These are checked against the built packages, as a host would bundle them.

  Scenario: a host on the kernel alone bundles no module
    Given a host that composes the kernel package with no modules
    When the host is bundled for the browser from the built packages
    Then the bundle holds code from the workspace package "kernel"
    And the bundle holds no code from the workspace package "core"
    And the bundle holds no code from "nostr-double-ratchet"
    And the bundle holds no code from "@internet-privacy/marmot-ts"

  Scenario: a host that lists one module from its own entry bundles no other module's library
    Given a host that composes the kernel with the theme module from its entry
    When the host is bundled for the browser from the built packages
    Then the bundle holds no code from "nostr-double-ratchet"
    And the bundle holds no code from "@internet-privacy/marmot-ts"
    And the bundle holds no code from "@sqlite.org/sqlite-wasm"
    And the bundle holds no code from "blossom-client-sdk"
    And the bundler reads under 10 KB of the modules' built code

  Scenario: a host that lists only private messages bundles neither the ratchet nor the group library
    Given a host that composes the kernel with messages over "private"
    When the host is bundled for the browser from the built packages
    Then the bundle holds no code from "nostr-double-ratchet"
    And the bundle holds no code from "@internet-privacy/marmot-ts"

  Scenario: a host that lists the ratchet and group providers bundles their libraries
    Given a host that composes the kernel with messages over "private,ratchet,groups"
    When the host is bundled for the browser from the built packages
    Then the bundle holds code from "nostr-double-ratchet"
    And the bundle holds code from "@internet-privacy/marmot-ts"

  Scenario: a host on kernl's own modules bundles every provider's library
    Given a host that composes kernl with its own modules
    When the host is bundled for the browser from the built packages
    Then the bundle holds code from "nostr-double-ratchet"
    And the bundle holds code from "@internet-privacy/marmot-ts"

  Scenario: a host that draws the grants list from the view models bundles no third-party code
    Given a host that draws the grants list from the view models
    When the host is bundled for the browser from the built packages
    Then the bundle holds no code from any installed package
