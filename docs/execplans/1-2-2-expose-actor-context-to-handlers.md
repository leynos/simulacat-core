# Expose actor context to REST and GraphQL handlers

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: IN PROGRESS

Roadmap reference: `docs/roadmap.md` task `1.2.2` (legacy label `1.2.3`) under
section 1.2 "Make request actors visible to REST and GraphQL". Depends on
`1.2.1`, which landed in commit `b9093ce` and is documented in
`docs/execplans/1-2-1-request-scoped-actor-resolution.md`.

Approval gate: not yet satisfied. Drafting, validating, and committing this
plan happen before approval. Branch renaming, upstream tracking, and draft PR
creation may occur to support reviewing the plan, but no production code in
`src/` may change before the user explicitly approves implementation.

## Purpose / big picture

Roadmap item `1.2.1` taught the simulator how to *parse and resolve* a request
actor — anonymous, user, app, or installation — from documented request
headers, and rewired `GET /user`, `GET /user/memberships/orgs`, and GraphQL
`Query.viewer` to use it. That parsing now happens **inline inside each of the
three actor-aware handlers**: `src/rest/index.ts:48-88` defines a
`parseActorRequest` helper local to the REST module, and `src/graphql/handler.ts:57-64`
parses again inside the GraphQL Yoga context function. Every other built-in
REST operation handler, every GraphQL resolver other than `viewer`, every
caller-provided `extend.openapiHandlers` operation, and every
`extend.extendRouter` Express route is currently *blind* to the request actor:
if such a handler wants actor-aware behaviour today, it has to import the
helpers, re-read headers, and re-resolve against the store on its own.

After this work, a single Express middleware decorates each incoming
`request` with a typed `simulacatActor` property carrying the parsed actor,
parse diagnostics, optional request-id observation context, and a lazy
`resolve(simulationStore)` helper. The GraphQL Yoga context function uses the
same shared `buildActorContext` helper so that REST, GraphQL, built-in
handlers, and caller-supplied extensions all see one consistent
`ResolvedRequestActor` for the same request. A new pair of exported
helpers — `getActorContext(request)` and `requireUserActor(request,
simulationStore)` — let extension authors make actor-aware decisions in two
lines, with the same authentication-failure observability the built-in
handlers emit. After this work, the `/user/memberships/orgs` and `viewer`
handlers must select their authenticated user through the same shared helper
as a brand-new caller-provided OpenAPI route.

The acceptance test is observable: a fixture with two seeded users, one
caller-supplied OpenAPI operation, and one caller-supplied Express route can
prove that all four surfaces (built-in REST, extension REST, extension router,
built-in GraphQL) report the same selected `login` for the same
`x-simulacat-actor` header value, and that the request actor parse observation
fires exactly once per HTTP request.

This task does NOT add a GraphQL resolver extension hook, does NOT model
permissions, does NOT validate real tokens, and does NOT change the public
header contract documented in `docs/users-guide.md`. Those are later roadmap
items.

## Constraints

Hard invariants that must hold throughout implementation. Violation requires
escalation, not workarounds.

- Do not implement this plan until the user explicitly approves it.
- Before implementation, run `git branch --show-current`. If the branch is
  `main`, `master`, or another default branch, stop and ask for direction.
- Rename the implementation branch to
  `1-2-2-expose-actor-context-to-handlers` before implementation work starts.
  Once the remote branch exists, track
  `origin/1-2-2-expose-actor-context-to-handlers`.
- Preserve every existing public export consumed by `tests/` or
  `docs/api-reference.md`. In particular keep, with identical signatures:
  `parseRequestActor`, `parseRequestActorWithDiagnostics`,
  `parseActorHeaderValue`, `resolveRequestActor`, `selectAuthenticatedUser`,
  `requestIdFromHeaders`, `observeParsedRequestActor`,
  `observeResolvedRequestActor`, `observeSelectedActor`,
  `observeAuthenticationFailure`, `requestActorHeader`,
  `legacySimulacatUserHeader`, `legacyGitHubUserHeader`, `requestIdHeader`,
  `correlationIdHeader`, `resetActorObservationCounters`,
  `getActorObservabilityCounters`, `getActorObservabilityMetrics`, all
  `RequestActor`/`ResolvedRequestActor`/`HeaderReader` types, and the
  `GitHubSimulatorArgs` shape in `src/index.ts:25-34`.
- Preserve the existing simulator header contract documented in
  `docs/users-guide.md` and `docs/architecture.md`: `x-simulacat-actor` is
  preferred; `x-simulacat-user` and `x-github-user` remain user-actor
  compatibility aliases.
- Preserve existing observable behaviour for `GET /user`,
  `GET /user/memberships/orgs`, and GraphQL `viewer`: anonymous, unknown,
  app, and installation actors continue to return the same `Authentication
  required` 401 (REST) or `AuthenticationError` (GraphQL) shape.
