Feature: Toolchain smoke
  Scenario: the package exports its name
    When I import the guard package
    Then the package name is "@kernl/guard"
