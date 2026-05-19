# Add request-scoped actor resolution

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: COMPLETE

Roadmap reference: `docs/roadmap.md` task `1.2.1` under section 1.2 "Make
request actors visible to REST and GraphQL".

Approval gate: satisfied on 2026-05-17T14:38:16+02:00 when the user asked to
proceed with implementation of the planned functionality. Drafting this
document, validating it, and committing the plan were completed before
approval. Branch renaming, upstream tracking, pushing, and draft PR creation
were also completed before implementation at the user's explicit request.

## Purpose / big picture

Simulacat Core currently answers REST `GET /user` and GraphQL `viewer` by
selecting the first seeded user from the in-memory store. That shortcut makes
fixtures brittle: adding another user can silently change who the simulated
caller is, and later work on permissions, team administration, branch
protection, pull requests, and mergeability would have to work around a
route-local identity guess.

After this work, each incoming request can carry an explicit actor. An actor is
the identity the simulator treats as making the request. The minimum supported
actor kinds are anonymous, user, app, and installation. `GET /user` and
GraphQL `viewer` resolve from that request actor, not from seed ordering. A
test fixture with two seeded users can prove that a request for `dev` returns
`dev`, a request for `reviewer` returns `reviewer`, and an anonymous or unknown
actor does not accidentally fall back to the first seeded user.

This task deliberately does not implement full GitHub authorization. It creates
the shared actor resolution spine that later tasks can reuse for permission
checks. REST and GraphQL adapters should call shared selectors and actor
helpers rather than parsing users independently.

## Constraints

Hard invariants that must hold throughout implementation. Violation requires
escalation, not workarounds.

- Do not implement this plan until the user explicitly approves it.
- Before implementation, run `git branch --show-current`. If the branch is
  `main`, `master`, or another default branch, stop and ask for direction.
- Rename the implementation branch to
  `1-2-1-request-scoped-actor-resolution` before implementation work starts.
  Once the remote branch exists, track
  `origin/1-2-1-request-scoped-actor-resolution`.
- Preserve existing public exports and fixture compatibility unless this plan
  is revised and approved. Existing users who seed only users, organizations,
  repositories, branches, blobs, refs, commits, issues, pull requests, and
  installations must not be forced to rewrite those fixtures.
- Support anonymous, user, app, and installation actor kinds. The actor model
  must be typed, explicit, and request-scoped.
- Do not introduce real token validation, signature verification, permission
  enforcement, scopes, rate limits, or GitHub App JWT cryptography in this
  task. Those behaviours are broader authorization work.
- Keep actor domain and policy logic in store schemas, selectors, key helpers,
  or a small shared actor module. REST and GraphQL adapters may translate
  request headers into actor input, but they must not own the selection rules.
  This applies the `hexagonal-architecture` skill as a boundary check, not as
  a directory transplant.
- GraphQL `viewer` must receive request context through GraphQL Yoga rather
  than closing over a global or first seeded user.
- `GET /user` and GraphQL `viewer` must agree for equivalent request actor
  inputs.
- Preserve the existing `GET /user/memberships/orgs` behaviour where a
  selected user sees only their organizations, but replace the first-user
  fallback with the same actor-aware selection used by `/user`.
- Do not add a runtime dependency without explicit approval. Development
  dependencies also require approval unless they are already present in
  `package.json`.
- Property tests using `fast-check` are required if the implementation adds
  actor key parsing, token-like parsing, or invariants over a range of actor
  ids, logins, or installation ids.
- A LemmaScript proof is required only if the implementation introduces a new
  business axiom whose correctness cannot be adequately expressed with ordinary
  examples and property tests. If such a proof appears necessary, stop and ask
  for approval before adding proof tooling.
- Update relevant documentation in the implementation branch:
  `docs/api-reference.md`, `docs/github-rest-api-audit.md`,
  `docs/github-graphql-api-audit.md`, `docs/architecture.md`,
  `docs/users-guide.md`, and the actual developer-facing guide
  `docs/development.md`. The requested `docs/developers-guide.md` file does
  not exist in this repository.
- Mark `docs/roadmap.md` task `1.2.1` done only after implementation,
  documentation, gates, CodeRabbit review, and draft PR preparation are
  complete.
- Run quality gates sequentially and capture long output with `tee` under
  `/tmp`, using names such as
  `/tmp/check-fmt-simulacat-core-1-2-1-request-scoped-actor-resolution.out`.
  Do not run formatting, linting, tests, or sub-agent test commands in
  parallel.