- Apply hexagonal architecture as a boundary check. Domain logic — header
  parsing, actor resolution against seeded users and installations,
  observability counter emission — must stay in `src/store/actors.ts` or a
  thin shared `src/store/actor-context.ts` module. Adapters
  (`src/middleware/request-actor.ts`, `src/rest/index.ts`,
  `src/graphql/handler.ts`, `src/graphql/resolvers.ts`,
  `src/extend-api.ts`) may translate transport details into helper input but
  must not own selection rules. This applies the `hexagonal-architecture`
  skill as a boundary check, not as a directory transplant. The same
  separation is reinforced by
  `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §4 "Model identity with actors", §8 "Separate domain rules from protocol
  adapters", and §9 "Centralize mutations as actions". Resolve the actor at
  the boundary, then pass an actor view down through one shared helper.
- Do not introduce real token validation, signature verification, permission
  enforcement, scopes, rate limits, or GitHub App JWT cryptography. Those are
  later roadmap items.
- Do not add a GraphQL resolver extension hook (`extend.graphqlResolvers`,
  `extend.graphqlContext`, etc.) in this slice. Document GraphQL extension as
  future work in `docs/development.md` and the `Decision Log` here.
- Do not add a runtime dependency without explicit approval. Development
  dependencies also require approval unless they are already present in
  `package.json`.
- Property tests using `fast-check` are required if the implementation adds
  any new parsing or token-like invariants over a range of inputs. A
  middleware that delegates to an already-property-tested parser does not
  require a new property test; do require one if a new normalisation rule
  appears.
- A LemmaScript proof is required only if the implementation introduces a new
  business axiom whose correctness cannot be adequately expressed with
  ordinary examples and property tests. If such a proof appears necessary,
  stop and ask for approval before adding proof tooling.
- Update relevant documentation in the implementation branch:
  `docs/api-reference.md`, `docs/architecture.md`, `docs/development.md`,
  `docs/users-guide.md`, `docs/github-rest-api-audit.md`, and
  `docs/github-graphql-api-audit.md`. The requested
  `docs/developers-guide.md` file does not exist in this repository; reuse
  `docs/development.md`, the actual developer-facing guide.
- Mark `docs/roadmap.md` task `1.2.2` done only after implementation,
  documentation, gates, CodeRabbit review, and draft PR preparation are
  complete.
- Run quality gates sequentially and capture long output with `tee` under
  `/tmp`, using names such as
  `/tmp/check-fmt-simulacat-core-1-2-2-expose-actor-context-to-handlers.out`.
  Do not run formatting, linting, tests, or sub-agent test commands in
  parallel.
- Use `coderabbit review --agent` after each major milestone. Clear all
  reported concerns before moving to the next milestone, or document why a
  concern requires user direction.
- Commit after each approved change or major milestone, and gate each commit.
  Use the `commit-message` skill and commit with `git commit -F`, not
  `git commit -m`.

## Tolerances (exception triggers)

- Scope: if implementation requires touching more than 18 files or more than
  900 net source lines, stop and ask for approval to continue. Documentation,
  tests, and generated files do not count toward the source-line threshold
  but must still be reviewed.
- Interface: if any existing exported signature in `src/index.ts`,
  `src/store/index.ts`, `src/store/entities.ts`, `src/store/actors.ts`, or
  `src/graphql/handler.ts` must change incompatibly, stop and present
  options.
- Middleware ordering: if the actor middleware cannot be registered before
  the OpenAPI handler chain in `node_modules/@simulacrum/foundation-simulator/src/index.ts:367-383`
  without a foundation-simulator change, stop and present options. The
  expected attachment point is `extendRouter` at
  `node_modules/@simulacrum/foundation-simulator/src/index.ts:186-188`.
- Type augmentation: if module augmentation of
  `express-serve-static-core#Request` cannot be made to compile under
  `verbatimModuleSyntax: true` and `exactOptionalPropertyTypes: true`
  (`tsconfig.json:5,21`), stop and choose between a `WeakMap`-keyed side
  table or another typing strategy.
- Yoga server context: if widening `createYoga` server context types breaks
  generated resolver types or pushes the resolver context shape into the
  generated `Resolvers` types, stop and consider the helper-only fallback
  described in option C below.
- Observability: if changing parse observation from
  one-per-handler-invocation to one-per-request would silently break an
  existing metric consumer covered by `tests/`, stop and propose an additive
  metric instead.
- Dependency: if a new runtime dependency is needed, stop. If a new
  development dependency is needed, stop unless the user approves it.
- Authorisation: if a route cannot be made actor-aware without implementing
  permission enforcement, leave that enforcement deferred and document the
  limitation. Do not expand the task into full auth.
- Tests: if the same quality gate still fails after three focused
  remediation attempts, stop and record the failing evidence in this plan.
- CodeRabbit: if `coderabbit review --agent` is unavailable, cannot
  authenticate, or reports concerns that exceed these tolerances, stop and
  record the reason before proceeding.
- PR: if the branch already has an open PR under another branch name, use
  GitHub's branch rename flow rather than pushing a differently named branch
  over it.

## Risks

- Risk: middleware-attached `req.simulacatActor` cannot be typed cleanly under
  `verbatimModuleSyntax: true` and `exactOptionalPropertyTypes: true`.
  Severity: medium. Likelihood: medium.
  Mitigation: keep module augmentation in a single value-export-free
  declaration file (`src/types/express-request.d.ts`) added to
  `tsconfig.json#include` (already covered by the existing `src/**/*.ts`
  pattern). Declare the new property as `simulacatActor?: SimulacatRequestActor`
  using optional-with-undefined-omitted semantics. If declaration merging is
  fragile, fall back to a module-scoped `WeakMap<express.Request,
  SimulacatRequestActor>` and route helper access through `getActorContext(request)`.

- Risk: the Yoga server context overload mismatches the runtime shape that
  `@whatwg-node/server` passes.
  Severity: medium. Likelihood: medium.
  Mitigation: keep the Yoga context function reading actor input through the
  shared `buildActorContext(headers)` helper, working against the Fetch
  `Request.headers`. Do not retype `createYoga`'s `TServerContext` in this
  slice unless required for a different reason; that change would couple
  GraphQL to Express types and is out of scope.

- Risk: the actor parse observation counter changes from
  one-per-handler-invocation to one-per-request, breaking a downstream
  alerting assumption.
  Severity: medium. Likelihood: low.
  Mitigation: document the change explicitly in `docs/development.md` and
  `docs/api-reference.md`. Add a regression test that asserts exactly one
  `rest-parse` observation per HTTP request after middleware adoption. Leave
  the `*-resolution` and `*-selected` counters as one-per-resolve so handlers
  that opt in continue to be visible.

- Risk: caller-provided extension router routes registered *before* the
  built-in middleware in `extend-api.ts` would not see `req.simulacatActor`.
  Severity: medium. Likelihood: high if not handled.
  Mitigation: register the actor middleware as the FIRST line of
  `extend-api.ts#extendRouter` callback, before invoking the
  caller-provided `extend` function. Document the ordering in
  `docs/development.md`.

