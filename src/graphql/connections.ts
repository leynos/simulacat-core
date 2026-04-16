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

/**
 * Converts relay-style `Page.pageInfo` metadata into the generated GraphQL
 * `PageInfo` shape.
 *
 * Cursor fields remain omitted when the source page does not provide them.
 */
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

/**
 * Returns the fixed empty stargazer connection used by topic placeholders.
 *
 * The returned shape always has empty edges and nodes, zero total count, and
 * page info with both pagination flags set to `false`.
 */
export const emptyStargazerConnection = () => ({
  edges: [],
  nodes: [],
  pageInfo: toConnectionPageInfo({
    hasNextPage: false,
    hasPreviousPage: false
  }),
  totalCount: 0
});

/**
 * Converts a page of organization nodes into an organization connection.
 *
 * Edge cursors are preserved exactly as supplied by the relay page.
 */
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

/**
 * Converts a page of team nodes into the generated team connection shape.
 *
 * The helper is a structural adapter only; it does not alter nodes or cursors.
 */
export const convertTeamConnection = (page: Page<Team>): TeamConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

/**
 * Converts a page of users into an organization-members connection.
 *
 * Every returned edge uses the fixed placeholder role
 * `OrganizationMemberRole.Member` until role-aware membership data is added.
 */
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

/**
 * Converts a page of users into a repository-collaborators connection.
 *
 * The current simulator uses placeholder collaborator metadata for every edge:
 * `permission` is always `RepositoryPermission.Read` and
 * `permissionSources` is always an empty array.
 */
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

/**
 * Converts a page of language entries into the generated language connection.
 *
 * `totalSize` must be supplied from the full unwindowed language collection so
 * Relay slicing does not shrink the aggregate size reported by the connection.
 */
export const convertLanguageConnection = (
  page: Page<{id: string; name: string; size: number}>,
  totalSize: number
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
  totalSize
});

/**
 * Returns the fixed empty repository connection used by topic placeholders.
 *
 * `totalDiskUsage` is currently a fixed placeholder value of `0`.
 */
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

/**
 * Converts a page of repository-topic nodes into the generated topic
 * connection shape.
 *
 * Topic nodes and cursors are preserved exactly as supplied by the relay page.
 */
export const convertRepositoryTopicConnection = (page: Page<RepositoryTopicShape>): RepositoryTopicConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

/**
 * Converts a page of repositories into the generated repository connection.
 *
 * `totalDiskUsage` is currently a fixed placeholder value of `0` until the
 * simulator exposes per-repository disk usage accounting.
 */
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
