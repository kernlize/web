Feature: The applet store's catalogue
  The store lists applets from signed manifests on the applet relays and the
  public relays. Each entry is read from a manifest whose signature verifies;
  its bytes are verified only when it is opened. Entries can be searched
  loosely, filtered by topic, by what the shell offers and by the requests
  they take, and the most common topics become filter bubbles.

  Scenario: a signed manifest becomes a store entry
    Given a catalogue manifest "minesweeper" titled "Minesweeper" with topics "Game, puzzle,game" requiring "storage" and an icon on "https://cdn.example/"
    When the catalogue reads that manifest found on "wss://relay.one"
    Then the catalogue entry is titled "Minesweeper" with topics "game,puzzle" and requires "storage"
    And the catalogue entry address decodes to the manifest coordinate with relay "wss://relay.one"
    And the catalogue entry icon is the icon hash on "https://cdn.example"
    And the catalogue entry catalogue id is kehto's for "minesweeper"

  Scenario: an applet that takes requests lists its roles and conventions
    Given a catalogue manifest "notepad" titled "Notepad" taking "text-editor" requests "napplet:text-editor/open,napplet:text-editor/edit"
    When the catalogue reads that manifest found on "wss://relay.one"
    Then the catalogue entry takes roles "text-editor" and conventions "napplet:text-editor/open,napplet:text-editor/edit"
    And the catalogue entry has no icon

  Scenario: an untitled root applet is named for what it is
    Given a root catalogue manifest without a title
    When the catalogue reads that manifest found on ""
    Then the catalogue entry is titled "Untitled applet" with topics "" and requires "relay"
    And the catalogue entry address is a shareable address

  Scenario: an older manifest is listed by its name, with its roles read from its routing pairs
    Given a legacy catalogue manifest "people" taking "napplet:profile/open" without a title or description
    When the catalogue reads that manifest found on ""
    Then the catalogue entry is titled "people" with topics "" and requires "relay"
    And the catalogue entry takes roles "profile" and conventions "napplet:profile/open"
    And the catalogue entry has no description

  Scenario: a pinned version's address names the event
    Given a snapshot catalogue manifest
    Then the snapshot's address decodes to its event id

  Scenario Outline: what the catalogue refuses to list
    Given a catalogue manifest that is <problem>
    When the catalogue reads that manifest found on ""
    Then the catalogue has no entry

    Examples:
      | problem              |
      | signed by someone else |
      | missing its hash     |

  Scenario: the newest version of each applet wins
    Given catalogue entries "chat@1,chat@3,notes@2,chat@2"
    When the catalogue keeps the newest of each
    Then the catalogue lists "chat@3,notes@2"

  Scenario: the store reads the applet relays and the public relays, newest first
    Given the fake pool serves catalogue manifests "older@1,newer@5,older@4" and a forged one
    When the catalogue loads from the shell's relays
    Then the catalogue lists "newer@5,older@4"
    And the catalogue asked "wss://relay.napplet.soy,wss://relay.damus.io,wss://nos.lol,wss://relay.primal.net" for named and root manifests limited to 500

  Scenario: the store can be narrowed to publishers and a smaller page
    Given the fake pool serves catalogue manifests "solo@1"
    When the catalogue loads 20 manifests from the test publisher
    Then the catalogue asked for 20 manifests from the test publisher

  Scenario: a relay that never finishes does not hold the store back
    Given the fake pool serves catalogue manifests "early@1" and then never finishes
    When the catalogue loads from the shell's relays waiting 20 ms
    Then the catalogue lists "early@1"

  Scenario: a dead relay leaves an empty store, not an error
    Given the fake pool fails requests
    When the catalogue loads from the shell's relays
    Then the catalogue lists ""

  Scenario Outline: loose matching of one search word
    Then the search score of "<word>" in "<field>" is <score>

    Examples:
      | word  | field             | score |
      | chess | chess club        | 4     |
      | che   | chess club        | 3     |
      | ess   | chess club        | 2     |
      | chss  | chess club        | 1     |
      | chb   | chess club        | 0     |
      | ch    | chess club rules  | 3     |
      | xyz   | chess club        | 0     |
      | ccr   | chess club        | 0     |
      |       | chess club        | 0     |
      | chess |                   | 0     |

  Scenario: search ranks titles above descriptions and needs every word
    Given a searchable catalogue
    Then searching "chess" finds "Chess,Puzzle Box"
    And searching "chess board" finds "Chess"
    And searching "chess spaceship" finds ""
    And searching "" finds "Chess,Puzzle Box,Notepad,Bitmap"
    And searching "editor" finds "Notepad"
    And searching "bitmp" finds "Bitmap"
    And searching the publisher finds every entry

  Scenario: search filters by topic, by what the shell offers and by request
    Given a searchable catalogue
    Then searching "" with topics "game" finds "Chess,Puzzle Box"
    And searching "" with topics "game,puzzle" finds "Puzzle Box"
    And searching "" with the shell offering "storage,relay" finds "Chess,Puzzle Box,Notepad"
    And searching "" accepting "napplet:text-editor/open" finds "Notepad"
    And searching "" accepting "napplet:profile/open" finds ""

  Scenario: popular topics come first, ties alphabetically
    Given a searchable catalogue
    Then the popular topics are "game:2,art:1,puzzle:1,writing:1"
    And the 2 most popular topics are "game:2,art:1"
