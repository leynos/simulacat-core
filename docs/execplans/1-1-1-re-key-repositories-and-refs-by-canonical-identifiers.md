# Re-key repositories and refs by canonical identifiers

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: DRAFT

Roadmap reference: docs/roadmap.md task `1.1.1` under §1.1
"Prove repository identity is owner-scoped and ref-safe".

## Purpose / big picture

Today Simulacat Core can only seed one repository called `awesome-repo`
across the whole simulation, even if the seed data places it under two
different owners. The store tables themselves are already keyed by
`owner/name` and `owner/repo:ref`, but downstream identity derivations
(notably the `node_id` assignment inside the `githubRepositorySchema`
transform in `src/store/entities/repository.ts` and the hard-coded
`node_id: 'node_id'` in `blobAsBase64` in `src/rest/utils.ts`) collapse
back onto the unqualified name, and there are no exported keyed
selectors or fixture builders that consumers can rely on. The goal of
this change is to make `(owner, name)` the only canonical handle for a
repository and `(owner, repo, name)` the only canonical handle for a
branch or ref, end-to-end, so that two repositories sharing a name
under different owners coexist and remain independently addressable
through REST, GraphQL, and the exported store selectors.

Observable outcome: a new behavioural test seeds two organizations
(`acme` and `globex`) each with a repository called `awesome-repo` and a
branch called `main`, then exercises every public surface — REST
`/orgs/{org}/repos`, REST `/repos/{owner}/{repo}/branches`, GraphQL
`repository(owner, name)`, GraphQL `Repository.id`, and the new keyed
selectors — and proves each surface returns the per-owner data without
cross-talk and with distinct, owner-qualified `node_id` values.

## Constraints

Hard invariants that must hold throughout implementation. These are not
suggestions; violation requires escalation, not workarounds.

- The public package surface declared in `package.json` `exports` and
  `src/index.ts` must remain backward compatible. Adding new exports is
  permitted; renaming, removing, or changing the type of existing exports
  is not.
- `githubInitialStoreSchema` must continue to accept all input shapes the
  current published fixtures use. New required fields are not permitted on
  existing schemas.
- The simulator must not introduce authentication or authorization
  enforcement as a side effect (per `docs/github-rest-api-audit.md`
  §Store and Modeling Constraints). Identity rekeying is independent of
  actor work, which lives in roadmap task 1.2.
- `convertObjByKey` already throws on duplicate keys. That contract must
  remain: seeding two repositories with identical `owner/name` is an error.
- No new external runtime dependency. `fast-check` is acceptable as a
  `devDependency` because the roadmap task explicitly calls for property
  tests; if it is already present, reuse it; otherwise add it as a
  `devDependency` only.
- Domain logic (key construction, identity invariants) must live in the
  store entities under `src/store/entities/*` and pure helpers; REST and
  GraphQL adapters must consume those keys rather than re-derive identity.
  This honours the `hexagonal-architecture` boundary: the store is the
  domain, REST and GraphQL are ports, and they must not invent their own
  identity scheme.
- Files must stay under 400 lines (AGENTS.md). If a new selector module
  pushes a file past that, split by feature.

## Tolerances (exception triggers)

- Scope: if implementation requires net changes to more than 12 source
  files or more than 600 net lines of code, stop and escalate.
- Interface: if the change requires altering an existing exported
  signature in `src/index.ts`, `src/store/index.ts`, or
  `src/store/entities.ts`, stop and escalate before proceeding.
- Dependencies: if any change requires a new runtime dependency, stop
  and escalate. `fast-check` is already a `devDependency`. Adding
  `markdownlint-cli2` as a `devDependency` is pre-approved because the
  Makefile's `markdownlint` target depends on it and the binary is not
  otherwise resolvable in the gating environment.
- Iterations: if `make check-fmt`, `make lint`, or `make test` still fail
  after three remediation attempts on the same milestone, stop and
  escalate.
- Time: if a single milestone (A through D) takes more than four hours of
  active work, stop and escalate.
- Ambiguity: if any consumer of the package outside this repository can be
  shown to depend on the legacy `node_id: repo.name` shape, stop and
  present options before changing it.
