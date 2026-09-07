/** @file Shared repository write use cases. */
import type {ExtendedSimulationStore} from '../index.ts';
import type {GitHubRepository} from '../entities.ts';
import {dispatchWrite} from './dispatch.ts';
import type {UpdateRepositoryCommand} from './repository.ts';

/** Result returned by the shared repository update use case. */
export type UpdateRepositoryResult =
  | {
      /** Discriminant marking a successful update. */
      ok: true;
      /** Repository fixture as it stands after the update. */
      repository: GitHubRepository;
    }
  | {
      /** Discriminant marking a failed update. */
      ok: false;
      /** Why the update did not happen. */
      reason: 'not-found';
    };

/**
 * Updates a repository through the built-in domain action.
 *
 * @example
 * ```ts
 * await updateRepositoryUseCase(simulationStore, {
 *   owner: 'acme',
 *   name: 'widgets',
 *   changes: {description: 'New'}
 * });
 * ```
 *
 * @param simulationStore Store facade containing selectors, actions, and dispatch.
 * @param command Repository update command.
 * @returns The updated repository, or `not-found` when no repository exists.
 */
export const updateRepositoryUseCase = async (
  simulationStore: ExtendedSimulationStore,
  command: UpdateRepositoryCommand
): Promise<UpdateRepositoryResult> => {
  const before = simulationStore.selectors.getRepository(simulationStore.store.getState(), command.owner, command.name);
  if (!before) return {ok: false, reason: 'not-found'};

  await dispatchWrite(simulationStore.store, simulationStore.actions.updateRepository(command));

  const repository = simulationStore.selectors.getRepository(
    simulationStore.store.getState(),
    command.owner,
    command.name
  );

  return repository ? {ok: true, repository} : {ok: false, reason: 'not-found'};
};
