# GitHub API scriptability roadmap

This roadmap translates the current Simulacat Core architecture guide, API
reference, REST audit, and GraphQL audit into an outcome-oriented delivery
sequence. It does not promise dates. Each phase carries one testable idea at
the Goals, Ideas, Steps, Tasks (GIST) level. Each step is a workstream that
validates or falsifies part of that idea, and each task is a review-sized
execution unit with explicit dependencies and source citations.

The delivery order is shaped by the current consumer portfolio rather than by
generic GitHub collaboration parity. Concordat drives repository administration
and branch governance, Ghillie drives read-heavy GraphQL behaviour, and
shared-actions drives mergeability, auto-merge, release lookup, and related
automation flows. Nile Valley remains relevant, but it should not dominate the
queue because its core workflows lean more heavily on plain Git operations and
GitHub Actions file semantics than on deep REST or GraphQL behaviour.

REST and GraphQL should become parallel views over the same state, actor
context, and domain events. The roadmap therefore keeps early foundation work
narrow, uses consumer-shaped vertical slices, and defers broad surfaces such
as Projects v2, code scanning, enterprise administration breadth, and webhook
breadth until the shared substrate is credible.

| Phase | Primary consumer               | Delivered capability                                                    |
| ----- | ------------------------------ | ----------------------------------------------------------------------- |
| 1     | All consumers                  | Canonical identities, actors, mutation plumbing, and fixtures.          |
| 2     | Ghillie, shared-actions        | Read-heavy GraphQL parity for refs, history, pull requests, and issues. |
| 3     | Concordat, shared-actions      | Real branch-to-pull-request state transitions.                          |
| 4     | Concordat                      | Repository administration, branch protection, and teams.                |
| 5     | shared-actions, Concordat      | Statuses, checks, mergeability, auto-merge, and release tag lookup.     |
| 6     | Concordat, shared-actions      | Review state and approval modelling.                                    |
| 7     | Concordat                      | Review threads and conversation resolution.                             |
| 8     | Reporting and triage consumers | Deeper issue collaboration and timelines.                               |
| 9     | simulacat and test harnesses   | Capability matrix, fixture recipes, and scenario suites.                |
| 10    | App integrations               | Webhooks and delivery inspection.                                       |
| 11    | Concordat follow-on work       | Governance extras such as Projects v2 and code scanning.                |

## 1. Foundational identities, actors, and mutation spine

Idea: if Simulacat Core first settles canonical identities, request actors,
shared write actions, and fixture builders, later consumer slices can reuse one
coherent state model instead of repeatedly reworking route-local shortcuts.

This phase keeps the foundation narrow. It fixes the store assumptions that
would otherwise make GraphQL reads, administration workflows, pull request
mutation, and mergeability logic unreliable.

### 1.1. Prove repository identity is owner-scoped and ref-safe

This step answers whether repository, branch, and ref data can coexist under
GitHub-like owner namespaces. Its outcome informs every later selector and
mutation task. See docs/architecture.md §State model,
docs/api-reference.md §Exported fixture schemas, and
docs/github-rest-api-audit.md §Store and Modeling Constraints.

- [ ] 1.1.1. Re-key repositories and refs by canonical identifiers.
  - Carries legacy task label `1.1.1`.
  - Use stable keys such as `owner/name` and `owner/name:ref`.
  - Remove assumptions that repository and branch names are globally unique.
  - Success: two repositories with the same name under different owners can
    coexist and remain addressable through REST, GraphQL, and store selectors.
- [ ] 1.1.2. Add the first-class entities needed for the early slices.
  - Carries the minimal early subset of legacy task label `1.1.2`.
  - Requires 1.1.1.
  - Cover refs, commits, issues, and pull requests only to the depth needed by
    phases 2 and 3.
  - Defer the wider collaboration lattice until later slices need it.
  - Success: phase 2 and phase 3 fixtures can be expressed without ad hoc
    route-local state.

### 1.2. Make request actors visible to REST and GraphQL

