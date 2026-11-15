# 1.5.1 Add first-class repository label entities and builders

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`,
`Decision log`, `Outcomes & retrospective`, `Conformance basis`, and
`Verification plan` must be kept up to date as work proceeds.

Status: DRAFT (awaiting design review and user approval)

Branch: `1-5-1-first-class-repository-label-entities`

Roadmap item: `1.5.1` in `docs/roadmap.md`, step 1.5 "Add mutable repository
labels as an early vertical slice".

Approval gate: do not implement any milestone in this plan until the user
explicitly approves it. Silence, a merged review, or a passing CI run is not
approval.

## Purpose / big picture

Simulacat Core is a GitHub API simulator written in TypeScript. A test author
gives it an `initialState` object (users, organizations, repositories, issues,
and so on). The simulator parses that object with Zod schemas, stores the
result in keyed in-memory tables, and answers REST and GraphQL requests from
those tables. Zod is the runtime validation library used for every seeded
fixture shape.

Today the simulator has no notion of a repository label. A label is the small
coloured tag GitHub attaches to issues and pull requests, such as `bug` with
colour `f29513`. Labels belong to exactly one repository. The downstream
project simulacat (a pytest plugin that drives this simulator through the
Python client `github3.py`) needs label create, lookup, and update to work
against real simulator state. Roadmap step 1.5 delivers that as a narrow
vertical slice. This task, 1.5.1, lays the state foundation only: the label
entity, its canonical key, its selectors, its fixture builder, and its URL
projection. The REST handlers (`GET`, `POST`, `PATCH`) belong to 1.5.2, and the
upstream `github3.py` contract tests belong to 1.5.3.

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
server.simulationStore.selectors.getLabel(state, {owner: 'acme', repo: 'awesome-repo', name: 'bug'});
// -> {owner: 'acme', repo: 'awesome-repo', name: 'Bug', color: 'f29513',
//     description: "Something isn't working", default: false, id: <stable integer>,
//     node_id: <base64 of "Label:acme/awesome-repo:bug">}
labelStoreKey({owner: 'acme', repo: 'awesome-repo', name: 'Good First Issue'});
// -> 'acme/awesome-repo:good first issue'
```

Today the same `initialState` is rejected because `labels` is not a recognised
collection, and there is no selector, key helper, or builder for labels.

Observable success, matching the roadmap's success line, is that labels can be
seeded in `initialState`, selected by repository and name, and serialized as
flat records rather than raw nested dictionaries. Concretely: the new
behavioural feature `features/repository-labels.feature` passes, the new
users-guide examples `seed-repository-labels` and `label-store-key` execute
and print the documented output, and `make check-fmt`, `make typecheck`,
`make lint`, `make test`, and the new `make prove` all succeed.

Existing behaviour is preserved: every current `initialState` shape still
parses because `labels` defaults to an empty array. No existing export changes
signature. No REST or GraphQL route changes behaviour in this task.

## Constraints

- Do not implement until the user explicitly approves this plan.
- Work on branch `1-5-1-first-class-repository-label-entities`. Never commit
  to `main`.
- Preserve every existing export from `src/index.ts` and its signature. Adding
  exports is authorized; removing or changing existing ones is not.
- `githubInitialStoreSchema` must keep accepting every existing fixture shape.
  The new `labels` collection must be optional with a default of `[]`.
- Labels are repository-scoped state in their own `labels` store table keyed
  by `owner/repo:<canonical name>` (see decision D1). Labels must not be stored
  as nested dictionaries inside repository records.
- Domain and policy logic (canonical name folding, key formatting and parsing,
  identifier derivation, seed validation predicates) lives in pure modules
  with no Zod, starfx, Express, or foundation-simulator imports. Zod parsing is
  the seeding adapter at the boundary. REST and GraphQL adapters, when 1.5.2
  adds them, must call these helpers rather than re-deriving keys. This applies
  the `hexagonal-architecture` skill as a boundary check, not as a directory
  transplant: no new `domain/` or `ports/` tree is introduced.
- No REST handler, GraphQL resolver, OpenAPI route registration, or write
  action for labels is added in 1.5.1. Those are 1.5.2 scope.
- No new runtime dependency. No new `package.json` devDependency. The
  LemmaScript toolchain is invoked through a pinned `npx` command (decision
  D14); adding it to `package.json` requires separate approval.
