/** @file Joins bounded shutdown when a documented-command allowance expires. */
import type {CommandResult, ShutdownScheduler} from './documented-example-shutdown-types.ts';

/** Inputs for waiting on command close and the bounded shutdown after expiry. */
export interface DocumentedCommandCompletionOptions {
  /** Resolves with the command output when its child closes. */
  closed: Promise<CommandResult>;
  /** Starts owned-process shutdown after the execution allowance expires. */
  shutdown: () => Promise<CommandResult>;
  /** Supplies the cancellable execution-allowance timer. */
  scheduler: ShutdownScheduler;
  /** Full command execution allowance before shutdown begins. */
  executionAllowanceMs: number;
  /** Stable example identifier for timeout diagnostics. */
  label: string;
}

type CommandCompletionOutcome = {kind: 'closed'; result: CommandResult} | {kind: 'expired'};

/**
 * Returns normal close results and waits for shutdown before reporting expiry.
 *
 * @param options Command close, bounded shutdown, scheduler, allowance, and label.
 * @returns The captured close result when the command closes within its allowance.
 * @throws Error when the allowance expires after shutdown settles. Shutdown
 * failures propagate unchanged.
 */
export const waitForDocumentedCommandCompletion = async (
  options: DocumentedCommandCompletionOptions
): Promise<CommandResult> => {
  const timer = options.scheduler.schedule(options.executionAllowanceMs);
  const closedOutcome = options.closed.then((result) => ({kind: 'closed', result}) as const);
  const expiredOutcome = timer.promise.then(() => ({kind: 'expired'}) as const);
  const outcome: CommandCompletionOutcome = await Promise.race([closedOutcome, expiredOutcome]).finally(() => {
    timer.cancel();
  });

  if (outcome.kind === 'closed') {
    return outcome.result;
  }

  const shutdownPromise = options.shutdown();
  const shutdownResult = await shutdownPromise;
  const timeoutMessage = [
    `${options.label} exceeded its ${options.executionAllowanceMs} ms command execution allowance`,
    shutdownResult.stdout,
    shutdownResult.stderr
  ].join('\n');
  throw new Error(timeoutMessage);
};
