# Assistant Instructions

## Code Style and Structure

- **Code is for humans.** Write your code with clarity and empathy—assume a
  tired teammate will need to debug it at 3 a.m.
- **Comment *why*, not *what*.** Explain assumptions, edge cases, trade-offs, or
  complexity. Don't echo the obvious.
- **Clarity over cleverness.** Be concise, but favour explicit over terse or
  obscure idioms. Prefer code that's easy to follow.
- **Use functions and composition.** Avoid repetition by extracting reusable
  logic. Prefer generators or comprehensions, and declarative code to
  imperative repetition when readable.
- **Small, meaningful functions.** Functions must be small, clear in purpose,
  single responsibility, and obey command/query segregation.
- **Clear commit messages.** Commit messages should be descriptive, explaining
  what was changed and why.
- **Name things precisely.** Use clear, descriptive variable and function names.
  For booleans, prefer names with `is`, `has`, or `should`.
- **Structure logically.** Each file should encapsulate a coherent module. Group
  related code (e.g., models + utilities + fixtures) close together.
- **Group by feature, not layer.** Colocate views, logic, fixtures, and helpers
  related to a domain concept rather than splitting by type.
- **Use consistent spelling and grammar.** Comments must use en-GB-oxendict
  ("-ize" / "-yse" / "-our") spelling and grammar, with the exception of
  references to external APIs.
- **Illustrate with clear examples.** Function documentation must include clear
  examples demonstrating the usage and outcome of the function. Test
  documentation should omit examples where the example serves only to reiterate
  the test logic.
- **Keep file size manageable.** No single code file may be longer than 400
  lines. Long switch statements or dispatch tables should be broken up by
  feature and constituents colocated with targets. Large blocks of test data
  should be moved to external data files.

## Documentation Maintenance

- **Reference:** Use the markdown files within the `docs/` directory as a
  knowledge base and source of truth for project requirements, dependency
  choices, and architectural decisions.
- **Update:** When new decisions are made, requirements change, libraries are
  added/removed, or architectural patterns evolve, **proactively update** the
  relevant file(s) in the `docs/` directory to reflect the latest state.
  **Ensure the documentation remains accurate and current.**
- Documentation must use en-GB-oxendict ("-ize" / "-yse" / "-our") spelling
  and grammar. (EXCEPTION: the naming of the "LICENSE" file, which is to be
  left unchanged for community consistency.)
- A documentation style guide lives in
  `docs/documentation-style-guide.md`.

## Tooling Defaults

- Use `bun` for JavaScript/TypeScript script invocations (including shebangs)
  unless there is a known reason not to. Any exception must be explicitly
  noted alongside the invocation or in this file.
- AVA does not run reliably under Bun (missing `node:v8` coverage hooks), so
  `test:unit` and the AVA bridge test intentionally invoke `node`.

## Change Quality & Committing

- **Atomicity:** Aim for small, focused, atomic changes. Each change (and
  subsequent commit) should represent a single logical unit of work.
- **Quality Gates:** Before considering a change complete or proposing a commit,
  ensure it meets the following criteria:

  - New functionality or changes in behaviour are fully validated by relevant
    unittests and behavioural tests.
  - Where a bug is being fixed, a unittest has been provided demonstrating the
    behaviour being corrected both to validate the fix and to guard against
    regression.
  - Passes all relevant unit and behavioural tests according to the guidelines
    above. (Use `bun test` to verify).
  - Passes lint checks. (Use `bun lint` to verify).
  - Adheres to formatting standards tested using a formatting validator. (Use
    `bun fmt` to verify).

- **Committing:**

  - Only changes that meet all the quality gates above should be committed.
  - Write clear, descriptive commit messages summarizing the change, following
    these formatting guidelines:

    - **Imperative Mood:** Use the imperative mood in the subject line (e.g.,
      "Fix bug", "Add feature" instead of "Fixed bug", "Added feature").
    - **Subject Line:** The first line should be a concise summary of the change
      (ideally 50 characters or fewer).
    - **Body:** Separate the subject from the body with a blank line. Subsequent
      lines should explain the *what* and *why* of the change in more detail,
      including rationale, goals, and scope. Wrap the body at 72 characters.
    - **Formatting:** Use Markdown for any formatted text (like bullet points or
      code snippets) within the commit message body.

- Do not commit changes that fail any of the quality gates.

## Refactoring Heuristics & Workflow

- **Recognizing Refactoring Needs:** Regularly assess the codebase for potential
  refactoring opportunities. Consider refactoring when observations indicate:
