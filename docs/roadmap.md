# GitHub API scriptability roadmap

This roadmap reprioritizes `@simulacrum/github-api-simulator` around the
current consumer portfolio rather than generic GitHub collaboration parity. The
delivery order now follows three primary drivers:

- Concordat drives the control-plane and administration model.
- Ghillie drives the read-heavy GraphQL model.
- shared-actions drives mergeability, auto-merge, and release lookups.

Nile Valley remains relevant, but it should not dominate the queue because its
core workflows lean more heavily on plain git operations and GitHub Actions
file semantics than on deep GitHub REST or GraphQL behaviour.

The roadmap still uses a vertical-slice approach. The difference is that the
first useful slices now reflect the products that consume the simulator today.

## Scope and prioritization principles

- Prioritize scriptable behaviours that unlock real repository governance and
  control-plane automation before richer collaboration theatre.
- Treat REST and GraphQL as parallel views over the same state, with GraphQL
  read parity landing early where portfolio consumers already depend on it.
- Keep the early foundation work narrow: fix canonical identities, actor
  resolution, mutation plumbing, and fixtures before adding broad parity.
- Prefer a small number of complete, testable consumer-shaped slices over wide
  endpoint coverage with placeholder responses.
- Defer low-leverage surfaces such as webhook breadth, Projects v2 parity, and
  code-scanning parity until the shared substrate is credible.

| Tranche | Primary consumer               | Delivered capability                                                    |
| ------- | ------------------------------ | ----------------------------------------------------------------------- |
| 1       | All consumers                  | Canonical identities, actors, mutation plumbing, and fixtures.          |
| 2       | Ghillie, shared-actions        | Read-heavy GraphQL parity for refs, history, pull requests, and issues. |
| 3       | Concordat, shared-actions      | Real branch-to-pull-request state transitions.                          |
| 4       | Concordat                      | Repository administration, branch protection, and teams.                |
| 5       | shared-actions, Concordat      | Statuses, checks, mergeability, auto-merge, and release tag lookup.     |
| 6       | Concordat, shared-actions      | Review state and approval modelling.                                    |
| 7       | Concordat                      | Review threads and conversation resolution.                             |
| 8       | Reporting and triage consumers | Deeper issue collaboration and timelines.                               |
| 9       | simulacat and test harnesses   | Capability matrix, fixture recipes, and scenario suites.                |
| 10      | App integrations               | Webhooks and delivery inspection.                                       |
| 11      | Concordat follow-on work       | Governance extras such as Projects v2 and code scanning.                |

_Table 1: Delivery tranches after reprioritization._

## 1. Canonical identities and actor-aware foundations

This tranche keeps only the essential Phase 1 surgery. It should land before
any larger behaviour slices because the current shortcuts make later work
unreliable.

- [ ] 1.1. Deliver `1.1.1`: re-key repositories and refs by canonical
      identifiers.
  - Use stable keys such as `owner/name` and `owner/name:ref`.
  - Remove assumptions that repository and branch names are globally unique.
- [ ] 1.2. Deliver a minimal form of `1.1.2`: add only the first-class
      entities needed immediately for refs, commits, issues, and pull
      requests.
  - Defer the wider collaboration lattice until later tranches need it.
- [ ] 1.3. Deliver `1.2.1` and `1.2.3`: add request-scoped actor resolution
      and expose actor context to REST and GraphQL.
  - Support at least anonymous, user, app, and installation actors.
  - Replace the current `/user` and `viewer` shortcuts with actor-aware
    selectors.
- [ ] 1.4. Deliver `1.3.1` and `1.3.3`: add shared domain actions and fixture
      builders.
  - Centralize write behaviour in reducers and shared actions.
  - Publish builders that can create repositories, refs, issues, and pull
    requests without hand-editing store state.

Completion criteria:

- Two repositories with the same name under different owners can coexist.
- `/user` and GraphQL `viewer` resolve from the request actor rather than from
  fixed store shortcuts.
- New tests can compose actor-aware repository fixtures through published
  builders rather than through route-local state mutation.

## 2. GraphQL read model slice

This tranche moves ahead of full issue mutation because Ghillie is a read-heavy
GraphQL consumer and shared-actions already depends on pull request read state.

- [ ] 2.1. Deliver `2.1.1` for repository refs, commit history, and basic tree
      traversal.
  - Support `Repository.ref(qualifiedName)` and commit `history`.
  - Fix broken or partial ref and tree behaviours.
