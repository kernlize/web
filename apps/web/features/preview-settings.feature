Feature: Applet settings in the preview
  The preview keeps an applet's settings the way the live shell does: kehto's
  own config service over the core's store, keyed by the applet rather than
  its version. The Notes sample registers a schema and asks for its form; the
  form's commit is validated, saved and sent back to the applet.

  Scenario: a granted applet opens its form and hears what was saved
    Given a preview kernl
    And the preview kernl user granted "config" to "notes"
    And the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"settings"}'
    Then the preview kernl frame "a" is answered "yes" with 'Its settings: signature "", size 15, tone "calm", compact false.'
    And the preview kernl host showed the settings for "Notes" with fields "signature,size,tone,compact,token"
    When the person commits '{"size":20,"token":"t0ken"}' in the preview settings form
    Then the preview kernl frame "a" is answered "yes" with "size 20"
    And the preview kernl frame "a" is answered "yes" with "token set"
    And the preview kernl frame "a" was never sent "t0ken"
    When the preview kernl frame "a" posts '{"kernlPreview":"settings"}'
    Then the preview kernl host showed the settings form 2 times

  Scenario: settings outlive the window that set them
    Given a preview kernl
    And the preview kernl user granted "config" to "notes"
    And the preview kernl mounts "notes" in frame "a"
    And the preview kernl frame "a" posts '{"kernlPreview":"settings"}'
    And the person commits '{"size":13}' in the preview settings form
    When the preview kernl closes the applet in frame "a"
    And the preview kernl mounts "notes" in frame "b"
    And the preview kernl frame "b" posts '{"kernlPreview":"settings"}'
    Then the preview kernl frame "b" is answered "yes" with "size 13"

  Scenario: an applet without the grant is refused
    Given a preview kernl
    And the preview kernl mounts "notes" in frame "a"
    When the preview kernl frame "a" posts '{"kernlPreview":"settings"}'
    Then the preview kernl frame "a" is answered "no" with "no grant for its settings"
    And the preview kernl host showed the settings form 0 times

  Scenario: a host that cannot show the form offers no settings
    Given a preview kernl whose host shows no settings
    And the preview kernl user granted "config" to "notes"
    When the preview kernl plans "notes"
    Then the preview kernl plan grants "" beyond the baseline
