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

- **Model GitHub as a testable system**: Seed users, organisations,
  repositories, branches, and blobs, then query them through REST and GraphQL.
- **Stay deterministic**: Run the same simulation locally and in CI without
  rewriting production code around "test mode" flags.
- **Extend where you need to**: Add store slices, OpenAPI handlers, and
  Express routes for product-specific behaviour.
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
  branches: [{name: 'main'}],
  blobs: []
};

const app = simulation({initialState});

app.listen(3300, () => {
  console.log('Simulacat Core is listening on http://localhost:3300');
});
```

Point your GitHub client at `http://localhost:3300`, then visit
`http://localhost:3300/simulation` to inspect the available routes.

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
changes so your work matches the repository's build, testing, and commit rules.