- Schema regeneration: if `bun run generate` produces unexpected diffs in
  `src/__generated__/resolvers-types.ts`, stop and inspect rather than
  committing the regenerated file blindly.

## Risks

- Risk: existing snapshots, fixture files, or downstream consumers depend
  on the unqualified `node_id: repo.name` value.
  Severity: medium.
  Likelihood: low.
  Mitigation: grep `repository-mock-data/`, `tests/`, and the bundled
  `example/` for the literal field `node_id` and for direct reads of
  `repo.name` against repository fixtures before changing the encoding.
  Document the new encoding (base64 of `Repository:owner/name`) in
  `docs/api-reference.md` and `docs/architecture.md`.
- Risk: the GraphQL `Repository.id` falls back to `repo.full_name` when
  the numeric `id` is absent in `convertRepositoryToGraphql`. Any test
  relying on a string `id` may now see a different value once that
  fallback is tightened to the canonical key.
  Severity: low.
  Likelihood: medium.
  Mitigation: keep numeric `id` precedence unchanged; only adjust the
  fallback when it would otherwise produce a non-owner-qualified value,
  and capture the previous behaviour in a regression test before changing.
- Risk: `convertObjByKey` collisions in seeded fixtures previously masked
  by the loose key derivation will now surface as parse errors.
  Severity: low.
  Likelihood: low.
  Mitigation: keep `convertObjByKey` semantics. Add an explicit unit test
  asserting the duplicate-key error message includes the offending
  `owner/name` so the failure is self-explanatory for users.
- Risk: `fast-check` integration drift.
  Severity: low.
  Likelihood: low.
  Mitigation: `fast-check` is already a `devDependency` in
  `package.json` (`^4.3.0`). Reuse it; do not bump or change the range
  as part of this task.
- Risk: regenerated `src/__generated__/resolvers-types.ts` diffs creep
  into the change set.
  Severity: low.
  Likelihood: medium.
  Mitigation: run `bun run generate` once at the start, commit any
  unrelated drift in a separate commit if it appears, then proceed.

## Progress

- [ ] Stage A — write failing behavioural tests for cross-owner same-name
  coexistence and identity uniqueness.
- [ ] Stage B — introduce canonical-key helpers, owner-qualified
  `node_id` derivation, keyed store selectors, and adapter updates.
- [ ] Stage C — add property tests with `fast-check` (or a justified
  parameterized alternative) covering store-key invariants.
- [ ] Stage D — fixture builders, documentation updates, roadmap tick,
  and final gating.

Use timestamps to measure rates of progress and detect tolerance breaches.

## Surprises & discoveries

- (none yet — populate during implementation)

## Decision log

- Decision: treat `owner/name` and `owner/repo:ref` as the single source
  of truth for repository and ref identity, exposing a public helper
  module `src/store/keys.ts` that re-exports `repositoryStoreKey`,
  `branchStoreKey`, and `blobStoreKey` plus typed parsing helpers.
  Rationale: avoids ad hoc string concatenation in adapters and keeps
  identity construction in one place, consistent with the
  `hexagonal-architecture` skill's port/adapter separation.
  Date/Author: 2026-05-02, plan author.
- Decision: encode repository `node_id` as
  `Buffer.from('Repository:' + repositoryStoreKey(repo)).toString('base64')`
  by analogy with the organization `node_id` derivation already present
  in the `githubOrganizationSchema` transform in
  `src/store/entities/organization.ts`.
  Rationale: matches the existing pattern in the codebase, is owner-
  qualified, and stays close to GitHub's actual GraphQL node-ID style.
  Date/Author: 2026-05-02, plan author.
- Decision: do not introduce a generic "actor" or "viewer" abstraction in
  this task. That belongs to roadmap task 1.2 and would expand scope.
  Rationale: roadmap §1.2 is a separate step with its own success
  criteria.
  Date/Author: 2026-05-02, plan author.

## Outcomes & retrospective

- (to be filled in at completion)

## Context and orientation

Simulacat Core is a thin GitHub layer over `@simulacrum/foundation-simulator`.
Reading order for a newcomer:

