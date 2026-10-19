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
import type {
  QueryOrganizationArgs,
  QueryRepositoryArgs,
  QueryRepositoryOwnerArgs,
  QueryUserArgs
} from '../__generated__/resolvers-types.ts';
import {makeToGraphql, deriveOwner} from './to-graphql.ts';
import {assert} from 'assert-ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import type {RequestActorParseResult, RequestActor, SimulacatRequestActor} from '../store/actors.ts';
import {requireGraphQLUserActor} from './actor-context.ts';
import type {BaseUrls} from '../http/request-url.ts';
import type {GraphQLData, OrganizationConnectionType} from './to-graphql-types.ts';

/**
 * Query-root resolver signatures actually served by the simulator.
 *
 * The generated `Resolvers` map is derived from the documentation schema, which
 * omits the enterprise-only `Query.organizations` field this simulator serves.
 * Declaring the supported subset locally keeps the root field signatures exact
 * while `createSchema` accepts the map through its looser `IResolvers` contract.
 */
export type QueryResolversMap = {
  Query: {
    viewer: (
      root: Record<PropertyKey, never>,
      args: Record<PropertyKey, never>,
      context: GraphQLContext
    ) => GraphQLData['User'];
    user: (root: Record<PropertyKey, never>, args: QueryUserArgs, context: GraphQLContext) => GraphQLData['User'];
    organization: (
      root: Record<PropertyKey, never>,
      args: QueryOrganizationArgs,
      context: GraphQLContext
    ) => GraphQLData['Organization'];
    organizations: (
      root: Record<PropertyKey, never>,
      args: PageArgs,
      context: GraphQLContext
    ) => OrganizationConnectionType;
    repository: (
      root: Record<PropertyKey, never>,
      args: QueryRepositoryArgs,
      context: GraphQLContext
    ) => GraphQLData['Repository'];
    repositoryOwner: (
      root: Record<PropertyKey, never>,
      args: QueryRepositoryOwnerArgs,
      context: GraphQLContext
    ) => GraphQLData['Organization'] | GraphQLData['User'];
  };
};

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
  baseUrls: BaseUrls;
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
export function createResolvers(simulationStore: ExtendedSimulationStore): QueryResolversMap {
  return {
    Query: {
      viewer(_root, _args, context) {
        const result = requireGraphQLUserActor(context, simulationStore, 'Query.viewer');
        if ('failure' in result) {
          throw new AuthenticationError('Authentication required');
        }
        const toGraphql = makeToGraphql(simulationStore, context.baseUrls);
        return toGraphql(simulationStore, 'User', result.user);
      },
      user(_root, {login}, context) {
        const user = simulationStore.schema.users
          .selectTableAsList(simulationStore.store.getState())
          .find((u) => u.login === login);
        assert(!!user, `no user found for ${login}`);
        const toGraphql = makeToGraphql(simulationStore, context.baseUrls);
        return toGraphql(simulationStore, 'User', user);
      },
      organization(_root, {login}, context) {
        const orgs = simulationStore.schema.organizations.selectTableAsList(simulationStore.store.getState());
        const org = orgs.find((o) => o.login === login);
        assert(!!org, `no organization found for ${login}`);
        const toGraphql = makeToGraphql(simulationStore, context.baseUrls);
        return toGraphql(simulationStore, 'Organization', org);
      },
      organizations(_root, pageArgs, context) {
        const orgs = simulationStore.schema.organizations.selectTableAsList(simulationStore.store.getState());
        const toGraphql = makeToGraphql(simulationStore, context.baseUrls);
        return applyRelayPagination(orgs, pageArgs, (org) => toGraphql(simulationStore, 'Organization', org));
      },
      repository(_root, {owner, name}, context) {
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
        const toGraphql = makeToGraphql(simulationStore, context.baseUrls);
        return toGraphql(simulationStore, 'Repository', repo);
      },
      repositoryOwner(_root, {login}, context) {
        return deriveOwner(simulationStore, login, context.baseUrls);
      }
    }
  };
}
