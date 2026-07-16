# Add shared domain actions for write behaviour (1.3.1)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

Roadmap item: `1.3.1` (legacy task label `1.3.1`). See `docs/roadmap.md`
§1.3.1. Requires roadmap steps 1.1 and 1.2, which are already complete.

## Purpose / big picture

Today Simulacat Core can read seeded state through REST and GraphQL, but it has
no way to *write* state. The built-in action set is empty: `inputActions` in
`src/store/index.ts` returns `{}`, and no REST handler mutates the store. Every
future slice that needs mutation — the pull request lifecycle (roadmap 3.1),
mutable labels (1.5), reviews (6.1), and issue mutation (8.1) — is blocked on a
credible, shared write path.

This change introduces a **mutation spine**: a small, well-bounded way to write
store state through *shared domain actions* (centralized reducers) rather than
through route-local state edits. After this change a developer can issue a
single GitHub-shaped write (`PATCH /repos/{owner}/{repo}`) and observe the new
value through **two independent read surfaces** — a REST read
(`GET /repos/{owner}/{repo}` and `GET /orgs/{org}/repos`) and a GraphQL read
(`query { repository(owner, name) { description } }`) — because all three paths
agree on one piece of store state written by one action.

The behaviour can be observed by starting a simulator, patching a repository's
`description`, and then reading that same `description` back through both REST
and GraphQL. The acceptance tests below assert exactly this round trip.

The deliverable is deliberately split into two parts:

1. The **spine** — a reusable module layout, a pure domain reducer, a starfx
   thunk adapter wired into the built-in action set, and a dispatch helper.
   This is the part that later slices reuse.
2. One **demonstrator action** — `updateRepository` — and the REST write route
   that drives it, which exists to satisfy the roadmap success criterion and to
   prove the spine end to end. It is intentionally narrow.

## Constraints

Hard invariants that must hold throughout implementation. Violation requires
escalation, not a workaround.

- The demonstrator must not front-run later roadmap phases. The
  `updateRepository` action writes only benign descriptive fields
  (`description`, `homepage`). It must **not** implement repository *policy*
  flags such as `allow_squash_merge`, `delete_branch_on_merge`, merge-strategy
  controls, `default_branch`, or visibility/archival semantics: those belong to
  phase 4 (`docs/roadmap.md` §4.1.1). The OpenAPI `repos/update` request body
  exposes all of those fields; the handler must accept the request but apply
  only the whitelisted descriptive fields, ignoring the rest for now.
- Domain purity. The pure reducer module
  (`src/store/actions/repository.ts`) must not import starfx,
  `@simulacrum/foundation-simulator`, express, faker, or any I/O. Zod parsing
  belongs in the REST or use-case adapter before the command reaches the
  reducer. It depends only on the `GitHubRepository` *type* and pure key
  helpers. This is the domain/policy core; the starfx thunk is its driven
  adapter. (See
  `$hexagonal-architecture`: protect the boundary through module purity, do not
  transplant a parallel `src/domain` tree against the repository's existing
  `src/store` colocation convention.)
- No actor/authentication or permission enforcement is added here. Mutating
  routes accept any plausible `Authorization` header without validation, as the
  architecture guide already specifies for write routes
  (`docs/architecture.md` §Repository label slice, §GitHub client
  compatibility). Actor-aware write authorization is a separate slice.
- No new request-host URL derivation. REST repository payloads keep their
  seeded/default URLs. Deriving URLs from the inbound host is roadmap 1.4.1 and
  must not be pulled in here.
- Public API stability. Existing exports from `src/index.ts` and existing
  selectors/handlers keep their signatures. New exports are additive.
- Determinism. The reducer must be a pure, deterministic function of
  `(current, command)`. It must not read the clock; it must not mutate
  `updated_at`/`pushed_at` (timestamp-on-write is deferred, see Decision Log).
  Centralized `now()` injection, if ever needed, follows the `AGENTS.md`
  time/randomness guidance and is out of scope here.
- All four gates must pass before each CodeRabbit review and before each
  commit: `make check-fmt`, `make typecheck`, `make lint`, `make test`.
- Prose uses en-GB-oxendict spelling and wraps at 80 columns; code blocks wrap
  at 120. Markdown is validated with `make markdownlint`; Mermaid (if any) with
  `make nixie`.

## Tolerances (exception triggers)

Stop and escalate when any of these is breached:

- Scope: more than ~12 source files changed, or more than ~500 net lines of
  non-test code. The spine plus one demonstrator should be well under this.
- Interface: if any *existing* public signature in `src/index.ts`,
  `src/store/index.ts` selectors, or REST handler context must change
  (as opposed to additive new exports), stop and escalate.
- Dependencies: if any new runtime dependency is required, stop and escalate.
  The Dafny/Lean toolchain needed by the optional LemmaScript proof (see Risks
  and "Optional proof milestone") is itself a tolerance breach: it must be
  explicitly approved before being added to any gate, and must remain an
  additive, separately-gated artefact if approved.
- starfx semantics: if dispatching a thunk and awaiting it does **not**
  reliably settle the store update before a subsequent read in the same process
  (see Risk R1), stop after two remediation attempts and escalate with the
  reproduction.
- Iterations: if a red test cannot be turned green within 3 focused attempts,
  stop and escalate with the failing transcript.
- Ambiguity: if the demonstrator entity choice (repository) turns out not to be
  readable through *both* REST and GraphQL for the chosen field, stop and
  present alternatives rather than expanding GraphQL read coverage (that is
  roadmap phase 2 work).

## Risks

