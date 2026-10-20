/** @file Collects independent evidence for source-driven guide examples. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  assertCollaborationEntities,
  assertCurlResponses,
  assertFixtureBuilders,
  assertFixtureUrlOverrides,
  assertMountedApiRoot,
  assertQuickStartRepository,
  assertRepositoryMetadataPatch,
  assertRepositoryNodeId,
  parseJsonDocument,
  parseJsonOutput
} from './documented-example-contracts.ts';
import type {CapturedOutput, JsonValue} from './documented-example-contracts.ts';
import type {DocumentedExampleId, PreparedDocumentedExamples} from './documented-example-execution.ts';
import type {DocumentedExample} from './documented-examples.ts';

/** Immutable evidence emitted by a completed documented operation. */
export type DocumentedExampleObservation =
  | {readonly kind: 'completed'; readonly id: DocumentedExampleId}
  | {readonly kind: 'typescript-output'; readonly id: DocumentedExampleId; readonly stdout: string}
  | {readonly kind: 'curl-output'; readonly id: 'query-simulator-with-curl'; readonly stdout: string}
  | {
      readonly kind: 'startup-response';
      readonly id: 'run-simulator-command';
      readonly status: number;
      readonly body: JsonValue;
    };

/** Receives observations from one prepared example session. */
export interface DocumentedExampleObserver {
  record(observation: DocumentedExampleObservation): void;
}

/** Stores immutable observations for an independent test oracle. */
export interface DocumentedExampleObservationCollector extends DocumentedExampleObserver {
  snapshot(): readonly DocumentedExampleObservation[];
}

/** Inputs needed to compare executed evidence with selected source fences. */
export interface DocumentedExampleOracleInput {
  sourceExamples: readonly DocumentedExample[];
  selectedIds: readonly DocumentedExampleId[];
  prepared: PreparedDocumentedExamples;
  collector: DocumentedExampleObservationCollector;
}

type TypeScriptOutputContract =
  | {kind: 'stdout'; validate: (output: CapturedOutput) => void}
  | {kind: 'json'; validate: (value: JsonValue) => void}
  | {kind: 'text'; expected: string};

const typeScriptOutputContracts: Partial<Record<DocumentedExampleId, TypeScriptOutputContract>> = {
  'repository-node-id': {kind: 'stdout', validate: assertRepositoryNodeId},
  'fixture-builders': {kind: 'json', validate: assertFixtureBuilders},
  'seed-collaboration-entities': {kind: 'json', validate: assertCollaborationEntities},
  'patch-repository-metadata': {kind: 'json', validate: assertRepositoryMetadataPatch},
  'mount-api-under-v3': {kind: 'json', validate: assertMountedApiRoot},
  'preserve-fixture-url-overrides': {kind: 'json', validate: assertFixtureUrlOverrides},
  'repository-store-key': {kind: 'text', expected: 'acme/awesome-repo'},
  'branch-store-key': {kind: 'text', expected: 'acme/awesome-repo:main'},
  'blob-store-key': {kind: 'text', expected: 'acme/awesome-repo:README.md'}
};

/**
 * Creates a test-owned collector whose snapshot cannot mutate its event log.
 *
 * @returns A collector with an immutable event log and copied snapshots.
 */
export const createDocumentedExampleObservationCollector = (): DocumentedExampleObservationCollector => {
  const observations: DocumentedExampleObservation[] = [];

  return {
    record: (observation) => {
      observations.push(Object.freeze(observation));
    },
    snapshot: () => [...observations]
  };
};

/**
 * Checks the observed execution trace, command output, source bytes, and live server.
 *
 * @param input Fresh guide fences, selected IDs, prepared fixture, and test-owned observations.
 * @returns Resolves when the source-derived execution evidence satisfies every contract.
 * @throws AssertionError when execution evidence differs from the selected fences or contracts.
 */
export const assertDocumentedExampleObservations = async (input: DocumentedExampleOracleInput): Promise<void> => {
  const examples = selectSourceExamples(input.sourceExamples, input.selectedIds);
  const observations = input.collector.snapshot();
  assertCompletionTrace(examples, observations);
  assertCapturedOutputs(examples, observations);
  await assertStartupProgramMatchesFence(input.prepared, examples);
  await assertLiveRepositoryResponse(input.prepared, examples);
};

