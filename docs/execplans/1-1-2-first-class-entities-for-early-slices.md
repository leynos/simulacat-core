# Add first-class entities for early slices

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

Roadmap reference: `docs/roadmap.md` task `1.1.2` under section 1.1
"Prove repository identity is owner-scoped and ref-safe".

Approval gate: approved for implementation on 2026-05-10 after the draft PR
was created. Implementation is proceeding milestone by milestone under the
tolerances below.

## Purpose / big picture

Simulacat Core currently has first-class store entities for users,
organizations, repositories, branches, installations, and blobs. It does not
yet have first-class store entities for the early collaboration objects that
later roadmap phases need: refs, commits, issues, and pull requests. Without
those entities, phase 2 GraphQL reads and phase 3 pull request mutations would
have to invent ad hoc route-local state, which would make REST and GraphQL
views disagree.

After this work, a fixture author can seed repository-scoped refs, commits,
issues, and pull requests through the public initial-state schema and fixture
builders. Store selectors can look them up by canonical owner-scoped
coordinates. Early REST and GraphQL read paths can rely on the same store
tables instead of placeholder-only payloads. This does not implement the full
collaboration lattice. Reviews, timelines, labels, assignees, statuses, checks,
mergeability, webhooks, and rich issue collaboration remain later roadmap work.

Observable success is a test fixture that seeds two owners with repositories of
the same short name, plus refs, commits, issues, and pull requests under each
repository. Unit tests prove canonical key round trips and duplicate detection.
Behavioural tests prove each new entity stays scoped to the requested owner and
repository and can be read through the minimum public surfaces needed by phases
2 and 3.

## Constraints

Hard invariants that must hold throughout implementation. Violation requires
escalation, not workarounds.

- Do not implement this plan until the user explicitly approves it. This was
  satisfied on 2026-05-10 when the user asked to proceed with implementation.
- The branch must not be `main`, `master`, or another default branch. Before
  implementation, run `git branch --show-current`; if it is a default branch,
  stop and ask for direction.
- Rename the implementation branch to
  `1-1-2-first-class-entities-for-early-slices` before implementation work
  starts, and track `origin/1-1-2-first-class-entities-for-early-slices` once
  the remote branch exists.
- Preserve all existing exported APIs in `src/index.ts`. Adding schemas,
  builders, key helpers, parsers, and types is permitted. Removing or changing
  the signature of existing exports is not.
- `githubInitialStoreSchema` must continue to accept existing fixture shapes.
  New top-level collections for refs, commits, issues, and pull requests must
  have defaults so existing users are not forced to seed them.
- Repository-owned entities must use owner-qualified keys. The existing
  repository key is `owner/name`; branch and blob keys are
  `owner/repo:reference`. New keys must be documented before they are relied on
  by adapters.
- Domain and policy logic belongs in store entities, key helpers, selectors,
  and later shared actions. REST and GraphQL adapters must consume those
  helpers instead of re-deriving identity locally. This applies the
  `hexagonal-architecture` skill as a boundary check, not as a directory
  transplant.
- Authentication and authorization remain out of scope for this task. `/user`,
  GraphQL `viewer`, request actors, and actor-aware permissions belong to
  roadmap section 1.2.
- Do not claim broad REST or GraphQL support merely because the OpenAPI or
  GraphQL schemas contain a field. A surface is scriptable only when it is
  backed by the new store entities and tested with meaningful returned data.
- Do not add a new runtime dependency without explicit approval. New
  development-only tooling also requires approval unless it is already present
  in `package.json`.
- Use the shared default Bun and Cargo caches. Do not create an isolated cache.
- Run formatting, linting, type-checking, tests, Markdown linting, and
  CodeRabbit review sequentially. Do not run quality gates in parallel.
- Other agents may be active on the machine. Do not kill unrelated processes.
- Keep TypeScript source files under 400 lines. If a store or GraphQL module
  would exceed that, split by feature.
- Update relevant documentation in the same implementation branch:
  `docs/api-reference.md`, `docs/architecture.md`, `docs/users-guide.md`, and
  the actual developer guide `docs/development.md`. There is no
  `docs/developers-guide.md` in this repository.
- Mark roadmap item 1.1.2 done only after the implementation, documentation,
  gates, and review are complete.

## Tolerances (exception triggers)

- Scope: if implementation requires touching more than 22 files or more than
  1,200 net source lines, stop and ask for approval to continue. Documentation
  and generated resolver type changes do not count toward the source-line
  threshold, but they must be reviewed.
