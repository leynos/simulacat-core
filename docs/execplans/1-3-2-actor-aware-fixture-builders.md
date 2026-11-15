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
Today a test author seeds that state by handwriting an `initialState` object
literal and passing it to `simulation({initialState})`. Every test repeats the
same `users`, `organizations`, `repositories`, `branches`, and `blobs` arrays,
and nothing checks that the pieces agree with each other. An issue can name an
author who was never seeded. A pull request can name a head SHA that has no
commit row (`tests/rest-request-urls.test.ts` lines 66-74 does exactly this). A
branch row and its `refs/heads/...` ref row can carry different SHAs. Many
schema defaults are drawn from Faker (a random fake-data library), so two runs
of the same test produce different SHAs, timestamps, emails, and identifiers,
even for state the test never mentions, such as the GitHub App installation the
schema invents for every organization.

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
  const feature = scenario.branch({repository: widgets, name: 'feature/login', author: alice});
  const bug = scenario.issue({repository: widgets, author: alice, title: 'Login fails'});
  const fix = scenario.pullRequest({repository: widgets, author: alice, title: 'Fix login', head: feature});
  return {alice, widgets, bug, fix};
});

const app = simulation({initialState});
// GET /user with actorHeaders(handles.alice) returns login "alice".
// GET /repos/acme/widgets/issues/1 returns user.login "alice".
// GET /repos/acme/widgets/pulls/2 returns head.ref "feature/login".
```

Before the simulator starts, the builder guarantees four things. Every actor
named by a fixture (repository owner, organization member, issue author, pull
request author, commit author) is seeded. Issues and pull requests share one
number sequence per repository, as on GitHub. Every branch and tag has a
matching ref row and commit row with the same SHA. Building the same scenario
twice yields identical state, both before and after the simulator's own schema
parse. The handles it returns carry canonical coordinates (login, `owner/name`,
number, branch name) and can be turned into request headers that select that
actor through the existing `x-simulacat-actor` header.

Observable success: the new Gherkin feature
`features/actor-aware-fixtures.feature` starts a real simulator from a built
scenario and proves, over HTTP, that GraphQL `viewer`, REST `/user`, REST issue
and pull request reads, and REST ref reads all agree with the handles. A new
users-guide example installs the packed package into a throwaway consumer,
type-checks it against the published declarations, and runs it. An existing
hand-seeded test is migrated to the builder as an ergonomics check.

## Constraints

Hard invariants. Violating any of them requires escalation, not a workaround.

- `C1` Boundary direction. Modules under `src/fixtures/` may directly import
  only: other `src/fixtures/` modules; `src/store/entities.ts`,
  `src/store/entities/*.ts`, and `src/store/keys.ts` (schemas, types, and key
  helpers); type-only imports and the exported header constants from
  `src/store/actors.ts`; `zod`; and `node:crypto`. They must not directly import
  `express`, `starfx`, `@simulacrum/foundation-simulator`, `@faker-js/faker`,
  or anything under `src/rest/`, `src/graphql/`, `src/middleware/`, or
  `src/store/actions/`. The rule covers direct imports only:
  `src/store/entities.ts` itself imports Faker and the foundation simulator,
  which is acceptable because the builder never reaches the randomized defaults
  (`C6`). A fitness test enforces the allow-list (`EP-M3`).
- `C2` One validation path. Built state is validated by the same
  `githubInitialStoreSchema` and `convertInitialStateToStoreState` that
  `simulation()` uses, so a scenario that builds is a scenario that seeds.
  Because `convertInitialStateToStoreState` silently overwrites duplicate
  users, organizations, and installations (it uses the foundation package's
  `convertObjToProp`), the builder also performs its own duplicate checks.
- `C3` Input-shaped output. `buildFixtureScenario` returns `initialState` in
  the input shape (`InitialState`), not the parsed shape, so the simulator
  parses it exactly once.
- `C4` No authorization semantics. Actor-awareness means representation and
  referential integrity only. No permission checks, token validation,
  collaborator lattices, or actor-derived `permissions` fields. Those belong to
  roadmap items 4.3 and 9.5.2 (`docs/architecture.md` lines 186-188,
  `docs/developers-guide.md` lines 424-427 and 478-485). Builder inputs must
  not accept `permissions`.
- `C5` No silent actor defaults. The builder never defaults a repository
  owner, organization member, issue author, or pull request author to a seeded
  user or to the schema's `octocat` fallback. Every attributable entity takes
  an explicit handle. Commit authorship is a Git identity rather than a request
  actor: when `author` is omitted, commits use the schema's neutral
  `Simulacat Author` identity, which is not a seeded user.
- `C6` No hidden randomness. Neither building nor the simulator's subsequent
  `githubInitialStoreSchema.parse` of the built state may reach any
  Faker-backed default. The builder supplies every such field explicitly,
  including one installation row per organization.
- `C7` No URL synthesis. The builder never populates URL fields; URLs stay
  request-time projections (`docs/api-reference.md` lines 233-242).
- `C8` No new store actions, and no pull request issue twins. This task adds
  no create actions for any entity (roadmap phases 3 and 8), and does not seed
  backing issue rows for pull requests (roadmap 3.3.1 owns the
  issue-to-pull-request link). Fixtures seed through `initialState`; post-start
  mutation continues to use the existing `updateRepository` spine.
- `C9` Existing behaviour preserved. Existing tests and the six existing
  `build*Fixture` exports keep their contracts, except for the documented
  ref-normalization fix in `EP-M1`.
- `C10` Repository conventions. No source file exceeds 400 lines. Exported
  functions do not destructure parameters in their signatures
  (`docs/developers-guide.md` lines 109-117) and carry `@param`, `@returns`,
  `@throws`, and `@example` JSDoc where applicable. Biome, Oxlint (including
  `unicorn`, `deslop`, and the local `df12` rules), and the TypeDoc
  zero-warning gate must pass with no new suppressions or baseline entries.
  Optional input fields are declared `?: T | undefined` because
  `exactOptionalPropertyTypes` is enabled.
- `C11` Zod major version. The package uses `zod` `^3.25.76`. Do not use
  Zod 4 only APIs.
- `C12` No new package dependencies. `lemmascript` is invoked through
  `bunx --package lemmascript@0.6.10` from `make prove`; it is not added to
  `package.json` or `bun.lock`, because its dependency tree (`ts-morph`,
  `claimcheck`, and three cloud SDKs) would enter the audited CI install.

## Tolerances (exception triggers)

ExecPlan files are excluded from every count below. Counts compare the branch
with its merge base on `main`
(`git diff --numstat $(git merge-base HEAD origin/main)`) and measure net lines
(additions minus deletions) per category. Generated `.dfy.gen` files and the
regenerated `typos.toml` are excluded from line counts; hand-maintained `.dfy`
proof files count as code.

Categories are assigned by purpose:

- Code: `src/**`, `tests/**`, `features/**`, `tools/**`, and proof sources.
- Configuration: `package.json`, `Makefile`, `LemmaScript-files.txt`,
  `tsconfig.json`, `biome.json`, `.oxlintrc*`, `typos.local.toml`, and
  `.github/workflows/**`.
- Documentation: `docs/**` except `docs/execplans/**`, `README.md`, and
  `CHANGELOG.md`.

Historical evidence, measured with `git show --numstat` and the same
classification: 1.1.2 (`c47de65`) changed 24 code files for +2,035/-110; 1.2.2
(`79b51f3`) changed 17 code files for +835/-157; 1.3.1 (`b42475f`) changed 28
code files for +3,012/-1,037; 1.4.1 (`4ce19bd`) changed 40 code files for
+2,907/-371. Documentation ran +122 to +359 lines per task, and configuration
never exceeded +3 lines. No earlier plan recorded a budget increase in its
revision history; 1.2.2 used its file budget as a scope lever to defer a
GraphQL hook. Those plans set budgets of 500 to 1,200 net source lines yet
delivered larger totals once tests were counted, so this plan counts tests
explicitly.

Budgets for this task:

- Code: at most 2,800 net lines and 36 files. Estimate: about 950 lines of
  production source across 14 new or changed files (`src/fixtures/*`,
  `src/store/entities/ref.ts`, `src/store/entities/ref-name.ts`,
  `src/graphql/converters/repository.ts`, `src/index.ts`); about 1,500 lines of
  tests across 14 files; about 200 lines of hand-maintained Dafny proof. The
  migration of `tests/rest-request-urls.test.ts` is roughly line-neutral.
  Contingency is roughly 10%.
- Configuration: at most 60 net lines and 4 files (`Makefile` `prove`
  target, `LemmaScript-files.txt`, a `prove` job in `.github/workflows/ci.yml`,
  and possibly `typos.local.toml`).
- Documentation: at most 500 net lines and 10 files.

Other triggers:

- Any category budget exceeded: stop and escalate. Spare capacity in one
  category does not offset another.
- `EP-M0` spike shows that `lsc gen --backend=dafny` rejects either proof
  module: stop and record the rejection before choosing a fallback.
- `make prove` cannot verify an obligation after three focused attempts, or
  closing it needs an `assume`, `{:axiom}`, or added axiom: stop and record the
  options. Do not weaken a specification to make it pass.
- Any change needed to `src/store/actors.ts` (954 lines, already over the
  400-line limit) beyond importing its exports: escalate.
- Any change to the signature or behaviour of an existing public export
  other than the `EP-M1` ref fix: escalate.
- Any new `package.json` dependency, or a CI action that cannot be pinned to a
  full commit SHA: escalate.
- The `make test` wall time grows by more than 30 seconds over the `EP-M0`
  baseline: stop and tune property run counts before continuing.
- A gate fails three times for the same root cause after fixes: escalate.

## Risks

- `R1` The ref fix changes keys for some existing inputs. Inputs whose `ref`
  is already fully qualified (`refs/heads/main`) move from key
  `owner/repo:refs/heads/main` to `owner/repo:main`, which is what the REST and
  GraphQL lookups already expect. Inputs `refs/heads/v1` and `refs/tags/v1` in
  the same repository now collide on key `owner/repo:v1`, as the short names
  `v1` already did. Mitigation: named examples pin both cases, `CHANGELOG.md`
  gets a "Changed" entry with migration text, and the builder reports the
  collision as `FixtureScenarioError` code `duplicate`.
- `R2` LemmaScript is a tech preview (0.6.10 at planning time), and its
  installed skill documents 0.5.22. Mitigation: `EP-M0` spikes `lsc gen` on
  both planned proof modules before any budget is committed; the version is
  pinned exactly; the fast-check properties for the same obligations land
  regardless of the proof outcome.
- `R3` The proof could go stale outside CI. Mitigation: a dedicated `prove`
  CI job installs Dafny and runs `make prove`, off the critical `verify` path;
  `make prove` also regenerates `.dfy.gen` and fails on drift.
- `R4` Step-phrase collisions. Cucumber step definitions are global
  (`test-plugins.ts`), so a new phrase that matches an existing one ambiguously
  breaks every feature. Mitigation: reuse existing phrases verbatim where they
  mean the same thing, otherwise prefix new phrases with "fixture", and run the
  whole suite at the `EP-M4` red step.
- `R5` The docs-example harness is at its size limit:
  `tests/support/documented-example-execution.ts` is 392 lines and one more
  example adds about 7. Mitigation: the first commit of `EP-M4` splits its
  handler table into its own module as an atomic refactor.
- `R6` Property-test cost. Each model run builds, checks, parses, and
  converts a whole state twice. Mitigation: commands are capped at 25 per run,
  references are index-based so shrinking works, and the `EP-M0` wall-time
  baseline backs the tolerance above.
- `R7` Order-dependent identifiers. The logical clock and id sequences
  advance per created entity, so inserting an entity early in a callback shifts
  later timestamps and ids. Mitigation: SHAs are derived from canonical
  coordinates rather than order; clock and id order dependence is documented,
  and snapshot tests use stable scenarios.

## Progress

- [x] (2026-11-15) Renamed the branch to `1-3-2-actor-aware-fixture-builders`.
- [x] (2026-11-15) Reconnaissance with a Wyvern team: documentation
  constraints, current fixture patterns, public surface, and plan history.
- [x] (2026-11-15) Prior-art research (fishery factories, LemmaScript subset
  and toolchain, `bunx --package`).
- [x] (2026-11-15) Confirmed the ref re-parse defect with a scratch probe.
- [x] (2026-11-15) Drafted this ExecPlan.
- [x] (2026-11-15) Community-of-experts design review (three panels:
  structure and contracts; alternatives and developer experience; failure modes
  and verification). Verdict: proceed with conditions.
- [x] (2026-11-15) Revised the plan to address every finding (see
  `Decision log` and `Revision note`).
- [ ] User approval.
- [ ] `EP-M0` Baseline gates and LemmaScript spike.
- [ ] `EP-M1` Ref-name normalization and schema idempotence.
- [ ] `EP-M2` Pure fixture policy core.
- [ ] `EP-M3` Scenario builder and actor headers.
- [ ] `EP-M4` Behavioural, end-to-end, and migration acceptance.
- [ ] `EP-M5` Proofs and the `prove` gate.
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
  gets a silently broken ref. `EP-M1` fixes this.
- Observation: `githubInitialStoreSchema` invents an installation for every
  organization that lacks one (`src/store/entities.ts` lines 141-152), and the
  installation schema then draws `created_at` and `updated_at` from Faker
  (`src/store/entities/installation.ts` lines 12 and 48-75). So input-shaped
  determinism is not enough: the design review caught that the first draft's
  determinism check would have passed while the running store stayed random.
  The builder now seeds installations explicitly.
- Observation: `convertInitialStateToStoreState` rejects duplicate keys for
  repositories, branches, refs, commits, issues, and pull requests, but uses
  the foundation package's `convertObjToProp` for users, organizations, and
  installations, which silently keeps the last row.
- Observation: `src/graphql/converters/repository.ts` line 38
  (`normalizeRefLookup`) and `src/rest/utils.ts` line 5 (`normalizeGitRefPath`)
  each strip ref namespaces with their own regular expression. The REST helper
  strips `heads/` and `tags/` (URL path form); the GraphQL helper strips
  `refs/heads/` and `refs/tags/`, which is the rule the fixed schema needs.
- Observation: GraphQL `repository.issue` and `repository.issues`
  (`src/graphql/converters/repository.ts` lines 173-180) do not filter pull
  requests, and REST issue projection (`src/urls/issue.ts` lines 14-16) never
  fills the nested `pull_request` links. Seeding backing issue rows for pull
  requests would therefore surface pull requests as GraphQL `Issue` nodes. The
  first draft proposed those rows; the revision drops them (`C8`).
- Observation: `lemmascript@0.6.10` depends on `ts-morph` and
  `lemmascript-claimcheck`, which depends on `claimcheck`, which depends on
  `@anthropic-ai/sdk`, `@anthropic-ai/vertex-sdk`, and
  `@anthropic-ai/bedrock-sdk` (checked with `npm view` on 2026-11-15).
- Observation: LemmaScript's Dafny backend models `number` as a mathematical
  integer and supports string `startsWith` and `slice`, array `includes`, and
  discriminated unions (`SUBSET.md`, fetched 2026-11-15). It does not list
  `Number.isSafeInteger`, so integer and range guards stay outside the proven
  functions or are expressed as explicit comparisons.
- Observation: `src/store/actors.ts` is 954 lines and not exported from
  `src/index.ts`. The builder needs only its header constant and actor types.
- Observation: `podbot-design.md`, named in the task brief, does not exist in
  this repository. It is recorded as absent in `Conformance basis`.

## Decision log

- Decision: define "actor-aware" as (a) every attributable fixture takes an
  explicit actor handle instead of a login string, (b) the builder proves every
  referenced actor is seeded, and (c) a handle converts into the request header
  that selects that actor. Rationale: no repository document defines the term;
  this satisfies the roadmap success criterion without the authorization
  semantics that `C4` forbids. The design review judged the definition sound.
  Date: 2026-11-15.
- Decision: keep the draft-callback builder,
  `buildFixtureScenario((scenario) => handles, options?)`. Alternatives
  considered:
  1. A persistent immutable builder, where each call returns a new builder.
     Rejected: capturing handles such as auto-assigned numbers is awkward.
  2. Free functions composed afterwards. Rejected: shared per-repository
     numbers cannot be allocated until composition, so a test cannot know the
     number it asserts on.
  3. A declarative data spec, `defineScenario({...})`, with references by
     caller-chosen labels. This is the strongest alternative: it is
     JSON-serializable, which would suit scenario routes (mocking guide §23)
     and recipe data files (roadmap 9.2.1). Rejected for now: references
     become untyped strings and allocation order becomes implicit. Kept open:
     handles remain plain coordinate data, so a later `scenarioFromSpec` can
     be a thin layer over the same planners.
  4. Seeding through store actions after start. Rejected: blocked by `C8`,
     and it would make every fixture asynchronous.
  Date: 2026-11-15.
- Decision: implement each entity's rules as a pure planner over input-shaped
  tables (`planBranch(tables, input, policy)` returns rows and a handle, or
  violations), with the composer as a thin accumulator. The pure rules (number
  allocation, ref-name normalization, and branch/ref/commit coherence) are the
  "one domain path" that roadmap step 1.3 asks about. The create reducers in
  roadmap 3.1.1 and 8.1.1 should reuse these rules rather than re-derive them.
  Rationale: this answers the step's question without adding actions (`C8`).
  Date: 2026-11-15.
- Decision: return input-shaped `initialState`, validated once through
  `githubInitialStoreSchema` and `convertInitialStateToStoreState`, plus the
  builder's own duplicate and integrity checks. Rationale: `C2`, `C3`, and the
  silent-overwrite discovery. Date: 2026-11-15.
- Decision: handles are frozen, type-branded coordinate records. Runtime
  lookup is by canonical coordinates, never by object identity: a handle whose
  coordinates are not seeded in this scenario is an `unknown-reference`, and
  two handles with the same coordinates name the same entity. Handles carry no
  mutable facts such as branch tip SHAs; tips are read after the build with
  `scenarioBranchSha`. The composer is locked once the callback returns, and a
  callback that returns a promise is rejected. Rationale: the review found
  identity tracking contradicts spreading handles, and stored SHAs would go
  stale once phase 3 adds commits. Date: 2026-11-15.
- Decision: issues and pull requests share one per-repository number
  sequence. An omitted number is one more than the largest number used so far
  (or 1); an explicit number must be an unused integer in `[1, 2147483647]`,
  the GraphQL `Int` range. Pull requests do not get backing issue rows (`C8`).
  Rationale: GitHub's observable numbering, with the issue-link design left to
  roadmap 3.3.1. Date: 2026-11-15.
- Decision: every branch seeds a branch row (`protected: false`, GitHub's
  default, set explicitly), a `refs/heads/<name>` ref row, and a commit row,
  all sharing one SHA. A repository seeds its default branch with a root
  commit. A new branch gets a fresh commit whose parent is the tip of its
  `from` branch (default: the repository's default branch), so a pull request's
  head and base differ. A fork (`repository({forkOf})`) sets `fork: true` and
  copies the parent's default-branch ancestry into the fork, so fork pull
  requests share history. `scenario.tag` seeds a lightweight `refs/tags/<name>`
  ref at a branch tip. `scenario.blob` seeds a blob with explicit content.
  Rationale: removes the most common source of empty relations and covers refs,
  which the roadmap names. Date: 2026-11-15.
- Decision: deterministic values come from a scenario-local policy, not
  Faker. SHAs are the SHA-1 of a seed derived from the entity's canonical
  coordinates (for example `commit:acme/widgets:feature/login:1`), so adding
  unrelated entities does not change them. A logical clock starts at
  `2024-01-01T00:00:00.000Z` (overridable through `options.epoch`) and advances
  one second per created entity. Users and organizations share one account id
  sequence, because GitHub accounts share an id space; repository, issue, pull
  request, and installation ids come from scenario-local sequences. Clock and
  id order dependence is documented. Rationale: `C6`, stable snapshots, no
  module-global counters. Date: 2026-11-15.
- Decision: logins must match GitHub's account-name form,
  `^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$`, and duplicates are detected
  case-insensitively across users and organizations together. Rationale: GitHub
  logins are case-insensitive and share one namespace; the pattern also keeps
  header values free of whitespace and control characters, so a handle's login
  always equals the seeded login. Date: 2026-11-15.
- Decision: every input has an optional `attributes` field typed as the
  entity's schema input minus builder-owned keys (identity, coordinates, actor
  references, ids, timestamps, URLs, `permissions`, and `private`, which is
  derived from `visibility`). Builder-owned keys are also rejected at runtime,
  and `attributes` are spread before builder fields. Rationale: uniform escape
  hatches for closed issues, merged pull requests, commit messages, and
  repository metadata without bypassing integrity. Date: 2026-11-15.
- Decision: builder misuse throws `FixtureScenarioError`, an `Error` subclass
  with a `code` (`unknown-reference`, `duplicate`, `invalid-number`,
  `invalid-relation`, `invalid-input`, `schema`, or `composition`), an `entity`
  kind, a readonly `violations` list, and a `cause` where one exists. The
  integrity check is a pure query returning
  `readonly FixtureIntegrityViolation[]`. Rationale: fixture misuse is a
  programming error in test setup, so failing fast is right; generic codes stay
  stable as entity kinds are added (labels in 1.5.1); the pure query keeps
  command/query separation. Date: 2026-11-15.
- Decision: names avoid collisions with existing exports. Handles are
  `UserHandle`, `OrganizationHandle`, `OwnerHandle`, `RepositoryHandle`,
  `BranchHandle`, `TagHandle`, `BlobHandle`, `IssueHandle`, and
  `PullRequestHandle`; inputs are `Scenario*Input`; the callback argument is a
  `FixtureScenarioComposer`. Rationale: `RepositoryFixtureInput` and friends
  already exist, and "draft" collides with the pull request `draft` field.
  Date: 2026-11-15.
- Decision: `actorHeaders` accepts `FixtureActor`, currently
  `UserHandle | AnonymousFixtureActor`, handled by an exhaustive `switch` with a
  `never` guard, and returns `FixtureActorHeaders`, a named type with one
  literal key and no index signature. App and installation actors are deferred
  to roadmap 9.5.2 and can be added to the union without breaking callers.
  Date: 2026-11-15.
- Decision: keep the six existing `build*Fixture` exports unchanged apart
  from the `EP-M1` fix. Rationale: they validate single entities for converter
  and URL unit tests; the package is pre-1.0 with no release tag, so no
  compatibility layer is needed either way. Date: 2026-11-15.
- Decision: formally prove two pieces of contractual logic with LemmaScript's
  Dafny backend: ref-name normalization (where the real defect was found) and
  the number allocator (with an exact postcondition and a distinctness
  preservation lemma). The review showed that the first draft's allocator
  specification admitted wrong implementations (for example `max + 2`) and that
  its availability lemma restated its body; both are replaced. A reviewer
  recommended dropping the proof as low value; it is kept because the brief
  requires an exhaustive proof for contractual business logic, and the
  replacement targets are substantive. Date: 2026-11-15.
- Decision: run `lsc` through `bunx --package lemmascript@0.6.10` and add a
  separate `prove` CI job that installs a pinned Dafny release. Rationale:
  `C12`, and a proof that is not enforced in CI goes stale. Date: 2026-11-15.
- Decision: migrate `tests/rest-request-urls.test.ts`'s fixture to the
  builder in `EP-M4`. Rationale: it exercises refs, commits, a blob, issues,
  and pull requests, it currently seeds a dangling head SHA, and migrating it
  tests the API's ergonomics on a real case at roughly zero net lines. Date:
  2026-11-15.

## Outcomes & retrospective

Not started. Fill in at each milestone boundary and at completion.

## Conformance basis

Upstream artefacts, read at commit `c2e5ddc` (the base of `main`):

- `docs/roadmap.md` §1 idea, §1.3 step ("whether mutations and test
  fixtures can share one domain path"), and §1.3.2 task (`RM-1.3.2`). Its
  success criterion is `RM-1.3.2-S`: "new tests can compose actor-aware
  repository fixtures through published builders." Later dependants: 1.5.1
  (label builders), 3.1.1 and 8.1.1 (create reducers), 3.3.1
  (issue-to-pull-request link), 9.2.1 (scenario recipes), 9.3 (reset), and
  9.5.2 (app and installation actors).
- `docs/architecture.md` §State model and §Extension seams (`ARCH-STATE`,
  `ARCH-SEAMS`), including lines 58-60 that describe `src/store/builders.ts`.
- `docs/developers-guide.md` §Testing expectations (`DEV-TEST`) and §Linting
  rules (`DEV-LINT`).
- `docs/github-rest-api-audit.md` §Extension Surface and §Store and Modelling
  Constraints (`REST-EXT`).
- `docs/api-reference.md` §Exported fixture schemas (`API-FIX`).
- `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §5 stable keys, §6 seed fixtures, §9 shared actions, and §25 clocks
  (`MOCK-KEYS`, `MOCK-SEED`, `MOCK-ACTIONS`, `MOCK-CLOCK`).
- `docs/complexity-antipatterns-and-refactoring-strategies.md` (bumpy-road
  avoidance and command/query separation).
- `docs/github-graphql-api-audit.md` (the `viewer` surface used in
  acceptance).
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
RM-1.3 step -> MOCK-ACTIONS -> EP-M2 planners -> Decision log (reuse in 3.1.1, 8.1.1)
MOCK-KEYS -> EP-M1/EP-M5 -> tests/entity-schema-idempotence.test.ts, src/store/entities/ref-name.dfy
MOCK-KEYS -> EP-M2/EP-M5 -> tests/fixture-numbering.test.ts, src/fixtures/numbering.dfy
MOCK-CLOCK -> EP-M2/EP-M3 -> tests/fixture-determinism.test.ts
DEV-TEST -> EP-M2..EP-M4 -> property, unit, behavioural, and end-to-end suites
```

## Verification plan

Invariants, lemmas, and axioms are listed with their method, artefact, command,
expected evidence, discharge condition, and non-vacuity check. All fast-check
properties use `propertyTestSeed` from `tests/support/property-test-seed.ts`
and print `fc.statistics` classifications.

### Invariants

`INV-1` Ref-schema idempotence. For every valid ref input `x`,
`githubRefSchema.parse(githubRefSchema.parse(x))` deep-equals
`githubRefSchema.parse(x)`; the stored `qualifiedName` never starts with
`refs/heads/` or `refs/tags/` and is never empty; and
`githubInitialStoreSchema` is idempotent on states built by the scenario
builder.

- Methods: the `L1` proof; a fast-check property over ref inputs; named
  regression examples for `main`, `refs/heads/main`, `v1.0.0` with
  `type: 'tag'`, `refs/pull/1/head`, `refs/heads/refs/heads/main`, the rejected
  `refs/heads/`, and the `refs/heads/v1` versus `refs/tags/v1` collision.
- Artefacts: `src/store/entities/ref-name.ts`,
  `tests/entity-schema-idempotence.test.ts`, `tests/entities.test.ts`.
- Command:
  `bun test tests/entity-schema-idempotence.test.ts tests/entities.test.ts`.
- Evidence and discharge: red on the current ref schema, green after
  `EP-M1`, 200 runs.
- Non-vacuity: the arbitrary generates short names, `refs/heads/...`,
  `refs/tags/...`, other `refs/...` namespaces, and doubled prefixes; the
  recorded classification must show each class above 10%. The pre-fix failure
  is the negative control.

`INV-2` Referential integrity. In every built state: each repository owner is a
seeded user or organization; each organization member is a seeded user whose
`organizations` lists that organization; each branch, ref, commit, blob, issue,
and pull request names a seeded repository; each issue and pull request author
is a seeded user; each pull request's base and head name seeded refs whose SHAs
equal its `base.sha` and `head.sha`; each pull request's base ref belongs to
the pull request's repository; and each organization has exactly one
installation row.

- Method: a model-based fast-check property. A command arbitrary generates
  up to 25 calls to `user`, `organization`, `repository` (including forks),
  `branch`, `tag`, `blob`, `issue`, and `pullRequest`, choosing references by
  index into handles created earlier. Two oracles must agree:
  `findFixtureIntegrityViolations` must return `[]`, and a production-path
  oracle must resolve every pull request's base and head through
  `convertInitialStateToStoreState` tables using the production key helpers
  `refStoreKey` and `commitStoreKey`. The output must also pass
  `githubInitialStoreSchema`.
- Artefact: `tests/fixture-scenario-properties.test.ts`.
- Command: `bun test tests/fixture-scenario-properties.test.ts`.
- Evidence and discharge: 200 runs passing.
- Non-vacuity: classify runs by counts of pull requests, fork pull requests,
  cross-owner repositories, tags, and organization members; at least 30% of
  runs must contain an issue and a pull request, and at least 10% a fork pull
  request. A generative negative control takes a valid built state, applies one
  corruption drawn from a catalogue (unknown owner, unknown author, member
  missing its organization, missing head ref, mismatched head SHA, base ref
  from another repository, missing installation), and asserts the expected
  violation code, so each oracle rule is shown to fire.

`INV-3` Shared, unique, exact numbering. Within one repository, issue and pull
request numbers are pairwise distinct integers in `[1, 2147483647]`; an omitted
number is exactly one more than the largest used (or 1 when none); an explicit
unused in-range number is honoured exactly; anything else is rejected with
`invalid-number`.

- Methods: the `L2` and `L3` proofs, plus a fast-check property over mixed
  explicit and omitted requests against a `Set<number>` model, with a boundary
  arbitrary covering `0`, negative values, non-integers, `2147483647`,
  `2147483648`, and `Number.MAX_SAFE_INTEGER`.
- Artefacts: `src/fixtures/numbering.ts`, `src/fixtures/numbering.dfy`,
  `tests/fixture-numbering.test.ts`.
- Commands: `make prove` and `bun test tests/fixture-numbering.test.ts`.
- Evidence and discharge: Dafny reports all obligations verified with zero
  errors; the property passes 500 runs.
- Non-vacuity: the preconditions are satisfiable, witnessed by `[]` and
  `[1, 3]`. Mutation controls, each run once on a scratch copy and recorded in
  `Artefacts and notes`: `max + 1` changed to `max + 2`, and the initial
  maximum changed from 0 to 1, must each make `make prove` fail an `ensures`;
  dropping the upper-bound check must make the property fail.

`INV-4` Branch, ref, and commit coherence. For every seeded branch `b`, there
is exactly one ref with `qualifiedName` equal to `b.name`, `ref` equal to
`refs/heads/<b.name>`, and `object.sha` equal to `b.commit.sha`, and exactly
one commit with that SHA in the same repository. Every tag ref points at a
seeded commit in its repository. Every non-root commit's parents are seeded
commits in the same repository.

- Method: part of both `INV-2` oracles and the model property; named
  examples for the default branch, a non-default `from`, a fork, and a tag.
- Artefacts: `tests/fixture-scenario.test.ts`,
  `tests/fixture-scenario-properties.test.ts`.

`INV-5` Determinism. Two builds with the same callback and options yield
deep-equal `initialState` and handles, and deep-equal output from
`githubInitialStoreSchema.parse(initialState)`; no Faker-backed default is
reached during either the build or that parse.

- Method: a fast-check property building each generated command sequence
  twice, plus a tripwire that uses Bun's `spyOn` on `faker.date.recent`,
  `faker.date.between`, `faker.number.int`, `faker.internet.email`, and
  `faker.git.commitSha` and asserts zero calls; plus a stored snapshot of one
  representative scenario.
- Artefact: `tests/fixture-determinism.test.ts`.
- Non-vacuity: the tripwire's negative control appends one handwritten
  organization without an email or installation to a built state and asserts
  that the spies record calls, proving the tripwire can fire. Residual gap:
  `src/store/entities/blob.ts` captures `faker.lorem.paragraphs` by reference,
  so a spy cannot see it; the builder's `blob` input therefore requires
  `content`, and a type test pins that requirement.

`INV-6` Actor header round trip. For every login accepted by the builder,
parsing `actorHeaders(handle)` with the existing request-actor parser yields
`{kind: 'user', login}`, and resolving it against a store seeded from the same
scenario yields that seeded user. `anonymousFixtureActor` parses as
`{kind: 'anonymous'}`.

- Method: a fast-check property over the builder's login pattern (not a
  wider alphabet), plus named examples, including case variants.
- Artefact: `tests/fixture-actor-headers.test.ts`.
- Non-vacuity: a login absent from the scenario must resolve to anonymous,
  showing that resolution consults seeded state; a login the builder rejects
  (with a space or a leading hyphen) must throw `invalid-input`.

`INV-7` Boundary direction. Every module under `src/fixtures/` imports only
from the `C1` allow-list.

- Method: a fitness test reading each file's import specifiers.
- Artefact: `tests/fixture-boundaries.test.ts`.
- Non-vacuity: the test asserts that it found at least ten fixture modules
  and at least one import per module, so an empty glob cannot pass, and it
  includes a fixture string containing a forbidden import to show that the
  checker rejects it.

### Lemmas

`L1` Ref-name normalization, proven for `normalizeRefName(raw, type)` in
`src/store/entities/ref-name.ts`. The function returns
`{tag: 'ok', qualifiedName, ref}` or `{tag: 'error'}`. For every string `raw`
and type `commit` or `tag`:

1. On success, `qualifiedName` is non-empty and does not start with
   `refs/heads/` or `refs/tags/`.
2. On success, if `raw` starts with `refs/`, then `ref === raw`; otherwise
   `ref` is the type's namespace prefix followed by `raw`, and
   `qualifiedName === raw`.
3. Idempotence: on success, `normalizeRefName(ref, type)` succeeds with the
   same `qualifiedName` and `ref`.
4. It errors exactly when stripping the namespace leaves an empty name.

Clause 3 is the step that discharges `INV-1` for the ref schema, because the
schema's transform delegates to this function and the re-parse reads the stored
`ref`.

`L2` Number allocation, proven for `allocateNumber(used, request)` in
`src/fixtures/numbering.ts`. `request` is `{tag: 'auto'}` or
`{tag: 'explicit', value}`. Preconditions: every element of `used` lies in
`[1, MAX]` with `MAX = 2147483647`. Postconditions on `{tag: 'ok', value}`:
`value` lies in `[1, MAX]` and is not in `used`; for an explicit request,
`value` equals the requested value; for an automatic request, `value` is 1 when
`used` is empty, and otherwise `value - 1` is an element of `used` and every
element is less than `value`. It returns `{tag: 'error'}` exactly when an
explicit value is out of range or already used, or an automatic request finds
the maximum already at `MAX`.

`L3` Distinctness preservation: if `used` has no duplicates and
`allocateNumber` succeeds with `value`, then `used` followed by `value` has no
duplicates. This is the induction step for `INV-3`; the property test's model
carries the induction over whole sequences, because the composer's sequencing
is ordinary imperative code.

### Axioms

- `A1` `node:crypto` SHA-1 is deterministic for equal input strings.
- `A2` Zod 3 `parse` is deterministic for inputs that supply every
  defaulted-by-function field, and returns new objects without mutating its
  input.
- `A3` `@aboviq/bun-test-cucumber` runs every scenario in
  `features/**/*.feature` with step definitions from `tests/**/*.steps.ts`.
- `A4` LemmaScript's Dafny translation of the annotated subset is faithful to
  the TypeScript semantics for strings and integers, as documented in its
  `SUBSET.md` and `SPEC_DAFNY.md`. Runtime guards outside the proven functions
  reject non-integers before they reach the proven code, and the fast-check
  properties exercise the same TypeScript functions at runtime to guard against
  translation drift.
- `A5` The foundation simulator does not mutate the `initialState` it
  receives after `githubInitialStoreSchema` parsing.
- `A6` Dafny 4.11 (the version installed on the development host) and the
  version pinned in CI produce the same verdicts for these proofs.

## Context and orientation

Simulacat Core is a TypeScript package that serves simulated GitHub REST and
GraphQL APIs from seeded state. These are the files a newcomer needs:

- `src/index.ts` is the public entry point. `simulation(args)` parses
  `args.initialState` with `githubInitialStoreSchema` and starts the foundation
  simulator. It also re-exports the public fixture surface.
- `src/store/entities.ts` defines `githubUserSchema`,
  `githubInitialStoreSchema`, `GitHubStore`, `GitHubInitialStore` (exported as
  `InitialState`), and `convertInitialStateToStoreState`, which turns parsed
  arrays into keyed tables.
- `src/store/entities/*.ts` hold one Zod schema per entity: `repository.ts`,
  `branch.ts`, `ref.ts`, `commit.ts`, `issue.ts`, `pull-request.ts`,
  `organization.ts`, `installation.ts`, `blob.ts`, `shared.ts`, and
  `defaults.ts`. Store keys are `owner/name` (repository), `owner/repo:name`
  (branch), `owner/repo:qualifiedName` (ref), `owner/repo:sha` (commit),
  `owner/repo:path` (blob), `owner/repo#n` (issue), and `owner/repo!n` (pull
  request).
- `src/store/builders.ts` holds the six existing single-entity builders.
- `src/store/actors.ts` parses `x-simulacat-actor` values such as
  `user:alice` and `anonymous`, and resolves them against seeded users.
- `src/store/early-entity-selectors.ts` resolves pull request base and head
  refs (`resolvePullRequestRelations`, lines 114-126).
- `src/rest/index.ts` serves `GET /user`, `GET /repos/{owner}/{repo}/issues`,
  `.../issues/{n}`, `.../pulls`, `.../pulls/{n}`, `.../git/ref/{ref}`, and
  `.../git/commits/{sha}`. `src/graphql/resolvers.ts` serves `viewer`, `user`,
  `organization`, and `repository`.
- `tests/` holds Bun tests. `tests/cucumber.js` and
  `tests/cross-owner-identity.features.test.ts` load every Gherkin file under
  `features/`; `test-plugins.ts` registers step files matching
  `tests/**/*.steps.ts`. `tests/support/property-test-seed.ts` exports the
  shared fast-check seed.
- `tests/support/documented-examples.ts`,
  `tests/support/documented-example-execution.ts`,
  `tests/support/documented-example-observations.ts`, and
  `tests/support/documented-example-contracts.ts` execute every
  `tested-example` block in `docs/users-guide.md` against the packed package in
  a temporary consumer project. This is the repository's end-to-end harness for
  the published API.
- `tests/documented-surface.test-d.ts` pins public types; `tsc --noEmit`
  compiles it through `make typecheck`.

The survey used to size the budgets found about 16 test files that handwrite
`initialState` literals; issues, pull requests, refs, and commits are seeded by
hand only in `tests/rest-request-urls.test.ts`. The existing builders are
called about 35 times across 7 test files, all for single-entity unit tests.
This task migrates one test; migrating the rest is optional follow-up work.

Terms used in this plan:

- Actor: the principal a request acts as, selected by the
  `x-simulacat-actor` header (`user:<login>`, `app:<id>`, `installation:<id>`,
  or `anonymous`).
- Handle: a small frozen object returned by the builder that names one
  seeded entity by its canonical coordinates.
- Composer: the object passed to the scenario callback. It accumulates rows
  and allocates identifiers while the callback runs, and is locked afterwards.
- Planner: a pure function that, given the current input-shaped tables and
  one builder input, returns the rows to add and the new handle, or a list of
  violations.
- Input-shaped state: an `InitialState` value before Zod parsing applies
  defaults and transforms.
- Property test: a test that checks an invariant over many generated inputs
  (here with fast-check).
- LemmaScript: a toolchain that translates TypeScript annotated with `//@`
  contracts into Dafny, a verification language whose verifier proves the
  contracts for all inputs.

