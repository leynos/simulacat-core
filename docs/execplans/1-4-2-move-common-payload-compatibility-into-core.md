# Move common github3.py payload compatibility into core (1.4.2)

This ExecPlan (execution plan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT (awaiting design review and user approval)

Branch: `1-4-2-move-common-payload-compatibility-into-core`

Roadmap item: `1.4.2` in `docs/roadmap.md` (§1.4 "Make GitHub client payloads
contract-tested"). It requires `1.4.1`, which is complete.

Implementation must not begin until the user explicitly approves this plan.

## Purpose / big picture

Simulacat Core is an in-memory GitHub REST and GraphQL API simulator used as a
test double. Its most important downstream consumer, the Python pytest plugin
simulacat, hands tests a real `github3.py` client (`github3.GitHub`) pointed at
the simulator. `github3.py` does not tolerate thin payloads: when it turns a
JSON response into a Python object it indexes dozens of keys directly
(`json["network_count"]`, `json["assignee"]`, `json["merge_commit_sha"]`) and
raises `github3.exceptions.IncompleteResponse` when any of them is missing. To
make its tests pass today, simulacat wraps four core routes with route-local
"payload patches" in `src/github-sim-server.ts` that clone OpenAPI example
payloads and rewrite them.

A planning-time probe against base revision `c2e5ddc` showed what a
`github3.py` user sees today. With a seeded organization `frontside`, user
`octo`, repository `frontside/test-repo`, issue 1, and pull request 2, both
`github3.py` 3.2.0 and 4.0.1 behave identically:

```plaintext
gh.repository("frontside", "test-repo")         -> IncompleteResponse KeyError('network_count')
gh.repositories_by("frontside")                 -> ['octocat/Hello-World']   (OpenAPI example, not state)
gh.repositories()  (GET /user/repos)            -> ['octocat/Hello-World']   (OpenAPI example, not state)
gh.organization("frontside").repositories()     -> 401 "Bad credentials" from the real api.github.com
gh.issue("frontside", "test-repo", 1)           -> IncompleteResponse KeyError('assignee')
gh.pull_request("frontside", "test-repo", 2)    -> IncompleteResponse KeyError('active_lock_reason')
repo.issues() / repo.pull_requests()            -> fail at the repository lookup first
```

The organization case is worse than a failure: `GET /orgs/{org}` is still an
OpenAPI example whose `url` is `https://api.github.com/orgs/github`, so
`github3.py` silently leaves the simulator and calls real GitHub.

After this change, the same client calls succeed against an unpatched core for
both `github3.py` 3.x and 4.x, return objects built from seeded state, and stay
on the simulator for every follow-up request. In concrete terms, a user can:

```python
gh = github3.GitHub(token="local")
gh.session.base_url = simulator_base_url            # root-mounted, no /api/v3
gh.session.headers["x-simulacat-actor"] = "user:octo"

repo = gh.repository("frontside", "test-repo")      # github3.repos.Repository
[r.full_name for r in gh.repositories_by("octo")]   # seeded repositories owned by octo
[r.full_name for r in gh.organization("frontside").repositories()]
[r.full_name for r in gh.repositories()]            # actor-scoped /user/repos
issue = repo.issue(1)                               # body, body_text, body_html present
pull = repo.pull_request(2)                         # head/base carry nested repositories
```

The work is proven by a new contract-test suite that drives the real
`github3.py` 3.2.0 and 4.0.1 libraries from `bun test`, plus property and table
tests over the new REST representation functions. Success for the roadmap item
is that simulacat no longer needs route-local payload patches for the supported
repository, issue, and pull request read workflows; core can only demonstrate
this from its own side (see `Decision log` D9).

Terms used throughout:

- *Payload patch*: downstream code that rewrites a core response before the
  client sees it.
- *Representation*: the GitHub-shaped JSON object returned for one resource
  (for example GitHub's `full-repository` or `pull-request-simple` schema).
- *Projector* or *representation function*: a pure function that maps stored
  entities plus request context to a representation.
- *Unmodelled field*: a field `github3.py` requires but which describes state
  the simulator does not model yet (labels, assignees, milestones, review
  counts). Core emits a documented neutral value for it.
- *Contract test*: a test that runs the real third-party client library
  against the simulator and asserts what the client observes.

Preserved behaviour: URL derivation from 1.4.1 (request host plus API root,
explicit seeded overrides win), the 404 behaviour of existing item routes, the
`PATCH /repos/{owner}/{repo}` write path, GraphQL output, and actor resolution.
Deliberately changed behaviour is listed in `Decision log` D10.

## Constraints

1. Approval gate: no implementation before the user approves this plan.
2. Pre-1.0 package (`simulacat-core` 0.6.x). No compatibility shims, aliases,
   or dual REST shapes are introduced for the old payloads; callers and tests
   change together. The breaking payload changes are documented instead.
3. Public TypeScript API: `src/index.ts` exports do not change. The new
   representation module is internal to the REST adapter. Exported entity
   schemas (`githubIssueSchema`, `githubPullRequestSchema`,
   `githubRepositorySchema`, and friends) keep their input shape; this plan
   does not add stored fields to them.
4. Hexagonal boundary (protect, do not transplant): stored entities and
   selectors in `src/store/` remain the domain and query side; REST
   representation functions in `src/rest/representations/` are pure, take
   already-resolved records plus a request context, and must not import
   `express`, `openapi-backend`, `@simulacrum/foundation-simulator`, Node
   built-ins, or any store action or reducer. Route handlers in `src/rest/`
   remain the only code that touches the request, the store, and the response.
5. URL policy from 1.4.1 is reused, not reimplemented: every URL in a new
   representation comes from `src/urls/` projectors or `buildUrl` with the
   request `BaseUrls` from `src/http/request-url.ts`. Non-API URLs (`git_url`,
   `ssh_url`, `clone_url`, `svn_url`, `mirror_url`, `avatar_url`) keep their
   1.4.1 classification.
6. No served URL may point at `api.github.com` or `localhost:3300` unless a
   fixture seeded it explicitly.
7. Code-quality gates from `docs/developers-guide.md` §Linting rules: functions
   at most 70 lines, at most 4 parameters, cognitive complexity at most 8,
   nesting at most 3, at most one logical operator per predicate; files at most
   400 lines (`AGENTS.md`); every file starts with an `@file` block; exported
   functions carry JSDoc with examples; no new `.jsdoc-baseline.json` entries;
   en-GB-oxendict spelling in prose and comments.
8. Test-first. Every behavioural change follows Red-Green-Refactor with
   `bun test`. Red is enforced with `test.failing` (Bun's strict expected
   failure, which fails if the test unexpectedly passes); every `.failing`
   marker is removed in the green step and none remain at completion.
9. Existing assertions are strengthened, never weakened.
10. The Python toolchain is test-only. Nothing Python ships in the npm package
    (`package.json` `files` is unchanged) and no runtime dependency is added.
11. Contract tests must not reach the public internet once dependencies are
    synced: the Python driver runs with an egress guard (see `Verification
    plan` INV-no-egress).
12. Historical ExecPlans in `docs/execplans/` other than this file are not
    edited.
13. The simulacat repository is not modified by this plan. Any downstream
    issue or PR in simulacat requires separate user authorization.

If satisfying the objective requires violating a constraint, stop, record the
conflict in `Decision log`, set the status to `BLOCKED`, and escalate.

## Tolerances (exception triggers)

Comparison base: `c2e5ddc` (`git merge-base HEAD origin/main` at planning
time). Every count below excludes ExecPlan files, including this one, and the
generated files `tests/contracts/github3/uv.lock`, `typos.toml`, and
`src/__generated__/**`.

Classification, by whole file unless stated:

- Code: `src/**`, `tests/**` except `tests/contracts/github3/pyproject.toml`
  and `tests/contracts/github3/.python-version`, `features/**`, and the recipe
  hunks of `Makefile`.
- Configuration: `.oxlintrc.json`, `biome.json`, `package.json`,
  `.gitignore`, `.github/**`, `typos.local.toml`,
  `tests/contracts/github3/pyproject.toml`,
  `tests/contracts/github3/.python-version`, and non-recipe hunks of `Makefile`
  (variables and `.PHONY`).
- Documentation: `docs/**` except `docs/execplans/**`, `CHANGELOG.md`, and
  `README.md`.

Counting command (net lines = additions minus deletions):

```bash
git diff --numstat c2e5ddc -- . \
  ':!docs/execplans/**' ':!tests/contracts/github3/uv.lock' ':!typos.toml' \
  ':!src/__generated__/**' \
  | awk '{print $1-$2, $3}'
```

Budgets, enforced independently (spare capacity in one category never offsets
another):

- Files: more than 45 non-ExecPlan files changed or added → stop and escalate.
- Code: more than 2,600 net lines → stop and escalate. Within that, production
  code under `src/` above 1,150 net lines → stop and escalate. No single
  milestone may add more than 750 net code lines.
- Configuration: more than 120 net lines → stop and escalate.
- Documentation: more than 500 net lines → stop and escalate.
- Interface: any change to `src/index.ts` exports, to the `simulation()`
  argument shape, or to an exported entity schema's input → stop and escalate.
- Dependencies: any npm dependency change, or any Python dependency other than
  `github3.py==3.2.0`, `github3.py==4.0.1` (each with its transitive closure in
  `uv.lock`) and the `uv tool run` invocation of `ruff==0.17.5` → stop and
  escalate.
- Architecture: if a representation needs to read the store, the request, or
  the response directly, or a stored entity schema must gain fields → stop and
  escalate.
- Scope: if a supported `github3.py` workflow needs a route not named in
  `Plan of work` (for example `GET /users/{username}`) → stop and escalate.
- Iterations: if a milestone's focused tests still fail after 3 focused fix
  attempts → stop and escalate with the failing output.
- Time: if a milestone takes more than 4 hours of active work, excluding
  queueing for compile slots or CI → stop and escalate.
- Ambiguity: if `github3.py` 3.x and 4.x disagree about a field in a way the
  reconnaissance below did not predict → stop and present options.

Budget rationale is in `Context and orientation` §Budget survey.

## Risks

- Risk: the first `uv sync` of the contract environments needs network access
  to PyPI, so an offline developer machine cannot run `make test`. Severity:
  medium. Likelihood: medium. Mitigation: the harness fails fast with a message
  naming the command that populates the cache; once synced, runs are offline
  (`--frozen`, cached wheels). CI already installs `uv`
  (`.github/workflows/ci.yml`, `astral-sh/setup-uv`). Silent skipping is
  rejected (see D4) because it would make the contract vacuous.
- Risk: the probe logged `Error: "nullable" cannot be used without "type"`
  from `ajv` in the server output and one run saw `ConnectionResetError` on
  `GET /repos/{owner}/{repo}/pulls/{n}`; a re-run did not reproduce it.
  Severity: medium. Likelihood: medium. Mitigation: `EP-M0` reproduces it under
  the harness, identifies whether OpenAPI response validation or mock
  generation triggers it, and records the finding in `Surprises & discoveries`
  before any representation work.
- Risk: OpenAPI response validation (`postResponseHandler` in
  `@simulacrum/foundation-simulator`) may reject the richer payloads with HTTP
  502 if handlers stop bypassing it. Severity: medium. Likelihood: low
  (reconnaissance infers `response.json(...)` bypasses it). Mitigation: the
  contract suite would expose a 502 immediately; `EP-M0` confirms the bypass.
- Risk: `@aboviq/bun-test-cucumber` 0.2.0 has no `Scenario Outline` support.
  Severity: low. Likelihood: certain. Mitigation: each scenario exercises both
  client lines in its steps ("github3.py 3.x and 4.x each …").
- Risk: oxlint may not support a path-scoped `no-restricted-imports`
  override. Severity: low. Likelihood: medium. Mitigation: fall back to a small
  `bun test` fitness function that parses import specifiers in
  `src/rest/representations/**` (record in `Decision log`).
- Risk: Breaking payload changes (D10) surprise consumers who read the leaked
  internal `owner`, `repo`, or `issue_number` keys from REST issue and pull
  request payloads. Severity: low. Likelihood: low. Mitigation: users-guide
  "Breaking changes" entry and CHANGELOG entry; GraphQL is unaffected because
  it reads store entities, not REST payloads (verified by the existing GraphQL
  suite staying green).
- Risk: representation functions with 40-plus fields collide with the 70-line
  function limit and complexity limit. Severity: low. Likelihood: high.
  Mitigation: compose each representation from small field-group helpers (URL
  group, lifecycle group, unmodelled defaults) as designed in
  `Interfaces and dependencies`.
- Risk: `src/rest/index.ts` is already 403 lines, above the 400-line limit.
  Severity: low. Likelihood: certain. Mitigation: `EP-M3` and `EP-M4` move the
  issue and pull request handlers into their own files, which brings the file
  well under the limit.
- Risk: the contract suite lengthens `make test`. Severity: low. Likelihood:
  high. Mitigation: one Python process per client line per test file runs all
  scenarios in a batch; expected overhead is under 15 seconds once synced.
- Risk: synthetic account IDs for unseeded logins collide with seeded IDs.
  Severity: low. Likelihood: low. Mitigation: a dedicated ID band in
  `src/store/entity-id-offsets.ts` documented alongside the existing bands.

## Progress

- [x] (2026-11-15 21:10Z) Branch renamed; Lody session titled.
- [x] (2026-11-15 21:40Z) Wyvern reconnaissance: simulacat patch inventory,
  `github3.py` 3.2.0/4.0.1 field requirements, core REST builders, tooling and
  plan history.
- [x] (2026-11-15 22:00Z) Planning probe: real `github3.py` 3.2.0 and 4.0.1
  against the simulator at `c2e5ddc` (transcript in `Artefacts and notes`).
- [x] (2026-11-15 22:30Z) Initial draft written.
- [ ] Community-of-experts design review applied.
- [ ] Plan approved by the user.
- [ ] `EP-M0` Contract harness and red baseline.
- [ ] `EP-M1` Account and repository representations; repository lookup.
- [ ] `EP-M2` Repository listings and organization lookup.
- [ ] `EP-M3` Body media types and issue representation.
- [ ] `EP-M4` Pull request representation.
- [ ] `EP-M5` Behavioural feature, documentation, and delivery closure.

## Surprises & discoveries

- Observation: `GET /orgs/{org}`, `GET /users/{username}/repos`, and
  `GET /user/repos` have no core handler and serve OpenAPI examples. Evidence:
  probe output (`/users/frontside/repos` returns `octocat/Hello-World`);
  `src/rest/index.ts` registers no handler for `orgs/get`,
  `repos/list-for-user`, or `repos/list-for-authenticated-user`. Impact:
  repository listing is not state-backed today; `EP-M2` adds handlers.
- Observation: `github3.py` builds `Organization.repositories()` from the
  organization's `url` field (`self._api`), not from `repos_url` (`orgs.py:779`
  in 4.0.1), so the stubbed organization payload sends the client to real
  GitHub. Evidence: probe returned `401 Bad credentials` and, anonymously,
  `403 API rate limit exceeded for <public IP>`. Impact: motivates
  INV-no-egress and the `orgs/get` handler (D3).
- Observation: issue and pull request REST payloads are raw store entities.
  They leak internal `owner`, `repo`, and `issue_number` keys and carry
  `user: {login}` only. Evidence: probe `RAW` key lists. Impact: D10.
- Observation: `github3.py` 3.2.0 and 4.0.1 read identical field sets for
  every class in scope. Evidence: Wyvern diff of `repos/repo.py`,
  `issues/issue.py`, `pulls.py`, `users.py`, `orgs.py`; only line numbers move.
  Impact: one required-field manifest serves both lines; the two-line matrix
  still runs because behaviour (not just field reads) could diverge.
- Observation: both `github3.py` lines import and run under CPython 3.14.7.
  Evidence: probe. Impact: one interpreter pin serves both environments.

## Decision log

- D1. Decision: put REST representations in a new internal module
  `src/rest/representations/`, as pure functions over resolved records, and
  keep handlers as thin adapters. Rationale: the store is the domain and query
  side; the REST JSON shape is an adapter concern. Pure functions are table-
  and property-testable without a server and give GraphQL no reason to change.
  The rejected alternative — adding `github3.py`-only fields to stored entity
  schemas — would leak a transport contract into the domain and change exported
  schemas (Constraint 3). Owner and account shaping currently in
  `src/rest/repository-handlers.ts` moves into the module rather than being
  duplicated. Date/Author: 2026-11-15, planning agent.
- D2. Decision: one representation per GitHub schema family, chosen per
  route: `full-repository` for `GET /repos/{owner}/{repo}`,
  `minimal-repository` for repository listings and nested repositories, `issue`
  for issue reads, `pull-request` for `GET …/pulls/{n}`, and
  `pull-request-simple` for `GET …/pulls`. List items are the item
  representation restricted to the list schema. Rationale: matches the bundled
  OpenAPI description (`schema/api.github.com.json`) and the `github3.py` class
  split (`Repository`/`ShortRepository`, `PullRequest`/`ShortPullRequest`), and
  makes INV-list-item-agreement checkable. Date/Author: 2026-11-15, planning
  agent.
- D3. Decision: include `GET /orgs/{org}` (state-backed organization
  representation) in scope; exclude `GET /users/{username}`. Rationale:
  `gh.organization(org).repositories()` is a repository listing workflow and
  cannot work without a state-backed organization whose `url` points at the
  simulator; today it escapes to real GitHub. No in-scope `github3.py` call
  needs `GET /users/{username}` (`repositories_by` calls
  `/users/{username}/repos` directly). simulacat patches both routes; the user
  route stays a simulacat patch until a later roadmap item. Flagged for user
  confirmation. Date/Author: 2026-11-15, planning agent.
- D4. Decision: run the `github3.py` contract tests inside `make test` (via
  `bun test`), driving Python through `uv` from a TypeScript harness; fail
  loudly when `uv` or the synced environment is unavailable rather than
  skipping. Rationale: the roadmap requires the contract in core; a separate
  opt-in target would let regressions land. A skip would make the gate vacuous.
  Date/Author: 2026-11-15, planning agent.
- D5. Decision: model the Python side as a non-package `uv` project at
  `tests/contracts/github3/` with two conflicting dependency groups
  (`github3-v3 = ["github3.py==3.2.0"]`, `github3-v4 = ["github3.py==4.0.1"]`),
  a committed `uv.lock`, and per-line environments under the ignored
  `.uv-cache/` directory selected with `UV_PROJECT_ENVIRONMENT`. Rationale:
  exact, hash-locked, reproducible resolution with one manifest. 3.2.0 and
  4.0.1 are the final releases of each major line (PyPI index at planning
  time), so exact pins are representative. Rejected: ad hoc
  `uv run --with github3.py==X` (unlocked, resolves on every run) and two
  separate projects (duplicated manifests). Date/Author: 2026-11-15, planning
  agent.
- D6. Decision: honour GitHub body media types. `Accept` values naming
  `application/vnd.github[.v3].full+json` yield `body`, `body_text`, and
  `body_html`; `.text+json` yields `body_text`; `.html+json` yields `body_html`;
  `.raw+json`, `application/vnd.github+json`, `application/json`, absent, or
  unrecognized yield `body` only. `body_text` is the stored body verbatim;
  `body_html` is the HTML-escaped body wrapped in `<p>…</p>`, or the empty
  string for an empty body. Rationale: this is GitHub's documented contract
  (REST "Get an issue" media types, confirmed with Firecrawl) and `github3.py`
  always sends `application/vnd.github.v3.full+json` (`session.py:106`).
  Rejected: simulacat's always-emit approach (adds fields other clients never
  receive) and Markdown rendering (needs a new runtime dependency; escaping is
  enough for client contracts and is safe if a consumer renders it).
  Date/Author: 2026-11-15, planning agent.
- D7. Decision: emit documented neutral values for unmodelled collaboration
  fields from one constants module
  (`src/rest/representations/unmodelled-fields.ts`): `labels: []`,
  `assignee: null`, `assignees: []`, `milestone: null`, `comments: 0`,
  `locked: false`, `active_lock_reason: null`, `closed_by: null`,
  `author_association: "NONE"`, `requested_reviewers: []`,
  `requested_teams: []`, `merge_commit_sha: null`, `merged_by: null`,
  `review_comments: 0`, `commits: 0`, `additions: 0`, `deletions: 0`,
  `changed_files: 0`, `auto_merge: null`, `maintainer_can_modify: false`,
  `rebaseable: null`, and `mergeable_state: "unknown"`, plus repository
  `network_count` and `subscribers_count` read from stored counters with the
  stored `forks_count` and `watchers_count` as the respective fallbacks.
  Rationale: `github3.py` requires the keys; inventing values would mislead
  tests. Each constant's JSDoc names the roadmap item that will model it
  (labels 1.5.x, review state phase 6, issue collaboration phase 8,
  mergeability phase 5), so later slices replace one constant with state.
  Date/Author: 2026-11-15, planning agent.
- D8. Decision: resolve accounts for `owner`, `user`, and `head.user` through
  a store selector that returns a discriminated union (seeded user, seeded
  organization, or unseeded login). Unseeded logins project as a synthetic
  `User` with a deterministic ID in a new `ENTITY_ID_OFFSETS.ACCOUNT` band and
  `node_id` `base64("User:<login>")`. Rationale: issue and pull request schemas
  default `user` to `octocat`, which fixtures rarely seed, and `github3.py`
  indexes `user["avatar_url"]`. A synthetic account keeps reads working without
  making seeding mandatory. Date/Author: 2026-11-15, planning agent.
- D9. Decision: core proves the success criterion from its side only. The
  contract suite reproduces every simulacat-patched workflow in scope
  (repository lookup, user and organization repository listing, issue retrieval
  with rich body fields, pull request retrieval) against unpatched core and
  asserts values, not just types. A manual downstream check (run simulacat's
  `tests/test_github3_compat.py` against a locally linked core build with the
  patches deleted, in a scratch checkout) is described in
  `Validation and acceptance` but not committed. Filing a simulacat issue needs
  user approval (Constraint 13). Rationale: simulacat currently depends on
  `@simulacrum/github-api-simulator` 0.8.0, not this package; adoption is
  simulacat's own roadmap (its `docs/roadmap.md` step 5.1 names this task as a
  prerequisite). Date/Author: 2026-11-15, planning agent.
