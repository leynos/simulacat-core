# Development guide

This repository uses Bun, Biome, TypeScript, and a small Makefile wrapper for
the common contributor workflow.

## Local setup

```bash
bun install
```

The package expects Bun to run scripts, tests, and formatting commands.

## Day-to-day workflow

Prefer the Makefile targets where available:

- `make check-fmt`
- `make lint`
- `make test`
- `make all`
- `make build`

The normal contributor gate is:

1. `bun fmt`
2. `bun lint`
3. `bun check:types`
4. `bun test`

`make all` runs `check-fmt`, `typecheck`, `lint`, and `test` in the
repository's preferred order.

The package publishes an ESM library surface, but the build intentionally keeps
`dist/index.cjs` because `bin/start.cjs` requires that artifact to start the
simulator under plain Node without a transpilation step.

### Running the simulator directly

The simulator can be started directly from the CLI entry point after the build
artifacts exist:

```bash
node bin/start.cjs
```

`bun bin/start.cjs` works too when Bun is preferred as the launcher.

The listening port defaults to `3300`. That value can be overridden with the
`PORT` environment variable:

```bash
PORT=8080 node bin/start.cjs
```

`bin/start.cjs` loads `dist/index.cjs`, so `make build` must run first.

## Testing expectations

Changes to behaviour should come with a targeted regression test.

- REST helpers belong in unit tests under `tests/*`.
- GraphQL pagination and conversion logic should be covered with focused unit
  tests when possible.
- Route-level behaviour should be covered by integration tests that assert both
  status codes and response shapes.

## Regenerating bundled assets

### GraphQL resolver types

```bash
bun run generate
```

This refreshes `src/__generated__/resolvers-types.ts` from the bundled GraphQL
schema.

### GitHub REST schema

```bash
bun run sync:schema:rest
```

This downloads the latest upstream REST description into `schema/`.

## Documentation expectations

When public APIs or behaviour change, update the matching documentation in the
same branch:

- `README.md` for user-facing guidance
- `docs/api-reference.md` for surface-level API details
- `docs/architecture.md` for structural changes
- `docs/development.md` for contributor workflow changes

All prose should use en-GB-oxendict spelling and wrap at 80 columns.
