/** @file Defines the process facts and scheduler contract used by example shutdown. */

/** Captured output and exit status from one command process. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

/** Current process facts needed to decide whether an owned group is signalable. */
export interface OwnedProcessSnapshot {
  command: string;
  args: readonly string[];
  pid: number | undefined;
  processGroupId: number | undefined;
  hasExited: boolean;
  hasClosed: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: Error | undefined;
  /** Factory-clock time when the child process was spawned. */
  startedAt?: number | undefined;
  /** Factory-clock time when the direct child's exit was observed. */
  exitObservedAt?: number | undefined;
  /** Factory-clock time when the child's stdio close was observed. */
  closeObservedAt?: number | undefined;
  /** Signal most recently passed to the owned-group signal operation. */
  lastSignalAttempt?: NodeJS.Signals | undefined;
  /** Factory-clock time when the latest owned-group signal was attempted. */
  lastSignalAttemptAt?: number | undefined;
}

/** Events observed while a factory-owned process is shutting down. */
export type ProcessShutdownEvent =
  | {kind: 'exit'}
  | {kind: 'close'; result: CommandResult}
  | {kind: 'error'; error: Error};

/** Result of attempting a signal against the exact process group owned by a fixture. */
export type SignalAttempt = 'sent' | 'group-missing' | 'skipped';

/** Process lifecycle operations required by the bounded shutdown algorithm. */
export interface OwnedProcessTarget {
  closed: Promise<CommandResult>;
  snapshot(): OwnedProcessSnapshot;
  subscribe(listener: (event: ProcessShutdownEvent) => void): () => void;
  signalGroup(signal: NodeJS.Signals): SignalAttempt;
  releasePipes(): void;
}

/** A scheduled timeout whose pending handle can be cancelled. */
export interface ShutdownTimer {
  promise: Promise<void>;
  cancel(): void;
}

/** Monotonic time and cancellable delays used by shutdown. */
export interface ShutdownScheduler {
  now(): number;
  schedule(delayMs: number): ShutdownTimer;
}

/** Finite process shutdown budgets in milliseconds. */
export interface ShutdownLimits {
  gracefulMs: number;
  forcedMs: number;
  postExitMs: number;
}

/** Defaults keep normal termination brief and escalation bounded. */
export const DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS: Readonly<ShutdownLimits> = {
  gracefulMs: 3_000,
  forcedMs: 2_000,
  postExitMs: 2_000
};
