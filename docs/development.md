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

`make all` runs format checking, linting, type-checking, and the test suite in
the repository's preferred order.

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