- Interface: if an existing exported signature in `src/index.ts`,
  `src/store/entities.ts`, `src/store/index.ts`, or `src/store/keys.ts` must
  change incompatibly, stop and present options.
- Dependency: if a new runtime dependency is needed, stop. If a new
  development dependency is needed, stop unless the user has approved it.
- Proof tooling: if a substantive LemmaScript proof is required, stop before
  adding or invoking LemmaScript because Firecrawl research found it is a
  TypeScript verification toolchain in tech preview with external Dafny or Lean
  dependencies.
- GraphQL schema: if `bun run generate` produces unexpected diffs outside
  `src/__generated__/resolvers-types.ts`, stop and inspect before continuing.
- Behaviour: if a REST or GraphQL surface can only be implemented as a schema
  stub, keep it documented as deferred. Do not mark it scriptable.
- Test repair: if the same gate still fails after three focused remediation
  attempts, stop and document the failing evidence in this plan.
- Ambiguity: if phase 2 or phase 3 needs a richer field than this plan's
  minimal entity model covers, stop and ask whether to expand 1.1.2 or defer
  that field to the later roadmap task.
- CodeRabbit: if `coderabbit review --agent` is unavailable, cannot
  authenticate, or reports concerns that require scope expansion beyond these
  tolerances, stop and record the reason before proceeding.

## Risks

- Risk: the word "ref" overlaps with the existing `GitHubBranch` entity.
  Severity: medium.
  Likelihood: high.
  Mitigation: model a new generic repository ref entity only where needed for
  Git refs and GraphQL `Repository.ref(qualifiedName)`. Keep `GitHubBranch` as
  the REST branch payload shape unless tests prove it should become a wrapper
  over refs in this slice.

- Risk: pull requests are also issues in GitHub's REST model.
  Severity: high.
  Likelihood: high.
  Mitigation: make the link explicit. A pull request fixture must either carry
  or derive an issue key for the same repository and number. Issue endpoints
  may include pull requests only when the tested contract requires it; broad
  issue collaboration remains phase 8.

- Risk: GitHub docs and runtime schemas expose far more fields than this task
  should implement.
  Severity: medium.
  Likelihood: high.
  Mitigation: keep schemas minimal but GitHub-shaped. Include only identity,
  owner/repo coordinates, number or SHA, state, title/body where relevant,
  author login, timestamps, base/head refs for pull requests, and commit parent
  linkage needed for phase 2 history.

- Risk: existing GraphQL tests often assert only `errors === undefined`, which
  can hide semantic regressions.
  Severity: medium.
  Likelihood: high.
  Mitigation: add behavioural GraphQL tests that assert returned entity ids,
  names, numbers, states, SHAs, pagination counts, and owner scoping.

- Risk: REST handlers are only registered when `initialState` is present, while
  schema stubs can respond without first-class state.
  Severity: medium.
  Likelihood: medium.
  Mitigation: tests for new scriptable REST behaviour must seed `initialState`
  and assert 404 or empty results for missing entities. Documentation must
  continue to distinguish schema-stubbed from state-backed behaviour.

- Risk: generated ids and timestamps can make tests flaky.
  Severity: medium.
  Likelihood: medium.
  Mitigation: follow the repository id precedent with resettable counters for
  numeric defaults where needed. In tests, provide explicit ids and ISO
  timestamps unless the test is about defaulting.

- Risk: canonical key grammar can accidentally make different entity kinds
  collide.
  Severity: high.
  Likelihood: low.
  Mitigation: use entity-specific prefixes in node ids and entity-specific key
  helper names. Add property tests proving distinct coordinates produce
  distinct keys within each entity type and that parsers round-trip valid
  generated parts.

- Risk: adding nested GraphQL conversion for refs, commits, issues, and pull
  requests may require types from the enterprise schema rather than the public
  schema described in the audit.
  Severity: medium.
  Likelihood: medium.
  Mitigation: inspect `src/__generated__/resolvers-types.ts` and the runtime
  `schema/schema.docs-enterprise.graphql` before writing converters. Keep tests
  aligned to the runtime schema.

## Progress

- [x] (2026-05-10T12:11:35Z) Drafted the planning brief after loading the
  `execplans`, `leta`, `hexagonal-architecture`, and Firecrawl workflows.
- [x] (2026-05-10T12:11:35Z) Confirmed the current branch is
  `feat/plan-first-class-entities`, not a default branch.
