Feature: Site motion
  The landing site crosses between its own pages behind a curtain, and draws its
  stage in the page's own colours (DECISIONS D-023). The shell, the docs and plain
  files are not the site's pages: they load on their own, with no curtain.

  Scenario Outline: only the site's own pages carry the curtain
    Then the path "<path>" under the base "<base>" <verdict> a site page

    Examples:
      | path                    | base   | verdict |
      | /                       | /      | is      |
      | /about/                 | /      | is      |
      | /about/guard/           | /      | is      |
      | /about/guard            | /      | is      |
      | /app/                   | /      | is not  |
      | /app                    | /      | is not  |
      | /docs/tutorials/        | /      | is not  |
      | /llms.txt               | /      | is not  |
      | /about/index.md         | /      | is not  |
      | /web/                   | /web/  | is      |
      | /web                    | /web   | is      |
      | /web/about/why/         | /web   | is      |
      | /web/app/               | /web/  | is not  |
      | /elsewhere/about/       | /web/  | is not  |
      | /application/           | /      | is      |

  Scenario Outline: a move within one page is a scroll, not a crossing
    Then moving from "<from>" to "<to>" <verdict> the page

    Examples:
      | from                      | to                              | verdict         |
      | https://kernl.run/        | https://kernl.run/about/        | changes         |
      | https://kernl.run/about/  | https://kernl.run/              | changes         |
      | https://kernl.run/        | https://kernl.run/#adopt        | does not change |
      | https://kernl.run/#adopt  | https://kernl.run/              | does not change |
      | https://kernl.run/app/    | https://kernl.run/app/?open=abc | changes         |
      | https://kernl.run/        | https://example.com/            | does not change |

  Scenario Outline: a theme colour is read as unit channels
    Then the stage reads the colour "<colour>" as "<channels>"

    Examples:
      | colour    | channels            |
      | #ffffff   | 1, 1, 1             |
      | #000      | 0, 0, 0             |
      | #efb449   | 0.937, 0.706, 0.286 |
      |  #F80     | 1, 0.533, 0         |
      | 0c0e11    | 0.047, 0.055, 0.067 |

  Scenario Outline: a colour the stage cannot read is mid grey, never an error
    Then the stage reads the colour "<colour>" as "0.5, 0.5, 0.5"

    Examples:
      | colour                    |
      |                           |
      | rgba(239, 180, 73, 0.14)  |
      | #12345                    |
      | #gggggg                   |

  Scenario: the stage takes its colours from the theme tokens
    Given the theme tokens:
      | token       | value   |
      | --ink-muted | #9a968c |
      | --ink       | #ebe6da |
      | --accent    | #efb449 |
      | --bg-sunken | #080a0c |
    Then the stage palette is:
      | role   | channels            |
      | ink    | 0.604, 0.588, 0.549 |
      | bright | 0.922, 0.902, 0.855 |
      | accent | 0.937, 0.706, 0.286 |
      | panel  | 0.031, 0.039, 0.047 |
