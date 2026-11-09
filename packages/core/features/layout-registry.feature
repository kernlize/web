Feature: Layout registry
  A window manager offers the layouts in a registry. kernl ships four; a
  developer's own layout is one registration, and it is listed like the rest.

  Scenario: the default layouts are the four strategies, floating first
    Given the default layouts
    Then the layouts are:
      | id           | label          | freeform |
      | floating     | floating       | yes      |
      | dwindle      | tiled          | no       |
      | columns      | columns        | no       |
      | master-stack | main and stack | no       |

  Scenario: the default layouts take the spacing they are given
    Given the default layouts with a gap of 8 and a margin of 0
    When the layout "dwindle" arranges 2 windows in 1000 by 600
    Then the layout placed them at:
      | x   | y | w   | h   |
      | 0   | 0 | 496 | 600 |
      | 504 | 0 | 496 | 600 |

  Scenario: a layout of your own is one registration
    Given the default layouts
    When a layout "rows" labelled "rows" is registered
    Then the layouts are:
      | id           | label          | freeform |
      | floating     | floating       | yes      |
      | dwindle      | tiled          | no       |
      | columns      | columns        | no       |
      | master-stack | main and stack | no       |
      | rows         | rows           | no       |
    When the layout "rows" arranges 2 windows in 1000 by 600
    Then the layout placed them at:
      | x | y   | w    | h   |
      | 0 | 0   | 1000 | 300 |
      | 0 | 300 | 1000 | 300 |

  Scenario: an id can be registered once
    Given the default layouts
    When a layout "columns" labelled "side by side" is registered
    Then the layout registry refuses with "invalid:duplicate-layout"

  Scenario: a registry starts with what it is given, and nothing else
    Given an empty layout registry
    Then there are no layouts
    And there is no layout "floating"
    When a layout "rows" labelled "rows" is registered
    Then the layouts are:
      | id   | label | freeform |
      | rows | rows  | no       |