- [x] (2026-05-10T12:11:35Z) Used a Wyvern agent team for read-only
  reconnaissance across store/fixtures, API contracts, and documentation/test
  obligations.
- [x] (2026-05-10T12:11:35Z) Used Firecrawl to inspect current official GitHub
  REST documentation for refs, commits, issues, and pull requests, plus
  LemmaScript maturity.
- [x] (2026-05-10T12:25:00Z) Attempted `coderabbit review --agent` for the
  planning milestone; it could not run because the account has no remaining
  usage credits.
- [x] (2026-05-10T12:50:30Z) Received explicit user approval to implement the
  planned functionality.
- [x] (2026-05-10T12:50:30Z) Confirmed the branch is
  `1-1-2-first-class-entities-for-early-slices`; the branch rename and upstream
  tracking were completed before implementation resumed.
- [x] (2026-05-10T13:02:44Z) Implemented milestone A test coverage for key
  round trips, defaulted initial-state collections, duplicate detection,
  owner-scoped REST reads, and GraphQL repository reads. The first focused
  test run exposed a numbered-key generator gap for `#` and `!` separators.
- [x] (2026-05-10T13:02:44Z) Implemented milestone B store schemas, key
  helpers, parsers, public builders, store slices, and selectors for refs,
  commits, issues, and pull requests.
- [x] (2026-05-10T13:02:44Z) Implemented milestone C's narrow state-backed
  REST and GraphQL reads for git refs, git commits, issue list/detail, pull
  request list/detail, `Repository.ref`, `Repository.issues`,
  `Repository.pullRequests`, and seeded `defaultBranchRef`.
- [x] (2026-05-10T13:11:58Z) Ran `coderabbit review --agent` after the
  store/API milestone. CodeRabbit completed successfully and reported 15
  findings; all were addressed with type-aware ref object URLs, message-body
  parsing, timestamp/default factories, and JSDoc additions.
- [x] (2026-05-10T14:01:03Z) Implemented milestone D documentation and
  roadmap completion. Updated API, architecture, user, development, roadmap,
  and ExecPlan documents in the implementation branch.
- [x] (2026-05-10T14:01:03Z) Cleared successive CodeRabbit review findings
  covering ref validation, ref object URL construction, generated ID offsets,
  shared fixture defaults, PR state conversion, repository wrapping,
  selector-builder typing, and schema JSDoc.
- [x] (2026-05-10T14:01:03Z) Final verification passed:
  `make check-fmt`, `make lint`, `make typecheck`, `make test`, and
  `make markdownlint`. The final `make test` run reported 167 passing tests,
  0 failures, and 2079 assertions across 12 files.
- [x] (2026-05-10T14:01:03Z) Final `coderabbit review --agent` completed with
  `findings: 0`.

## Surprises & discoveries

- Observation: `docs/developers-guide.md` does not exist.
  Evidence: repository file listing contains `docs/development.md` instead.
  Impact: implementation must update `docs/development.md` for developer
  practice and architecture notes.

- Observation: the context-pack Model Context Protocol (MCP) server has no
  existing context pack for this task.
  Evidence: `context_pack.output` returned no packs for the first-class entity
  query.
  Impact: the plan relies on direct repository inspection and Wyvern reports.

- Observation: LemmaScript is a tech-preview TypeScript verification toolchain
  that relies on `//@` specifications and external Dafny or Lean tooling.
  Evidence: Firecrawl result for
  `https://github.com/midspiral/LemmaScript/blob/main/README.md`.
  Impact: property tests are the default proof method for key grammar and
  repository scoping. If implementation introduces a true business axiom that
  needs exhaustive proof, dependency/tooling approval is required first.

- Observation: CodeRabbit review is blocked by account usage credits.
  Evidence: `coderabbit review --agent` failed with "You've run out of usage
  credits" during the planning milestone review.
  Impact: implementation must either wait for CodeRabbit credits to be restored
  before each milestone review or receive explicit approval to use an alternate
  review path.

- Observation: `leta files` failed to start its daemon inside the read-only
  sandbox, but the already-added workspace could be queried after elevated
  execution.
  Evidence: the first `leta files src` and `leta files tests` attempts returned
  "Error: Failed to start daemon"; `leta workspace add` reported the workspace
  already existed, and an elevated `leta files src` listed the source tree.
  Impact: continue to use `leta` for code navigation where it starts cleanly,
  and use direct file reads for Markdown and focused implementation context.

