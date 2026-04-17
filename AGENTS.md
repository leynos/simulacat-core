# Assistant Instructions

## Code Style and Structure

- **Code is for humans.** Code is written with clarity and empathy,
  assuming that a tired teammate may need to debug it at 3 a.m.
- **Comment *why*, not *what*.** Comments explain assumptions, edge cases,
  trade-offs, or complexity. The obvious is not restated.
- **Clarity over cleverness.** Concision is valued, but explicit code is
  preferred over terse or obscure idioms. Code that is easy to follow is
  preferred.
- **Use functions and composition.** Repetition is avoided by extracting
  reusable logic. Generators or comprehensions, and declarative code over
  imperative repetition, are preferred when readability is preserved.
- **Small, meaningful functions.** Functions remain small, clear in purpose,
  single responsibility, and obedient to command/query segregation.
- **Clear commit messages.** Commit messages are descriptive, explaining what
  changed and why.
- **Name things precisely.** Variable and function names are clear and
  descriptive. Boolean names prefer `is`, `has`, or `should`.
- **Structure logically.** Each file encapsulates a coherent module. Related
  code (e.g., models + utilities + fixtures) stays close together.
- **Group by feature, not layer.** Views, logic, fixtures, and helpers related
  to a domain concept are colocated rather than split by type.
- **Use consistent spelling and grammar.** Comments use en-GB-oxendict
  ("-ize" / "-yse" / "-our") spelling and grammar, except references to
  external APIs.
- **Illustrate with clear examples.** Function documentation includes clear
  examples demonstrating usage and outcome. Test documentation omits examples
  when the example merely reiterates the test logic.
- **Keep file size manageable.** No single code file exceeds 400 lines. Long
  switch statements or dispatch tables are broken up by feature and
  constituents colocated with targets. Large blocks of test data move to
  external data files.

## Documentation Maintenance

- **Reference:** The Markdown files within the `docs/` directory act as the
  knowledge base and source of truth for project requirements, dependency
  choices, and architectural decisions.
- **Update:** When new decisions are made, requirements change, libraries are
  added or removed, or architectural patterns evolve, the relevant file(s) in
  `docs/` should be updated proactively to reflect the latest state.
  Documentation should remain accurate and current.
- Documentation must use en-GB-oxendict ("-ize" / "-yse" / "-our") spelling
  and grammar. (EXCEPTION: the naming of the "LICENSE" file, which is to be
  left unchanged for community consistency.)
- A documentation style guide lives in
  `docs/documentation-style-guide.md`.

## Tooling Defaults

- `bun` is used for JavaScript/TypeScript script invocations (including
  shebangs) unless there is a known reason not to. Any exception must be noted
  explicitly alongside the invocation or in this file.
- AVA does not run reliably under Bun (missing `node:v8` coverage hooks), so
  `test:unit` and the AVA bridge test intentionally invoke `node`.

## Change Quality & Committing

- **Atomicity:** Changes should be small, focused, and atomic. Each change (and
  subsequent commit) should represent a single logical unit of work.
- **Quality Gates:** Before a change is considered complete or proposed for
  commit, it should meet the following criteria:

  - New functionality or changes in behaviour are fully validated by relevant
    unittests and behavioural tests.
  - Where a bug is being fixed, a unittest has been provided demonstrating the
    behaviour being corrected, both to validate the fix and to guard against
    regression.
  - Passes all relevant unit and behavioural tests according to the guidelines
    above. (`bun test` verifies this.)
  - Passes lint checks. (`bun lint` verifies this.)
  - Adheres to formatting standards tested using a formatting validator. (Use
    `make check-fmt` to verify, or run the underlying `biome check`
    command directly. `bun fmt` is mutating and should be used to apply
    formatting fixes, not to verify them.)

- **Committing:**

  - Only changes that meet all the quality gates above should be committed.
  - Commit messages should be clear and descriptive, summarizing the change and
    following these formatting guidelines:

    - **Imperative Mood:** The subject line uses the imperative mood (e.g.,
      "Fix bug", "Add feature" instead of "Fixed bug", "Added feature").
    - **Subject Line:** The first line should be a concise summary of the change
      (ideally 50 characters or fewer).
    - **Body:** Separate the subject from the body with a blank line. Subsequent
      lines should explain the *what* and *why* of the change in more detail,
      including rationale, goals, and scope. Wrap the body at 72 characters.
    - **Formatting:** Markdown is used for any formatted text (like bullet
      points or code snippets) within the commit message body.