- Risk R1: awaiting a dispatched starfx thunk may not guarantee the store
  update is visible to an immediate, synchronous re-read in the *same* handler.
  Severity: medium. Likelihood: low–medium.
  Mitigation: the roadmap success criterion is satisfied across *separate* HTTP
  requests (write request, then read request), where any microtask/IO boundary
  has already flushed — so the cross-surface acceptance test is robust
  regardless. For the *write response itself*, the use case re-selects the
  persisted repository after dispatch; pure reducer output is only a fallback
  if that contract changes. If a within-request read-back is ever needed,
  prefer a state-subscription latch over assuming synchronous settlement. Stage
  B includes a focused store-level test that dispatches the action and asserts
  the new state is observable, which pins this behaviour down early.
- Risk R2: returning a full repository object via `return {status, json}` runs
  the OpenAPI response validator, which is known to choke on nullable fields in
  the GitHub schema. Severity: low.
  Mitigation: emit responses with `response.status(200).json(...)` (the
  validator-bypassing path the existing handlers use; see the documented
  `apps/get-org-installation` comment in `src/rest/index.ts`).
- Risk R3: the `repos/update` OpenAPI operation may be subject to request-body
  schema validation by openapi-backend. Severity: low.
  Mitigation: the simulator mounts OpenAPI with `additionalOptions.quick: true`
  (`src/rest/index.ts`), which skips precompiled validation; the handler reads
  `request.body` defensively and coerces fields itself.
- Risk R4: LemmaScript is a Tech Preview and its Dafny/Lean backend is a
  heavyweight, non-incremental toolchain dependency. Severity: medium for the
  optional proof milestone only. Likelihood: high if attempted in CI.
  Mitigation: keep the LemmaScript proof additive and outside the default gate;
  treat fast-check property tests as the primary, in-repo invariant evidence.
  Escalate before adding Dafny/Lean to CI. (See "Optional proof milestone".)
- Risk R5: the `GitHubActions` type is derived as
  `ReturnType<typeof inputActions>`; widening it from `{}` to a real action map
  could ripple into the `ExtendedSimulationStore` generic and caller extension
  types. Severity: low–medium.
  Mitigation: keep `buildDomainActions` strongly typed and run `make typecheck`
  after the wiring change before touching handlers; the type surface is
  exercised by `tests/extension-handlers.test.ts`.

## Progress

- [x] (Stage A) Confirm orientation facts and finalize the demonstrator field
      set; no code changes.
- [x] (Stage B) Red: store-level unit/property tests for the pure reducer and
      the dispatched action; REST+GraphQL cross-surface integration test; a
      Gherkin scenario. All fail for the expected reasons.
- [x] (Stage C) Green: implement the pure reducer, the thunk adapter, the
      dispatch helper, wire `inputActions`, add the `repos/update` and
      `repos/get` handlers.
- [x] (Stage D) Refactor, documentation, JSDoc, and gate clean-up; CodeRabbit
      review; mark roadmap 1.3.1 done.
- [ ] (Optional, non-blocking) LemmaScript proof of the reducer
      idempotence/determinism axioms, only if the Dafny/Lean toolchain
      dependency is approved.

## Surprises & discoveries

- Observation: the GraphQL repository converter already maps `description`
  conditionally. Evidence: `src/graphql/converters/repository.ts:129`
  (`...(repo.description ? {description: repo.description} : {})`). Impact: no
  GraphQL changes are needed for the success criterion; writing `description`
  through the action is observable via `Query.repository { description }`.
- Observation: the foundation already dispatches thunks via
  `simulationStore.store.dispatch(simulationStore.actions.batchUpdater([...]))`
  fire-and-forget. Evidence: `@simulacrum/foundation-simulator` `src/index.ts`
  lines ~360 and ~407. Impact: confirms the dispatch idiom and that the action
  result is observable on later requests.
- Observation: the 2026-06-26 rebase onto `origin/main` completed without
  conflicts. The post-rebase gates passed after running `bun install` because
  this worktree had no `node_modules` directory. Evidence:
  `/tmp/rebase-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`,
  `/tmp/check-fmt-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`,
  `/tmp/test-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`,
  `/tmp/typecheck-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`,
  and
  `/tmp/lint-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`.
  Impact: implementation starts from a clean, validated branch based on
  `origin/main`.
- Observation: the local documentation set has `docs/users-guide.md` and
  `docs/api-reference.md`, but no `docs/developers-guide.md` or
  `docs/documentation-style-guide.md`. Impact: Stage D will update
  `docs/api-reference.md` for public/internal API reference material and
  `docs/users-guide.md` for user-facing behaviour rather than creating a
  new developer guide only to satisfy a stale plan reference.
- Observation: `githubRepositorySchema` already includes both `description`
  and `homepage`. Evidence: `src/store/entities/repository.ts` fields in
  `githubRepositorySchema`. Impact: the demonstrator whitelist can remain
  `description` plus `homepage`; no schema expansion is needed.
- Observation: `repos/get` and `repos/update` are present in the bundled REST
  schema. Evidence: `schema/api.github.com.json` operation IDs at lines
  27824 and 27874. Impact: implementation can add explicit handlers for
  existing OpenAPI operations rather than altering the schema.
- Observation: `Query.repository` reads from `selectors.getRepository` and
  then converts through `toGraphql(..., 'Repository', repo)`. Evidence:
  `src/graphql/resolvers.ts:createResolvers`. Impact: a store write to the
  repository table is observable through the existing GraphQL read path with
  no resolver change.
