/** @file Checks the guide execution oracle against missing and corrupt evidence. */
import {describe, expect, it} from 'bun:test';
import {
  assertDocumentedExampleObservations,
  createDocumentedExampleObservationCollector,
  type DocumentedExampleOracleInput
} from './support/documented-example-observations.ts';
import type {DocumentedExampleId} from './support/documented-example-execution.ts';
import type {DocumentedExample} from './support/documented-examples.ts';

const SOURCE_EXAMPLE: DocumentedExample = {
  id: 'repository-node-id',
  language: 'typescript',
  body: 'console.log("example");\n',
  line: 1,
  sourcePath: 'fixture.md'
};

const SELECTED_IDS: readonly DocumentedExampleId[] = ['repository-node-id'];

describe('documented-example observation oracle', () => {
  it('rejects a constant completion result when the runner records no events', async () => {
    const collector = createDocumentedExampleObservationCollector();
    const fakeRunnerResult = {completedIds: [...SELECTED_IDS]};
    const input = createOracleInput(collector);

    expect(fakeRunnerResult.completedIds).toEqual([...SELECTED_IDS]);
    await expect(assertDocumentedExampleObservations(input)).rejects.toThrow(
      'completed observations must match the selected source fences in document order'
    );
  });

  it('rejects a completion trace without required TypeScript output', async () => {
    const collector = createDocumentedExampleObservationCollector();
    collector.record({kind: 'completed', id: 'repository-node-id'});

    await expect(assertDocumentedExampleObservations(createOracleInput(collector))).rejects.toThrow(
      'TypeScript output evidence is incomplete'
    );
  });

  it('applies the existing node ID contract to captured stdout', async () => {
    const collector = createDocumentedExampleObservationCollector();
    collector.record({kind: 'completed', id: 'repository-node-id'});
    collector.record({kind: 'typescript-output', id: 'repository-node-id', stdout: 'corrupt stdout'});

    await expect(assertDocumentedExampleObservations(createOracleInput(collector))).rejects.toMatchObject({
      code: 'ERR_ASSERTION',
      expected: 'Repository:acme/awesome-repo',
      operator: 'strictEqual'
    });
  });
});

/** Creates a no-server oracle input for deterministic evidence failures. */
const createOracleInput = (
  collector: ReturnType<typeof createDocumentedExampleObservationCollector>
): DocumentedExampleOracleInput => ({
  sourceExamples: [SOURCE_EXAMPLE],
  selectedIds: SELECTED_IDS,
  prepared: {
    fixture: {checkoutPath: 'checkout', consumerPath: 'consumer', directory: 'fixture', environment: {}},
    examples: [SOURCE_EXAMPLE],
    programPaths: new Map(),
    completedIds: []
  },
  collector
});