- D10. Decision: accept these pre-1.0 breaking REST payload changes without
  shims: issue and pull request payloads stop exposing internal `owner`,
  `repo`, and `issue_number` keys; their `user` becomes a full simple-user
  object; pull request `head`/`base` gain `label`, `user`, and `repo` objects
  and lose their internal `owner`/`repo` strings; `GET /users/{username}/repos`,
  `GET /user/repos`, and `GET /orgs/{org}` return seeded state (404 or 401
  where GitHub would) instead of OpenAPI examples; `GET /orgs/{org}/repos`
  returns `minimal-repository` items. Rationale: Constraint 2; the old shapes
  are not GitHub's and are what forced downstream patching. Date/Author:
  2026-11-15, planning agent.
- D11. Decision: no LemmaScript proof. See `Verification plan` §Formal
  verification decision. Date/Author: 2026-11-15, planning agent.
- D12. Decision: lint and format the Python driver with `ruff==0.17.5` run
  through `uv tool run`, wired into `make check-fmt`, `make lint`, and
  `make fmt`; no Python type checker. Rationale: keeps the "no lint or format
  violations" bar for every language in the repository at the cost of three
  Makefile lines, using the same `uv tool run` precedent as `make spelling`. A
  type checker for one ~150-line test driver is disproportionate; its inputs
  are validated by the TypeScript side, which owns the assertions. Date/Author:
  2026-11-15, planning agent.

