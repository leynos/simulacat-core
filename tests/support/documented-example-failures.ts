/** @file Preserves primary failures when owned cleanup also fails. */

/**
 * Awaits cleanup, then rethrows the operation failure or combines both failures.
 *
 * @param operationError Original failure from fixture preparation or packing.
 * @param cleanup Awaitable cleanup for resources owned by the failed operation.
 * @returns A rejected promise carrying the original or combined failure.
 * @throws The original error, or an aggregate containing both errors.
 */
export const rethrowAfterCleanup = async (operationError: unknown, cleanup: () => Promise<void>): Promise<never> => {
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError([operationError, cleanupError], 'Operation and cleanup both failed', {
      cause: operationError
    });
  }

  throw operationError;
};
