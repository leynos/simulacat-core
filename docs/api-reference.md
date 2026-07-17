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
  Changes the mounted REST API root and the API path embedded in derived
  response URLs. Applicable when a harness expects the API to reside under
  `/api/v3` instead of `/`.
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
  simulation store, so custom operations can read seeded entities. Operation
  handlers can call `requireRestUserActor()` with the Express request to use
  the same request actor selection path as built-in authenticated-user routes.
- `extend.extendRouter`
  Adds plain Express routes before the built-in health, OAuth, and GraphQL
  routes are wired in. Request actor middleware runs before these routes, so
  `getActorContext(request)` can read `req.simulacatActor` when custom routes
  need raw actor details.

### Request actor helpers

`src/store/actors.ts` exports request actor helpers for extension authors:

- `buildActorContext(headers)`
  Builds the parsed request actor context from an abstract header reader.
- `getActorContext(request)`
  Reads the actor context attached to an Express request by middleware.
- `requireUserActor(input, simulationStore)`
  Resolves a normalized actor context against the seeded store and returns
  either the selected user or an unauthenticated failure result while recording
  the same actor observability as built-in handlers.

`src/rest/actor-context.ts` exports `requireRestUserActor(request,
simulationStore, surface)` for REST and extension handlers that should read
middleware-attached context or fall back to request headers when middleware did
not run.

## Exported fixture schemas

The package exports the schemas needed to validate and build seeded state:

- `githubUserSchema`
- `githubOrganizationSchema`
- `githubRepositorySchema`
- `githubBranchSchema`
- `githubBlobSchema`
- `githubRefSchema`
- `githubCommitSchema`
- `githubIssueSchema`
- `githubPullRequestSchema`
- `buildRepositoryFixture`
- `buildBranchFixture`
- `buildRefFixture`
- `buildCommitFixture`
- `buildIssueFixture`
- `buildPullRequestFixture`

## Exported write action helpers

Shared write helpers are exported for extension authors and downstream tests
that need to reuse the same mutation path as built-in REST handlers:

- `REPOSITORY_WRITABLE_FIELDS`
- `applyRepositoryUpdate(current, command)`
- `buildUpdateRepositoryCommand(input)`
- `buildDomainActions(args)`
- `createEntityUpdateThunk(args)`
- `dispatchWrite(store, action)`
- `updateRepositoryUseCase(simulationStore, command)`

`applyRepositoryUpdate` is the pure repository reducer. It accepts
`UpdateRepositoryCommand` values and only applies the current demonstrator
fields, `description` and `homepage`. Other fields accepted by GitHub's
`repos/update` request schema, including policy or visibility fields such as
`private`, are intentionally ignored until the repository settings roadmap
slice implements them.

`updateRepositoryUseCase` dispatches the built-in `updateRepository` action,
then re-selects the repository from the shared store. This keeps
`PATCH /repos/{owner}/{repo}`, `GET /repos/{owner}/{repo}`,
`GET /orgs/{org}/repos`, and GraphQL `repository(owner:, name:)` aligned on
one persisted repository value.

Repository identity is owner-scoped. Repositories are keyed as `owner/name`,
branches are keyed as `owner/repo:name`, and blobs are keyed as
`owner/repo:reference`, where `reference` is the seeded `path` or `sha`. Two
repositories with the same `name` can coexist when their `owner` values differ.
Repository `node_id` values are base64-encoded strings prefixed with
`Repository:` and followed by the canonical `owner/name` key.

Early collaboration entities use the same owner-qualified repository prefix:

- refs: `owner/repo:qualifiedName`
- commits: `owner/repo:sha`
- issues: `owner/repo#number`
- pull requests: `owner/repo!number`

These entities are intentionally minimal. They cover identity, refs, commits,
issue read data, and pull request read data needed by the early GraphQL and
pull-request slices. Reviews, labels, timelines, mergeability, and mutations
remain later work.

### `githubUserSchema`

| Field   | Type     | Required | Default                     | Notes                                                   |
| ------- | -------- | -------- | --------------------------- | ------------------------------------------------------- |
| `login` | `string` | Yes      | None                        | Canonical user key in the seeded store.                 |
| `id`    | `number` | No       | Generated integer `>= 1000` | Preserved when supplied explicitly.                     |
| `name`  | `string` | No       | Falls back to `login`       | Used for GraphQL `User.name` and REST `/user` payloads. |
| `email` | `string` | No       | Generated email address     | Falls back to a Faker-generated address when omitted.   |

