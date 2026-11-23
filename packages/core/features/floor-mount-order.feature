Feature: Floor: mounting follows one order and every revocation removes the frame, whatever modules are loaded
  Register, set the environment, observe the frame, then assign `srcdoc`. A
  frame that is revoked for any reason is removed and never reused. No module
  takes part in the order or keeps a frame alive (AGENTS.md, D-061).

  Background:
    Given a verified applet summary for "chat" requiring "relay,identity"
    And a shell adapter whose resolver allows "shell,identity,storage,theme,inc"

  Scenario: the frame is sandboxed and registered before it holds any code
    Given a plan for window "w1"
    And a fake frame
    When the shell mounts the plan into the frame
    Then the mount steps were "sandbox,register,setEnvironment,observeFrame,srcdoc"

  Scenario: closing removes the frame and drops the guard's state
    Given a plan for window "w1"
    And a fake frame
    And the shell mounts the plan into the frame
    When the shell closes the applet
    Then the frame was removed
    And the guard forgot "w1"

  Scenario: a revocation from the bridge removes the frame and tells the host
    Given a plan for window "w1"
    And a fake frame
    And the shell mounts the plan into the frame
    When the bridge reports the applet revoked for "second-load"
    Then the frame was removed
    And the host was told "w1" was revoked for "second-load"
