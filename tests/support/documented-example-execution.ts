/** @file Executes users-guide examples from their marked source fences. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {
  assertCollaborationEntities,
  assertCurlResponses,
  assertFixtureBuilders,
  assertFixtureUrlOverrides,
  assertMountedApiRoot,
  assertQuickStartRepository,
  assertRepositoryMetadataPatch,
  assertRepositoryNodeId,
  parseJsonOutput
} from './documented-example-contracts.ts';
import {
  createExampleFixture,
  removeExampleFixture,
  runShellExample,
  runTypeScriptExample,
  startShellExample,
  typeCheckExamples,
  writeExampleProgram,
  type ExampleFixture
} from './documented-example-fixture.ts';
import {stopExampleProcess, type RunningDocumentedServer} from './documented-examples-process.ts';
import {cleanupExampleResources, type ExampleCleanupObservation} from './documented-example-cleanup.ts';
import {loadUsersGuideExamples, type DocumentedExample} from './documented-examples.ts';
import {rethrowAfterCleanup} from './documented-example-failures.ts';
import type {DocumentedExampleObserver} from './documented-example-observations.ts';

/** Stable identifiers required by the users-guide test contract. */
export const DOCUMENTED_EXAMPLE_IDS = [
  'install-local-package',
  'start-simulator-program',
  'run-simulator-command',
  'query-simulator-with-curl',
  'repository-node-id',
  'fixture-builders',
  'seed-collaboration-entities',
  'patch-repository-metadata',
  'mount-api-under-v3',
  'preserve-fixture-url-overrides',
  'repository-store-key',
  'branch-store-key',
  'blob-store-key'
] as const;

/** The finite set of example IDs supported by the runner. */
export type DocumentedExampleId = (typeof DOCUMENTED_EXAMPLE_IDS)[number];

/** Example identifiers exercised by the BDD quick-start scenario. */
export const QUICK_START_EXAMPLE_IDS: readonly DocumentedExampleId[] = [
  'install-local-package',
  'start-simulator-program',
  'run-simulator-command',
  'query-simulator-with-curl'
];

/** Result of executing a selected set of source examples. */
export interface DocumentedExampleRun {
  completedIds: DocumentedExampleId[];
}

/** Prepared consumer fixture retained between setup and scenario steps. */
export interface PreparedDocumentedExamples {
  fixture: ExampleFixture;
  examples: DocumentedExample[];
  programPaths: Map<DocumentedExampleId, string>;
  completedIds: DocumentedExampleId[];
  server?: RunningDocumentedServer;
  observer?: DocumentedExampleObserver;
}

type ExampleHandler = (session: PreparedDocumentedExamples, example: DocumentedExample) => Promise<void>;

/**
 * Executes marked examples sequentially against an installed checkout.
 *
 * @param selectedIds Optional ordered subset of examples.
 * @returns Identifiers whose original document fences completed successfully.
 * @throws Error when markers, handler coverage, package setup, or behaviour fails.
 */
export const runDocumentedExamples = async (
  selectedIds: readonly DocumentedExampleId[] = DOCUMENTED_EXAMPLE_IDS
): Promise<DocumentedExampleRun> => {
  const prepared = await prepareDocumentedExamples(selectedIds);

  try {
    return await runPreparedDocumentedExamples(prepared);
  } finally {
    await cleanupPreparedDocumentedExamples(prepared);
  }
};

/**
 * Installs the local package and type-checks each selected source program.
 *
 * @param selectedIds Ordered examples to prepare, including the install fence.
 * @param observer Optional test-owned collector for completed work and captured outputs.
 * @returns Consumer fixture, generated programs, and completed install ID.
 * @throws Error when the guide, checkout installation, or typecheck fails.
 */
export const prepareDocumentedExamples = async (
  selectedIds: readonly DocumentedExampleId[],
  observer?: DocumentedExampleObserver
): Promise<PreparedDocumentedExamples> => {
  const examples = await loadUsersGuideExamples();
  assertExampleCoverage(examples);
  const selectedExamples = selectExamples(examples, selectedIds);
  const fixture = await createExampleFixture();
  const prepared: PreparedDocumentedExamples = {
    fixture,
    examples: selectedExamples,
    programPaths: new Map(),
    completedIds: [],
    ...(observer ? {observer} : {})
  };

  try {
    await preparePrograms(prepared, selectedExamples);
    const installationExample = selectedExamples.find((example) => example.id === 'install-local-package');

    if (!installationExample) {
      throw new Error('The local package installation fence was not selected');
    }

    await installLocalPackage(prepared, installationExample);
    prepared.observer?.record({kind: 'completed', id: 'install-local-package'});
    prepared.completedIds.push('install-local-package');
    return prepared;
  } catch (error) {
    return await rethrowAfterCleanup(error, () => cleanupPreparedDocumentedExamples(prepared));
  }
};