- Risk: a built-in route or test depends on the existing inline
  `parseActorRequest` helper signature exported indirectly through
  re-exports.
  Severity: low. Likelihood: low.
  Mitigation: `parseActorRequest` is currently a private const inside
  `src/rest/index.ts`. Search `tests/` and `src/` for `parseActorRequest`
  before deletion. Replace its callers with the middleware-backed pathway in
  the same commit.

- Risk: GraphQL Yoga reconstructs its own Fetch `Request`, so the Express
  `req` is not object-identical to the `request` Yoga passes the context
  function.
  Severity: medium. Likelihood: high.
  Mitigation: do not assume `req === request`. The shared
  `buildActorContext(headers)` helper accepts only the abstract
  `HeaderReader` shape already defined in `src/store/actors.ts:25-29`, so
  both `req.headers` (Express via the existing inline adapter
  `{get: (name) => req.get(name)}`) and `request.headers` (Fetch
  `Headers`) plug in cleanly.

- Risk: extension authors expect the actor context to be observable through
  `extendStore` or store selectors.
  Severity: low. Likelihood: low.
  Mitigation: document that actor context is *request-scoped* and lives on
  the request, not in the store. Provide the `getActorContext(request)` and
  `requireUserActor(request, simulationStore)` helpers as the public access
  points.

- Risk: external GitHub documentation changes over time.
  Severity: low. Likelihood: medium.
  Mitigation: this slice does not introduce new claims about GitHub
  behaviour beyond those settled by `1.2.1`. Cite the same prior-art
  references as that ExecPlan when documentation updates rephrase actor
  semantics.

## Progress

- [x] (2026-05-24T14:32:00+01:00) Loaded the `leta`, `execplans`,
  `hexagonal-architecture`, `firecrawl`, and `commit-message` skill workflows
  relevant to this planning task.
- [x] (2026-05-24T14:32:00+01:00) Created a leta workspace for
  `/home/leynos/.lody/repos/github---leynos---simulacat-core/worktrees/51fc42fd-e92a-47ba-ab4c-1b2a095b9666`.
- [x] (2026-05-24T14:32:00+01:00) Confirmed the current branch is
  `feat/actor-context-plan`, not a default branch.
- [x] (2026-05-24T14:32:00+01:00) Used a Wyvern agent for read-only
  reconnaissance of actor-context exposure touchpoints, foundation-simulator
  middleware ordering, and Yoga server-context typing.
- [x] (2026-05-24T14:32:00+01:00) Used Firecrawl to confirm the prior art for
  Express request augmentation under `verbatimModuleSyntax`, the GraphQL
  Yoga context lifecycle, and the openapi-backend handler signature.
- [x] (2026-05-24T14:32:00+01:00) Drafted this ExecPlan for review.
- [x] (2026-06-01T00:00:00+02:00) Received explicit implementation
  instruction from the user and moved this ExecPlan to IN PROGRESS.
- [x] (2026-06-01T00:00:00+02:00) Confirmed the current branch is already
  `1-2-2-expose-actor-context-to-handlers`, not a default branch.
- [x] (2026-06-01T00:00:00+02:00) Confirmed the leta workspace already exists
  for this worktree.
- [ ] Rename branch to `1-2-2-expose-actor-context-to-handlers` and set
  upstream tracking.
- [x] (2026-06-01T00:00:00+02:00) Implemented milestone 1 (shared
  actor-context helper surface, Express request augmentation, request actor
  middleware, and focused helper/middleware tests).
- [x] (2026-06-01T00:00:00+02:00) Ran `coderabbit review --agent` for
  milestone 1 after disabling the global `diff.external=difft` setting with a
  temporary empty Git config. Fixed the valid active-plan spelling finding.
  Verified the two actor-context export findings were stale because
  `buildActorContext` and `SimulacatRequestActor` are exported and
  `bun check:types` passes. Skipped the remaining baseline findings as outside
  Stage B scope.
- [x] (2026-06-01T00:00:00+02:00) Implemented built-in REST and GraphQL
  rewiring: `extendRouter` installs request actor middleware before caller
  extensions, `/user` and `/user/memberships/orgs` call `requireUserActor`,
  and GraphQL `viewer` uses the same helper via Yoga context.
- [x] (2026-06-01T00:00:00+02:00) Ran `coderabbit review --agent` for the
  built-in REST/GraphQL rewiring. Addressed valid findings in changed actor,
  middleware, and GraphQL files by expanding JSDoc, clarifying observability
  key comments, and simplifying the GraphQL context fallback construction.
  Skipped branch-wide baseline documentation, CI, and test-maintenance
  findings outside the Stage C diff.
- [x] (2026-06-01T00:00:00+02:00) Implemented the extension agreement
  fixture under `tests/extension-handlers.test.ts`. The fixture overrides the
  existing `users/get-by-username` OpenAPI operation and registers
  `GET /labs/whoami` through `extend.extendRouter`, so the same seeded actor
  is selected through built-in REST, extension OpenAPI, extension router, and
  GraphQL surfaces.
- [x] (2026-06-01T00:00:00+02:00) Ran `coderabbit review --agent` for the
  extension fixture after the deterministic gates passed. Fixed the valid
  findings in changed route code by adding the Prometheus metrics charset and
  removing the redundant `/user` id parse roundtrip. Skipped the suggested
  GraphQL parse observation because it would violate the planned
  one-parse-observation-per-HTTP-request semantics; skipped the remaining
  branch-wide baseline refactors as outside this milestone.
- [ ] Implement milestone 4 (extension router route fixture, agreement test,
  documentation updates, roadmap completion).
- [ ] Run `bun fmt`, `bunx markdownlint-cli2 "**/*.md"`, `make check-fmt`,
  `make lint`, and `make test` sequentially with `tee` logs.
