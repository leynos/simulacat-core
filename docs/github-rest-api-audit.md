# GitHub REST API Audit

## Scope

This audit compares `@packages/github-api` to the GitHub REST OpenAPI
description at:

- `https://raw.githubusercontent.com/github/rest-api-description/refs/heads/main/descriptions-next/ghes-3.20/ghes-3.20.yaml`

The focus is not just "does a route exist", but which parts of the simulator
are:

- stubbed from OpenAPI examples
- stateful or scriptable against the in-memory store
- extensible by consumers

## Executive Summary

`packages/github-api` has three distinct REST support layers:

1. The foundation simulator can auto-stub any operation present in the loaded
   OpenAPI document via `mockResponseForOperation(...)` when no explicit
   handler is registered.
2. `packages/github-api` adds a small set of built-in stateful handlers backed
   by `initialState` and selectors.
3. Consumers can extend the simulator with custom OpenAPI handlers, Express
   routes, and store extensions.

Against the GHES 3.20 REST spec, the important distinction is:

- Stubbed coverage can be broad if the GHES 3.20 schema is loaded.
- Built-in scriptable coverage is narrow: 13 explicit operation handlers.
- Out of the box, the package does not even load the GHES 3.20 spec. It
  defaults to the bundled dotcom schema `schema/api.github.com.json`.

## Key Findings

### 1. Default runtime coverage is not GHES 3.20

The package defaults `apiSchema` to `api.github.com.json`, not the GHES 3.20
YAML. That bundled schema is synced from the dotcom description, not the GHES
document.

- `packages/github-api/src/index.ts` defaults `apiSchema` to
  `"api.github.com.json"`.
- `packages/github-api/sync.ts` fetches
  `descriptions/api.github.com/api.github.com.json`.
- `packages/github-api/schema/README.md` also describes the REST schema as
  coming from `descriptions/api.github.com`.

Implication:

- The default simulator is aligned to the bundled dotcom schema, not the GHES
  3.20 schema used for this audit.
- To get GHES 3.20-wide stub coverage, a caller must pass the GHES schema path
  into `simulation({ apiSchema })`.

### 2. GHES 3.20 is much broader than the built-in GitHub mock logic

From the GHES 3.20 YAML:

- 702 path entries
- 1348 operations

Largest tags by operation count:

| Tag                | Operations |
| ------------------ | ---------: |
| `repos`            | 196        |
| `actions`          | 160        |
| `enterprise-admin` | 151        |
| `orgs`             | 87         |
| `issues`           | 45         |
| `apps`             | 38         |
| `users`            | 37         |
| `teams`            | 35         |
| `activity`         | 32         |
| `dependabot`       | 28         |
| `packages`         | 27         |
| `pulls`            | 27         |
| `projects`         | 26         |
| `secret-scanning`  | 22         |
| `code-security`    | 20         |
| `gists`            | 20         |
| `git`              | 13         |

The built-in GitHub mock contributes 13 explicit REST handlers, or about
`0.96%` of the GHES 3.20 operation surface.

### 3. Stubbed coverage and scriptable coverage are very different

The foundation layer registers a `notImplemented` handler that returns
`c.api.mockResponseForOperation(...)`. That means:

- any operation present in the loaded schema can return some example-based
  response
- but only explicitly registered handlers are stateful or behaviourally
  scriptable

In practice:

- GHES 3.20 schema loaded: potentially broad stubbed coverage
- default dotcom schema loaded: broad stubbed coverage for that smaller,
  different schema
- built-in scriptable coverage: still only the explicit operation handlers below

### 4. `initialState` is the switch that turns on built-in GitHub behaviour

`packages/github-api/src/rest/index.ts` registers the built-in handlers only
when `initialState` is present.

Implication:

- without `initialState`, none of the built-in GitHub REST handlers register
- without `initialState`, `extend.openapiHandlers` still registers because it
  is merged outside the built-in handler guard
- in that mode, REST behaviour is effectively pure OpenAPI example stubbing plus
  the non-OpenAPI Express routes

This is a meaningful gotcha for consumers who expect custom REST handlers to
work without seeding store state.

## Built-In Scriptable REST Coverage

The explicit OpenAPI handler map lives in
`packages/github-api/src/rest/index.ts`.

