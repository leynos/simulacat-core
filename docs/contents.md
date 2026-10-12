# Documentation contents

- [Documentation contents](contents.md) — Find the right guide, reference, or
  design note for the task.

## Use the simulator

- [Repository README](../README.md) — Install the package, start a simulation,
  and check the supported API surface.
- [Users guide](users-guide.md) — Seed entities, use request actors, and
  understand simulator behaviour.
- [API reference](api-reference.md) — Check exported APIs, routes, and
  GraphQL coverage.
- [Bundled schema README](../schema/README.md) — Learn about the REST and
  GraphQL schemas included with the package.

## Develop and maintain the project

- [Developers guide](developers-guide.md) — Set up local development and use
  the repository workflows.
- [Repository layout](repository-layout.md) — Locate source, tests, fixtures,
  schemas, and generated files.
- [Documentation style guide](documentation-style-guide.md) — Apply the shared
  conventions for project documentation.
- [Complexity antipatterns and refactoring strategies](complexity-antipatterns-and-refactoring-strategies.md)
  — Recognize costly code patterns and choose refactoring approaches.
- [Dependency policy exception: braces in nested patterns](dependency-policy-exception-braces-nested-patterns.md)
  — Understand the repository's documented dependency policy exception.

## Understand the design and API coverage

- [Architecture](architecture.md) — Follow the simulator's main structural
  boundaries.
- [Mocking services with Simulacrum actors and stable keyset connections](mocking-services-with-simulacrum-actors-and-stable-keyset-connections.md)
  — Read the design rationale for actors and keyset connections.
- [GitHub REST API audit](github-rest-api-audit.md) — Review the REST surface
  coverage audit.
- [GitHub GraphQL API audit](github-graphql-api-audit.md) — Review the GraphQL
  surface coverage audit.

## Follow planned work

- [Roadmap](roadmap.md) — See the project's planned delivery slices.
- [ExecPlans](execplans/) — Read implementation plans for roadmap slices:
  - [1.1.1: Re-key repositories and refs by canonical identifiers](execplans/1-1-1-re-key-repositories-and-refs-by-canonical-identifiers.md)
  - [1.1.2: First-class entities for early slices](execplans/1-1-2-first-class-entities-for-early-slices.md)
  - [1.2.1: Request-scoped actor resolution](execplans/1-2-1-request-scoped-actor-resolution.md)
  - [1.2.2: Expose actor context to handlers](execplans/1-2-2-expose-actor-context-to-handlers.md)
  - [1.3.1: Shared domain actions for write behaviour](execplans/1-3-1-shared-domain-actions-for-write-behaviour.md)
  - [1.4.1: Derive REST URLs](execplans/1-4-1-derive-rest-ur-ls.md)

## Shared standards source

The complexity and refactoring guide and the documentation style guide are
imported from the `documentation-library/` directory in
[leynos/agent-helper-scripts](https://github.com/leynos/agent-helper-scripts/tree/d3da862950d9169e08454fb47d55f9bb079bf6b8/documentation-library).
The import uses revision `d3da862950d9169e08454fb47d55f9bb079bf6b8`, the
latest revision on the upstream default branch at import time. Local formatting
adjustments may be required by this repository's Markdown gates.