This step answers whether authenticated GitHub concepts can be represented
without fixed store shortcuts. Its outcome informs `/user`, GraphQL `viewer`,
permissions, team administration, and protected-branch behaviour. See
docs/api-reference.md §Capability matrix,
docs/github-rest-api-audit.md §Store and Modeling Constraints, and
docs/github-graphql-api-audit.md §Explicit Coverage.

- [ ] 1.2.1. Add request-scoped actor resolution.
  - Carries legacy task label `1.2.1`.
  - Requires 1.1.2.
  - Support at least anonymous, user, app, and installation actors.
  - Replace the current `/user` and GraphQL `viewer` shortcuts with
    actor-aware selectors.
  - Success: `/user` and `viewer` resolve from the request actor rather than
    from the first seeded user.
- [ ] 1.2.2. Expose actor context to REST and GraphQL handlers.
  - Carries legacy task label `1.2.3`.
  - Requires 1.2.1.
  - Make actor context available to OpenAPI handlers, GraphQL resolvers, and
    caller-provided extension routes.
  - Success: built-in and extension handlers can make consistent actor-aware
    decisions without duplicating request parsing.

### 1.3. Centralize writes and reusable fixture construction

This step answers whether mutations and test fixtures can share one domain
path. Its outcome informs pull request lifecycle work, issue mutations,
webhooks, and external scenario recipes. See docs/architecture.md
§Extension seams, docs/development.md §Testing expectations, and
docs/github-rest-api-audit.md §Extension Surface.

- [ ] 1.3.1. Add shared domain actions for write behaviour.
  - Carries legacy task label `1.3.1`.
  - Requires steps 1.1-1.2.
  - Centralize mutating behaviour in reducers and shared actions instead of
    route-local state updates.
  - Success: at least one REST and one GraphQL-facing read path can observe
    state written through the same action.
- [ ] 1.3.2. Publish actor-aware fixture builders.
  - Carries legacy task label `1.3.3`.
  - Requires 1.3.1.
  - Provide builders for repositories, refs, issues, and pull requests without
    hand-editing store state.
  - Success: new tests can compose actor-aware repository fixtures through
    published builders.

## 2. GraphQL read model for repository triage

Idea: if Simulacat Core can answer read-heavy GraphQL queries for refs,
history, pull requests, and issues from shared state, Ghillie and
shared-actions can rely on the simulator for real triage workflows before
broad mutation coverage lands.

This phase moves ahead of full issue mutation because the audits show that
GraphQL has a large schema surface but a narrow set of meaningful resolvers.
The slice is intentionally shaped around current consumer queries rather than
schema-wide optimism.

### 2.1. Prove repository refs and history are queryable through GraphQL

This step answers whether repository refs, commit history, and tree traversal
can move beyond placeholder behaviour. Its outcome informs pull request read
queries and later release-tag support. See docs/github-graphql-api-audit.md
§Recommended Follow-Ups, docs/api-reference.md §GraphQL fields, and
docs/github-rest-api-audit.md §Recommended Follow-Ups.

- [ ] 2.1.1. Implement GraphQL repository refs and commit history.
  - Carries legacy task label `2.1.1`.
  - Requires steps 1.1-1.3.
  - Support `Repository.ref(qualifiedName)` and commit `history`.
  - Fix broken or partial ref behaviours that prevent meaningful reads.
  - Success: GraphQL can answer repository ref and history queries without
    placeholder-only data.
- [ ] 2.1.2. Add basic tree traversal backed by repository blob state.
  - Carries the tree-traversal portion of legacy task label `2.1.1`.
  - Requires 2.1.1.
  - Align the GraphQL traversal with the REST tree limitation documented in
    the REST audit.
  - Success: tree traversal behaviour is explicitly classified as scriptable,
    partially scriptable, or deferred in the capability matrix.

### 2.2. Deliver pull request reads before pull request writes

