Feature: Consent summaries
  Every write the shell signs on an applet's behalf is shown as what it
  changes, not as JSON. Profile, follow, relay and list changes are
  destructive; everything else is routine with a preview.

  Background:
    Given the applet asking is "chat"

  Scenario: a profile update is diffed field by field
    Given the current profile is '{"name":"alice","about":"old","display_name":"Alice"}'
    When the shell describes signing a kind 0 event with content '{"name":"alicia","display_name":"Alice","picture":"https://img.example/a.png","about":""}'
    Then the summary is "destructive" titled "Update your profile"
    And the summary lines are:
      | label   | before | after                     |
      | Name    | alice  | alicia                    |
      | About   | old    |                           |
      | Picture |        | https://img.example/a.png |

  Scenario: a first profile has no before values
    When the shell describes signing a kind 0 event with content '{"name":"alice"}'
    Then the summary lines are:
      | label | before | after |
      | Name  |        | alice |

  Scenario: a profile update that changes nothing says so
    Given the current profile is '{"name":"alice"}'
    When the shell describes signing a kind 0 event with content '{"name":"alice"}'
    Then the summary lines are:
      | label  | before | after                    |
      | Change |        | No profile fields change |

  Scenario: unreadable profile content is treated as empty
    Given the current profile is 'not json'
    When the shell describes signing a kind 0 event with content '42'
    Then the summary lines are:
      | label  | before | after                    |
      | Change |        | No profile fields change |

  Scenario: follow changes are counted and the first few named
    Given the current follow list follows "a1,a2,a3,a4,a5"
    When the shell describes signing a kind 3 event following "a1,b1,b2,b3,b4"
    Then the summary is "destructive" titled "Change who you follow"
    And the summary lines are:
      | label           | before                                                                                                                                                                                                                                                   | after                                                                                                                                                                                                                                                      |
      | Follows added   |                                                                                                                                                                                                                                                          | 4: b1b1b1b1…, b2b2b2b2…, b3b3b3b3… and 1 more                                                                                                                                                                                                              |
      | Follows removed | 4: a2a2a2a2…, a3a3a3a3…, a4a4a4a4… and 1 more                                                                                                                                                                                                            |                                                                                                                                                                                                                                                            |

  Scenario: a follow list that changes nothing says so
    Given the current follow list follows "a1"
    When the shell describes signing a kind 3 event following "a1"
    Then the summary lines are:
      | label  | before | after             |
      | Change |        | No entries change |

  Scenario: a first follow list, relay list and list have nothing to remove
    When the shell describes signing a kind 3 event following "a1"
    Then the summary lines are:
      | label         | before | after        |
      | Follows added |        | 1: a1a1a1a1… |
    When the shell describes signing a kind 10002 event with relays "wss://a.example="
    Then the summary lines are:
      | label             | before | after              |
      | Connections added |        | 1: wss://a.example |
    When the shell describes signing a kind 30000 list "friends" titled "" with entries "p:x1"
    Then the summary lines are:
      | label         | before | after   |
      | Entries added |        | 1: p:x1 |

  Scenario: deletions list what disappears
    When the shell describes signing a kind 5 event deleting "e1,e2"
    Then the summary is "destructive" titled "Delete 2 events"
    And the summary lines are:
      | label  | before    | after |
      | Delete | e1e1e1e1… |       |
      | Delete | e2e2e2e2… |       |
    When the shell describes signing a kind 5 event deleting "e1"
    Then the summary is "destructive" titled "Delete 1 event"

  Scenario: relay list changes keep their read and write markers
    Given the current relay list is "wss://a.example=read,wss://b.example="
    When the shell describes signing a kind 10002 event with relays "wss://a.example=write,wss://b.example="
    Then the summary is "destructive" titled "Change your connections list"
    And the summary lines are:
      | label               | before                     | after                      |
      | Connections added   |                            | 1: wss://a.example (write) |
      | Connections removed | 1: wss://a.example (read)  |                            |

  Scenario: list changes are named by title or identifier
    Given the current list has entries "p:x1,t:nostr"
    When the shell describes signing a kind 30000 list "friends" titled "Friends" with entries "p:x1,p:x2"
    Then the summary is "destructive" titled "Change the list \"Friends\""
    And the summary lines are:
      | label           | before     | after   |
      | Entries added   |            | 1: p:x2 |
      | Entries removed | 1: t:nostr |         |
    When the shell describes signing a kind 10000 list "" titled "" with entries "p:x1"
    Then the summary is "destructive" titled "Change a list"
    When the shell describes signing a kind 30001 list "pins" titled "" with entries "e:x1"
    Then the summary is "destructive" titled "Change the list \"pins\""

  Scenario: other kinds are routine with a preview
    When the shell describes signing a kind 1 event with content 'hello   world'
    Then the summary is "routine" titled "Publish a note"
    And the summary lines are:
      | label   | before | after       |
      | Content |        | hello world |
    When the shell describes signing a kind 1 event with 200 characters of content
    Then the summary preview is 141 characters long and ends with "…"
    When the shell describes signing a kind 4242 event with content 'x'
    Then the summary is "routine" titled "Publish a kind 4242 event"

  Scenario: the handler asks the host with a summary and passes the answer back
    Given a consent handler with a store holding the current profile '{"name":"alice"}'
    When kehto requests consent from window "w1" to sign a kind 0 event with content '{"name":"bob"}'
    Then the host was asked "Update your profile" for applet "chat"
    And the asked summary lines are:
      | label | before | after |
      | Name  | alice  | bob   |
    When the host answers true
    Then kehto received true

  Scenario: the handler looks up addressable events by identifier
    Given a consent handler with a store holding a kind 30000 list "friends" with entries "p:x1"
    When kehto requests consent from window "w1" to sign a kind 30000 list "friends" with entries "p:x1,p:x2"
    Then the asked summary lines are:
      | label         | before | after   |
      | Entries added |        | 1: p:x2 |

  Scenario: requests without an event or from an unknown window are refused without asking
    Given a consent handler with an empty store
    When kehto requests firewall consent from window "w1"
    Then kehto received false
    And the host was not asked
    When kehto requests consent from window "ghost" to sign a kind 1 event with content 'hi'
    Then kehto received false
    And the host was not asked