## Outcomes & retrospective

Not started. To be completed at each milestone and at the end.

## Context and orientation

Inspected base revision: `c2e5ddc` ("Enable unicorn and deslop Oxlint plug-ins
(#121)"). Line numbers below refer to that revision; relocate symbols with
`rg -n '<symbol>' src tests` if they drift.

### How a REST request is served

`simulation()` in `src/index.ts` builds a foundation simulator
(`@simulacrum/foundation-simulator`) whose REST surface is an `openapi-backend`
router over the bundled GitHub OpenAPI description `schema/api.github.com.json`.
`openapi()` in `src/rest/index.ts` registers handlers keyed by OpenAPI
`operationId`. Operations without a handler fall through to the foundation's
`notImplemented` handler, which returns `mockResponseForOperation` — an example
payload from the OpenAPI document. That fall-through is why
`/users/{username}/repos` returns `octocat/Hello-World`.

Handlers today:

- `repos/get` and `repos/update` live in `src/rest/repository-handlers.ts`
  (`projectRepositoryResponse`, lines 104-122, reshapes the owner; owner URL
  helpers at lines 50-100).
- `repos/list-for-org` (`src/rest/index.ts` lines 193-200) uses the store
  selector `allReposWithOrgs` (`src/store/index.ts` lines 245-262) and returns
  plain-text `Not Found` for an unknown organization.
- `issues/list-for-repo`, `issues/get`, `pulls/list`, and `pulls/get`
  (`src/rest/index.ts` lines 304-329) use the generic `makeListHandler` and
  `makeItemHandler` (lines 85-110) with `projectIssueUrls` and
  `projectPullRequestUrls` from `src/urls/`.
- `users/get-authenticated` (`GET /user`) at lines 332-344 shows the actor
  pattern: `requireRestUserActor` from `src/rest/actor-context.ts` returns
  `{user}` or `{failure: 'unauthenticated'}`, and the handler answers 401
  `{"message":"Authentication required"}`.

URL derivation (roadmap 1.4.1, complete): `buildBaseUrls`
(`src/http/request-url.ts` lines 184-203) derives `{apiBaseUrl, webBaseUrl}`
from the request; `src/urls/*.ts` hold per-entity projectors
(`projectRepositoryUrls`, `projectIssueUrls`, `projectPullRequestUrls`,
`projectOrganizationUrls`) that fill a URL only when the stored value is
`undefined`, so seeded values, including `null`, win (`projectDerivedFields` in
`src/urls/shared.ts` lines 95-114).

Stored entities: `githubRepositorySchema` (`src/store/entities/repository.ts`),
`githubIssueSchema` (`src/store/entities/issue.ts`), `githubPullRequestSchema`
(`src/store/entities/pull-request.ts`), `githubOrganizationSchema`
(`src/store/entities/organization.ts`), `githubUserSchema`
(`src/store/entities.ts`). Early-entity selectors (`getIssue`,
`listIssuesForRepository`, `getPullRequest`, `listPullRequestsForRepository`)
are in `src/store/early-entity-selectors.ts`. Generated ID bands live in
`src/store/entity-id-offsets.ts`. Fixture builders are in
`src/store/builders.ts`.

There is no `src/domain` or `src/ports` directory. In hexagonal terms the store
(entities, selectors, actions) is the domain and its query port, the REST and
GraphQL directories are driving adapters, and `src/urls/` plus
`src/http/request-url.ts` are framework-neutral projection policy shared by
both adapters. This plan follows that shape rather than introducing new
top-level layers.

### What github3.py requires

Reconnaissance read `github3.py` 3.2.0 and 4.0.1 source (`models.py`,
`repos/repo.py`, `users.py`, `orgs.py`, `issues/issue.py`, `issues/label.py`,
`issues/milestone.py`, `pulls.py`). Field reads are identical across both
versions. Mechanics that matter:

- `GitHubCore.__init__` converts a missing key (`KeyError`) into
  `IncompleteResponse`. A `null` where an object is indexed raises a raw
  `TypeError`; a malformed date raises `ValueError`.
- Date fields go through `_strptime`: an ISO 8601 string or `null`.
- URI-template fields are parsed with `uritemplate.URITemplate`.
- `self._api = json["url"]`; follow-up calls build URLs from it, so `url`
  must point at the simulator.
- The session sends `Accept: application/vnd.github.v3.full+json`.

Required keys per class (the manifest `EP-M0` commits as
`tests/contracts/github3/required-fields.json`):

- `ShortUser` (owner, user, head/base user): `avatar_url`, `events_url`,
  `followers_url`, `following_url`, `gists_url`, `gravatar_id`, `html_url`,
  `id`, `login`, `organizations_url`, `received_events_url`, `repos_url`,
  `starred_url`, `subscriptions_url`, `type`, `url`.
- `ShortRepository` (listings, nested in pull request head/base):
  `archive_url`, `assignees_url`, `blobs_url`, `branches_url`,
  `collaborators_url`, `comments_url`, `commits_url`, `compare_url`,
  `contents_url`, `contributors_url`, `deployments_url`, `description`,
  `downloads_url`, `events_url`, `fork`, `forks_url`, `full_name`,
  `git_commits_url`, `git_refs_url`, `git_tags_url`, `hooks_url`, `html_url`,
  `id`, `issue_comment_url`, `issue_events_url`, `issues_url`, `keys_url`,
  `labels_url`, `languages_url`, `merges_url`, `milestones_url`, `name`,
  `notifications_url`, `owner` (object), `private`, `pulls_url`, `releases_url`,
  `stargazers_url`, `statuses_url`, `subscribers_url`, `subscription_url`,
  `tags_url`, `teams_url`, `trees_url`, `url`.
- `Repository` adds: `archived`, `clone_url`, `created_at`,
  `default_branch`, `forks_count`, `git_url`, `has_downloads`, `has_issues`,
  `has_pages`, `has_projects`, `has_wiki`, `homepage`, `language`, `mirror_url`,
  `network_count`, `open_issues_count`, `pushed_at`, `size`, `ssh_url`,
  `stargazers_count`, `subscribers_count`, `svn_url`, `updated_at`,
  `watchers_count`.
- `Organization` (`GET /orgs/{org}`): `avatar_url`, `description`,
  `events_url`, `hooks_url`, `id`, `issues_url`, `login`, `members_url`,
  `public_members_url`, `repos_url`, `url`, `created_at`, `followers`,
  `following`, `html_url`, `public_repos`.
- `ShortIssue` (`repo.issues()`): `url`, `assignee` (nullable), `assignees`
  (list), `body`, `closed_at`, `comments`, `comments_url`, `created_at`,
  `events_url`, `html_url`, `id`, `labels` (list), `labels_url`, `locked`,
  `milestone` (nullable), `number`, `state`, `title`, `updated_at`, `user`
  (object). `Issue` (`repo.issue(n)`, `gh.issue(...)`) adds `body_html`,
  `body_text`, `closed_by` (nullable).
- `ShortPullRequest` (`repo.pull_requests()`): `url`, `_links`,
  `active_lock_reason`, `assignee`, `assignees` (list, not null), `base`,
  `body`, `body_html`, `body_text`, `closed_at`, `comments_url`, `commits_url`,
  `created_at`, `diff_url`, `head`, `html_url`, `id`, `issue_url`, `locked`,
  `merge_commit_sha`, `merged_at`, `number`, `patch_url`, `review_comment_url`,
  `review_comments_url`, `state`, `statuses_url`, `title`, `updated_at`, `user`.
  `PullRequest` (`repo.pull_request(n)`) adds `additions`,
  `author_association`, `comments`, `commits`, `deletions`, `draft`,
  `mergeable`, `mergeable_state`, `merged`, `merged_by` (nullable),
  `review_comments`, `requested_reviewers`, `requested_teams`.
- Pull request `head`/`base` (`PullDestination`): `ref`, `label`, `sha`;
  `user` and `repo` are optional, but when `repo` is present it must be a
  complete `ShortRepository`, and `base.repo` must be present because
  `_PullRequest` reads `self.base.repository` unguarded (a missing base
  repository raises `AttributeError`, which escapes `IncompleteResponse`).

### Simulacat's current patches (the work this replaces)

From a read-only snapshot of simulacat `main` (`src/github-sim-server.ts` lines
248-451): `repos/get` (name, full name, owner login, `language`),
`repos/list-for-user` (state-backed list built from the `repos/get` example),
`issues/get` (`number`, `body_html`/`body_text` copies of `body`,
`closed_by: null`), `pulls/get` (`number`, body fields), plus out-of-scope
`orgs/get` and `users/get-by-username` (login and URL rewrites). Simulacat's
compatibility tests (`tests/test_github3_compat.py`: repository lookup, user
listing, organization listing, issue and pull request retrieval) run on a CI
matrix over `github3.py>=3.2.0,<4` and `>=4.0.0,<5`.

### Test and tooling inventory

- Runner: `bun test --max-concurrency=1 tests` (`make test`). `bunfig.toml`
  preloads `test-plugins.ts`, which registers `@aboviq/bun-test-cucumber` 0.2.0
  for `tests/**/*.steps.ts`; `tests/cross-owner-identity.features.test.ts`
  loads every `features/**/*.feature`.
- In-process servers: `simulation({initialState}).listen(0)` returns a server
  with `port` and `ensureClose()` (for example
  `tests/cross-owner-identity.steps.ts` lines 132-145). `bin/start.cjs` treats
  `PORT=0` as 3300, so the contract harness must use the in-process API.
- Child-process helpers: `tests/support/documented-example-child.ts` spawns
  detached process groups and stops them with `stopOwnedProcessGroup`; reuse it
  for the Python driver rather than writing a second process manager.
- Property tests: `fast-check` ^4.9.0 with the seed helper
  `tests/support/property-test-seed.ts` (see `tests/urls.test.ts` for the 1.4.1
  request-host properties).
- Python: none tracked. `Makefile` already defines `UV`,
  `UV_ENV = UV_CACHE_DIR=.uv-cache UV_TOOL_DIR=.uv-tools`, and uses
  `uv tool run` for `make spelling`; `.gitignore` already ignores `.uv-cache/`
  and `.uv-tools/`. Host: `uv` 0.13.2; CPython 3.14.7 managed by `uv`.
- CI: `.github/workflows/ci.yml` (one `ubuntu-latest` job) installs Bun,
  `astral-sh/setup-uv`, Node, then runs `make all`
  (`check-fmt typecheck docs-check lint test spelling`).
- Lint: Biome (`bun run lint`), Oxlint (`.oxlintrc.json`, no `overrides`
  yet), TypeDoc documentation gate (`make docs-check`).

### Signposted documentation and skills

Read before implementing: `docs/architecture.md` §GitHub client compatibility
and §Repository label slice; `docs/api-reference.md` §Exported fixture schemas
and §Capability matrix; `docs/github-rest-api-audit.md` §Store and Modelling
Constraints; `docs/developers-guide.md` §URL derivation, §Linting rules,
§Testing expectations, §Gherkin feature scenarios, §Executable guide examples;
`docs/complexity-antipatterns-and-refactoring-strategies.md` (keep
representation helpers small);
`docs/mocking-services-with-simulacrum- actors-and-stable-keyset-connections.md`
(actor model behind `/user/repos`); `docs/github-graphql-api-audit.md`
(confirm GraphQL is untouched); `docs/documentation-style-guide.md`;
`docs/execplans/1-4-1-derive-rest-ur-ls.md` (URL policy history). The user also
named `podbot-design.md`; no such file exists in this repository at `c2e5ddc`.

Skills: `execplans` (this document), `hexagonal-architecture` (boundary checks
at each milestone), `typescript-router` then
`typescript-boundaries-and-validation` and `typescript-data-and-state`
(representation shapes), `fast-check` (property tests), `typescript-testing`,
`typescript-verification` and `lemmascript` (only if D11 is revisited),
`codegraph-mcp` (callers and impact before moving owner helpers),
`python-testing` and `ruff-016` (driver hygiene), `firecrawl-mcp` (GitHub REST
documentation lookups), `commit-message`, `pr-creation`.

### Budget survey

Estimated net code lines from tracing callers, tests, and integration points:
representations ~620 (account 120, organization 60, repository 120, body media
types 70, issue 100, pull request 150), handlers and selectors ~260 net after
moving issue and pull request handlers out of `src/rest/index.ts` and owner
helpers out of `src/rest/repository-handlers.ts`, so `src/` ≈ 880 net. Tests:
representation unit and table tests ~450, property tests ~300, contract harness
and suite ~300, feature steps ~180, Python driver ~170, boundary fitness check
~40, so tests ≈ 1,440. Total ≈ 2,320 net; the 2,600 budget leaves ~12 %
contingency and the 1,150 `src/` sub-limit ~30 %. Configuration:
`pyproject.toml` ~45, `.python-version` 1, `.oxlintrc.json` override ~20,
Makefile variables ~6, `.gitignore`/`typos.local.toml` ~5 ≈ 80 (budget 120).
Documentation: users guide ~150, developers guide ~120, architecture ~50, API
reference capability matrix ~25, REST audit ~20, CHANGELOG ~8, roadmap ~3 ≈ 375
(budget 500). Files ≈ 38 (budget 45).

Historical evidence: `docs/execplans/1-4-1-derive-rest-ur-ls.md` set "roughly
600 lines" per milestone and recorded no budget increase (its retrospective
names only a CodeRabbit rate limit).
`docs/execplans/1-3-1-shared-domain- actions-for-write-behaviour.md` set "~12
source files, ~500 net non-test lines" and its three revision notes record no
increase. Neither plan shows repeated underestimation, so the per-milestone cap
here (750) follows 1.4.1's order of magnitude, raised modestly because this
plan carries a cross-language harness. No comparable history exists for Python
tooling.

## Conformance basis

Upstream artefacts (all at `c2e5ddc`): `docs/roadmap.md` §1.4 item 1.4.2;
`docs/architecture.md` §GitHub client compatibility (lines 209-240) and
§Repository label slice (lines 242-263); `docs/api-reference.md` §Exported
fixture schemas and §Capability matrix; `docs/github-rest-api-audit.md` §Store
and Modelling Constraints (lines 201-221); `docs/developers-guide.md` §Linting
rules and §Testing expectations; `docs/adr-001-linting-strategy.md`;
`AGENTS.md`. There is no Terms of Reference document and no technical design
document beyond `docs/architecture.md`; none is invented here.

Requirements:

- REQ-repo-read: `github3.py` `GitHub.repository(owner, name)` returns a
  `Repository` built from seeded state (roadmap 1.4.2; architecture lines
  222-223).
- REQ-repo-list: `repositories_by(login)`, `organization(org).repositories()`,
  and `repositories()` return `ShortRepository` objects for exactly the seeded
  repositories in scope (roadmap 1.4.2 "repository lookup and listing").
- REQ-issue-read: `Repository.issue(n)`, `GitHub.issue(...)`, and
  `Repository.issues()` succeed, with `body_html` and `body_text` present for
  the `full` media type (roadmap 1.4.2).
- REQ-pr-read: `Repository.pull_request(n)`, `GitHub.pull_request(...)`, and
  `Repository.pull_requests()` succeed with head and base destinations (roadmap
  1.4.2).
- REQ-matrix: every in-scope workflow is contract-tested against `github3.py`
  3.x and 4.x (roadmap 1.4.2).
- REQ-no-patch: no in-scope workflow needs a downstream payload patch
  (roadmap 1.4.2 success; architecture lines 238-240).
- REQ-self-host: every served URL in scope points at the simulator instance
  unless seeded otherwise (architecture lines 218-231; 1.4.1).
- REQ-boundary: representation policy is pure and separate from handlers and
  the store (architecture §Extension seams; hexagonal skill invariants).

Gaps at `c2e5ddc`:

- GAP-repo-full: repository payload lacks `network_count` and
  `subscribers_count`; an unseeded owner is emitted as a bare string.
- GAP-list-mocks: `/users/{username}/repos` and `/user/repos` serve OpenAPI
  examples.
- GAP-org-stub: `/orgs/{org}` serves an OpenAPI example pointing at
  `api.github.com`.
- GAP-issue-shape: issue payload lacks `assignee`, `assignees`, `labels`,
  `milestone`, `comments`, `comments_url`, `events_url`, `labels_url`, `locked`,
  `closed_by`, `body_html`, `body_text`; leaks `owner`/`repo`.
- GAP-pr-shape: pull request payload lacks the `ShortPullRequest` and
  `PullRequest` keys listed above, and head/base lack `label`, `user`, `repo`;
  leaks `owner`/`repo`/`issue_number`.
- GAP-user-shape: issue and pull request `user` is `{login}` only.
- GAP-no-harness: no Python client harness exists in core.
- GAP-index-size: `src/rest/index.ts` is 403 lines (limit 400).

Trace links:

```plaintext
roadmap-1.4.2 -> REQ-matrix -> GAP-no-harness -> EP-M0 -> tests/github3-contract.test.ts (harness self-test, egress guard)
roadmap-1.4.2 -> REQ-repo-read -> GAP-repo-full, GAP-user-shape -> EP-M1 -> github3 contract: repository lookup (3.x, 4.x)
roadmap-1.4.2 -> REQ-repo-list -> GAP-list-mocks, GAP-org-stub -> EP-M2
  -> github3 contract: repositories_by, organization().repositories(), repositories()
roadmap-1.4.2 -> REQ-issue-read -> GAP-issue-shape -> EP-M3 -> github3 contract: issue, issues, gh.issue
roadmap-1.4.2 -> REQ-pr-read -> GAP-pr-shape, GAP-index-size -> EP-M4
  -> github3 contract: pull_request, pull_requests, gh.pull_request
architecture-client-compat -> REQ-self-host -> EP-M1..EP-M4 -> INV-self-host property + INV-no-egress guard
hexagonal -> REQ-boundary -> EP-M1 -> oxlint override (or fitness test) on src/rest/representations/**
roadmap-1.4.2 -> REQ-no-patch -> EP-M5 -> features/github3-client-compatibility.feature + manual downstream check
```

## Verification plan

### Abstract model

State `S` is the seeded store: accounts `A` (users and organizations keyed by
login), repositories `R` keyed by `owner/name`, issues `I` and pull requests
`P` keyed by `owner/name#number`. A request is
`(route, params, actor, accept, base)` where `base` is the request-derived
`BaseUrls`. Each in-scope route is `select(S, params, actor)` followed by
either a not-found or unauthenticated outcome or `represent(records, ctx)` where
`ctx = {base, body}` and `body = negotiate(accept)`. Representations are total
functions from resolved records and `ctx` to JSON; they never read `S`.

Preconditions: records satisfy the stored entity schemas (they were parsed by
Zod at seed time). Unknown owner, repository, issue, or pull request yields 404
`{"message":"Not Found"}`; `/user/repos` without a user actor yields 401
`{"message":"Authentication required"}` (existing convention for `/user`).

### Invariants and lemmas

- INV-required-fields (REQ-repo-read, REQ-repo-list, REQ-issue-read,
  REQ-pr-read): for every representation `R` in {simple-user, organization,
  minimal-repository, full-repository, issue (full media type),
  pull-request-simple, pull-request, pull destination} and every admissible
  input, `represent_R` produces every key in the `github3.py` manifest for its
  class, never `undefined`; keys the manifest marks non-nullable objects are
  objects; list keys are arrays; date keys are ISO 8601 strings or `null`;
  `url` is a non-empty string.
- INV-no-internal-leak (D10): no issue or pull request representation
  contains the store-only keys `owner` (as a string), `repo`, or
  `issue_number`, and every top-level key is a property of the matching OpenAPI
  component schema in `schema/api.github.com.json` or one of the media-type
  body keys.
- INV-list-item-agreement (D2): for every seeded entity, its list item equals
  its item representation restricted to the list schema's keys (and the nested
  `minimal-repository` inside a pull request equals the listing item for that
  repository).