- [ ] Run final `coderabbit review --agent`; clear all findings.
- [ ] Push the renamed branch and update the draft PR.

## Surprises & Discoveries

- The 1.2.1 commit `b9093ce` already extracted REST parse helpers
  (`src/rest/index.ts:48-88`) and the GraphQL context function
  (`src/graphql/handler.ts:57-64`). The 1.2.2 slice can therefore consolidate
  rather than introduce new parsing — most of the work is *shrinking*
  inline duplication.
- `node_modules/@simulacrum/foundation-simulator/src/index.ts:367-383` calls
  `api.handleRequest(req as Request, req, res, next, routeMetadata)` with the
  same Express `req` decorated by upstream middleware, so any
  `extendRouter`-registered middleware that mutates `req` is visible inside
  every OpenAPI handler. Confirmed against the bundled foundation-simulator
  source.
- `node_modules/graphql-yoga/typings/server.d.ts:15,34,154` defines
  `createYoga<TServerContext, TUserContext>` such that `TServerContext` is
  merged into the user context. Today the simulator's `createYoga<{},
  GraphQLUserContext>` (`src/graphql/handler.ts:51`) leaves the Express
  request out of the static type even though `@whatwg-node/server` puts it
  there at runtime. This slice does not change that typing; the GraphQL
  context function will instead parse headers off the Fetch `Request.headers`
  through the shared helper.
- `tsconfig.json` already includes `src/**/*.ts`, so an additional
  `src/types/express-request.d.ts` will be picked up by the build without
  modifying `include` or `typeRoots`.
- `docs/developers-guide.md` does not exist. The actual developer-facing
  guide is `docs/development.md`. The 1.2.1 ExecPlan applied the same
  substitution; this plan follows that precedent.
- The implementation branch already contains planning commits on top of the
  1.2.1 baseline. `git log --oneline -5` now shows `4d0ea99` and `9961510`
  plan/documentation commits above `29afb26 Plan exposing actor context to REST
  and GraphQL handlers`; the old Stage A expectation that `b9093ce` would be
  the most recent commit is stale.
- Stage B typecheck originally exposed that `tee` pipelines can mask
  `tsc --noEmit` failures unless `set -o pipefail` is enabled. Subsequent
  gates use `set -o pipefail` before piping output into `/tmp` logs.
- CodeRabbit inherited the user-level Git config `diff.external=difft`, and
  `difft` panicked while CodeRabbit gathered a branch-wide diff for an older
  file. Running CodeRabbit with `GIT_CONFIG_GLOBAL` pointing at a temporary
  empty config allowed the review to proceed.
- Installing actor middleware before `/metrics` means the metrics request
  itself now records a `rest-parse` observation. The stable metrics snapshot
  changed from one to two anonymous default `rest-parse` observations after a
  test that requests `/user` and then `/metrics`. This matches the intended
  once-per-HTTP-request parse semantics.
- The extension agreement test does not need a custom OpenAPI schema entry.
  Overriding the existing `users/get-by-username` operation exercises the same
  caller-provided OpenAPI handler pathway while keeping request validation and
  path routing inside the bundled GitHub schema.
- CodeRabbit suggested adding a second `graphql` parse observation in the
  GraphQL context builder. That is intentionally not applied in this slice:
  the middleware now records exactly one parse observation for the inbound
  `/graphql` HTTP request, and a second parse event inside Yoga would undo the
  once-per-HTTP-request metric semantics accepted by this plan.

## Decision Log

- Decision: ship the hybrid design — Express middleware decorates
  `req.simulacatActor`; GraphQL Yoga `context({request})` and built-in REST
  handlers both call the same `buildActorContext(headers)` helper; extension
  authors read either `req.simulacatActor` or call
  `getActorContext(request)`/`requireUserActor(request, simulationStore)`.
  Rationale: the alternative options each fail one of the stated
  requirements. Pure helper-only (every handler calls `buildActorContext`)
  forces extension authors to opt in and multiplies parse observations per
  request. Pure AsyncLocalStorage hides coupling across the port boundary,
  is fragile across Yoga's `@whatwg-node/server` await boundaries, and
  makes fixture isolation harder. Decorating `req` only and skipping a
  shared helper would force GraphQL to depend on Express types and
  complicate `createYoga` server-context typing under
  `verbatimModuleSyntax: true`. The hybrid path keeps the Yoga server
  context as `{}` today, makes Express the single source of truth for
  request-scoped state, and offers a shared helper for both adapters.

- Decision: keep `simulacat_actor_observations_total{event="rest-parse"}`
  semantics one-per-HTTP-request after this slice.
  Rationale: today the counter conflates parse and handler invocation;
  with middleware-once parsing, the counter measures genuine inbound
  request shape. The change is additive in meaning (one HTTP request, one
  parse event) but it IS a semantic narrowing; the developer guide and API
  reference must call it out. `*-resolution`, `*-selected`, and
  `*-authentication` remain one-per-resolve-or-failure so handlers that
  opt in stay observable.

- Decision: do NOT introduce a GraphQL resolver extension hook in this
  slice.
  Rationale: `src/index.ts:25-34` exposes only `extend.extendStore`,
  `extend.openapiHandlers`, and `extend.extendRouter` today. Adding a
  GraphQL resolver extension hook is its own scope item, would push the
  task beyond the 18-file tolerance, and is not required by the roadmap
  acceptance criterion. Built-in GraphQL resolvers will gain actor context
  through the shared helper; GraphQL extension authors are deferred to a
  later roadmap item, documented in `docs/development.md`.

- Decision: use `docs/development.md` for developer guidance updates
  instead of creating `docs/developers-guide.md`.
  Rationale: the requested file is absent, and the repository already
  names `docs/development.md` as the developer guide. The 1.2.1 ExecPlan
  applied the same substitution.

- Decision: defer branch rename, upstream tracking, push, and draft PR
  creation until after plan approval, mirroring the 1.2.1 ExecPlan
  precedent.
  Rationale: the user explicitly stated that the plan must be approved
  before implementation. The plan itself may be pushed for review.

- Decision: use `users/get-by-username` as the extension OpenAPI fixture route
  instead of inventing a test-only OpenAPI path.
  Rationale: the operation already exists in the bundled GitHub schema, so it
  validates the caller override path through `extend.openapiHandlers` without
  adding schema maintenance or broadening the public API contract.

## External references and prior art

- Prior 1.2.1 ExecPlan with the same approval and observability
  conventions: `docs/execplans/1-2-1-request-scoped-actor-resolution.md`.
- In-repository design guidance:
  `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`.
  §4 "Model identity with actors" sets the actor-at-the-boundary pattern;
  §8 "Separate domain rules from protocol adapters" prescribes the thin-REST
  / thin-GraphQL adapter shape this plan adopts; §9 "Centralize mutations
  as actions" frames where actor-aware write paths should live as the
  roadmap moves past read-only surfaces.
- GraphQL Yoga context lifecycle documentation, including server-context
  merging behaviour when mounted as Node.js/Express middleware[^1].
- Stack Overflow confirmation that the Express `req` and `res` reach the
  Yoga server context at runtime when Yoga is exposed via
  `router.use('/graphql', createYoga(...))`[^2].
- TypeScript declaration-merging pattern for adding optional properties to
  the Express `Request` interface[^3].
- Node.js `AsyncLocalStorage` documentation — referenced as the rejected
  alternative for request-scoped context[^4].

These references are signposts. Simulacat Core remains explicit that this
slice provides simulator actor selection, not full GitHub authentication
or authorisation.

## Context and orientation

A novice reader picking up this plan should know the following before
making any change. Read
`docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
§4, §8, and §9 first; they describe the boundary-versus-domain split this
plan applies and the simulator-controlled actor contract this repository
already follows.

