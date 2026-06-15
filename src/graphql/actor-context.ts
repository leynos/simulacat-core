/** @file GraphQL adapter helpers for request actor selection. */
import {requireUserActor} from '../store/actors.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import type {GraphQLContext} from './resolvers.ts';

/**
 * Selects a required user actor from GraphQL resolver context.
 *
 * @example
 * ```ts
 * const result = requireGraphQLUserActor(context, simulationStore, 'Query.viewer');
 * ```
 *
 * @param context GraphQL resolver context populated by Yoga.
 * @param simulationStore Store containing seeded users and installations.
 * @param surface GraphQL surface used in authentication-failure observations.
 * @returns Authenticated user selection or an unauthenticated failure result.
 */
export const requireGraphQLUserActor = (
  context: GraphQLContext,
  simulationStore: ExtendedSimulationStore,
  surface: string
) => {
  return requireUserActor({transport: 'graphql', surface, context: context.requestActorContext}, simulationStore);
};