This step answers whether consumers can inspect pull requests through GraphQL
before the full state machine exists. Its outcome informs the phase 3 mutation
shape. See docs/github-graphql-api-audit.md §Explicit Coverage and
docs/api-reference.md §Capability matrix.

- [ ] 2.2.1. Implement GraphQL pull request list and detail reads.
  - Carries legacy task label `3.1.2`.
  - Requires 2.1.1.
  - Support `repository.pullRequests` and `repository.pullRequest(number)`.
  - Add the field set currently required by Ghillie and shared-actions, with
    cursor pagination.
  - Success: supported pull request fields reflect actual consumer queries
    rather than schema breadth alone.

### 2.3. Expose the issue read subset needed for triage

This step answers how much issue state must exist before write-side issue
collaboration can wait. Its outcome informs phase 8 and the capability matrix.
See docs/github-graphql-api-audit.md §Public Schema vs Runtime Behavior and
docs/api-reference.md §GraphQL fields.

- [ ] 2.3.1. Implement the GraphQL issue visibility subset.
  - Carries the read-side subset of legacy task label `2.2.1`.
  - Requires 1.1.2 and 2.1.1.
  - Support `repository.issues` and the issue fields current consumers fetch.
  - Defer broad issue mutation, timelines, and notifications to phase 8.
  - Success: REST and GraphQL issue reads share the same underlying issue
    state.

## 3. Branch-to-pull-request state machine

Idea: if a test can create a branch, open a pull request, mutate its state,
and read that state consistently through REST and GraphQL, Simulacat Core will
have a real scriptable collaboration object instead of ornamental pull request
JSON.

This phase lands before rich issue collaboration because Concordat and
shared-actions both need pull requests to be mutable, stateful objects.

### 3.1. Implement the pull request lifecycle

This step answers whether pull request writes can share the phase 1 action
spine. Its outcome informs timelines, branch protection, mergeability, and
review state. See docs/architecture.md §High-level flow and
docs/github-rest-api-audit.md §Extension Surface.

- [ ] 3.1.1. Implement create, update, close, and reopen flows.
  - Carries legacy task label `3.2.1`.
  - Requires 2.2.1 and 1.3.1.
  - Model base ref, head ref, draft state, author, and open or closed state as
    first-class mutable data.
  - Success: a test can create a feature branch, open a pull request against
    another branch, change its state, and read the same state through REST and
    GraphQL.

### 3.2. Preserve state transitions as timeline events

This step answers whether state changes leave inspectable history rather than
being reconstructed from unrelated route responses. Its outcome informs review
threads, issue timelines, and webhooks. See docs/github-rest-api-audit.md
§Recommended Follow-Ups and docs/github-graphql-api-audit.md §Recommended
Follow-Ups.

- [ ] 3.2.1. Add pull request timeline items for core transitions.
  - Carries legacy task label `3.2.3`.
  - Requires 3.1.1.
  - Include opened, converted to draft, ready for review, closed, and reopened
    events.
  - Success: pull request timelines expose the key transitions without
    reconstructing them from unrelated route responses.

### 3.3. Link pull requests to branches, commits, and issues

This step answers which adjacent objects must be connected for the state
machine to remain coherent. Its outcome informs mergeability, release lookup,
and issue collaboration. See docs/architecture.md §State model and
docs/api-reference.md §Exported fixture schemas.

- [ ] 3.3.1. Connect pull requests to branches, commits, and minimal issues.
  - Carries the required expansion of legacy task label `3.1.1`.
  - Requires 3.1.1 and 3.2.1.
  - Keep the issue link minimal until phase 8.
  - Success: pull request state changes can be traced to branch, commit, and
    issue references without duplicating identifiers.

## 4. Concordat administration and branch governance

Idea: if Concordat-style repository policy, branch protection, teams, and
permissions can be scripted through the simulator, Simulacat Core can support
real governance automation before deeper review and webhook breadth land.

This phase is new relative to the older collaboration-first order. It must land
before deep review work because Concordat's core value sits in repository
governance, protected branches, and team-driven access control.

