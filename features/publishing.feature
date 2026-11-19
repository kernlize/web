Feature: Publishing to two registries
  Scenario: Prepare the same release under each registry's scope
    Given the publishable workspace packages
    When the JSR release workspace is prepared
    Then npm packages use the kernlize scope and built exports
    And JSR packages use the kernl scope and TypeScript exports
    And JSR internal dependencies use the matching workspace versions
    And JSR sources exclude tests and resolve relative TypeScript imports

  Scenario: A JSR release may use the project's own upstream releases on the day they ship
    Given the publishable workspace packages
    When the JSR release workspace is prepared
    Then every kehto and napplet dependency is exempt from Deno's minimum dependency age
    And every other dependency keeps Deno's default minimum dependency age