- **Long Methods/Functions:** Functions or methods that are excessively long
    or try to do too many things.
- **Duplicated Code:** Identical or very similar code blocks appearing in
    multiple places.
- **Complex Conditionals:** Deeply nested or overly complex `if`/`else` or
    `switch` statements (high cyclomatic complexity).
- **Large Code Blocks for Single Values:** Significant chunks of logic
    dedicated solely to calculating or deriving a single value.
- **Primitive Obsession / Data Clumps:** Groups of simple variables (strings,
    numbers, booleans) that are frequently passed around together, often
    indicating a missing class or object structure.
- **Excessive Parameters:** Functions or methods requiring a very long list of
    parameters.
- **Feature Envy:** Methods that seem more interested in the data of another
    class/object than their own.
- **Shotgun Surgery:** A single change requiring small modifications in many
    different classes or functions.
- **Post-Commit Review:** After committing a functional change or bug fix (that
  meets all quality gates), review the changed code and surrounding areas using
  the heuristics above.
- **Separate Atomic Refactors:** If refactoring is deemed necessary:
- Perform the refactoring as a **separate, atomic commit** *after* the
    functional change commit.
- Ensure the refactoring adheres to the testing guidelines (behavioural tests
    pass before and after, unit tests added for new units).
- Ensure the refactoring commit itself passes all quality gates.

## Markdown Guidance

- Validate Markdown files using `bunx markdownlint-cli2 \"docs/**/*.md\"`.
- Run `bun fmt` after any documentation changes to format all Markdown
  files and fix table markup.
- Validate Mermaid diagrams in Markdown files by running `nixie --no-sandbox`.
- Markdown paragraphs and bullet points must be wrapped at 80 columns.
- Code blocks must be wrapped at 120 columns.
- Tables and headings must not be wrapped.
- Use dashes (`-`) for list bullets.
- Use GitHub-flavoured Markdown footnotes (`[^1]`) for references and
  footnotes.

## TypeScript Frontend Guidance (Client‑Side Only)

**Stack**: Bun · Biome · Vite (esbuild under the hood for dev) · React ·
Tailwind CSS v4 · daisyUI v5 · TanStack (Query/Router/Table).

This document mirrors the intent of the Rust guidance—strictness, clarity, and
predictable builds—translated into idiomatic, modern TypeScript and a
browser‑only runtime.

### Toolchain & Project Shape

- **ESM‑only**: Source and build outputs are ES Modules. No CommonJS. Configure
  Vite accordingly; package publishes only ESM (for libraries) or static assets
  (for apps).
- **Runtime targets**: Target modern evergreen browsers. Use `browserslist` to
  define the support matrix; drop legacy where feasible. Prefer native Web APIs
  (Fetch, URL, AbortController, Streams).
- **Bun as runner**: Use Bun for scripts and dev server invocations. Prefer
  `bun <script>` for package scripts and `bunx` for one‑off CLIs.
- **Workspaces (optional)**: If a monorepo, use `pnpm` or Bun workspaces with
  clear package boundaries and TS project references.
- **Vite**: Default bundler for dev/build. Enable code‑splitting, prefetch
  hints, and asset hashing. Esbuild handles TS/JS transforms in dev; production
  uses Rollup via Vite.
- **Project scripts (Bun)**:
  - `fmt`: `bunx biome format --write .`
  - `lint`: `bunx biome ci .`
  - `check:types`: `bunx tsgo --project tsconfig.typecheck.json`
  - `dev`: `vite`
  - `build`: `vite build`
  - `preview`: `vite preview`
  - `tokens:build`: `node tokens/build/style-dictionary.js`
  - `test`: `bun test --preload ./tests/setup-happy-dom.ts`
  - `test:e2e`: `playwright test`

  Prefer Bun's direct shortcuts: `bun fmt`, `bun lint`, `bun check:types`,
  `bun test`, and `bun test:e2e`. Bun accepts `bun run <name>` too, but the
  terse form is faster to type. `lint` covers Biome checks, whilst
  `check:types` keeps TypeScript errors visible. The `test` script uses Bun's
  built-in runner, preloading the Happy DOM shim so component tests can render
  without a browser.

  Call Biome or other CLIs through `bunx` when ad hoc execution makes sense:

  ```bash
  bun x biome format --write
  bun x biome ci frontend-pwa packages/tokens/src packages/tokens/build packages/types/src
  ```