### `githubOrganizationSchema`

| Field         | Type                       | Required        | Default                     | Notes                                                 |
| ------------- | -------------------------- | --------------- | --------------------------- | ----------------------------------------------------- |
| `login`       | `string`                   | Yes             | None                        | Canonical organization key in the seeded store.       |
| `id`          | `number`                   | No              | `4000`                      | Preserved when supplied explicitly.                   |
| `type`        | `'User' \| 'Organization'` | No              | `'Organization'`            | Controls generated installation `target_type`.        |
| `description` | `string`                   | No              | `'Generic org description'` | Used in GraphQL organization payloads.                |
| `avatar_url`  | `string`                   | No              | GitHub octocat error image  | Exposed through GraphQL owner fields.                 |
| `name`        | `string`                   | No              | Falls back to `login`       | Human-readable display name.                          |
| `email`       | `string`                   | No              | Generated email address     | Falls back to a Faker-generated address when omitted. |

### `githubRepositorySchema`

| Field            | Type                    | Required   | Default                                              | Notes                                                    |
| ---------------- | ----------------------- | ---------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `owner`          | `string`                | Yes        | None                                                 | Used with `name` to form the canonical `owner/name` key. |
| `name`           | `string`                | Yes        | None                                                 | Repository name within the owner namespace.              |
| `id`             | `number`                | No         | Generated from a resettable counter seeded at `3000` | Preserved when supplied explicitly.                      |
| `node_id`        | `string`                | No         | Base64 `Repository:owner/name`                       | Preserved when supplied explicitly.                      |
| `full_name`      | `string`                | No         | Derived as `${owner}/${name}`                        | Recomputed during schema transform.                      |
| `visibility`     | `'public' \| 'private'` | No         | `'public'`                                           | Mapped into GraphQL repository visibility.               |
| `default_branch` | `string`                | No         | `'main'`                                             | Used for the placeholder `defaultBranchRef`.             |
| `url`            | `string`                | No         | Derived at response time                             | Uses the request host and `apiUrl` unless seeded.        |

### `githubBranchSchema`

| Field       | Type                             | Required | Default  | Notes                                                                                          |
| ----------- | -------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------- |
| `owner`     | `string`                         | Yes      | None     | Used with `repo` and `name` to form the canonical branch key.                                  |
| `repo`      | `string`                         | Yes      | None     | Repository component of the canonical branch key.                                              |
| `name`      | `string`                         | No       | `'main'` | Branch or ref name.                                                                            |
| `protected` | `boolean`                        | No       | `true`   | Mirrors the REST branch payload field.                                                         |
| `commit`    | `{ sha?: string; url?: string }` | No       | `{}`     | `commit.sha` is generated; `commit.url` is projected unless seeded.                            |

### `githubBlobSchema`

| Field      | Type                   | Required      | Default                    | Notes                                                                            |
| ---------- | ---------------------- | ------------- | -------------------------- | -------------------------------------------------------------------------------- |
| `owner`    | `string`               | Yes           | None                       | Used with `repo` and the blob key in REST lookups.                               |
| `repo`     | `string`               | Yes           | None                       | Repository component for blob lookup and tree generation.                        |
| `path`     | `string`               | Conditionally | None                       | Must be non-empty when present. At least one of `path` or `sha` must be present. |
| `sha`      | `string`               | Conditionally | None                       | Must be non-empty when present. At least one of `path` or `sha` must be present. |
| `content`  | `string`               | No            | Faker-generated paragraphs | Returned through contents and git-blob payload builders.                         |
| `encoding` | `'string' \| 'base64'` | No            | `'string'`                 | Determines whether `content` is re-encoded before REST responses.                |

### Early repository-owned schemas

| Schema                    | Required identity fields                           | Key format                 | Notes                                                                                               |
| ------------------------- | -------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------- |
| `githubRefSchema`         | `owner`, `repo`, `qualifiedName`, `object.sha`     | `owner/repo:qualifiedName` | Defaults unqualified names to branch refs for branches and tag refs for tags.                       |
| `githubCommitSchema`      | `owner`, `repo`                                    | `owner/repo:sha`           | Generates `sha` when omitted and normalizes commit author, committer, tree, and parent fields.      |
| `githubIssueSchema`       | `owner`, `repo`, `number`, `title`                 | `owner/repo#number`        | Supports minimal open/closed issue reads with generated ids, user, and timestamps.                  |
| `githubPullRequestSchema` | `owner`, `repo`, `number`, `title`, `base`, `head` | `owner/repo!number`        | Supports minimal open/closed/merged pull request reads with base/head refs and linked issue number. |

