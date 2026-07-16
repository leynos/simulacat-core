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

## Updating repository metadata

`PATCH /repos/{owner}/{repo}` writes repository metadata through the shared
store action path. The current demonstrator intentionally persists only
`description` and `homepage`; policy and visibility fields such as
`visibility`, merge strategy settings, and `default_branch` are accepted by
the request body but ignored until the repository settings roadmap slice
implements them.

```typescript
const response = await fetch(`${baseUrl}/repos/acme/awesome-repo`, {
  method: 'PATCH',
  headers: {
    authorization: 'Bearer local-token',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    description: 'Patched via shared action',
    homepage: 'https://docs.example.test',
    visibility: 'private'
  })
});

const repository = await response.json();
repository.description; // 'Patched via shared action'
repository.homepage; // 'https://docs.example.test'
repository.visibility; // still the seeded/default value
```

The same persisted value is visible through `GET /repos/{owner}/{repo}`,
`GET /orgs/{org}/repos`, and GraphQL `repository(owner:, name:)` reads.
Repository write routes do not validate real GitHub tokens.

## Request-derived URLs

REST and GraphQL payload URLs are derived from the request that produced the
response. A simulator listening on a random port returns repository, issue,
pull request, commit, ref, branch, and organization URLs that point back at
that same host and port.

`apiUrl` controls the mounted API root and is included in API URLs:

```typescript
const app = simulation({
  apiUrl: '/api/v3',
  initialState
});
```

A request to `http://127.0.0.1:49152/api/v3/repos/acme/awesome-repo` returns
API links under `http://127.0.0.1:49152/api/v3/...` and web links under
`http://127.0.0.1:49152/...`.

Fixture URL fields are overrides. When a fixture explicitly seeds a URL, the
projectors preserve it; when the field is omitted, the adapters derive it from
the request. Nullable URL fields can still be set to `null` deliberately.

```typescript
simulation({
  initialState: {
    users: [],
    organizations: [{login: 'acme'}],
    repositories: [
      {
        owner: 'acme',
        name: 'awesome-repo',
        html_url: 'https://docs.example.test/acme/awesome-repo',
        mirror_url: null
      }
    ],
    branches: [],
    blobs: []
  }
});
```

If a request has no usable `Host` header, Simulacat Core uses the absolute
`SIMULACAT_GITHUB_API_URL` environment variable as a fallback base. Normal HTTP
requests should not need that fallback because the request host is preferred.

## Request actors

Authenticated-user surfaces use a simulator-controlled request actor instead
of the first seeded user. Set the preferred `x-simulacat-actor` header when
a test needs `/user`, `/user/memberships/orgs`, or GraphQL `viewer` to run
as a specific seeded user.

| Actor kind | Header value | Observable behaviour |
| --- | --- | --- |
| Anonymous | `anonymous` or no actor header | `/user` returns 401 and `viewer` fails with `Authentication required`. |
| User | `user:octocat` | `/user` and `viewer` resolve the seeded user whose login is `octocat`. |
| App | `app:1` or `app:simulator-app` | The actor is parsed for later policy work, but authenticated-user surfaces return 401. |
| Installation | `installation:1` | The actor is parsed for later policy work, but authenticated-user surfaces return 401. |

`x-simulacat-user: octocat` and `x-github-user: octocat` remain
compatibility aliases for `user:octocat`. Prefer `x-simulacat-actor` for new
tests because it can represent all supported actor kinds. These headers do not
validate real GitHub personal access tokens, OAuth tokens, GitHub App JWTs, or
installation tokens.

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

### 1.2.1 — Request-scoped actor resolution

`GET /user`, `GET /user/memberships/orgs`, and `Query.viewer` no longer fall
back to the first seeded user when no actor header is present. They now return
HTTP 401 with `Authentication required` for unauthenticated requests.

| Scenario | Before 1.2.1 | After 1.2.1 |
| --- | --- | --- |
| No actor header sent | First seeded user returned | 401 `{"message":"Authentication required"}` |
| `x-simulacat-user: <login>` sent | Named user returned (unchanged) | Named user returned (unchanged) |
| `x-simulacat-actor: user:<login>` sent | Not supported | Named user returned |

Set `x-simulacat-actor: user:<login>` (or a legacy alias) on every request that
must exercise `/user`, `/user/memberships/orgs`, or `viewer`.

For REST authenticated-user routes, both `GET /user` and
`GET /user/memberships/orgs` require `x-simulacat-actor: user:<login>` or a
legacy user alias. Without an actor that resolves to a seeded user, these routes
return HTTP 401 with `{"message":"Authentication required"}`.
