Feature: Conversations name their people
  Applets list conversations through the shell's dm domain. The shell names
  each participant from their published profile, so a messaging applet shows
  names without looking anyone up itself. A label the provider already gave is
  kept, and a person with no profile keeps no label (D-031).

  Scenario: participants are named from profiles; provider labels and unknown people are left alone
    Given a conversation adapter listing a conversation with "ada,bob=Bobby,cy"
    And profiles naming "ada" as "Ada Lovelace" and "bob" as "Robert"
    When the shell lists conversations through the naming adapter
    Then the participants are "ada=Ada Lovelace,bob=Bobby,cy"
    And the naming adapter still answers status, messages, send and subscriptions as the backend does