- The simulator entry point is `src/index.ts#simulation`. It calls
  `createFoundationSimulationServer` (from
  `@simulacrum/foundation-simulator`) with an `extendRouter` callback
  built in `src/extend-api.ts`. The callback runs caller-provided
  router extensions FIRST, then mounts the built-in routes — including
  GraphQL via `router.use('/graphql', createHandler(simulationStore))` at
  `src/extend-api.ts:57`.
- The foundation simulator's middleware order is, in calling sequence:
  cors → `express.json` → `express.urlencoded` → request-log middleware →
  the `extendRouter` callback (above) → the OpenAPI middleware that
  delegates to `openapi-backend`. See
  `node_modules/@simulacrum/foundation-simulator/src/index.ts:160-186`
  and `:367-383`.
- The OpenAPI middleware calls `api.handleRequest(req as Request, req,
  res, next, routeMetadata)`, so the Express `req` is the second
  positional argument passed to every operation handler — both built-in
  handlers in `src/rest/index.ts` and caller-provided handlers registered
  through `extend.openapiHandlers`.
- The request actor module lives at `src/store/actors.ts`. It exports
  pure parse, resolve, and observation helpers; this slice must not
  weaken its hexagonal role.
- The actor observability counters today are emitted by REST and
  GraphQL adapters at the point of parse, resolve, and selection. This
  slice moves the parse-observation emission into the middleware so
  every HTTP request records exactly one parse observation regardless of
  how many handlers run.
- The bundled GraphQL handler at `src/graphql/handler.ts` parses request
  actors inside Yoga's `context({request})` function. The Fetch
  `request.headers` provides the `HeaderReader` shape that
  `parseRequestActorWithDiagnostics` expects. After this slice, this
  call site uses the shared `buildActorContext(headers)` helper instead
  of duplicating the parse-then-record sequence.

Key files this plan will touch (see milestone breakdown for details):

- `src/store/actors.ts` — add `SimulacatRequestActor` (the
  middleware-attached aggregate) and `buildActorContext(headers)` /
  `resolveActorContext(simulationStore, context)` /
  `requireUserActor(request, simulationStore, surface)` /
  `getActorContext(request)` helpers; preserve every existing export.
- `src/types/express-request.d.ts` (new) — module-augment
  `express-serve-static-core#Request` with an optional `simulacatActor`
  property.
- `src/middleware/request-actor.ts` (new) — Express middleware factory
  `requestActorMiddleware()` that decorates `req.simulacatActor` and
  emits the once-per-request parse observation.
- `src/extend-api.ts` — install the middleware BEFORE the caller's
  `extend(router, simulationStore)` call so caller-provided routes and
  the GraphQL handler see the decorated `req`.
- `src/rest/index.ts` — replace the inline `parseActorRequest` and
  `selectUserForRequest` helpers with calls into the shared helpers.
  `users/get-authenticated` and `orgs/list-memberships-for-authenticated-user`
  both call `requireUserActor(...)`.
- `src/graphql/handler.ts` — replace the inline parse with
  `buildActorContext(request.headers)`. Carry the parse result on the
  Yoga user context as today.
- `src/graphql/resolvers.ts` — `Query.viewer` calls
  `requireUserActor(...)` against the resolver context instead of
  re-resolving manually.
- `tests/actors.test.ts` — extend with middleware-shape and
  helper-contract cases, including a `fast-check` test for any new
  parser rule (none planned today, so this may be empty additions).
- `tests/middleware-request-actor.test.ts` (new) — unit-level tests
  for the middleware (decoration, fall-through to anonymous, single
  parse observation per call, request-id propagation).
- `tests/extension-handlers.test.ts` (new) — integration test using a
  fixture simulator that registers an `extend.openapiHandlers` route and
  an `extend.extendRouter` Express route. Asserts both see the same
  resolved actor as built-in `/user` and GraphQL `viewer`.
- `tests/user.test.ts` and `tests/graphql.test.ts` — adjusted only where
  the new helpers replace local helpers; existing observable behaviour
  must not change.