- INV-pr-lifecycle: `merged === (merged_at !== null)`; `state` is `open` or
  `closed`; when `merged` then `state === "closed"`; `draft` and `mergeable`
  pass through from state.
- INV-body-negotiation (D6): `negotiate` is total over all strings and the
  emitted body key set is exactly the table in D6 for each recognized media
  type, and `{body}` otherwise.
- INV-html-escape: for every body string `b`, `body_html` is `""` when `b` is
  empty, otherwise `<p>` + `escape(b)` + `</p>`, where `escape(b)` contains
  none of `<`, `>`, `"`, `'` and every `&` begins one of the five entities, and
  `unescape(escape(b)) === b`.
- INV-account-resolution (D8): a seeded user or organization login projects
  its stored `id`, `login`, and `type`; an unseeded login projects
  `type: "User"`, the same login, and an ID that is a positive integer inside
  the `ACCOUNT` band and identical across calls and requests.
- INV-self-host (REQ-self-host): every `*_url`, `url`, and `_links.*.href`
  value in every representation either was seeded explicitly or starts with the
  request's API or web base URL (external clone fields keep their 1.4.1
  classification), for arbitrary request hosts and API roots.
- INV-no-egress (Constraint 11): during a contract run, any attempt by the
  Python client to reach a non-loopback host fails immediately.
