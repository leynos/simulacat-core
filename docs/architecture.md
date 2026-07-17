# Architecture guide

Simulacat Core is a thin GitHub-specific layer over
`@simulacrum/foundation-simulator`. It turns seeded entity fixtures into a
state store, then exposes that state through REST and GraphQL surfaces.

## High-level flow

1. `simulation(args)` parses `initialState` with the aggregated Zod schemas in
   `src/store/entities.ts`.
2. `extendStore()` in `src/store/index.ts` converts the parsed state into keyed
   store tables and registers selectors used by the handlers.
3. `openapi()` in `src/rest/index.ts` mounts REST handlers against the chosen
   OpenAPI schema.
4. `extendRouter()` in `src/extend-api.ts` installs request actor middleware,
   applies caller-provided routes, then mounts built-in local routes such as
   GraphQL, health, and OAuth helper routes.
5. `createHandler()` and `createResolvers()` expose the same store state through
   GraphQL Yoga. GraphQL Yoga also builds request context from simulator actor
   headers before resolvers run.

## Module responsibilities

- `src/index.ts`
  Public API surface. Accepts configuration, parses seeded state, and starts
  the simulator.
- `src/store/entities.ts`
  Aggregates the entity submodules, exports `githubInitialStoreSchema`,
  `convertInitialStateToStoreState`, and `convertObjByKey`.
- `src/store/entities/blob.ts`
  Defines `githubBlobSchema`, `GitHubBlob`, and `blobStoreKey`.
- `src/store/entities/branch.ts`
  Defines `githubBranchSchema`, `GitHubBranch`, and `branchStoreKey`.
- `src/store/entities/commit.ts`
  Defines `githubCommitSchema`, `GitHubCommit`, and `commitStoreKey`.
- `src/store/entities/issue.ts`
  Defines `githubIssueSchema`, `GitHubIssue`, and `issueStoreKey`.
- `src/store/entities/installation.ts`
  Defines `githubAppInstallationSchema` and `GitHubAppInstallation`.
- `src/store/entities/organization.ts`
  Defines `githubOrganizationSchema` and `GitHubOrganization`.
- `src/store/entities/pull-request.ts`
  Defines `githubPullRequestSchema`, `GitHubPullRequest`, and
  `pullRequestStoreKey`.
- `src/store/entities/ref.ts`
  Defines `githubRefSchema`, `GitHubRef`, and `refStoreKey`.
- `src/store/entities/repository.ts`
  Defines `githubRepositorySchema`, `GitHubRepository`, and
  `repositoryStoreKey`.
- `src/store/entities/label.ts`
  Planned early vertical-slice module for repository labels. It will define a
  repository-scoped `GitHubLabel`, canonical `labelStoreKey`, URL defaults,
  and fixture parsing once roadmap step 1.5 lands.
- `src/store/keys.ts`
  Re-exports canonical key helpers and parsing helpers for repositories,
  branches, blobs, refs, commits, issues, pull requests, and future
  repository labels.
- `src/store/builders.ts`
  Provides public fixture builders backed by the same schemas used for seeded
  state.
- `src/store/early-entity-selectors.ts`
  Provides selectors for repository-scoped refs, commits, issues, and pull
  requests. REST and GraphQL adapters consume these selectors instead of
  deriving keys locally.
- `src/store/actors.ts`
  Defines simulator request actor parsing, middleware context construction,
  resolution, selection, and observability for anonymous, user, app, and
  installation actors. REST, GraphQL, and caller extensions use these helpers
  instead of selecting a user locally.
- `src/store/actions/`
  Contains shared write reducers, starfx thunk adapters, dispatch helpers, and
  application use cases. Pure reducer modules such as
  `src/store/actions/repository.ts` stay framework-free; Zod request-body
  parsing happens in the adapter layer before commands reach reducers, and
  adapters and REST handlers call use cases rather than mutating store tables
  locally.
- `src/store/repository-observability.ts`
  Maintains process-local counters for bounded repository PATCH outcomes only:
  success, missing repository, or unshaped repository. Repository GET handlers
  do not record these observations.
- `src/store/entities/shared.ts`
  Defines `githubEntityPermissionSchema`.
- `src/store/index.ts`
  Base schema slices plus selectors for installations, repositories, and blob
  lookups, including the targeted `getRepositoryWithOwner` selector used by the
  repository write and read paths.
