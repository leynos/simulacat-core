/**
 * @file Owner lookup and `RepositoryOwner` field helpers for GraphQL adapters.
 *
 * These utilities resolve seeded users and organizations into the shared
 * owner-facing GraphQL fields used by repository and account conversions.
 */
import {assert} from 'assert-ts';
import type {PageArgs} from './relay.ts';
import {applyRelayPagination} from './relay.ts';
import {convertRepositoryConnection} from './connections.ts';
import type {DataSchemas, GraphQLData, ToGraphqlDispatcher} from './to-graphql-shapes.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';

export function deriveOwner(
  simulationStore: ExtendedSimulationStore,
  login: string,
  toGraphql: ToGraphqlDispatcher
): GraphQLData['Organization'] | GraphQLData['User'] {
  const [org] = simulationStore.schema.organizations
    .selectTableAsList(simulationStore.store.getState())
    .filter((candidate) => candidate.login === login);
  if (org) {
    return toGraphql(simulationStore, 'Organization', org);
  }

  const [userAccount] = simulationStore.schema.users
    .selectTableAsList(simulationStore.store.getState())
    .filter((candidate) => candidate.login === login);
  assert(!!userAccount, `no github organization or account found for ${login}`);
  return toGraphql(simulationStore, 'User', userAccount);
}

/**
 * Builds the shared GraphQL fields for the `RepositoryOwner` interface.
 *
 * @example
 * ```ts
 * const owner = toGithubRepositoryOwner(simulationStore, user, toGraphql);
 * ```
 */
export function toGithubRepositoryOwner(
  simulationStore: ExtendedSimulationStore,
  entity: DataSchemas['User'] | DataSchemas['Organization'],
  toGraphql: ToGraphqlDispatcher
): Pick<GraphQLData['User'], 'avatarUrl' | 'login' | 'repositories' | 'resourcePath' | 'url'> {
  return {
    login: entity.login,
    ...(entity.avatar_url ? {avatarUrl: entity.avatar_url} : {}),
    repositories(pageArgs: PageArgs) {
      return convertRepositoryConnection(
        applyRelayPagination(
          simulationStore.schema.repositories
            .selectTableAsList(simulationStore.store.getState())
            .filter((repo) => repo.owner === entity.login),
          pageArgs,
          (repository: DataSchemas['Repository']) => toGraphql(simulationStore, 'Repository', repository)
        )
      );
    },
    resourcePath: `/${entity.login}`,
    ...(entity.url ? {url: entity.url} : {})
  };
}
