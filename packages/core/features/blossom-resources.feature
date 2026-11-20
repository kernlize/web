Feature: An applet's Blossom resources
  An applet granted web fetches asks for `blossom:` references. The shell looks
  for the blob on the servers the reference hints at, then on the servers the
  applet's own manifest names, and hands over only bytes whose hash matches. A
  failure reaches the applet as the NAP-RESOURCE error it is (D-055).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" whose servers are "https://applet-files.example"

  Scenario: a reference that names no server is found on the applet's own server
    Given the web holds the asset blob on "https://applet-files.example"
    And a kernl shell over that host and pool
    And a mounted applet granted "resource" that has said hello
    When the applet asks for the asset blob as "blossom:sha256:HASH" over its port
    Then the applet received the asset blob
    And the web was asked only "https://applet-files.example/HASH"

  Scenario: a hinted server is asked first
    Given the web holds the asset blob on "https://hint.example"
    And a kernl shell over that host and pool
    And a mounted applet granted "resource" that has said hello
    When the applet asks for the asset blob as "blossom:HASH.png?xs=hint.example" over its port
    Then the applet received the asset blob
    And the web was asked only "https://hint.example/HASH"

  Scenario: a blob no named server holds is not found, and nobody else is asked
    Given the web holds the asset blob on "https://elsewhere.example"
    And a kernl shell over that host and pool
    And a mounted applet granted "resource" that has said hello
    When the applet asks for the asset blob as "blossom:sha256:HASH" over its port
    Then the applet was told "not-found" for the asset blob
    And the web was asked only "https://applet-files.example/HASH"

  Scenario: a scheme no bridge serves is unsupported, not a network failure
    Given a kernl shell over that host and pool
    And a mounted applet granted "resource" that has said hello
    When the applet asks for the asset blob as "ipfs://bafyexample" over its port
    Then the applet was told "unsupported-scheme" for the asset blob

  Scenario: only a running applet's servers are used, and the shell's own requests have none
    Given the web holds the asset blob on "https://applet-files.example"
    And a kernl shell over that host and pool
    And a mounted applet granted "resource" that has said hello
    When the shell's bridges resolve the asset blob for the shell
    Then the shell's bridges failed with "unavailable:no-servers"
    When the shell's bridges resolve the asset blob for an applet that is not running
    Then the shell's bridges failed with "unavailable:no-servers"
    And the web was asked only ""

  Scenario: the default bridges fetch Blossom blobs under the web options they are given
    Given the web holds the asset blob on "https://applet-files.example"
    When default bridges built with their own fetch resolve the asset blob from "https://applet-files.example"
    Then the default bridges returned the asset blob through their own fetch

  Scenario Outline: each bridge reason becomes the resource error it is
    Then the bridge reason "<reason>" reaches the applet as "<code>"

    Examples:
      | reason                                 | code               |
      | unavailable:no-bridge                  | unsupported-scheme |
      | unavailable:not-found                  | not-found          |
      | unavailable:no-servers                 | not-found          |
      | unavailable:timeout                    | timeout            |
      | denied:too-large                       | too-large          |
      | invalid:blossom                        | invalid-request    |
      | denied:private-address 10.0.0.1        | blocked-by-policy  |
      | unavailable:network Failed to fetch    | network-error      |