### 4.1. Make repository policy settings scriptable

This step answers whether repository administration can move from example
responses to store-backed policy state. Its outcome informs branch protection
and mergeability. See docs/github-rest-api-audit.md §What Is Stubbed But Not
Really Mocked and docs/api-reference.md §REST endpoints.

- [ ] 4.1.1. Add repository settings scriptability.
  - Requires steps 1.1-1.3.
  - Cover merge strategy controls, delete-branch-on-merge, and related
    repository policy flags that Concordat manages directly.
  - Success: Concordat-style workflows can script repository policy without
    bypassing the simulator.

### 4.2. Model branch protection as policy state

This step answers whether protected-branch rules can be configured before they
are enforced by mergeability. Its outcome informs phases 5 and 6. See
docs/github-rest-api-audit.md §Built-In Scriptable REST Coverage and
docs/api-reference.md §Capability matrix.

- [ ] 4.2.1. Add required-review and required-check branch protection state.
  - Requires 4.1.1.
  - Preserve the required-review and required-status-check portions of the
    existing branch protection scope.
  - Success: branch protection state is visible through configuration reads
    and can be consumed by downstream mergeability decisions.
- [ ] 4.2.2. Add the remaining branch protection policy flags.
  - Requires 4.2.1.
  - Model signed commits, linear history, force-push constraints, and
    conversation-resolution gates.
  - Success: all branch protection flags named by the roadmap are represented
    as store-backed policy rather than hard-coded response branches.

### 4.3. Keep permissions minimal until governance needs more depth

This step answers how much permission modelling is needed for administration
without building a broad matrix prematurely. Its outcome informs team
membership, protected branches, and actor-aware handlers. See
docs/github-rest-api-audit.md §Store and Modeling Constraints and
docs/github-graphql-api-audit.md §Recommended Follow-Ups.

- [ ] 4.3.1. Deliver the minimum viable permission lattice.
  - Carries the administration-sized subset of legacy task label `1.2.2`.
  - Requires 1.2.2 and 4.1.1.
  - Model user, app, installation, and team access only to the depth needed by
    repository administration and protected-branch behaviour.
  - Success: permission decisions needed by repository settings and branch
    protection do not depend on fixed actor shortcuts.
- [ ] 4.3.2. Add teams, team membership, and team-repository permissions.
  - Requires 4.3.1.
  - Replace empty organization team and membership placeholders with
    store-backed behaviour.
  - Support the repository permission states Concordat manages.
  - Success: organization team and membership reads no longer return
    placeholder-only empty data for configured fixtures.

## 5. Checks, mergeability, auto-merge, and release lookup

Idea: if shared-actions can observe mutable statuses and checks, calculate
mergeability from the same policy state as Concordat, enable auto-merge, and
look up releases by tag, then automation workflows can run end to end without
direct store edits.

This phase is narrow but sharp. It closes the loop between branch governance
and automation while leaving review-specific inputs to phase 6 and review
threads to phase 7.

### 5.1. Replace fixed status payloads with mutable CI state

This step answers whether commit status and check data can become real
scriptable inputs. Its outcome informs mergeability and auto-merge. See
docs/github-rest-api-audit.md §Built-In Scriptable REST Coverage and
docs/api-reference.md §REST endpoints.

- [ ] 5.1.1. Add mutable commit status history.
  - Carries legacy task label `5.1.1`.
  - Requires 3.3.1.
  - Replace fixed combined-status responses with per-sha status state.
  - Success: shared-actions-style workflows can observe failing and passing
    statuses as state changes.
- [ ] 5.1.2. Add check suites and check runs.
  - Carries legacy task label `5.1.2`.
  - Requires 5.1.1.
  - Cover the read and write operations needed by GitHub App and automation
    flows.
  - Success: checks participate in the same commit-scoped state as statuses.

### 5.2. Derive mergeability from branch policy and pull request state

