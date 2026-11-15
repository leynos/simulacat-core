# 1.5.1 Add first-class repository label entities and builders

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, `Outcomes & retrospective`, `Conformance basis`, and
`Verification plan` must be kept up to date as work proceeds.

Status: DRAFT (design review applied; awaiting user approval)

Branch: `1-5-1-first-class-repository-label-entities`, stacked on
`refresh-shared-spelling-policy` (a one-commit base branch that only
regenerates `typos.toml`; see `Surprises & discoveries`).

Roadmap item: `1.5.1` in `docs/roadmap.md`, step 1.5 "Add mutable repository
labels as an early vertical slice".

Approval gate: do not implement any milestone in this plan until the user
explicitly approves it. Silence, a merged review, or a passing CI run is not
approval.

## Purpose / big picture

Simulacat Core is a GitHub API simulator written in TypeScript. A test author
gives it an `initialState` object (users, organizations, repositories, issues,
and so on). The simulator validates that object with Zod (a runtime schema
validation library), stores the result in keyed in-memory tables, and answers
REST and GraphQL requests from those tables.

Today the simulator has no notion of a repository label. A label is the small
coloured tag GitHub attaches to issues and pull requests, such as `bug` with
colour `f29513`. Labels belong to exactly one repository. The downstream
project simulacat (a pytest plugin that drives this simulator through the
Python client `github3.py`) needs label create, lookup, and update to work
against real simulator state. Roadmap step 1.5 delivers that as a narrow
vertical slice. This task, 1.5.1, lays the state foundation only: the label
entity, its canonical key, identifier allocation, selectors, a fixture
builder, and request-scoped URL projection. The REST handlers (`GET`, `POST`,
`PATCH`) belong to 1.5.2, and the upstream `github3.py` contract tests belong
to 1.5.3.

After this work a fixture author can write:

```typescript
import {buildLabelFixture, labelStoreKey, simulation, type InitialState} from 'simulacat-core';

const initialState: InitialState = {
  users: [],
  organizations: [{login: 'acme'}],
  repositories: [{owner: 'acme', name: 'awesome-repo'}],
  branches: [],
  blobs: [],
  labels: [
    {owner: 'acme', repo: 'awesome-repo', name: 'Bug', color: 'f29513', description: "Something isn't working"},
    buildLabelFixture({owner: 'acme', repo: 'awesome-repo', name: 'good first issue', color: '7057ff'})
  ]
};

const server = await simulation({initialState}).listen(0);
const state = server.simulationStore.store.getState();
server.simulationStore.selectors.getLabel(state, {owner: 'acme', repo: 'awesome-repo', name: 'BUG'});
// -> {owner: 'acme', repo: 'awesome-repo', name: 'Bug', color: 'f29513',
//     description: "Something isn't working", default: false,
//     id: 1000001, node_id: <Base64 of "Label:1000001">}
labelStoreKey({owner: 'acme', repo: 'awesome-repo', name: '  Good First Issue '});
// -> 'acme/awesome-repo:good first issue'
```

Identifiers are allocated when the seed is loaded, in canonical-key order, so
`Bug` (key `acme/awesome-repo:bug`) receives `1000001` and `good first issue`
receives `1000002` regardless of their order in the array.

Today the same `initialState` is rejected because `labels` is not a recognized
collection, and there is no selector, key helper, or builder for labels.

Observable success, matching the roadmap's success line, is that labels can be
seeded in `initialState`, selected by repository and name, and serialized as
flat records rather than raw nested dictionaries. Concretely: the new
behavioural feature `features/repository-labels.feature` passes, the new
users-guide examples `seed-repository-labels` and `label-store-key` execute
and print the documented output, `make all`, `make build`, and the new
`make prove` succeed.

Existing behaviour is preserved: every current `initialState` shape still
parses because `labels` defaults to an empty array. No existing export changes
signature. No REST or GraphQL route changes behaviour in this task. The only
change to existing code paths is that the private branch, blob, ref, and
commit key parser delegates its splitting to the newly proved key-grammar
module, with identical results and error messages.

### Glossary

- Canonical key: the string under which an entity is stored in its table, for
  example `acme/awesome-repo:bug` for a label.
- Canonical label name: a label name after trimming surrounding whitespace and
  lower-casing with `String.prototype.toLowerCase()`.
- Key segment: a non-empty string containing neither `/` nor `:`; owners and
  repository names in keys must be key segments.
- Foundation simulator: the `@simulacrum/foundation-simulator` package that
  provides the store, tables, selectors, and HTTP server this project extends.
- starfx: the state library underneath the foundation simulator; its
  `slice.table` provides keyed tables with `add`, `remove`, and `selectById`.
- Seed: the parsed `initialState`; seeding is the one-off parse and table
  construction performed by `simulation()`.
- Plateau: a milestone end state that is correct, coherent, gated, and safe to
  stop at.
- LemmaScript: a toolchain that turns TypeScript annotated with `//@` comments
  into Dafny, a verification-aware language whose verifier proves the
  annotated contracts for all inputs.
- Non-vacuity: evidence that a test or proof could fail, for example a witness
  input satisfying the preconditions.
- Negative control: a deliberate, temporary bug that the verification must
  reject, proving the check is sensitive to the defect it targets.

## Constraints

- Do not implement until the user explicitly approves this plan.
- Work on branch `1-5-1-first-class-repository-label-entities`. Never commit
  to `main`. Keep the branch stacked on `refresh-shared-spelling-policy` until
  that base branch merges, then rebase onto `main`.
- Preserve every existing export from `src/index.ts` and its signature. Adding
  the exports listed in `Interfaces and dependencies` is authorized; removing
  or changing existing ones is not.
- `githubInitialStoreSchema` must keep accepting every existing fixture shape.
  The new `labels` collection must be optional with a default of `[]`.
- Labels are repository-scoped state in their own `labels` store table keyed
  by `owner/repo:<canonical label name>` (D1). Labels must not be stored as
  nested dictionaries inside repository records.
- Domain and policy logic lives in Zod-free, framework-free modules:
  `src/store/repository-scoped-key.ts` (proved key grammar),
  `src/store/entities/label-id.ts` (proved identifier allocation), and
  `src/store/entities/label-policy.ts` (canonical names, keys, seed
  validation predicates, and pure table lookups). These modules must not
  import Zod, starfx, Express, or the foundation simulator. The Zod schema in
  `src/store/entities/label.ts` is the seeding adapter. This applies the
  `hexagonal-architecture` skill as a boundary check, not a directory
  transplant: no `domain/` or `ports/` tree is introduced.
- No REST handler, GraphQL resolver, OpenAPI route registration, or write
  action for labels is added in 1.5.1 (D13). `Forward constraints for 1.5.2
  and 8.2.2` records what those tasks must honour.
- No new runtime dependency and no new `package.json` devDependency.
  LemmaScript runs through a pinned `npx` command (D14).
- Every source and test file stays at or below 400 lines (AGENTS.md).
  `src/store/index.ts` is 427 lines at the base revision and must end this
  task at or below 400 (D15).
- New exported symbols carry full JSDoc so the zero-tolerance TypeDoc gate
  (`make docs-check`) passes. Do not add entries to `.jsdoc-baseline.json`.
- Lint policy from `docs/developers-guide.md` §"Linting rules" applies: Biome
  `noExcessiveLinesPerFunction` 70 and `noExcessiveCognitiveComplexity` 8;
  Oxlint complexity 8, `max-depth` 3, `df12/complex-conditional` (at most one
  logical operator per condition), `df12/require-module-jsdoc` (every module
  starts with a `/** @file … */` block), and unicorn rules such as
  `no-array-reduce` and `no-array-sort` (use `toSorted`).
- The spelling gate uses the `en-gb` locale and rejects `color` outside code
  spans. The GitHub wire field `color` must be admitted with narrow
  `typos.local.toml` ignore patterns, never with a bare accepted word, and
  `typos.toml` must be regenerated with `make spelling`, not edited.
- Documentation uses en-GB Oxford spelling, 80-column wrapping, and
  `docs/documentation-style-guide.md`.
- Every commit passes the full gate list in `Concrete steps` (the same targets
  CI runs: `make all`, which is `check-fmt typecheck docs-check lint test
  spelling`, plus `make build`), and `make prove` from `EP-M2` onwards.
  Documentation commits also pass `make markdownlint` and `make nixie`.
- Historical ExecPlans in `docs/execplans/` other than this file must not be
  edited.

## Tolerances (exception triggers)

Comparison base: `refresh-shared-spelling-policy` (which is `origin/main` at
`c2e5ddcb8092c327003f92916fe8e4a7befd5037` plus the regenerated `typos.toml`).
Count with:

```sh
git diff --numstat refresh-shared-spelling-policy -- . \
  ':(exclude)docs/execplans/*' ':(exclude)*.dfy.gen'
```

This ExecPlan file is excluded from every count. Generated `*.dfy.gen` files
written by `lsc gen` and the regenerated `typos.toml` are excluded as
generated artefacts; handwritten `*.dfy` proof files count as code.
Classification is whole-file by purpose: `src/**`, `tests/**`, `features/**`,
`*.dfy`, `scripts/**`, and `Makefile` are code; `LemmaScript-files.txt`,
`typos.local.toml`, the proof stamp file, `package.json`, and CI workflows are
configuration; `docs/**` (except ExecPlans), `README.md`, and `CHANGELOG.md`
are documentation. All limits are net lines (additions minus deletions),
enforced independently per category.

- Files: if more than 42 non-ExecPlan files change, stop and escalate.
- Code: if code changes exceed 2,300 net lines, stop and escalate.
- Configuration: if configuration changes exceed 40 net lines, stop and
  escalate.
- Documentation: if documentation changes exceed 420 net lines, stop and
  escalate.
- Interface: any public API change beyond `Interfaces and dependencies`, or
  any change to an existing export, requires escalation.
- Dependencies: no new runtime or development dependency. If LemmaScript
  cannot run through the pinned `npx` invocation, stop and escalate rather than
  adding it to `package.json`.
- Architecture: if 1.5.1 appears to need a REST handler, GraphQL resolver, or
  write action, or if case-insensitive keys (D1) prove incompatible with the
  foundation simulator's table API, stop and escalate.
- Behaviour preservation: if delegating the existing branch, blob, ref, and
  commit key parser to the proved grammar changes any existing test result or
  error message, stop and escalate.
- Proof: if `EP-M0` cannot verify both proof targets within four working
  hours, or verification requires `//@ assume` on anything other than a
  deliberately havocked value (a value the prover is told to treat as
  arbitrary), stop and escalate.
- Iterations: if a gate still fails after three fix attempts for the same
  cause, stop and escalate.
- Time: if any milestone exceeds one working day, stop and escalate.
- Ambiguity: if a GitHub behaviour this plan relies on (case-insensitive label
  names, colour format and case, description length) is contradicted by
  evidence, stop and present options.

Budget survey. The closest precedent is
`docs/execplans/1-1-2-first-class-entities-for-early-slices.md`, which added
four entities with a 22-file, 1,200 net-source-line tolerance (documentation
and generated files excluded). Its decision log records no budget increase,
but it forced an unplanned structural move (selectors into
`src/store/early-entity-selectors.ts`) because `src/store/index.ts` crossed 400
lines. Plans 1.1.1 (12 files, 600 lines), 1.2.1 (16 files, 700), 1.2.2 (18
files, 900), 1.3.1 (about 12 files, about 500 non-test lines), and 1.4.1
(about 600 lines per milestone) record no budget increases and no final diff
sizes, so there is no evidence of systematic underestimation, only the
recurring `src/store/index.ts` size pressure, which `EP-M1` schedules. The
design review counted the first draft's file list at 34 to 35 files against a
34-file limit; this revision adds two modules and a stamp test, so the limit
is set to 42.