- `src/rest/index.ts`
  OpenAPI operation handlers for the current REST surface. Write handlers
  parse and validate request bodies before calling shared action use cases,
  then shape a re-selected persisted repository for PATCH responses through
  `getRepositoryWithOwner`.
- `src/rest/utils.ts`
  Small payload builders shared by the REST handlers.
- `src/graphql/handler.ts`
  Loads the GraphQL SDL, builds the Yoga handler, and registers the custom
  media-type parser plugin.
- `src/graphql/relay.ts`
  Defines `applyRelayPagination` and the associated cursor-pagination types.
- `src/graphql/resolvers.ts`
  Defines `createResolvers`, mapping root `Query` fields to store-backed data.
- `src/graphql/to-graphql.ts`
  Defines `toGraphql` and `deriveOwner` entity-conversion helpers.

## State model

The built-in store contains the following slices:

- `users`
- `installations`
- `repositories`
- `branches`
- `organizations`
- `blobs`
- `refs`
- `commits`
- `issues`
- `pullRequests`

Tables use canonical owner-qualified keys:

- repositories: `owner/name`
- branches: `owner/repo:name`
- blobs: `owner/repo:reference`, where `reference` is the seeded `path` or
  `sha`
- refs: `owner/repo:qualifiedName`
- commits: `owner/repo:sha`
- issues: `owner/repo#number`
- pull requests: `owner/repo!number`

This means `acme/awesome-repo` and `globex/awesome-repo` are distinct
repositories even though their short names match. Repository `node_id` values
derive from the same key as base64-encoded `Repository:owner/name` strings.

Selectors provide the higher-level joins the handlers need:

- installations joined to owning organizations and repositories
- repositories decorated with organization owners
- keyed repository and branch lookup by owner-qualified coordinates
- blob lookup by `path` or `sha`
- repository tree lookup across all blobs in an owner/repository pair
- ref, commit, issue, and pull request lookup scoped by owner and repository
- shallow commit reachability from a seeded ref
- pull request relation lookup for base refs, head refs, and linked issues

The early collaboration slices are deliberately narrow. They model enough
state for REST and GraphQL reads to agree on refs, commits, issues, and pull
requests, but they do not yet own collaboration policy. Mutations,
mergeability, labels, reviews, timelines, checks, and actor-aware permissions
belong to later roadmap slices.

Repository metadata writes are the first shared action demonstrator. The
`updateRepository` action applies only whitelisted descriptive fields
(`description`, `homepage`) through the shared store, so REST
`PATCH /repos/{owner}/{repo}`, REST repository reads, and GraphQL
`repository(owner:, name:)` observe the same persisted repository value.
Repository policy settings remain a later roadmap slice.

## Request actor flow

`x-simulacat-actor` is the preferred request actor header. The supported values
are `anonymous`, `user:<login>`, `app:<id-or-slug>`, and `installation:<id>`.
`x-simulacat-user` and `x-github-user` remain compatibility aliases for user
actors.

`src/extend-api.ts` installs `requestActorMiddleware()` before caller
`extendRouter()`/extension routes, and before built-in local routes such as
`/graphql`. It builds a request-scoped actor context from inbound headers,
attaches it to `req.simulacatActor`, and records one parse observation for the
HTTP request. `openapi()` mounts built-in REST handlers, but the middleware does
not directly govern OpenAPI handler mounting. The actor context includes parsed
actor details, diagnostics, and request-id context. The REST and GraphQL
adapters then pass that normalized context into shared helper flows, which
resolve user actors through `requireUserActor()` and GraphQL's
`requireGraphQLUserActor()` respectively. GraphQL Yoga builds the same context
from Fetch headers using `buildActorContext` and passes it into
`createResolvers()`, so `viewer`, REST `/user`, caller OpenAPI handlers, and
caller Express routes agree for equivalent user actor input.