- `docs/architecture.md`, `docs/development.md`, `docs/api-reference.md`,
  `docs/users-guide.md`, `docs/github-rest-api-audit.md`,
  `docs/github-graphql-api-audit.md`, `docs/roadmap.md`.

## Plan of work

The work is staged with explicit go/no-go points. Do not advance to the
next stage if the current stage's validation fails or if CodeRabbit
reports unresolved concerns.

### Stage A: understand and propose (no code changes)

Verify the orientation above against the live tree. Specifically:

- Run `git log --oneline -5` and confirm `b9093ce Resolve request actors
  (1.2.1)` is the most recent commit before this plan's commits.
- Read `src/store/actors.ts`, `src/rest/index.ts:48-88,367-407`,
  `src/graphql/handler.ts`, `src/graphql/resolvers.ts:35-100`, and
  `src/extend-api.ts:38-99` again to confirm the inline parse helpers
  are exactly as described above.
- Read `node_modules/@simulacrum/foundation-simulator/src/index.ts:160-188,367-383`
  to confirm middleware ordering. If the foundation-simulator version
  upgrades between plan approval and implementation, redo this read and
  record any change in `Surprises & Discoveries`.
- Confirm `tsconfig.json:5,21` still set `exactOptionalPropertyTypes:
  true` and `verbatimModuleSyntax: true`.

Stage A produces no commits.

### Stage B: scaffolding and tests (small, verifiable diffs)

Add the helper surface and the middleware in isolation, with failing
tests first.

- In `src/store/actors.ts`, append (without removing) the shared
  `SimulacatRequestActor` type and the
  `buildActorContext(headers)`, `resolveActorContext(simulationStore,
  context)`, `getActorContext(request)`, and
  `requireUserActor(request, simulationStore, surface)` helpers. Each
  helper has a `/**` docstring including an `@example`.
- Add `src/types/express-request.d.ts` declaring
  `simulacatActor?: SimulacatRequestActor` on
  `express-serve-static-core#Request`. The file is
  declaration-only — it must not have value exports under
  `verbatimModuleSyntax`. Verify with `bunx tsc --noEmit`.
- Add `src/middleware/request-actor.ts` with the
  `requestActorMiddleware()` factory. The factory returns an Express
  middleware that calls `buildActorContext`, attaches the result to
  `req.simulacatActor`, emits `observeParsedRequestActor('rest', ...)`
  once, and calls `next()`.
- Add `tests/middleware-request-actor.test.ts` with cases for: no
  header → anonymous attached; `x-simulacat-actor: user:dev` →
  user-actor attached; legacy headers → user-actor attached; malformed
  preferred header → anonymous fallback with `invalid-preferred-header`
  reason; same middleware instance handling sequential requests does
  not leak state. Each test asserts exactly one parse observation per
  request via `getActorObservabilityCounters`.
- Add `tests/actors-helpers.test.ts` with unit cases for
  `buildActorContext`, `resolveActorContext`, `requireUserActor`, and
  `getActorContext`, covering all four actor kinds and the
  unauthenticated path.

Stage B validation:

```bash
bun test tests/middleware-request-actor.test.ts 2>&1 \
  | tee /tmp/test-stageb-mw-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
bun test tests/actors-helpers.test.ts 2>&1 \
  | tee /tmp/test-stageb-helpers-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
bun check:types 2>&1 \
  | tee /tmp/typecheck-stageb-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
```

Expect all targeted tests to pass and typecheck to succeed. Commit the
stage with a message like `Add shared actor-context helpers and middleware`.
Run `coderabbit review --agent` and clear concerns before stage C.

### Stage C: rewire built-in REST and GraphQL handlers

- Update `src/extend-api.ts#extendRouter` so the *very first* statement
  inside the returned callback registers the actor middleware via
  `router.use(requestActorMiddleware())`. The caller-provided `extend`
  function runs AFTER the middleware. Document the rationale in a
  `// Why:` comment on the middleware registration line.
- Update `src/rest/index.ts` so `users/get-authenticated` and
  `orgs/list-memberships-for-authenticated-user` call
  `requireUserActor(request, simulationStore, '<surface>')` instead of
  the local `parseActorRequest`/`selectUserForRequest`/observation
  trio. Remove the inline helpers. Re-export nothing new from this
  module.
- Update `src/graphql/handler.ts` so the Yoga `context` function calls
  `buildActorContext(headersFromFetch(request))` once and carries the
  result on the user context. `requestId` continues to flow through
  the same code path. The previous inline parse-then-record sequence
  is removed.
- Update `src/graphql/resolvers.ts` so `Query.viewer` calls
  `requireUserActor` against the resolver context. Keep the
  `AuthenticationError` shape so the existing `graphql.test.ts`
  snapshots and assertions hold.
- Adjust `tests/user.test.ts`, `tests/graphql.test.ts`, and
  `tests/actors.test.ts` only where mechanically necessary (helper
  imports, observation-counter expectations). Existing observable
  behaviours — status codes, error messages, agreement assertions —
  must not change.

Stage C validation:

```bash
make check-fmt 2>&1 \
  | tee /tmp/check-fmt-stagec-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
make lint 2>&1 \
  | tee /tmp/lint-stagec-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
make test 2>&1 \
  | tee /tmp/test-stagec-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
```

Expect all gates green; expect the request-parse counter to settle to
exactly one observation per HTTP request. Commit the stage. Run
`coderabbit review --agent` and clear concerns before stage D.

### Stage D: extension fixture and agreement test

- Add `tests/extension-handlers.test.ts`. The test spins up a
  simulator with `extend.openapiHandlers` registering a single
  GitHub-shaped operation (for example a `whoami` operation under the
  bundled schema's `users/get-authenticated` slot is unsuitable since
  it is already wired; instead register a stable test-only operation by
  exposing the actor on a small adapter route inside `extend.extendRouter`,
  and assert agreement across all four surfaces). Alternative
  acceptable approach: register a custom OpenAPI handler that overrides
  a permissive operation and reads the actor through
  `getActorContext(request)`. Pick whichever path is verified to compile
  cleanly under the bundled `api.github.com.json` schema and OpenAPI
  validation; record the chosen approach in `Surprises & Discoveries`.