- Changes that fail any of the quality gates should not be committed.

## Refactoring Heuristics & Workflow

- **Recognizing Refactoring Needs:** The codebase should be assessed regularly
  for potential refactoring opportunities. Refactoring should be considered when
  observations indicate:
  - **Long Methods/Functions:** Functions or methods that are excessively long
    or try to do too many things.
  - **Duplicated Code:** Identical or very similar code blocks appearing in
    multiple places.
  - **Complex Conditionals:** Deeply nested or overly complex `if`/`else` or
    `switch` statements (high cyclomatic complexity).
  - **Large Code Blocks for Single Values:** Significant chunks of logic
    dedicated solely to calculating or deriving a single value.
  - **Primitive Obsession / Data Clumps:** Groups of simple variables
    (strings, numbers, booleans) that are frequently passed around together,
    often indicating a missing class or object structure.
  - **Excessive Parameters:** Functions or methods requiring a very long list
    of parameters.
  - **Feature Envy:** Methods that seem more interested in the data of another
    class/object than their own.
  - **Shotgun Surgery:** A single change requiring small modifications in many
    different classes or functions.
  - **Post-Commit Review:** After a functional change or bug fix is committed
    (and meets all quality gates), the changed code and surrounding areas
    should be reviewed using the heuristics above.
- **Separate Atomic Refactors:** If refactoring is deemed necessary:
  - Refactoring should be performed as a **separate, atomic commit** *after*
    the functional change commit.
  - The refactoring should adhere to the testing guidelines (behavioural tests
    pass before and after, unit tests added for new units).
  - The refactoring commit itself should pass all quality gates.

## Markdown Guidance

- Validate Markdown files using `bunx markdownlint-cli2 "**/*.md"`.
- Run `bun fmt` after any documentation changes to format all Markdown
  files and fix table markup.
- Validate Mermaid diagrams in Markdown files by running `nixie --no-sandbox`.
- Markdown paragraphs and bullet points must be wrapped at 80 columns.
- Code blocks must be wrapped at 120 columns.
- Tables and headings must not be wrapped.
- Use dashes (`-`) for list bullets.
- Use GitHub-flavoured Markdown footnotes (`[^1]`) for references and
  footnotes.

## TypeScript Guidance

This repository is implemented in TypeScript and should follow the same
clarity, strictness, and reproducibility goals used elsewhere in this guide.

### Toolchain & Project Shape

- **ESM-first with a documented CLI exception**: Source modules and the
  published library surface are expected to be ESM. This repository retains a
  CommonJS build artifact for the Node CLI because `bin/start.cjs` requires
  `../dist/index.cjs` so it can run under Node without transpilation. Treat
  that CommonJS output as a narrow operational exception, not as the default
  module model.
- **Bun as runner**: Bun is used for package scripts and ad hoc TypeScript
  tooling. Prefer `bun <script>` for package scripts and `bunx` for one-off
  CLIs.
- **Project scripts (Bun)**:
  - `fmt`: `bunx @biomejs/biome format --write .`
  - `lint`: `bunx @biomejs/biome lint .`
  - `check:types`: `bun run generate && bunx tsc --noEmit`
  - `test`: `bun test --max-concurrency=1 tests`

### Compiler Configuration

Use a sharp `tsconfig.json` and keep strictness enabled. The repository should
prefer settings such as:

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `useUnknownInCatchVariables: true`
- `noPropertyAccessFromIndexSignature: true`
- `verbatimModuleSyntax: true` with `import type` / `export type`

Place JSDoc comments above declarations and above decorators when decorators
are present.

### Code Style & Structure

- **Immutability first**: Prefer `const`, `readonly`, and returning new objects
  over mutating inputs.
- **Functions**: Extract meaningfully named helpers when a function grows long
  or takes on multiple responsibilities.