1. `docs/architecture.md` §High-level flow and §State model: the request
   is parsed by Zod schemas in `src/store/entities.ts`, converted into
   keyed tables by `convertInitialStateToStoreState`, then exposed
   through REST handlers in `src/rest/index.ts` and GraphQL resolvers in
   `src/graphql/resolvers.ts`.
2. `docs/api-reference.md` §Exported fixture schemas: lists the public
   fixture entry points (`githubRepositorySchema`, `githubBranchSchema`,
   `githubBlobSchema`, etc.).
3. `docs/github-rest-api-audit.md` §Store and Modeling Constraints:
   captures the current limitation that motivated this task.

Key files that this task touches:

- `src/store/entities/repository.ts` — Zod schema, transform, and
  `repositoryStoreKey`. The transform currently sets
  `node_id: repo.name`, which is the principal bug.
- `src/store/entities/branch.ts` — `githubBranchSchema` and
  `branchStoreKey`. Already canonical; will be reused, not changed,
  except for an exported parse helper.
- `src/store/entities/blob.ts` — `blobStoreKey`. Already canonical.
- `src/store/entities.ts` — aggregates entity schemas and contains
  `convertInitialStateToStoreState` and `convertObjByKey`. The
  duplicate-key error messaging lives here.
- `src/store/index.ts` — slice/selector wiring. Lacks `getRepository`
  and `getBranch` keyed selectors; this plan adds them.
- `src/rest/index.ts` — REST handlers. The `repos/list-branches` and
  `git/get-tree` operations currently use linear `.find` scans; the
  plan switches them to the new keyed selectors and confirms each
  lookup requires both `owner` and the entity name.
- `src/rest/utils.ts` — `blobAsBase64` currently emits a hard-coded
  `node_id: 'node_id'` placeholder. The plan replaces it with an
  owner-qualified encoding derived from `blobStoreKey`.
- `src/graphql/resolvers.ts` — the `repository(owner, name)` resolver
  already filters by both fields case-insensitively; the plan rewires
  it to call the new keyed selector.
- `src/graphql/converters/repository.ts` — emits `Repository.id` and
  `defaultBranchRef.id`. Both must be owner-qualified.
- `tests/repositories.test.ts`, `tests/graphql.test.ts`,
  `tests/entities.test.ts` — the existing test surfaces that anchor
  regression coverage.

Term definitions:

- "Canonical key": the deterministic string that uniquely identifies an
  entity across all owners. For repositories, `${owner}/${name}`. For
  branches, `${owner}/${repo}:${name}`. For blobs,
  `${owner}/${repo}:${path|sha}`.
- "Owner namespace": the set of repositories, branches, and blobs whose
  `owner` field equals a given user or organization `login`. Two owner
  namespaces may contain entities with identical short names without
  collision.
- "Identity leakage": any code path where an entity's identity is
  derived from a substring of its canonical key, such that two entities
  in different owner namespaces could be confused.

## Plan of work

### Stage A — behavioural tests for cross-owner coexistence (red phase)

1. Add `tests/cross-owner-identity.test.ts`. This is a new test file
   that seeds two organizations (`acme` and `globex`) each owning a
   repository called `awesome-repo` with a `main` branch and a
   `README.md` blob, then asserts:
   - `GET /orgs/acme/repos` returns exactly one repository whose
     `full_name` is `acme/awesome-repo`, and the same for `globex`.
   - `GET /repos/acme/awesome-repo/branches` returns the `acme` branch
     only; the `globex` branch is not present.
   - `GET /repos/globex/awesome-repo/branches` returns the `globex`
     branch only.
   - The two repositories' `node_id` values are non-empty, distinct,
     and decode to different owner-qualified strings.
   - GraphQL `repository(owner: "acme", name: "awesome-repo")` returns
     the `acme` repository with `nameWithOwner` `acme/awesome-repo` and
     a `Repository.id` distinct from the `globex` query.
   - Seeding two repositories with identical `owner/name` throws a
     descriptive error from `convertObjByKey`.
