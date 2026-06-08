# Replace the in-repo oxlint plugin with the shared df12-lints package

This ExecPlan (execution plan) is a living document. The sections
`Constraints`, `Tolerances`, `Risks`, `Progress`, `Surprises & Discoveries`,
`Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work
proceeds.

Status: DRAFT

## Purpose / big picture

Today this repository carries a private copy of an Oxlint plugin at
`tools/oxlint-plugin-df12/index.js` (about 560 lines) plus a behavioural test
suite at `tests/oxlint-plugin.test.js` (about 620 lines). The same plugin now
lives in a shared repository, `df12-lints`
(<https://github.com/leynos/df12-lints>), where it is maintained and tested
centrally. Keeping a fork here means every fix to the shared rules must be
hand-ported.

After this change, the repository consumes the plugin from the shared package
instead of its local fork. Concretely:

1. `package.json` gains a pinned dependency on `df12-lints` at commit
   `fe04adc80cfd8d3fc3df987f8022863a2f27a2a0`.
2. `.oxlintrc.json` loads the plugin through the package export
   `df12-lints/oxlint-plugin` rather than the relative path
   `./tools/oxlint-plugin-df12/index.js`.
3. The local plugin source and its dedicated test file are removed.
4. The documentation that describes the plugin is updated to say the rules come
   from the shared package.

A reader can observe success by running `make lint` (which runs `bunx oxlint .`)
and `make test` at the repository root: linting still enforces the four `df12/`
rules and the `.jsdoc-baseline.json` suppressions, and the test suite still
passes — now without a local plugin copy. The four enforced rules are
unchanged: `df12/complex-conditional`, `df12/require-module-jsdoc`,
`df12/require-public-jsdoc`, and `df12/require-private-jsdoc`.

A secondary deliverable is a written list of issues and behavioural
discrepancies in the shared `df12-lints` package (recorded under `Surprises &
Discoveries` and `Artifacts and notes`) so they can be filed as bugs against
that repository.

## Constraints

Hard invariants that must hold throughout implementation. Violation requires
escalation, not a workaround.

1. The four enforced `df12/` rules and their configured options in
   `.oxlintrc.json` must remain behaviourally identical: `complex-conditional`
   with `maxLogicalOperators: 1`, `includeTernary: true`,
   `includeNullishCoalescing: false`; and the three `require-*-jsdoc` rules at
   `error`.
2. The existing `.jsdoc-baseline.json` (83 entries) must continue to suppress
   exactly the functions it suppresses today. No file that lints clean now may
   begin to error, and no currently-suppressed function may start erroring,
   after the switch.
3. `.oxlintrc.json` `ignorePatterns`, `categories`, and the built-in
   `complexity` / `max-depth` rules must be preserved verbatim. Only the
   `jsPlugins` entry changes.
4. The dependency must be pinned to the exact commit
   `fe04adc80cfd8d3fc3df987f8022863a2f27a2a0`, not a branch or tag, so the
   ruleset is reproducible.
5. All quality gates defined in `AGENTS.md` must pass before each commit:
   `make check-fmt`, `make typecheck`, `make lint`, `make test`, and
   `make build`. Equivalently, `make all` followed by `make build`, matching CI
   in `.github/workflows/ci.yml`.
6. `bun install --frozen-lockfile` (used by CI) must succeed, so `bun.lock`
   must be committed in the same change as the `package.json` edit.

## Tolerances (exception triggers)

1. Scope: this change should touch roughly six files (`package.json`,
   `bun.lock`, `.oxlintrc.json`, the deleted plugin, the deleted plugin test,
   and two docs files). If more than ten files need editing, stop and escalate.
2. Dependencies: adding `df12-lints` is the one intended new dependency. If a
   second new dependency proves necessary (for example a build helper), stop
   and escalate.
3. Resolution failure: if `bunx oxlint .` cannot resolve the bare specifier
   `df12-lints/oxlint-plugin` after one configuration attempt and one
   documented fallback (see Risk R1), stop and escalate rather than vendoring
   the file back.
4. Baseline regression: if, after the switch, `bunx oxlint .` reports any
   `df12/` diagnostic that it does not report today, stop and escalate; this
   signals the working-directory behavioural change (Risk R2) has bitten.
5. Iterations: if `make all` still fails after three focused fix attempts,
   stop and escalate.

## Risks

1. Risk R1: Oxlint may not resolve a bare package-subpath specifier
   (`df12-lints/oxlint-plugin`) in `jsPlugins`, or may not honour the package
   `exports` map, when the package is installed from a git dependency.
   Severity: high. Likelihood: medium.
   Mitigation: the shared README documents exactly this usage, so it is
   expected to work. Stage B is a prototyping milestone that verifies
   resolution before any deletion. Documented fallback: point `jsPlugins` at
   the installed file path
   `./node_modules/df12-lints/tools/oxlint-plugin-df12/index.js`, which is the
   same resolution mechanism the repo uses today, only relocated into
   `node_modules`. If the fallback is used, record it in the `Decision Log`.

2. Risk R2: The shared plugin computes repository-relative paths from
   `context.cwd` (falling back to `process.cwd()`), whereas the local fork
   always uses `process.cwd()`. If Oxlint sets `context.cwd` to something other
   than the repository root, the baseline keys (for example
   `src/graphql/handler.ts#createHandler`) will not match and 83 suppressed
   functions could start erroring.
   Severity: high. Likelihood: low.
   Mitigation: Constraint 2 plus Tolerance 4 — diff the `df12/` diagnostics
   before and after; any new diagnostic is a stop condition. The shared
   fallback chain `context.cwd ?? context.getCwd?.() ?? process.cwd()` makes a
   regression unlikely when `oxlint` is invoked from the repository root.