This step answers whether mergeability can be calculated instead of hard-coded.
Its outcome informs auto-merge and phase 6 review integration. See
docs/github-rest-api-audit.md §Recommended Follow-Ups and
docs/github-graphql-api-audit.md §Recommended Follow-Ups.

- [ ] 5.2.1. Add mergeability selectors.
  - Carries legacy task label `5.2.1`.
  - Requires 4.2.1, 5.1.1, and 5.1.2.
  - Include draft state, failing checks, merge conflicts, and explicit inputs
    for requested reviews and review conclusions.
  - Success: mergeability derives from repository, pull request, branch
    protection, status, and check state rather than from hard-coded response
    branches.
- [ ] 5.2.2. Enforce the status-check side of branch protection.
  - Carries the checks-backed portion of legacy task label `5.2.2`.
  - Requires 5.2.1.
  - Enforce required checks against pull request state.
  - Leave required-review enforcement to phase 6, which supplies the review
    model.
  - Success: a failing required check blocks mergeability until the status or
    check state changes.

### 5.3. Support automation endpoints that depend on mergeability

This step answers whether automation consumers can act on the mergeability
state rather than only read it. Its outcome informs scenario suites and release
automation fixtures. See docs/api-reference.md §Capability matrix and
docs/github-graphql-api-audit.md §Explicit Coverage.

- [ ] 5.3.1. Add GraphQL auto-merge state and mutation coverage.
  - Requires 5.2.1.
  - Support `autoMergeRequest`, `mergeStateStatus`, `mergeable`, and
    `enablePullRequestAutoMerge`.
  - Success: shared-actions-style workflows can enable auto-merge and see the
    GraphQL state update as mergeability inputs change.
- [ ] 5.3.2. Add early release-tag lookup support.
  - Requires 3.3.1.
  - Implement `GET /repos/{owner}/{repo}/releases/tags/{tag}` ahead of wider
    Releases parity.
  - Success: release-tag lookup is scriptable without broad Releases API
    parity.

## 6. Review state and approval modelling

Idea: if review submissions, summaries, requested reviewers, and latest-review
selectors plug into the phase 5 mergeability contract, protected-branch
approval rules can become real without waiting for full review-thread
modelling.

Review state lands before review threads because required approvals and
latest-review state matter earlier than pixel-perfect conversation modelling.

### 6.1. Model review submissions as stateful objects

This step answers whether review outcomes can be stored and changed through a
shared action path. Its outcome informs summaries and branch-protection
approval gates. See docs/github-rest-api-audit.md §What Is Stubbed But Not
Really Mocked and docs/github-graphql-api-audit.md §Recommended Follow-Ups.

- [ ] 6.1.1. Add review entities and submission flow.
  - Carries legacy task label `4.1.1`.
  - Requires 3.1.1 and 1.3.1.
  - Support pending reviews, submitted reviews, dismissal, approval, comment,
    and request-changes outcomes.
  - Success: review state changes are visible through the same pull request
    object that mergeability reads.

### 6.2. Expose review summaries consistently

This step answers whether REST and GraphQL agree on review state. Its outcome
informs mergeability and automation reads. See docs/api-reference.md
§Capability matrix and docs/github-graphql-api-audit.md §Explicit Coverage.

- [ ] 6.2.1. Add REST and GraphQL review summaries.
  - Carries legacy task label `4.1.2`.
  - Requires 6.1.1.
  - Cover the fields needed by approval and mergeability decisions, not only
    totals.
  - Success: REST and GraphQL expose consistent review summaries for the same
    pull request fixture.

### 6.3. Connect review selectors to protected-branch rules

This step answers whether approval policy can be evaluated without
reconstructing state from comments. Its outcome informs phase 7 conversation
resolution. See docs/github-rest-api-audit.md §Recommended Follow-Ups and
docs/github-graphql-api-audit.md §Recommended Follow-Ups.

- [ ] 6.3.1. Add requested-reviewer and latest-review selectors.
  - Carries legacy task label `4.1.3`.
  - Requires 6.2.1 and 5.2.1.
  - Expose the state needed for protected-branch rules and automation.
  - Success: required-review logic can evaluate approvals and change requests
    without reconstructing state from raw review comments.
