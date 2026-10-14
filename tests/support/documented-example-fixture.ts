/** @file Prepares a consumer project for executing published guide examples. */
import {mkdtemp, mkdir, realpath, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {
  runDocumentedCommand,
  startDocumentedServer,
  type CommandResult,
  type RunningDocumentedServer
} from './documented-examples-process.ts';
import type {DocumentedExample} from './documented-examples.ts';
import {rethrowAfterCleanup} from './documented-example-failures.ts';
import {assertFixtureCacheOutsideCheckout} from './documented-example-fixture-location.ts';

const CHECKOUT_PATH = resolve(import.meta.dir, '../..');
const FIXTURE_CACHE_DIRECTORY = 'simulacat-core-documentation-examples';
const BUILD_TIMEOUT_MS = 180_000;
const COMMAND_TIMEOUT_MS = 60_000;

/** Paths for the temporary consumer project created by the fixture. */
interface ConsumerProject {
  directory: string;
  consumerPath: string;
}

/** Paths and environment shared while one set of guide examples executes. */
export interface ExampleFixture {
  checkoutPath: string;
  consumerPath: string;
  directory: string;
  environment: NodeJS.ProcessEnv;
}

/** Generated program path paired with its stable diagnostic example ID. */
export interface ExampleProgramRun {
  path: string;
  exampleId: string;
}

/**
 * Creates an empty Bun consumer under the home cache outside the checkout.
 *
 * @returns Fixture paths and the environment used by documented commands.
 * @throws Error when the isolated consumer directory cannot be prepared.
 */
export const createExampleFixture = async (): Promise<ExampleFixture> => {
  const checkoutPath = await realpath(CHECKOUT_PATH);
  const cacheParent = await createFixtureCacheParent(checkoutPath);
  const {directory, consumerPath} = await createConsumerProject(cacheParent);

  return {
    checkoutPath,
    consumerPath,
    directory,
    environment: {
      ...process.env,
      SIMULACAT_CORE_CHECKOUT: checkoutPath,
      SIMULACAT_CORE_CONSUMER: consumerPath
    }
  };
};

/** Resolves and validates the dedicated cache parent outside the checkout. */
const createFixtureCacheParent = async (checkoutPath: string): Promise<string> => {
  const homePath = await realpath(homedir());
  const requestedCachePath = join(homePath, '.cache');
  assertFixtureCacheOutsideCheckout(checkoutPath, requestedCachePath);
  await mkdir(requestedCachePath, {recursive: true});

  const cachePath = await realpath(requestedCachePath);
  assertFixtureCacheOutsideCheckout(checkoutPath, cachePath);
  const requestedFixtureParent = join(cachePath, FIXTURE_CACHE_DIRECTORY);
  assertFixtureCacheOutsideCheckout(checkoutPath, requestedFixtureParent);
  await mkdir(requestedFixtureParent, {recursive: true});

  const fixtureParent = await realpath(requestedFixtureParent);
  assertFixtureCacheOutsideCheckout(checkoutPath, fixtureParent);
  return fixtureParent;
};

/** Creates the empty consumer and removes its owned directory after failure. */
const createConsumerProject = async (cacheParent: string): Promise<ConsumerProject> => {
  const directory = await mkdtemp(join(cacheParent, 'documented-examples-'));
  const consumerPath = join(directory, 'consumer');

  try {
    await mkdir(consumerPath);
    await writeFile(
      join(consumerPath, 'package.json'),
      `${JSON.stringify({name: 'documented-example-consumer', private: true, type: 'module'}, null, 2)}\n`
    );
  } catch (error) {
    await rethrowAfterCleanup(error, async () => {
      await rm(directory, {recursive: true, force: true});
    });
  }

  return {directory, consumerPath};
};

/**
 * Removes the temporary consumer directory owned by this fixture.
 *
 * @param fixture Fixture directory to remove.
 */
export const removeExampleFixture = async (fixture: ExampleFixture): Promise<void> => {
  await rm(fixture.directory, {recursive: true, force: true});
};

/**
 * Writes extracted TypeScript source unchanged and may append assertions.
 *
 * @param fixture Consumer fixture receiving the generated program.
 * @param example Marked document fence to write.
 * @param fileName Name assigned to the generated program.
 * @param footer Optional assertions appended after the original body.
 * @returns Absolute path to the generated source file.
 */
export const writeExampleProgram = async (
  fixture: ExampleFixture,
  example: DocumentedExample,
  fileName: string,
  footer = ''
): Promise<string> => {
  const path = join(fixture.consumerPath, fileName);
  const source = footer ? `${example.body}\n${footer}` : example.body;
  await writeFile(path, source);
  return path;
};

/**
 * Runs the published shell fence in its stated working directory.
 *
 * @param fixture Consumer fixture used for environment variables.
 * @param example Extracted shell fence to execute verbatim.
 * @param environment Additional environment values for this command.
 * @returns Captured standard output and error.
 * @throws Error when the command fails or exceeds its bounded runtime.
 */
export const runShellExample = async (
  fixture: ExampleFixture,
  example: DocumentedExample,
  environment: NodeJS.ProcessEnv = {}
): Promise<CommandResult> => {
  return await runDocumentedCommand({
    command: 'bash',
    args: ['--noprofile', '--norc', '-c', `set -euo pipefail\n${example.body}`],
    cwd: fixture.consumerPath,
    env: {...fixture.environment, ...environment},
    label: example.id,
    timeoutMs: timeoutForExample(example)
  });
};

/**
 * Runs one generated TypeScript program with the installed local Bun runtime.
 *
 * @param fixture Consumer fixture used for package resolution.
 * @param program Source path and stable identifier included in command failures.
 * @returns Captured standard output and error.
 * @throws Error when Bun reports a failure or exceeds its bounded runtime.
 */
export const runTypeScriptExample = async (
  fixture: ExampleFixture,
  program: ExampleProgramRun
): Promise<CommandResult> => {
  return await runDocumentedCommand({
    command: process.execPath,
    args: [program.path],
    cwd: fixture.consumerPath,
    env: fixture.environment,
    label: program.exampleId,
    timeoutMs: COMMAND_TIMEOUT_MS
  });
};

/**
 * Type-checks generated guide programs against the installed package types.
 *
 * @param fixture Consumer fixture containing the installed package.
 * @param programPaths Generated TypeScript sources to check.
 * @returns Captured compiler output.
 * @throws Error when strict TypeScript checking fails or times out.
 */
export const typeCheckExamples = async (fixture: ExampleFixture, programPaths: string[]): Promise<CommandResult> => {
  const typeRoots = [
    join(fixture.checkoutPath, 'node_modules/@types'),
    join(fixture.checkoutPath, 'node_modules')
  ].join(',');

  return await runDocumentedCommand({
    command: join(fixture.checkoutPath, 'node_modules/.bin/tsc'),
    args: [
      '--ignoreConfig',
      '--skipLibCheck',
      '--noEmit',
      '--strict',
      '--noUncheckedIndexedAccess',
      '--exactOptionalPropertyTypes',
      '--noImplicitOverride',
      '--noPropertyAccessFromIndexSignature',
      '--verbatimModuleSyntax',
      '--target',
      'ES2022',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--lib',
      'ES2022,DOM',
      '--typeRoots',
      typeRoots,
      '--types',
      'node,bun-types',
      ...programPaths
    ],
    cwd: fixture.consumerPath,
    env: fixture.environment,
    label: 'strict TypeScript example check',
    timeoutMs: COMMAND_TIMEOUT_MS
  });
};

/**
 * Starts a documented long-running shell example in the consumer project.
 *
 * @param fixture Consumer fixture used for package resolution.
 * @param example Long-running shell fence to execute verbatim.
 * @param environment Additional environment values for the process.
 * @returns The owned server process and its announced address.
 * @throws Error when the process exits early or does not report readiness.
 */
export const startShellExample = async (
  fixture: ExampleFixture,
  example: DocumentedExample,
  environment: NodeJS.ProcessEnv = {}
): Promise<RunningDocumentedServer> => {
  return await startDocumentedServer({
    example,
    cwd: fixture.consumerPath,
    env: {...fixture.environment, ...environment}
  });
};

/** Assigns the bounded build interval only to the installation fence. */
const timeoutForExample = (example: DocumentedExample): number => {
  return example.id === 'install-local-package' ? BUILD_TIMEOUT_MS : COMMAND_TIMEOUT_MS;
};