## Interfaces and dependencies

New and changed production modules, each under 400 lines:

- `src/store/entities/ref-name.ts` (new): `normalizeRefName(raw, type)`,
  written in the LemmaScript subset with `//@ ensures` contracts. Used by
  `src/store/entities/ref.ts` and by `normalizeRefLookup` in
  `src/graphql/converters/repository.ts`, replacing its regular expression.
- `src/fixtures/handles.ts`: branded handle types, `FixtureActor`,
  `AnonymousFixtureActor`, and the `Scenario*Input` types.

  ```typescript
  declare const handleBrand: unique symbol;
  type Handle<Kind extends string, Fields> = Readonly<{kind: Kind; [handleBrand]: Kind} & Fields>;
  export type UserHandle = Handle<'user', {login: string}>;
  export type OrganizationHandle = Handle<'organization', {login: string}>;
  export type OwnerHandle = UserHandle | OrganizationHandle;
  export type RepositoryHandle = Handle<'repository', {owner: string; name: string; defaultBranch: BranchHandle}>;
  export type BranchHandle = Handle<'branch', {owner: string; repo: string; name: string}>;
  export type TagHandle = Handle<'tag', {owner: string; repo: string; name: string}>;
  export type BlobHandle = Handle<'blob', {owner: string; repo: string; path: string}>;
  export type IssueHandle = Handle<'issue', {owner: string; repo: string; number: number}>;
  export type PullRequestHandle = Handle<'pullRequest', {owner: string; repo: string; number: number}>;
  ```

  Inputs (all optional fields typed `?: T | undefined`): `ScenarioUserInput`
  (`login`, `name`, `email`, `attributes`); `ScenarioOrganizationInput`
  (`login`, `name`, `members`, `attributes`); `ScenarioRepositoryInput`
  (`owner`, `name`, `defaultBranch`, `visibility`, `forkOf`, `attributes`);
  `ScenarioBranchInput` (`repository`, `name`, `from`, `author`, `message`);
  `ScenarioTagInput` (`repository`, `name`, `target`); `ScenarioBlobInput`
  (`repository`, `path`, `content`); `ScenarioIssueInput` (`repository`,
  `author`, `title`, `number`, `state`, `body`, `attributes`);
  `ScenarioPullRequestInput` (`repository`, `author`, `title`, `head`, `base`
  defaulting to the repository's default branch, `number`, `state`, `draft`,
  `body`, `attributes`).
