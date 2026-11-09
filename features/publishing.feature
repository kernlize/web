Feature: Publishing to two registries
  Scenario: Prepare the same release under each registry's scope
    Given the publishable workspace packages
    When the JSR release workspace is prepared
    Then npm packages use the kernlize scope and built exports
    And JSR packages use the kernl scope and TypeScript exports
    And JSR internal dependencies use the matching workspace versions
    And JSR sources exclude tests and resolve relative TypeScript imports