- L-route-uses-representation: each in-scope handler returns exactly
  `represent(select(S, params, actor), ctx)`; this connects the pure invariants
  above to served responses.
- L-scope-filter: `/users/{login}/repos` returns exactly the repositories whose
  owner is `login`; `/orgs/{org}/repos` exactly those owned by `org`;
  `/user/repos` exactly those owned by the actor or by an organization in the
  actor's `organizations`; each sorted by `full_name` for determinism.

### Axioms (trusted, not verified here)

- AXIOM-github3: `github3.py` 3.2.0 and 4.0.1 behave as their published
  source does; the manifest above was read from that source. Repository
  boundary: the contract suite exercises the real libraries, so a manifest
  error surfaces as a contract failure.
- AXIOM-openapi: `schema/api.github.com.json` (bundled, refreshed per
  `docs/developers-guide.md` §GitHub REST schema) describes GitHub's REST
  component schemas. Boundary: INV-no-internal-leak uses it as an independent
  oracle for permitted keys.
- AXIOM-media-types: GitHub's documented REST media types for issue and pull
  request bodies (`raw`, `text`, `html`, `full`). Boundary: D6 and
  INV-body-negotiation.
- AXIOM-uv: `uv` 0.13.x resolves `uv.lock` reproducibly and honours
  `UV_PROJECT_ENVIRONMENT`, `--frozen`, and dependency-group conflicts.
- AXIOM-requests-proxy: `requests` honours `HTTP_PROXY`/`HTTPS_PROXY`/
  `NO_PROXY` from the environment, which the egress guard relies on. The
  guard's self-test (below) exercises it rather than assuming it.
- AXIOM-foundation: `simulation().listen(0)` binds an ephemeral loopback port
  and `ensureClose()` releases it.

### Methods per obligation

- Obligation: INV-required-fields.
  Method: `fast-check` property per representation, plus the contract suite.
  Rationale: the input space (seeded/unseeded owners, optional fields, URL
  overrides, states) is too large for tables; the real clients are the final
  oracle. Domain: arbitraries built from the exported fixture builders,
  covering user-owned and organization-owned repositories, unseeded owners,
  issues with and without `pull_request` links, pull requests
  open/closed/merged/draft, head repository seeded or absent, seeded URL
  overrides including `null`. Artefact:
  `tests/rest-representations.properties.test.ts`, oracle
  `tests/contracts/github3/required-fields.json`. Evidence:
  `bun test tests/rest-representations.properties.test.ts` fails in `EP-M1` red
  (functions missing), passes after each milestone's green step; contract tests
  pass for both lines. Non-vacuity: `fc.statistics`-style classification
  asserts each class above occurs; seeded mutation — delete `network_count`
  from the full-repository helper and confirm the property and the contract
  test both fail, then revert (`git checkout -- <file>`).
- Obligation: INV-no-internal-leak.
  Method: property over the same arbitraries against OpenAPI component
  properties. Artefact: same property file; helper reads
  `schema/api.github.com.json` once. Non-vacuity: before green, the property
  fails on today's payload (`owner` string present); seeded mutation re-adding
  `repo` is rejected.
- Obligation: INV-list-item-agreement.
  Method: property over generated stores with 1-5 entities per repository.
  Artefact: `tests/rest-representations.properties.test.ts`. Non-vacuity:
  classification requires at least one multi-entity store and at least one
  user-owned and one organization-owned repository; mutation making the list
  item use a different `updated_at` is rejected.
- Obligation: INV-pr-lifecycle.
  Method: exhaustive table over the finite domain `state ∈ {open, closed}` ×
  `merged_at ∈ {null, timestamp}` × `closed_at ∈ {null, timestamp}` ×
  `draft ∈ {true, false}` (16 rows), each row stating the expected `state`,
  `merged`, `merged_at`, `closed_at`; rows the stored schema's transform
  rejects or normalizes are asserted as such. Rationale: the domain is finite,
  so the table is a complete case analysis rather than a sample. Artefact:
  `tests/rest-pull-request-representation.test.ts`. Non-vacuity: every row is
  reachable through `buildPullRequestFixture`; a mutation `merged: true`
  constant is rejected by the open rows.
- Obligation: INV-body-negotiation.
  Method: table for the recognized media types (with and without `.v3`, with
  parameters, mixed case, comma-separated lists, quality values) plus a
  `fast-check` totality property over arbitrary strings. Artefact:
  `tests/rest-body-media-type.test.ts`. Non-vacuity: the property's generator
  mixes recognized tokens into random strings and classifies hits versus misses
  (both must occur); a mutation mapping `text` to `full` is rejected by the
  table.
- Obligation: INV-html-escape.
  Method: bounded-exhaustive check over every string of length 0-5 drawn from
  the alphabet `{&, <, >, ", ', a, ;, #}` (37,449 strings) plus a `fast-check`
  property over arbitrary Unicode strings. Rationale: escaping is a
  per-character homomorphism, so ambiguity can only arise between adjacent
  characters; exhaustive short strings over every special character plus the
  entity punctuation `;` and `#` cover every adjacency, and the property covers
  the unbounded remainder. Artefact: `tests/rest-body-media-type.test.ts`; the
  test owns its `unescape` oracle (five fixed entities). Non-vacuity: a
  mutation omitting the `'` mapping is rejected; a mutation escaping `&` after
  `<` (double-escaping) is rejected by the round trip.
