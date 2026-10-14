/** @file Verifies idempotent fixture cleanup and truthful phase diagnostics. */
import {describe, expect, it} from 'bun:test';
import {
  cleanupExampleResources,
  type ExampleCleanupActions,
  type ExampleCleanupObservation
} from './support/documented-example-cleanup.ts';

/** Optional actions that let a cleanup test control one resource phase. */
interface CleanupTestOverrides {
  now?: () => number;
  stop?: () => Promise<void>;
  remove?: () => Promise<void>;
}

/** Creates deterministic cleanup operations and records their observations. */
const makeCleanupActions = (
  observations: ExampleCleanupObservation[],
  overrides: CleanupTestOverrides = {}
): ExampleCleanupActions => ({
  fixturePath: '/cache/documented-examples-test',
  now: overrides.now ?? (() => 0),
  stop: overrides.stop ?? (async () => undefined),
  remove: overrides.remove ?? (async () => undefined),
  observe: (observation) => observations.push(observation)
});

describe('documented-example resource cleanup', () => {
  it('shares one cleanup promise across concurrent and repeated callers', async () => {
    const observations: ExampleCleanupObservation[] = [];
    let releaseStop: () => void = () => undefined;
    let stopCount = 0;
    let removeCount = 0;
    const stopped = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const owner = {};
    const actions = makeCleanupActions(observations, {
      stop: async () => {
        stopCount += 1;
        await stopped;
      },
      remove: async () => {
        removeCount += 1;
      }
    });
    const first = cleanupExampleResources(owner, actions);
    const second = cleanupExampleResources(owner, actions);

    expect(second).toBe(first);
    releaseStop();
    await Promise.all([first, second]);

    expect(stopCount).toBe(1);
    expect(removeCount).toBe(1);
  });
});

describe('documented-example resource cleanup failures', () => {
  it('attempts removal after shutdown fails and retains both errors', async () => {
    const observations: ExampleCleanupObservation[] = [];
    let removalAttempted = false;
    let removalCount = 0;
    const owner = {};
    const actions = makeCleanupActions(observations, {
      stop: async () => {
        throw new Error('shutdown fault');
      },
      remove: async () => {
        removalAttempted = true;
        removalCount += 1;
        throw new Error('removal fault');
      }
    });
    const cleanup = cleanupExampleResources(owner, actions);
    const repeated = cleanupExampleResources(owner, actions);
    let failure: unknown;

    expect(repeated).toBe(cleanup);

    try {
      await cleanup;
    } catch (error) {
      failure = error;
    }

    expect(removalAttempted).toBe(true);
    expect(removalCount).toBe(1);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      'shutdown failed for fixture /cache/documented-examples-test: shutdown fault',
      'removal failed for fixture /cache/documented-examples-test: removal fault'
    ]);
  });
});

describe('documented-example resource cleanup timing', () => {
  it('reports delayed removal as completed with measured elapsed time', async () => {
    const observations: ExampleCleanupObservation[] = [];
    let currentTime = 0;
    let removed = false;
    await cleanupExampleResources(
      {},
      makeCleanupActions(observations, {
        now: () => currentTime,
        remove: async () => {
          currentTime = 75;
          removed = true;
        }
      })
    );

    expect(removed).toBe(true);
    expect(observations.map(({phase, status, elapsedMs}) => [phase, status, elapsedMs])).toEqual([
      ['shutdown', 'started', 0],
      ['shutdown', 'completed', 0],
      ['removal', 'started', 0],
      ['removal', 'completed', 75]
    ]);
  });
});
