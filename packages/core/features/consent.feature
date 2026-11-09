Feature: Consent summaries
  Every write the shell signs on an applet's behalf is shown as what it
  changes, not as JSON. Every replaceable and addressable write, deletions
  and requests to vanish are destructive; everything else is routine with a
  preview. A replacing write is described against the current version, from
  the store or the network, and says so when that version cannot be loaded.

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

  Scenario: a first follow list and list have nothing to remove
    When the shell describes signing a kind 3 event following "a1"
    Then the summary lines are:
      | label         | before | after        |
      | Follows added |        | 1: a1a1a1a1… |
    When the shell describes signing a kind 30000 list "friends" titled "" with entries "p:x1"
    Then the summary lines are:
      | label         | before | after                 |
      | Entries added |        | 1: person x1…       |

  Scenario: deletions list what disappears
    When the shell describes signing a kind 5 event deleting "e1,e2"
    Then the summary is "destructive" titled "Delete 2 items"
    And the summary lines are:
      | label  | before    | after |
      | Delete | e1e1e1e1… |       |
      | Delete | e2e2e2e2… |       |
    When the shell describes signing a kind 5 event deleting "e1"
    Then the summary is "destructive" titled "Delete 1 item"

  Scenario: deletions by address list the coordinates that disappear
    When the shell describes signing a kind 5 event deleting "e1" and addresses "30023:a1:post,30311:b2:"
    Then the summary is "destructive" titled "Delete 3 items"
    And the summary lines are:
      | label                   | before                                  | after |
      | Delete                  | e1e1e1e1…                               |       |
      | Delete every version of | article "post" by person a1a1a1a1…      |       |
      | Delete every version of | record (type 30311) by person b2b2b2b2… |       |
    When the shell describes signing a kind 5 event deleting "" and addresses "30023:a1:post"
    Then the summary is "destructive" titled "Delete 1 item"

  Scenario: deletions that name only posts say posts
    When the shell describes signing a kind 5 event deleting "e1,e2" of kinds "1,1"
    Then the summary is "destructive" titled "Delete 2 posts"
    When the shell describes signing a kind 5 event deleting "e1" of kinds "1"
    Then the summary is "destructive" titled "Delete 1 post"
    When the shell describes signing a kind 5 event deleting "e1,e2" of kinds "1,7"
    Then the summary is "destructive" titled "Delete 2 items"

  Scenario: a request to vanish asks services to erase the account
    When the shell describes signing a kind 62 request naming services "ALL_RELAYS"
    Then the summary is "destructive" titled "Ask services to erase your account"
    And the summary lines are:
      | label          | before                                | after         |
      | Erase          | Everything this account has published |               |
      | Services asked |                                       | Every service |
    When the shell describes signing a kind 62 request naming services ""
    Then the summary lines are:
      | label          | before                                | after         |
      | Erase          | Everything this account has published |               |
      | Services asked |                                       | Every service |
    When the shell describes signing a kind 62 request naming services "wss://relay.damus.io/,wss://nos.lol,wss://relay.example"
    Then the summary lines are:
      | label          | before                                | after                                 |
      | Erase          | Everything this account has published |                                       |
      | Services asked |                                       | damus.io, nos.lol, relay.example |

  Scenario: any other replaceable or addressable record is destructive and diffed
    When the shell describes signing a kind 17375 record "" with content "sealed" and entries "mint:m1"
    Then the summary is "destructive" titled "Replace one of your records (type 17375)"
    And the summary lines are:
      | label         | before | after      |
      | Entries added |        | 1: mint m1 |
    Given the current kind 30311 record "stream" has content "old" and entries "status:live"
    When the shell describes signing a kind 30311 record "stream" with content "new" and entries "status:ended"
    Then the summary is "destructive" titled "Replace one of your records (type 30311) \"stream\""
    And the summary lines are:
      | label           | before         | after           |
      | Entries added   |                | 1: status ended |
      | Entries removed | 1: status live |                 |
      | Content         |                | Replaced        |
    When the shell describes signing a kind 30311 record "stream" with content "old" and entries "status:live"
    Then the summary lines are:
      | label  | before | after             |
      | Change |        | No entries change |

  Scenario: every replaceable and addressable kind, deletions and vanishing are destructive
    Then kinds "0,3,10000,10002,17375,19999,30000,30311,39999,5,62" are destructive
    And kinds "1,4,7,1059,9735,20000,29999,40000" are routine

  Scenario: a relay list change reads as the inbox and outbox it changes
    Given the current relay list is "wss://a.test=read,wss://relay.b.test="
    When the shell describes signing a kind 10002 event with relays "wss://a.test=write,wss://relay.b.test=,wss://c.test=read"
    Then the summary is "destructive" titled "Change your inbox and outbox"
    And the summary lines are:
      | label          | before    | after                                                                                          |
      | What this is   |           | Your inbox is where people send things to you; your outbox is where your posts are kept and found. |
      | Inbox added    |           | 1: c.test                                                                                      |
      | Inbox removed  | 1: a.test |                                                                                                |
      | Outbox added   |           | 1: a.test                                                                                      |

  Scenario: a relay list that changes nothing, or arrives with nothing before it, says so plainly
    When the shell describes signing a kind 10002 event with relays "wss://a.test="
    Then the summary lines are:
      | label          | before | after                                                                                          |
      | What this is   |        | Your inbox is where people send things to you; your outbox is where your posts are kept and found. |
      | Inbox added    |        | 1: a.test                                                                                      |
      | Outbox added   |        | 1: a.test                                                                                      |
    Given the current relay list is "wss://a.test="
    When the shell describes signing a kind 10002 event with relays "wss://a.test="
    Then the summary lines are:
      | label          | before | after                                                                                          |
      | What this is   |        | Your inbox is where people send things to you; your outbox is where your posts are kept and found. |
      | Change         |        | No entries change                                                                              |

  Scenario: an applet changing which applets open requests for the user is named in plain words
    Given the current handler preferences for "profile" are "a=viewer,i=napplet:profile/edit>editor"
    When the shell describes an applet setting the handler preferences for "profile" to "a=chat,e=d,r=,i=napplet:profile/edit>chat" with private choices
    Then the summary is "destructive" titled "Change which applets open \"profile\" for you"
    And the summary lines are:
      | label           | before                                                                                     | after                                                                                                     |
      | Applets added   |                                                                                            | 4: applet "chat" by person cccccccc…, pinned applet dddddddd…, applet by person cccccccc… and 1 more     |
      | Applets removed | 2: applet "viewer" by person cccccccc…, applet "editor" by person cccccccc… for "profile/edit" |                                                                                                           |
      | Private choices |                                                                                            | Replaced                                                                                                  |

  Scenario: handler preferences without an archetype or a handler still describe what they add
    When the shell describes an applet setting handler preferences without an archetype to "i=napplet:note/open>?"
    Then the summary is "destructive" titled "Change which applets open \"some requests\" for you"
    And the summary lines are:
      | label         | before | after                                   |
      | Applets added |        | 1: applet by person … for "note/open"   |

  Scenario: list changes are named by title or identifier
    Given the current list has entries "p:x1,t:nostr"
    When the shell describes signing a kind 30000 list "friends" titled "Friends" with entries "p:x1,p:x2"
    Then the summary is "destructive" titled "Change the list \"Friends\""
    And the summary lines are:
      | label           | before         | after                 |
      | Entries added   |                | 1: person x2…       |
      | Entries removed | 1: topic nostr |                       |
    When the shell describes signing a kind 10000 list "" titled "" with entries "p:x1"
    Then the summary is "destructive" titled "Change a list"
    When the shell describes signing a kind 30001 list "pins" titled "" with entries "e:x1"
    Then the summary is "destructive" titled "Change the list \"pins\""

  Scenario: other kinds are routine with a preview
    When the shell describes signing a kind 1 event with content 'hello   world'
    Then the summary is "routine" titled "Publish a post"
    And the summary lines are:
      | label   | before | after       |
      | Content |        | hello world |
    When the shell describes signing a kind 1 event with 200 characters of content
    Then the summary preview is 141 characters long and ends with "…"
    When the shell describes signing a kind 4242 event with content 'x'
    Then the summary is "routine" titled "Publish a record (type 4242)"

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
      | label         | before | after                 |
      | Entries added |        | 1: person x2…       |

  Scenario: a current version the store does not hold is loaded from the network
    Given a consent handler with an empty store and a network holding follow lists "a9" then "a1,a2,a3"
    When kehto requests consent from window "w1" to sign a kind 3 event following "a1"
    Then the asked summary lines are:
      | label           | before                    | after |
      | Follows removed | 2: a2a2a2a2…, a3a3a3a3… |       |
    And the network was asked for kind 3 with no identifier

  Scenario: a current version nobody can load is reported and the write stays destructive
    Given a consent handler with an empty store and a network that never answers
    When kehto requests consent from window "w1" to sign a kind 3 event following "a1"
    Then the asked summary is "destructive"
    And the asked summary lines are:
      | label           | before | after                                          |
      | Current version |        | could not be loaded; this replaces it entirely |
      | Follows added   |        | 1: a1a1a1a1…                                   |
    When kehto requests consent from window "w1" to sign a kind 30311 list "" with entries "p:x1"
    Then the network was asked for kind 30311 with identifier ""

  Scenario: a failing network and a store-only lookup report the same unknown version
    Given a consent handler with an empty store and a network that fails
    When kehto requests consent from window "w1" to sign a kind 0 event with content '{"name":"bob"}'
    Then the asked summary lines are:
      | label           | before | after                                          |
      | Current version |        | could not be loaded; this replaces it entirely |
      | Name            |        | bob                                            |
    Given a consent handler with an empty store
    When kehto requests consent from window "w1" to sign a kind 3 event following "a1"
    Then the asked summary lines are:
      | label           | before | after                                          |
      | Current version |        | could not be loaded; this replaces it entirely |
      | Follows added   |        | 1: a1a1a1a1…                                   |

  Scenario: a routine write from a known window is asked about without a lookup
    Given a consent handler with an empty store and a network that never answers
    When kehto requests consent from window "w1" to sign a kind 1 event with content 'hi'
    Then the host was asked "Publish a post" for applet "chat"
    And the network was not asked

  Scenario: requests without an event or from an unknown window are refused without asking
    Given a consent handler with an empty store
    When kehto requests firewall consent from window "w1"
    Then kehto received false
    And the host was not asked
    When kehto requests consent from window "ghost" to sign a kind 1 event with content 'hi'
    Then kehto received false
    And the host was not asked

  Scenario: no summary of a replacing or erasing write speaks protocol
    Then no consent summary for kinds "0,3,5,62,10002,17375,30311" names a protocol, a key format, a server address or a kind
    And every one of those summaries carries the raw event for the record view
