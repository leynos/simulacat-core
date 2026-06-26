Feature: Shared domain writes are visible through read surfaces

  Scenario: A repository description written once is visible through REST and GraphQL
    Given a write-capable simulator seeded with organization "acme" and repository "awesome-repo"
    When the client PATCHes repository "acme/awesome-repo" with description "Patched via shared action"
    Then the response status is 200
    And REST repository "acme/awesome-repo" has description "Patched via shared action"
    And GraphQL repository "acme/awesome-repo" has description "Patched via shared action"
