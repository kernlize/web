Feature: Envelope classification
  kehto treats the operation class as an opaque key. kernl assigns it from the
  envelope type, with deletions split out because they are the cheapest way to
  damage an account's public record.

  Scenario Outline: envelope types map to operation classes
    Then the guard classifies "<type>" as "<class>"

    Examples:
      | type                   | class            |
      | relay.subscribe        | relay:subscribe  |
      | relay.publish          | relay:publish    |
      | relay.publishEncrypted | relay:publish    |
      | relay.close            | control          |
      | outbox.subscribe       | outbox:subscribe |
      | outbox.query           | outbox:subscribe |
      | outbox.getEvent        | outbox:subscribe |
      | outbox.publish         | outbox:publish   |
      | outbox.close           | control          |
      | resource.fetch         | resource:bytes   |
      | resource.head          | resource:bytes   |
      | storage.set            | storage:write    |
      | storage.remove         | storage:write    |
      | storage.get            | control          |
      | storage.keys           | control          |
      | dm.send                | dm:send          |
      | dm.list                | control          |
      | intent.invoke          | intent:invoke    |
      | intent.open            | intent:invoke    |
      | shell.close            | control          |
      | inc.register           | control          |
      | theme.get              | control          |
      | identity.get           | control          |
      | clipboard.write        | generic          |

  Scenario Outline: publishing a deletion is its own class
    Then the guard classifies "<type>" with kind <kind> as "<class>"

    Examples:
      | type                   | kind | class                |
      | relay.publish          | 5    | relay:publish:delete |
      | relay.publishEncrypted | 5    | relay:publish:delete |
      | relay.publish          | 1    | relay:publish        |
      | outbox.publish         | 5    | outbox:publish       |

  Scenario: envelope size is the UTF-8 length of the JSON form
    Then the guard estimates the envelope '{"type":"relay.subscribe"}' as 26 bytes
    And the guard estimates the envelope '{"type":"é"}' as 13 bytes

  Scenario: a value JSON cannot represent measures as zero
    Then the guard estimates an unserialisable value as 0 bytes