2. Add a focused unit test in `tests/entities.test.ts` (or a new
   `tests/store-keys.test.ts`) for `repositoryStoreKey`, `branchStoreKey`,
   and `blobStoreKey`, covering the happy path and an explicit case
   where two inputs differ only in `owner` and yield different keys.
3. Run `bun test` and confirm the new tests fail. Capture the failing
   transcript in `Concrete steps` below.

Validation gate for Stage A: at least one of the new behavioural
assertions fails — specifically the `node_id` distinctness assertion
is expected to fail because of the unqualified `node_id` assignment in
the `githubRepositorySchema` transform.

### Stage B — owner-qualified identity in the store and adapters

1. In `src/store/entities/repository.ts`, replace the transform's
   `node_id: repo.name` line with the snippet shown below. Preserve any
   caller-supplied `node_id`. This mirrors the organization schema's
   existing approach.

   ```ts
   node_id:
     repo.node_id ??
     Buffer.from(
       `Repository:${repositoryStoreKey({owner: repo.owner, name: repo.name})}`
     ).toString('base64')
   ```

2. Introduce `src/store/keys.ts` exporting:
   - `repositoryStoreKey` (re-exported)
   - `branchStoreKey` (re-exported)
   - `blobStoreKey` (re-exported)
   - `repositoryNodeId(owner: string, name: string): string`
   - `parseRepositoryStoreKey(key: string): {owner: string; name: string}`
   - `parseBranchStoreKey(key: string): {owner: string; repo: string; name: string}`

   The parsing helpers must validate input and throw a descriptive
   `Error` when the key is malformed (for example, missing `/` or
   missing `:`). Re-export the new helpers from `src/index.ts`.
3. In `src/store/index.ts`, add the following selectors to
   `inputSelectors`:
   - `getRepository(state, owner, name): GitHubRepository | undefined`
     — looks up the repository by `repositoryStoreKey` directly via
     `schema.repositories.selectTable(state)?.[key]` (foundation tables
     are keyed records, so this is O(1)).
   - `getBranch(state, owner, repo, name): GitHubBranch | undefined`
     — equivalent O(1) lookup against `schema.branches.selectTable`.
   - `listBranchesForRepository(state, owner, repo): GitHubBranch[]`
     — derived from the existing `selectTableAsList` filter, but
     scoped through the new helpers so adapters do not duplicate the
     filter predicate.
   Keep the existing selectors unchanged. The new selectors must accept
   `state` first to match the foundation simulator selector contract.
4. In `src/rest/index.ts`, refactor:
   - `repos/list-branches` (line ~133) to look up the repository via
     `getRepository(getState(), owner, repo)` and the branches via
     `listBranchesForRepository(getState(), owner, repo)`.
   - `git/get-tree` (line ~209) to use the same `getRepository` lookup.
   - Verify `get-combined-status-for-ref` still composes the response
     using both `owner` and `repo` from the path; no behavioural change
     beyond replacing `repository.node_id` once the schema fix lands.
5. In `src/rest/utils.ts`, inside `blobAsBase64`, replace the
   hard-coded `node_id: 'node_id'` placeholder with
   `node_id: Buffer.from('Blob:' + blobStoreKey(blob)).toString('base64')`.
   This is consistent with the new repository encoding and keeps blob
   identities owner-qualified.
6. In `src/graphql/resolvers.ts`, change the `repository` resolver to
   call `simulationStore.selectors.getRepository(state, owner, name)`.
   Preserve case-insensitive matching by lower-casing both `owner` and
   `name` before the lookup, but only after confirming the existing
   `convertObjByKey` keying preserves the original casing. If a
   case-insensitive match is required, fall back to a list scan and add
   a follow-up note in `Surprises`. Otherwise the lookup is exact.
7. In `src/graphql/converters/repository.ts`, inside
   `convertRepositoryToGraphql`, replace the existing `defaultBranchId`
   derivation with the snippet shown below so the default branch
   identity is owner-qualified even when the numeric repository `id`
   is missing. Change the `Repository.id` fallback in the same function
   from `String(repo.full_name)` to `repositoryNodeId(repo.owner,
   repo.name)` so it is also owner-qualified.

   ```ts
   const defaultBranchId = Buffer.from(
     `Branch:${branchStoreKey({
       owner: repo.owner,
       repo: repo.name,
       name: defaultBranchName
     })}`
   ).toString('base64');
   ```