- `src/fixtures/policy.ts`: `fixtureSha(seed)`, `createFixtureClock(epoch)`,
  `createIdSequence(start)`, and `isValidLogin(login)`.
- `src/fixtures/numbering.ts`: `allocateNumber(used, request)`, annotated for
  LemmaScript, plus a thin runtime guard that rejects non-integers before
  calling it.
- `src/fixtures/tables.ts`: the input-shaped `ScenarioTables` type and
  coordinate lookups shared by planners.
- `src/fixtures/plan-accounts.ts`: `planUser` and `planOrganization` (which
  also plans the organization's installation row).
- `src/fixtures/plan-repositories.ts`: `planRepository`, including forks and
  the default branch.
- `src/fixtures/plan-git.ts`: `planBranch`, `planTag`, `planBlob`, and the
  shared commit constructor.
- `src/fixtures/plan-collaboration.ts`: `planIssue` and `planPullRequest`.
- `src/fixtures/integrity.ts`: `findFixtureIntegrityViolations(state)`
  returning `readonly FixtureIntegrityViolation[]`, a discriminated union on
  `code`. The violation type is exported; the function is internal.
- `src/fixtures/errors.ts`: `FixtureScenarioError`.
- `src/fixtures/scenario.ts`: the composer, `buildFixtureScenario`, and
  `scenarioBranchSha`.

  ```typescript
  export type FixtureScenarioOptions = Readonly<{epoch?: string | undefined}>;
  export type FixtureScenario<Handles> = Readonly<{initialState: InitialState; handles: Handles}>;
  export type FixtureScenarioComposer = {
    user(input: ScenarioUserInput): UserHandle;
    organization(input: ScenarioOrganizationInput): OrganizationHandle;
    repository(input: ScenarioRepositoryInput): RepositoryHandle;
    branch(input: ScenarioBranchInput): BranchHandle;
    tag(input: ScenarioTagInput): TagHandle;
    blob(input: ScenarioBlobInput): BlobHandle;
    issue(input: ScenarioIssueInput): IssueHandle;
    pullRequest(input: ScenarioPullRequestInput): PullRequestHandle;
  };
  export const buildFixtureScenario: <Handles>(
    compose: (scenario: FixtureScenarioComposer) => Handles,
    options?: FixtureScenarioOptions
  ) => FixtureScenario<Handles>;
  export const scenarioBranchSha: <Handles>(lookup: {
    scenario: FixtureScenario<Handles>;
    branch: BranchHandle;
  }) => string;
  ```

- `src/fixtures/actor-headers.ts`: `anonymousFixtureActor`,
  `actorHeaders(actor)`, and the `FixtureActorHeaders` type:

  ```typescript
  export type FixtureActorHeaders = Readonly<{'x-simulacat-actor': `user:${string}` | 'anonymous'}>;
  ```

- `src/fixtures/index.ts`: the feature's barrel, re-exported by name (no
  wildcard) from `src/index.ts`.