- [ ] 6.3.2. Enforce the required-review side of branch protection.
  - Carries the review-backed portion of legacy task label `5.2.2`.
  - Requires 6.3.1 and 4.2.1.
  - Connect required approvals and change requests to the mergeability
    selectors from phase 5.
  - Success: branch protection and mergeability derive review decisions from
    the same review model.

## 7. Review threads and conversation resolution

Idea: if inline review comments, thread grouping, and resolution state can be
rendered and enforced from simulator data alone, Concordat and UI-style
consumers can test conversation workflows without bespoke route mocks.

This phase deepens pull request collaboration after the approval model is
already useful.

### 7.1. Represent inline review comments on diffs

This step answers whether line-level comments can be addressed with enough
source metadata to support thread grouping. Its outcome informs conversation
resolution and webhook payloads. See docs/github-graphql-api-audit.md
§Recommended Follow-Ups and docs/api-reference.md §Capability matrix.

- [ ] 7.1.1. Add inline review comments on diffs.
  - Carries legacy task label `4.2.1`.
  - Requires 6.1.1 and 3.3.1.
  - Support path, line, side, and commit metadata.
  - Success: review UIs can render inline comments from simulator data alone.

### 7.2. Group comments into resolvable threads

This step answers whether conversation state can be represented independently
of raw comment lists. Its outcome informs protected-branch conversation gates.
See docs/github-graphql-api-audit.md §Public Schema vs Runtime Behavior.

- [ ] 7.2.1. Add review thread grouping and resolution.
  - Carries legacy task label `4.2.2`.
  - Requires 7.1.1 and 4.2.2.
  - Provide resolved state, reply chains, and actor attribution.
  - Success: conversation resolution can participate in protected-branch
    decisions.

### 7.3. Expose thread state through REST and GraphQL

This step answers whether review-thread data is available to both UI-style
consumers and automation. Its outcome informs webhook payload shape and
scenario suites. See docs/api-reference.md §GraphQL fields and
docs/github-graphql-api-audit.md §Recommended Follow-Ups.

- [ ] 7.3.1. Add REST and GraphQL review thread exposure.
  - Carries legacy task label `4.2.3`.
  - Requires 7.2.1.
  - Make thread state available to UI-style consumers and automation.
  - Success: REST and GraphQL expose the same resolved-state and reply-chain
    data for review threads.

## 8. Deeper issue collaboration and timelines

Idea: if issue mutation, comments, labels, milestones, reactions, timelines,
subscriptions, and notifications reuse the shared event model, reporting and
triage consumers can operate through the simulator without direct store edits.

Issue parity remains important, but it no longer blocks the earlier slices
that carry more portfolio value today.

### 8.1. Finish issue lifecycle mutation

This step answers whether issue reads from phase 2 can become full lifecycle
objects. Its outcome informs issue comments and timelines. See
docs/api-reference.md §Capability matrix and docs/github-rest-api-audit.md
§What Is Stubbed But Not Really Mocked.

- [ ] 8.1.1. Implement issue create, update, close, and reopen flows.
  - Carries the mutation side of legacy task label `2.2.1`.
  - Requires 2.3.1 and 1.3.1.
  - Cover issue lifecycle changes end to end.
  - Success: repository triage workflows can operate through the simulator
    without direct store edits.

### 8.2. Add issue collaboration objects

This step answers whether common issue collaboration state can be scripted
without broad timeline work. Its outcome informs the timeline and notification
model. See docs/github-rest-api-audit.md §What Is Stubbed But Not Really
Mocked and docs/github-graphql-api-audit.md §Public Schema vs Runtime Behavior.

- [ ] 8.2.1. Add issue comments and reactions.
  - Carries part of legacy task labels `2.2.2` and `2.2.3`.
  - Requires 8.1.1.
  - Success: issue discussions and reaction state are store-backed and
    visible through supported reads.
