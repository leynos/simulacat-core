/** @file Fault-tests bounded shutdown and idempotent example-fixture cleanup. */
import {describe, expect, it} from 'bun:test';
import {FakeShutdownTarget, ManualShutdownScheduler} from './support/documented-example-shutdown-fakes.ts';
import {
  cleanupExampleResources,
  type ExampleCleanupActions,
  type ExampleCleanupObservation
} from './support/documented-example-cleanup.ts';
import {DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS, stopOwnedProcessGroup} from './support/documented-example-shutdown.ts';

/** Creates cleanup operations with a stable fixture path and observable phases. */
const makeCleanupActions = (
  observations: ExampleCleanupObservation[],
  now: () => number,
  overrides: Partial<ExampleCleanupActions> = {}
): ExampleCleanupActions => ({
  fixturePath: overrides.fixturePath ?? '/cache/documented-examples-test',
  now: overrides.now ?? now,
  stop: overrides.stop ?? (async () => {}),
  remove: overrides.remove ?? (async () => {}),
  observe: overrides.observe ?? ((observation) => observations.push(observation))
});

describe('documented-example process shutdown graceful termination', () => {
  it('returns full output when SIGTERM is followed by exit and close', async () => {
    const target = new FakeShutdownTarget();
    const result = {stdout: 'final output', stderr: 'diagnostic', exitCode: 0, signal: null};
    target.onSignal = () => {
      target.emitExit();
      target.emitClose(result);
    };

    await expect(
      stopOwnedProcessGroup(target, new ManualShutdownScheduler(), DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS)
    ).resolves.toEqual(result);
    expect(target.signals).toEqual(['SIGTERM']);
  });

  it('releases held parent pipes only after the direct child exits', async () => {
    const target = new FakeShutdownTarget();
    const result = {stdout: 'captured before exit', stderr: '', exitCode: 0, signal: null};
    target.onSignal = () => target.emitExit();
    target.onReleasePipes = () => target.emitClose(result);

    await expect(stopOwnedProcessGroup(target, new ManualShutdownScheduler())).resolves.toEqual(result);
    expect(target.releasedPipeCount).toBe(1);
    expect(target.signals).toEqual(['SIGTERM']);
    expect(target.listenerCount).toBe(0);
  });
});