Public additions to `src/index.ts`: `buildFixtureScenario`, `scenarioBranchSha`,
`actorHeaders`, `anonymousFixtureActor`, `FixtureScenarioError`, and the
handle, input, option, result, actor, header, and violation types. These are
pre-1.0 additions with no compatibility obligations.

Dependencies: none added to `package.json`. `make prove` runs
`bunx --package lemmascript@0.6.10 lsc ...`; the `prove` CI job installs a
Dafny release through an action pinned to a full commit SHA. `fast-check`
`^4.9.0` is already a development dependency.

## Plan of work

Each milestone is a coherent plateau: it ends with every gate green, a commit,
and an updated `Progress` entry. Do not start the next milestone while the
current one is red.

### `EP-M0` Baseline and LemmaScript spike

Run the four gates on the untouched branch and record their result and the
`make test` wall time in `Artefacts and notes`. A pre-existing failure is
recorded with evidence and reported before any code change.

Spike, in `/tmp/scratch-1-3-2/` only: write throwaway versions of
`normalizeRefName` and `allocateNumber` with their contracts, run
`bunx --package lemmascript@0.6.10 lsc gen --backend=dafny <file>`, and confirm
that generation succeeds and that `dafny verify` runs on the output. Record the
outcome.

- Acceptance: gates recorded; spike outcome recorded.
- Recovery: none needed; nothing is committed except plan updates.