- Observation: this repository is currently on Zod 3.25.76, not Zod 4.
  Evidence: `bun install` reported `zod@3.25.76`, and `package.json` pins
  `^3.24.1`.
  Impact: new schemas use the repository's existing Zod 3 idioms, including
  `z.string().email()`, instead of introducing Zod 4-only constructors.

- Observation: local server tests cannot bind ports inside the read-only,
  network-restricted sandbox even when no process owns the port.
  Evidence: `bun test --max-concurrency=1 tests/repositories.test.ts` failed
  with "Failed to start server. Is port 3320 in use?", while elevated
  `ss -ltnp 'sport = :3320 or sport = :3400'` showed no listener. The same
  tests passed when run with elevated permissions.
  Impact: REST, GraphQL, and full `make test` gates must run outside the
  network-restricted sandbox so the simulator can bind local test ports.

- Observation: CodeRabbit review completed for the implementation milestone.
  Evidence: `coderabbit review --agent` returned 15 findings, including one
  major finding that `githubRefSchema` treated every ref object URL as a
  commit URL.
  Impact: the implementation now maps supported ref object URL fallbacks by
  object type and deliberately restricts early refs to commit and tag targets.
  It also includes the requested documentation comments, shared defaults, and
  stricter validation.

- Observation: CodeRabbit review converged after several small follow-up
  passes.
  Evidence: later `coderabbit review --agent` runs reported findings around
  generated ID offsets, deterministic/default timestamp centralization,
  PR-state mapping, GraphQL repository wrapping, empty `ref` strings, and
  schema JSDoc before the final pass returned `findings: 0`.
  Impact: the final implementation has a shared early-entity defaults module,
  explicit generated-ID band documentation, an exhaustive PR-state converter,
  consistent minimal repository GraphQL references, and stricter ref input
  validation.

## Decision log

- Decision: keep this task focused on entity foundations, not full endpoint
  parity.
  Rationale: `docs/roadmap.md` says 1.1.2 should cover refs, commits, issues,
  and pull requests only to the depth needed by phases 2 and 3. The REST and
  GraphQL audits warn that broad schema coverage is not the same as scriptable
  behaviour.
  Date/Author: 2026-05-10T12:11:35Z / Codex.

- Decision: use store entities and selectors as the domain boundary, with REST
  and GraphQL as adapters.
  Rationale: this follows the project architecture and the
  `hexagonal-architecture` skill without forcing a new directory layout.
  Date/Author: 2026-05-10T12:11:35Z / Codex.

- Decision: treat pull requests as linked to issues but not as a reason to
  implement broad issue collaboration.
  Rationale: GitHub's REST issue documentation states that pull requests appear
  in the issue model, but roadmap phase 8 owns deeper issue collaboration.
  Date/Author: 2026-05-10T12:11:35Z / Codex.

- Decision: do not add LemmaScript as part of the draft plan's default path.
  Rationale: the expected invariants are key grammar, duplicate rejection, and
  owner-scoped lookup properties, which are well suited to `fast-check`
  property tests already available in the repository. LemmaScript remains an
  escalation path for a substantive axiom introduced during implementation.
  Date/Author: 2026-05-10T12:11:35Z / Codex.

- Decision: proceed with implementation despite the previously observed
  CodeRabbit usage-credit blockage, but re-run `coderabbit review --agent`
  after each milestone and record the exact outcome.
  Rationale: the user explicitly asked to proceed with implementation and to
  use CodeRabbit after each major milestone. The plan will continue to surface
  the review blockage rather than silently skipping it.
  Date/Author: 2026-05-10T12:50:30Z / Codex.

- Decision: split early entity selectors out of `src/store/index.ts` into
  `src/store/early-entity-selectors.ts`.
  Rationale: adding the new selector family pushed `src/store/index.ts` over
  the project 400-line file-size constraint. The split keeps store wiring in
  `src/store/index.ts` and keeps repository-owned entity lookup policy in a
  focused feature file.
  Date/Author: 2026-05-10T13:02:44Z / Codex.

- Decision: expose only narrow state-backed GraphQL fields in this slice.
  Rationale: the generated schema contains far richer `Commit`, `Issue`,
  `PullRequest`, and `Ref` contracts than 1.1.2 requires. The implementation
  backs the fields proven by behavioural tests and leaves wider collaboration
  and mergeability surfaces to later roadmap slices.
  Date/Author: 2026-05-10T13:02:44Z / Codex.