- [ ] 8.2.2. Add labels, milestones, and assignee management.
  - Carries the remaining collaboration scope from legacy task labels `2.2.2`
    and `2.2.3`.
  - Requires 8.1.1.
  - Success: label, milestone, and assignee changes can be scripted through
    simulator endpoints and read back consistently.

### 8.3. Expose timelines, subscriptions, and notifications

This step answers whether issue activity can be consumed as event history
rather than as disconnected object snapshots. Its outcome informs webhooks.
See docs/github-rest-api-audit.md §Recommended Follow-Ups and
docs/architecture.md §High-level flow.

- [ ] 8.3.1. Add issue timeline views.
  - Carries legacy task label `2.3.1`.
  - Requires 8.2.1 and 8.2.2.
  - Success: issue timeline events derive from the shared event model.
- [ ] 8.3.2. Add subscriptions and notification state.
  - Carries legacy task label `2.3.2`.
  - Requires 8.3.1.
  - Success: notification state derives from the same issue and event data as
    REST, GraphQL, and future webhook payloads.

## 9. Capability matrix, fixture recipes, and scenarios

Idea: if consumers can see exactly which REST endpoints, GraphQL fields,
fixture recipes, and scenario suites are supported, test harnesses can depend
on the simulator contract instead of inferring support from schema presence.

The capability contract should become explicit before webhook breadth because
simulacat and future test harnesses need a crisp agreement on what is and is
not scriptable.

### 9.1. Publish the support contract

This step answers whether supported behaviour can be selected deliberately
rather than guessed from routes or schema fields. Its outcome informs fixture
recipes and downstream adoption. See docs/api-reference.md §Capability matrix,
docs/github-rest-api-audit.md §Recommended Follow-Ups, and
docs/github-graphql-api-audit.md §Recommended Follow-Ups.

- [ ] 9.1.1. Publish a REST and GraphQL capability matrix.
  - Requires phases 1-8.
  - Distinguish fully scriptable, schema-stubbed, placeholder-only, and
    unsupported behaviour.
  - Success: consumers can select a documented simulator capability profile
    rather than inferring support from schema breadth.

### 9.2. Provide consumer-shaped fixture recipes

This step answers whether common workflows can start from maintained builders
instead of bespoke fixture graphs. Its outcome informs end-to-end scenario
suites. See docs/development.md §Testing expectations and docs/architecture.md
§Extension seams.

- [ ] 9.2.1. Publish scenario builders and fixture recipes.
  - Requires 9.1.1 and 1.3.2.
  - Provide ready-made builders for Concordat, Ghillie, shared-actions, and
    other common consumer shapes.
  - Success: new integration tests can start from published recipes instead of
    rebuilding the same fixture graphs.

### 9.3. Exercise the vertical slices as scenarios

This step answers whether the consumer slices work together rather than only
as isolated endpoint tests. Its outcome informs webhook confidence and release
readiness. See docs/development.md §Testing expectations,
docs/github-rest-api-audit.md §Test Coverage Observed, and
docs/github-graphql-api-audit.md §Test Coverage Observed.

- [ ] 9.3.1. Add end-to-end scenario suites.
  - Requires 9.2.1.
  - Cover the administration, read-model, pull request, mergeability, and
    review slices before webhook assertions are added.
  - Success: the scenario suite proves the phase 1-8 slices can be used as
    combined consumer workflows.

## 10. Webhooks and delivery inspection

Idea: if webhook payloads are driven by the same domain events as REST and
GraphQL reads, app integrations can assert delivery behaviour without
route-local mocks or bespoke test-only hooks.

Webhooks move down the queue because current high-value consumers rely more on
polling and direct reads than on webhook delivery.

### 10.1. Emit webhooks from shared domain events

This step answers whether domain events can produce webhook payloads without
duplicating state transitions. Its outcome informs delivery inspection and
replay. See docs/architecture.md §High-level flow and
docs/github-rest-api-audit.md §Recommended Follow-Ups.