- **Parameters**: Group related parameters into typed objects rather than long
  positional lists.
- **Predicates**: When branching becomes complex, extract predicate helpers or
  lookup tables. Exhaustive `switch` logic should include a `never` guard.
- **Docs**: Every module begins with a `/** @file … */` block describing
  purpose, responsibilities, and usage.
- **Public APIs**: Export explicit entry points via `package.json`
  `exports`/`types`. Avoid wildcard re-exports that hide breaking changes.

### Runtime Validation & Types

- **Runtime schemas**: Validate I/O boundaries such as network responses,
  fixture payloads, and persisted data with `zod`.
- **Nominal branding**: Prefer branded types for identifiers or tokens when it
  prevents accidental mixing of otherwise identical primitives.
- **Time & randomness**: Centralize `now()` and `rng()` style adapters rather
  than calling `Date.now()` or `Math.random()` directly in business logic.

### Error Handling

- **Semantic errors**: Use discriminated unions for recoverable conditions that
  callers branch on.
- **Exceptions**: Reserve `Error` subclasses for exceptional paths and attach a
  `cause` where available.

### Testing

- **Runner**: Use `bun test` and keep tests deterministic.
- **Fixtures**: Prefer factories and builders over repeated ad hoc object
  literals.
- **Parameterized tests**: Drive variations with helpers or compact loops
  rather than duplicated cases.
- **Snapshots**: Keep snapshot inputs deterministic by fixing seeds and sorting
  unstable data.

### Dependency Management

- **Version policy**: Use caret requirements (`^x.y.z`) for direct
  dependencies unless a narrower range is justified explicitly.
- **Lockfile**: Commit `bun.lock`. Rebuild it deliberately when major tool
  upgrades require it.
- **Culling**: Prefer small, actively maintained packages and remove
  unmaintained dependencies quickly.

### Linting & Formatting

- **Biome**: Use Biome for formatting and linting through `bun fmt` and
  `bun lint`.
- **Type-checking**: Use `bun check:types` to surface TypeScript issues early.
- **Import hygiene**: Keep imports sorted and remove unused or extraneous
  dependencies.

## Additional tooling

The following tooling is available in this environment:

- `mbake` — A Makefile validator. Run using `mbake validate Makefile`.
- `strace` — Traces system calls and signals made by a process; useful for
  debugging runtime behaviour and syscalls.
- `gdb` — The GNU Debugger, for inspecting and controlling programs as they
  execute (or post-mortem via core dumps).
- `ripgrep` — Fast, recursive text search tool (`grep` alternative) that
  respects `.gitignore` files.
- `ltrace` — Traces calls to dynamic library functions made by a process.
- `valgrind` — Suite for detecting memory leaks, profiling, and debugging
  low-level memory errors.
- `bpftrace` — High-level tracing tool for eBPF, using a custom scripting
  language for kernel and application tracing.
- `lsof` — Lists open files and the processes using them.
- `htop` — Interactive process viewer (visual upgrade to `top`).
- `iotop` — Displays and monitors I/O usage by processes.
- `ncdu` — NCurses-based disk usage viewer for finding large files/folders.
- `tree` — Displays directory structure as a tree.
- `bat` — `cat` clone with syntax highlighting, Git integration, and paging.
- `delta` — Syntax-highlighted pager for Git and diff output.
- `tcpdump` — Captures and analyses network traffic at the packet level.
- `nmap` — Network scanner for host discovery, port scanning, and service
  identification.
- `lldb` — LLVM debugger, alternative to `gdb`.
- `eza` — Modern `ls` replacement with more features and better defaults.
- `fzf` — Interactive fuzzy finder for selecting files, commands, etc.
- `hyperfine` — Command-line benchmarking tool with statistical output.
- `shellcheck` — Linter for shell scripts, identifying errors and bad practices.
- `fd` — Fast, user-friendly `find` alternative with sensible defaults.
- `checkmake` — Linter for `Makefile`s, ensuring they follow best practices and
  conventions.
- `difft` **(Difftastic)** — Semantic diff tool that compares code structure
  rather than just text differences.

## Key Takeaway

These practices help maintain a high-quality codebase and facilitate
collaboration.