- Decision: mark roadmap item 1.1.2 done only after the code and documentation
  were both updated in this branch.
  Rationale: the roadmap entry's success condition is no route-local state for
  phase 2 and phase 3 fixtures. The store schemas, selectors, public builders,
  REST reads, GraphQL reads, and documentation updates now describe and test
  that contract.
  Date/Author: 2026-05-10T13:11:58Z / Codex.

## Outcomes & retrospective

The implementation is complete and ready for review. Simulacat Core now has
first-class fixture schemas, keyed store tables, selectors, public builders,
REST reads, and narrow GraphQL repository reads for refs, commits, issues, and
pull requests. The model remains intentionally narrow: reviews, labels,
timelines, statuses, checks, broad mergeability behaviour, and mutation
workflows remain deferred to later roadmap slices.

Final verification passed on 2026-05-10:

- `make check-fmt`
- `make lint`
- `make typecheck`
- `make test` (`167 pass`, `0 fail`, `2079 expect() calls`, 12 files)
- `make markdownlint`
- `coderabbit review --agent` (`findings: 0`)

## Context and orientation

The repository is a TypeScript package using Bun, Biome, GraphQL Yoga, Zod, and
`@simulacrum/foundation-simulator`. The public factory is `simulation()` in
`src/index.ts`. It parses `initialState` with `githubInitialStoreSchema` from
`src/store/entities.ts`, converts arrays into keyed store tables with
`convertInitialStateToStoreState`, wires selectors through `extendStore()` in
`src/store/index.ts`, then exposes REST and GraphQL adapters.

Existing store slices are:

- `users`
- `installations`
- `repositories`
- `branches`
- `organizations`
- `blobs`

Existing canonical key helpers live in `src/store/keys.ts` and entity modules:

- `repositoryStoreKey({owner, name})` -> `owner/name`
- `branchStoreKey({owner, repo, name})` -> `owner/repo:name`
- `blobStoreKey({owner, repo, path?, sha?})` -> `owner/repo:reference`

Current public fixture builders live in `src/store/builders.ts`:

- `buildRepositoryFixture(input)`
- `buildBranchFixture(input)`

The GraphQL conversion path is deliberately narrow. `src/graphql/to-graphql.ts`
dispatches only `User`, `Organization`, and `Repository`. Repository GraphQL
conversion in `src/graphql/converters/repository.ts` currently creates a
placeholder `defaultBranchRef` with an id and name, not a first-class ref with
a target commit. The resolver map in `src/graphql/resolvers.ts` implements only
top-level user, organization, and repository reads.

The relevant documentation says:

- `docs/architecture.md` describes the current state model and extension seams.
- `docs/api-reference.md` lists exported fixture schemas and the capability
  matrix.
- `docs/github-rest-api-audit.md` says issues, pulls, and richer git state are
  mostly stub-only today.
- `docs/github-graphql-api-audit.md` says GraphQL exposes a broad schema but
  implements only a narrow read model.
- `docs/development.md` defines Makefile targets and testing expectations.
- `docs/users-guide.md` explains canonical keys from the 1.1.1 work.
- `docs/execplans/1-1-1-re-key-repositories-and-refs-by-canonical-identifiers.md`
  is the completed predecessor plan.

Firecrawl research against GitHub's official REST docs found these design
anchors:

- Git refs are repository-scoped references whose response shape includes
  `ref`, `node_id`, `url`, and `object`.
- Git commit objects need an SHA, message, tree reference, parent commits, and
  author/committer metadata.
- Issues need at least id, node id, number, state, title, body, user, URLs, and
  timestamps; the issue API treats pull requests as issues.
- Pull requests need at least number, state, title, body, user, base, head,
  created/updated/closed/merged timestamps, mergeability placeholder fields,
  and draft state.

## Plan of work

Milestone A is a design and red-test milestone. Before writing implementation
code, rename the branch to
`1-1-2-first-class-entities-for-early-slices`, confirm it is tracking
`origin/1-1-2-first-class-entities-for-early-slices` after the first push, and
record the result in `Progress`. Then inspect the runtime GraphQL enterprise
schema and generated resolver types for the exact names and nullability of
`Ref`, `Commit`, `Issue`, and `PullRequest` fields that are already present.
Do not regenerate schema files unless types are stale.

