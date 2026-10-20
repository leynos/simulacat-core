/** @file Captures output and lifecycle facts from a documented-example child. */
import {spawn, type ChildProcess} from 'node:child_process';
import {z} from 'zod';
import type {
  CommandResult,
  OwnedProcessSnapshot,
  OwnedProcessTarget,
  ProcessShutdownEvent,
  SignalAttempt
} from './documented-example-shutdown-types.ts';

/** Options required to spawn one documented shell fence. */
export interface DocumentedChildOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** Captured output and lifecycle state for one owned child process. */
export interface RunningExampleProcess {
  child: ChildProcess;
  closed: Promise<CommandResult>;
  target: OwnedProcessTarget;
  get stdout(): string;
}

/** Mutable lifecycle fields recorded on the factory's monotonic clock. */
type ChildLifecycleState = Pick<
  OwnedProcessSnapshot,
  | 'hasExited'
  | 'hasClosed'
  | 'exitCode'
  | 'signal'
  | 'error'
  | 'startedAt'
  | 'exitObservedAt'
  | 'closeObservedAt'
  | 'lastSignalAttempt'
  | 'lastSignalAttemptAt'
>;

/** Output accumulated until the child and its pipes close. */
interface ChildOutput {
  stdout: string;
  stderr: string;
}

/** Resolves when stdio closes or rejects when spawning reports an error. */
interface ChildCloseChannel {
  promise: Promise<CommandResult>;
  resolve(result: CommandResult): void;
  reject(error: Error): void;
}

/** Factory-owned process state shared by event, snapshot, and signal helpers. */
interface DocumentedChildContext {
  command: string;
  args: string[];
  child: ChildProcess;
  processGroupId: number | undefined;
  state: ChildLifecycleState;
  output: ChildOutput;
  listeners: Set<(event: ProcessShutdownEvent) => void>;
  now(): number;
}

/** Placeholder resolver replaced when the close-result promise is created. */
const ignoreResult = (_result: CommandResult): void => undefined;

/** Placeholder rejecter replaced when the close-result promise is created. */
const ignoreError = (_error: Error): void => undefined;

/** Creates a close-result channel before attaching any child event listeners. */
const createCloseChannel = (): ChildCloseChannel => {
  let resolve = ignoreResult;
  let reject = ignoreError;
  const promise = new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
};

/**
 * Spawns one owned process and connects its output and lifecycle target.
 *
 * @param options Command, arguments, working directory, and child environment.
 * @param now Factory monotonic clock used for lifecycle observations.
 * @returns Owned child handle with captured output and shutdown target.
 * @throws Error when spawn rejects its arguments synchronously.
 */
export const createDocumentedExampleChild = (
  options: DocumentedChildOptions,
  now: () => number
): RunningExampleProcess => {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const processGroupId = isPositivePid(child.pid) ? child.pid : undefined;
  const context: DocumentedChildContext = {
    command: options.command,
    args: [...options.args],
    child,
    processGroupId,
    state: createLifecycleState(now()),
    output: {stdout: '', stderr: ''},
    listeners: new Set(),
    now
  };
  const channel = createCloseChannel();
  const removeOutputListeners = attachOutputCapture(context);
  installLifecycleListeners(context, channel, removeOutputListeners);
  const target = createOwnedTarget(context, channel.promise);

  return {
    child,
    closed: channel.promise,
    target,
    get stdout() {
      return context.output.stdout;
    }
  };
};

/** Initializes lifecycle observations before the child can emit events. */
const createLifecycleState = (startedAt: number): ChildLifecycleState => ({
  hasExited: false,
  hasClosed: false,
  exitCode: null,
  signal: null,
  error: undefined,
  startedAt
});

/** Attaches stream collectors and returns their close-time removal callback. */
const attachOutputCapture = (context: DocumentedChildContext): (() => void) => {
  const onStdout = (chunk: Buffer): void => {
    context.output.stdout += chunk.toString();
  };
  const onStderr = (chunk: Buffer): void => {
    context.output.stderr += chunk.toString();
  };
  context.child.stdout?.on('data', onStdout);
  context.child.stderr?.on('data', onStderr);
  return () => {
    context.child.stdout?.off('data', onStdout);
    context.child.stderr?.off('data', onStderr);
  };
};

/** Connects child lifecycle events to state, observers, and close results. */
const installLifecycleListeners = (
  context: DocumentedChildContext,
  channel: ChildCloseChannel,
  removeOutputListeners: () => void
): void => {
  const onExit = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    recordChildExit(context, exitCode, signal);
  };
  const onClose = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
    const result = recordChildClose(context, exitCode, signal);
    channel.resolve(result);
    removeOutputListeners();
    context.child.off('exit', onExit);
    context.child.off('close', onClose);
    context.child.off('error', onError);
  };
  const onError = (error: Error): void => {
    context.state.error = error;
    publishEvent(context, {kind: 'error', error});
    channel.reject(error);
  };
  context.child.on('exit', onExit);
  context.child.on('close', onClose);
  context.child.on('error', onError);
};

