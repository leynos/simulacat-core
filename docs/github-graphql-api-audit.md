# GitHub GraphQL API Audit

## Scope

This audit compares `packages/github-api` to the public GitHub GraphQL schema
at:

- `https://docs.github.com/public/fpt/schema.docs.graphql`

The question here is not only "does the schema exist", but:

- which parts of the GraphQL API are actually resolved
- which parts are store-backed and scriptable
- which parts are only nullable, empty, or effectively unimplemented

## Executive Summary

The GraphQL simulator exposes a very large schema surface but only a small
amount of real behaviour.

There are three important layers:

1. The package loads a full SDL file into GraphQL Yoga.
2. It provides a very small custom resolver map on top of that schema.
3. Anything else depends on GraphQL default field resolution, which usually
   means `null`, empty connections, or raw object properties if they happen to
   exist.

Relative to the public GitHub schema:

- the loaded runtime schema is already a mismatch, because the simulator uses
  the bundled enterprise schema, not the public dotcom schema
- explicit top-level coverage is tiny: 6 query resolvers and 0 mutation
  resolvers
- meaningful scriptability exists mostly for users, organizations,
  repositories, pagination, repo topics, and a few repository metadata fields
- much of the apparent breadth is schema-shaped only, not behaviourally mocked

## Key Findings

### 1. The runtime schema does not match the audited public schema

The GraphQL handler loads `schema.docs-enterprise.graphql`, not
`schema.docs.graphql` and not the public docs URL directly.

- `packages/github-api/src/graphql/handler.ts` loads
  `schema.docs-enterprise.graphql`
- `packages/github-api/schema/README.md` confirms the package carries both a
  GitHub.com schema and an enterprise schema

That matters because the public schema and the loaded enterprise schema differ
materially.

Observed counts:

| Schema                                                              | Query root fields | Mutation root fields |
| ------------------------------------------------------------------- | ----------------: | -------------------: |
| Public schema from `docs.github.com/public/fpt/schema.docs.graphql` | 31                | 264                  |
| Bundled `schema.docs.graphql`                                       | 28                | 225                  |
| Runtime-loaded `schema.docs-enterprise.graphql`                     | 23                | 147                  |

So before resolver coverage is even considered, the simulator is already
running against a smaller, different schema than the one used for this audit.

### 2. Explicit resolver coverage is very small

The only explicit top-level GraphQL resolvers are in
`packages/github-api/src/graphql/resolvers.ts`:

- `Query.viewer`
- `Query.user`
- `Query.organization`
- `Query.organizations`
- `Query.repository`
- `Query.repositoryOwner`

There are:

- 6 explicit query resolvers
- 0 explicit mutation resolvers

Relative to the public schema, that is roughly:

- `6 / 31` query entry points explicitly implemented
- `0 / 264` mutations explicitly implemented

### 3. What is actually scriptable is a thin user/org/repo slice

The real GraphQL behaviour comes from the in-memory store plus the translation
layer in `packages/github-api/src/graphql/to-graphql.ts`.

Store-backed and meaningfully scriptable pieces include:

- `repositoryOwner(login)` resolving to an org or user
- `user(login)`
- `RepositoryOwner.repositories(...)`
- `organization(login)`
- `organizations(...)`
- `repository(owner, name)`
- `User.organizations(...)`
- `Repository.owner`
- `Repository.defaultBranchRef`
- `Repository.languages(...)`
- `Repository.repositoryTopics(...)`
- `Repository.visibility`
- `Repository.isArchived`
- `Repository.isFork`
- Relay-style pagination for the connections above

This means the GraphQL layer is somewhat scriptable if your use case is:

- listing orgs or repos
- traversing owner to repositories
- rendering repo metadata
- reading repo topics, language, branch name, visibility, fork/archive state

### 4. A lot of the schema is only "mocked" in the loosest sense

Large parts of the GraphQL surface are not actually modeled:

- `Organization.teams(...)` always returns an empty connection
- `Organization.membersWithRole(...)` always returns an empty connection
- `Repository.collaborators(...)` always returns an empty connection

Other fields are not explicitly resolved at all. They only work if GraphQL can
fall back to a matching property on the translated object, or if returning
`null` is acceptable for the field type.

Important examples from the tests:

- queries against `organization.team(slug: ...)` are considered passing if they
  produce no GraphQL errors, but there is no explicit `team` resolver in the
  package
- queries against `repository.object(expression: ...)` similarly have no
  explicit object/blob resolver in the GraphQL layer
- most GraphQL tests assert only "no errors", not meaningful returned data

So the package is not a deep GitHub GraphQL mock. It is a narrow store-backed
graph embedded inside a very large schema.

## Explicit Coverage

### Top-level queries

| Field                     | Status                        | Notes                                                                                                        |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `viewer`                  | Fragile/partially implemented | Explicit resolver exists, but it still resolves to the first seeded user rather than a real auth context.    |
| `user(login)`             | Implemented                   | Store-backed lookup by user login.                                                                           |
| `organization(login)`     | Implemented                   | Store-backed lookup by org login.                                                                            |
| `organizations(...)`      | Implemented                   | Store-backed list with relay pagination.                                                                     |
| `repository(owner, name)` | Implemented                   | Store-backed repo lookup.                                                                                    |
| `repositoryOwner(login)`  | Implemented                   | Resolves to org or user from store.                                                                          |
| `users(...)`              | Not explicitly implemented    | Present in the enterprise schema, but not in the resolver map.                                               |
| Other public query roots  | Not explicitly implemented    | Most of the public schema entry points have no package resolver.                                             |