- Obligation: INV-account-resolution.
  Method: table for seeded user, seeded organization, and unseeded login;
  `fast-check` property over arbitrary valid logins for determinism, band
  membership, and positive integer IDs. Artefact:
  `tests/rest-account-representation.test.ts`. Non-vacuity: generator includes
  logins equal to seeded logins (must not synthesize) and logins differing only
  by case.
- Obligation: INV-self-host.
  Method: extend the 1.4.1 request-host property (`tests/urls.test.ts`) to walk
  every string field of every new representation, including nested owners,
  `head.repo`, `base.repo`, and `_links`. Non-vacuity: a mutation hard-coding
  `https://api.github.com` in `_links` is rejected.
- Obligation: INV-no-egress.
  Method: the Python driver runs with `HTTP_PROXY` and `HTTPS_PROXY` set to
  `http://127.0.0.1:9` and `NO_PROXY=127.0.0.1,localhost`; a driver self-test
  scenario requests `https://api.github.com/` and must report a connection
  error. Artefact: `tests/contracts/github3/workflows.py` scenario
  `egress_guard`, asserted in `tests/github3-contract.test.ts`. Non-vacuity:
  the self-test is the negative control; it fails if the guard is removed and
  the host has network access.
- Obligation: L-route-uses-representation and L-scope-filter.
  Method: named example and table tests through HTTP (`fetch` against
  `listen(0)`), plus the contract suite and the BDD feature. Artefact:
  `tests/rest-repository-reads.test.ts`, `tests/rest-issue-reads.test.ts`,
  `tests/rest-pull-request-reads.test.ts`, `tests/github3-contract.test.ts`,
  `features/github3-client-compatibility.feature`. Non-vacuity: fixtures always
  include a decoy repository, issue, and pull request under a second owner that
  must not appear.

### Formal verification decision

No LemmaScript or other prover is used (D11). The contractual business logic
introduced here is (a) the pull request lifecycle derivation, whose domain is
finite and is enumerated exhaustively (a complete proof by cases), (b) body
media-type selection, a finite table plus a totality property, and (c) HTML
escaping, a per-character homomorphism covered by bounded-exhaustive
enumeration over every special-character adjacency plus a property for the
unbounded remainder. A LemmaScript/Dafny proof of escape injectivity would add
an all-lengths guarantee for (c) but would need a new verification toolchain
(escalation-gated in `docs/execplans/1-3-1-…`), and would leave the real risk —
agreement with `github3.py` and GitHub's schema — unverified; the contract
suite and OpenAPI oracle address that risk directly. If review disagrees, the
fallback is an escalation-gated proof milestone for `escapeHtml` only.

### Suggested BDD features

Feature file: `features/github3-client-compatibility.feature`, steps in
`tests/github3-client-compatibility.steps.ts` (runner: `make test`, loaded by
`tests/cross-owner-identity.features.test.ts`). The runner has no
`Scenario Outline`, so each scenario runs both client lines.

```gherkin
@github3-client-compatibility
Feature: github3.py reads seeded repositories, issues, and pull requests

  Background:
    Given a simulator seeded with organization "acme" and user "octo" who belongs to "acme"
    And repository "acme/widgets" with issue 1 titled "Crash on start" and body "Steps <to> reproduce"
    And pull request 2 titled "Fix crash" from branch "feature" into "main" in "acme/widgets"
    And repository "octo/dotfiles" and decoy repository "globex/secret"

  Scenario: Looking up a repository                                  # REQ-repo-read, EP-M1
    When github3.py 3.x and 4.x each look up repository "acme/widgets"
    Then both clients see full name "acme/widgets" owned by organization "acme"
    And both clients' repository API URLs point at the simulator

  Scenario: Listing repositories for a user, an organization, and the actor  # REQ-repo-list, EP-M2
    When github3.py 3.x and 4.x each list repositories by "octo", for organization "acme", and for actor "octo"
    Then both clients list ["octo/dotfiles"], ["acme/widgets"], and ["acme/widgets", "octo/dotfiles"]
    And no client lists "globex/secret"

  Scenario: Retrieving an issue with rendered body fields             # REQ-issue-read, EP-M3
    When github3.py 3.x and 4.x each retrieve issue 1 from "acme/widgets"
    Then both clients see title "Crash on start", body_text "Steps <to> reproduce"
    And body_html "<p>Steps &lt;to&gt; reproduce</p>"

  Scenario: Retrieving a pull request with head and base repositories # REQ-pr-read, EP-M4
    When github3.py 3.x and 4.x each retrieve pull request 2 from "acme/widgets"
    Then both clients see head ref "feature", base ref "main", and base repository "acme/widgets"
    And both clients see the pull request as open and not merged

  Scenario: Missing resources are absent, not errors                  # unhappy path, EP-M1/EP-M3/EP-M4
    When github3.py 3.x and 4.x each look up repository "acme/missing", issue 99, and pull request 99
    Then every lookup returns no object

  Scenario: Listing the actor's repositories requires an actor        # unhappy path, EP-M2
    When github3.py 3.x and 4.x each list repositories without an actor header
    Then both clients raise an authentication failure
```

## Plan of work

Each milestone ends with the gates in `Concrete steps` and a commit. The
focused red tests are written first and committed together with the green
change (the red run is evidenced in the commit message and in
`Artefacts and notes`), so every commit leaves `make test` green.

### `EP-M0` Contract harness and red baseline

Requirements: REQ-matrix, GAP-no-harness; decisions D4, D5, D12.

1. Create `tests/contracts/github3/pyproject.toml`: `[project]` name
   `simulacat-core-github3-contract`, `requires-python = ">=3.12"`,
   `dependencies = []`; `[dependency-groups]`
   `github3-v3 = ["github3.py==3.2.0"]`, `github3-v4 = ["github3.py==4.0.1"]`;
   `[tool.uv]` `package = false`, `default-groups = []`,
   `conflicts = [[{group = "github3-v3"}, {group = "github3-v4"}]]`;
   `[tool.ruff]` `target-version = "py312"`, `line-length = 100`;
   `[tool.ruff.lint]` `select = ["ALL"]`,
   `ignore = ["D203", "D213", "COM812"]`. Add `.python-version` containing
   `3.14`. Generate `uv.lock` with
   `UV_CACHE_DIR=.uv-cache uv lock --project tests/contracts/github3`.
2. Create `tests/contracts/github3/workflows.py`: reads `--base-url`,
   `--actor` (optional), and scenario names; configures
   `github3.GitHub(token="contract-token")`, `session.base_url`, and the actor
   header; runs each scenario in a `try` block and writes one JSON line per
   scenario to standard output:
   `{"scenario", "ok", "observed", "error": {"type", "message"}}`. `observed`
   holds plain values the TypeScript side asserts (full names, owner logins and
   types, titles, body fields, head/base refs and repository full names,
   `merged`, URLs). Include `egress_guard` and `client_version` scenarios. Keep
   each function small; use `sys.stdout.write(json.dumps(...) + "\n")`.
3. Create `tests/support/github3-contract-client.ts`: `syncGithub3Line(line)`
   runs
   `uv sync --frozen --project tests/contracts/github3
   --no-default-groups --group github3-v<line>`
   with `UV_CACHE_DIR=<repo>/.uv-cache` and
   `UV_PROJECT_ENVIRONMENT=<repo>/.uv-cache/github3-contract-v<line>`;
   `runGithub3Workflows({line, baseUrl, actor, scenarios})` runs
   `uv run --frozen --no-sync … python -I tests/contracts/github3/workflows.py`
   under the egress-guard environment, using the process-group helpers from
   `tests/support/documented-example-child.ts`, a 60-second timeout, and Zod to
   parse each JSON line (the boundary between processes). Missing `uv` produces
   an `Error` whose message names `uv` and the sync command.
4. Create `tests/support/github3-contract-fixture.ts`: the seeded state from
   the BDD Background (built with the exported fixture builders, including
   decoys) and a `startContractSimulator()` that returns `{baseUrl, close}` from
   `simulation({initialState}).listen(0)`.
5. Create `tests/github3-contract.test.ts`: `beforeAll` starts the simulator
   and runs both lines once with all scenarios; one `it` per (line, scenario).
   Harness self-tests (`client_version` reports 3.2.0 and 4.0.1; `egress_guard`
   reports a connection error) are ordinary passing tests. Every workflow
   scenario starts as `it.failing(...)`, which passes only while the workflow
   fails. The value assertions are written now, in full.
6. Reproduce and diagnose the `ajv` `nullable` error and the transient
   connection reset seen in the probe; record findings in
   `Surprises & discoveries`. If the fix is a one-line handler change inside
   scope, make it with a regression test; otherwise escalate.
7. Makefile: add `RUFF ?= $(UV_ENV) $(UV) tool run ruff@0.17.5` and
   `PY_CONTRACTS = tests/contracts/github3`; `check-fmt` gains
   `$(RUFF) format --check $(PY_CONTRACTS)`; `lint` gains a `ruff` target
   running `$(RUFF) check $(PY_CONTRACTS)`; `fmt` gains
   `$(RUFF) format $(PY_CONTRACTS)`. Validate with `mbake validate Makefile`.
8. Ensure Biome and Oxlint ignore `tests/contracts/github3/**/*.py`
   (they do not lint Python; confirm nothing reports) and that `typos` accepts
   the new files (add exact patterns to `typos.local.toml` only if needed).

End state: `make test` passes; the new suite shows 2 harness tests passing and
every workflow test passing as an expected failure.

### `EP-M1` Account and repository representations; repository lookup

Requirements: REQ-repo-read, REQ-self-host, REQ-boundary; GAP-repo-full,
GAP-user-shape; decisions D1, D2, D7, D8.

Red: write `tests/rest-account-representation.test.ts`,
`tests/rest-repository-representation.test.ts`, and the repository part of
`tests/rest-representations.properties.test.ts` against the not-yet-existing
module (fails to import). Write `tests/rest-repository-reads.test.ts` cases
asserting `GET /repos/acme/widgets` includes `network_count`,
`subscribers_count`, and an owner object for an unseeded owner (fails today).