- Use `coderabbit review --agent` after each major milestone. Clear all
  reported concerns before moving to the next milestone, or document why a
  concern requires user direction.
- Commit after each approved change or major milestone, and gate each commit.
  Use the `commit-message` skill and commit with `git commit -F`, not
  `git commit -m`.

## Tolerances (exception triggers)

- Scope: if implementation requires touching more than 16 files or more than
  700 net source lines, stop and ask for approval to continue. Documentation,
  tests, and generated files do not count toward the source-line threshold but
  must still be reviewed.
- Interface: if an existing exported function signature in `src/index.ts`,
  `src/store/index.ts`, `src/store/entities.ts`, or `src/graphql/handler.ts`
  must change incompatibly, stop and present options.
- Request contract: if there are multiple viable actor input formats with
  materially different user experience, stop and ask for approval. A compatible
  simulator header may be added, but it must be documented.
- Dependency: if a new runtime dependency is needed, stop. If a new
  development dependency is needed, stop unless the user approves it.
- Authorization: if a route cannot be made actor-aware without implementing
  permission enforcement, leave that enforcement deferred and document the
  limitation. Do not expand the task into full auth.
- GraphQL: if `viewer` cannot receive request context through Yoga without a
  larger resolver refactor, stop and present the smallest options.
- Tests: if the same quality gate still fails after three focused remediation
  attempts, stop and record the failing evidence in this plan.
- CodeRabbit: if `coderabbit review --agent` is unavailable, cannot
  authenticate, or reports concerns that exceed these tolerances, stop and
  record the reason before proceeding.
- PR: if the branch already has an open PR under another branch name, use
  GitHub's branch rename flow rather than pushing a differently named branch
  over it.

## Risks

- Risk: the actor contract could accidentally look like real GitHub token
  validation.
  Severity: high.
  Likelihood: medium.
  Mitigation: document the contract as simulator-controlled actor selection.
  Use explicit development headers or deterministic fixture tokens rather than
  claiming support for real OAuth, PAT, JWT, or installation token validation.

- Risk: app and installation actors do not naturally map to GraphQL `User`.
  Severity: medium.
  Likelihood: high.
  Mitigation: define the first slice's observable behaviour carefully. `/user`
  and `viewer` should return a user only for a user actor. App and
  installation actors should resolve as actors for later policy use, but
  authenticated-user surfaces may return a GitHub-shaped auth error until an
  app bot account model is explicitly introduced.

- Risk: `GET /user/memberships/orgs` already supports `x-simulacat-user` and
  `x-github-user`, while `/user` does not.
  Severity: medium.
  Likelihood: high.
  Mitigation: preserve those headers as compatibility aliases during this
  slice, route them through the shared resolver, and document the preferred
  request actor header.

- Risk: GraphQL Yoga context wiring may expose type mismatches with the
  generated resolver types.
  Severity: medium.
  Likelihood: medium.
  Mitigation: keep the context type small and local. Add focused GraphQL tests
  before changing implementation. If generated types need regeneration, run
  `bun run generate` and inspect diffs before proceeding.

- Risk: tests could pass, while REST and GraphQL disagree about actor
  selection.
  Severity: high.
  Likelihood: medium.
  Mitigation: add integration tests that send equivalent actor input to
  `/user` and `/graphql` and assert matching login and id values.

- Risk: the current roadmap asks for anonymous, user, app, and installation
  actors, but only `/user` and `viewer` are required observable surfaces in
  `1.2.1`.
  Severity: medium.
  Likelihood: high.
  Mitigation: unit-test all four actor kinds at the selector/parser level, and
  behavioural-test the user-facing surfaces where the actor kind has defined
  GitHub-shaped output.

- Risk: external GitHub documentation changes over time.
  Severity: low.
  Likelihood: medium.
  Mitigation: cite the specific documentation consulted during planning:
  GitHub REST users docs, GitHub App installation auth docs, and GitHub
  GraphQL auth docs as scraped on 2026-05-16.

## Progress

- [x] (2026-05-16T23:55:12+02:00) Loaded the `leta`, `execplans`,
  `hexagonal-architecture`, `firecrawl-mcp`, and `commit-message` skill
  workflows relevant to this planning task.
- [x] (2026-05-16T23:55:12+02:00) Created a leta workspace for
  `/home/leynos/.lody/repos/github---leynos---simulacat-core/worktrees/d58847cc-43e0-48ce-a607-0d18eeb80691`.