### Nested fields with real scripting

| Type field                                             | Status           | Source of behavior                           |
| ------------------------------------------------------ | ---------------- | -------------------------------------------- |
| `User.organizations(...)`                              | Scriptable       | Uses `user.organizations` ids from store.    |
| `Organization.repositories(...)` via `RepositoryOwner` | Scriptable       | Filters repos by owner login.                |
| `User.repositories(...)` via `RepositoryOwner`         | Scriptable       | Same owner-based filtering.                  |
| `Repository.owner`                                     | Scriptable       | Derived from repo owner login.               |
| `Repository.defaultBranchRef`                          | Lightly scripted | Derived from `repo.default_branch`.          |
| `Repository.languages(...)`                            | Lightly scripted | Derived from a single `repo.language` field. |
| `Repository.repositoryTopics(...)`                     | Scriptable       | Derived from `repo.topics`.                  |
| `Repository.visibility`                                | Scriptable       | Derived from repo visibility enum.           |
| `Repository.isArchived`                                | Scriptable       | Derived from repo.                           |
| `Repository.isFork`                                    | Scriptable       | Derived from repo.                           |

### Nested fields that are placeholder-only

| Type field                          | Status                    | Notes                                                  |
| ----------------------------------- | ------------------------- | ------------------------------------------------------ |
| `Organization.teams(...)`           | Placeholder               | Always empty.                                          |
| `Organization.membersWithRole(...)` | Placeholder               | Always empty.                                          |
| `Repository.collaborators(...)`     | Placeholder               | Always empty.                                          |
| `Organization.team(slug)`           | Effectively unimplemented | No explicit resolver.                                  |
| `Repository.object(expression)`     | Effectively unimplemented | No explicit blob/object resolver in the GraphQL layer. |
| Mutations broadly                   | Unimplemented             | No mutation resolvers exist.                           |

## Public Schema vs Runtime Behavior

Relative to `https://docs.github.com/public/fpt/schema.docs.graphql`, the
package falls into four buckets:

### A. Present in schema and meaningfully scriptable

This is the strongest part of the implementation:

- owner/repository traversal
- repository lists
- organization lists
- repository metadata fields
- repo topics/language/default branch
- relay paging

### B. Present in schema but returning empty placeholder data

These are "safe" mocks for UI rendering, but not useful for behaviour-heavy
tests:

- teams
- org members
- collaborators

### C. Present in schema but usually resolving to `null`

This is the largest bucket. The schema advertises many fields the package does
not resolve. Queries may still succeed because:

- the field is nullable
- an ancestor field resolves to `null`
- the default resolver finds a matching raw property

### D. Not even present at runtime when auditing against the public schema

Because the runtime loads the enterprise schema instead of the public dotcom
schema, part of the public docs surface is absent before custom logic is
considered.

Notable gap size:

- public schema has 31 query roots vs 23 in the runtime enterprise schema
- public schema has 264 mutation roots vs 147 in the runtime enterprise schema

## Test Coverage Observed

The GraphQL tests are useful for proving the endpoint starts and basic queries
parse, but they are weak evidence of deep behaviour.

Patterns in `packages/github-api/tests/graphql.test.ts`:

- most tests only check `response.errors === undefined`
- only the repository-owner repository listing test asserts meaningful data
  such as repo count and pagination
- queries exercise fields like `team(...)` and `object(expression: ...)`
  without asserting that the returned payload is non-null or accurate

So current tests overstate functional coverage if read as a capability matrix.

## Extensibility

The package does not expose a first-class GraphQL extension API similar to
`extend.openapiHandlers` on the REST side.

What exists:

- the backing store can be changed with `extend.extendStore`
- routes can be added with `extend.extendRouter`

What does not exist:

- no documented resolver injection point for GraphQL
- no package-level mutation framework
- no direct way to extend the GraphQL schema/resolver map without replacing or
  intercepting `/graphql` yourself

That makes GraphQL less scriptable than the REST side from a consumer-extension
standpoint.

## Assessment

Relative to the public GitHub GraphQL API, `packages/github-api` is:

- broad in exposed schema shape
- narrow in explicit resolver coverage
- moderately scriptable for a small read-only repository graph
- weak for teams, members, collaborators, blobs/objects, and essentially all
  mutations

The most accurate short description is:

> The GraphQL simulator is mostly a thin store-backed read model for users,
> organizations, and repositories layered onto a much larger schema, not a
> comprehensive mock of the GitHub GraphQL API.

## Recommended Follow-Ups

1. Decide whether GraphQL should be audited and documented against the public
   dotcom schema or the enterprise schema actually loaded at runtime.
2. Add a supported-field matrix that distinguishes:
   - explicitly resolved fields
   - placeholder empty fields
   - schema-present but unresolved fields
3. Add explicit resolvers for high-value fields already referenced in tests,
   especially:
   - `Query.user`
   - `Organization.team`
   - `Repository.object`
4. Add mutation support only where there is a backing store model to make it
   scriptable rather than purely decorative.
5. Strengthen tests to assert returned data, not just absence of GraphQL errors.