### Fixture builders

`buildRepositoryFixture(input)`, `buildBranchFixture(input)`,
`buildRefFixture(input)`, `buildCommitFixture(input)`,
`buildIssueFixture(input)`, and `buildPullRequestFixture(input)` parse their
inputs through the matching schemas. Use them when tests need fully expanded
fixtures without constructing a full `InitialState` object.

### `InitialState`

`InitialState` is an alias for `GitHubInitialStore`, the input side of
`githubInitialStoreSchema`.

Required top-level collections:

- `users`
- `organizations`
- `repositories`
- `branches`
- `blobs`

Optional top-level collections default to empty arrays:

- `refs`
- `commits`
- `issues`
- `pullRequests`

Derived behaviour worth knowing:

- Each organization creates a matching app installation during schema parsing.
- Stored repositories gain default metadata, but URL fields stay absent unless
  a fixture explicitly seeds them.
- REST and GraphQL responses derive repository, organization, branch, ref,
  commit, issue, and pull request URLs from the inbound request host and the
  configured `apiUrl`.
- Blobs may be addressed by `path`, `sha`, or both, but at least one must be
  present.
- Refs, commits, issues, and pull requests are converted into owner-scoped keyed
  tables and reject duplicate canonical keys.

### Request-derived URLs

URL fields on stored fixtures are override fields, not seed-time defaults. When
a URL field is omitted, built-in REST handlers and GraphQL resolvers project it
from the current request. API URLs use the request host plus `apiUrl`; browser
URLs use the same request host without the API root. Explicitly seeded URL
fields are preserved, including nullable fields such as `mirror_url: null`.

If a handler has no usable request `Host` header, the adapters use
`SIMULACAT_GITHUB_API_URL` as an absolute fallback base. If neither source can
produce an HTTP(S) origin, URL projection throws a greppable
`SIMULACAT: cannot derive base URL` error.

## Capability matrix

The current surface is easier to understand as a capability matrix than as a
flat route list.

### REST endpoints

| Surface                                            | Classification       | Current behaviour                                                                         |
| -------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `GET /health`                                      | Fully scriptable     | Built-in helper route that always returns `{status: "ok"}`.                               |
| `GET /metrics`                                     | Fully scriptable     | Exposes bounded actor, URL, and PATCH-only repository-write counters.                     |
| `POST /graphql`                                    | Fully scriptable     | Routed through GraphQL Yoga using the shared seeded store.                                |
| `GET /login/oauth/authorize`                       | Fully scriptable     | Built-in OAuth helper that redirects with a fixed development code.                       |
| `POST /login/oauth/access_token`                   | Fully scriptable     | Built-in OAuth helper that returns fixed development token fields.                        |
| `POST /api/v3/app/installations/:id/access_tokens` | Fully scriptable     | Built-in helper returns fixed token metadata plus store-backed repositories.              |
| `GET /user/installations`                          | Fully scriptable     | Returns installation rows from the seeded installation slice.                             |
| `GET /installation/repositories`                   | Fully scriptable     | Returns store-backed repositories with `total_count`.                                     |
| `GET /orgs/{org}/installation`                     | Fully scriptable     | Store-backed installation lookup for an organization account.                             |
| `GET /repos/{owner}/{repo}/installation`           | Fully scriptable     | Store-backed installation lookup for a repository owner/repo pair.                        |
| `GET /orgs/{org}/repos`                            | Fully scriptable     | Store-backed repository list scoped by organization.                                      |
| `GET /repos/{owner}/{repo}`                        | Fully scriptable     | Returns the store-backed repository joined with the organization owner shape.             |
| `PATCH /repos/{owner}/{repo}`                      | Fully scriptable     | Updates whitelisted repository metadata through the shared `updateRepository` action.     |
| `GET /repos/{owner}/{repo}/branches`               | Fully scriptable     | Returns repository-scoped branches and 404s for unknown repositories.                     |
| `GET /repos/{owner}/{repo}/commits/{ref}/status`   | Schema-stubbed       | Returns a fixed success payload with dynamic owner/repo/ref interpolation only.           |
| `GET /repos/{owner}/{repo}/contents/{path}`        | Fully scriptable     | Returns store-backed blob content looked up by owner/repo/path.                           |
| `GET /repos/{owner}/{repo}/git/blobs/{file_sha}`   | Fully scriptable     | Returns store-backed blob content looked up by owner/repo/sha.                            |
| `GET /repos/{owner}/{repo}/git/trees/{tree_sha}`   | Placeholder-only     | Reads `tree_sha`, but still flattens all repo blobs rather than modelling tree objects.   |
| `GET /repos/{owner}/{repo}/git/ref/{ref}`          | Fully scriptable     | Returns the seeded repository-scoped ref or 404s for unknown owner/repo/ref combinations. |
| `GET /repos/{owner}/{repo}/git/commits/{sha}`      | Fully scriptable     | Returns the seeded repository-scoped git commit or 404s for unknown owner/repo/SHA data.  |
| `GET /repos/{owner}/{repo}/issues`                 | Fully scriptable     | Lists seeded issues scoped to the requested owner and repository.                         |
| `GET /repos/{owner}/{repo}/issues/{number}`        | Fully scriptable     | Returns a seeded issue by owner, repository, and number.                                  |
| `GET /repos/{owner}/{repo}/pulls`                  | Fully scriptable     | Lists seeded pull requests scoped to the requested owner and repository.                  |
| `GET /repos/{owner}/{repo}/pulls/{number}`         | Fully scriptable     | Returns a seeded pull request by owner, repository, and number.                           |
| `GET /user`                                        | Partially scriptable | Uses shared request actor helpers to return the selected `user:<login>` actor or 401.     |
| `GET /user/memberships/orgs`                       | Partially scriptable | Uses shared request actor helpers to return active memberships for the selected user.     |

