/** @file Supplies deterministic in-memory process and timer fakes for shutdown tests. */
import type {
  CommandResult,
  OwnedProcessSnapshot,
  OwnedProcessTarget,
  ProcessShutdownEvent,
  ShutdownScheduler,
  ShutdownTimer,
  SignalAttempt
} from './documented-example-shutdown.ts';

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

type FakeShutdownObservationData =
  | {
      kind: 'signal';
      signal: NodeJS.Signals;
      pid: number | undefined;
      processGroupId: number | undefined;
      hasExited: boolean;
      hasClosed: boolean;
    }
  | {kind: 'release-pipes'; hasExited: boolean}
  | {kind: 'exit'}
  | {kind: 'close'}
  | {kind: 'error'; message: string};

/** In-memory lifecycle observations captured before callbacks run. */
export type FakeShutdownObservation = FakeShutdownObservationData & {time?: number | undefined};

/** Placeholder resolver replaced when a virtual timer is registered. */
const ignoreScheduledDelay = (): void => undefined;

/** Monotonic fake clock that advances only when a test requests it. */
export class ManualShutdownScheduler implements ShutdownScheduler {
  private currentTime = 0;
  private readonly entries: ScheduledEntry[] = [];
  private readonly scheduleWaiters: ScheduleWaiter[] = [];
  cancellationCount = 0;
  lastScheduledDelayMs = 0;

  /** Returns the current fake monotonic time.
   *
   * @returns The fake time in milliseconds.
   */
  now(): number {
    return this.currentTime;
  }

