Feature: Floor: an applet runs in a locked frame, whatever modules are loaded
  The frame is part of the kernel. Whatever modules a host loads, an applet's
  bytes reach the frame only through `srcdoc`, under `sandbox="allow-scripts"`
  and the guard's Content Security Policy, and never in a nested frame
  (SOUL §2, D-014, D-061).

  Scenario: the plan carries only the sandbox and the guard's policy
    Given a verified applet summary for "chat" requiring "relay,identity"
    And a shell adapter whose resolver allows "shell,identity,storage,theme,inc"
    When the shell plans the mount in window "w1" under the "strict" profile
    Then the plan is for window "w1" with sandbox "allow-scripts"
    And the plan srcdoc starts with the CSP meta and contains the namespace prelude and the verified html
    And the plan srcdoc CSP ends with "require-trusted-types-for 'script'; trusted-types default"

  Scenario: markup that declares a nested frame is refused before it is planned
    Given a verified applet summary for "chat" with markup '<!doctype html><html><body><iframe srcdoc="x"></iframe></body></html>'
    And a shell adapter whose resolver allows "shell,identity,storage,theme,inc"
    When the shell tries to plan the mount in window "w1"
    Then the shell refused with "denied:nested-frame"

  Scenario: sandbox tokens a host left on the frame are dropped, never widened
    Given a verified applet summary for "chat" requiring "relay,identity"
    And a shell adapter whose resolver allows "shell,identity,storage,theme,inc"
    And a plan for window "w1"
    And a fake frame whose sandbox is already "allow-same-origin allow-scripts allow-popups"
    When the shell mounts the plan into the frame
    Then the frame sandbox attribute is exactly "allow-scripts"
    And the frame srcdoc is the plan srcdoc

  Scenario: the composed shell mounts into the sandbox alone
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"
    And a kernl shell over that host and pool
    When the shell resolves the manifest address
    And the shell plans the summary
    And the shell mounts the plan into a fake frame
    Then the mounted frame's sandbox is exactly "allow-scripts"
    And the mounted frame's srcdoc starts with the guard's policy
