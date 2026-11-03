Feature: Applet content security policy
  Every applet frame gets kehto's zero-network baseline. Profiles loosen
  limits and thresholds, never the sandbox (D-003).

  Scenario Outline: no profile grants a connection origin
    When the guard builds the applet CSP for the "<profile>" profile
    Then the guard CSP grants no connection origins
    And the guard CSP directive "connect-src" is "'none'"

    Examples:
      | profile  |
      | strict   |
      | balanced |
      | relaxed  |

  Scenario: the directives are kehto's zero-network baseline
    When the guard builds the applet CSP for the "strict" profile
    Then the guard CSP has 14 directives
    And the guard CSP directive "default-src" is "'none'"
    And the guard CSP directive "script-src" is "'unsafe-inline' 'wasm-unsafe-eval'"
    And the guard CSP directive "style-src" is "'unsafe-inline'"
    And the guard CSP directive "img-src" is "data: blob:"
    And the guard CSP directive "font-src" is "data:"
    And the guard CSP directive "worker-src" is "'none'"
    And the guard CSP directive "child-src" is "'none'"
    And the guard CSP directive "frame-src" is "'none'"
    And the guard CSP directive "media-src" is "'none'"
    And the guard CSP directive "object-src" is "'none'"
    And the guard CSP directive "manifest-src" is "'none'"
    And the guard CSP directive "base-uri" is "'none'"
    And the guard CSP directive "form-action" is "'none'"

  Scenario: the relaxed profile does not loosen the CSP
    Then the guard CSP for the "relaxed" profile equals the CSP for the "strict" profile

  Scenario: the policy renders as a meta-ready string
    When the guard builds the applet CSP for the "strict" profile
    And the guard renders the CSP
    Then the rendered guard CSP is:
      """
      default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'
      """
