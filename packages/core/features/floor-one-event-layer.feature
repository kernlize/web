Feature: Floor: one store, one pool and one account manager, whatever modules are loaded
  A shell has one `EventStore`, one `RelayPool` and one `AccountManager`. A
  host may supply them; a module uses the shell's and never brings its own
  (SOUL §1, D-061).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: host-supplied parts are the shell's only ones
    Given a kernl shell over that host and pool with its own store, accounts, messaging, bridges, relays, a "balanced" guard, a theme, a clock and a blob fetcher
    Then the shell uses the supplied store, accounts and pool

  Scenario: a shell without a supplied pool owns one and closes it when destroyed
    Given a kernl shell over that host without a pool
    Then the shell pool is its own
    When the shell is destroyed
    Then the shell pool is closed
