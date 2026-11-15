# Move common github3.py payload compatibility into core (1.4.2)

This ExecPlan (execution plan) is a living document. The sections `Constraints`,
`Tolerances`, `Risks`, `Progress`, `Surprises & discoveries`, `Decision log`,
`Outcomes & retrospective`, `Conformance basis`, and `Verification plan` must
be kept up to date as work proceeds.

Status: DRAFT (community-of-experts review applied; awaiting user approval)

Branch: `1-4-2-move-common-payload-compatibility-into-core`

Roadmap item: `1.4.2` in `docs/roadmap.md` (§1.4 "Make GitHub client payloads
contract-tested"). It requires `1.4.1`, which is complete.

Implementation must not begin until the user explicitly approves this plan.
Approval of this plan is also asked to cover the decisions marked "needs user
confirmation" in `Decision log` (D3, D4, D11, D14).

## Purpose / big picture

Simulacat Core is an in-memory GitHub REST and GraphQL API simulator used as a
test double. Its most important downstream consumer, the Python pytest plugin
simulacat, hands tests a real `github3.py` client (`github3.GitHub`) pointed at
the simulator. `github3.py` does not tolerate thin payloads: when it turns a
JSON response into a Python object it indexes dozens of keys directly
(`json["network_count"]`, `json["assignee"]`, `json["merge_commit_sha"]`) and
raises `github3.exceptions.IncompleteResponse` when one is missing. To make its
tests pass today, simulacat wraps core routes with route-local "payload
patches" in its `src/github-sim-server.ts` that clone OpenAPI example payloads
and rewrite them.

A planning-time probe against base revision `c2e5ddc` showed what a
`github3.py` user sees today. With a seeded organization `frontside`, user
`octo`, repository `frontside/test-repo`, issue 1, and pull request 2, both
`github3.py` 3.2.0 and 4.0.1 behave identically:

```plaintext
gh.repository("frontside", "test-repo")       -> IncompleteResponse KeyError('network_count')
gh.repositories_by("frontside")               -> ['octocat/Hello-World']  (OpenAPI example, not state)
gh.repositories()  (GET /user/repos)          -> ['octocat/Hello-World']  (OpenAPI example, not state)
gh.organization("frontside").repositories()   -> 401 "Bad credentials" from the real api.github.com
gh.issue("frontside", "test-repo", 1)         -> IncompleteResponse KeyError('assignee')
gh.pull_request("frontside", "test-repo", 2)  -> IncompleteResponse KeyError('active_lock_reason')
repo.issues() / repo.pull_requests()          -> fail at the repository lookup first
```

The organization case is worse than a failure. `GET /orgs/{org}` still serves
an OpenAPI example whose `url` is `https://api.github.com/orgs/github`, and
`github3.py` builds the next request from that `url`, so the client silently
leaves the simulator and calls real GitHub with the test's token.

After this change, the same client calls succeed against an unpatched core for
both `github3.py` 3.x and 4.x, return objects built from seeded state, and stay
on the simulator for every follow-up request:

```python
gh = github3.GitHub(token="local")
gh.session.base_url = simulator_base_url            # root-mounted, no /api/v3
gh.session.headers["x-simulacat-actor"] = "user:octo"

repo = gh.repository("frontside", "test-repo")      # github3.repos.Repository
[r.full_name for r in gh.repositories_by("octo")]   # seeded public repositories owned by octo
[r.full_name for r in gh.organization("frontside").repositories()]
[r.full_name for r in gh.repositories()]            # actor-scoped GET /user/repos
issue = repo.issue(1)                               # body, body_text, body_html present
pull = repo.pull_request(2)                         # head/base carry nested repositories
gh.repository("frontside", "missing")               # raises github3.exceptions.NotFoundError
```

The work is proven by a contract-test suite that drives the real `github3.py`
3.2.0 and 4.0.1 libraries from `bun test`, by table and property tests over
pure REST representation functions, and, subject to approval, by a LemmaScript
proof of the HTML-escaping and media-type selection logic. Success for the
roadmap item is that simulacat no longer needs route-local payload patches for
the supported repository, issue, and pull request read workflows; core
demonstrates this from its own side (D9).

Terms used throughout:

- *Payload patch*: downstream code that rewrites a core response before the
  client sees it.
- *Representation*: the GitHub-shaped JSON object returned for one resource,
  named after GitHub's OpenAPI component schema (for example `full-repository`,
  `minimal-repository`, `pull-request-simple`).
- *Representation function*: a pure function that maps stored entities plus a
  request context to a representation.
- *Unmodelled field*: a field `github3.py` or GitHub's schema requires that
  describes state the simulator does not model yet (labels, assignees,
  milestones, review counts). Core emits a documented neutral value.
- *Client line*: one major version of `github3.py`; this plan covers the 3.x
  line (pinned to 3.2.0) and the 4.x line (pinned to 4.0.1).
- *Contract test*: a test that runs the real third-party client library
  against the simulator and asserts what the client observes.
- *Request actor*: the simulated caller, selected by the request header
  `x-simulacat-actor: user:<login>` (see `docs/users-guide.md` §Request actors).
  `GET /user/repos` uses it.
- *Egress*: any network connection leaving the test machine's loopback
  interface.

Preserved behaviour: URL derivation from 1.4.1 (request host plus API root;
explicit seeded overrides win), the 404 behaviour of existing item routes, the
`PATCH /repos/{owner}/{repo}` write path, GraphQL output, actor resolution, and
the public store selectors reachable through `simulationStore.selectors`.
Deliberately changed behaviour is listed in D10.

## Constraints

1. Approval gate: no implementation before the user approves this plan.
2. Pre-1.0 package (`simulacat-core` 0.6.x). No compatibility shims, aliases,
   or dual REST shapes are introduced for the old payloads; callers and tests
   change together, and the breaking changes are documented instead.
3. Public TypeScript API: `src/index.ts` exports do not change. Exported entity
   schemas keep their input shape and gain no fields. Public store selectors
   (`getRepositoryWithOwner`, `allReposWithOrgs`, and the rest of
   `simulationStore.selectors`) keep their behaviour; REST stops using the
   owner-shaping ones but they are not removed.
4. Hexagonal boundary (protect, do not transplant). Stored entities and
   selectors in `src/store/` are the domain and query side and own identity,
   including synthetic account identity. REST representation functions in
   `src/rest/representations/` are pure: they take already-resolved records
   plus a request context, may use only `import type` from `src/store/**`, and
   must not import `express`, `openapi-backend`,
   `@simulacrum/foundation-simulator`, `starfx`, Node built-ins, or any store
   action or reducer. Route handlers in `src/rest/` remain the only code that
   touches the request, the store, and the response.
5. URL policy from 1.4.1 is reused, not reimplemented: every URL in a new
   representation comes from `src/urls/` projectors or `buildUrl` with the
   request `BaseUrls` from `src/http/request-url.ts`. Non-API URLs (`git_url`,
   `ssh_url`, `clone_url`, `svn_url`, `mirror_url`, `avatar_url`) keep their
   1.4.1 classification.
6. No served URL may point at `api.github.com`, `github.com` API paths, or
   `localhost:3300` unless a fixture seeded it explicitly.
7. Privacy: account representations are allow-lists. A stored user's `email`,
   `name`, `bio`, and `organizations` never appear in a nested simple-user
   object; only `GET /users/{username}` may expose public profile fields, and
   then only those listed in `Plan of work` `EP-M2`.
8. Code-quality gates from `docs/developers-guide.md` §Linting rules: functions
   at most 70 lines, at most 4 parameters, cognitive complexity at most 8,
   nesting at most 3, at most one logical operator per predicate; files at most
   400 lines (`AGENTS.md`); every file starts with an `@file` block; exported
   functions carry JSDoc with examples; no new `.jsdoc-baseline.json` entries;
   en-GB-oxendict spelling in prose and comments.
9. Test-first. Every behavioural change follows Red-Green-Refactor with
   `bun test` (evidence rules in D15 and `Validation and acceptance`). No
   expected-failure markers or red assertions remain at completion.
10. Existing assertions are strengthened, never weakened.
11. The Python toolchain is test-only. Nothing Python ships in the npm package
    (`package.json` `files` is unchanged) and no runtime dependency is added.
12. `bun test` never performs network access: Python environments are created
    only by `make contracts-sync`, and the contract driver blocks egress
    (INV-no-egress).
13. Historical ExecPlans in `docs/execplans/` other than this file are not
    edited.
14. The simulacat repository is not modified by this plan; any downstream issue
    or PR in simulacat requires separate user authorization.

If satisfying the objective requires violating a constraint, stop, record the
conflict in `Decision log`, set the status to `BLOCKED`, and escalate.

## Tolerances (exception triggers)

Comparison base: `c2e5ddc` (`git merge-base HEAD origin/main` at planning
time). Every count excludes ExecPlan files, including this one, and these
generated files: `tests/contracts/github3/uv.lock`, `bun.lock`, `typos.toml`,
`src/__generated__/**`, and LemmaScript `*.dfy.gen` files.

Classification, by whole file unless stated:

- Code: `src/**/*.ts`, `tests/**` except
  `tests/contracts/github3/pyproject.toml` and
  `tests/contracts/github3/.python-version`, `features/**`, and the recipe
  hunks of `Makefile`. LemmaScript proof files (`src/**/*.dfy`) are code with
  their own sub-limit.
- Configuration: `.oxlintrc.json`, `biome.json`, `package.json`, `.gitignore`,
  `.github/**`, `typos.local.toml`, `LemmaScript-files.txt`,
  `tests/contracts/github3/pyproject.toml`,
  `tests/contracts/github3/.python-version`, and non-recipe hunks of `Makefile`
  (variables and `.PHONY`).
- Documentation: `docs/**` except `docs/execplans/**`, `CHANGELOG.md`, and
  `README.md`.

Counting command (net lines = additions minus deletions):

```bash
git diff --numstat c2e5ddc -- . \
  ':!docs/execplans/**' ':!tests/contracts/github3/uv.lock' ':!bun.lock' \
  ':!typos.toml' ':!src/__generated__/**' ':!**/*.dfy.gen' \
  | awk '{print $1-$2, $3}'
```

Budgets, enforced independently (spare capacity in one category never offsets
another):

- Files: more than 65 non-ExecPlan files changed or added → stop and escalate.
- Code: more than 3,100 net lines, excluding proof files → stop and escalate.
  Sub-limits: production TypeScript under `src/` above 1,250 net lines, or
  proof files (`*.dfy`) above 350 net lines → stop and escalate. No single
  milestone may add more than 800 net code lines. If cumulative net code
  exceeds 1,700 lines when `EP-M2` closes, stop and re-plan before `EP-M3`.
- Configuration: more than 170 net lines → stop and escalate.
- Documentation: more than 600 net lines → stop and escalate.
- File size: any touched file above 400 lines after its milestone → stop and
  split before continuing; `src/store/index.ts` must end at or below 400 lines
  by the end of `EP-M1` (GAP-store-index-size) and `src/rest/index.ts` by the
  end of `EP-M4` (GAP-rest-index-size), and neither may grow before then.
- Interface: any change to `src/index.ts` exports, to the `simulation()`
  argument shape, to an exported entity schema's input, or to a public store
  selector's behaviour → stop and escalate.
- Dependencies: any npm dependency change other than the approval-gated
  `lemmascript@0.5.22` dev dependency (D11), or any Python dependency other than
  `github3.py==3.2.0`, `github3.py==4.0.1`, and `ruff==0.17.5` (each with its
  transitive closure in `uv.lock`) → stop and escalate.
- Architecture: if a representation needs to read the store, the request, or
  the response directly, or a stored entity schema must gain fields → stop and
  escalate.
- Scope: if a supported `github3.py` workflow needs a route not named in
  `Plan of work` → stop and escalate.
- Iterations: if a milestone's focused tests still fail after 3 focused fix
  attempts → stop and escalate with the failing output.
- Time: if a milestone takes more than 4 hours of active work, excluding
  queueing for compile slots or CI → stop and escalate. The `EP-M0` server-log
  spike is time-boxed separately to 1 hour, and `EP-M3P` proof iteration to 4
  hours.
- Ambiguity: if `github3.py` 3.x and 4.x disagree about a field in a way the
  generated manifest did not predict → stop and present options.

Budget rationale is in `Context and orientation` §Budget survey.

## Risks

- Risk: the first `make contracts-sync` needs network access to PyPI (and to
  the CPython download mirror if CPython 3.14 is not cached). Severity: medium.
  Likelihood: medium. Mitigation: syncing is a separate Make target, run as a
  prerequisite of `make test` and as an explicit CI step; once synced it is
  idempotent and needs no network (`uv sync --locked` against cached wheels).
  The harness never syncs; if an environment is missing it fails fast with a
  message naming `make contracts-sync`. Silent skipping is rejected because it
  would make the contract vacuous (D4).
- Risk: the probe logged `Error: "nullable" cannot be used without "type"`
  from `ajv` and one run saw `ConnectionResetError` on
  `GET /repos/{owner}/{repo}/pulls/{n}`; a re-run did not reproduce it.
  Hypotheses: the foundation simulator's `postResponseHandler` compiles a
  response schema lazily for handlers that *return* `{status, json}` (the
  installation and organization-repository routes), or a Bun `node:http`
  keep-alive race. Severity: medium. Likelihood: medium. Mitigation: the
  `EP-M0` spike (1-hour box) runs the client batch 50 times under `bun test`
  and records which route logs the error; the contract suite fails if the
  simulator writes to `console.error`. No client-side retries are added.
  Representation-backed handlers all write with `response.json()` (D13).