3. Risk R3: The shared package declares `"private": true`, `version: 0.0.0`,
   has no `dist/` (it is git-ignored), no `files` whitelist, and no `prepare`
   build script. Its `.` export (`./dist/index.js`) therefore does not exist in
   a git install.
   Severity: low. Likelihood: high (it is certainly true).
   Mitigation: this repository only needs the `./oxlint-plugin` subpath, which
   maps to the committed file `tools/oxlint-plugin-df12/index.js` and is present
   in a git install (confirmed: `git ls-files` lists it). The broken `.` export
   is irrelevant here but is recorded as a bug to file upstream.

4. Risk R4: The local test `tests/oxlint-plugin.test.js` imports the plugin's
   `testInternals` and asserts the old caching contract (a cached `Set` with
   identity equality). The shared plugin removed baseline caching and changed
   `loadBaseline` to return a result object. Keeping the local test pointed at
   the dependency would fail to compile or assert.
   Severity: medium. Likelihood: high.
   Mitigation: delete the local test; the shared repository owns the equivalent
   and broader suite. See the `Decision Log`.

## Progress

- [ ] Stage A: orientation and discrepancy capture (no code changes).
- [ ] Stage B (prototyping): prove Oxlint resolves `df12-lints/oxlint-plugin`
  from a git install, and capture the baseline diagnostics for comparison.
- [ ] Stage C: add the pinned dependency, switch `jsPlugins`, remove the local
  plugin and its test.
- [ ] Stage D: update documentation; run all gates; finalise discrepancy list.

## Surprises & discoveries

Findings during planning that will be carried into implementation and filed
upstream are listed under `Artifacts and notes`. This section will record
anything unexpected encountered during execution.

## Decision log

1. Decision: Consume the shared plugin as a pinned git dependency
   (`github:leynos/df12-lints#fe04adc...`) rather than via the npm registry.
   Rationale: the package is `private: true`, `version: 0.0.0`, and is not
   published, so a registry install is impossible; a commit-pinned git
   dependency satisfies Constraint 4's reproducibility requirement.
   Date/Author: 2026-06-09, planning.

2. Decision: Delete `tests/oxlint-plugin.test.js` rather than re-point it at the
   dependency.
   Rationale: the suite asserts the removed baseline-caching contract and
   imports `testInternals` whose `loadBaseline` shape changed; the shared
   repository now owns this coverage. Retaining it would couple this repo to the
   plugin's internals, which is exactly what this migration removes.
   Date/Author: 2026-06-09, planning.

3. Decision: Change only the `jsPlugins` line in `.oxlintrc.json`, leaving
   `ignorePatterns`, `categories`, and rule options untouched.
   Rationale: Constraints 1 and 3 require behavioural parity.
   Date/Author: 2026-06-09, planning.

## Outcomes & retrospective

To be completed at the end of implementation. Compare the final lint and test
behaviour against the purpose above, and confirm the upstream discrepancy list
was filed.

## Context and orientation

This repository (`simulacat-core`) is a Bun/TypeScript package. Linting runs
through two tools, wired in the `Makefile`:

- `make biomejs` runs Biome (`bun run lint`).
- `make oxlint` runs `bunx oxlint .`.

Oxlint is configured by `.oxlintrc.json` at the repository root. Its current
`jsPlugins` array loads one local plugin:

```json oxlintrc
"jsPlugins": ["./tools/oxlint-plugin-df12/index.js"],
```

That plugin file, `tools/oxlint-plugin-df12/index.js`, defines a plugin named
`df12` exporting four rules. Three of them (`require-module-jsdoc`,
`require-public-jsdoc`, `require-private-jsdoc`) read a suppression list from
`.jsdoc-baseline.json` at the repository root; that file currently holds 83
entries of the form `relative/path.ts#functionName`. The fourth rule,
`complex-conditional`, counts logical operators in branch predicates.

The plugin has a dedicated behavioural test at `tests/oxlint-plugin.test.js`. It
runs the real `oxlint` binary against temporary fixture workspaces and also
imports the plugin's `testInternals` export to unit-test helpers such as
`loadBaseline`. The wider test suite is run by `make test`
(`bun test --max-concurrency=1 tests`).

Continuous integration is defined in `.github/workflows/ci.yml`: it runs
`bun install --frozen-lockfile`, then `make all` (which is
`check-fmt typecheck lint test`), then `bun audit`, then `make build`.

Documentation that mentions the plugin:

- `docs/development.md` lines 80–95 describe the four `df12/` rules and the
  `.jsdoc-baseline.json` mechanism; line 84 calls it "the local
  `tools/oxlint-plugin-df12` plugin".
- `docs/architecture.md` line 243 lists `.jsdoc-baseline.json` as a root file.

The shared package, fetched at commit
`fe04adc80cfd8d3fc3df987f8022863a2f27a2a0`, is laid out as:

- `package.json` with `"exports"` mapping `"./oxlint-plugin"` to
  `"./tools/oxlint-plugin-df12/index.js"` and `"."` to `"./dist/index.js"`.
- `tools/oxlint-plugin-df12/index.js`: the maintained plugin (git-tracked, so
  present in a git install).
- `src/index.ts`: a one-line metadata export, compiled to `dist/` by `tsc`
  (`dist/` is git-ignored and therefore absent from a git install).
- `tests/`: the upstream plugin and package tests.

Term definitions:

- "Baseline": the `.jsdoc-baseline.json` allow-list of functions exempted from
  the JSDoc rules while legacy documentation debt is paid down.
- "git dependency": a `package.json` dependency whose version is a git URL with
  a commit, which `bun install` clones instead of fetching from a registry.

## Plan of work

Stage A — understand and propose (no code changes). Confirm the current lint
and test behaviour as the baseline to preserve. Capture the full set of `df12/`
diagnostics emitted today (expected: none, because the baseline plus clean code
yields a passing lint) so Stage C can prove parity. Finalise the upstream
discrepancy list in `Artifacts and notes`.

Stage B — prototyping (de-risk resolution before deleting anything). Add the
git dependency and install it, switch `jsPlugins` to the bare specifier, and run
`bunx oxlint .`. The go/no-go decision: if Oxlint loads the plugin and reports
the same diagnostics as Stage A, proceed; if it cannot resolve the specifier,
apply the Risk R1 fallback (the `node_modules` path) and record it in the
`Decision Log`; if even that fails, stop and escalate (Tolerance 3). Keep the
local plugin file in place during this stage so the change is trivially
reversible.

Stage C — implementation. With resolution proven, delete the local plugin
`tools/oxlint-plugin-df12/index.js` and its test `tests/oxlint-plugin.test.js`,
remove the now-empty `tools/oxlint-plugin-df12/` directory, and confirm nothing
else imports either path. Re-run `make lint` and `make test`.

Stage D — documentation and cleanup. Update `docs/development.md` so the rules
are attributed to the shared `df12-lints` package rather than a local plugin,
keeping the rule descriptions and the baseline explanation intact. Review
`docs/architecture.md` line 243 and adjust if it implies the plugin is local.
Run the full gate sequence and `make build`.

Each stage ends with validation; do not proceed past a failing stage.

## Concrete steps

All commands run from the repository root
(`/home/leynos/.lody/repos/github---leynos---simulacat-core/worktrees/356761ad-7655-49fd-983f-1de0ad59df70`).

Stage A — capture the current behaviour:

```bash shell
bun install --frozen-lockfile
bunx oxlint . | tee /tmp/oxlint-before-$(git branch --show-current).out
```

Expect Oxlint to finish with no `df12/` errors (exit status 0). This is the
parity target.

Stage B — add and pin the dependency, then prove resolution. Edit
`package.json` to add, under `devDependencies`:

