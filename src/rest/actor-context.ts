/** @file REST adapter helpers for request actor selection. */
import type {Request} from 'express';
import {buildActorContext, getActorContext, requireUserActor} from '../store/actors.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';

/**
 * Selects a required user actor from an Express request.
 *
 * @example
 * ```ts
 * const result = requireRestUserActor(request, simulationStore, 'GET /user');
 * ```
 *
 * @param request Express request that may carry middleware actor context.
 * @param simulationStore Store containing seeded users and installations.
 * @param surface REST surface used in authentication-failure observations.
 * @returns Authenticated user selection or an unauthenticated failure result.
 */
export const requireRestUserActor = (request: Request, simulationStore: ExtendedSimulationStore, surface: string) => {
  const context = getActorContext(request) ?? buildActorContext({get: (name) => request.get(name)});
  return requireUserActor({transport: 'rest', surface, context}, simulationStore);
};