- Observation: Stage B red tests now cover the reducer contract, store action,
  use case, REST/GraphQL read-your-write behaviour, Gherkin acceptance, and
  action extension coexistence. Evidence:
  `/tmp/red-store-actions-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
  fails because `src/store/actions/repository.ts` does not exist;
  `/tmp/red-repository-write-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
  fails because `PATCH /repos/acme/awesome-repo` returns the OpenAPI example
  repository instead of persisted fixture state;
  `/tmp/red-shared-domain-feature-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
  fails because REST and GraphQL reads still see the original descriptions;
  and
  `/tmp/red-extension-actions-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
  fails because `simulationStore.actions.updateRepository` is undefined.
  Impact: implementation can now proceed against observed failing behaviour.
- Observation: Stage C introduced the shared action spine under
  `src/store/actions/`: a pure repository reducer and command builder, a
  generic `createEntityUpdateThunk`, a `dispatchWrite` helper, and
  `updateRepositoryUseCase`. `src/store/index.ts` now wires
  `buildDomainActions(args)` through the built-in action set.
  Impact: future mutable slices can reuse the reducer/thunk/use-case shape
  rather than mutating tables in route handlers.
- Observation: `starfx` table `set` replaces the entire table, while `add`
  upserts the provided entities into the existing table. Evidence:
  `node_modules/starfx/dist/esm/store/slice/table.js`; the focused
  two-owner store test initially lost `globex/awesome-repo` when the adapter
  used `table.set({[id]: entity})`. Impact: shared update thunks must use
  `table.add` for whole-entity upserts unless a future slice intentionally
  replaces the full table.
- Observation: caller action extensions must remain possible alongside
  built-in actions, and schema extensions are optional in real use. Evidence:
  `tests/extension-handlers.test.ts` exercises an action-only
  `extendStore` configuration. Impact: `GitHubExtendStoreInput` now allows
  extra action names and keeps `schema` optional, matching the existing
  runtime extension contract.
