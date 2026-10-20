# Architectural decision record (ADR) 001: linting strategy for Oxlint plug-ins

## Status

Accepted. The repository pins Oxlint, the built-in `unicorn` plug-in, and two
JavaScript plug-ins (`ai-deslop` and the local `df12` plug-in), and prefers
`unicorn` whenever a `unicorn` rule and a `deslop` rule disagree.

## Date

2026-10-19.

## Context and problem statement

Biome and Oxlint already share the maintainability gates (see the
[Developers guide](developers-guide.md#linting-rules)). Biome covers function
length, parameter count, and cognitive complexity; Oxlint covers McCabe
complexity, nesting depth, complex conditionals, and the local `df12` JSDoc
rules.

Two gaps remained:

- Oxlint's `unicorn` plug-in provides a large, well-tested set of correctness
  and style rules that the repository did not run, despite the plug-in shipping
  with the pinned Oxlint release.
- `deslop` (`ai-deslop`) adds rules aimed at low-evidence TypeScript: ad hoc
  `typeof` narrowing, `unknown` parameters and returns, type assertions without
  a stated invariant, and dictionary types that hide an escape hatch.

Both are opt-in. Without a recorded decision, future maintainers cannot tell
which rule is authoritative when two plug-ins flag the same construct, or which
versions the gates were validated against.

## Decision Drivers

- One owner per concern: the compiler owns types, Biome owns formatting and
  its native maintainability rules, Oxlint owns syntax-aware maintainability,
  and the plug-ins extend that last owner rather than duplicating Biome.
- Reproducible gates: the linter, the plug-ins, and the type-aware backend must
  be pinned, so a green gate means the same rules ran for every contributor.
- Evidence-first code: `deslop` exists to push runtime evidence to boundaries
  and named types, which matches the repository's Zod-at-the-boundary policy.
- Existing obligations: the `df12` rules, TypeDoc, and Biome rules must keep
  working; they are not superseded by the new plug-ins.

## Requirements

### Functional requirements

- Run every supported `unicorn` rule in the Oxlint "recommended" profile, with
  documented exceptions only.
- Run the `deslop` recommended rule set.
- Keep the `df12` maintainability and JSDoc rules in the same Oxlint process.
- Keep type-aware linting enabled for the rules that require it.

### Technical requirements

- Pin exact versions of Oxlint, `oxlint-tsgolint`, and `ai-deslop`.
- Load both JavaScript plug-ins through `jsPlugins`, which Oxlint marks as
  alpha; keep each pinned to a version validated against the pinned Oxlint.
- Turn every rule on explicitly: the configuration sets all Oxlint categories
  to `off` so that no rule arrives or disappears with an upstream category
  reshuffle.

## Options considered

### Option A: rely on Oxlint's recommended category presets

Enable `correctness` and `pedantic` and inherit whatever Oxlint ships. This is
the least configuration, but the rule set can change on a patch release, and
`unicorn`'s recommended profile is not identical to the category presets.

### Option B: pin the toolchain and enumerate every rule

Disable all categories, list the `unicorn` and `deslop` rules explicitly, and
pin all three packages. The rule set then moves only with a deliberate
dependency bump, and a rule that is disabled for a conflict stays documented.

### Option C: adopt Biome's recommended set and skip Oxlint plug-ins

This keeps one linter, but loses the syntax-aware rules the repository already
relies on and does not cover the evidence-first checks that `deslop`
contributes.

| Topic                 | Option A | Option B | Option C |
| --------------------- | -------- | -------- | -------- |
| Rule-set stability    | Low      | High     | Medium   |
| Conflict visibility   | Low      | High     | High     |
| Configuration effort  | Low      | High     | Low      |
| Evidence-first checks | Partial  | Full     | None     |
| Type-aware support    | Partial  | Full     | None     |

Table 1: comparison of the three options.

## Decision outcome

Option B. The repository now pins:

| Component         | Version    | Role                                                        |
| ----------------- | ---------- | ----------------------------------------------------------- |
| `oxlint`          | `1.82.0`   | Linter binary and the built-in plug-ins it bundles          |
| `unicorn`         | Built in   | Correctness and style rules from the pinned Oxlint release  |
| `ai-deslop`       | `0.4.8`    | Evidence-first `deslop/*` rules and selected standard rules |
| `oxlint-tsgolint` | `7.0.2004` | Type-aware backend for the type-aware rules                 |

Table 2: pinned components of the linting stack.

Each pin is an exact version (no caret) in `package.json`; `bun.lock` records
the resolved graph. The `deslop` package brings `@oxlint/plugins` as a runtime
dependency, so its version moves with `ai-deslop` and must stay compatible with
the pinned Oxlint.

### Rule configuration

- All Oxlint categories are `off`. The enabled rules are those listed in
  `.oxlintrc.json`, which makes the set auditable in review.
- Every supported `unicorn` rule is `error`. The one exception is
  `unicorn/no-null`, which is `off`.
- The `deslop` rules are `error`, together with the standard rules its
  recommended set carries: `typescript/no-deprecated`,
  `typescript/no-require-imports`, `typescript/no-floating-promises`,
  `typescript/no-unnecessary-condition`, and `no-unreachable`.
- `options.typeAware` is `true`, satisfying the type-aware rules in both
  plug-ins.
- The `df12` rules and the existing `complexity`, `max-depth`, and
  `no-unreachable` settings are unchanged.

### Disabled and preferred rules

`unicorn/no-null` is the only rule disabled in `.oxlintrc.json`. It would
reject the `null` values that the GitHub REST and GraphQL contracts require in
responses: GraphQL returns `data: null` for a rejected request, and several
REST fields are explicitly nullable. Rewriting those values to `undefined`
would change the published wire contract, so the rule conflicts with the
documented API behaviour and stays off.

Where a `unicorn` rule and a `deslop` rule flag the same construct, the
`unicorn` spelling wins and the call site is rewritten to the `unicorn` form.
The type-assertion rules are the main overlap in intent: `unicorn` has no
assertion rule of its own, so
`deslop/require-safety-comment-for-type-assertion` and
`deslop/no-chained-type-assertions` apply without a competing spelling.
`unicorn/no-array-callback-reference` and `unicorn/prefer-array-flat-map` are
satisfied by the same `flatMap` rewrite that `deslop/no-array-filter-map`
requires.

In general, a conflict is resolved by rewriting the call site to a form both
rules accept. Disabling one of the pair is a last resort and requires a note in
`.oxlintrc.json` plus an amendment to this ADR. Other `unicorn` or `deslop`
rules may be disabled only where they conflict with an existing Biome or `df12`
requirement, with TypeDoc output, or with each other.

Two such conflicts were resolved with a scoped suppression rather than a global
disable:

- `deslop/no-pass-through-type-alias` and TypeDoc disagree on
  `export type InitialState = GitHubInitialStore`. Rewriting the alias as an
  interface makes TypeDoc expand the inherited schema fields and require
  documentation for each one, which the generated schema type cannot supply.
  The alias is kept, with a single inline `oxlint-disable-next-line` that
  states the TypeDoc reason.
- `typescript/no-require-imports` conflicts with the CommonJS CLI entry point
  `bin/start.cjs`, which `AGENTS.md` documents as an intentional exception that
  must run under Node without transpilation. The single `require` call carries
  an inline suppression with that reason.

## Known risks and limitations

- Oxlint JavaScript plug-ins are an alpha interface. A future Oxlint release
  may change the `eslintCompatPlugin` surface; the exact pins mean the gates
  are stable, and an upgrade is a deliberate change that reruns the gates.
- `deslop/no-runtime-typeof` is intentionally strict: every `typeof` that is
  not a comparison with the literal `'undefined'` is rejected. Boundary code
  must use a schema or a named type guard instead.
- `deslop/require-safety-comment-for-type-assertion` requires a comment
  containing `SAFETY:`, attached where the rule's comment-owner ancestor can
  see it. Some assertion sites cannot carry a comment (for example, an
  assertion in a type-only expression), and those sites must be restructured.
- Enabling the full `unicorn` set raises churn in code written before the
  decision. The remediation was done as part of this change rather than
  deferred with a baseline.

## Architectural rationale

The decision keeps one owner per concern. Biome remains the formatter and the
owner of native maintainability rules; Oxlint remains the syntax-aware owner
and now also hosts the evidence-first rules; the compiler still owns types.
Pinning is the same reproducibility discipline the repository applies to
dependencies in `package.json`. Enumerating rules makes every suppression and
every disabled rule a reviewable line rather than an inherited default.

## References

- [Developers guide: linting rules](developers-guide.md#linting-rules)
- [Oxlint configuration schema](https://oxc.rs/docs/guide/usage/linter/config)
- [`ai-deslop` package](https://www.npmjs.com/package/ai-deslop)