- Risk: Bun's default per-test and per-hook timeout is 5 seconds; a slow
  Python start on a busy host would time out a hook while its promise keeps
  running. Severity: high. Likelihood: medium. Mitigation: the observation
  batch runs once per client line in a `beforeAll` with an explicit 120-second
  timeout (the pattern in `tests/documentation-examples.steps.ts`); the child
  deadline is 60 seconds and process-group shutdown at most 7 seconds, both
  below the hook timeout; individual tests only read memoized results.
- Risk: the egress guard is bypassed by inherited lowercase proxy variables,
  `ALL_PROXY`, or a leaked `localhost:3300` URL reaching another agent's
  simulator. Severity: high. Likelihood: medium. Mitigation: the child
  environment is built from an allow-list; the primary guard is a Python audit
  hook that permits connections only to `127.0.0.1:<simulator port>`; proxy
  variables are a second layer; the self-test probes `https`, `http`, and
  `http://localhost:3300`.
- Risk: `@aboviq/bun-test-cucumber` 0.2.0 has no `Scenario Outline` support.
  Severity: low. Likelihood: certain. Mitigation: each scenario covers both
  client lines in its steps.
- Risk: oxlint may not support a path-scoped `no-restricted-imports`
  override. Severity: low. Likelihood: medium. Mitigation: fall back to a
  `bun test` fitness function that parses import specifiers in
  `src/rest/representations/**` (record in `Decision log`).
- Risk: breaking payload changes (D10) surprise consumers reading leaked
  internal keys or relying on OpenAPI-example listings. Severity: low.
  Likelihood: low. Mitigation: users-guide "Breaking changes" and CHANGELOG
  entries land in the milestone that makes each change; GraphQL is unaffected
  because it reads store entities.
- Risk: representation functions with 40-plus fields collide with the 70-line
  and complexity limits. Severity: low. Likelihood: high. Mitigation: compose
  each representation from small field-group helpers (URL group, lifecycle
  group, relation slots).
- Risk: `src/rest/index.ts` (403 lines) and `src/store/index.ts` (427 lines)
  already exceed 400 lines. Severity: low. Likelihood: certain. Mitigation:
  `EP-M1` moves owner-resolution helpers into `src/store/account-selectors.ts`;
  `EP-M2` to `EP-M4` move handlers out of `src/rest/index.ts`.
- Risk: synthetic account IDs collide with seeded IDs (seeded user IDs default
  to random `faker` values of at least 1000; organizations to 4000-9,999,999).
  Severity: medium. Likelihood: low. Mitigation: synthetic IDs live in
  `[2^40, 2^41)`, are derived from a SHA-256 of the login, and are re-derived
  with a salt counter if they equal a seeded ID (INV-account-resolution).
- Risk: the LemmaScript toolchain (tech preview) cannot model the escaping
  function's string handling. Severity: medium. Likelihood: medium. Mitigation:
  the proof milestone is approval-gated and time-boxed, with a defined fallback
  (the written prefix-code proof plus exhaustive finite checks), recorded in
  D11.
- Risk: the contract suite lengthens `make test`. Severity: low. Likelihood:
  high. Mitigation: two Python processes per `bun test` run (one per client
  line), shared by the contract test file and the feature steps; expected
  overhead under 10 seconds once synced.

## Progress

- [x] (2026-11-15 21:10Z) Branch renamed; Lody session titled.
- [x] (2026-11-15 21:40Z) Wyvern reconnaissance: simulacat patch inventory,
  `github3.py` 3.2.0/4.0.1 field requirements, core REST builders, tooling and
  plan history.
- [x] (2026-11-15 22:00Z) Planning probe: real `github3.py` 3.2.0 and 4.0.1
  against the simulator at `c2e5ddc` (transcript in `Artefacts and notes`).
- [x] (2026-11-15 22:30Z) Initial draft written and committed.
- [x] (2026-11-15 23:30Z) Community-of-experts design review (structure and
  contracts, failure modes and operations, verification, alternatives and
  viability) applied; see `Revision note`.
- [ ] Plan approved by the user (including D3, D4, D11, D14).
- [ ] `EP-M0` Contract harness, manifest, and red baseline.
- [ ] `EP-M1` Account and repository representations; repository lookup.
- [ ] `EP-M2` Repository listings, organization lookup, and user lookup.
- [ ] `EP-M3` Body media types and issue representation.
- [ ] `EP-M3P` LemmaScript proof of escaping and media-type selection
  (approval-gated).
- [ ] `EP-M4` Pull request representation.
- [ ] `EP-M5` Delivery closure.

## Surprises & discoveries

- Observation: `GET /orgs/{org}`, `GET /users/{username}`,
  `GET /users/{username}/repos`, and `GET /user/repos` have no core handler and
  serve OpenAPI examples. Evidence: probe output (`/users/frontside/repos`
  returns `octocat/Hello-World`; `/orgs/frontside` returns login `github`);
  `src/rest/index.ts` registers no handler for those operation IDs. Impact:
  repository listing is not state-backed today; `EP-M2` adds handlers.
- Observation: `github3.py` builds `Organization.repositories()` from the
  organization's `url` (`self._api`), not from `repos_url` (`orgs.py:779` in
  4.0.1), so the stubbed organization payload sends the client to real GitHub.
  Evidence: probe returned `401 Bad credentials` and, anonymously,
  `403 API rate limit exceeded for <public IP>`. Impact: motivates
  INV-no-egress and the organization and user lookup handlers (D3).
- Observation: issue and pull request REST payloads are raw store entities;
  they leak internal `owner`, `repo`, and `issue_number` keys and carry
  `user: {login}` only. Stored pull request `state` is
  `open | closed | merged`, and today REST serves `state: "merged"`, which
  GitHub never does. Evidence: probe `RAW` key lists;
  `src/store/entities/pull-request.ts` line
  6. Impact: D10, INV-pr-lifecycle.
- Observation: `github3.py` 3.2.0 and 4.0.1 read identical field sets for
  every class in scope (only line numbers move). Impact: one manifest serves
  both lines, but it is generated per line and compared (INV-manifest), so a
  divergence would be caught; the two-line matrix still runs because behaviour,
  not just field reads, could diverge.
- Observation: a 404 makes `github3.py` raise `NotFoundError`; it does not
  return `None` (`models.py:159-161`: `_json` calls `error_for` for any status
  of 400 or above). Impact: unhappy-path scenarios assert `NotFoundError`.
- Observation: the foundation simulator validates objects that handlers
  *return* against the OpenAPI response schema and answers 502 on mismatch;
  handlers that call `response.json()` bypass that validation
  (`@simulacrum/foundation-simulator` `postResponseHandler`; comment at
  `src/rest/index.ts` line 370). Impact: D13.
- Observation: `simulation().listen(0)` passes its arguments straight to
  `server.listen`, so without a host it listens on all interfaces. Impact: the
  harness calls `listen(0, '127.0.0.1')`.
- Observation: both client lines import and run under CPython 3.14.7; the
  host has `uv` 0.13.2 and Dafny 4.11.0. Impact: one interpreter pin serves
  both environments; a LemmaScript proof is feasible locally.
- Observation: running `make spelling` on this host regenerates `typos.toml`
  from the shared dictionary (a tokio attribute pattern). The refresh is
  committed separately at the base of this branch. Impact: none on scope; the
  PR description calls it out.

## Decision log

- D1. Decision: put REST representations in a new internal module
  `src/rest/representations/`, as pure functions over resolved records, and
  keep handlers as thin adapters. Rationale: the store is the domain and query
  side; the REST JSON shape is an adapter concern. Pure functions are table-,
  property-, and proof-testable without a server and give GraphQL no reason to
  change. Rejected: adding `github3.py`-only fields to stored entity schemas
  (leaks a transport contract into the domain and changes exported schemas,
  Constraint 3). Owner and account shaping currently in
  `src/rest/repository-handlers.ts` moves into the module rather than being
  duplicated. Date/Author: 2026-11-15, planning agent.
- D2. Decision: three repository levels and one representation per GitHub
  schema family, chosen per route from the bundled OpenAPI description:
  `minimal-repository` for `GET /users/{username}/repos` and
  `GET /orgs/{org}/repos`; `repository` for `GET /user/repos`, both
  installation routes, and pull request `head.repo`/`base.repo`;
  `full-repository` for `GET /repos/{owner}/{repo}` and `PATCH` responses;
  `issue` for issue reads; `pull-request` for `GET …/pulls/{n}`;
  `pull-request-simple` for `GET …/pulls`; `simple-user` for every nested
  account; `organization-full` for `GET /orgs/{org}`; `public-user` for
  `GET /users/{username}`. Each repository level is a superset of the one below
  (`minimal ⊂ repository ⊂ full`). An unseeded head repository is emitted as
  `head.repo: null`, a deliberate deviation from the schema (GitHub does the
  same for deleted forks; `github3.py` tolerates it). Rationale: matches the
  OpenAPI components and the `github3.py` class split
  (`ShortRepository`/`Repository`, `ShortPullRequest`/`PullRequest`).
  Date/Author: 2026-11-15, revised after review.
- D3. Decision (needs user confirmation): include `GET /orgs/{org}` and
  `GET /users/{username}` (state-backed) in scope. Rationale:
  `gh.organization(org).repositories()` cannot work without a state-backed
  organization whose `url` points at the simulator, and today it escapes to
  real GitHub. `GET /users/{username}` is not called by the core read
  workflows, but once owners carry simulator URLs, `repo.owner.refresh()` or
  `gh.user(login)` would fetch the OpenAPI example whose `url` points at
  `api.github.com`, and the next call would leave the simulator. Adding it
  costs about 60 lines on top of the account representation, closes the last
  egress path in these workflows, and lets simulacat drop every patch in this
  family. Rejected: leaving it as a simulacat patch with an "unsupported"
  capability row (keeps a known egress path open). Date/Author: 2026-11-15,
  revised after review.
- D4. Decision (needs user confirmation): run the `github3.py` contract tests
  inside `make test`, with `make contracts-sync` as its prerequisite and the
  only network step; fail loudly rather than skip when an environment is
  missing. Rationale: the user's milestone gates name `make test`; keeping the
  real-client contract inside it means every milestone gate exercises it. The
  strongest alternative (a separate `make test-contracts` target included in
  `make all` and run as a required CI matrix job, keeping `make test` Bun-only
  and offline) is described in `Context and orientation` §Alternatives
  considered; it is a reasonable choice if the user prefers `make test` to stay
  Bun-only. Date/Author: 2026-11-15, revised after review.
- D5. Decision: model the Python side as a non-package `uv` project at
  `tests/contracts/github3/` with three dependency groups —
  `github3-v3 = ["github3.py==3.2.0"]`, `github3-v4 = ["github3.py==4.0.1"]`
  (declared as conflicting), and `lint = ["ruff==0.17.5"]` — a committed,
  hash-locked `uv.lock`, and per-group environments under
  `tests/contracts/github3/.venv/` selected with `UV_PROJECT_ENVIRONMENT`.
  Syncs use `--locked`, so a stale lock fails rather than being silently
  ignored. Tests invoke each environment's interpreter directly
  (`.venv/github3-v3/bin/python -I -u`), never `uv run`. Rationale: exact,
  hash-locked, reproducible resolution with one manifest; 3.2.0 and 4.0.1 are
  the final releases of their lines (PyPI index at planning time). Environments
  under `.venv/` survive `uv cache clean` and are not indexed by CodeGraph.
  Rejected: ad hoc `uv run --with` (unlocked) and two separate projects
  (duplicated manifests). Date/Author: 2026-11-15, revised after review.
- D6. Decision: honour GitHub body media types on issue and pull request
  routes (items and lists). Recognized tokens are
  `application/vnd.github[.v3].{raw,text,html,full}+json`, matched
  case-insensitively, with media-type parameters ignored. The selected
  representation is that of the first recognized token in header order whose
  quality value is not `q=0`; other quality values are ignored (a documented
  simplification). No recognized token yields `raw`. `full` emits `body`,
  `body_text`, and `body_html`; `text` emits `body_text`; `html` emits
  `body_html`; `raw` emits `body`. `body_text` is the stored body verbatim;
  `body_html` is the stored body escaped with the five-entity HTML escape and
  wrapped in `<p>…</p>`, or the empty string for an empty body. Rationale: this
  is GitHub's documented contract (REST "Get an issue" media types, confirmed
  with Firecrawl), and `github3.py` always sends
  `application/vnd.github.v3.full+json` (`session.py:106`). Rejected:
  simulacat's always-emit approach (other clients would receive fields GitHub
  never sends) and Markdown rendering (new runtime dependency; escaping is
  enough for client contracts and safe if a consumer renders it). Date/Author:
  2026-11-15, revised after review.
