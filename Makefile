.PHONY: all fmt check-fmt typecheck docs-check lint biomejs oxlint test \
	build clean generate markdownlint nixie spelling

# `make fmt` fixes Markdown in place, so the linter has to be a real
# executable rather than a `bunx` resolution that may reach the registry.
MDLINT ?= $(shell command -v markdownlint-cli2 2>/dev/null || printf '%s' "node_modules/.bin/markdownlint-cli2")
# `make fmt` and `make check-fmt` call mdtablefix directly. `--git` selects the
# Markdown files Git tracks and `--include-untracked` adds the untracked files
# Git does not ignore, so a new document is formatted before it is staged.
# Both modes need mdtablefix 0.6.0 or later; CI pins the version at the
# install-mdtablefix step.
MDTABLEFIX ?= mdtablefix
MDTABLEFIX_SELECT = --git --include-untracked
MDTABLEFIX_RULES = --wrap --renumber --breaks --ellipsis --fences
XARGS_R := $(shell if xargs --help 2>&1 | grep -q '\\-r'; then printf -- '-r'; fi)
UV ?= uv
UV_ENV = UV_CACHE_DIR=.uv-cache UV_TOOL_DIR=.uv-tools
TYPOS_CONFIG_BUILDER_VERSION ?= v0.1.3
TYPOS_CONFIG_BUILDER = $(UV_ENV) $(UV) tool run --python 3.14 --from \
	"git+https://github.com/leynos/typos-config-builder.git@$(TYPOS_CONFIG_BUILDER_VERSION)" \
	typos-config-builder

all: check-fmt typecheck docs-check lint test spelling

fmt:
	bun run fmt
	$(MDTABLEFIX) --in-place $(MDTABLEFIX_SELECT) $(MDTABLEFIX_RULES)
	@unset FORCE_COLOR; $(MDLINT) --fix "**/*.md"

check-fmt:
	bunx @biomejs/biome check --linter-enabled=false --assist-enabled=false .
	$(MDTABLEFIX) --check $(MDTABLEFIX_SELECT) $(MDTABLEFIX_RULES)

typecheck:
	bun run check:types

# Zero-tolerance documentation gate: TypeDoc's notDocumented and link
# validation over the package entry point (typedoc.json). Depends on
# typecheck, not merely ordered after it in `all`, so the generated GraphQL
# types exist even under `make -j` or a bare `make docs-check`. Emits no
# documentation artefacts.
docs-check: typecheck
	bun run docs:check

lint: biomejs oxlint

biomejs:
	bun run lint

oxlint:
	bunx oxlint .

test:
	bun run test

build:
	bun run build

clean:
	rm -rf dist src/__generated__/resolvers-types.ts

generate:
	bun run generate

markdownlint: spelling # Lint Markdown files and enforce spelling
	find . -type f -name '*.md' -not -path '*/target/*' -not -path '*/node_modules/*' -print0 | xargs -0 $(XARGS_R) $(MDLINT)

spelling: ## Enforce en-GB-oxendict spelling and shared phrase corrections
	$(TYPOS_CONFIG_BUILDER) gate --repository .

nixie:
	nixie --no-sandbox
