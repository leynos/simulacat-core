/**
 * @file Converters from stored GitHub entities to GraphQL resolver objects.
 *
 * This module maps seeded store entities into generated GraphQL types and
 * connection helpers, composing `applyRelayPagination` with the generated
 * `User`, `Repository`, `Organization`, and `Team` resolver shapes.
 */
import type {PageArgs} from './relay.ts';
import {applyRelayPagination} from './relay.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import type {GitHubUser, GitHubRepository, GitHubOrganization} from '../store/entities.ts';
import {
  type User,
  type Team,
  type PageInfo as GraphqlPageInfo,
  OrganizationMemberRole,
  RepositoryPermission,
  RepositoryVisibility
} from '../__generated__/resolvers-types.ts';
import {assert} from 'assert-ts';
import type {Page} from './relay.ts';

type ConnectionPageInfo = GraphqlPageInfo;

type Connection<Node, Edge extends {cursor: string; node: Node}> = {
  edges: Edge[];
  nodes: Node[];
  pageInfo: ConnectionPageInfo;
  totalCount: number;
};

type OrganizationConnectionShape = Connection<
  GraphQLData['Organization'],
  {cursor: string; node: GraphQLData['Organization']}
>;

type TeamConnectionShape = Connection<Team, {cursor: string; node: Team}>;

type OrganizationMemberConnectionShape = Connection<User, {cursor: string; node: User; role: OrganizationMemberRole}>;

type RepositoryCollaboratorConnectionShape = Connection<
  User,
  {
    cursor: string;
    node: User;
    permission: RepositoryPermission;
    permissionSources: [];
  }
>;

type LanguageConnectionShape = Connection<
  {id: string; name: string},
  {cursor: string; node: {id: string; name: string}; size: number}
> & {totalSize: number};

type RepositoryTopicShape = {
  id: string;
  resourcePath: string;
  topic: {
    id: string;
    name: string;
    relatedTopics: [];
    repositories: RepositoryConnectionShape;
    stargazerCount: number;
    stargazers: {
      edges: never[];
      nodes: never[];
      pageInfo: ConnectionPageInfo;
      totalCount: number;
    };
    viewerHasStarred: boolean;
  };
  url: string;
};

type RepositoryTopicConnectionShape = Connection<RepositoryTopicShape, {cursor: string; node: RepositoryTopicShape}>;

type RepositoryConnectionShape = Connection<
  GraphQLData['Repository'],
  {cursor: string; node: GraphQLData['Repository']}
> & {totalDiskUsage: number};

interface GraphQLData {
  User: {
    __typename: 'User';
    id: string;
    avatarUrl?: string;
    login: string;
    name?: string;
    bio: string;
    createdAt: string;
    resourcePath: string;
    url?: string;
    repositories: (pageArgs: PageArgs) => RepositoryConnectionShape;
    organizations: (pageArgs: PageArgs) => OrganizationConnectionShape;
  };
  Repository: {
    __typename: 'Repository';
    id: string;
    name: string;
    description?: string;
    nameWithOwner: string;
    url: string;
    createdAt: string;
    collaborators: (pageArgs: PageArgs) => RepositoryCollaboratorConnectionShape;
    owner: GraphQLData['User'] | GraphQLData['Organization'];
    defaultBranchRef: {
      id: string;
      name: string;
    };
    languages: (pageArgs: PageArgs) => LanguageConnectionShape;
    repositoryTopics: (pageArgs: PageArgs) => RepositoryTopicConnectionShape;
    visibility: RepositoryVisibility;
    isArchived: boolean;
    isFork: boolean;
  };
  Organization: {
    __typename: 'Organization';
    id: string;
    avatarUrl?: string;
    login: string;
    name?: string;
    description?: string;
    email?: string;
    createdAt: string;
    resourcePath: string;
    url?: string;
    repositories: (pageArgs: PageArgs) => RepositoryConnectionShape;
    teams: (pageArgs: PageArgs) => TeamConnectionShape;
    membersWithRole: (pageArgs: PageArgs) => OrganizationMemberConnectionShape;
  };
}
interface DataSchemas {
  User: GitHubUser;
  Repository: GitHubRepository;
  Organization: GitHubOrganization;
}

