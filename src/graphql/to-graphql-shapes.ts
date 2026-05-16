/**
 * @file Shared types for store-to-GraphQL conversion helpers.
 *
 * This module defines the intermediate GraphQL object shapes and connection
 * types that the resolver conversion helpers compose before handing values to
 * the generated resolver contracts.
 */
import type {PageArgs} from './relay.ts';
import type {ExtendedSimulationStore} from '../store/index.ts';
import type {
  GitHubCommit,
  GitHubIssue,
  GitHubOrganization,
  GitHubPullRequest,
  GitHubRef,
  GitHubRepository,
  GitHubUser
} from '../store/entities.ts';
import type {
  OrganizationMemberRole,
  PageInfo as GraphqlPageInfo,
  RepositoryPermission,
  RepositoryVisibility,
  Team,
  User
} from '../__generated__/resolvers-types.ts';

export type ConnectionPageInfo = GraphqlPageInfo;

export type Connection<Node, Edge extends {cursor: string; node: Node}> = {
  edges: Edge[];
  nodes: Node[];
  pageInfo: ConnectionPageInfo;
  totalCount: number;
};

export type RepositoryTopicShape = {
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

export interface GraphQLData {
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
    defaultBranchRef: GraphQLData['Ref'] | {id: string; name: string};
    ref: (args: {qualifiedName: string}) => GraphQLData['Ref'] | undefined;
    refs: (pageArgs: PageArgs & {refPrefix: string}) => RefConnectionShape;
    issue: (args: {number: number}) => GraphQLData['Issue'] | undefined;
    issues: (pageArgs: PageArgs) => IssueConnectionShape;
    pullRequest: (args: {number: number}) => GraphQLData['PullRequest'] | undefined;
    pullRequests: (pageArgs: PageArgs) => PullRequestConnectionShape;
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
  Ref: Record<string, unknown> & {
    __typename: 'Ref';
    id: string;
    name: string;
    prefix: string;
    target?: GraphQLData['Commit'];
  };
  Commit: Record<string, unknown> & {
    __typename: 'Commit';
    id: string;
    oid: string;
    message: string;
  };
  Issue: Record<string, unknown> & {
    __typename: 'Issue';
    id: string;
    number: number;
    title: string;
    body: string;
  };
  PullRequest: Record<string, unknown> & {
    __typename: 'PullRequest';
    id: string;
    number: number;
    title: string;
    body: string;
  };
}

export interface DataSchemas {
  User: GitHubUser;
  Repository: GitHubRepository;
  Organization: GitHubOrganization;
  Ref: GitHubRef;
  Commit: GitHubCommit;
  Issue: GitHubIssue;
  PullRequest: GitHubPullRequest;
}

export type OrganizationConnectionShape = Connection<
  GraphQLData['Organization'],
  {cursor: string; node: GraphQLData['Organization']}
>;

export type TeamConnectionShape = Connection<Team, {cursor: string; node: Team}>;

export type OrganizationMemberConnectionShape = Connection<
  User,
  {cursor: string; node: User; role: OrganizationMemberRole}
>;

export type RepositoryCollaboratorConnectionShape = Connection<
  User,
  {
    cursor: string;
    node: User;
    permission: RepositoryPermission;
    permissionSources: [];
  }
>;

export type LanguageConnectionShape = Connection<
  {id: string; name: string},
  {cursor: string; node: {id: string; name: string}; size: number}
> & {totalSize: number};

export type RepositoryTopicConnectionShape = Connection<
  RepositoryTopicShape,
  {cursor: string; node: RepositoryTopicShape}
>;

export type RepositoryConnectionShape = Connection<
  GraphQLData['Repository'],
  {cursor: string; node: GraphQLData['Repository']}
> & {totalDiskUsage: number};

/**
 * `Connection` shape for `GraphQLData['Ref']` nodes.
 *
 * Edges carry `cursor: string` and `node: GraphQLData['Ref']` payloads.
 */
export type RefConnectionShape = Connection<GraphQLData['Ref'], {cursor: string; node: GraphQLData['Ref']}>;

/**
 * `Connection` shape for `GraphQLData['Issue']` nodes.
 *
 * Edges carry `cursor: string` and `node: GraphQLData['Issue']` payloads.
 */
export type IssueConnectionShape = Connection<GraphQLData['Issue'], {cursor: string; node: GraphQLData['Issue']}>;

/**
 * `Connection` shape for `GraphQLData['PullRequest']` nodes.
 *
 * Edges carry `cursor: string` and `node: GraphQLData['PullRequest']`
 * payloads.
 */
export type PullRequestConnectionShape = Connection<
  GraphQLData['PullRequest'],
  {cursor: string; node: GraphQLData['PullRequest']}
>;

export type ToGraphqlDispatcher = <T extends keyof DataSchemas>(
  simulationStore: ExtendedSimulationStore,
  __typename: T,
  entity: DataSchemas[T]
) => GraphQLData[T];
