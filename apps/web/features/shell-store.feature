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
      | https://applets.example/n/naddr1qvzqqqrcvypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qqdkuctswpkx2apddpskuervv4ez6urjv4nx2un9de3k2uc050cjv?ref=share | is     |
      | try nevent1qqsrhuxx8l9ex335q7he0f09aej04zpazpl0ne2cgukyawd24mayt8gpp4mhxue69uhkummn9ekx7mqzyrhxagf6h8l9cjngatumrg60uq22v66qz979pm32v985ek54ndh8gj8u2gng please | is     |
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

  Scenario: a failure the store knows is shown in its words, and nothing is logged
    Then opening fails with "unavailable:preview-offline" and the store says "The preview runs offline. Pick one of the applets in the store." without a warning

  Scenario: a failure the store has no words for is said generically and left in the console
    Then opening fails with "Relay sockets exploded" and the store says "Could not open the applet. Try again, or try another address." with a warning