- D7. Decision: unmodelled fields come from one constants module
  (`src/rest/representations/unmodelled-fields.ts`) and reach representations
  through *relation slots* that handlers fill. `IssueRelations` carries
  `labels`, `assignees`, `milestone`, and `closedBy`; `PullRequestRelations`
  additionally carries `requestedReviewers`, `requestedTeams`, `mergedBy`, and
  review counters. Neutral values: `labels: []`, `assignee: null`,
  `assignees: []`, `milestone: null`, `comments: 0`, `locked: false`,
  `active_lock_reason: null`, `closed_by: null`, `requested_reviewers: []`,
  `requested_teams: []`, `merge_commit_sha: null`, `merged_by: null`,
  `review_comments: 0`, `commits: 0` (GitHub never reports zero; documented as
  unmodelled), `additions: 0`, `deletions: 0`, `changed_files: 0`,
  `auto_merge: null`, `maintainer_can_modify: false`, `rebaseable: null`;
  organization `followers: 0`, `following: 0`, `public_gists: 0`,
  `archived_at: null`, `has_organization_projects: true`,
  `has_repository_projects: true`. Cheaply derivable fields are derived, not
  defaulted: `mergeable_state` from stored `mergeable` (`null` → `unknown`,
  `true` → `clean`, `false` → `dirty`); `author_association` is `OWNER` when
  the author's login equals the repository owner's login, else `NONE`;
  organization `public_repos` is the count of public repositories it owns
  (computed by a selector and passed in); repository `network_count` equals
  `forks_count` and `subscribers_count` equals `watchers_count` (the store has
  no separate counters, and Zod strips unknown seeded keys). Rationale:
  `github3.py` requires the keys; inventing state would mislead tests. Relation
  slots mean later slices (labels 1.5.x, mergeability phase 5, review state
  phase 6, issue collaboration phase 8) change selectors, not representation
  signatures. Each constant's JSDoc names its future owner. Date/Author:
  2026-11-15, revised after review.
- D8. Decision: the store owns account identity. A new selector
  `resolveAccount(state, login)` in `src/store/account-selectors.ts` returns a
  discriminated union: seeded organization (checked first, so an organization
  wins when a login is seeded as both, matching today's owner resolution),
  seeded user, or unseeded login with a synthetic `id` and `node_id`. Synthetic
  IDs are `2^40 + (first 40 bits of SHA-256(login))`, re-derived with an
  incrementing salt while they equal a seeded account ID; `node_id` is
  `base64("User:<login>")`. Representations never mint identity. Rationale:
  issue and pull request schemas default `user` to `octocat`, which fixtures
  rarely seed, and `github3.py` indexes `user["avatar_url"]`. Minting in the
  store keeps REST and any future GraphQL rendering of the same unseeded author
  consistent. IDs below 2^41 stay below 2^53, so they are exact in JavaScript
  and Python. Date/Author: 2026-11-15, revised after review.
- D9. Decision: core proves the success criterion from its side. The contract
  suite reproduces every simulacat-patched workflow in scope (repository
  lookup, user and organization repository listing, organization and user
  lookup, issue and pull request retrieval with rich body fields) against
  unpatched core and asserts values, not just types. A manual downstream check,
  described in `Validation and acceptance`, runs simulacat's compatibility
  tests against a packed build of this branch in a scratch copy; it is
  recorded, not committed. Filing a simulacat issue needs user approval
  (Constraint 14). Rationale: simulacat currently depends on
  `@simulacrum/github-api-simulator` 0.8.0, not this package; adoption is
  simulacat's own roadmap (its `docs/roadmap.md` step 5.1 names this task as a
  prerequisite). Date/Author: 2026-11-15, planning agent.
- D10. Decision: accept these pre-1.0 breaking REST changes without shims:
  issue and pull request payloads stop exposing internal `owner`, `repo`, and
  `issue_number`; their `user` becomes a `simple-user` object; pull request
  `state` is `open` or `closed` with `merged: true` for stored merged pull
  requests (previously `state: "merged"`); `head`/`base` gain `label`, `user`,
  and `repo` and lose their internal `owner`/`repo` strings;
  `GET /users/{username}/repos`, `GET /user/repos`, `GET /orgs/{org}`, and
  `GET /users/{username}` return seeded state (404 or 401 where GitHub would)
  instead of OpenAPI examples; `GET /orgs/{org}/repos` returns
  `minimal-repository` items, a JSON 404 body instead of plain text, and
  GitHub's default order; repository owners in REST payloads are `simple-user`
  objects (organization owners lose organization-only keys such as
  `members_url`, matching GitHub). Rationale: Constraint 2; the old shapes are
  not GitHub's and are what forced downstream patching. Date/Author:
  2026-11-15, revised after review.
- D11. Decision (needs user confirmation): add an approval-gated LemmaScript
  milestone, `EP-M3P`, proving the two pieces of contractual business logic
  that range over unbounded inputs: the HTML escape (no raw `<`, `>`, `"`, `'`
  in the output; every `&` starts one of the five entities; a single-pass
  decode inverts it) and media-type selection over a parsed token list
  (totality; the result is the first acceptable recognized token, else `raw`).
  The pull request lifecycle needs no prover: its domain is finite and is
  enumerated exhaustively (54 rows), which is a complete proof by cases. The
  Accept-header tokenizer stays outside the proof (string-splitting code best
  covered by properties) and is tied to the proved selector by a correspondence
  test. Approval covers adding `lemmascript@0.5.22` as a dev dependency, a
  `LemmaScript-files.txt`, a `make proofs` target included in `make all`, and
  installing Dafny 4.x in CI. If approval is refused, the substitute is the
  written prefix-code proof in `Verification plan` plus its finite exhaustive
  checks, and the refusal is recorded here. Rationale: the user's standing
  requirement is an exhaustive proof for contractual business logic; escaping
  and selection qualify; Dafny 4.11 is already on the host. Date/Author:
  2026-11-15, revised after review.
- D12. Decision: lint and format the Python driver with `ruff==0.17.5` from
  the hash-locked `lint` group, wired into `make check-fmt`, `make lint`, and
  `make fmt`; no Python type checker. Rationale: keeps the "no lint or format
  violations" bar for every language in the repository; a type checker for one
  ~200-line test driver is disproportionate because the TypeScript side
  validates its output with Zod and owns every assertion. The `ruff-016` skill
  documents Ruff 0.16; 0.17.5 is pinned because it is current, and any rule
  renames are handled in the pyproject. Date/Author: 2026-11-15, revised after
  review.
- D13. Decision: every representation-backed handler writes its body with
  `response.status(...).json(...)`; none returns `{status, json}` for
  foundation-level OpenAPI response validation. The installation routes and
  `GET /orgs/{org}/repos`, which currently return objects, move to the same
  convention. Rationale: one convention; representation conformance is verified
  by this plan's tests against the OpenAPI components (and later by roadmap
  9.5.3), and the foundation's lazy validation is the leading suspect for the
  `ajv` error. The `EP-M0` spike confirms or refutes this before it is applied.
  Date/Author: 2026-11-15, planning agent after review.
- D14. Decision (needs user confirmation): follow GitHub's default list order
  for repository listings (`/users/{username}/repos` and `/user/repos` by
  `full_name` ascending; `/orgs/{org}/repos` by `created_at` descending, ties by
  `full_name`); `/users/{username}/repos` returns public repositories only;
  listing query parameters (`type`, `sort`, `direction`, `visibility`,
  `affiliation`, `per_page`, `page`) are ignored, and lists are a single page
  without a `Link` header. Issue and pull request list filtering and order are
  unchanged (all seeded entries, insertion order; pull requests do not appear
  in the issue list). Rationale: deterministic and GitHub-faithful for the new
  routes; filtering, sorting parameters, and pagination belong to roadmap 9.5.1
  and issue collaboration work, and changing issue and pull request list
  semantics is outside "payload compatibility". Date/Author: 2026-11-15,
  planning agent after review.
- D15. Decision: red evidence. Contract workflows are red in git: before a
  milestone's green change, each workflow's test asserts the *expected failure*
  from the structured observation (for example
  `errorType === "IncompleteResponse"` and a message naming `network_count`),
  and the green change replaces that with value assertions. Unit and property
  tests are red by a recorded run before the green change; to keep red
  meaningful, each milestone first adds the new module with its exported
  signatures throwing a `NotImplementedError`, so the red run fails on that
  error rather than on an import error. Every commit passes all gates.
  Rationale: Bun's `test.failing` passes on any exception, including harness
  breakage, so it cannot distinguish "red for the right reason". Date/Author:
  2026-11-15, revised after review.

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
`notImplemented` handler, which returns an example payload from the OpenAPI
document. That is why `/users/{username}/repos` returns `octocat/Hello-World`.
Handlers that *return* `{status, json}` are validated by the foundation's
`postResponseHandler` (502 on mismatch); handlers that call
`response.json(...)` are not.

Handlers today:

- `repos/get` and `repos/update` live in `src/rest/repository-handlers.ts`.
  `projectRepositoryResponse` (lines 104-122) reshapes the owner using owner
  URL helpers at lines 50-100.
- `projectRepositoryResponse` is also called by
  `apps/create-installation-access-token` (`src/rest/index.ts` line 162),
  `apps/list-repos-accessible-to-installation` (lines 167-177), and
  `repos/list-for-org` (lines 193-200; plain-text `Not Found` for an unknown
  organization). Run the CodeGraph MCP tool `codegraph_get_callers` on it
  before editing to confirm the list.
- `issues/list-for-repo`, `issues/get`, `pulls/list`, and `pulls/get`
  (lines 304-329) use generic `makeListHandler` and `makeItemHandler` (lines
  85-110) with `projectIssueUrls` and `projectPullRequestUrls`.
- `users/get-authenticated` (`GET /user`, lines 332-344) shows the actor
  pattern: `requireRestUserActor` (`src/rest/actor-context.ts`) returns
  `{user}` or `{failure: 'unauthenticated'}`, and the handler answers 401
  `{"message":"Authentication required"}`.

URL derivation (roadmap 1.4.1, complete): `buildBaseUrls`
(`src/http/request-url.ts` lines 184-203) derives `{apiBaseUrl, webBaseUrl}`
from the request; `src/urls/*.ts` hold per-entity projectors
(`projectRepositoryUrls`, `projectIssueUrls`, `projectPullRequestUrls`,
`projectOrganizationUrls`) that fill a URL only when the stored value is
`undefined`, so seeded values, including `null`, win (`projectDerivedFields`,
`src/urls/shared.ts` lines 95-114).

Stored entities: `githubRepositorySchema` (`src/store/entities/repository.ts`),
`githubIssueSchema` (`src/store/entities/issue.ts`), `githubPullRequestSchema`
(`src/store/entities/pull-request.ts`; stored `state` is
`open | closed | merged`, and the transform derives `closed_at` and `merged_at`
from `state` with `updated_at` as fallback), `githubOrganizationSchema`
(`src/store/entities/organization.ts`), `githubUserSchema`
(`src/store/entities.ts`). Owner-shaping helpers `toRepoOwner`,
`toPublicUserOwner`, and `resolveRepositoryOwner` live in `src/store/index.ts`
(lines 163-210), which is 427 lines long. Early-entity selectors (`getIssue`,
`listIssuesForRepository`, `getPullRequest`, `listPullRequestsForRepository`)
are in `src/store/early-entity-selectors.ts`. Generated ID bands live in
`src/store/entity-id-offsets.ts`. Fixture builders are in
`src/store/builders.ts`.

There is no `src/domain` or `src/ports` directory. In hexagonal terms the store
(entities, selectors, actions) is the domain and its query port, the REST and
GraphQL directories are driving adapters, and `src/urls/` plus
`src/http/request-url.ts` are framework-neutral projection policy shared by
both adapters. This plan follows that shape rather than adding layers.

### What github3.py requires

Reconnaissance read `github3.py` 3.2.0 and 4.0.1 source (`models.py`,
`repos/repo.py`, `users.py`, `orgs.py`, `issues/issue.py`, `issues/label.py`,
`issues/milestone.py`, `pulls.py`, `session.py`). Field reads are identical
across both versions. Mechanics that matter:

- `GitHubCore.__init__` converts a missing key (`KeyError`) into
  `IncompleteResponse`. A `null` where an object is indexed raises a raw
  `TypeError`; a malformed date raises `ValueError`.
- `_json` raises `error_for(response)` for any status of 400 or above, so a
  404 raises `NotFoundError` and a 401 raises `AuthenticationFailed`.
- Date fields go through `_strptime`: an ISO 8601 string or `null`.
- URI-template fields are parsed with `uritemplate.URITemplate`.
- `self._api = json["url"]`; follow-up calls build URLs from it, so `url`
  must point at the simulator.
- The session sends `Accept: application/vnd.github.v3.full+json`.

Required keys per class (`EP-M0` generates the authoritative manifest
`tests/contracts/github3/required-fields.json` mechanically; this list is the
reconnaissance reading it must reproduce):

- `ShortUser` (owner, user, head/base user): `avatar_url`, `events_url`,
  `followers_url`, `following_url`, `gists_url`, `gravatar_id`, `html_url`,
  `id`, `login`, `organizations_url`, `received_events_url`, `repos_url`,
  `starred_url`, `subscriptions_url`, `type`, `url`.
- `User` (`gh.user(login)`) adds: `bio`, `blog`, `company`, `created_at`,
  `email`, `followers`, `following`, `hireable`, `location`, `name`,
  `public_gists`, `public_repos`, `updated_at`.
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
  `active_lock_reason`, `assignee`, `assignees` (list, never null), `base`,
  `body`, `body_html`, `body_text`, `closed_at`, `comments_url`, `commits_url`,
  `created_at`, `diff_url`, `head`, `html_url`, `id`, `issue_url`, `locked`,
  `merge_commit_sha`, `merged_at`, `number`, `patch_url`, `review_comment_url`,
  `review_comments_url`, `state`, `statuses_url`, `title`, `updated_at`, `user`.
  `PullRequest` (`repo.pull_request(n)`) adds `additions`,
  `author_association`, `comments`, `commits`, `deletions`, `draft`,
  `mergeable`, `mergeable_state`, `merged`, `merged_by` (nullable),
  `review_comments`, `requested_reviewers`, `requested_teams`.
