.PHONY: all check-fmt typecheck lint biomejs oxlint test build clean generate markdownlint nixie

MDLINT ?= markdownlint-cli2
XARGS_R := $(shell if xargs --help 2>&1 | grep -q '\\-r'; then printf -- '-r'; fi)

all: check-fmt typecheck lint test

check-fmt:
	bunx @biomejs/biome check --linter-enabled=false --assist-enabled=false .

typecheck:
	bun run check:types

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

markdownlint: # Lint Markdown files
	find . -type f -name '*.md' -not -path '*/target/*' -not -path '*/node_modules/*' -print0 | xargs -0 $(XARGS_R) $(MDLINT)

nixie:
	nixie --no-sandbox
