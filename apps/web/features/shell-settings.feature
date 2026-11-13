Feature: An applet's settings form
  The shell draws an applet's settings from the schema it registered: a text
  box, a masked box for a secret, a list for a fixed set of choices, a number
  box within its bounds and a checkbox, grouped by the applet's sections. The
  form gives plain words for what is wrong before it commits, and the commit
  itself still validates, saves and tells the applet.

  Background:
    Given an applet settings schema
      """
      {
        "type": "object",
        "required": ["level"],
        "properties": {
          "nickname": { "type": "string", "description": "Shown to others" },
          "level": { "type": "integer", "minimum": 1, "maximum": 5, "x-napplet-section": "look", "x-napplet-order": 2 },
          "tone": { "type": "string", "title": "Colour tone", "enum": ["calm", "bright"], "x-napplet-section": "look", "x-napplet-order": 1 },
          "zoom": { "type": ["number", "null"], "x-napplet-section": "look" },
          "rounded_corners": { "type": "boolean", "x-napplet-section": "look" },
          "apiKey": { "type": "string", "x-napplet-secret": true, "x-napplet-section": "account" },
          "size": { "enum": [1, 2] , "x-napplet-section": "look" },
          "flags": { "type": "boolean", "enum": [true] },
          "tags": { "type": "array", "items": { "type": "string" } },
          "blank": { "type": "string", "x-napplet-section": "" },
          "odd": {}
        }
      }
      """
    And the applet's current settings are '{"level":3,"apiKey":"s3cret","tags":["a"],"size":2}'

  Scenario: the schema becomes sections of fields, ordered as the applet asked
    Then the settings form has sections "General,Look,Account"
    And the settings section "General" has fields "blank:text,flags:toggle,nickname:text"
    And the settings section "Look" has fields "tone:choice,level:number,rounded_corners:toggle,size:choice,zoom:number"
    And the settings section "Account" has fields "apiKey:secret"
    And the setting "nickname" is labelled "Nickname" and described "Shown to others"
    And the setting "rounded_corners" is labelled "Rounded corners"
    And the setting "apiKey" is labelled "Api key" and keeps its saved value
    And the setting "tone" is labelled "Colour tone" with choices "calm,bright"
    And the setting "size" has choices "1,2"
    And the setting "level" is a whole number from 1 to 5 and needed
    And the setting "zoom" is any number without bounds

  Scenario: the form starts from the current values and never shows a secret
    Then the settings draft is '{"blank":"","flags":false,"nickname":"","tone":"","level":"3","rounded_corners":false,"size":"2","zoom":"","apiKey":""}'

  Scenario: an untouched form commits the current values back
    When the person saves the settings form unchanged
    Then the settings commit received '{"level":3,"apiKey":"s3cret","tags":["a"],"size":2,"blank":"","flags":false,"nickname":"","rounded_corners":false}'

  Scenario: edited fields replace the current values
    When the person sets the settings draft '{"level":5,"zoom":"1.5","apiKey":"n3w","rounded_corners":true,"size":""}'
    And the person picks "bright" for the setting "tone"
    And the person saves the settings form
    Then the settings commit received '{"level":5,"apiKey":"n3w","tags":["a"],"blank":"","flags":false,"nickname":"","tone":"bright","rounded_corners":true,"zoom":1.5}'

  Scenario Outline: the form names what to fix before it commits
    When the person sets the settings draft '<draft>'
    And the person saves the settings form
    Then the settings form says "<words>"
    And nothing was committed

    Examples:
      | draft              | words                    |
      | {"level":""}       | Level is needed.         |
      | {"level":null}     | Level is needed.         |
      | {"level":"two"}    | Level needs a number.    |
      | {"level":"2.5"}    | Level needs a whole number. |
      | {"level":0}        | Level is at least 1.     |
      | {"level":"9"}      | Level is at most 5.      |

  Scenario: a refused commit comes back as plain words
    Given the settings commit refuses
    When the person saves the settings form unchanged
    Then the settings form says "These settings were not accepted. Check the values and try again."

  Scenario: a secret never set stays unset, and a schema without settings draws nothing
    Given the applet's current settings are '{"level":1}'
    When the person saves the settings form unchanged
    Then the settings commit received '{"level":1,"blank":"","flags":false,"nickname":"","rounded_corners":false}'
    And the setting "apiKey" does not keep a saved value
    Given an applet settings schema
      """
      { "type": "object" }
      """
    Then the settings form has sections ""