- Pull request `head`/`base` (`PullDestination`): `ref`, `label`, `sha`;
  `user` and `repo` are read with `.get`, but a present `repo` must be a
  complete `ShortRepository`, and `base.repo` must be present because
  `_PullRequest` reads `self.base.repository` unguarded (a missing base
  repository raises `AttributeError`, which escapes `IncompleteResponse`).

Representations emit the union of these keys and the `required` list of the
matching OpenAPI component (for example `pull-request-simple` also requires
`labels`, `milestone`, `node_id`, `author_association`, and `auto_merge`).

### Simulacat's current patches (the work this replaces)

From a read-only snapshot of simulacat `main` (`src/github-sim-server.ts` lines
248-451): `orgs/get` and `users/get-by-username` (login and URL rewrites),
`repos/get` (name, full name, owner login, `language`), `repos/list-for-user`
(state-backed list built from the `repos/get` example), `issues/get` (`number`,
`body_html`/`body_text` copies of `body`, `closed_by: null`), and `pulls/get`
(`number`, body fields). The issue and pull request patches invent payloads for
any number on a known repository. Simulacat's compatibility tests
(`tests/test_github3_compat.py`: repository lookup, user listing, organization
listing, issue and pull request retrieval) run on a CI matrix over
`github3.py>=3.2.0,<4` and `>=4.0.0,<5`, and fetch issue 1 and pull request 1
on a repository with no seeded issues or pull requests.

### Test and tooling inventory

- Runner: `bun test --max-concurrency=1 tests` (`make test`). Bun runs test
  files sequentially in one process, so module-level memoization is shared
  across files. `bunfig.toml` preloads `test-plugins.ts`, which registers
  `@aboviq/bun-test-cucumber` 0.2.0 for `tests/**/*.steps.ts`;
  `tests/cross-owner-identity.features.test.ts` loads every
  `features/**/*.feature`. Step files may register Bun `beforeAll` hooks with
  explicit timeouts (`tests/documentation-examples.steps.ts` lines 28-31).
  Bun's default test and hook timeout is 5 seconds.
- In-process servers: `simulation({initialState}).listen(...)` returns a
  server with `port` and `ensureClose()`; it forwards its arguments to
  `server.listen` (for example `tests/cross-owner-identity.steps.ts` lines
  132-145). `bin/start.cjs` treats `PORT=0` as 3300, so the harness uses the
  in-process API.
- Child-process helpers: `tests/support/documented-example-child.ts` spawns
  detached process groups and stops them with `stopOwnedProcessGroup` (guarded
  by `pid == pgid`); reuse it for the Python driver.
- Property tests: `fast-check` ^4.9.0 with the seed helper
  `tests/support/property-test-seed.ts` (see `tests/urls.test.ts` for the 1.4.1
  request-host properties).
- Python: none tracked yet. `Makefile` defines `UV`,
  `UV_ENV = UV_CACHE_DIR=.uv-cache UV_TOOL_DIR=.uv-tools`, and uses
  `uv tool run` for `make spelling`; `.gitignore` ignores `.uv-cache/` and
  `.uv-tools/`. Host: `uv` 0.13.2; CPython 3.14.7 managed by `uv`; Dafny 4.11.0
  at `~/.local/bin/dafny`.
- CI: `.github/workflows/ci.yml` (one `ubuntu-latest` job) installs Bun
  1.3.11, `astral-sh/setup-uv`, Node, then runs `make all`
  (`check-fmt typecheck docs-check lint test spelling`).
  `.github/dependabot.yml` covers `github-actions` and `bun` only.
- Lint: Biome (`bun run lint`), Oxlint (`.oxlintrc.json`, no `overrides`
  yet), TypeDoc documentation gate (`make docs-check`).
- Gate runner: the `scrutineer` agent runs the full gate sequence and returns
  a bounded report; prefer delegating full gate runs to it.

### Alternatives considered

The strongest alternative (raised by the design review) keeps the Python
harness but runs it from a dedicated `make test-contracts` target, included in
`make all` and run as a required CI job with 3.x and 4.x in parallel, while
`make test` stays Bun-only and offline with TypeScript manifest properties as a
fast oracle. It gains an offline, faster `make test` and isolates unrelated
agents' gates from Python flakiness; it trades away the guarantee that the
user's per-milestone `make test` gate exercises the real clients. This plan
keeps the contract inside `make test` (D4) and mitigates the costs with
`make contracts-sync`, memoized single batches, and strict timeouts. A
TypeScript-only conformance check (no Python) was rejected because roadmap
1.4.2 requires real `github3.py` contract tests and because key lists cannot
catch navigation behaviour such as `github3.py` following `json["url"]`.
Recorded client fixtures were rejected because they would test the simulator
against itself. OpenAPI-generated response builders were rejected as roadmap
9.5.3 territory that still needs per-field state mapping. Sharing
representations with GraphQL was rejected because the REST and GraphQL shapes
differ and sharing would couple the two adapters.

### Signposted documentation and skills

Read before implementing: `docs/architecture.md` §GitHub client compatibility
and §Repository label slice; `docs/api-reference.md` §Exported fixture schemas
and §Capability matrix; `docs/github-rest-api-audit.md` §Store and Modelling
Constraints; `docs/developers-guide.md` §URL derivation, §Linting rules,
§Testing expectations, §Gherkin feature scenarios, §Executable guide examples,
§Request actors; `docs/complexity-antipatterns-and-refactoring-strategies.md`
(keep representation helpers small);
`docs/mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md`
(actor model behind `/user/repos`); `docs/github-graphql-api-audit.md` (confirm
GraphQL is untouched); `docs/documentation-style-guide.md`;
`docs/execplans/1-4-1-derive-rest-ur-ls.md` (URL policy history). The user also
named `podbot-design.md`; no such file exists in this repository at `c2e5ddc`.

Skills: `execplans` (this document), `hexagonal-architecture` (boundary checks
at each milestone), `typescript-router` then
`typescript-boundaries-and-validation` (Zod at the Python process boundary) and
`typescript-data-and-state` (representation shapes), `fast-check` (properties
and coverage), `typescript-testing`, `typescript-verification` and `lemmascript`
(`EP-M3P`), `codegraph-mcp` (callers and impact before moving owner helpers),
`python-testing` and `ruff-016` (driver hygiene; the skill documents Ruff 0.16
and the pin is 0.17.5), `firecrawl-mcp` (GitHub REST documentation lookups),
`changelog`, `commit-message`, `pr-creation`.

### Budget survey

Files the plan names: `src/` new 15 (10 representation modules,
`account-selectors.ts`, and four handler files) plus 4 modified
(`src/rest/index.ts`, `src/rest/repository-handlers.ts`, `src/store/index.ts`,
`src/store/entity-id-offsets.ts`) and up to 2 proof files; tests new 19 (9
representation, property, and coverage files, 3 HTTP read files, the contract
test, the steps file, 3 support modules, `workflows.py`,
`required-fields.json`) plus the feature file and 5 modified existing tests
(`tests/urls.test.ts`, `tests/repositories.test.ts`,
`tests/rest-request-urls.test.ts`, `tests/installations.test.ts`,
`tests/cross-owner-identity.steps.ts`); configuration 9 (`pyproject.toml`,
`.python-version`, `.oxlintrc.json`, `.gitignore`, `.github/dependabot.yml`,
`.github/workflows/ci.yml`, `package.json`, `LemmaScript-files.txt`,
`Makefile`); documentation 7 (users guide, developers guide, architecture, API
reference, REST audit, CHANGELOG, roadmap). Total ≈ 62; budget 65.

Net lines: `src/` representations ~720, handlers and selectors ~330 net after
moves, so ~1,050 (sub-limit 1,250); proofs ~200 (sub-limit 350). Tests:
representation and table tests ~600, properties and coverage ~400, HTTP read
tests ~350, contract harness and test ~330, feature steps ~120, Python driver
and manifest recorder ~220, so ~2,020. Code total excluding proofs ≈ 3,070
against a budget of 3,100: the estimate sits at the edge, which is why the plan
adds a re-plan checkpoint after `EP-M2` rather than a larger budget.
Configuration ≈ 130 (budget 170). Documentation ≈ 450 (budget 600).

Historical evidence: `docs/execplans/1-4-1-derive-rest-ur-ls.md` set "roughly
600 lines" per milestone and recorded no budget increase (its retrospective
names only a CodeRabbit rate limit).
`docs/execplans/1-3-1-shared-domain-actions-for-write-behaviour.md` set "~12
source files, ~500 net non-test lines", and its three revision notes record no
increase. Neither shows repeated underestimation. This plan's first draft
undercounted files (38 against a recount of 46-50) because it omitted existing
tests broken by D10; the recount above includes them. No comparable history
exists for Python tooling or LemmaScript in this repository.

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
  and `repositories()` return objects for exactly the seeded repositories in
  scope (roadmap 1.4.2 "repository lookup and listing").
- REQ-account-read: `organization(org)` and `user(login)` return objects
  built from seeded state whose URLs keep the client on the simulator (D3).
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
  the store (architecture §Extension seams; Constraint 4).

Gaps at `c2e5ddc`:

- GAP-repo-full: repository payload lacks `network_count` and
  `subscribers_count`; an unseeded owner is emitted as a bare string.
- GAP-list-mocks: `/users/{username}/repos` and `/user/repos` serve OpenAPI
  examples.
- GAP-account-stubs: `/orgs/{org}` and `/users/{username}` serve OpenAPI
  examples pointing at `api.github.com`.
- GAP-issue-shape: issue payload lacks `assignee`, `assignees`, `labels`,
  `milestone`, `comments`, `comments_url`, `events_url`, `labels_url`, `locked`,
  `closed_by`, `author_association`, `body_html`, `body_text`; leaks
  `owner`/`repo`.
- GAP-pr-shape: pull request payload lacks the `ShortPullRequest`,
  `PullRequest`, and OpenAPI-required keys listed above; serves
  `state: "merged"`; head/base lack `label`, `user`, `repo`; leaks
  `owner`/`repo`/`issue_number`.
- GAP-user-shape: issue and pull request `user` is `{login}` only.
- GAP-no-harness: no Python client harness exists in core.
- GAP-rest-index-size: `src/rest/index.ts` is 403 lines (limit 400).
- GAP-store-index-size: `src/store/index.ts` is 427 lines (limit 400).

Trace links:

```plaintext
roadmap-1.4.2 -> REQ-matrix -> GAP-no-harness -> EP-M0
  -> tests/github3-contract.test.ts (well-formed results, egress guard, manifest)
roadmap-1.4.2 -> REQ-repo-read -> GAP-repo-full, GAP-user-shape, GAP-store-index-size -> EP-M1
  -> github3 contract: repository lookup (3.x, 4.x); feature: "Looking up a repository"
roadmap-1.4.2 -> REQ-repo-list, REQ-account-read -> GAP-list-mocks, GAP-account-stubs -> EP-M2
  -> github3 contract: repositories_by, organization().repositories(), repositories(), user()
roadmap-1.4.2 -> REQ-issue-read -> GAP-issue-shape -> EP-M3 (+ EP-M3P proof)
  -> github3 contract: issue, issues, gh.issue; feature: "Retrieving and listing issues"
roadmap-1.4.2 -> REQ-pr-read -> GAP-pr-shape, GAP-rest-index-size -> EP-M4
  -> github3 contract: pull_request, pull_requests, gh.pull_request
architecture-client-compat -> REQ-self-host -> EP-M1..EP-M4 -> INV-self-host + INV-no-egress
Constraint-4 -> REQ-boundary -> EP-M0/EP-M1 -> oxlint override on src/rest/representations/**
roadmap-1.4.2 -> REQ-no-patch -> EP-M5
  -> features/github3-client-compatibility.feature + manual downstream check
```

## Verification plan

### Abstract model

State `S` is the seeded store: accounts `A` (users and organizations keyed by
login), repositories `R` keyed by `owner/name`, issues `I` and pull requests
`P` keyed by `owner/name#number`. A request is
`(route, params, actor, accept, base)` where `base` is the request-derived
`BaseUrls`. Each in-scope route is `select(S, params, actor)` followed by
either a not-found or unauthenticated outcome or
`represent(records, relations, ctx)` where `ctx = {base, body}` and
`body = select_body(tokenize(accept))`. Representations are total functions
from resolved records, relation slots, and `ctx` to JSON; they never read `S`,
the request, or the response.

Preconditions: records satisfy the stored entity schemas (they were parsed by
Zod at seed time). Unknown owner, repository, issue, pull request,
organization, or user yields 404 `{"message":"Not Found"}`; `/user/repos`
without a user actor yields 401 `{"message":"Authentication required"}` (the
existing `/user` convention). `/users/{login}/repos` yields 404 only when
`login` is neither a seeded account nor the owner of a seeded repository.

### Invariants and lemmas

- INV-manifest (REQ-matrix): the committed manifest
  `tests/contracts/github3/required-fields.json` equals, for each client line,
  the key sets recorded by instantiating each in-scope `github3.py` class from
  a recording mapping (keys read with `[]` are required; keys read with `.get`
  are optional).