- [x] (2026-05-16T23:55:12+02:00) Confirmed the current branch is
  `feat/request-actor-plan`, not a default branch.
- [x] (2026-05-16T23:55:12+02:00) Used a Wyvern agent for read-only
  reconnaissance of request actor touchpoints.
- [x] (2026-05-16T23:55:12+02:00) Used Firecrawl to inspect current GitHub
  documentation for REST `/user`, GraphQL authentication, and GitHub App
  installation authentication.
- [x] (2026-05-16T23:55:12+02:00) Drafted this ExecPlan for review.
- [x] (2026-05-17T14:38:16+02:00) Received explicit approval to implement the
  planned functionality.
- [x] (2026-05-17T14:38:16+02:00) Confirmed the current branch is
  `1-2-1-request-scoped-actor-resolution` and tracks
  `origin/1-2-1-request-scoped-actor-resolution`.
- [x] Rename branch and set upstream tracking.
- [x] (2026-05-17T14:42:29+02:00) Implemented milestone 1:
  added the shared actor parser and resolver in `src/store/actors.ts`, with
  unit tests and a `fast-check` property test in `tests/actors.test.ts`.
- [x] (2026-05-17T14:44:20+02:00) Ran
  `coderabbit review --agent` for milestone 1; CodeRabbit reported zero
  findings.
- [x] (2026-05-17T14:45:34+02:00) Implemented milestone 2:
  REST `GET /user` and `GET /user/memberships/orgs` now resolve the
  authenticated user through the shared request actor helpers, and
  `tests/user.test.ts` covers selected users, missing actors, app and
  installation actors, and membership scoping.
- [x] (2026-05-17T14:47:42+02:00) Ran
  `coderabbit review --agent` for milestone 2; CodeRabbit reported zero
  findings.
- [x] (2026-05-17T14:48:49+02:00) Implemented milestone 3:
  GraphQL Yoga now builds request context from request headers, `viewer`
  resolves through the shared actor helpers, and `tests/graphql.test.ts`
  covers selected users, unauthenticated actor kinds, and REST/GraphQL
  agreement for equivalent actor input.
- [x] (2026-05-17T14:51:51+02:00) Ran
  `coderabbit review --agent` for milestone 3; CodeRabbit reported zero
  findings.
- [x] (2026-05-17T14:51:51+02:00) Updated the user, developer,
  architecture, API reference, REST audit, GraphQL audit, and roadmap
  documentation for request-scoped actor behaviour.
- [x] (2026-05-17T14:55:00+02:00) Ran `bun fmt`,
  `bunx markdownlint-cli2 "**/*.md"`, `make check-fmt`, `make lint`, and
  `make test`; all passed. `make test` reported 197 passing tests across 13
  files.
- [x] (2026-05-17T14:58:32+02:00) Ran final
  `coderabbit review --agent`; CodeRabbit reported zero findings.
- [x] (2026-05-17T14:58:32+02:00) Implemented milestone 4:
  documentation is updated, roadmap item `1.2.1` is marked done, gates pass,
  CodeRabbit has no findings, and the branch is ready to push to the existing
  draft PR.

## Surprises & Discoveries

- `docs/developers-guide.md` does not exist. The repository's developer-facing
  guide is `docs/development.md`, and existing ExecPlans already use that file
  for developer documentation updates.
- `GET /user/memberships/orgs` already accepts `x-simulacat-user` and
  `x-github-user` headers, but falls back to the first seeded user when those
  headers are absent.
- `GET /user` ignores those headers and always returns the first seeded user,
  or `401` when no user is seeded.
- GraphQL `viewer` is implemented in `src/graphql/resolvers.ts` and also
  selects the first seeded user.
- `src/graphql/handler.ts` creates the Yoga handler without request context,
  so `viewer` cannot currently inspect request headers.
- Official GitHub REST docs state that `GET /user` is for authenticated users
  and can return `401 Requires authentication`.
- Official GitHub App installation docs state that installation access tokens
  work with both REST and GraphQL, but individual endpoint permissions still
  apply.
- Official GitHub GraphQL docs state that GraphQL can authenticate with a
  personal access token, GitHub App, or OAuth app. This plan uses that only as
  prior art for actor kinds, not as a commitment to validate real tokens.
- `fast-check`'s `stringMatching` arbitrary can generate strings that contain
  an unanchored regular expression rather than strings that equal it. The
  actor login round-trip property now uses an anchored login pattern.
- User fixture emails are generated when omitted. Actor selection tests now
  seed explicit email addresses, so failures describe actor behaviour rather
  than faker output.
