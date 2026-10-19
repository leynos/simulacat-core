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
import type {DataSchemas, GraphQLData, RepositoryConnectionType, ToGraphqlDispatcher} from './to-graphql-types.ts';
import type {BaseUrls} from '../http/request-url.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import {urlPathSegment, webUrl} from '../urls/shared.ts';

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
  const state = simulationStore.store.getState();
  const org = simulationStore.schema.organizations
    .selectTableAsList(state)
    .find((candidate) => candidate.login === login);
  if (org) {
    return toGraphql(simulationStore, 'Organization', org);
  }

  const userAccount = simulationStore.schema.users
    .selectTableAsList(state)
    .find((candidate) => candidate.login === login);
  assert(!!userAccount, `no github organization or account found for ${login}`);
  return toGraphql(simulationStore, 'User', userAccount);
}

/** Builds the Relay connection of repositories owned by one login. */
const toOwnedRepositoryConnection = (
  simulationStore: ExtendedSimulationStore,
  ownerLogin: string,
  toGraphql: ToGraphqlDispatcher,
  pageArgs: PageArgs
): RepositoryConnectionType => {
  const repositoryList = simulationStore.schema.repositories
    .selectTableAsList(simulationStore.store.getState())
    .filter((repository) => repository.owner === ownerLogin);
  const page = applyRelayPagination(repositoryList, pageArgs, (repository: DataSchemas['Repository']) =>
    toGraphql(simulationStore, 'Repository', repository)
  );
  return convertRepositoryConnection(page);
};

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
  const resourcePath = `/${urlPathSegment(entity.login)}`;
  const ownerFields = {
    login: entity.login,
    resourcePath,
    url: entity.url ?? webUrl(baseUrls, resourcePath)
  };
  const repositories = (pageArgs: PageArgs) =>
    toOwnedRepositoryConnection(simulationStore, entity.login, toGraphql, pageArgs);

  if (entity.avatar_url) {
    return {...ownerFields, avatarUrl: entity.avatar_url, repositories};
  }

  return {...ownerFields, repositories};
}