| Operation ID                                   | Method | Path                                                 | Classification                     | Notes                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------ | ---------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/list-installations`                      | `GET`  | `/app/installations`                                 | Partially scriptable               | Derived from installation entities in the store, but the endpoint still reflects only the seeded installation slice.                                                                                                  |
| `apps/create-installation-access-token`        | `POST` | `/app/installations/{installation_id}/access_tokens` | Partially scriptable               | Token, expiry, permissions, and selection are fixed; repository list comes from the store.                                                                                                                            |
| `apps/list-repos-accessible-to-installation`   | `GET`  | `/installation/repositories`                         | Stateful/scriptable                | Returns all repos in store with `total_count`.                                                                                                                                                                        |
| `apps/get-org-installation`                    | `GET`  | `/orgs/{org}/installation`                           | Stateful/scriptable                | Looks up generated installation for org; returns 404 when missing.                                                                                                                                                    |
| `apps/get-repo-installation`                   | `GET`  | `/repos/{owner}/{repo}/installation`                 | Stateful/scriptable                | Looks up installation for repo owner and repo; returns 404 when missing.                                                                                                                                              |
| `repos/list-for-org`                           | `GET`  | `/orgs/{org}/repos`                                  | Stateful/scriptable                | Filters repositories by org; returns `[]` for orgs with no repos and 404 for unknown orgs.                                                                                                                            |
| `repos/list-branches`                          | `GET`  | `/repos/{owner}/{repo}/branches`                     | Stateful/scriptable                | Filters the branches table by owner and repo.                                                                                                                                                                         |
| `repos/get-combined-status-for-ref`            | `GET`  | `/repos/{owner}/{repo}/commits/{ref}/status`         | Mostly stubbed                     | Response is built from a fixed utility payload with dynamic owner/repo/ref interpolation only.                                                                                                                        |
| `repos/get-content`                            | `GET`  | `/repos/{owner}/{repo}/contents/{path}`              | Stateful/scriptable                | Looks up a blob by owner/repo/path and returns base64 content.                                                                                                                                                        |
| `git/get-blob`                                 | `GET`  | `/repos/{owner}/{repo}/git/blobs/{file_sha}`         | Stateful/scriptable                | Looks up a blob by owner/repo/sha and returns base64 content.                                                                                                                                                         |
| `git/get-tree`                                 | `GET`  | `/repos/{owner}/{repo}/git/trees/{tree_sha}`         | Partially scriptable               | The handler now reads `tree_sha`, but it still ignores real tree-sha semantics and simply maps all blobs for the repo.                                                                                                |
| `users/get-authenticated`                      | `GET`  | `/user`                                              | Partially scriptable               | Returns the first user in the store only; there is no token or auth context.                                                                                                                                          |
| `orgs/list-memberships-for-authenticated-user` | `GET`  | `/user/memberships/orgs`                             | Partially scriptable               | Returns all orgs as active admin memberships for the first user in the store.                                                                                                                                         |

## What Is Stubbed But Not Really Mocked

If the relevant OpenAPI schema is loaded, the simulator can still return
example payloads for many operations with no custom logic behind them. That is
useful for shallow client integration, but it is not equivalent to a mock with
controllable state.

These areas are effectively stub-only by default relative to GHES 3.20:

- `actions`
- `enterprise-admin`
- `issues`
- `teams`
- `activity`
- `dependabot`
- `packages`
- `pulls`
- `projects`
- `secret-scanning`
- `code-security`
- `gists`
- `checks`
- `migrations`
- enterprise and admin paths such as `/enterprises/*`, `/enterprise/*`,
  `/admin/*`
- utility surfaces such as `/search`, `/notifications`, `/licenses`,
  `/markdown`, `/rate_limit`

The package has no built-in state model for these groups.

## Extension Surface

The package is better described as "a small GitHub-specific stateful layer on
top of a generic OpenAPI mock server" than as a comprehensive GitHub REST
simulator.

Consumers can extend it in three ways:

| Extension point          | Where                                    | What it enables                                                                       |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `extend.openapiHandlers` | `packages/github-api/src/index.ts`       | Add or replace OpenAPI operation handlers with access to the GitHub simulation store. |
| `extend.extendRouter`    | `packages/github-api/src/extend-api.ts`  | Add arbitrary Express routes or middleware outside the OpenAPI surface.               |
| `extend.extendStore`     | `packages/github-api/src/store/index.ts` | Add schema slices, actions, and selectors to support richer scripted behavior.        |

Current limitations of that extension model:

- There is no built-in package API to replace the GraphQL handler directly.
- Base GitHub actions are empty, so mutating REST behavior must be added by
  consumers.

## Store and Modeling Constraints

The current store model is enough for a thin set of repository and installation
flows, but it is not a close model of the GitHub REST domain.

Notable constraints:

- Installations are generated for organizations during
  `githubInitialStoreSchema.parse(...)`, but caller-supplied installation rows
  are preserved rather than overwritten.
- Generated repository, organization, and installation URLs assume
  `localhost:3300`.
- Authentication and authorization are intentionally not enforced.

These constraints reduce the realism of any attempt to script broader GitHub
REST workflows.

## Non-OpenAPI Routes

The package also registers several routes outside the REST OpenAPI surface:

- `GET /health`
- `POST /graphql`
- `GET /login/oauth/authorize`
- `POST /login/oauth/access_token`
- `POST /api/v3/app/installations/:id/access_tokens`

These are useful simulator conveniences, but they should not be counted as GHES
REST API completeness.

## Test Coverage Observed

The current test suite exercises only a subset of the explicit REST handlers:

- covered: installation lookup routes, installation repositories, org repos,
  branches, user org memberships
- not covered: installation access token, combined commit status, repository
  contents, git blob, git tree

That aligns with the current implementation shape: the most dynamic content
handlers exist, but several partially stubbed or fragile handlers are not under
direct test.

## Assessment

Relative to the GHES 3.20 REST documentation, `packages/github-api` is:

- strong as an example-backed OpenAPI stub server
- narrow as a built-in stateful GitHub REST mock
- reasonably extensible for teams willing to add their own handlers and store
  behaviour
- not complete as a GHES 3.20 behavioural simulator

The best practical description is:

> Broad stub coverage is available through the loaded OpenAPI schema, but
> built-in scriptable GitHub behavior is limited to a small
> repository/installations/user slice.

## Recommended Follow-Ups

1. Decide whether the package should be audited against GHES 3.20 or against
   the bundled dotcom schema, then make the default explicit in docs. The
   bundled dotcom schema should remain the documented default unless runtime
   behaviour changes.
2. Keep documenting that `extend.openapiHandlers` stays active without seeded
   `initialState`, because that extension seam now works independently of the
   built-in handler guard.
3. Keep documenting `git/get-tree` as only partially scriptable: the route now
   reads `tree_sha` and has coverage, but it still maps all blobs in the
   repository instead of modelling real tree objects.
4. Add real tree and status models if deeper git scripting is a goal.
5. Add a support matrix to package docs that separates:
   - schema-stubbed operations
   - built-in stateful operations
   - extension-only operations.