  /** Registers a cancellable delay without starting a real timer.
   *
   * @param delayMs Delay before the virtual timer fires.
   * @returns The virtual timer handle.
   */
  schedule(delayMs: number): ShutdownTimer {
    let resolvePromise: () => void = ignoreScheduledDelay;
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

  /** Returns the number of virtual timers registered so far.
   *
   * @returns Total timer registrations, including cancelled timers.
   */
  get scheduledTimerCount(): number {
    return this.entries.length;
  }

  /** Returns uncancelled timers, including timers fired but not yet finalized.
   *
   * @returns The number of still-pending timer handles.
   */
  get pendingTimerCount(): number {
    return this.entries.filter((entry) => !entry.cancelled).length;
  }

  /** Returns the earliest uncancelled timer that has not fired.
   *
   * @returns The next deadline, or undefined when no timer can advance time.
   */
  get nextDeadline(): number | undefined {
    let deadline: number | undefined;

    for (const entry of this.entries) {
      if (entry.cancelled || entry.fired) {
        continue;
      }

      deadline = deadline === undefined ? entry.deadline : Math.min(deadline, entry.deadline);
    }

    return deadline;
  }

  /** Resolves when the indexed timeout is registered by shutdown.
   *
   * @param index Zero-based timer registration index.
   * @returns A promise resolved when that timer exists.
   */
  waitForScheduledTimer(index: number): Promise<void> {
    if (this.entries.length > index) {
      return Promise.resolve();
    }

    return new Promise<void>((resolvePromise) => {
      this.scheduleWaiters.push({index, resolve: resolvePromise});
    });
  }

  /** Advances fake time and resolves every due, uncancelled delay.
   *
   * @param milliseconds Amount of virtual time to advance.
   * @returns Nothing; due virtual delays resolve synchronously.
   */
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

  /** Resolves only waiters whose requested timeout now exists. */
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
export class FakeShutdownTarget implements OwnedProcessTarget {
  /** Current process facts used by the shutdown algorithm. */
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

  /** Signal operations requested by the shutdown algorithm. */
  readonly signals: NodeJS.Signals[] = [];

  /** Lifecycle operations captured before the fake applies their callbacks. */
  readonly observations: FakeShutdownObservation[] = [];

  /** Promise resolved with complete output after the simulated stdio close. */
  readonly closed: Promise<CommandResult>;

  /** Result applied to each attempted signal. */
  signalResult: SignalAttempt = 'sent';

  /** Callback invoked after an attempted signal is recorded. */
  onSignal: (signal: NodeJS.Signals) => void = () => {};

  /** Callback invoked after parent-pipe release is recorded. */
  onReleasePipes: () => void = () => {};

  /** Number of parent-pipe release operations. */
  releasedPipeCount = 0;

  private readonly listeners = new Set<(event: ProcessShutdownEvent) => void>();
  private resolveClosed: (result: CommandResult) => void = () => {};
  private rejectClosed: (error: Error) => void = () => {};

  /** Creates a fake target with the existing snapshot defaults.
   *
   * @param overrides Selected initial process facts for a test case.
   * @param now Optional fake clock used to timestamp observations.
   */
  constructor(
    overrides: Partial<OwnedProcessSnapshot> = {},
    private readonly now?: (() => number) | undefined
  ) {
    Object.assign(this.state, overrides);
    this.closed = new Promise<CommandResult>((resolve, reject) => {
      this.resolveClosed = resolve;
      this.rejectClosed = reject;
    });
    void this.closed.catch(() => {});
  }

  /** Returns a copy of the current fake process facts.
   *
   * @returns A process snapshot with a copied argument list.
   */
  snapshot(): OwnedProcessSnapshot {
    return {...this.state, args: [...this.state.args]};
  }

  /** Registers a temporary shutdown observer.
   *
   * @param listener Callback receiving a fake process lifecycle event.
   * @returns A callback that removes the registered observer.
   */
  subscribe(listener: (event: ProcessShutdownEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Records a signal attempt and applies the test-selected result.
   *
   * @param signal Signal requested by the shutdown operation.
   * @returns The configured result of the signal attempt.
   */
  signalGroup(signal: NodeJS.Signals): SignalAttempt {
    this.signals.push(signal);
    this.recordObservation({
      kind: 'signal',
      signal,
      pid: this.state.pid,
      processGroupId: this.state.processGroupId,
      hasExited: this.state.hasExited,
      hasClosed: this.state.hasClosed
    });
    this.onSignal(signal);
    return this.signalResult;
  }

  /** Records parent-pipe release and applies the test's close behaviour.
   *
   * @returns Nothing; the operation is synchronous in this fake.
   */
  releasePipes(): void {
    this.releasedPipeCount += 1;
    this.recordObservation({kind: 'release-pipes', hasExited: this.state.hasExited});
    this.onReleasePipes();
  }

  /** Reports the direct child's exit without closing inherited pipes.
   *
   * @param exitCode Direct-child exit code, or null for signal termination.
   * @param signal Signal that caused termination, if any.
   * @returns Nothing; the event is delivered synchronously.
   */
  emitExit(exitCode: number | null = 0, signal: NodeJS.Signals | null = null): void {
    this.state.hasExited = true;
    this.state.exitCode = exitCode;
    this.state.signal = signal;
    this.recordObservation({kind: 'exit'});
    this.emit({kind: 'exit'});
  }

  /** Reports stdio closure and resolves the captured command result.
   *
   * @param result Full output and status returned by the simulated command.
   * @returns Nothing; the event is delivered synchronously.
   */
  emitClose(result: CommandResult): void {
    this.state.hasClosed = true;
    this.state.exitCode = result.exitCode;
    this.state.signal = result.signal;
    this.state.stdout = result.stdout;
    this.state.stderr = result.stderr;
    this.recordObservation({kind: 'close'});
    this.emit({kind: 'close', result});
    this.resolveClosed(result);
  }

  /** Reports a child error through both the event and close-result channels.
   *
   * @param error Error raised by the simulated child operation.
   * @returns Nothing; the event is delivered synchronously.
   */
  emitError(error: Error): void {
    this.state.error = error;
    this.recordObservation({kind: 'error', message: error.message});
    this.emit({kind: 'error', error});
    this.rejectClosed(error);
  }

  /** Returns the number of observers retained by this target.
   *
   * @returns The current listener count.
   */
  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Adds the optional fake-clock timestamp to one observation. */
  private recordObservation(observation: FakeShutdownObservationData): void {
    const time = this.now?.();
    this.observations.push(time === undefined ? observation : {...observation, time});
  }

  /** Notifies the current temporary shutdown observers. */
  private emit(event: ProcessShutdownEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
