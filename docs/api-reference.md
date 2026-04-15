# API reference

Simulacat Core exposes one main factory, several extension points, and a small
set of exported fixture schemas.

## `simulation(args)`

`simulation()` builds a foundation-simulator server preloaded with GitHub store
state, REST handlers, GraphQL resolvers, and a few convenience routes.

### Arguments

- `initialState?: InitialState`
  Seeds the built-in GitHub tables. This is parsed through
  `githubInitialStoreSchema`, so defaults and transforms are applied before the
  store is built.
- `apiUrl?: string`
  Changes the mounted REST API root. Applicable when a harness expects the API
  to reside under `/api/v3` instead of `/`.
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
  Adds plain Express routes before the built-in health, OAuth, and GraphQL
  routes are wired in.

## Exported fixture schemas

The package exports the schemas needed to validate and build seeded state:

- `githubUserSchema`
- `githubOrganizationSchema`
- `githubRepositorySchema`
- `githubBranchSchema`
- `githubBlobSchema`

### `githubUserSchema`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `login` | `string` | Yes | None | Canonical user key in the seeded store. |
| `id` | `number` | No | Generated integer `>= 1000` | Preserved when supplied explicitly. |
| `name` | `string` | No | Falls back to `login` | Used for GraphQL `User.name` and REST `/user` payloads. |
| `email` | `string` | No | Generated email address | Falls back to a Faker-generated address when omitted. |

### `githubOrganizationSchema`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `login` | `string` | Yes | None | Canonical organization key in the seeded store. |
| `id` | `number` | No | `4000` | Preserved when supplied explicitly. |
| `type` | `'User' \| 'Organization'` | No | `'Organization'` | Controls generated installation `target_type`. |
| `description` | `string` | No | `'Generic org description'` | Used in GraphQL organization payloads. |
| `avatar_url` | `string` | No | GitHub octocat error image | Exposed through GraphQL owner fields. |
| `name` | `string` | No | Falls back to `login` | Human-readable display name. |
| `email` | `string` | No | Generated email address | Falls back to a Faker-generated address when omitted. |

### `githubRepositorySchema`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `owner` | `string` | Yes | None | Used with `name` to form the canonical `owner/name` key. |
| `name` | `string` | Yes | None | Repository name within the owner namespace. |
| `id` | `number` | No | Generated from a resettable counter seeded at `3000` | Preserved when supplied explicitly. |
| `full_name` | `string` | No | Derived as `${owner}/${name}` | Recomputed during schema transform. |
| `visibility` | `'public' \| 'private'` | No | `'public'` | Mapped into GraphQL repository visibility. |
| `default_branch` | `string` | No | `'main'` | Used for the placeholder `defaultBranchRef`. |
| `url` | `string` | No | Derived simulator URL | Recomputed as a simulator-local repository URL. |

### `githubBranchSchema`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `owner` | `string` | Yes | None | Used with `repo` and `name` to form the canonical branch key. |
| `repo` | `string` | Yes | None | Repository component of the canonical branch key. |
| `name` | `string` | No | `'main'` | Branch or ref name. |
| `protected` | `boolean` | No | `true` | Mirrors the REST branch payload field. |
| `commit` | `{ sha?: string; url?: string }` | No | `{}` | `commit.sha` is generated when absent, and `commit.url` is derived from that SHA when omitted. |

### `githubBlobSchema`

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `owner` | `string` | Yes | None | Used with `repo` and the blob key in REST lookups. |
| `repo` | `string` | Yes | None | Repository component for blob lookup and tree generation. |
| `path` | `string` | Conditionally | None | Must be non-empty when present. At least one of `path` or `sha` must be present. |
| `sha` | `string` | Conditionally | None | Must be non-empty when present. At least one of `path` or `sha` must be present. |
| `content` | `string` | No | Faker-generated paragraphs | Returned through contents and git-blob payload builders. |
| `encoding` | `'string' \| 'base64'` | No | `'string'` | Determines whether `content` is re-encoded before REST responses. |

### `InitialState`

`InitialState` is an alias for `GitHubInitialStore`, the input side of
`githubInitialStoreSchema`.

Required top-level collections:

- `users`
- `organizations`
- `repositories`
- `branches`
- `blobs`

Derived behaviour worth knowing:

