/**
 * @file Connection builders for GraphQL pagination responses.
 *
 * These helpers convert relay `Page` objects into the generated connection
 * shapes consumed by resolver fields exposed from the simulation store.
 */
import type {Page} from './relay.ts';
import type {
  GraphQLData,
  LanguageConnectionShape,
  OrganizationConnectionShape,
  OrganizationMemberConnectionShape,
  RepositoryCollaboratorConnectionShape,
  RepositoryConnectionShape,
  RepositoryTopicConnectionShape,
  RepositoryTopicShape,
  TeamConnectionShape
} from './to-graphql-shapes.ts';
import type {PageInfo as GraphqlPageInfo, Team, User} from '../__generated__/resolvers-types.ts';
import {OrganizationMemberRole, RepositoryPermission} from '../__generated__/resolvers-types.ts';

export const toConnectionPageInfo = (pageInfo: Page<unknown>['pageInfo']): GraphqlPageInfo => {
  const connectionPageInfo: GraphqlPageInfo = {
    hasNextPage: pageInfo.hasNextPage,
    hasPreviousPage: pageInfo.hasPreviousPage
  };

  if (pageInfo.startCursor !== undefined) {
    connectionPageInfo.startCursor = pageInfo.startCursor;
  }

  if (pageInfo.endCursor !== undefined) {
    connectionPageInfo.endCursor = pageInfo.endCursor;
  }

  return connectionPageInfo;
};

export const emptyStargazerConnection = () => ({
  edges: [],
  nodes: [],
  pageInfo: toConnectionPageInfo({
    hasNextPage: false,
    hasPreviousPage: false
  }),
  totalCount: 0
});

export const convertOrganizationConnection = (
  page: Page<GraphQLData['Organization']>
): OrganizationConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

export const convertTeamConnection = (page: Page<Team>): TeamConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

export const convertOrganizationMemberConnection = (page: Page<User>): OrganizationMemberConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node,
    role: OrganizationMemberRole.Member
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

export const convertRepositoryCollaboratorConnection = (page: Page<User>): RepositoryCollaboratorConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node,
    permission: RepositoryPermission.Read,
    permissionSources: []
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

export const convertLanguageConnection = (
  page: Page<{id: string; name: string; size: number}>
): LanguageConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: {
      id: edge.node.id,
      name: edge.node.name
    },
    size: edge.node.size
  })),
  nodes: page.nodes.map((node) => ({
    id: node.id,
    name: node.name
  })),
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount,
  totalSize: page.nodes.reduce((sum, node) => sum + node.size, 0)
});

export const emptyRepositoryConnection = (): RepositoryConnectionShape => ({
  edges: [],
  nodes: [],
  pageInfo: toConnectionPageInfo({
    hasNextPage: false,
    hasPreviousPage: false
  }),
  totalCount: 0,
  totalDiskUsage: 0
});

export const convertRepositoryTopicConnection = (page: Page<RepositoryTopicShape>): RepositoryTopicConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

export const convertRepositoryConnection = (page: Page<GraphQLData['Repository']>): RepositoryConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount,
  totalDiskUsage: 0
});