/** Selects source fences and rejects empty, unknown, or repeated requested IDs. */
const selectSourceExamples = (
  sourceExamples: readonly DocumentedExample[],
  selectedIds: readonly DocumentedExampleId[]
): DocumentedExample[] => {
  assert.ok(selectedIds.length > 0, 'the observation oracle requires selected source examples');
  assert.equal(new Set(selectedIds).size, selectedIds.length, 'selected example IDs must be unique');
  const selected = new Set<string>(selectedIds);
  const examples = sourceExamples.filter((example) => selected.has(example.id));
  assert.deepEqual(
    examples.map((example) => example.id).toSorted(),
    [...selectedIds].toSorted(),
    'selected IDs must exist in the current users-guide source'
  );
  return examples;
};

/** Compares actual completion events with source-order selected fence IDs. */
const assertCompletionTrace = (
  examples: readonly DocumentedExample[],
  observations: readonly DocumentedExampleObservation[]
): void => {
  const completedIds = observations.flatMap((observation) => (isCompletion(observation) ? [observation.id] : []));
  assert.deepEqual(
    completedIds,
    examples.map((example) => example.id),
    'completed observations must match the selected source fences in document order'
  );
};

/** Requires and validates captured outputs from every selected executing example. */
const assertCapturedOutputs = (
  examples: readonly DocumentedExample[],
  observations: readonly DocumentedExampleObservation[]
): void => {
  assertTypeScriptOutputs(examples, observations);
  assertCurlOutputs(examples, observations);
  assertStartupResponses(examples, observations);
};

/** One observation kind, the source-derived IDs it must cover, and its validator. */
interface ObservationExpectation<Observation extends DocumentedExampleObservation> {
  readonly isKind: (observation: DocumentedExampleObservation) => observation is Observation;
  readonly expectedIds: readonly string[];
  readonly validate: (observation: Observation) => void;
  readonly incompleteMessage: string;
}

/** Requires exactly the source-derived observations of one kind, in trace order, and validates each one. */
const assertObservedKind = <Observation extends DocumentedExampleObservation>(
  observations: readonly DocumentedExampleObservation[],
  expectation: ObservationExpectation<Observation>
): void => {
  const matched = observations.flatMap((observation) => (expectation.isKind(observation) ? [observation] : []));
  // Both halves matter: a missing observation and a stray or reordered one are
  // equally invalid evidence, so the comparison is over the full ID sequence
  // rather than merely checking that an expected ID is present.
  assert.deepEqual(
    matched.map((observation) => observation.id),
    expectation.expectedIds,
    expectation.incompleteMessage
  );

  for (const observation of matched) {
    expectation.validate(observation);
  }
};

/** Lists an example ID when the selected fences include it. */
const expectedIdsFor = (examples: readonly DocumentedExample[], id: DocumentedExampleId): readonly string[] =>
  examples.flatMap((example) => (example.id === id ? [example.id] : []));

/** Lists IDs of selected fences whose source is a TypeScript program. */
const executedTypeScriptIds = (examples: readonly DocumentedExample[]): readonly string[] =>
  examples.flatMap((example) => (isExecutedTypeScriptExample(example) ? [example.id] : []));

/** Requires one captured program output per selected executing TypeScript fence. */
const assertTypeScriptOutputs = (
  examples: readonly DocumentedExample[],
  observations: readonly DocumentedExampleObservation[]
): void => {
  assertObservedKind(observations, {
    isKind: isTypeScriptOutput,
    expectedIds: executedTypeScriptIds(examples),
    validate: validateTypeScriptOutput,
    incompleteMessage: 'TypeScript output evidence is incomplete'
  });
};

