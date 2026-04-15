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
   GraphQL Yoga.

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
- `src/store/entities/installation.ts`
  Defines `githubAppInstallationSchema` and `GitHubAppInstallation`.
- `src/store/entities/organization.ts`
  Defines `githubOrganizationSchema` and `GitHubOrganization`.
- `src/store/entities/repository.ts`
  Defines `githubRepositorySchema`, `GitHubRepository`, and
  `repositoryStoreKey`.
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

Selectors provide the higher-level joins the handlers need:

- installations joined to owning organizations and repositories
- repositories decorated with organization owners
- blob lookup by `path` or `sha`
- repository tree lookup across all blobs in an owner/repository pair

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