/**
 * Executes prepared examples after the local package installation step.
 *
 * @param prepared Installed consumer and source examples from preparation.
 * @returns All IDs completed by preparation and execution.
 * @throws Error when an example command or observable contract fails.
 */
export const runPreparedDocumentedExamples = async (
  prepared: PreparedDocumentedExamples
): Promise<DocumentedExampleRun> => {
  for (const example of prepared.examples) {
    const id = example.id as DocumentedExampleId;
    if (prepared.completedIds.includes(id)) {
      continue;
    }

    await handlers[id](prepared, example);
    prepared.observer?.record({kind: 'completed', id});
    prepared.completedIds.push(id);
  }

  return {completedIds: [...prepared.completedIds]};
};

/**
 * Stops the owned server and removes the temporary consumer fixture.
 *
 * @param prepared Prepared fixture to dispose.
 * @returns The shared operation that shuts down the server and removes the fixture.
 * @throws Error when the owned server cannot be stopped or fixture removed.
 */
export const cleanupPreparedDocumentedExamples = (prepared: PreparedDocumentedExamples): Promise<void> => {
  return cleanupExampleResources(prepared, {
    fixturePath: prepared.fixture.directory,
    now: () => performance.now(),
    stop: () => stopPreparedServer(prepared),
    remove: () => removePreparedFixture(prepared),
    observe: logCleanupObservation
  });
};

/** Stops the prepared fixture's server and retains its handle if shutdown fails. */
const stopPreparedServer = async (prepared: PreparedDocumentedExamples): Promise<void> => {
  const server = prepared.server;

  if (!server) {
    return;
  }

  await stopExampleProcess(server.process);
  delete prepared.server;
};

/** Removes the consumer directory owned by the prepared fixture. */
const removePreparedFixture = async (prepared: PreparedDocumentedExamples): Promise<void> => {
  await removeExampleFixture(prepared.fixture);
};

/** Reports bounded phase timings and includes shutdown state on failure. */
const logCleanupObservation = (observation: ExampleCleanupObservation): void => {
  const label = `[documented-example-cleanup] ${observation.phase} ${observation.status}`;

  if (observation.status === 'failed') {
    console.error(label, observation);
    return;
  }

  console.info(label, observation);
};

/**
 * Verifies each document marker has exactly one executable handler.
 *
 * @param examples Parsed source examples.
 * @throws Error when the guide and runner inventories differ.
 */
export const assertExampleCoverage = (examples: DocumentedExample[]): void => {
  const sourceIds = examples.map((example) => example.id).sort();
  const expectedIds = [...DOCUMENTED_EXAMPLE_IDS].sort();
  const handlerIds = Object.keys(handlers).sort();
  assert.deepEqual(sourceIds, expectedIds, 'users-guide markers must match the documented contract inventory');
  assert.deepEqual(handlerIds, expectedIds, 'every documented example must have exactly one handler');
};

/** Selects source fences in document order and requires package installation. */
const selectExamples = (examples: DocumentedExample[], ids: readonly DocumentedExampleId[]): DocumentedExample[] => {
  const byId = new Map(examples.map((example) => [example.id, example]));
  const missing = ids.filter((id) => !byId.has(id));

  if (missing.length > 0) {
    throw new Error(`Requested guide examples are missing: ${missing.join(', ')}`);
  }

  if (!ids.includes('install-local-package')) {
    throw new Error('Example execution must include the local package installation fence');
  }

  const selected = new Set(ids);
  return examples.filter((example) => selected.has(example.id as DocumentedExampleId));
};

/** Writes selected TypeScript fences unchanged for type-checking and execution. */
const preparePrograms = async (prepared: PreparedDocumentedExamples, examples: DocumentedExample[]): Promise<void> => {
  for (const example of examples) {
    if (example.language !== 'typescript') {
      continue;
    }

    const id = example.id as DocumentedExampleId;
    const fileName = id === 'start-simulator-program' ? 'simulation.ts' : `${id}.ts`;
    const path = await writeExampleProgram(prepared.fixture, example, fileName);
    prepared.programPaths.set(id, path);
  }
};

/** Executes the guide's checked-out package installation recipe. */
const installLocalPackage: ExampleHandler = async (prepared, example) => {
  await runShellExample(prepared.fixture, example);
  const programs = [...prepared.programPaths.values()];
  await typeCheckExamples(prepared.fixture, programs);
};

/** Checks the startup source fence was written without changing its body. */
const prepareSimulatorProgram: ExampleHandler = async (prepared) => {
  assert.ok(prepared.programPaths.has('start-simulator-program'));
};

