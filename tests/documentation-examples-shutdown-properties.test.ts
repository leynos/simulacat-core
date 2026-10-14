/** @file Samples bounded shutdown schedules against an independent lifecycle model. */
import {describe, it} from 'bun:test';
import fc from 'fast-check';
import {propertyTestSeed} from './support/property-test-seed.ts';
import {stopOwnedProcessGroup, type CommandResult} from './support/documented-example-shutdown.ts';
import {FakeShutdownTarget, ManualShutdownScheduler} from './support/documented-example-shutdown-fakes.ts';
import {shutdownScenarioArbitrary, type ShutdownScenario} from './support/documented-example-shutdown-scenarios.ts';
import {
  assertShutdownOracleSensitivity,
  assertShutdownTrace,
  type ShutdownRun
} from './support/documented-example-shutdown-model.ts';

type ShutdownOutcome =
  | {kind: 'closed'; result: CommandResult; settledAt: number}
  | {kind: 'rejected'; error: unknown; settledAt: number};

interface ShutdownHarness {
  target: FakeShutdownTarget;
  scheduler: ManualShutdownScheduler;
  outcome(): ShutdownOutcome | undefined;
}

interface TransitionBudget {
  count: number;
}

const MAX_MICROTASK_FLUSHES = 32;
const MAX_MODEL_TRANSITIONS = 8;
const CLOSED_RESULT: CommandResult = {
  stdout: 'captured final output',
  stderr: 'captured diagnostic',
  exitCode: 0,
  signal: null
};

describe('generated documented-example shutdown schedules', () => {
  it('matches the independent model for bounded virtual schedules', async () => {
    await fc.assert(
      fc.asyncProperty(shutdownScenarioArbitrary, async (scenario) => {
        const actual = await driveShutdownScenario(scenario);
        assertShutdownTrace(scenario, actual);
      }),
      {seed: propertyTestSeed, numRuns: 100}
    );
  });

  it('rejects unowned signals, early pipe release, and a reset deadline model trace', () => {
    assertShutdownOracleSensitivity();
  });
});

/** Creates an owned in-memory target and captures asynchronous settlement. */
const createShutdownHarness = (scenario: ShutdownScenario): ShutdownHarness => {
  const scheduler = new ManualShutdownScheduler();
  const target = new FakeShutdownTarget({}, () => scheduler.now());
  target.signalResult = scenario.signalResult;
  configureScenarioEvents(target, scenario);
  let observedOutcome: ShutdownOutcome | undefined;

  void stopOwnedProcessGroup(target, scheduler, scenario.limits).then(
    (result) => {
      observedOutcome = {kind: 'closed', result, settledAt: scheduler.now()};
    },
    (error: unknown) => {
      observedOutcome = {kind: 'rejected', error, settledAt: scheduler.now()};
    }
  );

  return {target, scheduler, outcome: () => observedOutcome};
};

/** Applies only the generated process events for a scenario. */
const configureScenarioEvents = (target: FakeShutdownTarget, scenario: ShutdownScenario): void => {
  if (scenario.kind === 'graceful-close') {
    target.onSignal = (signal) => exitOnGracefulSignal(target, signal);
  }

  if (scenario.kind === 'forced-close') {
    target.onSignal = (signal) => closeOnForcedSignal(target, signal);
  }
};

/** Emits direct-child exit only for the graceful-stop signal. */
const exitOnGracefulSignal = (target: FakeShutdownTarget, signal: NodeJS.Signals): void => {
  if (signal !== 'SIGTERM') {
    return;
  }

  target.emitExit();
};

/** Emits child exit and complete output only for the forced-stop signal. */
const closeOnForcedSignal = (target: FakeShutdownTarget, signal: NodeJS.Signals): void => {
  if (signal !== 'SIGKILL') {
    return;
  }

  target.emitExit(null, 'SIGKILL');
  target.emitClose(CLOSED_RESULT);
};

/** Drives a generated schedule with bounded transitions and no real waits. */
const driveShutdownScenario = async (scenario: ShutdownScenario): Promise<ShutdownRun> => {
  const harness = createShutdownHarness(scenario);
  const transitions: TransitionBudget = {count: 0};
  await waitForProgress(harness, 0);

  if (scenario.kind === 'graceful-close') {
    await finishGracefulClose(harness, scenario, transitions);
  } else if (scenario.kind === 'forced-close') {
    await finishForcedClose(harness, transitions);
  } else if (scenario.kind === 'exit-before-deadline') {
    await finishExitBeforeDeadline(harness, scenario, transitions);
  } else {
    await finishForcedTimeout(harness, transitions);
  }

  return captureShutdownRun(harness);
};

