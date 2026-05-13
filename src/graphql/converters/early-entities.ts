/** @file GraphQL converters for the early repository-owned entity slices. */
import {IssueState, PullRequestState} from '../../__generated__/resolvers-types.ts';
import type {GitHubRepository} from '../../store/entities.ts';
import type {ExtendedSimulationStore} from '../../store/index.ts';
import {repositoryNodeId} from '../../store/keys.ts';
import type {DataSchemas, GraphQLData, ToGraphqlDispatcher} from '../to-graphql-shapes.ts';

type MinimalRepositoryRef = {
  __typename: 'Repository';
  id: string;
  name: string;
};

/**
 * Converts a GitHub repository fixture into a minimal GraphQL repository ref.
 *
 * @param repository GitHub repository fixture to wrap, or `undefined`.
 * @returns A minimal repository reference, or `undefined` when `repository` is
 * undefined.
 *
 * The conversion maps `node_id` to GraphQL `id`, preserves `name`, and sets
 * `__typename` to `Repository`.
 */
const wrapRepository = (repository: GitHubRepository | undefined): MinimalRepositoryRef | undefined => {
  return repository
    ? {
        __typename: 'Repository',
        id: repository.node_id ?? repositoryNodeId({owner: repository.owner, name: repository.name}),
        name: repository.name
      }
    : undefined;
};

/**
 * Converts fixture pull request state values to GraphQL enum values.
 *
 * @param state Pull request fixture state: `open`, `closed`, or `merged`.
 * @returns The matching GraphQL `PullRequestState` value: `Open`, `Closed`, or
 * `Merged`.
 *
 * The default branch assigns `state` to `never` so TypeScript validates the
 * mapping exhaustively. It throws an `Error` if an unhandled state reaches
 * runtime.
 */
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

/**
 * Splits a qualified ref name into GraphQL prefix and name fields.
 *
 * @param qualifiedName Ref name supplied by the fixture.
 * @returns A prefix/name pair for the GraphQL `Ref` shape.
 */
const splitRefName = (qualifiedName: string) => {
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
 * @returns The GraphQL commit object.
 */
export function convertCommitToGraphql(
  simulationStore: ExtendedSimulationStore,
  commit: DataSchemas['Commit']
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
    url: commit.html_url,
    commitUrl: commit.html_url
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
 * @returns The GraphQL issue object.
 */
export function convertIssueToGraphql(
  simulationStore: ExtendedSimulationStore,
  issue: DataSchemas['Issue']
): GraphQLData['Issue'] {
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
    url: issue.html_url,
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
 * @returns The GraphQL pull request object.
 */
export function convertPullRequestToGraphql(
  simulationStore: ExtendedSimulationStore,
  pullRequest: DataSchemas['PullRequest'],
  toGraphql: ToGraphqlDispatcher
): GraphQLData['PullRequest'] {
  const state = simulationStore.store.getState();
  const relations = simulationStore.selectors.resolvePullRequestRelations(state, pullRequest);

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
    url: pullRequest.html_url,
    permalink: pullRequest.html_url,
    resourcePath: `/${pullRequest.owner}/${pullRequest.repo}/pull/${pullRequest.number}`,
    repository: wrapRepository(simulationStore.selectors.getRepository(state, pullRequest.owner, pullRequest.repo))
  };
}
