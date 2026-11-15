# Publish actor-aware fixture builders (1.3.2)

This ExecPlan (execution plan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT

Approval: not yet approved. Implementation must not begin until the user
explicitly approves this plan or requests revisions.

Roadmap item: `1.3.2` (legacy task label `1.3.3`). See `docs/roadmap.md`
§1.3.2. Requires roadmap item 1.3.1, which is complete.

## Purpose / big picture

Simulacat Core simulates the GitHub REST and GraphQL APIs from seeded state.
Today a test author seeds that state by hand-writing an `initialState` object
literal and passing it to `simulation({initialState})`. Every test repeats the
same `users`, `organizations`, `repositories`, `branches`, and `blobs` arrays,
and nothing checks that the pieces agree with each other. An issue can name an
author who was never seeded. A pull request can name a head branch whose ref
row does not exist, so its GraphQL relations silently resolve to nothing. A
branch row and its `refs/heads/...` ref row can carry different SHAs. Many
defaults are drawn from Faker (a random fake-data library), so two runs of the
same test produce different SHAs, timestamps, emails, and identifiers.

The package already exports six thin builders (`buildRepositoryFixture` and
friends in `src/store/builders.ts`), but each one only validates a single
entity against its schema. They do not compose into a coherent seeded state,
they know nothing about actors, and one of them (`buildRefFixture`) produces
output that changes its own store key when it is fed back into `initialState`
(see `Surprises & discoveries`).

After this change, a test author can write:

```typescript
import {actorHeaders, buildFixtureScenario, simulation} from 'simulacat-core';

const {initialState, handles} = buildFixtureScenario((scenario) => {
  const alice = scenario.user({login: 'alice'});
  const acme = scenario.organization({login: 'acme', members: [alice]});
  const widgets = scenario.repository({owner: acme, name: 'widgets'});
  const feature = scenario.branch({repository: widgets, name: 'feature/login'});
  const bug = scenario.issue({repository: widgets, author: alice, title: 'Login fails'});
  const fix = scenario.pullRequest({repository: widgets, author: alice, title: 'Fix login', head: feature});
  return {alice, widgets, bug, fix};
});

const app = simulation({initialState});
// GET /user with actorHeaders(handles.alice) returns login "alice".
// GET /repos/acme/widgets/issues/1 returns user.login "alice".
// GET /repos/acme/widgets/pulls/2 returns head.ref "feature/login".
```

The builder guarantees, before the simulator starts, that every actor named by
a fixture (repository owner, organization member, issue author, pull request
author) is seeded; that issues and pull requests share one number sequence per
repository, as on GitHub; that every branch has a matching ref row and commit
row with the same SHA; and that building the same scenario twice yields
byte-identical state. The handles it returns carry the coordinates a test needs
(login, `owner/name`, issue number, branch SHA) and can be turned into request
headers that select that actor through the existing `x-simulacat-actor` header.

Observable success: the new Gherkin feature
`features/actor-aware-fixtures.feature` starts a real simulator from a built
scenario and proves, over HTTP, that the GraphQL `viewer`, REST `/user`, REST
issue and pull request reads, and REST ref reads all agree with the handles. A
new users-guide example installs the packed package into a throwaway consumer,
type-checks it against the published declarations, and runs it.

## Constraints

Hard invariants. Violating any of them requires escalation, not a workaround.

- `C1` Pure composition. Modules under `src/fixtures/` must not import
  `express`, `starfx`, `@simulacrum/foundation-simulator`, `@faker-js/faker`,
  or anything under `src/rest/`, `src/graphql/`, or `src/middleware/`. They may
  import entity schemas and key helpers from `src/store/` and the actor header
  constants from `src/store/actors.ts`. A fitness test enforces this (see
  `EP-M3`).
- `C2` One validation path. Built state must be validated by the same
  `githubInitialStoreSchema` and `convertInitialStateToStoreState` that
  `simulation()` uses, so a scenario that builds is a scenario that seeds. The
  builder must not maintain a second, divergent schema.
- `C3` Input-shaped output. `buildFixtureScenario` returns `initialState` in
  the *input* shape (`InitialState`), not the parsed shape, so the simulator
  parses it exactly once.
- `C4` No authorization semantics. Actor-awareness here means representation
  and referential integrity only. No permission checks, token validation,
  collaborator lattices, or actor-derived `permissions` fields. Those belong to
  roadmap items 4.3 and 9.5.2 (`docs/architecture.md` lines 186-188,
  `docs/developers-guide.md` lines 424-427 and 478-485).
- `C5` No silent actor defaults. The builder must never default an author or
  owner to a seeded user or to the schema's `octocat` fallback. Every
  attributable entity takes an explicit actor handle.
- `C6` No hidden randomness. Built state must not reach any Faker-backed
  schema default. Every field the schemas would otherwise randomize is supplied
  explicitly and deterministically.
- `C7` No URL synthesis. The builder must not populate URL fields; URLs stay
  request-time projections (`docs/api-reference.md` lines 233-242).
- `C8` No new store actions. This task must not add create actions for
  repositories, issues, pull requests, branches, or refs. Those belong to
  roadmap phases 3 and 8. Fixtures seed through `initialState`; post-start
  mutation continues to use the existing `updateRepository` spine.
- `C9` Existing behaviour preserved. Existing tests and the existing six
  `build*Fixture` exports keep their current contracts, except for the
  documented ref-normalization fix in `EP-M1`, which changes only inputs whose
  `ref` is already fully qualified.
- `C10` Repository conventions. No source file may exceed 400 lines. Exported
  functions take one parameter object and are documented with `@param`,
  `@returns`, `@throws`, and `@example` where applicable. Biome, Oxlint
  (including the `unicorn`, `deslop`, and local `df12` rules), and the TypeDoc
  zero-warning gate must pass with no new suppressions or baseline entries.
- `C11` Zod major version. The package uses `zod` `^3.25.76`. Do not use Zod 4
  only APIs.

## Tolerances (exception triggers)

ExecPlan files are excluded from every count below. Counts compare the branch
against the merge base with `main`
(`git diff --numstat $(git merge-base HEAD origin/main)`), and measure net
lines (additions minus deletions) per category. `bun.lock` is excluded from
line counts but counts as one configuration file. Generated `.dfy.gen` files
are excluded from line counts; hand-maintained `.dfy` proof files count as code.

Categories are assigned by purpose:

- Code: `src/**`, `tests/**`, `features/**`, `tools/**`, and proof sources.
- Configuration: `package.json`, `Makefile`, `LemmaScript-files.txt`,
  `tsconfig.json`, `biome.json`, `.oxlintrc*`, `typos.local.toml`, and CI
  workflow files.
- Documentation: `docs/**` except `docs/execplans/**`, `README.md`, and
  `CHANGELOG.md`.

Historical evidence (from `git show --numstat` on the merged commits, with the
same classification): 1.1.2 (`c47de65`) changed 24 code files for +2,035/-110;
1.2.2 (`79b51f3`) changed 17 code files for +835/-157; 1.3.1 (`b42475f`)
changed 28 code files for +3,012/-1,037; 1.4.1 (`4ce19bd`) changed 40 code
files for +2,907/-371. Documentation ran +122 to +359 per task, and
configuration never exceeded +3 lines. None of those plans recorded a budget
increase in its revision history; 1.2.2 used its file budget as a scope lever
to defer a GraphQL hook. Those plans set budgets of 500 to 1,200 net source
lines and still delivered larger totals once tests were counted, so this plan
counts tests explicitly.

Budgets for this task:

- Code: at most 2,400 net lines and 32 files. Estimate: about 650 lines of
  production source across 7 new files, about 1,400 lines of tests across 9
  files, and about 150 lines of proof source. Contingency is roughly 10%.
- Configuration: at most 40 net lines and 4 files (one `lemmascript`
  development dependency, one `prove` Makefile target, `LemmaScript-files.txt`,
  and `bun.lock`).
- Documentation: at most 450 net lines and 9 files.

Other triggers:

- Any category budget exceeded: stop and escalate. Spare capacity in one
  category does not offset another.
- `EP-M1` finds more than two entity schemas that are not idempotent: stop and
  escalate, because the fix would no longer be a bounded correction.
- Any change needed to `src/store/actors.ts` beyond importing its exported
  constants (it is already 954 lines and over the 400-line limit): escalate.
- Any change to the signature or behaviour of an existing public export other
  than the `EP-M1` ref fix: escalate.
- Any new runtime dependency, or any development dependency other than
  `lemmascript`: escalate.
- `lsc check` cannot verify the allocator after three focused attempts, or
  needs an `assume`, `{:axiom}`, or added axiom to close: stop and record the
  options. Do not weaken the specification to make it pass.
- A gate fails three times for the same root cause after fixes: escalate.
- `tests/support/documented-example-execution.ts` (392 lines today) would
  exceed 400 lines: split the handler table out first as a separate atomic
  refactor commit, and record it.

## Risks

- `R1` Ref-schema fix ripples. Changing how `githubRefSchema` derives
  `qualifiedName` could alter keys for existing fixtures that pass a fully
  qualified `ref`. Mitigation: the fix strips only the `refs/heads/` and
  `refs/tags/` prefixes, which the REST lookup path (`normalizeGitRefPath`)
  already strips; existing tests in `tests/entities.test.ts` pin the short-name
  behaviour; a property test pins idempotence.
- `R2` Backing issue rows change listings. Seeding a backing issue row for
  each pull request makes `GET /repos/{owner}/{repo}/issues` list pull
  requests, as GitHub does. If `projectIssueUrls` mishandles an empty
  `pull_request` marker, payloads may break. Mitigation: `EP-M3` red tests read
  both endpoints; if projection breaks, record it and fall back to omitting the
  marker rather than patching projection code outside scope.
- `R3` The draft-callback shape may feel unfamiliar. Mitigation: the
  community-of-experts review below examined the alternatives; the decision log
  records why the callback was kept.
- `R4` LemmaScript is a tech preview (0.6.10 at planning time). Its Dafny
  backend may reject the chosen subset. Mitigation: the proven function is kept
  to arrays of integers and a loop; `EP-M5` is isolated so a failure there does
  not block the builder; the fast-check property for the same obligation lands
  in `EP-M2` regardless.
- `R5` Dafny is installed on the development host (4.11.0) but not in CI.
  Mitigation: `make prove` is a separate target and an explicit acceptance
  criterion for `EP-M5`; adding a CI job is recorded as follow-up rather than
  silently assumed.
- `R6` Freezing returned handles could surprise callers who spread and mutate
  them. Mitigation: handles are documented as read-only values and typed
  `Readonly`; `initialState` is returned as a fresh, unfrozen object so the
  foundation simulator and Zod can consume it normally.
- `R7` Bun's test runner discovers step files through the `test-plugins.ts`
  preload. A new `*.steps.ts` file must follow the existing naming pattern or
  its steps will be missing. Mitigation: `EP-M4` red run confirms the steps are
  registered (undefined-step failures are the expected red result).

## Progress

- [x] (2026-11-15) Renamed the branch to `1-3-2-actor-aware-fixture-builders`.
- [x] (2026-11-15) Reconnaissance with a Wyvern team: documentation
  constraints, current fixture patterns, public surface, and plan history.
- [x] (2026-11-15) Prior-art research (fishery factories, LemmaScript).
- [x] (2026-11-15) Confirmed the ref re-parse defect with a scratch probe.
- [x] (2026-11-15) Drafted this ExecPlan.
- [ ] Community-of-experts design review and revision.
- [ ] User approval.
- [ ] `EP-M0` Baseline gates recorded.
- [ ] `EP-M1` Entity schema idempotence.
- [ ] `EP-M2` Pure fixture policy core.
- [ ] `EP-M3` Scenario builder and actor headers.
- [ ] `EP-M4` Behavioural and end-to-end acceptance.
- [ ] `EP-M5` LemmaScript proof of number allocation.
- [ ] `EP-M6` Documentation and delivery closure.

## Surprises & discoveries

- Observation: `githubRefSchema` is not idempotent. Parsing
  `{qualifiedName: 'main', object: {sha}}` yields `qualifiedName: 'main'` and
  `ref: 'refs/heads/main'`; parsing that output again yields
  `qualifiedName: 'refs/heads/main'`, so the store key moves from
  `owner/repo:main` to `owner/repo:refs/heads/main`, and REST `git/get-ref`
  (which looks up `main`) no longer finds it. Evidence, from a scratch probe
  run on 2026-11-15:

  ```plaintext
  main -> refs/heads/main
  branch sha differs across builds: true
  repo id 3000 3000 topics ["octocat","boilerplate","tauri","api"]
  ```

  Impact: any test that seeds `initialState.refs` with `buildRefFixture` output
  gets a silently broken ref. `EP-M1` fixes this before builders are composed.
- Observation: `githubBranchSchema` draws a random SHA when `commit.sha` is
  omitted, user and organization schemas draw random ids, emails, and
  timestamps, and repository ids come from a module-global counter. No test
  seeds Faker. Impact: the builder must supply all of these explicitly (`C6`).
- Observation: pull request relations (`resolvePullRequestRelations` in
  `src/store/early-entity-selectors.ts` lines 114-126) look up base and head
  refs by `qualifiedName` and the backing issue by `issue_number`. Nothing
  seeds those rows today, so the relations are usually empty.
- Observation: `src/store/actors.ts` is 954 lines and is not exported from
  `src/index.ts`. The builder only needs its `requestActorHeader` constant.
- Observation: `podbot-design.md`, named in the task brief, does not exist in
  this repository. It is recorded as absent in `Conformance basis`.

## Decision log

- Decision: define "actor-aware" as (a) every attributable fixture takes an
  explicit actor handle instead of a login string, (b) the builder proves every
  referenced actor is seeded, and (c) a handle can be converted into the
  request header that selects that actor. Rationale: no repository document
  defines the term; this definition satisfies the roadmap success criterion
  ("compose actor-aware repository fixtures") without importing the
  authorization semantics that `C4` forbids. Date: 2026-11-15.
- Decision: return input-shaped `initialState` validated once through
  `githubInitialStoreSchema` and `convertInitialStateToStoreState`, rather than
  parsed entities. Rationale: parsing twice is unsafe today (see the ref
  discovery), and validating with the simulator's own schema keeps one path
  (`C2`, `C3`). Date: 2026-11-15.
- Decision: use a draft callback,
  `buildFixtureScenario((scenario) => handles)`, that confines mutation to the
  callback and returns frozen handles plus fresh state. Alternatives
  considered: (1) a persistent immutable builder where each call returns a new
  builder, which makes it awkward to capture handles such as an auto-assigned
  issue number; (2) free functions composed afterwards, which cannot allocate
  shared per-repository numbers until composition, so the test cannot know the
  number it is asserting on. Rationale: the callback gives handles with final
  coordinates at the call site, keeps allocation order explicit, and matches
  the "pleasant to write but strict to load" guidance in
  `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §6. Date: 2026-11-15.
- Decision: issues and pull requests share one per-repository number
  sequence; an omitted number is `max(used) + 1`; an explicit number must be
  positive and unused. Rationale: this is GitHub's observable behaviour, and
  the existing schemas already tie `issue_number` to the pull request number.
  Date: 2026-11-15.
- Decision: each pull request also seeds its backing issue row, marked with
  an empty `pull_request` link object. Rationale: GitHub lists pull requests in
  the issues endpoint, and the existing `issue` relation in
  `resolvePullRequestRelations` expects the row. Subject to `R2`. Date:
  2026-11-15.
- Decision: each branch seeds a branch row, a `refs/heads/<name>` ref row, and
  a commit row with one shared SHA. A repository seeds its default branch with
  a root commit. A new branch, by default, gets a fresh commit whose parent is
  the tip of the branch it starts from, so a pull request's head and base
  differ. Rationale: this removes the most common source of empty relations.
  Date: 2026-11-15.
- Decision: deterministic values come from a scenario-local policy, not
  Faker. SHAs are the SHA-1 of a stable seed string (`node:crypto`); a logical
  clock starts at `2024-01-01T00:00:00.000Z` (overridable) and advances one
  second per created entity; users and organizations share one account id
  sequence (GitHub accounts share an id space); repository, issue, and pull
  request ids come from scenario-local sequences. Rationale: `C6`, stable
  snapshots, and no reliance on module-global counters. Date: 2026-11-15.
- Decision: builder misuse throws `FixtureScenarioError`, an `Error` subclass
  with a `code` discriminant (`unknown-reference`, `duplicate`,
  `invalid-number`, `invalid-pull-request`, `schema`) and a `cause` where one
  exists. Internally, the integrity check is a pure query returning a readonly
  list of violations; the builder turns a non-empty list into the error.
  Rationale: fixture misuse is a programming error in test setup, so failing
  fast is right, while the pure query keeps command/query separation and
  doubles as an independent oracle in property tests. Date: 2026-11-15.
- Decision: keep the six existing `build*Fixture` exports unchanged. They
  validate single entities for converter and URL unit tests; the new scenario
  builder composes whole states. Rationale: no external consumer needs them
  removed, and the package is pre-1.0 without a release tag, so no
  compatibility layer is needed either way. Date: 2026-11-15.
- Decision: scope actor handles to users and organizations, plus an
  `anonymousFixtureActor` constant for header generation. App and installation
  handles are deferred to roadmap 9.5.2. Rationale: the roadmap names
  repositories, refs, issues, and pull requests; user actors are the only kind
  that the current read surfaces resolve. Date: 2026-11-15.
- Decision: prove the number allocator with LemmaScript (Dafny backend), and
  cover every other invariant with fast-check properties and named examples.
  Rationale: the allocator is the one piece of contractual business logic whose
  guarantee must hold for all inputs; the rest are compositional properties
  that model-based testing covers well. Adding `lemmascript` as a development
  dependency is part of this plan and is approved only with it. Date:
  2026-11-15.

## Outcomes & retrospective

Not started. Fill in at each milestone boundary and at completion.

## Conformance basis

Upstream artefacts, read at commit `c2e5ddc` (branch base):

- `docs/roadmap.md` §1 idea, §1.3 step, and §1.3.2 task (`RM-1.3.2`). Its
  success criterion is `RM-1.3.2-S`: "new tests can compose actor-aware
  repository fixtures through published builders."
- `docs/architecture.md` §State model and §Extension seams (`ARCH-STATE`,
  `ARCH-SEAMS`), including lines 58-60 that already describe
  `src/store/builders.ts`.
- `docs/developers-guide.md` §Testing expectations (`DEV-TEST`) and
  §Linting rules (`DEV-LINT`).
- `docs/github-rest-api-audit.md` §Extension Surface and §Store and Modelling
  Constraints (`REST-EXT`).
- `docs/api-reference.md` §Exported fixture schemas (`API-FIX`).
- `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §5 stable keys, §6 seed fixtures, and §25 clocks (`MOCK-KEYS`, `MOCK-SEED`,
  `MOCK-CLOCK`).
- `docs/complexity-antipatterns-and-refactoring-strategies.md` (bumpy-road
  avoidance and command/query separation).
- `docs/github-graphql-api-audit.md` (the `viewer` surface the acceptance
  tests use).
- `podbot-design.md`: named in the brief, absent from this repository. No
  requirement is drawn from it.
- No Terms of Reference, ADR, or technical design revision governs this task
  beyond the documents above. `docs/adr-001-linting-strategy.md` governs lint
  tooling only.

Trace links:

```plaintext
RM-1.3.2-S -> MOCK-SEED -> EP-M3 -> tests/fixture-scenario.test.ts
RM-1.3.2-S -> ARCH-SEAMS -> EP-M4 -> features/actor-aware-fixtures.feature
RM-1.3.2-S -> API-FIX -> EP-M4 -> users-guide tested-example actor-aware-fixture-scenario
MOCK-KEYS -> EP-M1 -> tests/entity-schema-idempotence.test.ts
MOCK-KEYS -> EP-M2/EP-M5 -> tests/fixture-numbering.test.ts, src/fixtures/numbering.dfy
MOCK-CLOCK -> EP-M2 -> tests/fixture-determinism.test.ts
DEV-TEST -> EP-M2..EP-M4 -> property, unit, behavioural, and end-to-end suites
```

## Verification plan

Invariants, lemmas, and axioms are listed with their method, artefact, command,
expected evidence, discharge condition, and non-vacuity check.

### Invariants

`INV-1` Schema idempotence. For every entity schema `S` in
`src/store/entities/` and for `githubInitialStoreSchema`, `S.parse(S.parse(x))`
deep-equals `S.parse(x)` for every valid input `x` that supplies explicit
values for Faker-backed fields.

- Method: fast-check property per schema, plus named regression examples for
  the ref cases (`main`, `refs/heads/main`, `v1.0.0` with `type: 'tag'`,
  `refs/pull/1/head`).
- Artefact: `tests/entity-schema-idempotence.test.ts`.
- Command: `bun test tests/entity-schema-idempotence.test.ts`.
- Evidence and discharge: red on the ref schema before `EP-M1`, green after,
  with the shared `propertyTestSeed` and 200 runs per schema.
- Non-vacuity: the ref arbitrary must generate both short and fully
  qualified names, so record `fc.statistics` classification showing each class
  above 20%. The pre-fix failure is the negative control.

`INV-2` Referential integrity. In every built state, each repository owner is a
seeded user or organization login; each organization member is a seeded user
whose `organizations` lists that organization; each branch, ref, commit, issue,
and pull request names a seeded repository; each issue and pull request author
is a seeded user; each pull request's base and head name seeded refs whose SHAs
match its `base.sha` and `head.sha`; each pull request has a backing issue with
the same number.

- Method: model-based fast-check property. A command arbitrary generates
  sequences of `user`, `organization`, `repository`, `branch`, `issue`, and
  `pullRequest` calls, choosing references from handles created earlier in the
  sequence. The oracle is `findFixtureIntegrityViolations`, an independent pure
  query over the output state, and must return `[]`. The output must also pass
  `githubInitialStoreSchema` and `convertInitialStateToStoreState` without
  throwing.
- Artefact: `tests/fixture-scenario-properties.test.ts`.
- Command: `bun test tests/fixture-scenario-properties.test.ts`.
- Evidence and discharge: 200 runs with `propertyTestSeed`, all passing.
- Non-vacuity: classify each run by the number of pull requests, cross-owner
  repositories, and organization members; require at least 30% of runs to
  contain one or more pull requests and one or more issues. Negative controls in
  `tests/fixture-integrity.test.ts` corrupt a valid state in each listed way
  (unknown owner, unknown author, missing head ref, mismatched SHA, missing
  backing issue) and assert the specific violation code.

`INV-3` Shared, unique numbering. Within one repository, issue and pull request
numbers are pairwise distinct positive integers; an omitted number is one
greater than the largest number used so far (or 1); an explicit unused positive
number is honoured; an explicit used or non-positive number is rejected.

- Method: LemmaScript proof of `nextIssueNumber` and `isNumberAvailable`
  (see `L1` and `L2`), plus a fast-check property over mixed sequences of
  explicit and omitted numbers against a model `Set<number>`.
- Artefacts: `src/fixtures/numbering.ts` (annotated with `//@` contracts),
  `src/fixtures/numbering.dfy`, and `tests/fixture-numbering.test.ts`.
- Commands: `make prove` and `bun test tests/fixture-numbering.test.ts`.
- Evidence and discharge: Dafny reports every obligation verified with zero
  errors; the property passes 500 runs.
- Non-vacuity: the proof's precondition (all elements positive) is
  satisfiable, witnessed by `[]` and `[1, 3]`. Mutation controls are run once
  and recorded in `Artefacts and notes`: changing `max + 1` to `max` must make
  `lsc check` fail its `ensures`; dropping the `> 0` check must make the
  property fail.

`INV-4` Branch, ref, and commit coherence. For every seeded branch `b`, there
is exactly one ref with `qualifiedName` equal to `b.name`, `ref` equal to
`refs/heads/<b.name>`, and `object.sha` equal to `b.commit.sha`, and exactly
one commit with that SHA in the same repository. Every non-root commit's parent
SHA is a seeded commit in the same repository.

- Method: included in the `INV-2` oracle and model property; named examples
  for the default branch and for a branch started from a non-default branch.
- Artefacts: `tests/fixture-scenario.test.ts`,
  `tests/fixture-scenario-properties.test.ts`.

`INV-5` Determinism. Running `buildFixtureScenario` twice with the same
callback and options yields deep-equal `initialState` and handles, and no
Faker-backed default is reached.

- Method: fast-check property: for a generated command sequence, build twice
  and compare with `toStrictEqual`; named example comparing against a stored
  snapshot.
- Artefact: `tests/fixture-determinism.test.ts`.
- Non-vacuity: a seeded-fault control temporarily omits the explicit branch
  SHA in a test-local wrapper and asserts the two builds then differ, which
  proves the comparison can detect Faker leakage.

`INV-6` Actor header round trip. For every user handle `h`, parsing the headers
produced by `actorHeaders(h)` with the existing request-actor parser yields
`{kind: 'user', login: h.login}`, and resolving it against a store seeded from
the same scenario yields the seeded user. For `anonymousFixtureActor`, the
parser yields `{kind: 'anonymous'}`.

- Method: fast-check property over logins drawn from GitHub's login
  alphabet (alphanumerics and single interior hyphens, 1 to 39 characters),
  plus named examples.
- Artefact: `tests/fixture-actor-headers.test.ts`.
- Non-vacuity: a negative example with a login absent from the scenario must
  resolve to anonymous, showing that resolution consults seeded state.

`INV-7` Boundary purity. No module under `src/fixtures/` imports a forbidden
module (`C1`).

- Method: fitness test that reads each file's import specifiers.
- Artefact: `tests/fixture-boundaries.test.ts`.
- Non-vacuity: the test first asserts it found at least six fixture modules
  and at least one import per module, so an empty glob cannot pass.

### Lemmas

`L1` For any finite array `used` of positive integers, `nextIssueNumber(used)`
is strictly greater than every element of `used` and is at least 1. Corollary:
the result is not an element of `used`, which is the step that connects
allocation to `INV-3` uniqueness.

`L2` For any finite array `used` and integer `n`, `isNumberAvailable(used, n)`
is true exactly when `n > 0` and `n` is not an element of `used`.

`L3` If every allocation in a sequence is made through `L1` or accepted by
`L2`, the resulting multiset of numbers has no duplicates. This is discharged
by induction in the property test's model rather than by the prover, because
the draft's sequencing is ordinary imperative code; the prover covers the
per-step contract that the induction relies on.

### Axioms

- `A1` `node:crypto` SHA-1 is deterministic for equal input strings.
- `A2` Zod 3 `parse` is deterministic for inputs that supply every
  defaulted-by-function field, and returns new objects without mutating its
  input.
- `A3` `@aboviq/bun-test-cucumber` runs every scenario in
  `features/**/*.feature` with step definitions from `tests/**/*.steps.ts`.
- `A4` LemmaScript's Dafny translation of the annotated subset is faithful to
  the TypeScript semantics for arrays of integers, as documented in its
  `SPEC_DAFNY.md`. The fast-check property for `INV-3` exercises the same
  TypeScript function at runtime to guard against translation drift.
- `A5` The foundation simulator does not mutate `initialState` arrays it
  receives after `githubInitialStoreSchema` parsing.

## Context and orientation

Simulacat Core is a TypeScript package that serves simulated GitHub REST and
GraphQL APIs from seeded state. These are the files a newcomer needs:

- `src/index.ts` is the public entry point. `simulation(args)` parses
  `args.initialState` with `githubInitialStoreSchema` and starts the foundation
  simulator. It also re-exports the public fixture surface.
- `src/store/entities.ts` defines `githubUserSchema`,
  `githubInitialStoreSchema`, `GitHubStore`, `GitHubInitialStore` (exported as
  `InitialState`), and `convertInitialStateToStoreState`, which turns parsed
  arrays into keyed tables and throws on duplicate keys.
- `src/store/entities/*.ts` hold one Zod schema per entity: `repository.ts`,
  `branch.ts`, `ref.ts`, `commit.ts`, `issue.ts`, `pull-request.ts`,
  `organization.ts`, `installation.ts`, `blob.ts`, `shared.ts`, `defaults.ts`.
  Store keys are `owner/name` (repository), `owner/repo:name` (branch),
  `owner/repo:qualifiedName` (ref), `owner/repo:sha` (commit), `owner/repo#n`
  (issue), and `owner/repo!n` (pull request).
- `src/store/builders.ts` holds the six existing single-entity builders.
- `src/store/actors.ts` parses `x-simulacat-actor` values such as
  `user:alice` and `anonymous`, and resolves them against seeded users.
- `src/store/early-entity-selectors.ts` resolves pull request relations.
- `src/rest/index.ts` serves `GET /user`, `GET /repos/{owner}/{repo}/issues`,
  `.../issues/{n}`, `.../pulls`, `.../pulls/{n}`, `.../git/ref/{ref}`, and
  `.../git/commits/{sha}`. `src/graphql/resolvers.ts` serves `viewer`, `user`,
  `organization`, and `repository`.
- `tests/` holds Bun tests. `tests/cucumber.js` and
  `tests/cross-owner-identity.features.test.ts` load every Gherkin file under
  `features/`; step files are `tests/*.steps.ts`.
  `tests/support/property-test-seed.ts` exports the shared fast-check seed.
- `tests/support/documented-examples.ts`,
  `tests/support/documented-example-execution.ts`, and
  `tests/support/documented-example-observations.ts` execute every
  `tested-example` block in `docs/users-guide.md` against the packed package in
  a temporary consumer project. This is the repository's end-to-end harness for
  the published API.
- `tests/documented-surface.test-d.ts` pins public types; `tsc --noEmit`
  compiles it through `make typecheck`.

Survey used to size the budgets: about 16 test files hand-write `initialState`
literals today; issues, pull requests, refs, and commits are seeded by hand
only in `tests/rest-request-urls.test.ts`. The existing builders are called
about 35 times across 7 test files, all for single-entity unit tests. This task
does not migrate those tests; it gives new tests a better path. Migrating older
tests is optional follow-up work.

Terms used in this plan:

- Actor: the principal a request acts as, selected by the
  `x-simulacat-actor` header (`user:<login>`, `app:<id>`, `installation:<id>`,
  or `anonymous`).
- Handle: a small frozen object returned by the builder that names one seeded
  entity by its canonical coordinates.
- Draft: the scenario object passed to the callback; it accumulates rows and
  allocates identifiers while the callback runs.
- Input-shaped state: an `InitialState` value before Zod parsing applies
  defaults and transforms.
- Property test: a test that checks an invariant over many generated inputs
  (here with fast-check).
- LemmaScript: a toolchain that translates annotated TypeScript into Dafny, a
  verification language whose verifier proves the annotations for all inputs.

## Interfaces and dependencies

New production modules, all under `src/fixtures/`, each under 400 lines:

- `src/fixtures/handles.ts`: handle and input types.

  ```typescript
  export type FixtureUser = Readonly<{kind: 'user'; login: string}>;
  export type FixtureOrganization = Readonly<{kind: 'organization'; login: string}>;
  export type FixtureOwner = FixtureUser | FixtureOrganization;
  export type FixtureBranch = Readonly<{kind: 'branch'; owner: string; repo: string; name: string; sha: string}>;
  export type FixtureRepository = Readonly<{
    kind: 'repository'; owner: string; name: string; defaultBranch: FixtureBranch;
  }>;
  export type FixtureIssue = Readonly<{
    kind: 'issue'; owner: string; repo: string; number: number; author: FixtureUser;
  }>;
  export type FixturePullRequest = Readonly<{
    kind: 'pullRequest'; owner: string; repo: string; number: number;
    author: FixtureUser; base: FixtureBranch; head: FixtureBranch;
  }>;
  ```

  Inputs: `FixtureUserInput` (`login`, optional `name`, `email`);
  `FixtureOrganizationInput` (`login`, optional `name`, `members`);
  `FixtureRepositoryInput` (`owner`, `name`, optional `defaultBranch` name,
  `visibility`, and `attributes` typed as the repository input minus the
  builder-owned keys `owner`, `name`, `id`, `node_id`, `full_name`,
  `default_branch`, timestamps, and URL fields); `FixtureBranchInput`
  (`repository`, `name`, optional `from` branch handle); `FixtureIssueInput`
  (`repository`, `author`, `title`, optional `number`, `state`, `body`);
  `FixturePullRequestInput` (`repository`, `author`, `title`, `head`, optional
  `base` defaulting to the repository's default branch, `number`, `state`,
  `draft`, `body`).
- `src/fixtures/policy.ts`: deterministic values. `fixtureSha(seed)`,
  `createFixtureClock(epoch)`, and `createIdSequence(start)`. Pure apart from
  the `node:crypto` hash.
- `src/fixtures/numbering.ts`: `nextIssueNumber(used: number[]): number` and
  `isNumberAvailable(used: number[], n: number): boolean`, written in the
  LemmaScript subset with `//@ requires` and `//@ ensures` annotations.
- `src/fixtures/integrity.ts`: `findFixtureIntegrityViolations(state)`,
  returning `readonly FixtureIntegrityViolation[]`, a discriminated union on
  `code`. Internal, not exported from the package.
- `src/fixtures/errors.ts`: `FixtureScenarioError` with a `code` field.
- `src/fixtures/scenario.ts`: `buildFixtureScenario` and the draft. If the
  draft approaches 400 lines, split the pull request and branch helpers into
  `src/fixtures/scenario-git.ts`.

  ```typescript
  export type FixtureScenarioOptions = Readonly<{epoch?: string}>;
  export type FixtureScenario<Handles> = Readonly<{initialState: InitialState; handles: Handles}>;
  export type FixtureScenarioDraft = {
    user(input: FixtureUserInput): FixtureUser;
    organization(input: FixtureOrganizationInput): FixtureOrganization;
    repository(input: FixtureRepositoryInput): FixtureRepository;
    branch(input: FixtureBranchInput): FixtureBranch;
    issue(input: FixtureIssueInput): FixtureIssue;
    pullRequest(input: FixturePullRequestInput): FixturePullRequest;
  };
  export const buildFixtureScenario: <Handles>(
    compose: (scenario: FixtureScenarioDraft) => Handles,
    options?: FixtureScenarioOptions
  ) => FixtureScenario<Handles>;
  ```

- `src/fixtures/actor-headers.ts`: `anonymousFixtureActor` and
  `actorHeaders(actor)`, returning
  `Readonly<Record<'x-simulacat-actor', string>>`.
- `src/fixtures/index.ts`: the feature's internal barrel, re-exported by name
  (no wildcard) from `src/index.ts`.

Public additions to `src/index.ts`: `buildFixtureScenario`, `actorHeaders`,
`anonymousFixtureActor`, `FixtureScenarioError`, and the handle, input, option,
and result types. These are pre-1.0 additions with no compatibility obligations.

Dependencies: add `lemmascript` `^0.6.10` as a development dependency for
`EP-M5` only. No runtime dependency changes. `fast-check` `^4.9.0` is already
present.

## Plan of work

Each milestone is a coherent plateau: it ends with every gate green, a commit,
and an updated `Progress` entry. Do not start the next milestone while the
current one is red.

### `EP-M0` Baseline

Run the four gates on the untouched branch and record their result in
`Artefacts and notes`. A pre-existing failure is recorded with evidence and
reported before any code change; it is not silently waived.

- Acceptance: all four gates pass, or failures are recorded with a cause.
- Recovery: none needed; no code changes.

### `EP-M1` Entity schema idempotence

Outcome: every entity schema and `githubInitialStoreSchema` are idempotent, so
existing `build*Fixture` output can be fed back into `initialState` safely.

Red: add `tests/entity-schema-idempotence.test.ts` with one fast-check property
per schema and named ref examples. Run it; expect the ref property and the
`refs/heads/main` example to fail, reporting `qualifiedName` `refs/heads/main`
where `main` was expected.

Green: in `src/store/entities/ref.ts`, derive the stored `qualifiedName` by
stripping a leading `refs/heads/` or `refs/tags/` from `ref ?? qualifiedName`,
and derive the full `ref` from the raw value (kept as is when it starts with
`refs/`, prefixed otherwise). Update the schema's JSDoc to describe the rule.
Add a named regression example to `tests/entities.test.ts` for an input whose
`ref` is `refs/heads/main`, asserting the key `owner/repo:main`.

Refactor: extract `stripRefNamespace` as a small named helper if the transform
grows beyond one conditional.

- Requirements: `MOCK-KEYS`; supports `C2` and `C3`.
- Acceptance: `INV-1` green; all existing tests green.
- Conformance check: no public signature changed; behaviour changed only for
  fully qualified `ref` inputs, which is recorded in `CHANGELOG.md` in `EP-M6`.
- Recovery: revert the single commit.
- Remaining gaps: none for this obligation.

### `EP-M2` Pure fixture policy core

Outcome: tested, pure building blocks for deterministic values, number
allocation, and integrity checking, with no public exports yet.

Red: add `tests/fixture-numbering.test.ts` (named examples plus the `INV-3`
model property), `tests/fixture-policy.test.ts` (SHA format is 40 lowercase hex
characters and stable for equal seeds; the clock is strictly increasing;
sequences are strictly increasing), and `tests/fixture-integrity.test.ts` (one
negative control per violation code plus a valid hand-written state that yields
`[]`). Run them; expect module-not-found failures.

Green: implement `src/fixtures/policy.ts`, `src/fixtures/numbering.ts`,
`src/fixtures/integrity.ts`, and `src/fixtures/errors.ts`.

Refactor: keep each function under the Biome and Oxlint limits (70 lines, four
parameters, cognitive complexity 8, nesting depth 3). Prefer lookup tables over
nested conditionals in the integrity checker: one small rule function per
violation code, combined with `flatMap`.

- Requirements: `MOCK-CLOCK`, `MOCK-KEYS`, `DEV-TEST`.
- Acceptance: the three suites pass; `INV-3` property passes 500 runs.
- Conformance check: `src/fixtures/` imports nothing forbidden by `C1`.
- Recovery: modules are new and unexported, so reverting is safe.

### `EP-M3` Scenario builder and actor headers

Outcome: `buildFixtureScenario`, the handles, and `actorHeaders` are published
from `src/index.ts`, with unit, property, type-level, and boundary tests.

Red: add `tests/fixture-scenario.test.ts` with named examples:

1. A user, an organization with that user as member, an organization-owned
   repository, and a user-owned repository build into a state that
   `githubInitialStoreSchema` and `convertInitialStateToStoreState` accept,
   with the member's `organizations` listing the organization.
2. A repository seeds its default branch, `refs/heads/main` ref, and root
   commit with one SHA; a `defaultBranch: 'trunk'` option is honoured.
3. A branch started from `main` gets a fresh commit whose parent is the main
   tip.
4. An issue then a pull request get numbers 1 and 2; an explicit issue
   number 10 followed by an omitted pull request number yields 11.
5. A pull request seeds a backing issue row with the same number and an
   empty `pull_request` marker; its `base` defaults to the default branch.
6. Unhappy paths, each asserting `FixtureScenarioError` and its `code`:
   duplicate user login; duplicate repository `owner/name`; a handle from
   another scenario (`unknown-reference`); an explicit number already used
   (`invalid-number`); a non-positive number (`invalid-number`); a pull request
   whose head is its base (`invalid-pull-request`); a base branch from another
   repository (`invalid-pull-request`); an empty title (`schema`, with the Zod
   error as `cause`).

Add `tests/fixture-scenario-properties.test.ts` (`INV-2`, `INV-4`),
`tests/fixture-determinism.test.ts` (`INV-5`),
`tests/fixture-actor-headers.test.ts` (`INV-6`),
`tests/fixture-boundaries.test.ts` (`INV-7`), and
`tests/fixture-scenario.test-d.ts`, which pins the exported types and uses
`@ts-expect-error` to prove that an organization handle cannot be an issue
author and that `attributes` rejects builder-owned keys. Run them; expect
missing-export failures.

Green: implement `src/fixtures/handles.ts`, `src/fixtures/scenario.ts`,
`src/fixtures/actor-headers.ts`, and `src/fixtures/index.ts`, and export them
from `src/index.ts`. `buildFixtureScenario` runs the callback against a fresh
draft, assembles the input-shaped state, runs `findFixtureIntegrityViolations`,
parses a copy with `githubInitialStoreSchema` and converts it with
`convertInitialStateToStoreState` (wrapping any thrown error as
`FixtureScenarioError` with `code: 'schema'` or `'duplicate'` and the original
as `cause`), then returns the unparsed state and frozen handles.

Refactor: split `scenario.ts` if it nears 400 lines; check that each draft
method validates its handles through one shared lookup helper rather than
repeating checks.

- Requirements: `RM-1.3.2`, `MOCK-SEED`, `API-FIX`, `C1` to `C8`.
- Acceptance: all new suites pass; `make typecheck` compiles the type test;
  `make docs-check` reports zero TypeDoc warnings for the new exports.
- Conformance check: one validation path (`C2`); no store actions added
  (`C8`); no authorization semantics (`C4`).
- Recovery: revert the milestone commits; `EP-M2` remains a valid plateau.

### `EP-M4` Behavioural and end-to-end acceptance

Outcome: the scenario builder is proven through real HTTP against a running
simulator and through the packed package in a consumer project.

Red: add `features/actor-aware-fixtures.feature` (below) and
`tests/actor-aware-fixtures.steps.ts`. Run `bun test tests`; expect
undefined-step failures for the new feature, which proves the feature is loaded
(`R7`). Then add the `actor-aware-fixture-scenario` example to
`docs/users-guide.md` with its `tested-example` marker; expect the
documentation inventory test to fail because no handler exists.

Green: implement the steps by building a scenario, starting
`simulation({initialState}).listen(0)`, and issuing requests with
`actorHeaders`. Register the example's handler in
`tests/support/documented-example-execution.ts` and its JSON contract in
`tests/support/documented-example-observations.ts` and
`tests/support/documented-example-contracts.ts`. The example builds a scenario,
starts the simulator, fetches `/user` as alice and
`/repos/acme/widgets/pulls/2`, prints both as JSON, and closes the server.

Proposed feature text, at `features/actor-aware-fixtures.feature`:

```gherkin
@actor-aware-fixtures
Feature: Actor-aware fixture scenarios seed coherent, attributable state

  Background:
    Given a simulator seeded from a fixture scenario where user "alice" is a member of organization "acme"
    And organization "acme" owns repository "widgets" with branch "feature/login"
    And "alice" opened issue "Login fails" and pull request "Fix login" from "feature/login" in "acme/widgets"

  Scenario: The fixture actor is the authenticated user
    When the client requests GraphQL viewer as fixture actor "alice"
    Then the viewer login is "alice"
    And REST "/user" as fixture actor "alice" returns login "alice"

  Scenario: Anonymous requests are not authenticated
    When the client requests REST "/user" as the anonymous fixture actor
    Then the response status is 401

  Scenario: Issues and pull requests share the repository number sequence
    Then REST issue 1 in "acme/widgets" has title "Login fails" and author "alice"
    And REST pull request 2 in "acme/widgets" has title "Fix login" and author "alice"
    And REST issues in "acme/widgets" include numbers 1 and 2

  Scenario: Pull request refs resolve to the seeded branches
    Then REST pull request 2 in "acme/widgets" has head ref "feature/login"
    And the head SHA of pull request 2 equals the SHA of ref "heads/feature/login"
    And the base SHA of pull request 2 equals the SHA of ref "heads/main"

  Scenario: Fixture-built repositories accept writes through the shared action
    When the client PATCHes repository "acme/widgets" with description "Seeded by scenario"
    Then GraphQL repository "acme/widgets" has description "Seeded by scenario"
```

Reuse existing step phrases from `tests/shared-domain-writes.steps.ts` where
the wording already matches; the plan does not require identical wording if
reuse would couple step files.

- Requirements: `RM-1.3.2-S`, `ARCH-SEAMS`, `API-FIX`.
- Acceptance: `make test` passes, including the new feature and the new
  documentation example run against the packed package.
- Conformance check: the example uses only names exported from the package
  root.
- Recovery: revert the milestone commits; `EP-M3` remains a valid plateau.

### `EP-M5` LemmaScript proof of number allocation

Outcome: `L1` and `L2` are machine-checked for all inputs.

Steps: add `lemmascript` as a development dependency with
`bun add -d lemmascript@^0.6.10`; add `LemmaScript-files.txt` listing
`src/fixtures/numbering.ts`; generate with
`bunx lsc gen --backend=dafny src/fixtures/numbering.ts`; add the minimal loop
invariants and lemma calls to the generated `src/fixtures/numbering.dfy`
(additions only, per LemmaScript's contract); add a `prove` Makefile target
that runs `bunx lsc check --backend=dafny`; validate the Makefile with
`mbake validate Makefile`.

Red: before adding loop invariants, `make prove` must fail with Dafny reporting
that a postcondition could not be proved. That is the expected red state for a
proof milestone.

Green: `make prove` reports all obligations verified, zero errors.

Non-vacuity, recorded in `Artefacts and notes`: apply the `max` mutation
described under `INV-3` to a scratch copy, run `lsc check`, observe the
failure, and discard the copy. Inspect the `.dfy` file for any `assume`,
`{:axiom}`, or added `axiom`; there must be none.

- Requirements: `INV-3`.
- Acceptance: `make prove` passes, plus the four standard gates.
- Conformance check: the dependency added is exactly `lemmascript`.
- Recovery: if `R4` materializes, stop under the tolerance rule, record the
  attempts, and ask whether to ship `EP-M6` with the fast-check property as the
  recorded substitute.

### `EP-M6` Documentation and delivery closure

Update, keeping each change minimal and evidence-based:

- `docs/users-guide.md`: a "Composing actor-aware fixture scenarios" section
  around the tested example, the actor-header helper, the shared numbering
  rule, the determinism guarantee, and the error codes.
- `docs/developers-guide.md`: the `src/fixtures/` boundary and fitness test,
  the integrity oracle, `make prove`, and guidance to prefer the scenario
  builder in new tests.
- `docs/api-reference.md`: the new exports and the ref-normalization rule.
- `docs/architecture.md`: the fixtures module's place between the entity
  schemas and the `simulation()` composition root.
- `docs/repository-layout.md`: `src/fixtures/` and `LemmaScript-files.txt`.
- `docs/contents.md`: link this plan.
- `CHANGELOG.md`: an entry under the unreleased `0.6.5` heading.
- `docs/roadmap.md`: mark 1.3.2 done with a one-line "Delivered:" note, as
  1.3.1 does.

Search for stale claims with
`rg -n "buildRepositoryFixture|fixture builders|qualifiedName" docs README.md
--glob '!docs/execplans/**'`
and reconcile each hit. Then run every gate, including `make markdownlint`,
`make nixie`, and `make spelling`.

- Acceptance: all gates pass; roadmap entry checked.
- Conformance check: reconcile every discovery against `Conformance basis`;
  set `Status: COMPLETE` only when no deviation is unrecorded.

## Concrete steps

Working directory: the repository root of this worktree. Use `pipefail` so a
failed gate cannot appear to pass through `tee`.

```bash
set -o pipefail
BRANCH=$(git branch --show-current)
make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-$BRANCH.out
make typecheck 2>&1 | tee /tmp/typecheck-simulacat-core-$BRANCH.out
make lint 2>&1 | tee /tmp/lint-simulacat-core-$BRANCH.out
make test 2>&1 | tee /tmp/test-simulacat-core-$BRANCH.out
```

Documentation milestones add, in order:

```bash
make docs-check 2>&1 | tee /tmp/docs-check-simulacat-core-$BRANCH.out
make markdownlint 2>&1 | tee /tmp/markdownlint-simulacat-core-$BRANCH.out
make nixie 2>&1 | tee /tmp/nixie-simulacat-core-$BRANCH.out
make spelling 2>&1 | tee /tmp/spelling-simulacat-core-$BRANCH.out
```

`EP-M5` adds:

```bash
make prove 2>&1 | tee /tmp/prove-simulacat-core-$BRANCH.out
```

Focused red and green runs, by milestone:

```plaintext
EP-M1 red:   bun test tests/entity-schema-idempotence.test.ts -> ref property fails (refs/heads/main != main)
EP-M1 green: same command -> all pass
EP-M2 red:   bun test tests/fixture-numbering.test.ts tests/fixture-policy.test.ts \
               tests/fixture-integrity.test.ts -> cannot find module
EP-M2 green: same command -> all pass
EP-M3 red:   bun test tests/fixture-scenario.test.ts -> buildFixtureScenario is not exported
EP-M3 green: bun test tests/fixture-*.test.ts -> all pass; make typecheck -> 0 errors
EP-M4 red:   bun test tests -> undefined steps for @actor-aware-fixtures; documentation inventory mismatch
EP-M4 green: make test -> all pass
EP-M5 red:   make prove -> a postcondition could not be proved
EP-M5 green: make prove -> all obligations verified, 0 errors
```

Gates run sequentially, never in parallel with each other for this worktree.
Commit after each green plateau with a message in the imperative mood that
names the milestone, for example "Make entity schemas idempotent (1.3.2)".

## Validation and acceptance

The work is accepted when all of the following hold:

1. `make check-fmt`, `make typecheck`, `make lint`, and `make test` pass at
   every milestone boundary; `make docs-check`, `make markdownlint`,
   `make nixie`, and `make spelling` pass at `EP-M6`; `make prove` passes at
   `EP-M5` and `EP-M6`.
2. `features/actor-aware-fixtures.feature` passes, and each of its scenarios
   was observed failing (undefined steps) before the steps existed.
3. The `actor-aware-fixture-scenario` users-guide example runs against the
   packed package and prints JSON whose `/user` login is `alice` and whose pull
   request number is `2` with head ref `feature/login`.
4. `tests/entity-schema-idempotence.test.ts` failed on the ref schema before
   `EP-M1` and passes after it.
5. Each invariant in the `Verification plan` has its recorded non-vacuity
   evidence in `Artefacts and notes`.
6. `docs/roadmap.md` marks 1.3.2 done.

## Idempotence and recovery

Every step is re-runnable. Gates are read-only apart from `/tmp` logs, and
`make typecheck` regenerates GraphQL types deterministically. `bun add -d` is
idempotent. `lsc gen` regenerates `.dfy.gen` files; never overwrite a
hand-edited `.dfy` with generated output except through `lsc regen`, which
merges. Each milestone is one or more commits on this branch, so a failed
milestone is rolled back with `git revert` of its commits without touching
earlier plateaus. Scratch probes live under `/tmp/scratch-1-3-2/` and are never
committed.

## Artefacts and notes

Baseline gate results, red and green transcripts, property classification
statistics, mutation-control results, and proof outputs are recorded here as
each milestone completes.

## Signposted documentation and skills

Read before starting:

- `AGENTS.md` for code style, file size, commit, and gate rules.
- `docs/developers-guide.md` §Linting rules and §Testing expectations.
- `docs/architecture.md` §State model and §Extension seams.
- `docs/api-reference.md` §Exported fixture schemas.
- `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §5, §6, §9, and §25.
- `docs/complexity-antipatterns-and-refactoring-strategies.md` for the
  bumpy-road and command/query guidance.
- `docs/execplans/1-3-1-shared-domain-actions-for-write-behaviour.md` for the
  write spine the final scenario exercises.

Skills to load during implementation:

- `execplans` to keep this document current.
- `hexagonal-architecture` for the `src/fixtures/` boundary: protect it with
  the fitness test rather than transplanting a full ports-and-adapters layout.
- `typescript-router`, then `typescript-types-and-apis` (handle and input
  types, `@ts-expect-error` tests), `typescript-data-and-state` (immutable
  handles and deterministic transitions), `typescript-errors-and-outcomes`
  (`FixtureScenarioError` and the violation union), and `typescript-testing`.
- `fast-check` for the model-based and round-trip properties.
- `typescript-verification` and `lemmascript` for `EP-M5`.
- `biome-typescript` and `typescript-quality-tools` when a lint rule fires.
- `codegraph-mcp` for callers and impact analysis before touching
  `src/store/entities/ref.ts` and `src/index.ts`.
- `en-gb-oxendict-style` for documentation, and `commit-message` for
  commits.

## Revision note

2026-11-15: initial draft, written after Wyvern reconnaissance, prior-art
research, and a scratch probe that found the ref re-parse defect. Pending
community-of-experts review and user approval.