- Add `extend.extendRouter` test routes such as
  `GET /labs/whoami` that returns the resolved actor as JSON. The test
  fixture seeds two users (`dev`, `reviewer`) and asserts that for the
  same `x-simulacat-actor: user:reviewer` header the four surfaces
  agree: built-in `/user`, the extension OpenAPI handler, the
  extension Express route, and GraphQL `viewer`.
- Update `docs/architecture.md` "Request actor flow" and "Extension
  seams" sections to describe the middleware, the helpers, and the
  agreement contract. Cross-link
  `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  §4 and §8 from those sections so readers can trace the actor-at-the-boundary
  pattern. Update `docs/development.md` to describe the helper surface, the
  middleware ordering, the observation-counter change, and the deferred
  GraphQL extension story, with a "Further reading" pointer to the same
  guidance document. Update
  `docs/api-reference.md` capability matrix rows for `viewer`,
  `GET /user`, and `GET /user/memberships/orgs` if the descriptive
  language needs to mention the new helper-driven behaviour (the
  classifications themselves do not change). Update
  `docs/users-guide.md` only if the user-visible header contract or
  failure mode changes (it should not). Update
  `docs/github-rest-api-audit.md` and
  `docs/github-graphql-api-audit.md` extension-surface sections to
  reflect the new helper-driven extension contract.
- Mark `docs/roadmap.md` task `1.2.2` complete.
- Run all gates one final time, capture transcripts, run
  `coderabbit review --agent`, clear concerns, commit the
  documentation and roadmap update.

Stage D validation:

```bash
bun fmt
bunx markdownlint-cli2 "**/*.md" 2>&1 \
  | tee /tmp/markdownlint-staged-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
make check-fmt 2>&1 \
  | tee /tmp/check-fmt-staged-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
make lint 2>&1 \
  | tee /tmp/lint-staged-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
make test 2>&1 \
  | tee /tmp/test-staged-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
```

Expect all gates green. Push the renamed branch and update the draft PR.

## Concrete steps

This section lists the exact commands to run. Update it as work proceeds.

```bash
git branch --show-current
# Expected (before rename): feat/actor-context-plan

git branch -m 1-2-2-expose-actor-context-to-handlers
git push --set-upstream origin 1-2-2-expose-actor-context-to-handlers
# Expected: branch tracks origin/1-2-2-expose-actor-context-to-handlers

gh pr create --draft \
  --title "(1.2.2) Expose actor context to REST and GraphQL handlers" \
  --body-file /tmp/pr-body-1-2-2.md
# The draft PR body references this ExecPlan and the Lody session URL.

bun install
make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
make lint     2>&1 | tee /tmp/lint-simulacat-core-1-2-2-expose-actor-context-to-handlers.out
make test     2>&1 | tee /tmp/test-simulacat-core-1-2-2-expose-actor-context-to-handlers.out

bunx markdownlint-cli2 "**/*.md" 2>&1 \
  | tee /tmp/markdownlint-simulacat-core-1-2-2-expose-actor-context-to-handlers.out

coderabbit review --agent
```

## Validation and acceptance

Acceptance is behaviour-shaped, not implementation-shaped.

Expected evidence after implementation:

```plaintext
tests/middleware-request-actor.test.ts:
- middleware attaches simulacatActor for each actor kind
- middleware records exactly one parse observation per request
- middleware passes the request through when headers are absent
- middleware preserves x-request-id observation context

tests/actors-helpers.test.ts:
- buildActorContext returns the same actor as parseRequestActor for the same headers
- resolveActorContext resolves user actors against seeded users
- requireUserActor records a single authentication-failure observation per failure
- getActorContext returns undefined when the middleware has not run

tests/extension-handlers.test.ts:
- built-in /user, extension OpenAPI handler, extension router route, and
  GraphQL viewer all agree on the selected login for the same actor header
- changing the actor header changes the agreed login across all four surfaces
- omitting the actor header returns 401 from /user and the extension OpenAPI
  handler, and an AuthenticationError from viewer
