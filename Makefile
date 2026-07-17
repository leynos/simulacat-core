.PHONY: all fmt check-fmt typecheck docs-check lint biomejs oxlint test build clean generate markdownlint nixie spelling spelling-config spelling-phrase-check spelling-helper-test

MDLINT ?= bunx --package markdownlint-cli2@0.23.0 markdownlint-cli2
XARGS_R := $(shell if xargs --help 2>&1 | grep -q '\\-r'; then printf -- '-r'; fi)
UV ?= uv
UV_ENV = UV_CACHE_DIR=.uv-cache UV_TOOL_DIR=.uv-tools
RUFF_VERSION ?= 0.15.12
PATHSPEC_VERSION ?= 1.1.1
TYPOS_VERSION ?= 1.48.0
TYPOS_CONFIG_BUILDER_COMMIT := d6da92f02240a79a945c835f69bdd08a888da1d0
TYPOS_CONFIG_BUILDER_SOURCE := git+https://github.com/leynos/typos-config-builder.git@$(TYPOS_CONFIG_BUILDER_COMMIT)
TYPOS_CONFIG_BUILDER := $(UV_ENV) $(UV) tool run --python 3.14 \
	--from "$(TYPOS_CONFIG_BUILDER_SOURCE)" typos-config-builder
SPELLING_PY_SRCS := \
	scripts/typos_rollout_check.py scripts/tests/test_typos_rollout_check.py
SPELLING_PY_TESTS := scripts/tests/test_typos_rollout_check.py
SPELLING_COVERAGE_ARGS := --cov=typos_rollout_check --cov-fail-under=90
SPELLING_HELPER_PYTEST = PYTHONPATH=scripts $(UV_ENV) $(UV) run --no-project \
	--python 3.14 --with pathspec==$(PATHSPEC_VERSION) --with pytest==9.0.2 \
	--with pytest-cov==7.0.0 python -m pytest

all: check-fmt typecheck docs-check lint test spelling

fmt:
	bun run fmt
	mdformat-all

check-fmt:
	bunx @biomejs/biome check --linter-enabled=false --assist-enabled=false .

typecheck:
	bun run check:types

# Zero-tolerance documentation gate: TypeDoc's notDocumented validation over
# the package entry point (typedoc.json). Runs after typecheck so the
# generated GraphQL types already exist. Emits no documentation artefacts.
docs-check:
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

spelling: spelling-phrase-check # Enforce en-GB-oxendict spelling in tracked Markdown prose
	@git ls-files -z '*.md' | \
		xargs -0 $(XARGS_R) env $(UV_ENV) $(UV) tool run typos@$(TYPOS_VERSION) \
		--config typos.toml --force-exclude

spelling-phrase-check: spelling-config # Reject prohibited spelling phrases
	@PYTHONPATH=scripts $(UV_ENV) $(UV) run --no-project --python 3.14 scripts/typos_rollout_check.py --repository .

spelling-config: spelling-helper-test # Generate and verify the spelling configuration
	@git ls-files --error-unmatch typos.toml >/dev/null
	@$(TYPOS_CONFIG_BUILDER) --repository . --check

spelling-helper-test: # Validate the shared spelling-policy integration
	@$(UV_ENV) $(UV) tool run ruff@$(RUFF_VERSION) format --isolated --target-version py313 --check $(SPELLING_PY_SRCS)
	@$(UV_ENV) $(UV) tool run ruff@$(RUFF_VERSION) check --isolated --target-version py313 $(SPELLING_PY_SRCS)
	@$(SPELLING_HELPER_PYTEST) $(SPELLING_PY_TESTS) -c /dev/null --rootdir=. -p no:cacheprovider $(SPELLING_COVERAGE_ARGS)

nixie:
	nixie --no-sandbox