Write failing tests first. Extend `tests/store-keys.test.ts` or create a
focused `tests/early-entities-keys.test.ts` for key helpers and parsers. Extend
`tests/entities.test.ts` or create `tests/early-entities.test.ts` for schema
defaults, duplicate-key failures, and `convertInitialStateToStoreState`.
Include `fast-check` properties for key round trips and owner/repository
separation. Add behavioural tests for the externally observable reads that
1.1.2 claims: repository-scoped ref and commit lookup, issue list/detail, and
pull request list/detail at the minimum depth needed by phases 2 and 3. These
tests should fail before implementation because the slices and selectors do
not exist.

Milestone B adds the store foundation. Create small entity modules under
`src/store/entities/` for commits, refs, issues, and pull requests. Prefer
these stable names unless implementation reveals a conflict:
`commit.ts`, `ref.ts`, `issue.ts`, and `pull-request.ts`. Each module must
start with a `/** @file ... */` block, define a Zod schema, export the inferred
type, and provide the canonical store-key helper where the helper is
entity-specific.

Use these key formats unless Milestone A proves they conflict with a runtime
schema requirement:

```plaintext
Repository ref: owner/repo:qualifiedName
Commit: owner/repo:sha
Issue: owner/repo#number
Pull request: owner/repo!number
```

The punctuation deliberately separates issue and pull request number spaces in
store keys while still allowing pull requests to link to an issue number. If a
parser would become ambiguous because branch and ref names can contain `/`,
parse the repository prefix with the existing `owner/name` parser and treat
the terminal segment as opaque except for the entity's structural separator.

In `src/store/entities.ts`, add optional defaulted arrays for the new
collections, export the schemas and types, and convert the parsed arrays into
keyed tables. In `src/store/index.ts`, add slices for the new tables and
selectors for:

- get a repository by owner/name, unchanged from 1.1.1;
- get/list refs for an owner/repo;
- get a commit by owner/repo/SHA;
- list commits reachable from a ref at the shallow depth this slice supports;
- get/list issues for an owner/repo and issue number;
- get/list pull requests for an owner/repo and pull request number;
- resolve a pull request's base/head refs and linked issue when present.

In `src/store/builders.ts`, add public builders:

- `buildRefFixture(input)`
- `buildCommitFixture(input)`
- `buildIssueFixture(input)`
- `buildPullRequestFixture(input)`

In `src/index.ts`, export the new builders, input types, schemas, entity
types, key helpers, parser helpers, and node-id helpers. Existing exports must
remain unchanged.

Milestone C wires the minimum adapters. Add REST handlers only for endpoints
that can be made state-backed with the new slices and that are needed as
observable proof for early consumers. Good first candidates are repository
git-ref reads, git-commit reads, issue list/get, and pull request list/get.
Keep create/update/close/reopen pull request flows deferred to phase 3 unless
the red tests prove they are necessary for 1.1.2 success. Add response builders
to `src/rest/utils.ts` only when they remove real duplication.

For GraphQL, add conversion shapes and converter modules only for fields
exercised by the behavioural tests. The target is not schema-wide parity. The
minimum useful shape is:

- `Repository.ref(qualifiedName)` returns a ref with a name/prefix and commit
  target where the runtime schema supports it.
- `Repository.issues(first: ...)` returns seeded issues with meaningful ids,
  numbers, states, titles, and bodies.
- `Repository.pullRequests(first: ...)` returns seeded pull requests with
  meaningful ids, numbers, states, titles, base/head names, and draft status.
- `Repository.defaultBranchRef` points at a seeded ref when one exists, falling
  back to the existing placeholder only when no seeded ref exists.

If generated resolver type constraints make any one of those fields much
larger than this task's entity foundation, document the deferral and keep the
surface out of the supported matrix.

Milestone D completes documentation, review, and publication mechanics. Update
`docs/architecture.md` with the new state slices and selector responsibilities.
Update `docs/api-reference.md` with the exported schemas, builders, key
formats, and capability matrix changes. Update `docs/users-guide.md` with
fixture examples and user-facing behaviour changes. Update
`docs/development.md` with developer guidance for early entity fixtures,
property tests, and any formal-proof decision. Update the REST and GraphQL
audits only where classifications actually changed. Mark roadmap task 1.1.2
done only after the gates pass.

After each major milestone, run `coderabbit review --agent`, clear every
concern, and record the outcome in this plan. Commit after each gated
milestone using the `commit-message` skill's file-based commit message
workflow. At the end, push the branch and create a draft PR. The PR title must
include `(1.1.2)`, and the PR summary must mention this ExecPlan file.

