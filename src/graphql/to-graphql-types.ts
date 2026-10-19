/**
 * @file Shared types for store-to-GraphQL conversion helpers.
 *
 * This module defines the intermediate GraphQL object types and connection
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
  IssueState,
  OrganizationMemberRole,
  PageInfo as GraphqlPageInfo,
  PullRequestState,
  RepositoryPermission,
  RepositoryVisibility,
  Team,
  User
} from '../__generated__/resolvers-types.ts';

/**
 * Minimal repository relation embedded in commit, ref, issue, and pull request
 * conversions.
 *
 * The full `Repository` GraphQL object is resolved lazily by the graph, so only
 * the identity fields needed by the converters are carried here.
 */
export type RepositoryReference = {
  __typename: 'Repository';
  id: string;
  name: string;
};

/**
 * Author or committer information carried by a converted commit.
 *
 * The fixture date is the Git author/committer timestamp; GraphQL's `GitActor`
 * also exposes `avatarUrl` and `user`, which this simulator does not model.
 */
export type CommitActor = {
  name: string;
  email: string;
  date: string;
};

export type Connection<Node, Edge extends {cursor: string; node: Node}> = {
  edges: Edge[];
  nodes: Node[];
  pageInfo: GraphqlPageInfo;
  totalCount: number;
};

export type RepositoryTopicType = {
  id: string;
  resourcePath: string;
  topic: {
    id: string;
    name: string;
    relatedTopics: [];
    repositories: RepositoryConnectionType;
    stargazerCount: number;
    stargazers: {
      edges: never[];
      nodes: never[];
      pageInfo: GraphqlPageInfo;
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
    repositories: (pageArgs: PageArgs) => RepositoryConnectionType;
    organizations: (pageArgs: PageArgs) => OrganizationConnectionType;
  };
  Repository: {
    __typename: 'Repository';
    id: string;
    name: string;
    description?: string;
    nameWithOwner: string;
    url: string;
    createdAt: string;
    collaborators: (pageArgs: PageArgs) => RepositoryCollaboratorConnectionType;
    owner: GraphQLData['User'] | GraphQLData['Organization'];
    defaultBranchRef: GraphQLData['Ref'] | {id: string; name: string};
    ref: (args: {qualifiedName: string}) => GraphQLData['Ref'] | undefined;
    refs: (pageArgs: PageArgs & {refPrefix: string}) => RefConnectionType;
    issue: (args: {number: number}) => GraphQLData['Issue'] | undefined;
    issues: (pageArgs: PageArgs) => IssueConnectionType;
    pullRequest: (args: {number: number}) => GraphQLData['PullRequest'] | undefined;
    pullRequests: (pageArgs: PageArgs) => PullRequestConnectionType;
    languages: (pageArgs: PageArgs) => LanguageConnectionType;
    repositoryTopics: (pageArgs: PageArgs) => RepositoryTopicConnectionType;
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
    repositories: (pageArgs: PageArgs) => RepositoryConnectionType;
    teams: (pageArgs: PageArgs) => TeamConnectionType;
    membersWithRole: (pageArgs: PageArgs) => OrganizationMemberConnectionType;
  };
  Ref: {
    __typename: 'Ref';
    id: string;
    name: string;
    prefix: string;
    repository: RepositoryReference | undefined;
    target: GraphQLData['Commit'] | undefined;
  };
  Commit: {
    __typename: 'Commit';
    id: string;
    abbreviatedOid: string;
    oid: string;
    message: string;
    messageHeadline: string;
    messageBody: string;
    authoredDate: string;
    committedDate: string;
    author: CommitActor;
    committer: CommitActor;
    repository: RepositoryReference | undefined;
    resourcePath: string;
    url: string;
    commitUrl: string;
  };
  Issue: {
    __typename: 'Issue';
    id: string;
    number: number;
    title: string;
    body: string;
    bodyText: string;
    bodyHTML: string;
    createdAt: string;
    updatedAt: string;
    closed: boolean;
    closedAt: string | null;
    state: IssueState;
    url: string;
    resourcePath: string;
    repository: RepositoryReference | undefined;
  };
  PullRequest: {
    __typename: 'PullRequest';
    id: string;
    number: number;
    title: string;
    body: string;
    bodyText: string;
    bodyHTML: string;
    createdAt: string;
    updatedAt: string;
    closed: boolean;
    closedAt: string | null;
    merged: boolean;
    mergedAt: string | null;
    state: PullRequestState;
    isDraft: boolean;
    baseRefName: string;
    baseRefOid: string;
    headRefName: string;
    headRefOid: string;
    baseRef: GraphQLData['Ref'] | undefined;
    headRef: GraphQLData['Ref'] | undefined;
    url: string;
    permalink: string;
    resourcePath: string;
    repository: RepositoryReference | undefined;
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

export type OrganizationConnectionType = Connection<
  GraphQLData['Organization'],
  {cursor: string; node: GraphQLData['Organization']}
>;

export type TeamConnectionType = Connection<Team, {cursor: string; node: Team}>;

export type OrganizationMemberConnectionType = Connection<
  User,
  {cursor: string; node: User; role: OrganizationMemberRole}
>;

export type RepositoryCollaboratorConnectionType = Connection<
  User,
  {
    cursor: string;
    node: User;
    permission: RepositoryPermission;
    permissionSources: [];
  }
>;

export type LanguageConnectionType = Connection<
  {id: string; name: string},
  {cursor: string; node: {id: string; name: string}; size: number}
> & {totalSize: number};

export type RepositoryTopicConnectionType = Connection<
  RepositoryTopicType,
  {cursor: string; node: RepositoryTopicType}
>;

export type RepositoryConnectionType = Connection<
  GraphQLData['Repository'],
  {cursor: string; node: GraphQLData['Repository']}
> & {totalDiskUsage: number};

/**
 * `Connection` type for `GraphQLData['Ref']` nodes.
 *
 * Edges carry `cursor: string` and `node: GraphQLData['Ref']` payloads.
 */
export type RefConnectionType = Connection<GraphQLData['Ref'], {cursor: string; node: GraphQLData['Ref']}>;

/**
 * `Connection` type for `GraphQLData['Issue']` nodes.
 *
 * Edges carry `cursor: string` and `node: GraphQLData['Issue']` payloads.
 */
export type IssueConnectionType = Connection<GraphQLData['Issue'], {cursor: string; node: GraphQLData['Issue']}>;

/**
 * `Connection` type for `GraphQLData['PullRequest']` nodes.
 *
 * Edges carry `cursor: string` and `node: GraphQLData['PullRequest']`
 * payloads.
 */
export type PullRequestConnectionType = Connection<
  GraphQLData['PullRequest'],
  {cursor: string; node: GraphQLData['PullRequest']}
>;

export type ToGraphqlDispatcher = <T extends keyof DataSchemas>(
  simulationStore: ExtendedSimulationStore,
  __typename: T,
  entity: DataSchemas[T]
) => GraphQLData[T];