Validation gate for Stage B: `make check-fmt`, `make lint`, and
`make test` all pass; the Stage A tests now go green.

### Stage C — invariant property tests

1. Confirm whether `fast-check` is already a `devDependency`. If not,
   add it via `bun add -d fast-check` and commit `package.json` and
   `bun.lock` together.
2. Add `tests/store-keys.property.test.ts` (or co-locate with the
   key unit tests) covering the following invariants with `fast-check`:
   - For all `(owner1, name1, owner2, name2)` where
     `(owner1, name1) !== (owner2, name2)`,
     `repositoryStoreKey({owner: owner1, name: name1}) !==
      repositoryStoreKey({owner: owner2, name: name2})`.
   - For all `(owner, name)`,
     `parseRepositoryStoreKey(repositoryStoreKey({owner, name}))`
     equals `{owner, name}`.
   - The branch and blob equivalents of the above two properties.
   - For all repository fixtures, the derived `node_id` is non-empty,
     base64-decodable, and starts with `Repository:`.
   Use small string arbitraries that exclude `/` and `:` to avoid
   ambiguous encodings; document that constraint in the test file.
3. The roadmap mentions LemmaScript for "introduced axioms or
   contractual business logic". Decision: do not introduce LemmaScript
   here. The invariants are already total functions over strings and
   are fully covered by the property tests; a LemmaScript proof would
   restate the property without adding rigour. Record this decision in
   `Decision log` once the implementation reaches this stage.

Validation gate for Stage C: `make test` passes including the new
property tests; the property tests run in fewer than five seconds in
the default Bun test environment.

### Stage D — fixture builders, documentation, and gating

1. Add a small public builder API in `src/store/builders.ts` exposing
   `buildRepositoryFixture({owner, name, ...overrides})` and
   `buildBranchFixture({owner, repo, name, ...overrides})`. These
   builders run their inputs through the existing Zod schemas and
   return the parsed entity. They are intended as the seed of the
   broader fixture-builder work in roadmap §1.3.2 and explicitly do
   not cover that task's full scope.
2. Re-export the builders from `src/index.ts` so consumers can import
   them without reaching into internals.
3. Update `docs/api-reference.md` §Exported fixture schemas to mention
   the canonical keys and the owner-qualified `node_id` encoding.
   Update the surrounding prose to make clear that two repositories
   with the same name under different owners coexist.
4. Update `docs/architecture.md` §State model to describe the
   canonical keys explicitly.
5. The user request mentions `docs/users-guide.md` and
   `docs/developers-guide.md`. Those files do not exist in this
   repository. The closest equivalents are `README.md` (user-facing)
   and `docs/development.md` (contributor-facing). Update both with
   short notes referencing the canonical keys, and record this
   substitution in `Decision log` for transparency.
6. Tick the `1.1.1` checkbox in `docs/roadmap.md` only after `make
   check-fmt`, `make lint`, and `make test` all pass.
7. Run `make markdownlint` to confirm the documentation changes pass
   markdown lint, and `bun fmt` to format any updated markdown.

Validation gate for Stage D: full quality gate (`make check-fmt`,
`make lint`, `make test`) passes; documentation lint passes;
`docs/roadmap.md` shows the task as complete; the branch is renamed
and pushed per the user instructions.

## Concrete steps

Run all commands from the project worktree root (the directory
containing `package.json` and `Makefile`). Substitute the actual path
on the executor's machine; the absolute path is intentionally not
recorded here because it is environment-specific.

1. Sanity check the working tree:

   ```bash
   git status
   git branch --show-current
   ```

   Expect a clean tree on the branch
   `1-1-1-re-key-repositories-and-refs-by-canonical-identifiers`. That
   branch was renamed and pushed alongside the draft of this plan, so
   no further rename is required before opening the implementation
   pull request (PR).

2. Capture the baseline test result so regressions are easy to spot:

   ```bash
   make test 2>&1 | tee /tmp/test-simulacat-core-1-1-1-baseline.out
   ```