Green:

1. `src/store/entity-id-offsets.ts`: add `ACCOUNT` band with JSDoc.
2. `src/store/index.ts`: add selector `resolveAccount(state, login)`
   returning `ResolvedAccount` (`{kind: 'user', user}` |
   `{kind: 'organization', organization}` | `{kind: 'unseeded', login}`), and
   rebuild `getRepositoryWithOwner` and `allReposWithOrgs` on it so the owner
   is never a bare string. Keep `src/store/index.ts` under 400 lines by placing
   the selector in `src/store/account-selectors.ts` if needed.
3. `src/rest/representations/context.ts`: `RestRepresentationContext`.
4. `src/rest/representations/account.ts`: `toRestSimpleUser(account, ctx)`
   (moves `projectOwnerAccountUrls`, `projectUserOwnerResponse`, and
   `projectOrganizationOwnerResponse` out of
   `src/rest/repository-handlers.ts`), and `syntheticAccountId(login)`.
5. `src/rest/representations/unmodelled-fields.ts`: constants from D7 with
   JSDoc naming their future roadmap owners.
6. `src/rest/representations/repository.ts`:
   `toRestMinimalRepository(repository, owner, ctx)` and
   `toRestFullRepository(repository, owner, ctx)` built on
   `projectRepositoryUrls`.
7. `src/rest/repository-handlers.ts`: `repos/get` uses
   `toRestFullRepository`; `projectRepositoryResponse` is deleted and its
   callers (`repos/update`, `repos/list-for-org`,
   `apps/list-repos-accessible-to-installation`) move to the new functions in
   the same commit. Use `codegraph_get_callers` on `projectRepositoryResponse`
   first.
8. `.oxlintrc.json`: add an `overrides` entry for
   `src/rest/representations/**` with `no-restricted-imports` forbidding
   `express`, `openapi-backend`, `@simulacrum/foundation-simulator`, `node:*`,
   and `**/store/actions/**`. If unsupported, use the fallback fitness test
   `tests/rest-representation-boundary.test.ts` and record it.
9. Remove `.failing` from the repository-lookup contract tests.

End state: `github3.py` 3.x and 4.x `repository()` pass; all gates pass.

### `EP-M2` Repository listings and organization lookup

Requirements: REQ-repo-list, REQ-self-host; GAP-list-mocks, GAP-org-stub;
decisions D3, D10.

Red: HTTP tests in `tests/rest-repository-reads.test.ts` for
`GET /users/octo/repos` (exactly `octo/dotfiles`), `GET /users/nobody/repos`
(404), `GET /user/repos` with actor `user:octo` (owned plus member-org
repositories, sorted by `full_name`), without an actor (401), `GET /orgs/acme`
(organization fields, `url` on the simulator), `GET /orgs/nobody` (404 JSON),
`GET /orgs/acme/repos` items equal the listing representation; the
`L-scope-filter` table; the INV-list-item-agreement property for repositories.

Green:

1. `src/store/index.ts` (or `src/store/account-selectors.ts`): selectors
   `listRepositoriesOwnedBy(state, login)` and
   `listRepositoriesForUser(state, user)` (owned plus member organizations),
   both sorted by `full_name`.
2. `src/rest/representations/organization.ts`:
   `toRestOrganization(organization, ctx)` using `projectOrganizationUrls`.
3. `src/rest/repository-handlers.ts`: handlers for `repos/list-for-user`,
   `repos/list-for-authenticated-user` (via `requireRestUserActor`), and
   `repos/list-for-org` (moved from `src/rest/index.ts`, now returning JSON 404
   `{"message":"Not Found"}` and `minimal-repository` items). If this file
   would exceed 400 lines, place list handlers in
   `src/rest/repository-list-handlers.ts`.
4. `src/rest/organization-handlers.ts`: `orgs/get`.
5. Remove `.failing` from the three listing contract tests and the
   actor-less unhappy path.

End state: listings are state-backed; no in-scope route serves an OpenAPI
example; all gates pass.

### `EP-M3` Body media types and issue representation

Requirements: REQ-issue-read; GAP-issue-shape, GAP-user-shape, GAP-index-size;
decisions D6, D7, D10.

Red: `tests/rest-body-media-type.test.ts` (negotiation table, totality
property, escape exhaustive check and property),
`tests/rest-issue-representation.test.ts`, issue parts of the properties file,
and `tests/rest-issue-reads.test.ts` (item, list, 404, media types via
`Accept`).

Green:

1. `src/rest/representations/body.ts`: `negotiateBodyRepresentation(accept)`,
   `escapeHtml(text)`, `toRestBodyFields(body, representation)`.
2. `src/rest/representations/issue.ts`: `toRestIssue(issue, related, ctx)`
   with `related = {user: ResolvedAccount}`; uses `projectIssueUrls`, adds
   `comments_url`, `events_url`, `labels_url` (URI template `…/labels{/name}`),
   unmodelled defaults, body fields, and preserves a seeded `pull_request` link.
3. `src/rest/issue-handlers.ts`: `issues/get` and `issues/list-for-repo`
   moved out of `src/rest/index.ts`, resolving the user and negotiating the
   body from `request.get('accept')`.
4. Remove `.failing` from the issue contract tests.

End state: issue workflows pass on both lines; `src/rest/index.ts` shrinks; all
gates pass.

### `EP-M4` Pull request representation

Requirements: REQ-pr-read; GAP-pr-shape, GAP-index-size; decisions D2, D7, D10.

Red: `tests/rest-pull-request-representation.test.ts` (including the 16-row
lifecycle table), pull request parts of the properties file, and
`tests/rest-pull-request-reads.test.ts` (item, list, 404, head repository
absent yields `head.repo: null` while `base.repo` is always present).

Green:

1. `src/rest/representations/pull-request.ts`:
   `toRestPullDestination(destination, related, ctx)`
   (`label = "<owner>:<ref>"`, `user`, `repo` as `minimal-repository` or `null`
   for an unseeded head repository),
   `toRestPullRequestSimple(pr, related, ctx)`, and
   `toRestPullRequest(pr, related, ctx)` = simple plus the full-only keys. URL
   group: `diff_url`, `patch_url` (web), `commits_url`, `comments_url`,
   `review_comments_url`, `review_comment_url` (template), `statuses_url`
   (`…/statuses/{head.sha}`), and `_links` (`self`, `html`, `issue`, `comments`,
   `review_comments`, `review_comment`, `commits`, `statuses`).
2. `src/rest/pull-request-handlers.ts`: `pulls/get` and `pulls/list` moved out
   of `src/rest/index.ts`; resolves base and head repositories and accounts.
   Delete `makeListHandler`/`makeItemHandler` if no caller remains.
3. Remove `.failing` from the pull request contract tests.

End state: every in-scope workflow passes on both lines; no `.failing` remains;
`src/rest/index.ts` is under 400 lines; all gates pass.

### `EP-M5` Behavioural feature, documentation, and delivery closure

Requirements: REQ-no-patch, all trace links.

1. Add `features/github3-client-compatibility.feature` and
   `tests/github3-client-compatibility.steps.ts` (reusing
   `tests/support/github3-contract-*.ts`).
2. Documentation:
   - `docs/users-guide.md`: new section "Using github3.py" (supported
     root-mounted setup, supported calls, `x-simulacat-actor` for
     `gh.repositories()`, body media types, unmodelled fields and their
     neutral values) and a "Breaking changes" entry "1.4.2 — GitHub-shaped
     repository, issue, and pull request payloads" listing D10. Mark Python
     fences as not executed by the guide-example harness, following
     `docs/developers-guide.md` §Executable guide examples.
   - `docs/developers-guide.md`: "GitHub client contract tests" (layout,
     `uv` environments, adding a scenario, egress guard, refreshing pins,
     Ruff) and "REST representations" (module boundary, adding a field,
     unmodelled-field policy).
   - `docs/architecture.md` §GitHub client compatibility: record D1, D2, D6,
     D7, D8 as design decisions and list the contract-tested workflows.
   - `docs/api-reference.md` §Capability matrix: update the repository,
     issue, and pull request rows; add `GET /users/{username}/repos`,
     `GET /user/repos`, and `GET /orgs/{org}`.
   - `docs/github-rest-api-audit.md` §Store and Modelling Constraints: the
     unmodelled-field policy.
   - `CHANGELOG.md`: entry following the existing version-heading
     convention.
   - `docs/roadmap.md`: mark 1.4.2 `[x]` with a one-line "Delivered" note.
3. Run the manual downstream check from `Validation and acceptance` and record
   the outcome.
4. Complete `Outcomes & retrospective`, reconcile upstream documents, set
   status `COMPLETE`.

## Milestones and plateaus

- `EP-M0`: harness and red baseline; REQ-matrix (partial); evidence: harness
  self-tests pass, workflow tests are strict expected failures. Recovery:
  revert the milestone commit; nothing else depends on it yet. Remaining: every
  workflow. Compatibility decision: none.
- `EP-M1`: repository lookup green on both lines; REQ-repo-read,
  REQ-boundary; evidence: contract tests, representation tests, properties.
  Recovery: revert; `projectRepositoryResponse` callers move in the same
  commit, so there is no half-migrated state. Remaining: listings, issues, pull
  requests. Compatibility decision: none (pre-1.0, D10).
- `EP-M2`: listings and organization lookup green; REQ-repo-list. Recovery:
  revert. Remaining: issues, pull requests. Compatibility decision: none.
- `EP-M3`: issue workflows green; REQ-issue-read. Recovery: revert.
  Remaining: pull requests. Compatibility decision: none.
- `EP-M4`: pull request workflows green; REQ-pr-read, REQ-matrix complete.
  Recovery: revert. Remaining: documentation and feature. Compatibility
  decision: none.
- `EP-M5`: documentation, BDD feature, roadmap tick; REQ-no-patch evidence.
  Recovery: documentation-only revert. Remaining: downstream adoption in
  simulacat (out of scope).

Conformance check at every boundary, one line each:

- Requirements assigned to the milestone are satisfied by passing evidence.
- Representations still import nothing from the forbidden list (lint green).
- No upstream assumption falsified (record otherwise and escalate).
- No change to `src/index.ts` exports, `simulation()` arguments, exported
  schema inputs, or npm dependencies.