- GraphQL Yoga exposes thrown `Error` messages directly because this simulator
  sets `maskedErrors: false`. `assert-ts` prefixes assertion messages, so
  `viewer` now throws a plain `Error` for the authentication-shaped failure.
- The current GraphQL user converter populates the GraphQL `id` field from the
  seeded user id string, but not `databaseId`. The REST/GraphQL agreement test
  therefore compares REST `id` with GraphQL `id`.
- Markdown tables in the API reference and audit documents use aligned pipe
  columns. Long cell edits required a mechanical table realignment pass, and
  escaped pipe characters in inline type unions had to be preserved while
  doing that.

## Decision Log

- Decision: model actors as simulator request context, not as real GitHub
  credentials.
  Rationale: roadmap item `1.2.1` asks whether authenticated GitHub concepts
  can be represented without fixed store shortcuts. Real credential validation
  would be a larger authorization project, and would obscure the core selector
  change.

- Decision: keep app and installation actor support in the resolver/parser
  layer for this slice, but define `/user` and `viewer` success around user
  actors.
  Rationale: GitHub's authenticated-user surfaces return user-shaped data.
  Simulacat Core does not yet have a first-class GitHub App bot account model.
  App and installation actors are still needed, so later permission and mutation
  slices can consume the same actor context.

- Decision: use `docs/development.md` for developer guidance updates instead
  of creating `docs/developers-guide.md`.
  Rationale: the requested file is absent, and the repository already names
  `docs/development.md` as the developer guide.

- Decision: preserve `x-simulacat-user` and `x-github-user` as compatibility
  aliases while documenting one preferred request actor mechanism.
  Rationale: existing tests and users may already rely on those headers for
  membership flows. Removing them is unnecessary for this roadmap item.

- Decision: use `x-simulacat-actor` as the preferred simulator actor header,
  with values `anonymous`, `user:<login>`, `app:<id-or-slug>`, and
  `installation:<id>`.
  Rationale: one explicit development header keeps actor selection separate
  from real GitHub credentials while representing the four required actor
  kinds. Existing `x-simulacat-user` and `x-github-user` headers remain
  compatibility aliases for user actors.

- Decision: defer branch rename, upstream tracking, push, draft PR creation,
  and roadmap completion until after plan approval.
  Rationale: the user explicitly stated that the plan must be approved before
  implementation.

## External references and prior art

- GitHub REST `GET /user` documentation[^1]
- GitHub App installation authentication documentation[^2]
- GitHub GraphQL authentication documentation[^3]

These references are signposts for actor semantics only. Simulacat Core should
remain explicit that this slice provides simulator actor selection, not full
GitHub authentication or authorization.

## Implementation plan

Implementation proceeds only after explicit approval.

Milestone 1 adds the shared actor model. Inspect `src/store/index.ts`,
`src/store/entities.ts`, `src/store/entities/installation.ts`, and existing
selectors. Add a small actor module or store selector set that can represent:
anonymous, user by login, app by app id or slug when available, and
installation by installation id. Add a request parser that reads documented
simulator headers and compatibility aliases. The preferred contract should be
simple enough for tests and users to set with `fetch` headers. Unit tests
should cover all actor kinds, unknown user login, unknown installation id, and
anonymous requests. If actor key parsing has a grammar, add `fast-check`
property tests for round trips and invalid input rejection.

Milestone 2 rewires REST authenticated-user routes. Update
`src/rest/index.ts` so `users/get-authenticated` uses the shared actor
resolver. A user actor returns the matched user. Anonymous, unknown,
app-only, and installation-only actors return `401` with the existing
GitHub-shaped `{message: "Authentication required"}` body unless an approved
revision defines a bot-user mapping. Update
`orgs/list-memberships-for-authenticated-user` to use the same resolved user
actor and remove the first-user fallback. Add or update `tests/user.test.ts`
so a store with multiple users proves `/user` selects the request actor, not
the first seed, and memberships are scoped to that actor.

Milestone 3 rewires GraphQL `viewer`. Update `src/graphql/handler.ts` to pass
a minimal request context into GraphQL Yoga. Update
`src/graphql/resolvers.ts` so `Query.viewer` uses the shared actor resolver
from context and returns the same user as REST for a user actor. Add
behavioural tests in `tests/graphql.test.ts` for user actor selection, unknown
or anonymous actor failure, and REST/GraphQL agreement. The expected failure
shape should match GraphQL Yoga's existing unmasked error behaviour, unless the
repository already has a GraphQL auth-error convention.

