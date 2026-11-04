Feature: Insertion lock
  kehto's nested-context lock refuses frame creation at string sinks and
  element factories. A frame element only becomes a fresh realm once it is
  connected to a document, and some creation routes slip past those factories,
  so kernl also guards every insertion method, reads node identity through
  native getters captured before applet code runs, refuses custom elements that
  extend frames and removes the XSLT processor (D-014).

  Background:
    Given an insertion-lock realm with every insertion method
    When the insertion lock is applied to the realm

  Scenario Outline: every insertion method refuses a frame and passes ordinary nodes
    Then inserting a frame with "<owner>" "<method>" is refused
    And inserting a paragraph with "<owner>" "<method>" is delegated

    Examples:
      | owner            | method                |
      | Node             | appendChild           |
      | Node             | insertBefore          |
      | Node             | replaceChild          |
      | Element          | append                |
      | Element          | prepend               |
      | Element          | replaceChildren       |
      | Element          | before                |
      | Element          | after                 |
      | Element          | replaceWith           |
      | Element          | insertAdjacentElement |
      | Element          | moveBefore            |
      | Document         | append                |
      | DocumentFragment | replaceChildren       |
      | CharacterData    | before                |
      | DocumentType     | after                 |
      | Range            | insertNode            |
      | Range            | surroundContents      |

  Scenario: frames hidden inside containers are found
    Then inserting an element whose descendant is a frame is refused
    And inserting a fragment whose descendant is a frame is refused
    And inserting a template whose content holds a frame is refused
    And inserting an element whose shadow root holds a frame is refused
    And inserting a frame in a foreign namespace is delegated
    And inserting text and non-nodes is delegated

  Scenario: an element cannot disguise itself by overriding its own name
    Then inserting a frame that claims to be a "div" is refused

  Scenario: custom elements cannot extend frames
    Then defining a custom element that extends "iframe" is refused
    And defining a custom element whose class inherits a frame element is refused
    And defining an ordinary custom element is delegated
    And defining a custom element with no class is delegated
    And the realm has no XSLT processor

  Scenario: the pinned methods cannot be redefined
    Then the realm's insertion methods cannot be redefined

  Scenario: a realm the lock cannot change is left working
    Given an insertion-lock realm with frozen prototypes and no custom elements
    When the insertion lock is applied to the realm
    Then the insertion lock did not throw
    And inserting a frame with "Node" "appendChild" is delegated

  Scenario: a realm without templates still finds nested frames
    Given an insertion-lock realm without templates
    When the insertion lock is applied to the realm
    Then inserting an element whose descendant is a frame is refused

  Scenario: a realm with nothing to guard is left as it is
    Given an empty insertion-lock realm
    When the insertion lock is applied to the realm
    Then the insertion lock did not throw

  Scenario: the insertion-lock script is one inline element that applies the lock to its window
    When the guard renders the insertion-lock script
    Then the insertion-lock script opens with "<script data-kernl-insertion-lock>(" and closes with ")(window);</script>"
    And the insertion-lock script closes no element before its end
    And the insertion-lock script applies the insertion lock