```

Quality criteria (what "done" means):

- Tests: `make test` passes with the new tests counted in.
- Lint/typecheck: `make lint` and `bun check:types` succeed.
- Format: `make check-fmt` succeeds; `bunx markdownlint-cli2` succeeds.
- CodeRabbit: zero findings on the final pass.
- Documentation: `docs/architecture.md`, `docs/development.md`,
  `docs/api-reference.md`, `docs/users-guide.md`, both audit documents,
  and `docs/roadmap.md` reflect the shipped behaviour.
- Roadmap: `docs/roadmap.md` task `1.2.2` is checked off.

Quality method (how we check): run the commands in `Concrete steps`
sequentially with `tee` logs; review the logs; run
`coderabbit review --agent`; only then commit.

## Idempotence and recovery

- Each stage commit is small and bisectable.
- The middleware is additive at first; rewiring built-in handlers
  happens in stage C. If stage C breaks an existing test, `git revert`
  the stage C commit to restore the pre-rewire behaviour and re-attempt.
- The new helpers do not mutate global state outside the existing
  `actorObservationCounters` map (already covered by
  `resetActorObservationCounters`).
- The `src/types/express-request.d.ts` augmentation is reversible by
  deleting the file; no tsconfig changes are required.
- If `coderabbit review --agent` reports concerns, address them in the
  same stage before progressing.

## Artifacts and notes

Capture relevant evidence inline as work progresses. Examples to include:

- Output transcripts from `make test`, `make lint`, `make check-fmt`,
  `bun check:types`, and `bunx markdownlint-cli2`, trimmed to the
  summary lines.
- `coderabbit review --agent` summaries.
- A short snippet from `tests/extension-handlers.test.ts` showing the
  four-surface agreement assertion.

Stage B evidence captured on 2026-06-01:

- `bun test tests/middleware-request-actor.test.ts tests/actors-helpers.test.ts`
  passed: 12 tests, 31 assertions.
- `bun check:types` passed after `graphql-codegen` regenerated
  `src/__generated__/resolvers-types.ts`.
- `make check-fmt` passed: 71 files checked, no fixes applied.
- `make lint` passed: Biome and Oxlint reported no findings.
- `coderabbit review --agent` completed with 35 branch-wide findings. Stage B
  handled the one valid finding in this ExecPlan; the actor-context export
  findings were stale against the typechecked working tree, and the remaining
  findings targeted pre-existing files outside the Stage B diff.

Stage C built-in rewiring evidence captured on 2026-06-01:

- `bun test tests/user.test.ts` passed: 10 tests.
- `bun test tests/graphql.test.ts` passed: 32 tests.
- `bun check:types` passed after `graphql-codegen`.
- `make check-fmt` passed: 71 files checked, no fixes applied.
- `make lint` passed: Biome and Oxlint reported no findings.
- `make test` passed after updating the `/metrics` snapshot: 256 tests, 4
  snapshots, 5584 assertions.
- `coderabbit review --agent` completed with 23 branch-wide findings. Stage C
  addressed the valid findings in changed actor-context files; remaining
  findings targeted pre-existing documentation, CI, and test-maintenance work
  outside this milestone.
- After review-driven edits, `make lint`, `bun check:types`, and `make test`
  passed again; the final test run reported 256 tests, 4 snapshots, and 5584
  assertions.

Stage D extension fixture evidence captured on 2026-06-01:

- `bun test tests/extension-handlers.test.ts` passed: 3 tests, 6 assertions.
- `make check-fmt` passed: 72 files checked, no fixes applied.
- `make lint` passed after extracting test helpers out of the oversized
  `describe` callback flagged by Biome and Oxlint.
- `bun check:types` passed after `graphql-codegen`.
- `make test` passed: 259 tests, 4 snapshots, 5590 assertions.
- `coderabbit review --agent` completed with 16 branch-wide findings after one
  rate-limit backoff. The review produced two valid cleanups in touched route
  code, one intentionally rejected GraphQL metric suggestion, and baseline
  findings in older documentation, tests, utilities, package overrides, and the
  large pre-existing actor module.
- After review-driven edits, `bunx markdownlint-cli2
  docs/execplans/1-2-2-expose-actor-context-to-handlers.md`, `make check-fmt`,
  `make lint`, `bun check:types`, and `make test` passed again. The final test
  run still reported 259 tests, 4 snapshots, and 5590 assertions.

## Interfaces and dependencies

After this slice, the public actor surface in `src/store/actors.ts`
must include the existing exports plus:

```ts
/** Aggregated request-scoped actor context attached by middleware. */
export type SimulacatRequestActor = {
  actor: RequestActor;
  parseResult: RequestActorParseResult;
  observationContext?: ActorObservationContext;
};

/** Builds the request-scoped actor context from inbound headers. */
export const buildActorContext: (headers: HeaderReader) => SimulacatRequestActor;

/** Resolves a context against seeded users and installations. */
export const resolveActorContext: (
  simulationStore: ExtendedSimulationStore,
  context: SimulacatRequestActor
) => { resolvedActor: ResolvedRequestActor; user: GitHubUser | undefined };

/** Reads middleware-attached context from an Express request. */
export const getActorContext: (request: Request) => SimulacatRequestActor | undefined;

/**
 * Selects an authenticated user, emits observation, and throws a
 * GraphQL-compatible AuthenticationError when no user actor resolves.
 */
export const requireUserActor: (
  source:
    | {transport: 'rest'; request: Request; surface: string}
    | {transport: 'graphql'; context: GraphQLContext; surface: string},
  simulationStore: ExtendedSimulationStore
) =>
  | {user: GitHubUser; resolvedActor: ResolvedRequestActor}
  | {failure: 'unauthenticated'; resolvedActor: ResolvedRequestActor};
```

The middleware factory in `src/middleware/request-actor.ts`:

```ts
/**
 * Builds an Express middleware that decorates `req.simulacatActor` and
 * records one parse observation per request.
 */
export const requestActorMiddleware: () => import('express').RequestHandler;
```

The Express type augmentation in `src/types/express-request.d.ts`:

```ts
import type {SimulacatRequestActor} from '../store/actors.ts';

declare module 'express-serve-static-core' {
  interface Request {
    simulacatActor?: SimulacatRequestActor;
  }
}
```

No other public type or runtime export changes.

## Outcomes & Retrospective

To be filled in after implementation. Sections to populate at completion:

- Final helper surface, with code citations.
- Validation evidence (test counts, CodeRabbit pass).
- Branch, draft PR URL, and Lody session URL.
- Lessons learned, including any deviations from this plan.

[^1]: <https://the-guild.dev/graphql/yoga-server/docs/features/context>
[^2]: <https://stackoverflow.com/questions/74713444/how-can-i-pass-express-request-and-response-objects-into-graphql-yoga-context-us>
[^3]: <https://dev.to/kwabenberko/extend-express-s-request-object-with-typescript-declaration-merging-1nn5>
[^4]: <https://nodejs.org/api/async_context.html>

## Revision note

2026-05-26: rebased onto `origin/main` (over commits `3a7a780`, `af29673`,
`607399b`). No code conflicts; main's lockfile is unchanged on this branch.
Signposted the newly-added
`docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
from `Constraints`, `External references and prior art`,
`Context and orientation`, and Stage D documentation steps so the
boundary-versus-domain pattern this plan applies is anchored to the
in-repository guidance. No change to milestones, tolerances, or interface
shapes.
