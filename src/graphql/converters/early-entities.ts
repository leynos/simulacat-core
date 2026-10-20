/** @file GraphQL converters for the early repository-owned entity slices. */
import {IssueState, PullRequestState} from '../../__generated__/resolvers-types.ts';
import type {GitHubRepository} from '../../store/entities.ts';
import type {ExtendedSimulationStore} from '../../store/index.ts';
import {repositoryNodeId} from '../../store/keys.ts';
import type {BaseUrls} from '../../http/request-url.ts';
import {GraphqlProjectionError, type ProjectionEntity} from '../projection-error.ts';
import {projectCommitUrls, projectIssueUrls, projectPullRequestUrls} from '../../urls/index.ts';
import type {DataSchemas, GraphQLData, RepositoryReference, ToGraphqlDispatcher} from '../to-graphql-types.ts';

// The projection helpers fill missing fields from the request base URLs, so a
// missing value means the fixture could not be converted into a usable URL.
/** Requires a URL that request-scoped projection must have derived. */
const requireProjectedUrl = (url: string | null | undefined, entity: ProjectionEntity): string => {
  if (url === null || url === undefined) {
    throw new GraphqlProjectionError(entity);
  }
  return url;
};

/**
 * Fixture fields needed to describe an embedded repository reference.
 *
 * `node_id` is optional here because a test builder may assemble a fixture
 * without running it through `githubRepositorySchema`, which normally derives
 * the id during its transform.
 */
type RepositoryFixtureRef = Pick<GitHubRepository, 'name' | 'owner'> & {node_id?: string | undefined};

/** Converts a GitHub repository fixture into a minimal GraphQL repository ref. */
const wrapRepository = (repository: RepositoryFixtureRef | undefined): RepositoryReference | undefined => {
  return repository
    ? {
        __typename: 'Repository',
        // A repository parsed from a fixture always carries a node id; the
        // fallback covers fixtures assembled directly in test builders.
        id: repository.node_id ?? repositoryNodeId({owner: repository.owner, name: repository.name}),
        name: repository.name
      }
    : undefined;
};

/** Converts fixture pull request state values to GraphQL enum values. */
const convertPullRequestStateToGraphQL = (state: 'open' | 'closed' | 'merged'): PullRequestState => {
  switch (state) {
    case 'open': {
      return PullRequestState.Open;
    }
    case 'merged': {
      return PullRequestState.Merged;
    }
    case 'closed': {
      return PullRequestState.Closed;
    }
    default: {
      const exhaustive: never = state;
      throw new Error(`Unhandled pull request state: ${exhaustive}`);
    }
  }
};

/** Splits a qualified ref name into GraphQL prefix and name fields. */
const splitRefName = (qualifiedName: string) => {
  if (qualifiedName.startsWith('refs/')) {
    const namespaceEnd = qualifiedName.indexOf('/', 'refs/'.length);
    if (namespaceEnd !== -1) {
      return {
        prefix: qualifiedName.slice(0, namespaceEnd + 1),
        name: qualifiedName.slice(namespaceEnd + 1)
      };
    }
  }

  const lastSlash = qualifiedName.lastIndexOf('/');
  if (lastSlash === -1) {
    return {prefix: '', name: qualifiedName};
  }

  return {
    prefix: `${qualifiedName.slice(0, lastSlash + 1)}`,
    name: qualifiedName.slice(lastSlash + 1)
  };
};

/**
 * Converts a Git commit fixture to the GraphQL Commit shape.
 *
 * @param simulationStore Simulation store used for resolving the repository.
 * @param commit Commit fixture to convert.
 * @param baseUrls Request-derived API and web bases for URL projection.
 * @returns The GraphQL commit object.
 */
export function convertCommitToGraphql(
  simulationStore: ExtendedSimulationStore,
  commit: DataSchemas['Commit'],
  baseUrls: BaseUrls
): GraphQLData['Commit'] {
  const repository = simulationStore.selectors.getRepository(
    simulationStore.store.getState(),
    commit.owner,
    commit.repo
  );
  const messageParts = commit.commit.message.split(/\r?\n/);
  const messageHeadline = messageParts[0] ?? commit.commit.message;
  const messageBody = messageParts.slice(1).join('\n');
  const repositoryRef = wrapRepository(repository);
  const projectedCommit = projectCommitUrls(commit, baseUrls);
  const commitUrl = requireProjectedUrl(projectedCommit.html_url, 'commit');

  return {
    __typename: 'Commit',
    id: commit.node_id,
    abbreviatedOid: commit.sha.slice(0, 7),
    oid: commit.sha,
    message: commit.commit.message,
    messageHeadline,
    messageBody,
    authoredDate: commit.commit.author.date,
    committedDate: commit.commit.committer.date,
    author: {name: commit.commit.author.name, email: commit.commit.author.email, date: commit.commit.author.date},
    committer: {
      name: commit.commit.committer.name,
      email: commit.commit.committer.email,
      date: commit.commit.committer.date
    },
    repository: repositoryRef,
    resourcePath: `/${commit.owner}/${commit.repo}/commit/${commit.sha}`,
    url: commitUrl,
    commitUrl
  };
}