- Observation: the Stage C focused gate passes for store actions,
  repository write integration, cross-owner Gherkin scenarios, and extension
  coexistence. The full Stage C commit gates also pass:
  `make check-fmt`, `make markdownlint`, `make typecheck`, `make lint`, and
  `make test` (275 tests). Evidence:
  `/tmp/focused-stage-c-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
  plus
  `/tmp/check-fmt-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour-stage-c.out`,
  `/tmp/markdownlint-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour-stage-c.out`,
  `/tmp/typecheck-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour-stage-c.out`,
  `/tmp/lint-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour-stage-c.out`,
  and
  `/tmp/test-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour-stage-c.out`.
  Impact: implementation can proceed to CodeRabbit review and Stage D
  documentation.
- Observation: CodeRabbit reviewed the Stage C implementation commit
  (`2867a0c`) with zero findings. Evidence:
  `/tmp/coderabbit-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour-stage-c.out`.
  Impact: no Stage C review concerns need remediation before documenting the
  delivered public behaviour.
- Observation: Stage D documents the shared action exports in
  `docs/api-reference.md`, the repository metadata write workflow in
  `docs/users-guide.md`, the shared write module boundary in
  `docs/architecture.md` and `docs/development.md`, and marks roadmap item
  1.3.1 complete in `docs/roadmap.md`.
  Impact: user-facing and roadmap documentation now matches the delivered
  mutation spine.
- Observation: CodeRabbit reviewed the Stage D documentation commit
  (`2783f27`) with zero findings after the required rate-limit backoff.
  Evidence:
  `/tmp/coderabbit-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour-stage-d.out`.
  Impact: no documentation review concerns remain outstanding.

## Decision log

- Decision: demonstrate the spine with a **repository update** action.
  Rationale: repositories are the only entity currently readable through *both*
  REST (`repos/list-for-org`) and GraphQL (`Query.repository`). Issues and pull
  requests have REST reads but no GraphQL reads yet (roadmap phase 2), so they
  cannot satisfy the "one REST and one GraphQL-facing read path" criterion
  without expanding GraphQL coverage out of scope.
  Date/Author: 2026-06-17, planning.
- Decision: write only `description` and `homepage`.
  Rationale: benign descriptive metadata that is unambiguously not repository
  *policy*; avoids front-running phase 4 settings work while still proving a
  real, observable mutation. `description` is the asserted field because it is
  already exposed by both surfaces.
  Date/Author: 2026-06-17, planning.
- Decision: the reducer does not touch `updated_at`/`pushed_at`.
  Rationale: keeping the reducer a pure, clock-free function makes it
  unit-testable, property-testable, and (optionally) formally provable without
  a time port. Timestamp-on-write is a later, separate concern.
  Date/Author: 2026-06-17, planning.
- Decision: place pure reducers under `src/store/actions/<entity>.ts` rather
  than a new top-level `src/domain/` tree.
  Rationale: the repository colocates entity logic under `src/store`
  (`AGENTS.md`: "group by feature, not layer"); the hexagonal boundary is
  enforced through *module purity* and an import lint, not through a parallel
  directory transplant. This matches `$hexagonal-architecture`'s guidance to
  protect boundaries rather than impose a pattern.
  Date/Author: 2026-06-17, planning.
- Decision: the write response is built by **re-selecting the persisted entity
  after the dispatched action settles** (read-your-write), so the PATCH body is
  identical to a subsequent GET. The pure-reducer output is the documented
  fallback only if the Stage-A settlement spike shows the awaited dispatch does
  not settle in time.
  Rationale: a PATCH response that diverges from GET is a contract bug
  (Telefono). Cross-surface acceptance is still asserted across separate
  requests, which is robust regardless of settlement.
  Supersedes the earlier "build from pure reducer output" decision.
  Date/Author: 2026-06-17, planning (revised after design review).
- Decision: introduce an application-layer use case (`updateRepositoryUseCase`)
  and a thunk factory (`createEntityUpdateThunk`) even though only one action
  ships now.
  Rationale: design review (Pandalump/Doggylump) found that leaving
  guard+dispatch+reselect inline in the route would make the next slice copy
  route-local orchestration — the very smell 1.3.1 removes. The use case is the
  shared driving port; the factory is the shared driven-adapter seam. Together
  they are the actual reusable "spine" that PR lifecycle, labels, and reviews
  build on.
  Date/Author: 2026-06-17, planning (added after design review).
- Decision: the demonstrator command type is
  `Partial<Record<RepositoryWritableField, string | undefined>>`
  (string-only values, with optional generated entries tolerated).
  Rationale: `description` and `homepage` are both strings. Boolean policy
  fields (e.g. `private`) are out of scope (phase 4); when a later slice needs
  them the command/whitelist types widen to a field→value union. The
  `undefined` allowance reflects exact optional property typing and property
  test generation; `buildUpdateRepositoryCommand` still accepts only string
  values from adapter bodies. Noted so the narrowing is a deliberate,
  documented choice rather than an oversight.
  Date/Author: 2026-06-17, planning (added after design review).
- Decision: LemmaScript proof is optional and gate-isolated.
  Rationale: it introduces a Dafny/Lean toolchain dependency (Tech Preview);
  fast-check property tests provide the primary invariant evidence in-repo.
  Date/Author: 2026-06-17, planning.
- Decision: move from draft to implementation on 2026-06-26.
  Rationale: the user explicitly requested implementation of this ExecPlan
  after the rebase, which satisfies the approval gate described by the
  `execplans` skill for this already-authored plan.
  Date/Author: 2026-06-26, implementation.
- Decision: document the action-spine API in `docs/api-reference.md` rather
  than `docs/developers-guide.md`.
  Rationale: `docs/developers-guide.md` does not exist in this branch, while
  `docs/api-reference.md` is the existing public API document and already
  describes extension hooks. Creating a new guide would be a documentation
  structure change unrelated to the write spine.
  Date/Author: 2026-06-26, implementation.

## Context and orientation

Simulacat Core is a TypeScript GitHub API simulator built on
`@simulacrum/foundation-simulator` (which itself wraps the `starfx` store).
Seeded fixtures are parsed by zod schemas, converted into keyed store tables,
and exposed through REST (OpenAPI handlers) and GraphQL (Yoga resolvers). Read
the architecture guide at `docs/architecture.md` and the development guide at
`docs/development.md` before starting.

Key files a novice will touch or read:

- `src/store/index.ts` — builds the store schema, the built-in action set
  (`inputActions`, currently `() => ({})`), and selectors. `extendStore`
  merges caller extensions. This is where the spine is wired in.
- `src/store/entities/repository.ts` — `githubRepositorySchema`,
  `GitHubRepository`, `repositoryStoreKey({owner, name})`. The store key is
  `owner/name`.
- `src/store/keys.ts` — re-exports canonical key helpers.
- `src/rest/index.ts` — the OpenAPI handler table. `requireRepository` guards
  repository-scoped routes; `makeItemHandler`/`makeListHandler` are read
  helpers. Handlers reach the store via `simulationStore.store.getState()` and
  `simulationStore.selectors.*`. Responses use `response.status(n).json(...)`
  to avoid OpenAPI response validation (see the `apps/get-org-installation`
  comment).
- `src/graphql/resolvers.ts` — `Query.repository(owner, name)` reads
  `selectors.getRepository` then `toGraphql(..., 'Repository', repo)`.
- `src/graphql/converters/repository.ts` — maps `description` at line 129.

How writes work in the foundation/starfx store (this is the mechanism the spine
uses):

- Actions are starfx *thunks* created with
  `thunks.create<Payload>('name', function* (ctx, next) { ... yield* next(); })`.
  Inside a thunk, state is written with
  `yield* schema.update(schema.<slice>.set({[key]: entity}))` (or `.merge` /
  `.patch`). The table slice updaters are `add`, `set`, `remove`, `patch`,
  `merge`, `reset` (see starfx `store/slice/table.d.ts`).
- Actions are dispatched with
  `simulationStore.store.dispatch(simulationStore.actions.<name>(payload))`.
- `inputActions({thunks, store, schema})` is the seam that returns the built-in
  action map. Today it returns `{}`. The foundation merges these with its own
  `simulationLog`/`batchUpdater` base actions.

Terms of art:

- **Action / reducer / mutation spine**: the shared, centralized write path. A
  *reducer* here is the pure function that computes the next entity from the
  current entity plus a command; the *action* (thunk) is the adapter that
  persists the reducer's output into the store table.
- **Driving adapter**: REST handler or GraphQL resolver that invokes the
  domain. **Driven adapter**: the starfx thunk that performs persistence. The
  **port** is the action's command signature.
- **Read-your-write**: after a write completes, a subsequent read returns the
  written value.

## Interfaces and dependencies

Be prescriptive. At the end of Stage C these must exist.

In `src/store/actions/repository.ts` (pure domain core — no framework imports):

```ts
/** Fields the repository write spine may mutate in this slice. */
export const REPOSITORY_WRITABLE_FIELDS = ['description', 'homepage'] as const;

export type RepositoryWritableField = (typeof REPOSITORY_WRITABLE_FIELDS)[number];

/** A request to update descriptive fields of one repository. */
export type UpdateRepositoryCommand = {
  owner: string;
  name: string;
  changes: Partial<Record<RepositoryWritableField, string>>;
};

/**
 * Pure reducer: returns a new repository with whitelisted, defined fields
 * applied. Never mutates `current`. Deterministic. Ignores unknown and
 * undefined fields. Empty `changes` returns an equal-valued repository.
 */
