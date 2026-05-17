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
4. `extendRouter()` in `src/extend-api.ts` applies caller-provided routes
   first, then mounts the built-in GraphQL, health, and OAuth helper routes.
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
- `src/store/keys.ts`
  Re-exports canonical key helpers and parsing helpers for repositories,
  branches, blobs, refs, commits, issues, and pull requests.
- `src/store/builders.ts`
  Provides public fixture builders backed by the same schemas used for seeded
  state.
- `src/store/early-entity-selectors.ts`
  Provides selectors for repository-scoped refs, commits, issues, and pull
  requests. REST and GraphQL adapters consume these selectors instead of
  deriving keys locally.
- `src/store/actors.ts`
  Defines simulator request actor parsing and resolution for anonymous, user,
  app, and installation actors. REST and GraphQL adapters use these helpers
  instead of selecting a user locally.
- `src/store/entities/shared.ts`
  Defines `githubEntityPermissionSchema`.
- `src/store/index.ts`
  Base schema slices plus selectors for installations, repositories, and blob
  lookups.
- `src/rest/index.ts`
  OpenAPI operation handlers for the current REST surface.
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

## Request actor flow

`x-simulacat-actor` is the preferred request actor header. The supported values
are `anonymous`, `user:<login>`, `app:<id-or-slug>`, and `installation:<id>`.
`x-simulacat-user` and `x-github-user` remain compatibility aliases for user
actors.

REST authenticated-user handlers parse the request headers through
`parseRequestActor()`, resolve seeded users and installations through
`resolveRequestActor()`, and return user-shaped data only when the actor is a
known user. GraphQL Yoga performs the same parsing in `createHandler()` and
passes the actor into `createResolvers()` through resolver context, so
`viewer` and REST `/user` agree for equivalent user actor input.

This is actor representation, not authentication. The simulator does not
validate OAuth tokens, personal access tokens, GitHub App JWTs, or installation
tokens, and it does not enforce permissions in this slice.

## Extension seams

The package is designed to be extended rather than forked.

- `extendStore`
  Provides schema slices, actions, and selectors.
- `openapiHandlers`
  Registers or overrides REST operations while reusing the same store.
- `extendRouter`
  Adds plain Express routes for harness-specific behaviour.

This keeps the core package small whilst still letting higher-level tools such
as Simulacat or Rentaneko layer in product-specific fixtures and endpoints.

## Build and tooling configuration

- `tsdown.config.ts`
  Bundles `src/index.ts` to ESM (`dist/index.mjs`) and CJS (`dist/index.cjs`)
  using tsdown, and enables `attw` plus `publint` checks.
- `biome.json`
  Defines the Biome formatter and linter configuration: 2-space indentation,
  120-character line width, single quotes, and no trailing commas.
- `codegen.ts`
  Defines the GraphQL Code Generator configuration, reading
  `schema/schema.docs.graphql` and writing
  `src/__generated__/resolvers-types.ts`.