Milestone 4 updates documentation and release artefacts. Update
`docs/api-reference.md` so `GET /user`, `GET /user/memberships/orgs`, and
`viewer` no longer claim first-seeded-user behaviour. Update the REST and
GraphQL audit docs with the new actor-aware behaviour and remaining limitation
that authentication is represented, not enforced. Update
`docs/architecture.md` and `docs/development.md` with the actor module,
request-context flow, and testing expectations. Update `docs/users-guide.md`
with the user-visible request actor header contract. Mark roadmap item `1.2.1`
done after gates and review pass.

Milestone 5 performs final validation and publishing work. Run, sequentially,
`bun fmt` if formatting changed, `make check-fmt`, `make lint`, and
`make test`, each with `tee` logs under `/tmp`. Run
`coderabbit review --agent` and clear every actionable concern. Commit the
final implementation state. Run `echo ${LODY_SESSION_ID}`. Push the renamed
branch and create a draft PR whose title includes the roadmap item number as
requested: `(1.2.1) Request-scoped actor resolution`. Mention this ExecPlan in
the PR summary and include a `## References` section with the Lody session
link `https://lody.ai/leynos/sessions/${LODY_SESSION_ID}`.

## Validation strategy

The first implementation commit should add failing tests before production
code where practical.

Run focused tests during development:

```bash
bun test tests/user.test.ts
bun test tests/graphql.test.ts
```

Expected evidence after implementation:

```plaintext
tests/user.test.ts:
- `/user` returns 401 for anonymous or unknown actors.
- `/user` returns the selected seeded user for a user actor even when that user
  is not first in the seed list.
- `/user/memberships/orgs` scopes memberships to the selected user actor and
  does not fall back to the first user.

tests/graphql.test.ts:
- `viewer { login }` returns the selected seeded user for a user actor.
- `viewer` fails with an authentication-shaped error for anonymous or unknown
  actors.
- Equivalent REST and GraphQL requests resolve the same actor login.
```

Run full gates before each commit that claims a complete milestone:

```bash
make check-fmt 2>&1 | tee /tmp/check-fmt-simulacat-core-1-2-1-request-scoped-actor-resolution.out
make lint 2>&1 | tee /tmp/lint-simulacat-core-1-2-1-request-scoped-actor-resolution.out
make test 2>&1 | tee /tmp/test-simulacat-core-1-2-1-request-scoped-actor-resolution.out
```

If documentation tables or Markdown wrapping change, also run:

```bash
bunx markdownlint-cli2 "**/*.md" 2>&1 | tee /tmp/markdownlint-simulacat-core-1-2-1-request-scoped-actor-resolution.out
```

## Outcomes & Retrospective

Implemented.

The request actor contract uses `x-simulacat-actor` with values `anonymous`,
`user:<login>`, `app:<id-or-slug>`, and `installation:<id>`. Legacy
`x-simulacat-user` and `x-github-user` headers remain aliases for user actors.
REST `/user`, REST `/user/memberships/orgs`, and GraphQL `viewer` now resolve
from the request actor instead of the first seeded user. User actors return the
selected seeded user. Anonymous, unknown, app, and installation actors do not
map to authenticated-user payloads in this slice and return or surface
`Authentication required`.

Code changes landed in:

- `0f4a927` — shared actor parser, resolver, unit tests, and `fast-check`
  coverage.
- `141accc` — REST `/user` and membership actor resolution.
- `962f513` — GraphQL Yoga request context and `viewer` actor resolution.
- `2e7387f` — documentation and roadmap updates.

Validation passed with:

- `bun fmt`
- `bunx markdownlint-cli2 "**/*.md"`
- `make check-fmt`
- `make lint`
- `make test` with 197 passing tests across 13 files
- `coderabbit review --agent` after milestones 1, 2, 3, and final
  documentation, each with zero findings

The implementation branch is `1-2-1-request-scoped-actor-resolution`, tracking
`origin/1-2-1-request-scoped-actor-resolution`. The draft PR is
`https://github.com/leynos/simulacat-core/pull/10`. The Lody session is
`https://lody.ai/leynos/sessions/d58847cc-43e0-48ce-a607-0d18eeb80691`.

[^1]: <https://docs.github.com/rest/users/users?apiVersion=2026-03-10>
[^2]: <https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation>
[^3]: <https://docs.github.com/en/graphql/guides/forming-calls-with-graphql>