### `EP-M1` Ref-name normalization and schema idempotence

Outcome: the ref schema is idempotent, existing `buildRefFixture` output can be
fed back into `initialState`, and GraphQL ref lookup shares the same
normalization. This is a standalone correctness fix in its own commit.

Red: add `tests/entity-schema-idempotence.test.ts` (the `INV-1` property and
named examples) and new named examples in `tests/entities.test.ts`, including
an input whose `ref` is `refs/heads/main`, which must produce key
`owner/repo:main`. Run them; expect failures reporting `qualifiedName`
`refs/heads/main` where `main` was expected, and no rejection of `refs/heads/`.

Green: add `src/store/entities/ref-name.ts` with `normalizeRefName`, using
`startsWith` and `slice` only. Make `githubRefSchema`'s transform delegate to
it, reporting the error variant through `ctx.addIssue` in a `superRefine` step
so that an empty name fails validation. Replace the regular expression in
`normalizeRefLookup` with the shared helper. Update JSDoc on both.

Refactor: keep the transform to one conditional.

- Requirements: `MOCK-KEYS`; supports `C2` and `C3`.
- Acceptance: `INV-1` green; every existing test green.
- Conformance check: no public signature changed; behaviour changed only for
  fully qualified `ref` inputs and the empty-name case, recorded for the
  `CHANGELOG.md` entry in `EP-M6`.
