# Derive REST URLs from the inbound request host and API root (1.4.1)

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: IN PROGRESS

Roadmap item: 1.4.1 (see `docs/roadmap.md` §1.4 "Make GitHub client payloads
contract-tested"). Requires 1.1.2 (first-class early entities), which is
complete.

## Purpose / big picture

Simulacat Core is an in-memory GitHub REST and GraphQL API *simulator* used as
a test double. Real GitHub clients — first and foremost the Python `github3.py`
library — do not only read scalar fields from a response; they **navigate**
using the URLs embedded in the payload. `github3.py` stores a fetched object's
`url` as its self-link and expands the RFC 6570 URI-template fields (for
example `labels_url` = `.../labels{/name}`, `contents_url` = `.../contents{+path}`)
client-side to reach sub-resources. If those URLs point at the wrong host, the
client is sent to the wrong place.

Today the simulator bakes absolute URLs into entities at **seed time**, inside
the Zod `.transform()` of each entity schema, using three different hardcoded
hosts: `localhost:3300` (repositories, organizations), and `https://api.github.com`
/ `https://github.com` (issues, pull requests, commits, refs, branches). A
simulator started on a random port therefore returns URLs that point at
`localhost:3300` (or at real GitHub), not at itself. A client that lists a
repository and then follows `commits_url` jumps straight off the simulator.

After this change, a simulator listening on any port returns repository, issue,
pull-request, organization, commit, ref, and branch URLs that point back at
that running instance, derived per-request from the inbound HTTP request host
and the configured API root. URLs a caller intentionally seeds in a fixture are
preserved. The intended behaviour is already documented in
`docs/architecture.md` §"GitHub client compatibility"; this plan makes the code
match the documented contract.

How to observe success: start a simulator with `app.listen(0)` (operating
system picks a free port), fetch `GET /repos/{owner}/{repo}`, and assert that
`url`, `html_url`, and every `*_url` template field contain the actual bound
port and host of that instance — not `localhost:3300` and not `api.github.com`.
Repeat for issues, pull requests, commits, refs, branches, and organization
membership, and through GraphQL.

## Constraints

Hard invariants. Violating one requires escalation, not a workaround.

1. Hexagonal boundary. URL derivation is a request-scoped *presentation*
   concern and must live in adapter/policy code, never in the domain store. The
   pure URL-policy helpers must accept a plain record (for example
   `{protocol, host, apiRoot}`) and must **not** import or accept a framework
   request type (Express `Request` or Fetch `Request`). Each adapter extracts
   the plain record itself. See the `hexagonal-architecture` skill: this is a
   boundary check, not a pattern transplant.
2. The store becomes host-agnostic. After this change, stored entities hold URL
   fields only when a caller explicitly seeded them (an override). All other
   URL fields are absent in the store and are produced at the adapter boundary.
   No code may read a derived URL directly off a stored entity.
3. Override preservation. A URL field a caller seeds in `initialState` (or via a
   fixture builder) must be returned unchanged. The rule is uniform across
   entities: a field present (not `undefined`) is an override and is emitted
   verbatim; a field that is `undefined` is derived; a field explicitly set to
   `null` (only for genuinely nullable fields such as `mirror_url` and
   `homepage`) is emitted as JSON `null`.
4. REST and GraphQL must agree. Both adapters derive URLs from the same shared
   policy helpers so the two surfaces cannot drift.
5. Non-API URLs must not be host-rewritten. `git_url`, `ssh_url`, `clone_url`,
   `svn_url`, `mirror_url`, and `avatar_url` are clone/CDN/web endpoints, not
   simulator API endpoints. They are never pointed at the request host.
6. Public exported types stay usable. `GitHubRepository`, `GitHubIssue`,
   `GitHubPullRequest`, `GitHubOrganization`, `GitHubCommit`, `GitHubRef`, and
   `GitHubBranch` remain exported from `src/index.ts`. URL fields on the stored
   shape become optional; every reader of a now-optional field must be routed
   through the projection helpers (audited, not left to read a hole).
7. Code-quality gates. Functions ≤ 70 lines, ≤ 4 parameters, cognitive
   complexity ≤ 8, nesting ≤ 3 levels, ≤ 1 logical operator per branch
   predicate; files ≤ 400 lines. All exported functions carry JSDoc with
   `@param`/`@returns`/`@throws`; every file starts with an `@file` block. Do
   not add new entries to `.jsdoc-baseline.json`. Prose and comments use
   en-GB-oxendict spelling.
8. Test-first. Every behavioural change follows Red-Green-Refactor with
   `bun test`. Existing host assertions are **strengthened**, never weakened
   (do not downgrade an exact `toBe('http://localhost:3300/...')` to a
   `toContain('/repos/...')` that drops host verification).

## Tolerances (exception triggers)

Stop and escalate when any of these is reached.

1. Scope. If delivering a milestone requires touching files beyond those named
   in "Plan of work" plus their tests, or the net diff for a single milestone
   exceeds roughly 600 lines, stop and escalate.
2. Public interface. If a public signature beyond the entity URL fields and the
   GraphQL dispatcher must change (for example `simulation()`'s argument shape),
   stop and escalate.
3. Dependencies. If a new runtime dependency seems necessary, stop and
   escalate. A new dev-only dependency for RFC 6570 template expansion in tests
   (for example `uri-templates`) is permitted but must be recorded in the
   Decision Log; prefer a tiny in-test expander if one suffices.
4. Iterations. If a milestone's tests still fail after 3 focused attempts, stop
   and escalate with the failing output.
5. GraphQL ripple. If making the dispatcher request-scoped forces changes at
   more than ~20 call sites or breaks the generated `Resolvers` typing in a way
   that cannot be contained by the existing `as unknown as Resolvers` cast, stop
   and escalate.
6. Ambiguity. If a field's correct host classification (API vs web vs external)
   is genuinely unclear for a field not enumerated in this plan, stop and ask.

## Risks

1. Risk: half-rewritten URL graph. If only some linked entities are made
   request-aware, a client navigates off the simulator mid-graph.
   Severity: high. Likelihood: high if scope were narrowed.
   Mitigation: full convergence — repository, issue, pull request,
   organization, commit, ref, and branch are all in scope (Decision D-1). A
   deny-list property test asserts no served `*_url` contains `localhost:3300`,
   `api.github.com`, or `github.com` except the explicitly external clone
   fields.
2. Risk: RFC 6570 templates mangled during the move from inline literals to a
   data table (a dropped `+`, `?`, or `{/...}` suffix silently breaks clients).
   Severity: high. Likelihood: medium.
   Mitigation: golden-snapshot the current template output byte-for-byte before
   refactoring (Milestone 0) and assert equality after; an expansion contract
   test expands each template and asserts a valid absolute URL.
3. Risk: GraphQL regression. Converters read `html_url`/`url` off the store; once
   the store stops baking them, GraphQL emits `undefined` unless a request-scoped
   base URL is threaded through the recursive, lazily-invoked dispatcher.
   Severity: high. Likelihood: high.
   Mitigation: request-bound dispatcher factory (`makeToGraphql`) built per
   request from `context.baseUrls`; lazy `issues()`/`pullRequests()` closures
   capture it lexically (Milestone 5).
4. Risk: malformed base URL. Missing/empty `Host`, IPv6 host (`[::1]:port`),
   port handling, or naive string joins producing `//` or `http://undefined`.
   Severity: medium. Likelihood: medium.
   Mitigation: a single tested `buildUrl`/`normalizeApiRoot`; `WHATWG URL`
   construction; a clear, greppable throw on missing host; fast-check host
   generator includes empty, IPv6, ported, and uppercase hosts (Milestone 1).
5. Risk: non-root API root untested. `apiRoot='/api/v3'` produces double slashes
   or drops the prefix because only `'/'` is exercised.
   Severity: medium. Likelihood: medium.
   Mitigation: parametrize integration tests over `apiRoot ∈ {'/', '/api/v3'}`.
6. Risk: success theatre. Tests assert the port propagated but `github3.py`
   still cannot navigate. Severity: medium. Likelihood: medium.
   Mitigation: the expansion contract test exercises real RFC 6570 expansion; a
   JS-side end-to-end navigation test follows `commits_url` → a served commit
   and asserts the second hop stays on the simulator. (A real `github3.py`
   round-trip is Python and belongs to roadmap task 1.4.2; note the boundary.)

## Progress

- [x] 2026-06-24T14:39:54+02:00 — Branch, PR, and session aligned for
  implementation. Local branch is `1-4-1-derive-rest-ur-ls`, tracking
  `origin/1-4-1-derive-rest-ur-ls`; PR #19 title is now
  "Derive REST URLs from request host (1.4.1)" and the PR references this Lody
  session.
- [x] 2026-06-24T14:42:26+02:00 — Milestone 0 golden snapshot test added.
  `tests/url-templates.golden.test.ts` captures current parsed URL fields for
  repository, issue, pull request, organization, commit, ref, and branch
  fixtures. Focused validation passed with
  `bun test tests/url-templates.golden.test.ts --update-snapshots` and then
  `bun test tests/url-templates.golden.test.ts` without snapshot update.
- [x] 2026-06-24T14:48:39+02:00 — Milestone 0 gates and review cleared.
  `make check-fmt`, `make test`, `make typecheck`, `make lint`, and
  `make --no-print-directory markdownlint nixie` passed. CodeRabbit
  `coderabbit review --agent` completed with `findings: 0`.
- [x] Milestone 0 — orientation, inventory, golden snapshots (no behaviour
  change).
- [x] 2026-06-24T14:51:39+02:00 — Milestone 1 red and green focused tests
  completed. Red: `bun test tests/request-url.test.ts` failed because
  `../src/http/request-url.ts` did not exist. Green:
  `bun test tests/request-url.test.ts` passed with 18 tests after adding
  `src/http/request-url.ts`. The focused suite covers API-root normalization,
  URL joining, request-host base derivation, fallback derivation, missing-host
  errors, IPv6, ports, uppercase hosts, and generated host/root combinations.
- [x] 2026-06-24T17:46:34+02:00 — Milestone 1 gates and review cleared after
  CodeRabbit review. Final focused validation
  `bun test tests/request-url.test.ts` passed with 29 tests. Full validation
  passed with `make check-fmt`, `make test`, `make typecheck`, `make lint`, and
  `make --no-print-directory markdownlint nixie`; the full suite reported
  291 passing tests, 5 snapshots, and 5824 assertions. CodeRabbit initially
  found malformed URL handling, seeded fast-check drift, canonical-host test
  drift, non-HTTP origins, raw JavaScript input guards, and protocol delimiter
  normalization. Each actionable finding is fixed and
  `coderabbit review --agent` now reports `findings: 0`.
- [x] Milestone 1 — shared request base-URL policy (`src/http/request-url.ts`).
- [x] 2026-06-24T17:49:44+02:00 — Milestone 2 started. The projector tests
  will use sparse copies of parsed fixtures, with URL fields deleted, so the
  request-host derivation is observable before Milestone 3 removes baked store
  URLs.
- [x] 2026-06-25T02:21:03+02:00 — Milestone 2 gates and review cleared.
  Per-entity projectors now cover repository, issue, pull request,
  organization, commit, ref, and branch payloads. Focused validation passed
  with `bun test tests/urls.test.ts`, reporting 8 tests and 24447 assertions.
  Full validation passed with `make check-fmt`, `make test`, `make typecheck`,
  `make lint`, and `make --no-print-directory markdownlint nixie`; the full
  suite reported 299 passing tests, 5 snapshots, and 30271 assertions.
  CodeRabbit findings for repository web and external URL derivation,
  non-derived homepage fields, branch protection encoding, organization avatar
  fallback, organization user-only URL omission, commit REST versus Git data
  endpoint selection, ref path preservation, typed URL classifications, SSH URL
  collection, and top-level payload aliases are fixed. Final
  `coderabbit review --agent` reports `findings: 0`.
- [x] Milestone 2 — per-entity URL projection policy (`src/urls/*`).
- [ ] Milestone 3 — make the store host-agnostic (Zod transforms stop baking
  URLs; override-only storage).
- [ ] Milestone 4 — wire the REST adapter to project per request.
- [ ] Milestone 5 — wire the GraphQL adapter to project per request.
- [ ] Milestone 6 — fix the `git_url` defect and remove dead suppressions.
- [ ] Milestone 7 — documentation, capability notes, CHANGELOG, roadmap tick.

## Surprises & discoveries

- Observation: the intended behaviour is already documented but unimplemented.
  Evidence: `docs/architecture.md` §"GitHub client compatibility" says response
  builders should "derive REST URLs from the inbound request host and
  configured API root … preserve explicitly seeded URL fields"; and
  `docs/api-reference.md` describes repository `url` as a "Derived simulator
  URL". `docs/github-rest-api-audit.md` §"Store and Modeling Constraints" still
  records the live constraint: "Generated repository, organization, and
  installation URLs assume `localhost:3300`." Impact: this plan aligns code with
  documented intent and updates the audit note.
- Observation: override preservation does not currently exist for repositories.
  Evidence: `src/store/entities/repository.ts:158-200` overwrites `url`,
  `html_url`, and all `*_url` fields **unconditionally** (no `??`), whereas
  issue/pull-request/commit/ref/organization use `field ?? default`. Impact:
  D1's override rule is net-new behaviour for repositories and must be tested
  explicitly, not treated as a pure refactor.
- Observation: a third host source exists, unmentioned by the roadmap.
  Evidence: `src/store/entities/organization.ts:10-11` reads a
  `SIMULACAT_GITHUB_API_URL` environment variable as a base-URL default, and
  `deriveOrganizationBaseUrl` (lines 13-26) reverse-parses an existing URL.
  Impact: the new helper subsumes both; the reverse-parser is removed (it is a
  malformation hazard for IPv6/ported hosts), and the env var is repurposed as
  an optional fallback default only (Decision D-7).
- Observation: `git_url` is malformed. Evidence:
  `src/store/entities/repository.ts:177` emits `git:github.com/${full_name}.git`
  (missing `//`); correct git protocol is `git://github.com/...`. Impact: fixed
  in Milestone 6 (Decision D-8).
- Observation: there is no label entity yet. Evidence: `src/store/entities/`
  contains no `label.ts`; `label` appears only as the repository `labels_url`
  template. Impact: "label URLs" in the success criterion means the repository
  `labels_url` template field only; first-class label entities arrive in
  roadmap task 1.5 (Decision D-9).
- Observation: `homepage` is not a navigation URL. Evidence:
  `repository.ts:201` defaults `homepage` to `http://${host}`. Impact: it is a
  fixture content field, not an API/web link; it is treated as web-derived only
  to preserve "points at the simulator", not folded into the API template table.
- Observation: Milestone 0 confirmed the request-root threading split. Evidence:
  `src/index.ts` passes `args.apiUrl ?? '/'` to `openapi(...)`; REST stores it
  as the OpenAPI `apiRoot`, but `src/rest/index.ts` still calls
  `handlers(initialState, openapiHandlers)` without passing `apiRoot` into the
  handler closure. GraphQL is mounted in `src/extend-api.ts` as
  `createHandler(simulationStore)`, and `src/graphql/handler.ts` currently has
  no `apiRoot` or base-URL parameter. Impact: Milestones 4 and 5 must thread
  `apiRoot` separately through REST handlers and GraphQL router composition.
- Observation: the installed `fast-check` version does not expose
  `fc.stringOf`. Evidence: the first Milestone 1 green attempt failed with
  `TypeError: fc.stringOf is not a function` from `tests/request-url.test.ts`.
  Impact: property tests that need generated strings should use
  `fc.array(fc.constantFrom(...)).map((parts) => parts.join(''))` or another
  available string arbitrary.
- Observation: CodeRabbit found several request-origin boundary cases after
  the first Milestone 1 green pass. Evidence: reviews flagged malformed
  `new URL(...)` constructor leakage, non-deterministic fast-check seeds,
  lower-case expected hosts that missed URL canonicalization, non-HTTP origins
  whose `.origin` is `null`, raw JavaScript callers passing non-string
  `protocol`/`host` fields, and raw protocol strings ending in `://`. Impact:
  `src/http/request-url.ts` now safe-parses URLs, accepts only HTTP(S) origins,
  guards raw inputs before string methods, canonicalizes `http://`/`https://`
  protocol delimiters before origin assembly, and fixes generated tests with a
  stable seed plus canonical host expectations.

## Decision log

- Decision D-1: full entity convergence — repository, issue, pull request,
  organization, commit, ref, and branch are all made request-aware in this
  task. Rationale: confirmed with the requester after the expert panel flagged a
  split-brain URL graph; the named roadmap entities (repo/issue/PR) link to
  commit/ref/branch in the same payload graph, so deferring those would ship a
  graph `github3.py` cannot navigate. Date/Author: 2026-06-18, leynos (scope
  confirmation) + planning agent.
- Decision D-2: per-entity projector design (data-driven template tables +
  pure `projectXUrls` functions) over a generic "absolutise the whole payload"
  walker. Rationale: a fidelity-focused test double benefits from explicit,
  greppable, per-entity URL shapes that are unit-testable in isolation; the
  generic walker trades that for DRY but spreads URL-key policy into a fragile
  key-matching pass. Adopt the walker's best idea — classify fields once,
  centrally — without adopting relative-URL storage. Date/Author: 2026-06-18,
  planning + expert panel (Wafflecat).
- Decision D-3: pure policy helpers take a plain `{protocol, host, apiRoot}`
  record, not a framework request. Rationale: Express exposes
  `request.headers.host`; Yoga exposes `request.headers.get('host')`; the policy
  layer must serve both without importing either (Constraint 1). Date/Author:
  2026-06-18, expert panel (Pandalump, Dinolump).
- Decision D-4: GraphQL uses a request-bound dispatcher factory, not a threaded
  parameter. Rationale: `toGraphql` is recursive and is captured by lazy
  connection closures that run after the resolver returns; a per-call parameter
  would not survive them, but a dispatcher closure carrying `baseUrls` is
  captured lexically. Date/Author: 2026-06-18, expert panel (Pandalump).
- Decision D-5: override detection by per-field `undefined`, with explicit
  `null` support for genuinely nullable fields. Rationale: simplest uniform rule
  that distinguishes "derive" from "caller-set" from "explicit null"; matches
  GitHub's nullable `mirror_url`/`homepage`. Date/Author: 2026-06-18, expert
  panel (Telefono).
- Decision D-6: no per-request URL caching. Rationale: ~35 string
  concatenations per repository payload are negligible against JSON
  serialisation and HTTP for short-lived random-port test servers; caching keyed
  on host adds invalidation risk for no observable benefit. Date/Author:
  2026-06-18, expert panel (Buzzy Bee).
- Decision D-7: base resolution layers request host first, then an optional
  configured fallback (`apiUrl` option / `SIMULACAT_GITHUB_API_URL`), then a
  hard throw if neither yields a host. Rationale: keeps per-request derivation
  primary while giving single-server callers a deterministic fallback and
  avoiding `http://undefined`. Date/Author: 2026-06-18, expert panel
  (Doggylump, Wafflecat).
- Decision D-8: fix malformed Git protocol URLs (`git:` → `git://`) in this
  task. Rationale: confirmed with the requester; trivial and clearly correct.
  Milestone 2 applies the corrected sparse projector values for `git_url` and
  `mirror_url`; the legacy baked store defaults and golden snapshot remain as
  evidence until the store is made host-agnostic and the deferred cleanup
  milestone removes or fixes the baked defaults. Date/Author: 2026-06-18,
  leynos; updated 2026-06-24, implementation agent.
- Decision D-9: "label URLs" scopes to the repository `labels_url` template;
  first-class label entities are out of scope (roadmap 1.5). Rationale: no label
  entity exists yet. Date/Author: 2026-06-18, expert panel (Pandalump).
- Decision D-10: Milestone 0 snapshots collect only URL-shaped fields from
  parsed fixtures. Rationale: generated timestamps, ids, and random display data
  are not part of the URL-template safety net and would make the snapshot noisy.
  The ref fixture uses `qualifiedName: 'main'` so the baseline covers the normal
  branch-ref path. Date/Author: 2026-06-24, implementation agent.
- Decision D-11: keep raw `RequestOrigin` guard checks in
  `src/http/request-url.ts` until the REST and GraphQL adapter wiring
  milestones introduce real adapter extractors. Rationale: CodeRabbit suggested
  moving all parsing to the adapter edge with Zod; that is the desired final
  boundary, but Milestone 1 deliberately provides a framework-neutral helper
  with no adapter call sites yet. Removing guards before the adapters exist
  would make JavaScript callers brittle without improving the boundary.
  Date/Author: 2026-06-24, implementation agent.
- Decision D-12: protocol inputs ending in `://` are accepted and normalized to
  the bare scheme before origin assembly. Rationale: adapters commonly expose
  `request.protocol` as `http`/`https`, but callers can pass `http://`; treating
  that as a malformed composed URL would incorrectly force fallback or failure
  even though the protocol intent is unambiguous. Date/Author: 2026-06-24,
  implementation agent.
- Decision D-13: sparse repository projection uses GitHub-correct web, clone,
  SVN, and Git-protocol URLs even while current parsed fixtures still preserve
  legacy explicit values. Rationale: CodeRabbit correctly flagged that
  repository `html_url` is a web URL (`/{owner}/{repo}`), while `clone_url` and
  `svn_url` should use GitHub HTTPS forms and `git_url` / `mirror_url` should
  use valid `git://` schemes. Milestone 2 now projects those corrected values
  only when fields are absent; current baked store values remain explicit
  overrides until later milestones remove or fix them. Date/Author: 2026-06-24,
  implementation agent.
- Decision D-14: `homepage` is not a derived URL field, branch names are
  encoded in `protection_url`, and missing organization avatars use a
  per-organization GitHub avatar URL (`avatars.githubusercontent.com/u/{id}`).
  Rationale: CodeRabbit found that inventing repository homepage metadata
  changes payload meaning, raw branch names break reserved-character path
  segments, and a shared octocat fallback collapses distinct organizations.
  Date/Author: 2026-06-24, implementation agent.
- Decision D-15: organization projection excludes user-only URL fields, and
  commit projection distinguishes REST commit resources from nested Git commit
  object URLs. Rationale: the current GitHub REST organization shape exposes
  org-scoped URLs (`repos_url`, `events_url`, `hooks_url`, `issues_url`,
  `members_url`, `public_members_url`) but not user-scoped follower/gist/star
  URL templates; commit payloads use `/commits/{sha}` for the top-level
  resource and top-level parents, while nested Git object references keep
  `/git/commits/{sha}`. Date/Author: 2026-06-24, implementation agent.
- Decision D-16: ref projection preserves the full `refs/...` name under
  `/git/refs/...`, issue and pull-request URL classifications are derived from
  typed field arrays, and the URL property collector treats scp-style SSH
  values (`git@github.com:owner/repo.git`) as URL-like external fields.
  Rationale: CodeRabbit found that stripping `refs/` breaks GitHub ref URL
  round-tripping, while raw classification literals and missed SSH URLs reduce
  test coverage. Date/Author: 2026-06-24, implementation agent.
- Decision D-17: every top-level projector payload alias omits the derived URL
  fields from the stored entity type before adding them back as optional
  projection fields. Rationale: the projection contract says sparse stored
  entities may omit derived URLs; intersecting with the original schema type
  accidentally kept those fields effectively required in TypeScript. Date/
  Author: 2026-06-24, implementation agent.

## External references and prior art

- `docs/architecture.md` §"GitHub client compatibility", §"State model",
  §"Extension seams", §"Repository label slice".
- `docs/api-reference.md` §"Exported fixture schemas" (repository/issue/PR
  schema tables), §"Capability matrix", §"REST endpoints".
- `docs/github-rest-api-audit.md` §"Store and Modeling Constraints" (the
  `localhost:3300` constraint this plan removes).
- `docs/development.md` §"Testing expectations" and the linting-rules section
  (thresholds in Constraint 7).
- `docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
  — prior art for the simulator's actor and store model.
- Prior ExecPlans for house style: `docs/execplans/1-2-2-expose-actor-context-to-handlers.md`,
  `docs/execplans/1-2-1-request-scoped-actor-resolution.md`.
- GitHub REST URL semantics: `url` is the API URL, `html_url` the web URL;
  `{...}` fields are RFC 6570 URI Templates expanded client-side
  (<https://docs.github.com/en/rest/repos/repos>).
- `github3.py` navigation: it stores the payload `url` as `_api` and expands
  `*_url` templates with the `uritemplate` library
  (<https://github.com/sigmavirus24/github3.py> — `src/github3/models.py`,
  `src/github3/repos/repo.py`).
- Express base-URL derivation and `trust proxy` caveats
  (<https://expressjs.com/en/guide/behind-proxies/>). WireMock's
  `request.baseUrl` response-template variable is the canonical
  "self-referential mock URL" precedent
  (<https://wiremock.org/docs/response-templating/>).
- fast-check under `bun:test`: import `fc`, wrap `fc.assert(fc.property(...))`
  in a `bun:test` `test`; use `fc.asyncProperty` + `await` for async
  (<https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/>).
- Skills to load while implementing: `hexagonal-architecture` (boundary check),
  `rust-router` does not apply (this is TypeScript); use repo TypeScript
  guidance in `AGENTS.md`; `execplans` (this document); `leta` for navigation.

## Context and orientation

The reader is assumed new to this repository. It is a TypeScript project run
with Bun. Key directories: `src/store/` (the in-memory domain store and entity
schemas), `src/rest/` (the OpenAPI-backed REST adapter), `src/graphql/` (the
GraphQL Yoga adapter and store-to-GraphQL converters), `tests/` (`bun:test`
suites), and `docs/` (the source-of-truth knowledge base).

How a request becomes a response today:

- Seeding. `simulation(args)` in `src/index.ts` calls
  `githubInitialStoreSchema.parse(args.initialState)`. Parsing runs each
  entity's Zod `.transform()`, which is where URLs are currently baked. The
  parsed state is loaded into the store via `extendStore`.
- REST. `openapi(initialState, apiRoot, apiSchema, handlers)` in
  `src/rest/index.ts` builds the handler table. `apiRoot` is
  `args.apiUrl ?? '/'`. Handlers read entities through selectors
  (`simulationStore.selectors.*`) and send them as JSON. Three helpers already
  derive host per request — `blobAsBase64`, `gitTrees`, `commitStatusResponse`
  in `src/rest/utils.ts` receive `host: ${request.protocol}://${request.headers.host}`.
  This is the pattern to generalise.
- GraphQL. `createHandler(simulationStore)` in `src/graphql/handler.ts` builds a
  Yoga server. Its `context({request})` parses the request actor into
  `GraphQLContext` (`src/graphql/resolvers.ts`). Resolvers call the module-level
  `toGraphql(simulationStore, __typename, entity)` dispatcher
  (`src/graphql/to-graphql.ts`), which delegates to per-entity converters in
  `src/graphql/converters/`. Converters read `entity.html_url`/`entity.url` and
  also call `toGraphql` recursively (and inside lazy connection closures such as
  `issues(pageArgs)`).

Where URLs are baked today (all to be made override-only in Milestone 3):

- `src/store/entities/repository.ts:146-204` — ~40 fields, host `localhost:3300`
  (unconditional overwrite; includes the external `git_url`/`ssh_url`/
  `clone_url`/`svn_url`/`mirror_url` and the content field `homepage`).
- `src/store/entities/issue.ts:70-83` — `url`, `html_url`, `repository_url`,
  host `api.github.com`/`github.com` (override-preserving).
- `src/store/entities/pull-request.ts:80-122` — `url`, `html_url`, `issue_url`.
- `src/store/entities/organization.ts:10-97` — env var + reverse-parsed base.
- `src/store/entities/commit.ts:70-97` — `url`, `html_url`, tree and parent URLs.
- `src/store/entities/ref.ts:69-91` — `url`, `object.url`.
- `src/store/entities/branch.ts:5-38` — `commit.url`, `protection_url`.

Where stored URLs are read (all to be routed through projection):

- REST: `repos/list-for-org`, `apps/list-repos-accessible-to-installation`,
  `apps/create-installation-access-token` (repositories via
  `allReposWithOrgs`); `issues/get`, `issues/list-for-repo`; `pulls/get`,
  `pulls/list`; `git/get-commit`; `git/get-ref`; `repos/list-branches`; and the
  `orgs/list-memberships-for-authenticated-user` handler, which reads
  `organization.url` to build `${organization.url}/memberships/...`
  (`src/rest/index.ts:337-342`) — a concrete regression if org URLs become
  override-only without projection here.
- GraphQL: `src/graphql/converters/repository.ts:127,213` (`repo.url`, topic
  URL `${repo.url}/topics/...`); `src/graphql/converters/early-entities.ts`
  (commit `html_url`; issue `html_url`; pull-request `html_url`);
  `src/graphql/owners.ts:71`.

Field host classification (the central policy, defined once in Milestone 2):

- API-host fields — derived from `apiBaseUrl` (= origin + normalised API root),
  carrying their RFC 6570 templates verbatim. Repository: `url`, `archive_url`,
  `assignees_url`, `blobs_url`, `branches_url`, `collaborators_url`,
  `comments_url`, `commits_url`, `compare_url`, `contents_url`,
  `contributors_url`, `deployments_url`, `downloads_url`, `events_url`,
  `forks_url`, `git_commits_url`, `git_refs_url`, `git_tags_url`,
  `issue_comment_url`, `issue_events_url`, `issues_url`, `keys_url`,
  `labels_url`, `languages_url`, `merges_url`, `milestones_url`,
  `notifications_url`, `pulls_url`, `releases_url`, `stargazers_url`,
  `statuses_url`, `subscribers_url`, `subscription_url`, `tags_url`,
  `teams_url`, `trees_url`, `hooks_url`. Issue: `url`, `repository_url`. Pull
  request: `url`, `issue_url`. Organization: `url`, `repos_url`,
  `events_url`, `hooks_url`, `issues_url`, `members_url`,
  `public_members_url`. Commit: top-level `url` and `parents[].url` use
  `/commits/{sha}`; nested tree URLs and `commit.parents[].url` use Git data
  endpoints. Ref: `url`, `object.url`. Branch: `commit.url`,
  `protection_url`.
- Web-host fields — derived from `webBaseUrl` (= origin, no API root). Each
  entity keeps its GitHub web path shape. Repository:
  `html_url` (`${webBaseUrl}/${full_name}`). `homepage` is repository metadata,
  not a navigation URL, so it is preserved only when explicitly stored. Issue:
  `html_url`
  (`${webBaseUrl}/${owner}/${repo}/issues/${number}`). Pull request: `html_url`
  (`${webBaseUrl}/${owner}/${repo}/pull/${number}`). Commit: `html_url`
  (`${webBaseUrl}/${owner}/${repo}/commit/${sha}`).
- External fixed fields — never host-rewritten (Constraint 5). `git_url`
  (`git://github.com/${full_name}.git`), `ssh_url`
  (`git@github.com:${full_name}.git`), `clone_url`
  (`https://github.com/${full_name}.git`), `svn_url`
  (`https://github.com/${full_name}`), `mirror_url`
  (`git://github.com/${full_name}`), `avatar_url`
  (`https://avatars.githubusercontent.com/u/${id}?v=4`). These keep fixed
  external hosts (github.com / avatars.githubusercontent.com) and are never
  rewritten to the simulator host.

## Plan of work

The work is staged so each milestone is independently verifiable and
committable, and so the risky store change (Milestone 3) lands only after the
projection policy it depends on is fully tested in isolation (Milestone 2).

### Milestone 0 — orientation, inventory, golden snapshots (no behaviour change)

Goal: lock the current URL output so the refactor cannot silently mangle a
template, and confirm the two `apiRoot`-threading paths.

- Add `tests/url-templates.golden.test.ts`: seed one repository, one issue, one
  pull request, one organization, one commit, one ref, and one branch through
  the existing schemas, and snapshot every URL field with `bun:test`'s `to
  MatchSnapshot`. This captures the current literals (including the `git_url`
  defect) byte-for-byte as the pre-refactor baseline.
- Confirm, by reading, where `createHandler` is invoked (expected:
  `src/extend-api.ts`) and how `apiRoot` reaches it; record the exact path in
  this section before changing it. The REST `apiRoot` is already a parameter of
  `openapi()` (`src/rest/index.ts:364`) but is not yet passed into the inner
  `handlers(...)` closure.
- Stage A go/no-go: snapshots written and committed; threading paths recorded.

Validation: `bun test tests/url-templates.golden.test.ts` passes and writes the
snapshot. No source behaviour changed.

### Milestone 1 — shared request base-URL policy

Create `src/http/request-url.ts` (new file, < 200 lines). Define:

```ts
// src/http/request-url.ts
export type RequestOrigin = {protocol: string; host: string};
export type BaseUrls = {apiBaseUrl: string; webBaseUrl: string};

/** Normalises an API root to '' or '/segment' form (no trailing slash). */
export const normalizeApiRoot = (apiRoot: string): string => { /* ... */ };

/** Joins a normalised base and a path with exactly one separating slash. */
export const buildUrl = (base: string, path: string): string => { /* ... */ };

/** Derives API and web base URLs; throws when no host can be determined. */
export const buildBaseUrls = (
  origin: RequestOrigin,
  apiRoot: string,
  fallbackBaseUrl?: string
): BaseUrls => { /* ... */ };
```

Behaviour:

- `normalizeApiRoot` is total: `'/'` and `''` → `''`; ensures a single leading
  slash; strips trailing slashes; collapses internal `//`; trims whitespace;
  `'api/v3'` → `'/api/v3'`.
- `buildBaseUrls`: `apiBaseUrl = ${protocol}://${host}${normalizeApiRoot(apiRoot)}`,
  `webBaseUrl = ${protocol}://${host}`. If `host` is empty/whitespace, fall back
  to `fallbackBaseUrl` (Decision D-7) and, failing that, throw
  `Error('SIMULACAT: cannot derive base URL; request Host header missing')`.
  Construct via the WHATWG `URL` where practical so IPv6 (`[::1]:port`) and
  ports survive.
- The adapter-specific extractors do not live here as framework-bound code;
  instead the REST handler builds `{protocol: request.protocol, host:
  request.headers.host ?? ''}` and the GraphQL context builds `{protocol, host:
  request.headers.get('host') ?? ''}` and both call `buildBaseUrls`.

Tests (`tests/request-url.test.ts`), Red first:

- Unit table for `normalizeApiRoot` (`'/'`, `''`, `'/api/v3'`, `'api/v3'`,
  `'/api/v3/'`, `'//api//v3//'`, `'  /x  '`).
- Unit for `buildUrl` (no double slash; base with/without trailing slash).
- Unit for `buildBaseUrls` over `apiRoot ∈ {'/', '/api/v3'}` and hosts
  `127.0.0.1:54321`, `[::1]:3300`, `Example.COM`, bare `localhost`.
- Property test (fast-check): for any non-empty host and any apiRoot, the
  resulting `apiBaseUrl` parses with `new URL`, has no `//` after the authority,
  and round-trips its host.
- Negative: empty/whitespace host throws the greppable error.

Validation: `bun test tests/request-url.test.ts` — red before, green after.

### Milestone 2 — per-entity URL projection policy

Create `src/urls/` (each file < 200 lines), importing `BaseUrls` from
`src/http/request-url.ts`. One module per entity plus a shared classifier:

```ts
// src/urls/repository.ts
export const projectRepositoryUrls = (
  repository: GitHubRepository,
  baseUrls: BaseUrls
): GitHubRepositoryPayload => { /* ... */ };
```

- Each module declares a data table mapping field → builder
  `(ctx) => string`, where the builder uses `apiBaseUrl`, `webBaseUrl`, or a
  fixed literal per the classification in "Context and orientation". The table
  is data, not branches (keeps cognitive complexity ~1).
- `projectXUrls` returns the full wire payload: for each field, emit
  `entity[field] !== undefined ? entity[field] : derived` (Decision D-5);
  `null` overrides for nullable fields pass through unchanged.
- The external clone/CDN fields are produced from the fixed table and are never
  passed `apiBaseUrl`/`webBaseUrl` (Constraint 5).
- Provide `src/urls/index.ts` re-exporting the projectors and the shared field
  classifier so REST and GraphQL import from one place.

Tests (`tests/urls.test.ts`), Red first — tested against the *current* literals
so the projectors are proven correct before the store changes:

- For each entity, given a sparse stored entity and `baseUrls` built from a
  fixed origin, assert each projected field equals the expected absolute URL
  (exact `toBe`, host included).
- Override test: seed a custom `html_url` (and a `null` `mirror_url`); assert it
  is returned unchanged while siblings derive.
- Current fixture parity: projecting the parsed fixtures preserves explicit
  legacy URL values unchanged, while sparse fixtures derive the corrected
  GitHub web, clone, SVN, Git-protocol, and avatar values.
- Deny-list property test (fast-check over hosts/owners/repos/numbers): no
  API/web field of any projected entity contains `localhost:3300`,
  `api.github.com`, or `github.com`; external fields may.
- RFC 6570 expansion contract test: expand each templated field (with a minimal
  in-test expander or a dev-only `uri-templates` dependency — record in Decision
  Log if added) and assert the result is a syntactically valid absolute URL
  whose host is the request host.

Validation: `bun test tests/urls.test.ts` — red before, green after.

### Milestone 3 — make the store host-agnostic

Edit each entity schema so the `.transform()` keeps non-URL derivations
(`id`, `node_id`, `full_name`, `closed_at`, default `user`, etc.) but **stops
synthesising host URLs**. URL fields remain optional in the schema and are
stored only when the caller supplied them.

- `src/store/entities/repository.ts`: remove the `host` constant and the ~40
  URL assignments; keep id/node_id/full_name/topics defaults. Keep URL fields as
  optional passthrough. Widen `mirror_url` and `homepage` to
  `z.string().nullable().optional()`.
- `src/store/entities/{issue,pull-request,commit,ref,branch}.ts`: drop the
  `api.github.com`/`github.com` URL synthesis; keep override passthrough.
- `src/store/entities/organization.ts`: remove `SIMULACAT_GITHUB_API_URL`
  default and `deriveOrganizationBaseUrl`; keep override passthrough; widen
  nullable fields as needed. (The env var is reintroduced only as the optional
  `fallbackBaseUrl` wired in Milestones 4/5, per D-7.)
- Update `GitHubRepository`/etc. consumers that read URLs directly to instead go
  through projection (the GraphQL converters change in Milestone 5; any store
  selector that copies URL fields — for example `toRepoOwner` in
  `src/store/index.ts:125-151` — keeps copying whatever is stored, which is now
  override-only, and projection happens at the adapter).

Tests: update `tests/entities.test.ts` to assert the *stored* shape is now
host-agnostic (URL fields absent unless seeded; overrides preserved). These
assertions replace the old baked-host assertions (strengthening: they now prove
the store no longer carries a host). The golden snapshot from Milestone 0 is
updated to reflect the sparse store, or moved entirely to the
projector/integration level — record which in the Decision Log.

Validation: `bun test tests/entities.test.ts tests/urls.test.ts` green;
`make typecheck` passes with URL fields optional (fix any newly-surfaced
`string | undefined` readers by routing through projection).

### Milestone 4 — wire the REST adapter

- Thread `apiRoot` into the handler closure: change
  `handlers(initialState, extendedHandlers)` to
  `handlers(initialState, apiRoot, extendedHandlers)` and pass it from
  `openapi(...)` (`src/rest/index.ts`).
- Add a small per-request helper inside the closure that builds the base URLs
  from the request and the closure's `apiRoot`:

  ```ts
  const baseUrlsFor = (request) =>
    buildBaseUrls(
      {protocol: request.protocol, host: request.headers.host ?? ''},
      apiRoot,
      fallbackBaseUrl
    );
  ```

- Extend `makeListHandler`/`makeItemHandler` with an optional
  `project?: (item, baseUrls) => unknown`; when present, map the selector output
  through it using `baseUrlsFor(request)`.
- Apply projectors: repositories in `repos/list-for-org`,
  `apps/list-repos-accessible-to-installation`,
  `apps/create-installation-access-token`; issues in `issues/get` /
  `issues/list-for-repo`; pull requests in `pulls/get` / `pulls/list`; commit in
  `git/get-commit`; ref in `git/get-ref`; branches in `repos/list-branches`.
- Organization memberships: project the organization (via
  `projectOrganizationUrls`) before building `${org.url}/memberships/...`.
- Update `blobAsBase64`, `gitTrees`, and `commitStatusResponse`
  (`src/rest/utils.ts`) to accept `apiBaseUrl` (from `baseUrlsFor`) instead of a
  bare `host`, so their `*_url` fields are API-root-aware. Within
  `commitStatusResponse`, build the embedded repository sub-object's
  `trees_url`/`archive_url` from the same projector table.

Tests: rewrite `tests/rest-utils.test.ts` to pass an explicit injected
`apiBaseUrl` and assert full URLs equal `${injectedBase}/...` (exact, not
`toContain`). Add `tests/rest-request-urls.test.ts`: start the server with
`listen(0)`, parametrise over `apiRoot ∈ {'/', '/api/v3'}`, and for each of
repository, issue, pull request, commit, ref, branch, and org-membership assert
that `url`, `html_url`, and the templated `*_url` fields contain the actual
bound port and host. Add a navigation hop test: fetch a repository, expand its
`commits_url` to a concrete commit URL, fetch it, and assert the served commit's
`url`/`html_url` stay on the same instance.

Validation: red before (random-port URLs still say `localhost:3300`), green
after. `make test` passes.

### Milestone 5 — wire the GraphQL adapter

- Add `baseUrls` to `GraphQLContext` (`src/graphql/resolvers.ts`). Compute it in
  `createHandler`'s `context({request})` (`src/graphql/handler.ts`) via
  `buildBaseUrls({protocol, host: request.headers.get('host') ?? ''}, apiRoot, fallbackBaseUrl)`.
  Thread `apiRoot` into `createHandler` from its call site (recorded in
  Milestone 0).
- Replace the module-level `toGraphql`/`deriveOwner` usage in resolvers with a
  request-bound factory: add `makeToGraphql(simulationStore, baseUrls)` in
  `src/graphql/to-graphql.ts` returning a dispatcher closure that carries
  `baseUrls` and uses itself for recursion. Each `Query.*` resolver builds the
  dispatcher from `context.baseUrls` and uses it; the keep-compatible module
  `toGraphql` may remain as a thin wrapper for any non-request caller, or be
  removed if no such caller exists (confirm via `leta refs toGraphql`).
- Update the URL-emitting converters (`converters/repository.ts`,
  `converters/early-entities.ts`, `owners.ts`) to take `baseUrls` and compute
  `url`/`permalink`/`commitUrl`/topic URL from the shared projectors (or from
  `webBaseUrl`/`apiBaseUrl` + the `resourcePath` they already build). Lazy
  `issues()`/`pullRequests()`/`refs()` closures capture the bound dispatcher, so
  `baseUrls` reaches them lexically.

Tests: extend `tests/graphql.test.ts` to start on `listen(0)` and assert
repository/issue/pull-request/commit/ref GraphQL `url`/`permalink` fields point
at the bound instance; assert a nested connection (for example
`repository.pullRequests.nodes[].url`) is also request-aware (proves the
lazy-closure carrier works).

Validation: red before, green after. `make test` passes.

### Milestone 6 — fix the `git_url` defect and remove dead suppressions

- In the repository projector's external table, emit
  `git://github.com/${full_name}.git` (Decision D-8). Update the Milestone 2
  external-field assertion and the golden snapshot accordingly. Commit
  separately from the host-derivation work.
- Remove now-unnecessary `biome-ignore`/`oxlint-disable` suppressions that were
  attached to the old giant transform literals (the data-table projectors should
  satisfy the complexity/length gates without them). Do not remove suppressions
  that still apply.

Validation: `make lint` passes without the removed suppressions; `make test`
green.

### Milestone 7 — documentation, capability notes, CHANGELOG, roadmap tick

- `docs/architecture.md` §"GitHub client compatibility": note the behaviour is
  now implemented and point to `src/http/request-url.ts` and `src/urls/`.
- `docs/api-reference.md`: confirm the repository/issue/PR URL rows describe
  request-derived URLs and document the override and `apiRoot` behaviour.
- `docs/github-rest-api-audit.md` §"Store and Modeling Constraints": replace the
  "URLs assume `localhost:3300`" constraint with the new request-derived
  behaviour and the external-field exceptions.
- `docs/development.md`: document the URL-policy modules and the
  store-is-host-agnostic invariant for contributors; note the fast-check URL
  property tests.
- `docs/users-guide.md`: document that URLs reflect the request host/port and
  the configured API root, the optional `apiUrl`/`SIMULACAT_GITHUB_API_URL`
  fallback, and how to seed override URLs.
- `CHANGELOG.md`: add an entry (Common Changelog style).
- `docs/roadmap.md`: tick 1.4.1 to done on completion.
- Validate Markdown: `bunx markdownlint-cli2 "**/*.md"` and `bun fmt`; wrap
  prose at 80 columns.

## Concrete steps

Run from the repository root
`/home/leynos/.lody/repos/github---leynos---simulacat-core/worktrees/9cf131a4-bce1-4dda-99f6-d0abb89d6f38`.

Per the global command guidance, tee gate output to a log for review:

```bash
# Format check (non-mutating)
make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-$(git branch --show-current).out

# Types
make typecheck 2>&1 | tee /tmp/typecheck-simulacat-core-$(git branch --show-current).out

# Lint (biome + oxlint)
make lint 2>&1 | tee /tmp/lint-simulacat-core-$(git branch --show-current).out

# Tests
make test 2>&1 | tee /tmp/test-simulacat-core-$(git branch --show-current).out
```

Run a single suite while iterating, for example:

```bash
bun test tests/request-url.test.ts 2>&1 | tee /tmp/test-one-simulacat-core-$(git branch --show-current).out
```

After all deterministic gates pass for a milestone, request a CodeRabbit
review and clear every concern before the next milestone:

```bash
coderabbit review --agent 2>&1 | tee /tmp/coderabbit-simulacat-core-$(git branch --show-current).out
```

Commit after each green, gated milestone (see the commit-message skill; use a
file-based message, never `-m`).

## Validation and acceptance

Acceptance is behavioural and observable:

1. A simulator started with `app.listen(0)` returns, for
   `GET /repos/{owner}/{repo}`, `url`/`html_url`/`*_url` fields whose host and
   port equal the bound instance — not `localhost:3300`, not `api.github.com`.
   The same holds for issues, pull
   requests, commits, refs, branches, and organization membership, and through
   GraphQL.
2. With `apiUrl: '/api/v3'`, API-host URLs include exactly one `/api/v3`
   segment and no double slash; `html_url` (web) does not include the API root.
3. A fixture that seeds a custom `html_url` returns it unchanged while sibling
   URLs derive; a fixture setting `mirror_url: null` returns JSON `null`.
4. A navigation hop (fetch repository → expand `commits_url` → fetch that commit)
   stays on the same instance at every hop.
5. The deny-list property test finds no `localhost:3300`/`api.github.com`/
   `github.com` in any API/web field across generated inputs.

Red-Green-Refactor evidence to record per milestone:

- Red: the new test fails for the expected reason (for example
  "received `http://localhost:3300/...`, expected `http://127.0.0.1:<port>/...`").
- Green: minimal projector/wiring change makes it pass.
- Refactor: tidy, rerun the focused suite and the four gates.

Quality criteria ("done"):

- Tests: `make test` passes; new suites `tests/request-url.test.ts`,
  `tests/urls.test.ts`, `tests/rest-request-urls.test.ts`, and the GraphQL and
  golden suites pass; no host assertion was weakened.
- Lint/typecheck: `make check-fmt`, `make typecheck`, `make lint` all pass.
- CodeRabbit: `coderabbit review --agent` reports no outstanding concerns after
  each major milestone.
- Docs: Markdown lint passes; affected docs updated; roadmap 1.4.1 ticked.

## Idempotence and recovery

- Each milestone is a separate commit; revert a milestone with `git revert`
  without disturbing earlier ones.
- The golden snapshot (Milestone 0) is the safety net against template drift; if
  a later milestone changes a snapshot unexpectedly, treat it as a regression
  until explained.
- No data migrations or destructive operations are involved; the store is
  in-memory and rebuilt per process.

## Interfaces and dependencies

At completion these must exist:

```ts
// src/http/request-url.ts
export type RequestOrigin = {protocol: string; host: string};
export type BaseUrls = {apiBaseUrl: string; webBaseUrl: string};
export const normalizeApiRoot: (apiRoot: string) => string;
export const buildUrl: (base: string, path: string) => string;
export const buildBaseUrls: (origin: RequestOrigin, apiRoot: string, fallbackBaseUrl?: string) => BaseUrls;

// src/urls/index.ts (re-exports per-entity projectors)
export const projectRepositoryUrls: (repository: GitHubRepository, baseUrls: BaseUrls) => GitHubRepositoryPayload;
export const projectIssueUrls: (issue: GitHubIssue, baseUrls: BaseUrls) => GitHubIssuePayload;
export const projectPullRequestUrls: (pr: GitHubPullRequest, baseUrls: BaseUrls) => GitHubPullRequestPayload;
export const projectOrganizationUrls: (org: GitHubOrganization, baseUrls: BaseUrls) => GitHubOrganizationPayload;
export const projectCommitUrls: (commit: GitHubCommit, baseUrls: BaseUrls) => GitHubCommitPayload;
export const projectRefUrls: (ref: GitHubRef, baseUrls: BaseUrls) => GitHubRefPayload;
export const projectBranchUrls: (branch: GitHubBranch, baseUrls: BaseUrls) => GitHubBranchPayload;

// src/graphql/to-graphql.ts
export const makeToGraphql: (simulationStore: ExtendedSimulationStore, baseUrls: BaseUrls) => ToGraphqlDispatcher;
```

No new runtime dependencies. A dev-only RFC 6570 expander may be added for the
expansion contract test (record in Decision Log if used). `bun:test` and
`fast-check` (already present) are the test tools; use `fc.asyncProperty` +
`await` for any async property.

## Outcomes & retrospective

To be completed at major milestones and at the end. Compare the delivered
behaviour against the five acceptance criteria, record the final `make test`
counts, note any tolerance breaches, and capture lessons for the follow-on
tasks 1.4.2 (`github3.py` contract tests) and 1.5 (mutable repository labels),
which both reuse the URL-policy helpers introduced here.
