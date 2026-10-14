# Users guide

This guide is for library consumers and test-harness integrators. It covers
installation, fixture seeding, configuration, shared writes, and request actors
for the supported GitHub API simulation.

## Introduction

Simulacat Core uses owner-qualified canonical keys so that repositories with
identical short names owned by different accounts do not collide in seeded
stores, REST responses, or GraphQL lookups.

## Getting started

Pack the checkout and install its archive in an existing, empty Bun consumer
project outside this checkout. Set `SIMULACAT_CORE_CHECKOUT` to the absolute
path of this repository and `SIMULACAT_CORE_CONSUMER` to the absolute path of
the consumer directory:

<!-- tested-example: install-local-package -->
```bash
cd "$SIMULACAT_CORE_CHECKOUT"
bun install --frozen-lockfile
bun pm pack --filename "$SIMULACAT_CORE_CONSUMER/simulacat-core.tgz"
cd "$SIMULACAT_CORE_CONSUMER"
bun add ./simulacat-core.tgz
```

Packing runs the package's `prepack` script, which generates and builds the
published files before Bun creates the archive. The consumer therefore resolves
the package's built exports as a normal installation does.

Create `simulation.ts` with a small, explicit fixture:

<!-- tested-example: start-simulator-program -->
```typescript
import {simulation, type InitialState} from 'simulacat-core';

const initialState: InitialState = {
  users: [{login: 'octocat', organizations: ['acme']}],
  organizations: [{login: 'acme'}],
  repositories: [{owner: 'acme', name: 'awesome-repo'}],
  branches: [{owner: 'acme', repo: 'awesome-repo', name: 'main'}],
  blobs: []
};

const app = simulation({initialState});
const server = await app.listen(Number(process.env['PORT'] ?? 3300));
process.once('SIGINT', () => {void server.ensureClose();});
process.once('SIGTERM', () => {void server.ensureClose();});
console.log(`Listening on http://127.0.0.1:${server.port}`);
```

Start the simulator:

<!-- tested-example: run-simulator-command -->
```bash
bun simulation.ts
```

Point a GitHub client at `BASE_URL`, which defaults to `http://localhost:3300`.
A repository lookup reads the seeded store:

<!-- tested-example: query-simulator-with-curl -->
```bash
BASE_URL="${BASE_URL:-http://localhost:3300}"
curl -fsS "$BASE_URL/repos/acme/awesome-repo" -w '\n'
curl -fsS -H 'x-simulacat-actor: user:octocat' "$BASE_URL/user" -w '\n'
```

The first response describes `acme/awesome-repo`; the second selects the seeded
`octocat` user. Stop the server with Ctrl+C when the session is finished.

For a checkout of this repository, run `bun install` and `make build` before
starting `node bin/start.cjs`. The CLI uses port `3300` by default; set `PORT`
to choose another port. The library example above supplies its own fixtures.

## Configuration and extensions

`simulation()` accepts an `initialState` fixture and optional configuration:

- `apiUrl` changes the mounted REST API root; it defaults to `/`.
- `apiSchema` selects a bundled or custom OpenAPI schema.
- `extend.extendStore` adds store slices, actions, or selectors.
- `extend.openapiHandlers` adds or overrides OpenAPI operation handlers.
- `extend.extendRouter` adds Express routes for a particular test harness.

