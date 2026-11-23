Feature: Floor: an applet runs in a locked frame, whatever modules are loaded
  The frame is part of the kernel. Whatever modules a host loads, an applet's
  bytes reach the frame only through `srcdoc`, under `sandbox="allow-scripts"`
  and the guard's Content Security Policy, and never in a nested frame
  (SOUL §2, D-014, D-061).

  Background:
    Given a verified applet summary for "chat" requiring "relay,identity"
    And a shell adapter whose resolver allows "shell,identity,storage,theme,inc"

  Scenario: the plan carries only the sandbox and the guard's policy
    When the shell plans the mount in window "w1" under the "strict" profile
    Then the plan is for window "w1" with sandbox "allow-scripts"
    And the plan srcdoc starts with the CSP meta and contains the namespace prelude and the verified html
    And the plan srcdoc CSP ends with "require-trusted-types-for 'script'; trusted-types default"

  Scenario: markup that declares a nested frame is refused before it is planned
    Given a verified applet summary for "chat" with markup '<!doctype html><html><body><iframe srcdoc="x"></iframe></body></html>'
    When the shell tries to plan the mount in window "w1"
    Then the shell refused with "denied:nested-frame"

  Scenario: sandbox tokens a host left on the frame are dropped, never widened
    Given a plan for window "w1"
    And a fake frame whose sandbox is already "allow-same-origin allow-scripts allow-popups"
    When the shell mounts the plan into the frame
    Then the frame sandbox attribute is exactly "allow-scripts"
    And the frame srcdoc is the plan srcdoc
