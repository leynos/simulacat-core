/** @file Defines independent lifecycle assertions for generated shutdown schedules. */
import {expect} from 'bun:test';
import type {CommandResult, SignalAttempt} from './documented-example-shutdown.ts';
import type {FakeShutdownObservation} from './documented-example-shutdown-fakes.ts';
import type {ShutdownScenario} from './documented-example-shutdown-scenarios.ts';

type ShutdownOutcome =
  | {kind: 'closed'; result: CommandResult; settledAt: number}
  | {kind: 'rejected'; error: unknown; settledAt: number};

/** Captured observations compared with a generated shutdown schedule. */
export interface ShutdownRun {
  outcome: ShutdownOutcome;
  observations: readonly FakeShutdownObservation[];
  configuredSignalResult: SignalAttempt;
  releasedPipeCount: number;
  pendingTimerCount: number;
  listenerCount: number;
}

interface ShutdownExpectation {
  signals: NodeJS.Signals[];
  outcome: 'closed' | 'rejected';
  rejectionMessage: string | undefined;
  releasedPipeCount: number;
}

const OWNED_PROCESS_ID = 4312;
const CLOSED_RESULT: CommandResult = {
  stdout: 'captured final output',
  stderr: 'captured diagnostic',
  exitCode: 0,
  signal: null
};

/** Compares captured lifecycle facts with independent scenario expectations.
 *
 * @param scenario Generated signal-result and timing requirements.
 * @param actual Captured shutdown observations and resource counts.
 * @returns Nothing when every lifecycle invariant holds.
 * @throws Error when an outcome, ownership fact, deadline, or cleanup count differs.
 */
export const assertShutdownTrace = (scenario: ShutdownScenario, actual: ShutdownRun): void => {
  const expected = expectationFor(scenario);
  expect(actual.configuredSignalResult).toBe(scenario.signalResult);
  const signals = signalObservations(actual.observations);
  assertOwnedSignals(signals);
  expect(signals.map(({signal}) => signal)).toEqual(expected.signals);
  assertPipesFollowExit(actual.observations);
  expect(actual.releasedPipeCount).toBe(expected.releasedPipeCount);
  expect(actual.pendingTimerCount).toBe(0);
  expect(actual.listenerCount).toBe(0);
  assertClosedOutcomeHasCloseEvent(actual);
  assertOutcomeMatches(actual.outcome, expected);
  assertSettlementBudget(scenario, actual);
};

/** Requires the model to reject three deliberately impossible lifecycle traces.
 *
 * @returns Nothing when ownership, pipe ordering, and original deadline checks are sensitive.
 * @throws Error when any deliberately invalid trace satisfies the model.
 */
export const assertShutdownOracleSensitivity = (): void => {
  const forcedScenario: Extract<ShutdownScenario, {kind: 'forced-close'}> = {
    kind: 'forced-close',
    limits: {gracefulMs: 2, forcedMs: 3, postExitMs: 2},
    signalResult: 'sent'
  };
  const validForcedTrace = createForcedCloseTrace();
  assertShutdownTrace(forcedScenario, validForcedTrace);

  const unownedSignal = createSignalObservation('SIGKILL', 2, OWNED_PROCESS_ID + 1);
  expect(() =>
    assertShutdownTrace(forcedScenario, {
      ...validForcedTrace,
      observations: validForcedTrace.observations.map((observation) => {
        if (observation.kind !== 'signal') {
          return observation;
        }

        return observation.signal === 'SIGKILL' ? unownedSignal : observation;
      })
    })
  ).toThrow();

  const deadlineScenario: Extract<ShutdownScenario, {kind: 'exit-before-deadline'}> = {
    kind: 'exit-before-deadline',
    limits: {gracefulMs: 2, forcedMs: 3, postExitMs: 2},
    exitOffset: 2,
    signalResult: 'sent'
  };
  const deadlineTrace = createExitDeadlineTrace();
  assertShutdownTrace(deadlineScenario, deadlineTrace);

  const earlyRelease: FakeShutdownObservation = {kind: 'release-pipes', hasExited: false, time: 3};
  expect(() =>
    assertShutdownTrace(deadlineScenario, {
      ...deadlineTrace,
      observations: [
        createSignalObservation('SIGTERM', 0),
        createSignalObservation('SIGKILL', 2),
        earlyRelease,
        {kind: 'exit', time: 4}
      ]
    })
  ).toThrow();

  const restartedDeadline =
    deadlineScenario.limits.gracefulMs + deadlineScenario.exitOffset + deadlineScenario.limits.forcedMs;
  expect(() =>
    assertShutdownTrace(deadlineScenario, {
      ...deadlineTrace,
      outcome: {...deadlineTrace.outcome, settledAt: restartedDeadline}
    })
  ).toThrow();
};

/** Returns expected signal order, result, and pipe-release count. */
const expectationFor = (scenario: ShutdownScenario): ShutdownExpectation => {
  if (scenario.kind === 'graceful-close') {
    return {signals: ['SIGTERM'], outcome: 'closed', rejectionMessage: undefined, releasedPipeCount: 1};
  }

  if (scenario.kind === 'forced-close') {
    return {signals: ['SIGTERM', 'SIGKILL'], outcome: 'closed', rejectionMessage: undefined, releasedPipeCount: 0};
  }

  if (scenario.kind === 'exit-before-deadline') {
    return {
      signals: ['SIGTERM', 'SIGKILL'],
      outcome: 'rejected',
      rejectionMessage: 'stdio did not close before the post-SIGKILL deadline',
      releasedPipeCount: 1
    };
  }

  return {
    signals: ['SIGTERM', 'SIGKILL'],
    outcome: 'rejected',
    rejectionMessage: `the child did not exit within ${scenario.limits.forcedMs} ms after SIGKILL`,
    releasedPipeCount: 0
  };
};