- Recovery: revert the milestone commit.

### `EP-M2` Pure fixture policy core

Outcome: tested, pure building blocks with no public exports yet.

Red: add `tests/fixture-numbering.test.ts` (named examples and the `INV-3`
property), `tests/fixture-policy.test.ts` (SHAs are 40 lowercase hexadecimal
characters and equal for equal seeds; the clock strictly increases; id
sequences strictly increase; the login pattern accepts and rejects the
documented cases), and `tests/fixture-integrity.test.ts` (one handwritten
negative example per violation code, and a valid handwritten state that yields
`[]`). Run them; expect module-not-found failures.

Green: implement `src/fixtures/policy.ts`, `src/fixtures/numbering.ts`,
`src/fixtures/tables.ts`, `src/fixtures/integrity.ts`, and
`src/fixtures/errors.ts`.

Refactor: keep each function within the Biome and Oxlint limits (70 lines, four
parameters, cognitive complexity 8, nesting depth 3). The integrity checker is
a table of small rule functions, one per violation code, combined with
`flatMap`.

- Requirements: `MOCK-CLOCK`, `MOCK-KEYS`, `DEV-TEST`.
- Acceptance: the three suites pass; the `INV-3` property passes 500 runs.
- Conformance check: `src/fixtures/` imports only from the `C1` allow-list.
- Recovery: the modules are new and unexported, so reverting is safe.

### `EP-M3` Scenario builder and actor headers

Outcome: `buildFixtureScenario`, `scenarioBranchSha`, the handles, and
`actorHeaders` are published from `src/index.ts`, with unit, property,
type-level, and boundary tests.

Red: add `tests/fixture-scenario.test.ts` with named examples:

1. A user, an organization with that user as a member, an organization-owned
   repository, and a user-owned repository build into a state that
   `githubInitialStoreSchema` and `convertInitialStateToStoreState` accept; the
   member's `organizations` lists the organization; the organization has one
   installation row.