/** Requires the curl guide's output when that fence is selected. */
const assertCurlOutputs = (
  examples: readonly DocumentedExample[],
  observations: readonly DocumentedExampleObservation[]
): void => {
  assertObservedKind(observations, {
    isKind: isCurlOutput,
    expectedIds: expectedIdsFor(examples, 'query-simulator-with-curl'),
    validate: (output) => assertCurlResponses({stdout: output.stdout, label: output.id}),
    incompleteMessage: 'curl output evidence is incomplete'
  });
};

/** Requires the startup guide's recorded HTTP response when that fence is selected. */
const assertStartupResponses = (
  examples: readonly DocumentedExample[],
  observations: readonly DocumentedExampleObservation[]
): void => {
  assertObservedKind(observations, {
    isKind: isStartupResponse,
    expectedIds: expectedIdsFor(examples, 'run-simulator-command'),
    validate: (response) => {
      assert.equal(response.status, 200);
      assertQuickStartRepository(response.body);
    },
    incompleteMessage: 'startup response evidence is incomplete'
  });
};

/** Applies the existing output contract for one captured TypeScript program. */
const validateTypeScriptOutput = (output: TypeScriptOutputObservation): void => {
  const contract = typeScriptOutputContracts[output.id];
  assert.ok(contract, `no captured-output contract exists for ${output.id}`);

  if (contract.kind === 'stdout') {
    contract.validate({stdout: output.stdout, label: output.id});
    return;
  }

  if (contract.kind === 'json') {
    contract.validate(parseJsonOutput({stdout: output.stdout, label: output.id}));
    return;
  }

  assert.equal(output.stdout.trim(), contract.expected, `${output.id} output differs from its canonical key`);
};

/** Verifies the generated startup program remains byte-for-byte source driven. */
const assertStartupProgramMatchesFence = async (
  prepared: PreparedDocumentedExamples,
  examples: readonly DocumentedExample[]
): Promise<void> => {
  const example = examples.find((candidate) => candidate.id === 'start-simulator-program');

  if (!example) {
    return;
  }

  const programPath = prepared.programPaths.get('start-simulator-program');
  assert.ok(programPath, 'the selected startup fence must have a generated program');
  assert.equal(
    await readFile(programPath, 'utf8'),
    example.body,
    'generated startup program changed the source fence bytes'
  );
};

/** Fetches the seeded repository outside the runner from its live owned server. */
const assertLiveRepositoryResponse = async (
  prepared: PreparedDocumentedExamples,
  examples: readonly DocumentedExample[]
): Promise<void> => {
  if (!examples.some((example) => example.id === 'run-simulator-command')) {
    return;
  }

  const server = prepared.server;
  assert.ok(server, 'the selected startup command must leave its owned server available to the oracle');
  const response = await fetch(`${server.baseUrl}/repos/acme/awesome-repo`);
  assert.equal(response.status, 200);
  assertQuickStartRepository(parseJsonDocument(await response.text(), 'live repository response'));
};

/** Selects fences whose captured stdout must match a TypeScript output contract. */
const isExecutedTypeScriptExample = (example: DocumentedExample): boolean =>
  example.language === 'typescript' && example.id !== 'start-simulator-program';

type TypeScriptOutputObservation = Extract<DocumentedExampleObservation, {kind: 'typescript-output'}>;
type CurlOutputObservation = Extract<DocumentedExampleObservation, {kind: 'curl-output'}>;
type StartupResponseObservation = Extract<DocumentedExampleObservation, {kind: 'startup-response'}>;

/** Narrows one completion event. */
const isCompletion = (
  observation: DocumentedExampleObservation
): observation is Extract<DocumentedExampleObservation, {kind: 'completed'}> => observation.kind === 'completed';

/** Narrows one TypeScript output event. */
const isTypeScriptOutput = (observation: DocumentedExampleObservation): observation is TypeScriptOutputObservation =>
  observation.kind === 'typescript-output';

/** Narrows one curl output event. */
const isCurlOutput = (observation: DocumentedExampleObservation): observation is CurlOutputObservation =>
  observation.kind === 'curl-output';

/** Narrows one startup response event. */
const isStartupResponse = (observation: DocumentedExampleObservation): observation is StartupResponseObservation =>
  observation.kind === 'startup-response';