- [ ] 2.2. Deliver `3.1.2` for pull request list and detail reads.
  - Support `repository.pullRequests` and
    `repository.pullRequest(number)`.
  - Add the field set currently required by Ghillie and shared-actions, with
    cursor pagination.
- [ ] 2.3. Deliver only the read-side subset of `2.2.1` needed for issue
      visibility.
  - Support `repository.issues` and the issue fields current consumers fetch.
  - Defer broad issue mutation and timeline work.

Completion criteria:

- GraphQL can answer repository ref, history, issue, and pull request queries
  without placeholder-only data.
- The supported fields reflect actual consumer queries rather than schema-wide
  optimism.
- REST and GraphQL read selectors share the same underlying repository and
  issue state.

## 3. Pull request state machine slice

This tranche lands before rich issue collaboration because Concordat and
shared-actions both need pull requests to be real mutable objects rather than
ornamental JSON.

- [ ] 3.1. Deliver `3.2.1`: create, update, close, and reopen pull requests.
  - Model base ref, head ref, draft state, author, and open or closed state as
    first-class mutable data.
- [ ] 3.2. Deliver `3.2.3`: add pull request timeline items for the core state
      transitions.
  - Include opened, converted to draft, ready for review, closed, and reopened
    events.
- [ ] 3.3. Expand `3.1.1` only where needed to keep the pull request state
      machine coherent.
  - Link pull requests to branches, commits, and minimal issue references.

Completion criteria:

- A test can create a feature branch, open a pull request against another
  branch, change its state, and read the same state through REST and GraphQL.
- Pull request timelines expose the key transitions without reconstructing them
  from unrelated route responses.

## 4. Concordat administration slice

This slice is new. It must land before deep review work because Concordat's
core value sits in repository governance, branch protection, and team-driven
access control.

- [ ] 4.1. Add repository settings scriptability.
  - Cover the settings Concordat manages directly, including merge strategy
    controls, delete-branch-on-merge, and related repository policy flags.
- [ ] 4.2. Add branch protection configuration scriptability.
  - Model required reviews, required status checks, signed commits, linear
    history, force-push constraints, and conversation-resolution gates.
- [ ] 4.3. Deliver the minimum viable permission lattice from `1.2.2`.
  - Model user, app, installation, and team access only to the depth needed by
    repository administration and protected-branch behaviour.
  - Defer a broader permission matrix until it is justified by later slices.
- [ ] 4.4. Add teams, team membership, and team-repository permissions.
  - Replace the current empty organization team and membership placeholders
    with store-backed behaviour.
  - Support the repository permission states Concordat manages.

Completion criteria:

- Concordat-style workflows can script repository policy and team membership
  without bypassing the simulator.
- Branch protection state is visible through both configuration reads and
  downstream mergeability decisions.

## 5. Statuses, checks, mergeability, and auto-merge

This tranche is the narrow but sharp shared-actions slice. It also closes the
loop on Concordat's branch-protection model.

- [ ] 5.1. Deliver `5.1.1`: mutable commit status history.
  - Replace fixed combined-status responses with per-sha status state.
- [ ] 5.2. Deliver `5.1.2`: check suites and check runs.
  - Cover the read and write operations needed by GitHub App and automation
    flows.
- [ ] 5.3. Deliver `5.2.1`: mergeability selectors.
  - Include draft state, requested reviews, review conclusions, failing checks,
    and merge conflicts.
- [ ] 5.4. Deliver `5.2.2`: minimal branch-protection enforcement.
  - Enforce required reviews and required checks against pull request state.
- [ ] 5.5. Add GraphQL auto-merge state and mutation coverage.
  - Support `autoMergeRequest`, `mergeStateStatus`, `mergeable`, and
    `enablePullRequestAutoMerge`.
- [ ] 5.6. Add early release-tag lookup support.
  - Implement `GET /repos/{owner}/{repo}/releases/tags/{tag}` ahead of wider
    Releases parity.

Completion criteria:

- shared-actions-style workflows can observe failing checks, enable auto-merge,
  and see mergeability update as state changes.
- Branch protection and mergeability derive from the same repository and review
  model rather than from hard-coded response branches.

## 6. Review state slice

Review state should land before review threads because required approvals and
latest-review state matter earlier than pixel-perfect conversation modelling.

- [ ] 6.1. Deliver `4.1.1`: review entities and submission flow.
  - Support pending reviews, submitted reviews, dismissal, approval, comment,
    and request-changes outcomes.
- [ ] 6.2. Deliver `4.1.2`: REST and GraphQL review summaries.
  - Cover the fields needed by approval and mergeability decisions, not only
    totals.