export function applyRepositoryUpdate(
  current: GitHubRepository,
  command: UpdateRepositoryCommand
): GitHubRepository;

/** Extracts a command from a raw REST request body, keeping only whitelisted
 * string fields. This adapter-facing parser is separate from the pure reducer. */
export function buildUpdateRepositoryCommand(
  owner: string,
  name: string,
  body: unknown
): UpdateRepositoryCommand;
```

In `src/store/actions/index.ts` (driven adapter — starfx wiring):

```ts
/**
 * Factory that wires one pure entity reducer into a starfx update thunk. This
 * is the reuse seam: later slices (labels, pull requests, reviews) build their
 * own update action by supplying a key function and a pure reducer, without
 * re-implementing read-modify-write or dispatch plumbing.
 */
export const createEntityUpdateThunk = <Command, Entity>(args: {
  thunks: ExtendSimulationActions<ExtendedSchema>['thunks'];
  store: ExtendSimulationActions<ExtendedSchema>['store'];
  slice: /* schema.<slice> */ unknown;
  name: string;
  keyOf: (command: Command) => string;
  reducer: (current: Entity, command: Command) => Entity;
}) => /* thunks.create<Command>(name, function* (ctx, next) { read → reduce → set }) */ unknown;

/** Builds the package's built-in domain actions (thunks) from the store args.
 * Wired into `inputActions` in `src/store/index.ts`. */
export const buildDomainActions = (
  args: ExtendSimulationActions<ExtendedSchema>
) => ({
  updateRepository: createEntityUpdateThunk<UpdateRepositoryCommand, GitHubRepository>({
    thunks: args.thunks,
    store: args.store,
    slice: args.schema.repositories,
    name: 'updateRepository',
    keyOf: (command) => repositoryStoreKey(command),
    reducer: applyRepositoryUpdate
  })
});
```

In `src/store/actions/repository-use-case.ts` (driving port — shared
orchestration reused by every driving adapter):

```ts
/**
 * Application-layer use case: the single shared write path for repository
 * updates. Guards existence, dispatches the shared action, awaits settlement,
 * and returns the persisted, re-selected entity so REST/GraphQL/Gherkin all go
 * through one orchestration rather than re-implementing guard+dispatch+reselect.
 *
 * @returns `{ok: true, repository}` with the persisted entity, or
 * `{ok: false, reason: 'not-found'}` when the repository is absent.
 */
export async function updateRepositoryUseCase(
  store: ExtendedSimulationStore,
  command: UpdateRepositoryCommand
): Promise<{ok: true; repository: GitHubRepository} | {ok: false; reason: 'not-found'}>;
```

In `src/store/actions/dispatch.ts` (driving-adapter support):

```ts
/** Dispatches a write action and awaits its completion. Throws if the
 * dispatch rejects. Used by `updateRepositoryUseCase`. */
