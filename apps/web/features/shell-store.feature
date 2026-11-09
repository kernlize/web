Feature: The applet store's words and filters
  The store is where a person finds applets. Pasting an address always works;
  topics filter as bubbles; requests between applets are described as what
  they do; and a failure to open an applet is explained without its raw reason.

  Scenario Outline: an address pasted into the search is recognised
    Then "<text>" <is> an applet address

    Examples:
      | text                                                                                  | is     |
      | naddr1qvzqqqrcvypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qqdkuctswpkx2apddpskuervv4ez6urjv4nx2un9de3k2uc050cjv | is     |
      | nostr:naddr1qvzqqqrcvypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qqdkuctswpkx2apddpskuervv4ez6urjv4nx2un9de3k2uc050cjv | is     |
      | 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d                      | is     |
      | 35129:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:notes          | is     |
      | 3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:35129:notes          | is     |
      |   preview:notes                                                                       | is     |
      | chess                                                                                 | is not |
      | naddr1short                                                                           | is not |
      | open a profile                                                                        | is not |

  Scenario: selected topics stay in front of the popular ones
    Then the topic bubbles for popular "game:14,3d:5,social:3" with "puzzle,3d" selected are "puzzle:0:on,3d:5:on,game:14:off,social:3:off"
    And toggling "game" into "puzzle" selects "puzzle,game"
    And toggling "puzzle" out of "puzzle,game" selects "game"

  Scenario: what a listed applet needs that the shell does not offer is said in plain words
    Then an applet requiring "storage,fs,llm" on a shell offering "storage,relay" needs "your files,language models"
    And an applet requiring "storage" on a shell offering "storage" needs ""

  Scenario Outline: requests between applets read as what they do
    Then the request from "<source>" to "<action>" a "<archetype>" reads "<words>"
    And remembering it reads "<remember>"
    And the role "<archetype>" reads "<role>"

    Examples:
      | source | action    | archetype   | words                                     | remember                                  | role         |
      | Notes  | open      | profile     | Notes wants to open a profile.            | Always use it to open a profile           | Profiles     |
      | Feed   | edit      | text-editor | Feed wants to edit a text editor.         | Always use it to edit a text editor       | Text editors |
      | Chat   | open      | event       | Chat wants to open an event.              | Always use it to open an event            | Events       |
      | Chat   | show_more | address     | Chat wants to show more an address.       | Always use it to show more an address     | Address      |

  Scenario: the conventions an applet accepts read as actions
    Then accepting "napplet:profile/open,napplet:text-editor/edit,bogus" reads "open a profile, edit a text editor"
    And accepting "" reads ""

  Scenario Outline: why an applet could not be opened, in plain words
    Then the launch error for "<reason>" reads "<words>"

    Examples:
      | reason                       | words                                                                                 |
      | invalid:pointer              | That does not look like an applet address.                                            |
      | unavailable:manifest         | No applet was found at that address. Check it and try again.                          |
      | unavailable:preview-offline  | The preview runs offline. Pick one of the applets in the store.                      |
      | invalid:bad-hash and details | This applet did not pass the shell's checks, so it was not opened.                    |
      | unavailable:something        | The applet cannot be reached right now. Try again later.                              |
      | denied:other                 | The shell refused to open this applet.                                                |
      | timeout after 20s            | Looking up the applet took too long. Try again.                                       |
      | surprise                     | Could not open the applet. Try again, or try another address.                         |

  Scenario: a thrown error is explained by its message
    Then the launch error for a thrown "denied:blocked" reads "You blocked this applet. Unblock it from its grants first."