- Every source and test file stays at or below 400 lines (AGENTS.md "Keep file
  size manageable"). `src/store/index.ts` is already 427 lines and must end
  this task at or below 400 lines (decision D15).
- New exported symbols carry full JSDoc so the zero-tolerance TypeDoc gate
  (`make docs-check`, configured in `typedoc.json`) passes. Do not add entries
  to `.jsdoc-baseline.json`.
- Lint policy from `docs/developers-guide.md` §Linting rules applies: Biome
  `noExcessiveLinesPerFunction` 70, `noExcessiveCognitiveComplexity` 8,
  Oxlint complexity 8, `max-depth` 3, `df12/complex-conditional` at most one
  logical operator per condition, `df12/require-module-jsdoc` (every module
  starts with a `/** @file … */` block), and unicorn rules such as
  `no-array-reduce` and `no-array-sort` (use `toSorted`).
- Documentation uses en-GB Oxford spelling, 80-column wrapping, and the
  conventions in `docs/documentation-style-guide.md`.
- Commit after each milestone (and the preparatory refactor separately), and
  gate every commit with `make check-fmt`, `make typecheck`, `make lint`, and
  `make test`, plus `make prove` once the proof exists.
- Historical ExecPlans in `docs/execplans/` other than this file must not be
  edited.

## Tolerances (exception triggers)

Comparison base: `origin/main` at `c2e5ddcb8092c327003f92916fe8e4a7befd5037`.
Count with:

```sh
git diff --numstat c2e5ddc -- . ':(exclude)docs/execplans/*' ':(exclude)*.dfy.gen'
```

This ExecPlan file is excluded from every count. Generated `*.dfy.gen` files
written by `lsc gen` are excluded as generated artefacts; the hand-maintained
`*.dfy` proof file counts as code. Classification is whole-file by purpose:
`src/**`, `tests/**`, `features/**`, `*.dfy`, and `Makefile` are code;
`LemmaScript-files.txt`, `typos.local.toml`, `package.json`, and CI workflows
are configuration; `docs/**` (except ExecPlans), `README.md`, and
`CHANGELOG.md` are documentation. All limits are net lines (additions minus
deletions), enforced independently per category.

- Files: if more than 34 non-ExecPlan files change, stop and escalate.
- Code: if code changes exceed 2,000 net lines, stop and escalate.
- Configuration: if configuration changes exceed 30 net lines, stop and
  escalate.
- Documentation: if documentation changes exceed 380 net lines, stop and
  escalate.
- Interface: adding the exports listed in `Interfaces and dependencies` is
  authorized. Any other public API change, or any change to an existing
  export, requires escalation.
- Dependencies: no new runtime or dev dependency. If LemmaScript cannot run
  through the pinned `npx` invocation, stop and escalate rather than adding it
  to `package.json`.
- Architecture: if 1.5.1 appears to need a REST handler, GraphQL resolver, or
  write action, or if case-insensitive keys (D1) prove incompatible with the
  foundation simulator's table API, stop and escalate.
- Proof: if the LemmaScript feasibility probe (`EP-M0`) cannot verify the key
  round-trip within four working hours, or verification requires `//@ assume`
  on anything other than a deliberately havocked value, stop and escalate.
- Iterations: if a gate still fails after three fix attempts for the same
  cause, stop and escalate.
- Time: if any milestone exceeds one working day, stop and escalate.
- Ambiguity: if a GitHub behaviour this plan relies on (case-insensitive label
  names, colour format, description length) is contradicted by evidence, stop
  and present options.

Budget survey. The closest precedent is
`docs/execplans/1-1-2-first-class-entities-for-early-slices.md`, which added
four entities with a 22-file, 1,200 net-source-line tolerance (documentation
and generated files excluded). Its decision log records no budget increase,
but it did force an unplanned structural move (selectors into
`src/store/early-entity-selectors.ts`) because `src/store/index.ts` crossed 400
lines. Plans 1.1.1 (12 files, 600 lines), 1.2.1 (16 files, 700), 1.2.2 (18
files, 900), 1.3.1 (about 12 files, about 500 non-test lines), and 1.4.1
(about 600 lines per milestone) also record no budget increases; none records
its final diff size, so there is no evidence of systematic underestimation,
only of the recurring `src/store/index.ts` size pressure, which this plan
schedules explicitly as `EP-M1`.

The estimate for this plan, from tracing every affected caller and test:

- Production source, about 520 net lines: `src/store/entities/label.ts` (new,
  about 140), `src/store/entities/label-key.ts` (new, proved, about 90),
  `src/store/label-selectors.ts` (new, about 75), `src/urls/label.ts` (new,
  about 45), `src/store/repository-owner-projection.ts` (new, about 60, moved
  from `src/store/index.ts`, net about 0 after the move), plus edits to
  `src/store/entities.ts` (about +30), `src/store/keys.ts` (about +40),
  `src/store/builders.ts` (about +15), `src/store/entity-id-offsets.ts` (about
  +8), `src/store/index.ts` (about +6 before the extraction), `src/urls/index.ts`
  (about +2), and `src/index.ts` (about +16).
- Tests and features, about 1,000 net lines: `tests/label-entity.test.ts`,
  `tests/label-keys.test.ts`, `tests/label-selectors.test.ts`,
  `tests/label-urls.test.ts`, `tests/repository-labels.steps.ts`,
  `features/repository-labels.feature`, a new
  `tests/support/documented-example-label-checks.ts`, and small edits to
  `tests/documented-surface.test-d.ts`, `tests/support/documented-example-*.ts`,
  and the existing seed-shape snapshot if it records collections.
- Proof, about 160 net lines in `src/store/entities/label-key.dfy` (generated
  base plus hand-written lemmas) and about 8 lines of `Makefile`.

That totals roughly 1,690 lines against a 2,000-line code budget; the
contingency of about 18 per cent covers proof helper lemmas, which are the
least predictable item. Documentation is estimated at about 260 lines
(users guide about 110, developers guide about 45, API reference about 35,
architecture about 35, roadmap, contents, and changelog about 15) against a
380-line budget. Configuration is two files: `LemmaScript-files.txt` (1 line)
and possibly a `typos.local.toml` exception for `fnv` or Dafny keywords.

## Risks

- Risk R1: GitHub's exact case-folding rule for label names is undocumented
  beyond "label names are case-insensitive". `String.prototype.toLowerCase()`
  may disagree with GitHub for some non-ASCII names. Severity: low.
  Likelihood: medium. Mitigation: fold with locale-independent
  `toLowerCase()`, document the residual gap in `docs/architecture.md`, and
  let 1.5.3's real-client contract tests flag ASCII disagreements; non-ASCII
  parity is explicitly unclaimed.
- Risk R2: LemmaScript is a tech preview. Its Dafny backend may not model the
  exact functions (record returns, `indexOf`, `slice`) used by the key
  grammar. Severity: medium. Likelihood: medium. Mitigation: `EP-M0` is a
  time-boxed feasibility probe on the real `label-key.ts` before anything else
  depends on it; the function shapes are chosen to stay inside the documented
  string subset (`indexOf`, `slice`, `includes`, `length`, concatenation, and
  `===`).
- Risk R3: the deterministic identifier derivation (D7) could collide for two
  labels in one seed. Severity: low. Likelihood: low (about n²/2×10⁹ for n
  labels). Mitigation: seed-time duplicate-identifier detection fails loudly
  and names both keys; fixture authors can supply `id` explicitly.
- Risk R4: requiring that each label's repository exists (D10) is a stricter
  seed rule than issues and refs currently have, and could surprise callers
  who seed labels before repositories in separate calls. Severity: low.
  Likelihood: low (no existing callers seed labels). Mitigation: a clear error
  message naming the label key and the missing repository, and a users-guide
  note.
- Risk R5: `src/store/index.ts` and
  `tests/support/documented-example-execution.ts` (392 lines) sit at or over
  the 400-line rule. Severity: low. Likelihood: high. Mitigation: `EP-M1`
  extracts owner projection from `src/store/index.ts`; new example checks go
  in a new support module so the execution module grows by at most four
  lines.
- Risk R6: the users-guide example harness runs examples as child processes
  and may need a per-example observation contract. Severity: low. Likelihood:
  medium. Mitigation: follow the existing `seed-collaboration-entities` and
  `branch-store-key` registrations exactly (inventory in
  `tests/support/documented-example-execution.ts`, observation in
  `tests/support/documented-example-observations.ts`).
- Risk R7: Unicode `toLowerCase()` might not be idempotent for some input,
  which would break key round-trips. Severity: medium. Likelihood: low.
  Mitigation: an exhaustive check over every Unicode scalar value plus a
  fast-check property over full-Unicode strings (see `INV-fold-idempotent`); a
  failure stops the plan for a folding-rule decision.

## Progress

- [x] (2026-11-15 19:45Z) Branch renamed to
  `1-5-1-first-class-repository-label-entities`; Lody session titled.
- [x] (2026-11-15 20:30Z) Reconnaissance with a Wyvern agent team (store
  entity pattern; tests, gates, and plan history; documentation and label
  references) and web research (`github3.py` label model, GitHub label REST
  contract, LemmaScript string model).
- [x] (2026-11-15 21:10Z) Initial draft written.
- [ ] Community-of-experts design review applied.
- [ ] Draft PR opened.
- [ ] Plan approved by the user.
- [ ] `EP-M0` LemmaScript feasibility probe (prototype).
- [ ] `EP-M1` preparatory refactor: `src/store/index.ts` at or below 400
  lines.
- [ ] `EP-M2` label policy, key grammar, and proof.
- [ ] `EP-M3` label schema, seeding, builder, and URL projection.
- [ ] `EP-M4` label selectors, behavioural feature, and end-to-end seeding.
- [ ] `EP-M5` documentation, roadmap, and delivery closure.

## Surprises & discoveries

- Observation: `src/store/index.ts` is already 427 lines, above the 400-line
  rule. Evidence: Wyvern reconnaissance line count at `c2e5ddc`. Impact:
  `EP-M1` is scheduled before any label wiring.
- Observation: `podbot-design.md` exists only in the unrelated podbot
  repository (`/data/lody/repos/github---leynos---podbot/…/docs/`), not in
  Simulacat Core or simulacat. Evidence: filesystem search. Impact: it is not
  a design input for this task; no requirement is drawn from it.
- Observation: `../simulacat/docs/simulacat-design.md` is not checked out
  beside this worktree but is readable from the simulacat bare repository at
  `main` (`d81e344`). Evidence:
  `git -C ~/.lody/repos/github---leynos---simulacat/bare.git show main:docs/simulacat-design.md`.
  Impact: its §"Phase 5 – core-backed labels and diagnostics" is quoted in
  `Conformance basis`.
- Observation: no test currently exercises `buildEarlyEntitySelectors`
  directly. Evidence: Wyvern reconnaissance of `tests/`. Impact: the label
  selectors get their own direct integration tests rather than relying on
  adapter coverage.

## Decision log

- D1. Decision: label identity is case-insensitive. The key's name segment is
  `canonicalLabelName(name)`, defined as `name.toLowerCase()`, while the
  stored `name` field preserves the author's display casing. Selectors fold
  their input, so `getLabel(state, {owner, repo, name: 'BUG'})` finds a label
  seeded as `Bug`. Seeding two labels whose names differ only by case is a
  duplicate-key error. Rationale: GitHub's label API documents that label
  names are case-insensitive, `github3.py`'s `repo.label(name)` relies on that
  lookup, and 1.5.2's create route must reject case-variant duplicates with
  `422 already_exists`; deciding identity now avoids re-keying stored state in
  1.5.2. Rejected alternative: verbatim-name keys, which match the other
  tables' exact-match behaviour but would force every adapter to scan for
  case-insensitive matches. The roadmap's `owner/repo:name` key is preserved
  with `name` read as the canonical name. Repository owner and name segments
  remain case-sensitive, as in every other table; changing that is out of
  scope. Date/Author: 2026-11-15, planning agent; subject to user approval.
- D2. Decision: label names are trimmed, must be non-empty, and may contain
  any other characters, including `:`, `/`, `#`, spaces, and emoji. Rationale:
  real label names such as `type: bug` and `area/api` are common; the key
  parser splits at the first `:`, which is unambiguous because owner and
  repository segments cannot contain `:` (D3). No maximum name length is
  enforced because GitHub's limit is not documented in the REST reference
  consulted. Date/Author: 2026-11-15, planning agent.
- D3. Decision: the label schema rejects `owner` and `repo` values containing
  `/` or `:`. Rationale: these are the key grammar's structural separators,
  and the key round-trip proof (`L-key-roundtrip`) requires them to be absent.
  Other entity schemas leave this to convention; tightening them is out of
  scope and recorded as follow-up. Date/Author: 2026-11-15, planning agent.
- D4. Decision: `color` must match `^[0-9a-fA-F]{6}$` (no leading `#`), is
  stored verbatim, and defaults to `ededed`. Rationale: GitHub's REST contract
  specifies a six-digit hexadecimal colour without `#`; `github3.py` strips a
  leading `#` client-side before sending, so the wire form never carries one.
  A default keeps fixtures terse. Date/Author: 2026-11-15, planning agent.
- D5. Decision: `description` is a string of at most 100 characters or
  `null`, defaults to `null`, and is always present on the parsed entity.
  Rationale: GitHub documents the 100-character limit, and `github3.py` 3.2.0
  and 4.x read `label["description"]` with indexing, so a missing key raises
  `KeyError` in the client. Date/Author: 2026-11-15, planning agent.
- D6. Decision: `default` is a boolean defaulting to `false`. Rationale: the
  GitHub `label` component schema in `schema/api.github.com.json` lists it as
  required. Date/Author: 2026-11-15, planning agent.
- D7. Decision: when `id` is omitted, it is derived deterministically as
  `LABEL_ID_BASE + (fnv1a32(creationKey) % LABEL_ID_SPAN)`, with
  `LABEL_ID_BASE = 1_000_000_000` and `LABEL_ID_SPAN = 1_000_000_000`, so
  derived identifiers lie in `[1e9, 2e9)`, below the GraphQL 32-bit `Int`
  limit and clear of the issue and pull-request bands. FNV-1a (Fowler–Noll–Vo
  hash, variant 1a) over the key's UTF-16 code units is used because it is a
  dozen lines, has no dependency, and is stable across runs. Seeding fails if
  two labels end up with the same `id`, naming both keys. Rationale: labels,
  unlike issues, have no per-repository number to offset, and the builder must
  return a complete entity without knowing the rest of the seed. Rejected
  alternatives: sequential allocation during store conversion (leaves
  builder output incomplete and makes identifiers depend on seed order) and
  random identifiers (non-deterministic snapshots). The identifier is an
  attribute that persists across a future rename in 1.5.2, as on GitHub.
  Date/Author: 2026-11-15, planning agent.
- D8. Decision: `node_id` defaults to Base64 of `Label:${labelStoreKey(label)}`
  through a new `labelNodeId` helper in `src/store/keys.ts`, following the
  `Repository:`, `Ref:`, and `Issue:` conventions. Like `id`, it persists
  across a future rename. Date/Author: 2026-11-15, planning agent.
- D9. Decision: the stored entity keeps `url` only as an optional seeded
  override. A new `projectLabelUrls` in `src/urls/label.ts` derives
  `url = <apiBase>/repos/<owner>/<repo>/labels/<encodeURIComponent(name)>`
  from request-scoped base URLs, using the display name, and preserves a
  seeded override. Rationale: roadmap 1.4.1 established that stored entities
  are host-agnostic and adapters project URLs per request; including the
  projector now completes the `url` field that `github3.py` needs and lets
  1.5.2 consume it unchanged. Date/Author: 2026-11-15, planning agent.
- D10. Decision: seeding fails when a label's `owner/repo` does not match a
  seeded repository key. Rationale: the simulacat design (Phase 5, step 5.1,
  rule 1) states that validation fails for labels on unknown repositories, and
  `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §6 "Validate seed state aggressively" recommends failing at startup. The
  check is a pure predicate in the label policy module invoked from the seed
  schema. Date/Author: 2026-11-15, planning agent.
- D11. Decision: selectors are `getLabel(state, {owner, repo, name})` and
  `listLabelsForRepository(state, {owner, repo})`, built by a new
  `buildLabelSelectors` in `src/store/label-selectors.ts` and spread into the
  built-in selector suite. `listLabelsForRepository` returns labels ordered by
  canonical name so output is deterministic regardless of seed order.
  Rationale: object-coordinate selectors match `getIssue` and `getRef`;
  colocating label selectors in their own module follows "group by feature"
  and keeps `src/store/early-entity-selectors.ts` focused. Date/Author:
  2026-11-15, planning agent.
- D12. Decision: the pure label policy is split into
  `src/store/entities/label-key.ts` (the proved key grammar:
  `formatLabelStoreKey` and `splitLabelStoreKey`, no imports) and policy
  helpers in `src/store/entities/label.ts` (`canonicalLabelName`,
  `deriveLabelId`, `findLabelsWithUnknownRepository`), with the Zod schema in
  the same module acting as the seeding adapter. Rationale: LemmaScript
  axiomatizes cross-file calls, so the proved functions must share a file and
  stay free of Zod; the policy helpers are pure but use `toLowerCase`, which
  the Dafny model only covers for ASCII, so they are verified by property
  tests instead. Date/Author: 2026-11-15, planning agent.
- D13. Decision: 1.5.1 adds no write action, REST route, or GraphQL field.
  Rationale: roadmap 1.5.2 owns handlers and the create and update actions
  through the shared write spine (`src/store/actions/`); landing state first
  keeps this change reviewable. Date/Author: 2026-11-15, planning agent.
- D14. Decision: formal verification uses LemmaScript's Dafny backend, invoked
  as `npx --yes --package=lemmascript@0.6.10 -- lsc check --backend=dafny`,
  wrapped in a new `make prove` target that reads `LemmaScript-files.txt`.
  `make prove` is a milestone acceptance gate for `EP-M2` onwards. It is not
  added to `make all` or CI in this task because CI does not install Dafny;
  wiring it into CI is an open approval question. Dafny 4.11.0 is installed on
  the development host at `~/.local/bin/dafny`. `npx` rather than `bunx` is a
  documented exception because LemmaScript targets Node. Date/Author:
  2026-11-15, planning agent; subject to user approval.
- D15. Decision: before adding label wiring, extract the repository owner
  projection helpers (`toRepoOwner`, `toPublicUserOwner`,
  `resolveRepositoryOwner`, and `buildRepositoryWithOwnerSelector`, currently
  in `src/store/index.ts`) into a new `src/store/repository-owner-projection.ts`
  as a separate, behaviour-preserving refactor commit. Rationale: the file is
  already over the 400-line limit, and AGENTS.md requires refactors to be
  separate atomic commits. Date/Author: 2026-11-15, planning agent.
- D16. Decision: "serialized without raw nested dictionaries" is read as the
  parsed label being a flat record of scalar fields that survives a JSON round
  trip and re-parse unchanged, and the published seed shape being a flat
  `initialState.labels` array rather than a `repositories[].labels`
  dictionary. Rationale: simulacat's step 5.1 serializes its Python label
  model to "the core `initialState.labels` shape once that shape is
  published". Date/Author: 2026-11-15, planning agent.

## Outcomes & retrospective

Not started. To be completed at each milestone and at completion.

## Context and orientation

Inspected base revision: `c2e5ddcb8092c327003f92916fe8e4a7befd5037` (`main`,
2026-10-20). Line numbers below are at that revision; relocate symbols with
`rg -n '<symbol>' src tests`.

The seeding pipeline. `simulation(args)` in `src/index.ts` parses
`args.initialState` with `githubInitialStoreSchema` from
`src/store/entities.ts` (lines 106–118 list the collections; optional ones use
`.optional().default([])`). `convertInitialStateToStoreState` (lines 192–209)
turns each array into a keyed table with `convertObjByKey(array, keyFn)`, which
throws `Duplicate key "<key>" for objects at indices <i> and <j>` on a
collision. `src/store/index.ts` `inputSchema` (lines 124–143) registers each
table with `slice.table<T>(tableOptions(storeInitialState, '<name>'))`.

Entity modules live in `src/store/entities/`. `src/store/entities/issue.ts` is
the closest template: a Zod object schema with a `.transform` that fills
`id` (from `ENTITY_ID_OFFSETS.ISSUE + number`, see
`src/store/entity-id-offsets.ts`) and `node_id` (Base64 of `Issue:<key>`), an
exported `GitHubIssue` interface, and an exported `issueStoreKey`. Field
JSDoc comments are mandatory because TypeDoc validates every property.

Keys. `src/store/keys.ts` re-exports each `*StoreKey`, defines
`*StoreKeyParts` types and the shared `RepositoryCoords`, node-identifier
helpers (`issueNodeId` and others), and parsers. The private
`parseRepositoryScopedReferenceKey(key, entityName, referenceName)` (lines
225–251) splits at the first `:` and delegates the prefix to
`parseRepositoryStoreKey`. Existing property tests in
`tests/store-keys.test.ts` (lines 45–72) generate owner and repository
segments that exclude `/` and `:`.

Selectors. `src/store/early-entity-selectors.ts` defines
`buildEarlyEntitySelectors({createSelector, schema})`, using a memoised
`buildRepoIndex` and object-coordinate lookups such as
`getIssue(state, {owner, repo, number})`. `src/store/index.ts`
`earlyEntitySelectorArgs` (lines 366–374) and `inputSelectors` (lines 377–385)
wire them in. Tests reach selectors through a running server, as
`tests/store-selectors.test.ts` does: it passes
`server.simulationStore.store.getState()` to
`server.simulationStore.selectors.getRepositoryWithOwner`.

Builders. `src/store/builders.ts` exports `build*Fixture(input)` functions that
call `schema.parse(input)` and `*FixtureInput = z.input<typeof schema>`
types. `src/index.ts` (lines 104–153) re-exports builders, schemas, entity
types, keys, parsers, and node-identifier helpers.
`tests/documented-surface.test-d.ts` pins builder input and return types at
compile time.

URLs. `src/urls/issue.ts` is the projector template: field lists,
a `satisfies`-checked builder table, and
`projectIssueUrls(issue, baseUrls)` via `projectDerivedFields` from
`src/urls/shared.ts` (which also provides `apiUrl`, `repositoryPath`, and
`urlPathSegment`, an `encodeURIComponent` wrapper). Repositories already
project `labels_url` as `<api>/repos/<owner>/<repo>/labels{/name}`
(`src/urls/repository.ts` lines 37 and 107).

Write spine (context only; not changed). `src/store/actions/` holds the 1.3.1
pattern: a pure reducer, a starfx thunk from `createEntityUpdateThunk`, a use
case, and `dispatchWrite`. 1.5.2 will add label create and update there.

Tests and tools. `make test` runs `bun test --max-concurrency=1 tests`.
`bunfig.toml` preloads `test-plugins.ts`, which registers
`@aboviq/bun-test-cucumber` with step definitions from `tests/**/*.steps.ts`;
`tests/cross-owner-identity.features.test.ts` loads every
`features/**/*.feature`. Property tests use `fast-check` 4.x with the shared
seed in `tests/support/property-test-seed.ts`. The users guide contains
executable examples marked `<!-- tested-example: <id> -->`; the inventory is
`DOCUMENTED_EXAMPLE_IDS` in `tests/support/documented-example-execution.ts`
and expected output lives in `tests/support/documented-example-observations.ts`.
Makefile targets: `check-fmt` (Biome check plus `mdtablefix --check`),
`typecheck` (`bun run check:types`), `docs-check` (TypeDoc, depends on
`typecheck`), `lint` (Biome plus Oxlint), `test`, `markdownlint`, `nixie`, and
`spelling`. No proof target exists yet. Dafny 4.11.0 is installed on the host;
LemmaScript is not installed and is not a repository dependency.

External facts gathered with Firecrawl. `github3.py` 3.2.0 and the current
4.x source of `src/github3/issues/label.py` both build `Label` by indexing
`label["url"]`, `label["color"]`, `label["name"]`, and `label["description"]`.
GitHub's REST documentation for labels (API version 2022-11-28) states that
label names are case-insensitive, colour is hexadecimal without a leading `#`,
descriptions are at most 100 characters, and it gives this example payload:

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
and `default`. LemmaScript 0.6.10 (released 2026-11-15) models strings as
Dafny `seq<char>`, supports `indexOf`, `slice`, `includes`, `length`,
concatenation, template literals, and `===`, and models `toLowerCase` for
ASCII letters only.

Signposts. Read before implementing: `AGENTS.md`; `docs/architecture.md`
§"State model" and §"Repository label slice"; `docs/developers-guide.md`
§"Linting rules", §"Testing expectations", and §"Early repository-owned
entities"; `docs/users-guide.md` §"Seeding early collaboration entities" and
§"Store key helpers and parsers"; `docs/api-reference.md` §"Exported fixture
schemas"; `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
§5 "Define canonical keys before defining routes", §6 "Validate seed state
aggressively", and §7 on selectors; `docs/complexity-antipatterns-and-refactoring-strategies.md`
§3 (bumpy road) and §5.A (command/query separation);
`docs/github-rest-api-audit.md` §"What Is Stubbed But Not Really Mocked"; and
`docs/execplans/1-1-2-first-class-entities-for-early-slices.md` as the
precedent. Skills: `execplans`, `hexagonal-architecture` (boundary check),
`typescript-router` routing to `typescript-data-and-state` and
`typescript-boundaries-and-validation`, `zod4-typescript` only if the Zod
major changes (this repository uses Zod 3.25), `fast-check`, `lemmascript`,
`typescript-testing`, `biome-typescript`, `codegraph-mcp` for impact analysis,
and `en-gb-oxendict-style` for documentation.

## Conformance basis

Upstream artefacts, all read at `c2e5ddc` unless stated:

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
  shape once that shape is published," and rule 1, "Labels belong to a
  repository identified by owner and name. Validation fails if a label
  references an unknown repository."
- No Terms of Reference or separate technical-design document exists for this
  slice; `docs/architecture.md` serves as the design of record.

Requirements derived from those sources:

- `REQ-key`: labels are stored in their own table keyed by
  `owner/repo:<canonical name>`, distinct across owners and repositories.
- `REQ-fields`: a parsed label always carries `id`, `node_id`, `name`,
  `color`, `description` (nullable), and `default`, and supports `url` as a
  seeded override or a request-derived projection.
- `REQ-seed`: `initialState.labels` is optional, defaults to `[]`, and seeds
  the label table; invalid labels, case-variant duplicates, identifier
  collisions, and labels for unseeded repositories fail at startup.
- `REQ-select`: labels are selectable by repository and name
  (case-insensitively) and listable per repository.
- `REQ-exports`: the label schema, entity type, key helper, parser,
  node-identifier helper, builder, builder input type, and URL projector are
  exported from `src/index.ts`.
- `REQ-serialize`: parsed labels are flat records that survive JSON
  serialization and re-parsing unchanged.
- `REQ-boundary`: label policy is pure and adapter-free.
- `REQ-docs`: users guide, developers guide, API reference, architecture, and
  roadmap describe the delivered behaviour.

Observed gaps at the base revision:

- `GAP-entity`: no label schema, table, key, selector, or builder exists.
- `GAP-url`: no label URL projector exists, although `labels_url` is
  projected for repositories.
- `GAP-size`: `src/store/index.ts` exceeds 400 lines.

Trace links:

```plaintext
roadmap-1.5.1 -> REQ-key -> L-key-roundtrip, INV-case-identity -> EP-M2 -> tests/label-keys.test.ts, make prove
roadmap-1.5.1 -> REQ-fields, REQ-serialize -> INV-flat-reparse -> EP-M3 -> tests/label-entity.test.ts
architecture §Repository label slice -> REQ-seed -> INV-seed-rejects -> EP-M3 -> tests/label-entity.test.ts, features/repository-labels.feature
simulacat 5.1 rule 1 -> REQ-seed (unknown repository) -> EP-M3 -> features/repository-labels.feature
roadmap-1.5.1 -> REQ-select -> INV-scoped-selection -> EP-M4 -> tests/label-selectors.test.ts, features/repository-labels.feature
architecture §GitHub client compatibility -> REQ-fields (url) -> INV-url-projection -> EP-M3 -> tests/label-urls.test.ts
roadmap-1.5.1 -> REQ-exports -> EP-M3, EP-M4 -> tests/documented-surface.test-d.ts, users-guide examples
GAP-size -> EP-M1 -> wc -l src/store/index.ts <= 400
REQ-docs -> EP-M5 -> make markdownlint, make nixie, users-guide example tests
```

## Verification plan

### Abstract model

A label is a record `L = (owner, repo, name, color, description, default, id,
node_id, url?)`. Let `fold(s) = s.toLowerCase()` and let a key segment be a
non-empty string containing neither `/` nor `:`. The canonical key is
`key(L) = owner + "/" + repo + ":" + fold(name)`. A seed is a finite list of
labels plus a set `R` of seeded repository keys `owner/name`. Seeding succeeds
if and only if every label parses, every `owner/repo` is in `R`, the keys are
pairwise distinct, and the identifiers are pairwise distinct; it then
produces a table `T: key -> L`. `getLabel(T, o, r, n) = T[o/r:fold(n)]`.
`listLabelsForRepository(T, o, r)` is every `L` in `T` with that owner and
repository, ordered by `fold(name)`. Malformed input (empty name, bad colour,
long description, separator in owner or repository) is rejected by Zod with
a path-qualified issue; seed-level violations throw an `Error` naming the
offending keys.

### Invariants and lemmas

- `L-key-roundtrip` (supports `REQ-key`): for all key segments `o` and `r`
  and every non-empty string `c`, `splitLabelStoreKey(formatLabelStoreKey(o,
  r, c))` returns `{ok: true, owner: o, repo: r, name: c}`.
- `L-key-injective` (supports `REQ-key`): for all key segments `o1, r1, o2,
  r2` and non-empty `c1, c2`, equal formatted keys imply `o1 = o2`, `r1 =
  r2`, and `c1 = c2`. Two labels in different repositories therefore never
  share a key.
- `L-split-rejects` (supports `REQ-key`): `splitLabelStoreKey(k)` returns
  `{ok: false}` whenever `k` has no `:`, an empty prefix or suffix, or a
  prefix that is not exactly two key segments joined by one `/`.
- `INV-fold-idempotent` (axiom check, supports `REQ-key`): `fold(fold(s)) =
  fold(s)` for every string `s`. This is a property of the JavaScript runtime
  that the design relies on, so it is checked rather than assumed.
- `INV-case-identity` (supports `REQ-key`, `REQ-select`): `labelStoreKey`
  maps two names to the same key exactly when their folds are equal;
  `parseLabelStoreKey(labelStoreKey(p))` equals `p` with `name` folded; and
  `parseLabelStoreKey` rejects a key whose name segment is not already folded.
- `INV-id-derivation` (supports `REQ-fields`): `deriveLabelId(k)` is a
  deterministic safe integer in `[1e9, 2e9)` for every key `k`.
- `INV-seed-rejects` (supports `REQ-seed`): seeding throws for a case-variant
  duplicate, an identifier collision, or a label whose repository is not
  seeded, and accepts the same seed once the violation is removed.
- `INV-flat-reparse` (supports `REQ-serialize`, `REQ-fields`): for every valid
  input `x`, `p = buildLabelFixture(x)` has only scalar or `null` field
  values, contains `description` and `default`, and
  `buildLabelFixture(JSON.parse(JSON.stringify(p)))` deep-equals `p`.
- `INV-scoped-selection` (supports `REQ-select`): for every seeded table,
  `getLabel` returns the seeded label for any casing of its name and
  `undefined` for any other owner, repository, or name;
  `listLabelsForRepository` returns exactly that repository's labels, ordered
  by folded name, and never another repository's labels.
- `INV-url-projection` (supports `REQ-fields`): `projectLabelUrls` keeps a
  seeded `url` unchanged and otherwise produces
  `<apiBase>/repos/<enc owner>/<enc repo>/labels/<enc name>`, where `enc` is
  `encodeURIComponent`, so names containing spaces, `/`, `:`, `#`, `?`, or
  emoji are a single path segment.

### Axioms (trusted, not verified here)

- `AXIOM-github-case`: GitHub label names are case-insensitive (GitHub REST
  documentation, labels, API version 2022-11-28). Relied on by D1. Exact
  folding for non-ASCII names is not claimed (R1).
- `AXIOM-github3-fields`: `github3.py` 3.2.0 and 4.x construct `Label` from
  `url`, `color`, `name`, and `description` by indexing (source of
  `src/github3/issues/label.py` at tag `3.2.0` and on `main`). Relied on by
  D5 and D9; exercised end to end by 1.5.3.
- `AXIOM-lemmascript-model`: LemmaScript 0.6.10's Dafny translation of
  `indexOf`, `slice`, concatenation, and `===` matches JavaScript semantics on
  strings without unpaired surrogates. Relied on by the proof's transfer to
  runtime; cross-checked by the fast-check round-trip property on full-Unicode
  strings, which exercises the same functions at runtime.
- `AXIOM-dafny`: Dafny 4.11.0 is sound for the generated obligations.
- `AXIOM-foundation-table`: the foundation simulator's `slice.table` stores
  and returns entities by the exact key string supplied at seed time (as
  already relied on by every other table).

### Methods per obligation

- Obligation: `L-key-roundtrip`, `L-key-injective`, `L-split-rejects`.
  Method: formal proof with LemmaScript's Dafny backend on
  `src/store/entities/label-key.ts`, plus a fast-check regression net.
  Rationale: these are the contractual identity axioms every later label
  route relies on; they quantify over all strings, so sampling alone cannot
  discharge them, and the functions stay inside LemmaScript's supported
  string subset. Domain: all strings, with key segments constrained by a
  `//@ requires` predicate `isKeySegment(s) = s.length > 0 && !s.includes('/')
  && !s.includes(':')`. Artefact: `src/store/entities/label-key.ts` with
  `//@ verify`, `//@ requires`, and `//@ ensures`;
  `src/store/entities/label-key.dfy` (hand-maintained lemmas);
  `LemmaScript-files.txt`; `make prove`; and fast-check properties in
  `tests/label-keys.test.ts`. Evidence: `make prove` reports every obligation
  verified with zero errors; before the lemmas are written, `lsc check`
  reports the round-trip postcondition as unproved (the red state). Discharge
  condition: zero Dafny errors, no `assume`, and an additions-only diff
  between `label-key.dfy.gen` and `label-key.dfy`. Non-vacuity: the
  `requires` predicate is inhabited (witness `o = 'acme'`, `r = 'repo'`, `c =
  'type: bug/a'`), and a Dafny `example` lemma asserts the round trip for that
  witness; the name witness contains both separators, so the proof is not
  restricted to separator-free names. Negative control: temporarily change
  `splitLabelStoreKey` to split at the last `:` instead of the first; `make
  prove` must fail on `L-key-roundtrip` (the witness name contains `:`), and
  the fast-check property must find a counterexample. Revert the mutation and
  delete any regenerated `.dfy.gen` drift.
- Obligation: `INV-fold-idempotent`. Method: exhaustive check plus property
  test. Rationale: it is an assumption about the runtime's Unicode tables,
  which cannot be proved here but can be checked completely for single code
  points. Domain: every Unicode scalar value (`0x0`–`0x10FFFF` excluding
  surrogates, about 1.1 million strings) exhaustively, then fast-check
  `fc.string({unit: 'grapheme'})` and `fc.string({unit: 'binary'})` for
  multi-character contexts such as Greek final sigma. Artefact:
  `tests/label-keys.test.ts`. Evidence: `bun test tests/label-keys.test.ts`
  passes; the exhaustive loop asserts the count of checked scalars equals
  1,112,064. Non-vacuity: the generated classes include ASCII upper case,
  non-ASCII upper case (`İ`, `Σ`), and already-lower strings, asserted with
  `fc.statistics` or explicit witnesses. Negative control: replacing `fold`
  with a function that maps `a` to `A` and `A` to `a` makes the property
  fail.
- Obligation: `INV-case-identity`. Method: property test plus parameterized
  examples. Domain: generated owner and repository key segments and
  full-Unicode names, plus a table of explicit cases (`Bug`/`bug`/`BUG`,
  `type: bug`, `area/api`, emoji, trailing spaces trimmed by the schema).
  Artefact: `tests/label-keys.test.ts`. Evidence: properties pass with the
  shared seed. Non-vacuity: a generator that upper-cases a random subset of
  characters guarantees case-variant pairs; the test asserts at least one
  generated pair differs before folding. Negative control: removing `fold`
  from `labelStoreKey` must fail the case-variant property.
- Obligation: `INV-id-derivation`. Method: property test plus fixed vectors.
  Domain: arbitrary key strings; fixed FNV-1a vectors (`''` hashes to
  `0x811c9dc5`, and `'a'` to `0xe40c292c`). Artefact:
  `tests/label-entity.test.ts`. Evidence: the property asserts
  `Number.isSafeInteger`, the range bound, and determinism across two calls.
  Non-vacuity: the fixed vectors fail if the offset basis or prime is wrong.
  Negative control: dropping the `>>> 0` unsigned conversion produces negative
  hashes and fails the range assertion.
- Obligation: `INV-seed-rejects`. Method: parameterized unit tests and a
  behavioural scenario. Domain: one row per violation (case-variant
  duplicate, explicit duplicate `id`, unseeded repository, empty name, bad
  colour, long description, `owner` containing `/`). Artefact:
  `tests/label-entity.test.ts`, `features/repository-labels.feature`.
  Evidence: each row throws with a message naming the key or Zod path; the
  paired valid seed (row with the violation removed) succeeds. Non-vacuity:
  every rejection row has a passing twin, so a schema that rejects everything
  fails the suite.
- Obligation: `INV-flat-reparse`. Method: property test. Domain: a fast-check
  arbitrary over valid label inputs (optional `id`, `node_id`, `url`,
  `description` including `null`, colours in mixed case). Artefact:
  `tests/label-entity.test.ts`. Evidence: property passes. Non-vacuity: the
  arbitrary omits optional fields in some cases and supplies them in others,
  asserted with `fc.statistics` buckets. Negative control: a transform that
  regenerates `id` from a different key on re-parse would fail.
- Obligation: `INV-scoped-selection`. Method: integration property test
  against a running simulator, plus examples. Domain: generated seeds of up
  to 12 labels across up to three owners and two repository names, with
  overlapping label names. Artefact: `tests/label-selectors.test.ts`.
  Evidence: for each seed, every label is found under random casings of its
  name, absent coordinates return `undefined`, and list output equals an
  independent oracle (filter then sort by folded name over the input array).
  Non-vacuity: the generator forces at least one shared label name across two
  repositories in each run. Negative control: a selector that ignores `owner`
  fails the cross-owner case.
- Obligation: `INV-url-projection`. Method: parameterized tests plus a
  property. Domain: names with spaces, `/`, `:`, `#`, `?`, `%`, and emoji;
  seeded override present or absent; API roots `/` and `/api/v3`. Artefact:
  `tests/label-urls.test.ts`. Evidence: the projected URL path decodes, segment
  by segment, back to the original name. Negative control: using the raw name
  without encoding fails the `/` and `#` rows.

### Formal verification decision

A formal proof is used for the key grammar only (`L-key-roundtrip`,
`L-key-injective`, `L-split-rejects`), because label identity is contractual
business logic that 1.5.2, 1.5.3, and 8.2.2 all build on, and it must hold
for every admissible string, including names containing the separator
characters. Model checking is unnecessary because 1.5.1 introduces no
concurrency, protocol, or state machine. The proof leaves several things
unverified, and covers them with tests instead: Unicode folding (outside the
ASCII-only model, covered by `INV-fold-idempotent`), the Zod schema and
seed-level checks (adapter code), and the foundation simulator's table
storage (`AXIOM-foundation-table`). Proving `deriveLabelId` would add little,
because its only contract is range and determinism, which the property test
checks directly. This decision is recorded as D12 and D14.

### Suggested BDD features

Adopted, using the repository's existing `@aboviq/bun-test-cucumber` runner.
Path: `features/repository-labels.feature`; steps:
`tests/repository-labels.steps.ts`. Runner command:
`bun test tests/cross-owner-identity.features.test.ts`, which loads every
feature file.

```gherkin
@repository-labels
Feature: Repository labels are first-class seeded state

  # REQ-seed, REQ-select; EP-M4
  Scenario: A seeded label is selectable by repository and any casing of its name
    Given a simulator seeded with repository "acme/awesome-repo" and label "Bug" coloured "f29513"
    When the store is asked for label "BUG" in "acme/awesome-repo"
    Then the selected label has name "Bug", colour "f29513", and a null description
    And the selected label has a node ID derived from "Label:acme/awesome-repo:bug"

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
    Then seeding fails with an error mentioning "acme/awesome-repo:bug"

  # REQ-seed (unknown repository); EP-M3
  Scenario: A label for an unseeded repository is rejected
    Given an initial state with label "bug" in "acme/missing-repo" and no such repository
    When the simulator parses the initial state
    Then seeding fails with an error mentioning "acme/missing-repo"

  # REQ-select (absence); EP-M4
  Scenario: Looking up an unknown label returns nothing
    Given a simulator seeded with repository "acme/awesome-repo" and label "Bug" coloured "f29513"
    When the store is asked for label "enhancement" in "acme/awesome-repo"
    Then no label is returned
```

## Plan of work

Each milestone ends with the gate sequence in `Concrete steps` and a commit.
Do not start a milestone while the previous one's gates fail.

### `EP-M0` LemmaScript feasibility probe (prototype)

Question: can LemmaScript 0.6.10's Dafny backend verify the round trip for the
exact function shapes planned for `src/store/entities/label-key.ts`? In a
scratch directory under `/tmp/label-key-probe/` (never inside the worktree),
write a copy of the planned `formatLabelStoreKey`, `isKeySegment`, and
`splitLabelStoreKey` with annotations, then run
`npx --yes --package=lemmascript@0.6.10 -- lsc gen --backend=dafny label-key.ts`
and `lsc check`. Expected observation: generation succeeds and Dafny reports
the round-trip postcondition either verified or unproved with a concrete
obligation (not a translation error). Go: generation succeeds and the
obligations are expressible, even if helper lemmas are still needed. No-go:
`lsc gen` rejects the record return type or the string operations; in that
case try the documented fallback shape (return a tuple-like
`{ok, owner, repo, name}` object with all fields always present, or split into
three pure accessor functions), and if that also fails, stop and escalate per
`Tolerances`. The probe is deleted afterwards; its transcript goes into
`Artefacts and notes`. The probe needs network access for `npx`; if that is
unavailable, stop and report.

### `EP-M1` preparatory refactor of `src/store/index.ts`

Assigned: `GAP-size`, D15. Move `toRepoOwner`, `toPublicUserOwner`,
`resolveRepositoryOwner`, the `RepositoryWithOwnerSchema` type, and
`buildRepositoryWithOwnerSelector` (lines 162–231) into a new
`src/store/repository-owner-projection.ts` with a `/** @file … */` block and
the existing JSDoc. Export only what `src/store/index.ts` imports. Keep the
public types `GitHubRepoOwner`, `GitHubPublicUserOwner`, and
`GitHubRepositoryOwner` declared in `src/store/index.ts` (they are part of its
exported type surface), and import them into the new module with `import
type`. No behaviour changes. Red-Green-Refactor does not apply to a pure move;
the existing suites `tests/store-selectors.test.ts`, `tests/repositories.test.ts`,
`tests/graphql.test.ts`, and `tests/repository-write.test.ts` are the
regression net and must pass unchanged. Acceptance: `wc -l src/store/index.ts`
prints at most 400 (expected about 365), and the four gates pass. Commit as
"Extract repository owner projection from store index".

### `EP-M2` label policy, key grammar, and proof

Assigned: `REQ-key`, `REQ-boundary`, D1–D3, D12, D14. Red first: create
`tests/label-keys.test.ts` with example tests and properties for
`labelStoreKey`, `parseLabelStoreKey`, `labelNodeId`, `canonicalLabelName`,
and the exhaustive fold check, importing from `../src/index.ts`. Run
`bun test tests/label-keys.test.ts`; it must fail because the exports do not
exist (`SyntaxError: Export named 'labelStoreKey' not found` or the
TypeScript equivalent).

Green: create `src/store/entities/label-key.ts` containing only
`isKeySegment`, `formatLabelStoreKey(owner, repo, canonicalName)`, and
`splitLabelStoreKey(key)`, annotated with `//@ verify`, `//@ requires`, and
`//@ ensures` as described in `Verification plan`. It must have no imports.
Create the policy part of `src/store/entities/label.ts`: `canonicalLabelName`
and `labelStoreKey(label)`, which returns
`formatLabelStoreKey(label.owner, label.repo, canonicalLabelName(label.name))`.
In `src/store/keys.ts`, add `LabelStoreKeyParts`, `labelNodeId(parts)`, and
`parseLabelStoreKey(key)`, which calls `splitLabelStoreKey`, throws
`Malformed label store key "<key>"; expected "owner/repo:name"` when it
returns `{ok: false}`, and throws
`Non-canonical label store key "<key>"; label names in keys must be lower case`
when the name segment is not already folded. Re-export `labelStoreKey` from
`src/store/keys.ts` and export the new symbols from `src/index.ts`.

Proof: run `lsc gen --backend=dafny src/store/entities/label-key.ts`, commit
the generated `label-key.dfy.gen` and the initial `label-key.dfy`, add helper
lemmas to `label-key.dfy` until `lsc check` verifies, add
`LemmaScript-files.txt` containing `src/store/entities/label-key.ts`, and add
a `prove` target to `Makefile` (with a `.PHONY` entry) that runs
`npx --yes --package=lemmascript@0.6.10 -- lsc check --backend=dafny` with no
file argument. Validate the Makefile with `mbake validate Makefile` and
`checkmake Makefile`. Run the negative control from `Verification plan`, record
the failing transcript, and revert it.

Refactor: confirm the new functions are within lint limits, then run all
gates plus `make prove`. Commit as "Add canonical repository label keys with a
verified key grammar".

### `EP-M3` label schema, seeding, builder, and URL projection

Assigned: `REQ-fields`, `REQ-seed`, `REQ-serialize`, `REQ-exports`, `GAP-url`,
D4–D10, D16. Red first: create `tests/label-entity.test.ts` (schema defaults,
rejection rows, FNV vectors, the identifier property, the flat-reparse
property, seed-level duplicate, identifier collision, and unknown-repository
rejections through `githubInitialStoreSchema` and
`convertInitialStateToStoreState`) and `tests/label-urls.test.ts`. Add the
three seeding scenarios from `features/repository-labels.feature` with their
steps in `tests/repository-labels.steps.ts`. Run them; they must fail on
missing exports or on `labels` being stripped from the seed.

Green: in `src/store/entities/label.ts` add `githubLabelSchema` (fields:
`owner`, `repo` refined with `isKeySegment` after trimming; `name` trimmed and
non-empty; `color` regex with default `ededed`; `description` nullable, at
most 100 characters, default `null`; `default` default `false`; optional
`id`, `node_id`, and `url`) with a `.transform` that fills `id` from
`deriveLabelId(labelStoreKey(label))` and `node_id` from `labelNodeId`. Add
`GitHubLabel`, `fnv1a32`, `deriveLabelId`, and
`findLabelsWithUnknownRepository(labels, repositoryKeys)`. In
`src/store/entity-id-offsets.ts` add `LABEL_ID_BASE` and `LABEL_ID_SPAN` with
a comment explaining the band. In `src/store/entities.ts` add
`labels: z.array(githubLabelSchema).optional().default([])`, a
`superRefine` (or a check in the existing transform) that reports unknown
repositories and duplicate label identifiers with the offending keys, add
`labels: convertObjByKey(initialState.labels, labelStoreKey)` to
`convertInitialStateToStoreState`, and re-export the label symbols. In
`src/store/index.ts` register
`labels: slice.table<GitHubLabel>(tableOptions(storeInitialState, 'labels'))`.
In `src/store/builders.ts` add `LabelFixtureInput` and `buildLabelFixture`
with JSDoc and an example. Create `src/urls/label.ts` with `labelUrlFields`,
`LabelUrlPayload`, and `projectLabelUrls`, following `src/urls/issue.ts`, and
export it from `src/urls/index.ts`. Export everything listed in `Interfaces
and dependencies` from `src/index.ts`, and add compile-time assertions for
`buildLabelFixture` and `LabelFixtureInput` to
`tests/documented-surface.test-d.ts`.

Refactor: keep `githubInitialStoreSchema` readable by moving the label
seed-level checks into a named helper; rerun focused tests and all gates
plus `make prove`. Commit as "Seed first-class repository labels with
builders and URL projection".

### `EP-M4` label selectors, behavioural feature, and end-to-end seeding

Assigned: `REQ-select`, D11. Red first: create `tests/label-selectors.test.ts`
(example table plus the scoped-selection property, each starting a server
with `simulation({initialState}).listen(0)` and closing it with
`ensureClose()`), and add the two selection scenarios and the absence
scenario to the feature file. They must fail because `getLabel` is not a
selector.

Green: create `src/store/label-selectors.ts` exporting `LabelSelectorArgs`
and `buildLabelSelectors({createSelector, schema})` returning `getLabel` and
`listLabelsForRepository` (memoised per-repository index, sorted with
`toSorted` by folded name). In `src/store/index.ts`, spread
`buildLabelSelectors({createSelector: args.createSelector, schema: {labels:
args.schema.labels}})` into `inputSelectors`. Confirm the file is still at or
below 400 lines.

Refactor and gates, then commit as "Select repository labels by repository
and name".

### `EP-M5` documentation, roadmap, and delivery closure

Assigned: `REQ-docs`. Update:

- `docs/users-guide.md`: a new "Seeding repository labels" section after
  "Seeding early collaboration entities" with the tested example
  `seed-repository-labels` (seed, select with a different casing, print the
  selected label's name and colour as JSON), notes on case-insensitive
  identity, defaults, and the unknown-repository rule; and a `labelStoreKey`
  subsection under "Store key helpers and parsers" with the tested example
  `label-store-key` printing `acme/awesome-repo:good first issue`. Register
  both IDs in `DOCUMENTED_EXAMPLE_IDS`, add observations, and put the check
  functions in the new `tests/support/documented-example-label-checks.ts`.
- `docs/developers-guide.md` §"Early repository-owned entities": replace the
  "do not expand into labels" sentence with the label slice's module map, the
  pure-policy boundary, the `make prove` workflow (LemmaScript regen rules:
  edit `.dfy`, never `.dfy.gen`; run `lsc regen` after changing the
  TypeScript), and the identifier band.
- `docs/api-reference.md`: add `githubLabelSchema`, `buildLabelFixture`,
  `labelStoreKey`, `parseLabelStoreKey`, `labelNodeId`, and
  `projectLabelUrls` to §"Exported fixture schemas" and its table, and update
  the "labels remain later work" sentence (line 123) to say label state exists
  while label routes arrive in 1.5.2.
- `docs/architecture.md`: change the `src/store/entities/label.ts` entry from
  planned to delivered, add `label-key.ts`, `label-selectors.ts`,
  `repository-owner-projection.ts`, and `src/urls/label.ts`; add `labels` to
  §"State model" with key format `owner/repo:<lower-cased name>`; and record
  D1, D7, D10, and the R1 residual gap under §"Repository label slice".
- `docs/roadmap.md`: mark 1.5.1 `[x]` with a one-line "Delivered:" note.
- `docs/contents.md`: add the 1.5.1 plan link.
- `CHANGELOG.md`: add an unreleased entry for repository label entities.

Run `make markdownlint`, `make nixie`, `make spelling`, and the four gates
plus `make prove`. Reconcile `Conformance basis`, complete `Outcomes &
retrospective`, set the status to `COMPLETE`, and commit as "Document
repository label entities (1.5.1)".

## Milestones and plateaus

- `EP-M0`: a go or no-go decision on LemmaScript, with transcript. No
  repository change. Recovery: delete `/tmp/label-key-probe/`. Compatibility
  decision: none.
- `EP-M1`: `src/store/index.ts` at or below 400 lines, with behaviour
  unchanged. Requirements: `GAP-size`. Evidence: `wc -l` and unchanged test
  results. Conformance check: no public type moved out of
  `src/store/index.ts`; no dependency change. Recovery: `git revert` the
  single commit. Remaining gaps: all label work. Compatibility decision: none.
- `EP-M2`: canonical keys, parser, node identifier, and proof, exported and
  verified. Requirements: `REQ-key`, `REQ-boundary`. Evidence:
  `tests/label-keys.test.ts` and `make prove`. Conformance check: D1 and D3
  applied; `label-key.ts` has no imports; no unapproved dependency (LemmaScript
  through `npx` only). Recovery: revert the commit; the `.dfy` file is
  reproducible with `lsc regen`. Remaining gaps: no seedable entity yet.
  Compatibility decision: none (new exports only).
- `EP-M3`: labels seed through `initialState`, build through
  `buildLabelFixture`, and project URLs. Requirements: `REQ-fields`,
  `REQ-seed`, `REQ-serialize`, `REQ-exports`, `GAP-url`. Evidence:
  `tests/label-entity.test.ts`, `tests/label-urls.test.ts`, three feature
  scenarios, and `tests/documented-surface.test-d.ts`. Conformance check: the
  seed shape remains backwards compatible; no route registered; the stored
  entity is host-agnostic. Recovery: revert the commit. Remaining gaps:
  selectors. Compatibility decision: none.
- `EP-M4`: labels selectable by repository and name. Requirements:
  `REQ-select`. Evidence: `tests/label-selectors.test.ts` and the full feature
  file. Conformance check: selectors fold input; `src/store/index.ts` at or
  below 400 lines. Recovery: revert the commit. Remaining gaps:
  documentation. Compatibility decision: none.
- `EP-M5`: documentation, roadmap, and changelog current; plan complete.
  Requirements: `REQ-docs`. Evidence: Markdown gates and executed users-guide
  examples. Recovery: revert the documentation commit. Remaining gaps: 1.5.2
  and 1.5.3. Compatibility decision: none.

## Concrete steps

Working directory for every command: the repository root of this worktree.
Run each gate sequentially and capture output with `tee`, with `pipefail` set
so a failing gate cannot look like a pass:

```sh
set -o pipefail
BRANCH=$(git branch --show-current)
make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-$BRANCH.out
make typecheck 2>&1 | tee /tmp/typecheck-simulacat-core-$BRANCH.out
make docs-check 2>&1 | tee /tmp/docs-check-simulacat-core-$BRANCH.out
make lint 2>&1 | tee /tmp/lint-simulacat-core-$BRANCH.out
make test 2>&1 | tee /tmp/test-simulacat-core-$BRANCH.out
make prove 2>&1 | tee /tmp/prove-simulacat-core-$BRANCH.out   # from EP-M2 onwards
```

For documentation milestones, also run:

```sh
make markdownlint 2>&1 | tee /tmp/markdownlint-simulacat-core-$BRANCH.out
make nixie 2>&1 | tee /tmp/nixie-simulacat-core-$BRANCH.out
make spelling 2>&1 | tee /tmp/spelling-simulacat-core-$BRANCH.out
```

Expected red and green transcripts, per milestone:

```plaintext
EP-M2 red:   bun test tests/label-keys.test.ts -> fails: export 'labelStoreKey' not found
EP-M2 green: bun test tests/label-keys.test.ts -> all pass
EP-M2 proof red:   lsc check (before lemmas) -> postcondition might not hold (round trip)
EP-M2 proof green: make prove -> Dafny program verifier finished with N verified, 0 errors
EP-M3 red:   bun test tests/label-entity.test.ts tests/label-urls.test.ts -> fails: missing exports
EP-M3 green: same command -> all pass
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
  `selectors.getLabel(state, {owner: 'acme', repo: 'awesome-repo', name: 'bug'})`
  returns the label named `Bug` with colour `f29513`.
- The same `initialState` with a second label named `bug` fails at startup
  with an error containing `acme/awesome-repo:bug`.
- A label for `acme/missing-repo` with no such repository fails at startup
  with an error containing `acme/missing-repo`.
- `labelStoreKey({owner: 'acme', repo: 'awesome-repo', name: 'Good First Issue'})`
  returns `acme/awesome-repo:good first issue`, and `parseLabelStoreKey` of
  that string returns the folded parts.
- `projectLabelUrls(label, {apiBaseUrl: 'http://localhost:3300', webBaseUrl:
  'http://localhost:3300'})` for a label named `good first issue` returns
  `url` `http://localhost:3300/repos/acme/awesome-repo/labels/good%20first%20issue`.
- `make test` passes, including the new feature file, the new test files, and
  the two new users-guide examples; each new test fails before its milestone's
  implementation and passes after.
- `make prove` reports zero errors.

Quality criteria: `make check-fmt`, `make typecheck`, `make docs-check`,
`make lint`, `make test`, and `make prove` all pass at each milestone from
`EP-M2`; `make markdownlint`, `make nixie`, and `make spelling` pass at
`EP-M5`. Verification: every obligation in `Verification plan` is discharged
with its negative control recorded. No performance or security gate is
affected beyond the existing ones.

## Idempotence and recovery

Every step is a source edit followed by gates and can be rerun. `lsc gen`
must only be run once per file; afterwards use `lsc regen`, which three-way
merges proof additions. Never delete `label-key.dfy` to start again. Seeded
negative controls are applied as uncommitted edits and reverted with
`git restore <file>`; check `git status` is clean of `.dfy.gen` drift
afterwards. Each milestone is one commit, so `git revert <sha>` restores the
previous plateau.

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
```

`EP-M0` transcript, red and green proof transcripts, and negative-control
transcripts are to be added here during implementation.

## Interfaces and dependencies

No new runtime or development dependency. LemmaScript 0.6.10 runs through
`npx` (D14); Dafny 4.11.0 is a host tool.

New module `src/store/entities/label-key.ts` (pure, proved, no imports):

```typescript
export function isKeySegment(segment: string): boolean;
export function formatLabelStoreKey(owner: string, repo: string, canonicalName: string): string;
export type SplitLabelStoreKeyResult =
  | {readonly ok: true; readonly owner: string; readonly repo: string; readonly name: string}
  | {readonly ok: false};
export function splitLabelStoreKey(key: string): SplitLabelStoreKeyResult;
```

The exact result shape may change in `EP-M0` if LemmaScript cannot model a
discriminated union; any change must be recorded in `Decision log`.

New module `src/store/entities/label.ts`:

```typescript
export const canonicalLabelName: (name: string) => string;
export const labelStoreKey: (label: {owner: string; repo: string; name: string}) => string;
export const fnv1a32: (input: string) => number;
export const deriveLabelId: (key: string) => number;
export const githubLabelSchema: z.ZodType<GitHubLabel, z.ZodTypeDef, unknown>; // @internal, as other schemas
export interface GitHubLabel {
  owner: string; repo: string; id: number; node_id: string; name: string;
  color: string; description: string | null; default: boolean; url?: string;
}
export const findLabelsWithUnknownRepository: (
  labels: readonly GitHubLabel[],
  repositoryKeys: ReadonlySet<string>
) => GitHubLabel[];
```

`src/store/keys.ts` additions:

```typescript
export type LabelStoreKeyParts = {owner: string; repo: string; name: string};
export const labelNodeId: (parts: LabelStoreKeyParts) => string;
export const parseLabelStoreKey: (key: string) => LabelStoreKeyParts;
export {labelStoreKey} from './entities/label.ts';
```

`src/store/entity-id-offsets.ts` additions: `LABEL_ID_BASE = 1_000_000_000`
and `LABEL_ID_SPAN = 1_000_000_000`.

`src/store/label-selectors.ts`:

```typescript
export type LabelSelectorArgs = {createSelector: CreateSelector; schema: {labels: StoreTable<GitHubLabel>}};
export const buildLabelSelectors: (args: LabelSelectorArgs) => {
  getLabel: (state: AnyState, coords: LabelStoreKeyParts) => GitHubLabel | undefined;
  listLabelsForRepository: (state: AnyState, coords: RepositoryCoords) => GitHubLabel[];
};
```

`src/store/builders.ts` additions:
`export type LabelFixtureInput = z.input<typeof githubLabelSchema>;` and
`export const buildLabelFixture: (input: LabelFixtureInput) => GitHubLabel;`.

`src/urls/label.ts`: `labelUrlFields = ['url'] as const`, `LabelUrlField`,
`LabelUrlPayload`, and
`projectLabelUrls(label: LabelUrlPayload, baseUrls: BaseUrls): LabelUrlPayload`.

`src/store/repository-owner-projection.ts` (internal, `EP-M1`):
`toRepoOwner`, `toPublicUserOwner`, `resolveRepositoryOwner`, and
`buildRepositoryWithOwnerSelector`, moved unchanged.

Public exports added to `src/index.ts`: `buildLabelFixture`,
`LabelFixtureInput`, `githubLabelSchema`, `GitHubLabel`, `labelStoreKey`,
`parseLabelStoreKey`, `labelNodeId`, `LabelStoreKeyParts`,
`canonicalLabelName`, and `projectLabelUrls`. Selectors are published through
the simulator's `simulationStore.selectors`, as for every other entity, and
are not exported as standalone functions.

Reuse policy: 1.5.2's REST handlers and write actions must obtain keys only
through `labelStoreKey` and `parseLabelStoreKey`, labels only through
`getLabel` and `listLabelsForRepository`, and URLs only through
`projectLabelUrls`. A second key derivation or label representation anywhere
else, including 8.2.2's issue-label linking, violates this design.

## Revision note

- 2026-11-15: initial draft from Wyvern reconnaissance and Firecrawl research.
  Awaiting community-of-experts design review and user approval.