The estimate, from tracing every affected caller and test:

- Production source, about 640 net lines: new
  `src/store/repository-scoped-key.ts` (about 80, proved),
  `src/store/entities/label-id.ts` (about 70, proved),
  `src/store/entities/label-policy.ts` (about 120),
  `src/store/entities/label.ts` (about 90), `src/store/label-selectors.ts`
  (about 50), `src/urls/label.ts` (about 45), and
  `src/store/repository-owner-projection.ts` (about 75, moved from
  `src/store/index.ts`, so about 0 net); edits to `src/store/keys.ts` (about
  +30, with the private parser body shrinking), `src/store/entities.ts`
  (about +45), `src/store/early-entity-selectors.ts` (about +5 to export shared
  types), `src/store/builders.ts` (about +15), `src/store/entity-id-offsets.ts`
  (about +8), `src/store/index.ts` (about +6 before the extraction),
  `src/urls/index.ts` (about +2), and `src/index.ts` (about +14).
- Tests and features, about 1,050 net lines:
  `tests/repository-scoped-key.test.ts`, `tests/label-keys.test.ts`,
  `tests/label-id.test.ts`, `tests/label-entity.test.ts`,
  `tests/label-selectors.test.ts`, `tests/label-urls.test.ts`,
  `tests/proof-stamp.test.ts`, `tests/repository-labels.steps.ts`,
  `features/repository-labels.feature`,
  `tests/support/documented-example-label-checks.ts`, and small edits to
  `tests/documented-surface.test-d.ts` and two
  `tests/support/documented-example-*.ts` modules.
- Proof and tooling, about 330 net lines: handwritten lemmas in
  `src/store/repository-scoped-key.dfy` and `src/store/entities/label-id.dfy`
  (about 260 together), `scripts/prove.sh` (about 60), and the `Makefile`
  target (about 8).

That totals about 2,020 lines against a 2,300-line code budget; the
contingency of about 14 per cent covers helper lemmas, the least predictable
item. Documentation is estimated at about 290 lines (users guide about 120,
developers guide about 60, API reference about 35, architecture about 50,
roadmap, contents, and changelog about 20) against 420. Configuration is
`LemmaScript-files.txt` (2 lines), `typos.local.toml` (about 8 lines), and the
proof stamp file (about 4 lines) against 40.

## Risks

- Risk R1: GitHub's exact case-folding rule for label names is undocumented
  beyond "label names are case-insensitive". `toLowerCase()` may disagree with
  GitHub for some non-ASCII names (for example `ß` against `ss`, or accented
  letters under database collation). Severity: low. Likelihood: medium.
  Mitigation: document the residual gap in `docs/architecture.md`; 1.5.3's
  real-client tests cover ASCII names; non-ASCII parity is explicitly
  unclaimed. Option O1 in `Decision log` offers ASCII-only folding instead.
- Risk R2: LemmaScript is a tech preview (0.6.10 was released on 2026-11-15).
  Its Dafny backend may not translate the planned shapes (discriminated-union
  returns, array loops, `indexOf` with a start position). Severity: medium.
  Likelihood: medium. Mitigation: `EP-M0` probes both proof targets before
  anything depends on them; fallback shapes are listed there.
- Risk R3: the proof could go stale, because `make prove` needs Dafny and
  network access and is not in CI. Severity: medium. Likelihood: high without
  mitigation. Mitigation: `make prove` writes a stamp file of SHA-256 hashes of
  each proved TypeScript source and its `.dfy`; `tests/proof-stamp.test.ts`
  (run by `make test` and CI) fails when a proved file changes without a fresh
  stamp. Adding a Dafny CI job is open question Q2.
- Risk R4: rejecting labels whose repository is not seeded (D10) is stricter
  than issues and refs. Severity: low. Likelihood: low (no existing callers
  seed labels). Mitigation: a precise error message naming the label key and
  the missing repository key, and a users-guide note. Aligning issues and refs
  is recorded as a follow-up, not done here.
- Risk R5: `src/store/index.ts` (427 lines) and
  `tests/support/documented-example-execution.ts` (392 lines) are at or over
  the 400-line rule. Severity: low. Likelihood: high. Mitigation: `EP-M1`
  extracts owner projection; label example handlers live in a new support
  module that exports its inventory and handler entries for spreading, so the
  execution module grows by at most five lines.
- Risk R6: JavaScript strings are UTF-16 code units, while Dafny's
  `seq<char>` holds Unicode scalar values, and Zod accepts lone surrogates.
  The proof's transfer to runtime therefore assumes no lone surrogates.
  Severity: low. Likelihood: low. Mitigation: a fast-check round-trip property
  over arbitrary UTF-16 code units (`0x0000`–`0xFFFF`, which includes lone
  surrogates) exercises the shipped functions directly.
- Risk R7: `toLowerCase()` might not be idempotent for some input, which would
  break key round-trips. Severity: medium. Likelihood: low. Mitigation: an
  exhaustive check over every Unicode scalar value plus properties over
  grapheme and code-unit strings (`INV-fold-idempotent`); a failure stops the
  plan for a folding-rule decision.
- Risk R8: integration tests start a whole simulator, which re-reads an 11 MB
  OpenAPI document each time. Generated tests against servers would make
  `make test` slow. Severity: medium. Likelihood: high if ignored. Mitigation:
  property tests target pure functions (`selectLabelFromTable`,
  `listRepositoryLabelsFromTable`); server-backed tests are a handful of
  examples sharing one server per file.

## Progress

- [x] (2026-11-15 19:45Z) Branch renamed to
  `1-5-1-first-class-repository-label-entities`; Lody session titled.
- [x] (2026-11-15 20:30Z) Reconnaissance with a Wyvern agent team and web
  research (`github3.py` label model, GitHub label REST contract, LemmaScript
  string model).
- [x] (2026-11-15 21:10Z) Initial draft written and committed.
- [x] (2026-11-15 21:40Z) Spelling gate regenerated `typos.toml`; isolated in
  base branch `refresh-shared-spelling-policy` and this branch stacked on it.
- [x] (2026-11-15 22:20Z) Community-of-experts design review (structure and
  contracts; failure modes and verification; alternatives and viability)
  completed and applied in this revision.
- [x] (2026-11-15 22:50Z) PRs opened: base spelling-policy PR #134 and this
  plan's draft PR #136, stacked on #134.
- [ ] Plan approved by the user.
- [ ] `EP-M0` LemmaScript feasibility probe (prototype).
- [ ] `EP-M1` preparatory refactor: `src/store/index.ts` at or below 400
  lines.
- [ ] `EP-M2` proved key grammar and canonical label keys.
- [ ] `EP-M3` proved identifier allocation, label schema, seeding, builder,
  and URL projection.
- [ ] `EP-M4` label selectors, behavioural feature, and end-to-end seeding.
- [ ] `EP-M5` documentation, roadmap, and delivery closure.

## Surprises & discoveries

- Observation: `src/store/index.ts` is already 427 lines, above the 400-line
  rule. Evidence: line count at `c2e5ddc`. Impact: `EP-M1` precedes label
  wiring.
- Observation: running `make spelling` regenerates `typos.toml` from the
  shared dictionary with changes unrelated to labels (Tokio attribute
  patterns). Evidence: `git diff typos.toml` after the first gate run.
  Impact: per AGENTS.md §Spelling, the regeneration is committed alone on
  `refresh-shared-spelling-policy`, proposed as its own PR, and this branch is
  stacked on it.
- Observation: the spelling gate's `en-gb` locale rejects the identifier
  `color` in code. Evidence: design review ran `typos` with the repository
  configuration on a scratch file containing `{color: "f29513"}`. Impact:
  `EP-M3` adds narrow `typos.local.toml` patterns, and every milestone runs
  `make spelling`.
- Observation: the 1.3.1 write spine updates entities in place under one key
  (`createEntityUpdateThunk`, `src/store/actions/index.ts` lines 174–179) and
  its table type exposes only `add` and `selectById`. Evidence: design review.
  Impact: renaming a label in 1.5.2 changes its key and needs a new re-keying
  write; recorded as D17 and in `Forward constraints`.
- Observation: no URL projector is exported from `src/index.ts`; they are
  internal to `src/urls/`. Evidence: `src/index.ts` exports and
  `typedoc.json` entry point. Impact: `projectLabelUrls` stays internal.
- Observation: `podbot-design.md` exists only in the unrelated podbot
  repository, not in Simulacat Core or simulacat. Impact: it is not a design
  input; no requirement is drawn from it.
- Observation: `../simulacat/docs/simulacat-design.md` is not checked out
  beside this worktree but is readable from the simulacat bare repository at
  `main` (`d81e344`) with
  `git -C ~/.lody/repos/github---leynos---simulacat/bare.git show main:docs/simulacat-design.md`.
  Impact: its Phase 5 section is quoted in `Conformance basis`.
- Observation: no test exercises `buildEarlyEntitySelectors` directly.
  Impact: label selectors get direct tests.

## Decision log

- D1. Decision: label identity is case-insensitive. The key's name segment is
  `canonicalLabelName(name)`, which trims surrounding whitespace and then
  applies `toLowerCase()`; the stored `name` field keeps the author's display
  casing (after trimming). Selectors and `labelStoreKey` canonicalize their
  input, so `getLabel(state, {owner, repo, name: ' BUG '})` finds `Bug`.
  Seeding two labels whose canonical names match is a duplicate-key error.
  Rationale: GitHub documents label names as case-insensitive,
  `github3.py`'s `repo.label(name)` relies on that lookup, and 1.5.2 must
  reject case-variant creates with `422 already_exists` using a direct key
  lookup rather than a scan. A case-only rename keeps the key; any other
  rename re-keys the label (D17). Rejected alternative: verbatim-name keys
  plus a lower-case secondary index, which keeps exact-match keys like other
  tables but makes every adapter perform two lookups and turns duplicate
  detection into an index maintenance problem. Repository owner and name
  segments stay case-sensitive, as in every other table. Date/Author:
  2026-11-15, planning agent; confirmed by design review; subject to user
  approval.
- D2. Decision: label names are trimmed, must be non-empty after trimming, and
  may contain any other characters, including `:`, `/`, `#`, `?`, spaces, and
  emoji. No maximum name length is enforced because GitHub's limit is not in
  the REST reference consulted. Rationale: names such as `type: bug` and
  `area/api` are common, and the key parser splits at the first `:`, which is
  unambiguous because owner and repository are key segments (D3). Date/Author:
  2026-11-15, planning agent.
- D3. Decision: the label schema and `labelStoreKey` reject `owner` and `repo`
  values that are not key segments. Rationale: `/` and `:` are the key
  grammar's separators; the proof's precondition requires their absence.
  Other entity schemas leave this to convention; tightening them is a
  follow-up. Date/Author: 2026-11-15, planning agent.
- D4. Decision: `color` must match `^[0-9a-fA-F]{6}$` (no leading `#`), is
  stored verbatim, and defaults to `ededed`. Rationale: GitHub's REST contract
  specifies six hexadecimal digits without `#`; `github3.py` strips `#`
  client-side; `ededed` is GitHub's default. Whether GitHub lower-cases colours
  on write is unverified and falls under the Ambiguity tolerance. Date/Author:
  2026-11-15, planning agent.