- No new trust boundary beyond the Python child process (whose output is
  Zod-validated) and no persisted-format change.
- Trace links in `Conformance basis` still match test names.

## Concrete steps

Working directory: repository root. Use `set -o pipefail` in every shell that
pipes through `tee`. Log names follow
`/tmp/<action>-simulacat-core-1-4-2-move-common-payload-compatibility-into-core.out`.

One-time environment preparation (needs network):

```bash
bun install --frozen-lockfile
UV_CACHE_DIR=.uv-cache UV_PROJECT_ENVIRONMENT="$PWD/.uv-cache/github3-contract-v3" \
  uv sync --frozen --project tests/contracts/github3 --no-default-groups --group github3-v3
UV_CACHE_DIR=.uv-cache UV_PROJECT_ENVIRONMENT="$PWD/.uv-cache/github3-contract-v4" \
  uv sync --frozen --project tests/contracts/github3 --no-default-groups --group github3-v4
```

Focused loops per milestone (examples):

```plaintext
Red:   bun test tests/rest-repository-representation.test.ts
       -> fails: Cannot find module '../src/rest/representations/repository.ts'
Red:   bun test tests/github3-contract.test.ts
       -> repository lookup (3.x/4.x) pass as expected failures (IncompleteResponse 'network_count')
Green: bun test tests/rest-repository-representation.test.ts tests/github3-contract.test.ts
       -> all pass after removing .failing from the repository lookup tests
```

Gate sequence after each milestone, sequential, never in parallel:

```bash
set -o pipefail
make check-fmt  2>&1 | tee /tmp/check-fmt-simulacat-core-1-4-2-move-common-payload-compatibility-into-core.out
make typecheck  2>&1 | tee /tmp/typecheck-simulacat-core-1-4-2-move-common-payload-compatibility-into-core.out
make docs-check 2>&1 | tee /tmp/docs-check-simulacat-core-1-4-2-move-common-payload-compatibility-into-core.out
make lint       2>&1 | tee /tmp/lint-simulacat-core-1-4-2-move-common-payload-compatibility-into-core.out
make test       2>&1 | tee /tmp/test-simulacat-core-1-4-2-move-common-payload-compatibility-into-core.out
make spelling   2>&1 | tee /tmp/spelling-simulacat-core-1-4-2-move-common-payload-compatibility-into-core.out
```

When Markdown changes (`EP-M5`, and this plan): `make markdownlint` and
`make nixie` (the latter only if a Mermaid diagram is added). Prefer delegating
the full gate run to the `scrutineer` agent.

## Validation and acceptance

Acceptance is behavioural:

- `bun test tests/github3-contract.test.ts` reports, for each of `3.2.0` and
  `4.0.1`: repository lookup, `repositories_by`, organization listing, actor
  listing, actor-less listing failure, `issue`, `issues`, `gh.issue`,
  `pull_request`, `pull_requests`, `gh.pull_request`, and missing-resource
  lookups all passing with value assertions, plus the two harness self-tests.
  Each workflow test was a strict expected failure at `EP-M0`.
- `make test` passes with the new feature's six scenarios.
- Starting the example server and running
  `curl -s -H 'Accept: application/vnd.github.v3.full+json' "$BASE/repos/frontside/test-repo/issues/1"`
  shows `body`, `body_text`, `body_html`, `assignees: []`, a full `user`
  object, and no `owner`/`repo` keys.
- Manual downstream check (not committed, scratch only): in a scratch copy of
  simulacat, delete the `repos/get`, `repos/list-for-user`, `issues/get`,
  `pulls/get`, and `orgs/get` patches, point its simulator dependency at a
  `bun pm pack` tarball of this branch, seed issues and pull requests in
  `tests/test_github3_compat.py`'s configuration, and run that file under
  `github3.py` 3.2.0 and 4.0.1. Expected: the four in-scope tests pass. Record
  the transcript in `Artefacts and notes`; if simulacat's own scenario plumbing
  blocks the check (for example `include_unsupported=False` dropping issues),
  record that as a downstream finding rather than a core failure.

Quality criteria:

- Tests: `make test` green; no `.failing` markers remain.
- Verification: every obligation in `Verification plan` discharged with its
  non-vacuity evidence recorded; seeded mutations reverted.
- Lint and types: `make check-fmt`, `make typecheck`, `make docs-check`,
  `make lint`, `make spelling`, `make markdownlint` green.
- Security: no served URL leaves the simulator; the egress guard self-test
  passes.

## Idempotence and recovery

All steps are re-runnable. `uv sync --frozen` is idempotent; delete
`.uv-cache/github3-contract-v*` to rebuild an environment. The contract harness
owns its child process group and kills it on timeout or test teardown, so an
interrupted run leaves no stray Python or server processes; if one does, stop
only processes whose command line contains
`tests/contracts/github3/workflows.py` and that this session started. Seeded
mutations for non-vacuity are made in the working tree only and reverted with
`git checkout -- <file>` before committing. Each milestone is one or more
commits that pass every gate; roll back with `git revert`.

## Artefacts and notes

Planning probe at `c2e5ddc` (scratch files under `/tmp/gh3probe`, not
committed), CPython 3.14.7, both lines identical:

```plaintext
FAIL repository        IncompleteResponse KeyError('network_count')
OK   repositories_by   ['octocat/Hello-World']
FAIL org.repositories  AuthenticationFailed 401 Bad credentials   (request reached api.github.com)
OK   user repositories ['octocat/Hello-World']
FAIL gh.issue          IncompleteResponse KeyError('assignee')
FAIL gh.pull_request   IncompleteResponse KeyError('active_lock_reason')
RAW /repos/frontside/test-repo/issues/1 keys: body closed_at created_at html_url id node_id number owner repo
    repository_url state title updated_at url user
RAW /repos/frontside/test-repo/pulls/2 keys: base body closed_at created_at draft head html_url id issue_number
    issue_url mergeable merged_at node_id number owner repo state title updated_at url user
```

OpenAPI required-key counts from `schema/api.github.com.json`:
`full-repository` 75, `minimal-repository` 46, `issue` 20, `pull-request` 42,
`pull-request-simple` 31, `simple-user` 18. List routes reference
`minimal-repository` (`/users/{username}/repos`, `/orgs/{org}/repos`),
`repository` (`/user/repos`), and `pull-request-simple` (`/pulls`).

## Interfaces and dependencies

New internal module `src/rest/representations/` (not exported from
`src/index.ts`):

```typescript
// context.ts
export type BodyRepresentation = 'raw' | 'text' | 'html' | 'full';
export type RestRepresentationContext = Readonly<{
  baseUrls: BaseUrls;
  body: BodyRepresentation;
}>;

// account.ts
export const toRestSimpleUser: (account: ResolvedAccount, ctx: RestRepresentationContext) => RestSimpleUser;
export const syntheticAccountId: (login: string) => number;

// organization.ts
export const toRestOrganization: (organization: GitHubOrganization, ctx: RestRepresentationContext) => RestOrganization;

// repository.ts
export const toRestMinimalRepository: (
  repository: GitHubRepository, owner: ResolvedAccount, ctx: RestRepresentationContext
) => RestMinimalRepository;
export const toRestFullRepository: (
  repository: GitHubRepository, owner: ResolvedAccount, ctx: RestRepresentationContext
) => RestFullRepository;

// body.ts
export const negotiateBodyRepresentation: (accept: string | undefined) => BodyRepresentation;
export const escapeHtml: (text: string) => string;
export const toRestBodyFields: (body: string, representation: BodyRepresentation) => RestBodyFields;

// issue.ts
export const toRestIssue: (issue: GitHubIssue, related: IssueRelations, ctx: RestRepresentationContext) => RestIssue;

// pull-request.ts
export const toRestPullDestination: (
  destination: GitHubPullRequest['head'], related: DestinationRelations, ctx: RestRepresentationContext
) => RestPullDestination;
export const toRestPullRequestSimple: (
  pullRequest: GitHubPullRequest, related: PullRequestRelations, ctx: RestRepresentationContext
) => RestPullRequestSimple;
export const toRestPullRequest: (
  pullRequest: GitHubPullRequest, related: PullRequestRelations, ctx: RestRepresentationContext
) => RestPullRequest;
```

Store addition (`src/store/index.ts` or `src/store/account-selectors.ts`):

```typescript
export type ResolvedAccount =
  | Readonly<{kind: 'user'; user: GitHubUser}>
  | Readonly<{kind: 'organization'; organization: GitHubOrganization}>
  | Readonly<{kind: 'unseeded'; login: string}>;
// selectors: resolveAccount(state, login), listRepositoriesOwnedBy(state, login),
// listRepositoriesForUser(state, user)
```

`Rest*` output types are `Readonly` object types declared beside each function;
exhaustive `switch` over `ResolvedAccount['kind']` ends in a `never` guard.
Reuse policy: every REST route that emits a repository, account, issue, or pull
request uses these functions; no handler builds those shapes inline, and
GraphQL keeps its own converters (`src/graphql/converters`).

Handler files after the change: `src/rest/index.ts` (wiring and remaining
routes), `src/rest/repository-handlers.ts` (repository get, update, lists),
`src/rest/organization-handlers.ts`, `src/rest/issue-handlers.ts`,
`src/rest/pull-request-handlers.ts`.

Contract harness: `tests/support/github3-contract-client.ts`,
`tests/support/github3-contract-fixture.ts`,
`tests/contracts/github3/{pyproject.toml,.python-version,uv.lock,workflows.py,required-fields.json}`.

Dependencies: no npm changes. Python, test-only and locked: `github3.py==3.2.0`
and `github3.py==4.0.1` (with transitive `requests`, `uritemplate`,
`python-dateutil`, `PyJWT[crypto]`). Tooling: `ruff==0.17.5` via `uv tool run`.
Interpreter: CPython 3.14 managed by `uv`.

## Revision note

- 2026-11-15: Initial draft from Wyvern reconnaissance and a live
  `github3.py` probe. Awaiting community-of-experts review and user approval.