### Compiler Configuration (Make It Sharp)

Use a strict `tsconfig.json` suitable for browser builds:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `useUnknownInCatchVariables: true`
- `noPropertyAccessFromIndexSignature: true`
- `verbatimModuleSyntax: true` (and use `import type` / `export type`)
- `moduleResolution: "bundler"` (lets Vite resolve modern packages)
- `lib`: include only what you need (e.g., `dom`, `dom.iterable`, `es2022`)
- Do not emit from `tsgo` in app packages (`noEmit: true`); Vite handles
  emission.

**Order**: Place JSDoc comments above declarations and above any decorators.
Keep docs close to code.

### Code Style & Structure

- **Immutability first**: Prefer `const`, `readonly`, and `Readonly<T>`; avoid
  mutating props or inputs.
- **Functions**: Extract meaningfully named helpers when a function grows long.
  Keep trivial functions on one line when readability allows:

  ```ts
  export const mkId = (n: number): Id => new Id(n);
  ```

- **Parameters**: Group related parameters into typed objects or builders;
  avoid long positional lists.
- **Predicates**: When `if/else` grows beyond two branches, extract a predicate
  function or use a lookup table. Ensure exhaustive `switch` with a `never`
  guard helper.
- **Docs**: Every module begins with a `/** @file … */` block describing
  purpose, responsibilities, and usage.
- **Public APIs (for libs)**: Export explicit entry points via `package.json`
  `exports`/`types`. Avoid wildcard re‑exports that mask breaking changes.

### Runtime Validation & Types

- **Runtime schemas**: Validate I/O boundaries (network responses, localStorage
  payloads, URL params) with `zod`/`valibot`. Generate TS types from schemas or
  derive schemas from types, but add a CI check to keep them in sync.
- **Nominal branding**: Use branded types for IDs/tokens to avoid accidental
    mixing:

    ```ts
    type UserId = string & { readonly brand: "UserId" };
    ```

- **Cancellation**: Accept `AbortSignal` for any async that can hang (fetches,
  long UI work). Wire signals through TanStack Query via `signal` in fetchers.
- **Time & RNG**: Centralize `now()` and `rng()` adapters; never call
  `Date.now()` or `Math.random()` directly in business logic.

### Error Handling (Frontend)

- **Semantic errors**: Use discriminated unions for recoverable conditions
  callers might branch on (e.g.,
  `{ type: "rate_limited"; retryAfterMs: number }`).
- **Exceptions**: Reserve `Error` subclasses for exceptional paths
  (framework/edge). Always attach a `cause` where available.
- **App boundary**: Map domain errors to user‑facing messages in UI components
  only. Never leak raw stack traces to the DOM or logs shipped to analytics.

### Testing (Unit, Behavioural, and UI)

- **Runner**: Use `bun test` with the Happy DOM preload so component suites stay
  deterministic and parallel‑safe.
- **Fixtures**: Use factories/builders for component props and server
  responses. Avoid ad hoc object literals in tests.
- **Parameterized tests**: Drive variations with helper builders or tight loops
  rather than copy‑pasting cases.
- **Mocking**: Prefer dependency injection; if you must stub modules, lean on
  the `mock` helpers provided by `bun:test`.
- **Fake timers**: Encapsulate clocks behind adapters; fall back to
  `mock.timers` from `bun:test` only when necessary.
- **Snapshots**: Keep deterministic by sorting keys and fixing seeds. Limit
  snapshot scope to stable UI fragments.

### Dependency Management (Frontend)

- **Version policy**: Use caret requirements (`^x.y.z`) for all direct
  dependencies. Avoid `*`, `>=` or tag aliases like `latest`. Use tilde
  (`~x.y.z`) only with a documented justification.
- **Lockfile**: Commit `bun.lock`. Recreate on major tool upgrades; keep
  `bun.lockb` ignored.
- **Audit**: Run `bun x pnpm@latest audit` locally and in automation. Track
  exceptions with explicit expiry dates.
- **Culling**: Prefer small, actively maintained packages. Remove unmaintained
  or risky dependencies swiftly.

### Linting & Formatting

- **Biome**: One tool for format + lint. Configure with strict rules: disallow
  `any`, no non‑null `!`, forbid `@ts-ignore` in favour of `@ts-expect-error`
  (with a reason).
  - In this repo: use `bun fmt`, `bun lint`, and `bun check:types`.
  - Biome respects `.biomeignore` and VCS ignore files; large build trees like
    any `target/` directory are excluded.