- INV-required-fields (REQ-repo-read, REQ-repo-list, REQ-account-read,
  REQ-issue-read, REQ-pr-read): for every representation and every admissible
  input, the output contains every key the manifest marks required for its
  class and every key the matching OpenAPI component lists as required, never
  `undefined`; manifest object keys are objects; list keys are arrays; date
  keys are ISO 8601 strings or `null`; `url` is a non-empty string.
- INV-no-internal-leak (D10, Constraint 7): recursively, through nested
  `owner`, `user`, `head`, `base`, `head.repo`, `base.repo`, and `_links`
  (resolving OpenAPI `$ref`s), every key is a property of the matching OpenAPI
  component (plus the media-type body keys); no store-only key (`owner` as a
  string, `repo`, `issue_number`, `packages`, `organizations`, `email` in a
  simple-user) appears.
- INV-list-item-agreement (D2), at the HTTP layer: the item for a repository
  in `GET /users/{u}/repos` or `GET /orgs/{o}/repos` equals
  `GET /repos/{o}/{r}` restricted to the `minimal-repository` keys; the item in
  `GET /user/repos` and the nested `base.repo` equal it restricted to the
  `repository` keys; a pull request in `GET …/pulls` equals `GET …/pulls/{n}`
  restricted to `pull-request-simple` keys. Independently, `full_name`, `id`,
  `owner.login`, and `html_url` equal a test-owned projection of the seed.
- INV-pr-lifecycle: REST `state` is `closed` when stored `state` is `closed`
  or `merged`, else `open`; `merged === (stored state === "merged")`;
  `merged_at` is non-null exactly when merged and equals the stored `merged_at`
  (seeded value or `updated_at` fallback); `closed_at` is non-null exactly when
  REST `state` is `closed`; `draft` and `mergeable` pass through;
  `mergeable_state` follows D7.
- INV-body-selection (D6): `select_body` is total over all token lists; its
  result is the representation of the first recognized token whose quality is
  not zero, else `raw`; the emitted body key set is exactly the D6 table entry.
- INV-tokenize: `tokenize` is total over all strings; changing letter case or
  appending unrecognized tokens does not change `select_body(tokenize(h))`.
- INV-html-escape: for every string `b`, `escapeHtml(b)` contains none of `<`,
  `>`, `"`, `'`; every `&` in it starts one of `&amp;`, `&lt;`, `&gt;`,
  `&quot;`, `&#39;`; and `decode(escapeHtml(b)) === b` for the single-pass
  decoder. `body_html` is `""` for an empty body, else `<p>` + escaped body +
  `</p>`.
- INV-account-resolution (D8): a seeded organization login resolves to that
  organization; otherwise a seeded user login resolves to that user; otherwise
  the resolution is `unseeded` with an ID in `[2^40, 2^41)` that is
  deterministic across calls and requests and not equal to any seeded account
  ID in `S`. Logins differing only by case resolve independently: GitHub logins
  are case-insensitive, but store keys are case-sensitive, and this plan does
  not change that.
- INV-self-host (REQ-self-host): every `*_url`, `url`, and `_links.*.href`
  value in every representation either was seeded explicitly, or equals the
  request's API or web base URL, or starts with that base followed by `/`
  (external clone fields keep their 1.4.1 classification), for arbitrary
  request hosts and API roots.
- INV-override-precedence: seeded `url`, `html_url`, `issue_url`, and
  `repository_url` are emitted verbatim; derived sub-resource URLs
  (`comments_url`, `events_url`, `labels_url`, `diff_url`, `_links`) derive
  from the request base and entity coordinates, never from a seeded `url`.
- INV-cross-link: `_links.self.href === url`, `_links.html.href === html_url`,
  `_links.issue.href === issue_url`; a pull request's `issue_url` equals the
  derived URL of the issue with the same number;
  `head.label === head.user.login + ":" + head.ref`; `statuses_url` ends with
  `/statuses/` + `head.sha`.
- INV-error-shape: for every in-scope route and every missing resource, the
  status is 404 (or 401 for the actor-less `/user/repos`), the content type is
  `application/json`, and the body is exactly the message above.
- INV-read-idempotence: two identical reads return deep-equal bodies and leave
  the store state unchanged.
- INV-no-egress (Constraint 12): during a contract run, the Python driver can
  connect only to `127.0.0.1:<simulator port>`; any other destination fails
  immediately with a guard error.
- L-route-uses-representation: each in-scope handler returns exactly
  `represent(select(S, params, actor), relations, ctx)`.
- L-scope-filter: `/users/{login}/repos` returns exactly the public
  repositories owned by `login`; `/orgs/{org}/repos` exactly those owned by
  `org`; `/user/repos` exactly those owned by the actor or by an organization
  in the actor's `organizations`; each in the D14 order.

`INV-lifecycle-temporal` (`merged_at ≤ closed_at`) is out of scope: the store
transform can produce `merged_at = updated_at` with an earlier seeded
`closed_at`. It belongs to the pull request state-transition work in phase 3
and is recorded as a known store-level limitation in
`docs/github-rest-api-audit.md`.

### Axioms (trusted, not verified here)

- AXIOM-github3: `github3.py` 3.2.0 and 4.0.1 behave as their published
  source does. Boundary: the contract suite exercises the real libraries, and
  the manifest is generated from them, not transcribed.
- AXIOM-openapi: `schema/api.github.com.json` (bundled; refreshed per
  `docs/developers-guide.md` §GitHub REST schema) describes GitHub's REST
  component schemas. Boundary: INV-required-fields and INV-no-internal-leak use
  it as an oracle independent of the implementation.
- AXIOM-media-types: GitHub's documented REST media types for issue and pull
  request bodies (`raw`, `text`, `html`, `full`). Boundary: D6.
- AXIOM-uv: `uv` 0.13.x honours `uv.lock` hashes, `--locked`,
  `UV_PROJECT_ENVIRONMENT`, and dependency-group conflicts.
- AXIOM-python-audit: CPython's `sys.addaudithook` raises the
  `socket.connect` and `socket.getaddrinfo` audit events before a connection is
  attempted. Boundary: the guard self-test exercises it.
- AXIOM-foundation: `simulation().listen(0, '127.0.0.1')` binds an ephemeral
  loopback port and `ensureClose()` releases it.
- AXIOM-lemmascript: LemmaScript 0.5.22 translates the annotated functions
  faithfully within its documented fragment (strings as sequences, `number` as
  mathematical integers), and Dafny 4.x is sound. Boundary: the correspondence
  test in `EP-M3P`.

### Methods per obligation

Mutations below are made in the working tree only; the named tests are run and
must fail for the stated reason; and the mutation is reverted with
`git checkout -- <file>` before any commit. Each result is recorded in
`Artefacts and notes` as a row: obligation, file, mutation, failing tests.

- Obligation: INV-manifest.
  Method: generated oracle. The `manifest` scenario in
  `tests/contracts/github3/workflows.py` instantiates each in-scope class with a
  `dict` subclass that records `__getitem__` and `get` keys, for both client
  lines; `tests/github3-contract.test.ts` asserts the committed JSON equals
  both recordings. Non-vacuity: the manifest must contain at least the
  reconnaissance keys listed above (for example `network_count`,
  `active_lock_reason`); mutation: delete one key from the committed JSON → the
  equality test fails.
- Obligation: INV-required-fields.
  Method: `fast-check` property per representation over tagged-`fc.oneof`
  arbitraries built from the exported fixture builders with explicit IDs and
  timestamps (no `faker` defaults), plus the contract suite. Domain classes:
  user-owned, organization-owned, and unseeded-owner repositories; public and
  private; issues with and without `pull_request` links; pull requests in each
  stored state, draft or not, head repository seeded or absent; seeded URL
  overrides including `null`; empty and non-empty bodies; each body media type.
  Artefact: `tests/rest-representations.properties.test.ts`, with the coverage
  test `tests/rest-representations.coverage.test.ts`, which draws
  `fc.sample(arbitrary, {seed: FIXED_SEED, numRuns: 500})`, classifies each
  sample by its tag, and asserts every class count is greater than zero.
  Non-vacuity: the coverage test as above; mutation: remove `network_count`
  from the full-repository helper → the property and the repository contract
  tests fail.
- Obligation: INV-no-internal-leak.
  Method: property over the same arbitraries against OpenAPI component
  properties, recursing with `$ref` resolution. Non-vacuity: the property is
  first run against a captured fixture of today's payload shape and must fail
  on the `owner` string; mutation: spread the stored user into `user` → fails on
  `email`.
- Obligation: INV-list-item-agreement.
  Method: HTTP-level property over generated stores (1-5 repositories per
  owner, user and organization owners, 0-3 pull requests per repository),
  comparing list items with item reads, plus the test-owned seed projection.
  Non-vacuity: coverage requires a store with at least two repositories per
  owner and at least one pull request; mutation: make the user listing use
  `toRestFullRepository` → the key-set comparison fails.
- Obligation: INV-pr-lifecycle.
  Method: exhaustive table over the finite domain stored
  `state ∈ {open, closed, merged}` × `merged_at ∈ {absent, null, timestamp}` ×
  `closed_at ∈ {absent, null, timestamp}` × `draft ∈ {true, false}` (54 rows),
  each built through `githubPullRequestSchema` and `toRestPullRequest`, each
  asserting REST `state`, `merged`, `merged_at`, `closed_at`, and `draft`; plus
  a 3-row table for `mergeable ∈ {true, false, null}` → `mergeable_state`.
  Rationale: the domain is finite and every row is constructible, so the table
  is a complete proof by cases. Artefact:
  `tests/rest-pull-request-representation.test.ts`. Non-vacuity: a
  generated-row count assertion (`=== 54`); mutation: `state: stored.state` →
  the merged rows fail.
- Obligation: INV-body-selection and INV-tokenize.
  Method: table over recognized media types (with and without `.v3`, mixed
  case, parameters, comma-separated lists, `q=0`, unrecognized prefixes);
  `fast-check` totality and metamorphic properties for `tokenize` (case change,
  appended unrecognized tokens); in `EP-M3P`, a LemmaScript proof of
  `select_body` (D11) and a correspondence property asserting the shipped
  `negotiateBodyRepresentation(h) === selectBodyRepresentation(
  tokenizeAccept(h))`
  over generated headers. Artefact: `tests/rest-body-media-type.test.ts`,
  `src/rest/representations/body-selection.ts` (proof target). Non-vacuity:
  generators mix recognized tokens into random strings and the coverage test
  requires both hits and misses; mutation: map `text` to `full` → the table
  fails; for the proof, a deliberately wrong selector (always `raw`) must make
  Dafny report a failed `ensures`.
- Obligation: INV-html-escape.
  Method: written proof plus checks, then (approval-gated) a LemmaScript proof.
  Written proof: `escapeHtml` is implemented as a per-character lookup, which
  makes it a monoid morphism from strings to strings. Its images
  `{&amp;, &lt;, &gt;, &quot;, &#39;} ∪ {c | c is not special}` form a prefix
  code: every multi-character image starts with `&`, `&` is never a
  single-character image, and the five entities differ before their terminating
  `;`. A morphism whose images form a prefix code is injective, and the
  single-pass decoder is its left inverse. Checks: an exhaustive test that no
  image is a prefix of another (finite: the five entities against each other
  and against the single-character image class); a property
  `escapeHtml(x + y) === escapeHtml(x) + escapeHtml(y)`; a property
  `decode(escapeHtml(b)) === b` over arbitrary Unicode strings, with the
  test-owned single-pass decoder `/&(amp|lt|gt|quot|#39);/g`; and a property
  that the output contains no raw specials. Proof (`EP-M3P`): LemmaScript
  `ensures` clauses for absence of raw specials and for
  `decodeSpec(escapeHtml(s)) == s`, by induction over the string. Artefact:
  `tests/rest-body-media-type.test.ts`,
  `src/rest/representations/html-escape.ts` and its `.dfy`. Non-vacuity:
  mutation omitting the `'` mapping → the no-raw-specials property fails;
  mutation double-escaping `&` → the round-trip property fails; for the proof,
  the same two mutations must make Dafny report a failed `ensures`.
- Obligation: INV-account-resolution.
  Method: table for seeded organization, seeded user, a login seeded as both,
  and an unseeded login; `fast-check` property over arbitrary valid logins for
  determinism, band membership, and inequality with seeded IDs; a forced
  collision test that seeds a user whose `id` equals the first-derived
  synthetic ID of `ghost` and asserts `ghost` resolves to the salted second
  derivation. Artefact: `tests/store-account-selectors.test.ts`. Non-vacuity:
  the forced-collision test is the witness for the salt path; mutation: drop
  the salt loop → the collision test fails.
- Obligation: INV-self-host and INV-override-precedence.
  Method: extend the 1.4.1 request-host property (`tests/urls.test.ts`) to walk
  every string field of every new representation (including nested owners,
  `head.repo`, `base.repo`, and `_links`) with the prefix-plus-slash rule; a
  table for seeded overrides. Non-vacuity: generators include ports that are
  prefixes of each other (`:1234` and `:12345`); mutation: hard-code
  `https://api.github.com` in `_links` → fails.
- Obligation: INV-cross-link.
  Method: property over generated pull requests and issues. Non-vacuity:
  mutation: build `head.label` from the repository name → fails.
