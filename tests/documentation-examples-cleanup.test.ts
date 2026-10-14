/** @file Fault-tests bounded shutdown and idempotent example-fixture cleanup. */
import {describe, expect, it} from 'bun:test';
import {
  cleanupExampleResources,
  type ExampleCleanupActions,
  type ExampleCleanupObservation
} from './support/documented-example-cleanup.ts';
import {
  DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS,
  stopOwnedProcessGroup,
  type CommandResult,
  type OwnedProcessSnapshot,
  type OwnedProcessTarget,
  type ProcessShutdownEvent,
  type ShutdownScheduler,
  type ShutdownTimer,
  type SignalAttempt
} from './support/documented-example-shutdown.ts';

interface ScheduledEntry {
  deadline: number;
  resolve(): void;
  cancelled: boolean;
  fired: boolean;
}

/** Caller waiting for a specific fake timer registration. */
interface ScheduleWaiter {
  index: number;
  resolve(): void;
}

/** Monotonic fake clock that advances only when a test requests it. */
class ManualShutdownScheduler implements ShutdownScheduler {
  private currentTime = 0;
  private readonly entries: ScheduledEntry[] = [];
  private readonly scheduleWaiters: ScheduleWaiter[] = [];
  cancellationCount = 0;
  lastScheduledDelayMs = 0;

  /** Returns the current fake monotonic time. */
  now(): number {
    return this.currentTime;
  }

  /** Registers a cancellable delay without starting a real timer. */
  schedule(delayMs: number): ShutdownTimer {
    let resolvePromise: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const entry: ScheduledEntry = {
      deadline: this.currentTime + delayMs,
      resolve: resolvePromise,
      cancelled: false,
      fired: false
    };
    this.lastScheduledDelayMs = delayMs;
    this.entries.push(entry);
    this.resolveScheduleWaiters();

    return {
      promise,
      cancel: () => {
        if (entry.cancelled) {
          return;
        }

        entry.cancelled = true;
        this.cancellationCount += 1;
      }
    };
  }

  /** Resolves when the indexed timeout is registered by shutdown. */
  waitForScheduledTimer(index: number): Promise<void> {
    if (this.entries.length > index) {
      return Promise.resolve();
    }

    return new Promise<void>((resolvePromise) => {
      this.scheduleWaiters.push({index, resolve: resolvePromise});
    });
  }

  /** Advances fake time and resolves every due, uncancelled delay. */
  advanceBy(milliseconds: number): void {
    this.currentTime += milliseconds;

    for (const entry of this.entries) {
      if (entry.cancelled) {
        continue;
      }

      if (entry.fired) {
        continue;
      }

      if (entry.deadline > this.currentTime) {
        continue;
      }

      entry.fired = true;
      entry.resolve();
    }
  }

  /** Releases only waiters whose requested timeout now exists. */
  private resolveScheduleWaiters(): void {
    for (let index = this.scheduleWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.scheduleWaiters[index];

      if (waiter && this.entries.length > waiter.index) {
        this.scheduleWaiters.splice(index, 1);
        waiter.resolve();
      }
    }
  }
}

/** In-memory lifecycle target; it never starts or signals an operating-system process. */
class FakeShutdownTarget implements OwnedProcessTarget {
  readonly state: OwnedProcessSnapshot = {
    command: 'bun',
    args: ['simulation.ts'],
    pid: 4312,
    processGroupId: 4312,
    hasExited: false,
    hasClosed: false,
    exitCode: null,
    signal: null,
    stdout: 'server output',
    stderr: '',
    error: undefined
  };
  readonly signals: NodeJS.Signals[] = [];
  readonly closed: Promise<CommandResult>;
  signalResult: SignalAttempt = 'sent';
  onSignal: (signal: NodeJS.Signals) => void = () => undefined;
  onReleasePipes: () => void = () => undefined;
  releasedPipeCount = 0;
  private readonly listeners = new Set<(event: ProcessShutdownEvent) => void>();
  private resolveClosed: (result: CommandResult) => void = () => undefined;
  private rejectClosed: (error: Error) => void = () => undefined;

  constructor(overrides: Partial<OwnedProcessSnapshot> = {}) {
    Object.assign(this.state, overrides);
    this.closed = new Promise<CommandResult>((resolve, reject) => {
      this.resolveClosed = resolve;
      this.rejectClosed = reject;
    });
    void this.closed.catch(() => undefined);
  }

  /** Returns the current fake process facts. */
  snapshot(): OwnedProcessSnapshot {
    return {...this.state, args: [...this.state.args]};
  }

  /** Registers a temporary shutdown observer and returns its removal callback. */
  subscribe(listener: (event: ProcessShutdownEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Records a signal attempt and applies the test-selected result. */
  signalGroup(signal: NodeJS.Signals): SignalAttempt {
    this.signals.push(signal);
    this.onSignal(signal);
    return this.signalResult;
  }

  /** Records parent-pipe release and applies the test's close behaviour. */
  releasePipes(): void {
    this.releasedPipeCount += 1;
    this.onReleasePipes();
  }

  /** Reports the direct child's exit without closing inherited pipes. */
  emitExit(exitCode: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.state.hasExited = true;
    this.state.exitCode = exitCode;
    this.state.signal = signal;
    this.emit({kind: 'exit'});
  }

  /** Reports stdio closure and resolves the captured command result. */
  emitClose(result: CommandResult): void {
    this.state.hasClosed = true;
    this.state.exitCode = result.exitCode;
    this.state.signal = result.signal;
    this.state.stdout = result.stdout;
    this.state.stderr = result.stderr;
    this.emit({kind: 'close', result});
    this.resolveClosed(result);
  }

  /** Reports a child error through both the event and close-result channels. */
  emitError(error: Error): void {
    this.state.error = error;
    this.emit({kind: 'error', error});
    this.rejectClosed(error);
  }

  /** Returns the number of observers retained by this target. */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Notifies the current temporary shutdown observers. */
  private emit(event: ProcessShutdownEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

/** Creates cleanup operations with a stable fixture path and observable phases. */
const makeCleanupActions = (
  observations: ExampleCleanupObservation[],
  now: () => number,
  overrides: Partial<ExampleCleanupActions> = {}
): ExampleCleanupActions => ({
  fixturePath: overrides.fixturePath ?? '/cache/documented-examples-test',
  now: overrides.now ?? now,
  stop: overrides.stop ?? (async () => undefined),
  remove: overrides.remove ?? (async () => undefined),
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

    const failure = await stopping.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('sending SIGKILL to the owned process group failed');
    expect((failure as Error).cause).toBe(signalError);
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
