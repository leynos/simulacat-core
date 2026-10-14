/** @file Bounds shutdown of process groups owned by documented-example tests. */
import {shutdownFailure, shutdownFailureFromSnapshot} from './documented-example-shutdown-diagnostics.ts';
import {
  DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS,
  type CommandResult,
  type OwnedProcessSnapshot,
  type OwnedProcessTarget,
  type ProcessShutdownEvent,
  type ShutdownLimits,
  type ShutdownScheduler,
  type ShutdownTimer,
  type SignalAttempt
} from './documented-example-shutdown-types.ts';

export {
  DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS,
  type CommandResult,
  type OwnedProcessSnapshot,
  type OwnedProcessTarget,
  type ProcessShutdownEvent,
  type ShutdownLimits,
  type ShutdownScheduler,
  type ShutdownTimer,
  type SignalAttempt
} from './documented-example-shutdown-types.ts';

type ProcessEventWait = ProcessShutdownEvent | {kind: 'timeout'};
type StopAttempt = {kind: 'stopped'; result: CommandResult} | {kind: 'pending'};
type CloseWait = {kind: 'closed'; result: CommandResult} | {kind: 'timeout'};
/** Budget form used for post-exit pipe closure. */
type CloseBudget = {kind: 'duration'; milliseconds: number} | {kind: 'deadline'; at: number};
type CloseWaitPolicy = {timeoutMs: number; failureMessage: string};
/** Budget and phase-specific child-error message for one completion check. */
type CompletionContext = {budget: CloseBudget; errorMessage: string};

/**
 * Stops an owned process group with a graceful signal and a finite escalation.
 *
 * @param target Factory-owned process operations and live lifecycle facts.
 * @param scheduler Monotonic clock and cancellable timeout provider.
 * @param limits Grace, post-kill, and post-exit time bounds.
 * @returns The captured output and verified close result.
 * @throws Error when ownership is invalid, signalling fails, or shutdown times out.
 */
export const stopOwnedProcessGroup = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  limits: Readonly<ShutdownLimits> = DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS
): Promise<CommandResult> => {
  const alreadyStopped = await completedProcess(target, scheduler, {
    budget: {kind: 'duration', milliseconds: limits.postExitMs},
    errorMessage: 'the child reported an error before shutdown'
  });

  if (alreadyStopped) {
    return alreadyStopped;
  }

  const graceful = await requestGracefulStop(target, scheduler, limits);

  if (graceful.kind === 'stopped') {
    return graceful.result;
  }

  return await requestForcedStop(target, scheduler, limits.forcedMs);
};

/** Returns a completed child result or waits for close after a recorded exit. */
const completedProcess = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  context: CompletionContext
): Promise<CommandResult | undefined> => {
  const state = checkedSnapshot(target, context.errorMessage);

  if (state.hasClosed) {
    return await observeShutdownResult(target, 'the child close result was rejected', () => target.closed);
  }

  if (state.hasExited) {
    return await finishExitedProcess(target, scheduler, context.budget);
  }

  return undefined;
};

/** Returns one lifecycle observation after preserving errors from that snapshot. */
const checkedSnapshot = (target: OwnedProcessTarget, reason: string): OwnedProcessSnapshot => {
  const state = target.snapshot();

  if (state.error) {
    throw shutdownFailureFromSnapshot(state, reason);
  }

  return state;
};

/** Requests SIGTERM and waits for exit or close within the graceful budget. */
const requestGracefulStop = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  limits: Readonly<ShutdownLimits>
): Promise<StopAttempt> => {
  const signalAttempt = signalIfOwned(target, 'SIGTERM');

  if (signalAttempt === 'skipped') {
    const stopped = await completedProcess(target, scheduler, {
      budget: {kind: 'duration', milliseconds: limits.postExitMs},
      errorMessage: 'the child reported an error before shutdown'
    });

    if (stopped) {
      return {kind: 'stopped', result: stopped};
    }

    throw shutdownFailure(target, 'cannot safely signal the owned process group');
  }

  const completedAfterSignal = await completedProcess(target, scheduler, {
    budget: {kind: 'duration', milliseconds: limits.postExitMs},
    errorMessage: 'the child reported an error before shutdown'
  });

  if (completedAfterSignal) {
    return {kind: 'stopped', result: completedAfterSignal};
  }

  const event = await waitForProcessEvent(target, scheduler, limits.gracefulMs);

  if (event.kind !== 'timeout') {
    return {
      kind: 'stopped',
      result: await completeEvent(target, event, scheduler, {
        budget: {kind: 'duration', milliseconds: limits.postExitMs},
        errorMessage: 'the child reported an error while stopping'
      })
    };
  }

  const stopped = await completedProcess(target, scheduler, {
    budget: {kind: 'duration', milliseconds: limits.postExitMs},
    errorMessage: 'the child reported an error before shutdown'
  });
  return stopped ? {kind: 'stopped', result: stopped} : {kind: 'pending'};
};

/** Sends SIGKILL only to a still-running group and enforces its final deadline. */
const requestForcedStop = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  forcedMs: number
): Promise<CommandResult> => {
  const signalAttempt = signalIfOwned(target, 'SIGKILL');

  if (signalAttempt === 'skipped') {
    const stopped = await completedProcess(target, scheduler, {
      budget: {kind: 'duration', milliseconds: forcedMs},
      errorMessage: 'the child reported an error before shutdown'
    });

    if (stopped) {
      return stopped;
    }

    throw shutdownFailure(target, 'cannot safely escalate the owned process group');
  }

  const deadline = scheduler.now() + forcedMs;
  const completionContext: CompletionContext = {
    budget: {kind: 'deadline', at: deadline},
    errorMessage: 'the child reported an error after shutdown timed out'
  };
  const completedAfterSignal = await completedProcess(target, scheduler, completionContext);

  if (completedAfterSignal) {
    return completedAfterSignal;
  }

  const event = await waitForProcessEvent(target, scheduler, getRemainingTime(scheduler, deadline));

  if (event.kind !== 'timeout') {
    return await completeEvent(target, event, scheduler, {
      budget: {kind: 'deadline', at: deadline},
      errorMessage: 'the child reported an error after SIGKILL'
    });
  }

  const stopped = await completedProcess(target, scheduler, completionContext);

  if (stopped) {
    return stopped;
  }

  throw shutdownFailure(target, `the child did not exit within ${forcedMs} ms after SIGKILL`);
};