/** Executes the documented Bun command and verifies its live server response. */
const runSimulatorCommand: ExampleHandler = async (prepared, example) => {
  prepared.server = await startShellExample(prepared.fixture, example, {PORT: '0'});
  const response = await fetch(`${prepared.server.baseUrl}/repos/acme/awesome-repo`);
  const body: unknown = await response.json();
  prepared.observer?.record({kind: 'startup-response', id: 'run-simulator-command', status: response.status, body});
  assert.equal(response.status, 200);
  assertQuickStartRepository(body);
};

/** Executes the curl commands against the port announced by the startup fence. */
const querySimulatorWithCurl: ExampleHandler = async (prepared, example) => {
  assert.ok(prepared.server, 'the startup command must run before curl');
  const result = await runShellExample(prepared.fixture, example, {BASE_URL: prepared.server.baseUrl});
  prepared.observer?.record({kind: 'curl-output', id: 'query-simulator-with-curl', stdout: result.stdout});
  assertCurlResponses(result.stdout);
};

/** Executes a TypeScript fence and returns its final output for assertions. */
const executeProgram = async (prepared: PreparedDocumentedExamples, example: DocumentedExample): Promise<string> => {
  const id = example.id as DocumentedExampleId;
  const path = prepared.programPaths.get(id);

  if (!path) {
    throw new Error(`No generated TypeScript program exists for ${id}`);
  }

  const result = await runTypeScriptExample(prepared.fixture, {path, exampleId: id});
  prepared.observer?.record({kind: 'typescript-output', id, stdout: result.stdout});
  return result.stdout;
};

/** Executes the canonical repository node-ID example. */
const checkRepositoryNodeId: ExampleHandler = async (prepared, example) => {
  assertRepositoryNodeId(await executeProgram(prepared, example));
};

/** Executes and checks the six parsed fixture builder results. */
const checkFixtureBuilders: ExampleHandler = async (prepared, example) => {
  assertFixtureBuilders(parseJsonOutput({stdout: await executeProgram(prepared, example), label: example.id}));
};

/** Exercises seeded collaboration routes and GraphQL fields over HTTP. */
const checkCollaborationEntities: ExampleHandler = async (prepared, example) => {
  assertCollaborationEntities(parseJsonOutput({stdout: await executeProgram(prepared, example), label: example.id}));
};

/** Exercises persisted repository metadata through REST and GraphQL reads. */
const checkRepositoryMetadataPatch: ExampleHandler = async (prepared, example) => {
  assertRepositoryMetadataPatch(parseJsonOutput({stdout: await executeProgram(prepared, example), label: example.id}));
};

/** Checks request-derived API URLs under the configured v3 mount. */
const checkMountedApiRoot: ExampleHandler = async (prepared, example) => {
  assertMountedApiRoot(parseJsonOutput({stdout: await executeProgram(prepared, example), label: example.id}));
};

/** Checks seeded URLs override the host-derived repository URLs. */
const checkFixtureUrlOverrides: ExampleHandler = async (prepared, example) => {
  assertFixtureUrlOverrides(parseJsonOutput({stdout: await executeProgram(prepared, example), label: example.id}));
};

/** Checks the narrowed repository helper returns its canonical key. */
const checkRepositoryStoreKey: ExampleHandler = async (prepared, example) => {
  assert.equal((await executeProgram(prepared, example)).trim(), 'acme/awesome-repo');
};

/** Checks the narrowed branch helper returns its canonical key. */
const checkBranchStoreKey: ExampleHandler = async (prepared, example) => {
  assert.equal((await executeProgram(prepared, example)).trim(), 'acme/awesome-repo:main');
};

/** Checks the narrowed blob helper returns its path-based canonical key. */
const checkBlobStoreKey: ExampleHandler = async (prepared, example) => {
  assert.equal((await executeProgram(prepared, example)).trim(), 'acme/awesome-repo:README.md');
};

const handlers: Record<DocumentedExampleId, ExampleHandler> = {
  'install-local-package': installLocalPackage,
  'start-simulator-program': prepareSimulatorProgram,
  'run-simulator-command': runSimulatorCommand,
  'query-simulator-with-curl': querySimulatorWithCurl,
  'repository-node-id': checkRepositoryNodeId,
  'fixture-builders': checkFixtureBuilders,
  'seed-collaboration-entities': checkCollaborationEntities,
  'patch-repository-metadata': checkRepositoryMetadataPatch,
  'mount-api-under-v3': checkMountedApiRoot,
  'preserve-fixture-url-overrides': checkFixtureUrlOverrides,
  'repository-store-key': checkRepositoryStoreKey,
  'branch-store-key': checkBranchStoreKey,
  'blob-store-key': checkBlobStoreKey
};
