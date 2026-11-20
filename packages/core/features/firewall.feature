Feature: The firewall
  kehto's firewall decides every request an applet makes. kernl gives it rules,
  so the person is not asked about each one: what they granted is allowed, and
  opening a link outside the shell asks every time. The person can change the
  rules and take back the answers they gave (D-049).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: the shipped rules allow everything and ask about links
    Then the shipped firewall rules allow by default and ask about "link.open" only

  Scenario: starting an applet asks the person nothing
    Given a kernl shell whose host answers firewall questions
    And a mounted applet granted "relay" that has said hello
    Then the host was asked 0 firewall questions
    And the firewall holds a rule-given "access" answer for domain "relay"
    And the firewall holds no answers the person gave

  Scenario: opening a link asks every time and opens only on yes
    Given a kernl shell whose host answers firewall questions
    And a mounted applet granted "link" that has said hello
    When the applet asks to open link 1 at "https://example.com/a"
    Then the host was asked a "link" firewall question by "Chat" with choices "allow-once,deny"
    And the firewall question is about "link.open" of "https://example.com/a" in domain "link"
    And the host opened no links
    When the person answers the firewall question with "allow-once"
    Then link 1 was "opened"
    And the host opened "https://example.com/a" as already approved
    When the applet asks to open link 2 at "https://example.com/a"
    Then the host was asked 2 firewall questions
    And the firewall holds no answers the person gave

  Scenario Outline: a link the person does not allow is not opened
    Given a kernl shell whose host answers firewall questions
    And a mounted applet granted "link" that has said hello
    When the applet asks to open link 1 at "https://example.com/a"
    And the person answers the firewall question with "<answer>"
    Then link 1 was "denied"
    And the host opened no links

    Examples:
      | answer        |
      | deny          |
      | dismiss       |
      | allow-always  |

  Scenario: a host that cannot ask has links refused, never allowed
    Given a kernl shell over that host and pool
    And a mounted applet granted "link" that has said hello
    When the applet asks to open link 1 at "https://example.com/a"
    Then link 1 was "denied"
    And the host opened no links

  Scenario: a rule the person loosened opens links without asking
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"operation":"link.open"}' is set to "allow"
    And a mounted applet granted "link" that has said hello
    When the applet asks to open link 1 at "https://example.com/a"
    Then link 1 was "opened"
    And the host was asked 0 firewall questions
    And the host opened "https://example.com/a" as already approved

  Scenario: a rule for one applet does not loosen the others
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"applet":"nip5d:35129:0000000000000000000000000000000000000000000000000000000000000000:other","operation":"link.open"}' is set to "allow"
    And a mounted applet granted "link" that has said hello
    When the applet asks to open link 1 at "https://example.com/a"
    Then the host was asked 1 firewall questions

  Scenario: a link question is withdrawn when the applet closes
    Given a kernl shell whose host answers firewall questions
    And a mounted applet granted "link" that has said hello
    When the applet asks to open link 1 at "https://example.com/a"
    And the shell closes the mounted applet
    Then the firewall question was withdrawn
    When the person answers the firewall question with "allow-once"
    Then the host opened no links

  Scenario: a domain set to ask is put to the person when the applet starts
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"domain":"relay"}' is set to "ask"
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    Then the host was asked a "access" firewall question by "Chat" with choices "allow-session,allow-always,deny"
    And the firewall question is about "access" of "relay" in domain "relay"
    When the person answers the firewall question with "allow-always"
    Then the plan is ready and offers "relay"
    And the firewall told its listeners of an answer the person gave
    And the firewall holds an "always" answer the person gave for domain "relay"
    And the host storage holds the firewall's answers under "kernl:firewall-decisions:v1"

  Scenario: refusing a domain the applet requires refuses the start
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"domain":"relay"}' is set to "ask"
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    And the person answers the firewall question with "deny"
    Then planning failed with "denied:firewall"
    And the shell runtime holds no session for the planned window

  Scenario: a domain the rules deny is left out when the applet does not require it
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"domain":"theme"}' is set to "deny"
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    Then the plan is ready and offers "relay"
    And the plan does not offer "theme"
    And the host was asked 0 firewall questions

  Scenario: taking back an answer stops the applet that ran under it
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"domain":"relay"}' is set to "ask"
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    And the person answers the firewall question with "allow-session"
    And the plan is mounted
    Then the firewall holds a "session" answer the person gave for domain "relay"
    When the person takes that answer back
    Then the host was told the window was revoked for "firewall"
    And the mounted frame was removed
    And the shell has 0 applets

  Scenario: taking back one window's answer leaves another window of the applet running
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"domain":"relay"}' is set to "ask"
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    And the person answers the firewall question with "allow-session"
    And the plan is mounted
    And the shell starts planning the applet
    And the person answers the firewall question with "allow-session"
    And the plan is mounted
    Then the shell has 2 applets
    When the person takes the first of their answers back
    Then the host was told window "applet-1" was revoked for "firewall" and no other
    And the shell has 1 applets

  Scenario: tightening a rule stops an applet the old rule let start
    Given a kernl shell whose host answers firewall questions
    And a mounted applet granted "relay" that has said hello
    When the firewall rule for '{"domain":"relay"}' is set to "ask"
    Then the host was told the window was revoked for "firewall"
    And the firewall holds no rule-given answer for domain "relay"

  Scenario: restoring the shipped rules takes back what a looser rule gave
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"operation":"link.open"}' is set to "allow"
    And a mounted applet granted "link" that has said hello
    When the applet asks to open link 1 at "https://example.com/a"
    And the firewall rules are restored
    Then the shipped firewall rules are in force
    And the host was told the window was revoked for "firewall"

  Scenario: taking every answer back stops every applet
    Given a kernl shell whose host answers firewall questions
    And a mounted applet granted "relay" that has said hello
    When the person takes every firewall answer back
    Then the host was told the window was revoked for "firewall"
    And the firewall holds no answers at all

  Scenario: a plan whose answers were taken back cannot be mounted
    Given a kernl shell whose host answers firewall questions
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    And the plan is ready and offers "relay"
    And the person takes every firewall answer back
    Then mounting the plan fails with "denied:admission-expired"

  Scenario: plans left unmounted are dropped, oldest first
    Given a kernl shell whose host answers firewall questions
    And the applet is resolved and granted "relay"
    When the shell plans the applet 17 times without mounting
    Then mounting the first of those plans fails with "denied:admission-expired"
    And mounting the last of those plans works

  Scenario: a malformed rule is refused
    Given a kernl shell whose host answers firewall questions
    Then setting the firewall rule for '{"domain":"Not A Domain"}' fails with "invalid:rule"

  Scenario: rules are kept across visits
    Given a kernl shell whose host answers firewall questions
    And the firewall rule for '{"domain":"relay"}' is set to "ask"
    When the shell is destroyed
    And a kernl shell whose host answers firewall questions
    Then the firewall rule for domain "relay" is "ask"
    When the firewall rule for '{"domain":"relay"}' is removed
    Then the shipped firewall rules are in force

  Scenario: damaged stored rules fall back to the shipped ones
    Given the host storage holds "not rules" under "kernl:firewall-rules:v1"
    And a kernl shell whose host answers firewall questions
    Then the shipped firewall rules are in force

  Scenario: damaged stored answers refuse every start and tell the person
    Given the host storage holds "not answers" under "kernl:firewall-decisions:v1"
    And a kernl shell whose host answers firewall questions
    And the applet is resolved and granted "relay"
    When the shell starts planning the applet
    Then planning failed with "unavailable:firewall"
    And the host was told "Firewall: stored answers"

  Scenario Outline: the rules decide a request by its strictest requirement
    Given firewall rules over the host storage with '<rules>'
    Then those rules decide "<decision>" for a "link.open" request in domain "link" alongside access to "link"

    Examples:
      | rules                                                    | decision |
      | {"default":"allow"}                                      | allow    |
      | {"default":"allow","operations":{"link.open":"ask"}}     | ask      |
      | {"default":"ask","operations":{"link.open":"deny"}}      | deny     |
      | {"default":"allow","domains":{"link":"deny"}}            | deny     |

  Scenario Outline: a question offers each answer kehto allows, and a dismissal stores nothing
    When kehto asks about "<operation>" in domain "<domain>" as a "<category>" request, allowing "<lifetimes>"
    Then the firewall summary is a "<kind>" with choices "<choices>"
    And the answer for "<choice>" is "<answer>"

    Examples:
      | operation     | domain | category  | lifetimes               | kind    | choices                                    | choice        | answer           |
      | link.open     | link   | resource  | once,session,persistent | link    | allow-once,deny                            | allow-once    | allow once       |
      | link.open     | link   | resource  | once,session,persistent | link    | allow-once,deny                            | allow-session | cancel           |
      | access        | relay  | interface | session,persistent      | access  | allow-session,allow-always,deny            | allow-always  | allow persistent |
      | access        | relay  | interface | session                 | access  | allow-session,deny                         | allow-session | allow session    |
      | relay.network | relay  | network   | once,session,persistent | request | allow-once,allow-session,allow-always,deny | deny          | deny once        |
      | notify.send   | notify | resource  | once,session            | request | allow-once,allow-session,deny              | dismiss       | cancel           |

  Scenario: a question for an applet the shell did not plan is cancelled
    When kehto's firewall adapter is asked about an applet nobody planned
    Then that question was cancelled without the host being asked
