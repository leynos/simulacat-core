@cross-owner-identity
Feature: Repository identity is owner-scoped and ref-safe

  Background:
    Given a simulator seeded with organizations "acme" and "globex"
    And each organization owns a repository named "awesome-repo"
    And each repository has a "main" branch
    And each repository has a "README.md" blob

  Scenario: Listing repositories under one owner does not leak the other
    When the client GETs "/orgs/acme/repos"
    Then the response status is 200
    And the response contains exactly one repository
    And the repository "full_name" is "acme/awesome-repo"

  Scenario: Listing branches is scoped to the requested repository
    When the client GETs "/repos/acme/awesome-repo/branches"
    Then the response status is 200
    And the response contains exactly one branch
    And the branch belongs to "acme/awesome-repo"

  Scenario: GraphQL repository lookup resolves the correct owner
    When the client queries GraphQL for repository "acme/awesome-repo"
    Then the result has nameWithOwner "acme/awesome-repo"
    And the result has Repository.id "Repository:acme/awesome-repo"

  Scenario: Repository node_id values are owner-qualified and distinct
    Then the seeded repositories have non-empty node_id values
    And the two repositories' node_id values decode to different strings
    And every node_id begins with "Repository:"

  Scenario: Seeding duplicate canonical keys is rejected
    When the simulator is seeded with two repositories whose owner and name are both "acme/awesome-repo"
    Then parsing the initial state throws an error
    And the error message includes the duplicated key