/** Closes inherited pipes after a generated exit within its post-exit budget. */
const finishGracefulClose = async (
  harness: ShutdownHarness,
  scenario: Extract<ShutdownScenario, {kind: 'graceful-close'}>,
  transitions: TransitionBudget
): Promise<void> => {
  applyTransition(transitions, () => {
    harness.scheduler.advanceBy(scenario.closeOffset);
    harness.target.emitClose(CLOSED_RESULT);
  });
  await waitForSettlement(harness);
};

/** Advances through graceful timeout and accepts the generated forced close. */
const finishForcedClose = async (harness: ShutdownHarness, transitions: TransitionBudget): Promise<void> => {
  advanceToNextDeadline(harness.scheduler, transitions);
  await waitForProgress(harness, harness.scheduler.scheduledTimerCount);
  await waitForSettlement(harness);
};

/** Emits exit just before the original forced deadline and leaves pipes open. */
const finishExitBeforeDeadline = async (
  harness: ShutdownHarness,
  scenario: Extract<ShutdownScenario, {kind: 'exit-before-deadline'}>,
  transitions: TransitionBudget
): Promise<void> => {
  advanceToNextDeadline(harness.scheduler, transitions);
  await waitForProgress(harness, harness.scheduler.scheduledTimerCount);
  applyTransition(transitions, () => {
    harness.scheduler.advanceBy(scenario.exitOffset);
    harness.target.emitExit(null, 'SIGKILL');
  });
  await waitForProgress(harness, harness.scheduler.scheduledTimerCount);
  advanceToNextDeadline(harness.scheduler, transitions);
  await waitForSettlement(harness);
};

/** Advances through both shutdown deadlines without reporting child exit. */
const finishForcedTimeout = async (harness: ShutdownHarness, transitions: TransitionBudget): Promise<void> => {
  advanceToNextDeadline(harness.scheduler, transitions);
  await waitForProgress(harness, harness.scheduler.scheduledTimerCount);
  advanceToNextDeadline(harness.scheduler, transitions);
  await waitForSettlement(harness);
};

/** Advances fake time exactly to the next live deadline. */
const advanceToNextDeadline = (scheduler: ManualShutdownScheduler, transitions: TransitionBudget): void => {
  applyTransition(transitions, () => {
    const deadline = scheduler.nextDeadline;

    if (deadline === undefined) {
      throw new Error('shutdown driver found no live timer deadline');
    }

    scheduler.advanceBy(deadline - scheduler.now());
  });
};

/** Applies one bounded generated event or timer transition. */
const applyTransition = (budget: TransitionBudget, action: () => void): void => {
  budget.count += 1;

  if (budget.count > MAX_MODEL_TRANSITIONS) {
    throw new Error('shutdown driver exceeded its transition cap');
  }

  action();
};

/** Flushes microtasks until operation settlement or a new timer registration. */
const waitForProgress = async (harness: ShutdownHarness, priorTimerCount: number): Promise<void> => {
  for (let attempt = 0; attempt < MAX_MICROTASK_FLUSHES; attempt += 1) {
    await Promise.resolve();

    if (harness.outcome() || harness.scheduler.scheduledTimerCount > priorTimerCount) {
      return;
    }
  }

  throw new Error('shutdown driver made no progress during its bounded microtask flush');
};

/** Flushes microtasks until settlement or an explicit bounded-driver failure. */
const waitForSettlement = async (harness: ShutdownHarness): Promise<void> => {
  for (let attempt = 0; attempt < MAX_MICROTASK_FLUSHES; attempt += 1) {
    await Promise.resolve();

    if (harness.outcome()) {
      return;
    }
  }

  throw new Error('shutdown operation did not settle during its bounded microtask flush');
};

/** Captures the settled process facts and resource counts for the model. */
const captureShutdownRun = (harness: ShutdownHarness): ShutdownRun => {
  const outcome = harness.outcome();

  if (!outcome) {
    throw new Error('shutdown driver completed without a recorded outcome');
  }

  return {
    outcome,
    observations: [...harness.target.observations],
    configuredSignalResult: harness.target.signalResult,
    releasedPipeCount: harness.target.releasedPipeCount,
    pendingTimerCount: harness.scheduler.pendingTimerCount,
    listenerCount: harness.target.listenerCount
  };
};