```json package.json
"df12-lints": "github:leynos/df12-lints#fe04adc80cfd8d3fc3df987f8022863a2f27a2a0",
```

Then install and switch the plugin specifier:

```bash shell
bun install
```

Edit `.oxlintrc.json`, changing only the `jsPlugins` line:

```json oxlintrc
"jsPlugins": ["df12-lints/oxlint-plugin"],
```

Validate resolution and parity:

```bash shell
bunx oxlint . | tee /tmp/oxlint-after-$(git branch --show-current).out
diff /tmp/oxlint-before-$(git branch --show-current).out \
     /tmp/oxlint-after-$(git branch --show-current).out
```

Expect the `diff` to be empty (identical diagnostics). If `oxlint` errors with a
plugin-resolution failure, apply the fallback specifier
`./node_modules/df12-lints/tools/oxlint-plugin-df12/index.js`, re-run, and note
it in the `Decision Log`.

Stage C — remove the local copy:

```bash shell
git rm tools/oxlint-plugin-df12/index.js tests/oxlint-plugin.test.js
make lint  | tee /tmp/lint-$(git branch --show-current).out
make test  | tee /tmp/test-$(git branch --show-current).out
```

Expect `make lint` to pass and `make test` to report the suite passing with the
plugin test gone. Confirm no remaining references:

```bash shell
grep -rn "tools/oxlint-plugin-df12" --include='*.ts' --include='*.js' \
  --include='*.json' --include='*.md' . | grep -v node_modules
```

Expect no matches outside historical plan documents.

Stage D — documentation and full gate:

```bash shell
make check-fmt | tee /tmp/check-fmt-$(git branch --show-current).out
make typecheck | tee /tmp/typecheck-$(git branch --show-current).out
make all       | tee /tmp/all-$(git branch --show-current).out
make build     | tee /tmp/build-$(git branch --show-current).out
```

Expect every target to pass, matching CI.

## Validation and acceptance

This change is configuration and dependency wiring, not new behaviour, so the
Red-Green-Refactor cycle is replaced by a before/after parity check (justified
here under `Decision Log` and the execplans guidance for cases where a focused
red test does not apply).

- Parity (stands in for Red/Green): the `diff` of `bunx oxlint .` output before
  and after the switch (Stage B) must be empty. This proves the shared plugin
  enforces the identical ruleset against the identical baseline.
- Tests: `make test` passes. The repository test suite (excluding the deleted
  plugin test) is green.
- Lint/typecheck: `make lint` and `make typecheck` pass.
- Build: `make build` succeeds.
- Frozen install: `bun install --frozen-lockfile` succeeds with the committed
  `bun.lock`, matching CI.

Acceptance, phrased as observable behaviour:

1. With `.oxlintrc.json` loading `df12-lints/oxlint-plugin`, running
   `bunx oxlint .` at the repository root completes with status 0 and no
   `df12/` diagnostics — identical to before the change.
2. Temporarily removing one entry from `.jsdoc-baseline.json` (for example
   `src/graphql/handler.ts#createHandler`) and re-running `bunx oxlint .`
   produces a `df12(require-public-jsdoc)` diagnostic for that function, proving
   the shared plugin still reads the baseline from the repository root. Restore
   the entry afterwards.
3. `tools/oxlint-plugin-df12/` no longer exists, and `make all` still passes.

Quality method: run the gate commands above locally; CI re-runs `make all` and
`make build` on the pull request.

## Idempotence and recovery

Stages A and B are non-destructive: the local plugin file remains until Stage C,
so reverting is a one-line change back to the relative `jsPlugins` path plus
`git checkout package.json bun.lock`. Stage C deletions are recoverable from git
history until the branch is squashed. Re-running any `make` target is safe and
benefits from Bun's build cache. If `bun install` leaves `bun.lock` in an
unexpected state, `git checkout bun.lock && bun install --frozen-lockfile`
restores it.

## Artifacts and notes

Discrepancies between the shared `df12-lints` plugin (at
`fe04adc80cfd8d3fc3df987f8022863a2f27a2a0`) and the in-repo fork, to be filed as
issues against `df12-lints`. The first group are packaging/deployment defects;
the second are behavioural differences that a consumer must understand.

Packaging and deployment issues:

1. The `.` export is unusable from a git install. `package.json` maps `"."` to
   `"./dist/index.js"`, but `dist/` is git-ignored and there is no `prepare`
   (or `postinstall`) script to build it on install. A consumer that imports
   `df12-lints` (the root) gets a missing-module error. Suggested fix: add a
   `prepare` script running `tsc`, or commit/ship `dist/`, or document that only
   the `./oxlint-plugin` subpath is consumable. (The `./oxlint-plugin` subpath
   itself is fine — it points at committed source.)