## Concrete steps

All commands run from the repository root:

```plaintext
/home/leynos/.lody/repos/github---leynos---simulacat-core/worktrees/17695ba9-8a3b-4798-b0aa-b3f8e23b16ff
```

Before implementation:

```bash
git branch --show-current
git status --short
git branch -m 1-1-2-first-class-entities-for-early-slices
git push -u origin 1-1-2-first-class-entities-for-early-slices
```

Expected branch evidence:

```plaintext
1-1-2-first-class-entities-for-early-slices
```

Inspect the existing shapes before editing:

```bash
leta workspace add /home/leynos/.lody/repos/github---leynos---simulacat-core/worktrees/17695ba9-8a3b-4798-b0aa-b3f8e23b16ff
leta grep "github.*Schema" "src/store/entities" -k variable
leta grep "convert.*ToGraphql" "src/graphql" -k function
rg 'type (Ref|PullRequest|Issue|Commit)|interface (Ref|PullRequest|Issue|Commit)' \
  src/__generated__/resolvers-types.ts \
  schema/schema.docs-enterprise.graphql
```

After writing red tests for a milestone, run the focused tests and capture the
expected failure:

```bash
bun test --max-concurrency=1 tests/early-entities.test.ts
bun test --max-concurrency=1 tests/early-entities-keys.test.ts
```

After each implementation milestone, run gates sequentially and tee long
outputs to `/tmp`:

```bash
make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-1-1-2-first-class-entities.out
make lint 2>&1 | tee /tmp/lint-simulacat-core-1-1-2-first-class-entities.out
make typecheck 2>&1 | tee /tmp/typecheck-simulacat-core-1-1-2-first-class-entities.out
make test 2>&1 | tee /tmp/test-simulacat-core-1-1-2-first-class-entities.out
make markdownlint 2>&1 | tee /tmp/markdownlint-simulacat-core-1-1-2-first-class-entities.out
```

Run CodeRabbit after each major milestone:

```bash
coderabbit review --agent
```

At completion, after the full gate sequence and CodeRabbit review pass:

```bash
git status --short
git push
gh pr create --draft
```

Use the interactive PR flow only if it is already configured. Otherwise, use a
file-backed PR body. The title must contain `(1.1.2)` and the body must mention
`docs/execplans/1-1-2-first-class-entities-for-early-slices.md`.

## Validation and acceptance

The change is acceptable only when all of the following are true:

- Existing 1.1.1 cross-owner repository and branch tests still pass.
- New unit tests prove schema parsing, defaults, duplicate detection, builders,
  key helpers, parsers, and store conversion for refs, commits, issues, and
  pull requests.
- New property tests with `fast-check` prove key round trips and owner-scoped
  separation for every new key helper. They also prove entity keys do not
  collapse when two owners have repositories with the same short name.
- New behavioural tests prove seeded refs, commits, issues, and pull requests
  can be expressed without route-local state and can be read through the
  minimum REST and GraphQL surfaces implemented in this slice.
- Negative tests prove unknown owner/repo/entity lookups do not fall through to
  another owner and return the documented 404, `null`, or empty connection
  shape.
- Documentation accurately separates state-backed support from schema stubs and
  deferred surfaces.
- `docs/roadmap.md` marks item 1.1.2 done only after implementation gates pass.
- `make check-fmt`, `make lint`, `make typecheck`, `make test`, and
  `make markdownlint` pass sequentially.
- `coderabbit review --agent` has been run after each major milestone and all
  concerns are either resolved or explicitly escalated.
- The branch is pushed and a draft PR exists with `(1.1.2)` in the title and
  this ExecPlan referenced in the summary.

Expected gate evidence is a set of passing summaries in `/tmp` logs. If a log
is truncated in the terminal, inspect the corresponding `/tmp/*.out` file
before committing.

## Idempotence and recovery

Most steps are additive and can be repeated. Re-running schema parsing tests,
property tests, and Makefile gates is safe. If a formatting command mutates
files, inspect `git diff` before staging.

If a milestone fails, keep the failing test or log, update `Progress`,
`Surprises & Discoveries`, and `Decision log`, then fix within tolerance. If
the work crosses a tolerance, stop before broadening the implementation.

If branch rename or push fails because the remote branch already exists, stop
and inspect `git branch -vv` and `git remote -v`. Do not force-push unless the
user explicitly asks for that operation.

