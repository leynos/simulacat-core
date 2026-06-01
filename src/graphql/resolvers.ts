/**
 * @file Root GraphQL resolvers backed by the simulation store.
 *
 * This module binds generated `Resolvers` types to the in-memory simulation
 * store, using `applyRelayPagination`, `toGraphql`, and `deriveOwner` to serve
 * GraphQL queries. It also defines `GraphQLContext`, the Yoga resolver context
 * that carries the request-scoped `RequestActor` parsed by the handler before
 * any resolver runs, and `AuthenticationError`, thrown by `Query.viewer` when
 * no user actor is resolved. Actor resolution and observation are delegated to
 * `src/store/actors.ts`.
 */
import type {PageArgs} from './relay.ts';
import {applyRelayPagination} from './relay.ts';
import type {Resolvers} from '../__generated__/resolvers-types.ts';
import {toGraphql, deriveOwner} from './to-graphql.ts';
import {assert} from 'assert-ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {
  requireUserActor,
  type RequestActorParseResult,
  type RequestActor,
  type SimulacatRequestActor
} from '../store/actors.ts';

/**
 * GraphQL resolver context populated by the Yoga context function.
 *
 * `createHandler` builds this object before any resolver runs. Resolvers use
 * `requestActor` for the parsed actor, `requestActorContext` for parse
 * diagnostics and request-id observation context, `requestActorParseResult` for
 * backwards-compatible parse diagnostics, and `requestId` when a resolver needs
 * request correlation.
 *
 * @example
 * ```ts
 * const login = ctx.requestActor.kind === 'user' ? ctx.requestActor.login : undefined;
 * const requestId = ctx.requestId;
 * ```
 */
export type GraphQLContext = {
  requestActor: RequestActor;
  requestActorContext: SimulacatRequestActor;
  requestActorParseResult: RequestActorParseResult;
  requestId?: string;
};

/**
 * Error thrown when a GraphQL field requires an authenticated user actor.
 *
 * Extends `Error` with `name = 'AuthenticationError'` so callers can classify
 * authentication failures from `Query.viewer`. Callers that execute resolvers
 * directly can catch this subclass; transport clients usually see Yoga's
 * serialised GraphQL error response.
 *
 * @example
 * ```ts
 * try {
 *   await resolveViewer();
 * } catch (error) {
 *   if (error instanceof AuthenticationError) {
 *     // Handle unauthenticated viewer access.
 *   }
 * }
 * ```
 */
export class AuthenticationError extends Error {
  override name = 'AuthenticationError';
}

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
        const result = requireUserActor({transport: 'graphql', context, surface: 'Query.viewer'}, simulationStore);
        if ('failure' in result) {
          throw new AuthenticationError('Authentication required');
        }
        return toGraphql(simulationStore, 'User', result.user);
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
