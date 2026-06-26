/** @file Dispatch helpers for shared write use cases. */
import type {ExtendedSimulationStore} from '../index.ts';

type SimulationStoreDispatch = ExtendedSimulationStore['store']['dispatch'];

/**
 * Dispatches a store write action and waits for the store to accept it.
 *
 * @example
 * ```ts
 * await dispatchWrite(simulationStore.store, simulationStore.actions.updateRepository(command));
 * ```
 *
 * @param store Store object that owns the dispatch function.
 * @param action Action returned by a store action creator.
 * @returns A promise that resolves after dispatch returns.
 */
export const dispatchWrite = async (
  store: {dispatch: SimulationStoreDispatch},
  action: Parameters<SimulationStoreDispatch>[0]
): Promise<void> => {
  await store.dispatch(action);
};