- **Type‑checking**: Run `bun check:types` to surface TypeScript issues
  early.
- **Import hygiene**: Enforce sorted, grouped imports; no unused or extraneous
  dependencies.

### Internationalization

- **Setup**: Initialize `react-i18next` with `i18next-http-backend` and
  `i18next-browser-languagedetector`; set `fallbackLng: 'en'`.
- **Translations**: Store locale files under `public/locales/<lang>/<ns>.json`
  and load strings by namespace.
- **Hooks**: Call `useTranslation` within logic hooks and pass all translated
  strings to view components via props.

### Observability (Frontend)

- **Structured logs**: Gate debug logs behind a flag (`?debug=1` or build‑time
  define). Use a small logger that emits structured objects in dev and terse
  strings in prod.
- **Metrics**: Basic RUM—navigation timings, error counts, and SPA route
  transitions. Sample aggressively to preserve privacy and cost.
- **Feature flags**: Centralize flags; keep a kill‑switch for risky features;
  document fallback behaviour.

### Documentation & Examples

- **Literate examples**: Keep small TS snippets in docs that compile during
  builds (typecheck only). Prefer examples that mirror production patterns
  (schema‑validated fetchers, `AbortSignal`, TanStack Query hooks).
- **Module headers**: Each file begins with `/** @file … */` stating purpose,
  invariants, and cross‑links to related modules.
- **Error semantics**: Document user‑visible failure modes next to components
  and hooks that surface them.

### Release Discipline

- **Conventional Commits + Changesets** for versioning (libraries) and change
  logs.
- **SemVer**: Honour breaking changes with a major bump; avoid sneaking them in
  via dependency updates.
- **Reproducibility**: Pin tool versions via `.tool-versions`/`.bun-version`
  (or document required Bun/Node versions). Rebuild the lockfile on major
  upgrades.
- **Bundle sanity**: Maintain a bundle size budget; track regressions; document
  acceptable variances when adding large features.

### Quick Checklist (Before Commit)

- `bun fmt`, `bun lint`, `bun check:types`, `bun test` all clean; no Biome
  warnings; no TypeScript errors; coverage thresholds hold.
- No `any`, no `@ts-ignore`; use `@ts-expect-error` only with a reason.
- All async APIs accept `AbortSignal` where relevant; all fetchers validated
  against runtime schemas.
- Module headers present; public exports documented; design tokens consistent
  across Tailwind/daisyUI.

## Additional tooling

The following tooling is available in this environment:

- `mbake` – A Makefile validator. Run using `mbake validate Makefile`.
- `strace` – Traces system calls and signals made by a process; useful for
  debugging runtime behaviour and syscalls.
- `gdb` – The GNU Debugger, for inspecting and controlling programs as they
  execute (or post-mortem via core dumps).
- `ripgrep` – Fast, recursive text search tool (`grep` alternative) that
  respects `.gitignore` files.
- `ltrace` – Traces calls to dynamic library functions made by a process.
- `valgrind` – Suite for detecting memory leaks, profiling, and debugging
  low-level memory errors.
- `bpftrace` – High-level tracing tool for eBPF, using a custom scripting
  language for kernel and application tracing.
- `lsof` – Lists open files and the processes using them.
- `htop` – Interactive process viewer (visual upgrade to `top`).
- `iotop` – Displays and monitors I/O usage by processes.
- `ncdu` – NCurses-based disk usage viewer for finding large files/folders.
- `tree` – Displays directory structure as a tree.
- `bat` – `cat` clone with syntax highlighting, Git integration, and paging.
- `delta` – Syntax-highlighted pager for Git and diff output.
- `tcpdump` – Captures and analyses network traffic at the packet level.
- `nmap` – Network scanner for host discovery, port scanning, and service
  identification.
- `lldb` – LLVM debugger, alternative to `gdb`.
- `eza` – Modern `ls` replacement with more features and better defaults.
- `fzf` – Interactive fuzzy finder for selecting files, commands, etc.
- `hyperfine` – Command-line benchmarking tool with statistical output.
- `shellcheck` – Linter for shell scripts, identifying errors and bad practices.
- `fd` – Fast, user-friendly `find` alternative with sensible defaults.
- `checkmake` – Linter for `Makefile`s, ensuring they follow best practices and
  conventions.
- `difft` **(Difftastic)** – Semantic diff tool that compares code structure
  rather than just text differences.

## Key Takeaway

These practices help maintain a high-quality codebase and facilitate
collaboration.