describe('documented-example process shutdown escalation', () => {
  it('escalates once and accepts the resulting close event', async () => {
    const target = new FakeShutdownTarget();
    const scheduler = new ManualShutdownScheduler();
    const result = {stdout: 'killed output', stderr: '', exitCode: null, signal: 'SIGKILL' as const};
    target.onSignal = (signal) => {
      if (signal === 'SIGKILL') {
        target.emitExit(null, 'SIGKILL');
        target.emitClose(result);
      }
    };
    const stopping = stopOwnedProcessGroup(target, scheduler);

    await scheduler.waitForScheduledTimer(0);
    scheduler.advanceBy(DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS.gracefulMs);

    await expect(stopping).resolves.toEqual(result);
    expect(target.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(scheduler.cancellationCount).toBe(1);
    expect(target.listenerCount).toBe(0);
  });

  it('keeps pipe-close waiting inside the original forced deadline', async () => {
    const target = new FakeShutdownTarget();
    const scheduler = new ManualShutdownScheduler();
    const stopping = stopOwnedProcessGroup(target, scheduler);

    await scheduler.waitForScheduledTimer(0);
    scheduler.advanceBy(DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS.gracefulMs);
    await scheduler.waitForScheduledTimer(1);
    scheduler.advanceBy(DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS.forcedMs - 1);
    target.emitExit();
    await scheduler.waitForScheduledTimer(2);

    expect(scheduler.lastScheduledDelayMs).toBe(1);
    scheduler.advanceBy(1);

    await expect(stopping).rejects.toThrow('stdio did not close before the post-SIGKILL deadline');
    expect(target.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(target.releasedPipeCount).toBe(1);
    expect(target.listenerCount).toBe(0);
    expect(scheduler.cancellationCount).toBe(3);
  });

  it('treats ESRCH as a signal result and still requires observed completion', async () => {
    const target = new FakeShutdownTarget();
    const scheduler = new ManualShutdownScheduler();
    const result = {stdout: 'observed close', stderr: '', exitCode: 0, signal: null};
    target.signalResult = 'group-missing';
    const stopping = stopOwnedProcessGroup(target, scheduler);
    await scheduler.waitForScheduledTimer(0);
    target.emitExit();
    target.emitClose(result);

    await expect(stopping).resolves.toEqual(result);
    expect(target.signals).toEqual(['SIGTERM']);
  });
});

describe('documented-example process shutdown failures', () => {
  it('rejects child errors instead of returning empty output', async () => {
    const target = new FakeShutdownTarget();
    const scheduler = new ManualShutdownScheduler();
    const stopping = stopOwnedProcessGroup(target, scheduler);
    await scheduler.waitForScheduledTimer(0);
    target.emitError(new Error('spawn failed'));

    await expect(stopping).rejects.toThrow('spawn failed');
    expect(target.listenerCount).toBe(0);
  });

  it('does not signal an exited child or a group without valid ownership', async () => {
    const exited = new FakeShutdownTarget();
    const result = {stdout: '', stderr: '', exitCode: 0, signal: null};
    exited.emitExit();
    exited.onReleasePipes = () => exited.emitClose(result);
    await stopOwnedProcessGroup(exited, new ManualShutdownScheduler());

    const invalid = new FakeShutdownTarget({processGroupId: 9999});
    await expect(stopOwnedProcessGroup(invalid, new ManualShutdownScheduler())).rejects.toThrow(
      'cannot safely signal the owned process group'
    );
    expect(exited.signals).toEqual([]);
    expect(invalid.signals).toEqual([]);
  });

  it('propagates SIGKILL failures through shutdown after the grace timer', async () => {
    const target = new FakeShutdownTarget();
    const scheduler = new ManualShutdownScheduler();
    const signalError = new Error('signal denied');
    target.onSignal = (signal) => {
      if (signal === 'SIGKILL') {
        throw signalError;
      }
    };
    const stopping = stopOwnedProcessGroup(target, scheduler);

    await scheduler.waitForScheduledTimer(0);
    scheduler.advanceBy(DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS.gracefulMs);

    const failure = await stopping.catch((error: Error) => error);
    if (!(failure instanceof Error)) throw new Error('shutdown should reject with an Error');
    expect(failure.message).toContain('sending SIGKILL to the owned process group failed');
    expect(failure.cause).toBe(signalError);
    expect(target.listenerCount).toBe(0);
    expect(scheduler.cancellationCount).toBe(1);
  });
});

describe('documented-example fixture cleanup after shutdown failure', () => {
  it('removes the fixture after a bounded post-SIGKILL timeout', async () => {
    const target = new FakeShutdownTarget();
    const scheduler = new ManualShutdownScheduler();
    const observations: ExampleCleanupObservation[] = [];
    let removalAttempted = false;
    const cleanup = cleanupExampleResources(
      {},
      makeCleanupActions(observations, () => scheduler.now(), {
        stop: async () => {
          await stopOwnedProcessGroup(target, scheduler);
        },
        remove: async () => {
          removalAttempted = true;
        }
      })
    );

    await scheduler.waitForScheduledTimer(0);
    scheduler.advanceBy(DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS.gracefulMs);
    await scheduler.waitForScheduledTimer(1);
    scheduler.advanceBy(DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS.forcedMs);

    await expect(cleanup).rejects.toThrow('did not exit within');
    expect(removalAttempted).toBe(true);
    expect(target.listenerCount).toBe(0);
    expect(scheduler.cancellationCount).toBe(2);
    expect(observations.map(({phase, status}) => [phase, status])).toContainEqual(['removal', 'completed']);
  });
});
