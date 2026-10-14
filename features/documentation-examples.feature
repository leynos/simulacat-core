@documented-examples
Feature: Users-guide examples remain runnable

  @documentation-examples
  Scenario: The quick start works from the published guide text
    When the quick-start examples from the users guide are executed
    Then every quick-start example contract passes
