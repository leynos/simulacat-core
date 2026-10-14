/** @file Formats bounded diagnostics for owned example-process shutdown failures. */
import type {OwnedProcessSnapshot, OwnedProcessTarget} from './documented-example-shutdown-types.ts';

/**
 * Builds a bounded diagnostic with process identity, lifecycle facts, and output tails.
 *
 * @param target Owned child process that failed to stop cleanly.
 * @param reason Shutdown phase that failed.
 * @param cause Optional underlying signal, child, or close error.
 * @returns Error containing actionable process state and captured output.
 */
export const shutdownFailure = (target: OwnedProcessTarget, reason: string, cause?: unknown): Error => {
  const state = target.snapshot();
  const command = [state.command, ...state.args].join(' ');
  const details = [
    reason,
    `command=${command}`,
    `pid=${state.pid ?? 'unknown'} processGroup=${state.processGroupId ?? 'unknown'}`,
    `exitCode=${state.exitCode ?? 'unknown'} signal=${state.signal ?? 'none'}`,
    formatLifecycleTimestamps(state),
    formatSignalAttempt(state),
    `exited=${state.hasExited} closed=${state.hasClosed}`,
    `stdout=${outputTail(state.stdout)}`,
    `stderr=${outputTail(state.stderr)}`
  ];

  if (state.error) {
    details.push(`childError=${state.error.message}`);
  }

  return new Error(details.join('\n'), {cause: cause ?? state.error});
};

/** Formats lifecycle observations in diagnostic field order. */
const formatLifecycleTimestamps = (state: OwnedProcessSnapshot): string => {
  return `startedAtMs=${state.startedAt ?? 'unknown'} exitObservedAtMs=${state.exitObservedAt ?? 'unknown'} closeObservedAtMs=${state.closeObservedAt ?? 'unknown'}`;
};

/** Formats the last signal attempt and its factory-clock time. */
const formatSignalAttempt = (state: OwnedProcessSnapshot): string => {
  return `lastSignalAttempt=${state.lastSignalAttempt ?? 'none'} lastSignalAttemptAtMs=${state.lastSignalAttemptAt ?? 'unknown'}`;
};

/** Retains a bounded tail of captured child output. */
const outputTail = (output: string): string => {
  const limit = 2_000;

  if (output.length <= limit) {
    return output;
  }

  return `[truncated] ${output.slice(-limit)}`;
};
