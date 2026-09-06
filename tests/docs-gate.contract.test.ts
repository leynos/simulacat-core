/**
 * @file Contract tests for the zero-tolerance TypeDoc documentation gate.
 *
 * These tests assert the mechanism, not the prose around it: that CI actually
 * invokes the gate, that `make all` actually depends on it, that `docs-check`
 * actually runs TypeDoc, and that TypeDoc is actually configured to fail on an
 * undocumented declaration. Each link in that chain can be deleted
 * independently, and deleting any one of them must turn a test red.
 */
import {describe, expect, it} from 'bun:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/** Reads a repository-relative file as UTF-8 text. */
const readRepositoryFile = (relativePath: string): string => {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8');
};

/** A parsed GitHub Actions step, narrowed to the fields the contract reads. */
type WorkflowStep = {
  run?: unknown;
  if?: unknown;
  'continue-on-error'?: unknown;
};

/** A parsed GitHub Actions job, narrowed to the fields the contract reads. */
type WorkflowJob = {
  steps?: WorkflowStep[];
  if?: unknown;
  'continue-on-error'?: unknown;
};

/** The CI workflow, narrowed to the fields the contract reads. */
type Workflow = {jobs?: {verify?: WorkflowJob}};

const workflow = Bun.YAML.parse(readRepositoryFile('.github/workflows/ci.yml')) as Workflow;
const makefile = readRepositoryFile('Makefile');
const packageManifest = JSON.parse(readRepositoryFile('package.json')) as {
  scripts?: Record<string, string>;
  devDependencies?: {typedoc?: string};
};
const typedocOptions = JSON.parse(readRepositoryFile('typedoc.json')) as {
  emit?: unknown;
  entryPoints?: unknown;
  treatValidationWarningsAsErrors?: unknown;
  validation?: {notDocumented?: unknown; invalidLink?: unknown; invalidPath?: unknown};
};

/** Splits a shell command into whitespace-separated tokens. */
const tokenize = (command: string): string[] => command.split(/\s+/u).filter((token) => token.length > 0);

// The comparison is by exact token so that a step running `make all-docs`, or
// one that only mentions `make all` inside a comment, never satisfies the
// contract.
/** Reports whether a `run:` script invokes `make` with the given target. */
const invokesMakeTarget = (script: string, target: string): boolean => {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .some((line) => {
      const tokens = tokenize(line);
      const makeIndex = tokens.indexOf('make');
      return makeIndex >= 0 && tokens.slice(makeIndex + 1).includes(target);
    });
};

/** Returns the prerequisites declared for a Makefile target. */
const makefilePrerequisites = (target: string): string[] => {
  const match = new RegExp(`^${target}:([^\\n=]*)$`, 'mu').exec(makefile);
  expect(match, `Makefile has no \`${target}\` target`).not.toBeNull();
  return tokenize((match?.[1] ?? '').split('#')[0] ?? '');
};

/** Returns the recipe lines declared for a Makefile target. */
const makefileRecipe = (target: string): string[] => {
  const match = new RegExp(`^${target}:[^\\n]*\\n((?:\\t[^\\n]*\\n)+)`, 'mu').exec(makefile);
  expect(match, `Makefile target \`${target}\` has no recipe`).not.toBeNull();
  return (match?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

describe('CI runs the documentation gate', () => {
  const verify = workflow.jobs?.verify;

  it('has a verify job', () => {
    expect(verify).toBeDefined();
  });

  it('runs `make all`, which is what reaches the gate', () => {
    const gateSteps = (verify?.steps ?? []).filter(
      (step) => typeof step.run === 'string' && invokesMakeTarget(step.run, 'all')
    );

    expect(gateSteps).toHaveLength(1);
  });

  it('runs the gate unconditionally and fails the job on it', () => {
    const gateStep = (verify?.steps ?? []).find(
      (step) => typeof step.run === 'string' && invokesMakeTarget(step.run, 'all')
    );

    expect(gateStep?.if).toBeUndefined();
    expect(gateStep?.['continue-on-error']).toBeUndefined();
    expect(verify?.if).toBeUndefined();
    expect(verify?.['continue-on-error']).toBeUndefined();
  });
});

describe('`make all` reaches the documentation gate', () => {
  it('lists `docs-check` among its prerequisites', () => {
    expect(makefilePrerequisites('all')).toContain('docs-check');
  });

  it('orders `docs-check` after `typecheck` so generated types exist', () => {
    const prerequisites = makefilePrerequisites('all');

    expect(prerequisites.indexOf('docs-check')).toBeGreaterThan(prerequisites.indexOf('typecheck'));
  });

  it('runs the gate command from the `docs-check` recipe', () => {
    expect(makefileRecipe('docs-check')).toContain('bun run docs:check');
  });
});

describe('the `docs:check` script runs TypeDoc against the pinned configuration', () => {
  it('invokes typedoc with typedoc.json', () => {
    const script = packageManifest.scripts?.['docs:check'] ?? '';
    const tokens = tokenize(script);

    expect(tokens[0]).toBe('typedoc');
    expect(tokens).toContain('--options');
    expect(tokens[tokens.indexOf('--options') + 1]).toBe('typedoc.json');
  });

  it('declares typedoc as a development dependency', () => {
    expect(packageManifest.devDependencies?.typedoc).toBeDefined();
  });
});

describe('TypeDoc is configured as a zero-tolerance gate', () => {
  it('validates that every declaration is documented', () => {
    expect(typedocOptions.validation?.notDocumented).toBe(true);
  });

  it('validates that every reference resolves', () => {
    expect(typedocOptions.validation?.invalidLink).toBe(true);
    expect(typedocOptions.validation?.invalidPath).toBe(true);
  });

  it('treats validation warnings as errors', () => {
    expect(typedocOptions.treatValidationWarningsAsErrors).toBe(true);
  });

  it('emits no documentation artefacts', () => {
    expect(typedocOptions.emit).toBe('none');
  });

  it('covers the package entry point', () => {
    expect(typedocOptions.entryPoints).toEqual(['src/index.ts']);
  });
});