/**
 * Converts a GitHub ref fixture to the GraphQL Ref shape.
 *
 * @param simulationStore Simulation store used for resolving relations.
 * @param ref Ref fixture to convert.
 * @param toGraphql Dispatcher used for related-entity conversions.
 * @returns The GraphQL ref object.
 */
export function convertRefToGraphql(
  simulationStore: ExtendedSimulationStore,
  ref: DataSchemas['Ref'],
  toGraphql: ToGraphqlDispatcher
): GraphQLData['Ref'] {
  const {name, prefix} = splitRefName(ref.ref);
  const commit = simulationStore.selectors.getCommit(simulationStore.store.getState(), {
    owner: ref.owner,
    repo: ref.repo,
    sha: ref.object.sha
  });

  const target = commit ? toGraphql(simulationStore, 'Commit', commit) : undefined;

  return {
    __typename: 'Ref',
    id: ref.node_id,
    name,
    prefix,
    repository: wrapRepository(
      simulationStore.selectors.getRepository(simulationStore.store.getState(), ref.owner, ref.repo)
    ),
    target
  };
}

/**
 * Converts a GitHub issue fixture to the GraphQL Issue shape.
 *
 * @param simulationStore Simulation store used for resolving relations.
 * @param issue Issue fixture to convert.
 * @param baseUrls Request-derived API and web bases for URL projection.
 * @returns The GraphQL issue object.
 */
export function convertIssueToGraphql(
  simulationStore: ExtendedSimulationStore,
  issue: DataSchemas['Issue'],
  baseUrls: BaseUrls
): GraphQLData['Issue'] {
  const projectedIssue = projectIssueUrls(issue, baseUrls);
  const issueUrl = requireProjectedUrl(projectedIssue.html_url, 'issue');

  return {
    __typename: 'Issue',
    id: issue.node_id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    bodyText: issue.body,
    bodyHTML: issue.body,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    closed: issue.state === 'closed',
    closedAt: issue.closed_at,
    state: issue.state === 'open' ? IssueState.Open : IssueState.Closed,
    url: issueUrl,
    resourcePath: `/${issue.owner}/${issue.repo}/issues/${issue.number}`,
    repository: wrapRepository(
      simulationStore.selectors.getRepository(simulationStore.store.getState(), issue.owner, issue.repo)
    )
  };
}

/**
 * Converts a GitHub pull request fixture to the GraphQL PullRequest shape.
 *
 * @param simulationStore Simulation store used for resolving relations.
 * @param pullRequest Pull request fixture to convert.
 * @param toGraphql Dispatcher used for related-entity conversions.
 * @param baseUrls Request-derived API and web bases for URL projection.
 * @returns The GraphQL pull request object.
 */
export function convertPullRequestToGraphql(
  simulationStore: ExtendedSimulationStore,
  pullRequest: DataSchemas['PullRequest'],
  toGraphql: ToGraphqlDispatcher,
  baseUrls: BaseUrls
): GraphQLData['PullRequest'] {
  const state = simulationStore.store.getState();
  const relations = simulationStore.selectors.resolvePullRequestRelations(state, pullRequest);
  const projectedPullRequest = projectPullRequestUrls(pullRequest, baseUrls);
  const pullRequestUrl = requireProjectedUrl(projectedPullRequest.html_url, 'pull-request');

  return {
    __typename: 'PullRequest',
    id: pullRequest.node_id,
    number: pullRequest.number,
    title: pullRequest.title,
    body: pullRequest.body,
    bodyText: pullRequest.body,
    bodyHTML: pullRequest.body,
    createdAt: pullRequest.created_at,
    updatedAt: pullRequest.updated_at,
    closed: pullRequest.state !== 'open',
    closedAt: pullRequest.closed_at,
    merged: pullRequest.state === 'merged',
    mergedAt: pullRequest.merged_at,
    state: convertPullRequestStateToGraphQL(pullRequest.state),
    isDraft: pullRequest.draft,
    baseRefName: pullRequest.base.ref,
    baseRefOid: pullRequest.base.sha,
    headRefName: pullRequest.head.ref,
    headRefOid: pullRequest.head.sha,
    baseRef: relations.baseRef ? toGraphql(simulationStore, 'Ref', relations.baseRef) : undefined,
    headRef: relations.headRef ? toGraphql(simulationStore, 'Ref', relations.headRef) : undefined,
    url: pullRequestUrl,
    permalink: pullRequestUrl,
    resourcePath: `/${pullRequest.owner}/${pullRequest.repo}/pull/${pullRequest.number}`,
    repository: wrapRepository(simulationStore.selectors.getRepository(state, pullRequest.owner, pullRequest.repo))
  };
}
