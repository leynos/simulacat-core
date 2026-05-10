# Users guide

## Introduction

Simulacat Core uses owner-qualified canonical keys so that repositories with
identical short names owned by different accounts do not collide in seeded
stores, REST responses, or GraphQL lookups.

## Canonical key formats

The canonical identity scheme uses these key formats:

| Entity | Format | Example |
| --- | --- | --- |
| Repository | `owner/name` | `acme/awesome-repo` |
| Branch | `owner/repo:name` | `acme/awesome-repo:main` |
| Blob | `owner/repo:reference` | `acme/awesome-repo:docs/api/README.md` |
| Ref | `owner/repo:qualifiedName` | `acme/awesome-repo:main` |
| Commit | `owner/repo:sha` | `acme/awesome-repo:abc123` |
| Issue | `owner/repo#number` | `acme/awesome-repo#42` |
| Pull request | `owner/repo!number` | `acme/awesome-repo!42` |

The `reference` component in blob keys may contain `/`, so paths such as
`docs/api/README.md` remain valid terminal references.

## Repository `node_id` derivation

When a repository fixture omits `node_id`, Simulacat Core derives it as
`base64("Repository:owner/name")`. Use `repositoryNodeId` when code needs the
same canonical node identifier without building a full fixture.

```typescript
import {repositoryNodeId} from 'simulacat-core';

const id = repositoryNodeId('acme', 'awesome-repo');
// Buffer.from(id, 'base64').toString() === 'Repository:acme/awesome-repo'
```

## Fixture builders

Use the fixture builders when tests need parsed repository, branch, ref,
commit, issue, or pull request fixtures without constructing a complete initial
state. See
[`docs/api-reference.md`](./api-reference.md) for the detailed fixture schema
fields.

```typescript
import {
  buildRepositoryFixture,
  buildBranchFixture,
  buildRefFixture,
  buildCommitFixture,
  buildIssueFixture,
  buildPullRequestFixture
} from 'simulacat-core';

const repo = buildRepositoryFixture({owner: 'acme', name: 'awesome-repo'});
const branch = buildBranchFixture({
  owner: 'acme',
  repo: 'awesome-repo',
  name: 'main'
});
const commit = buildCommitFixture({
  owner: 'acme',
  repo: 'awesome-repo',
  sha: 'abc123'
});
const ref = buildRefFixture({
  owner: 'acme',
  repo: 'awesome-repo',
  qualifiedName: 'main',
  object: {sha: commit.sha}
});
const issue = buildIssueFixture({
  owner: 'acme',
  repo: 'awesome-repo',
  number: 1,
  title: 'Document first-class entities'
});
const pullRequest = buildPullRequestFixture({
  owner: 'acme',
  repo: 'awesome-repo',
  number: 2,
  title: 'Add entity spine',
  base: {ref: 'main', sha: commit.sha},
  head: {ref: 'feature/entity-spine', sha: 'def456'}
});
```

These functions validate their input against the relevant Zod schema and throw
on invalid data.

## Seeding early collaboration entities

`InitialState` now accepts optional `refs`, `commits`, `issues`, and
`pullRequests` arrays. They default to empty arrays, so existing fixtures do
not need to change.

```typescript
simulation({
  initialState: {
    users: [],
    organizations: [{login: 'acme'}],
    repositories: [{owner: 'acme', name: 'awesome-repo'}],
    branches: [{owner: 'acme', repo: 'awesome-repo', name: 'main'}],
    blobs: [],
    commits: [{owner: 'acme', repo: 'awesome-repo', sha: 'abc123'}],
    refs: [
      {
        owner: 'acme',
        repo: 'awesome-repo',
        qualifiedName: 'main',
        object: {sha: 'abc123'}
      }
    ],
    issues: [{owner: 'acme', repo: 'awesome-repo', number: 1, title: 'Bug'}],
    pullRequests: [
      {
        owner: 'acme',
        repo: 'awesome-repo',
        number: 2,
        title: 'Fix bug',
        base: {ref: 'main', sha: 'abc123'},
        head: {ref: 'feature/fix', sha: 'def456'}
      }
    ]
  }
});
```

Seeded refs, commits, issues, and pull requests are visible through the
documented REST endpoints and through repository GraphQL fields such as
`defaultBranchRef`, `ref`, `issues`, and `pullRequests`.

## Store key helpers and parsers

The public store key helpers format and parse canonical keys:

- `repositoryStoreKey({owner, name})` formats a repository key.
- `branchStoreKey({owner, repo, name})` formats a branch key.
- `blobStoreKey({owner, repo, path?, sha?})` formats a blob key.
- `refStoreKey({owner, repo, qualifiedName})` formats a ref key.
- `commitStoreKey({owner, repo, sha})` formats a commit key.
- `issueStoreKey({owner, repo, number})` formats an issue key.
- `pullRequestStoreKey({owner, repo, number})` formats a pull request key.
- `parseRepositoryStoreKey(key)` parses and validates a repository key.
- `parseBranchStoreKey(key)` parses and validates a branch key.
- `parseBlobStoreKey(key)` parses and validates a blob key.
- `parseRefStoreKey(key)` parses and validates a ref key.
- `parseCommitStoreKey(key)` parses and validates a commit key.
- `parseIssueStoreKey(key)` parses and validates an issue key.
- `parsePullRequestStoreKey(key)` parses and validates a pull request key.

All parsers throw a descriptive `Error` on malformed input.

## Cross-owner isolation

Seeding two repositories with the same `owner/name` canonical key throws at
parse time. Repositories with the same short `name` remain distinct when their
`owner` values differ, so `acme/awesome-repo` and `globex/awesome-repo` can
coexist safely.

## Breaking changes

### 1.1.1 — Narrowed store key helper input types

`repositoryStoreKey`, `branchStoreKey`, and `blobStoreKey` now accept narrower
input shapes rather than the full GitHub entity types. Callers passing complete
entity objects continue to work unchanged, but explicit type annotations
referencing the old parameter types must be updated.

#### `repositoryStoreKey`

```typescript
// Before
repositoryStoreKey(repository: GitHubRepository)

// After
repositoryStoreKey(repository: { owner: string; name: string })
```

#### `branchStoreKey`

```typescript
// Before
branchStoreKey(branch: GitHubBranch)

// After
branchStoreKey(branch: Pick<GitHubBranch, 'owner' | 'repo' | 'name'>)
```

#### `blobStoreKey`

```typescript
// Before
blobStoreKey(blob: GitHubBlob)

// After
blobStoreKey(blob: Pick<GitHubBlob, 'owner' | 'repo' | 'path' | 'sha'>)
```