/** Checks every signal snapshot identifies the active, positively owned group. */
const assertOwnedSignals = (signals: readonly SignalObservation[]): void => {
  for (const signal of signals) {
    expect(Number.isInteger(signal.pid)).toBe(true);
    expect(signal.pid ?? 0).toBeGreaterThan(0);
    expect(signal.processGroupId).toBe(signal.pid);
    expect(signal.hasExited).toBe(false);
    expect(signal.hasClosed).toBe(false);
  }
};

/** Requires captured success to include the stdio-close lifecycle event. */
const assertClosedOutcomeHasCloseEvent = (actual: ShutdownRun): void => {
  if (actual.outcome.kind === 'closed') {
    expect(actual.observations.some((observation) => observation.kind === 'close')).toBe(true);
  }
};

/** Requires every parent-pipe release to follow the observed direct-child exit. */
const assertPipesFollowExit = (observations: readonly FakeShutdownObservation[]): void => {
  const exitIndex = observations.findIndex((observation) => observation.kind === 'exit');
  const releases = observations
    .map((observation, index) => ({observation, index}))
    .filter(({observation}) => observation.kind === 'release-pipes');

  for (const release of releases) {
    if (release.observation.kind === 'release-pipes') {
      expect(release.observation.hasExited).toBe(true);
      expect(exitIndex).toBeGreaterThanOrEqual(0);
      expect(release.index).toBeGreaterThan(exitIndex);
    }
  }
};

/** Dispatches to the captured-close or rejection contract selected by the model. */
const assertOutcomeMatches = (actual: ShutdownOutcome, expected: ShutdownExpectation): void => {
  if (expected.outcome === 'closed') {
    assertClosedOutcome(actual);
    return;
  }

  assertRejectedOutcome(actual, expected.rejectionMessage);
};

/** Checks that a successful outcome contains the expected captured command result. */
const assertClosedOutcome = (actual: ShutdownOutcome): void => {
  if (actual.kind !== 'closed') {
    throw new Error('shutdown model expected captured output and close status');
  }

  expect(actual.result).toEqual(CLOSED_RESULT);
};

/** Checks the rejected outcome and the model-selected failure message. */
const assertRejectedOutcome = (actual: ShutdownOutcome, expectedRejectionMessage: string | undefined): void => {
  if (actual.kind !== 'rejected') {
    throw new Error('shutdown model expected the selected finite deadline failure');
  }

  if (expectedRejectionMessage === undefined) {
    throw new Error('shutdown model requires a specific rejection message');
  }

  const message = actual.error instanceof Error ? actual.error.message : String(actual.error);
  expect(message).toContain(expectedRejectionMessage);
};

/** Enforces each generated case's original absolute shutdown budget. */
const assertSettlementBudget = (scenario: ShutdownScenario, actual: ShutdownRun): void => {
  if (scenario.kind === 'graceful-close') {
    const close = actual.observations.find((observation) => observation.kind === 'close');
    expect(close?.time).toBe(scenario.closeOffset);
    expect(actual.outcome.settledAt).toBeLessThanOrEqual(scenario.limits.postExitMs);
    return;
  }

  const kill = signalObservations(actual.observations).find((observation) => observation.signal === 'SIGKILL');

  if (kill?.time === undefined) {
    throw new Error('forced shutdown model requires a timestamped SIGKILL observation');
  }

  expect(kill.time).toBe(scenario.limits.gracefulMs);
  const deadline = scenario.limits.gracefulMs + scenario.limits.forcedMs;
  expect(actual.outcome.settledAt).toBeLessThanOrEqual(deadline);

  if (scenario.kind !== 'forced-close') {
    expect(actual.outcome.settledAt).toBe(deadline);
  }
};

/** Narrows observed signal operations for ownership and ordering assertions. */
const signalObservations = (observations: readonly FakeShutdownObservation[]): SignalObservation[] => {
  return observations.filter((observation): observation is SignalObservation => observation.kind === 'signal');
};

type SignalObservation = Extract<FakeShutdownObservation, {kind: 'signal'}>;

/** Builds a successful synthetic trace for model sensitivity checks. */
const createForcedCloseTrace = (): ShutdownRun => ({
  outcome: {kind: 'closed', result: CLOSED_RESULT, settledAt: 2},
  observations: [
    createSignalObservation('SIGTERM', 0),
    createSignalObservation('SIGKILL', 2),
    {kind: 'exit', time: 2},
    {kind: 'close', time: 2}
  ],
  configuredSignalResult: 'sent',
  releasedPipeCount: 0,
  pendingTimerCount: 0,
  listenerCount: 0
});

/** Builds an original-deadline failure trace for the reset-deadline control. */
const createExitDeadlineTrace = (): ShutdownRun => ({
  outcome: {
    kind: 'rejected',
    error: new Error('stdio did not close before the post-SIGKILL deadline'),
    settledAt: 5
  },
  observations: [
    createSignalObservation('SIGTERM', 0),
    createSignalObservation('SIGKILL', 2),
    {kind: 'exit', time: 4},
    {kind: 'release-pipes', hasExited: true, time: 4}
  ],
  configuredSignalResult: 'sent',
  releasedPipeCount: 1,
  pendingTimerCount: 0,
  listenerCount: 0
});

/** Creates a signal observation with the synthetic owned group identity. */
const createSignalObservation = (
  signal: NodeJS.Signals,
  time: number,
  processGroupId = OWNED_PROCESS_ID
): SignalObservation => ({
  kind: 'signal',
  signal,
  pid: OWNED_PROCESS_ID,
  processGroupId,
  hasExited: false,
  hasClosed: false,
  time
});
