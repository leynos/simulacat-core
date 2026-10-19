/** @file Coordinates idempotent shutdown and removal of example fixtures. */
import {z} from 'zod';

/** Prepared fixture whose cleanup operation is shared across callers. */
export interface FixtureOwner {
  /** Fixture directory, present on prepared examples and absent in unit doubles. */
  readonly fixturePath?: string;
}

/** Shutdown or removal phase recorded by fixture cleanup diagnostics. */
export type ExampleCleanupPhase = 'shutdown' | 'removal';

/** Lifecycle point reported for a cleanup phase. */
export type ExampleCleanupStatus = 'started' | 'completed' | 'failed';

/** Bounded timing and error facts for one fixture cleanup phase. */
export interface ExampleCleanupObservation {
  fixturePath: string;
  phase: ExampleCleanupPhase;
  status: ExampleCleanupStatus;
  elapsedMs: number;
  error: Error | undefined;
}

/** Operations and diagnostic sinks required to dispose one fixture. */
export interface ExampleCleanupActions {
  fixturePath: string;
  now(): number;
  stop(): Promise<void>;
  remove(): Promise<void>;
  observe(observation: ExampleCleanupObservation): void;
}

const cleanupOperations = new WeakMap<object, Promise<void>>();

/**
 * Runs cleanup once per owner and preserves failures from both disposal phases.
 *
 * @param owner Prepared fixture whose cleanup must be shared by all callers.
 * @param actions Owned server, fixture removal, clock, and diagnostic operations.
 * @returns Shared cleanup operation for the fixture owner.
 * @throws The phase error or an aggregate when shutdown and removal both fail.
 */
export const cleanupExampleResources = (owner: FixtureOwner, actions: ExampleCleanupActions): Promise<void> => {
  const previous = cleanupOperations.get(owner);

  if (previous) {
    return previous;
  }

  const operation = runCleanup(actions);
  cleanupOperations.set(owner, operation);
  return operation;
};

/** Runs both cleanup phases and returns every failure without masking either. */
const runCleanup = async (actions: ExampleCleanupActions): Promise<void> => {
  const failures: Error[] = [];
  await runCleanupPhase('shutdown', () => actions.stop(), actions, failures);
  await runCleanupPhase('removal', () => actions.remove(), actions, failures);

  if (failures.length === 1) {
    throw failures[0];
  }

  if (failures.length > 1) {
    throw new AggregateError(failures, `documented-example cleanup failed for ${actions.fixturePath}`);
  }
};

/** Observes and records one cleanup phase while allowing the next phase to run. */
const runCleanupPhase = async (
  phase: ExampleCleanupPhase,
  action: () => Promise<void>,
  actions: ExampleCleanupActions,
  failures: Error[]
): Promise<void> => {
  const startedAt = actions.now();
  reportObservation(actions, {
    fixturePath: actions.fixturePath,
    phase,
    status: 'started',
    elapsedMs: 0,
    error: undefined
  });

  try {
    await action();
  } catch (error) {
    const observedFailure: Error = z.instanceof(Error).parse(error);
    const failure = phaseFailure(phase, actions.fixturePath, observedFailure);
    failures.push(failure);
    reportObservation(actions, {
      fixturePath: actions.fixturePath,
      phase,
      status: 'failed',
      elapsedMs: elapsedSince(actions, startedAt),
      error: failure
    });
    return;
  }

  reportObservation(actions, {
    fixturePath: actions.fixturePath,
    phase,
    status: 'completed',
    elapsedMs: elapsedSince(actions, startedAt),
    error: undefined
  });
};

/** Keeps a diagnostic sink failure from skipping fixture removal. */
const reportObservation = (actions: ExampleCleanupActions, observation: ExampleCleanupObservation): void => {
  try {
    actions.observe(observation);
  } catch {
    // Disposal remains authoritative when a diagnostic sink is unavailable.
  }
};

/** Adds the fixture and phase to an operation failure while retaining its cause. */
const phaseFailure = (phase: ExampleCleanupPhase, fixturePath: string, error: Error): Error => {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${phase} failed for fixture ${fixturePath}: ${message}`, {cause: error});
};

/** Measures non-negative elapsed time on the injected monotonic clock. */
const elapsedSince = (actions: ExampleCleanupActions, startedAt: number): number => {
  return Math.max(0, actions.now() - startedAt);
};