- [ ] 6.3. Deliver `4.1.3`: requested-reviewer and latest-review selectors.
  - Expose the state needed for protected-branch rules and automation.

Completion criteria:

- Required-review logic can evaluate approvals and change requests without
  reconstructing state from raw review comments.
- REST and GraphQL expose consistent latest-review and requested-reviewer data.

## 7. Review threads and conversation resolution

This tranche deepens pull request collaboration after the approval model is
already useful.

- [ ] 7.1. Deliver `4.2.1`: inline review comments on diffs.
  - Support path, line, side, and commit metadata.
- [ ] 7.2. Deliver `4.2.2`: review thread grouping and resolution.
  - Provide resolved state, reply chains, and actor attribution.
- [ ] 7.3. Deliver `4.2.3`: REST and GraphQL review thread exposure.
  - Make thread state available to UI-style consumers and automation.

Completion criteria:

- Conversation resolution can participate in protected-branch decisions.
- Review UIs can render thread state from simulator data alone.

## 8. Deeper issue collaboration slice

Issue parity remains important, but it no longer blocks the earlier slices that
carry more portfolio value today.

- [ ] 8.1. Finish the mutation side of `2.2.1`.
  - Cover issue create, update, close, and reopen flows end to end.
- [ ] 8.2. Deliver `2.2.2` and `2.2.3`.
  - Add issue comments, reactions, labels, milestones, and assignee
    management.
- [ ] 8.3. Deliver `2.3.1` and `2.3.2`.
  - Add timeline views, subscriptions, and notification state.

Completion criteria:

- Repository triage workflows can operate through the simulator without direct
  store edits.
- Issue timeline events and notification state derive from the shared event
  model.

## 9. Capability matrix, fixture recipes, and scenarios

The capability contract should become explicit before webhook breadth, because
simulacat and future test harnesses need a crisp agreement on what is and is
not scriptable.

- [ ] 9.1. Publish a capability matrix for supported REST endpoints and
      GraphQL fields.
  - Distinguish fully scriptable, schema-stubbed, placeholder-only, and
    unsupported behaviour.
- [ ] 9.2. Publish scenario builders and fixture recipes.
  - Provide ready-made builders for Concordat, Ghillie, shared-actions, and
    other common consumer shapes.
- [ ] 9.3. Add end-to-end scenario suites.
  - Cover the admin, read-model, pull request, mergeability, and review slices
    before webhook assertions are added.

Completion criteria:

- Consumers can select a documented simulator capability profile rather than
  inferring support from the schema.
- New integration tests can start from published recipes instead of rebuilding
  the same fixture graphs.

## 10. Webhooks and delivery inspection

Webhooks move down the queue because current high-value consumers rely more on
polling and direct reads than on webhook delivery.

- [ ] 10.1. Deliver `6.1.1`: webhook events for issue and pull request
      activity.
- [ ] 10.2. Deliver `6.1.2`: delivery inspection and replay helpers.
  - Provide deterministic delivery logs and replay support for assertions.

Completion criteria:

- Webhook payloads are driven by the same domain events as REST and GraphQL
  reads.
- Delivery assertions do not require route-local mocking or bespoke test-only
  hooks.

## 11. Governance extras

These items remain important, especially for Concordat, but they should follow
once the shared substrate and core consumer slices are credible.

- [ ] 11.1. Add Projects v2 parity for the fields and mutations Concordat
      actually uses.
- [ ] 11.2. Add code-scanning and SARIF parity where Concordat governance flows
      depend on them.
- [ ] 11.3. Reassess whether further enterprise administration surfaces belong
      in this package or in adjacent simulators.

Completion criteria:

- Governance extras build on the same actor, permission, and event models used
  by the earlier slices.
- The package does not accumulate broad enterprise parity without a concrete
  consumer and a testable slice definition.

## Sequencing notes

- The original task identifiers remain useful as reference labels, but delivery
  order is now governed by the tranches above rather than by the previous
  collaboration-first phase order.
- `1.2.2` should stay minimal until the administration and branch-protection
  work requires more depth.
- Review state (`4.1.x`) should complete before review threads (`4.2.x`).
- Capability matrices and scenario recipes should land before broad webhook
  parity because they define the contract that external test harnesses consume.
- Projects v2 and code-scanning work should not displace the shared substrate,
  GraphQL read model, or mergeability slices unless a portfolio change makes
  that trade-off explicit.

## Definition of done for the roadmap

The roadmap should be treated as complete when all of the following are true:

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
