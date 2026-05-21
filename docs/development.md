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
- `make markdownlint`
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


## Linting rules

`make all` runs Biome and Semgrep maintainability gates. Biome enforces exact
rules where it has native support:

- `complexity.noExcessiveLinesPerFunction`: functions may not exceed 70 lines,
  counting blank lines.
- `complexity.useMaxParams`: functions may not take more than 4 parameters.
- `complexity.noExcessiveCognitiveComplexity`: functions may not exceed
  cognitive complexity 8. This is an additional readability guard, not a
  substitute for McCabe/C90 complexity.

Semgrep covers contracts that Biome does not express directly:

- `simulacat.ts.cyclomatic-complexity`: flags JavaScript and TypeScript
  functions that appear to exceed McCabe/C90 cyclomatic complexity 8 within a
  bounded body scan. This rule is heuristic and counts common decision tokens
  such as `if`, `case`, `catch`, `&&`, `||`, and ternaries.
  The rule flags 9 counted decision tokens because that maps to complexity
  greater than 8. Counted tokens are `if`, `else if`, `case`, `catch`, `&&`,
  `||`, and the ternary `?:` operator.
- `simulacat.ts.nesting-depth`: flags control-flow blocks nested deeper than
  3 levels.
- `simulacat.ts.public-jsdoc`: requires exported function declarations to have
  complete usage-oriented JavaScript documentation (JSDoc), including `@param`,
  `@returns` where applicable, and `@throws` where the function throws or
  returns a rejecting promise.
- `simulacat.ts.private-jsdoc`: requires private/internal functions to have a
  concise one-line JSDoc summary.
- `simulacat.ts.module-jsdoc`: requires JS/TS files to start with module-level
  JSDoc, preferably an `@file` block.

Non-compliant examples:

```ts
export function convert(owner: string, repo: string, ref: string, sha: string, mode: string) {
  if (owner) {
    if (repo) {
      if (ref) {
        if (sha) {
          return mode;
        }
      }
    }
  }
}
```

Compliant examples:

```ts
/**
 * Converts a repository ref into a stable display label.
 *
 * @param input Repository ref details.
 * @returns A label suitable for REST and GraphQL responses.
 */
export function convert(input: RepositoryRefInput): string {
  if (!isCompleteRef(input)) {
    return input.mode;
  }

  return formatRefLabel(input);
}
```

### Suppressing lint violations

Prefer refactoring to suppression. When a suppression is unavoidable, include
a short reason that explains why the exception is narrower than changing the
rule.

Biome inline suppression:

```ts
// biome-ignore complexity.useMaxParams: Adapter signature mirrors upstream API.
```

Semgrep inline suppression:

```ts
// nosemgrep: simulacat.ts.cyclomatic-complexity - Legacy parser is covered by fixture tests.
```

For cyclomatic-complexity false positives, first try to extract predicates,
split orchestration from data shaping, or replace repeated branches with a
lookup table. Use `// nosemgrep: simulacat.ts.cyclomatic-complexity - <reason>`
only when the function is already bounded and tested, and the matched token
count is an accepted edge case rather than hidden control-flow complexity. A
typical accepted workflow is to add the inline suppression beside a legacy
schema transform, cite the fixture or property tests that cover it in the
reason, and track the later refactor in the related issue.

Use `.semgrepignore` only for generated, vendored, or bundled files that should
not be scanned at all.


### Security overrides

`package.json` pins a few transitive dependency overrides while upstream
dependency ranges catch up with patched releases. Remove an override only after
the upstream dependency accepts the patched range, `bun audit` remains clean,
and the lockfile no longer resolves the vulnerable version without the pin.

