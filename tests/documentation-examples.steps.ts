/** @file Step definitions for executable users-guide quick-start examples. */
import {afterAll, beforeAll, expect} from 'bun:test';
import {withState} from './cucumber.js';
import {
  QUICK_START_EXAMPLE_IDS,
  cleanupPreparedDocumentedExamples,
  prepareDocumentedExamples,
  runPreparedDocumentedExamples,
  type PreparedDocumentedExamples,
  type DocumentedExampleId
} from './support/documented-example-execution.ts';
import {
  assertDocumentedExampleObservations,
  createDocumentedExampleObservationCollector,
  type DocumentedExampleObservationCollector
} from './support/documented-example-observations.ts';
import {loadUsersGuideExamples} from './support/documented-examples.ts';

interface DocumentationExampleState {
  completedIds?: DocumentedExampleId[];
}

const {When, Then} = withState<DocumentationExampleState>();

let preparedExamples: PreparedDocumentedExamples | undefined;
let observationCollector: DocumentedExampleObservationCollector | undefined;

beforeAll(async () => {
  observationCollector = createDocumentedExampleObservationCollector();
  preparedExamples = await prepareDocumentedExamples(QUICK_START_EXAMPLE_IDS, observationCollector);
}, 240_000);

/** Disposes the quick-start fixture under Bun's local afterAll time bound. */
const cleanupQuickStartFixture = async (): Promise<void> => {
  const prepared = preparedExamples;

  if (!prepared) {
    observationCollector = undefined;
    return;
  }

  await cleanupPreparedDocumentedExamples(prepared);
  preparedExamples = undefined;
  observationCollector = undefined;
};

// Removing the installed consumer took 25 seconds; allow filesystem cleanup
// its own local budget without extending process shutdown or scenario timeouts.
afterAll(cleanupQuickStartFixture, 60_000);

When('the quick-start examples from the users guide are executed', async (state) => {
  if (!preparedExamples) {
    throw new Error('The documented examples were not prepared before the scenario');
  }

  const result = await runPreparedDocumentedExamples(preparedExamples);
  return {...state, completedIds: result.completedIds};
});

Then('every quick-start example contract passes', async (state) => {
  expect(state.completedIds).toEqual([...QUICK_START_EXAMPLE_IDS]);
  const prepared = preparedExamples;
  const collector = observationCollector;

  if (!prepared || !collector) {
    throw new Error('the prepared quick-start observations are unavailable');
  }

  await assertDocumentedExampleObservations({
    sourceExamples: await loadUsersGuideExamples(),
    selectedIds: QUICK_START_EXAMPLE_IDS,
    prepared,
    collector
  });
  return state;
});
