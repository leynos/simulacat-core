# Simulacat Core

*A stateful mock GitHub API engine for deterministic tests and local
automation.*

Simulacat Core extends The Frontside's Simulacrum GitHub API example into a
reusable library for higher-level test harnesses. It is the engine behind
[Simulacat](https://github.com/leynos/simulacat), a Python `pytest` fixture for
stateful GitHub API mocking, and the planned Rust companion Rentaneko.

______________________________________________________________________

## Why Simulacat Core?

GitHub-heavy tests usually rot in one of two ways: they either hit the real API
and become brittle, or they rely on static fixtures that cannot express
stateful behaviour.

- **Model GitHub as a testable system**: Seed users, organizations,
  repositories, branches, blobs, and installations, then query them through
  REST and GraphQL.
- **Stay deterministic**: Run the same simulation locally and in CI without
  rewriting production code around "test mode" flags.
- **Extend where you need to**: Add store slices, OpenAPI handlers, and Express
  routes for product-specific behaviour.
- **Share one engine across languages**: Use the same simulator core from
  Python fixtures today and Rust fixtures tomorrow.

______________________________________________________________________

## Quick start

### Installation

```bash
bun add simulacat-core
```

### Basic usage

```ts
import {simulation, type InitialState} from 'simulacat-core';

const initialState: InitialState = {
  users: [{login: 'test', organizations: ['frontside']}],
  organizations: [{login: 'frontside'}],
  repositories: [{owner: 'frontside', name: 'test-repo'}],
  branches: [{owner: 'frontside', repo: 'test-repo', name: 'main'}],
  blobs: [{owner: 'frontside', repo: 'test-repo', path: 'README.md'}]
};

const app = simulation({initialState});

app.listen(3300, () => {
  console.log('Simulacat Core is listening on http://localhost:3300');
});
```

Point your GitHub client at `http://localhost:3300`, then visit
`http://localhost:3300/simulation` to inspect the available routes.

______________________________________________________________________

## Configuration

`simulation()` accepts a single `GitHubSimulatorArgs` object.

- `initialState`: Seeds users, organizations, repositories, branches, and
  blobs. Organizations also generate installation fixtures automatically.
- `apiUrl`: Changes the mounted REST API root. The default is `/`.
- `apiSchema`: Uses a bundled schema such as `api.github.com.json` or a custom
  schema path on disk.
- `extend.extendStore`: Adds store schema, actions, or selectors alongside the
  built-in GitHub slices.
- `extend.openapiHandlers`: Registers extra OpenAPI operation handlers that can
  read from the shared simulation store.
- `extend.extendRouter`: Adds plain Express routes next to the built-in health,
  OAuth, and GraphQL routes.

______________________________________________________________________

## Extending the simulation

You can layer custom routes and handlers on top of the core GitHub behaviour
without forking the package:

```ts
import {simulation, type InitialState} from 'simulacat-core';

const initialState: InitialState = {
  users: [{login: 'test', organizations: []}],
  organizations: [{login: 'frontside'}],
  repositories: [{owner: 'frontside', name: 'test-repo'}],
  branches: [{owner: 'frontside', repo: 'test-repo', name: 'main'}],
  blobs: []
};

const app = simulation({
  initialState,
  extend: {
    extendRouter: (router) => {
      router.get('/hello-world', (_request, response) => {
        response.json({message: 'hello from simulacat-core'});
      });
    },
    openapiHandlers: (simulationStore) => ({
      'repos/list-tags': async () => ({
        status: 200,
        json: [
          {
            name: `v${simulationStore.schema.repositories.selectTableAsList(
              simulationStore.store.getState()
            ).length}.0.0`
          }
        ]
      })
    })
  }
});
```

______________________________________________________________________

## Supported API surface

| Surface | Coverage today | Notes |
| --- | --- | --- |
| REST routes | Installations, repository lists, branches, blobs, trees, commit status, authenticated user, and org memberships | See [`docs/api-reference.md`](docs/api-reference.md) for the exact route list. |
| GraphQL root queries | `viewer`, `organization`, `organizations`, `repository`, and `repositoryOwner` | Connection pagination uses Relay-style cursors. |
| GraphQL nested fields | Repository owners, repository topics, languages, and user organizations | Some connections are intentionally stubbed with empty results for now. |
| Platform routes | `/health`, `/graphql`, OAuth authorize, and OAuth access token endpoints | Useful for local harness bootstrapping and login flows. |

______________________________________________________________________

## Type reference

The package exports both the simulation factory and the schema helpers used to
seed fixtures.

- `InitialState`: Alias for the input shape accepted by `simulation()`.
- `githubUserSchema`: Seeds GitHub users and fills in default names, emails,
  avatars, and timestamps.
- `githubOrganizationSchema`: Seeds organizations and derives GitHub-style URLs
  plus default metadata.
- `githubRepositorySchema`: Seeds repositories and expands them with canonical
  REST-style URLs and default visibility metadata.
- `githubBranchSchema`: Seeds branch data, defaulting to `main`.
- `githubBlobSchema`: Seeds repository contents. A blob must specify either
  `path` or `sha`; either lookup style is supported.

______________________________________________________________________

## Features

- Store-backed REST handlers for core GitHub simulator workflows.
- GraphQL support for repository, owner, and pagination-driven test queries.
- Typed `InitialState` input for seeding stateful test fixtures quickly.
- Extension hooks for custom store state, OpenAPI handlers, and router
  behaviour.
- Bundled GitHub REST and GraphQL schemas for local simulation.

______________________________________________________________________

## Learn more

- [API reference](docs/api-reference.md) — simulation arguments, exported
  schemas, and supported API operations.
- [Architecture guide](docs/architecture.md) — how seeded state flows through
  the store, REST, and GraphQL layers.
- [Development guide](docs/development.md) — local workflows, quality gates, and
  schema regeneration.
- [GitHub REST API audit](docs/github-rest-api-audit.md) — current REST
  coverage, scriptability, and gaps.
- [GitHub GraphQL API audit](docs/github-graphql-api-audit.md) — current
  GraphQL behaviour and limitations.
- [Roadmap](docs/roadmap.md) — planned delivery slices and priorities.
- [Schema notes](schema/README.md) — bundled REST and GraphQL schema details.

______________________________________________________________________

## Origins

Simulacat Core is derived from the GitHub API example shipped with
[Simulacrum by The Frontside](https://frontside.com). This repository keeps
that "scriptable fake over inert fixtures" spirit, then pushes it towards
stateful testing for the df12 toolchain.

______________________________________________________________________

## Licence

MIT — see [LICENSE](LICENSE) for details.

______________________________________________________________________

## Contributing

Contributions are welcome. Please read [AGENTS.md](AGENTS.md) before making
changes, so your work matches the repository's build, testing, and commit
rules.