export async function dispatchWrite(
  store: ExtendedSimulationStore['store'],
  action: unknown
): Promise<void>;
```

In `src/rest/index.ts`, two new entries in the base handler table, plus one
shared shaping helper:

- `shapeRepository(state, owner, name)` — returns the single stored repository
  with the same owner-object reshaping `repos/list-for-org` already applies (it
  reuses `selectors.allReposWithOrgs(state, owner)` and finds by name, so the
  PATCH response, the GET response, and the list response are byte-for-byte the
  same shape). This is the single REST serialization point for a repository.
- `'repos/update'` — `PATCH /repos/{owner}/{repo}`: guards with
  `requireRepository`; builds a command with the adapter-facing
  `buildUpdateRepositoryCommand`;
  calls `updateRepositoryUseCase(simulationStore, command)`; on `not-found`
  responds `404` (shared `notFound`); on success responds `200` with
  `shapeRepository(getState(), owner, repo)` — i.e. the **persisted,
  re-selected** entity, so the PATCH body is identical to a subsequent GET
  (read-your-write). The handler itself stays tiny; orchestration lives in the
  use case.
- `'repos/get'` — `GET /repos/{owner}/{repo}`: guards with `requireRepository`
  and responds `200` with `shapeRepository(getState(), owner, repo)`; `404`
  when absent.

Wiring change in `src/store/index.ts`: replace the empty `inputActions` body
with `return buildDomainActions(args);`. `GitHubActions` then becomes the real
action map automatically (`ReturnType<typeof inputActions>`); run `typecheck`
immediately after this change.

## Plan of work

Stage A — understand and propose (no code changes).

1. Re-read `docs/architecture.md` §State model, §Extension seams, §Repository
   label slice; `docs/development.md` §Testing expectations and §Early
   repository-owned entities; `docs/github-rest-api-audit.md` §Extension
   Surface.
2. Confirm `Query.repository` returns `description` end to end (converter line
   129) and that `repos/list-for-org` returns repositories including
   `description`.
3. Confirm `repos/update` and `repos/get` operationIds exist in
   `schema/api.github.com.json` (they do: PATCH and GET `/repos/{owner}/{repo}`).
4. Finalize the writable field set. `description` is the asserted field and is
   confirmed present in `githubRepositorySchema`. Verify `homepage` is also in
   `githubRepositorySchema` (`src/store/entities/repository.ts`); if it is not,
   either add it as an optional string field (preferred — it is a standard
   GitHub field) or reduce the whitelist to `description` only. Do not write a
   field the schema does not model.
5. Settlement spike (pins Risk R1, ~10 lines, throwaway): in a scratch test,
   build the store, `await store.dispatch(actions.updateRepository(cmd))`, and
   assert `selectors.getRepository(store.getState(), ...)` shows the write. If
   the awaited dispatch reliably settles, the use case re-selects after await
   (preferred). If it does not, switch the use case to return the pure reducer
   output (which equals the eventually-settled state) and record the finding in
   Surprises & Discoveries. Delete the spike once the behaviour is known.

Stage B — red tests (small diffs that fail before implementation).

Write these tests first and run them to observe the expected failures. Mirror
the existing conventions catalogued in `docs/development.md` and the test files
named below.

1. `tests/store-actions.test.ts` (unit + property, `bun:test` + `fast-check`):
   - Unit: `applyRepositoryUpdate` applies `description`; returns a new object
     (does not mutate `current`); ignores non-whitelisted fields (e.g. a
     `private` change is dropped); empty `changes` yields equal values.
   - Property (fast-check, mirroring `tests/store-keys.test.ts` arbitraries):
     - Idempotence: `applyRepositoryUpdate(applyRepositoryUpdate(r, c), c)`
       deep-equals `applyRepositoryUpdate(r, c)` for arbitrary repos and
       commands over the whitelisted fields.
     - Determinism/purity: two independent calls with structurally equal
       inputs produce deep-equal outputs, and `current` is unchanged
       (snapshot before/after).
     - Whitelist safety: for arbitrary extra keys in `changes`, output fields
       outside the whitelist equal the corresponding `current` fields.
     - Cross-owner isolation (store level): dispatching `updateRepository` for
       `owner/name` never changes a distinct `owner2/name2` repository's
       `description`.
   - Store-level (pins Risk R1): build a store via `extendStore` +
     `createSimulationStore` (or the public `simulation(...)` store), dispatch
     `updateRepository`, and assert `selectors.getRepository(...).description`
     reflects the write. Also exercise `updateRepositoryUseCase` directly and
     assert it returns `{ok: false, reason: 'not-found'}` for an unknown
     repository.
   - Type-regression guard (`tests/extension-handlers.test.ts`, mitigates Risk
     R5): assert that a caller-provided `extendStore.actions` extension and the
     new built-in `updateRepository` action coexist — both are present on
     `simulationStore.actions` and typecheck — so widening `GitHubActions` from
     `{}` does not break caller action extensions.
2. `tests/repository-write.test.ts` (integration, `bun:test`): start a server
   with `simulation({initialState}).listen(0)`; `PATCH
   /repos/{owner}/{repo}` with a JSON body `{description: '...'}`; assert `200`
   and that the response body carries the new description; then issue a **REST
   read** (`GET /repos/{owner}/{repo}` and `GET /orgs/{org}/repos`) and a
   **GraphQL read** (`POST /graphql` with
   `query { repository(owner, name) { description } }`) and assert both reflect
   the new description. Mirror `tests/repositories.test.ts` and
   `tests/graphql.test.ts` for the request idioms.
3. `features/shared-domain-writes.feature` + a `*.steps.ts` (Gherkin,
   `@aboviq/bun-test-cucumber`): one scenario — "a repository description
   written once is visible through REST and GraphQL". Wire via `withState`,
   `Given`/`When`/`Then`, and `After(state => state.server?.ensureClose())`,
   following `tests/cross-owner-identity.steps.ts`.

Run the focused suites and confirm they fail because the action, handlers, and
modules do not yet exist.

Stage C — implementation (minimal change to pass the red tests).

1. Add `src/store/actions/repository.ts` — the pure reducer, command type, and
   whitelist with no framework imports. Add `src/rest/repository-patch.ts` for
   Zod request parsing and command construction.
2. Add `src/store/actions/index.ts` — `createEntityUpdateThunk` (the reuse
   seam) and `buildDomainActions`, which builds `updateRepository` from the
   factory. Inside the factory thunk: read `current` from
   `slice.selectById(store.getState(), {id: keyOf(command)})`; if absent,
   complete without writing; else
   `yield* schema.update(slice.add({[key]: reducer(current, command)}))`.
3. Add `src/store/actions/dispatch.ts` — `dispatchWrite`.
4. Add `src/store/actions/repository-use-case.ts` — `updateRepositoryUseCase`
   (guard → dispatch via `dispatchWrite` → re-select → return persisted
   entity), the single shared orchestration path for repository writes.
5. Edit `src/store/index.ts` — `inputActions` now returns
   `buildDomainActions(args)`. Run `make typecheck` immediately (Risk R5).
6. Edit `src/rest/index.ts` — add the `shapeRepository` helper and the
   `'repos/update'` and `'repos/get'` handlers as specified in Interfaces. The
   handlers stay tiny (parse params/body, parse the request body with Zod,
   call the use case, shape the result); orchestration lives in the use case,
   not the route. Prefer small extracted helpers over complexity suppressions
   to stay within the maintainability gates.
7. Export the new public types/functions from `src/index.ts` that a consumer or
   later slice would reasonably need (`UpdateRepositoryCommand`,
   `applyRepositoryUpdate`, `createEntityUpdateThunk`). Keep exports additive.

Run the Stage B suites; turn each red test green with the smallest change.

Stage D — refactor, documentation, cleanup.

1. Update `docs/architecture.md`: add a "Mutation spine" subsection under
   §State model / §Extension seams describing shared domain actions, the pure
   reducer vs thunk-adapter split, and the dispatch helper. Note the writable
   field whitelist and the phase-4 boundary. Add `src/store/actions/*` to the
   module-responsibilities list.
2. Update `docs/development.md` §Testing expectations: document where mutation
   logic lives (pure reducers under `src/store/actions`, thunks as adapters),
   that REST/GraphQL handlers must call shared actions rather than editing
   state locally, and the property-test expectation for write invariants.
3. Update `docs/users-guide.md`: document the new observable behaviour — a
   `PATCH /repos/{owner}/{repo}` updates `description`/`homepage` and the change
   is visible through REST and GraphQL reads; note that other `repos/update`
   fields are accepted but not yet applied.
4. Update `docs/api-reference.md`: document the internal action-spine API
   (`buildDomainActions`, `applyRepositoryUpdate`, `dispatchWrite`), the
   hexagonal boundary, and how a future slice adds a new action.
5. JSDoc on all new exported functions per the `df12` Oxlint rules
   (`@param`/`@returns`/`@throws`); module `@file` headers on new files.
6. Run `make markdownlint`; `bun fmt` for Markdown table formatting.
7. Mark roadmap `1.3.1` done in `docs/roadmap.md`.

## Concrete steps

Run all commands from the repository root. Use `tee` to a log so truncated
output can be reviewed, per `~/.claude/CLAUDE.md`.

Red (expect failures):

```bash
bun test tests/store-actions.test.ts 2>&1 | tee /tmp/red-store-actions.out
bun test tests/repository-write.test.ts 2>&1 | tee /tmp/red-repo-write.out
```

Expected: failures referencing missing modules
(`src/store/actions/...`) and missing `repos/update`/`repos/get` routes
(404 / unhandled), and a GraphQL/REST description mismatch.

Green (after implementation):

```bash
bun test tests/store-actions.test.ts tests/repository-write.test.ts \
  2>&1 | tee /tmp/green-writes.out
```

Expected: all new tests pass.

Full gate (before every commit and before CodeRabbit):

```bash
make check-fmt 2>&1 | tee /tmp/fmt.out
make typecheck 2>&1 | tee /tmp/typecheck.out
make lint      2>&1 | tee /tmp/lint.out
make test      2>&1 | tee /tmp/test.out
```

Expected: each target exits zero. Do not run these in parallel (build cache is
shared; sequential runs benefit from caching).

CodeRabbit (only after the deterministic gates pass):

```bash
coderabbit review --agent 2>&1 | tee /tmp/coderabbit.out
```

## Validation and acceptance

Behavioural acceptance (the roadmap success criterion — "at least one REST and
one GraphQL-facing read path can observe state written through the same
action"):

1. Start a simulator seeded with an organization `acme` and a repository
   `acme/awesome-repo` (description `Generic repository description`).
2. `PATCH /repos/acme/awesome-repo` with body
   `{"description": "Patched via shared action"}` returns `200` and a body
   whose `description` is `Patched via shared action`.
3. `GET /repos/acme/awesome-repo` returns `description = "Patched via shared
   action"` (REST read path #1).
4. `GET /orgs/acme/repos` returns the repository with the same description
   (REST read path #2, pre-existing route).
5. `POST /graphql` with
   `query { repository(owner: "acme", name: "awesome-repo") { description } }`
   returns `data.repository.description = "Patched via shared action"`
   (GraphQL read path).

Red-Green-Refactor evidence to record in this section as work proceeds:

- Red: paste the failing transcript from `/tmp/red-*.out` showing the tests
  fail for the intended reasons (missing modules/routes, mismatched
  description).
  Evidence captured on 2026-06-26:
  - `/tmp/red-store-actions-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
    shows `Cannot find module '../src/store/actions/repository.ts'`.
  - `/tmp/red-repository-write-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
    shows `PATCH /repos/acme/awesome-repo` returning the bundled OpenAPI
    example repository (`octocat/Hello-World`) rather than the seeded
    `acme/awesome-repo`.
  - `/tmp/red-shared-domain-feature-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
    shows the new Gherkin scenario reading `"This your first repo!"` through
    REST and `"Original description"` through GraphQL after the write.
  - `/tmp/red-extension-actions-simulacat-core-1-3-1-shared-domain-actions-for-write-behaviour.out`
    shows `simulationStore.actions.updateRepository` is currently `undefined`
    when caller action extensions are present.
- Green: paste the passing transcript from `/tmp/green-writes.out`.
- Refactor: paste the final `make all`-equivalent transcript
  (`check-fmt`, `typecheck`, `lint`, `test` all green).

Quality criteria (definition of done):

- Tests: new unit, property, integration, and Gherkin tests pass; the full
  `make test` suite passes.
- Lint/typecheck/format: `make lint`, `make typecheck`, `make check-fmt` exit
  zero, with no new `.jsdoc-baseline.json` entries and no broad lint
  suppressions added.
- Architecture: no starfx/framework import appears in
  `src/store/actions/repository.ts`; REST/GraphQL observe the same written
  state through the shared action.
- Docs: `architecture.md`, `development.md`, `users-guide.md`,
  `api-reference.md`, and `roadmap.md` updated; `make markdownlint` passes.
- CodeRabbit: `coderabbit review --agent` reports no outstanding actionable
  concerns.

## Optional proof milestone (LemmaScript) — escalation-gated

`docs/...` task guidance asks that introduced axioms/contractual business logic
be backed by an exhaustive proof (for example with LemmaScript,
<https://github.com/midspiral/LemmaScript>) where one is well-founded. The
reducer `applyRepositoryUpdate` carries crisp algebraic axioms that are a good
proof target: **idempotence** (`apply(apply(r, c), c) == apply(r, c)`),
**determinism/purity**, and **whitelist confinement** (fields outside the
whitelist are preserved). These mirror the "invariant preserved across actions"
and "NoOp completeness" shape LemmaScript case studies prove.

LemmaScript, however, compiles annotated TypeScript to **Dafny or Lean 4** and
requires that toolchain (Node ≥ 18 plus Dafny ≥ 4.x or elan/Lean). It is a Tech
Preview. Adding Dafny/Lean to the commit gate is a **dependency tolerance
breach** and must be approved before being attempted. Therefore:

- Primary, in-repo evidence for the axioms is the **fast-check property suite**
  in Stage B (idempotence, determinism, purity, whitelist safety, cross-owner
  isolation). This is sufficient for the roadmap success criterion.
- If the maintainer approves the toolchain, add the proof as an **additive,
  separately-gated** artefact: annotate `src/store/actions/repository.ts` (or a
  proof-only mirror) with `//@ ensures`/`//@ requires` and run
  `bunx lsc gen --backend=dafny` / `bunx lsc check --backend=dafny`, keeping the
  generated `.dfy.gen`/`.dfy` under a `proofs/` path with its own make target —
  never in the default `make all` path until the team decides otherwise.
- If approval is withheld, record in the Decision Log that fast-check property
  tests are the chosen substitute and why (no Dafny/Lean dependency in the gate
  for a single descriptive-field reducer).

This proof remains optional and non-blocking for plan completion.

## Idempotence and recovery

All steps are re-runnable. The new modules and handlers are additive; re-running
Stage C edits is safe (idempotent file writes / unique handler keys). If a gate
fails mid-way, fix forward and re-run the specific gate via `tee`. No
destructive operations are involved; no migrations, no data deletion. Reverting
is a `git revert`/branch reset away because work is committed in small,
gated increments.

## Artefacts and notes

- OpenAPI `repos/update` request body exposes: `name, description, homepage,
  private, visibility, security_and_analysis, has_issues, has_projects,
  has_wiki, is_template, default_branch, allow_squash_merge,
  allow_merge_commit, allow_rebase_merge, allow_auto_merge,
  delete_branch_on_merge, allow_update_branch, use_squash_pr_title_as_default,
  squash_merge_commit_title, squash_merge_commit_message, merge_commit_title,
  merge_commit_message, archived, allow_forking, web_commit_signoff_required`.
  Only `description` and `homepage` are applied here; the rest are accepted and
  ignored (policy fields are roadmap phase 4).
- starfx table slice updaters available on `schema.repositories`: `add`, `set`,
  `remove`, `patch`, `merge`, `reset`, plus `selectById`/`selectTable`/
  `selectTableAsList`.

## Signposted documentation and skills

- Skills: `execplans` (this document's form), `$hexagonal-architecture`
  (domain/adapter boundary), `leta` (semantic code navigation), `firecrawl`
  (web research used for the LemmaScript assessment), `proptest` concepts via
  `fast-check`, `logisphere-design-review`/`logisphere-experts` (community
  review of this plan).
- Repository docs: `docs/architecture.md`, `docs/development.md`,
  `docs/github-rest-api-audit.md`, `docs/api-reference.md`,
  `docs/users-guide.md`, `docs/roadmap.md`, and
  `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`.
- External: LemmaScript <https://github.com/midspiral/LemmaScript>; fast-check
  property testing; the foundation simulator / starfx store action model.

## Outcomes & retrospective

The delivered result matches the Purpose: `PATCH /repos/{owner}/{repo}` writes
repository `description` and `homepage` through one shared `updateRepository`
action, and the same state is visible through `GET /repos/{owner}/{repo}`,
`GET /orgs/{org}/repos`, and GraphQL `repository(owner:, name:)`.

The mutation spine cost four small source modules under `src/store/actions/`
plus thin REST adapter wiring. The pure reducer stayed framework-free, while
starfx-specific behaviour lives in the thunk factory. Awaiting the dispatched
action was sufficient for immediate re-selection in the same request. The main
implementation lesson is that starfx table `set` replaces an entire table;
future whole-entity updates should use table `add` unless full replacement is
explicitly intended.

## Revision note

- 2026-07-16 — Completed the final review follow-up. Zod PATCH parsing moved
  into the REST adapter, keyed action supervision serializes same-entity
  read-modify-write flows, and repository metrics now preserve escaped,
  period-containing reasons. The optional proof milestone remains non-blocking.
- 2026-07-15 — Addressed review feedback after re-verifying each report against
  the live branch. The REST response now shapes an already-resolved repository
  through the unscoped joined selector, preserving user-owned repository reads
  and writes; both behavioural and Gherkin coverage now exercise that path.
  PATCH input is validated with Zod, GraphQL description assertions share one
  helper, and scenario servers close in an `After` hook. The public action
  surface has compile-time assertions, while bounded PATCH/GET outcome metrics
  and optional diagnostic logs cover the new write boundary. The markdownlint
  pin was intentionally unchanged because `Makefile`, `package.json`, and
  `bun.lock` already resolve `markdownlint-cli2` at 0.22.1.
- 2026-06-17 — Initial draft, then revised after a Logisphere design review.
  What changed: added an application-layer use case
  (`updateRepositoryUseCase`) and a thunk factory (`createEntityUpdateThunk`)
  so the spine is a genuine reuse seam rather than route-local orchestration;
  changed the write response to re-select the persisted entity (PATCH body ==
  GET body) with the pure-reducer output as fallback; added a Stage-A
  settlement spike and a `homepage` schema check; added a type-regression
  guard test for the `GitHubActions` widening; recorded the string-only command
  type as a deliberate, documented narrowing. Why: the review found the
  original draft centralized the reducer but not the orchestration, which would
  have let the next slice reintroduce the route-local writes 1.3.1 exists to
  remove. Effect on remaining work: Stage C gains two small files
  (`repository-use-case.ts`, the factory in `actions/index.ts`); the REST
  handlers shrink to thin adapters; no change to the success criterion.