2. A repository seeds its default branch (`protected: false`), its
   `refs/heads/main` ref, and a root commit with one SHA; the
   `defaultBranch: 'trunk'` option is honoured.
3. A branch started from `main` gets a fresh commit whose parent is the main
   tip, authored by the given user.
4. An issue then a pull request get numbers 1 and 2; an explicit issue
   number 10 followed by an omitted pull request number yields 11.
5. A fork owned by another user shares the parent's default-branch ancestry,
   and a pull request in the parent whose head is a branch of the fork resolves
   both refs.
6. A tag points at a branch tip; a blob is keyed by path.
7. `attributes` sets a closed issue's `closed_at` and a repository's
   `topics`.
8. Unhappy paths, each asserting `FixtureScenarioError` and its `code` and
   `entity`: a duplicate login, including a different-case duplicate across a
   user and an organization (`duplicate`); a duplicate repository; a tag that
   shares a branch's name (`duplicate`); a handle whose coordinates are not
   seeded (`unknown-reference`); a used, zero, non-integer, or out-of-range
   number (`invalid-number`); a pull request whose head is its base, or whose
   base is in another repository (`invalid-relation`); an invalid login or a
   builder-owned key smuggled into `attributes` through a spread variable
   (`invalid-input`); an empty title (`schema`, with the Zod error as `cause`);
   calling the composer after the callback returns, or returning a promise from
   the callback (`composition`).

Add `tests/fixture-scenario-properties.test.ts` (`INV-2`, `INV-4`),
`tests/fixture-determinism.test.ts` (`INV-5`),
`tests/fixture-actor-headers.test.ts` (`INV-6`),
`tests/fixture-boundaries.test.ts` (`INV-7`), and
`tests/fixture-scenario.test-d.ts`. The type test pins the exported types and
uses `@ts-expect-error` to prove that an organization handle cannot be an issue
author, that a hand-built object literal is not a handle, that `attributes`
rejects builder-owned keys in a literal, and that a blob input without
`content` does not compile. Run them; expect missing-export failures.

Green: implement `src/fixtures/handles.ts`, the four planner modules,
`src/fixtures/scenario.ts`, `src/fixtures/actor-headers.ts`, and
`src/fixtures/index.ts`, and export them from `src/index.ts`.
`buildFixtureScenario` runs the callback against a fresh composer, locks it,
rejects a returned promise, runs `findFixtureIntegrityViolations`, parses a
copy with `githubInitialStoreSchema` and converts it with
`convertInitialStateToStoreState` (wrapping any thrown error as
`FixtureScenarioError` with the original as `cause`), then returns the unparsed
state and frozen handles.

Refactor: split any module that nears 400 lines; check that every composer
method resolves handles through the shared lookup in `tables.ts` rather than
repeating checks.

- Requirements: `RM-1.3.2`, `MOCK-SEED`, `API-FIX`, `C1` to `C8`.
- Acceptance: all new suites pass; `make typecheck` compiles the type test;
  `make docs-check` reports zero TypeDoc warnings for the new exports.
- Conformance check: one validation path (`C2`); no store actions or issue
  twins (`C8`); no authorization semantics (`C4`).
- Recovery: revert the milestone commits; `EP-M2` remains a valid plateau.

### `EP-M4` Behavioural, end-to-end, and migration acceptance

Outcome: the builder is proven through real HTTP against a running simulator,
through the packed package in a consumer project, and on a migrated real test.

First commit (refactor, `R5`): move the example handler table out of
`tests/support/documented-example-execution.ts` into
`tests/support/documented-example-handlers.ts`; behaviour unchanged; gates
green.

Red: add `features/actor-aware-fixtures.feature` (below) and
`tests/actor-aware-fixtures.steps.ts`, with a tagged
`After({tags: '@actor-aware-fixtures'})` hook that closes the server. Run
`bun test tests`; expect undefined-step failures for the new feature only,
which shows that it is loaded and that no phrase collides (`R4`). Then add the
`actor-aware-fixture-scenario` example to `docs/users-guide.md` with its
`tested-example` marker; expect the documentation inventory test to fail
because no handler exists.

Green: implement the steps by building a scenario, starting
`simulation({initialState}).listen(0)`, and issuing requests with
`actorHeaders`. Register the example's handler and its JSON contract in the
documentation harness. The example builds a scenario, starts the simulator,
fetches `/user` as alice and `/repos/acme/widgets/pulls/2`, prints both as
JSON, and closes the server.

Migration: replace the handwritten fixture in `tests/rest-request-urls.test.ts`
with a scenario, deriving expected commit URLs from `scenarioBranchSha` instead
of the literal `commit-a`. The test's assertions about URL shapes must remain
otherwise unchanged and pass.

Proposed feature text, at `features/actor-aware-fixtures.feature`:

```gherkin
@actor-aware-fixtures
Feature: Actor-aware fixture scenarios seed coherent, attributable state

  Background:
    Given a fixture scenario where user "alice" is a member of organization "acme"
    And fixture organization "acme" owns repository "widgets" with branch "feature/login"
    And fixture user "alice" opened issue "Login fails" in "acme/widgets"
    And fixture user "alice" opened pull request "Fix login" from "feature/login" in "acme/widgets"
    And a simulator seeded from the fixture scenario

  Scenario: The fixture actor is the authenticated user
    When the client requests GraphQL viewer as fixture actor "alice"
    Then the GraphQL viewer login is "alice"
    And REST "/user" as fixture actor "alice" returns login "alice"

  Scenario: Anonymous requests are not authenticated
    When the client requests REST "/user" as the anonymous fixture actor
    Then the fixture response status is 401

  Scenario: Issues and pull requests share the repository number sequence
    Then REST issue 1 in "acme/widgets" has title "Login fails" and author "alice"
    And REST pull request 2 in "acme/widgets" has title "Fix login" and author "alice"

  Scenario: Pull request refs resolve to the seeded branches
    Then REST pull request 2 in "acme/widgets" has head ref "feature/login"
    And the head SHA of fixture pull request 2 equals the SHA of ref "heads/feature/login"
    And the base SHA of fixture pull request 2 equals the SHA of ref "heads/main"

  Scenario: Fixture-built repositories accept writes through the shared action
    When the client PATCHes repository "acme/widgets" with description "Seeded by scenario"
    Then GraphQL repository "acme/widgets" has description "Seeded by scenario"
```

The last scenario deliberately reuses the existing step phrases from
`tests/shared-domain-writes.steps.ts`; if those steps read state that this
feature's steps cannot share, add "fixture" variants instead.

- Requirements: `RM-1.3.2-S`, `ARCH-SEAMS`, `API-FIX`.
- Acceptance: `make test` passes, including the feature, the documentation
  example run against the packed package, and the migrated test.
- Conformance check: the example uses only names exported from the package
  root.
- Recovery: revert the milestone commits; `EP-M3` remains a valid plateau.

### `EP-M5` Proofs and the `prove` gate

Outcome: `L1`, `L2`, and `L3` are machine-checked for all inputs, locally and
in CI.