For extension code, `getActorContext(request)` reads the middleware-attached
context and `requireRestUserActor(request, simulationStore, surface)` applies
the same authenticated-user selection and observability path used by built-in
handlers. This follows the actor-at-the-boundary guidance in
`docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
§4 and §8.

This is actor representation, not authentication. The simulator does not
validate OAuth tokens, personal access tokens, GitHub App JWTs, or installation
tokens, and it does not enforce permissions in this slice.

## Extension seams

The package is designed to be extended rather than forked.

- `extendStore`
  Provides schema slices, actions, and selectors.
- `openapiHandlers`
  Registers or overrides REST operations while reusing the same store. Actor-aware
  handlers should call `requireRestUserActor(request, simulationStore, surface)`,
  which uses middleware-attached `req.simulacatActor` when present and falls back
  to rebuilding the same actor context from request headers.
- `extendRouter`
  Adds plain Express routes for harness-specific behaviour. These routes run
  after request actor middleware, so `req.simulacatActor` is already available.

This keeps the core package small whilst still letting higher-level tools such
as Simulacat or Rentaneko layer in product-specific fixtures and endpoints.

## GitHub client compatibility

Simulacat Core should treat compatibility with maintained GitHub client
libraries as a contract for supported routes, not as a downstream patching
concern. The first supported external-client contract is `github3.py` because
simulacat exposes a `github3.GitHub` client as its primary pytest fixture.

For supported REST routes, response builders:

- derive REST URLs from the inbound request host and configured API root when
  a response is generated by a handler;
- preserve explicitly seeded URL fields when fixtures intentionally override
  generated defaults;
- include fields that `github3.py` 3.x and 4.x consume for rich objects, even
  when those fields are not important to the internal simulator state;
- avoid requiring token validation for local write tests unless a caller opts
  into stricter token or permission scenarios.

The implemented URL policy lives in `src/http/request-url.ts` and the
per-entity projectors in `src/urls/`. Stored GitHub entities remain
host-agnostic unless a fixture explicitly seeds a URL override; REST and
GraphQL adapters project response URLs from the request host, `apiUrl`, and the
shared projector tables.

The supported root-mounted client setup is a `github3.GitHub` instance using a
`GitHubSession` whose `base_url` points at the simulator root. A
`github3.GitHubEnterprise` setup is only supported once an explicit `/api/v3`
compatibility contract and tests exist.

Repository, issue, pull request, and label payloads are the first contract-test
targets. This lets simulacat remove route-local compatibility patches and
keeps direct client incompatibilities visible in core.

## Repository label slice

Repository labels are promoted ahead of broader issue collaboration because a
real downstream `github3.py` workflow needs mutable label create, lookup, and
update behaviour. The label slice should remain narrow:

- labels are repository-scoped entities keyed by `owner/repo:name`;
- `initialState.labels` seeds label fixtures alongside repositories, branches,
  refs, commits, issues, and pull requests;
- selectors look up labels by owner, repository, and name without relying on
  OpenAPI example payloads;
- domain actions create and update labels through the shared write spine;
- REST handlers support `GET`, `POST`, and `PATCH` for repository labels and
  persist changes in memory;
- response payloads preserve `url`, `name`, `color`, and `description` for
  `github3.py` compatibility;
- mutable label routes accept ordinary local Authorization headers by default
  without token validation.

Issue label assignment is later work. It should reuse the repository label
entity rather than adding a second label representation under issue
collaboration.

## Simulator control APIs

External harnesses should not have to replace core handlers to inspect effects
or exercise error paths. Simulator-only control APIs are planned for:

- state inspection and reset between tests;
- request log capture with bounded retention and sensitive-header redaction;
- route-scoped error injection for the next matching request.

These APIs are separate from GitHub REST compatibility. They exist to support
test harnesses such as simulacat and should be documented as simulator control
surfaces rather than as GitHub API endpoints.

## Build and tooling configuration

- `tsdown.config.ts`
  Bundles `src/index.ts` to ESM (`dist/index.mjs`) and CJS (`dist/index.cjs`)
  using tsdown, and enables `attw` plus `publint` checks.
- `biome.json`
  Defines the Biome formatter and linter configuration: 2-space indentation,
  120-character line width, single quotes, and no trailing commas.
- `.oxlintrc.json`
  Defines the Oxlint maintainability gate, including McCabe complexity, nesting
  depth, complex conditional, and local documentation rules.
- `tools/oxlint-plugin-df12/index.js`
  Hosts the local Oxlint rules that enforce project-specific conditional and
  JSDoc contracts without adding a separate ESLint runner.
- `.jsdoc-baseline.json`
  Records existing documentation debt by symbol. New code should satisfy the
  JSDoc rules directly rather than adding baseline entries.
- `codegen.ts`
  Defines the GraphQL Code Generator configuration, reading
  `schema/schema.docs.graphql` and writing
  `src/__generated__/resolvers-types.ts`.
- `.github/workflows/ci.yml`
  Runs `make all` in continuous integration and pins `astral-sh/setup-uv` to a
  reviewed v8.1.0 commit for reproducible `uv` setup.
