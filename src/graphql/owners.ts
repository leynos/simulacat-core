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
import type {BaseUrls} from '../http/request-url.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {webUrl} from '../urls/shared.ts';

/**
 * Resolves a login to the GraphQL Organization or User owner union member.
 *
 * @param simulationStore Store and selectors used to find seeded owners.
 * @param login Organization or user login to resolve.
 * @param toGraphql Dispatcher used to convert the matched owner.
 * @returns GraphQL Organization when the login belongs to an organization,
 * otherwise GraphQL User.
 * @throws Error when no seeded organization or user exists for `login`.
 */
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
 * const owner = toGithubRepositoryOwner(simulationStore, user, toGraphql, baseUrls);
 * ```
 *
 * @param simulationStore Store and selectors used to resolve repositories.
 * @param entity User or organization owner entity.
 * @param toGraphql Dispatcher used for repository conversion.
 * @param baseUrls Request-derived API and web bases for URL projection.
 * @returns Shared GraphQL repository-owner fields.
 */
export function toGithubRepositoryOwner(
  simulationStore: ExtendedSimulationStore,
  entity: DataSchemas['User'] | DataSchemas['Organization'],
  toGraphql: ToGraphqlDispatcher,
  baseUrls: BaseUrls
): Pick<GraphQLData['User'], 'avatarUrl' | 'login' | 'repositories' | 'resourcePath' | 'url'> {
  const resourcePath = 'organizations' in entity ? `/${entity.login}` : `/orgs/${entity.login}`;

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
    resourcePath,
    url: entity.url ?? webUrl(baseUrls, resourcePath)
  };
}