Steps: add `LemmaScript-files.txt` listing `src/store/entities/ref-name.ts` and
`src/fixtures/numbering.ts`; generate with
`bunx --package lemmascript@0.6.10 lsc gen --backend=dafny <file>` for each;
add the minimal loop invariants and lemma calls to the generated `.dfy` files
(additions only, per LemmaScript's contract); add a `prove` Makefile target
that regenerates the `.dfy.gen` files, fails if they differ from the committed
copies, and runs `lsc check --backend=dafny`; validate the Makefile with
`mbake validate Makefile`. Add a `prove` job to `.github/workflows/ci.yml` that
installs Dafny through an action pinned to a full commit SHA, then runs
`make prove`. It does not block the existing `verify` job.

Red: before adding loop invariants, `make prove` must fail with Dafny reporting
that a postcondition could not be proved.

Green: `make prove` reports all obligations verified and zero errors.

Non-vacuity, recorded in `Artefacts and notes`: run each `INV-3` mutation
control, plus one for `L1` (dropping the empty-name check), on a scratch copy;
observe each failure; discard the copies. Inspect the `.dfy` files for any
`assume`, `{:axiom}`, or added `axiom`; there must be none. Confirm that each
`requires` clause is satisfiable with the recorded witnesses.

- Requirements: `INV-1`, `INV-3`.
- Acceptance: `make prove` passes, plus the four standard gates.
- Conformance check: no `package.json` change (`C12`).
- Recovery: if an obligation cannot be closed within tolerance, stop, record
  the attempts, and ask whether to ship with the fast-check property as the
  recorded substitute for that obligation.

### `EP-M6` Documentation and delivery closure

Update each document with minimal, evidence-based changes:

- `docs/users-guide.md`: a "Composing actor-aware fixture scenarios" section
  around the tested example, covering the actor-header helper, the shared
  numbering rule, forks, tags, blobs, `attributes`, the determinism and
  order-dependence notes, and the error codes.
- `docs/developers-guide.md`: the `src/fixtures/` boundary and fitness test,
  the planner pattern, the integrity oracle, `make prove` and its trust
  boundary, and an "Adding an entity to the scenario builder" checklist.
- `docs/api-reference.md`: the new exports and the ref-normalization rule.
- `docs/architecture.md`: the fixtures module's place between the entity
  schemas and the `simulation()` composition root, and the planners as the
  shared rule path for future create actions.
- `docs/repository-layout.md`: `src/fixtures/` and `LemmaScript-files.txt`.
- `docs/contents.md`: link this plan.
- `CHANGELOG.md`: an "Added" entry for the builder and a "Changed" entry for
  ref normalization, with migration text, under the unreleased `0.6.5` heading.
- `docs/roadmap.md`: mark 1.3.2 done with a one-line "Delivered:" note, as
  1.3.1 does.

Search for stale claims with the command below and reconcile each hit.

```bash
rg -n "buildRepositoryFixture|fixture builders|qualifiedName" docs README.md --glob '!docs/execplans/**'
```

Then run every gate, including `make docs-check`, `make markdownlint`,
`make nixie`, `make spelling`, and `make prove`.

- Acceptance: all gates pass; roadmap entry checked.
- Conformance check: reconcile every discovery against `Conformance basis`;
  set `Status: COMPLETE` only when no deviation is unrecorded.

## Milestones and plateaus

Each milestone above states its outcome, requirements, acceptance evidence,
conformance check, and recovery. Compatibility decision for every milestone:
none. The package is pre-1.0 with no release tag, so no milestone introduces
aliases, shims, or dual implementations. The only behavioural change to an
existing surface (`EP-M1`) is a defect fix recorded in `CHANGELOG.md`.

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

`EP-M5` and `EP-M6` add:

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
EP-M4 red:   bun test tests -> undefined steps for @actor-aware-fixtures only; documentation inventory mismatch
EP-M4 green: make test -> all pass
EP-M5 red:   make prove -> a postcondition could not be proved
EP-M5 green: make prove -> all obligations verified, 0 errors
```

Gates run sequentially, never in parallel with each other for this worktree.
Commit after each green plateau with an imperative message that names the
milestone, for example "Make ref normalization idempotent (1.3.2)".

## Validation and acceptance

The work is accepted when all of the following hold:

1. `make check-fmt`, `make typecheck`, `make lint`, and `make test` pass at
   every milestone boundary; `make docs-check`, `make markdownlint`,
   `make nixie`, and `make spelling` pass at `EP-M6`; `make prove` passes at
   `EP-M5` and `EP-M6`, locally and in the `prove` CI job.
2. `features/actor-aware-fixtures.feature` passes, and its scenarios were
   observed failing with undefined steps before the steps existed.
3. The `actor-aware-fixture-scenario` users-guide example runs against the
   packed package and prints JSON whose `/user` login is `alice` and whose pull
   request number is `2` with head ref `feature/login`.
4. `tests/rest-request-urls.test.ts` passes on a builder-made fixture.
5. `tests/entity-schema-idempotence.test.ts` failed on the ref schema before
   `EP-M1` and passes after it.
6. Each invariant and lemma in the `Verification plan` has its recorded
   non-vacuity evidence in `Artefacts and notes`.
7. `docs/roadmap.md` marks 1.3.2 done.

## Idempotence and recovery

Every step can be re-run. Gates are read-only apart from `/tmp` logs, and
`make typecheck` regenerates GraphQL types deterministically. `lsc gen`
regenerates `.dfy.gen` files; never overwrite a hand-edited `.dfy` with
generated output except through `lsc regen`, which merges. Each milestone is
one or more commits on this branch, so a failed milestone is rolled back with
`git revert` of its commits without touching earlier plateaus. Scratch probes
live under `/tmp/scratch-1-3-2/` and are never committed.

## Artefacts and notes

Baseline gate results and wall time, the LemmaScript spike outcome, red and
green transcripts, property classification statistics, mutation-control
results, and proof outputs are recorded here as each milestone completes.

## Signposted documentation and skills

Read before starting:

- `AGENTS.md` for code style, file size, commit, and gate rules.
- `docs/developers-guide.md` §Linting rules and §Testing expectations.
- `docs/architecture.md` §State model and §Extension seams.
- `docs/api-reference.md` §Exported fixture schemas.
- `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §5, §6, §9, §23, and §25.
- `docs/complexity-antipatterns-and-refactoring-strategies.md` for the
  bumpy-road and command/query guidance.
- `docs/execplans/1-3-1-shared-domain-actions-for-write-behaviour.md` for the
  write spine the final scenario exercises.
- LemmaScript's `SUBSET.md`, `SPEC_DAFNY.md`, and `GETTING_STARTED.md` at
  <https://github.com/midspiral/LemmaScript>.

Skills to load during implementation:

- `execplans` to keep this document current.
- `hexagonal-architecture` for the `src/fixtures/` boundary: protect it with
  the fitness test and pure planners rather than transplanting a full
  ports-and-adapters layout.
- `typescript-router`, then `typescript-types-and-apis` (branded handles,
  input types, `@ts-expect-error` tests), `typescript-data-and-state`
  (immutable handles and deterministic transitions),
  `typescript-errors-and-outcomes` (`FixtureScenarioError` and the violation
  union), and `typescript-testing`.
- `fast-check` for the model-based, corruption, and round-trip properties.
- `typescript-verification` and `lemmascript` for `EP-M5`.
- `biome-typescript` and `typescript-quality-tools` when a lint rule fires.
- `codegraph-mcp` for callers and impact analysis before touching
  `src/store/entities/ref.ts`, `src/graphql/converters/repository.ts`, and
  `src/index.ts`.
- `en-gb-oxendict-style` for documentation, and `commit-message` for
  commits.

## Revision note

2026-11-15, initial draft: written after Wyvern reconnaissance, prior-art
research, and a scratch probe that found the ref re-parse defect.

2026-11-15, revision 1, after the community-of-experts review (verdict: proceed
with conditions):

- Dropped backing issue rows for pull requests (`C8`). They would have
  surfaced pull requests as GraphQL `Issue` nodes and encroached on roadmap
  3.3.1.
- Closed the determinism hole at simulator start. The builder now seeds
  installations, determinism is checked on parsed output, and a Faker tripwire
  was added (`C6`, `INV-5`).
- Renamed public types to avoid collisions (`*Handle`, `Scenario*Input`,
  `FixtureScenarioComposer`).
- Changed handles:
  - They are branded coordinate records, looked up by coordinates.
  - They no longer carry SHAs (`scenarioBranchSha` instead).
  - The composer locks after the callback returns and rejects async
    callbacks.
- Broadened the error codes and added `entity` and `violations`.
- Added uniform `attributes` with runtime rejection of builder-owned keys,
  plus `tag`, `blob`, `forkOf`, and commit authors.
- Added builder-side, case-insensitive duplicate checks and login
  validation.
- Extended the ref fix: empty-name rejection, the branch and tag collision,
  and one shared helper used by GraphQL lookup.
- Restated `C1` as a direct-import allow-list.
- Strengthened the proofs:
  - Ref normalization is now a proof target.
  - The allocator specification is exact, with a distinctness-preservation
    lemma replacing the restated availability lemma.
  - Integer ranges are bounded.
- `lemmascript` now runs through `bunx` rather than as a dependency, and a
  `prove` CI job was added.
- Added a production-path oracle and generative corruption controls for
  `INV-2`.
- Added a migration of `tests/rest-request-urls.test.ts` and an `EP-M0`
  LemmaScript spike.
- Raised the code budget to 2,800 lines and 36 files to cover these
  additions, and lowered the configuration budget, since no lockfile change is
  needed.

Remaining work is unchanged in shape: approval, then `EP-M0` to `EP-M6`.