- Obligation: INV-error-shape and INV-read-idempotence.
  Method: table over every in-scope route × missing resource; a property that
  reads twice and compares bodies and a store snapshot. Artefact:
  `tests/rest-repository-reads.test.ts`, `tests/rest-issue-reads.test.ts`,
  `tests/rest-pull-request-reads.test.ts`. Non-vacuity: mutation: plain-text
  `Not Found` in one handler → fails.
- Obligation: INV-no-egress.
  Method: the driver installs `sys.addaudithook` before importing `github3`;
  the hook raises on `socket.connect` or `socket.getaddrinfo` for any address
  other than `127.0.0.1` with the simulator port. The child environment is
  built from an allow-list (`PATH`, `HOME`, `LANG`, `TMPDIR`, plus `HTTP_PROXY`,
  `HTTPS_PROXY`, `http_proxy`, and `https_proxy` set to `http://127.0.0.1:9`,
  and `NO_PROXY` and `no_proxy` set to `127.0.0.1`), so inherited proxy
  settings and tokens (`GH_TOKEN`, `GITHUB_TOKEN`) never reach it. The
  `egress_guard` self-test attempts `https://api.github.com/`,
  `http://example.invalid/`, and `http://localhost:3300/` and must report the
  guard error for each. Artefact: `tests/contracts/github3/workflows.py`,
  `tests/github3-contract.test.ts`. Non-vacuity: the self-test works offline
  (the guard fires before any connection); mutation: allow any loopback port →
  the `localhost:3300` probe stops reporting the guard error and the test fails.
- Obligation: L-route-uses-representation and L-scope-filter.
  Method: named example and table tests through HTTP (`fetch` against a loopback
  `listen`), plus the contract suite and the BDD feature. Non-vacuity:
  fixtures always include decoy repositories, issues, and pull requests under a
  second owner, a private repository, and an organization the actor does not
  belong to; none may appear where excluded.

### Formal verification decision

Proportionate methods per D11. The pull request lifecycle is proved by
exhaustive enumeration of its finite domain. Escaping and media-type selection
range over unbounded inputs and are contractual (they define what every client
receives), so they get a LemmaScript proof in `EP-M3P`, with properties as the
regression net and a correspondence property tying the proved functions to the
shipped code. The proof leaves the Accept tokenizer, the handlers, and
agreement with `github3.py` unverified; the tokenizer is covered by properties
and the rest by the contract suite and OpenAPI oracle. If the user declines the
LemmaScript dependency, the written prefix-code proof and its finite checks
stand in, and the decision is recorded in `Decision log`.

### Suggested BDD features

Feature file: `features/github3-client-compatibility.feature`, steps in
`tests/github3-client-compatibility.steps.ts` (runner: `make test`, loaded by
`tests/cross-owner-identity.features.test.ts`). The runner has no
`Scenario Outline`, so every scenario covers both client lines. Steps read the
memoized observation batch from `tests/support/github3-observations.ts`; a
step-file `beforeAll` with a 120-second timeout starts it. Tags link scenarios
to requirements and milestones. Each scenario is added in the milestone that
makes it pass.

```gherkin
@github3-client-compatibility
Feature: github3.py reads seeded repositories, issues, and pull requests

  Background:
    Given a simulator seeded with organization "acme" and user "octo" who belongs to "acme"
    And repository "acme/widgets" with issue 1 titled "Crash on start" and body "Steps <to> reproduce"
    And pull request 2 titled "Fix crash" from branch "feature" into "main" in "acme/widgets"
    And public repository "octo/dotfiles", private repository "octo/diary", and decoy repository "globex/secret"

  @REQ-repo-read @EP-M1
  Scenario: Looking up a repository
    When github3.py 3.x and 4.x each look up repository "acme/widgets"
    Then both clients see full name "acme/widgets" owned by organization "acme"
    And both clients' repository API URLs point at the simulator

  @REQ-repo-list @REQ-account-read @EP-M2
  Scenario: Listing repositories for a user, an organization, and the actor
    When github3.py 3.x and 4.x each list repositories by "octo", for organization "acme", and for actor "octo"
    Then both clients list ["octo/dotfiles"], ["acme/widgets"], and ["acme/widgets", "octo/diary", "octo/dotfiles"]
    And no client lists "globex/secret"

  @REQ-repo-list @EP-M2
  Scenario: Listing the actor's repositories requires an actor
    When github3.py 3.x and 4.x each list repositories without an actor header
    Then both clients raise an authentication failure

  @REQ-issue-read @EP-M3
  Scenario: Retrieving and listing issues with rendered body fields
    When github3.py 3.x and 4.x each retrieve issue 1 and list issues in "acme/widgets"
    Then both clients see title "Crash on start" and body_text "Steps <to> reproduce"
    And both clients see body_html "<p>Steps &lt;to&gt; reproduce</p>"
    And both clients list issue numbers [1]

  @REQ-pr-read @EP-M4
  Scenario: Retrieving and listing pull requests with head and base repositories
    When github3.py 3.x and 4.x each retrieve pull request 2 and list pull requests in "acme/widgets"
    Then both clients see head ref "feature", base ref "main", and base repository "acme/widgets"
    And both clients see the pull request as open and not merged
    And both clients list pull request numbers [2]

  @REQ-repo-read @REQ-issue-read @REQ-pr-read @EP-M4
  Scenario: Missing resources raise not-found errors
    When github3.py 3.x and 4.x each look up repository "acme/missing"
    And github3.py 3.x and 4.x each look up issue 99 and pull request 99 in "acme/widgets"
    Then every lookup raises a not-found error
```

## Plan of work

Each milestone follows D15: add stub signatures (where a module is new), record
the red run, implement, refactor, run the gate sequence in `Concrete steps`,
update this plan's living sections, and commit. Documentation for a behaviour
lands in the same milestone as the behaviour.

### `EP-M0` Contract harness, manifest, and red baseline

Requirements: REQ-matrix, REQ-boundary (lint rule); GAP-no-harness; decisions
D4, D5, D12, D13, D15.

1. Create `tests/contracts/github3/pyproject.toml`: `[project]` name
   `simulacat-core-github3-contract`, `version = "0"`,
   `requires-python = ">=3.12"`, `dependencies = []`; `[dependency-groups]`
   `github3-v3 = ["github3.py==3.2.0"]`, `github3-v4 = ["github3.py==4.0.1"]`,
   `lint = ["ruff==0.17.5"]`; `[tool.uv]` `package = false`,
   `default-groups = []`,
   `conflicts = [[{group = "github3-v3"}, {group = "github3-v4"}]]`;
   `[tool.ruff]` `target-version = "py312"`, `line-length = 100`;
   `[tool.ruff.lint]` `select = ["ALL"]`,
   `ignore = ["D203", "D213", "COM812"]`. Add `.python-version` containing
   `3.14`. Generate `uv.lock` with
   `UV_CACHE_DIR=.uv-cache uv lock --project tests/contracts/github3`.
2. Makefile: add `PY_CONTRACTS = tests/contracts/github3` and a
   `contracts-sync` target that runs, for each of `github3-v3`, `github3-v4`,
   and `lint`,
   `UV_PROJECT_ENVIRONMENT=$(PY_CONTRACTS)/.venv/<group>
   $(UV_ENV) $(UV) sync --locked --project $(PY_CONTRACTS)
   --no-default-groups --group <group>`;
   make `test` depend on `contracts-sync`; add
   `RUFF = $(PY_CONTRACTS)/.venv/lint/bin/ruff`; `check-fmt` gains
   `$(RUFF) format --check $(PY_CONTRACTS)`; `lint` gains a `ruff` target
   running `$(RUFF) check $(PY_CONTRACTS)` (both depend on `contracts-sync`);
   `fmt` gains `$(RUFF) format $(PY_CONTRACTS)`; `clean` removes
   `$(PY_CONTRACTS)/.venv`. Change the fixed `UV_CACHE_DIR=.uv-cache` in
   `UV_ENV` to come from a `UV_CACHE_DIR ?= .uv-cache` variable so CI can point
   it at the setup-uv cache. Validate with `mbake validate Makefile`. Add
   `tests/contracts/github3/.venv/` to `.gitignore`.
3. CI and dependency hygiene: in `.github/workflows/ci.yml`, enable setup-uv
   caching with `cache-dependency-glob: tests/contracts/github3/uv.lock` and run
   `make contracts-sync` as its own step before `make all`. In
   `.github/dependabot.yml`, add a `uv` entry for `/tests/contracts/github3`
   with the same schedule and cooldown as the `bun` entry, ignoring version
   updates for `github3.py` (the pins are deliberate line representatives) so
   only transitive security updates and `ruff` move.
4. Create `tests/contracts/github3/workflows.py`. It installs the egress audit
   hook first, then imports `github3`. It reads `--base-url`, `--port`,
   `--actor` (optional), and scenario names; configures
   `github3.GitHub(token="contract-token")`, `session.base_url`, a per-request
   timeout of 10 seconds, and the actor header; and runs each scenario in a
   `try` block. It writes one line per scenario to standard output, prefixed
   with the sentinel `GITHUB3-CONTRACT` and one space, and followed by
   `json.dumps({...}, ensure_ascii=True)`, with keys `scenario`, `ok`,
   `observed`, and `error` (`{type, message}`). `observed` holds plain values
   the TypeScript side asserts (full names, owner logins and types, titles,
   body fields, head/base refs and repository full names, `merged`, URLs).
   Scenarios: `client_version`, `egress_guard`, `manifest`, and every workflow
   named in `Validation and acceptance`. Use `sys.stdout.write`; never `print`.
5. Create `tests/support/github3-contract-client.ts`:
   `runGithub3Workflows({line, baseUrl, port, actor, scenarios})` spawns
   `tests/contracts/github3/.venv/github3-v<line>/bin/python -I -u
   tests/contracts/github3/workflows.py …`
   with the allow-listed environment, via the process-group helpers in
   `tests/support/documented-example-child.ts`, a 60-second deadline, and a
   `StringDecoder` for UTF-8-safe chunk joining. It keeps only sentinel lines,
   parses each with a Zod schema, and treats a non-zero exit, a missing or
   duplicate scenario line, or a parse failure as a harness error. If the
   interpreter is missing it throws an `Error` naming `make contracts-sync`.
6. Create `tests/support/github3-contract-fixture.ts` (the Background state,
   built with explicit IDs and timestamps from the exported fixture builders,
   including decoys and a private repository) and
   `tests/support/github3-observations.ts`: `getGithub3Observations(line)`
   memoizes one batch per client line per `bun test` process. It starts the
   simulator with `listen(0, '127.0.0.1')`, takes the port from the returned
   server, runs every scenario once, closes the server, and returns the parsed
   observations. Both the contract test and the feature steps consume it.
7. Create `tests/github3-contract.test.ts`: a `beforeAll` with a 120-second
   timeout loads both lines' observations and spies on `console.error`. Harness
   tests: exactly one well-formed result per (line, scenario); `client_version`
   reports 3.2.0 and 4.0.1; `egress_guard` reports the guard error for every
   probe; `manifest` equals the committed
   `tests/contracts/github3/required-fields.json` for both lines (create that
   file from the first recording, then review it against the reconnaissance
   list in `Context and orientation`); no simulator `console.error` output.
   Workflow tests: one `it` per (line, workflow) asserting the expected red
   outcome from the probe (D15), for example `IncompleteResponse` naming
   `network_count`.
8. Add the `.oxlintrc.json` override for `src/rest/representations/**`
   (`no-restricted-imports` for the modules in Constraint 4, and a pattern rule
   rejecting value imports from `**/store/**`); confirm it reports on a scratch
   violating file, then delete the scratch file. If oxlint cannot express it,
   write `tests/rest-representation-boundary.test.ts` instead and record the
   choice.
9. Spike (1-hour box): run the full observation batch 50 times in a scratch
   loop under `bun test`; record which route logs the `ajv` `nullable` error
   and whether the connection reset reproduces. Record the outcome in
   `Surprises & discoveries` and confirm or revise D13. Escalate if the cause
   is outside this plan's routes.
10. Documentation: `docs/developers-guide.md` gains "GitHub client contract
    tests" (layout, `make contracts-sync`, environments, adding a scenario,
    sentinel framing, egress guard, refreshing pins and the manifest, Ruff,
    Dependabot coverage).

End state: `make test` passes; harness tests pass; every workflow test passes
by asserting its exact red reason.

### `EP-M1` Account and repository representations; repository lookup

Requirements: REQ-repo-read, REQ-self-host, REQ-boundary; GAP-repo-full,
GAP-user-shape, GAP-store-index-size; decisions D1, D2, D7, D8, D10, D13.

1. Stubs (D15): create `src/store/account-selectors.ts` and
   `src/rest/representations/{context,account,repository,unmodelled-fields}.ts`
   with exported signatures throwing `NotImplementedError`. Write
   `tests/store-account-selectors.test.ts`,
   `tests/rest-account-representation.test.ts`,
   `tests/rest-repository-representation.test.ts`, the repository and account
   parts of the properties and coverage files, and repository cases in
   `tests/rest-repository-reads.test.ts`. Record the red run.
2. `src/store/entity-id-offsets.ts`: document the synthetic account band.
3. `src/store/account-selectors.ts`: `ResolvedAccount` (type-only section),
   `resolveAccount(state, login)` per D8, and move `toRepoOwner`,
   `toPublicUserOwner`, and `resolveRepositoryOwner` out of
   `src/store/index.ts` unchanged (public selector behaviour identical; the
   existing `tests/store-selectors.test.ts` must stay green unmodified).
   `src/store/index.ts` ends at or below 400 lines.