/** Attempts one signal and turns non-ESRCH failures into actionable errors. */
const signalIfOwned = (target: OwnedProcessTarget, signal: NodeJS.Signals): SignalAttempt => {
  const state = target.snapshot();

  if (!isSignalable(state)) {
    return 'skipped';
  }

  try {
    return target.signalGroup(signal);
  } catch (error) {
    throw shutdownFailure(target, `sending ${signal} to the owned process group failed`, error);
  }
};

/** Checks PID, group identity, and lifecycle state before allowing a signal. */
const isSignalable = (state: OwnedProcessSnapshot): boolean => {
  if (!isPositivePid(state.pid)) {
    return false;
  }

  if (state.processGroupId !== state.pid) {
    return false;
  }

  if (state.hasExited || state.hasClosed) {
    return false;
  }

  return state.error === undefined;
};

/** Checks that a captured process identifier is positive and integral. */
const isPositivePid = (pid: number | undefined): boolean => {
  if (pid === undefined) {
    return false;
  }

  if (!Number.isInteger(pid)) {
    return false;
  }

  return pid > 0;
};

/** Waits for one exit, close, or error event and always releases its timer/listener. */
const waitForProcessEvent = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  timeoutMs: number
): Promise<ProcessEventWait> => {
  let removeListener = (): void => undefined;
  let timer: ShutdownTimer | undefined;
  const eventPromise = new Promise<ProcessShutdownEvent>((resolvePromise, rejectPromise) => {
    removeListener = target.subscribe((event) => {
      if (event.kind === 'error') {
        rejectPromise(event.error);
        return;
      }

      resolvePromise(event);
    });
  });

  try {
    return await observeShutdownResult(target, 'observing child shutdown failed', () => {
      timer = scheduler.schedule(timeoutMs);
      return Promise.race([eventPromise, timer.promise.then((): ProcessEventWait => ({kind: 'timeout'}))]);
    });
  } finally {
    timer?.cancel();
    removeListener();
  }
};

/** Completes an event within its budget and preserves the phase diagnostic. */
const completeEvent = async (
  target: OwnedProcessTarget,
  event: ProcessShutdownEvent,
  scheduler: ShutdownScheduler,
  context: CompletionContext
): Promise<CommandResult> => {
  if (event.kind === 'error') {
    throw shutdownFailure(target, context.errorMessage, event.error);
  }

  if (event.kind === 'close') {
    return event.result;
  }

  return await finishExitedProcess(target, scheduler, context.budget);
};

/** Releases parent pipes after exit and waits within the supplied finite budget. */
const finishExitedProcess = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  budget: CloseBudget
): Promise<CommandResult> => {
  const state = checkedSnapshot(target, 'the child reported an error before pipe close');

  if (state.hasClosed) {
    return await observeShutdownResult(target, 'the child close result was rejected', () => target.closed);
  }

  target.releasePipes();
  const policy = closeWaitPolicy(scheduler, budget);
  const result = await waitForClosed(target, scheduler, policy.timeoutMs);

  if (result === undefined) {
    throw shutdownFailure(target, policy.failureMessage);
  }

  return result;
};

/** Returns a child result if it closes before the supplied timeout. */
const waitForClosed = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  timeoutMs: number
): Promise<CommandResult | undefined> => {
  const state = checkedSnapshot(target, 'the child reported an error while waiting for close');

  if (state.hasClosed) {
    return await observeShutdownResult(target, 'the child close result was rejected', () => target.closed);
  }

  const timer = scheduler.schedule(timeoutMs);

  try {
    return await observeShutdownResult(target, 'waiting for child close failed', async () => {
      const outcome: CloseWait = await Promise.race([
        target.closed.then((result): CloseWait => ({kind: 'closed', result})),
        timer.promise.then((): CloseWait => ({kind: 'timeout'}))
      ]);
      return outcome.kind === 'closed' ? outcome.result : undefined;
    });
  } finally {
    timer.cancel();
  }
};

/** Applies the shared shutdown diagnostic to one asynchronous observation. */
const observeShutdownResult = async <T>(
  target: OwnedProcessTarget,
  reason: string,
  operation: () => Promise<T>
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw shutdownFailure(target, reason, error);
  }
};

/** Pairs each post-exit wait duration with its phase-specific timeout diagnostic. */
const closeWaitPolicy = (scheduler: ShutdownScheduler, budget: CloseBudget): CloseWaitPolicy => {
  if (budget.kind === 'deadline') {
    return {
      timeoutMs: getRemainingTime(scheduler, budget.at),
      failureMessage: 'stdio did not close before the post-SIGKILL deadline'
    };
  }

  return {
    timeoutMs: budget.milliseconds,
    failureMessage: `stdio did not close within ${budget.milliseconds} ms after child exit`
  };
};

/** Returns the remaining time before a monotonic deadline. */
const getRemainingTime = (scheduler: ShutdownScheduler, deadline: number): number => {
  return Math.max(0, deadline - scheduler.now());
};