3. Implement Stage A (failing tests). Re-run only the new file:

   ```bash
   bun test tests/cross-owner-identity.test.ts \
     2>&1 | tee /tmp/test-simulacat-core-1-1-1-stageA.out
   ```

   Expect failures on the `node_id` distinctness assertion before any
   source changes.

4. Implement Stage B and re-run the gates sequentially (per AGENTS.md
   guidance to avoid parallel runs):

   ```bash
   make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-1-1-1-stageB.out
   make lint     2>&1 | tee /tmp/lint-simulacat-core-1-1-1-stageB.out
   make test     2>&1 | tee /tmp/test-simulacat-core-1-1-1-stageB.out
   ```

   All three must pass before continuing.

5. Implement Stage C (property tests). Re-run `make test` and confirm
   the property suite stabilizes within a few seconds:

   ```bash
   make test 2>&1 | tee /tmp/test-simulacat-core-1-1-1-stageC.out
   ```

6. Implement Stage D (builders, docs, roadmap tick). Re-run all gates
   one more time:

   ```bash
   make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-1-1-1-stageD.out
   make lint     2>&1 | tee /tmp/lint-simulacat-core-1-1-1-stageD.out
   make test     2>&1 | tee /tmp/test-simulacat-core-1-1-1-stageD.out
   make markdownlint \
     2>&1 | tee /tmp/markdownlint-simulacat-core-1-1-1-stageD.out
   ```

7. Push the implementation commits to the existing branch and update
   the open pull request (PR), or open a fresh PR if none is open:

   ```bash
   git push origin 1-1-1-re-key-repositories-and-refs-by-canonical-identifiers
   ```

   The branch and the planning PR were created at draft time, so this
   step is normally just `git push`. The PR title must keep the
   `(1.1.1)` roadmap tag, and the body must reference this ExecPlan
   path. When updating the body, use `$'...'` heredoc syntax with real
   newlines, per the system instructions.

## Validation and acceptance

Acceptance is a behavioural statement, not a code-shape statement.

- A consumer can seed two organizations, each with a repository called
  `awesome-repo` and a branch called `main`. Issuing
  `GET /orgs/acme/repos` returns the `acme` repository only; issuing
  `GET /orgs/globex/repos` returns the `globex` repository only;
  issuing `GET /repos/acme/awesome-repo/branches` returns the `acme`
  branch only; the GraphQL query
  `repository(owner: "acme", name: "awesome-repo")` returns the
  `acme` repository with a `Repository.id` distinct from the
  equivalent `globex` query.
- The two repositories' `node_id` values are owner-qualified, distinct,
  base64-decodable strings beginning with `Repository:`.
- Seeding two repositories with identical `owner/name` produces a
  parse-time error from `convertObjByKey` whose message includes the
  duplicated key.
- The new property tests pass deterministically and run in under five
  seconds locally.

Quality criteria (what "done" means):

- Tests: `make test` passes, including the new behavioural,
  parameterized, and property tests.
- Lint and types: `make lint` and `bun check:types` (invoked via
  `make typecheck`) pass without warnings.
- Format: `make check-fmt` reports no changes.
- Markdown: `make markdownlint` exits cleanly.
- Documentation: `docs/api-reference.md`, `docs/architecture.md`,
  `README.md`, and `docs/development.md` reflect the canonical-key
  contract.

Quality method (how compliance is checked):

- Run the gating commands captured under `Concrete steps` and inspect
  the tee'd logs.
- Manually exercise the simulator end-to-end by following Stage A's
  seed scenario through `bun bin/start.cjs` and `curl`.

## Idempotence and recovery

All steps are re-runnable. The new code paths are additive (a new
selectors file, a new keys module, new tests) plus targeted edits to
two `node_id` lines and a small set of resolver and adapter call
sites. If a step fails partway, fix the underlying cause and re-run
the gate from Stage B onward; the test suite is the source of truth
for whether a checkpoint has been reached. No destructive operations
are required at any stage; the branch rename happens only once at the
end of Stage D and uses GitHub's branch rename flow only if a PR has
already been opened.

