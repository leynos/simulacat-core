@shared-domain-writes
Feature: Shared domain writes are visible through read surfaces

  Scenario: A repository description written once is visible through REST and GraphQL
    Given a write-capable simulator seeded with organization "acme" and repository "awesome-repo"
    When the client PATCHes repository "acme/awesome-repo" with description "Patched via shared action"
    Then the response status is 200
    And REST repository "acme/awesome-repo" has description "Patched via shared action"
    And GraphQL repository "acme/awesome-repo" has description "Patched via shared action"

  Scenario: A user-owned repository description written once is visible through REST and GraphQL
    Given a write-capable simulator seeded with user "octocat" and repository "personal-repo"
    When the client PATCHes repository "octocat/personal-repo" with description "Patched user repository"
    Then the response status is 200
    And REST repository "octocat/personal-repo" has description "Patched user repository"
    And GraphQL repository "octocat/personal-repo" has description "Patched user repository"