- [ ] 10.1.1. Add webhook events for issue and pull request activity.
  - Carries legacy task label `6.1.1`.
  - Requires 3.2.1, 7.3.1, and 8.3.1.
  - Drive webhook payloads from the same domain events as REST and GraphQL
    reads.
  - Success: webhook payloads reflect issue, pull request, review, and thread
    state without route-local mocking.

### 10.2. Make deliveries inspectable and replayable

This step answers whether tests can assert webhook delivery deterministically.
Its outcome informs app-integration adoption. See docs/development.md
§Testing expectations and docs/api-reference.md §Capability matrix.

- [ ] 10.2.1. Add delivery inspection and replay helpers.
  - Carries legacy task label `6.1.2`.
  - Requires 10.1.1.
  - Provide deterministic delivery logs and replay support for assertions.
  - Success: delivery assertions do not require bespoke test-only hooks.

## 11. Deferred governance extras after core scriptability

Idea: if the core v1 promise is already trustworthy and boring to operate,
Simulacat Core can evaluate broader governance extensions on their product
value instead of letting them destabilize the main release.

These items remain important, especially for Concordat, but they should follow
once the shared substrate and core consumer slices are credible.

### 11.1. Evaluate Projects v2 after the governance core is stable

This step answers whether Projects v2 belongs in this package once branch
governance and review workflows are already scriptable. See
docs/github-rest-api-audit.md §What Is Stubbed But Not Really Mocked.

- [ ] 11.1.1. Add Projects v2 parity for Concordat-used fields and mutations.
  - Requires phase 10.
  - Scope the work to fields and mutations Concordat actually uses.
  - Success: Projects v2 support builds on the same actor, permission, and
    event models used by the earlier slices.

### 11.2. Evaluate code-scanning and SARIF governance support

This step answers whether code-scanning support is justified by concrete
governance flows rather than broad parity. See docs/github-rest-api-audit.md
§What Is Stubbed But Not Really Mocked.

- [ ] 11.2.1. Add code-scanning and SARIF parity where governance flows need it.
  - Requires phase 10.
  - Limit the scope to Concordat flows that depend on the data.
  - Success: code-scanning support does not bypass the actor, permission, and
    event models used by earlier governance work.

### 11.3. Reassess enterprise administration breadth

This step answers whether additional enterprise administration surfaces belong
in Simulacat Core or in adjacent simulators. See
docs/github-rest-api-audit.md §Assessment and docs/architecture.md
§Extension seams.

- [ ] 11.3.1. Decide where further enterprise administration surfaces belong.
  - Requires 11.1.1 and 11.2.1.
  - Compare package-level scope against adjacent simulator extension options.
  - Success: the package does not accumulate broad enterprise parity without a
    concrete consumer and a testable slice definition.

Sequencing notes:

- Legacy task identifiers remain useful as reference labels, but delivery
  order is governed by the GIST phases above.
- The legacy `1.2.2` permission scope stays minimal until administration and
  branch protection require more depth.
- Review state in phase 6 must complete before review threads in phase 7.
- Phase 5 defines the mergeability contract, while phase 6 completes the
  review-backed approval side of that contract.
- Capability matrices and scenario recipes land before broad webhook parity
  because they define the contract external test harnesses consume.
- Projects v2 and code-scanning work stay deferred unless a portfolio change
  makes that trade-off explicit.

Definition of done for the roadmap:

- Concordat-style repository governance and team administration workflows are
  scriptable through the simulator.
- Ghillie-style GraphQL reads for refs, history, pull requests, and issues are
  backed by real shared state rather than by schema breadth alone.
- shared-actions-style mergeability, checks, auto-merge, and release-tag
  workflows are scriptable end to end.
- REST, GraphQL, and webhooks are parallel views over shared entities, actor
  context, and domain events.
- The capability matrix and fixture recipes make the supported contract clear
  enough for external test harnesses to depend on it directly.