## Artifacts and notes

Indicative diff shapes (illustrative only — do not copy verbatim):

```ts
// src/store/keys.ts
export {repositoryStoreKey} from './entities/repository.ts';
export {branchStoreKey} from './entities/branch.ts';
export {blobStoreKey} from './entities/blob.ts';

export const repositoryNodeId = (owner: string, name: string): string =>
  Buffer.from(`Repository:${owner}/${name}`).toString('base64');

export const parseRepositoryStoreKey = (key: string): {owner: string; name: string} => {
  const slash = key.indexOf('/');
  if (slash <= 0 || slash === key.length - 1) {
    throw new Error(`Invalid repository store key: ${key}`);
  }
  return {owner: key.slice(0, slash), name: key.slice(slash + 1)};
};
```

```ts
// src/store/entities/repository.ts (excerpt)
const id = repo.id ?? nextRepositoryId();
const full_name = `${repo.owner}/${repo.name}`;
const node_id =
  repo.node_id ?? Buffer.from(`Repository:${full_name}`).toString('base64');
```

## Interfaces and dependencies

At the end of this milestone the following names must exist with
these signatures:

```ts
// src/store/keys.ts
export const repositoryStoreKey: (
  repository: Pick<GitHubRepository, 'owner' | 'name'>
) => string;
export const branchStoreKey: (
  branch: Pick<GitHubBranch, 'owner' | 'repo' | 'name'>
) => string;
export const blobStoreKey: (blob: GitHubBlob) => string;
export const repositoryNodeId: (owner: string, name: string) => string;
export const parseRepositoryStoreKey: (key: string) => {
  owner: string;
  name: string;
};
export const parseBranchStoreKey: (key: string) => {
  owner: string;
  repo: string;
  name: string;
};
```

```ts
// src/store/index.ts (selectors)
type Selectors = {
  // ...existing selectors...
  getRepository: (
    state: AnyState,
    owner: string,
    name: string
  ) => GitHubRepository | undefined;
  getBranch: (
    state: AnyState,
    owner: string,
    repo: string,
    name: string
  ) => GitHubBranch | undefined;
  listBranchesForRepository: (
    state: AnyState,
    owner: string,
    repo: string
  ) => GitHubBranch[];
};
```

```ts
// src/store/builders.ts
export const buildRepositoryFixture: (
  input: GitHubInitialStore['repositories'][number]
) => GitHubRepository;
export const buildBranchFixture: (
  input: GitHubInitialStore['branches'][number]
) => GitHubBranch;
```

Existing public exports must remain unchanged in signature: this
includes `simulation`, `extendStore`, `githubInitialStoreSchema`,
`githubRepositorySchema`, `githubBranchSchema`, `githubBlobSchema`,
`githubOrganizationSchema`, `githubUserSchema`, and
`convertInitialStateToStoreState`.

## Out of scope

The following items are explicitly out of scope for task 1.1.1 and
will be tackled in later roadmap items:

- Pull requests, issues, commits, and refs beyond the existing branch
  representation (roadmap 1.1.2).
- Request-scoped actor resolution and `viewer`/`/user` rework
  (roadmap 1.2).
- Centralized write actions (roadmap 1.3.1).
- Full actor-aware fixture builders (roadmap 1.3.2). The minimal
  builders introduced here cover only repositories and branches and
  do not yet model actor context.
- Tree-object modelling, status mutability, and any work flagged for
  later phases in `docs/github-rest-api-audit.md` §Recommended
  Follow-Ups.

## Revision note

- 2026-05-04: Code review pass. Replaced absolute file:line references
  with symbolic references (function or transform names) so the plan
  survives line-number drift. Standardized the plan's documentation
  lint command on `make markdownlint` to match the project's gating
  surface. Removed first-person plural ("we") in favour of neutral or
  passive voice. Switched non-Oxford "parameterised" and "stabilises"
  to the en-GB-oxendict "-ize" spellings. Defined "pull request (PR)"
  on first use. Reflowed the Concrete steps preamble to drop the
  environment-specific absolute path and to reflect that the branch
  rename and planning PR were completed during the draft phase.