/** Records exit status and its monotonic observation time. */
const recordChildExit = (
  context: DocumentedChildContext,
  exitCode: number | null,
  signal: NodeJS.Signals | null
): void => {
  context.state.hasExited = true;
  context.state.exitCode = exitCode;
  context.state.signal = signal;
  context.state.exitObservedAt = context.now();
  publishEvent(context, {kind: 'exit'});
};

/** Records close status, captures final streams, and notifies shutdown waiters. */
const recordChildClose = (
  context: DocumentedChildContext,
  exitCode: number | null,
  signal: NodeJS.Signals | null
): CommandResult => {
  context.state.hasClosed = true;
  context.state.exitCode = exitCode;
  context.state.signal = signal;
  context.state.closeObservedAt = context.now();
  const result = {stdout: context.output.stdout, stderr: context.output.stderr, exitCode, signal};
  publishEvent(context, {kind: 'close', result});
  return result;
};

/** Notifies temporary shutdown subscribers of one child lifecycle event. */
const publishEvent = (context: DocumentedChildContext, event: ProcessShutdownEvent): void => {
  for (const listener of context.listeners) {
    listener(event);
  }
};

/** Builds the injected target used by the bounded shutdown state machine. */
const createOwnedTarget = (context: DocumentedChildContext, closed: Promise<CommandResult>): OwnedProcessTarget => ({
  closed,
  snapshot: () => snapshotChild(context),
  subscribe: (listener) => subscribeToChild(context, listener),
  signalGroup: (signal) => signalOwnedGroup(context, signal),
  releasePipes: () => {
    context.child.stdout?.destroy();
    context.child.stderr?.destroy();
  }
});

/** Captures the current process state without exposing mutable internal objects. */
const snapshotChild = (context: DocumentedChildContext): OwnedProcessSnapshot => ({
  command: context.command,
  args: [...context.args],
  pid: context.child.pid,
  processGroupId: context.processGroupId,
  hasExited: context.state.hasExited,
  hasClosed: context.state.hasClosed,
  exitCode: context.state.exitCode,
  signal: context.state.signal,
  stdout: context.output.stdout,
  stderr: context.output.stderr,
  error: context.state.error,
  startedAt: context.state.startedAt,
  exitObservedAt: context.state.exitObservedAt,
  closeObservedAt: context.state.closeObservedAt,
  lastSignalAttempt: context.state.lastSignalAttempt,
  lastSignalAttemptAt: context.state.lastSignalAttemptAt
});

/** Registers one temporary observer and returns its removal callback. */
const subscribeToChild = (
  context: DocumentedChildContext,
  listener: (event: ProcessShutdownEvent) => void
): (() => void) => {
  context.listeners.add(listener);
  return () => {
    context.listeners.delete(listener);
  };
};

/** Signals only a still-active process group captured by this factory. */
const signalOwnedGroup = (context: DocumentedChildContext, signal: NodeJS.Signals): SignalAttempt => {
  const processGroupId = capturedProcessGroup(context);

  if (processGroupId === undefined) {
    return 'skipped';
  }

  if (!isActiveChild(context)) {
    return 'skipped';
  }

  context.state.lastSignalAttempt = signal;
  context.state.lastSignalAttemptAt = context.now();
  return sendOwnedSignal(processGroupId, signal);
};

/** Returns the positive process group that still matches the captured child. */
const capturedProcessGroup = (context: DocumentedChildContext): number | undefined => {
  const processGroupId = context.processGroupId;

  if (!isPositivePid(processGroupId)) {
    return undefined;
  }

  return context.child.pid === processGroupId ? processGroupId : undefined;
};

/** Confirms the factory has not observed child exit, close, or error. */
const isActiveChild = (context: DocumentedChildContext): boolean => {
  if (context.state.hasExited || context.state.hasClosed) {
    return false;
  }

  if (context.child.exitCode !== null || context.child.signalCode !== null) {
    return false;
  }

  return context.state.error === undefined;
};

/** Schema that recognises an `Error` at a catch boundary. */
const thrownErrorSchema = z.instanceof(Error);

/** Sends one captured-group signal and distinguishes ESRCH from other errors. */
const sendOwnedSignal = (processGroupId: number, signal: NodeJS.Signals): SignalAttempt => {
  try {
    process.kill(-processGroupId, signal);
    return 'sent';
  } catch (error) {
    const observed = thrownErrorSchema.safeParse(error);
    // A replaced or stubbed `process.kill` can reject with a non-Error; wrap it
    // so the original value survives as the cause instead of becoming a ZodError.
    const failure = observed.success
      ? observed.data
      : new Error(`signalling the owned process group failed: ${String(error)}`, {cause: error});
    if (isNoSuchProcessError(failure)) {
      return 'group-missing';
    }

    throw failure;
  }
};

/** Checks that a captured process identifier is positive and integral. */
const isPositivePid = (pid: number | undefined): pid is number => {
  if (pid === undefined) {
    return false;
  }

  return Number.isInteger(pid) && pid > 0;
};

/** Recognizes ESRCH so shutdown still waits for observed child completion. */
const isNoSuchProcessError = (error: Error): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  if (!('code' in error)) {
    return false;
  }

  return error.code === 'ESRCH';
};
