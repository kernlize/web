Feature: Nested-frame lock
  An applet has no use for a child frame, and a child srcdoc frame is a fresh
  realm that no policy reaches. The guard refuses static frame markup before it
  becomes a document, and a script that runs before any applet code closes the
  string sinks and element factories that could mint one. Ported from kehto
  4d8a5693 until kehto ships it (D-014).

  Scenario: the CSP carries the Trusted Types directives that arm the lock
    When the guard builds the applet CSP for the "strict" profile
    Then the guard CSP Trusted Types directives are "require-trusted-types-for 'script'; trusted-types default"

  Scenario: the frame-lock script is one inline element that applies the lock to its window
    When the guard renders the frame-lock script
    Then the frame-lock script opens with "<script data-kernl-frame-lock>(" and closes with ")(window);</script>"
    And the frame-lock script closes no element before its end

  Scenario: the Trusted Types default policy passes ordinary markup and refuses frame tags
    Given an applet realm with Trusted Types, element factories and a document factory
    When the frame lock is applied to the realm
    Then the realm registered one Trusted Types policy named "default"
    And the policy passes "<p>hello</p>" for "Element innerHTML"
    And the policy passes "<iframes>" for "Element innerHTML"
    And the policy passes "<ifr" for "Element innerHTML"
    And the policy passes "<p>" with no sink named
    And the policy refuses "<iframe srcdoc=x>" for "Element innerHTML"
    And the policy refuses "<IFRAME>" for "Element insertAdjacentHTML"
    And the policy refuses "</object>" for "Element outerHTML"
    And the policy refuses "<embed src=x>" for "DOMParser parseFromString"
    And the policy refuses "<ifr" for "Document write"
    And the policy passes scripts and script addresses through

  Scenario: the element factories refuse frame elements and delegate everything else
    Given an applet realm with Trusted Types, element factories and a document factory
    When the frame lock is applied to the realm
    Then creating element "iframe" in the realm is refused
    And creating element "FRAMESET" in the realm is refused
    And creating element "div" in the realm is delegated with the document as receiver
    And creating "html:iframe" in the HTML namespace is refused
    And creating "embed" in the HTML namespace is refused
    And creating "iframe" in the SVG namespace is delegated
    And creating a nameless element in the HTML namespace is delegated
    And creating a document rooted at "fencedframe" in the HTML namespace is refused
    And creating a document rooted at "html" in the HTML namespace is delegated
    And the realm's factories cannot be redefined

  Scenario: hardening never blocks a realm it cannot change
    Given an applet realm whose Trusted Types policy name is taken and whose prototypes are frozen
    When the frame lock is applied to the realm
    Then the frame lock did not throw
    And creating element "iframe" in the realm is delegated with the document as receiver

  Scenario: a realm without Trusted Types or factories is left as it is
    Given an applet realm with nothing to harden
    When the frame lock is applied to the realm
    Then the frame lock did not throw

  Scenario Outline: without a parser the markup scan matches frame tags lexically
    Then applet markup "<markup>" has a frame: <frame>

    Examples:
      | markup                              | frame |
      | <iframe srcdoc='x'></iframe>        | yes   |
      | <OBJECT data='x'>                   | yes   |
      | <portal/>                           | yes   |
      | <p>no frames</p>                    | no    |
      | <iframes>                           | no    |
      | <!-- <iframe> -->                   | yes   |

  Scenario: with a parser the markup scan walks elements, templates and shadow roots
    Given a host parser that builds the trees below
    Then applet markup "html-frame" parsed by the host has a frame: yes
    And applet markup "svg-frame" parsed by the host has a frame: no
    And applet markup "template-frame" parsed by the host has a frame: yes
    And applet markup "shadow-frame" parsed by the host has a frame: yes
    And applet markup "plain" parsed by the host has a frame: no
    And applet markup "<iframe> in a parser that throws" parsed by the host has a frame: yes

  Scenario: the assertion refuses frame markup with a stable reason
    Then asserting applet markup "<p>ok</p>" has no frame passes
    And asserting applet markup "<embed src=x>" has no frame is refused with "denied:nested-frame"