4. `src/rest/representations/account.ts`: `toRestSimpleUser(account, ctx)`,
   an allow-list producing GitHub's `simple-user` with `/users/{login}` URLs
   for every account kind (moves and replaces `projectOwnerAccountUrls`,
   `projectUserOwnerResponse`, and `projectOrganizationOwnerResponse` from
   `src/rest/repository-handlers.ts`).
5. `src/rest/representations/unmodelled-fields.ts`: D7 constants with JSDoc
   naming their future owners.
6. `src/rest/representations/repository.ts`: `toRestMinimalRepository`,
   `toRestRepository`, and `toRestFullRepository`, each built on the level
   below and on `projectRepositoryUrls`.
7. `src/rest/repository-handlers.ts`: `repos/get` and `repos/update` compose
   `getRepository`, `resolveAccount`, and `toRestFullRepository`; delete
   `projectRepositoryResponse` and move its other callers in the same commit:
   `apps/create-installation-access-token` and
   `apps/list-repos-accessible-to-installation` (`toRestRepository`) and
   `repos/list-for-org` (`toRestMinimalRepository`), all switching to
   `response.json` (D13). Update `tests/installations.test.ts`,
   `tests/repositories.test.ts`, and `tests/rest-request-urls.test.ts` for the
   new owner shape and JSON 404.
8. Contract: change the repository-lookup workflow tests from red assertions
   to value assertions; add the "Looking up a repository" scenario to the
   feature and its steps.
9. Documentation: `docs/architecture.md` §GitHub client compatibility records
   D1, D2, D7, D8, and D13; `docs/users-guide.md` "Breaking changes" gains
   "1.4.2 — GitHub-shaped REST payloads" with the repository and owner entries
   from D10; `CHANGELOG.md` gains an entry following the existing
   version-heading convention.

End state: `github3.py` 3.x and 4.x `repository()` pass; all gates pass.

### `EP-M2` Repository listings, organization lookup, and user lookup

Requirements: REQ-repo-list, REQ-account-read, REQ-self-host; GAP-list-mocks,
GAP-account-stubs; decisions D3, D10, D14.

1. Stubs and red: `src/rest/representations/organization.ts` and the
   `toRestPublicUser` export in `account.ts` throw `NotImplementedError`. Write
   HTTP tests for `GET /users/octo/repos` (exactly `octo/dotfiles`; the private
   `octo/diary` excluded), `GET /users/nobody/repos` (404), `GET /user/repos`
   with `x-simulacat-actor: user:octo` (owned plus member-organization
   repositories in D14 order) and without an actor (401), `GET /orgs/acme` (all
   `organization-full` required keys; `url` on the simulator; `public_repos`
   counts public repositories), `GET /orgs/nobody` (404 JSON), `GET /users/octo`
   (`public-user` keys, no non-allow-listed fields), `GET /users/nobody`
   (404), and the `GET /orgs/acme/repos` order; the L-scope-filter table; the
   INV-list-item-agreement property for repositories. Record the red run.
2. `src/store/account-selectors.ts`:
   `listRepositoriesOwnedBy(state, login, {publicOnly})`,
   `listRepositoriesForUser(state, user)`, and
   `countPublicRepositories(state, login)`, each in D14 order.
3. `src/rest/representations/organization.ts`:
   `toRestOrganization(organization, relations, ctx)` with
   `relations.publicRepos`. `account.ts`:
   `toRestPublicUser(user, relations, ctx)` with an explicit allow-list
   (`login`, `id`, `node_id`, `type`, URLs, `site_admin`, `name`, `company`,
   `blog`, `location`, `email` (only when the fixture sets it, else `null`),
   `hireable`, `bio`, `public_repos`, `public_gists`, `followers`, `following`,
   `created_at`, `updated_at`).
4. Handlers: `repos/list-for-user`, `repos/list-for-authenticated-user` (via
   `requireRestUserActor`), and `repos/list-for-org` in
   `src/rest/repository-list-handlers.ts`; `orgs/get` and
   `users/get-by-username` in `src/rest/account-handlers.ts`. Wire them in
   `src/rest/index.ts` without net growth of that file.
5. Contract and feature: listing workflows and `user()` move to value
   assertions; add the two listing scenarios.
6. Documentation: `docs/api-reference.md` capability-matrix rows for the four
   routes and the changed `GET /orgs/{org}/repos`; users-guide breaking changes
   for listings and account routes; a new `docs/users-guide.md` section "Using
   github3.py" (the supported root-mounted setup, kept minimal so roadmap 1.4.3
   owns the custom API-root and Enterprise classification; `x-simulacat-actor`
   for `gh.repositories()`; listing order, visibility, and ignored parameters
   per D14). Python fences in the guide are marked as not executed by the
   guide-example harness, following `docs/developers-guide.md` §Executable
   guide examples.

End state: no in-scope route serves an OpenAPI example; all gates pass. Re-plan
checkpoint: record cumulative net code lines; if above 1,700, stop and re-plan
before `EP-M3`.

### `EP-M3` Body media types and issue representation

Requirements: REQ-issue-read; GAP-issue-shape, GAP-user-shape; decisions D6,
D7, D10, D11.

1. Stubs and red: `src/rest/representations/html-escape.ts`
   (`escapeHtml`), `body-selection.ts` (`selectBodyRepresentation(tokens)`),
   `body.ts` (`tokenizeAccept(header)`, `negotiateBodyRepresentation(header)`,
   `toRestBodyFields(body, representation)`), and `issue.ts` (`toRestIssue`)
   throw `NotImplementedError`. Write `tests/rest-body-media-type.test.ts`,
   `tests/rest-issue-representation.test.ts`, the issue parts of the properties
   and coverage files, and `tests/rest-issue-reads.test.ts` (item, list, 404,
   media types via `Accept`, idempotence). Record the red run.
2. Implement `escapeHtml` as a per-character lookup and
   `selectBodyRepresentation` as a loop over tokens; both stay inside the
   LemmaScript-supported fragment (no regular expressions, no closures over
   mutable state) so `EP-M3P` can verify them in place. `tokenizeAccept` may
   use ordinary string handling.
3. `src/rest/representations/issue.ts`: `toRestIssue(issue, relations, ctx)`
   with
   `relations = {user, labels, assignees, milestone, closedBy,
   repositoryOwnerLogin}`;
   uses `projectIssueUrls`; adds `comments_url`, `events_url`, `labels_url`
   (`…/labels{/name}`), unmodelled values, `author_association`, and body
   fields; preserves a seeded `pull_request` link.
4. `src/rest/issue-handlers.ts`: `issues/get` and `issues/list-for-repo`
   moved out of `src/rest/index.ts`, resolving the author with
   `resolveAccount`, filling relation slots from `unmodelled-fields.ts`, and
   negotiating the body from `request.get('accept')`.
5. Contract and feature: issue workflows move to value assertions; add the
   issue scenario.
6. Documentation: "Using github3.py" gains body media types and the
   unmodelled-field table; a breaking-changes entry for issue payloads;
   `docs/github-rest-api-audit.md` §Store and Modelling Constraints records the
   unmodelled-field policy and the `INV-lifecycle-temporal` limitation.

End state: issue workflows pass on both lines; all gates pass.

### `EP-M3P` LemmaScript proof of escaping and media-type selection (approval-gated)

This milestone runs only if the user approved D11; otherwise record the written
proof as the discharge and continue with `EP-M4`.

1. Add `lemmascript@0.5.22` as a dev dependency
   (`bun add -d -E lemmascript@0.5.22`), a `LemmaScript-files.txt` listing
   `src/rest/representations/html-escape.ts` and
   `src/rest/representations/body-selection.ts`, and a `make proofs` target
   (`bunx lsc check --backend=dafny <file>` per listed file) included in
   `make all`. CI installs Dafny 4.x from a pinned release archive before
   `make all`.
2. Annotate `escapeHtml` with `//@ verify`, a pure recursive `decodeSpec`, and
   `//@ ensures` clauses: no raw special character in the result, every `&`
   begins an entity, and `decodeSpec(\result) === s`; add loop invariants
   relating the processed prefix to the output prefix. Annotate
   `selectBodyRepresentation` with `ensures` clauses for the first acceptable
   recognized token and the `raw` default.
3. Run `bunx lsc gen --backend=dafny <file>`, then iterate on `*.dfy` helper
   lemmas until `make proofs` passes. Never use `//@ assume`. Run the two
   seeded mutations from `Verification plan` and record Dafny's rejection.
4. Add the correspondence property to `tests/rest-body-media-type.test.ts`
   (the shipped `negotiateBodyRepresentation(h)` equals
   `selectBodyRepresentation(tokenizeAccept(h))`).
5. Documentation: `docs/developers-guide.md` gains "Formal proofs" (what is
   proved, the trusted boundary, `make proofs`, the regen workflow).

End state: `make proofs` passes; all gates pass.

### `EP-M4` Pull request representation

Requirements: REQ-pr-read; GAP-pr-shape, GAP-rest-index-size; decisions D2, D6,
D7, D10.

1. Stubs and red: `src/rest/representations/pull-request.ts` throws
   `NotImplementedError`. Write
   `tests/rest-pull-request-representation.test.ts` (including the 54-row
   lifecycle table and the 3-row mergeability table), the pull request parts of
   the properties and coverage files, and
   `tests/rest-pull-request-reads.test.ts` (item, list, 404, media types,
   `head.repo: null` for an unseeded head repository while `base.repo` is
   always present). Record the red run.
2. `src/rest/representations/pull-request.ts`:
   `toRestPullDestination(destination, relations, ctx)`
   (`label = "<owner login>:<ref>"`, `user` as `simple-user`, `repo` as
   `repository` or `null`),
   `toRestPullRequestSimple(pullRequest, relations, ctx)`, and
   `toRestPullRequest(pullRequest, relations, ctx)` (simple plus full-only
   keys). URL group: `diff_url`, `patch_url` (web), `commits_url`,
   `comments_url`, `review_comments_url`, `review_comment_url` (template),
   `statuses_url` (`…/statuses/{head sha}`), and `_links` (`self`, `html`,
   `issue`, `comments`, `review_comments`, `review_comment`, `commits`,
   `statuses`). Lifecycle group per INV-pr-lifecycle.
3. `src/rest/pull-request-handlers.ts`: `pulls/get` and `pulls/list` moved out
   of `src/rest/index.ts`; both negotiate the body media type and resolve base
   and head repositories and accounts. Delete `makeListHandler` and
   `makeItemHandler` if no caller remains. `src/rest/index.ts` ends below 400
   lines.
4. Contract and feature: pull request and missing-resource workflows move to
   value assertions; add the remaining two scenarios. Confirm no red assertion
   remains anywhere.
5. Documentation: capability-matrix rows for issues and pull requests;
   breaking-changes entries for pull request payloads (including
   `state: "merged"` becoming `closed` plus `merged: true`).

End state: every in-scope workflow passes on both lines; all gates pass.

### `EP-M5` Delivery closure

Requirements: REQ-no-patch and every trace link.

1. Run the manual downstream check from `Validation and acceptance` and record
   its outcome and any downstream findings (for example simulacat fixtures that
   fetch unseeded issue and pull request numbers, or a missing actor header for
   `gh.repositories()`).
2. `docs/roadmap.md`: mark 1.4.2 `[x]` with a one-line "Delivered" note
   naming the contract suite.
3. Reconcile `docs/architecture.md`, `docs/api-reference.md`, and
   `docs/github-rest-api-audit.md` with the final implementation; complete
   `Outcomes & retrospective`; set status `COMPLETE`.

## Milestones and plateaus

- `EP-M0`: harness, manifest, guard, and red baseline; REQ-matrix (harness
  side). Evidence: harness tests green; workflow tests assert exact red
  reasons. Recovery: revert the milestone commits; nothing depends on them.
  Remaining: every workflow. Compatibility decision: none.
- `EP-M1`: repository lookup green on both lines; REQ-repo-read,
  REQ-boundary; GAP-store-index-size closed. Recovery: revert; all
  `projectRepositoryResponse` callers move in the same commit, so there is no
  half-migrated state. Remaining: listings, accounts, issues, pull requests.
  Compatibility decision: none (pre-1.0, D10).
- `EP-M2`: listings and account lookups green; REQ-repo-list,
  REQ-account-read. Recovery: revert. Remaining: issues, pull requests.
  Compatibility decision: none.
- `EP-M3`: issue workflows green; REQ-issue-read. Recovery: revert.
  Remaining: the proof (if approved), pull requests. Compatibility decision:
  none.
- `EP-M3P`: proofs green under `make proofs`. Recovery: revert the dev
  dependency, proof files, and target together. Remaining: pull requests.
  Compatibility decision: none.
- `EP-M4`: pull request workflows green; REQ-pr-read; REQ-matrix complete;
  GAP-rest-index-size closed. Recovery: revert. Remaining: closure.
  Compatibility decision: none.
- `EP-M5`: roadmap tick, reconciliation, downstream evidence; REQ-no-patch.
  Recovery: documentation-only revert. Remaining: downstream adoption in
  simulacat (out of scope).

Conformance check at every boundary, one line each:

- The milestone's requirements are satisfied by passing evidence, and no red
  assertion remains for workflows the milestone owns.