### GraphQL fields

| Surface                                 | Classification       | Current behaviour                                                                         |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `viewer`                                | Partially scriptable | Uses GraphQL request actor context to resolve the selected `user:<login>` actor.          |
| `user(login: String!)`                  | Fully scriptable     | Store-backed user lookup by login.                                                        |
| `organization(login: String!)`          | Fully scriptable     | Store-backed organization lookup by login.                                                |
| `repository(...)`                       | Fully scriptable     | Store-backed repository lookup with case-insensitive owner/name matching.                 |
| `repositoryOwner(login: String!)`       | Fully scriptable     | Resolves to either a user or organization from the store.                                 |
| `Repository.id`                         | Fully scriptable     | Exposes the repository `node_id`, derived as base64 `Repository:owner/name` by default.   |
| `Repository.owner`                      | Fully scriptable     | Derived from seeded owner data and mapped into the GraphQL owner shape.                   |
| `Repository.defaultBranchRef`           | Fully scriptable     | Returns a seeded default-branch ref when present, otherwise the legacy placeholder.       |
| `Repository.ref(qualifiedName:)`        | Fully scriptable     | Returns a seeded ref, including a commit target when that commit is seeded.               |
| `Repository.refs(refPrefix:)`           | Fully scriptable     | Returns seeded refs matching the supplied prefix.                                         |
| `Repository.issue(number:)`             | Fully scriptable     | Returns a seeded issue by repository and number.                                          |
| `Repository.issues`                     | Fully scriptable     | Returns seeded repository issues through a Relay connection.                              |
| `Repository.pullRequest(number:)`       | Fully scriptable     | Returns a seeded pull request by repository and number.                                   |
| `Repository.pullRequests`               | Fully scriptable     | Returns seeded repository pull requests through a Relay connection.                       |
| `Repository.languages`                  | Schema-stubbed       | Exposed through the schema, but still derived from lightweight placeholder data.          |
| `Repository.repositoryTopics`           | Schema-stubbed       | Returns topic names from repository fixture metadata rather than a richer topic model.    |
| `User.organizations`                    | Fully scriptable     | Relay connection backed by the user's seeded organization logins.                         |
| `Organization.teams`                    | Placeholder-only     | Always returns an empty connection today.                                                 |
| `Organization.membersWithRole`          | Placeholder-only     | Always returns an empty connection today.                                                 |
| `RepositoryOwner.repositories`          | Fully scriptable     | Relay connection backed by repositories whose owner matches the seeded login.             |
| `Repository.collaborators`              | Placeholder-only     | No collaborator model exists, so callers only see placeholder empty results when exposed. |

Anything not listed in the tables above should be treated as unsupported until
the package adds either explicit scripting or documented schema-stubbed
behaviour for that surface.
