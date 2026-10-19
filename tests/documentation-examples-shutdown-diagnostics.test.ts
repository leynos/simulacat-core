/** @file Checks shutdown diagnostics against the failed lifecycle observation. */
import {describe, expect, it} from 'bun:test';
import {
  stopOwnedProcessGroup,
  type CommandResult,
  type OwnedProcessSnapshot,
  type OwnedProcessTarget,
  type ShutdownScheduler
} from './support/documented-example-shutdown.ts';

interface FaultTargetFixture {
  target: OwnedProcessTarget;
  snapshotCount(): number;
}

describe('documented-example shutdown diagnostics', () => {
  it('formats the first errored snapshot without touching other lifecycle operations', async () => {
    const childError = new Error('first child failure');
    const firstSnapshot = makeSnapshot('first-command', childError);
    const laterSnapshot = makeSnapshot('later-command', new Error('later failure'));
    const fixture = createFaultTarget(firstSnapshot, laterSnapshot);
    const failure = await stopOwnedProcessGroup(fixture.target, makeForbiddenScheduler()).catch(
      (error: Error) => error
    );

    if (!(failure instanceof Error)) {
      throw new Error('shutdown should reject with a diagnostic Error');
    }

    expect(failure.cause).toBe(childError);
    expect(failure.message).toContain('the child reported an error before shutdown');
    expect(failure.message).toContain('command=first-command --first');
    expect(failure.message).toContain('pid=713 processGroup=713');
    expect(failure.message).toContain('exitCode=17 signal=SIGTERM');
    expect(fixture.snapshotCount()).toBe(1);
  });
});

/** Builds a process target whose first and later observations differ. */
const createFaultTarget = (
  firstSnapshot: OwnedProcessSnapshot,
  laterSnapshot: OwnedProcessSnapshot
): FaultTargetFixture => {
  let snapshotCount = 0;
  const target: OwnedProcessTarget = {
    closed: new Promise<CommandResult>(() => {}),
    snapshot: () => {
      snapshotCount += 1;
      return snapshotCount === 1 ? firstSnapshot : laterSnapshot;
    },
    subscribe: () => {
      throw new Error('subscribe must not run');
    },
    signalGroup: () => {
      throw new Error('signal must not run');
    },
    releasePipes: () => {
      throw new Error('pipe release must not run');
    }
  };

  return {target, snapshotCount: () => snapshotCount};
};

/** Creates a scheduler that fails if shutdown unexpectedly waits. */
const makeForbiddenScheduler = (): ShutdownScheduler => ({
  now: () => {
    throw new Error('clock must not run');
  },
  schedule: () => {
    throw new Error('timer must not run');
  }
});

/** Creates distinguishable process facts for the single-observation contract. */
const makeSnapshot = (command: string, error: Error): OwnedProcessSnapshot => ({
  command,
  args: ['--first'],
  pid: 713,
  processGroupId: 713,
  hasExited: true,
  hasClosed: true,
  exitCode: 17,
  signal: 'SIGTERM',
  stdout: 'first stdout',
  stderr: 'first stderr',
  error,
  startedAt: 1,
  exitObservedAt: 2,
  closeObservedAt: 3,
  lastSignalAttempt: 'SIGTERM',
  lastSignalAttemptAt: 4
});
