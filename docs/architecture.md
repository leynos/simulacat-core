# Architecture guide

Simulacat Core is a thin GitHub-specific layer over
`@simulacrum/foundation-simulator`. It turns seeded entity fixtures into a
state store, then exposes that state through REST and GraphQL surfaces.

## High-level flow

1. `simulation(args)` parses `initialState` with Zod schemas in
   `src/store/entities.ts`.
2. `extendStore()` in `src/store/index.ts` converts the parsed state into keyed
   store tables and registers selectors used by the handlers.
3. `openapi()` in `src/rest/index.ts` mounts REST handlers against the chosen
   OpenAPI schema.
4. `extendRouter()` in `src/extend-api.ts` mounts GraphQL, health, and OAuth
   helper routes, then applies caller-provided routes.
5. `createHandler()` and `createResolvers()` expose the same store state through
   GraphQL Yoga.

## Module responsibilities

- `src/index.ts`
  Public API surface. Accepts configuration, parses seeded state, and starts
  the simulator.
- `src/store/entities.ts`
  Zod schemas for seed data plus conversion into store tables.
- `src/store/index.ts`
  Base schema slices plus selectors for installations, repositories, and blob
  lookups.
- `src/rest/index.ts`
  OpenAPI operation handlers for the current REST surface.
- `src/rest/utils.ts`
  Small payload builders shared by the REST handlers.
- `src/graphql/*`
  GraphQL schema loading, Relay pagination, root resolvers, and entity
  conversion helpers.

## State model

The built-in store contains the following slices:

- `users`
- `installations`
- `repositories`
- `branches`
- `organizations`
- `blobs`

Selectors provide the higher-level joins the handlers need:

- installations joined to owning organisations and repositories
- repositories decorated with organisation owners
- blob lookup by `path` or `sha`
- repository tree lookup across all blobs in an owner/repository pair

## Extension seams

The package is designed to be extended rather than forked.

- `extendStore`
  Adds schema slices, actions, and selectors.
- `openapiHandlers`
  Adds or overrides REST operations while reusing the same store.
- `extendRouter`
  Adds plain Express routes for harness-specific behaviour.

This keeps the core package small whilst still letting higher-level tools such
as Simulacat or Rentaneko layer in product-specific fixtures and endpoints.
