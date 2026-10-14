/** @file Bounds shutdown of process groups owned by documented-example tests. */
import {shutdownFailure} from './documented-example-shutdown-diagnostics.ts';
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
  const alreadyStopped = await completedProcess(target, scheduler, limits.postExitMs);

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
  postExitMs: number
): Promise<CommandResult | undefined> => {
  const state = target.snapshot();

  if (state.error) {
    throw shutdownFailure(target, 'the child reported an error before shutdown');
  }

  if (state.hasClosed) {
    return await readClosedResult(target);
  }

  if (state.hasExited) {
    return await finishExitedProcess(target, scheduler, {kind: 'duration', milliseconds: postExitMs});
  }

  return undefined;
};

/** Requests SIGTERM and waits for exit or close within the graceful budget. */
const requestGracefulStop = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  limits: Readonly<ShutdownLimits>
): Promise<StopAttempt> => {
  const signalAttempt = signalIfOwned(target, 'SIGTERM');

  if (signalAttempt === 'skipped') {
    const stopped = await completedProcess(target, scheduler, limits.postExitMs);

    if (stopped) {
      return {kind: 'stopped', result: stopped};
    }

    throw shutdownFailure(target, 'cannot safely signal the owned process group');
  }

  const completedAfterSignal = await completedProcess(target, scheduler, limits.postExitMs);

  if (completedAfterSignal) {
    return {kind: 'stopped', result: completedAfterSignal};
  }

  const event = await waitForProcessEvent(target, scheduler, limits.gracefulMs);

  if (event.kind !== 'timeout') {
    return {kind: 'stopped', result: await completeEvent(target, event, scheduler, limits.postExitMs)};
  }

  const stopped = await completedProcess(target, scheduler, limits.postExitMs);
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
    const stopped = await completedProcess(target, scheduler, forcedMs);

    if (stopped) {
      return stopped;
    }

    throw shutdownFailure(target, 'cannot safely escalate the owned process group');
  }

  const deadline = scheduler.now() + forcedMs;
  const completedAfterSignal = await completedProcessUntil(target, scheduler, deadline);

  if (completedAfterSignal) {
    return completedAfterSignal;
  }

  const event = await waitForProcessEvent(target, scheduler, getRemainingTime(scheduler, deadline));

  if (event.kind !== 'timeout') {
    return await completeEventUntil(target, event, scheduler, deadline);
  }

  const stopped = await completedProcessUntil(target, scheduler, deadline);

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
    timer = scheduler.schedule(timeoutMs);
    return await Promise.race([eventPromise, timer.promise.then((): ProcessEventWait => ({kind: 'timeout'}))]);
  } catch (error) {
    throw shutdownFailure(target, 'observing child shutdown failed', error);
  } finally {
    timer?.cancel();
    removeListener();
  }
};

/** Completes an event and gives an exited child a bounded chance to close its pipes. */
const completeEvent = async (
  target: OwnedProcessTarget,
  event: ProcessShutdownEvent,
  scheduler: ShutdownScheduler,
  postExitMs: number
): Promise<CommandResult> => {
  if (event.kind === 'error') {
    throw shutdownFailure(target, 'the child reported an error while stopping', event.error);
  }

  if (event.kind === 'close') {
    return event.result;
  }

  return await finishExitedProcess(target, scheduler, {kind: 'duration', milliseconds: postExitMs});
};

/** Completes an event against the post-SIGKILL deadline without extending it. */
const completeEventUntil = async (
  target: OwnedProcessTarget,
  event: ProcessShutdownEvent,
  scheduler: ShutdownScheduler,
  deadline: number
): Promise<CommandResult> => {
  if (event.kind === 'error') {
    throw shutdownFailure(target, 'the child reported an error after SIGKILL', event.error);
  }

  if (event.kind === 'close') {
    return event.result;
  }

  return await finishExitedProcess(target, scheduler, {kind: 'deadline', at: deadline});
};

/** Releases parent pipes after exit and waits within the supplied finite budget. */
const finishExitedProcess = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  budget: CloseBudget
): Promise<CommandResult> => {
  const state = target.snapshot();

  if (state.error) {
    throw shutdownFailure(target, 'the child reported an error before pipe close');
  }

  if (state.hasClosed) {
    return await readClosedResult(target);
  }

  target.releasePipes();
  const timeoutMs = budget.kind === 'deadline' ? getRemainingTime(scheduler, budget.at) : budget.milliseconds;
  const result = await waitForClosed(target, scheduler, timeoutMs);

  if (result === undefined) {
    const reason =
      budget.kind === 'deadline'
        ? 'stdio did not close before the post-SIGKILL deadline'
        : `stdio did not close within ${budget.milliseconds} ms after child exit`;
    throw shutdownFailure(target, reason);
  }

  return result;
};

/** Returns a child result if it closes before the supplied timeout. */
const waitForClosed = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  timeoutMs: number
): Promise<CommandResult | undefined> => {
  const state = target.snapshot();

  if (state.error) {
    throw shutdownFailure(target, 'the child reported an error while waiting for close');
  }

  if (state.hasClosed) {
    return await readClosedResult(target);
  }

  const timer = scheduler.schedule(timeoutMs);

  try {
    const outcome: CloseWait = await Promise.race([
      target.closed.then((result): CloseWait => ({kind: 'closed', result})),
      timer.promise.then((): CloseWait => ({kind: 'timeout'}))
    ]);
    return outcome.kind === 'closed' ? outcome.result : undefined;
  } catch (error) {
    throw shutdownFailure(target, 'waiting for child close failed', error);
  } finally {
    timer.cancel();
  }
};

/** Resolves the close result after the lifecycle snapshot confirms closure. */
const readClosedResult = async (target: OwnedProcessTarget): Promise<CommandResult> => {
  try {
    return await target.closed;
  } catch (error) {
    throw shutdownFailure(target, 'the child close result was rejected', error);
  }
};

/** Checks completion after a timeout without confusing elapsed time with process exit. */
const completedProcessUntil = async (
  target: OwnedProcessTarget,
  scheduler: ShutdownScheduler,
  deadline: number
): Promise<CommandResult | undefined> => {
  const state = target.snapshot();

  if (state.error) {
    throw shutdownFailure(target, 'the child reported an error after shutdown timed out');
  }

  if (state.hasClosed) {
    return await readClosedResult(target);
  }

  if (state.hasExited) {
    return await finishExitedProcess(target, scheduler, {kind: 'deadline', at: deadline});
  }

  return undefined;
};

/** Returns the remaining time before a monotonic deadline. */
const getRemainingTime = (scheduler: ShutdownScheduler, deadline: number): number => {
  return Math.max(0, deadline - scheduler.now());
};