2. No `LICENSE` file despite `package.json` declaring `"license": "ISC"`. The
   repository root has no license text. Suggested fix: add an ISC `LICENSE`.
3. `"private": true` blocks `npm publish`, forcing consumers onto git
   dependencies with a commit pin. If the intent is to be reusable across df12
   projects, consider publishing to a registry (npm or GitHub Packages) and
   removing `private`. At minimum, document the git-dependency install recipe in
   the README.
4. No `files` whitelist in `package.json`. Git installs work (they copy all
   tracked files, so `tools/` is present), but a future `npm publish` would ship
   `tools/` and `tests/` unless `files` is set; conversely a too-narrow `files`
   could omit `tools/`. Worth making explicit before publishing.
5. The README's documented usage (`"jsPlugins": ["df12-lints/oxlint-plugin"]`)
   depends on Oxlint honouring package `exports` subpaths for a git-installed
   dependency. This should be tested and documented in the shared repo's CI so
   consumers can rely on it (this plan's Stage B validates it for our case).

Behavioural differences from the previous in-repo fork (consumers upgrading
from the old local copy should be aware):

1. Baseline caching was removed. The fork cached `.jsdoc-baseline.json` in a
   module-level `Set` (`baselineCache`) and `loadBaseline()` returned that
   `Set`. The shared version reads the baseline per rule invocation
   (`jsDocRuleState`) and `loadBaseline()` now returns a result object
   `{ baseline, ok, error }`. Any consumer test that imported
   `testInternals.loadBaseline` and expected a `Set` (as this repo's
   `tests/oxlint-plugin.test.js` did) will break. This is the reason the local
   test is deleted rather than re-pointed. Worth a CHANGELOG note upstream.
2. Working directory resolution changed from `process.cwd()` to
   `context.cwd ?? context.getCwd?.() ?? process.cwd()`. This is generally an
   improvement (more robust when Oxlint is invoked from a subdirectory), but it
   is a behavioural change in how baseline keys are resolved and should be
   called out. If Oxlint ever sets `context.cwd` to a non-root directory,
   baseline suppression could silently break (tracked here as Risk R2).
3. New diagnostic surface: a malformed `.jsdoc-baseline.json` (invalid JSON, or
   `entries` not an array) now emits an Oxlint diagnostic
   ("Could not load .jsdoc-baseline.json: …") via `reportBaselineError`, instead
   of being silently swallowed as in the fork. This is an improvement but is a
   visible behaviour change for anyone with a malformed baseline.
4. New option validation: `complex-conditional`'s `maxLogicalOperators` is now
   coerced by `configuredMaxLogicalOperators` — non-integer or non-positive
   values fall back to `1`, whereas the fork used the raw value. Configs relying
   on the old (unvalidated) handling could see different counts.
5. Source formatting diverged (the shared copy uses double quotes and trailing
   commas; the fork used single quotes and none). This is cosmetic and does not
   affect consumers loading the package, but it does mean a line-by-line diff
   of the two files is noisy; reviewers should compare behaviour, not text.

## Interfaces and dependencies

- New dependency: `df12-lints`, pinned at
  `github:leynos/df12-lints#fe04adc80cfd8d3fc3df987f8022863a2f27a2a0`, added to
  `devDependencies` in `package.json`. It is a dev dependency because the plugin
  is only needed at lint time, never at runtime or in the published artifact.
- Plugin entry point consumed: the package subpath export
  `df12-lints/oxlint-plugin`, resolving to
  `node_modules/df12-lints/tools/oxlint-plugin-df12/index.js`, which default-
  exports an Oxlint plugin object `{ meta: { name: "df12" }, rules: { ... } }`
  providing the rules `complex-conditional`, `require-module-jsdoc`,
  `require-private-jsdoc`, and `require-public-jsdoc`.
- Configuration contract unchanged in `.oxlintrc.json`: the `rules` block keeps
  `df12/complex-conditional` (with `maxLogicalOperators: 1`,
  `includeTernary: true`, `includeNullishCoalescing: false`) and the three
  `df12/require-*-jsdoc` rules at `error`.
- Files removed: `tools/oxlint-plugin-df12/index.js` and
  `tests/oxlint-plugin.test.js`.
- Files edited: `package.json`, `bun.lock`, `.oxlintrc.json`,
  `docs/development.md`, and (if needed) `docs/architecture.md`.
