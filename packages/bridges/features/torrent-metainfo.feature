Feature: Torrent metainfo
  Before kernl hands a .torrent file to the person's torrent client it reads the file
  itself: to know the info hash the client will name the torrent by, to show what is
  inside, and to refuse a file whose paths could reach outside the torrent or whose
  encoding different programs would read differently.

  Scenario: a single-file torrent is named by the SHA-1 of its info dictionary
    Given a torrent file holding one 40000 byte file "night-mix.flac"
    When the torrent file is read
    Then the torrent metainfo info hash is the SHA-1 of the info dictionary as it sits in the file
    And the torrent metainfo name is "night-mix.flac"
    And the torrent metainfo is not private
    And the torrent metainfo totals 40000 bytes
    And the torrent metainfo lists the files:
      | path           | size  |
      | night-mix.flac | 40000 |
    And the torrent metainfo lists the trackers "https://tracker.example/announce, udp://backup.example:6969"

  Scenario: a private folder torrent lists every file by its path inside the torrent
    Given a torrent file holding the private folder "Field Recordings"
    When the torrent file is read
    Then the torrent metainfo info hash is the SHA-1 of the info dictionary as it sits in the file
    And the torrent metainfo name is "Field Recordings"
    And the torrent metainfo is private
    And the torrent metainfo totals 60000 bytes
    And the torrent metainfo lists the files:
      | path               | size  |
      | notes.txt          | 10000 |
      | day one/dawn.flac  | 20000 |
      | day two/dusk.flac  | 30000 |
    And the torrent metainfo lists the trackers "https://private.example/announce"

  Scenario: a torrent without trackers still reads
    Given a torrent file that names no tracker
    When the torrent file is read
    Then the torrent metainfo info hash is the SHA-1 of the info dictionary as it sits in the file
    And the torrent metainfo lists the trackers ""

  Scenario: a hybrid torrent is read by its v1 half
    Given a torrent file that is a v1 and v2 hybrid
    When the torrent file is read
    Then the torrent metainfo info hash is the SHA-1 of the info dictionary as it sits in the file
    And the torrent metainfo totals 40000 bytes

  Scenario: a v2-only torrent has no hash a v1 client would know it by
    Given a torrent file that is v2 only
    When the torrent file is read
    Then reading the torrent file fails with "invalid:metainfo-format"

  Scenario Outline: a file that <defect> is not a torrent
    Given a torrent file that <defect>
    When the torrent file is read
    Then reading the torrent file fails with "invalid:metainfo"
    And the torrent file refusal is exactly "invalid:metainfo"

    Examples:
      | defect                                   |
      | is empty                                 |
      | is plain text                            |
      | is a list instead of a dictionary        |
      | stops in the middle                      |
      | has bytes after its end                  |
      | is nested deeper than any torrent        |
      | is larger than any torrent               |

  Scenario Outline: a torrent file that <defect> could be read two ways, so it is refused
    Given a torrent file that <defect>
    When the torrent file is read
    Then reading the torrent file fails with "invalid:metainfo"
    And the torrent file refusal is exactly "invalid:metainfo"

    Examples:
      | defect                                   |
      | has its keys out of order                |
      | repeats a key                            |
      | pads a number with zeros                 |
      | writes zero as minus zero                |
      | pads a string length with zeros          |
      | claims a string longer than the file     |
      | holds a number too large to count with   |

  Scenario Outline: a torrent file that <defect> lacks what a client needs
    Given a torrent file that <defect>
    When the torrent file is read
    Then reading the torrent file fails with "invalid:metainfo"
    And the torrent file refusal is exactly "invalid:metainfo"

    Examples:
      | defect                                   |
      | has no info dictionary                   |
      | has a list for its info                  |
      | has no name                              |
      | has a number for its name                |
      | has neither a length nor files           |
      | has both a length and files              |
      | has a negative length                    |
      | has text for its length                  |
      | has an empty file list                   |
      | has text for its file list               |
      | lists a file that is not a dictionary    |
      | lists a file with no path                |
      | has no piece hashes                      |
      | has the wrong number of piece hashes     |
      | has a piece length of zero               |
      | has sizes that overflow when added       |
      | has a number for its tracker             |
      | has text for its tracker list            |

  Scenario Outline: a torrent file that <defect> could reach outside the torrent, so it is refused
    Given a torrent file that <defect>
    When the torrent file is read
    Then reading the torrent file fails with "invalid:metainfo"
    And the torrent file refusal is exactly "invalid:metainfo"

    Examples:
      | defect                                   |
      | is named ".."                            |
      | is named with a slash                    |
      | has an empty name                        |
      | lists a file under ".."                  |
      | lists a file under "."                   |
      | lists a file with an absolute path       |
      | lists a file with a backslash path       |
      | lists a file on a drive letter           |
      | lists a file with an empty path part     |
      | lists a file with a NUL in its name      |

  Scenario Outline: a magnet link names its info hash
    When the info hash of the magnet link "<magnet>" is read
    Then the magnet link info hash is "abcdef0123456789abcdef0123456789abcdef01"

    Examples:
      | magnet                                                                                              |
      | magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01                                        |
      | magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Night%20Mix&tr=udp%3A%2F%2Ft.example |
      | magnet:?xt=urn:btih:VPG66AJDIVTYTK6N54ASGRLHRGV433YB                                                |
      | magnet:?dn=first&xt=urn:btmh:1220aaaa&xt=urn:btih:vpg66ajdivtytk6n54asgrlhrgv433yb                  |
      | MAGNET:?xt=URN:BTIH:ABCDEF0123456789ABCDEF0123456789ABCDEF01                                        |

  Scenario Outline: a link that names no v1 info hash is refused
    When the info hash of the magnet link "<magnet>" is read
    Then reading the magnet link fails with "invalid:magnet"

    Examples:
      | magnet                                                              |
      |                                                                     |
      | https://example.com/file.torrent                                    |
      | magnet:?dn=only-a-name                                              |
      | magnet:?xt=urn:btih:abcdef                                          |
      | magnet:?xt=urn:btih:zzzzzz0123456789abcdef0123456789abcdef01        |
      | magnet:?xt=urn:btih:VPG66AJDIVTYTK6N54ASGRLHRGV433Y1                |
      | magnet:?xt=urn:btmh:1220abcdef0123456789abcdef0123456789abcdef01    |
      | magnet:xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01         |