See the [API reference](api-reference.md) for argument details and supported
operations, and the [architecture guide](architecture.md#extension-seams) for
the responsibilities of each extension hook. Unlisted API operations should be
treated as unsupported until documented.

The sections below explain identity, fixture construction, shared writes, and
request actors. Contributor setup and validation commands are in the
[developers guide](developers-guide.md); the
[documentation contents](contents.md) links the remaining references.

## Canonical key formats

The canonical identity scheme uses these key formats:

| Entity       | Format                     | Example                                |
| ------------ | -------------------------- | -------------------------------------- |
| Repository   | `owner/name`               | `acme/awesome-repo`                    |
| Branch       | `owner/repo:name`          | `acme/awesome-repo:main`               |
| Blob         | `owner/repo:reference`     | `acme/awesome-repo:docs/api/README.md` |
| Ref          | `owner/repo:qualifiedName` | `acme/awesome-repo:main`               |
| Commit       | `owner/repo:sha`           | `acme/awesome-repo:abc123`             |
| Issue        | `owner/repo#number`        | `acme/awesome-repo#42`                 |
| Pull request | `owner/repo!number`        | `acme/awesome-repo!42`                 |

The `reference` component in blob keys may contain `/`, so paths such as
`docs/api/README.md` remain valid terminal references.

## Repository `node_id` derivation

When a repository fixture omits `node_id`, Simulacat Core derives it as
`base64("Repository:owner/name")`. Use `repositoryNodeId` when code needs the
same canonical node identifier without building a full fixture.

<!-- tested-example: repository-node-id -->
```typescript
import {repositoryNodeId} from 'simulacat-core';

const id = repositoryNodeId({owner: 'acme', name: 'awesome-repo'});
console.log(id);
```

## Fixture builders

Use the fixture builders when tests need parsed repository, branch, ref,
commit, issue, or pull request fixtures without constructing a complete initial
state. See [`docs/api-reference.md`](./api-reference.md) for the detailed
fixture schema fields.

<!-- tested-example: fixture-builders -->
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

console.log(JSON.stringify({repo, branch, commit, ref, issue, pullRequest}));
```

These functions validate their input against the relevant Zod schema and throw
on invalid data.

## Seeding early collaboration entities

`InitialState` now accepts optional `refs`, `commits`, `issues`, and
`pullRequests` arrays. They default to empty arrays, so existing fixtures do
not need to change.

<!-- tested-example: seed-collaboration-entities -->
```typescript
import {type InitialState, simulation} from 'simulacat-core';

const initialState: InitialState = {
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
};
const app = simulation({initialState});
const server = await app.listen(0);
try {
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const paths = [
    '/repos/acme/awesome-repo/git/ref/main',
    '/repos/acme/awesome-repo/git/commits/abc123',
    '/repos/acme/awesome-repo/issues/1',
    '/repos/acme/awesome-repo/pulls/2'
  ];
  const rest = await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(`${baseUrl}${path}`);
      return {status: response.status, body: await response.json()};
    })
  );
  const query = `query {
    repository(owner: "acme", name: "awesome-repo") {
      defaultBranchRef { name }
      ref(qualifiedName: "main") { name }
      issues(first: 10) { nodes { number } }
      pullRequests(first: 10) { nodes { number } }
    }
  }`;
  const graphQlResponse = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({query})
  });
  const graphQl = await graphQlResponse.json();

  console.log(JSON.stringify({rest, graphQl}));
} finally {
  await server.ensureClose();
}
```

Seeded refs, commits, issues, and pull requests are visible through the
documented REST endpoints and through repository GraphQL fields such as
`defaultBranchRef`, `ref`, `issues`, and `pullRequests`.

## Updating repository metadata

`PATCH /repos/{owner}/{repo}` writes repository metadata through the shared
store action path. The current demonstrator intentionally persists only
`description` and `homepage`; policy and visibility fields such as
`visibility`, merge strategy settings, and `default_branch` are accepted by the
request body but ignored until the repository settings roadmap slice implements
them.

<!-- tested-example: patch-repository-metadata -->
```typescript
import {type InitialState, simulation} from 'simulacat-core';

const initialState: InitialState = {
  users: [],
  organizations: [{login: 'acme'}],
  repositories: [{owner: 'acme', name: 'awesome-repo', visibility: 'public'}],
  branches: [{owner: 'acme', repo: 'awesome-repo', name: 'main'}],
  blobs: []
};
const app = simulation({initialState});
const server = await app.listen(0);
const baseUrl = `http://127.0.0.1:${server.port}`;
try {
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
  const persisted = await fetch(`${baseUrl}/repos/acme/awesome-repo`).then((result) => result.json());
  const organizationRepositories = await fetch(`${baseUrl}/orgs/acme/repos`)
    .then((result) => result.json());
  const graphQlQuery = `query {
    repository(owner: "acme", name: "awesome-repo") {
      description
      visibility
    }
  }`;
  const graphQl = await fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({query: graphQlQuery})
  }).then((result) => result.json());

  console.log(JSON.stringify({repository, persisted, organizationRepositories, graphQl}));
} finally {
  await server.ensureClose();
}
```

The persisted description is visible through `GET /repos/{owner}/{repo}`,
`GET /orgs/{org}/repos`, and GraphQL `repository(owner:, name:)` reads. REST
responses also include the persisted homepage. The PATCH response is shaped
from the stored repository rather than the request body, so it matches those
subsequent reads. Repository write routes do not validate real GitHub tokens.

## Request-derived URLs

REST and GraphQL payload URLs are derived from the request that produced the
response. A simulator listening on a random port returns repository, issue,
pull request, commit, ref, branch, and organization URLs that point back at
that same host and port.

`apiUrl` controls the mounted API root and is included in API URLs:

<!-- tested-example: mount-api-under-v3 -->
```typescript
import {type InitialState, simulation} from 'simulacat-core';