- Each organization creates a matching app installation during schema parsing.
- Repositories gain GitHub-like URLs and default metadata.
- Blobs may be addressed by `path`, `sha`, or both, but at least one must be
  present.

## Capability matrix

The current surface is easier to understand as a capability matrix than as a
flat route list.

### REST endpoints

| Surface                                            | Classification   | Current behaviour                                                                        |
| -------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `GET /health`                                      | Fully scriptable | Built-in helper route that always returns `{status: "ok"}`.                              |
| `POST /graphql`                                    | Fully scriptable | Routed through GraphQL Yoga using the shared seeded store.                               |
| `GET /login/oauth/authorize`                       | Fully scriptable | Built-in OAuth helper that redirects with a fixed development code.                      |
| `POST /login/oauth/access_token`                   | Fully scriptable | Built-in OAuth helper that returns fixed development token fields.                       |
| `POST /api/v3/app/installations/:id/access_tokens` | Fully scriptable | Built-in helper returns fixed token metadata plus store-backed repositories.             |
| `GET /user/installations`                          | Fully scriptable | Returns installation rows from the seeded installation slice.                            |
| `GET /installation/repositories`                   | Fully scriptable | Returns store-backed repositories with `total_count`.                                    |
| `GET /orgs/{org}/installation`                     | Fully scriptable | Store-backed installation lookup for an organization account.                            |
| `GET /repos/{owner}/{repo}/installation`           | Fully scriptable | Store-backed installation lookup for a repository owner/repo pair.                       |
| `GET /orgs/{org}/repos`                            | Fully scriptable | Store-backed repository list scoped by organization.                                     |
| `GET /repos/{owner}/{repo}/branches`               | Fully scriptable | Returns repository-scoped branches and 404s for unknown repositories.                    |
| `GET /repos/{owner}/{repo}/commits/{ref}/status`   | Schema-stubbed   | Returns a fixed success payload with dynamic owner/repo/ref interpolation only.          |
| `GET /repos/{owner}/{repo}/contents/{path}`        | Fully scriptable | Returns store-backed blob content looked up by owner/repo/path.                          |
| `GET /repos/{owner}/{repo}/git/blobs/{file_sha}`   | Fully scriptable | Returns store-backed blob content looked up by owner/repo/sha.                           |
| `GET /repos/{owner}/{repo}/git/trees/{tree_sha}`   | Placeholder-only | Reads `tree_sha`, but still flattens all repo blobs rather than modelling tree objects.  |
| `GET /user`                                        | Placeholder-only | Returns the first seeded user and 401s when no authenticated user fixture exists.        |
| `GET /user/memberships/orgs`                       | Placeholder-only | Returns all organizations as active admin memberships for the first seeded user.         |

### GraphQL fields

| Surface                                 | Classification   | Current behaviour                                                                        |
| --------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------- |
| `viewer`                                | Placeholder-only | Resolves to the first seeded user rather than a request-scoped actor.                    |
| `user(login: String!)`                  | Fully scriptable | Store-backed user lookup by login.                                                       |
| `organization(login: String!)`          | Fully scriptable | Store-backed organization lookup by login.                                               |
| `repository(...)`                       | Fully scriptable | Store-backed repository lookup with case-insensitive owner/name matching.                |
| `repositoryOwner(login: String!)`       | Fully scriptable | Resolves to either a user or organization from the store.                                |
| `Repository.owner`                      | Fully scriptable | Derived from seeded owner data and mapped into the GraphQL owner shape.                  |
| `Repository.languages`                  | Schema-stubbed   | Exposed through the schema, but still derived from lightweight placeholder data.         |
| `Repository.repositoryTopics`           | Schema-stubbed   | Returns topic names from repository fixture metadata rather than a richer topic model.   |
| `User.organizations`                    | Fully scriptable | Relay connection backed by the user's seeded organization logins.                        |
| `Organization.teams`                    | Placeholder-only | Always returns an empty connection today.                                                |
| `Organization.membersWithRole`          | Placeholder-only | Always returns an empty connection today.                                                |
| `RepositoryOwner.repositories`          | Fully scriptable | Relay connection backed by repositories whose owner matches the seeded login.            |
| `Repository.collaborators`              | Placeholder-only | No collaborator model exists, so callers only see placeholder empty results when exposed.|

Anything not listed in the tables above should be treated as unsupported until
the package adds either explicit scripting or documented schema-stubbed
behaviour for that surface.