- `src/rest/representations/**` imports nothing forbidden (lint green), and
  representations take only resolved records, relation slots, and context.
- `src/rest/index.ts` and `src/store/index.ts` line counts are recorded and do
  not grow (each at or below 400 by the milestone that owns its gap).
- The `egress_guard` self-test passes, and the suite saw no simulator
  `console.error` output.
- No change to `src/index.ts` exports, `simulation()` arguments, exported
  schema inputs, public selector behaviour, or dependencies beyond those
  authorized.
- No new trust boundary beyond the Python child process (Zod-validated output,
  allow-listed environment) and no persisted-format change.
- Trace links in `Conformance basis` still match test and scenario names, and
  documentation for the milestone's behaviour is updated.

## Concrete steps

Working directory: repository root. Use `set -o pipefail` in every shell that
pipes through `tee`. Logs follow
`/tmp/<action>-simulacat-core-1-4-2-move-common-payload-compatibility-into-core.out`.

One-time environment preparation (needs network):

```bash
bun install --frozen-lockfile
make contracts-sync
```

Focused loops (examples):

```plaintext
Stub:  bun test tests/rest-repository-representation.test.ts
       -> fails: NotImplementedError: toRestFullRepository
Red:   bun test tests/github3-contract.test.ts
       -> passes; repository lookup (3.x, 4.x) asserts IncompleteResponse naming 'network_count'
Green: bun test tests/rest-repository-representation.test.ts tests/github3-contract.test.ts
       -> all pass after implementation and switching the lookup tests to value assertions
```

Gate sequence after each milestone, sequential and never in parallel (prefer
delegating to the `scrutineer` agent):

```bash
set -o pipefail
LOG=simulacat-core-1-4-2-move-common-payload-compatibility-into-core
make check-fmt    2>&1 | tee "/tmp/check-fmt-$LOG.out"
make typecheck    2>&1 | tee "/tmp/typecheck-$LOG.out"
make docs-check   2>&1 | tee "/tmp/docs-check-$LOG.out"
make lint         2>&1 | tee "/tmp/lint-$LOG.out"
make test         2>&1 | tee "/tmp/test-$LOG.out"
make spelling     2>&1 | tee "/tmp/spelling-$LOG.out"
make markdownlint 2>&1 | tee "/tmp/markdownlint-$LOG.out"
```

From `EP-M3P` onward, also run `make proofs 2>&1 | tee "/tmp/proofs-$LOG.out"`.
Run `make nixie` only if a Mermaid diagram is added. If `make spelling`
regenerates `typos.toml` with changes unrelated to this work, commit that
refresh separately (as already done at the base of this branch).

## Validation and acceptance

Red-Green-Refactor evidence (D15): for each milestone, record in
`Artefacts and notes` the stub-stage failing command and its
`NotImplementedError` output, the contract red assertions in git, the green
command and pass count, and the post-refactor gate results.

Behavioural acceptance:

- `bun test tests/github3-contract.test.ts` reports, for each of 3.2.0 and
  4.0.1, value-asserted passes for: repository lookup; `repositories_by`;
  organization lookup and its `repositories()`; `user()`; actor listing;
  actor-less listing raising `AuthenticationFailed`; `issue`, `issues`, and
  `gh.issue`; `pull_request`, `pull_requests`, and `gh.pull_request`; and
  missing repository, issue, and pull request lookups raising `NotFoundError`.
  It also reports the harness tests (well-formed results, client versions,
  egress guard, manifest equality, no simulator errors).
- `make test` passes, including the six feature scenarios.
- Manual payload check: start the example server with
  `PORT=3399 bun example/start.ts` in one terminal, then run
  `curl -s -H 'Accept: application/vnd.github.v3.full+json'
  http://127.0.0.1:3399/repos/frontside/test-repo`
  and expect `network_count`, `subscribers_count`, and an `owner` object whose
  `url` is `http://127.0.0.1:3399/users/frontside`. Stop the server with Ctrl-C.
- Manual downstream check (scratch only, not committed): run
  `bun run build && bun pm pack` in this worktree to produce
  `simulacat-core-<version>.tgz`; copy simulacat's `main` into a scratch
  directory under `/tmp`; in its `package.json`, replace the
  `@simulacrum/github-api-simulator` dependency with
  `"simulacat-core": "file:/abs/path/simulacat-core-<version>.tgz"` and update
  the import in its `src/github-sim-server.ts`; delete the `orgs/get`,
  `users/get-by-username`, `repos/get`, `repos/list-for-user`, `issues/get`, and
  `pulls/get` patches; seed issue 1 and pull request 1 in
  `tests/test_github3_compat.py`'s configuration and send `x-simulacat-actor`;
  then run
  `uv run --with "github3.py==3.2.0" pytest tests/test_github3_compat.py` and
  the same with `4.0.1`. Expected: the four in-scope tests pass. Record the
  transcript. If simulacat's own plumbing blocks the check (for example
  `include_unsupported=False` dropping issues), record it as a downstream
  finding, not a core failure.

Quality criteria:

- Tests: `make test` green; no red assertions or expected-failure markers
  remain.
- Verification: every obligation in `Verification plan` discharged with its
  non-vacuity evidence and mutation rows recorded; mutations reverted;
  `make proofs` green if `EP-M3P` ran.
- Lint and types: `make check-fmt`, `make typecheck`, `make docs-check`,
  `make lint`, `make spelling`, `make markdownlint` green.
- Security: no served URL leaves the simulator; the egress guard self-test
  passes; the child environment allow-list excludes tokens.

## Idempotence and recovery

All steps are re-runnable. `make contracts-sync` is idempotent; delete
`tests/contracts/github3/.venv/` (or run `make clean`) to rebuild the
environments. The harness owns its child process group and kills it on deadline
or teardown. If a stray driver process remains, stop only processes whose
command line contains this worktree's absolute path and
`tests/contracts/github3/workflows.py`; other worktrees run the same script.
Seeded mutations are made in the working tree only and reverted with
`git checkout -- <file>` before committing. Each milestone is one or more
commits that pass every gate; roll back with `git revert`.

## Artefacts and notes

Planning probe at `c2e5ddc` (scratch files under `/tmp/gh3probe`, not
committed), CPython 3.14.7, both client lines identical:

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
`full-repository` 75, `repository` 73, `minimal-repository` 46, `issue` 20,
`pull-request` 42, `pull-request-simple` 31, `simple-user` 18. List routes
reference `minimal-repository` (`/users/{username}/repos`, `/orgs/{org}/repos`),
`repository` (`/user/repos`), and `pull-request-simple` (`/pulls`).

Mutation evidence table (filled during implementation): obligation, file,
mutation, failing tests, reverted (yes/no).

## Interfaces and dependencies

New internal module `src/rest/representations/` (not exported from
`src/index.ts`; value imports only from within the module, `src/urls/`, and
`src/http/request-url.ts`; type-only imports from `src/store/**`):

```typescript
// context.ts
export type BodyRepresentation = 'raw' | 'text' | 'html' | 'full';
export type RestRepresentationContext = Readonly<{baseUrls: BaseUrls; body: BodyRepresentation}>;

// account.ts
export const toRestSimpleUser: (account: ResolvedAccount, ctx: RestRepresentationContext) => RestSimpleUser;
export const toRestPublicUser: (
  user: GitHubUser, relations: PublicUserRelations, ctx: RestRepresentationContext
) => RestPublicUser;

// organization.ts
export const toRestOrganization: (
  organization: GitHubOrganization, relations: OrganizationRelations, ctx: RestRepresentationContext
) => RestOrganizationFull;

// repository.ts
export const toRestMinimalRepository: (
  repository: GitHubRepository, owner: ResolvedAccount, ctx: RestRepresentationContext
) => RestMinimalRepository;
export const toRestRepository: (
  repository: GitHubRepository, owner: ResolvedAccount, ctx: RestRepresentationContext
) => RestRepository;
export const toRestFullRepository: (
  repository: GitHubRepository, owner: ResolvedAccount, ctx: RestRepresentationContext
) => RestFullRepository;

// html-escape.ts and body-selection.ts (LemmaScript proof targets)
export const escapeHtml: (text: string) => string;
export const selectBodyRepresentation: (tokens: readonly AcceptToken[]) => BodyRepresentation;

// body.ts
export const tokenizeAccept: (header: string | undefined) => readonly AcceptToken[];
export const negotiateBodyRepresentation: (header: string | undefined) => BodyRepresentation;
export const toRestBodyFields: (body: string, representation: BodyRepresentation) => RestBodyFields;

// issue.ts
export type IssueRelations = Readonly<{
  user: ResolvedAccount;
  labels: readonly never[];
  assignees: readonly ResolvedAccount[];
  milestone: null;
  closedBy: ResolvedAccount | null;
  repositoryOwnerLogin: string;
}>;
export const toRestIssue: (issue: GitHubIssue, relations: IssueRelations, ctx: RestRepresentationContext) => RestIssue;

// pull-request.ts
export const toRestPullDestination: (
  destination: GitHubPullRequest['head'], relations: DestinationRelations, ctx: RestRepresentationContext
) => RestPullDestination;
export const toRestPullRequestSimple: (
  pullRequest: GitHubPullRequest, relations: PullRequestRelations, ctx: RestRepresentationContext
) => RestPullRequestSimple;
export const toRestPullRequest: (
  pullRequest: GitHubPullRequest, relations: PullRequestRelations, ctx: RestRepresentationContext
) => RestPullRequest;
```

The `labels` slot type (`readonly never[]`) is deliberate: it widens to the
label representation when roadmap 1.5.x lands, which is a type change at the
handler, not a new representation signature.

Store addition (`src/store/account-selectors.ts`):

```typescript
export type ResolvedAccount =
  | Readonly<{kind: 'organization'; organization: GitHubOrganization}>
  | Readonly<{kind: 'user'; user: GitHubUser}>
  | Readonly<{kind: 'unseeded'; login: string; id: number; node_id: string}>;
// selectors: resolveAccount(state, login), listRepositoriesOwnedBy(state, login, options),
// listRepositoriesForUser(state, user), countPublicRepositories(state, login)
```

`Rest*` output types are `Readonly` object types declared beside each function;
every `switch` over `ResolvedAccount['kind']` or `BodyRepresentation` ends in a
`never` guard. Reuse policy: every REST route that emits a repository, account,
issue, or pull request uses these functions; no handler builds those shapes
inline; GraphQL keeps its own converters (`src/graphql/converters`). Exporting
representations for extension handlers is out of scope (Constraint 3) and is
raised as an open question in the PR.

Handler files after the change: `src/rest/index.ts` (wiring and remaining
routes), `src/rest/repository-handlers.ts` (repository get and update),
`src/rest/repository-list-handlers.ts`, `src/rest/account-handlers.ts`,
`src/rest/issue-handlers.ts`, `src/rest/pull-request-handlers.ts`.

Contract harness: `tests/support/github3-contract-client.ts`,
`tests/support/github3-contract-fixture.ts`,
`tests/support/github3-observations.ts`, and
`tests/contracts/github3/{pyproject.toml,.python-version,uv.lock,workflows.py,required-fields.json}`.

Dependencies:

- npm: none, except (approval-gated, `EP-M3P`) `lemmascript@0.5.22` as an
  exact-pinned dev dependency, because the toolchain is a tech preview.
- Python, test-only and hash-locked in `tests/contracts/github3/uv.lock`:
  `github3.py==3.2.0` and `github3.py==4.0.1` (with transitive `requests`,
  `uritemplate`, `python-dateutil`, `PyJWT[crypto]`), and `ruff==0.17.5`.
- Interpreter: CPython 3.14 managed by `uv`. Prover (approval-gated): Dafny
  4.x.

## Revision note

- 2026-11-15: Initial draft from Wyvern reconnaissance and a live
  `github3.py` probe.
- 2026-11-15: Community-of-experts review applied (structure and contracts,
  failure modes and operations, verification, alternatives and viability).
  Changes: the pull request lifecycle domain is corrected to stored
  `open | closed | merged` (54-row table; `merged` maps to `closed` plus
  `merged: true`); three repository levels with OpenAPI-correct per-route
  choices; organization fields that `github3.py` requires are added;
  `GET /users/{username}` is brought into scope (D3) to close an egress path;
  missing-resource scenarios assert `NotFoundError`; the store mints synthetic
  account identity in `[2^40, 2^41)` with collision salting; account
  representations are allow-lists; public selectors are left intact and owner
  helpers move to `src/store/account-selectors.ts` (closing
  GAP-store-index-size); D13 response convention; D14 list order and filtering;
  the harness is hardened (`make contracts-sync`, direct interpreters,
  120-second hooks, sentinel framing, audit-hook egress guard with an
  environment allow-list, loopback-only `listen`, one memoized batch per client
  line, Dependabot and CI cache); red evidence moves from `test.failing` to
  structured red assertions and `NotImplementedError` stubs (D15); the manifest
  is generated from the real clients; new invariants (error shape, cross-links,
  override precedence, idempotence, tokenizer metamorphic properties); coverage
  is asserted with seeded `fc.sample`; an approval-gated LemmaScript milestone
  `EP-M3P` is added (D11); documentation moves into each milestone; budgets are
  recounted (files 65; code 3,100 with `src/` 1,250 and proofs 350;
  configuration 170; documentation 600; 800 per milestone). Remaining work is
  unchanged in intent; the milestone order gains `EP-M3P`.
