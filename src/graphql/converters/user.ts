/**
 * @file User entity conversion helpers for GraphQL responses.
 */
import type {PageArgs} from '../relay.ts';
import {applyRelayPagination} from '../relay.ts';
import {convertOrganizationConnection} from '../connections.ts';
import {toGithubRepositoryOwner} from '../owners.ts';
import type {DataSchemas, GraphQLData, ToGraphqlDispatcher} from '../to-graphql-shapes.ts';
import type {BaseUrls} from '../../http/request-url.ts';
import type {ExtendedSimulationStore} from '../../store/index.ts';

/**
 * Converts a stored user entity into its GraphQL User shape.
 *
 * @param simulationStore Store and selectors used to resolve related fields.
 * @param user User entity from simulator state.
 * @param toGraphql Dispatcher used for nested GraphQL conversions.
 * @param baseUrls Request-derived API and web bases for URL projection.
 * @returns GraphQL User with optional fields omitted when absent.
 */
export function convertUserToGraphql(
  simulationStore: ExtendedSimulationStore,
  user: DataSchemas['User'],
  toGraphql: ToGraphqlDispatcher,
  baseUrls: BaseUrls
): GraphQLData['User'] {
  return {
    ...toGithubRepositoryOwner(simulationStore, user, toGraphql, baseUrls),
    __typename: 'User',
    id: user.id.toString(),
    bio: user.bio,
    createdAt: user.created_at ?? new Date(0).toISOString(),
    ...(user.name ? {name: user.name} : {}),
    organizations(pageArgs: PageArgs) {
      return convertOrganizationConnection(
        applyRelayPagination(
          simulationStore.schema.organizations.selectByIds(simulationStore.store.getState(), {
            ids: user.organizations
          }),
          pageArgs,
          (org) => toGraphql(simulationStore, 'Organization', org)
        )
      );
    }
  };
}