- `brace-expansion` is pinned to `5.0.6` for
  [GHSA-jxxr-4gwj-5jf2](https://github.com/advisories/GHSA-jxxr-4gwj-5jf2),
  which fixes large numeric ranges bypassing documented `max` denial-of-service
  protection.
- `fast-uri` is pinned to `3.1.2` for
  [GHSA-v39h-62p7-jpjc](https://github.com/fastify/fast-uri/security/advisories/GHSA-v39h-62p7-jpjc),
  which fixes host confusion through percent-encoded authority delimiters.
- `lodash` is pinned to `4.18.1` for
  [CVE-2026-4800](https://nvd.nist.gov/vuln/detail/CVE-2026-4800) and
  [CVE-2026-2950](https://nvd.nist.gov/vuln/detail/CVE-2026-2950), which fix
  template-injection and prototype-pollution bypasses in earlier 4.x releases.
- `ws` is pinned to `8.20.1` for
  [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx),
  which fixes uninitialized memory disclosure.

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
- Repository-owned entity invariants should use property tests with
  `fast-check` when the behaviour covers a range of owners, repositories, refs,
  SHAs, numbers, or ordering combinations.
- REST and GraphQL integration tests start local simulator servers. In
  restricted sandboxes these tests may need elevated local port-binding
  permission; do not run them in parallel with other gates.

### Early repository-owned entities

Refs, commits, issues, and pull requests are first-class store slices. Keep new
logic for their identity, lookup, and relation policy in schemas, key helpers,
selectors, and shared actions. REST and GraphQL adapters should call those
helpers rather than re-deriving owner/repo keys locally.

The current entity model is intentionally narrow. It supports early read
surfaces for refs, commits, issues, and pull requests. Do not expand it into
reviews, labels, timelines, mergeability, checks, or actor-aware permissions
without updating the relevant roadmap item and design documentation.

### Request actors

Request actor parsing lives in `src/store/actors.ts`, not in individual REST
or GraphQL routes. REST handlers pass request headers into the shared parser.
GraphQL Yoga builds a small context object with the parsed actor, and
`Query.viewer` resolves the selected user from that context.

New actor-aware behaviour should add focused unit tests for parser or resolver
invariants and route-level tests for observable REST or GraphQL contracts. Use
`fast-check` when a parser or key format must hold across a range of generated
values. Do not add real credential validation, permission checks, or GitHub
App cryptography under the request actor helper; those are separate
authorization slices.

Actor observability uses process-local counters in `src/store/actors.ts`.
REST and GraphQL adapters record parse outcomes, store-resolution outcomes,
resolved actor selections, and authentication failures at their transport
boundaries. The parser and resolver helpers remain pure and do not log
directly.

The built-in `GET /metrics` route exports those counters in Prometheus text
format as `simulacat_actor_observations_total`. Metric labels are bounded to
event, actor kind, outcome, and reason. Request identifiers and concrete actor
labels are deliberately excluded from metrics to avoid high-cardinality series.
Production monitors should alert on sustained increases in
`event="rest-authentication"` or `event="graphql-authentication"` with
`outcome="failure"` compared with the local request baseline. Treat spikes as
authentication-contract regressions or caller misconfiguration until the
corresponding structured logs show an expected rollout or test workload.

Set `SIMULACAT_ACTOR_OBSERVABILITY=1` or
`SIMULACAT_ACTOR_OBSERVABILITY=true` to emit the same actor observations as
structured JSON debug lines on stderr. Each line includes
`component: "simulacat.actor"`, the event name, actor kind, outcome, source or
surface where applicable, a non-sensitive actor label, and the inbound
`x-request-id` or `x-correlation-id` value when present. Tests that inspect the
counters should call `resetActorObservationCounters()` before each case to
avoid cross-test leakage.

### Gherkin feature scenarios

Feature files live under `features/` and are loaded by
`tests/cross-owner-identity.features.test.ts` through
`@aboviq/bun-test-cucumber`'s `loadFeatures()` helper. Step definitions live in
`tests/**/*.steps.ts`; `test-plugins.ts` registers that pattern through Bun's
test preload configured in `bunfig.toml`.

`bun test` and `make test` run the Gherkin scenarios alongside the normal
unit and integration tests. Keep feature files focused on user-visible
behaviour, and keep pure helper invariants in regular Bun tests.

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
