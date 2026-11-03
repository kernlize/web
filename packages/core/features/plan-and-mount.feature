Feature: Planning and mounting an applet
  A plan narrows the applet's environment under the user's grants and prepares
  the verified bytes with the guard's CSP. Mounting follows the NIP-5D order:
  register, set environment, observe the frame, assign srcdoc. The frame is
  removed on every revocation reason and never reused.

  Background:
    Given a verified applet summary for "chat" requiring "relay,identity"
    And a shell adapter whose resolver allows "shell,identity,storage,theme,inc"

  Scenario: the plan carries the narrowed environment, the CSP and what is missing
    When the shell plans the mount in window "w1" under the "strict" profile
    Then the plan is for window "w1" with sandbox "allow-scripts"
    And the plan environment domains are "shell,identity,storage,theme,inc"
    And the plan is missing required domains "relay"
    And the plan srcdoc starts with the CSP meta and contains the namespace prelude and the verified html

  Scenario: the frame lock runs after kehto's prelude and before any applet script (D-014)
    Given a verified applet summary for "chat" with markup '<!doctype html><html><head><script>applet()</script></head><body>hi</body></html>'
    When the shell plans the mount in window "w1" under the "strict" profile
    Then the plan srcdoc holds, in order, "the CSP meta,kehto's prelude,the frame lock,the applet script"
    And the plan srcdoc CSP ends with "require-trusted-types-for 'script'; trusted-types default"
    And the plan srcdoc has exactly 1 frame lock

  Scenario: markup that declares a nested frame is refused before it is planned (D-014)
    Given a verified applet summary for "chat" with markup '<!doctype html><html><body><iframe srcdoc="x"></iframe></body></html>'
    When the shell tries to plan the mount in window "w1"
    Then the shell refused with "denied:nested-frame"

  Scenario: a srcdoc kehto shaped differently is refused rather than mounted unlocked
    When the frame lock splices "<b>" into "a<i>c"
    Then the shell refused with "unavailable:frame-lock"
    When the frame lock splices "<b>" into "a<b>c<b>"
    Then the spliced text is "a<b><lock>c<b>"

  Scenario: mounting follows the NIP-5D order and hardens the frame
    Given a plan for window "w1"
    And a fake frame
    When the shell mounts the plan into the frame
    Then the mount steps were "sandbox,register,setEnvironment,observeFrame,srcdoc"
    And the frame sandbox attribute is exactly "allow-scripts"
    And the frame allow attribute is "gamepad 'none'; hid 'none'; usb 'none'"
    And the frame srcdoc is the plan srcdoc
    And the applet status is "mounting"
    When the frame fires its load event
    Then the applet status is "running"
    And the frame has 0 load listeners

  Scenario: a frame with existing permissions is hardened in place
    Given a plan for window "w1"
    And a fake frame with a getAttribute and allow "camera; gamepad"
    When the shell mounts the plan into the frame
    Then the frame sandbox attribute is exactly "allow-scripts"
    And the frame allow attribute is "camera; gamepad 'none'; hid 'none'; usb 'none'"

  Scenario: sandbox tokens the host left on the frame are dropped, never widened
    Given a plan for window "w1"
    And a fake frame whose sandbox is already "allow-same-origin allow-scripts allow-popups"
    When the shell mounts the plan into the frame
    Then the frame sandbox attribute is exactly "allow-scripts"
    And the mount steps were "sandbox,register,setEnvironment,observeFrame,srcdoc"

  Scenario: a frame without a window cannot be mounted
    Given a plan for window "w1"
    And a detached fake frame
    When the shell mounts the plan into the frame
    Then the shell refused with "invalid:frame-detached"

  Scenario: closing revokes through the bridge, removes the frame and drops guard state
    Given a plan for window "w1"
    And a fake frame
    And the shell mounts the plan into the frame
    When the shell closes the applet
    Then the bridge revoked "w1" with reason "host"
    And the registry unregistered "w1"
    And the frame was removed
    And the guard forgot "w1"
    And the applet status is "closed"
    And the observed statuses are "mounting,closed"
    When the shell closes the applet
    And the frame fires its load event
    Then the applet status is "closed"
    And the bridge revoked 1 times

  Scenario: a bridge revocation removes the frame and tells the host
    Given a plan for window "w1"
    And a fake frame
    And the shell mounts the plan into the frame
    When the bridge reports the applet revoked for "second-load"
    Then the applet status is "revoked"
    And the frame was removed
    And the guard forgot "w1"
    And the host was told "w1" was revoked for "second-load"
    When the shell closes the applet
    Then the bridge revoked 0 times
    And the applet status is "revoked"

  Scenario: a revocation after close is ignored
    Given a plan for window "w1"
    And a fake frame
    And the shell mounts the plan into the frame
    When the shell closes the applet
    And the bridge reports the applet revoked for "port-closed"
    Then the applet status is "closed"
    And the host was not told about a revocation

  Scenario: visibility is forwarded to the guard
    Given a plan for window "w1"
    And a fake frame
    And the shell mounts the plan into the frame
    When the shell marks the applet hidden
    Then the guard saw "w1" become hidden
