/** @file Owns command processes started by documented-example tests. */
import {performance} from 'node:perf_hooks';
import type {DocumentedExample} from './documented-examples.ts';
import {createDocumentedExampleChild, type RunningExampleProcess} from './documented-example-child.ts';
import {stopOwnedProcessGroup} from './documented-example-shutdown.ts';
import {
  DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS,
  type CommandResult,
  type ShutdownScheduler,
  type ShutdownTimer
} from './documented-example-shutdown-types.ts';

const SERVER_READY_TIMEOUT_MS = 15_000;

const shutdownScheduler: ShutdownScheduler = {
  now: () => performance.now(),
  schedule: (delayMs) => scheduleShutdownDelay(delayMs)
};

export type {CommandResult} from './documented-example-shutdown-types.ts';
export type {RunningExampleProcess} from './documented-example-child.ts';

/** Running simulator process and the loopback address it announced. */
export interface RunningDocumentedServer {
  process: RunningExampleProcess;
  baseUrl: string;
}

/** Complete options for one bounded example command. */
export interface DocumentedCommandOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  label: string;
  timeoutMs: number;
}

/** Options for a shell fence that starts a long-running local server. */
export interface DocumentedServerOptions {
  example: DocumentedExample;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Runs one bounded child command and captures both output streams.
 *
 * @param options Command, process environment, label, and time bound.
 * @returns Captured output and exit state.
 * @throws Error when the command fails to start, exits unsuccessfully, or times out.
 */
export const runDocumentedCommand = async (options: DocumentedCommandOptions): Promise<CommandResult> => {
  const running = startCommand(options.command, options.args, {cwd: options.cwd, env: options.env});
  return await requireSuccessfulCommand(running, options.label, options.timeoutMs);
};

/**
 * Starts a server by executing its documented shell fence verbatim.
 *
 * @param options Source fence, consumer working directory, and environment.
 * @returns Owned process and announced loopback address.
 * @throws Error when the server exits early or does not report readiness.
 */
export const startDocumentedServer = async (options: DocumentedServerOptions): Promise<RunningDocumentedServer> => {
  const running = startCommand('bash', ['--noprofile', '--norc', '-c', `set -euo pipefail\n${options.example.body}`], {
    cwd: options.cwd,
    env: options.env
  });

  try {
    const baseUrl = await waitForServerReadiness(running, options.example.id);
    return {process: running, baseUrl};
  } catch (error) {
    await stopExampleProcess(running);
    throw error;
  }
};

/**
 * Waits for a server's readiness line and extracts its URL.
 *
 * @param running Owned shell process running the server.
 * @param exampleId Stable identifier for failure diagnostics.
 * @returns The announced loopback base URL.
 * @throws Error when the server exits or never announces its port.
 */
export const waitForServerReadiness = async (running: RunningExampleProcess, exampleId: string): Promise<string> => {
  const readinessPattern = /Listening on (http:\/\/127\.0\.0\.1:\d+)/;
  const existingMatch = readinessPattern.exec(running.stdout);

  if (existingMatch?.[1]) {
    return existingMatch[1];
  }

  return await new Promise<string>((resolvePromise, rejectPromise) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      cleanup();
      rejectPromise(new Error(`${exampleId} did not report server readiness within ${SERVER_READY_TIMEOUT_MS} ms`));
    }, SERVER_READY_TIMEOUT_MS);
    const onData = (): void => {
      const match = readinessPattern.exec(running.stdout);
      if (!settled && match?.[1]) {
        settled = true;
        cleanup();
        resolvePromise(match[1]);
      }
    };
    const onClose = (result: CommandResult): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      rejectPromise(commandFailure(exampleId, result));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      running.child.stdout?.off('data', onData);
    };

    running.child.stdout?.on('data', onData);
    const onError = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      rejectPromise(error);
    };

    void running.closed.then(onClose, onError);
    onData();
  });
};

/**
 * Stops and reaps the process group created for a long-running example.
 *
 * @param running Owned process group to stop.
 * @returns Final process output and exit state.
 * @throws Error when the owned process group cannot be signalled.
 */
export const stopExampleProcess = async (running: RunningExampleProcess): Promise<CommandResult> => {
  return await stopOwnedProcessGroup(running.target, shutdownScheduler, DOCUMENTED_EXAMPLE_SHUTDOWN_LIMITS);
};

/** Starts one process group and captures its standard output and error. */
const startCommand = (
  command: string,
  args: string[],
  options: {cwd: string; env: NodeJS.ProcessEnv}
): RunningExampleProcess => {
  return createDocumentedExampleChild({command, args, ...options}, shutdownScheduler.now);
};

/** Waits for command completion, stopping its group if the time bound expires. */
const requireSuccessfulCommand = async (
  running: RunningExampleProcess,
  label: string,
  timeoutMs: number
): Promise<CommandResult> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<CommandResult>((resolvePromise, rejectPromise) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      void stopExampleProcess(running).then(resolvePromise, rejectPromise);
    }, timeoutMs);
  });
  let result: CommandResult;

  try {
    result = await Promise.race([running.closed, timeout]);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }

  if (timedOut) {
    throw new Error(`${label} exceeded its ${timeoutMs} ms command bound\n${result.stdout}\n${result.stderr}`);
  }

  if (result.exitCode !== 0) {
    throw commandFailure(label, result);
  }

  return result;
};

/** Formats command failure with both captured output streams. */
const commandFailure = (label: string, result: CommandResult): Error => {
  const exitStatus = result.exitCode === null ? result.signal : result.exitCode;
  const status = exitStatus === null ? 'unknown' : exitStatus;
  return new Error(`${label} failed with exit ${status}\n${result.stdout}\n${result.stderr}`);
};

/** Schedules a cancellable timeout using the system timer and monotonic clock. */
const scheduleShutdownDelay = (delayMs: number): ShutdownTimer => {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolvePromise) => {
    handle = setTimeout(resolvePromise, delayMs);
  });

  return {
    promise,
    cancel: () => {
      if (handle !== undefined) {
        clearTimeout(handle);
      }
    }
  };
};
