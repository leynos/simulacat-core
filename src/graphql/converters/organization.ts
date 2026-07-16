/**
 * @file Organization entity conversion helpers for GraphQL responses.
 */
import type {PageArgs} from '../relay.ts';
import {applyRelayPagination} from '../relay.ts';
import {convertOrganizationMemberConnection, convertTeamConnection} from '../connections.ts';
import {toGithubRepositoryOwner} from '../owners.ts';
import type {DataSchemas, GraphQLData, ToGraphqlDispatcher} from '../to-graphql-shapes.ts';
import type {BaseUrls} from '../../http/request-url.ts';
import type {ExtendedSimulationStore} from '../../store/index.ts';
import type {Team, User} from '../../__generated__/resolvers-types.ts';

/**
 * Converts a stored organization entity into its GraphQL Organization shape.
 *
 * @param simulationStore Store and selectors used to resolve related fields.
 * @param org Organization entity from simulator state.
 * @param toGraphql Dispatcher used for nested GraphQL conversions.
 * @param baseUrls Request-derived API and web bases for URL projection.
 * @returns GraphQL Organization with optional fields omitted when absent.
 */
export function convertOrganizationToGraphql(
  simulationStore: ExtendedSimulationStore,
  org: DataSchemas['Organization'],
  toGraphql: ToGraphqlDispatcher,
  baseUrls: BaseUrls
): GraphQLData['Organization'] {
  return {
    ...toGithubRepositoryOwner(simulationStore, org, toGraphql, baseUrls),
    __typename: 'Organization',
    id: org.id.toString(),
    createdAt: org.created_at ?? new Date(0).toISOString(),
    ...(org.name ? {name: org.name} : {}),
    ...(org.description ? {description: org.description} : {}),
    ...(org.email ? {email: org.email} : {}),
    teams(pageArgs: PageArgs) {
      return convertTeamConnection(applyRelayPagination([], pageArgs, (team: Team) => team));
    },
    membersWithRole(pageArgs: PageArgs) {
      return convertOrganizationMemberConnection(applyRelayPagination([], pageArgs, (member: User) => member));
    }
  };
}