- D5. Decision: `description` is a string of at most 100 characters or `null`,
  defaults to `null`, and is always present on parsed labels. Rationale:
  GitHub documents the 100-character limit, and `github3.py` 3.2.0 and 4.x read
  `label["description"]` by indexing, so a missing key raises `KeyError`.
  Date/Author: 2026-11-15, planning agent.
- D6. Decision: `default` is a boolean defaulting to `false`. Rationale: the
  GitHub `label` component in `schema/api.github.com.json` requires it.
  Date/Author: 2026-11-15, planning agent.
- D7 (revised after design review). Decision: label `id` values are allocated,
  not derived from the key. The entity schema leaves `id` optional; the seed
  transform in `githubInitialStoreSchema` assigns every label without an
  explicit `id` a fresh identifier from `allocateLabelIds`, processing labels
  in canonical-key order. Fresh identifiers start at `LABEL_ID_FLOOR + 1`
  (`LABEL_ID_FLOOR = 1_000_000`) and each is greater than every identifier
  already taken, explicit or allocated. 1.5.2's create reuses
  `nextLabelId(takenIds)`. This follows the installation precedent in
  `src/store/entities.ts`, where the seed transform allocates installation
  identifiers. Rationale: the first draft hashed the creation key into an
  identifier that persisted across renames; the design review showed that a
  rename followed by a create of the old name derives a duplicate identifier
  at runtime. Monotonic allocation can never reissue an identifier, is
  independent of seed array order, and keeps identifiers below the GraphQL
  32-bit `Int` limit for any realistic fixture. Rejected alternatives: the
  key hash (duplicates after rename), a hash with deterministic probing (more
  complex and still needs a taken-set), and allocation in seed array order
  (fixture-order dependent). Trade-off: `buildLabelFixture` output has no `id`
  unless one is supplied, so builder output is a fixture, and the stored label
  is complete only after seeding; the types make this explicit
  (`GitHubLabelFixture` against `GitHubLabel`). Date/Author: 2026-11-15,
  planning agent after design review.
- D8 (revised after design review). Decision: `node_id` defaults to Base64 of
  `Label:<id>` through `labelNodeId(id)`, assigned with the identifier during
  seeding. Rationale: a label's key changes on rename, so a key-derived node
  identifier would collide in the same rename-then-create sequence as D7; the
  numeric identifier is stable and unique. This deliberately departs from the
  `Repository:`, `Ref:`, and `Issue:` key-based convention, whose keys never
  change. Explicit `node_id` values are preserved and must be unique.
  Date/Author: 2026-11-15, planning agent after design review.
- D9. Decision: the stored entity keeps `url` only as an optional seeded
  override. An internal `projectLabelUrls` in `src/urls/label.ts` derives
  `url = <apiBase>/repos/<owner>/<repo>/labels/<encodeURIComponent(name)>` from
  request-scoped base URLs using the display name, and preserves an override.
  It is not exported from `src/index.ts`, matching every other projector.
  Rationale: roadmap 1.4.1 made stored entities host-agnostic, and the
  projector completes the `url` field `github3.py` reads so 1.5.2 can use it
  unchanged. Date/Author: 2026-11-15, planning agent.
- D10. Decision: seeding fails when a label's `owner/repo` is not a seeded
  repository key. Rationale: simulacat's Phase 5 step 5.1 rule 1 requires it,
  and `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §6 recommends failing at startup. Date/Author: 2026-11-15, planning agent;
  confirmed by design review.
- D11. Decision: selectors are `getLabel(state, {owner, repo, name})` and
  `listLabelsForRepository(state, {owner, repo})`, built by
  `buildLabelSelectors` in `src/store/label-selectors.ts` as thin wrappers over
  the pure `selectLabelFromTable` and `listRepositoryLabelsFromTable` in
  `src/store/entities/label-policy.ts`. Listing is ordered by canonical name.
  The order is simulator-defined and is not a claim about GitHub's order. The
  per-repository index reuses `buildRepoIndex`, `StoreTable`, and
  `CreateSelector`, which become exported from
  `src/store/early-entity-selectors.ts` for internal reuse. Rationale: object
  coordinates match `getIssue`; pure lookups make property tests cheap (R8);
  reusing the index avoids a second implementation. Date/Author: 2026-11-15,
  planning agent after design review.
- D12 (revised after design review). Decision: proofs target two pieces of
  contractual logic, each in its own import-free module. First, the shared
  repository-scoped key grammar in `src/store/repository-scoped-key.ts`
  (`isKeySegment`, `formatRepositoryScopedKey`, `splitRepositoryScopedKey`),
  which the existing private `parseRepositoryScopedReferenceKey` in
  `src/store/keys.ts` is changed to call, so the proof protects branch, blob,
  ref, commit, and label keys alike. Second, identifier allocation in
  `src/store/entities/label-id.ts` (`nextLabelId` and `allocateLabelIds`),
  whose uniqueness 1.5.2 relies on. Unicode case folding is covered by
  property tests because LemmaScript models `toLowerCase` only for ASCII.
  Rationale: the design review judged a label-only grammar proof too weak and
  duplicative of the existing parser. Proving the shared grammar, plus the
  allocator that runtime creates depend on, puts the proof effort on the
  obligations later work actually relies on. Date/Author: 2026-11-15, planning
  agent after design review.
- D13. Decision: 1.5.1 adds no write action, REST route, or GraphQL field.
  Rationale: roadmap 1.5.2 owns handlers and writes; landing state first keeps
  this reviewable. Date/Author: 2026-11-15, planning agent.
- D14 (revised after design review). Decision: verification uses LemmaScript's
  Dafny backend through `scripts/prove.sh`, called by a new `make prove`. The
  script checks the Dafny version (4.11.x), runs
  `npx --prefer-offline --yes --package=lemmascript@0.6.10 -- lsc check
  --backend=dafny <file>` for each entry in `LemmaScript-files.txt` (with a
  pinned Dafny resource limit passed as extra flags), checks that each `.dfy`
  differs from its `.dfy.gen` by additions only, and rewrites
  `proofs.stamp`, which records SHA-256 hashes of each proved `.ts` and
  `.dfy`. `tests/proof-stamp.test.ts` checks those hashes in every
  `make test`, so CI fails if proved code changes without a fresh proof run.
  `make prove` is a milestone acceptance gate from `EP-M2`, but it is not
  added to `make all` or CI here because CI does not install Dafny (open
  question Q2). `npx` rather than `bunx` is a documented exception because
  LemmaScript targets Node. Date/Author: 2026-11-15, planning agent after
  design review; subject to user approval.
- D15. Decision: before adding label wiring, move `toRepoOwner`,
  `toPublicUserOwner`, `resolveRepositoryOwner`, the `RepositoryWithOwnerSchema`
  type, and `buildRepositoryWithOwnerSelector` from `src/store/index.ts` into
  `src/store/repository-owner-projection.ts` as a separate,
  behaviour-preserving commit. The module-private `ExtendedSchema` type that
  `RepositoryWithOwnerSchema` depends on becomes an internal (non-public)
  export, and the public types `GitHubRepoOwner`, `GitHubPublicUserOwner`,
  `GitHubRepositoryOwner`, and `GitHubRepositoryWithOrganizationOwner` stay
  declared in `src/store/index.ts` and are imported with `import type`, as
  `src/store/actions/dispatch.ts` already does. Rationale: the file is over
  the limit and AGENTS.md requires separate refactor commits. Removing about
  69 lines leaves about 360 before label wiring. Date/Author: 2026-11-15,
  planning agent; confirmed by design review.
- D16. Decision: "serialized without raw nested dictionaries" means a parsed
  label is a flat record of scalar or `null` values that survives a JSON round
  trip and re-parse unchanged, and the published seed shape is a flat
  `initialState.labels` array, not a `repositories[].labels` dictionary.
  Rationale: simulacat step 5.1 serializes its Python model to "the core
  `initialState.labels` shape once that shape is published". Date/Author:
  2026-11-15, planning agent.
- D17 (new from design review). Decision: record now that 1.5.2 cannot
  implement rename through `createEntityUpdateThunk`, which updates an entity
  in place under one key. 1.5.2 must add a re-keying write that removes the
  old key and adds the new one in a single store update, rejects a target key
  that already exists, and serializes against both keys (or a per-repository
  key) in the write supervisor; a case-only rename keeps the key and may use
  the in-place path. Rationale: D1 makes the key depend on the name; stating
  the consequence prevents 1.5.2 from discovering it mid-implementation.
  `docs/architecture.md` §"Repository label slice" is updated to say so.
  Date/Author: 2026-11-15, planning agent after design review.
- D18 (new from design review). Decision: seed validation runs as a
  `superRefine` on the `githubInitialStoreSchema` object before its existing
  `.transform`, so failures are `ZodError` issues (matching `simulation`'s
  documented `@throws {ZodError}`) and installation allocation never runs on a
  rejected seed. Checks run in this order, each with its own message: unknown
  repository; duplicate canonical key (naming both display names and indices);
  duplicate explicit `id`; duplicate explicit `node_id`. Rationale: the first
  draft would have reported a case-variant duplicate as an identifier
  collision, so a broken duplicate check could pass unnoticed. Date/Author:
  2026-11-15, planning agent after design review.
- D19 (new from design review). Decision: the public surface is
  `githubLabelSchema`, `GitHubLabel`, `GitHubLabelFixture`, `buildLabelFixture`,
  `LabelFixtureInput`, `labelStoreKey`, `parseLabelStoreKey`,
  `LabelStoreKeyParts`, and `labelNodeId`. `canonicalLabelName`,
  `projectLabelUrls`, the allocator, and the seed predicates stay internal.
  Selectors are published, like every other entity's, through
  `simulationStore.selectors`, and their signatures are pinned by
  compile-time assertions in `tests/documented-surface.test-d.ts`.
  `parseLabelStoreKey` returns `{owner, repo, name}` where `name` is the
  canonical name; its JSDoc says so. Rationale: keep the surface to what fixture
  authors and extension handlers need; simulacat is a Python consumer and 1.5.2
  is internal. Date/Author: 2026-11-15, planning agent after design review.
- O1 (option for the user, not adopted). ASCII-only folding instead of
  `toLowerCase()`. Gains: the canonicalization itself would fall inside
  LemmaScript's model and could be proved, and R7 disappears. Costs: non-ASCII
  names differing only by case would become distinct labels, which may differ
  from GitHub. Not adopted because GitHub parity for ASCII is unaffected either
  way and full-Unicode folding is closer to GitHub's documented behaviour.

Open questions for the user (recorded, not blocking the draft):

- Q1: accept D1's full-Unicode `toLowerCase()` folding, or prefer O1?
- Q2: add a CI job that installs Dafny and runs `make prove`, or keep the
  proof as a local milestone gate guarded by the stamp test?
- Q3: accept D10's strict unknown-repository rejection for labels now, with
  issues and refs aligned later?

## Outcomes & retrospective

Not started. To be completed at each milestone and at completion.

## Context and orientation

Inspected base revision: `c2e5ddcb8092c327003f92916fe8e4a7befd5037` (`main`,
2026-10-20). Line numbers below are at that revision; relocate symbols with
`rg -n '<symbol>' src tests`.

The seeding pipeline. `simulation(args)` in `src/index.ts` parses
`args.initialState` with `githubInitialStoreSchema` from
`src/store/entities.ts` (lines 106–118 list the collections; optional ones use
`.optional().default([])`; the `.transform` that follows allocates
installation identifiers, the precedent for D7). `convertInitialStateToStoreState`
(lines 192–209) turns each array into a keyed table with
`convertObjByKey(array, keyFn)`, which throws
`Duplicate key "<key>" for objects at indices <i> and <j>`.
`src/store/index.ts` `inputSchema` (lines 124–143) registers each table with
`slice.table<T>(tableOptions(storeInitialState, '<name>'))`.

Entity modules live in `src/store/entities/`. `src/store/entities/issue.ts` is
the closest template: a Zod object schema with a `.transform`, an exported
`GitHubIssue` interface, and an exported `issueStoreKey`. Every schema field
needs a JSDoc comment because TypeDoc validates every property.

Keys. `src/store/keys.ts` re-exports each `*StoreKey`, defines
`*StoreKeyParts` types and the shared `RepositoryCoords`, node-identifier
helpers (`issueNodeId` and others), and parsers. The private
`parseRepositoryScopedReferenceKey(key, entityName, referenceName)` (lines
225–251) splits at the first `:`, delegates the prefix to
`parseRepositoryStoreKey`, and throws
`Malformed <entity> store key "<key>"; expected "owner/repo:<reference>"`
with the inner error as `cause`. `parseBranchStoreKey`, `parseBlobStoreKey`,
`parseRefStoreKey`, and `parseCommitStoreKey` call it. Property tests in
`tests/store-keys.test.ts` (lines 45–72) generate owner and repository
segments that exclude `/` and `:`.

Selectors. `src/store/early-entity-selectors.ts` defines the private
`StoreTable`, `CreateSelector`, and `buildRepoIndex` (lines 16–58) and
`buildEarlyEntitySelectors({createSelector, schema})`. `src/store/index.ts`
`earlyEntitySelectorArgs` (lines 366–374) and `inputSelectors` (lines
377–385) wire selectors in. Tests reach selectors through a running server, as
`tests/store-selectors.test.ts` does: it passes
`server.simulationStore.store.getState()` to
`server.simulationStore.selectors.getRepositoryWithOwner`.

Builders. `src/store/builders.ts` exports `build*Fixture(input)` functions that
call `schema.parse(input)` and `*FixtureInput = z.input<typeof schema>`
types. `src/index.ts` (lines 104–153) re-exports builders, schemas, entity
types, keys, parsers, and node-identifier helpers.
`tests/documented-surface.test-d.ts` pins builder types at compile time;
`.test-d.ts` files are type-checked by `make typecheck` (via `tsc` over
`tests/**/*.ts`) and are not run by `bun test`.

URLs. `src/urls/issue.ts` is the projector template: field lists, a
`satisfies`-checked builder table, and `projectIssueUrls(issue, baseUrls)`
via `projectDerivedFields` from `src/urls/shared.ts`, which also provides
`apiUrl`, `repositoryPath`, and `urlPathSegment` (an `encodeURIComponent`
wrapper). Repositories already project `labels_url`
(`src/urls/repository.ts` lines 37 and 107).

Write spine (context only; not changed). `src/store/actions/` holds the 1.3.1
pattern: a pure reducer, a starfx thunk from `createEntityUpdateThunk`, a use
case, and `dispatchWrite`. The thunk reads and writes one key, which is why
D17 exists.

Tests and tools. `make test` runs `bun test --max-concurrency=1 tests`.
`bunfig.toml` preloads `test-plugins.ts`, which registers
`@aboviq/bun-test-cucumber` with step definitions from `tests/**/*.steps.ts`;
`tests/cross-owner-identity.features.test.ts` loads every
`features/**/*.feature`, so new feature files need no new loader. Property
tests use `fast-check` 4.9 with the shared seed in
`tests/support/property-test-seed.ts`; `fc.string({unit: 'grapheme'})` and
`{unit: 'binary'}` are valid in this version. `fc.statistics` only prints, so
non-vacuity is asserted with counters and `expect`. Each `simulation()` start
re-reads the 11 MB `schema/api.github.com.json` (`src/utils.ts` lines
124–133), so server-backed tests must be few. The users guide contains
executable examples marked `<!-- tested-example: <id> -->`; the inventory is
`DOCUMENTED_EXAMPLE_IDS` in `tests/support/documented-example-execution.ts`
(392 lines) and expected output is in
`tests/support/documented-example-observations.ts`. CI
(`.github/workflows/ci.yml`) runs `make spelling`, `make nixie`, `make all`
(`check-fmt typecheck docs-check lint test spelling`), `bun run audit`, and
`make build`. No proof target exists yet. Dafny 4.11.0 is installed on the
development host at `~/.local/bin/dafny`; LemmaScript is not installed and is
not a dependency.

External facts gathered with Firecrawl. `github3.py` 3.2.0 and current 4.x
`src/github3/issues/label.py` build `Label` by indexing `label["url"]`,
`label["color"]`, `label["name"]`, and `label["description"]`. GitHub's REST
documentation for labels (API version 2022-11-28) states that label names are
case-insensitive, colour is hexadecimal without a leading `#`, descriptions
are at most 100 characters, and gives this example payload:

```json
{
  "id": 208045946,
  "node_id": "MDU6TGFiZWwyMDgwNDU5NDY=",
  "url": "https://api.github.com/repos/octocat/Hello-World/labels/bug",
  "name": "bug",
  "description": "Something isn't working",
  "color": "f29513",
  "default": true
}
```

The `label` component in `schema/api.github.com.json` (around line 121391)
requires `id`, `node_id`, `url`, `name`, `description` (nullable), `color`,
and `default`. LemmaScript 0.6.10 models strings as Dafny `seq<char>`,
supports `indexOf`, `slice`, `includes`, `length`, concatenation, template
literals, and `===`, and models `toLowerCase` for ASCII letters only. The
design review noted that `github3.py` joins label names into request paths
without encoding them, which matters for 1.5.2 (see `Forward constraints`).

Signposts. Read before implementing: `AGENTS.md`; `docs/architecture.md`
§"State model" and §"Repository label slice"; `docs/developers-guide.md`
§"Linting rules", §"Testing expectations", and §"Early repository-owned
entities"; `docs/users-guide.md` §"Seeding early collaboration entities" and
§"Store key helpers and parsers"; `docs/api-reference.md` §"Exported fixture
schemas"; `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
§5 "Define canonical keys before defining routes", §6 "Validate seed state
aggressively", and §7 on selectors; `docs/complexity-antipatterns-and-refactoring-strategies.md`
§3 (bumpy road) and §5.A (command and query separation);
`docs/github-rest-api-audit.md` §"What Is Stubbed But Not Really Mocked"; and
`docs/execplans/1-1-2-first-class-entities-for-early-slices.md` as the
precedent. Skills: `execplans`; `hexagonal-architecture` (boundary check);
`typescript-router`, routing to `typescript-data-and-state` and
`typescript-boundaries-and-validation`; `fast-check`; `lemmascript`;
`typescript-testing`; `biome-typescript`; `codegraph-mcp` for impact analysis;
and `en-gb-oxendict-style` for documentation. The repository uses Zod 3.25, so
`zod4-typescript` does not apply.

## Conformance basis

Upstream artefacts, read at `c2e5ddc` unless stated:

- `docs/roadmap.md` task 1.5.1 and step 1.5; later consumers 1.5.2, 1.5.3, and
  8.2.2 ("Build on the repository label model from step 1.5 instead of
  introducing a second label representation").
- `docs/architecture.md` §"Repository label slice", §"State model", and
  §"GitHub client compatibility".
- `docs/adr-001-linting-strategy.md` (lint ownership).
- simulacat `docs/simulacat-design.md` at simulacat `main` `d81e344`,
  §"Phase 5 – core-backed labels and diagnostics", step 5.1: "The scenario
  schema will add a label model with `name`, `color`, and optional
  `description`, then serialize labels to the core `initialState.labels`
  shape once that shape is published," and rule 1: "Labels belong to a
  repository identified by owner and name. Validation fails if a label
  references an unknown repository."
- No Terms of Reference or separate technical design exists for this slice;
  `docs/architecture.md` is the design of record.

Requirements derived from those sources:

- `REQ-key`: labels are stored in their own table keyed by
  `owner/repo:<canonical label name>`, distinct across owners and
  repositories, with a key grammar that round-trips.
- `REQ-identity`: every stored label has an `id` and `node_id` that are
  unique within the table and remain unique under later creates and renames.
- `REQ-fields`: a stored label always carries `id`, `node_id`, `name`,
  `color`, `description` (nullable), and `default`, and supports `url` as a
  seeded override or a request-derived projection.
- `REQ-seed`: `initialState.labels` is optional, defaults to `[]`, and seeds
  the table; invalid labels, canonical-key duplicates, explicit identifier
  duplicates, and labels for unseeded repositories fail at startup with
  distinct messages.
- `REQ-select`: labels are selectable by repository and name
  (case-insensitively) and listable per repository.
- `REQ-exports`: the label schema, types, key helper, parser,
  node-identifier helper, builder, and builder input type are exported from
  `src/index.ts`, and the label selectors are published through
  `simulationStore.selectors` with pinned types.
- `REQ-serialize`: parsed labels are flat records that survive JSON
  serialization and re-parsing unchanged.
- `REQ-boundary`: label policy is pure and adapter-free.
- `REQ-docs`: users guide, developers guide, API reference, architecture,
  roadmap, and changelog describe the delivered behaviour.

Observed gaps at the base revision:

- `GAP-entity`: no label schema, table, key, selector, or builder exists.
- `GAP-url`: no label URL projector exists.
- `GAP-size`: `src/store/index.ts` exceeds 400 lines.
- `GAP-grammar`: the repository-scoped key grammar shared by four entities
  has property tests but no proof.

Trace links:

```plaintext
roadmap-1.5.1 -> REQ-key -> L-grammar-roundtrip, L-grammar-sound, L-grammar-injective -> EP-M2 -> make prove, tests/repository-scoped-key.test.ts
roadmap-1.5.1 -> REQ-key -> INV-fold-idempotent, INV-case-identity, INV-wrapper-total -> EP-M2 -> tests/label-keys.test.ts
GAP-grammar -> L-grammar-roundtrip -> EP-M2 -> tests/store-keys.test.ts (unchanged, regression net)
roadmap-1.5.1 -> REQ-identity -> L-next-fresh, L-allocate-unique -> EP-M3 -> make prove, tests/label-id.test.ts
roadmap-1.5.1 -> REQ-fields, REQ-serialize -> INV-flat-reparse -> EP-M3 -> tests/label-entity.test.ts
architecture §Repository label slice -> REQ-seed -> INV-seed-rejects -> EP-M3 -> tests/label-entity.test.ts, features/repository-labels.feature
simulacat 5.1 rule 1 -> REQ-seed (unknown repository) -> EP-M3 -> features/repository-labels.feature
roadmap-1.5.1 -> REQ-select -> INV-scoped-selection -> EP-M4 -> tests/label-selectors.test.ts, features/repository-labels.feature
architecture §GitHub client compatibility -> REQ-fields (url) -> INV-url-projection -> EP-M3 -> tests/label-urls.test.ts
roadmap-1.5.1 -> REQ-exports -> EP-M2, EP-M3, EP-M4 -> tests/documented-surface.test-d.ts, users-guide examples
REQ-boundary -> EP-M2, EP-M3 -> import check in tests/label-keys.test.ts
D14 -> INV-proof-fresh -> EP-M2 -> tests/proof-stamp.test.ts
GAP-size -> EP-M1 -> wc -l src/store/index.ts <= 400
REQ-docs -> EP-M5 -> make markdownlint, make nixie, users-guide example tests
```

## Verification plan

### Abstract model

A label is a record `L` with the fields `owner`, `repo`, `name`, `color`,
`description`, `default`, `id`, `node_id`, and an optional `url`. Let
`canon(s) = s.trim().toLowerCase()`, and let a key segment be a non-empty
string containing neither `/` nor `:`. The canonical key is
`key(L) = owner + "/" + repo + ":" + canon(name)`. A seed is a finite list of
label fixtures (identifiers optional) plus a set `R` of seeded repository keys.
Seeding succeeds if and only if every fixture parses, every `owner/repo` is in
`R`, canonical keys are pairwise distinct, explicit identifiers are pairwise
distinct, and explicit node identifiers are pairwise distinct. It then visits
fixtures in ascending key order and gives each one without an `id` the value
`max({LABEL_ID_FLOOR} ∪ taken) + 1`, where `taken` holds every explicit
identifier and every identifier allocated so far, and gives each label without
a `node_id` the value `labelNodeId(id)`. The result is a table `T: key -> L`.
`getLabel(T, o, r, n) = T[o/r:canon(n)]`, and
`listLabelsForRepository(T, o, r)` is every label in `T` with that owner and
repository, ordered by canonical name. Malformed fixtures are rejected by Zod
with a path-qualified issue; seed-level violations become `ZodError` issues
that name the offending keys.

### Invariants and lemmas

- `L-grammar-roundtrip` (supports `REQ-key`): for all key segments `o` and `r`
  and every non-empty string `c`,
  `splitRepositoryScopedKey(formatRepositoryScopedKey(o, r, c))` returns
  `{ok: true, owner: o, repo: r, reference: c}`.
- `L-grammar-sound` (supports `REQ-key`): whenever
  `splitRepositoryScopedKey(k)` returns `{ok: true, owner, repo, reference}`,
  `owner` and `repo` are key segments, `reference` is non-empty, and
  `formatRepositoryScopedKey(owner, repo, reference) === k`. Together with the
  round trip this makes the splitter an exact inverse on its domain.
- `L-grammar-injective` (supports `REQ-key`, corollary of
  `L-grammar-roundtrip`): equal formatted keys imply equal parts, so labels in
  different repositories never share a key.
- `L-next-fresh` (supports `REQ-identity`): for every finite array `taken` of
  integers, `nextLabelId(taken)` is greater than `LABEL_ID_FLOOR`, greater than
  every element of `taken`, and therefore not an element of `taken`.
- `L-allocate-unique` (supports `REQ-identity`): for every array `explicit` of
  pairwise-distinct integers and every count `n ≥ 0`,
  `allocateLabelIds(explicit, n)` returns `n` integers that are pairwise
  distinct, strictly increasing, and disjoint from `explicit`.
- `INV-fold-idempotent` (runtime axiom check, supports `REQ-key`):
  `canon(canon(s)) = canon(s)` for every string `s`.
- `INV-case-identity` (supports `REQ-key`, `REQ-select`): `labelStoreKey`
  maps two names to the same key exactly when their canonical names are equal;
  `parseLabelStoreKey(labelStoreKey(p))` equals `p` with `name` canonical; and
  `parseLabelStoreKey` rejects a key whose name segment is not canonical.
- `INV-wrapper-total` (supports `REQ-key`): for unrestricted input
  (including owners containing `:`, empty or whitespace-only names, and lone
  surrogates), `labelStoreKey` either throws a descriptive error or returns a
  key that `parseLabelStoreKey` maps back to the canonical parts.
- `INV-seed-rejects` (supports `REQ-seed`): seeding raises a `ZodError` whose
  message is specific to each violation (unknown repository, duplicate
  canonical key, duplicate explicit `id`, duplicate explicit `node_id`, and
  each field rule), and accepts the same seed once the violation is removed.
- `INV-seed-order-independent` (supports `REQ-identity`): permuting the
  `labels` array does not change any stored label.
- `INV-flat-reparse` (supports `REQ-serialize`, `REQ-fields`): for every valid
  fixture input `x`, `p = buildLabelFixture(x)` has only scalar or `null`
  field values, contains `description` and `default`, and
  `buildLabelFixture(JSON.parse(JSON.stringify(p)))` deep-equals `p`; the same
  holds for stored labels re-parsed through the schema.
- `INV-scoped-selection` (supports `REQ-select`): `selectLabelFromTable`
  returns the seeded label for any casing or surrounding whitespace of its
  name and `undefined` for any other owner, repository, or name;
  `listRepositoryLabelsFromTable` returns exactly that repository's labels in
  canonical-name order.
- `INV-url-projection` (supports `REQ-fields`): `projectLabelUrls` keeps a
  seeded `url` and otherwise produces
  `<apiBase>/repos/<enc owner>/<enc repo>/labels/<enc name>`, with `enc`
  being `encodeURIComponent`, so names containing spaces, `/`, `:`, `#`, `?`,
  `%`, or emoji form a single path segment.
- `INV-boundary` (supports `REQ-boundary`): the three policy modules import
  nothing from Zod, starfx, Express, or the foundation simulator.
- `INV-proof-fresh` (supports D14): the hashes in `proofs.stamp` match the
  current contents of every proved `.ts` and `.dfy` file.

### Axioms (trusted, not verified here)

- `AXIOM-github-case`: GitHub label names are case-insensitive (GitHub REST
  documentation, labels, API version 2022-11-28). Relied on by D1; non-ASCII
  parity is not claimed (R1).
- `AXIOM-github3-fields`: `github3.py` 3.2.0 and 4.x build `Label` from
  `url`, `color`, `name`, and `description` by indexing (source of
  `src/github3/issues/label.py` at tag `3.2.0` and on `main`). Relied on by
  D5 and D9; exercised end to end by 1.5.3.
- `AXIOM-lemmascript-model`: LemmaScript 0.6.10's Dafny translation of
  `indexOf`, `slice`, `includes`, concatenation, `===`, array indexing, and
  integer arithmetic matches JavaScript for strings without lone surrogates
  and for integers below 2^53. Relied on to transfer the proofs to runtime;
  cross-checked at runtime by fast-check properties over arbitrary UTF-16
  code units (R6).
- `AXIOM-dafny`: Dafny 4.11.0 is sound for the generated obligations.
- `AXIOM-foundation-table`: the foundation simulator's `slice.table` stores
  and returns entities by the exact key string supplied at seed time, as every
  other table already relies on.
- `AXIOM-zod-refine-order`: in Zod 3.25, a `superRefine` attached to an object
  schema runs after field parsing and before a later `.transform`, and a
  reported issue prevents the transform from running.

### Methods per obligation

- Obligation: `L-grammar-roundtrip`, `L-grammar-sound`,
  `L-grammar-injective`. Method: formal proof with LemmaScript's Dafny backend
  on `src/store/repository-scoped-key.ts`, plus fast-check properties.
  Rationale: the grammar is contractual identity logic used by five entity
  families and quantifies over all strings, including references that contain
  the separators; sampling cannot discharge it. Domain: all strings; the
  `requires` clause is `isKeySegment(o) && isKeySegment(r) && c.length > 0`.
  Artefacts: `src/store/repository-scoped-key.ts` (`//@ verify`, `//@ requires`,
  `//@ ensures`), `src/store/repository-scoped-key.dfy`, `make prove`, and
  `tests/repository-scoped-key.test.ts`. Evidence: before helper lemmas are
  written, `lsc check` reports the round-trip `ensures` as possibly failing
  (red); after, `make prove` reports zero errors (green). Discharge: zero
  Dafny errors, no `assume`, and an additions-only `.dfy` diff checked by
  `scripts/prove.sh`. Non-vacuity: a Dafny `example` lemma instantiates the
  round trip for `o = "acme"`, `r = "repo"`, `c = "type: bug/a"` (a reference
  containing both separators), and another instantiates soundness for the
  key `acme/repo:x:y`. Negative controls: (1) change the splitter to search
  for `:` with `key.indexOf(':', firstColon + 1)` when a second colon exists
  (an "after the first colon" bug written only with supported operations);
  `make prove` must fail on the round-trip lemma, and the fast-check property
  must find a counterexample; (2) let `isKeySegment` accept `:`; `make prove`
  must fail on the round-trip lemma, because an owner containing `:` is then
  admissible. Revert each control with `git restore` and confirm no `.dfy.gen`
  drift remains. Behaviour preservation: after `parseRepositoryScopedReferenceKey`
  delegates to the splitter, `tests/store-keys.test.ts` passes unchanged,
  including its exact error-message assertions.
- Obligation: `L-next-fresh`, `L-allocate-unique`. Method: formal proof with
  LemmaScript's Dafny backend on `src/store/entities/label-id.ts`, plus a
  fast-check model test. Rationale: identifier uniqueness is the invariant the
  design review showed the first draft violated, and 1.5.2's create relies on
  it for every reachable table. Domain: all finite integer arrays (`taken`
  and `explicit`, with `explicit` pairwise distinct as the precondition of
  `L-allocate-unique`) and all `n ≥ 0`; loops carry `//@ invariant` and
  `//@ decreases`. Artefacts: `src/store/entities/label-id.ts`,
  `src/store/entities/label-id.dfy`, and `tests/label-id.test.ts`. Evidence:
  red then green `make prove` as above; the fast-check test compares
  `allocateLabelIds` with an independent oracle (a `Set` built by repeated
  `max + 1`) on generated arrays including negatives, values below and above
  the floor, and empty arrays. Non-vacuity: Dafny `example` lemmas for
  `taken = []` (result `LABEL_ID_FLOOR + 1`), for `taken = [5, 2_000_000]`
  (result `2_000_001`), and for `n = 3` with `explicit = [1_000_002]`
  (results `1_000_003`, `1_000_004`, `1_000_005`); the fast-check counters
  assert that at least a quarter of runs contain an explicit identifier above
  the floor. Negative control: change `nextLabelId` to return
  `max(taken) + 1` without the floor, or to return `taken.length + floor`;
  each must fail `L-next-fresh` in Dafny and in fast-check.
- Obligation: `INV-fold-idempotent`. Method: exhaustive check plus property
  tests. Rationale: it is an assumption about the runtime's Unicode tables
  that can be checked completely for single code points but not proved here.
  Domain: every Unicode scalar value (`0x0`–`0x10FFFF` excluding surrogates,
  1,112,064 strings), then `fc.string({unit: 'grapheme'})` and
  `fc.string({unit: 'binary'})` for multi-character contexts such as Greek
  final sigma. Artefact: `tests/label-keys.test.ts`, with a test name that
  says it checks the JavaScript runtime rather than project code. Evidence:
  the exhaustive loop collects failures into an array and asserts it is empty
  and that the checked count is 1,112,064 (a few hundred milliseconds).
  Non-vacuity: explicit witnesses include ASCII capitals, `İ` (U+0130), `Σ`,
  and already-lower strings. Negative control: substituting a fold that swaps
  `a` and `A` fails.
- Obligation: `INV-case-identity` and `INV-wrapper-total`. Method: property
  tests plus a parameterized table. Domain: generated key segments,
  full-Unicode names, names built from arbitrary UTF-16 code units, and
  unrestricted owners and repositories; explicit rows for `Bug`/`bug`/`BUG`,
  `bug` padded with spaces, `type: bug`, `area/api`, emoji, an owner
  containing `:`, and an empty name. Artefact: `tests/label-keys.test.ts`.
  Evidence: properties pass with the shared seed. Non-vacuity: a generator
  upper-cases a random subset of characters so case-variant pairs occur, with
  a counter asserting that some pairs differ before canonicalization; another
  counter asserts that some unrestricted inputs throw and some succeed.
  Negative controls: removing `toLowerCase` or `trim` from
  `canonicalLabelName` fails the case-variant or whitespace property.
- Obligation: `INV-seed-rejects` and `INV-seed-order-independent`. Method:
  parameterized tests, a property test, and behavioural scenarios. Domain:
  one row per violation, each asserting its own message text, each paired
  with a valid twin; for order independence, generated seeds of up to eight
  labels and their random permutations. Artefacts:
  `tests/label-entity.test.ts`, `features/repository-labels.feature`.
  Evidence: rows and properties pass. Non-vacuity: every rejection row has an
  accepted twin, so a schema that rejects everything fails; the duplicate-key
  row asserts the duplicate-key message and not the identifier message.
- Obligation: `INV-flat-reparse`. Method: property test. Domain: a fast-check
  arbitrary over valid fixture inputs (optional `id`, `node_id`, `url`;
  `description` as string or `null`; mixed-case colours). Artefact:
  `tests/label-entity.test.ts`. Non-vacuity: counters assert that optional
  fields are both present and absent across runs. Negative control: a
  transform that rewrites `node_id` on re-parse fails.
- Obligation: `INV-scoped-selection`. Method: property test on the pure
  table functions, plus three server-backed examples. Domain: generated
  tables of up to 12 labels across up to three owners and two repository
  names with overlapping label names. Artefact: `tests/label-selectors.test.ts`.
  Evidence: every label is found under random casings and padding of its
  name, absent coordinates give `undefined`, and listings equal an independent
  oracle (filter the input array, then sort by canonical name). Non-vacuity:
  the generator forces at least one name shared across two repositories in
  every run. Negative control: a lookup that ignores `owner` fails the
  cross-owner case.
- Obligation: `INV-url-projection`. Method: parameterized tests plus a
  property. Domain: names with spaces, `/`, `:`, `#`, `?`, `%`, and emoji;
  override present or absent; API roots `/` and `/api/v3`. Artefact:
  `tests/label-urls.test.ts`. Evidence: the last path segment decodes back to
  the original name. Negative control: an unencoded name fails the `/` and `#`
  rows.
- Obligation: `INV-boundary`. Method: a unit test that reads the three policy
  modules' source and asserts that no import specifier matches `zod`,
  `starfx`, `express`, or `@simulacrum/`. Negative control: adding
  `import {z} from 'zod'` fails it.
- Obligation: `INV-proof-fresh`. Method: `tests/proof-stamp.test.ts` hashes
  each file listed in `proofs.stamp` and compares the hashes. Negative
  control: editing a comment in `src/store/entities/label-id.ts` without
  running `make prove` fails the test.

### Formal verification decision

Formal proof covers the shared key grammar (`L-grammar-*`) and identifier
allocation (`L-next-fresh`, `L-allocate-unique`). These are the two places
where later tasks (1.5.2 creates and renames, 8.2.2 linking, every existing
parser) need guarantees for every input rather than sampled ones, and both fit
LemmaScript's supported fragment. Model checking is unnecessary: 1.5.1 has no
concurrency, protocol, or state machine. The proofs leave the following
unverified, covered instead by tests: Unicode case folding (outside the
ASCII-only model; `INV-fold-idempotent`), the Zod schema and seed refinements
(adapter code), the thin public wrappers (`INV-wrapper-total`), and the
foundation simulator's table storage (`AXIOM-foundation-table`). Proving the
URL projector would add little, because `encodeURIComponent` is trusted and
the projector is a template. This is recorded as D12 and D14.

### Suggested BDD features

Adopted, using the repository's existing `@aboviq/bun-test-cucumber` runner.
Path: `features/repository-labels.feature`; steps:
`tests/repository-labels.steps.ts`. Runner command:
`bun test tests/cross-owner-identity.features.test.ts`, which loads every
feature file.

```gherkin
@repository-labels
Feature: Repository labels are first-class seeded state

  # REQ-seed, REQ-select, REQ-identity; EP-M4
  Scenario: A seeded label is selectable by repository and any casing of its name
    Given a simulator seeded with repository "acme/awesome-repo" and label "Bug" coloured "f29513"
    When the store is asked for label " BUG " in "acme/awesome-repo"
    Then the selected label has name "Bug", colour "f29513", and a null description
    And the selected label has identifier 1000001 and a node ID derived from "Label:1000001"

  # REQ-key, REQ-select; EP-M4
  Scenario: Same-named labels in different owners' repositories stay isolated
    Given a simulator seeded with repositories "acme/awesome-repo" and "globex/awesome-repo"
    And label "bug" coloured "f29513" in "acme/awesome-repo"
    And label "bug" coloured "0e8a16" in "globex/awesome-repo"
    When the store is asked for label "bug" in each repository
    Then "acme/awesome-repo" returns colour "f29513"
    And "globex/awesome-repo" returns colour "0e8a16"

  # REQ-seed (duplicates); EP-M3
  Scenario: Labels whose names differ only by case are rejected as duplicates
    Given an initial state with labels "Bug" and "bug" in "acme/awesome-repo"
    When the simulator parses the initial state
    Then seeding fails with a duplicate label key error mentioning "acme/awesome-repo:bug"

  # REQ-seed (unknown repository); EP-M3
  Scenario: A label for an unseeded repository is rejected
    Given an initial state with label "bug" in "acme/missing-repo" and no such repository
    When the simulator parses the initial state
    Then seeding fails with an unknown repository error mentioning "acme/missing-repo"

  # REQ-select (absence); EP-M4
  Scenario: Looking up an unknown label returns nothing
    Given a simulator seeded with repository "acme/awesome-repo" and label "Bug" coloured "f29513"
    When the store is asked for label "enhancement" in "acme/awesome-repo"
    Then no label is returned
```

`EP-M3` adds the two seeding-rejection scenarios; `EP-M4` adds the other
three.

## Plan of work

Each milestone ends with the gate list in `Concrete steps` and one or more
commits. Do not start a milestone while the previous one's gates fail.

### `EP-M0` LemmaScript feasibility probe (prototype)

Question: can LemmaScript 0.6.10's Dafny backend verify both proof targets in
the planned shapes? In a scratch directory `/tmp/label-proof-probe/` (never in
the worktree), write copies of the planned `repository-scoped-key.ts` and
`label-id.ts` with annotations. Run `lsc gen --backend=dafny <file>` and
`lsc check --backend=dafny <file>` on each, where `lsc` means
`npx --prefer-offline --yes --package=lemmascript@0.6.10 -- lsc`. Also run
`lsc check` with no file argument and a `LemmaScript-files.txt` to confirm
the batch form. List every artefact `lsc`
writes. Expected: generation succeeds; Dafny reports the postconditions as
verified or as specific unproved obligations (not translation errors). Go:
both files translate and the obligations are expressible, even if helper
lemmas are still needed. No-go fallbacks, in order: return a plain object
whose fields are always present (`{ok, owner, repo, reference}` with empty
strings when `ok` is false) instead of a discriminated union; express
`allocateLabelIds` as a recursive pure function instead of a loop; split the
splitter into separate pure accessor functions. If those fail, stop and
escalate. Delete the probe afterwards and record its transcript in
`Artefacts and notes`. The probe needs network access for `npx`; if that is
unavailable, stop and report.

### `EP-M1` preparatory refactor of `src/store/index.ts`

Assigned: `GAP-size`, D15. Move the owner-projection helpers as D15 describes
into `src/store/repository-owner-projection.ts` with a `/** @file … */` block
and their existing JSDoc. No behaviour changes. Red-Green-Refactor does not
apply to a pure move; the existing suites `tests/store-selectors.test.ts`,
`tests/repositories.test.ts`, `tests/graphql.test.ts`, and
`tests/repository-write.test.ts` are the regression net and must pass
unchanged. Acceptance: `wc -l src/store/index.ts` prints at most 400
(expected about 360) and all gates pass. Commit: "Extract repository owner
projection from store index".

### `EP-M2` proved key grammar and canonical label keys

Assigned: `REQ-key`, `REQ-boundary`, `GAP-grammar`, D1–D3, D12, D14, D19.

Step 1, shared grammar (red, green, refactor). Write
`tests/repository-scoped-key.test.ts` with examples and fast-check properties
for `formatRepositoryScopedKey`, `splitRepositoryScopedKey`, and
`isKeySegment` (including the UTF-16 code-unit round trip), and run
`bun test tests/repository-scoped-key.test.ts`; it fails because the module
does not exist. Create `src/store/repository-scoped-key.ts` with no imports,
annotated with `//@ verify`, `//@ requires`, and `//@ ensures`. Run the test
green. Then run `lsc gen` once, commit the generated `.dfy.gen` and initial
`.dfy`, and add helper lemmas to `src/store/repository-scoped-key.dfy` until
`lsc check` verifies. Create `scripts/prove.sh` (Bash, `set -euo pipefail`,
`shellcheck`-clean) implementing D14, `LemmaScript-files.txt`, and a
`prove` target in `Makefile` (with a `.PHONY` entry); validate with
`mbake validate Makefile` and `checkmake Makefile`. Run `make prove` to
create `proofs.stamp`. Write `tests/proof-stamp.test.ts`. Run both negative
controls, record the transcripts, and revert. Change the private
`parseRepositoryScopedReferenceKey` in `src/store/keys.ts` to call
`splitRepositoryScopedKey`, keeping its exact error messages and `cause`
chaining (the repository-part error is still produced by
`parseRepositoryStoreKey` on the prefix), and confirm
`tests/store-keys.test.ts` passes unchanged. Commit: "Prove the
repository-scoped key grammar shared by store keys".

Step 2, canonical label keys (red, green, refactor). Write
`tests/label-keys.test.ts` covering `labelStoreKey`, `parseLabelStoreKey`,
`labelNodeId`, the internal `canonicalLabelName`, `INV-fold-idempotent`,
`INV-case-identity`, `INV-wrapper-total`, and the `INV-boundary` import check.
It fails on missing exports. Create `src/store/entities/label-policy.ts` with
`canonicalLabelName` and `labelStoreKey`, which validates its input (key
segments, non-empty canonical name) and throws an `Error` whose message begins
`Invalid label coordinates` and names the offending owner, repository, or
name, then calls `formatRepositoryScopedKey`. In `src/store/keys.ts` add
`LabelStoreKeyParts`, `labelNodeId(id: number)`, and
`parseLabelStoreKey(key)`, which uses the same private parser with entity name
`label` and reference name `name`, then throws an `Error` whose message
begins `Non-canonical label store key` and quotes the key when the name
segment differs from its canonical form. Re-export
`labelStoreKey` from `src/store/keys.ts` and export the public symbols from
`src/index.ts`. Add `typos.local.toml` patterns now if `make spelling` flags
any new identifier. Run all gates and `make prove`. Commit: "Add canonical
repository label keys".

### `EP-M3` proved identifier allocation, label schema, seeding, builder, and URL projection

Assigned: `REQ-identity`, `REQ-fields`, `REQ-seed`, `REQ-serialize`,
`REQ-exports`, `GAP-entity`, `GAP-url`, D4–D10, D16, D18, D19.

Step 1, allocator (red, green, proof). Write `tests/label-id.test.ts` (fixed
examples, the oracle property, and counters); it fails on the missing module.
Create `src/store/entities/label-id.ts` (no imports) with `LABEL_ID_FLOOR`,
`nextLabelId(taken: readonly number[]): number`, and
`allocateLabelIds(explicit: readonly number[], count: number): number[]`,
annotated for LemmaScript. Add it to `LemmaScript-files.txt`, generate, add
lemmas to `src/store/entities/label-id.dfy`, run `make prove`, run the
negative controls, and revert them. Commit: "Prove fresh label identifier
allocation".

Step 2, schema and seeding (red, green, refactor). Write
`tests/label-entity.test.ts` (field defaults, each field-rule rejection row
with its twin, `INV-flat-reparse`, each seed-level rejection with its own
message, `INV-seed-order-independent`, and identifier assignment in key order)
and `tests/label-urls.test.ts`. Add the two `EP-M3` scenarios to
`features/repository-labels.feature` with their steps in
`tests/repository-labels.steps.ts`. Run them red. Then:

1. In `src/store/entities/label.ts`, add `githubLabelSchema` (`owner` and `repo`
   trimmed and refined with `isKeySegment`; `name` trimmed and non-empty;
   `color` matching the regex, default `ededed`; `description` nullable, at
   most 100 characters, default `null`; `default` defaulting to `false`;
   optional `id`, `node_id`, and `url`), with field JSDoc, plus the
   `GitHubLabelFixture` and `GitHubLabel` types.
2. In `src/store/entities/label-policy.ts`, add the pure seed predicates
   `findLabelsWithUnknownRepository`, `findDuplicateLabelKeys`,
   `findDuplicateExplicitLabelIds`, and `findDuplicateExplicitLabelNodeIds`,
   and `assignLabelIdentifiers(fixtures)`, which sorts by key with `toSorted`,
   calls `allocateLabelIds`, and fills `node_id` with `labelNodeId`.
3. In `src/store/entities.ts`, add
   `labels: z.array(githubLabelSchema).optional().default([])`, a
   `superRefine` on the object (before the existing `.transform`) that reports
   D18's issues in order through a named helper, call
   `assignLabelIdentifiers` inside the transform, add
   `labels: convertObjByKey(initialState.labels, labelStoreKey)` to
   `convertInitialStateToStoreState`, and re-export the label symbols.
4. In `src/store/index.ts`, register
   `labels: slice.table<GitHubLabel>(tableOptions(storeInitialState, 'labels'))`.
5. In `src/store/builders.ts`, add `LabelFixtureInput` and
   `buildLabelFixture(input): GitHubLabelFixture` with JSDoc and an example.
6. Create `src/urls/label.ts` (`labelUrlFields`, `LabelUrlPayload`, and
   `projectLabelUrls`) following `src/urls/issue.ts`, and export it from
   `src/urls/index.ts` only.
7. Export the public symbols from `src/index.ts`, and add compile-time
   assertions for `buildLabelFixture`, `LabelFixtureInput`, and
   `GitHubLabel` to `tests/documented-surface.test-d.ts`.
8. Add narrow `typos.local.toml` ignore patterns for the GitHub field, for
   example `'\bcolor\??\s*:'`, `'\.color\b'`, and `"['\"]color['\"]"`, and
   run `make spelling` to regenerate `typos.toml`. Do not add `color` as an
   accepted word.

Run all gates and `make prove`. Commit: "Seed first-class repository labels
with builders and URL projection".

### `EP-M4` label selectors, behavioural feature, and end-to-end seeding

Assigned: `REQ-select`, `REQ-exports`, D11. Red first: write
`tests/label-selectors.test.ts` (the `INV-scoped-selection` property against
`selectLabelFromTable` and `listRepositoryLabelsFromTable`, and three
server-backed examples sharing one server started with
`simulation({initialState}).listen(0)` and closed with `ensureClose()`), add
the three remaining scenarios to the feature file, and add compile-time
assertions for `getLabel` and `listLabelsForRepository` on the
`GitHubSelectors` type to `tests/documented-surface.test-d.ts`. They fail
because the selectors do not exist.

Green: in `src/store/entities/label-policy.ts` add `selectLabelFromTable` and
`listRepositoryLabelsFromTable`. Export `StoreTable`, `CreateSelector`, and
`buildRepoIndex` from `src/store/early-entity-selectors.ts` (internal only).
Create `src/store/label-selectors.ts` exporting `LabelSelectorArgs` and
`buildLabelSelectors`. In `src/store/index.ts`, spread
`buildLabelSelectors({createSelector: args.createSelector, schema: {labels:
args.schema.labels}})` into `inputSelectors`, and confirm the file is at most
400 lines. Run all gates and `make prove`. Commit: "Select repository labels
by repository and name".

### `EP-M5` documentation, roadmap, and delivery closure

Assigned: `REQ-docs`, D17. Update:

- `docs/users-guide.md`: a "Seeding repository labels" section after "Seeding
  early collaboration entities" with the tested example
  `seed-repository-labels` (seed two labels, select one with a different
  casing, print its name, colour, and identifier as JSON), covering
  case-insensitive identity, defaults, identifier allocation, and the
  unknown-repository rule; and a `labelStoreKey` subsection under "Store key
  helpers and parsers" with the tested example `label-store-key` printing
  `acme/awesome-repo:good first issue`. Register both identifiers in
  `DOCUMENTED_EXAMPLE_IDS`, add observations, and put the handlers in the new
  `tests/support/documented-example-label-checks.ts`, which exports entries
  for spreading into the existing tables.
- `docs/developers-guide.md` §"Early repository-owned entities": replace the
  "do not expand into labels" sentence with the label slice's module map, the
  pure-policy boundary, identifier allocation, and a new "Formal
  verification" subsection: installing Dafny 4.11, running `make prove`, the
  LemmaScript rules (edit `.dfy`, never `.dfy.gen`; run `lsc regen` after
  changing annotated TypeScript; never delete a `.dfy`), and the stamp test.
- `docs/api-reference.md`: add the D19 public symbols to §"Exported fixture
  schemas" and its table, document the selectors, and change the "labels
  remain later work" sentence (line 123) to say label state exists while label
  routes arrive in 1.5.2.
- `docs/architecture.md`: change the `src/store/entities/label.ts` entry from
  planned to delivered; add `label-policy.ts`, `label-id.ts`,
  `repository-scoped-key.ts`, `label-selectors.ts`,
  `repository-owner-projection.ts`, and `src/urls/label.ts`; add `labels` to
  §"State model" with key `owner/repo:<canonical label name>`; and under
  §"Repository label slice" record D1, D7, D8, D10, D17, the R1 residual gap,
  and the forward constraints below.
- `docs/roadmap.md`: mark 1.5.1 `[x]` with a one-line "Delivered:" note.
- `docs/contents.md`: add the 1.5.1 plan link.
- `CHANGELOG.md`: add an unreleased entry for repository label entities.

Run `make markdownlint`, `make nixie`, and all gates plus `make prove`.
Reconcile `Conformance basis`, complete `Outcomes & retrospective`, set the
status to `COMPLETE`, and commit: "Document repository label entities
(1.5.1)".

### Forward constraints for 1.5.2 and 8.2.2

These are recorded so later tasks build on this design rather than around
it. They are documented in `docs/architecture.md` in `EP-M5`.

- Rename (`PATCH` with `new_name`) re-keys a label unless only the case
  changes; it needs a re-keying write (D17), must return `422` when the
  target key exists, keeps `id` and `node_id`, and clears a seeded `url`
  override, which would otherwise point at the old name.
- Create allocates with `nextLabelId` over the identifiers in the table and
  must reject a canonical-key duplicate with `422 already_exists`.
- `github3.py` joins label names into request paths without encoding, so a
  name such as `area/api` arrives as `/labels/area/api`. The `GET` and `PATCH`
  routes must capture the rest of the path as the name and decode it once,
  with tests showing that encoded and raw forms resolve to the same key.
- Issue-label links in 8.2.2 reference the label `id` and read name and
  colour by joining at read time; they must not store keys or copies of
  names.

## Milestones and plateaus

- `EP-M0`: go or no-go decision on LemmaScript, with transcript. No
  repository change. Recovery: delete `/tmp/label-proof-probe/`.
  Compatibility decision: none.
- `EP-M1`: `src/store/index.ts` at or below 400 lines, behaviour unchanged.
  Requirements: `GAP-size`. Evidence: `wc -l` and unchanged test results.
  Conformance check, one line per item:
  - `GAP-size` closed.
  - No public type moved out of `src/store/index.ts`.
  - No dependency, trust boundary, or persisted-format change.
  Recovery: `git revert` the commit. Remaining gaps: all label work.
  Compatibility decision: none.
- `EP-M2`: proved key grammar shared by existing parsers; canonical label
  keys, parser, and node-identifier helper exported. Requirements: `REQ-key`,
  `REQ-boundary`, `GAP-grammar`. Evidence: `make prove`,
  `tests/repository-scoped-key.test.ts`, `tests/label-keys.test.ts`,
  `tests/proof-stamp.test.ts`, and unchanged `tests/store-keys.test.ts`.
  Conformance check:
  - D1, D3, and D12 applied.
  - The policy modules have no framework imports.
  - Existing parser messages unchanged.
  - No dependency added (LemmaScript through `npx` only).
  Recovery: revert the commits; `.dfy` files are reproducible with
  `lsc regen`. Remaining gaps: no seedable entity. Compatibility decision:
  none (new exports only).
- `EP-M3`: labels seed through `initialState`, build through
  `buildLabelFixture`, receive unique identifiers, and project URLs.
  Requirements: `REQ-identity`, `REQ-fields`, `REQ-seed`, `REQ-serialize`,
  `REQ-exports`, `GAP-entity`, `GAP-url`. Evidence: `make prove`,
  `tests/label-id.test.ts`, `tests/label-entity.test.ts`,
  `tests/label-urls.test.ts`, two feature scenarios, and type assertions.
  Conformance check:
  - The seed shape stays backwards compatible.
  - No route registered.
  - The stored entity is host-agnostic.
  - `make spelling` passes without accepting `color` as a word.
  Recovery: revert the commits. Remaining gaps: selectors. Compatibility
  decision: none.
- `EP-M4`: labels selectable by repository and name. Requirements:
  `REQ-select`, `REQ-exports`. Evidence: `tests/label-selectors.test.ts`, the
  full feature file, and selector type assertions. Conformance check:
  - Selectors canonicalize input.
  - `src/store/index.ts` stays at or below 400 lines.
  - Index helpers reused, not duplicated.
  Recovery: revert the commit. Remaining gaps: documentation. Compatibility
  decision: none.
- `EP-M5`: documentation, roadmap, and changelog current; plan complete.
  Requirements: `REQ-docs`. Evidence: Markdown gates and executed users-guide
  examples. Recovery: revert the documentation commit. Remaining gaps: 1.5.2
  and 1.5.3. Compatibility decision: none.

## Concrete steps

Working directory for every command: the repository root of this worktree.
Run each gate sequentially, capturing output with `tee` and with `pipefail`
set so a failing gate cannot look like a pass. This list mirrors CI:

```sh
set -o pipefail
BRANCH=$(git branch --show-current)
make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-$BRANCH.out
make typecheck 2>&1 | tee /tmp/typecheck-simulacat-core-$BRANCH.out
make docs-check 2>&1 | tee /tmp/docs-check-simulacat-core-$BRANCH.out
make lint 2>&1 | tee /tmp/lint-simulacat-core-$BRANCH.out
make test 2>&1 | tee /tmp/test-simulacat-core-$BRANCH.out
make spelling 2>&1 | tee /tmp/spelling-simulacat-core-$BRANCH.out
make build 2>&1 | tee /tmp/build-simulacat-core-$BRANCH.out
make prove 2>&1 | tee /tmp/prove-simulacat-core-$BRANCH.out   # from EP-M2 onwards
```

For documentation milestones, also run:

```sh
make markdownlint 2>&1 | tee /tmp/markdownlint-simulacat-core-$BRANCH.out
make nixie 2>&1 | tee /tmp/nixie-simulacat-core-$BRANCH.out
```

Expected red and green transcripts, per milestone:

```plaintext
EP-M2 red:   bun test tests/repository-scoped-key.test.ts -> fails: cannot find module '../src/store/repository-scoped-key.ts'
EP-M2 green: same command -> all pass
EP-M2 proof red:   lsc check (before lemmas) -> a postcondition could not be proved (round trip)
EP-M2 proof green: make prove -> Dafny program verifier finished with N verified, 0 errors; stamp written
EP-M2 red:   bun test tests/label-keys.test.ts -> fails: export 'labelStoreKey' not found
EP-M2 green: same command -> all pass
EP-M3 red:   bun test tests/label-id.test.ts -> fails: cannot find module
EP-M3 red:   bun test tests/label-entity.test.ts tests/label-urls.test.ts -> fails: missing exports
EP-M3 green: same commands -> all pass; make prove -> 0 errors
EP-M4 red:   bun test tests/label-selectors.test.ts -> fails: getLabel is not a function
EP-M4 green: same command -> all pass
```

Baseline: all gates pass on `c2e5ddc` per the latest `main` CI run. If a gate
fails before any change, record it in `Surprises & discoveries` with the log
path and stop rather than waiving it.

## Validation and acceptance

Acceptance is behavioural:

- Starting `simulation({initialState})` with the purpose example's
  `initialState` succeeds, and
  `selectors.getLabel(state, {owner: 'acme', repo: 'awesome-repo', name: 'BUG'})`
  returns the label named `Bug` with colour `f29513`, `id` `1000001`, and
  `node_id` equal to Base64 of `Label:1000001`.
- Reversing the `labels` array produces identical stored labels.
- The same `initialState` with an extra label named `bug` fails at startup
  with a duplicate-label-key `ZodError` containing `acme/awesome-repo:bug`.
- A label for `acme/missing-repo` with no such repository fails at startup
  with an unknown-repository `ZodError` containing `acme/missing-repo`.
- `labelStoreKey` called with owner `acme`, repository `awesome-repo`, and
  name `Good First Issue` padded with spaces returns
  `acme/awesome-repo:good first issue`, and `parseLabelStoreKey` of that
  string returns the canonical parts; `parseLabelStoreKey` of
  `acme/awesome-repo:Bug` throws the non-canonical error.
- The internal `projectLabelUrls` for a label named `good first issue` and an
  API base of `http://localhost:3300` returns `url`
  `http://localhost:3300/repos/acme/awesome-repo/labels/good%20first%20issue`.
- `make test` passes, including the new feature file, test files, stamp test,
  and the two new users-guide examples; each new test fails before its
  milestone's implementation and passes after.
- `make prove` reports zero errors for both proved modules.

Quality criteria: all gates in `Concrete steps` pass at every milestone from
`EP-M2` (and all except `make prove` at `EP-M1`); `make markdownlint` and
`make nixie` pass at `EP-M5`. Every obligation in `Verification plan` is
discharged with its negative control recorded. No performance or security
gate changes beyond the existing ones.

## Idempotence and recovery

Every step is a source edit followed by gates and can be rerun. Run `lsc gen`
only once per file; afterwards use `lsc regen`, which three-way merges proof
additions. Never delete a `.dfy` file to start again. Negative controls are
uncommitted edits reverted with `git restore <file>`; afterwards check
`git status` for `.dfy.gen` drift and rerun `make prove` so `proofs.stamp`
matches. Each milestone step is its own commit, so `git revert <sha>` restores
the previous plateau.

## Artefacts and notes

Reconnaissance evidence (planning, not implementation):

```plaintext
github3.py 3.2.0 src/github3/issues/label.py _update_attributes reads:
  label["url"], label["color"], label["name"], label["description"]
GitHub REST labels docs: "Label names are case-insensitive."
  color: hexadecimal without leading '#'; description: <= 100 characters
LemmaScript 0.6.10 string model: seq<char>; indexOf, slice, includes, length,
  concatenation, template literals, ===; toLowerCase ASCII-only
wc -l src/store/index.ts -> 427 (c2e5ddc)
typos (en-gb) on '{color: "f29513"}' -> `color` should be `colour`
```

Design review summary (2026-11-15). Panel: structure and contracts; failure
modes and verification; alternatives and viability. Verdict: proceed with
conditions. Conditions applied in this revision: allocate identifiers rather
than hash keys (D7, D8); record the rename consequence (D17); separate pure
policy from the Zod adapter; canonicalize with trim and lower case; report
seed violations in a defined order (D18); move proofs onto the shared grammar
and the allocator (D12); guard proof freshness with a stamp test (D14); run
property tests on pure functions (R8); admit `color` through narrow spelling
patterns; widen the file budget; trim the public surface (D19); and record the
forward constraints for 1.5.2 and 8.2.2.

`EP-M0` transcripts, red and green proof transcripts, and negative-control
transcripts are added here during implementation.

## Interfaces and dependencies

No new runtime or development dependency. LemmaScript 0.6.10 runs through
`npx` (D14); Dafny 4.11.0 is a host tool.

`src/store/repository-scoped-key.ts` (proved, no imports, internal):

```typescript
export function isKeySegment(segment: string): boolean;
export function formatRepositoryScopedKey(owner: string, repo: string, reference: string): string;
export type SplitRepositoryScopedKeyResult =
  | {readonly ok: true; readonly owner: string; readonly repo: string; readonly reference: string}
  | {readonly ok: false};
export function splitRepositoryScopedKey(key: string): SplitRepositoryScopedKeyResult;
```

The result shape may change in `EP-M0`; any change is recorded in `Decision
log`.

`src/store/entities/label-id.ts` (proved, no imports, internal):

```typescript
export const LABEL_ID_FLOOR = 1_000_000;
export function nextLabelId(taken: readonly number[]): number;
export function allocateLabelIds(explicit: readonly number[], count: number): number[];
```

`src/store/entities/label-policy.ts` (pure, internal):

```typescript
export const canonicalLabelName: (name: string) => string;
export const labelStoreKey: (label: {owner: string; repo: string; name: string}) => string;
export const findLabelsWithUnknownRepository: (
  labels: readonly GitHubLabelFixture[],
  repositoryKeys: ReadonlySet<string>
) => GitHubLabelFixture[];
export const findDuplicateLabelKeys: (labels: readonly GitHubLabelFixture[]) => DuplicateLabelKey[];
export const findDuplicateExplicitLabelIds: (labels: readonly GitHubLabelFixture[]) => number[];
export const findDuplicateExplicitLabelNodeIds: (labels: readonly GitHubLabelFixture[]) => string[];
export const assignLabelIdentifiers: (labels: readonly GitHubLabelFixture[]) => GitHubLabel[];
export const selectLabelFromTable: (
  table: Readonly<Record<string, GitHubLabel>> | undefined,
  coords: LabelStoreKeyParts
) => GitHubLabel | undefined;
export const listRepositoryLabelsFromTable: (labels: readonly GitHubLabel[], coords: RepositoryCoords) => GitHubLabel[];
```

`GitHubLabelFixture` and `GitHubLabel` are type-only imports from
`label.ts`, so the policy module stays free of Zod at runtime; the
`INV-boundary` test checks value imports.

`src/store/entities/label.ts` (Zod seeding adapter):

```typescript
export const githubLabelSchema; // @internal, like the other entity schemas
export interface GitHubLabelFixture {
  owner: string; repo: string; name: string; color: string; description: string | null;
  default: boolean; id?: number; node_id?: string; url?: string;
}
export interface GitHubLabel extends GitHubLabelFixture { id: number; node_id: string; }
```

`src/store/keys.ts` additions:

```typescript
export type LabelStoreKeyParts = {owner: string; repo: string; name: string};
export const labelNodeId: (id: number) => string;
export const parseLabelStoreKey: (key: string) => LabelStoreKeyParts;
export {labelStoreKey} from './entities/label-policy.ts';
```

`src/store/label-selectors.ts` (internal):

```typescript
export type LabelSelectorArgs = {createSelector: CreateSelector; schema: {labels: StoreTable<GitHubLabel>}};
export const buildLabelSelectors: (args: LabelSelectorArgs) => {
  getLabel: (state: AnyState, coords: LabelStoreKeyParts) => GitHubLabel | undefined;
  listLabelsForRepository: (state: AnyState, coords: RepositoryCoords) => GitHubLabel[];
};
```

`src/store/builders.ts` additions:
`export type LabelFixtureInput = z.input<typeof githubLabelSchema>;` and
`export const buildLabelFixture: (input: LabelFixtureInput) => GitHubLabelFixture;`.

`src/urls/label.ts` (internal): `labelUrlFields = ['url'] as const`,
`LabelUrlField`, `LabelUrlPayload`, and
`projectLabelUrls(label: LabelUrlPayload, baseUrls: BaseUrls): LabelUrlPayload`.

`src/store/repository-owner-projection.ts` (internal, `EP-M1`): the D15
helpers, moved unchanged.

Public exports added to `src/index.ts` (D19): `githubLabelSchema`,
`GitHubLabel`, `GitHubLabelFixture`, `buildLabelFixture`, `LabelFixtureInput`,
`labelStoreKey`, `parseLabelStoreKey`, `LabelStoreKeyParts`, and
`labelNodeId`.

Tooling added: `scripts/prove.sh`, `Makefile` target `prove`,
`LemmaScript-files.txt`, `proofs.stamp`, and narrow `typos.local.toml`
patterns.

Reuse policy: 1.5.2 handlers and write actions obtain keys only through
`labelStoreKey` and `parseLabelStoreKey`, identifiers only through
`nextLabelId`, labels only through `getLabel` and `listLabelsForRepository`,
and URLs only through `projectLabelUrls`. A second key derivation, identifier
scheme, or label representation anywhere else, including 8.2.2's issue-label
linking, violates this design.

## Revision note

- 2026-11-15: initial draft from Wyvern reconnaissance and Firecrawl research.
- 2026-11-15: applied the community-of-experts design review. Replaced
  key-hashed identifiers with proved monotonic allocation and identifier-based
  node identifiers (D7, D8); added D17 (rename needs a re-keying write), D18
  (ordered seed validation), and D19 (smaller public surface); moved pure
  policy out of the Zod module; made canonicalization trim as well as fold;
  retargeted the proof to the shared key grammar and the allocator (D12);
  added proof freshness checks and a scripted `make prove` (D14); moved
  selector properties to pure functions; planned narrow spelling patterns for
  `color`; aligned the gate list with CI; widened the file, code,
  configuration, and documentation budgets; and recorded forward constraints
  for 1.5.2 and 8.2.2 and open questions Q1–Q3. Milestone order is unchanged;
  `EP-M2` and `EP-M3` each gained a proof step. Implementation still awaits
  approval.
