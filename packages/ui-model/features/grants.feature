Feature: The grants list
  What an applet asks for, what this shell can give and what stands for it
  become the grants list: groups of switches, each with plain words, and the
  grants to make or take back when the person confirms. An applet that can
  read messages keeps only the domains that cannot send them on (D-046,
  D-057, D-060). The model is framework-free, so any host's UI draws it.

  Scenario Outline: grant domains read as plain words, with the contract beside them
    Then the shell calls the domain "<domain>" "<label>"
    And the shell writes the contract of "<domain>" as "<contract>"

    Examples:
      | domain   | label                    | contract |
      | identity | your identity            | IDENTITY |
      | relay    | network                  | RELAY    |
      | outbox   | posting to your network  | OUTBOX   |
      | resource | web fetches              | RESOURCE |
      | common   | social actions           | COMMON   |
      | zap      | another capability       | ZAP      |
      | toString | another capability       | TOSTRING |


  Scenario: required domains are on and fixed, optional ones are off and free, and each has its group
    Given an applet that requires "identity, relay" and may use "notify, theme"
    And the shell baseline is "theme"
    And the shell can offer "identity, relay, notify"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain   | label           | on  | locked | note        |
      | required | identity | your identity   | yes | yes    |             |
      | required | relay    | network         | yes | yes    |             |
      | optional | notify   | notifications   | no  | no     |             |
      | optional | theme    | your theme      | yes | yes    | always on   |

  Scenario: what was granted before shows as on, and the required ones are on regardless
    Given an applet that requires "identity" and may use "notify, relay"
    And the shell can offer "identity, notify, relay"
    And the applet was earlier granted "relay"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain   | label         | on  | locked | note |
      | required | identity | your identity | yes | yes    |      |
      | optional | notify   | notifications | no  | no     |      |
      | optional | relay    | network       | yes | no     |      |

  Scenario: a screen that does not force the required domains shows what is granted, and locks a required one once it is on
    Given an applet that requires "identity, relay" and may use ""
    And the shell can offer "identity, relay"
    And the applet was earlier granted "relay"
    When the shell groups the grants for a running applet
    Then the grant groups are:
      | group    | domain   | label         | on  | locked | note |
      | required | identity | your identity | no  | no     |      |
      | required | relay    | network       | yes | yes    |      |

  Scenario: a domain this shell cannot offer is listed, off and fixed
    Given an applet that requires "identity, outbox" and may use "config"
    And the shell can offer "outbox"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain   | label                   | on  | locked | note                                          |
      | required | identity | your identity           | no  | yes    | needed, and this shell cannot provide it      |
      | required | outbox   | posting to your network | yes | yes    |                                               |
      | optional | config   | its settings            | no  | yes    | not available in this shell                   |

  Scenario: an applet that takes requests from others needs the receiving switch, so it is required
    Given an applet that requires "identity" and may use "notify"
    And the shell can offer "identity, notify, intent"
    And the applet takes requests from other applets
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain   | label                 | on  | locked | note |
      | required | identity | your identity         | yes | yes    |      |
      | required | intent   | opening other applets | yes | yes    |      |
      | optional | notify   | notifications         | no  | no     |      |

  Scenario: a receiving applet that lists the switch as optional still needs it, and one this shell cannot offer shows it off
    Given an applet that requires "storage" and may use "intent"
    And the shell can offer "storage, intent"
    And the applet takes requests from other applets
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain  | label                 | on  | locked | note |
      | required | storage | its own storage       | yes | yes    |      |
      | required | intent  | opening other applets | yes | yes    |      |
    Given an applet that requires "" and may use ""
    And the shell can offer "relay"
    And the applet takes requests from other applets
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label                 | on | locked | note                                     |
      | required | intent | opening other applets | no | yes    | needed, and this shell cannot provide it |

  Scenario: domains the applet did not ask for follow, for a screen that lets the person grant more
    Given an applet that requires "relay" and may use ""
    And the shell can offer "relay, notify, media"
    And the applet was earlier granted "media"
    And the screen also offers "notify, media, relay"
    When the shell groups the grants for a running applet
    Then the grant groups are:
      | group | domain | label          | on  | locked | note |
      | required | relay | network      | no  | no     |      |
      | other | notify | notifications  | no  | no     |      |
      | other | media  | media controls | yes | no     |      |

  Scenario: group captions read as plain labels
    Then the grant group captions are "unsafe: Unsafe with messages, required: Required, optional: Optional, other: Not requested"


  Scenario: required domains that cannot go with required messages move to the unsafe group, off
    Given an applet that requires "dm, upload, relay" and may use "notify"
    And the shell can offer "dm, upload, relay, notify"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label         | on  | locked | note                                |
      | unsafe   | upload | uploads       | no  | no     | |
      | unsafe   | relay  | network       | no  | no     | |
      | required | dm     | messages      | yes | yes    |                                     |
      | optional | notify | notifications | no  | no     |                                     |

  Scenario: allowing one is the person's override, and shows as on
    Given an applet that requires "dm, upload, relay" and may use ""
    And the shell can offer "dm, upload, relay"
    And the person keeps "upload" beside messages
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label    | on  | locked | note                               |
      | unsafe   | upload | uploads  | yes | no     | |
      | unsafe   | relay  | network  | no  | no     | |
      | required | dm     | messages | yes | yes    |                                    |

  Scenario: messages the person switches on make the required domains unsafe, and switching them off puts them back
    Given an applet that requires "upload" and may use "dm"
    And the shell can offer "upload, dm"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label    | on  | locked | note |
      | required | upload | uploads  | yes | yes    |      |
      | optional | dm     | messages | no  | no     |      |
    Given the person switches on "dm"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label    | on  | locked | note                               |
      | unsafe   | upload | uploads  | no  | no     | |
      | optional | dm     | messages | yes | no     |                                    |

  Scenario: an optional domain that messages withhold stays off and fixed, in the optional group
    Given an applet that requires "dm" and may use "relay, notify"
    And the shell can offer "dm, relay, notify"
    And the applet was earlier granted "relay"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label         | on  | locked | note                              |
      | required | dm     | messages      | yes | yes    |                                   |
      | optional | relay  | network       | no  | yes    | off while it can read your messages |
      | optional | notify | notifications | no  | no     |                                   |

  Scenario: a baseline domain the applet requires, such as talking to other applets, can be unsafe too
    Given an applet that requires "dm, inc" and may use ""
    And the shell baseline is "inc"
    And the shell can offer "dm"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label                    | on | locked | note                               |
      | unsafe   | inc    | talking to other applets | no | no     | |
      | required | dm     | messages                 | yes | yes   |                                    |

  Scenario: a baseline domain the applet only mentions is withheld, off and fixed
    Given an applet that requires "dm" and may use "inc"
    And the shell baseline is "inc"
    And the shell can offer "dm"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label                    | on  | locked | note                                |
      | required | dm     | messages                 | yes | yes    |                                     |
      | optional | inc    | talking to other applets | no  | yes    | off while it can read your messages |

  Scenario: required messages that this shell cannot offer seal nothing
    Given an applet that requires "dm, upload" and may use ""
    And the shell can offer "upload"
    When the shell groups the grants for a first review
    Then the grant groups are:
      | group    | domain | label    | on  | locked | note                                     |
      | required | dm     | messages | no  | yes    | needed, and this shell cannot provide it |
      | required | upload | uploads  | yes | yes    |                                          |


  Scenario: on Run the required domains are granted, switched-on optional ones too, and what was switched off is taken back
    Given an applet that requires "identity" and may use "notify, relay"
    And the shell can offer "identity, notify, relay"
    And the applet was earlier granted "relay"
    And the person switches on "notify"
    And the person switches off "relay"
    Then the grants to apply are "allow identity, allow notify, revoke relay"

  Scenario: nothing is applied for what already stands, for a baseline domain, or for one the shell cannot offer
    Given an applet that requires "identity, outbox" and may use "theme"
    And the shell baseline is "theme"
    And the shell can offer "identity"
    And the applet was earlier granted "identity"
    Then the grants to apply are ""

  Scenario: an overridden unsafe domain is granted beside messages, and dropping the override keeps the grant
    Given an applet that requires "dm, upload, relay" and may use ""
    And the shell can offer "dm, upload, relay"
    And the person keeps "upload" beside messages
    Then the grants to apply are "allow upload beside messages, allow dm"
    Given the applet was earlier granted "dm, upload"
    And the applet was earlier kept "upload" beside messages
    And the person keeps nothing beside messages
    Then the grants to apply are "allow upload outside messages"

  Scenario: an override that already stands is not applied again, for a granted domain or a baseline one
    Given an applet that requires "dm, upload, inc" and may use ""
    And the shell baseline is "inc"
    And the shell can offer "dm, upload"
    And the applet was earlier granted "dm, upload"
    And the applet was earlier kept "upload, inc" beside messages
    And the person keeps "upload" beside messages
    And the person keeps "inc" beside messages
    Then the grants to apply are ""

  Scenario: an unsafe domain left off is not granted, and one granted before is left as it is
    Given an applet that requires "dm, upload" and may use ""
    And the shell can offer "dm, upload"
    And the applet was earlier granted "dm, upload"
    Then the grants to apply are ""

  Scenario: a domain messages withhold is never taken back by leaving it off
    Given an applet that requires "dm" and may use "relay"
    And the shell can offer "dm, relay"
    And the applet was earlier granted "dm, relay"
    Then the grants to apply are ""

  Scenario Outline: byte counts read in binary units
    Then the shell shows <bytes> bytes as "<text>"

    Examples:
      | bytes         | text     |
      | 0             | 0 B      |
      | 512           | 512 B    |
      | 1536          | 1.5 KiB  |
      | 20480         | 20 KiB   |
      | 1048576       | 1.0 MiB  |
      | 2199023255552 | 2048 GiB |

  Scenario: an applet that can read messages keeps only what cannot send them on (D-046)
    Then with "dm,identity" switched on, these are withheld and say "off while it can read your messages":
      | relay | outbox | upload | webrtc | inc | cvm | resource | link | llm | fs | cache | media | something-new |
    And with "dm,identity" switched on, these stay:
      | shell | dm | identity | theme | storage | config | notify | keys | intent |
    And with "relay,identity" switched on, nothing is withheld from "relay,upload,webrtc,inc"