const toConnectionPageInfo = (pageInfo: Page<unknown>['pageInfo']): GraphqlPageInfo => {
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

const emptyStargazerConnection = () => ({
  edges: [],
  nodes: [],
  pageInfo: toConnectionPageInfo({
    hasNextPage: false,
    hasPreviousPage: false
  }),
  totalCount: 0
});

const convertOrganizationConnection = (page: Page<GraphQLData['Organization']>): OrganizationConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

const convertTeamConnection = (page: Page<Team>): TeamConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

const convertOrganizationMemberConnection = (page: Page<User>): OrganizationMemberConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node,
    role: OrganizationMemberRole.Member
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

const convertRepositoryCollaboratorConnection = (page: Page<User>): RepositoryCollaboratorConnectionShape => ({
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

const convertLanguageConnection = (page: Page<{id: string; name: string; size: number}>): LanguageConnectionShape => ({
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

const emptyRepositoryConnection = (): RepositoryConnectionShape => ({
  edges: [],
  nodes: [],
  pageInfo: toConnectionPageInfo({
    hasNextPage: false,
    hasPreviousPage: false
  }),
  totalCount: 0,
  totalDiskUsage: 0
});

const convertRepositoryTopicConnection = (page: Page<RepositoryTopicShape>): RepositoryTopicConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount
});

const convertRepositoryConnection = (page: Page<GraphQLData['Repository']>): RepositoryConnectionShape => ({
  edges: page.edges.map((edge) => ({
    cursor: edge.cursor,
    node: edge.node
  })),
  nodes: page.nodes,
  pageInfo: toConnectionPageInfo(page.pageInfo),
  totalCount: page.totalCount,
  totalDiskUsage: 0
});

/**
 * Resolves a login to either an organisation or a user GraphQL owner.
 *
 * @example
 * ```ts
 * const owner = deriveOwner(simulationStore, 'frontside');
 * ```
 */
export function deriveOwner(simulationStore: ExtendedSimulationStore, login: string) {
  const [org] = simulationStore.schema.organizations
    .selectTableAsList(simulationStore.store.getState())
    .filter((o) => o.login === login);
  if (org) return toGraphql(simulationStore, 'Organization', org) as GraphQLData['Organization'];

  const [userAccount] = simulationStore.schema.users
    .selectTableAsList(simulationStore.store.getState())
    // TODO should we use u?.githubAccount?.login here?
    .filter((u) => u?.login === login);
  assert(!!userAccount, `no github organization or account found for ${login}`);
  return toGraphql(simulationStore, 'User', userAccount) as GraphQLData['User'];
}

/**
 * Converts a stored entity into the corresponding GraphQL resolver shape.
 *
 * @example
 * ```ts
 * const gqlRepo = toGraphql(simulationStore, 'Repository', repository);
 * ```
 */
export function toGraphql<T extends keyof (DataSchemas | GraphQLData)>(
  simulationStore: ExtendedSimulationStore,
  __typename: T,
  entity: DataSchemas[T]
): GraphQLData[T];
export function toGraphql(
  simulationStore: ExtendedSimulationStore,
  __typename: 'User' | 'Repository' | 'Organization',
  entity: DataSchemas['User'] | DataSchemas['Repository'] | DataSchemas['Organization']
): GraphQLData['User'] | GraphQLData['Repository'] | GraphQLData['Organization'] {
  switch (__typename) {
    case 'User': {
      const user = entity as DataSchemas['User'];
      const gqlUser: GraphQLData['User'] = {
        ...toGithubRepositoryOwner(simulationStore, user),
        __typename,
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
              (org) => toGraphql(simulationStore, 'Organization', org) as GraphQLData['Organization']
            )
          );
        }
      };
      return gqlUser;
    }
    case 'Organization': {
      const org = entity as DataSchemas['Organization'];
      const gqlOrg: GraphQLData['Organization'] = {
        ...toGithubRepositoryOwner(simulationStore, org),
        __typename,
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
      return gqlOrg;
    }
    case 'Repository': {
      const repo = entity as DataSchemas['Repository'];
      const gqlRepo: GraphQLData['Repository'] = {
        __typename,
        id: String(repo.id),
        name: repo.name,
        nameWithOwner: repo.full_name,
        url: repo.url,
        createdAt: repo.created_at ?? new Date(0).toISOString(),
        ...(repo.description ? {description: repo.description} : {}),
        collaborators(pageArgs: PageArgs) {
          // TODO fill in real collaborators
          return convertRepositoryCollaboratorConnection(applyRelayPagination([], pageArgs, (user: User) => user));
        },
        get owner() {
          return deriveOwner(simulationStore, repo.owner);
        },
        defaultBranchRef: {
          id: repo.default_branch ?? 'main',
          name: repo.default_branch ?? 'main'
        },
        languages(pageArgs: PageArgs) {
          return convertLanguageConnection(
            applyRelayPagination(repo.language ? [{id: repo.language, name: repo.language, size: 0}] : [], pageArgs)
          );
        },
        repositoryTopics(pageArgs: PageArgs) {
          return convertRepositoryTopicConnection(
            applyRelayPagination(repo.topics, pageArgs, (topicName) => ({
              id: `${repo.full_name}:${topicName}`,
              resourcePath: `/${repo.full_name}/topics/${topicName}`,
              topic: {
                id: topicName,
                name: topicName,
                relatedTopics: [],
                repositories: emptyRepositoryConnection(),
                stargazerCount: 0,
                stargazers: emptyStargazerConnection(),
                viewerHasStarred: false
              },
              url: `${repo.url}/topics/${topicName}`
            }))
          );
        },
        visibility: repo.visibility === 'public' ? RepositoryVisibility.Public : RepositoryVisibility.Private,
        isArchived: repo.archived,
        isFork: repo.fork
      };
      return gqlRepo;
    }
    default:
      console.error(`toGraphql: unhandled __typename ${__typename}`, {
        entity
      });
      throw new Error(`toGraphql: unhandled __typename ${__typename} for entity ${JSON.stringify(entity)}`);
  }
}

/**
 * Builds the shared GraphQL fields for the `RepositoryOwner` interface.
 *
 * @example
 * ```ts
 * const owner = toGithubRepositoryOwner(simulationStore, 'User', user);
 * ```
 */
function toGithubRepositoryOwner(
  simulationStore: ExtendedSimulationStore,
  entity: DataSchemas['User'] | DataSchemas['Organization']
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
          (repository: DataSchemas['Repository']) =>
            toGraphql(simulationStore, 'Repository', repository) as GraphQLData['Repository']
        )
      );
    },
    resourcePath: `/${entity.login}`,
    ...(entity.url ? {url: entity.url} : {})
  };
}
