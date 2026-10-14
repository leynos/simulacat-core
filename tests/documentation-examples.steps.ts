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

interface DocumentationExampleState {
  completedIds?: DocumentedExampleId[];
}

const {When, Then} = withState<DocumentationExampleState>();

let preparedExamples: PreparedDocumentedExamples | undefined;

beforeAll(async () => {
  preparedExamples = await prepareDocumentedExamples(QUICK_START_EXAMPLE_IDS);
}, 240_000);

/** Disposes the quick-start fixture under Bun's local afterAll time bound. */
const cleanupQuickStartFixture = async (): Promise<void> => {
  const prepared = preparedExamples;

  if (!prepared) {
    return;
  }

  await cleanupPreparedDocumentedExamples(prepared);
  preparedExamples = undefined;
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

Then('every quick-start example contract passes', (state) => {
  expect(state.completedIds).toEqual([...QUICK_START_EXAMPLE_IDS]);
  return state;
});
