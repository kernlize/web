Feature: Client address check
  A person types the address of a program they already run. Before kernl saves or
  calls it, the shell works out whether the address is plain or encrypted, compares
  that with how kernl's own page was loaded, and refuses the combinations a browser
  would block or that would leak a secret. An address without a scheme is tried
  encrypted first.

  Scenario Outline: an encrypted page calling an encrypted address needs no warning
    When the client address "<typed>" is checked for a page loaded over <page>
    Then the client address check allows "<url>" on <where> with notes "<notes>"

    Examples:
      | typed                          | page  | url                         | where           | notes |
      | https://nas.example:9091       | https | https://nas.example:9091    | another machine |       |
      | HTTPS://NAS.Example:443/       | https | https://nas.example         | another machine |       |
      | https://nas.example/sabnzbd/   | https | https://nas.example/sabnzbd | another machine |       |
      | https://nas.example//          | https | https://nas.example         | another machine |       |
      | https://nas.example/a/../gui/  | https | https://nas.example/gui     | another machine |       |
      | https://[2001:DB8::1]:8443/    | https | https://[2001:db8::1]:8443  | another machine |       |
      | https://localhost:5030         | https | https://localhost:5030      | this device     |       |

  Scenario Outline: an encrypted page may call a plain address when it is this device
    When the client address "<typed>" is checked for a page loaded over <page>
    Then the client address check allows "<url>" on <where> with notes "<notes>"

    Examples:
      | typed                          | page  | url                           | where       | notes              |
      | http://localhost:8080/sabnzbd  | https | http://localhost:8080/sabnzbd | this device | cleartext-loopback |
      | HTTP://LocalHost:80/           | https | http://localhost              | this device | cleartext-loopback |
      | http://localhost.:8080         | https | http://localhost.:8080        | this device | cleartext-loopback |
      | http://slskd.localhost:5030    | https | http://slskd.localhost:5030   | this device | cleartext-loopback |
      | http://127.0.0.1:9091          | https | http://127.0.0.1:9091         | this device | cleartext-loopback |
      | http://127.255.255.254         | https | http://127.255.255.254        | this device | cleartext-loopback |
      | http://127.1:9091              | https | http://127.0.0.1:9091         | this device | cleartext-loopback |
      | http://0x7f.0.0.1              | https | http://127.0.0.1              | this device | cleartext-loopback |
      | http://2130706433              | https | http://127.0.0.1              | this device | cleartext-loopback |
      | http://017700000001            | https | http://127.0.0.1              | this device | cleartext-loopback |
      | http://[::1]:6789              | https | http://[::1]:6789             | this device | cleartext-loopback |
      | http://[0:0:0:0:0:0:0:1]       | https | http://[::1]                  | this device | cleartext-loopback |

  Scenario Outline: a plain page may call anything, and the person is told what that costs
    When the client address "<typed>" is checked for a page loaded over <page>
    Then the client address check allows "<url>" on <where> with notes "<notes>"

    Examples:
      | typed                          | page | url                       | where           | notes              |
      | http://nas.local:9091          | http | http://nas.local:9091     | another machine | cleartext          |
      | http://192.168.1.20:8080       | http | http://192.168.1.20:8080  | another machine | cleartext          |
      | http://[::ffff:127.0.0.1]      | http | http://[::ffff:7f00:1]    | another machine | cleartext          |
      | http://localhost:8080          | http | http://localhost:8080     | this device     | cleartext-loopback |
      | http://[::1]                   | http | http://[::1]              | this device     | cleartext-loopback |
      | https://nas.example:9091       | http | https://nas.example:9091  | another machine | page-insecure      |
      | https://localhost:5030         | http | https://localhost:5030    | this device     | page-insecure      |

  Scenario Outline: an encrypted page may not call a plain address on another machine
    When the client address "<typed>" is checked for a page loaded over <page>
    Then the client address check refuses with "<reason>"

    Examples:
      | typed                            | page  | reason                |
      | http://nas.local:9091            | https | invalid:mixed-content |
      | http://192.168.1.20:8080         | https | invalid:mixed-content |
      | http://128.0.0.1                 | https | invalid:mixed-content |
      | http://[::ffff:127.0.0.1]        | https | invalid:mixed-content |
      | http://[fe80::1]                 | https | invalid:mixed-content |
      | http://localhost.example.com     | https | invalid:mixed-content |
      | http://notlocalhost              | https | invalid:mixed-content |

  Scenario Outline: something that is not a web address is refused
    When the client address "<typed>" is checked for a page loaded over <page>
    Then the client address check refuses with "<reason>"

    Examples:
      | typed                            | page  | reason          |
      | ftp://nas.local/files            | https | invalid:scheme  |
      | magnet:?xt=urn:btih:abcdef       | http  | invalid:scheme  |
      | file:///etc/passwd               | http  | invalid:scheme  |
      | nas.local:9091                   | http  | invalid:scheme  |
      |                                  | https | invalid:address |
      | nas.local                        | https | invalid:address |
      | http://                          | http  | invalid:address |
      | http://nas.local:99999           | http  | invalid:address |
      | http://exa mple.com              | http  | invalid:address |
      | http://256.1.1.1.1               | http  | invalid:address |

  Scenario Outline: an address carrying a secret, a query or a fragment is refused
    When the client address "<typed>" is checked for a page loaded over <page>
    Then the client address check refuses with "<reason>"

    Examples:
      | typed                            | page  | reason                         |
      | http://me:secret@localhost:8080  | https | invalid:credentials-in-address |
      | https://me@nas.example           | https | invalid:credentials-in-address |
      | http://me:secret@nas.local/?a=b  | https | invalid:credentials-in-address |
      | https://nas.example/api?apikey=k | https | invalid:address                |
      | https://nas.example/?            | https | invalid:address                |
      | https://nas.example/gui#top      | https | invalid:address                |
      | https://nas.example/#            | https | invalid:address                |

  Scenario Outline: the addresses to try for what was typed
    Then the client addresses to try for "<typed>" on a page loaded over <page> are "<candidates>"

    Examples:
      | typed                     | page  | candidates                                             |
      | nas.local:9091            | http  | https://nas.local:9091, http://nas.local:9091          |
      | nas.local:9091            | https | https://nas.local:9091                                 |
      | localhost:8080/sabnzbd/   | https | https://localhost:8080/sabnzbd, http://localhost:8080/sabnzbd |
      | 127.1:5030                | https | https://127.0.0.1:5030, http://127.0.0.1:5030          |
      | [::1]:5030                | https | https://[::1]:5030, http://[::1]:5030                  |
      | NAS.local                 | http  | https://nas.local, http://nas.local                    |
      | http://nas.local:9091     | http  | http://nas.local:9091                                  |
      | https://nas.local:9091    | https | https://nas.local:9091                                 |
      | http://nas.local:9091     | https | invalid:mixed-content                                  |
      | ftp://nas.local           | http  | invalid:scheme                                         |
      | me:secret@nas.local       | http  | invalid:credentials-in-address                         |
      | nas.local/api?key=1       | http  | invalid:address                                        |
      | magnet:?xt=urn:btih:abc   | http  | invalid:address                                        |
      |                           | https | invalid:address                                        |

  Rule: detection asks the program itself, encrypted first

    Background:
      Given two loopback programs stand in for the encrypted and the plain port of a typed client address

    Scenario: the encrypted client port answers, so the plain one is never asked
      Given the encrypted client port answers as the program
      And the plain client port answers as the program
      When the client address "nas.local:9091" is detected from a page loaded over http
      Then the detected client address is "https://nas.local:9091" with notes "page-insecure"
      And the detection result came from the encrypted client port
      And the client address detection asked "https://nas.local:9091"

    Scenario: nothing listens on the encrypted port, so the plain one is found
      Given the encrypted client port is switched off
      And the plain client port answers as the program
      When the client address "localhost:8080/sabnzbd" is detected from a page loaded over https
      Then the detected client address is "http://localhost:8080/sabnzbd" with notes "cleartext-loopback"
      And the detection result came from the plain client port
      And the client address detection asked "https://localhost:8080/sabnzbd, http://localhost:8080/sabnzbd"

    Scenario: something else answers on the encrypted port, so the plain one is found
      Given the encrypted client port answers as some other program
      And the plain client port answers as the program
      When the client address "nas.local:9091" is detected from a page loaded over http
      Then the detected client address is "http://nas.local:9091" with notes "cleartext"
      And the client address detection asked "https://nas.local:9091, http://nas.local:9091"

    Scenario: the program refuses the key on the encrypted port, so the key is not sent anywhere else
      Given the encrypted client port refuses the key
      And the plain client port answers as the program
      When the client address "nas.local:9091" is detected from a page loaded over http
      Then the client address detection fails with "denied:credentials"
      And the client address detection asked "https://nas.local:9091"

    Scenario: neither port answers as the program, and the last failure is the one reported
      Given the encrypted client port is switched off
      And the plain client port answers as some other program
      When the client address "nas.local:9091" is detected from a page loaded over http
      Then the client address detection fails with "unavailable:bad-response"
      And the client address detection asked "https://nas.local:9091, http://nas.local:9091"

    Scenario: an encrypted page never tries the plain port of another machine
      Given the encrypted client port is switched off
      And the plain client port answers as the program
      When the client address "nas.local:9091" is detected from a page loaded over https
      Then the client address detection fails with "unavailable:unreachable"
      And the client address detection asked "https://nas.local:9091"

    Scenario: a typed scheme is the only one tried
      Given the encrypted client port answers as the program
      And the plain client port answers as the program
      When the client address "http://nas.local:9091/" is detected from a page loaded over http
      Then the detected client address is "http://nas.local:9091" with notes "cleartext"
      And the client address detection asked "http://nas.local:9091"

    Scenario: an address that may not be used is refused before anything is asked
      Given the encrypted client port answers as the program
      And the plain client port answers as the program
      When the client address "http://nas.local:9091" is detected from a page loaded over https
      Then the client address detection fails with "invalid:mixed-content"
      And the client address detection asked ""
