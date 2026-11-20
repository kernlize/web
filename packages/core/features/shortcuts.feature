Feature: Applets' keyboard shortcuts
  An applet registers named actions, each with the key it would like, without
  being granted anything: keyboard shortcuts are part of the baseline. The
  shell binds the key, tells the applet which keys it holds, and runs the
  action when the key is pressed on the shell's own page while the applet's
  window is the focused one. A key the shell keeps for itself is never bound,
  and a key an applet had no shortcut for comes back to the host, so the
  shell's own shortcuts work while an applet has focus (D-049).

  Background:
    Given a kernl host over empty storage
    And a fake applesauce pool serving a signed manifest for "chat" requiring "relay"

  Scenario: the shell binds the key an applet asks for and tells it which keys it holds
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    Then the applet received a "shell.init" with domains "shell,storage,inc,theme,keys"
    When the applet registers the action "editor.save" on "Ctrl+S" over its port
    Then the applet received a "keys.registerAction.result" whose "binding" is "Ctrl+S"
    And the applet was last told its bindings are "editor.save=Ctrl+S"

  Scenario: an applet registers its whole keymap at once
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers 40 actions at once over its port
    Then the applet has no answer to its registrations yet
    When the applet's first second is over
    Then all 40 registrations were answered with a binding
    And the shell guard reported nothing

  Scenario: a keymap held for a window is not handed on early when the window is focused
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers 40 actions at once over its port
    And the applet window becomes "focused"
    Then the applet has no answer to its registrations yet
    When the applet's first second is over
    Then all 40 registrations were answered with a binding

  Scenario: a hidden window's keymap waits until the window is seen again
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers 40 actions at once over its port
    And the applet window becomes "hidden"
    And a second passes
    Then the applet has no answer to its registrations yet
    When the applet window becomes "focused"
    Then all 40 registrations were answered with a binding

  Scenario: the wait for a window's first second, step by step
    Then the keymap hold over a 1000 ms startup decides
      | window | at   | message                                 | holds | holding |
      | w1     | 0    | {"type":"storage.get"}                  | no    | no      |
      | w1     | 100  | {"type":"keys.registerAction"}          | yes   | yes     |
      | w1     | 200  | {"type":"keys.unregisterAction"}        | yes   | yes     |
      | w1     | 300  | {"type":"keys.forward"}                 | no    | yes     |
      | w1     | 5000 | {"type":"keys.registerAction"}          | yes   | yes     |
      | w2     | 0    | "keys.registerAction"                   | no    | no      |
      | w2     | 10   | null                                    | no    | no      |
      | w2     | 1000 | {"type":"keys.registerAction"}          | no    | no      |
      | w2     | 1001 | {"type":"keys.registerAction"}          | no    | no      |
    And the keymap hold hands on "w1" after 900 ms and holds nothing for it afterwards
    And a forgotten window is never handed on

  Scenario: a key pressed outside the applet runs its action, and does nothing else on the page
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers the action "editor.save" on "Ctrl+S" over its port
    And "Ctrl+S" is pressed on the shell
    Then the applet was told to run "editor.save" 1 times
    And the page was kept from acting on the last key
    When "Ctrl+Q" is pressed on the shell
    Then the applet was told to run "editor.save" 1 times
    And the page was left to act on the last key

  Scenario Outline: a key the shell used itself does not reach applets
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers the action "duck.hop" on "Space" over its port
    And "Space" is pressed on the shell <where>
    Then the applet was told to run "duck.hop" <times> times

    Examples:
      | where                              | times |
      | in a text field                    | 0     |
      | on a button                        | 0     |
      | in editable text                   | 0     |
      | while a character is composed      | 0     |
      | after the shell handled it         | 0     |
      | on the window's title bar          | 1     |
      | on something with no element name  | 1     |

  Scenario: only the focused window's action runs
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers the action "editor.save" on "Ctrl+S" over its port
    And the applet window becomes "visible but not focused"
    And "Ctrl+S" is pressed on the shell
    Then the applet was told to run "editor.save" 0 times
    And the page was left to act on the last key
    When the applet window becomes "focused"
    And "Ctrl+S" is pressed on the shell
    Then the applet was told to run "editor.save" 1 times

  Scenario: a key the shell keeps for itself is not bound
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers the action "steal.launcher" on "Alt+/" over its port
    Then the applet received a "keys.registerAction.result" whose "actionId" is "steal.launcher"
    And the applet's "keys.registerAction.result" names no binding
    When "Alt+/" is pressed on the shell
    Then the applet was told to run "steal.launcher" 0 times

  Scenario: an action the applet drops no longer runs
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers the action "editor.save" on "Ctrl+S" over its port
    And the applet drops the action "editor.save" over its port
    Then the applet was last told its bindings are ""
    When "Ctrl+S" is pressed on the shell
    Then the applet was told to run "editor.save" 0 times

  Scenario: a key an applet had no shortcut for comes back to the host
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet forwards "Alt+/" over its port
    Then the host was handed the keys "Alt+/"

  Scenario: a held key is the person's typing, not a flood
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet forwards "ArrowUp" 400 times over its port
    And the applet forwards "Alt+/" over its port
    Then the host was handed the keys "ArrowUp,Alt+/"
    And the host was told of no revocation
    And the shell guard reported nothing

  Scenario: a window that is not focused cannot press the shell's keys
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet window becomes "visible but not focused"
    And the applet forwards "Alt+/" over its port
    Then the host was handed the keys ""

  Scenario: the same key pressed again after a pause is a new press
    Then the forwarded-key filter over one window decides
      | at   | message                                | focused | drops |
      | 0    | {"type":"keys.forward","key":"a"}      | yes     | no    |
      | 500  | {"type":"keys.forward","key":"a"}      | yes     | yes   |
      | 1000 | {"type":"keys.forward","key":"a"}      | yes     | yes   |
      | 1100 | {"type":"keys.forward","key":"b"}      | yes     | no    |
      | 1150 | {"type":"keys.forward","key":"a"}      | yes     | no    |
      | 1750 | {"type":"keys.forward","key":"a"}      | yes     | no    |
      | 1800 | {"type":"keys.forward","key":"a"}      | no      | yes   |
      | 1810 | {"type":"storage.get","key":"a"}       | no      | no    |
      | 1820 | "keys.forward"                         | yes     | no    |
      | 1830 | null                                   | yes     | no    |

  Scenario: a host that takes no keys ignores a forwarded one
    Given a kernl shell over that host and pool
    And a mounted applet that has said hello and was granted nothing
    When the applet forwards "Alt+/" over its port
    And the applet registers the action "editor.save" on "Ctrl+S" over its port
    Then the applet received a "keys.registerAction.result" whose "binding" is "Ctrl+S"
    And the host was told of no revocation

  Scenario: without being told where, the shell hears keys on the page
    Given a page whose document hears keys
    And a kernl shell over that host and pool
    And a mounted applet that has said hello and was granted nothing
    When the applet registers the action "editor.save" on "Ctrl+S" over its port
    And "Ctrl+S" is pressed on the shell
    Then the applet was told to run "editor.save" 1 times

  Scenario: a destroyed shell stops listening for keys
    Given a kernl shell over that host and pool that hears keys and keeps "Alt+/" for itself
    And a mounted applet that has said hello and was granted nothing
    When the applet registers the action "editor.save" on "Ctrl+S" over its port
    And the shell is destroyed
    And "Ctrl+S" is pressed on the shell
    Then the applet was told to run "editor.save" 0 times