const initialState: InitialState = {
  users: [],
  organizations: [{login: 'acme'}],
  repositories: [{owner: 'acme', name: 'awesome-repo'}],
  branches: [],
  blobs: []
};
const app = simulation({
  apiUrl: '/api/v3',
  initialState
});
const server = await app.listen(0);
try {
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const repository = await fetch(`${baseUrl}/api/v3/repos/acme/awesome-repo`)
    .then((response) => response.json());

  console.log(JSON.stringify(repository));
} finally {
  await server.ensureClose();
}
```

A request to `/api/v3/repos/acme/awesome-repo` returns API links under
`/api/v3/...` and web links under `/...` on the request host.

Fixture URL fields are overrides. When a fixture explicitly seeds a URL, the
projectors preserve it; when the field is omitted, the adapters derive it from
the request. Nullable URL fields can still be set to `null` deliberately.

<!-- tested-example: preserve-fixture-url-overrides -->
```typescript
import {simulation} from 'simulacat-core';

const app = simulation({
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
const server = await app.listen(0);
try {
  const repository = await fetch(`http://127.0.0.1:${server.port}/repos/acme/awesome-repo`)
    .then((response) => response.json());

  console.log(JSON.stringify(repository));
} finally {
  await server.ensureClose();
}
```

If a request has no usable `Host` header, Simulacat Core uses the absolute
`SIMULACAT_GITHUB_API_URL` environment variable as a fallback base. Normal HTTP
requests should not need that fallback because the request host is preferred.

## Request actors

Authenticated-user surfaces use a simulator-controlled request actor instead of
the first seeded user. Set the preferred `x-simulacat-actor` header when a test
needs `/user`, `/user/memberships/orgs`, or GraphQL `viewer` to run as a
specific seeded user.

| Actor kind   | Header value                   | Observable behaviour                                                                   |
| ------------ | ------------------------------ | -------------------------------------------------------------------------------------- |
| Anonymous    | `anonymous` or no actor header | `/user` returns 401 and `viewer` fails with `Authentication required`.                 |
| User         | `user:octocat`                 | `/user` and `viewer` resolve the seeded user whose login is `octocat`.                 |
| App          | `app:1` or `app:simulator-app` | The actor is parsed for later policy work, but authenticated-user surfaces return 401. |
| Installation | `installation:1`               | The actor is parsed for later policy work, but authenticated-user surfaces return 401. |

`x-simulacat-user: octocat` and `x-github-user: octocat` remain compatibility
aliases for `user:octocat`. Prefer `x-simulacat-actor` for new tests because it
can represent all supported actor kinds. These headers do not validate real
GitHub personal access tokens, OAuth tokens, GitHub App JWTs, or installation
tokens.

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
input shapes rather than the `GitHubRepository`, `GitHubBranch`, and
`GitHubBlob` entity types. Calls passing complete entity objects continue to
work, but explicit parameter type annotations must use the new input shapes.

#### `repositoryStoreKey`

The helper now takes only an owner's login and repository name:

<!-- tested-example: repository-store-key -->
```typescript
import {repositoryStoreKey} from 'simulacat-core';

const key = repositoryStoreKey({owner: 'acme', name: 'awesome-repo'});
console.log(key);
```

#### `branchStoreKey`

The branch helper takes only an owner's login, repository name, and branch name:

<!-- tested-example: branch-store-key -->
```typescript
import {branchStoreKey} from 'simulacat-core';

const key = branchStoreKey({owner: 'acme', repo: 'awesome-repo', name: 'main'});
console.log(key);
```

#### `blobStoreKey`

The blob helper takes repository coordinates and either a path or SHA:

<!-- tested-example: blob-store-key -->
```typescript
import {blobStoreKey} from 'simulacat-core';

const key = blobStoreKey({owner: 'acme', repo: 'awesome-repo', path: 'README.md'});
console.log(key);
```

### 1.2.1 — Request-scoped actor resolution

`GET /user`, `GET /user/memberships/orgs`, and `Query.viewer` no longer fall
back to the first seeded user when no actor header is present. They now return
HTTP 401 with `Authentication required` for unauthenticated requests.

| Scenario                               | Before 1.2.1                    | After 1.2.1                                 |
| -------------------------------------- | ------------------------------- | ------------------------------------------- |
| No actor header sent                   | First seeded user returned      | 401 `{"message":"Authentication required"}` |
| `x-simulacat-user: <login>` sent       | Named user returned (unchanged) | Named user returned (unchanged)             |
| `x-simulacat-actor: user:<login>` sent | Not supported                   | Named user returned                         |

Set `x-simulacat-actor: user:<login>` (or a legacy alias) on every request that
must exercise `/user`, `/user/memberships/orgs`, or `viewer`.

For REST authenticated-user routes, both `GET /user` and
`GET /user/memberships/orgs` require `x-simulacat-actor: user:<login>` or a
legacy user alias. Without an actor that resolves to a seeded user, these
routes return HTTP 401 with `{"message":"Authentication required"}`.
