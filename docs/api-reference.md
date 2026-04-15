# API reference

Simulacat Core exposes one main factory, several extension points, and a small
set of exported fixture schemas.

## `simulation(args)`

`simulation()` builds a foundation-simulator server preloaded with GitHub store
state, REST handlers, GraphQL resolvers, and a few convenience routes.

### Arguments

- `initialState?: InitialState`
  Seeds the built-in GitHub tables. This is parsed through
  `gitubInitialStoreSchema`, so defaults and transforms are applied before the
  store is built.
- `apiUrl?: string`
  Changes the mounted REST API root. Use this when a harness expects the API to
  live under `/api/v3` rather than `/`.
- `apiSchema?: SchemaFile | string`
  Loads one of the bundled schemas (`api.github.com.json`,
  `schema.docs.graphql`, or `schema.docs-enterprise.graphql`) or a custom file
  path.
- `extend?: { ... }`
  Adds caller-defined behaviour on top of the built-in package features.

### Extension hooks

- `extend.extendStore`
  Merges additional schema slices, actions, and selectors into the GitHub store.
- `extend.openapiHandlers`
  Adds or overrides OpenAPI handlers. The callback receives the shared
  simulation store, so custom operations can read seeded entities.
- `extend.extendRouter`
  Adds plain Express routes after the built-in health, OAuth, and GraphQL
  routes are wired in.

## Exported fixture schemas

The package exports the schemas needed to validate and build seeded state:

- `githubUserSchema`
- `githubOrganizationSchema`
- `githubRepositorySchema`
- `githubBranchSchema`
- `githubBlobSchema`

### `InitialState`

`InitialState` is an alias for `GitHubInitialStore`, the input side of
`gitubInitialStoreSchema`.

Required top-level collections:

- `users`
- `organizations`
- `repositories`
- `branches`
- `blobs`

Derived behaviour worth knowing:

- Each organisation creates a matching app installation during schema parsing.
- Repositories gain GitHub-like URLs and default metadata.
- Blobs may be addressed by `path`, `sha`, or both, but at least one must be
  present.

## Supported REST operations

The package currently wires the following operations:

- `GET /health`
- `POST /graphql`
- `GET /login/oauth/authorize`
- `POST /login/oauth/access_token`
- `POST /api/v3/app/installations/:id/access_tokens`
- `GET /user/installations`
- `GET /installation/repositories`
- `GET /orgs/{org}/installation`
- `GET /repos/{owner}/{repo}/installation`
- `GET /orgs/{org}/repos`
- `GET /repos/{owner}/{repo}/branches`
- `GET /repos/{owner}/{repo}/commits/{ref}/status`
- `GET /repos/{owner}/{repo}/contents/{path}`
- `GET /repos/{owner}/{repo}/git/blobs/{file_sha}`
- `GET /repos/{owner}/{repo}/git/trees/{tree_sha}`
- `GET /user`
- `GET /user/memberships/orgs`

## Supported GraphQL queries

Root queries implemented by the generated resolver map:

- `viewer`
- `organization(login: String!)`
- `organizations(...)`
- `repository(owner: String!, name: String!)`
- `repositoryOwner(login: String!)`

Common nested fields implemented today:

- `Repository.owner`
- `Repository.languages(...)`
- `Repository.repositoryTopics(...)`
- `User.organizations(...)`
- `Organization.teams(...)`
- `Organization.membersWithRole(...)`
- `RepositoryOwner.repositories(...)`

The `teams`, `membersWithRole`, and `collaborators` connections currently
return empty collections rather than fully simulated data.
