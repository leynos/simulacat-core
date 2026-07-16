/** @file GraphQL converters for the early repository-owned entity slices. */
import {IssueState, PullRequestState} from '../../__generated__/resolvers-types.ts';
import type {GitHubRepository} from '../../store/entities.ts';
import type {ExtendedSimulationStore} from '../../store/index.ts';
import {repositoryNodeId} from '../../store/keys.ts';
import type {BaseUrls} from '../../http/request-url.ts';
import {projectCommitUrls, projectIssueUrls, projectPullRequestUrls} from '../../urls/index.ts';
import type {DataSchemas, GraphQLData, ToGraphqlDispatcher} from '../to-graphql-shapes.ts';

type MinimalRepositoryRef = {
  __typename: 'Repository';
  id: string;
  name: string;
};

/** Converts a GitHub repository fixture into a minimal GraphQL repository ref. */
const wrapRepository = (repository: GitHubRepository | undefined): MinimalRepositoryRef | undefined => {
  return repository
    ? {
        __typename: 'Repository',
        id: repository.node_id ?? repositoryNodeId({owner: repository.owner, name: repository.name}),
        name: repository.name
      }
    : undefined;
};

/** Converts fixture pull request state values to GraphQL enum values. */
const convertPullRequestStateToGraphQL = (state: 'open' | 'closed' | 'merged'): PullRequestState => {
  switch (state) {
    case 'open':
      return PullRequestState.Open;
    case 'merged':
      return PullRequestState.Merged;
    case 'closed':
      return PullRequestState.Closed;
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
    if (namespaceEnd >= 0) {
      return {
        prefix: qualifiedName.slice(0, namespaceEnd + 1),
        name: qualifiedName.slice(namespaceEnd + 1)
      };
    }
  }

  const lastSlash = qualifiedName.lastIndexOf('/');
  if (lastSlash < 0) {
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
    url: projectedCommit.html_url,
    commitUrl: projectedCommit.html_url
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

  return {
    __typename: 'Ref',
    id: ref.node_id,
    name,
    prefix,
    repository: wrapRepository(
      simulationStore.selectors.getRepository(simulationStore.store.getState(), ref.owner, ref.repo)
    ),
    ...(commit ? {target: toGraphql(simulationStore, 'Commit', commit)} : {})
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
    url: projectedIssue.html_url,
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
    url: projectedPullRequest.html_url,
    permalink: projectedPullRequest.html_url,
    resourcePath: `/${pullRequest.owner}/${pullRequest.repo}/pull/${pullRequest.number}`,
    repository: wrapRepository(simulationStore.selectors.getRepository(state, pullRequest.owner, pullRequest.repo))
  };
}