If generated GraphQL resolver types change unexpectedly, do not revert blindly.
Inspect the generator input and decide whether the diff is required for this
task. If it is unrelated, stop and ask for direction.

## Artifacts and notes

Wyvern team findings used in this draft:

- Store reconnaissance found `githubInitialStoreSchema`,
  `convertInitialStateToStoreState`, `src/store/keys.ts`,
  `src/store/builders.ts`, and `src/index.ts` as the core store and public API
  touchpoints.
- API reconnaissance found REST and GraphQL are intentionally narrow today and
  warned against upgrading schema-present fields to "supported" without
  state-backed handlers and semantic tests.
- Documentation reconnaissance found `docs/development.md` is the real
  developer guide and recommended full gates plus Markdown linting.

External documentation checked with Firecrawl:

- GitHub REST refs documentation[^1]
- GitHub REST git commits documentation[^2]
- GitHub REST issues documentation[^3]
- GitHub REST pull requests documentation[^4]
- LemmaScript README[^5]

[^1]: <https://docs.github.com/rest/git/refs>
[^2]: <https://docs.github.com/en/rest/git/commits>
[^3]: <https://docs.github.com/rest/issues/issues>
[^4]: <https://docs.github.com/en/rest/pulls/pulls>
[^5]: <https://github.com/midspiral/LemmaScript/blob/main/README.md>

## Interfaces and dependencies

New public interfaces should follow these names unless implementation reveals a
specific conflict:

```typescript
export const githubRefSchema: z.ZodType<GitHubRef>;
export const githubCommitSchema: z.ZodType<GitHubCommit>;
export const githubIssueSchema: z.ZodType<GitHubIssue>;
export const githubPullRequestSchema: z.ZodType<GitHubPullRequest>;

export type GitHubRef = z.infer<typeof githubRefSchema>;
export type GitHubCommit = z.infer<typeof githubCommitSchema>;
export type GitHubIssue = z.infer<typeof githubIssueSchema>;
export type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;

export const refStoreKey: (ref: {owner: string; repo: string; qualifiedName: string}) => string;
export const commitStoreKey: (commit: {owner: string; repo: string; sha: string}) => string;
export const issueStoreKey: (issue: {owner: string; repo: string; number: number}) => string;
export const pullRequestStoreKey: (pullRequest: {owner: string; repo: string; number: number}) => string;

export const parseRefStoreKey: (key: string) => {owner: string; repo: string; qualifiedName: string};
export const parseCommitStoreKey: (key: string) => {owner: string; repo: string; sha: string};
export const parseIssueStoreKey: (key: string) => {owner: string; repo: string; number: number};
export const parsePullRequestStoreKey: (key: string) => {owner: string; repo: string; number: number};

export const buildRefFixture: (input: RefFixtureInput) => GitHubRef;
export const buildCommitFixture: (input: CommitFixtureInput) => GitHubCommit;
export const buildIssueFixture: (input: IssueFixtureInput) => GitHubIssue;
export const buildPullRequestFixture: (input: PullRequestFixtureInput) => GitHubPullRequest;
```

Minimal entity field guidance:

- `GitHubRef`: `owner`, `repo`, `qualifiedName`, `ref`, `node_id`, `url`,
  `object: {type, sha, url}`.
- `GitHubCommit`: `owner`, `repo`, `sha`, `node_id`, `url`, `html_url`,
  `message`, `tree`, `parents`, `author`, `committer`, `created_at`.
- `GitHubIssue`: `owner`, `repo`, `id`, `node_id`, `number`, `state`, `title`,
  `body`, `user`, `pull_request?`, `created_at`, `updated_at`, `closed_at?`.
- `GitHubPullRequest`: `owner`, `repo`, `id`, `node_id`, `number`, `state`,
  `title`, `body`, `user`, `base`, `head`, `draft`, `issue_number`,
  `created_at`, `updated_at`, `closed_at?`, `merged_at?`, `mergeable?`.

No new runtime dependency is expected. Use existing `zod`, `@faker-js/faker`,
`fast-check`, Bun test, Biome, and GraphQL generated types.

## Revision note

Initial draft created on 2026-05-10. It captures the requested 1.1.2
implementation strategy, Wyvern reconnaissance, Firecrawl research, approval
gate, milestones, validation, documentation, CodeRabbit review, branch/PR
requirements, and tolerance thresholds. The remaining work is blocked on
explicit user approval.
