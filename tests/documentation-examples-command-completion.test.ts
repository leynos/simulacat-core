/** @file Verifies command-allowance expiry joins bounded shutdown. */
import {describe, expect, it} from 'bun:test';
import type {CommandResult} from './support/documented-example-shutdown-types.ts';
import {ManualShutdownScheduler} from './support/documented-example-shutdown-fakes.ts';
import {waitForDocumentedCommandCompletion} from './support/documented-example-command-completion.ts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

/** Creates a promise whose result the test controls. */
const deferred = <T>(): Deferred<T> => {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {promise, resolve: resolvePromise, reject: rejectPromise};
};

/** Advances a bounded number of promise jobs after virtual-time changes. */
const flushPromiseJobs = async (): Promise<void> => {
  for (let turn = 0; turn < 4; turn += 1) {
    await Promise.resolve();
  }
};

/** Builds one captured command result for completion tests. */
const commandResult = (stdout: string, stderr: string): CommandResult => ({
  stdout,
  stderr,
  exitCode: 0,
  signal: null
});

/** Creates one controllable command lifecycle and records its outward completion. */
const makeCompletionFixture = (executionAllowanceMs: number, label = 'example') => {
  const scheduler = new ManualShutdownScheduler();
  const closed = deferred<CommandResult>();
  const shutdownResult = deferred<CommandResult>();
  const shutdownStarted = deferred<void>();
  const state = {shutdownCalls: 0, settled: false};
  const completion = waitForDocumentedCommandCompletion({
    closed: closed.promise,
    shutdown: () => {
      state.shutdownCalls += 1;
      shutdownStarted.resolve(undefined);
      return shutdownResult.promise;
    },
    scheduler,
    executionAllowanceMs,
    label
  });
  const markSettled = (): void => {
    state.settled = true;
  };
  void completion.then(markSettled, markSettled);

  return {scheduler, closed, shutdownResult, shutdownStarted, state, completion};
};

describe('documented command completion before expiry', () => {
  it('returns a close before expiry without starting shutdown', async () => {
    const {scheduler, closed, state, completion} = makeCompletionFixture(30);
    const result = commandResult('completed', '');

    await scheduler.waitForScheduledTimer(0);
    closed.resolve(result);

    await expect(completion).resolves.toBe(result);
    expect(state.shutdownCalls).toBe(0);
    expect(scheduler.cancellationCount).toBe(1);
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it('preserves a close failure and disposes the execution timer', async () => {
    const {scheduler, closed, state, completion} = makeCompletionFixture(20);
    const closeFailure = new Error('close failed');

    await scheduler.waitForScheduledTimer(0);
    closed.reject(closeFailure);

    await expect(completion).rejects.toBe(closeFailure);
    expect(state.shutdownCalls).toBe(0);
    expect(scheduler.cancellationCount).toBe(1);
  });
});

describe('documented command execution allowance expiry', () => {
  it('starts shutdown only after the full allowance and reports captured output', async () => {
    const {scheduler, shutdownResult, shutdownStarted, state, completion} = makeCompletionFixture(
      30,
      'archive listing'
    );

    await scheduler.waitForScheduledTimer(0);
    scheduler.advanceBy(29);
    await flushPromiseJobs();
    expect(state.shutdownCalls).toBe(0);

    scheduler.advanceBy(1);
    await shutdownStarted.promise;
    await flushPromiseJobs();
    expect(state.shutdownCalls).toBe(1);
    expect(state.settled).toBe(false);

    shutdownResult.resolve(commandResult('captured stdout', 'captured stderr'));
    await expect(completion).rejects.toThrow(
      'archive listing exceeded its 30 ms command execution allowance\ncaptured stdout\ncaptured stderr'
    );
    expect(scheduler.cancellationCount).toBe(1);
  });
});

describe('documented command shutdown joining', () => {
  it('waits for started shutdown when the child closes first', async () => {
    const {scheduler, closed, shutdownResult, shutdownStarted, state, completion} = makeCompletionFixture(20);

    await scheduler.waitForScheduledTimer(0);
    scheduler.advanceBy(20);
    await shutdownStarted.promise;
    closed.resolve(commandResult('closed output', ''));
    await flushPromiseJobs();
    expect(state.settled).toBe(false);

    shutdownResult.resolve(commandResult('shutdown output', 'shutdown diagnostic'));
    await expect(completion).rejects.toThrow(
      'example exceeded its 20 ms command execution allowance\nshutdown output\nshutdown diagnostic'
    );
  });

  it('preserves the exact shutdown failure and cause', async () => {
    const {scheduler, closed, shutdownResult, shutdownStarted, completion} = makeCompletionFixture(20);
    const cause = new Error('underlying shutdown failure');
    const shutdownFailure = new Error('shutdown failed', {cause});

    await scheduler.waitForScheduledTimer(0);
    scheduler.advanceBy(20);
    await shutdownStarted.promise;
    closed.resolve(commandResult('closed output', ''));
    shutdownResult.reject(shutdownFailure);

    await expect(completion).rejects.toBe(shutdownFailure);
    expect(shutdownFailure.cause).toBe(cause);
  });
});
