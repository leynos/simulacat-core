/**
 * @file Root GraphQL resolvers backed by the simulation store.
 *
 * This module binds generated `Resolvers` types to the in-memory simulation
 * store, using `applyRelayPagination`, `toGraphql`, and `deriveOwner` to serve
 * GraphQL queries.
 */
import type {PageArgs} from './relay.ts';
import {applyRelayPagination} from './relay.ts';
import type {Resolvers} from '../__generated__/resolvers-types.ts';
import {toGraphql, deriveOwner} from './to-graphql.ts';
import {assert} from 'assert-ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {
  observeAuthenticationFailure,
  observeResolvedRequestActor,
  observeSelectedActor,
  resolveRequestActor,
  selectAuthenticatedUser,
  type RequestActor
} from '../store/actors.ts';

/**
 * GraphQL resolver context populated by the Yoga context function.
 *
 * Carries the parsed `RequestActor` before resolvers run.
 */
export type GraphQLContext = {
  requestActor: RequestActor;
};

/**
 * Error thrown when a GraphQL field requires an authenticated user actor.
 *
 * Extends `Error` with `name = 'AuthenticationError'` so callers can classify
 * authentication failures from `Query.viewer`.
 */
export class AuthenticationError extends Error {
  override name = 'AuthenticationError';
}

/**
 * Observes and selects the viewer user for the current GraphQL context.
 *
 * Resolves the context actor against the store's users and installations
 * tables, records the resolved actor in the process-local observability
 * counters, and returns both the resolved actor and matching `GitHubUser`, or
 * undefined when the actor is anonymous or unknown.
 */
const observeAndSelectViewer = (simulationStore: ExtendedSimulationStore, context: GraphQLContext) => {
  const state = simulationStore.store.getState();
  const resolvedActor = resolveRequestActor(context.requestActor, {
    users: simulationStore.schema.users.selectTableAsList(state),
    installations: simulationStore.schema.installations.selectTableAsList(state)
  });
  observeResolvedRequestActor('graphql', context.requestActor, resolvedActor);
  observeSelectedActor('graphql', resolvedActor);

  return {resolvedActor, user: selectAuthenticatedUser(resolvedActor)};
};

/**
 * Creates the root resolver map for the simulated GitHub GraphQL API.
 *
 * @example
 * ```ts
 * const resolvers = createResolvers(simulationStore);
 * ```
 */
export function createResolvers(simulationStore: ExtendedSimulationStore): Resolvers {
  return {
    Query: {
      viewer(_root: unknown, _args: unknown, context: GraphQLContext) {
        const {resolvedActor, user} = observeAndSelectViewer(simulationStore, context);
        if (!user) {
          observeAuthenticationFailure('graphql', resolvedActor, 'Query.viewer');
          throw new AuthenticationError('Authentication required');
        }
        return toGraphql(simulationStore, 'User', user);
      },
      user(_: unknown, {login}: {login: string}) {
        const user = simulationStore.schema.users
          .selectTableAsList(simulationStore.store.getState())
          .find((u) => u.login === login);
        assert(!!user, `no user found for ${login}`);
        return toGraphql(simulationStore, 'User', user);
      },
      organization(_: unknown, {login}: {login: string}) {
        const orgs = simulationStore.schema.organizations.selectTableAsList(simulationStore.store.getState());
        const [org] = orgs.filter((o) => o.login === login);
        assert(!!org, `no organization found for ${login}`);
        return toGraphql(simulationStore, 'Organization', org);
      },
      organizations(pageArgs: PageArgs) {
        const orgs = simulationStore.schema.organizations.selectTableAsList(simulationStore.store.getState());
        return applyRelayPagination(orgs, pageArgs, (org) => toGraphql(simulationStore, 'Organization', org));
      },
      repository(_root: unknown, {owner, name}: {owner: string; name: string}) {
        const state = simulationStore.store.getState();
        const repo =
          simulationStore.selectors.getRepository(state, owner, name) ??
          simulationStore.schema.repositories
            .selectTableAsList(state)
            .find(
              (r) =>
                r.name.toLowerCase() === name.toLowerCase() &&
                r.full_name.toLowerCase() === `${owner}/${name}`.toLowerCase()
            );
        assert(!!repo, `no repository found for ${name}`);
        return toGraphql(simulationStore, 'Repository', repo);
      },
      repositoryOwner(_root: unknown, {login}: {login: string}) {
        return deriveOwner(simulationStore, login);
      }
    }
    // The generated `Resolvers` signatures do not line up exactly with the
    // lightweight callback shapes used here for the simulated root fields.
  } as unknown as Resolvers;
}
